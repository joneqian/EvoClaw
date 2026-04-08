import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createApp } from '../server.js';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { AgentManager } from '../agent/agent-manager.js';

/** 读取迁移 SQL */
const migrationsDir = path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations');
const MIGRATION_SQL = fs.readFileSync(path.join(migrationsDir, '001_initial.sql'), 'utf-8');
const MIGRATION_CONVLOG_SQL = fs.readFileSync(path.join(migrationsDir, '004_conversation_log.sql'), 'utf-8');
const MIGRATION_021_SQL = fs.readFileSync(path.join(migrationsDir, '021_conversation_log_hierarchy.sql'), 'utf-8');
const MIGRATION_WORKSPACE_STATE_SQL = fs.readFileSync(path.join(migrationsDir, '014_workspace_state.sql'), 'utf-8');
// 缺 ON DELETE CASCADE 的表 — 用于回归测试 deleteAgent 手动级联清理
const MIGRATION_018_SQL = fs.readFileSync(path.join(migrationsDir, '018_consolidation_log.sql'), 'utf-8');
const MIGRATION_019_SQL = fs.readFileSync(path.join(migrationsDir, '019_session_summary.sql'), 'utf-8');
const MIGRATION_020_SQL = fs.readFileSync(path.join(migrationsDir, '020_usage_tracking.sql'), 'utf-8');

const TEST_TOKEN = 'test-token-for-routes';

function authHeader() {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
}

