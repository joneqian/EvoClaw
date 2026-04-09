/**
 * E2E: Sprint 15.12 Phase B 新增的 5 个 routes/memory.ts 端点
 * - PUT  /memory/:agentId/units/:id            — 更新 L1/L2（L0 锁死）
 * - POST /memory/:agentId/units/:id/feedback   — 写反馈 + confidence -= 0.15
 * - GET  /memory/:agentId/knowledge-graph      — 知识图谱三元组分页
 * - GET  /memory/:agentId/consolidations       — AutoDream 整合历史
 * - GET  /memory/:agentId/session-summaries    — 会话摘要列表
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestEnv, cleanupTestEnv, authHeader, jsonHeaders } from './e2e-helpers.js';

describe('E2E: Memory Phase B 端点', () => {
  let env: ReturnType<typeof createTestEnv>;
  let agentId: string;
  let memId: string;

  beforeEach(async () => {
    env = createTestEnv();
    const res = await env.app.request('/agents', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ name: 'Phase B 测试 Agent' }),
    });
    const body = await res.json() as { agent: { id: string } };
    agentId = body.agent.id;

    // 插入一条测试记忆
    memId = crypto.randomUUID();
    env.store.run(
      `INSERT INTO memory_units (id, agent_id, category, merge_type, l0_index, l1_overview, l2_content, confidence, access_count, created_at, updated_at)
       VALUES (?, ?, 'profile', 'merge', '原始 L0', '原始 L1', '原始 L2', 0.8, 0, datetime('now'), datetime('now'))`,
      memId, agentId,
    );
  });

  afterEach(() => {
    cleanupTestEnv(env.store, env.tmpDir);
  });

  // ─────────────────────────────────────────────────────────────────
  // PUT /:agentId/units/:id — 更新 L1/L2
  // ─────────────────────────────────────────────────────────────────

  describe('PUT /units/:id', () => {
    it('应能更新 l1Overview 和 l2Content', async () => {
      const res = await env.app.request(`/memory/${agentId}/units/${memId}`, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify({ l1Overview: '修订后概览', l2Content: '修订后详情' }),
      });
      expect(res.status).toBe(200);

      const row = env.store.get<{ l0_index: string; l1_overview: string; l2_content: string }>(
        'SELECT l0_index, l1_overview, l2_content FROM memory_units WHERE id = ?', memId,
      );
      expect(row!.l0_index).toBe('原始 L0'); // L0 锁死
      expect(row!.l1_overview).toBe('修订后概览');
      expect(row!.l2_content).toBe('修订后详情');
    });

    it('应忽略 l0Index 字段（L0 锁死）', async () => {
      const res = await env.app.request(`/memory/${agentId}/units/${memId}`, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify({ l0Index: '试图改 L0', l1Overview: '新概览' }),
      });
      expect(res.status).toBe(200);

      const row = env.store.get<{ l0_index: string }>(
        'SELECT l0_index FROM memory_units WHERE id = ?', memId,
      );
      expect(row!.l0_index).toBe('原始 L0');
    });

    it('未提供任何更新字段应返回 400', async () => {
      const res = await env.app.request(`/memory/${agentId}/units/${memId}`, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('id 不存在应返回 404', async () => {
      const res = await env.app.request(`/memory/${agentId}/units/nonexistent`, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify({ l1Overview: '新概览' }),
      });
      expect(res.status).toBe(404);
    });

    it('跨 agent 修改应返回 403', async () => {
      const otherRes = await env.app.request('/agents', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ name: '别的 Agent' }),
      });
      const { agent: { id: otherId } } = await otherRes.json() as { agent: { id: string } };

      const res = await env.app.request(`/memory/${otherId}/units/${memId}`, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify({ l1Overview: '入侵' }),
      });
      expect(res.status).toBe(403);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // POST /:agentId/units/:id/feedback — 反馈 + confidence 衰减
  // ─────────────────────────────────────────────────────────────────

  describe('POST /units/:id/feedback', () => {
    it('应写入 memory_feedback 并降低 confidence', async () => {
      const res = await env.app.request(`/memory/${agentId}/units/${memId}/feedback`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ type: 'inaccurate', note: '事实不符' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { feedback: { id: string; type: string } };
      expect(body.feedback.type).toBe('inaccurate');

      // memory_feedback 表里应有一条记录
      const fb = env.store.get<{ id: string; note: string; resolved_at: string | null }>(
        'SELECT id, note, resolved_at FROM memory_feedback WHERE memory_id = ?', memId,
      );
      expect(fb).toBeDefined();
      expect(fb!.note).toBe('事实不符');
      expect(fb!.resolved_at).toBeNull();

      // confidence 应从 0.8 降到 0.65
      const mem = env.store.get<{ confidence: number }>(
        'SELECT confidence FROM memory_units WHERE id = ?', memId,
      );
      expect(mem!.confidence).toBeCloseTo(0.65, 5);
    });

    it('多次反馈应连续衰减但不低于 0', async () => {
      for (let i = 0; i < 10; i++) {
        await env.app.request(`/memory/${agentId}/units/${memId}/feedback`, {
          method: 'POST',
          headers: jsonHeaders(),
          body: JSON.stringify({ type: 'inaccurate' }),
        });
      }
      const mem = env.store.get<{ confidence: number }>(
        'SELECT confidence FROM memory_units WHERE id = ?', memId,
      );
      expect(mem!.confidence).toBeGreaterThanOrEqual(0);
    });

    it('非法 type 应返回 400', async () => {
      const res = await env.app.request(`/memory/${agentId}/units/${memId}/feedback`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ type: 'bogus' }),
      });
      expect(res.status).toBe(400);
    });

    it('id 不存在应返回 404', async () => {
      const res = await env.app.request(`/memory/${agentId}/units/nonexistent/feedback`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ type: 'inaccurate' }),
      });
      expect(res.status).toBe(404);
    });

    it('跨 agent 反馈应返回 403', async () => {
      const otherRes = await env.app.request('/agents', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ name: '别的 Agent' }),
      });
      const { agent: { id: otherId } } = await otherRes.json() as { agent: { id: string } };

      const res = await env.app.request(`/memory/${otherId}/units/${memId}/feedback`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ type: 'sensitive' }),
      });
      expect(res.status).toBe(403);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /:agentId/knowledge-graph
  // ─────────────────────────────────────────────────────────────────

  describe('GET /knowledge-graph', () => {
    it('空知识图谱应返回空数组', async () => {
      const res = await env.app.request(`/memory/${agentId}/knowledge-graph`, {
        headers: authHeader(),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { relations: unknown[] };
      expect(body.relations).toEqual([]);
    });

    it('应返回当前 Agent 的关系三元组', async () => {
      env.store.run(
        `INSERT INTO knowledge_graph (id, agent_id, subject_id, predicate, object_id, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        crypto.randomUUID(), agentId, '用户', 'has_daughter', '笑笑', 0.9,
      );
      env.store.run(
        `INSERT INTO knowledge_graph (id, agent_id, subject_id, predicate, object_id, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        crypto.randomUUID(), agentId, '笑笑', 'likes', '画画', 0.95,
      );

      const res = await env.app.request(`/memory/${agentId}/knowledge-graph`, {
        headers: authHeader(),
      });
      const body = await res.json() as { relations: Array<{ subjectId: string; relation: string; objectId: string }> };
      expect(body.relations).toHaveLength(2);
      const relations = body.relations.map(r => r.relation);
      expect(relations).toContain('has_daughter');
      expect(relations).toContain('likes');
    });

    it('支持 limit 参数', async () => {
      for (let i = 0; i < 5; i++) {
        env.store.run(
          `INSERT INTO knowledge_graph (id, agent_id, subject_id, predicate, object_id, confidence, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          crypto.randomUUID(), agentId, `s${i}`, 'rel', `o${i}`, 0.5,
        );
      }
      const res = await env.app.request(`/memory/${agentId}/knowledge-graph?limit=3`, {
        headers: authHeader(),
      });
      const body = await res.json() as { relations: unknown[] };
      expect(body.relations).toHaveLength(3);
    });

    it('不应跨 Agent 泄露', async () => {
      const otherRes = await env.app.request('/agents', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ name: '别的 Agent' }),
      });
      const { agent: { id: otherId } } = await otherRes.json() as { agent: { id: string } };

      env.store.run(
        `INSERT INTO knowledge_graph (id, agent_id, subject_id, predicate, object_id, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        crypto.randomUUID(), otherId, '其他用户', 'has_secret', 'shhh', 0.99,
      );

      const res = await env.app.request(`/memory/${agentId}/knowledge-graph`, {
        headers: authHeader(),
      });
      const body = await res.json() as { relations: unknown[] };
      expect(body.relations).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /:agentId/consolidations
  // ─────────────────────────────────────────────────────────────────

  describe('GET /consolidations', () => {
    it('空整合历史应返回空数组', async () => {
      const res = await env.app.request(`/memory/${agentId}/consolidations`, {
        headers: authHeader(),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { runs: unknown[] };
      expect(body.runs).toEqual([]);
    });

    it('应返回 AutoDream 运行记录（按时间倒序）', async () => {
      env.store.run(
        `INSERT INTO consolidation_log (id, agent_id, started_at, completed_at, status, memories_merged, memories_pruned, memories_created)
         VALUES (?, ?, datetime('now', '-1 hour'), datetime('now', '-1 hour', '+10 seconds'), 'completed', 3, 1, 0)`,
        crypto.randomUUID(), agentId,
      );
      env.store.run(
        `INSERT INTO consolidation_log (id, agent_id, started_at, completed_at, status, memories_merged, memories_pruned, memories_created)
         VALUES (?, ?, datetime('now'), datetime('now', '+5 seconds'), 'completed', 2, 0, 1)`,
        crypto.randomUUID(), agentId,
      );

      const res = await env.app.request(`/memory/${agentId}/consolidations`, {
        headers: authHeader(),
      });
      const body = await res.json() as {
        runs: Array<{ status: string; memoriesMerged: number; memoriesPruned: number; memoriesCreated: number }>;
      };
      expect(body.runs).toHaveLength(2);
      // 倒序：最新的在前 (memoriesMerged=2)
      expect(body.runs[0].memoriesMerged).toBe(2);
      expect(body.runs[1].memoriesMerged).toBe(3);
    });

    it('支持 limit 参数', async () => {
      for (let i = 0; i < 5; i++) {
        env.store.run(
          `INSERT INTO consolidation_log (id, agent_id, status) VALUES (?, ?, 'completed')`,
          crypto.randomUUID(), agentId,
        );
      }
      const res = await env.app.request(`/memory/${agentId}/consolidations?limit=2`, {
        headers: authHeader(),
      });
      const body = await res.json() as { runs: unknown[] };
      expect(body.runs).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // GET /:agentId/session-summaries
  // ─────────────────────────────────────────────────────────────────

  describe('GET /session-summaries', () => {
    it('空摘要列表应返回空数组', async () => {
      const res = await env.app.request(`/memory/${agentId}/session-summaries`, {
        headers: authHeader(),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { summaries: unknown[] };
      expect(body.summaries).toEqual([]);
    });

    it('应返回会话摘要（按 updated_at 倒序）', async () => {
      env.store.run(
        `INSERT INTO session_summaries (id, agent_id, session_key, summary_markdown, token_count_at, turn_count_at, tool_call_count_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '-1 day'), datetime('now', '-1 day'))`,
        crypto.randomUUID(), agentId, 'session-A', '## 会话 A 摘要', 5000, 3, 1,
      );
      env.store.run(
        `INSERT INTO session_summaries (id, agent_id, session_key, summary_markdown, token_count_at, turn_count_at, tool_call_count_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        crypto.randomUUID(), agentId, 'session-B', '## 会话 B 摘要', 8000, 5, 2,
      );

      const res = await env.app.request(`/memory/${agentId}/session-summaries`, {
        headers: authHeader(),
      });
      const body = await res.json() as {
        summaries: Array<{ sessionKey: string; summaryMarkdown: string }>;
      };
      expect(body.summaries).toHaveLength(2);
      expect(body.summaries[0].sessionKey).toBe('session-B'); // 最新在前
      expect(body.summaries[0].summaryMarkdown).toContain('会话 B');
    });

    it('支持 limit 参数', async () => {
      for (let i = 0; i < 5; i++) {
        env.store.run(
          `INSERT INTO session_summaries (id, agent_id, session_key, summary_markdown, token_count_at, turn_count_at, tool_call_count_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          crypto.randomUUID(), agentId, `session-${i}`, `# ${i}`, 1000, 1, 0,
        );
      }
      const res = await env.app.request(`/memory/${agentId}/session-summaries?limit=2`, {
        headers: authHeader(),
      });
      const body = await res.json() as { summaries: unknown[] };
      expect(body.summaries).toHaveLength(2);
    });

    it('不应跨 Agent 泄露', async () => {
      const otherRes = await env.app.request('/agents', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ name: '别的 Agent' }),
      });
      const { agent: { id: otherId } } = await otherRes.json() as { agent: { id: string } };

      env.store.run(
        `INSERT INTO session_summaries (id, agent_id, session_key, summary_markdown, token_count_at, turn_count_at, tool_call_count_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        crypto.randomUUID(), otherId, 'other-session', '# 别人的摘要', 1000, 1, 0,
      );

      const res = await env.app.request(`/memory/${agentId}/session-summaries`, {
        headers: authHeader(),
      });
      const body = await res.json() as { summaries: unknown[] };
      expect(body.summaries).toHaveLength(0);
    });
  });
});
