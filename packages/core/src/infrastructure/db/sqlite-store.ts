import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { DEFAULT_DATA_DIR, DB_FILENAME } from '@evoclaw/shared';

/**
 * SQLite 存储层 — 封装 better-sqlite3
 * 默认使用 WAL 模式，数据文件存储在 ~/.evoclaw/data/evoclaw.db
 */
export class SqliteStore {
  private db: Database.Database;
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

    this.db = new Database(this.dbPath);

    // 启用 WAL 模式
    this.db.pragma('journal_mode = WAL');
    // 启用外键约束
    this.db.pragma('foreign_keys = ON');
  }

  /** 执行原始 SQL（用于迁移） */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /** 预编译并执行语句 */
  run(sql: string, ...params: unknown[]): Database.RunResult {
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

  /** 获取底层 better-sqlite3 实例 */
  get raw(): Database.Database {
    return this.db;
  }
}