describe('Agent CRUD 路由', () => {
  let store: SqliteStore;
  let manager: AgentManager;
  let app: ReturnType<typeof createApp>;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-routes-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const dbPath = path.join(tmpDir, 'test.db');
    const agentsDir = path.join(tmpDir, 'agents');

    store = new SqliteStore(dbPath);
    store.exec(MIGRATION_SQL);
    store.exec(MIGRATION_CONVLOG_SQL);
    store.exec(MIGRATION_021_SQL);
    store.exec(MIGRATION_WORKSPACE_STATE_SQL);
    store.exec(MIGRATION_018_SQL);
    store.exec(MIGRATION_019_SQL);
    store.exec(MIGRATION_020_SQL);
    try { store.exec('ALTER TABLE agents ADD COLUMN last_chat_at TEXT'); } catch { /* 已存在 */ }
    manager = new AgentManager(store, agentsDir);
    app = createApp({ token: TEST_TOKEN, store, agentManager: manager });
  });

  afterEach(() => {
    try { store.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /agents 初始应返回空列表', async () => {
    const res = await app.request('/agents', { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = await res.json() as { agents: unknown[] };
    expect(body.agents).toEqual([]);
  });

  it('POST /agents 应创建 Agent', async () => {
    const res = await app.request('/agents', {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '测试助手', emoji: '🧪' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { agent: { id: string; name: string; emoji: string } };
    expect(body.agent.name).toBe('测试助手');
    expect(body.agent.emoji).toBe('🧪');
    expect(body.agent.id).toBeDefined();
  });

  it('POST /agents 无 name 应返回 400', async () => {
    const res = await app.request('/agents', {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji: '🧪' }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /agents/:id 应返回已创建的 Agent', async () => {
    // 先创建
    const createRes = await app.request('/agents', {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '查询测试' }),
    });
    const { agent } = await createRes.json() as { agent: { id: string } };

    // 再查询
    const res = await app.request(`/agents/${agent.id}`, { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = await res.json() as { agent: { id: string; name: string } };
    expect(body.agent.id).toBe(agent.id);
    expect(body.agent.name).toBe('查询测试');
  });

  it('GET /agents/:id 不存在应返回 404', async () => {
    const res = await app.request('/agents/non-existent-id', { headers: authHeader() });
    expect(res.status).toBe(404);
  });

  it('PATCH /agents/:id 应更新 Agent', async () => {
    const createRes = await app.request('/agents', {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '旧名称' }),
    });
    const { agent } = await createRes.json() as { agent: { id: string } };

    const res = await app.request(`/agents/${agent.id}`, {
      method: 'PATCH',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '新名称' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { agent: { name: string } };
    expect(body.agent.name).toBe('新名称');
  });

  it('PATCH /agents/:id 不存在应返回 404', async () => {
    const res = await app.request('/agents/non-existent-id', {
      method: 'PATCH',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '新名称' }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /agents/:id 应删除 Agent', async () => {
    const createRes = await app.request('/agents', {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '删除测试' }),
    });
    const { agent } = await createRes.json() as { agent: { id: string } };

    const deleteRes = await app.request(`/agents/${agent.id}`, {
      method: 'DELETE',
      headers: authHeader(),
    });
    expect(deleteRes.status).toBe(200);
    const body = await deleteRes.json() as { deleted: boolean };
    expect(body.deleted).toBe(true);

    // 确认已删除
    const getRes = await app.request(`/agents/${agent.id}`, { headers: authHeader() });
    expect(getRes.status).toBe(404);
  });

  it('DELETE /agents/:id 不存在应返回 404', async () => {
    const res = await app.request('/agents/non-existent-id', {
      method: 'DELETE',
      headers: authHeader(),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /agents/:id 应级联清理无 CASCADE 的子表 (consolidation_log/session_summaries/usage_tracking)', async () => {
    // 1. 创建 Agent
    const createRes = await app.request('/agents', {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '级联删除回归测试' }),
    });
    const { agent } = await createRes.json() as { agent: { id: string } };

    // 2. 在 3 个无 CASCADE 的表里插入引用此 Agent 的行
    store.run(
      'INSERT INTO consolidation_log (id, agent_id, started_at, status) VALUES (?, ?, ?, ?)',
      crypto.randomUUID(), agent.id, new Date().toISOString(), 'completed',
    );
    store.run(
      'INSERT INTO session_summaries (id, agent_id, session_key, summary_markdown, token_count_at, turn_count_at) VALUES (?, ?, ?, ?, ?, ?)',
      crypto.randomUUID(), agent.id, 'agent:test:dm:peer', '# 摘要', 100, 5,
    );
    store.run(
      'INSERT INTO usage_tracking (id, agent_id, provider, model, input_tokens, output_tokens, total_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)',
      crypto.randomUUID(), agent.id, 'glm', 'glm-5', 1000, 200, 1200,
    );

    // 3. 删除 Agent —— 之前会因 FOREIGN KEY constraint failed 而报错
    const deleteRes = await app.request(`/agents/${agent.id}`, {
      method: 'DELETE',
      headers: authHeader(),
    });
    expect(deleteRes.status).toBe(200);

    // 4. 验证子表的引用行已清理
    const consolidation = store.all<{ id: string }>(
      'SELECT id FROM consolidation_log WHERE agent_id = ?', agent.id,
    );
    expect(consolidation).toHaveLength(0);

    const summaries = store.all<{ id: string }>(
      'SELECT id FROM session_summaries WHERE agent_id = ?', agent.id,
    );
    expect(summaries).toHaveLength(0);

    const usage = store.all<{ id: string }>(
      'SELECT id FROM usage_tracking WHERE agent_id = ?', agent.id,
    );
    expect(usage).toHaveLength(0);

    // 5. Agent 本身已删
    const getRes = await app.request(`/agents/${agent.id}`, { headers: authHeader() });
    expect(getRes.status).toBe(404);
  });
});

describe('Chat 路由', () => {
  let store: SqliteStore;
  let manager: AgentManager;
  let app: ReturnType<typeof createApp>;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-chat-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const dbPath = path.join(tmpDir, 'test.db');
    const agentsDir = path.join(tmpDir, 'agents');

    store = new SqliteStore(dbPath);
    store.exec(MIGRATION_SQL);
    store.exec(MIGRATION_CONVLOG_SQL);
    store.exec(MIGRATION_021_SQL);
    store.exec(MIGRATION_WORKSPACE_STATE_SQL);
    try { store.exec('ALTER TABLE agents ADD COLUMN last_chat_at TEXT'); } catch { /* 已存在 */ }
    manager = new AgentManager(store, agentsDir);
    app = createApp({ token: TEST_TOKEN, store, agentManager: manager });
  });

  afterEach(() => {
    try { store.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('POST /chat/nonexistent/send 应返回 404', async () => {
    const res = await app.request('/chat/nonexistent/send', {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '你好' }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /chat/:id/send 无消息应返回 400', async () => {
    const createRes = await app.request('/agents', {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '聊天测试' }),
    });
    const { agent } = await createRes.json() as { agent: { id: string } };

    const res = await app.request(`/chat/${agent.id}/send`, {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
