/**
 * Skill A-B 测试存储层 — M7-Tier3 PR-T3-1a
 *
 * 提供 skill_ab_test + skill_ab_outcome 两表的封装：
 *   - findActiveTest / startTest / endTest    — 主表生命周期
 *   - recordOutcome / getOutcomes              — 调用 outcome
 *   - assignBucket                             — hash 确定性桶位（D2 默认）
 *
 * 设计取舍：
 *   - 桶位 hash function = SHA-1（Node 内置 crypto，无外部依赖）
 *   - 同 (sessionKey, skillName, abTestId) 永远落同一桶（用户体验稳定）
 *   - 不同 abTestId 重新洗牌（防对同一用户长期偏向同一变体）
 *   - 永不抛异常（A-B 是辅助通路，主流程不受影响）
 */

import crypto from 'node:crypto';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('skill-ab-store');

export type AbTestStatus = 'active' | 'promoted' | 'rolled_back' | 'inconclusive';
export type AbVariant = 'A' | 'B';

export interface AbTestRow {
  id: number;
  skillName: string;
  evolutionLogId: number;
  status: AbTestStatus;
  variantAHash: string;
  variantBHash: string;
  startedAt: string;
  endedAt: string | null;
  minCallsPerVariant: number;
  maxTestDays: number;
  decisionReason: string | null;
  pValue: number | null;
  effectSize: number | null;
  /** M7-Tier3 PR-T3-2b: canary 模式标记（1=is_canary） */
  isCanary: number;
  /** M7-Tier3 PR-T3-2b: canary B 桶比例（仅 isCanary=1 时有意义） */
  canaryRatioB: number | null;
}

export interface AbOutcomeRow {
  id: number;
  abTestId: number;
  variant: AbVariant;
  invokedAt: string;
  sessionKey: string | null;
  agentId: string | null;
  success: number | null;
  durationMs: number | null;
  toolCallsCount: number | null;
  userFeedback: number | null;
}

export interface StartAbTestInput {
  skillName: string;
  evolutionLogId: number;
  variantAHash: string;
  variantBHash: string;
  /** 默认 30；ConfigManager 可覆盖 */
  minCallsPerVariant?: number;
  /** 默认 7 天；ConfigManager 可覆盖 */
  maxTestDays?: number;
  /**
   * M7-Tier3 PR-T3-2b: canary B 桶比例（5%-50%）
   * 给值 → 标 is_canary=1 + canary_ratio_b=value
   * undefined → 默认 50/50 经典 A-B
   */
  canaryRatioB?: number;
}

export interface RecordOutcomeInput {
  abTestId: number;
  variant: AbVariant;
  sessionKey?: string;
  agentId?: string;
  success?: boolean;
  durationMs?: number;
  toolCallsCount?: number;
  userFeedback?: 1 | -1 | null;
}

const ROW_COLUMNS = `
  id,
  skill_name           AS skillName,
  evolution_log_id     AS evolutionLogId,
  status,
  variant_a_hash       AS variantAHash,
  variant_b_hash       AS variantBHash,
  started_at           AS startedAt,
  ended_at             AS endedAt,
  min_calls_per_variant AS minCallsPerVariant,
  max_test_days        AS maxTestDays,
  decision_reason      AS decisionReason,
  p_value              AS pValue,
  effect_size          AS effectSize,
  is_canary            AS isCanary,
  canary_ratio_b       AS canaryRatioB
`;

/**
 * 按 skill 名查找当前 active 的 A-B 测试。
 * 同一 skill 同时只允许 1 个 active 测试（不变量，由 startTest 保证）。
 * 返回 null = 不在 A-B 期。
 */
