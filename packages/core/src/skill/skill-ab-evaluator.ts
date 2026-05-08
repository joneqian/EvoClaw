/**
 * Skill A-B 评估器 — M7-Tier3 PR-T3-1b
 *
 * 周期性扫描所有 active 的 A-B 测试，按 D6 默认阈值决策：
 *   - promote     B 显著优于 A（success +5%+ 且 p<0.05）→ keep B（已是磁盘版本）
 *   - rollback    B 显著差于 A（success -10%+ 且 p<0.05；或 duration ratio ≥1.5）
 *                 → editSkillInternal 写回 A 版本 + 清 cache
 *   - inconclusive 样本不足或差异不显著 → keep B（默认信任 LLM 决策）
 *   - continue    样本未到 min_calls_per_variant 且未到 max_test_days → 继续测试
 *
 * 全部决策都写 skill_evolution_log（trigger_source='ab-promote' | 'ab-rollback' |
 * 'ab-inconclusive'）+ endTest 关闭 ab_test 行。
 *
 * 永不抛异常：单个 test 失败不阻断其他 test 评估。
 */

import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { createLogger } from '../infrastructure/logger.js';
import {
  listActiveTests,
  endTest,
  getOutcomes,
  type AbTestRow,
  type AbOutcomeRow,
} from './skill-ab-store.js';
import { clearVariantFromCache } from './skill-ab-cache.js';
import { mannWhitneyU } from './mann-whitney.js';
import { editSkillInternal } from './skill-manage-tool.js';
import { computeSkillHash } from './skill-manifest.js';

const log = createLogger('skill-ab-evaluator');

/** 评估器配置（D6 默认保守阈值，详见 plan） */
export interface AbEvaluatorConfig {
  /** 每变体最少调用次数才检验，默认 30 */
  minCallsPerVariant: number;
  /** 测试期上限（天），到期强制 inconclusive，默认 7 */
  maxTestDays: number;
  /** B success 提升 ≥ 此值且 p<0.05 → promote；默认 0.05 */
  promoteSuccessDeltaMin: number;
  /** B success 退化 ≥ 此值且 p<0.05 → rollback；默认 0.10 */
  rollbackSuccessDeltaMin: number;
  /** p 值阈值，默认 0.05 */
  pValueThreshold: number;
  /** B 中位数 duration 是 A 的几倍触发 rollback，默认 1.5（B 慢 50%+） */
  durationRatioRollback: number;
}

export const DEFAULT_AB_EVALUATOR_CONFIG: AbEvaluatorConfig = {
  minCallsPerVariant: 30,
  maxTestDays: 7,
  promoteSuccessDeltaMin: 0.05,
  rollbackSuccessDeltaMin: 0.10,
  pValueThreshold: 0.05,
  durationRatioRollback: 1.5,
};

/** 评估单个测试的决策（不实际执行） */
export type EvaluationDecision =
  | { type: 'continue'; reason: string }
  | { type: 'promote'; reason: string; pValue: number; effectSize: number }
  | { type: 'rollback'; reason: string; pValue: number | null; effectSize: number }
  | { type: 'inconclusive'; reason: string; pValue: number | null; effectSize: number };

