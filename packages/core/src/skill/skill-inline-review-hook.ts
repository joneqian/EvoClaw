/**
 * P1-B Phase 4: Skill Inline Review turn-end hook
 *
 * 主 user turn 结束后异步调用：
 *   void triggerInlineReviewIfSignaled({...}).catch(() => {});
 *
 * 责任：
 * 1. 加载该 session 最近 5min 内的 skill 调用
 * 2. 跑 feedback-signal-detector
 * 3. 命中 strong 信号 → 调 runInlineReview（异步、限速 + 防递归内置）
 *
 * 永不抛异常；所有失败转 warn log。不阻塞调用方主 turn。
 */

import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { createLogger } from '../infrastructure/logger.js';
import { SkillUsageStore } from './skill-usage-store.js';
import { detectFeedbackSignal } from './feedback-signal-detector.js';
import { runInlineReview, type InlineReviewResult } from './skill-evolver-inline.js';
import type { LLMCallFn } from './skill-evolver.js';

const log = createLogger('skill-inline-review-hook');

/** 信号关联窗口（秒）—— 早于此则不算与最近 skill 关联 */
const SIGNAL_WINDOW_SECONDS = 300;

export interface TriggerInlineReviewOptions {
  /** 当前 turn 的用户消息原文 */
  userMessage: string;
  /** 当前 turn 的 sessionKey */
  sessionKey: string;
  db: SqliteStore;
  /** 用户 skills 目录（agent-created + clawhub + github 装的 skills） */
  userSkillsDir: string;
  /** 辅助 LLM 调用（与 cron evolver 同 provider） */
  llmCall: LLMCallFn;
  /** 模型 id（写审计日志） */
  model?: string;
  /** 限速窗口（分钟），默认沿用 runInlineReview 的 10 */
  rateLimitMinutes?: number;
}

/**
 * Turn 结束 hook：检测信号 → 触发 inline review（fire-and-forget 安全）。
 * 返回 InlineReviewResult 主要供测试用，调用方一般忽略 Promise。
 */
export async function triggerInlineReviewIfSignaled(
  opts: TriggerInlineReviewOptions,
): Promise<InlineReviewResult> {
  try {
    return await triggerInternal(opts);
  } catch (err) {
    log.warn('triggerInlineReviewIfSignaled unexpected error', { err: String(err) });
    return { triggered: false, reason: `unexpected error: ${String(err).slice(0, 200)}` };
  }
}

async function triggerInternal(opts: TriggerInlineReviewOptions): Promise<InlineReviewResult> {
  // 0. 主 turn 检查（与 runInlineReview 内部去重的 marker 保持一致）
  // 这里前置校验避免无谓的 SQL 查询
  if (
    opts.sessionKey.includes(':cron:') ||
    opts.sessionKey.includes(':subagent:') ||
    opts.sessionKey.includes(':heartbeat:') ||
    opts.sessionKey.includes(':boot')
  ) {
    return { triggered: false, reason: 'non-main session' };
  }

  // 1. 空消息 / 短消息直接 skip（节省查询）
  const text = opts.userMessage.trim();
  if (text.length < 2) {
    return { triggered: false, reason: 'empty user message' };
  }

  // 2. 拉最近 skill 调用
  const store = new SkillUsageStore(opts.db);
  const recent = store.listRecentInSession(opts.sessionKey, SIGNAL_WINDOW_SECONDS);
  if (recent.length === 0) {
    return { triggered: false, reason: 'no recent skill in session' };
  }

  // 3. 检测信号
  const signal = detectFeedbackSignal({
    userMessage: opts.userMessage,
    recentSkillUsages: recent,
    windowMinutes: Math.ceil(SIGNAL_WINDOW_SECONDS / 60),
  });
  if (signal.signal !== 'strong' || !signal.skillName) {
    return { triggered: false, reason: 'signal=none' };
  }

  log.info(`[inline-review-signal-hit] skill=${signal.skillName} pattern=${signal.matchedPattern}`, {
    skillName: signal.skillName, pattern: signal.matchedPattern,
  });

  // 4. 收集本 session 已用 skill 列表（Phase 5 优先级注入）
  const currentlyUsedSkills = store.listSkillsInSession(opts.sessionKey);

  // 5. 调度 inline review（runInlineReview 内部限速 + 防递归 + 永不抛）
  return runInlineReview({
    db: opts.db,
    store,
    userSkillsDir: opts.userSkillsDir,
    signal,
    sessionKey: opts.sessionKey,
    llmCall: opts.llmCall,
    model: opts.model,
    rateLimitMinutes: opts.rateLimitMinutes,
    currentlyUsedSkills,
  });
}
