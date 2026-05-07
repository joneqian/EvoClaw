/**
 * SQLite 运行时适配层
 *
 * 自动检测运行时环境：
 *   - Bun → 使用内置 bun:sqlite
 *   - Node.js → 使用 better-sqlite3
 *
 * 两者 API 高度兼容（prepare/run/get/all/exec/transaction/close），
 * 唯一差异是 pragma() — better-sqlite3 有此方法，bun:sqlite 没有。
 */

import { createRequire } from 'node:module';
import { isBun } from '../runtime.js';

// ESM 下没有 require — 用 createRequire 兜底，Bun 自带 require 也能 fallback 到这条路径
const requireFn = createRequire(import.meta.url);

/** 统一的 Database 实例类型（取两者交集） */
export interface DatabaseInstance {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

/** 创建数据库实例 */
export function createDatabase(dbPath: string): DatabaseInstance {
  if (isBun) {
    // Bun 内置 SQLite — 用 createRequire 在 ESM 下取
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { Database } = (globalThis as any).Bun.SQLite ?? requireFn('bun:sqlite');
    return new Database(dbPath) as unknown as DatabaseInstance;
  }
  // Node.js — 使用 better-sqlite3（ESM 下 bare require 不可用，需 createRequire）
  const Database = requireFn('better-sqlite3');
  return new Database(dbPath) as unknown as DatabaseInstance;
}

/** 设置 PRAGMA（兼容两种运行时） */
export function pragmaSet(db: DatabaseInstance, name: string, value: string): void {
  db.exec(`PRAGMA ${name} = ${value}`);
}
