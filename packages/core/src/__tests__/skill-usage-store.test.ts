/**
 * SkillUsageStore 单元测试 — M7 Phase 2
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { SkillUsageStore, sanitizeErrorSummary } from '../skill/skill-usage-store.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations');
const MIGRATION_001 = fs.readFileSync(path.join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8');
const MIGRATION_027 = fs.readFileSync(path.join(MIGRATIONS_DIR, '027_skill_usage.sql'), 'utf-8');
const MIGRATION_028 = fs.readFileSync(path.join(MIGRATIONS_DIR, '028_skill_evolution_log.sql'), 'utf-8');
const MIGRATION_037 = fs.readFileSync(path.join(MIGRATIONS_DIR, '037_skill_inline_review.sql'), 'utf-8');

const AGENT_A = 'agent-a';
const AGENT_B = 'agent-b';
const SESSION_1 = 'session-1';
const SESSION_2 = 'session-2';

describe('SkillUsageStore', () => {
  let db: SqliteStore;
  let usage: SkillUsageStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-skill-usage-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    db = new SqliteStore(path.join(tmpDir, 'test.db'));
    db.exec(MIGRATION_001);
    db.exec(MIGRATION_027);
    db.exec(MIGRATION_028);
    db.exec(MIGRATION_037);
    for (const id of [AGENT_A, AGENT_B]) {
      db.run(`INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)`, id, id, '🤖', 'active');
    }
    usage = new SkillUsageStore(db);
  });

  afterEach(() => {
    try { db.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('record + queries', () => {
    it('record 写入成功', () => {
      usage.record({
        skillName: 'arxiv',
        agentId: AGENT_A,
        sessionKey: SESSION_1,
        triggerType: 'invoke_skill',
        executionMode: 'inline',
        success: true,
        durationMs: 42,
      });
      const rows = usage.listRecent('arxiv', 10, AGENT_A);
      expect(rows).toHaveLength(1);
      expect(rows[0].success).toBe(1);
      expect(rows[0].executionMode).toBe('inline');
      expect(rows[0].durationMs).toBe(42);
    });

    it('record 失败静默（未抛异常）— 即使表不存在也不崩', () => {
      db.exec('DROP TABLE skill_usage');
      expect(() => usage.record({
        skillName: 'x', agentId: AGENT_A, sessionKey: SESSION_1,
        triggerType: 'invoke_skill', executionMode: 'inline', success: true,
      })).not.toThrow();
    });

    it('aggregateStats 多条聚合', () => {
      for (const success of [true, true, false, true, false]) {
        usage.record({
          skillName: 'x', agentId: AGENT_A, sessionKey: SESSION_1,
          triggerType: 'invoke_skill', executionMode: 'inline',
          success, durationMs: 10,
        });
      }
      const stats = usage.aggregateStats('x', 7, AGENT_A);
      expect(stats.invocationCount).toBe(5);
      expect(stats.successCount).toBe(3);
      expect(stats.failureCount).toBe(2);
      expect(stats.successRate).toBeCloseTo(0.6);
      expect(stats.avgDurationMs).toBe(10);
    });

    it('aggregateStats 按 agentId 隔离', () => {
      usage.record({ skillName: 'y', agentId: AGENT_A, sessionKey: SESSION_1, triggerType: 'invoke_skill', executionMode: 'inline', success: true });
      usage.record({ skillName: 'y', agentId: AGENT_B, sessionKey: SESSION_2, triggerType: 'invoke_skill', executionMode: 'inline', success: false });

      expect(usage.aggregateStats('y', 7, AGENT_A).successRate).toBe(1);
      expect(usage.aggregateStats('y', 7, AGENT_B).successRate).toBe(0);
    });

    it('listSkillsInSession 返回去重的 Skill 列表', () => {
      usage.record({ skillName: 'a', agentId: AGENT_A, sessionKey: SESSION_1, triggerType: 'invoke_skill', executionMode: 'inline', success: true });
      usage.record({ skillName: 'a', agentId: AGENT_A, sessionKey: SESSION_1, triggerType: 'invoke_skill', executionMode: 'inline', success: true });
      usage.record({ skillName: 'b', agentId: AGENT_A, sessionKey: SESSION_1, triggerType: 'invoke_skill', executionMode: 'fork', success: false });
      const skills = usage.listSkillsInSession(SESSION_1).sort();
      expect(skills).toEqual(['a', 'b']);
    });

    it('effectivenessForAgent 返回 Agent 的所有 Skill', () => {
      usage.record({ skillName: 'a', agentId: AGENT_A, sessionKey: SESSION_1, triggerType: 'invoke_skill', executionMode: 'inline', success: true });
      usage.record({ skillName: 'b', agentId: AGENT_A, sessionKey: SESSION_1, triggerType: 'invoke_skill', executionMode: 'inline', success: false });
      const result = usage.effectivenessForAgent(AGENT_A, 7);
      expect(result).toHaveLength(2);
      const names = result.map(r => r.skillName).sort();
      expect(names).toEqual(['a', 'b']);
    });
  });

  describe('recordUserFeedback', () => {
    it('更新现有记录', () => {
      usage.record({ skillName: 'a', agentId: AGENT_A, sessionKey: SESSION_1, triggerType: 'invoke_skill', executionMode: 'inline', success: true });
      const row = usage.listRecent('a', 1, AGENT_A)[0];
      const ok = usage.recordUserFeedback(row.id, 1, '很好用');
      expect(ok).toBe(true);
      const updated = usage.listRecent('a', 1, AGENT_A)[0];
      expect(updated.userFeedback).toBe(1);
      expect(updated.feedbackNote).toBe('很好用');
    });

    it('不存在的 id → 返回 false', () => {
      const ok = usage.recordUserFeedback(99999, 1);
      expect(ok).toBe(false);
    });

    it('反馈计数聚合到 aggregateStats', () => {
      for (let i = 0; i < 3; i++) {
        usage.record({ skillName: 'a', agentId: AGENT_A, sessionKey: SESSION_1, triggerType: 'invoke_skill', executionMode: 'inline', success: true });
      }
      const rows = usage.listRecent('a', 10, AGENT_A);
      usage.recordUserFeedback(rows[0].id, 1);
      usage.recordUserFeedback(rows[1].id, 1);
      usage.recordUserFeedback(rows[2].id, -1);
      const stats = usage.aggregateStats('a', 7, AGENT_A);
      expect(stats.positiveFeedbackCount).toBe(2);
      expect(stats.negativeFeedbackCount).toBe(1);
    });
  });

  describe('saveSummary + listSummaries', () => {
    it('写入后可按 skill_name 查询', () => {
      usage.saveSummary({
        skillName: 'arxiv',
        sessionKey: SESSION_1,
        agentId: AGENT_A,
        summaryText: '测试摘要内容',
        invocationCount: 5,
        successRate: 0.8,
        toolsUsed: ['web_search', 'read'],
        modelUsed: 'gpt-4o-mini',
      });
      const summaries = usage.listSummaries('arxiv', 5);
      expect(summaries).toHaveLength(1);
      expect(summaries[0].summaryText).toBe('测试摘要内容');
      expect(summaries[0].toolsUsed).toBe('["web_search","read"]');
      expect(summaries[0].modelUsed).toBe('gpt-4o-mini');
    });

    it('listSummaries 按时间倒序 + limit 截断', () => {
      for (let i = 0; i < 3; i++) {
        usage.saveSummary({
          skillName: 'x',
          sessionKey: `s-${i}`,
          agentId: AGENT_A,
          summaryText: `v${i}`,
          invocationCount: 2,
          successRate: 1,
        });
      }
      const summaries = usage.listSummaries('x', 2);
      expect(summaries).toHaveLength(2);
    });
  });

  describe('P1-B Inline Review — conversational_feedback + 限速', () => {
    function recordTwo(skillName: string): void {
      usage.record({
        skillName, agentId: AGENT_A, sessionKey: SESSION_1,
        triggerType: 'invoke_skill', executionMode: 'inline', success: true,
      });
      usage.record({
        skillName, agentId: AGENT_A, sessionKey: SESSION_1,
        triggerType: 'invoke_skill', executionMode: 'inline', success: false,
      });
    }

    it('recordConversationalFeedback 写入到该 session+skill 的最新一条', () => {
      recordTwo('arxiv');
      const ok = usage.recordConversationalFeedback({
        skillName: 'arxiv',
        sessionKey: SESSION_1,
        feedback: '不要这样',
      });
      expect(ok).toBe(true);

      const rows = usage.listBySessionAndSkill(SESSION_1, 'arxiv');
      expect(rows).toHaveLength(2);
      // 最新一条（最后写入）才有 conversational_feedback
      const latest = rows[rows.length - 1];
      const earlier = rows[0];
      expect((latest as { conversationalFeedback?: string }).conversationalFeedback ?? null).toBe('不要这样');
      expect((earlier as { conversationalFeedback?: string }).conversationalFeedback ?? null).toBeNull();
    });

    it('recordConversationalFeedback 截断到 200 字', () => {
      recordTwo('arxiv');
      const long = 'x'.repeat(500);
      const ok = usage.recordConversationalFeedback({
        skillName: 'arxiv',
        sessionKey: SESSION_1,
        feedback: long,
      });
      expect(ok).toBe(true);
      const rows = usage.listBySessionAndSkill(SESSION_1, 'arxiv');
      const latest = rows[rows.length - 1];
      const stored = (latest as { conversationalFeedback?: string }).conversationalFeedback ?? '';
      expect(stored.length).toBe(200);
    });

    it('recordConversationalFeedback 找不到 session+skill → false', () => {
      const ok = usage.recordConversationalFeedback({
        skillName: 'nonexistent',
        sessionKey: SESSION_1,
        feedback: '不要这样',
      });
      expect(ok).toBe(false);
    });

    it('markInlineReviewTriggered + getLastInlineReviewAt 配套', () => {
      recordTwo('arxiv');
      expect(usage.getLastInlineReviewAt('arxiv')).toBeNull();

      const before = new Date().toISOString();
      const ok = usage.markInlineReviewTriggered({
        skillName: 'arxiv',
        sessionKey: SESSION_1,
      });
      expect(ok).toBe(true);
      const last = usage.getLastInlineReviewAt('arxiv');
      expect(last).not.toBeNull();
      expect(last! >= before).toBe(true);
    });

    it('markInlineReviewTriggered 找不到 → false', () => {
      const ok = usage.markInlineReviewTriggered({
        skillName: 'absent',
        sessionKey: SESSION_1,
      });
      expect(ok).toBe(false);
    });

    it('getLastInlineReviewAt 跨 session 取最大值', () => {
      recordTwo('arxiv');
      // 同 skill 不同 session
      usage.record({
        skillName: 'arxiv', agentId: AGENT_A, sessionKey: SESSION_2,
        triggerType: 'invoke_skill', executionMode: 'inline', success: true,
      });

      // session_1 旧标记
      usage.markInlineReviewTriggered({ skillName: 'arxiv', sessionKey: SESSION_1 });
      const t1 = usage.getLastInlineReviewAt('arxiv');
      expect(t1).not.toBeNull();

      // session_2 新标记 — 最新值应大于等于 t1
      usage.markInlineReviewTriggered({ skillName: 'arxiv', sessionKey: SESSION_2 });
      const t2 = usage.getLastInlineReviewAt('arxiv');
      expect(t2).not.toBeNull();
      expect(t2! >= t1!).toBe(true);
    });

    it('record 失败静默：表不存在时新方法都不抛', () => {
      db.exec('DROP TABLE skill_usage');
      expect(() => usage.recordConversationalFeedback({
        skillName: 'x', sessionKey: SESSION_1, feedback: 'x',
      })).not.toThrow();
      expect(() => usage.markInlineReviewTriggered({
        skillName: 'x', sessionKey: SESSION_1,
      })).not.toThrow();
      expect(() => usage.getLastInlineReviewAt('x')).not.toThrow();
    });
  });

  describe('listRecentInSession（Phase 4 hook 用）', () => {
    it('返回 session 内 N 秒内调用，按时间倒序', () => {
      usage.record({
        skillName: 'old', agentId: AGENT_A, sessionKey: SESSION_1,
        triggerType: 'invoke_skill', executionMode: 'inline', success: true,
      });
      usage.record({
        skillName: 'new', agentId: AGENT_A, sessionKey: SESSION_1,
        triggerType: 'invoke_skill', executionMode: 'inline', success: true,
      });
      const rows = usage.listRecentInSession(SESSION_1, 60);
      expect(rows.length).toBe(2);
      // 倒序：new 在前
      expect(rows[0].skillName).toBe('new');
    });

    it('过滤其它 session', () => {
      usage.record({
        skillName: 'a', agentId: AGENT_A, sessionKey: SESSION_1,
        triggerType: 'invoke_skill', executionMode: 'inline', success: true,
      });
      usage.record({
        skillName: 'b', agentId: AGENT_A, sessionKey: SESSION_2,
        triggerType: 'invoke_skill', executionMode: 'inline', success: true,
      });
      const rows = usage.listRecentInSession(SESSION_1, 60);
      expect(rows.map(r => r.skillName)).toEqual(['a']);
    });

    it('表不存在 → 返回空数组（不抛）', () => {
      db.exec('DROP TABLE skill_usage');
      const rows = usage.listRecentInSession(SESSION_1, 60);
      expect(rows).toEqual([]);
    });
  });
});

describe('sanitizeErrorSummary', () => {
  it('剥离 sk- 开头密钥', () => {
    const s = sanitizeErrorSummary('Error: sk-abc123def456ghi789jkl unauthorized');
    expect(s).toContain('sk-***');
    expect(s).not.toContain('sk-abc123');
  });

  it('剥离 Bearer token', () => {
    const s = sanitizeErrorSummary('Authorization: Bearer ey.JlongtokenABCDEF failed');
    expect(s).toContain('Bearer ***');
    expect(s).not.toContain('longtokenABCDEF');
  });

  it('压缩空白 + 裁剪长度', () => {
    const longMsg = 'x'.repeat(500);
    const s = sanitizeErrorSummary(longMsg, 200);
    expect(s.length).toBe(200);
  });
});
