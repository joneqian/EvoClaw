import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';

/** 生成临时数据库路径 */
function tmpDbPath(): string {
  const dir = path.join(os.tmpdir(), `evoclaw-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'test.db');
}

describe('SqliteStore', () => {
  const stores: SqliteStore[] = [];

  /** 创建 store 并注册自动清理 */
  function createStore(dbPath?: string): SqliteStore {
    const store = new SqliteStore(dbPath ?? tmpDbPath());
    stores.push(store);
    return store;
  }

  afterEach(() => {
    for (const store of stores) {
      try {
        const dbPath = store.dbPath;
        store.close();
        // 清理临时文件
        if (dbPath !== ':memory:' && dbPath.includes(os.tmpdir())) {
          const dir = path.dirname(dbPath);
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch {
        // 忽略清理错误
      }
    }
    stores.length = 0;
  });

  it('应该启用 WAL 模式', () => {
    const store = createStore();
    const result = store.get<{ journal_mode: string }>('PRAGMA journal_mode');
    expect(result?.journal_mode).toBe('wal');
  });

  it('应该启用外键约束', () => {
    const store = createStore();
    const result = store.get<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(result?.foreign_keys).toBe(1);
  });

  it('应该支持基本 CRUD 操作', () => {
    const store = createStore();
    store.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');

    // Insert
    const insertResult = store.run('INSERT INTO test (name) VALUES (?)', 'Alice');
    expect(insertResult.changes).toBe(1);

    // Select single
    const row = store.get<{ id: number; name: string }>('SELECT * FROM test WHERE id = ?', insertResult.lastInsertRowid);
    expect(row).toEqual({ id: 1, name: 'Alice' });

    // Insert more
    store.run('INSERT INTO test (name) VALUES (?)', 'Bob');

    // Select all
    const rows = store.all<{ id: number; name: string }>('SELECT * FROM test ORDER BY id');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.name).toBe('Alice');
    expect(rows[1]!.name).toBe('Bob');

    // Update
    store.run('UPDATE test SET name = ? WHERE id = ?', 'Charlie', 1);
    const updated = store.get<{ name: string }>('SELECT name FROM test WHERE id = ?', 1);
    expect(updated?.name).toBe('Charlie');

    // Delete
    store.run('DELETE FROM test WHERE id = ?', 2);
    const remaining = store.all('SELECT * FROM test');
    expect(remaining).toHaveLength(1);
  });

  it('应该支持事务回滚', () => {
    const store = createStore();
    store.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    store.run('INSERT INTO test (value) VALUES (?)', 'original');

    // 事务中抛出错误应该回滚
    expect(() => {
      store.transaction(() => {
        store.run('UPDATE test SET value = ?', 'modified');
        throw new Error('模拟错误');
      });
    }).toThrow('模拟错误');

    // 数据应该未被修改
    const row = store.get<{ value: string }>('SELECT value FROM test WHERE id = 1');
    expect(row?.value).toBe('original');
  });

  it('应该正确关闭数据库连接', () => {
    const dbPath = tmpDbPath();
    const store = new SqliteStore(dbPath);
    store.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
    store.close();

    // 关闭后操作应该抛出错误
    expect(() => store.run('SELECT 1')).toThrow();

    // 清理
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it('应该自动创建数据目录', () => {
    const dbPath = path.join(os.tmpdir(), `evoclaw-test-${crypto.randomUUID()}`, 'nested', 'dir', 'test.db');
    const store = createStore(dbPath);
    expect(fs.existsSync(path.dirname(dbPath))).toBe(true);
    store.close();
    fs.rmSync(path.join(os.tmpdir(), path.basename(path.dirname(path.dirname(path.dirname(dbPath))))), { recursive: true, force: true });
  });

  it('get 查询不存在的行应返回 undefined', () => {
    const store = createStore();
    store.exec('CREATE TABLE test (id INTEGER PRIMARY KEY)');
    const result = store.get('SELECT * FROM test WHERE id = ?', 999);
    expect(result).toBeUndefined();
  });
});
