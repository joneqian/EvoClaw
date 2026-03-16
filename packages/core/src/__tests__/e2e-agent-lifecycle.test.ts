/**
 * E2E: Agent CRUD 全流程
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestEnv, cleanupTestEnv, authHeader, jsonHeaders } from './e2e-helpers.js';

describe('E2E: Agent 生命周期', () => {
  let env: ReturnType<typeof createTestEnv>;

  beforeEach(() => {
    env = createTestEnv();
  });

  afterEach(() => {
    cleanupTestEnv(env.store, env.tmpDir);
  });

  it('完整 CRUD 流程: 创建 → 查询 → 更新 → 列表 → 删除', async () => {
    // 1. 创建
    const createRes = await env.app.request('/agents', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: '测试 Agent', emoji: '🧪' }),
    });
    expect(createRes.status).toBe(201);
    const { agent } = await createRes.json() as { agent: { id: string; name: string; emoji: string } };
    expect(agent.name).toBe('测试 Agent');
    expect(agent.emoji).toBe('🧪');
    expect(agent.id).toBeTruthy();

    // 2. 查询
    const getRes = await env.app.request(`/agents/${agent.id}`, { headers: authHeader() });
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json() as { agent: { id: string; name: string } };
    expect(getBody.agent.id).toBe(agent.id);

    // 3. 更新
    const patchRes = await env.app.request(`/agents/${agent.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: '更新后的 Agent', emoji: '🎯' }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json() as { agent: { name: string; emoji: string } };
    expect(patchBody.agent.name).toBe('更新后的 Agent');

    // 4. 列表中应包含该 Agent
    const listRes = await env.app.request('/agents', { headers: authHeader() });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as { agents: { id: string }[] };
    expect(listBody.agents.length).toBe(1);
    expect(listBody.agents[0].id).toBe(agent.id);

    // 5. 删除
    const delRes = await env.app.request(`/agents/${agent.id}`, {
      method: 'DELETE',
      headers: authHeader(),
    });
    expect(delRes.status).toBe(200);

    // 6. 删除后查不到
    const getAfterDel = await env.app.request(`/agents/${agent.id}`, { headers: authHeader() });
    expect(getAfterDel.status).toBe(404);
  });

  it('创建多个 Agent 后列表返回正确数量', async () => {
    for (let i = 0; i < 3; i++) {
      await env.app.request('/agents', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ name: `Agent ${i}` }),
      });
    }
    const res = await env.app.request('/agents', { headers: authHeader() });
    const body = await res.json() as { agents: unknown[] };
    expect(body.agents.length).toBe(3);
  });

  it('创建不带 name 返回 400', async () => {
    const res = await env.app.request('/agents', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ emoji: '🤖' }),
    });
    expect(res.status).toBe(400);
  });

  it('获取不存在的 Agent 返回 404', async () => {
    const res = await env.app.request('/agents/nonexistent', { headers: authHeader() });
    expect(res.status).toBe(404);
  });

  it('删除不存在的 Agent 返回 404', async () => {
    const res = await env.app.request('/agents/nonexistent', {
      method: 'DELETE',
      headers: authHeader(),
    });
    expect(res.status).toBe(404);
  });
});
