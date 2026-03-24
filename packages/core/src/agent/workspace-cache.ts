/**
 * 工作区文件缓存 — 基于 mtime + size 避免重复读取
 */
import fs from 'node:fs';

interface CacheEntry {
  content: string;
  mtimeMs: number;
  size: number;
}

const cache = new Map<string, CacheEntry>();

/** 带缓存的文件读取 */
export function readFileWithCache(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;

  const stat = fs.statSync(filePath);
  const cached = cache.get(filePath);

  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.content;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  cache.set(filePath, { content, mtimeMs: stat.mtimeMs, size: stat.size });
  return content;
}

/** 清除指定文件的缓存 */
export function invalidateCache(filePath: string): void {
  cache.delete(filePath);
}

/** 清除所有缓存 */
export function clearCache(): void {
  cache.clear();
}
