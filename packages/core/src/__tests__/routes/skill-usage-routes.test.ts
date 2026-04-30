/**
 * skill-usage routes 集成测试 — M7 Phase 2
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Hono } from 'hono';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { SkillUsageStore } from '../../skill/skill-usage-store.js';
import { createSkillUsageRoutes } from '../../routes/skill-usage.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', '..', 'infrastructure', 'db', 'migrations');
const MIGRATION_001 = fs.readFileSync(path.join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8');
const MIGRATION_027 = fs.readFileSync(path.join(MIGRATIONS_DIR, '027_skill_usage.sql'), 'utf-8');
const MIGRATION_028 = fs.readFileSync(path.join(MIGRATIONS_DIR, '028_skill_evolution_log.sql'), 'utf-8');
const MIGRATION_037 = fs.readFileSync(path.join(MIGRATIONS_DIR, '037_skill_inline_review.sql'), 'utf-8');

const AGENT_ID = 'agent-a';

async function json(res: Response): Promise<any> {
  return await res.json();
}

describe('skill-usage routes', () => {
  let db: SqliteStore;
  let store: SkillUsageStore;
  let app: Hono;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-skill-usage-routes-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    db = new SqliteStore(path.join(tmpDir, 'test.db'));
    db.exec(MIGRATION_001);
    db.exec(MIGRATION_027);
    db.exec(MIGRATION_028);
    db.exec(MIGRATION_037);
    db.run(`INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)`, AGENT_ID, AGENT_ID, '🤖', 'active');
    store = new SkillUsageStore(db);
    app = new Hono();
    app.route('/skill-usage', createSkillUsageRoutes({ db }));
  });

  afterEach(() => {
    try { db.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /effectiveness — 返回该 Agent 用过的 Skill', async () => {
    for (const skill of ['a', 'b']) {
      store.record({ skillName: skill, agentId: AGENT_ID, sessionKey: 's1', triggerType: 'invoke_skill', executionMode: 'inline', success: true });
    }
    const res = await app.request(`/skill-usage/effectiveness?agentId=${AGENT_ID}&days=7`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.skills).toHaveLength(2);
    expect(body.days).toBe(7);
  });

  it('GET /effectiveness 缺 agentId → 400', async () => {
    const res = await app.request('/skill-usage/effectiveness');
    expect(res.status).toBe(400);
  });

  it('GET /stats — 单 Skill 聚合', async () => {
    for (const success of [true, true, false]) {
      store.record({ skillName: 'x', agentId: AGENT_ID, sessionKey: 's1', triggerType: 'invoke_skill', executionMode: 'inline', success });
    }
    const res = await app.request(`/skill-usage/stats?skill=x&agentId=${AGENT_ID}&days=7`);
    const body = await json(res);
    expect(body.invocationCount).toBe(3);
    expect(body.successRate).toBeCloseTo(2 / 3);
  });

  it('GET /recent — 最近调用（按时间倒序）', async () => {
    for (let i = 0; i < 3; i++) {
      store.record({ skillName: 'x', agentId: AGENT_ID, sessionKey: 's1', triggerType: 'invoke_skill', executionMode: 'inline', success: true });
    }
    const res = await app.request(`/skill-usage/recent?skill=x&agentId=${AGENT_ID}&limit=2`);
    const body = await json(res);
    expect(body.invocations).toHaveLength(2);
  });

  it('GET /summaries — 按 skill 查摘要列表', async () => {
    store.saveSummary({
      skillName: 'x', sessionKey: 's1', agentId: AGENT_ID,
      summaryText: '摘要 v1', invocationCount: 3, successRate: 0.67,
    });
    const res = await app.request('/skill-usage/summaries?skill=x');
    const body = await json(res);
    expect(body.summaries).toHaveLength(1);
    expect(body.summaries[0].summaryText).toBe('摘要 v1');
  });

  it('POST /:id/feedback — 写入反馈', async () => {
    store.record({ skillName: 'x', agentId: AGENT_ID, sessionKey: 's1', triggerType: 'invoke_skill', executionMode: 'inline', success: true });
    const row = store.listRecent('x', 1, AGENT_ID)[0];
    const res = await app.request(`/skill-usage/${row.id}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback: 1, note: 'nice' }),
    });
    expect(res.status).toBe(200);
    const updated = store.listRecent('x', 1, AGENT_ID)[0];
    expect(updated.userFeedback).toBe(1);
    expect(updated.feedbackNote).toBe('nice');
  });

  it('POST /:id/feedback — 非法 feedback 值 → 400', async () => {
    const res = await app.request('/skill-usage/1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback: 99 }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /:id/feedback — 不存在的 id → 404', async () => {
    const res = await app.request('/skill-usage/99999/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback: 1 }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /:id/feedback — 非法 JSON → 400', async () => {
    const res = await app.request('/skill-usage/1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });
});
