/**
 * M7-Tier3 PR-T3-1b: skill-ab-evaluator 决策矩阵 + 集成测试
 *
 * 覆盖：
 *   - 样本不足 → continue
 *   - B 显著好（success +5%+ p<0.05）→ promote
 *   - B 显著差（success -10%+ p<0.05）→ rollback
 *   - B duration 慢 1.5x+ → rollback
 *   - 差异不显著 → inconclusive
 *   - 过期但样本严重不足 → inconclusive
 *   - 过期 + 足够样本但差异不显著 → inconclusive
 *   - executeDecision rollback 写回 A 内容
 *   - executeDecision 写 audit log
 *   - runEvaluatorCycle 端到端
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import {
  evaluateAbTest,
  executeDecision,
  runEvaluatorCycle,
  DEFAULT_AB_EVALUATOR_CONFIG,
} from '../../skill/skill-ab-evaluator.js';
import {
  startTest,
  recordOutcome,
  findActiveTest,
  type AbTestRow,
} from '../../skill/skill-ab-store.js';
import { writeVariantToCache, readVariantFromCache } from '../../skill/skill-ab-cache.js';
import { upsertManifestEntry, computeSkillHash } from '../../skill/skill-manifest.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', '..', 'infrastructure', 'db', 'migrations');
const MIGRATION_001 = fs.readFileSync(path.join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8');
const MIGRATION_027 = fs.readFileSync(path.join(MIGRATIONS_DIR, '027_skill_usage.sql'), 'utf-8');
const MIGRATION_028 = fs.readFileSync(path.join(MIGRATIONS_DIR, '028_skill_evolution_log.sql'), 'utf-8');
const MIGRATION_029 = fs.readFileSync(path.join(MIGRATIONS_DIR, '029_skill_evolution_content.sql'), 'utf-8');
const MIGRATION_037 = fs.readFileSync(path.join(MIGRATIONS_DIR, '037_skill_inline_review.sql'), 'utf-8');
const MIGRATION_040 = fs.readFileSync(path.join(MIGRATIONS_DIR, '040_skill_ab_test.sql'), 'utf-8');
const MIGRATION_041 = fs.readFileSync(path.join(MIGRATIONS_DIR, '041_skill_ab_outcome.sql'), 'utf-8');
const MIGRATION_042 = fs.readFileSync(path.join(MIGRATIONS_DIR, '042_skill_evolver_pending.sql'), 'utf-8');
const MIGRATION_043 = fs.readFileSync(path.join(MIGRATIONS_DIR, '043_skill_ab_test_canary.sql'), 'utf-8');

describe('skill-ab-evaluator', () => {
  let db: SqliteStore;
  let userSkillsDir: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-eval-'));
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
    db.exec(MIGRATION_043);
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedAbTest(skill = 'arxiv', minCalls = 30): AbTestRow {
    db.run(
      `INSERT INTO skill_evolution_log (skill_name, decision, reasoning, evidence_count) VALUES (?, 'refine', 'init', 1)`,
      skill,
    );
    const evId = db.get<{ id: number }>(`SELECT last_insert_rowid() AS id`)!.id;
    startTest(db, {
      skillName: skill, evolutionLogId: evId,
      variantAHash: 'aaa111', variantBHash: 'bbb222',
      minCallsPerVariant: minCalls,
    });
    return findActiveTest(db, skill)!;
  }

  function seedOutcomes(abTestId: number, variant: 'A' | 'B', successCount: number, failureCount: number, durationMs?: number) {
    for (let i = 0; i < successCount; i++) {
      recordOutcome(db, { abTestId, variant, success: true, durationMs: durationMs ?? 100 });
    }
    for (let i = 0; i < failureCount; i++) {
      recordOutcome(db, { abTestId, variant, success: false, durationMs: durationMs ?? 100 });
    }
  }

  // ─── evaluateAbTest 决策矩阵 ───────────────────────────────────────

  describe('evaluateAbTest', () => {
    it('样本不足 + 未过期 → continue', () => {
      const test = seedAbTest('arxiv', 30);
      seedOutcomes(test.id, 'A', 5, 5);
      seedOutcomes(test.id, 'B', 5, 5);
      const outcomes = db.all<any>(`SELECT id, ab_test_id AS abTestId, variant, success, duration_ms AS durationMs FROM skill_ab_outcome`);
      const decision = evaluateAbTest(test, outcomes);
      expect(decision.type).toBe('continue');
    });

    it('B 显著好（25/5 vs 5/25） → promote', () => {
      const test = seedAbTest('arxiv', 30);
      seedOutcomes(test.id, 'A', 5, 25);   // success 17%
      seedOutcomes(test.id, 'B', 25, 5);   // success 83%
      const outcomes = db.all<any>(`SELECT id, ab_test_id AS abTestId, variant, success, duration_ms AS durationMs FROM skill_ab_outcome`);
      const decision = evaluateAbTest(test, outcomes);
      expect(decision.type).toBe('promote');
      if (decision.type === 'promote') {
        expect(decision.pValue).toBeLessThan(0.05);
        expect(decision.effectSize).toBeGreaterThan(0.5);
      }
    });

    it('B 显著差（5/25 vs 25/5） → rollback', () => {
      const test = seedAbTest('arxiv', 30);
      seedOutcomes(test.id, 'A', 25, 5);
      seedOutcomes(test.id, 'B', 5, 25);
      const outcomes = db.all<any>(`SELECT id, ab_test_id AS abTestId, variant, success, duration_ms AS durationMs FROM skill_ab_outcome`);
      const decision = evaluateAbTest(test, outcomes);
      expect(decision.type).toBe('rollback');
      if (decision.type === 'rollback') {
        expect(decision.effectSize).toBeLessThan(-0.1);
      }
    });

    it('B duration 慢 2x → rollback（即使 success 相当）', () => {
      const test = seedAbTest('arxiv', 30);
      // success 都是 25/5（无差异），duration B 慢 2x
      for (let i = 0; i < 25; i++) recordOutcome(db, { abTestId: test.id, variant: 'A', success: true, durationMs: 100 });
      for (let i = 0; i < 5; i++) recordOutcome(db, { abTestId: test.id, variant: 'A', success: false, durationMs: 100 });
      for (let i = 0; i < 25; i++) recordOutcome(db, { abTestId: test.id, variant: 'B', success: true, durationMs: 200 });
      for (let i = 0; i < 5; i++) recordOutcome(db, { abTestId: test.id, variant: 'B', success: false, durationMs: 200 });

      const outcomes = db.all<any>(`SELECT id, ab_test_id AS abTestId, variant, success, duration_ms AS durationMs FROM skill_ab_outcome`);
      const decision = evaluateAbTest(test, outcomes);
      expect(decision.type).toBe('rollback');
      if (decision.type === 'rollback') {
        expect(decision.reason).toContain('duration');
      }
    });

    it('差异微小（5%）+ 足够样本 → inconclusive（验证 D6 论据）', () => {
      const test = seedAbTest('arxiv', 30);
      seedOutcomes(test.id, 'A', 24, 6);  // 80%
      seedOutcomes(test.id, 'B', 22, 8);  // 73%
      const outcomes = db.all<any>(`SELECT id, ab_test_id AS abTestId, variant, success, duration_ms AS durationMs FROM skill_ab_outcome`);
      const decision = evaluateAbTest(test, outcomes);
      // N=30 下 7% 差异 power 不足 → 不达 promote/rollback 阈值
      expect(decision.type).toBe('inconclusive');
    });

    it('过期且样本严重不足（< 5）→ inconclusive', () => {
      const test = seedAbTest('arxiv', 30);
      seedOutcomes(test.id, 'A', 1, 1);
      seedOutcomes(test.id, 'B', 1, 1);
      const outcomes = db.all<any>(`SELECT id, ab_test_id AS abTestId, variant, success, duration_ms AS durationMs FROM skill_ab_outcome`);
      // mock 一个过期的 startedAt
      const futureNow = new Date(Date.parse(test.startedAt) + 8 * 86400_000);
      const decision = evaluateAbTest(test, outcomes, DEFAULT_AB_EVALUATOR_CONFIG, futureNow);
      expect(decision.type).toBe('inconclusive');
    });

    it('过期 + 足够样本但差异不显著 → inconclusive（不再 continue）', () => {
      const test = seedAbTest('arxiv', 30);
      seedOutcomes(test.id, 'A', 15, 5);  // 75%
      seedOutcomes(test.id, 'B', 16, 4);  // 80%（小差异）
      const outcomes = db.all<any>(`SELECT id, ab_test_id AS abTestId, variant, success, duration_ms AS durationMs FROM skill_ab_outcome`);
      const futureNow = new Date(Date.parse(test.startedAt) + 8 * 86400_000);
      const decision = evaluateAbTest(test, outcomes, DEFAULT_AB_EVALUATOR_CONFIG, futureNow);
      // 即使样本未达 30，过期且 ≥5 也走 inconclusive 决策路径
      expect(decision.type).toBe('inconclusive');
    });
  });

  // ─── executeDecision ────────────────────────────────────────────────

  describe('executeDecision rollback', () => {
    it('rollback 成功 → A 内容写回 SKILL.md + endTest + audit log', async () => {
      // 准备 skill 目录 + manifest
      const skillName = 'arxiv';
      const aContent = '---\nname: arxiv\ndescription: A version\n---\n\nold body\n';
      const bContent = '---\nname: arxiv\ndescription: B version\n---\n\nnew body\n';
      const skillDir = path.join(userSkillsDir, skillName);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), bContent, 'utf-8');
      upsertManifestEntry(userSkillsDir, {
        name: skillName, sha256: computeSkillHash(bContent),
        source: 'bundled', createdAt: '2026-01-01T00:00:00Z',
      });
      // 物化 A 到 cache
      const aHash = computeSkillHash(aContent);
      writeVariantToCache(userSkillsDir, skillName, aHash, aContent);

      // 起 ab_test
      const test = seedAbTest(skillName, 30);
      // override variant_a_hash to match
      db.run(`UPDATE skill_ab_test SET variant_a_hash = ? WHERE id = ?`, aHash, test.id);
      const refreshedTest = findActiveTest(db, skillName)!;

      const result = await executeDecision({
        db, test: refreshedTest, userSkillsDir,
        variantAContent: aContent,
        decision: { type: 'rollback', reason: 'B failed', pValue: 0.01, effectSize: -0.20 },
      });
      expect(result.success).toBe(true);

      // SKILL.md 现在是 A 内容
      const onDisk = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');
      expect(onDisk).toContain('old body');

      // ab_test 关闭
      expect(findActiveTest(db, skillName)).toBeNull();

      // audit log 有新行
      const log = db.get<{ trigger_source: string; reasoning: string }>(
        `SELECT trigger_source, reasoning FROM skill_evolution_log WHERE skill_name = ? AND trigger_source = 'ab-rollback'`,
        skillName,
      );
      expect(log).toBeDefined();
      expect(log!.reasoning).toContain('ab-rollback');

      // A cache 被清理
      expect(readVariantFromCache(userSkillsDir, skillName, aHash)).toBeNull();
    });

    it('rollback 缺 variantAContent → 失败不写回', async () => {
      const skillName = 'arxiv';
      const test = seedAbTest(skillName, 30);
      const result = await executeDecision({
        db, test, userSkillsDir,
        decision: { type: 'rollback', reason: 'B failed', pValue: 0.01, effectSize: -0.20 },
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('variantAContent');
      // ab_test 仍 active（未 endTest）
      expect(findActiveTest(db, skillName)).not.toBeNull();
    });
  });

  describe('executeDecision promote / inconclusive', () => {
    it('promote → endTest + 清 A cache（不改 SKILL.md）', async () => {
      const skillName = 'arxiv';
      const aHash = 'aaa111';
      writeVariantToCache(userSkillsDir, skillName, aHash, '---\nname: arxiv\ndescription: A\n---\n\nA\n');
      const test = seedAbTest(skillName, 30);
      const result = await executeDecision({
        db, test, userSkillsDir,
        decision: { type: 'promote', reason: 'B better', pValue: 0.01, effectSize: 0.15 },
      });
      expect(result.success).toBe(true);
      expect(findActiveTest(db, skillName)).toBeNull();
      // A cache 清掉
      expect(readVariantFromCache(userSkillsDir, skillName, aHash)).toBeNull();
    });

    it('inconclusive → endTest + 清 A cache', async () => {
      const skillName = 'arxiv';
      const aHash = 'aaa111';
      writeVariantToCache(userSkillsDir, skillName, aHash, 'A content');
      const test = seedAbTest(skillName, 30);
      const result = await executeDecision({
        db, test, userSkillsDir,
        decision: { type: 'inconclusive', reason: 'no signal', pValue: 0.5, effectSize: 0.01 },
      });
      expect(result.success).toBe(true);
      // 状态正确
      const closed = db.get<{ status: string }>(`SELECT status FROM skill_ab_test WHERE id = ?`, test.id);
      expect(closed!.status).toBe('inconclusive');
    });
  });

  // ─── runEvaluatorCycle 端到端 ──────────────────────────────────────

  describe('runEvaluatorCycle', () => {
    it('多个 active 测试，按决策分别处理', async () => {
      // Test 1: continue（样本不足）
      const t1 = seedAbTest('skill-1', 30);
      seedOutcomes(t1.id, 'A', 5, 5);
      seedOutcomes(t1.id, 'B', 5, 5);

      // Test 2: promote（B 好）
      const t2 = seedAbTest('skill-2', 30);
      seedOutcomes(t2.id, 'A', 5, 25);
      seedOutcomes(t2.id, 'B', 25, 5);

      // Test 3: inconclusive（差异微小）
      const t3 = seedAbTest('skill-3', 30);
      seedOutcomes(t3.id, 'A', 24, 6);
      seedOutcomes(t3.id, 'B', 22, 8);

      const result = await runEvaluatorCycle({ db, userSkillsDir });
      expect(result.scanned).toBe(3);
      expect(result.continued).toBe(1);
      expect(result.promoted).toBe(1);
      expect(result.inconclusive).toBe(1);
      expect(result.rolledBack).toBe(0);
    });

    it('空数据库 → cycle 0 个', async () => {
      const result = await runEvaluatorCycle({ db, userSkillsDir });
      expect(result.scanned).toBe(0);
    });
  });
});
