/**
 * P1-B Phase 3: Skill 信号驱动 Inline Review
 *
 * 由 turn-end hook 在主会话 turn 结束后异步调用：
 *   void runInlineReview({ ...args }).catch(() => {});
 *
 * 与 cron evolver 的差异：
 * - 触发来源：用户对话中的负反馈强信号（非定时）
 * - 限速：同 skill 10min 内最多 1 次（DB 查 last_inline_review_at）
 * - 防递归：cron / subagent / heartbeat / boot 上下文跳过
 * - 日志：trigger_source='inline' 落 skill_evolution_log
 *
 * 共用：
 * - skill-evolver.ts 的 runEvolverDecision + logEvolutionDecision
 * - skill-evidence-gatherer.ts 的 gatherEvidence
 *
 * 安全保证：
 * - 永不抛异常，所有失败静默落日志
 * - 不阻塞调用方主 turn
 */

import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { createLogger } from '../infrastructure/logger.js';
import type { SkillUsageStore } from './skill-usage-store.js';
import { gatherEvidence } from './skill-evidence-gatherer.js';
import {
  runEvolverDecision,
  logEvolutionDecision,
  type LLMCallFn,
} from './skill-evolver.js';
import type { SignalDetectionResult } from './feedback-signal-detector.js';

const log = createLogger('skill-evolver-inline');

/** 默认限速窗口（分钟）。同一 skill 10min 内最多触发 1 次 inline review。 */
const DEFAULT_RATE_LIMIT_MINUTES = 10;

/** sessionKey 中含这些 marker 时跳过（防递归 + 限主 user turn 触发） */
const NON_MAIN_TURN_MARKERS = [':cron:', ':subagent:', ':heartbeat:', ':boot'] as const;

export interface RunInlineReviewOptions {
  db: SqliteStore;
  store: SkillUsageStore;
  userSkillsDir: string;
  /** feedback-signal-detector 的输出 */
  signal: SignalDetectionResult;
  /** 当前主 turn 的 sessionKey */
  sessionKey: string;
  /** LLM 调用函数（与 cron evolver 同一签名） */
  llmCall: LLMCallFn;
  /** 模型 id（写入审计日志） */
  model?: string;
  /** 限速窗口分钟数，默认 10。设为 0 表示禁用限速 */
  rateLimitMinutes?: number;
  /** Phase 5: 本 session 已用过的 skill 名单（注入 prompt） */
  currentlyUsedSkills?: string[];
}

export interface InlineReviewResult {
  /** 是否真的进入 LLM 流程（false = 被前置门控拦下） */
  triggered: boolean;
  /** triggered=false 时的拒因；triggered=true 时缺省 */
  reason?: string;
  /** triggered=true 时 LLM 决策结果 */
  decision?: 'refine' | 'create' | 'skip';
  durationMs?: number;
}

/**
 * 检测到强信号后异步触发的 Skill review。
 * 永不抛异常 —— 所有失败转为 InlineReviewResult.reason 或静默 log。
 */
export async function runInlineReview(opts: RunInlineReviewOptions): Promise<InlineReviewResult> {
  try {
    return await runInlineReviewInternal(opts);
  } catch (err) {
    log.warn('runInlineReview unexpected error', { err: String(err) });
    return { triggered: false, reason: `unexpected error: ${String(err).slice(0, 200)}` };
  }
}

