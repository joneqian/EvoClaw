/**
 * System Events — 内存事件队列
 *
 * 轻量级 per-session 事件队列，用于在下一次 Agent turn 的 prompt 中注入事件。
 * 参考 OpenClaw 的 system-events.ts 设计。
 *
 * 特点：
 * - 纯内存，无持久化（事件是临时的，sidecar 重启即清空）
 * - 连续重复文本去重
 * - 每个 session 最多 20 条事件
 * - drain 消费后自动清空
 */

export interface SystemEvent {
  text: string;
  ts: number;
}

const MAX_EVENTS = 20;

interface SessionQueue {
  queue: SystemEvent[];
  lastText: string | null;
}

const queues = new Map<string, SessionQueue>();

function getOrCreateQueue(sessionKey: string): SessionQueue {
  const existing = queues.get(sessionKey);
  if (existing) return existing;
  const created: SessionQueue = { queue: [], lastText: null };
  queues.set(sessionKey, created);
  return created;
}

/** 入队系统事件 */
export function enqueueSystemEvent(text: string, sessionKey: string): boolean {
  const cleaned = text.trim();
  if (!cleaned || !sessionKey) return false;

  const entry = getOrCreateQueue(sessionKey);

  // 连续重复去重
  if (entry.lastText === cleaned) return false;
  entry.lastText = cleaned;

  entry.queue.push({ text: cleaned, ts: Date.now() });

  // 容量限制
  if (entry.queue.length > MAX_EVENTS) {
    entry.queue.shift();
  }
  return true;
}

/** 消费并清空事件队列 */
export function drainSystemEvents(sessionKey: string): string[] {
  const entry = queues.get(sessionKey);
  if (!entry || entry.queue.length === 0) return [];

  const texts = entry.queue.map(e => e.text);
  entry.queue.length = 0;
  entry.lastText = null;
  queues.delete(sessionKey);
  return texts;
}

/** 查看事件（不消费） */
export function peekSystemEvents(sessionKey: string): string[] {
  return queues.get(sessionKey)?.queue.map(e => e.text) ?? [];
}

/** 是否有待处理事件 */
export function hasSystemEvents(sessionKey: string): boolean {
  return (queues.get(sessionKey)?.queue.length ?? 0) > 0;
}

/** 重置所有队列（测试用） */
export function resetSystemEventsForTest(): void {
  queues.clear();
}
