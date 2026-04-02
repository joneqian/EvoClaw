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

import { isBun } from '../runtime.js';

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
    // Bun 内置 SQLite — 动态 require 避免 Node 环境报错
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const { Database } = (globalThis as any).Bun.SQLite ?? require('bun:sqlite');
    return new Database(dbPath) as unknown as DatabaseInstance;
  }
  // Node.js — 使用 better-sqlite3
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  return new Database(dbPath) as unknown as DatabaseInstance;
}

/** 设置 PRAGMA（兼容两种运行时） */
export function pragmaSet(db: DatabaseInstance, name: string, value: string): void {
  db.exec(`PRAGMA ${name} = ${value}`);
}
