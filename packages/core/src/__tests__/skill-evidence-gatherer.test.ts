/**
 * skill-evidence-gatherer 单测
 *
 * 重点覆盖 recentConversationalFeedbacks 抽取（A+C 后补）：
 * - 去重 / cap 3 / 过滤空值 / 按时间倒序
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { SkillUsageStore } from '../skill/skill-usage-store.js';
import { gatherEvidence } from '../skill/skill-evidence-gatherer.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations');
const MIGRATION_FILES = [
  '001_initial.sql',
  '027_skill_usage.sql',
  '028_skill_evolution_log.sql',
  '037_skill_inline_review.sql',
];

function loadMigrationsInto(store: SqliteStore): void {
  for (const f of MIGRATION_FILES) {
    store.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8'));
  }
}

const AGENT_ID = 'agent-test';
const SKILL = 'test-skill';
const SESSION = 'session-1';

describe('gatherEvidence — recentConversationalFeedbacks', () => {
  let db: SqliteStore;
  let usage: SkillUsageStore;
  let tmpDir: string;
  let userSkillsDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evidence-gatherer-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    db = new SqliteStore(path.join(tmpDir, 'test.db'));
    loadMigrationsInto(db);
    db.run(`INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)`, AGENT_ID, AGENT_ID, '🤖', 'active');
    usage = new SkillUsageStore(db);

    // 给 gatherEvidence 一份 SKILL.md
    userSkillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(path.join(userSkillsDir, SKILL), { recursive: true });
    fs.writeFileSync(path.join(userSkillsDir, SKILL, 'SKILL.md'),
      '---\nname: test-skill\ndescription: t\n---\nbody', 'utf-8');
  });

  afterEach(() => {
    try { db.close(); } catch { /* noop */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function recordWithFeedback(feedback: string | null) {
    usage.record({
      skillName: SKILL, agentId: AGENT_ID, sessionKey: SESSION,
      triggerType: 'invoke_skill', executionMode: 'inline', success: true,
    });
    if (feedback) {
      usage.recordConversationalFeedback({
        skillName: SKILL, sessionKey: SESSION, feedback,
      });
    }
  }

  it('无任何 conversational_feedback → 数组空', () => {
    recordWithFeedback(null);
    recordWithFeedback(null);
    const ev = gatherEvidence({ skillName: SKILL, store: usage, userSkillsDir });
    expect(ev.recentConversationalFeedbacks).toEqual([]);
  });

  it('5 条不同反馈 → cap 3 + 最新优先', () => {
    // 注意：recordConversationalFeedback 写到该 session+skill 最新一条 invocation 上，
    // 所以每次 record 后立刻 recordFeedback 把当前 invocation 标记为有反馈
    recordWithFeedback('反馈 1（最旧）');
    recordWithFeedback('反馈 2');
    recordWithFeedback('反馈 3');
    recordWithFeedback('反馈 4');
    recordWithFeedback('反馈 5（最新）');

    const ev = gatherEvidence({ skillName: SKILL, store: usage, userSkillsDir });
    expect(ev.recentConversationalFeedbacks).toHaveLength(3);
    // 最新的 3 条
    expect(ev.recentConversationalFeedbacks).toEqual([
      '反馈 5（最新）', '反馈 4', '反馈 3',
    ]);
  });

  it('重复反馈文本去重（同文本只保留 1 条）', () => {
    recordWithFeedback('完全不对');
    recordWithFeedback('完全不对');
    recordWithFeedback('搞砸了');
    recordWithFeedback('完全不对');

    const ev = gatherEvidence({ skillName: SKILL, store: usage, userSkillsDir });
    expect(ev.recentConversationalFeedbacks.length).toBeLessThanOrEqual(2);
    // 含两个不同文本，按时间倒序
    expect(ev.recentConversationalFeedbacks[0]).toBe('完全不对');
    expect(ev.recentConversationalFeedbacks[1]).toBe('搞砸了');
  });

  it('混合：有反馈和无反馈穿插 → 只取有反馈的，按时间倒序', () => {
    recordWithFeedback(null);
    recordWithFeedback('A');
    recordWithFeedback(null);
    recordWithFeedback('B');
    recordWithFeedback(null);

    const ev = gatherEvidence({ skillName: SKILL, store: usage, userSkillsDir });
    // 注意：listRecent 限制了 usagesLimit*2 条，且 B 比 A 新
    expect(ev.recentConversationalFeedbacks).toContain('A');
    expect(ev.recentConversationalFeedbacks).toContain('B');
    expect(ev.recentConversationalFeedbacks[0]).toBe('B'); // 最新
  });
});
