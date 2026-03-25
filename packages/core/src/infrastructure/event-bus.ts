/**
 * 全局事件总线 — Sidecar 内部事件广播
 * 用于通知前端 SSE 通道有新事件（如渠道消息产生新会话）
 */

import { EventEmitter } from 'node:events';

/** 事件类型 */
export type ServerEventType = 'conversations-changed' | 'channel-status-changed';

/** 事件数据 */
export interface ServerEvent {
  type: ServerEventType;
  data?: Record<string, unknown>;
}

/** 全局事件总线单例 */
export const serverEventBus = new EventEmitter();
serverEventBus.setMaxListeners(50); // 支持多个 SSE 连接

/** 发布事件 */
export function emitServerEvent(event: ServerEvent): void {
  serverEventBus.emit('server-event', event);
  // Tauri IPC 通道：Rust host 读取 stdout 后通过 app_handle.emit() 转发给前端
  // 协议：含 __event 字段的 JSON 行 = 事件（首行 {port,token} 无此字段，不冲突）
  try {
    process.stdout.write(JSON.stringify({ __event: event.type, ...event.data }) + '\n');
  } catch { /* stdout 不可写时静默忽略（如管道断开） */ }
}
