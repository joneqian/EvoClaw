/**
 * 入站消息 LRU 缓存
 *
 * 目的：用户在飞书"引用回复"某条机器人/他人消息时，飞书 WS 事件只给
 * `parent_id`（指向被引用消息的 message_id），不带原文。缓存最近的入站消息
 * 可以 O(1) 命中大多数情况，miss 时由 inbound 走 SDK `im.message.get` 兜底。
 *
 * 策略：LRU + TTL，软上限淘汰。与 SEEN_MESSAGE_IDS 同形态。
 */
export interface FeishuMessageCacheEntry {
  messageId: string;
  senderId: string;
  senderName?: string;
  content: string;
  timestamp: number;
}

export interface FeishuMessageCacheOptions {
  /** 最多缓存多少条消息，默认 200 */
  maxSize?: number;
  /** TTL 毫秒，默认 10 分钟 */
  ttlMs?: number;
}

export interface FeishuMessageCache {
  put(entry: FeishuMessageCacheEntry): void;
  get(messageId: string): FeishuMessageCacheEntry | null;
  clear(): void;
  /** 当前条目数（测试用） */
  size(): number;
}

interface InternalRecord {
  entry: FeishuMessageCacheEntry;
  /** 插入时间戳，用于 TTL / LRU 淘汰 */
  ts: number;
}

export function createFeishuMessageCache(
  options: FeishuMessageCacheOptions = {},
): FeishuMessageCache {
  const maxSize = options.maxSize ?? 200;
  const ttlMs = options.ttlMs ?? 10 * 60_000;
  const store = new Map<string, InternalRecord>();

  const evictExpired = (now: number): void => {
    const cutoff = now - ttlMs;
    for (const [id, rec] of store.entries()) {
      if (rec.ts < cutoff) store.delete(id);
    }
  };

  const evictOldestHalf = (): void => {
    const entries = Array.from(store.entries()).sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < entries.length / 2; i++) {
      const entry = entries[i];
      if (entry) store.delete(entry[0]);
    }
  };

  return {
    put(entry) {
      const now = Date.now();
      if (store.size >= maxSize) {
        evictExpired(now);
        if (store.size >= maxSize) evictOldestHalf();
      }
      // 重复 put 覆盖而非新增，避免容量膨胀
      store.set(entry.messageId, { entry, ts: now });
    },

    get(messageId) {
      const rec = store.get(messageId);
      if (!rec) return null;
      if (Date.now() - rec.ts >= ttlMs) {
        store.delete(messageId);
        return null;
      }
      return rec.entry;
    },

    clear() {
      store.clear();
    },

    size() {
      return store.size;
    },
  };
}
