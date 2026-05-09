/**
 * M7-Tier3 PR-T3-1a: skill-ab-store 单元测试
 *
 * 覆盖：
 *   - assignBucket 确定性 + 分布
 *   - findActiveTest / startTest / endTest 生命周期
 *   - recordOutcome / getOutcomes
 *   - 同 skill 不允许并发 active 测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import {
  findActiveTest,
  startTest,
  endTest,
  recordOutcome,
  listActiveTests,
  getOutcomes,
  assignBucket,
} from '../../skill/skill-ab-store.js';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', '..', 'infrastructure', 'db', 'migrations');
const MIGRATION_001 = fs.readFileSync(path.join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8');
const MIGRATION_028 = fs.readFileSync(path.join(MIGRATIONS_DIR, '028_skill_evolution_log.sql'), 'utf-8');
const MIGRATION_040 = fs.readFileSync(path.join(MIGRATIONS_DIR, '040_skill_ab_test.sql'), 'utf-8');
const MIGRATION_041 = fs.readFileSync(path.join(MIGRATIONS_DIR, '041_skill_ab_outcome.sql'), 'utf-8');
const MIGRATION_043 = fs.readFileSync(path.join(MIGRATIONS_DIR, '043_skill_ab_test_canary.sql'), 'utf-8');

describe('skill-ab-store', () => {
  let db: SqliteStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-store-'));
    db = new SqliteStore(path.join(tmpDir, 'test.db'));
    db.exec(MIGRATION_001);
    db.exec(MIGRATION_028);
    db.exec(MIGRATION_040);
    db.exec(MIGRATION_041);
    db.exec(MIGRATION_043);
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** 灌一条 evolution_log 用于 FK 约束 */
  function seedEvolutionLog(skillName = 'arxiv'): number {
    db.run(
      `INSERT INTO skill_evolution_log (skill_name, decision, reasoning, evidence_count)
       VALUES (?, 'refine', 'test', 0)`,
      skillName,
    );
    const row = db.get<{ id: number }>(`SELECT last_insert_rowid() AS id`);
    return row!.id;
  }

  // ─── assignBucket 桶位 ─────────────────────────────────────────────

  describe('assignBucket', () => {
    it('同 (sessionKey, skillName, abTestId) → 同变体', () => {
      const a = assignBucket('s1', 'arxiv', 1);
      const b = assignBucket('s1', 'arxiv', 1);
      expect(a).toBe(b);
    });

    it('不同 abTestId → 重新洗牌（不强制不同，但概率上半数会换）', () => {
      let switched = 0;
      for (let i = 0; i < 200; i++) {
        const v1 = assignBucket(`session-${i}`, 'arxiv', 1);
        const v2 = assignBucket(`session-${i}`, 'arxiv', 2);
        if (v1 !== v2) switched++;
      }
      // SHA-1 输出独立，期望 ~100；允许大幅偏差
      expect(switched).toBeGreaterThan(50);
      expect(switched).toBeLessThan(150);
    });

    it('整体分布近似 50/50（200 个 sessionKey）', () => {
      let aCount = 0;
      for (let i = 0; i < 200; i++) {
        if (assignBucket(`s${i}`, 'arxiv', 1) === 'A') aCount++;
      }
      // SHA-1 均匀，200 个样本下 |A - 100| <= 25 是合理范围
      expect(aCount).toBeGreaterThan(75);
      expect(aCount).toBeLessThan(125);
    });

    it('sessionKey=undefined 时仍是确定性（落 anon）', () => {
      const a = assignBucket(undefined, 'arxiv', 1);
      const b = assignBucket(undefined, 'arxiv', 1);
      expect(a).toBe(b);
    });

    it('返回值仅 A 或 B', () => {
      for (let i = 0; i < 50; i++) {
        const v = assignBucket(`s${i}`, 'skill', i);
        expect(v === 'A' || v === 'B').toBe(true);
      }
    });

    // ─── M7-Tier3 PR-T3-2b: canary 桶位偏置 ───
    it('ratioB=undefined 时退化到 50/50（向后兼容）', () => {
      // 跑 5000 次，B 比例应在 [0.45, 0.55]
      let bCount = 0;
      const N = 5000;
      for (let i = 0; i < N; i++) {
        if (assignBucket(`session-${i}`, 'arxiv', 1, undefined) === 'B') bCount++;
      }
      const ratio = bCount / N;
      expect(ratio).toBeGreaterThan(0.45);
      expect(ratio).toBeLessThan(0.55);
    });

    it('ratioB=0.1 时 B 桶 ~10%（10000 次模拟，偏差 < 2%）', () => {
      let bCount = 0;
      const N = 10000;
      for (let i = 0; i < N; i++) {
        if (assignBucket(`session-${i}`, 'arxiv', 1, 0.1) === 'B') bCount++;
      }
      const ratio = bCount / N;
      // 期望 0.1 ± 0.02
      expect(ratio).toBeGreaterThan(0.08);
      expect(ratio).toBeLessThan(0.12);
    });

    it('ratioB=0.3 时 B 桶 ~30%（10000 次模拟，偏差 < 3%）', () => {
      let bCount = 0;
      const N = 10000;
      for (let i = 0; i < N; i++) {
        if (assignBucket(`session-${i}`, 'arxiv', 1, 0.3) === 'B') bCount++;
      }
      const ratio = bCount / N;
      expect(ratio).toBeGreaterThan(0.27);
      expect(ratio).toBeLessThan(0.33);
    });

    it('ratioB=0 时永不返回 B；ratioB=1 时永不返回 A', () => {
      // 边界值校验（schema 限制 0.05~0.5，但函数本身应支持极端值不崩）
      let bAt0 = 0, aAt1 = 0;
      for (let i = 0; i < 200; i++) {
        if (assignBucket(`s${i}`, 'arxiv', 1, 0) === 'B') bAt0++;
        if (assignBucket(`s${i}`, 'arxiv', 1, 1) === 'A') aAt1++;
      }
      expect(bAt0).toBe(0);
      expect(aAt1).toBe(0);
    });

    it('canary 模式下同 (sessionKey, skillName, abTestId, ratioB) → 同变体', () => {
      const a = assignBucket('s1', 'arxiv', 1, 0.1);
      const b = assignBucket('s1', 'arxiv', 1, 0.1);
      expect(a).toBe(b);
    });
  });

  // ─── 主表 CRUD ──────────────────────────────────────────────────────

  describe('startTest / findActiveTest / endTest', () => {
    it('startTest 成功后 findActiveTest 能查到', () => {
      const evId = seedEvolutionLog('arxiv');
      const id = startTest(db, {
        skillName: 'arxiv',
        evolutionLogId: evId,
        variantAHash: 'aaa111',
        variantBHash: 'bbb222',
      });
      expect(id).not.toBeNull();
      const found = findActiveTest(db, 'arxiv');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(id);
      expect(found!.status).toBe('active');
      expect(found!.variantAHash).toBe('aaa111');
      expect(found!.variantBHash).toBe('bbb222');
      expect(found!.minCallsPerVariant).toBe(30);  // 默认
      expect(found!.maxTestDays).toBe(7);
      // PR-T3-2b: 默认非 canary
      expect(found!.isCanary).toBe(0);
      expect(found!.canaryRatioB).toBeNull();
    });

    it('startTest 传 canaryRatioB → is_canary=1 + canary_ratio_b 持久化', () => {
      const evId = seedEvolutionLog('arxiv');
      const id = startTest(db, {
        skillName: 'arxiv',
        evolutionLogId: evId,
        variantAHash: 'a1', variantBHash: 'b1',
        canaryRatioB: 0.1,
      });
      expect(id).not.toBeNull();
      const found = findActiveTest(db, 'arxiv');
      expect(found!.isCanary).toBe(1);
      expect(found!.canaryRatioB).toBeCloseTo(0.1, 5);
    });

    it('startTest 不传 canaryRatioB → is_canary=0 + canary_ratio_b=null（默认 50/50）', () => {
      const evId = seedEvolutionLog('arxiv');
      const id = startTest(db, {
        skillName: 'arxiv',
        evolutionLogId: evId,
        variantAHash: 'a1', variantBHash: 'b1',
      });
      expect(id).not.toBeNull();
      const found = findActiveTest(db, 'arxiv');
      expect(found!.isCanary).toBe(0);
      expect(found!.canaryRatioB).toBeNull();
    });

    it('未启动 → findActiveTest 返回 null', () => {
      expect(findActiveTest(db, 'nonexistent')).toBeNull();
    });

    it('同 skill 已有 active → 第二次 startTest 返回 null', () => {
      const evId = seedEvolutionLog('arxiv');
      const id1 = startTest(db, {
        skillName: 'arxiv',
        evolutionLogId: evId,
        variantAHash: 'a1', variantBHash: 'b1',
      });
      const id2 = startTest(db, {
        skillName: 'arxiv',
        evolutionLogId: evId,
        variantAHash: 'a2', variantBHash: 'b2',
      });
      expect(id1).not.toBeNull();
      expect(id2).toBeNull();
    });

    it('endTest 后 findActiveTest 返回 null', () => {
      const evId = seedEvolutionLog('arxiv');
      const id = startTest(db, {
        skillName: 'arxiv', evolutionLogId: evId,
        variantAHash: 'a', variantBHash: 'b',
      });
      const ok = endTest(db, id!, 'promoted', 'B success +12% p=0.02', 0.02, 0.12);
      expect(ok).toBe(true);
      expect(findActiveTest(db, 'arxiv')).toBeNull();
    });

    it('endTest 后可以为同 skill 启动新 A-B', () => {
      const evId = seedEvolutionLog('arxiv');
      const id1 = startTest(db, {
        skillName: 'arxiv', evolutionLogId: evId,
        variantAHash: 'a1', variantBHash: 'b1',
      });
      endTest(db, id1!, 'inconclusive', 'no signal');
      const id2 = startTest(db, {
        skillName: 'arxiv', evolutionLogId: evId,
        variantAHash: 'a2', variantBHash: 'b2',
      });
      expect(id2).not.toBeNull();
      expect(id2).not.toBe(id1);
    });

    it('自定义 min_calls / max_days', () => {
      const evId = seedEvolutionLog('arxiv');
      const id = startTest(db, {
        skillName: 'arxiv', evolutionLogId: evId,
        variantAHash: 'a', variantBHash: 'b',
        minCallsPerVariant: 50, maxTestDays: 14,
      });
      const found = findActiveTest(db, 'arxiv');
      expect(found!.id).toBe(id);
      expect(found!.minCallsPerVariant).toBe(50);
      expect(found!.maxTestDays).toBe(14);
    });
  });

  // ─── outcome 记录 ──────────────────────────────────────────────────

  describe('recordOutcome / getOutcomes', () => {
    it('记录 + 查询 outcome 双方对齐', () => {
      const evId = seedEvolutionLog('arxiv');
      const id = startTest(db, {
        skillName: 'arxiv', evolutionLogId: evId,
        variantAHash: 'a', variantBHash: 'b',
      });
      recordOutcome(db, {
        abTestId: id!, variant: 'A',
        sessionKey: 's1', agentId: 'agt-x', success: true, durationMs: 250,
      });
      recordOutcome(db, {
        abTestId: id!, variant: 'B',
        sessionKey: 's2', agentId: 'agt-x', success: false, durationMs: 800,
      });
      const out = getOutcomes(db, id!);
      expect(out).toHaveLength(2);
      expect(out[0].variant).toBe('A');
      expect(out[0].success).toBe(1);
      expect(out[1].variant).toBe('B');
      expect(out[1].success).toBe(0);
      expect(out[1].durationMs).toBe(800);
    });

    it('user_feedback 可为 null / 1 / -1', () => {
      const evId = seedEvolutionLog('arxiv');
      const id = startTest(db, {
        skillName: 'arxiv', evolutionLogId: evId,
        variantAHash: 'a', variantBHash: 'b',
      })!;
      recordOutcome(db, { abTestId: id, variant: 'A', userFeedback: 1 });
      recordOutcome(db, { abTestId: id, variant: 'A', userFeedback: -1 });
      recordOutcome(db, { abTestId: id, variant: 'A', userFeedback: null });
      const out = getOutcomes(db, id);
      expect(out.map(o => o.userFeedback)).toEqual([1, -1, null]);
    });
  });

  // ─── listActiveTests ───────────────────────────────────────────────

  describe('listActiveTests', () => {
    it('返回所有 status=active', () => {
      const evId = seedEvolutionLog('arxiv');
      const evId2 = seedEvolutionLog('summarize');
      startTest(db, { skillName: 'arxiv', evolutionLogId: evId, variantAHash: 'a', variantBHash: 'b' });
      startTest(db, { skillName: 'summarize', evolutionLogId: evId2, variantAHash: 'a', variantBHash: 'b' });
      const tests = listActiveTests(db);
      expect(tests).toHaveLength(2);
    });

    it('endTest 后从列表剔除', () => {
      const evId = seedEvolutionLog('arxiv');
      const id = startTest(db, { skillName: 'arxiv', evolutionLogId: evId, variantAHash: 'a', variantBHash: 'b' })!;
      endTest(db, id, 'promoted', 'done');
      expect(listActiveTests(db)).toHaveLength(0);
    });
  });
});
