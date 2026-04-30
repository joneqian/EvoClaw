/**
 * skill-evolution routes + rollback 端到端测试 — M7.1
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Hono } from 'hono';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { createSkillEvolutionRoutes } from '../../routes/skill-evolution.js';
import { computeSkillHash, upsertManifestEntry } from '../../skill/skill-manifest.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', '..', 'infrastructure', 'db', 'migrations');
const MIGRATION_001 = fs.readFileSync(path.join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8');
const MIGRATION_027 = fs.readFileSync(path.join(MIGRATIONS_DIR, '027_skill_usage.sql'), 'utf-8');
const MIGRATION_028 = fs.readFileSync(path.join(MIGRATIONS_DIR, '028_skill_evolution_log.sql'), 'utf-8');
const MIGRATION_029 = fs.readFileSync(path.join(MIGRATIONS_DIR, '029_skill_evolution_content.sql'), 'utf-8');
const MIGRATION_037 = fs.readFileSync(path.join(MIGRATIONS_DIR, '037_skill_inline_review.sql'), 'utf-8');

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function validSkill(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: test\n---\n\n${body}\n`;
}

function writeSkillToDisk(baseDir: string, name: string, content: string): void {
  const dir = path.join(baseDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf-8');
}

describe('skill-evolution routes', () => {
  let db: SqliteStore;
  let app: Hono;
  let tmpDir: string;
  let skillsDir: string;

  beforeEach(() => {
    tmpDir = mkTmpDir('evolution-routes-');
    skillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    db = new SqliteStore(path.join(tmpDir, 'test.db'));
    db.exec(MIGRATION_001);
    db.exec(MIGRATION_027);
    db.exec(MIGRATION_028);
    db.exec(MIGRATION_029);
    db.exec(MIGRATION_037);
    app = new Hono();
    app.route('/skill-evolution', createSkillEvolutionRoutes({ db, userSkillsDir: skillsDir }));
  });

  afterEach(() => {
    try { db.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function insertRefineLog(skill: string, prevContent: string, newContent: string): number {
    const result = db.run(
      `INSERT INTO skill_evolution_log (
         skill_name, decision, reasoning, evidence_count,
         previous_hash, new_hash, previous_content, new_content, duration_ms
       ) VALUES (?, 'refine', ?, 3, ?, ?, ?, ?, 100)`,
      skill, 'improve via evolver',
      computeSkillHash(prevContent), computeSkillHash(newContent),
      prevContent, newContent,
    );
    return Number(result.lastInsertRowid);
  }

  it('GET /log — 列表含所有记录', async () => {
    insertRefineLog('s1', validSkill('s1', 'v1'), validSkill('s1', 'v2'));
    insertRefineLog('s2', validSkill('s2', 'v1'), validSkill('s2', 'v2'));
    const res = await app.request('/skill-evolution/log');
    expect(res.status).toBe(200);
    const body = await res.json() as { entries: Array<{ skillName: string }> };
    expect(body.entries).toHaveLength(2);
  });

  it('GET /log?skill=X — 按 skill 过滤', async () => {
    insertRefineLog('alpha', validSkill('alpha', 'a'), validSkill('alpha', 'b'));
    insertRefineLog('beta', validSkill('beta', 'a'), validSkill('beta', 'b'));
    const res = await app.request('/skill-evolution/log?skill=alpha');
    const body = await res.json() as { entries: Array<{ skillName: string }> };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].skillName).toBe('alpha');
  });

  it('GET /log/:id — 详情含 previous/new content', async () => {
    const id = insertRefineLog('x', validSkill('x', 'old'), validSkill('x', 'new'));
    const res = await app.request(`/skill-evolution/log/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { entry: { previousContent: string; newContent: string } };
    expect(body.entry.previousContent).toContain('old');
    expect(body.entry.newContent).toContain('new');
  });

  it('GET /log/:id — 不存在 → 404', async () => {
    const res = await app.request('/skill-evolution/log/99999');
    expect(res.status).toBe(404);
  });

  it('GET /log/:id — 非法 id → 400', async () => {
    const res = await app.request('/skill-evolution/log/not-a-number');
    expect(res.status).toBe(400);
  });

  it('P1-B: GET /log 暴露 triggerSource 字段', async () => {
    insertRefineLog('s1', validSkill('s1', 'a'), validSkill('s1', 'b'));
    db.run(
      `INSERT INTO skill_evolution_log (
         skill_name, decision, reasoning, evidence_count, trigger_source, duration_ms
       ) VALUES ('s2', 'skip', 'inline run', 0, 'inline', 50)`,
    );
    const res = await app.request('/skill-evolution/log');
    const body = await res.json() as { entries: Array<{ skillName: string; triggerSource: string }> };
    const m = new Map(body.entries.map(e => [e.skillName, e.triggerSource]));
    expect(m.get('s1')).toBe('cron');
    expect(m.get('s2')).toBe('inline');
  });

  it('P1-B: GET /log/:id 对 inline 记录关联 conversational_feedback', async () => {
    // 先写一条 skill_usage（含 conversational_feedback）
    db.run(
      `INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)`,
      'agent-1', 'agent-1', '🤖', 'active',
    );
    db.run(
      `INSERT INTO skill_usage (
         skill_name, agent_id, session_key,
         trigger_type, execution_mode, success, conversational_feedback
       ) VALUES ('arxiv', 'agent-1', 'sk-1', 'invoke_skill', 'inline', 0, '不要这样')`,
    );
    // inline 进化日志
    const res1 = db.run(
      `INSERT INTO skill_evolution_log (
         skill_name, decision, reasoning, evidence_count,
         previous_content, new_content, trigger_source, duration_ms
       ) VALUES ('arxiv', 'refine', 'fix from feedback', 1, ?, ?, 'inline', 100)`,
      validSkill('arxiv', 'old'),
      validSkill('arxiv', 'new'),
    );
    const id = Number(res1.lastInsertRowid);

    const res = await app.request(`/skill-evolution/log/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { entry: { triggerSource: string; conversationalFeedback?: string | null } };
    expect(body.entry.triggerSource).toBe('inline');
    expect(body.entry.conversationalFeedback).toBe('不要这样');
  });

  it('P1-B: cron 记录详情不返回 conversationalFeedback', async () => {
    const id = insertRefineLog('cron-only', validSkill('cron-only', 'a'), validSkill('cron-only', 'b'));
    const res = await app.request(`/skill-evolution/log/${id}`);
    const body = await res.json() as { entry: { triggerSource: string; conversationalFeedback?: string | null } };
    expect(body.entry.triggerSource).toBe('cron');
    // 未进入 inline 分支 → 字段缺省
    expect(body.entry.conversationalFeedback ?? null).toBeNull();
  });

  describe('POST /log/:id/rollback', () => {
    it('合法 refine 记录 → 回滚成功 + 磁盘恢复 + rolled_back=1', async () => {
      const prev = validSkill('roll', 'original');
      const next = validSkill('roll', 'modified');
      // 模拟磁盘当前状态为 refine 后的
      writeSkillToDisk(skillsDir, 'roll', next);
      upsertManifestEntry(skillsDir, {
        name: 'roll', sha256: computeSkillHash(next),
        source: 'agent-created', createdAt: '2026-01-01T00:00:00Z',
      });
      const id = insertRefineLog('roll', prev, next);

      const res = await app.request(`/skill-evolution/log/${id}/rollback`, { method: 'POST' });
      expect(res.status).toBe(200);

      // 磁盘恢复为 prev
      const onDisk = fs.readFileSync(path.join(skillsDir, 'roll', 'SKILL.md'), 'utf-8');
      expect(onDisk).toContain('original');

      // rolled_back 标记
      const row = db.get<{ rolledBack: number }>(
        `SELECT rolled_back AS rolledBack FROM skill_evolution_log WHERE id = ?`,
        id,
      );
      expect(row?.rolledBack).toBe(1);

      // 追加了 audit 条目
      const auditRow = db.get<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM skill_evolution_log WHERE reasoning LIKE ?`,
        `%rollback of #${id}%`,
      );
      expect(auditRow?.cnt).toBe(1);
    });

    it('decision=create → 拒绝回滚', async () => {
      db.run(
        `INSERT INTO skill_evolution_log (skill_name, decision, reasoning, evidence_count, previous_content, new_content)
         VALUES ('new-skill', 'create', 'new workflow', 2, NULL, ?)`,
        validSkill('new-skill', 'body'),
      );
      const id = Number((db.get<{ id: number }>(`SELECT id FROM skill_evolution_log ORDER BY id DESC LIMIT 1`))?.id);
      const res = await app.request(`/skill-evolution/log/${id}/rollback`, { method: 'POST' });
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("decision='create'");
    });

    it('decision=skip → 拒绝回滚', async () => {
      db.run(
        `INSERT INTO skill_evolution_log (skill_name, decision, reasoning, evidence_count)
         VALUES ('s', 'skip', 'no action', 1)`,
      );
      const id = Number((db.get<{ id: number }>(`SELECT id FROM skill_evolution_log ORDER BY id DESC LIMIT 1`))?.id);
      const res = await app.request(`/skill-evolution/log/${id}/rollback`, { method: 'POST' });
      expect(res.status).toBe(400);
    });

    it('rolled_back=1 的记录 → 拒绝重复回滚', async () => {
      const prev = validSkill('dupe', 'a');
      const next = validSkill('dupe', 'b');
      writeSkillToDisk(skillsDir, 'dupe', next);
      upsertManifestEntry(skillsDir, {
        name: 'dupe', sha256: computeSkillHash(next), source: 'agent-created', createdAt: '2026-01-01',
      });
      const id = insertRefineLog('dupe', prev, next);

      const res1 = await app.request(`/skill-evolution/log/${id}/rollback`, { method: 'POST' });
      expect(res1.status).toBe(200);

      const res2 = await app.request(`/skill-evolution/log/${id}/rollback`, { method: 'POST' });
      expect(res2.status).toBe(400);
      const body = await res2.json() as { error: string };
      expect(body.error).toContain('already rolled back');
    });

    it('previous_content 为 NULL（legacy 记录）→ 400', async () => {
      db.run(
        `INSERT INTO skill_evolution_log (skill_name, decision, reasoning, evidence_count, previous_content)
         VALUES ('legacy', 'refine', 'old record', 1, NULL)`,
      );
      const id = Number((db.get<{ id: number }>(`SELECT id FROM skill_evolution_log ORDER BY id DESC LIMIT 1`))?.id);
      const res = await app.request(`/skill-evolution/log/${id}/rollback`, { method: 'POST' });
      expect(res.status).toBe(400);
    });

    it('非法 id → 400', async () => {
      const res = await app.request('/skill-evolution/log/bad/rollback', { method: 'POST' });
      expect(res.status).toBe(400);
    });
  });
});