export function findActiveTest(db: SqliteStore, skillName: string): AbTestRow | null {
  try {
    const row = db.get<AbTestRow>(
      `SELECT ${ROW_COLUMNS} FROM skill_ab_test
       WHERE skill_name = ? AND status = 'active'
       ORDER BY started_at DESC LIMIT 1`,
      skillName,
    );
    return row ?? null;
  } catch (err) {
    log.warn(`findActiveTest failed (${skillName}): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * 启动一次 A-B 测试。
 * 调用方应先确保同 skill 没有 active 测试（findActiveTest 返回 null）。
 *
 * 返回 ab_test_id（成功）或 null（失败）。
 */
export function startTest(db: SqliteStore, input: StartAbTestInput): number | null {
  try {
    // 防御性：拒绝创建第 2 个 active（理论上不应发生，但兜底）
    const existing = findActiveTest(db, input.skillName);
    if (existing) {
      log.warn(`startTest rejected: ${input.skillName} already has active test #${existing.id}`);
      return null;
    }

    const isCanary = input.canaryRatioB !== undefined ? 1 : 0;
    db.run(
      `INSERT INTO skill_ab_test (
        skill_name, evolution_log_id, status,
        variant_a_hash, variant_b_hash,
        min_calls_per_variant, max_test_days,
        is_canary, canary_ratio_b
      ) VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
      input.skillName,
      input.evolutionLogId,
      input.variantAHash,
      input.variantBHash,
      input.minCallsPerVariant ?? 30,
      input.maxTestDays ?? 7,
      isCanary,
      input.canaryRatioB ?? null,
    );
    const idRow = db.get<{ id: number }>(`SELECT last_insert_rowid() AS id`);
    if (!idRow) return null;
    log.info(`A-B test started`, {
      id: idRow.id,
      skillName: input.skillName,
      variantAHash: input.variantAHash.slice(0, 8),
      variantBHash: input.variantBHash.slice(0, 8),
    });
    return idRow.id;
  } catch (err) {
    log.warn(`startTest failed (${input.skillName}): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** 结束测试（评估器 PR-T3-1b 用） */
export function endTest(
  db: SqliteStore,
  id: number,
  status: Exclude<AbTestStatus, 'active'>,
  decisionReason: string,
  pValue: number | null = null,
  effectSize: number | null = null,
): boolean {
  try {
    db.run(
      `UPDATE skill_ab_test
       SET status = ?, ended_at = datetime('now'),
           decision_reason = ?, p_value = ?, effect_size = ?
       WHERE id = ? AND status = 'active'`,
      status, decisionReason, pValue, effectSize, id,
    );
    log.info(`A-B test ended`, { id, status, reason: decisionReason });
    return true;
  } catch (err) {
    log.warn(`endTest failed (id=${id}): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** 记录单次调用 outcome */
export function recordOutcome(db: SqliteStore, input: RecordOutcomeInput): void {
  try {
    db.run(
      `INSERT INTO skill_ab_outcome (
        ab_test_id, variant, session_key, agent_id,
        success, duration_ms, tool_calls_count, user_feedback
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      input.abTestId,
      input.variant,
      input.sessionKey ?? null,
      input.agentId ?? null,
      input.success === undefined ? null : (input.success ? 1 : 0),
      input.durationMs ?? null,
      input.toolCallsCount ?? null,
      input.userFeedback ?? null,
    );
  } catch (err) {
    // 失败静默 — A-B telemetry 永不阻塞主流程
    log.warn(`recordOutcome failed (id=${input.abTestId}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 列 active 测试（评估器 + UI 用） */
export function listActiveTests(db: SqliteStore): AbTestRow[] {
  try {
    return db.all<AbTestRow>(
      `SELECT ${ROW_COLUMNS} FROM skill_ab_test
       WHERE status = 'active' ORDER BY started_at ASC`,
    );
  } catch (err) {
    log.warn(`listActiveTests failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** 取某测试的所有 outcome（评估器用） */
export function getOutcomes(db: SqliteStore, abTestId: number): AbOutcomeRow[] {
  try {
    return db.all<AbOutcomeRow>(
      `SELECT
        id,
        ab_test_id        AS abTestId,
        variant,
        invoked_at        AS invokedAt,
        session_key       AS sessionKey,
        agent_id          AS agentId,
        success,
        duration_ms       AS durationMs,
        tool_calls_count  AS toolCallsCount,
        user_feedback     AS userFeedback
       FROM skill_ab_outcome
       WHERE ab_test_id = ?
       ORDER BY invoked_at ASC`,
      abTestId,
    );
  } catch (err) {
    log.warn(`getOutcomes failed (id=${abTestId}): ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * 桶位分配（D2 hash 确定性）
 *
 * 算法：
 *   - 默认（ratioB=undefined）：SHA-1 首字节奇偶 → A/B（约 50/50，PR-T3-1a 行为）
 *   - canary（ratioB=0.1）：SHA-1 前 4 字节 mod 1000 落 [0, ratioB*1000) 为 B
 *
 * 不变量：
 *   - 同 (sessionKey, skillName, abTestId) 永远同变体（同 session 行为稳定）
 *   - 不同 abTestId 重新洗牌（防同一用户长期偏向同一变体）
 *   - ratioB 不变时分布稳定（10000 次模拟统计偏差 < 2%）
 *
 * sessionKey 为空时退化到 hash(`anon:<skillName>:<abTestId>`)，仍确定性但全局
 * 偏 A 或 B 视 (skillName, abTestId) 而定 — 这是 acceptable 因匿名调用罕见。
 */
export function assignBucket(
  sessionKey: string | undefined,
  skillName: string,
  abTestId: number,
  /** M7-Tier3 PR-T3-2b: canary 模式下 B 桶比例（0~1）。undefined → 50/50 */
  ratioB?: number,
): AbVariant {
  const key = `${sessionKey ?? 'anon'}:${skillName}:${abTestId}`;
  const hash = crypto.createHash('sha1').update(key).digest();
  if (ratioB === undefined) {
    // 默认：首字节最低位 = 0 → A; = 1 → B
    return (hash[0]! & 1) === 0 ? 'A' : 'B';
  }
  // canary：取 hash 前 4 字节做大整数 → mod 1000 → 落 [0, 1000*ratioB) 为 B
  const bucket = ((hash[0]! << 24) | (hash[1]! << 16) | (hash[2]! << 8) | hash[3]!) >>> 0;
  return (bucket % 1000) < (ratioB * 1000) ? 'B' : 'A';
}
