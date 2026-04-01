/**
 * Bun vs Node 性能对比基准测试
 * 测试项: 启动速度、SQLite 读写、HTTP 请求、JSON 解析
 */

const runtime = typeof Bun !== 'undefined' ? 'Bun' : 'Node';
const version = typeof Bun !== 'undefined' ? Bun.version : process.version;

console.log(`\n=== ${runtime} ${version} 性能测试 ===\n`);

const results = [];

function bench(name, fn, iterations = 1000) {
  // warmup
  for (let i = 0; i < 10; i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;
  const opsPerSec = Math.round(iterations / (elapsed / 1000));
  results.push({ name, elapsed: elapsed.toFixed(1), iterations, opsPerSec });
}

async function benchAsync(name, fn, iterations = 100) {
  // warmup
  for (let i = 0; i < 3; i++) await fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) await fn();
  const elapsed = performance.now() - start;
  const opsPerSec = Math.round(iterations / (elapsed / 1000));
  results.push({ name, elapsed: elapsed.toFixed(1), iterations, opsPerSec });
}

// 1. JSON 序列化/反序列化
const testObj = { agents: Array.from({ length: 100 }, (_, i) => ({ id: `agent-${i}`, name: `Agent ${i}`, status: 'active', memory: { l0: 'summary', l1: 'overview', tags: ['a', 'b', 'c'] } })) };
const testJson = JSON.stringify(testObj);

bench('JSON.stringify (100 agents)', () => JSON.stringify(testObj), 10000);
bench('JSON.parse (100 agents)', () => JSON.parse(testJson), 10000);

// 2. SQLite 操作
let Database;
if (typeof Bun !== 'undefined') {
  const mod = await import('bun:sqlite');
  Database = mod.Database;
} else {
  Database = (await import('better-sqlite3')).default;
}

const db = new Database(':memory:');
db.exec('PRAGMA journal_mode = WAL');
db.exec(`CREATE TABLE bench (id INTEGER PRIMARY KEY, name TEXT, data TEXT, score REAL)`);

const insertStmt = db.prepare('INSERT INTO bench (name, data, score) VALUES (?, ?, ?)');
bench('SQLite INSERT', () => insertStmt.run('test', '{"key":"value"}', Math.random()), 10000);

const selectStmt = db.prepare('SELECT * FROM bench WHERE id = ?');
bench('SQLite SELECT by PK', () => selectStmt.get(Math.floor(Math.random() * 10000) + 1), 10000);

const selectAllStmt = db.prepare('SELECT * FROM bench LIMIT 100');
bench('SQLite SELECT 100 rows', () => selectAllStmt.all(), 5000);

// FTS5
db.exec(`CREATE VIRTUAL TABLE fts_bench USING fts5(content)`);
const ftsInsert = db.prepare('INSERT INTO fts_bench (content) VALUES (?)');
for (let i = 0; i < 1000; i++) {
  ftsInsert.run(`document ${i} with some random words like hello world testing benchmark performance`);
}
const ftsSearch = db.prepare("SELECT * FROM fts_bench WHERE fts_bench MATCH ? LIMIT 10");
bench('SQLite FTS5 search', () => ftsSearch.all('hello benchmark'), 5000);

// Transaction
bench('SQLite transaction (10 inserts)', () => {
  db.transaction(() => {
    for (let i = 0; i < 10; i++) {
      insertStmt.run(`batch-${i}`, 'data', i * 0.1);
    }
  })();
}, 2000);

db.close();

// 3. Crypto hashing
const { createHash } = await import('node:crypto');
const hashData = Buffer.alloc(4096, 'x');
bench('SHA-256 hash (4KB)', () => createHash('sha256').update(hashData).digest('hex'), 10000);

// 4. 文件系统
const { readFileSync, writeFileSync, unlinkSync, existsSync } = await import('node:fs');
const tmpFile = '/tmp/bench-test-' + Date.now() + '.txt';
const fileData = 'x'.repeat(10000);
bench('fs.writeFileSync (10KB)', () => writeFileSync(tmpFile, fileData), 2000);
bench('fs.readFileSync (10KB)', () => readFileSync(tmpFile, 'utf-8'), 5000);
if (existsSync(tmpFile)) unlinkSync(tmpFile);

// 5. URL 解析
bench('new URL() parse', () => new URL('https://api.example.com/v1/agents?page=1&limit=20'), 50000);

// 6. TextEncoder/TextDecoder
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const textData = 'Hello World 你好世界 '.repeat(100);
bench('TextEncoder.encode', () => encoder.encode(textData), 10000);
const encoded = encoder.encode(textData);
bench('TextDecoder.decode', () => decoder.decode(encoded), 10000);

// 输出结果
console.log('测试项'.padEnd(35) + '耗时(ms)'.padStart(10) + '  次数'.padStart(8) + '  ops/s'.padStart(12));
console.log('-'.repeat(70));
for (const r of results) {
  console.log(
    r.name.padEnd(35) +
    r.elapsed.padStart(10) +
    String(r.iterations).padStart(8) +
    String(r.opsPerSec).padStart(12)
  );
}

// 启动时间
console.log(`\n启动到此处总耗时: ${performance.now().toFixed(0)}ms`);
