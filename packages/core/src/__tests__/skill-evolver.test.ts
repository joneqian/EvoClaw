/**
 * Skill Evolver 核心集成测试 — M7 Phase 3
 *
 * 端到端：灌 usage → 跑 runEvolutionCycle → 验证 evolution_log + SKILL.md 变化
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { SkillUsageStore } from '../skill/skill-usage-store.js';
import { runEvolutionCycle } from '../skill/skill-evolver.js';
import { upsertManifestEntry, computeSkillHash } from '../skill/skill-manifest.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations');
const MIGRATION_001 = fs.readFileSync(path.join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8');
const MIGRATION_027 = fs.readFileSync(path.join(MIGRATIONS_DIR, '027_skill_usage.sql'), 'utf-8');
const MIGRATION_028 = fs.readFileSync(path.join(MIGRATIONS_DIR, '028_skill_evolution_log.sql'), 'utf-8');
const MIGRATION_029 = fs.readFileSync(path.join(MIGRATIONS_DIR, '029_skill_evolution_content.sql'), 'utf-8');
const MIGRATION_037 = fs.readFileSync(path.join(MIGRATIONS_DIR, '037_skill_inline_review.sql'), 'utf-8');

const AGENT = 'agent-1';

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(dir: string, name: string, body = 'marker text'): void {
  const skillDir = path.join(dir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  const content = `---\nname: ${name}\ndescription: test skill\n---\n\n${body}\n`;
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
  return;
}

function skillContent(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: test skill\n---\n\n${body}\n`;
}

describe('runEvolutionCycle', () => {
  let db: SqliteStore;
  let userSkillsDir: string;
  let tmpDir: string;
  let usageStore: SkillUsageStore;

  beforeEach(() => {
    tmpDir = mkTmpDir('evolver-test-');
    userSkillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(userSkillsDir, { recursive: true });
    db = new SqliteStore(path.join(tmpDir, 'test.db'));
    db.exec(MIGRATION_001);
    db.exec(MIGRATION_027);
    db.exec(MIGRATION_028);
    db.exec(MIGRATION_029);
    db.exec(MIGRATION_037);
    db.run(`INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)`, AGENT, AGENT, '🤖', 'active');
    usageStore = new SkillUsageStore(db);
  });

  afterEach(() => {
    try { db.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function feedUsages(skillName: string, successes: number, failures: number): void {
    for (let i = 0; i < successes; i++) {
      usageStore.record({
        skillName, agentId: AGENT, sessionKey: `s-${crypto.randomUUID()}`,
        triggerType: 'invoke_skill', executionMode: 'inline', success: true, durationMs: 100,
      });
    }
    for (let i = 0; i < failures; i++) {
      usageStore.record({
        skillName, agentId: AGENT, sessionKey: `s-${crypto.randomUUID()}`,
        triggerType: 'invoke_skill', executionMode: 'inline', success: false,
        durationMs: 200, errorSummary: `timeout error ${i}`,
      });
    }
  }

  it('candidate 成功率 < threshold 且 invocation >= 5 → 进入 LLM 决策', async () => {
    writeSkill(userSkillsDir, 'target', 'original marker text');
    const content = fs.readFileSync(path.join(userSkillsDir, 'target', 'SKILL.md'), 'utf-8');
    upsertManifestEntry(userSkillsDir, {
      name: 'target', sha256: computeSkillHash(content),
      source: 'bundled', createdAt: '2026-01-01T00:00:00Z',
    });
    // 补 5 次摘要让 evidenceCount 通过
    for (let i = 0; i < 3; i++) {
      usageStore.saveSummary({
        skillName: 'target', sessionKey: `s${i}`, agentId: AGENT,
        summaryText: '偶发超时', invocationCount: 2, successRate: 0.5,
      });
    }
    feedUsages('target', 2, 5);

    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      decision: 'refine',
      reasoning: 'timeout pattern detected',
      changes: { patches: [{ old: 'original marker', new: 'improved marker' }] },
    }));

    const result = await runEvolutionCycle({
      db, userSkillsDir,
      config: {
        enabled: true, cronSchedule: '0 3 * * *',
        minEvidenceCount: 2, successRateThreshold: 0.8,
        maxCandidatesPerRun: 5,
      },
      llmCall,
    });

    expect(result.candidatesFound).toBeGreaterThanOrEqual(1);
    expect(result.refined).toBe(1);
    expect(llmCall).toHaveBeenCalledTimes(1);

    const updated = fs.readFileSync(path.join(userSkillsDir, 'target', 'SKILL.md'), 'utf-8');
    expect(updated).toContain('improved marker');
    expect(updated).not.toContain('original marker');

    const logRows = db.all<{ decision: string; previousHash: string; newHash: string }>(
      `SELECT decision, previous_hash AS previousHash, new_hash AS newHash FROM skill_evolution_log WHERE skill_name = ?`,
      'target',
    );
    expect(logRows).toHaveLength(1);
    expect(logRows[0].decision).toBe('refine');
    expect(logRows[0].previousHash).not.toBe(logRows[0].newHash);
  });

  it('用户手改过 (hash 不匹配 manifest) → 自动 skip', async () => {
    writeSkill(userSkillsDir, 'usr-edited', 'body');
    // manifest 记了一个假的 hash（模拟用户改过）
    upsertManifestEntry(userSkillsDir, {
      name: 'usr-edited', sha256: 'HASH-FROM-BEFORE-USER-EDIT',
      source: 'bundled', createdAt: '2026-01-01T00:00:00Z',
    });
    feedUsages('usr-edited', 1, 6);
    // 补摘要
    usageStore.saveSummary({ skillName: 'usr-edited', sessionKey: 's1', agentId: AGENT, summaryText: 'x', invocationCount: 7, successRate: 0.14 });
    usageStore.saveSummary({ skillName: 'usr-edited', sessionKey: 's2', agentId: AGENT, summaryText: 'y', invocationCount: 7, successRate: 0.14 });

    const llmCall = vi.fn();
    const result = await runEvolutionCycle({
      db, userSkillsDir,
      config: { enabled: true, cronSchedule: '* * * * *', minEvidenceCount: 1, successRateThreshold: 0.8, maxCandidatesPerRun: 5 },
      llmCall,
    });
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(llmCall).not.toHaveBeenCalled();
    const logRows = db.all<{ reasoning: string }>(
      `SELECT reasoning FROM skill_evolution_log WHERE skill_name = ?`,
      'usr-edited',
    );
    expect(logRows[0].reasoning).toContain('user modified');
  });

  it('LLM 返回 skip → 不修改 SKILL.md', async () => {
    writeSkill(userSkillsDir, 'keeper', 'keeps original');
    upsertManifestEntry(userSkillsDir, {
      name: 'keeper',
      sha256: computeSkillHash(skillContent('keeper', 'keeps original')),
      source: 'bundled',
      createdAt: '2026-01-01T00:00:00Z',
    });
    for (let i = 0; i < 3; i++) {
      usageStore.saveSummary({ skillName: 'keeper', sessionKey: `s${i}`, agentId: AGENT, summaryText: '流程 OK', invocationCount: 2, successRate: 0.5 });
    }
    feedUsages('keeper', 2, 5);

    const llmCall = vi.fn().mockResolvedValue('{"decision":"skip","reasoning":"no clear fix"}');
    const result = await runEvolutionCycle({
      db, userSkillsDir,
      config: { enabled: true, cronSchedule: '* * * * *', minEvidenceCount: 1, successRateThreshold: 0.8, maxCandidatesPerRun: 5 },
      llmCall,
    });
    expect(result.skipped).toBe(1);
    const unchanged = fs.readFileSync(path.join(userSkillsDir, 'keeper', 'SKILL.md'), 'utf-8');
    expect(unchanged).toContain('keeps original');
  });

  it('patch.old 不匹配 → error（记日志，不改文件）', async () => {
    writeSkill(userSkillsDir, 'mismatch', 'real content');
    upsertManifestEntry(userSkillsDir, {
      name: 'mismatch',
      sha256: computeSkillHash(skillContent('mismatch', 'real content')),
      source: 'bundled',
      createdAt: '2026-01-01T00:00:00Z',
    });
    for (let i = 0; i < 3; i++) {
      usageStore.saveSummary({ skillName: 'mismatch', sessionKey: `s${i}`, agentId: AGENT, summaryText: 'x', invocationCount: 2, successRate: 0.5 });
    }
    feedUsages('mismatch', 2, 5);

    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      decision: 'refine',
      reasoning: 'x',
      changes: { patches: [{ old: 'DOES NOT EXIST', new: 'y' }] },
    }));
    const result = await runEvolutionCycle({
      db, userSkillsDir,
      config: { enabled: true, cronSchedule: '* * * * *', minEvidenceCount: 1, successRateThreshold: 0.8, maxCandidatesPerRun: 5 },
      llmCall,
    });
    expect(result.failed).toBe(1);
    const logRows = db.all<{ error_message: string }>(
      `SELECT error_message FROM skill_evolution_log WHERE skill_name = 'mismatch'`,
    );
    expect(logRows[0].error_message).toContain('not found');
  });

  it('evolved 内容含 eval → 安全扫描拒绝', async () => {
    writeSkill(userSkillsDir, 'unsafe', 'safe body');
    upsertManifestEntry(userSkillsDir, {
      name: 'unsafe',
      sha256: computeSkillHash(skillContent('unsafe', 'safe body')),
      source: 'bundled',
      createdAt: '2026-01-01T00:00:00Z',
    });
    for (let i = 0; i < 3; i++) {
      usageStore.saveSummary({ skillName: 'unsafe', sessionKey: `s${i}`, agentId: AGENT, summaryText: 'x', invocationCount: 2, successRate: 0.5 });
    }
    feedUsages('unsafe', 2, 5);

    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      decision: 'refine', reasoning: 'x',
      changes: { patches: [{ old: 'safe body', new: 'eval(malicious)' }] },
    }));
    const result = await runEvolutionCycle({
      db, userSkillsDir,
      config: { enabled: true, cronSchedule: '* * * * *', minEvidenceCount: 1, successRateThreshold: 0.8, maxCandidatesPerRun: 5 },
      llmCall,
    });
    expect(result.failed).toBe(1);
    const unchanged = fs.readFileSync(path.join(userSkillsDir, 'unsafe', 'SKILL.md'), 'utf-8');
    expect(unchanged).toContain('safe body');
    expect(unchanged).not.toContain('eval');
  });

  it('LLM 连续 3 次失败 → 熔断', async () => {
    // 灌 5 个候选
    for (let i = 0; i < 5; i++) {
      const name = `cand-${i}`;
      writeSkill(userSkillsDir, name, 'body');
      upsertManifestEntry(userSkillsDir, {
        name,
        sha256: computeSkillHash(skillContent(name, 'body')),
        source: 'bundled',
        createdAt: '2026-01-01T00:00:00Z',
      });
      for (let j = 0; j < 3; j++) {
        usageStore.saveSummary({ skillName: name, sessionKey: `s${j}`, agentId: AGENT, summaryText: 'x', invocationCount: 2, successRate: 0.5 });
      }
      feedUsages(name, 2, 5);
    }

    const llmCall = vi.fn().mockRejectedValue(new Error('LLM 网络超时'));
    const result = await runEvolutionCycle({
      db, userSkillsDir,
      config: { enabled: true, cronSchedule: '* * * * *', minEvidenceCount: 1, successRateThreshold: 0.8, maxCandidatesPerRun: 10 },
      llmCall,
    });
    // 3 次失败后熔断，LLM 只被调 3 次
    expect(llmCall).toHaveBeenCalledTimes(3);
    expect(result.failed).toBe(3);
  });

  it('enabled=false → 无操作', async () => {
    writeSkill(userSkillsDir, 'x', 'body');
    feedUsages('x', 1, 5);
    const llmCall = vi.fn();
    const result = await runEvolutionCycle({
      db, userSkillsDir,
      config: { enabled: false, cronSchedule: '* * * * *', minEvidenceCount: 1, successRateThreshold: 0.8, maxCandidatesPerRun: 5 },
      llmCall,
    });
    expect(result.candidatesFound).toBe(0);
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('decision=create → 新 Skill 目录 + manifest 记录', async () => {
    writeSkill(userSkillsDir, 'source', 'body');
    upsertManifestEntry(userSkillsDir, {
      name: 'source',
      sha256: computeSkillHash(skillContent('source', 'body')),
      source: 'bundled',
      createdAt: '2026-01-01T00:00:00Z',
    });
    for (let i = 0; i < 3; i++) {
      usageStore.saveSummary({ skillName: 'source', sessionKey: `s${i}`, agentId: AGENT, summaryText: 'x', invocationCount: 2, successRate: 0.5 });
    }
    feedUsages('source', 2, 5);

    const newSkillMd = '---\nname: derived-skill\ndescription: new one\n---\n\nstep 1\n';
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      decision: 'create',
      reasoning: 'derived new workflow',
      changes: { suggestedName: 'derived-skill', new_skill_md: newSkillMd },
    }));
    const result = await runEvolutionCycle({
      db, userSkillsDir,
      config: { enabled: true, cronSchedule: '* * * * *', minEvidenceCount: 1, successRateThreshold: 0.8, maxCandidatesPerRun: 5 },
      llmCall,
    });
    expect(result.created).toBe(1);
    expect(fs.existsSync(path.join(userSkillsDir, 'derived-skill', 'SKILL.md'))).toBe(true);
  });
});
