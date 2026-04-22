/**
 * Weixin 通道 Debug 模式管理
 *
 * 通过 ChannelStateRepo 持久化 debug 状态，
 * 启用后每条 AI 回复追加全链路耗时信息。
 */

import type { ChannelStateRepo } from '../channel-state-repo.js';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 状态存储 key 前缀 */
const DEBUG_KEY_PREFIX = 'debug:';

/** 通道类型标识 */
const CHANNEL = 'weixin' as const;

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 全链路耗时信息 */
export interface PipelineTiming {
  /** 插件收到消息的时间戳 (ms) */
  receivedAt: number;
  /** 媒体下载耗时 (ms) */
  mediaDownloadMs: number;
  /** AI 开始处理时间戳 (ms) */
  aiStartAt: number;
  /** AI 结束处理时间戳 (ms) */
  aiEndAt: number;
  /** 平台侧事件时间戳 (ms) */
  eventTimeMs?: number;
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

/**
 * 检查指定业务账号是否启用了 debug 模式
 *
 * 注意：这里的 accountId 是**业务层账号**（某个微信联系人 ID），
 * 与 ChannelState 的 accountId（多微信应用维度，过渡期用 ''）是两个概念。
 */
export function isDebugEnabled(accountId: string, stateRepo: ChannelStateRepo): boolean {
  const value = stateRepo.getState(CHANNEL, '', `${DEBUG_KEY_PREFIX}${accountId}`);
  return value === 'true';
}

/** 切换 debug 模式，返回新状态 */
export function toggleDebugMode(accountId: string, stateRepo: ChannelStateRepo): boolean {
  const current = isDebugEnabled(accountId, stateRepo);
  const next = !current;
  stateRepo.setState(CHANNEL, '', `${DEBUG_KEY_PREFIX}${accountId}`, String(next));
  return next;
}

/**
 * 格式化全链路耗时为可读文本
 *
 * 输出示例:
 * ```
 * ⏱ Debug 全链路
 * ├ 平台→插件: 120ms
 * ├ 媒体下载: 350ms
 * ├ AI 生成: 2100ms
 * ├ 总耗时: 2570ms
 * └ eventTime: 2026-03-23T10:00:00.000Z
 * ```
 */
export function formatDebugTrace(timing: PipelineTiming): string {
  const eventTs = timing.eventTimeMs ?? 0;
  const platformDelay = eventTs > 0 ? `${timing.receivedAt - eventTs}ms` : 'N/A';
  const aiDuration = timing.aiEndAt - timing.aiStartAt;
  const totalDuration = timing.aiEndAt - timing.receivedAt;
  const eventTimeStr = eventTs > 0 ? new Date(eventTs).toISOString() : 'N/A';

  return [
    '⏱ Debug 全链路',
    `├ 平台→插件: ${platformDelay}`,
    `├ 媒体下载: ${timing.mediaDownloadMs}ms`,
    `├ AI 生成: ${aiDuration}ms`,
    `├ 总耗时: ${totalDuration}ms`,
    `└ eventTime: ${eventTimeStr}`,
  ].join('\n');
}
