import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { FileIngester } from '../rag/file-ingester.js';

/** 读取迁移 SQL */
const MIGRATION_001 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '001_initial.sql'),
  'utf-8',
);
const MIGRATION_009 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '009_knowledge_base.sql'),
  'utf-8',
);

const TEST_AGENT_ID = 'test-agent-ingester';

describe('FileIngester', () => {
  let db: SqliteStore;
  let tmpDir: string;
  let ingester: FileIngester;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-ingester-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    db = new SqliteStore(path.join(tmpDir, 'test.db'));
    db.exec(MIGRATION_001);
    db.exec(MIGRATION_009);

    // 插入测试 Agent
    db.run('INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)',
      TEST_AGENT_ID, '摄取测试助手', '📥', 'active');

    ingester = new FileIngester(db);
  });

  afterEach(() => {
    try { db.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** 创建测试文件 */
  function createTestFile(name: string, content: string): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  it('ingest 应创建文件记录和分块', async () => {
    const filePath = createTestFile('test.md', '## Section A\n\nContent A.\n\n## Section B\n\nContent B.');
    const fileId = await ingester.ingest(TEST_AGENT_ID, filePath);

    expect(fileId).toBeTruthy();

    // 验证文件记录
    const file = db.get<{ id: string; status: string; chunk_count: number }>(
      'SELECT id, status, chunk_count FROM knowledge_base_files WHERE id = ?', fileId,
    );
    expect(file).toBeDefined();
    expect(file?.status).toBe('pending');
    expect(file?.chunk_count).toBeGreaterThan(0);

    // 验证分块
    const chunks = db.all('SELECT * FROM knowledge_base_chunks WHERE file_id = ?', fileId);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('ingest 相同文件应返回已有 ID', async () => {
    const filePath = createTestFile('dup.md', '## Duplicate\n\nSame content.');
    const fileId1 = await ingester.ingest(TEST_AGENT_ID, filePath);
    const fileId2 = await ingester.ingest(TEST_AGENT_ID, filePath);
    expect(fileId2).toBe(fileId1);
  });

  it('ingest 应正确计算 SHA-256 哈希', async () => {
    const content = 'Hello world';
    const filePath = createTestFile('hash.txt', content);
    const expectedHash = crypto.createHash('sha256').update(content).digest('hex');

    await ingester.ingest(TEST_AGENT_ID, filePath);

    const file = db.get<{ file_hash: string }>(
      'SELECT file_hash FROM knowledge_base_files WHERE agent_id = ?', TEST_AGENT_ID,
    );
    expect(file?.file_hash).toBe(expectedHash);
  });

  it('removeFile 应删除文件和分块', async () => {
    const filePath = createTestFile('remove.md', '## Remove\n\nTo be removed.');
    const fileId = await ingester.ingest(TEST_AGENT_ID, filePath);

    ingester.removeFile(fileId);

    const file = db.get('SELECT id FROM knowledge_base_files WHERE id = ?', fileId);
    expect(file).toBeUndefined();

    const chunks = db.all('SELECT id FROM knowledge_base_chunks WHERE file_id = ?', fileId);
    expect(chunks.length).toBe(0);
  });

  it('checkFileChanged 对新文件应返回 true', () => {
    const filePath = createTestFile('new.txt', 'Brand new content');
    expect(ingester.checkFileChanged(filePath)).toBe(true);
  });

  it('checkFileChanged 对已摄取且未变更的文件应返回 false', async () => {
    const filePath = createTestFile('stable.txt', 'Stable content');
    await ingester.ingest(TEST_AGENT_ID, filePath);
    expect(ingester.checkFileChanged(filePath)).toBe(false);
  });

  it('checkFileChanged 对已摄取但内容变更的文件应返回 true', async () => {
    const filePath = createTestFile('changed.txt', 'Original');
    await ingester.ingest(TEST_AGENT_ID, filePath);
    fs.writeFileSync(filePath, 'Modified', 'utf-8');
    expect(ingester.checkFileChanged(filePath)).toBe(true);
  });

  it('ingest 应正确检测文件类型并分块', async () => {
    const codePath = createTestFile('app.ts', `
export function greet(name: string): string {
  return 'Hello ' + name;
}

export class Greeter {
  hello() { return 'hi'; }
}
`);
    const fileId = await ingester.ingest(TEST_AGENT_ID, codePath);
    const chunks = db.all<{ metadata_json: string }>(
      'SELECT metadata_json FROM knowledge_base_chunks WHERE file_id = ?', fileId,
    );
    expect(chunks.length).toBeGreaterThan(0);
  });
});
