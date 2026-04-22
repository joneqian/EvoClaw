/**
 * 飞书 SDK 自定义 logger + WS 状态观察器
 *
 * 解决两个问题：
 * 1. `@larksuiteoapi/node-sdk` 默认把 WS 相关日志直接 console.log 到 stdout，
 *    不经过 EvoClaw 的 logger 管道（不写 core.log、不能脱敏、不带 tag）
 * 2. FeishuAdapter 只在初次 `wsClient.start()` 成功时标记 connected；运行期
 *    断连 / 重连 / 心跳失效完全不反馈到 `channel_status`，前端界面一直显示
 *    "已连接"但消息收不到（排查极痛苦）
 *
 * 做法：
 * - 实现 SDK `logger` 参数接收的接口（`{ error/warn/info/debug/trace }`）
 * - 转发到 EvoClaw `createLogger('feishu-ws')`
 * - 识别关键字符串（见 SDK `lib/index.js` `class WSClient`），回调 observer
 *   告知 WS 真实状态变化
 *
 * SDK 内部的关键字符串（抓自 @larksuiteoapi/node-sdk@1.61.x `class WSClient`）：
 * - 'ws connect success'   → 连接已建立（'open' 事件）
 * - 'ws connect failed'    → WebSocket 'error' 事件（handshake 阶段）
 * - 'connect failed'       → reConnect 判定初次连接失败
 * - 'ws error'             → 运行期 WS error 事件
 * - 'client closed'        → WS 'close' 事件，即将 reConnect
 * - 'reconnect'            → 开始重连轮
 * - 'reconnect success'    → 重连成功
 * - 'ws client ready'      → 初次 start 链路完成
 */

import type { createLogger } from '../../../infrastructure/logger.js';

type AppLogger = ReturnType<typeof createLogger>;

/** SDK 兼容的 logger 接口 */
export interface FeishuSdkLogger {
  error: (args: unknown[]) => void;
  warn: (args: unknown[]) => void;
  info: (args: unknown[]) => void;
  debug: (args: unknown[]) => void;
  trace: (args: unknown[]) => void;
}

/** WS 真实状态事件 */
export type FeishuWsStatusEvent =
  | { kind: 'connect_success' }
  | { kind: 'connect_failed'; reason: string }
  | { kind: 'client_closed' }
  | { kind: 'reconnecting' }
  | { kind: 'reconnect_success' }
  | { kind: 'client_ready' }
  | { kind: 'ws_error'; reason: string };

/** 从一条 SDK 日志（args 数组）尝试识别状态事件 */
export function detectWsStatus(args: readonly unknown[]): FeishuWsStatusEvent | null {
  const text = args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ');
  // 必须是 [ws] 标签开头，避免其他 [http] / [dispatcher] 日志误触发
  if (!text.includes('[ws]')) return null;

  if (text.includes('ws connect success')) return { kind: 'connect_success' };
  if (text.includes('reconnect success')) return { kind: 'reconnect_success' };
  if (text.includes('ws client ready')) return { kind: 'client_ready' };
  if (text.includes('client closed')) return { kind: 'client_closed' };
  if (text.includes('ws connect failed')) {
    return { kind: 'connect_failed', reason: 'WebSocket 握手失败' };
  }
  // 注意：'connect failed' 必须排在 'ws connect failed' 之后判断
  if (/(?<!ws\s)connect failed/.test(text) || text.includes(' connect failed')) {
    return { kind: 'connect_failed', reason: 'WS 连接建立失败' };
  }
  if (text.includes('ws error')) return { kind: 'ws_error', reason: text };
  // reconnect 动作词需避免误伤 'reconnect success'
  if (/\breconnect\b/.test(text) && !text.includes('reconnect success')) {
    return { kind: 'reconnecting' };
  }
  return null;
}

function safeStringify(v: unknown): string {
  try {
    if (v instanceof Error) return `${v.name}: ${v.message}`;
    if (typeof v === 'object' && v !== null) return JSON.stringify(v);
    return String(v);
  } catch {
    return '[unserializable]';
  }
}

/**
 * 构造一个 SDK 兼容 logger，转发日志到 EvoClaw logger 并把 WS 状态变化
 * 回调给 observer
 *
 * observer 会在识别到已知事件时被调用；未识别的日志只做转发，不回调。
 */
export function createFeishuSdkLogger(
  appLogger: AppLogger,
  observer: (ev: FeishuWsStatusEvent) => void,
): FeishuSdkLogger {
  const forward = (
    level: 'error' | 'warn' | 'info' | 'debug',
    args: unknown[],
  ) => {
    const text = args
      .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
      .join(' ');
    appLogger[level](text);
    const ev = detectWsStatus(args);
    if (ev) {
      try {
        observer(ev);
      } catch {
        // observer 出错不应让 SDK 日志丢失
      }
    }
  };

  return {
    error: (args) => forward('error', args),
    warn: (args) => forward('warn', args),
    info: (args) => forward('info', args),
    // SDK 的 debug/trace 比较啰嗦，降到我们的 debug 通道即可
    debug: (args) => forward('debug', args),
    trace: (args) => forward('debug', args),
  };
}
