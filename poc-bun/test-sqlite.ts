/**
 * POC: 测试 better-sqlite3 在 Bun 中的兼容性
 *
 * 测试项:
 * 1. 能否加载 better-sqlite3 原生模块
 * 2. 基本 CRUD 操作
 * 3. WAL 模式
 * 4. 事务
 * 5. 预编译语句
 */

import Database from 'better-sqlite3';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DB_PATH = join(import.meta.dirname, 'test.db');

// 清理旧文件
if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

const results: Array<{ test: string; status: 'PASS' | 'FAIL'; detail?: string }> = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    results.push({ test: name, status: 'PASS' });
  } catch (err) {
    results.push({ test: name, status: 'FAIL', detail: String(err) });
  }
}

// Test 1: 创建数据库 + WAL 模式
const db = new Database(DB_PATH);
test('1. 创建数据库 + WAL 模式', () => {
  db.pragma('journal_mode = WAL');
  const mode = db.pragma('journal_mode', { simple: true });
  if (mode !== 'wal') throw new Error(`Expected WAL, got ${mode}`);
});

// Test 2: 创建表
test('2. 创建表', () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
});

// Test 3: INSERT 预编译语句
test('3. INSERT 预编译语句', () => {
  const insert = db.prepare('INSERT INTO agents (id, name) VALUES (?, ?)');
  insert.run('agent-1', 'Test Agent 1');
  insert.run('agent-2', 'Test Agent 2');
});

// Test 4: SELECT 查询
test('4. SELECT 查询', () => {
  const rows = db.prepare('SELECT * FROM agents').all();
  if (rows.length !== 2) throw new Error(`Expected 2 rows, got ${rows.length}`);
});

// Test 5: 事务
test('5. 事务', () => {
  const insertMany = db.transaction((items: Array<{ id: string; name: string }>) => {
    const stmt = db.prepare('INSERT INTO agents (id, name) VALUES (?, ?)');
    for (const item of items) {
      stmt.run(item.id, item.name);
    }
    return items.length;
  });
  const count = insertMany([
    { id: 'agent-3', name: 'Batch 1' },
    { id: 'agent-4', name: 'Batch 2' },
    { id: 'agent-5', name: 'Batch 3' },
  ]);
  if (count !== 3) throw new Error(`Expected 3, got ${count}`);
});

// Test 6: UPDATE + 返回 changes
test('6. UPDATE + changes', () => {
  const result = db.prepare("UPDATE agents SET status = 'inactive' WHERE id = ?").run('agent-1');
  if (result.changes !== 1) throw new Error(`Expected 1 change, got ${result.changes}`);
});

// Test 7: DELETE
test('7. DELETE', () => {
  const result = db.prepare('DELETE FROM agents WHERE id = ?').run('agent-5');
  if (result.changes !== 1) throw new Error(`Expected 1 change, got ${result.changes}`);
});

// Test 8: FTS5 全文搜索
test('8. FTS5 全文搜索', () => {
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS fts_test USING fts5(content)`);
  db.prepare('INSERT INTO fts_test (content) VALUES (?)').run('hello world bun runtime');
  db.prepare('INSERT INTO fts_test (content) VALUES (?)').run('node.js is great too');
  const rows = db.prepare("SELECT * FROM fts_test WHERE fts_test MATCH 'bun'").all();
  if (rows.length !== 1) throw new Error(`Expected 1 FTS result, got ${rows.length}`);
});

// Test 9: JSON 函数
test('9. JSON 函数', () => {
  db.exec(`CREATE TABLE IF NOT EXISTS config (id TEXT PRIMARY KEY, data TEXT)`);
  db.prepare('INSERT INTO config VALUES (?, ?)').run('c1', JSON.stringify({ key: 'value', nested: { a: 1 } }));
  const row = db.prepare("SELECT json_extract(data, '$.nested.a') as val FROM config WHERE id = ?").get('c1') as any;
  if (row.val !== 1) throw new Error(`Expected 1, got ${row.val}`);
});

// Test 10: 并发读写（多句柄）
test('10. 并发读写（WAL 多句柄）', () => {
  const reader = new Database(DB_PATH, { readonly: true });
  // 写入
  db.prepare('INSERT INTO agents (id, name) VALUES (?, ?)').run('agent-6', 'Concurrent');
  // 另一个句柄读取
  const rows = reader.prepare('SELECT * FROM agents').all();
  if (rows.length < 5) throw new Error(`Expected >=5 rows from reader, got ${rows.length}`);
  reader.close();
});

// 清理
db.close();
if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
if (existsSync(DB_PATH + '-wal')) unlinkSync(DB_PATH + '-wal');
if (existsSync(DB_PATH + '-shm')) unlinkSync(DB_PATH + '-shm');

// 输出结果
console.log('\n=== better-sqlite3 Bun 兼容性测试 ===\n');
for (const r of results) {
  const icon = r.status === 'PASS' ? '✅' : '❌';
  console.log(`${icon} ${r.test}`);
  if (r.detail) console.log(`   ${r.detail}`);
}
const passed = results.filter(r => r.status === 'PASS').length;
console.log(`\n结果: ${passed}/${results.length} 通过`);
