/**
 * 文件状态缓存 — LRU 缓存追踪文件读取状态
 *
 * 用于 Edit/Write 工具的先读后写校验:
 * - 记录每次 Read 的时间戳和内容哈希
 * - Edit/Write 前检查文件是否被读取过
 * - Edit/Write 前检查文件是否被外部修改
 *
 * 参考 Claude Code FileStateCache:
 * - LRU with 100 max entries, 25 MB total
 * - 追踪: content, timestamp, offset, limit, isPartialView
 * - 用于 FileEditTool/FileWriteTool 的 staleness 检测
 *
 * 参考文档: docs/research/10-file-tools.md
 */

import fs from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface FileState {
  /** 文件 mtime (ms) at read time */
  mtimeMs: number;
  /** 读取时间戳 */
  readAt: number;
  /** 是否是部分读取 (offset/limit) */
  isPartialView: boolean;
  /** 内容长度 (用于 LRU 总大小控制) */
  contentLength: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// FileStateCache
// ═══════════════════════════════════════════════════════════════════════════

/** 最大缓存条目数 */
const MAX_ENTRIES = 100;

/** 最大总内容大小 (25 MB) */
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

/**
 * 文件状态缓存
 *
 * 单例使用: 在 createBuiltinTools() 中创建，
 * 传递给 read/edit/write 工具共享。
 */
export class FileStateCache {
  private cache = new Map<string, FileState>();
  private totalBytes = 0;

  /**
   * 记录文件读取状态
   * @param filePath - 文件绝对路径
   * @param contentLength - 读取的内容长度
   * @param isPartialView - 是否使用了 offset/limit
   */
  recordRead(filePath: string, contentLength: number, isPartialView: boolean): void {
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(filePath).mtimeMs;
    } catch {
      // 文件可能已被删除
    }

    // LRU: 如果已存在，先移除旧条目的大小
    const existing = this.cache.get(filePath);
    if (existing) {
      this.totalBytes -= existing.contentLength;
    }

    // 检查容量
    this.evictIfNeeded(contentLength);

    this.cache.set(filePath, {
      mtimeMs,
      readAt: Date.now(),
      isPartialView,
      contentLength,
    });
    this.totalBytes += contentLength;
  }

  /**
   * 检查文件是否曾被读取
   */
  wasReadBefore(filePath: string): boolean {
    // LRU: 访问时刷新位置（Map 删除再重插 = 移到末尾）
    const entry = this.cache.get(filePath);
    if (entry) {
      this.cache.delete(filePath);
      this.cache.set(filePath, entry);
      return true;
    }
    return false;
  }

  /**
   * 检查文件自上次读取后是否被外部修改
   * @returns null 表示未修改, string 表示修改原因
   */
  checkStaleness(filePath: string): string | null {
    const state = this.cache.get(filePath);
    if (!state) {
      return '文件未被读取过，请先用 read 工具读取';
    }

    // 部分读取不做 staleness 检查 (参考 Claude Code)
    if (state.isPartialView) {
      return null;
    }

    try {
      const currentMtimeMs = fs.statSync(filePath).mtimeMs;
      if (currentMtimeMs > state.mtimeMs) {
        return '文件自上次读取后已被外部修改';
      }
    } catch {
      // 文件不存在 — 可能被删除
      return '文件已被删除';
    }

    return null;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.totalBytes = 0;
  }

  /** 缓存条目数 */
  get size(): number {
    return this.cache.size;
  }

  // ─── Private ───

  private evictIfNeeded(newContentLength: number): void {
    // 超过条目限制 → 移除最旧的
    while (this.cache.size >= MAX_ENTRIES) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey === undefined) break;
      const entry = this.cache.get(firstKey);
      if (entry) this.totalBytes -= entry.contentLength;
      this.cache.delete(firstKey);
    }

    // 超过总大小限制 → 移除最旧的
    while (this.totalBytes + newContentLength > MAX_TOTAL_BYTES && this.cache.size > 0) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey === undefined) break;
      const entry = this.cache.get(firstKey);
      if (entry) this.totalBytes -= entry.contentLength;
      this.cache.delete(firstKey);
    }
  }
}
