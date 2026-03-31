/**
 * System Events — 内存事件队列
 *
 * 轻量级 per-session 事件队列，用于在下一次 Agent turn 的 prompt 中注入事件。
 * 参考 OpenClaw 的 system-events.ts 设计。
 *
 * 特点：
 * - 纯内存，无持久化（事件是临时的，sidecar 重启即清空）
 * - 连续重复文本去重 + contextKey 去重
 * - 每个 session 最多 20 条事件
 * - drain 消费后自动清空
 * - heartbeat 噪音事件过滤
 * - 时间戳格式化输出
 */

/** 投递上下文 */
export interface DeliveryContext {
  channel?: string;
  accountId?: string;
}

export interface SystemEvent {
  text: string;
  ts: number;
  /** 上下文标识，用于去重和追踪来源（如 "cron:jobId" / "wake"） */
  contextKey?: string | null;
  /** 投递上下文（渠道、接收者等路由信息） */
  deliveryContext?: DeliveryContext;
}

/** 入队选项 */
export interface EnqueueOpts {
  contextKey?: string | null;
  deliveryContext?: DeliveryContext;
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
export function enqueueSystemEvent(
  text: string,
  sessionKey: string,
  opts?: EnqueueOpts,
): boolean {
  const cleaned = text.trim();
  if (!cleaned || !sessionKey) return false;

  const entry = getOrCreateQueue(sessionKey);

  // 连续重复去重
  if (entry.lastText === cleaned) return false;
  entry.lastText = cleaned;

  // contextKey 去重（同一 contextKey 的事件只保留最新）
  if (opts?.contextKey) {
    const idx = entry.queue.findIndex(e => e.contextKey === opts.contextKey);
    if (idx >= 0) {
      entry.queue.splice(idx, 1);
    }
  }

  entry.queue.push({
    text: cleaned,
    ts: Date.now(),
    contextKey: opts?.contextKey ?? null,
    deliveryContext: opts?.deliveryContext,
  });

  // 容量限制
  if (entry.queue.length > MAX_EVENTS) {
    entry.queue.shift();
  }
  return true;
}

/** 消费并清空事件队列（返回原始文本） */
export function drainSystemEvents(sessionKey: string): string[] {
  const entry = queues.get(sessionKey);
  if (!entry || entry.queue.length === 0) return [];

  const texts = entry.queue.map(e => e.text);
  entry.queue.length = 0;
  entry.lastText = null;
  queues.delete(sessionKey);
  return texts;
}

/** 消费并返回完整事件记录（用于需要 deliveryContext 等元信息的场景） */
export function drainSystemEventEntries(sessionKey: string): SystemEvent[] {
  const entry = queues.get(sessionKey);
  if (!entry || entry.queue.length === 0) return [];

  const events = [...entry.queue];
  entry.queue.length = 0;
  entry.lastText = null;
  queues.delete(sessionKey);
  return events;
}

/** 检测是否为 heartbeat 噪音事件 */
export function isHeartbeatNoiseEvent(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('read heartbeat.md') ||
    lower.includes('heartbeat poll') ||
    lower.includes('heartbeat wake') ||
    lower.includes('reason periodic')
  );
}

/** 消费并返回格式化的事件文本（过滤噪音 + 时间戳格式化） */
export function drainFormattedSystemEvents(sessionKey: string): string[] {
  const events = drainSystemEventEntries(sessionKey);
  return events
    .filter(e => !isHeartbeatNoiseEvent(e.text))
    .map(e => {
      const ts = new Date(e.ts).toISOString().slice(11, 19); // HH:mm:ss
      return `[${ts}] ${e.text}`;
    });
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
