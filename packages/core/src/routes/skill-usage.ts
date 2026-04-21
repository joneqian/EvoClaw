/**
 * Skill 调用 telemetry 路由 — M7 Phase 2
 *
 * 为前端 MemoryFeedbackTab 的 "Skill 效能" 面板提供数据：
 * - GET  /effectiveness?agentId=X&days=7     近 N 天所有 Skill 的效能排行
 * - GET  /stats?skill=X&days=7&agentId=Y     单 Skill 聚合统计
 * - GET  /recent?skill=X&limit=10&agentId=Y  单 Skill 最近调用（详情）
 * - GET  /summaries?skill=X&limit=5          单 Skill 最近 session 摘要
 * - POST /:id/feedback  Body: { feedback: 1|-1, note? }   用户反馈回写
 */

import { Hono } from 'hono';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { SkillUsageStore } from '../skill/skill-usage-store.js';

export interface SkillUsageRouteDeps {
  db: SqliteStore;
}

export function createSkillUsageRoutes(deps: SkillUsageRouteDeps): Hono {
  const app = new Hono();
  const store = new SkillUsageStore(deps.db);

  /** GET /effectiveness — Agent 近 N 天所有 Skill 效能排行 */
  app.get('/effectiveness', (c) => {
    const agentId = c.req.query('agentId');
    if (!agentId) {
      return c.json({ error: 'agentId query param required' }, 400);
    }
    const days = Number(c.req.query('days')) || 7;
    const rows = store.effectivenessForAgent(agentId, days);
    // 按 hotness 粗略排序：最近调用时间 * 成功率 * sqrt(count)
    const ranked = rows.sort((a, b) => {
      const ta = a.lastInvokedAt ? Date.parse(a.lastInvokedAt) : 0;
      const tb = b.lastInvokedAt ? Date.parse(b.lastInvokedAt) : 0;
      const sa = a.successRate * Math.sqrt(a.invocationCount) * (ta / 1e12);
      const sb = b.successRate * Math.sqrt(b.invocationCount) * (tb / 1e12);
      return sb - sa;
    });
    return c.json({ skills: ranked, days });
  });

  /** GET /stats — 单 Skill 聚合统计 */
  app.get('/stats', (c) => {
    const skill = c.req.query('skill');
    if (!skill) {
      return c.json({ error: 'skill query param required' }, 400);
    }
    const days = Number(c.req.query('days')) || 7;
    const agentId = c.req.query('agentId') || undefined;
    return c.json(store.aggregateStats(skill, days, agentId));
  });

  /** GET /recent — 最近 N 条调用（详情展示用） */
  app.get('/recent', (c) => {
    const skill = c.req.query('skill');
    if (!skill) {
      return c.json({ error: 'skill query param required' }, 400);
    }
    const limit = Math.min(Number(c.req.query('limit')) || 10, 100);
    const agentId = c.req.query('agentId') || undefined;
    return c.json({ invocations: store.listRecent(skill, limit, agentId) });
  });

  /** GET /summaries — 最近 N 条 session LLM 摘要 */
  app.get('/summaries', (c) => {
    const skill = c.req.query('skill');
    if (!skill) {
      return c.json({ error: 'skill query param required' }, 400);
    }
    const limit = Math.min(Number(c.req.query('limit')) || 5, 50);
    return c.json({ summaries: store.listSummaries(skill, limit) });
  });

  /** POST /:id/feedback — 用户 👍/👎 回写 */
  app.post('/:id/feedback', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) {
      return c.json({ error: 'invalid id' }, 400);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const b = body as { feedback?: unknown; note?: unknown };
    if (b.feedback !== 1 && b.feedback !== -1) {
      return c.json({ error: 'feedback must be 1 or -1' }, 400);
    }
    const note = typeof b.note === 'string' ? b.note : undefined;

    const ok = store.recordUserFeedback(id, b.feedback, note);
    if (!ok) {
      return c.json({ error: 'usage record not found or update failed' }, 404);
    }
    return c.json({ ok: true });
  });

  return app;
}
