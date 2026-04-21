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