async function runInlineReviewInternal(opts: RunInlineReviewOptions): Promise<InlineReviewResult> {
  // 1. 信号校验
  if (opts.signal.signal !== 'strong' || !opts.signal.skillName) {
    return { triggered: false, reason: 'no strong signal' };
  }

  // 2. 防递归：仅主 user turn 触发
  for (const marker of NON_MAIN_TURN_MARKERS) {
    if (opts.sessionKey.includes(marker)) {
      log.info('[inline-review-block] event=recursion_guard', { skillName: opts.signal.skillName, marker });
      return { triggered: false, reason: `recursion guard: sessionKey contains "${marker}"` };
    }
  }

  const skillName = opts.signal.skillName;

  // 3. 限速：同 skill 全局 10min 内最多 1 次
  const rateLimitMs = (opts.rateLimitMinutes ?? DEFAULT_RATE_LIMIT_MINUTES) * 60_000;
  if (rateLimitMs > 0) {
    const lastAt = opts.store.getLastInlineReviewAt(skillName);
    if (lastAt) {
      const ageMs = Date.now() - Date.parse(lastAt);
      if (Number.isFinite(ageMs) && ageMs < rateLimitMs) {
        log.info('[inline-review-block] event=rate_limited', { skillName, ageSec: Math.round(ageMs / 1000), windowSec: Math.round(rateLimitMs / 1000) });
        return {
          triggered: false,
          reason: `rate limited: last inline review ${Math.round(ageMs / 1000)}s ago (window=${Math.round(rateLimitMs / 1000)}s)`,
        };
      }
    }
  }

  const start = Date.now();

  // 4. 标记触发 + 写 conversational_feedback 原文（限速去重 + 审计）
  opts.store.markInlineReviewTriggered({ skillName, sessionKey: opts.sessionKey });
  if (opts.signal.evidence) {
    opts.store.recordConversationalFeedback({
      skillName,
      sessionKey: opts.sessionKey,
      feedback: opts.signal.evidence,
    });
  }

  // 5. 取证（带当前 sessionKey 用于 Phase 5 优先级）
  const evidence = gatherEvidence({
    skillName,
    store: opts.store,
    userSkillsDir: opts.userSkillsDir,
    currentSessionKey: opts.sessionKey,
  });

  // 6. SKILL.md 缺失 / 用户手改 → 静默 skip
  if (!evidence.currentSkillMd) {
    log.warn('[inline-review-block] event=skill_md_missing', { skillName });
    return { triggered: false, reason: 'SKILL.md not found' };
  }
  if (evidence.userModified) {
    log.info('[inline-review-block] event=user_modified', { skillName });
    return { triggered: false, reason: 'user modified skill (hash mismatch)' };
  }

  log.info(`[inline-review-start] skill=${skillName} pattern=${opts.signal.matchedPattern ?? 'unknown'}`, {
    skillName, pattern: opts.signal.matchedPattern,
  });

  // 7. 跑共享决策核心
  const result = await runEvolverDecision({
    evidence,
    llmCall: opts.llmCall,
    userSkillsDir: opts.userSkillsDir,
    currentlyUsedSkills: opts.currentlyUsedSkills,
  });

  const durationMs = Date.now() - start;

  // 8. LLM 失败 → 写一条 skip 日志，不阻断
  if ('error' in result) {
    log.warn(`inline review LLM error (${skillName})`, { err: result.error });
    logEvolutionDecision(opts.db, {
      skillName,
      decision: 'skip',
      reasoning: `[inline] LLM error: ${result.error.slice(0, 200)}`,
      evidence,
      previousHash: evidence.currentHash,
      newHash: null,
      model: opts.model ?? null,
      durationMs,
      errorMessage: result.error,
      triggerSource: 'inline',
    });
    return { triggered: true, decision: 'skip', durationMs };
  }

  // 9. 写决策日志
  const { decision, outcome } = result;
  logEvolutionDecision(opts.db, {
    skillName: outcome.targetSkillName ?? skillName,
    decision: decision.decision,
    reasoning: decision.reasoning,
    evidence,
    previousHash: evidence.currentHash,
    newHash: outcome.newHash,
    patchesApplied: outcome.patchesApplied,
    model: opts.model ?? null,
    durationMs,
    errorMessage: outcome.error,
    previousContent: outcome.previousContent ?? null,
    newContent: outcome.newContent ?? null,
    triggerSource: 'inline',
  });

  log.info(`[inline-review-done] skill=${skillName} decision=${decision.decision} duration=${durationMs}ms`, {
    skillName, decision: decision.decision, durationMs, hadError: Boolean(outcome.error),
  });

  return {
    triggered: true,
    decision: decision.decision,
    durationMs,
  };
}
