/**
 * 运行时检测与 Bun API 代理层
 *
 * 统一运行时环境检测，为 Bun 独有 API 提供零开销代理 + Node.js 回退。
 * 采用 IIFE 缓存模式（参考 Claude Code），避免每次调用重复检测。
 */

import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

// ─── 运行时检测 ───

/** 当前运行时是否为 Bun */
export const isBun: boolean = typeof (globalThis as any).Bun !== 'undefined';

/** Bun 版本号（非 Bun 环境为 null） */
export const bunVersion: string | null = (() => {
  if (!isBun) return null;
  return (globalThis as any).Bun.version ?? null;
})();

// ─── Bun API 代理（null = 不可用，调用方需回退） ───

/** Bun.hash() — wyhash，~100x 快于 SHA-256 */
export const bunHash: ((content: string | ArrayBuffer | Uint8Array) => number) | null = (() => {
  if (!isBun) return null;
  const hash = (globalThis as any).Bun.hash;
  return typeof hash === 'function' ? hash : null;
})();

/** Bun.which() — 零进程开销命令查找 */
export const bunWhich: ((cmd: string) => string | null) | null = (() => {
  if (!isBun) return null;
  const w = (globalThis as any).Bun.which;
  return typeof w === 'function' ? w : null;
})();

/** Bun.gc() — 强制垃圾回收 */
export const bunGC: ((force: boolean) => void) | null = (() => {
  if (!isBun) return null;
  const gc = (globalThis as any).Bun.gc;
  return typeof gc === 'function' ? gc : null;
})();

/** Bun.generateHeapSnapshot() — V8 堆快照 */
export const bunHeapSnapshot: ((format?: string, encoding?: string) => any) | null = (() => {
  if (!isBun) return null;
  const fn = (globalThis as any).Bun.generateHeapSnapshot;
  return typeof fn === 'function' ? fn : null;
})();

/** Bun.JSONL.parseChunk() — 高效批量 JSON Lines 解析 */
export const bunJSONLParseChunk: ((chunk: string) => unknown[]) | null = (() => {
  if (!isBun) return null;
  const jsonl = (globalThis as any).Bun.JSONL;
  if (!jsonl?.parseChunk) return null;
  return jsonl.parseChunk;
})();

// ─── 高层工具函数 ───

/**
 * 快速哈希 — Bun 用 wyhash（~100x），Node 回退 SHA-256
 * 适用于非密码学场景：缓存键、去重、变更检测
 */
export function fastHash(content: string): string {
  if (bunHash) return bunHash(content).toString(36);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * 命令查找 — Bun 用 Bun.which()（零进程），Node 回退 execSync('which')
 * 结果缓存，同一命令只检测一次
 */
const whichCache = new Map<string, string | null>();

export function which(cmd: string): string | null {
  const cached = whichCache.get(cmd);
  if (cached !== undefined) return cached;

  let result: string | null;
  if (bunWhich) {
    result = bunWhich(cmd);
  } else {
    try {
      result = execSync(`which ${cmd}`, { encoding: 'utf-8', timeout: 5_000 }).trim() || null;
    } catch {
      result = null;
    }
  }
  whichCache.set(cmd, result);
  return result;
}
