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
