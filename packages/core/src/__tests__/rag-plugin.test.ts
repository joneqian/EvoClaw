import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { VectorStore } from '../infrastructure/db/vector-store.js';
import { createRagPlugin } from '../context/plugins/rag.js';
import type { TurnContext } from '../context/plugin.interface.js';

/** 读取迁移 SQL */
const MIGRATION_001 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '001_initial.sql'),
  'utf-8',
);
const MIGRATION_009 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '009_knowledge_base.sql'),
  'utf-8',
);

const TEST_AGENT_ID = 'test-agent-rag-plugin';

function vec(...values: number[]): Float32Array {
  return new Float32Array(values);
}

function createTurnContext(userMessage: string): TurnContext {
  return {
    agentId: TEST_AGENT_ID,
    sessionKey: `agent:${TEST_AGENT_ID}:default:dm:user1` as any,
    messages: [{ role: 'user', content: userMessage, id: 'test-msg-1', conversationId: 'test-conv', createdAt: new Date().toISOString() }],
    systemPrompt: '',
    injectedContext: [],
    estimatedTokens: 0,
    tokenLimit: 100000,
  };
}

describe('RAG Plugin', () => {
  let db: SqliteStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-rag-plugin-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    db = new SqliteStore(path.join(tmpDir, 'test.db'));
    db.exec(MIGRATION_001);
    db.exec(MIGRATION_009);

    db.run('INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)',
      TEST_AGENT_ID, 'RAG插件测试助手', '🔌', 'active');
  });

  afterEach(() => {
    try { db.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('name 和 priority 应正确设置', () => {
    const vs = new VectorStore(db);
    const plugin = createRagPlugin(vs, db);
    expect(plugin.name).toBe('rag');
    expect(plugin.priority).toBe(50);
  });

  it('无 embeddingFn 时 beforeTurn 应跳过', async () => {
    const vs = new VectorStore(db); // 无 embeddingFn
    const plugin = createRagPlugin(vs, db);
    const ctx = createTurnContext('hello');

    await plugin.beforeTurn!(ctx);
    expect(ctx.injectedContext.length).toBe(0);
  });

  it('无用户消息时应跳过', async () => {
    const mockFn = vi.fn().mockResolvedValue(vec(1, 0, 0, 0));
    const vs = new VectorStore(db, mockFn);
    const plugin = createRagPlugin(vs, db);

    const ctx: TurnContext = {
      agentId: TEST_AGENT_ID,
      sessionKey: `agent:${TEST_AGENT_ID}:default:dm:user1` as any,
      messages: [],
      systemPrompt: '',
      injectedContext: [],
      estimatedTokens: 0,
      tokenLimit: 100000,
    };

    await plugin.beforeTurn!(ctx);
    expect(ctx.injectedContext.length).toBe(0);
  });

  it('有 chunks 时应注入 RAG 上下文', async () => {
    const mockFn = vi.fn().mockResolvedValue(vec(1, 0, 0, 0));
    const vs = new VectorStore(db, mockFn);

    // 插入测试文件和 chunk
    const fileId = crypto.randomUUID();
    const chunkId = crypto.randomUUID();
    db.run(
      `INSERT INTO knowledge_base_files (id, agent_id, file_name, file_path, file_hash, file_size, chunk_count, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'indexed')`,
      fileId, TEST_AGENT_ID, 'test.md', '/tmp/test.md', 'abc', 100, 1,
    );
    db.run(
      `INSERT INTO knowledge_base_chunks (id, file_id, agent_id, chunk_index, content, token_count)
       VALUES (?, ?, ?, 0, '这是知识库的测试内容', 10)`,
      chunkId, fileId, TEST_AGENT_ID,
    );
    // 索引向量
    await vs.indexEmbedding(chunkId, vec(1, 0, 0, 0), 'chunk');

    const plugin = createRagPlugin(vs, db);
    const ctx = createTurnContext('测试查询');

    await plugin.beforeTurn!(ctx);

    expect(ctx.injectedContext.length).toBe(1);
    expect(ctx.injectedContext[0]).toContain('相关知识库文档');
    expect(ctx.injectedContext[0]).toContain('test.md');
    expect(ctx.estimatedTokens).toBeGreaterThan(0);
  });

  it('无匹配 chunks 时不注入', async () => {
    // 返回空搜索结果
    const mockFn = vi.fn().mockResolvedValue(vec(1, 0, 0, 0));
    const vs = new VectorStore(db, mockFn);
    // 不插入任何 chunks

    const plugin = createRagPlugin(vs, db);
    const ctx = createTurnContext('no match query');

    await plugin.beforeTurn!(ctx);
    expect(ctx.injectedContext.length).toBe(0);
  });

  it('compact 应返回原始消息', async () => {
    const vs = new VectorStore(db);
    const plugin = createRagPlugin(vs, db);

    const messages = [{ role: 'user' as const, content: 'test', id: 'test-msg-1', conversationId: 'test-conv', createdAt: new Date().toISOString() }];
    const result = await plugin.compact!({
      agentId: TEST_AGENT_ID,
      sessionKey: `agent:${TEST_AGENT_ID}:default:dm:user1` as any,
      messages,
      tokenUsageRatio: 0.8,
    });
    expect(result).toBe(messages);
  });
});
