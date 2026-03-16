/**
 * E2E: 写入记忆 → 列出 → 删除 → 反馈防护
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestEnv, cleanupTestEnv, authHeader, jsonHeaders } from './e2e-helpers.js';

describe('E2E: 记忆管理', () => {
  let env: ReturnType<typeof createTestEnv>;
  let agentId: string;

  beforeEach(async () => {
    env = createTestEnv();
    const res = await env.app.request('/agents', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: '记忆测试 Agent' }),
    });
    const body = await res.json() as { agent: { id: string } };
    agentId = body.agent.id;
  });

  afterEach(() => {
    cleanupTestEnv(env.store, env.tmpDir);
  });

  it('写入记忆后可通过 units 列出', async () => {
    const id = crypto.randomUUID();
    env.store.run(
      `INSERT INTO memory_units (id, agent_id, category, merge_type, l0_index, l1_overview, l2_content, access_count, created_at, updated_at)
       VALUES (?, ?, 'profile', 'independent', '用户喜欢 TypeScript', '用户多次提到偏好 TypeScript 语言', '完整的记忆内容', 0, datetime('now'), datetime('now'))`,
      id, agentId,
    );

    const res = await env.app.request(`/memory/${agentId}/units`, { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = await res.json() as { units: { id: string }[] };
    expect(body.units.length).toBeGreaterThanOrEqual(1);
  });

  it('获取单条记忆详情', async () => {
    const id = crypto.randomUUID();
    env.store.run(
      `INSERT INTO memory_units (id, agent_id, category, merge_type, l0_index, l1_overview, l2_content, access_count, created_at, updated_at)
       VALUES (?, ?, 'preference', 'independent', '偏好暗色主题', '用户表示喜欢暗色模式', '详细内容', 5, datetime('now'), datetime('now'))`,
      id, agentId,
    );

    const res = await env.app.request(`/memory/${agentId}/units/${id}`, { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = await res.json() as { unit: { category: string } };
    expect(body.unit.category).toBe('preference');
  });

  it('反馈防护标记的记忆含零宽空格', async () => {
    const markedContent = '用户\u200B喜欢\u200BPython';
    const id = crypto.randomUUID();
    env.store.run(
      `INSERT INTO memory_units (id, agent_id, category, merge_type, l0_index, l1_overview, l2_content, access_count, created_at, updated_at)
       VALUES (?, ?, 'profile', 'independent', ?, ?, ?, 0, datetime('now'), datetime('now'))`,
      id, agentId, markedContent, markedContent, markedContent,
    );

    const row = env.store.get<{ l2_content: string }>(
      'SELECT l2_content FROM memory_units WHERE id = ?', id,
    );
    expect(row!.l2_content).toContain('\u200B');
  });

  it('DELETE /memory/:agentId/units/:id 删除记忆', async () => {
    const id = crypto.randomUUID();
    env.store.run(
      `INSERT INTO memory_units (id, agent_id, category, merge_type, l0_index, l1_overview, l2_content, access_count, created_at, updated_at)
       VALUES (?, ?, 'entity', 'independent', '测试实体', '概览', '内容', 0, datetime('now'), datetime('now'))`,
      id, agentId,
    );

    const delRes = await env.app.request(`/memory/${agentId}/units/${id}`, {
      method: 'DELETE',
      headers: authHeader(),
    });
    expect(delRes.status).toBe(200);

    const row = env.store.get('SELECT id FROM memory_units WHERE id = ?', id);
    expect(row).toBeUndefined();
  });
});
