/**
 * 飞书入站消息 LRU 缓存 —— 供 parent_id 引用查询
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createFeishuMessageCache,
  type FeishuMessageCacheEntry,
} from '../../channel/adapters/feishu/message-cache.js';

function mkEntry(
  id: string,
  over: Partial<FeishuMessageCacheEntry> = {},
): FeishuMessageCacheEntry {
  return {
    messageId: id,
    senderId: 'ou_u',
    senderName: 'Alice',
    content: `body of ${id}`,
    timestamp: Date.now(),
    ...over,
  };
}

describe('FeishuMessageCache', () => {
  let cache: ReturnType<typeof createFeishuMessageCache>;

  beforeEach(() => {
    cache = createFeishuMessageCache({ maxSize: 5, ttlMs: 60_000 });
  });

  it('put + get 命中', () => {
    const e = mkEntry('om_1');
    cache.put(e);
    expect(cache.get('om_1')).toEqual(e);
  });

  it('get miss 返回 null', () => {
    expect(cache.get('om_x')).toBeNull();
  });

  it('超出 maxSize 时淘汰最老条目', () => {
    for (let i = 1; i <= 5; i++) cache.put(mkEntry(`om_${i}`));
    cache.put(mkEntry('om_6'));
    // om_1 应被淘汰
    expect(cache.get('om_1')).toBeNull();
    expect(cache.get('om_6')).not.toBeNull();
  });

  it('TTL 过期不返回', () => {
    const c = createFeishuMessageCache({ maxSize: 10, ttlMs: 10 });
    c.put(mkEntry('om_1'));
    return new Promise((r) => setTimeout(r, 20)).then(() => {
      expect(c.get('om_1')).toBeNull();
    });
  });

  it('重复 put 覆盖旧值且不膨胀容量', () => {
    cache.put(mkEntry('om_1', { content: 'v1' }));
    cache.put(mkEntry('om_1', { content: 'v2' }));
    expect(cache.get('om_1')?.content).toBe('v2');
  });

  it('clear 清空所有条目', () => {
    cache.put(mkEntry('om_1'));
    cache.clear();
    expect(cache.get('om_1')).toBeNull();
  });
});