/** 评估单个 A-B 测试（纯函数，无副作用） */
export function evaluateAbTest(
  test: AbTestRow,
  outcomes: AbOutcomeRow[],
  config: AbEvaluatorConfig = DEFAULT_AB_EVALUATOR_CONFIG,
  now: Date = new Date(),
): EvaluationDecision {
  const a = outcomes.filter(o => o.variant === 'A');
  const b = outcomes.filter(o => o.variant === 'B');

  const startedMs = Date.parse(test.startedAt);
  const elapsedMs = now.getTime() - startedMs;
  const elapsedDays = elapsedMs / 86400_000;
  const expired = elapsedDays >= (test.maxTestDays || config.maxTestDays);

  const minCalls = test.minCallsPerVariant || config.minCallsPerVariant;
  const enoughSamples = a.length >= minCalls && b.length >= minCalls;

  if (!enoughSamples && !expired) {
    return {
      type: 'continue',
      reason: `samples insufficient: A=${a.length}/${minCalls} B=${b.length}/${minCalls}; elapsed=${elapsedDays.toFixed(1)}d/${test.maxTestDays}d`,
    };
  }

  // 过期但样本严重不足 → inconclusive
  if (expired && (a.length < 5 || b.length < 5)) {
    return {
      type: 'inconclusive',
      reason: `expired but samples too sparse: A=${a.length} B=${b.length}`,
      pValue: null,
      effectSize: 0,
    };
  }

  // Success rate 对比
  const aSuccessCount = a.filter(o => o.success === 1).length;
  const bSuccessCount = b.filter(o => o.success === 1).length;
  const aRate = a.length > 0 ? aSuccessCount / a.length : 0;
  const bRate = b.length > 0 ? bSuccessCount / b.length : 0;
  const successDiff = bRate - aRate;

  // Duration 对比（仅看有 duration 的）
  const aDur = a
    .map(o => o.durationMs)
    .filter((v): v is number => typeof v === 'number');
  const bDur = b
    .map(o => o.durationMs)
    .filter((v): v is number => typeof v === 'number');
  const aMedian = median(aDur);
  const bMedian = median(bDur);
  const durationRatio = aMedian > 0 ? bMedian / aMedian : 1;

  // Mann-Whitney U on success（0/1 二值）
  const aSuccessVec = a.map(o => o.success ?? 0);
  const bSuccessVec = b.map(o => o.success ?? 0);
  const mw = mannWhitneyU(aSuccessVec, bSuccessVec);

  // 决策矩阵
  // 1) duration 严重退化 → rollback（即使 success 不显著）
  if (durationRatio >= config.durationRatioRollback && bDur.length >= minCalls / 2) {
    return {
      type: 'rollback',
      reason: `B duration median +${((durationRatio - 1) * 100).toFixed(0)}% (≥${((config.durationRatioRollback - 1) * 100).toFixed(0)}% 阈值)`,
      pValue: null,
      effectSize: durationRatio - 1,
    };
  }

  // 2) success 显著退化 → rollback
  if (successDiff <= -config.rollbackSuccessDeltaMin && mw.pValue < config.pValueThreshold) {
    return {
      type: 'rollback',
      reason: `B success ${(successDiff * 100).toFixed(1)}% (≥${(config.rollbackSuccessDeltaMin * 100).toFixed(0)}% 退化) p=${mw.pValue.toFixed(3)}`,
      pValue: mw.pValue,
      effectSize: successDiff,
    };
  }

  // 3) success 显著提升 → promote
  if (successDiff >= config.promoteSuccessDeltaMin && mw.pValue < config.pValueThreshold) {
    return {
      type: 'promote',
      reason: `B success +${(successDiff * 100).toFixed(1)}% (≥${(config.promoteSuccessDeltaMin * 100).toFixed(0)}%) p=${mw.pValue.toFixed(3)}`,
      pValue: mw.pValue,
      effectSize: successDiff,
    };
  }

  // 4) 其余 → inconclusive（样本足够但差异不显著；或过期但样本足够也走这里）
  return {
    type: 'inconclusive',
    reason: `Δsuccess=${(successDiff * 100).toFixed(1)}% durRatio=${durationRatio.toFixed(2)} p=${mw.pValue.toFixed(3)}`,
    pValue: mw.pValue,
    effectSize: successDiff,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

// ═══════════════════════════════════════════════════════════════════════════
// 决策执行
// ═══════════════════════════════════════════════════════════════════════════

export interface ExecuteDecisionContext {
  db: SqliteStore;
  test: AbTestRow;
  decision: Exclude<EvaluationDecision, { type: 'continue' }>;
  userSkillsDir: string;
  /** A 版本内容（rollback 时写回磁盘）。从 .ab-cache/ 读入 */
  variantAContent?: string;
}

export interface ExecuteDecisionResult {
  /** 是否成功执行 */
  success: boolean;
  /** 错误描述（success=false 时填） */
  error?: string;
}

/**
 * 执行决策：
 *   - promote     endTest('promoted') + 清 A cache（B 已是磁盘版本）
 *   - rollback    editSkillInternal 写回 A 内容 + endTest('rolled_back') + 清 cache + 写 evolution_log
 *   - inconclusive endTest('inconclusive') + 清 A cache（B 保留为磁盘版本）
 *
 * 永不抛异常 — 失败时返回 { success: false, error }。
 */
export async function executeDecision(
  ctx: ExecuteDecisionContext,
): Promise<ExecuteDecisionResult> {
  const { db, test, decision, userSkillsDir } = ctx;

  try {
    if (decision.type === 'rollback') {
      // 必须有 A 内容才能 rollback
      if (!ctx.variantAContent) {
        const err = `rollback failed: variantAContent missing (cache miss)`;
        log.warn(err, { skillName: test.skillName, abTestId: test.id });
        return { success: false, error: err };
      }
      // 写回 A 版本（完整 scan + atomic write + manifest 更新）
      const res = await editSkillInternal({
        name: test.skillName,
        content: ctx.variantAContent,
        userSkillsDir,
      });
      if (!res.success) {
        const err = `editSkillInternal failed: ${res.error ?? 'unknown'}`;
        log.warn(err, { skillName: test.skillName, abTestId: test.id });
        return { success: false, error: err };
      }
      const restoredHash = computeSkillHash(ctx.variantAContent);

      // 写 audit log（trigger_source='ab-rollback'）
      try {
        db.run(
          `INSERT INTO skill_evolution_log (
            skill_name, decision, reasoning, evidence_count, evidence_summary,
            previous_hash, new_hash, previous_content, new_content, trigger_source
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          test.skillName,
          'skip',  // 决策语义上是"撤销 refine"，不是新 refine；用 skip 防误读
          `[ab-rollback #${test.id}] ${decision.reason}`,
          0,
          JSON.stringify({ abTestId: test.id, decision: decision.type }),
          test.variantBHash,   // 当前磁盘是 B
          restoredHash,        // 写回后是 A（重算 hash 防 cache 污染）
          null,                // previousContent 不存（A 内容就是 newContent）
          ctx.variantAContent,
          'ab-rollback',
        );
      } catch (err) {
        log.warn(`audit log failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // promote / inconclusive 不改 SKILL.md（B 已是磁盘版本）
    // 只需要 endTest + 清 A cache
    endTest(
      db,
      test.id,
      decision.type === 'promote' ? 'promoted' :
      decision.type === 'rollback' ? 'rolled_back' : 'inconclusive',
      decision.reason,
      decision.pValue,
      decision.effectSize,
    );

    // 清 A 版本 cache（rollback 已写回磁盘，B cache 不需要；promote/inconclusive 也无需 A cache）
    clearVariantFromCache(userSkillsDir, test.skillName, test.variantAHash);

    log.info(`A-B test ${decision.type}`, {
      skillName: test.skillName,
      abTestId: test.id,
      reason: decision.reason,
    });
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`executeDecision failed: ${msg}`, { skillName: test.skillName, abTestId: test.id });
    return { success: false, error: msg };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 主入口：跑一次完整 cycle
// ═══════════════════════════════════════════════════════════════════════════

import { readVariantFromCache } from './skill-ab-cache.js';

export interface RunEvaluatorCycleOptions {
  db: SqliteStore;
  userSkillsDir: string;
  config?: AbEvaluatorConfig;
  /** 当前时间注入（测试用） */
  now?: Date;
}

export interface EvaluatorCycleResult {
  scanned: number;
  promoted: number;
  rolledBack: number;
  inconclusive: number;
  continued: number;
  errors: number;
}

/**
 * 评估所有 active A-B 测试。供 SkillAbEvaluatorScheduler cron 触发 + REST 手动触发。
 */
export async function runEvaluatorCycle(opts: RunEvaluatorCycleOptions): Promise<EvaluatorCycleResult> {
  const config = opts.config ?? DEFAULT_AB_EVALUATOR_CONFIG;
  const now = opts.now ?? new Date();
  const result: EvaluatorCycleResult = {
    scanned: 0, promoted: 0, rolledBack: 0, inconclusive: 0, continued: 0, errors: 0,
  };

  const tests = listActiveTests(opts.db);
  result.scanned = tests.length;
  log.info(`evaluator cycle start: ${tests.length} active tests`);

  for (const test of tests) {
    try {
      const outcomes = getOutcomes(opts.db, test.id);
      const decision = evaluateAbTest(test, outcomes, config, now);

      if (decision.type === 'continue') {
        result.continued++;
        log.debug(`continue ${test.skillName}: ${decision.reason}`);
        continue;
      }

      // rollback 需要 A 内容
      let variantAContent: string | undefined;
      if (decision.type === 'rollback') {
        const cached = readVariantFromCache(opts.userSkillsDir, test.skillName, test.variantAHash);
        if (cached) variantAContent = cached;
      }

      const exec = await executeDecision({
        db: opts.db,
        test,
        decision,
        userSkillsDir: opts.userSkillsDir,
        ...(variantAContent !== undefined ? { variantAContent } : {}),
      });

      if (!exec.success) {
        result.errors++;
        continue;
      }

      if (decision.type === 'promote') result.promoted++;
      else if (decision.type === 'rollback') result.rolledBack++;
      else result.inconclusive++;
    } catch (err) {
      result.errors++;
      log.warn(`evaluator failed for ${test.skillName}`, { err: String(err) });
    }
  }

  log.info(`evaluator cycle done`, { ...result });
  return result;
}
