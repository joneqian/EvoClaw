import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../infrastructure/db/migration-runner.js';

describe('MigrationRunner', () => {
  let store: SqliteStore;
  let tmpDir: string;
  let migrationsDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-migration-test-${crypto.randomUUID()}`);
    migrationsDir = path.join(tmpDir, 'migrations');
    fs.mkdirSync(migrationsDir, { recursive: true });

    const dbPath = path.join(tmpDir, 'test.db');
    store = new SqliteStore(dbPath);
  });

  afterEach(() => {
    try {
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  it('应该按顺序执行迁移文件', async () => {
    // 创建两个迁移文件
    fs.writeFileSync(
      path.join(migrationsDir, '001_create_users.sql'),
      'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);'
    );
    fs.writeFileSync(
      path.join(migrationsDir, '002_create_posts.sql'),
      'CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), title TEXT);'
    );

    const runner = new MigrationRunner(store, migrationsDir);
    const applied = await runner.run();

    expect(applied).toEqual(['001_create_users.sql', '002_create_posts.sql']);

    // 验证表已创建
    const tables = store.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name"
    );
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('posts');
  });

  it('应该跳过已执行的迁移', async () => {
    fs.writeFileSync(
      path.join(migrationsDir, '001_first.sql'),
      'CREATE TABLE first_table (id INTEGER PRIMARY KEY);'
    );

    const runner = new MigrationRunner(store, migrationsDir);

    // 第一次执行
    const firstRun = await runner.run();
    expect(firstRun).toEqual(['001_first.sql']);

    // 添加新迁移
    fs.writeFileSync(
      path.join(migrationsDir, '002_second.sql'),
      'CREATE TABLE second_table (id INTEGER PRIMARY KEY);'
    );

    // 第二次执行 — 应该只执行新迁移
    const secondRun = await runner.run();
    expect(secondRun).toEqual(['002_second.sql']);
  });

  it('应该在 _migrations 表中记录已应用的迁移', async () => {
    fs.writeFileSync(
      path.join(migrationsDir, '001_test.sql'),
      'CREATE TABLE test (id INTEGER PRIMARY KEY);'
    );

    const runner = new MigrationRunner(store, migrationsDir);
    await runner.run();

    const migrations = store.all<{ name: string; executed_at: string }>(
      'SELECT name, executed_at FROM _migrations'
    );
    expect(migrations).toHaveLength(1);
    expect(migrations[0]!.name).toBe('001_test.sql');
    expect(migrations[0]!.executed_at).toBeTruthy();
  });

  it('应该处理空的迁移目录', async () => {
    const runner = new MigrationRunner(store, migrationsDir);
    const applied = await runner.run();
    expect(applied).toEqual([]);
  });

  it('应该处理不存在的迁移目录', async () => {
    const nonExistentDir = path.join(tmpDir, 'nonexistent');
    const runner = new MigrationRunner(store, nonExistentDir);
    const applied = await runner.run();
    expect(applied).toEqual([]);
  });

  it('应该只处理 .sql 文件', async () => {
    fs.writeFileSync(
      path.join(migrationsDir, '001_valid.sql'),
      'CREATE TABLE valid (id INTEGER PRIMARY KEY);'
    );
    fs.writeFileSync(
      path.join(migrationsDir, 'README.md'),
      '# Migrations'
    );
    fs.writeFileSync(
      path.join(migrationsDir, '002_also_valid.sql'),
      'CREATE TABLE also_valid (id INTEGER PRIMARY KEY);'
    );

    const runner = new MigrationRunner(store, migrationsDir);
    const applied = await runner.run();

    expect(applied).toEqual(['001_valid.sql', '002_also_valid.sql']);
  });
});
