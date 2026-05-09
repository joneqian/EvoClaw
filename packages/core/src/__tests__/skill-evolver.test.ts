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
import { setPinned } from '../skill/skill-curator-lifecycle.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations');
const MIGRATION_001 = fs.readFileSync(path.join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8');
const MIGRATION_027 = fs.readFileSync(path.join(MIGRATIONS_DIR, '027_skill_usage.sql'), 'utf-8');
const MIGRATION_028 = fs.readFileSync(path.join(MIGRATIONS_DIR, '028_skill_evolution_log.sql'), 'utf-8');
const MIGRATION_029 = fs.readFileSync(path.join(MIGRATIONS_DIR, '029_skill_evolution_content.sql'), 'utf-8');
const MIGRATION_037 = fs.readFileSync(path.join(MIGRATIONS_DIR, '037_skill_inline_review.sql'), 'utf-8');
const MIGRATION_040 = fs.readFileSync(path.join(MIGRATIONS_DIR, '040_skill_ab_test.sql'), 'utf-8');
const MIGRATION_041 = fs.readFileSync(path.join(MIGRATIONS_DIR, '041_skill_ab_outcome.sql'), 'utf-8');
const MIGRATION_042 = fs.readFileSync(path.join(MIGRATIONS_DIR, '042_skill_evolver_pending.sql'), 'utf-8');

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
    db.exec(MIGRATION_040);
    db.exec(MIGRATION_041);
    db.exec(MIGRATION_042);
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

  // ─── M7-Tier1 PR1: pinned 过滤 ──────────────────────────────────────

  it('pinned candidate 不进入 LLM 决策', async () => {
    writeSkill(userSkillsDir, 'pinned-target', 'old marker');
    const content = fs.readFileSync(path.join(userSkillsDir, 'pinned-target', 'SKILL.md'), 'utf-8');
    upsertManifestEntry(userSkillsDir, {
      name: 'pinned-target', sha256: computeSkillHash(content),
      source: 'agent-created', createdAt: '2026-01-01T00:00:00Z',
    });
    // 灌足够的失败 usage 让其本应进候选
    feedUsages('pinned-target', 1, 5);
    for (let i = 0; i < 3; i++) {
      usageStore.saveSummary({
        skillName: 'pinned-target', sessionKey: `s${i}`, agentId: AGENT,
        summaryText: '失败', invocationCount: 2, successRate: 0.2,
      });
    }
    // 钉住
    setPinned('pinned-target', true, userSkillsDir);

    const llmCall = vi.fn();
    const result = await runEvolutionCycle({
      db, userSkillsDir,
      config: { enabled: true, cronSchedule: '* * * * *', minEvidenceCount: 1, successRateThreshold: 0.8, maxCandidatesPerRun: 5 },
      llmCall,
    });

    expect(result.candidatesFound).toBe(0);
    expect(llmCall).not.toHaveBeenCalled();

    // SKILL.md 未变 + 无 evolution_log
    const md = fs.readFileSync(path.join(userSkillsDir, 'pinned-target', 'SKILL.md'), 'utf-8');
    expect(md).toContain('old marker');
    const logs = db.all(
      `SELECT id FROM skill_evolution_log WHERE skill_name = ?`,
      'pinned-target',
    );
    expect(logs).toHaveLength(0);
  });

  it('混合候选只过滤 pinned 一项；其他正常进决策', async () => {
    // 两个候选：pinned-A（钉）和 free-B（不钉）
    for (const name of ['pinned-A', 'free-B']) {
      writeSkill(userSkillsDir, name, `marker ${name}`);
      const content = fs.readFileSync(path.join(userSkillsDir, name, 'SKILL.md'), 'utf-8');
      upsertManifestEntry(userSkillsDir, {
        name, sha256: computeSkillHash(content),
        source: 'agent-created', createdAt: '2026-01-01T00:00:00Z',
      });
      feedUsages(name, 1, 5);
      for (let i = 0; i < 3; i++) {
        usageStore.saveSummary({
          skillName: name, sessionKey: `${name}-s${i}`, agentId: AGENT,
          summaryText: '失败', invocationCount: 2, successRate: 0.2,
        });
      }
    }
    setPinned('pinned-A', true, userSkillsDir);

    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      decision: 'skip',
      reasoning: 'pass',
    }));
    const result = await runEvolutionCycle({
      db, userSkillsDir,
      config: { enabled: true, cronSchedule: '* * * * *', minEvidenceCount: 1, successRateThreshold: 0.8, maxCandidatesPerRun: 5 },
      llmCall,
    });

    expect(result.candidatesFound).toBe(1);
    expect(llmCall).toHaveBeenCalledTimes(1);

    // 只有 free-B 进了 evolution_log
    const allLogs = db.all<{ skillName: string }>(
      `SELECT skill_name AS skillName FROM skill_evolution_log`,
    );
    const names = allLogs.map(r => r.skillName);
    expect(names).toContain('free-B');
    expect(names).not.toContain('pinned-A');
  });

  // ─── M7-Tier3 PR-T3-1a: refine 成功后启动 A-B 测试 ──────────────────

  it('refine 成功 → 启动 A-B 测试 + 物化 .ab-cache/', async () => {
    writeSkill(userSkillsDir, 'target', 'old marker');
    const original = fs.readFileSync(path.join(userSkillsDir, 'target', 'SKILL.md'), 'utf-8');
    upsertManifestEntry(userSkillsDir, {
      name: 'target', sha256: computeSkillHash(original),
      source: 'bundled', createdAt: '2026-01-01T00:00:00Z',
    });
    feedUsages('target', 1, 5);
    for (let i = 0; i < 3; i++) {
      usageStore.saveSummary({
        skillName: 'target', sessionKey: `s${i}`, agentId: AGENT,
        summaryText: '失败', invocationCount: 2, successRate: 0.2,
      });
    }
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      decision: 'refine', reasoning: 'fix marker',
      changes: { patches: [{ old: 'old marker', new: 'new marker' }] },
    }));
    const result = await runEvolutionCycle({
      db, userSkillsDir,
      config: { enabled: true, cronSchedule: '* * * * *', minEvidenceCount: 1, successRateThreshold: 0.8, maxCandidatesPerRun: 5 },
      llmCall,
    });
    expect(result.refined).toBe(1);

    // ab_test 表有新 active 行
    const abRow = db.get<{ id: number; status: string; variantAHash: string; variantBHash: string }>(
      `SELECT id, status, variant_a_hash AS variantAHash, variant_b_hash AS variantBHash
       FROM skill_ab_test WHERE skill_name = ?`,
      'target',
    );
    expect(abRow).toBeDefined();
    expect(abRow!.status).toBe('active');
    expect(abRow!.variantAHash).toBeTruthy();
    expect(abRow!.variantBHash).toBeTruthy();
    expect(abRow!.variantAHash).not.toBe(abRow!.variantBHash);

    // .ab-cache/ 中物化了 A 版本
    const cacheDir = path.join(userSkillsDir, '.ab-cache');
    expect(fs.existsSync(cacheDir)).toBe(true);
    const cacheFiles = fs.readdirSync(cacheDir).filter(f => f.startsWith('target-'));
    expect(cacheFiles).toHaveLength(1);
    const cacheContent = fs.readFileSync(path.join(cacheDir, cacheFiles[0]!), 'utf-8');
    expect(cacheContent).toContain('old marker');  // A 是旧版本
  });

  it('decision=skip → 不启动 A-B', async () => {
    writeSkill(userSkillsDir, 'target', 'body');
    const c = fs.readFileSync(path.join(userSkillsDir, 'target', 'SKILL.md'), 'utf-8');
    upsertManifestEntry(userSkillsDir, {
      name: 'target', sha256: computeSkillHash(c),
      source: 'bundled', createdAt: '2026-01-01T00:00:00Z',
    });
    feedUsages('target', 1, 5);
    for (let i = 0; i < 3; i++) {
      usageStore.saveSummary({
        skillName: 'target', sessionKey: `s${i}`, agentId: AGENT,
        summaryText: '失败', invocationCount: 2, successRate: 0.2,
      });
    }
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      decision: 'skip', reasoning: 'no clear cause',
    }));
    await runEvolutionCycle({
      db, userSkillsDir,
      config: { enabled: true, cronSchedule: '* * * * *', minEvidenceCount: 1, successRateThreshold: 0.8, maxCandidatesPerRun: 5 },
      llmCall,
    });
    const abRow = db.get(`SELECT id FROM skill_ab_test WHERE skill_name = 'target'`);
    expect(abRow).toBeUndefined();
  });

  it('decision=create → 不启动 A-B（无 baseline）', async () => {
    writeSkill(userSkillsDir, 'source', 'body');
    upsertManifestEntry(userSkillsDir, {
      name: 'source', sha256: computeSkillHash(skillContent('source', 'body')),
      source: 'bundled', createdAt: '2026-01-01T00:00:00Z',
    });
    for (let i = 0; i < 3; i++) {
      usageStore.saveSummary({ skillName: 'source', sessionKey: `s${i}`, agentId: AGENT, summaryText: 'x', invocationCount: 2, successRate: 0.5 });
    }
    feedUsages('source', 2, 5);
    const newSkillMd = '---\nname: derived\ndescription: new\n---\n\nstep\n';
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      decision: 'create', reasoning: 'derived',
      changes: { suggestedName: 'derived', new_skill_md: newSkillMd },
    }));
    await runEvolutionCycle({
      db, userSkillsDir,
      config: { enabled: true, cronSchedule: '* * * * *', minEvidenceCount: 1, successRateThreshold: 0.8, maxCandidatesPerRun: 5 },
      llmCall,
    });
    // create 不进 A-B
    const abRows = db.all(`SELECT id FROM skill_ab_test`);
    expect(abRows).toHaveLength(0);
  });

  it('refine 失败（patch 不匹配）→ 不启动 A-B', async () => {
    writeSkill(userSkillsDir, 'target', 'body');
    const c = fs.readFileSync(path.join(userSkillsDir, 'target', 'SKILL.md'), 'utf-8');
    upsertManifestEntry(userSkillsDir, {
      name: 'target', sha256: computeSkillHash(c),
      source: 'bundled', createdAt: '2026-01-01T00:00:00Z',
    });
    feedUsages('target', 1, 5);
    for (let i = 0; i < 3; i++) {
      usageStore.saveSummary({
        skillName: 'target', sessionKey: `s${i}`, agentId: AGENT,
        summaryText: 'x', invocationCount: 2, successRate: 0.2,
      });
    }
    const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
      decision: 'refine', reasoning: 'fix',
      changes: { patches: [{ old: 'NONEXISTENT', new: 'whatever' }] },
    }));
    await runEvolutionCycle({
      db, userSkillsDir,
      config: { enabled: true, cronSchedule: '* * * * *', minEvidenceCount: 1, successRateThreshold: 0.8, maxCandidatesPerRun: 5 },
      llmCall,
    });
    const abRow = db.get(`SELECT id FROM skill_ab_test WHERE skill_name = 'target'`);
    expect(abRow).toBeUndefined();
  });

  // ─── M7-Tier3 PR-T3-2a: dryRun 模式 ─────────────────────────────────────

  describe('mode=dryRun', () => {
    function setupRefineCandidate(): string {
      writeSkill(userSkillsDir, 'dry-target', 'original marker text');
      const content = fs.readFileSync(path.join(userSkillsDir, 'dry-target', 'SKILL.md'), 'utf-8');
      upsertManifestEntry(userSkillsDir, {
        name: 'dry-target', sha256: computeSkillHash(content),
        source: 'bundled', createdAt: '2026-01-01T00:00:00Z',
      });
      for (let i = 0; i < 3; i++) {
        usageStore.saveSummary({
          skillName: 'dry-target', sessionKey: `s${i}`, agentId: AGENT,
          summaryText: '偶发超时', invocationCount: 2, successRate: 0.5,
        });
      }
      feedUsages('dry-target', 2, 5);
      return content;
    }

    it('refine 决策 → SKILL.md 不变 + log pending=1 + dryRunPending++', async () => {
      const before = setupRefineCandidate();
      const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
        decision: 'refine',
        reasoning: 'dryRun decision',
        changes: { patches: [{ old: 'original marker', new: 'improved marker' }] },
      }));

      const result = await runEvolutionCycle({
        db, userSkillsDir,
        config: {
          enabled: true, cronSchedule: '0 3 * * *',
          minEvidenceCount: 2, successRateThreshold: 0.8,
          maxCandidatesPerRun: 5, mode: 'dryRun',
        },
        llmCall,
      });

      // 行为期望
      expect(result.refined).toBe(0);
      expect(result.dryRunPending).toBe(1);

      // SKILL.md 文件未变
      const after = fs.readFileSync(path.join(userSkillsDir, 'dry-target', 'SKILL.md'), 'utf-8');
      expect(after).toBe(before);

      // log 行存在 + pending_approval=1
      const logRow = db.get<{
        decision: string; pending_approval: number;
        new_content: string | null; previous_content: string | null;
      }>(
        `SELECT decision, pending_approval, new_content, previous_content
         FROM skill_evolution_log WHERE skill_name = 'dry-target'`,
      );
      expect(logRow?.decision).toBe('refine');
      expect(logRow?.pending_approval).toBe(1);
      // new_content 应包含 patched 后的内容（dryRun 仍计算 hash + 内容）
      expect(logRow?.new_content).toContain('improved marker');
      expect(logRow?.previous_content).toContain('original marker');
    });

    it('dryRun + abTestEnabled=true → A-B 不启动（互斥）', async () => {
      setupRefineCandidate();
      const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
        decision: 'refine',
        reasoning: 'should not start ab',
        changes: { patches: [{ old: 'original marker', new: 'improved marker' }] },
      }));

      await runEvolutionCycle({
        db, userSkillsDir,
        config: {
          enabled: true, cronSchedule: '0 3 * * *',
          minEvidenceCount: 2, successRateThreshold: 0.8,
          maxCandidatesPerRun: 5, mode: 'dryRun',
          abTestEnabled: true,  // 显式开启 → 但 dryRun 优先
        },
        llmCall,
      });

      const abRow = db.get(`SELECT id FROM skill_ab_test WHERE skill_name = 'dry-target'`);
      expect(abRow).toBeUndefined();
    });

    it('skip 决策不会被标 pending（pending 仅 refine/create）', async () => {
      setupRefineCandidate();
      const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
        decision: 'skip',
        reasoning: 'evidence too noisy',
      }));

      const result = await runEvolutionCycle({
        db, userSkillsDir,
        config: {
          enabled: true, cronSchedule: '0 3 * * *',
          minEvidenceCount: 2, successRateThreshold: 0.8,
          maxCandidatesPerRun: 5, mode: 'dryRun',
        },
        llmCall,
      });
      expect(result.dryRunPending).toBe(0);
      expect(result.skipped).toBeGreaterThanOrEqual(1);

      const logRow = db.get<{ decision: string; pending_approval: number }>(
        `SELECT decision, pending_approval FROM skill_evolution_log WHERE skill_name = 'dry-target'`,
      );
      expect(logRow?.decision).toBe('skip');
      expect(logRow?.pending_approval).toBe(0);
    });

    it('mode=apply（默认）行为不变 — SKILL.md 写入 + pending=0', async () => {
      setupRefineCandidate();
      const llmCall = vi.fn().mockResolvedValue(JSON.stringify({
        decision: 'refine',
        reasoning: 'apply mode',
        changes: { patches: [{ old: 'original marker', new: 'improved marker' }] },
      }));

      const result = await runEvolutionCycle({
        db, userSkillsDir,
        config: {
          enabled: true, cronSchedule: '0 3 * * *',
          minEvidenceCount: 2, successRateThreshold: 0.8,
          maxCandidatesPerRun: 5,
          // mode 不传 → 默认 'apply'
        },
        llmCall,
      });
      expect(result.refined).toBe(1);
      expect(result.dryRunPending).toBe(0);
      const after = fs.readFileSync(path.join(userSkillsDir, 'dry-target', 'SKILL.md'), 'utf-8');
      expect(after).toContain('improved marker');
      const logRow = db.get<{ pending_approval: number }>(
        `SELECT pending_approval FROM skill_evolution_log WHERE skill_name = 'dry-target'`,
      );
      expect(logRow?.pending_approval).toBe(0);
    });
  });
});
