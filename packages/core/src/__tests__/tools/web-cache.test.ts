import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebLRUCache } from '../../tools/web-cache.js';

describe('WebLRUCache', () => {
  let cache: WebLRUCache<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new WebLRUCache({ maxSizeBytes: 1024, ttlMs: 60_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 基本读写 ──

  it('应该存储和读取值', () => {
    cache.set('key1', 'value1', 6);
    expect(cache.get('key1')).toBe('value1');
  });

  it('不存在的 key 返回 undefined', () => {
    expect(cache.get('missing')).toBeUndefined();
  });

  it('应该正确报告 has()', () => {
    cache.set('key1', 'value1', 6);
    expect(cache.has('key1')).toBe(true);
    expect(cache.has('missing')).toBe(false);
  });

  it('应该支持 delete()', () => {
    cache.set('key1', 'value1', 6);
    cache.delete('key1');
    expect(cache.get('key1')).toBeUndefined();
  });

  it('应该支持 clear()', () => {
    cache.set('key1', 'value1', 6);
    cache.set('key2', 'value2', 6);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.totalBytes).toBe(0);
  });

  // ── TTL 过期 ──

  it('过期条目应自动失效', () => {
    cache.set('key1', 'value1', 6);
    vi.advanceTimersByTime(60_001);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('未过期条目应正常返回', () => {
    cache.set('key1', 'value1', 6);
    vi.advanceTimersByTime(59_999);
    expect(cache.get('key1')).toBe('value1');
  });

  // ── 大小限制 ──

  it('超过总大小上限时应驱逐最旧条目', () => {
    // maxSizeBytes = 1024
    cache.set('big1', 'a'.repeat(600), 600);
    cache.set('big2', 'b'.repeat(600), 600);
    // big1 应被驱逐（600 + 600 > 1024）
    expect(cache.get('big1')).toBeUndefined();
    expect(cache.get('big2')).toBe('b'.repeat(600));
    expect(cache.totalBytes).toBeLessThanOrEqual(1024);
  });

  it('单条目超过上限时不存储', () => {
    cache.set('huge', 'x'.repeat(2000), 2000);
    expect(cache.get('huge')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  // ── LRU 驱逐顺序 ──

  it('访问应更新 LRU 顺序', () => {
    cache = new WebLRUCache({ maxSizeBytes: 250, ttlMs: 60_000 });
    cache.set('a', 'aaa', 100);
    cache.set('b', 'bbb', 100);
    // 访问 a → a 变为最近使用
    cache.get('a');
    // 插入 c → 应驱逐 b（最久未用）而非 a
    cache.set('c', 'ccc', 100);
    expect(cache.get('a')).toBe('aaa');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('ccc');
  });

  // ── stats ──

  it('size 和 totalBytes 应正确跟踪', () => {
    cache.set('k1', 'v1', 10);
    cache.set('k2', 'v2', 20);
    expect(cache.size).toBe(2);
    expect(cache.totalBytes).toBe(30);
    cache.delete('k1');
    expect(cache.size).toBe(1);
    expect(cache.totalBytes).toBe(20);
  });

  // ── 覆盖已有 key ──

  it('set 同一 key 应覆盖并更新大小', () => {
    cache.set('k1', 'short', 5);
    expect(cache.totalBytes).toBe(5);
    cache.set('k1', 'longer-value', 12);
    expect(cache.get('k1')).toBe('longer-value');
    expect(cache.totalBytes).toBe(12);
    expect(cache.size).toBe(1);
  });
});
