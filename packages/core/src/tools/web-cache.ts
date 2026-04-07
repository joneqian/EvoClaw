/**
 * Web 工具 LRU 缓存 — 零外部依赖
 *
 * 参考 Claude Code：URL 内容缓存 (15min TTL, 50MB)
 * 使用 Map 的迭代顺序（插入序）+ 手动 LRU 维护
 */

interface CacheEntry<T> {
  value: T;
  sizeBytes: number;
  expiresAt: number;
}

export interface WebLRUCacheOptions {
  /** 缓存总字节上限 */
  readonly maxSizeBytes: number;
  /** 条目存活时间（毫秒） */
  readonly ttlMs: number;
}

/**
 * 轻量 LRU 缓存，按字节大小驱逐
 *
 * - TTL 过期自动失效
 * - 总大小超限时驱逐最久未使用的条目
 * - get() 会刷新 LRU 顺序
 */
export class WebLRUCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly maxSizeBytes: number;
  private readonly ttlMs: number;
  private currentSizeBytes = 0;

  constructor(opts: WebLRUCacheOptions) {
    this.maxSizeBytes = opts.maxSizeBytes;
    this.ttlMs = opts.ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    // TTL 过期
    if (Date.now() > entry.expiresAt) {
      this.deleteEntry(key, entry);
      return undefined;
    }

    // 刷新 LRU 顺序：删除再插入，Map 保证迭代序 = 插入序
    this.entries.delete(key);
    this.entries.set(key, entry);

    return entry.value;
  }

  set(key: string, value: T, sizeBytes: number): void {
    // 单条目超过总上限 → 不存储
    if (sizeBytes > this.maxSizeBytes) return;

    // 覆盖已有条目
    const existing = this.entries.get(key);
    if (existing) {
      this.deleteEntry(key, existing);
    }

    // 驱逐直到有足够空间
    this.evict(sizeBytes);

    this.entries.set(key, {
      value,
      sizeBytes,
      expiresAt: Date.now() + this.ttlMs,
    });
    this.currentSizeBytes += sizeBytes;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      this.deleteEntry(key, entry);
    }
  }

  clear(): void {
    this.entries.clear();
    this.currentSizeBytes = 0;
  }

  get size(): number {
    return this.entries.size;
  }

  get totalBytes(): number {
    return this.currentSizeBytes;
  }

  // ── 内部方法 ──

  private deleteEntry(key: string, entry: CacheEntry<T>): void {
    this.entries.delete(key);
    this.currentSizeBytes -= entry.sizeBytes;
  }

  /** 驱逐最旧条目直到有足够空间容纳 neededBytes */
  private evict(neededBytes: number): void {
    while (this.currentSizeBytes + neededBytes > this.maxSizeBytes && this.entries.size > 0) {
      // Map 迭代顺序 = 插入顺序，第一个 = 最久未用
      const oldest = this.entries.entries().next();
      if (oldest.done) break;
      const [key, entry] = oldest.value;
      this.deleteEntry(key, entry);
    }
  }
}

// ── 默认 URL 缓存实例 ──

/** URL 内容缓存：15 分钟 TTL，50MB 上限 */
export const urlCache = new WebLRUCache<string>({
  maxSizeBytes: 50 * 1024 * 1024,
  ttlMs: 15 * 60 * 1000,
});

/** 域名安全检查缓存：5 分钟 TTL，128 条（按条数限制用小字节上限近似） */
export const domainCheckCache = new WebLRUCache<true>({
  maxSizeBytes: 128 * 64, // ~8KB，每条约 64 字节
  ttlMs: 5 * 60 * 1000,
});
