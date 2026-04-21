/**
 * SkillUsageSummarizer — M7 Phase 2
 *
 * Session 结束时（或手动触发）：
 * 1. 查出本 session 内所有被调用过的 Skill
 * 2. 对每个 Skill 聚合 usage 数据 + 失败摘要
 * 3. 调用辅助 LLM 生成 8-15 句摘要
 * 4. 写入 skill_usage_summary（为 Phase 3 Evolver 提供证据）
 *
 * 设计要点：
 * - 辅助 LLM：走 ModelRouter 低成本模型（feedback_secondary_llm_by_design）
 * - 静默失败：LLM 调用失败/超时不抛异常，跳过该 Skill
 * - 无效应：生成摘要本身不修改 SKILL.md，只写 DB
 */

import { createLogger } from '../infrastructure/logger.js';
import type { SkillUsageStore, SkillUsageRow } from './skill-usage-store.js';

const log = createLogger('skill-usage-summarizer');

/** 辅助 LLM 调用函数（与 web-fetch 保持一致签名） */
export type LLMCallFn = (systemPrompt: string, userMessage: string) => Promise<string>;

export interface GenerateSkillSummariesOptions {
  /** Skill usage DAO */
  store: SkillUsageStore;
  /** 辅助 LLM 调用函数（通常由 createSecondaryLLMCallFn 提供） */
  llmCall: LLMCallFn;
  /** Session 标识 */
  sessionKey: string;
  /** Agent 标识（过滤兜底） */
  agentId: string;
  /** 模型标识（写入 skill_usage_summary.model_used） */
  modelUsed?: string;
  /** 单 Skill 至少调用多少次才生成摘要（默认 2） */
  minInvocations?: number;
}

export interface GenerateSkillSummariesResult {
  generated: number;
  skipped: number;
  failed: number;
}

/** Summary 系统 prompt（英文以保证跨模型稳定性，摘要本身可按 LLM 默认语言） */
const SUMMARY_SYSTEM_PROMPT =
  'You are EvoClaw Skill Usage Summarizer. Given aggregated data about one skill\'s ' +
  'recent invocations (success/failure counts, duration, errors, user feedback), write ' +
  'a concise 8-15 sentence plain-text summary that highlights:\n' +
  '- Effectiveness (success rate, typical duration)\n' +
  '- Observed failure patterns (if any)\n' +
  '- User sentiment (if feedback present)\n' +
  '- Suggestions for improvement (if any)\n\n' +
  'Output plain text only, no markdown headers, no JSON, no preamble.';

/**
 * 为当前 session 内的每个被调用过的 Skill 生成并存储一条摘要。
 * 返回统计。整个流程不抛异常（单项失败记 warn 后继续）。
 */
export async function generateSkillSummaries(
  opts: GenerateSkillSummariesOptions,
): Promise<GenerateSkillSummariesResult> {
  const { store, llmCall, sessionKey, agentId, modelUsed, minInvocations = 2 } = opts;
  const result: GenerateSkillSummariesResult = { generated: 0, skipped: 0, failed: 0 };

  const skills = store.listSkillsInSession(sessionKey);
  if (skills.length === 0) return result;

  for (const skillName of skills) {
    const usages = store.listBySessionAndSkill(sessionKey, skillName);
    if (usages.length < minInvocations) {
      result.skipped++;
      continue;
    }

    const aggregate = summarizeUsages(usages);
    const userMessage = renderLLMInput(skillName, aggregate);

    let summaryText: string;
    try {
      summaryText = (await llmCall(SUMMARY_SYSTEM_PROMPT, userMessage)).trim();
    } catch (err) {
      log.warn('skill summary LLM 调用失败', { skill: skillName, err: String(err) });
      result.failed++;
      continue;
    }
    if (!summaryText) {
      result.failed++;
      continue;
    }

    store.saveSummary({
      skillName,
      sessionKey,
      agentId,
      summaryText: summaryText.slice(0, 4000),   // 硬上限防爆
      invocationCount: aggregate.invocationCount,
      successRate: aggregate.successRate,
      modelUsed,
    });
    result.generated++;
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

interface AggregateForPrompt {
  invocationCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDurationMs: number | null;
  executionModes: Record<string, number>;
  recentErrors: string[];
  positiveFeedbackNotes: string[];
  negativeFeedbackNotes: string[];
}

function summarizeUsages(usages: SkillUsageRow[]): AggregateForPrompt {
  const successCount = usages.filter(u => u.success === 1).length;
  const failureCount = usages.length - successCount;
  const durations = usages.filter(u => u.durationMs !== null).map(u => u.durationMs as number);
  const avgDurationMs = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : null;

  const executionModes: Record<string, number> = {};
  for (const u of usages) {
    executionModes[u.executionMode] = (executionModes[u.executionMode] ?? 0) + 1;
  }

  const recentErrors = usages
    .filter(u => u.success === 0 && u.errorSummary)
    .slice(-5)
    .map(u => u.errorSummary as string);

  const positiveFeedbackNotes = usages
    .filter(u => u.userFeedback === 1 && u.feedbackNote)
    .map(u => u.feedbackNote as string);
  const negativeFeedbackNotes = usages
    .filter(u => u.userFeedback === -1 && u.feedbackNote)
    .map(u => u.feedbackNote as string);

  return {
    invocationCount: usages.length,
    successCount,
    failureCount,
    successRate: usages.length > 0 ? successCount / usages.length : 0,
    avgDurationMs,
    executionModes,
    recentErrors,
    positiveFeedbackNotes,
    negativeFeedbackNotes,
  };
}

function renderLLMInput(skillName: string, a: AggregateForPrompt): string {
  const lines: string[] = [];
  lines.push(`Skill: ${skillName}`);
  lines.push(`Invocations: ${a.invocationCount} (success=${a.successCount}, failure=${a.failureCount})`);
  lines.push(`Success rate: ${(a.successRate * 100).toFixed(1)}%`);
  if (a.avgDurationMs !== null) {
    lines.push(`Avg duration: ${Math.round(a.avgDurationMs)}ms`);
  }
  const modesLine = Object.entries(a.executionModes)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  if (modesLine) lines.push(`Execution modes: ${modesLine}`);
  if (a.recentErrors.length > 0) {
    lines.push('Recent errors:');
    a.recentErrors.forEach(e => lines.push(`- ${e}`));
  }
  if (a.positiveFeedbackNotes.length > 0) {
    lines.push('Positive user feedback:');
    a.positiveFeedbackNotes.forEach(n => lines.push(`- ${n}`));
  }
  if (a.negativeFeedbackNotes.length > 0) {
    lines.push('Negative user feedback:');
    a.negativeFeedbackNotes.forEach(n => lines.push(`- ${n}`));
  }
  return lines.join('\n');
}
