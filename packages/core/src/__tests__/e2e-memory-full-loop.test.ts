/**
 * E2E: Sprint 15.12 全链路闭环测试
 *
 * 覆盖完整路径：
 *   memory_write LLM tool → DB 写入 →
 *   GET /units 列表能查到 →
 *   POST /units/:id/feedback 提交反馈 →
 *   memory_feedback 表有记录 →
 *   memory_units.confidence 下降 0.15 →
 *   再次反馈累加下降 →
 *   下降至 0 后不再为负
 *
 * 这是 Sprint 15.12 Phase A→B→E 全部价值的端到端验证。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestEnv, cleanupTestEnv, authHeader, jsonHeaders } from './e2e-helpers.js';

describe('E2E: Sprint 15.12 完整记忆闭环', () => {
  let env: ReturnType<typeof createTestEnv>;
  let agentId: string;

  beforeEach(async () => {
    env = createTestEnv();
    const res = await env.app.request('/agents', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: '闭环测试 Agent' }),
    });
    const body = await res.json() as { agent: { id: string } };
    agentId = body.agent.id;
  });

  afterEach(() => {
    cleanupTestEnv(env.store, env.tmpDir);
  });

  it('write → query → feedback → confidence decay → 多次累加 → 下限 0', async () => {
    // ── 1. 模拟 memory_write LLM 工具的写入（直接 INSERT 模拟工具内部行为）──
    const memoryId = crypto.randomUUID();
    const now = new Date().toISOString();
    env.store.run(
      `INSERT INTO memory_units (
        id, agent_id, category, merge_type, merge_key,
        l0_index, l1_overview, l2_content,
        confidence, activation, access_count,
        visibility, source_session_key,
        created_at, updated_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      memoryId, agentId, 'profile', 'merge', 'profile:family_daughter',
      '用户女儿叫小满，5月3日生日', '用户女儿小满 5月3日生日', '完整的女儿信息',
      0.9, 1.0, 0,
      'private', null,
      now, now, null,
    );

    // ── 2. GET /units 应能查到这条记忆 ──
    const listRes = await env.app.request(`/memory/${agentId}/units`, { headers: authHeader() });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as { units: Array<{ id: string; confidence: number; l0Index: string }> };
    expect(listBody.units.some(u => u.id === memoryId)).toBe(true);
    const initial = listBody.units.find(u => u.id === memoryId)!;
    expect(initial.confidence).toBeCloseTo(0.9, 5);
    expect(initial.l0Index).toContain('小满');

    // ── 3. 提交一次"不准确"反馈 ──
    const fb1Res = await env.app.request(`/memory/${agentId}/units/${memoryId}/feedback`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ type: 'inaccurate', note: '生日记错了' }),
    });
    expect(fb1Res.status).toBe(200);
    const fb1Body = await fb1Res.json() as { feedback: { id: string; type: string; note: string | null } };
    expect(fb1Body.feedback.type).toBe('inaccurate');
    expect(fb1Body.feedback.note).toBe('生日记错了');

    // ── 4. memory_feedback 表应有 1 条记录 ──
    const fbRows = env.store.all<{ id: string; type: string; resolved_at: string | null }>(
      'SELECT id, type, resolved_at FROM memory_feedback WHERE memory_id = ?', memoryId,
    );
    expect(fbRows).toHaveLength(1);
    expect(fbRows[0]!.type).toBe('inaccurate');
    expect(fbRows[0]!.resolved_at).toBeNull();

    // ── 5. memory_units.confidence 应从 0.9 降到 0.75 ──
    const after1 = env.store.get<{ confidence: number }>(
      'SELECT confidence FROM memory_units WHERE id = ?', memoryId,
    );
    expect(after1!.confidence).toBeCloseTo(0.75, 5);

    // ── 6. 连续多次反馈：每次再降 0.15 ──
    for (let i = 0; i < 4; i++) {
      const r = await env.app.request(`/memory/${agentId}/units/${memoryId}/feedback`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ type: 'inaccurate' }),
      });
      expect(r.status).toBe(200);
    }
    // 0.9 - 0.15*5 = 0.15
    const after5 = env.store.get<{ confidence: number }>(
      'SELECT confidence FROM memory_units WHERE id = ?', memoryId,
    );
    expect(after5!.confidence).toBeCloseTo(0.15, 5);

    // ── 7. 再来 5 次反馈，confidence 应该卡在 0 不变成负数 ──
    for (let i = 0; i < 5; i++) {
      await env.app.request(`/memory/${agentId}/units/${memoryId}/feedback`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ type: 'outdated' }),
      });
    }
    const after10 = env.store.get<{ confidence: number }>(
      'SELECT confidence FROM memory_units WHERE id = ?', memoryId,
    );
    expect(after10!.confidence).toBeGreaterThanOrEqual(0);
    expect(after10!.confidence).toBeLessThanOrEqual(0.001); // 应等于 0

    // ── 8. memory_feedback 表共 10 条，类型混合 ──
    const allFb = env.store.all<{ type: string }>(
      'SELECT type FROM memory_feedback WHERE memory_id = ? ORDER BY reported_at',
      memoryId,
    );
    expect(allFb).toHaveLength(10);
    expect(allFb.filter(r => r.type === 'inaccurate')).toHaveLength(5);
    expect(allFb.filter(r => r.type === 'outdated')).toHaveLength(5);
  });

  it('PUT 编辑 L1/L2 后再次反馈，confidence 仍按当前值衰减', async () => {
    // 创建一条 confidence=0.5 的记忆
    const memoryId = crypto.randomUUID();
    const now = new Date().toISOString();
    env.store.run(
      `INSERT INTO memory_units (id, agent_id, category, merge_type, l0_index, l1_overview, l2_content, confidence, activation, access_count, created_at, updated_at)
       VALUES (?, ?, 'preference', 'merge', '用户偏好简洁回答', '原始概述', '原始详情', 0.5, 1.0, 0, datetime('now'), datetime('now'))`,
      memoryId, agentId,
    );
    // 抑制 lint：确保 now 已使用
    expect(now).toBeTruthy();

    // 编辑 L1 + L2
    const editRes = await env.app.request(`/memory/${agentId}/units/${memoryId}`, {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({ l1Overview: '修订后概述', l2Content: '修订后详情' }),
    });
    expect(editRes.status).toBe(200);

    // 反馈后 confidence 0.5 → 0.35
    await env.app.request(`/memory/${agentId}/units/${memoryId}/feedback`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ type: 'sensitive' }),
    });

    const final = env.store.get<{ confidence: number; l1_overview: string; l2_content: string; l0_index: string }>(
      'SELECT confidence, l0_index, l1_overview, l2_content FROM memory_units WHERE id = ?', memoryId,
    );
    expect(final!.confidence).toBeCloseTo(0.35, 5);
    expect(final!.l0_index).toBe('用户偏好简洁回答'); // L0 锁死
    expect(final!.l1_overview).toBe('修订后概述');
    expect(final!.l2_content).toBe('修订后详情');
  });

  it('memory_feedback 跟随 memory_units 级联删除', async () => {
    const memoryId = crypto.randomUUID();
    env.store.run(
      `INSERT INTO memory_units (id, agent_id, category, merge_type, l0_index, l1_overview, l2_content, confidence, activation, access_count, created_at, updated_at)
       VALUES (?, ?, 'event', 'independent', '某事件', '某事件概览', '某事件详情', 0.6, 1.0, 0, datetime('now'), datetime('now'))`,
      memoryId, agentId,
    );

    // 提交 3 条反馈
    for (let i = 0; i < 3; i++) {
      await env.app.request(`/memory/${agentId}/units/${memoryId}/feedback`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ type: 'inaccurate' }),
      });
    }
    expect(env.store.all('SELECT id FROM memory_feedback WHERE memory_id = ?', memoryId)).toHaveLength(3);

    // 物理删除 memory_unit
    env.store.run('DELETE FROM memory_units WHERE id = ?', memoryId);

    // 反馈应被级联清理
    expect(env.store.all('SELECT id FROM memory_feedback WHERE memory_id = ?', memoryId)).toHaveLength(0);
  });
});
