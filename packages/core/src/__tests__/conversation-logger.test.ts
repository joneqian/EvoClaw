import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { ConversationLogger, type ConversationLogEntry } from '../memory/conversation-logger.js';

/** 读取迁移 SQL（001 + 004） */
const MIGRATION_001 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '001_initial.sql'),
  'utf-8'
);
const MIGRATION_004 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '004_conversation_log.sql'),
  'utf-8'
);

/** 创建测试用 Agent 记录 */
function insertTestAgent(store: SqliteStore, agentId: string): void {
  store.run(
    `INSERT INTO agents (id, name, emoji, status, config_json) VALUES (?, ?, ?, ?, ?)`,
    agentId, '测试助手', '🤖', 'active', '{}',
  );
}

/** 构建测试用日志条目 */
function makeLogEntry(overrides?: Partial<ConversationLogEntry>): ConversationLogEntry {
  return {
    id: crypto.randomUUID(),
    agentId: 'agent-logger-test-001',
    sessionKey: 'session-001',
    role: 'user',
    content: '你好，这是一条测试消息',
    tokenCount: 10,
    ...overrides,
  };
}

describe('ConversationLogger', () => {
  let store: SqliteStore;
  let logger: ConversationLogger;
  let tmpDir: string;
  const agentId = 'agent-logger-test-001';
  const sessionKey = 'session-001';

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-logger-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const dbPath = path.join(tmpDir, 'test.db');

    store = new SqliteStore(dbPath);
    store.exec(MIGRATION_001);
    store.exec(MIGRATION_004);
    insertTestAgent(store, agentId);

    logger = new ConversationLogger(store);
  });

  afterEach(() => {
    try { store.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('log 插入后可通过 getBySession 查询', () => {
    const entry = makeLogEntry();
    logger.log(entry);

    const results = logger.getBySession(agentId, sessionKey);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(entry.id);
    expect(results[0].agentId).toBe(agentId);
    expect(results[0].sessionKey).toBe(sessionKey);
    expect(results[0].role).toBe('user');
    expect(results[0].content).toBe('你好，这是一条测试消息');
    expect(results[0].tokenCount).toBe(10);
  });

  it('getPendingMessages 仅返回 raw 状态的条目', () => {
    // 插入 3 条消息
    const entry1 = makeLogEntry({ id: crypto.randomUUID(), content: '消息一' });
    const entry2 = makeLogEntry({ id: crypto.randomUUID(), content: '消息二' });
    const entry3 = makeLogEntry({ id: crypto.randomUUID(), content: '消息三' });
    logger.log(entry1);
    logger.log(entry2);
    logger.log(entry3);

    // 所有消息初始状态为 raw
    const pending = logger.getPendingMessages(agentId, sessionKey);
    expect(pending).toHaveLength(3);
    expect(pending.every(p => p.compactionStatus === 'raw')).toBe(true);
  });

  it('markExtracted 应更新 compaction_status 和 compaction_ref', () => {
    const entry = makeLogEntry();
    logger.log(entry);

    const memoryUnitId = 'mem-unit-001';
    logger.markExtracted([entry.id], memoryUnitId);

    // 通过原始 SQL 验证状态变更
    const row = store.get<{ compaction_status: string; compaction_ref: string }>(
      'SELECT compaction_status, compaction_ref FROM conversation_log WHERE id = ?',
      entry.id,
    );
    expect(row).toBeDefined();
    expect(row!.compaction_status).toBe('extracted');
    expect(row!.compaction_ref).toBe(memoryUnitId);
  });

  it('markCompacted 应更新 compaction_status 和 compaction_ref', () => {
    const entry = makeLogEntry();
    logger.log(entry);

    const summaryId = 'summary-001';
    logger.markCompacted([entry.id], summaryId);

    // 通过原始 SQL 验证状态变更
    const row = store.get<{ compaction_status: string; compaction_ref: string }>(
      'SELECT compaction_status, compaction_ref FROM conversation_log WHERE id = ?',
      entry.id,
    );
    expect(row).toBeDefined();
    expect(row!.compaction_status).toBe('compacted');
    expect(row!.compaction_ref).toBe(summaryId);
  });

  it('getBySession 支持 limit 参数限制返回条数', () => {
    // 插入 5 条消息
    for (let i = 0; i < 5; i++) {
      logger.log(makeLogEntry({ id: crypto.randomUUID(), content: `消息 ${i}` }));
    }

    const limited = logger.getBySession(agentId, sessionKey, 3);
    expect(limited).toHaveLength(3);

    // 无限制时应返回全部
    const all = logger.getBySession(agentId, sessionKey);
    expect(all).toHaveLength(5);
  });

  it('已提取的消息不会出现在 getPendingMessages 中', () => {
    const entry1 = makeLogEntry({ id: crypto.randomUUID(), content: '待处理消息' });
    const entry2 = makeLogEntry({ id: crypto.randomUUID(), content: '已提取消息' });
    logger.log(entry1);
    logger.log(entry2);

    // 标记 entry2 为已提取
    logger.markExtracted([entry2.id], 'mem-unit-002');

    // getPendingMessages 应只返回 entry1
    const pending = logger.getPendingMessages(agentId, sessionKey);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(entry1.id);
    expect(pending[0].content).toBe('待处理消息');
  });
});
