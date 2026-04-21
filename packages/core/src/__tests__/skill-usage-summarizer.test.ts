/**
 * SkillUsageSummarizer 单元测试 — M7 Phase 2
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { SkillUsageStore } from '../skill/skill-usage-store.js';
import { generateSkillSummaries } from '../skill/skill-usage-summarizer.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations');
const MIGRATION_001 = fs.readFileSync(path.join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8');
const MIGRATION_027 = fs.readFileSync(path.join(MIGRATIONS_DIR, '027_skill_usage.sql'), 'utf-8');

const AGENT_ID = 'agent-1';
const SESSION = 'session-1';

describe('SkillUsageSummarizer', () => {
  let db: SqliteStore;
  let store: SkillUsageStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-summarizer-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    db = new SqliteStore(path.join(tmpDir, 'test.db'));
    db.exec(MIGRATION_001);
    db.exec(MIGRATION_027);
    db.run(`INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)`, AGENT_ID, AGENT_ID, '🤖', 'active');
    store = new SkillUsageStore(db);
  });

  afterEach(() => {
    try { db.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('生成摘要并写入 skill_usage_summary', async () => {
    for (const success of [true, true, false, true]) {
      store.record({
        skillName: 'arxiv',
        agentId: AGENT_ID,
        sessionKey: SESSION,
        triggerType: 'invoke_skill',
        executionMode: 'inline',
        success,
      });
    }
    const llmCall = vi.fn().mockResolvedValue('模拟摘要：该技能总体有效，但偶发失败。');
    const result = await generateSkillSummaries({
      store, llmCall, sessionKey: SESSION, agentId: AGENT_ID,
      modelUsed: 'test-model',
    });
    expect(result.generated).toBe(1);
    expect(llmCall).toHaveBeenCalledTimes(1);
    const summaries = store.listSummaries('arxiv', 5);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].summaryText).toContain('模拟摘要');
    expect(summaries[0].modelUsed).toBe('test-model');
  });

  it('invocation 数不足 minInvocations → skipped 而非 generated', async () => {
    store.record({ skillName: 'solo', agentId: AGENT_ID, sessionKey: SESSION, triggerType: 'invoke_skill', executionMode: 'inline', success: true });
    const llmCall = vi.fn();
    const result = await generateSkillSummaries({
      store, llmCall, sessionKey: SESSION, agentId: AGENT_ID,
    });
    expect(result.skipped).toBe(1);
    expect(result.generated).toBe(0);
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('LLM 抛异常 → failed++，不中断其他 Skill 处理', async () => {
    for (const skill of ['good', 'bad']) {
      for (let i = 0; i < 2; i++) {
        store.record({ skillName: skill, agentId: AGENT_ID, sessionKey: SESSION, triggerType: 'invoke_skill', executionMode: 'inline', success: true });
      }
    }
    const llmCall = vi.fn().mockImplementation((_sys: string, user: string) => {
      if (user.includes('bad')) return Promise.reject(new Error('LLM 超时'));
      return Promise.resolve('good summary');
    });
    const result = await generateSkillSummaries({
      store, llmCall, sessionKey: SESSION, agentId: AGENT_ID,
    });
    expect(result.generated).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('session 无任何调用 → 所有计数为 0', async () => {
    const llmCall = vi.fn();
    const result = await generateSkillSummaries({
      store, llmCall, sessionKey: 'empty', agentId: AGENT_ID,
    });
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('LLM 返回空串 → failed', async () => {
    for (let i = 0; i < 3; i++) {
      store.record({ skillName: 'x', agentId: AGENT_ID, sessionKey: SESSION, triggerType: 'invoke_skill', executionMode: 'inline', success: true });
    }
    const llmCall = vi.fn().mockResolvedValue('   ');
    const result = await generateSkillSummaries({
      store, llmCall, sessionKey: SESSION, agentId: AGENT_ID,
    });
    expect(result.failed).toBe(1);
  });
});
