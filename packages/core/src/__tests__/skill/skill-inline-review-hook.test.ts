/**
 * P1-B Phase 4: triggerInlineReviewIfSignaled 集成测试
 *
 * 端到端：用户负反馈消息 → hook → runInlineReview → SKILL.md 改动
 * 防御：非主 turn / 无 skill 上下文 / 信号不命中 → no-op
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { SkillUsageStore } from '../../skill/skill-usage-store.js';
import { upsertManifestEntry, computeSkillHash } from '../../skill/skill-manifest.js';
import { triggerInlineReviewIfSignaled } from '../../skill/skill-inline-review-hook.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', '..', 'infrastructure', 'db', 'migrations');
const MIGRATIONS = [
  '001_initial.sql',
  '027_skill_usage.sql',
  '028_skill_evolution_log.sql',
  '029_skill_evolution_content.sql',
  '037_skill_inline_review.sql',
].map(f => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8'));

const AGENT_ID = 'agent-x';
const SESSION_KEY = 'agent:agent-x:wechat:dm:peer-1';

function writeSkill(dir: string, name: string, body: string): string {
  const skillDir = path.join(dir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  const content = `---\nname: ${name}\ndescription: test\n---\n\n${body}\n`;
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
  return content;
}

describe('triggerInlineReviewIfSignaled', () => {
  let db: SqliteStore;
  let store: SkillUsageStore;
  let userSkillsDir: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-hook-'));
    userSkillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(userSkillsDir, { recursive: true });
    db = new SqliteStore(path.join(tmpDir, 'test.db'));
    for (const m of MIGRATIONS) db.exec(m);
    db.run(`INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)`, AGENT_ID, AGENT_ID, '🤖', 'active');
    store = new SkillUsageStore(db);
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedSkill(name: string, body: string): void {
    const content = writeSkill(userSkillsDir, name, body);
    upsertManifestEntry(userSkillsDir, {
      name, sha256: computeSkillHash(content),
      source: 'bundled', createdAt: '2026-01-01T00:00:00Z',
    });
  }

  function recordRecentInvoke(skillName: string, sessionKey = SESSION_KEY) {
    store.record({
      skillName, agentId: AGENT_ID, sessionKey,
      triggerType: 'invoke_skill', executionMode: 'inline', success: false,
    });
  }

  it('强信号 + 最近 skill → 触发 review 并改 SKILL.md', async () => {
    seedSkill('arxiv', 'old marker');
    recordRecentInvoke('arxiv');

    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      decision: 'refine',
      reasoning: 'fix marker',
      changes: { patches: [{ old: 'old marker', new: 'new marker' }] },
    }));

    const r = await triggerInlineReviewIfSignaled({
      userMessage: '不要这样',
      sessionKey: SESSION_KEY,
      db, userSkillsDir, llmCall,
    });

    expect(r.triggered).toBe(true);
    expect(r.decision).toBe('refine');
    const updated = fs.readFileSync(path.join(userSkillsDir, 'arxiv', 'SKILL.md'), 'utf-8');
    expect(updated).toContain('new marker');
  });

  it('无最近 skill 调用 → 不触发（不调 LLM）', async () => {
    const llmCall = vi.fn();
    const r = await triggerInlineReviewIfSignaled({
      userMessage: '不要这样',
      sessionKey: SESSION_KEY,
      db, userSkillsDir, llmCall,
    });
    expect(r.triggered).toBe(false);
    expect(r.reason).toContain('no recent skill');
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('信号 none（regex 不命中 + LLM 也判 negative=false） → 不触发', async () => {
    seedSkill('arxiv', 'body');
    recordRecentInvoke('arxiv');
    // LLM 兜底也判定无不满
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      negative: false,
      skillName: '',
      reason: '中性请求',
    }));
    const r = await triggerInlineReviewIfSignaled({
      userMessage: '帮我下载这个',
      sessionKey: SESSION_KEY,
      db, userSkillsDir, llmCall,
    });
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('signal=none');
    // LLM 被调过 1 次（兜底分类），但结果 negative=false
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('regex 漏检 + LLM 兜底命中 → 触发 review', async () => {
    seedSkill('arxiv', 'old body');
    recordRecentInvoke('arxiv');
    // 第 1 次调用：LLM 分类器（detectFeedbackSignalViaLLM），返回 negative=true
    // 第 2 次调用：runInlineReview 的 evolver LLM，返回 refine 决策
    const llmCall = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        negative: true,
        skillName: 'arxiv',
        reason: '反话/暗示纠正',
      }))
      .mockResolvedValueOnce(JSON.stringify({
        decision: 'refine',
        reasoning: 'address user expectation',
        changes: { patches: [{ old: 'old body', new: 'better body' }] },
      }));

    const r = await triggerInlineReviewIfSignaled({
      // 这句话 regex 完全不命中（"不对" ≠ "完全不对"），但 LLM 应该看出来是抱怨
      userMessage: '这工具不对',
      sessionKey: SESSION_KEY,
      db, userSkillsDir, llmCall,
    });

    expect(r.triggered).toBe(true);
    expect(r.decision).toBe('refine');
    expect(llmCall).toHaveBeenCalledTimes(2);

    const updated = fs.readFileSync(path.join(userSkillsDir, 'arxiv', 'SKILL.md'), 'utf-8');
    expect(updated).toContain('better body');
  });

  it('regex 漏检 + LLM 抛异常 → 静默 skip 不冒泡', async () => {
    seedSkill('arxiv', 'body');
    recordRecentInvoke('arxiv');
    let callCount = 0;
    const llmCall = vi.fn().mockImplementation(async () => {
      callCount++;
      throw new Error('LLM provider down');
    });

    const r = await triggerInlineReviewIfSignaled({
      userMessage: '这工具不对',
      sessionKey: SESSION_KEY,
      db, userSkillsDir, llmCall,
    });

    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('signal=none');
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it('regex 命中时不浪费 LLM 调用（regex 优先）', async () => {
    seedSkill('arxiv', 'old');
    recordRecentInvoke('arxiv');
    // 仅 1 次 LLM 调用预期：runInlineReview 的 evolver。
    // detectFeedbackSignalViaLLM 不应被调（regex 已命中）。
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      decision: 'skip',
      reasoning: 'minor issue',
    }));

    await triggerInlineReviewIfSignaled({
      userMessage: '完全不对', // regex 命中 completely-wrong
      sessionKey: SESSION_KEY,
      db, userSkillsDir, llmCall,
    });

    // LLM 调用次数：1（仅 evolver），不含分类器
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('cron sessionKey 前置拦截：连 SQL 都不查', async () => {
    const llmCall = vi.fn();
    const r = await triggerInlineReviewIfSignaled({
      userMessage: '不要这样',
      sessionKey: 'agent:x:cron:tick:abc',
      db, userSkillsDir, llmCall,
    });
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('non-main session');
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('subagent / heartbeat / boot 同样拦截', async () => {
    const llmCall = vi.fn();
    for (const sk of [
      'agent:x:subagent:abc',
      'agent:x:heartbeat:tick',
      'agent:x:boot',
    ]) {
      const r = await triggerInlineReviewIfSignaled({
        userMessage: '不要这样',
        sessionKey: sk,
        db, userSkillsDir, llmCall,
      });
      expect(r.triggered).toBe(false);
      expect(r.reason).toBe('non-main session');
    }
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('空消息 → 直接 skip', async () => {
    seedSkill('arxiv', 'body');
    recordRecentInvoke('arxiv');
    const llmCall = vi.fn();
    const r = await triggerInlineReviewIfSignaled({
      userMessage: '   ',
      sessionKey: SESSION_KEY,
      db, userSkillsDir, llmCall,
    });
    expect(r.triggered).toBe(false);
    expect(r.reason).toContain('empty');
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('LLM 抛错 → 不抛到调用方', async () => {
    seedSkill('arxiv', 'body');
    recordRecentInvoke('arxiv');
    const llmCall = vi.fn().mockRejectedValue(new Error('boom'));
    const r = await triggerInlineReviewIfSignaled({
      userMessage: '不要这样',
      sessionKey: SESSION_KEY,
      db, userSkillsDir, llmCall,
    });
    expect(r.triggered).toBe(true);
    expect(r.decision).toBe('skip');
  });

  it('注入本 session 已用 skill 列表（Phase 5 优先级）', async () => {
    seedSkill('arxiv', 'body');
    seedSkill('other', 'body2');
    recordRecentInvoke('arxiv');
    recordRecentInvoke('other');

    let capturedUserPrompt = '';
    const llmCall = vi.fn().mockImplementation(async (_sys: string, user: string) => {
      capturedUserPrompt = user;
      return JSON.stringify({ decision: 'skip', reasoning: 'no fix' });
    });

    await triggerInlineReviewIfSignaled({
      userMessage: '不要这样',
      sessionKey: SESSION_KEY,
      db, userSkillsDir, llmCall,
    });

    expect(capturedUserPrompt).toContain('skills used in current session');
    expect(capturedUserPrompt).toContain('arxiv');
    expect(capturedUserPrompt).toContain('other');
  });
});
