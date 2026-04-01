/**
 * POC: 测试 bun:sqlite 内置 SQLite 的能力
 * 对比 better-sqlite3 API 差异
 */

import { Database } from 'bun:sqlite';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DB_PATH = join(import.meta.dirname, 'test-bun.db');
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

const db = new Database(DB_PATH);

// Test 1: WAL 模式
test('1. WAL 模式', () => {
  db.exec('PRAGMA journal_mode = WAL');
  const [row] = db.query('PRAGMA journal_mode').all() as any[];
  if (row.journal_mode !== 'wal') throw new Error(`Got ${row.journal_mode}`);
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

// Test 3: INSERT (prepare + run)
test('3. INSERT (prepare + run)', () => {
  const insert = db.prepare('INSERT INTO agents (id, name) VALUES (?, ?)');
  insert.run('agent-1', 'Test Agent 1');
  insert.run('agent-2', 'Test Agent 2');
});

// Test 4: SELECT (prepare + all)
test('4. SELECT (prepare + all)', () => {
  const rows = db.prepare('SELECT * FROM agents').all();
  if (rows.length !== 2) throw new Error(`Expected 2, got ${rows.length}`);
});

// Test 5: SELECT (prepare + get) 单行
test('5. SELECT get 单行', () => {
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get('agent-1') as any;
  if (!row || row.name !== 'Test Agent 1') throw new Error(`Got ${JSON.stringify(row)}`);
});

// Test 6: 事务
test('6. 事务', () => {
  const insertMany = db.transaction(() => {
    const stmt = db.prepare('INSERT INTO agents (id, name) VALUES (?, ?)');
    stmt.run('agent-3', 'Batch 1');
    stmt.run('agent-4', 'Batch 2');
    stmt.run('agent-5', 'Batch 3');
  });
  insertMany();
  const rows = db.prepare('SELECT * FROM agents').all();
  if (rows.length !== 5) throw new Error(`Expected 5, got ${rows.length}`);
});

// Test 7: UPDATE + changes
test('7. UPDATE + changes', () => {
  db.prepare("UPDATE agents SET status = 'inactive' WHERE id = ?").run('agent-1');
  // bun:sqlite 的 changes 通过 db.changes 获取
  const changes = (db as any).changes ?? -1;
  console.log(`   db.changes = ${changes}`);
});

// Test 8: FTS5
test('8. FTS5 全文搜索', () => {
  db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS fts_test USING fts5(content)');
  db.prepare('INSERT INTO fts_test (content) VALUES (?)').run('hello world bun runtime');
  db.prepare('INSERT INTO fts_test (content) VALUES (?)').run('node.js is great too');
  const rows = db.prepare("SELECT * FROM fts_test WHERE fts_test MATCH 'bun'").all();
  if (rows.length !== 1) throw new Error(`Expected 1, got ${rows.length}`);
});

// Test 9: JSON 函数
test('9. JSON 函数', () => {
  db.exec('CREATE TABLE IF NOT EXISTS config (id TEXT PRIMARY KEY, data TEXT)');
  db.prepare('INSERT INTO config VALUES (?, ?)').run('c1', JSON.stringify({ key: 'value', nested: { a: 1 } }));
  const row = db.prepare("SELECT json_extract(data, '$.nested.a') as val FROM config WHERE id = ?").get('c1') as any;
  if (row.val !== 1) throw new Error(`Expected 1, got ${row.val}`);
});

// Test 10: 并发读写
test('10. 并发读写（WAL 多句柄）', () => {
  const reader = new Database(DB_PATH, { readonly: true });
  db.prepare('INSERT INTO agents (id, name) VALUES (?, ?)').run('agent-6', 'Concurrent');
  const rows = reader.prepare('SELECT * FROM agents').all();
  if (rows.length < 5) throw new Error(`Expected >=5, got ${rows.length}`);
  reader.close();
});

// Test 11: API 差异检查
test('11. API 差异 — pragma()', () => {
  // better-sqlite3: db.pragma('journal_mode', { simple: true })
  // bun:sqlite: db.query('PRAGMA journal_mode').all()
  const [row] = db.query('PRAGMA journal_mode').all() as any[];
  if (!row) throw new Error('pragma query failed');
  console.log(`   bun:sqlite uses db.query() for pragma, not db.pragma()`);
});

// Test 12: API 差异 — exec vs run
test('12. API 差异 — prepare().run() 返回值', () => {
  // better-sqlite3: { changes, lastInsertRowid }
  // bun:sqlite: undefined (void), changes 通过 db 属性获取
  const result = db.prepare('DELETE FROM agents WHERE id = ?').run('agent-6');
  console.log(`   run() returns: ${JSON.stringify(result)}`);
  console.log(`   typeof result: ${typeof result}`);
});

// 清理
db.close();
if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
if (existsSync(DB_PATH + '-wal')) unlinkSync(DB_PATH + '-wal');
if (existsSync(DB_PATH + '-shm')) unlinkSync(DB_PATH + '-shm');

// 输出结果
console.log('\n=== bun:sqlite 兼容性测试 ===\n');
for (const r of results) {
  const icon = r.status === 'PASS' ? '✅' : '❌';
  console.log(`${icon} ${r.test}`);
  if (r.detail) console.log(`   ${r.detail}`);
}
const passed = results.filter(r => r.status === 'PASS').length;
console.log(`\n结果: ${passed}/${results.length} 通过`);

console.log('\n=== API 差异总结 ===');
console.log('better-sqlite3            | bun:sqlite');
console.log('--------------------------|---------------------------');
console.log('db.pragma(name)           | db.query("PRAGMA name")');
console.log('stmt.run() → {changes}    | stmt.run() → void');
console.log('new Database(path)        | new Database(path) ✅ 相同');
console.log('stmt.all() / get()        | stmt.all() / get() ✅ 相同');
console.log('db.exec(sql)              | db.exec(sql) ✅ 相同');
console.log('db.transaction(fn)        | db.transaction(fn) ✅ 相同');
console.log('db.prepare(sql)           | db.prepare(sql) ✅ 相同');
