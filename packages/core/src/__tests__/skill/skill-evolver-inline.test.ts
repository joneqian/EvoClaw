/**
 * P1-B Phase 3: Inline Evolver 端到端测试
 *
 * 覆盖：
 * - 强信号 → refine SKILL.md → 写 evolution_log（trigger_source='inline'）
 * - 信号=none → 不触发
 * - 防递归：cron sessionKey → 不触发
 * - 限速：10min 内第二次 → 不触发
 * - SKILL.md 缺失 / 用户手改 → 静默 skip
 * - LLM 失败 → skip + 记 log，不抛异常
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { SkillUsageStore } from '../../skill/skill-usage-store.js';
import { upsertManifestEntry, computeSkillHash } from '../../skill/skill-manifest.js';
import { runInlineReview } from '../../skill/skill-evolver-inline.js';
import type { SignalDetectionResult } from '../../skill/feedback-signal-detector.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', '..', 'infrastructure', 'db', 'migrations');
const MIGRATION_001 = fs.readFileSync(path.join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8');
const MIGRATION_027 = fs.readFileSync(path.join(MIGRATIONS_DIR, '027_skill_usage.sql'), 'utf-8');
const MIGRATION_028 = fs.readFileSync(path.join(MIGRATIONS_DIR, '028_skill_evolution_log.sql'), 'utf-8');
const MIGRATION_029 = fs.readFileSync(path.join(MIGRATIONS_DIR, '029_skill_evolution_content.sql'), 'utf-8');
const MIGRATION_037 = fs.readFileSync(path.join(MIGRATIONS_DIR, '037_skill_inline_review.sql'), 'utf-8');

const AGENT_ID = 'agent-x';
const SESSION_KEY = 'agent:agent-x:wechat:dm:peer-1';

function strongSignal(skillName: string, evidence = '不要这样'): SignalDetectionResult {
  return {
    signal: 'strong',
    skillName,
    evidence,
    matchedPattern: 'reject-this-way',
  };
}

function writeSkill(dir: string, name: string, body: string): string {
  const skillDir = path.join(dir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  const content = `---\nname: ${name}\ndescription: test\n---\n\n${body}\n`;
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
  return content;
}

describe('runInlineReview', () => {
  let db: SqliteStore;
  let store: SkillUsageStore;
  let userSkillsDir: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-evolver-'));
    userSkillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(userSkillsDir, { recursive: true });
    db = new SqliteStore(path.join(tmpDir, 'test.db'));
    db.exec(MIGRATION_001);
    db.exec(MIGRATION_027);
    db.exec(MIGRATION_028);
    db.exec(MIGRATION_029);
    db.exec(MIGRATION_037);
    db.run(`INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)`, AGENT_ID, AGENT_ID, '🤖', 'active');
    store = new SkillUsageStore(db);
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedUsage(skillName: string, sessionKey = SESSION_KEY, success = true) {
    store.record({
      skillName, agentId: AGENT_ID, sessionKey,
      triggerType: 'invoke_skill', executionMode: 'inline', success,
    });
  }

  function seedSkillWithManifest(name: string, body: string): string {
    const content = writeSkill(userSkillsDir, name, body);
    upsertManifestEntry(userSkillsDir, {
      name, sha256: computeSkillHash(content),
      source: 'bundled', createdAt: '2026-01-01T00:00:00Z',
    });
    return content;
  }

  it('强信号 → refine SKILL.md → 写 inline 日志', async () => {
    seedSkillWithManifest('arxiv', 'old marker');
    seedUsage('arxiv', SESSION_KEY, false);

    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      decision: 'refine',
      reasoning: 'user said no',
      changes: { patches: [{ old: 'old marker', new: 'new marker' }] },
    }));

    const result = await runInlineReview({
      db, store, userSkillsDir,
      signal: strongSignal('arxiv'),
      sessionKey: SESSION_KEY,
      llmCall,
    });

    expect(result.triggered).toBe(true);
    expect(result.decision).toBe('refine');
    expect(llmCall).toHaveBeenCalledTimes(1);

    const updated = fs.readFileSync(path.join(userSkillsDir, 'arxiv', 'SKILL.md'), 'utf-8');
    expect(updated).toContain('new marker');
    expect(updated).not.toContain('old marker');

    const logs = db.all<{ decision: string; triggerSource: string; reasoning: string }>(
      `SELECT decision, trigger_source AS triggerSource, reasoning FROM skill_evolution_log WHERE skill_name = ?`,
      'arxiv',
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].decision).toBe('refine');
    expect(logs[0].triggerSource).toBe('inline');
  });

  it('signal=none → 不触发任何动作', async () => {
    seedSkillWithManifest('arxiv', 'body');
    seedUsage('arxiv', SESSION_KEY);
    const llmCall = vi.fn();
    const result = await runInlineReview({
      db, store, userSkillsDir,
      signal: { signal: 'none' },
      sessionKey: SESSION_KEY,
      llmCall,
    });
    expect(result.triggered).toBe(false);
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('防递归：cron sessionKey → 不触发', async () => {
    seedSkillWithManifest('arxiv', 'body');
    seedUsage('arxiv', SESSION_KEY);
    const llmCall = vi.fn();
    const result = await runInlineReview({
      db, store, userSkillsDir,
      signal: strongSignal('arxiv'),
      sessionKey: 'agent:agent-x:cron:inline:abc123',
      llmCall,
    });
    expect(result.triggered).toBe(false);
    expect(result.reason).toContain('recursion');
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('限速：10min 内第二次 → 不触发', async () => {
    seedSkillWithManifest('arxiv', 'body');
    seedUsage('arxiv', SESSION_KEY, false);

    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      decision: 'skip',
      reasoning: 'no change',
    }));

    // 第一次正常触发
    const r1 = await runInlineReview({
      db, store, userSkillsDir,
      signal: strongSignal('arxiv'),
      sessionKey: SESSION_KEY,
      llmCall,
    });
    expect(r1.triggered).toBe(true);
    expect(llmCall).toHaveBeenCalledTimes(1);

    // 第二次立即调（默认窗口 10min 内）
    const r2 = await runInlineReview({
      db, store, userSkillsDir,
      signal: strongSignal('arxiv'),
      sessionKey: SESSION_KEY,
      llmCall,
    });
    expect(r2.triggered).toBe(false);
    expect(r2.reason).toContain('rate limit');
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('限速窗口可配置：rateLimitMinutes=0 → 总能触发', async () => {
    seedSkillWithManifest('arxiv', 'body');
    seedUsage('arxiv', SESSION_KEY, false);

    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      decision: 'skip', reasoning: 'no change',
    }));

    await runInlineReview({
      db, store, userSkillsDir,
      signal: strongSignal('arxiv'),
      sessionKey: SESSION_KEY, llmCall, rateLimitMinutes: 0,
    });
    const r2 = await runInlineReview({
      db, store, userSkillsDir,
      signal: strongSignal('arxiv'),
      sessionKey: SESSION_KEY, llmCall, rateLimitMinutes: 0,
    });
    expect(r2.triggered).toBe(true);
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('SKILL.md 缺失 → 静默 skip（不抛异常）', async () => {
    seedUsage('ghost', SESSION_KEY);
    const llmCall = vi.fn();
    const result = await runInlineReview({
      db, store, userSkillsDir,
      signal: strongSignal('ghost'),
      sessionKey: SESSION_KEY, llmCall,
    });
    expect(result.triggered).toBe(false);
    expect(result.reason).toContain('SKILL.md');
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('用户手改过 → 静默 skip', async () => {
    writeSkill(userSkillsDir, 'usr-edited', 'body');
    upsertManifestEntry(userSkillsDir, {
      name: 'usr-edited', sha256: 'FAKE-OLD-HASH',
      source: 'bundled', createdAt: '2026-01-01T00:00:00Z',
    });
    seedUsage('usr-edited', SESSION_KEY);

    const llmCall = vi.fn();
    const result = await runInlineReview({
      db, store, userSkillsDir,
      signal: strongSignal('usr-edited'),
      sessionKey: SESSION_KEY, llmCall,
    });
    expect(result.triggered).toBe(false);
    expect(result.reason).toContain('user modified');
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('LLM 抛错 → skip + 记 inline 日志，不抛', async () => {
    seedSkillWithManifest('arxiv', 'body');
    seedUsage('arxiv', SESSION_KEY, false);

    const llmCall = vi.fn().mockRejectedValue(new Error('LLM down'));
    const result = await runInlineReview({
      db, store, userSkillsDir,
      signal: strongSignal('arxiv'),
      sessionKey: SESSION_KEY, llmCall,
    });
    expect(result.triggered).toBe(true);
    expect(result.decision).toBe('skip');

    const logs = db.all<{ triggerSource: string; errorMessage: string | null }>(
      `SELECT trigger_source AS triggerSource, error_message AS errorMessage FROM skill_evolution_log WHERE skill_name = ?`,
      'arxiv',
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].triggerSource).toBe('inline');
    expect(logs[0].errorMessage).toContain('LLM down');

    const unchanged = fs.readFileSync(path.join(userSkillsDir, 'arxiv', 'SKILL.md'), 'utf-8');
    expect(unchanged).toContain('body');
  });

  it('conversational_feedback 原文写入对应 skill_usage 行', async () => {
    seedSkillWithManifest('arxiv', 'body');
    seedUsage('arxiv', SESSION_KEY, false);

    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      decision: 'skip', reasoning: 'no clear fix',
    }));

    await runInlineReview({
      db, store, userSkillsDir,
      signal: strongSignal('arxiv', '不要再这样了'),
      sessionKey: SESSION_KEY, llmCall,
    });

    const rows = store.listBySessionAndSkill(SESSION_KEY, 'arxiv');
    expect(rows).toHaveLength(1);
    expect(rows[0].conversationalFeedback).toBe('不要再这样了');
    expect(rows[0].inlineReviewTriggeredAt).not.toBeNull();
  });

  it('subagent sessionKey 也跳过（防递归保守扩展）', async () => {
    seedSkillWithManifest('arxiv', 'body');
    seedUsage('arxiv', 'agent:x:subagent:abc');
    const llmCall = vi.fn();
    const result = await runInlineReview({
      db, store, userSkillsDir,
      signal: strongSignal('arxiv'),
      sessionKey: 'agent:x:subagent:abc', llmCall,
    });
    expect(result.triggered).toBe(false);
    expect(llmCall).not.toHaveBeenCalled();
  });
});
