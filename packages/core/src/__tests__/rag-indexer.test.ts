import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { VectorStore } from '../infrastructure/db/vector-store.js';
import { FileIngester } from '../rag/file-ingester.js';
import { RagIndexer } from '../rag/rag-indexer.js';

/** 读取迁移 SQL */
const MIGRATION_001 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '001_initial.sql'),
  'utf-8',
);
const MIGRATION_009 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '009_knowledge_base.sql'),
  'utf-8',
);

const TEST_AGENT_ID = 'test-agent-indexer';

function vec(...values: number[]): Float32Array {
  return new Float32Array(values);
}

describe('RagIndexer', () => {
  let db: SqliteStore;
  let tmpDir: string;
  let vectorStore: VectorStore;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-indexer-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    db = new SqliteStore(path.join(tmpDir, 'test.db'));
    db.exec(MIGRATION_001);
    db.exec(MIGRATION_009);

    db.run('INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)',
      TEST_AGENT_ID, '索引测试助手', '📇', 'active');

    vectorStore = new VectorStore(db);
  });

  afterEach(() => {
    try { db.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createTestFile(name: string, content: string): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  it('indexFile 应生成 embedding 并更新状态为 indexed', async () => {
    const ingester = new FileIngester(db);
    const filePath = createTestFile('test.md', '## Test\n\nSome content for indexing.');
    const fileId = await ingester.ingest(TEST_AGENT_ID, filePath);

    const batchFn = vi.fn().mockImplementation(async (texts: string[]) =>
      texts.map(() => vec(0.1, 0.2, 0.3, 0.4))
    );

    const indexer = new RagIndexer(db, vectorStore, batchFn);
    await indexer.indexFile(fileId);

    // 验证状态
    const file = db.get<{ status: string; indexed_at: string | null }>(
      'SELECT status, indexed_at FROM knowledge_base_files WHERE id = ?', fileId,
    );
    expect(file?.status).toBe('indexed');
    expect(file?.indexed_at).toBeTruthy();

    // 验证向量已写入
    expect(vectorStore.size).toBeGreaterThan(0);
    expect(batchFn).toHaveBeenCalled();
  });

  it('indexFile 无 batchEmbedFn 应抛出错误', async () => {
    const ingester = new FileIngester(db);
    const filePath = createTestFile('no-fn.md', '## No Function\n\nContent.');
    const fileId = await ingester.ingest(TEST_AGENT_ID, filePath);

    const indexer = new RagIndexer(db, vectorStore);
    await expect(indexer.indexFile(fileId)).rejects.toThrow('未配置 Embedding 函数');
  });

  it('indexFile 失败应更新状态为 error', async () => {
    const ingester = new FileIngester(db);
    const filePath = createTestFile('fail.md', '## Fail\n\nContent.');
    const fileId = await ingester.ingest(TEST_AGENT_ID, filePath);

    const batchFn = vi.fn().mockRejectedValue(new Error('API 超时'));
    const indexer = new RagIndexer(db, vectorStore, batchFn);

    await expect(indexer.indexFile(fileId)).rejects.toThrow('API 超时');

    const file = db.get<{ status: string; error_message: string }>(
      'SELECT status, error_message FROM knowledge_base_files WHERE id = ?', fileId,
    );
    expect(file?.status).toBe('error');
    expect(file?.error_message).toBe('API 超时');
  });

  it('indexAllPending 应索引所有 pending 文件', async () => {
    const ingester = new FileIngester(db);
    const f1 = createTestFile('a.md', '## A\n\nContent A.');
    const f2 = createTestFile('b.md', '## B\n\nContent B.');
    await ingester.ingest(TEST_AGENT_ID, f1);
    await ingester.ingest(TEST_AGENT_ID, f2);

    const batchFn = vi.fn().mockImplementation(async (texts: string[]) =>
      texts.map(() => vec(0.5, 0.5, 0.5, 0.5))
    );

    const indexer = new RagIndexer(db, vectorStore, batchFn);
    const count = await indexer.indexAllPending(TEST_AGENT_ID);
    expect(count).toBe(2);
  });

  it('reindexFile 应清理旧向量并重新索引', async () => {
    const ingester = new FileIngester(db);
    const filePath = createTestFile('re.md', '## Re\n\nReindex me.');
    const fileId = await ingester.ingest(TEST_AGENT_ID, filePath);

    const batchFn = vi.fn().mockImplementation(async (texts: string[]) =>
      texts.map(() => vec(0.1, 0.2, 0.3, 0.4))
    );

    const indexer = new RagIndexer(db, vectorStore, batchFn);
    await indexer.indexFile(fileId);
    const initialSize = vectorStore.size;

    // 重新索引
    await indexer.reindexFile(fileId);
    expect(vectorStore.size).toBe(initialSize); // 数量不变
    expect(batchFn).toHaveBeenCalledTimes(2); // 调用两次
  });
});
