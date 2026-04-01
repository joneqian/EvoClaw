import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { DEFAULT_DATA_DIR, DB_FILENAME } from '@evoclaw/shared';
import { createDatabase, pragmaSet, type DatabaseInstance } from './sqlite-adapter.js';

/** run() 返回类型 */
export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * SQLite 存储层 — 自动适配 bun:sqlite / better-sqlite3
 * 默认使用 WAL 模式，数据文件存储在 ~/.evoclaw/data/evoclaw.db
 */
export class SqliteStore {
  private db: DatabaseInstance;
  readonly dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? path.join(os.homedir(), DEFAULT_DATA_DIR, 'data', DB_FILENAME);

    // 确保目录存在
    if (this.dbPath !== ':memory:') {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = createDatabase(this.dbPath);

    // 启用 WAL 模式
    pragmaSet(this.db, 'journal_mode', 'WAL');
    // 启用外键约束
    pragmaSet(this.db, 'foreign_keys', 'ON');
  }

  /** 执行原始 SQL（用于迁移） */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /** 预编译并执行语句 */
  run(sql: string, ...params: unknown[]): RunResult {
    return this.db.prepare(sql).run(...params);
  }

  /** 查询单行 */
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  /** 查询所有行 */
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  /** 事务包装器 */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close();
  }

  /** 获取底层数据库实例 */
  get raw(): DatabaseInstance {
    return this.db;
  }
}
