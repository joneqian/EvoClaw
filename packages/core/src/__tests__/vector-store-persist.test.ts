import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { VectorStore } from '../infrastructure/db/vector-store.js';

/** 读取迁移 SQL */
const MIGRATION_001 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '001_initial.sql'),
  'utf-8',
);
const MIGRATION_009 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '009_knowledge_base.sql'),
  'utf-8',
);

/** 创建简单的 4 维向量 */
function vec(...values: number[]): Float32Array {
  return new Float32Array(values);
}

describe('VectorStore (持久化)', () => {
  let db: SqliteStore;
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-vs-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
    db = new SqliteStore(dbPath);
    db.exec(MIGRATION_001);
    db.exec(MIGRATION_009);
  });

  afterEach(() => {
    try { db.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('indexEmbedding 应持久化到 SQLite', async () => {
    const store = new VectorStore(db);
    await store.indexEmbedding('mem-001', vec(1, 0, 0, 0), 'memory');
    expect(store.size).toBe(1);

    // 直接查 DB 验证
    const row = db.get<{ id: string; source_type: string; dimension: number }>(
      'SELECT id, source_type, dimension FROM embeddings WHERE id = ?', 'mem-001',
    );
    expect(row?.id).toBe('mem-001');
    expect(row?.source_type).toBe('memory');
    expect(row?.dimension).toBe(4);
  });

  it('search 应从 SQLite 读取 BLOB 并返回正确结果', async () => {
    const store = new VectorStore(db);
    await store.indexEmbedding('mem-001', vec(1, 0, 0, 0), 'memory');
    await store.indexEmbedding('mem-002', vec(0, 1, 0, 0), 'memory');

    const results = await store.search(vec(1, 0, 0, 0));
    expect(results.length).toBe(2);
    expect(results[0].memoryId).toBe('mem-001');
    expect(results[0].score).toBeCloseTo(1.0, 5);
    expect(results[1].score).toBeCloseTo(0.0, 5);
  });

  it('search 应支持 sourceType 过滤', async () => {
    const store = new VectorStore(db);
    await store.indexEmbedding('mem-001', vec(1, 0, 0, 0), 'memory');
    await store.indexEmbedding('chunk-001', vec(1, 0, 0, 0), 'chunk');

    const memResults = await store.search(vec(1, 0, 0, 0), 10, 'memory');
    expect(memResults.length).toBe(1);
    expect(memResults[0].memoryId).toBe('mem-001');

    const chunkResults = await store.search(vec(1, 0, 0, 0), 10, 'chunk');
    expect(chunkResults.length).toBe(1);
    expect(chunkResults[0].memoryId).toBe('chunk-001');
  });

  it('removeEmbedding 应从 DB 中删除', async () => {
    const store = new VectorStore(db);
    await store.indexEmbedding('mem-001', vec(1, 0, 0, 0));
    expect(store.size).toBe(1);

    store.removeEmbedding('mem-001');
    expect(store.size).toBe(0);

    const results = await store.search(vec(1, 0, 0, 0));
    expect(results.length).toBe(0);
  });

  it('removeEmbeddings 应批量删除', async () => {
    const store = new VectorStore(db);
    await store.indexEmbedding('mem-001', vec(1, 0, 0, 0));
    await store.indexEmbedding('mem-002', vec(0, 1, 0, 0));
    await store.indexEmbedding('mem-003', vec(0, 0, 1, 0));

    store.removeEmbeddings(['mem-001', 'mem-002']);
    expect(store.size).toBe(1);
  });

  it('indexEmbedding 对同一 ID 应 REPLACE', async () => {
    const store = new VectorStore(db);
    await store.indexEmbedding('mem-001', vec(1, 0, 0, 0));
    await store.indexEmbedding('mem-001', vec(0, 1, 0, 0));
    expect(store.size).toBe(1);

    const results = await store.search(vec(0, 1, 0, 0));
    expect(results[0].memoryId).toBe('mem-001');
    expect(results[0].score).toBeCloseTo(1.0, 5);
  });

  it('跨实例持久化：重新打开 DB 后仍可搜索', async () => {
    const store1 = new VectorStore(db);
    await store1.indexEmbedding('mem-001', vec(1, 0, 0, 0));
    db.close();

    // 重新打开
    const db2 = new SqliteStore(dbPath);
    const store2 = new VectorStore(db2);
    const results = await store2.search(vec(1, 0, 0, 0));
    expect(results.length).toBe(1);
    expect(results[0].memoryId).toBe('mem-001');
    expect(results[0].score).toBeCloseTo(1.0, 5);
    db2.close();

    // 防止 afterEach 的 db.close() 报错
    db = new SqliteStore(':memory:');
  });

  it('searchByText 无 embeddingFn 时返回空数组', async () => {
    const store = new VectorStore(db);
    const results = await store.searchByText('hello');
    expect(results).toEqual([]);
  });

  it('searchByText 有 embeddingFn 时正常搜索', async () => {
    const mockFn = vi.fn().mockResolvedValue(vec(1, 0, 0, 0));
    const store = new VectorStore(db, mockFn);
    await store.indexEmbedding('mem-001', vec(1, 0, 0, 0));

    const results = await store.searchByText('test');
    expect(mockFn).toHaveBeenCalledWith('test');
    expect(results.length).toBe(1);
    expect(results[0].score).toBeCloseTo(1.0, 5);
  });

  it('hasEmbeddingFn 应正确反映状态', () => {
    const storeWithout = new VectorStore(db);
    expect(storeWithout.hasEmbeddingFn).toBe(false);

    const storeWith = new VectorStore(db, vi.fn());
    expect(storeWith.hasEmbeddingFn).toBe(true);
  });

  it('内存 fallback 模式（无 db）应正常工作', async () => {
    const store = new VectorStore(); // 无 db
    await store.indexEmbedding('mem-001', vec(1, 0, 0, 0));
    const results = await store.search(vec(1, 0, 0, 0));
    expect(results[0].score).toBeCloseTo(1.0, 5);
  });
});
