import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteStore } from './sqlite-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 数据库迁移执行器
 * 按文件名顺序执行 migrations 目录下的 .sql 文件
 */
export class MigrationRunner {
  private store: SqliteStore;
  private migrationsDir: string;

  constructor(store: SqliteStore, migrationsDir?: string) {
    this.store = store;
    this.migrationsDir = migrationsDir ?? path.join(__dirname, 'migrations');
  }

  /** 执行所有未应用的迁移 */
  async run(): Promise<string[]> {
    // 创建迁移跟踪表
    this.store.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        executed_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // 获取已执行的迁移
    const executed = new Set(
      this.store.all<{ name: string }>('SELECT name FROM _migrations')
        .map(r => r.name)
    );

    // 读取迁移文件
    if (!fs.existsSync(this.migrationsDir)) {
      return [];
    }

    const files = fs.readdirSync(this.migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // 按文件名排序 (001_, 002_, ...)

    const applied: string[] = [];

    for (const file of files) {
      if (executed.has(file)) continue;

      const sql = fs.readFileSync(path.join(this.migrationsDir, file), 'utf-8');

      this.store.transaction(() => {
        this.store.exec(sql);
        this.store.run('INSERT INTO _migrations (name) VALUES (?)', file);
      });

      applied.push(file);
      console.log(`迁移已应用: ${file}`);
    }

    return applied;
  }
}
