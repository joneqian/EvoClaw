/**
 * SkillUsageStore — M7 Phase 2
 *
 * skill_usage + skill_usage_summary 两张表的 DAO。
 * - recordUsage: 每次 invoke_skill 后写一条（telemetry sink 实现）
 * - querySummaries / aggregateStats: 前端 "Skill 效能" 面板 + Phase 3 Evolver 取证用
 * - saveSummary: session 结束 hook 写 per-skill LLM 摘要
 * - recordUserFeedback: 前端 👍/👎 回写
 *
 * 失败策略：所有写入包 try/catch，记 warn log 后静默吞掉 —— telemetry 失败绝不能阻塞 Agent 执行。
 */

import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('skill-usage-store');

/** 单条调用 usage 记录（写入 skill_usage） */
export interface SkillUsageRecord {
  skillName: string;
  agentId: string;
  sessionKey: string;
  triggerType: 'invoke_skill' | 'heartbeat' | 'cron';
  executionMode: 'inline' | 'fork';
  toolCallsCount?: number;
  success: boolean;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  errorSummary?: string;
}

export interface SkillUsageRow {
  id: number;
  skillName: string;
  agentId: string;
  sessionKey: string;
  invokedAt: string;
  triggerType: string;
  executionMode: string;
  toolCallsCount: number;
  success: number;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorSummary: string | null;
  userFeedback: number | null;
  feedbackNote: string | null;
  /** P1-B: 用户对话中的负反馈原文（截断 200 字，PII 已过滤） */
  conversationalFeedback: string | null;
  /** P1-B: 最近一次 inline review 触发时间（ISO，限速去重用） */
  inlineReviewTriggeredAt: string | null;
}

export interface SkillAggregateStats {
  skillName: string;
  invocationCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;         // 0.0-1.0
  avgDurationMs: number | null;
  lastInvokedAt: string | null;
  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
}

export interface SkillUsageSummaryRow {
  id: number;
  skillName: string;
  sessionKey: string;
  agentId: string;
  summaryText: string;
  invocationCount: number;
  successRate: number;
  toolsUsed: string | null;     // JSON 字符串
  summarizedAt: string;
  modelUsed: string | null;
}

export interface SkillTelemetrySink {
  record(record: SkillUsageRecord): void;
}

/** DAO */
export class SkillUsageStore implements SkillTelemetrySink {
  constructor(private db: SqliteStore) {}

  // ─── 写入 ─────────────────────────────────────────────────────

  /** 记录一次 Skill 调用（失败静默，不阻塞 Agent） */
  record(r: SkillUsageRecord): void {
    try {
      this.db.run(
        `INSERT INTO skill_usage (
          skill_name, agent_id, session_key,
          trigger_type, execution_mode,
          tool_calls_count, success, duration_ms,
          input_tokens, output_tokens, error_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        r.skillName,
        r.agentId,
        r.sessionKey,
        r.triggerType,
        r.executionMode,
        r.toolCallsCount ?? 0,
        r.success ? 1 : 0,
        r.durationMs ?? null,
        r.inputTokens ?? null,
        r.outputTokens ?? null,
        r.errorSummary ?? null,
      );
    } catch (err) {
      log.warn('skill_usage 写入失败', { err: String(err), skill: r.skillName });
    }
  }

  /** 写入 per-skill LLM 摘要（Phase 2 session 结束 + Phase 3 Evolver 读） */
  saveSummary(params: {
    skillName: string;
    sessionKey: string;
    agentId: string;
    summaryText: string;
    invocationCount: number;
    successRate: number;
    toolsUsed?: string[];
    modelUsed?: string;
  }): void {
    try {
      this.db.run(
        `INSERT INTO skill_usage_summary (
          skill_name, session_key, agent_id,
          summary_text, invocation_count, success_rate,
          tools_used, model_used
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params.skillName,
        params.sessionKey,
        params.agentId,
        params.summaryText,
        params.invocationCount,
        params.successRate,
        params.toolsUsed ? JSON.stringify(params.toolsUsed) : null,
        params.modelUsed ?? null,
      );
    } catch (err) {
      log.warn('skill_usage_summary 写入失败', { err: String(err), skill: params.skillName });
    }
  }

  /**
   * P1-B Phase 2: 记录用户对话中的负反馈原文，写入该 session+skill 的最新一条 skill_usage。
   * 失败静默（绝不阻塞 Agent）。
   */
  recordConversationalFeedback(params: {
    skillName: string;
    sessionKey: string;
    feedback: string;
  }): boolean {
    try {
      const truncated = params.feedback.slice(0, 200);
      const result = this.db.run(
        `UPDATE skill_usage
           SET conversational_feedback = ?
         WHERE id = (
           SELECT id FROM skill_usage
            WHERE skill_name = ? AND session_key = ?
            ORDER BY invoked_at DESC, id DESC
            LIMIT 1
         )`,
        truncated,
        params.skillName,
        params.sessionKey,
      );
      return result.changes > 0;
    } catch (err) {
      log.warn('skill_usage.conversational_feedback 写入失败', { err: String(err), skill: params.skillName });
      return false;
    }
  }

  /**
   * P1-B Phase 2: 标记一次 inline review 已触发（写入 inline_review_triggered_at = now()）。
   * 限速去重 + 防递归用，更新该 session+skill 最新一条 row。
   */
  markInlineReviewTriggered(params: {
    skillName: string;
    sessionKey: string;
  }): boolean {
    try {
      const nowIso = new Date().toISOString();
      const result = this.db.run(
        `UPDATE skill_usage
           SET inline_review_triggered_at = ?
         WHERE id = (
           SELECT id FROM skill_usage
            WHERE skill_name = ? AND session_key = ?
            ORDER BY invoked_at DESC, id DESC
            LIMIT 1
         )`,
        nowIso,
        params.skillName,
        params.sessionKey,
      );
      return result.changes > 0;
    } catch (err) {
      log.warn('skill_usage.inline_review_triggered_at 写入失败', { err: String(err), skill: params.skillName });
      return false;
    }
  }

  /**
   * P1-B Phase 2: 限速查询：返回该 skill 全局最近一次 inline review 触发时间。
   * 失败静默（返回 null）。
   */
  getLastInlineReviewAt(skillName: string): string | null {
    try {
      const row = this.db.get<{ lastAt: string | null }>(
        `SELECT MAX(inline_review_triggered_at) AS lastAt
         FROM skill_usage
         WHERE skill_name = ?`,
        skillName,
      );
      return row?.lastAt ?? null;
    } catch (err) {
      log.warn('skill_usage.inline_review_triggered_at 查询失败', { err: String(err), skill: skillName });
      return null;
    }
  }

  /** 用户反馈（前端 👍/👎） */
  recordUserFeedback(id: number, feedback: 1 | -1, note?: string): boolean {
    try {
      const safeNote = note ? note.slice(0, 500) : null;
      const result = this.db.run(
        `UPDATE skill_usage SET user_feedback = ?, feedback_note = ? WHERE id = ?`,
        feedback,
        safeNote,
        id,
      );
      return result.changes > 0;
    } catch (err) {
      log.warn('skill_usage.feedback 更新失败', { err: String(err), id });
      return false;
    }
  }

  // ─── 查询 ─────────────────────────────────────────────────────

  /** 最近 N 条调用（前端 "最近调用" 详情） */
  listRecent(skillName: string, limit: number = 10, agentId?: string): SkillUsageRow[] {
    const params: unknown[] = [skillName];
    let where = 'skill_name = ?';
    if (agentId) {
      where += ' AND agent_id = ?';
      params.push(agentId);
    }
    params.push(limit);
    return this.db.all<SkillUsageRow>(
      `SELECT
         id,
         skill_name      AS skillName,
         agent_id        AS agentId,
         session_key     AS sessionKey,
         invoked_at      AS invokedAt,
         trigger_type    AS triggerType,
         execution_mode  AS executionMode,
         tool_calls_count AS toolCallsCount,
         success,
         duration_ms     AS durationMs,
         input_tokens    AS inputTokens,
         output_tokens   AS outputTokens,
         error_summary   AS errorSummary,
         user_feedback   AS userFeedback,
         feedback_note   AS feedbackNote,
         conversational_feedback     AS conversationalFeedback,
         inline_review_triggered_at  AS inlineReviewTriggeredAt
       FROM skill_usage
       WHERE ${where}
       ORDER BY invoked_at DESC
       LIMIT ?`,
      ...params,
    );
  }

  /** per-skill 聚合统计（近 N 天） */
  aggregateStats(skillName: string, days: number = 7, agentId?: string): SkillAggregateStats {
    const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();
    const params: unknown[] = [skillName, sinceIso];
    let where = 'skill_name = ? AND invoked_at >= ?';
    if (agentId) {
      where += ' AND agent_id = ?';
      params.push(agentId);
    }

    const row = this.db.get<{
      invocationCount: number;
      successCount: number;
      failureCount: number;
      avgDurationMs: number | null;
      lastInvokedAt: string | null;
      positiveFeedbackCount: number;
      negativeFeedbackCount: number;
    }>(
      `SELECT
         COUNT(*)                                            AS invocationCount,
         SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END)        AS successCount,
         SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END)        AS failureCount,
         AVG(duration_ms)                                    AS avgDurationMs,
         MAX(invoked_at)                                     AS lastInvokedAt,
         SUM(CASE WHEN user_feedback = 1 THEN 1 ELSE 0 END)  AS positiveFeedbackCount,
         SUM(CASE WHEN user_feedback = -1 THEN 1 ELSE 0 END) AS negativeFeedbackCount
       FROM skill_usage
       WHERE ${where}`,
      ...params,
    );
    const invocationCount = row?.invocationCount ?? 0;
    const successCount = row?.successCount ?? 0;
    const failureCount = row?.failureCount ?? 0;
    return {
      skillName,
      invocationCount,
      successCount,
      failureCount,
      successRate: invocationCount > 0 ? successCount / invocationCount : 0,
      avgDurationMs: row?.avgDurationMs ?? null,
      lastInvokedAt: row?.lastInvokedAt ?? null,
      positiveFeedbackCount: row?.positiveFeedbackCount ?? 0,
      negativeFeedbackCount: row?.negativeFeedbackCount ?? 0,
    };
  }

  /** 某 Agent 近 N 天用过的所有 Skill 的效能排行（前端面板主数据源） */
  effectivenessForAgent(agentId: string, days: number = 7): SkillAggregateStats[] {
    const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();
    const rows = this.db.all<{ skillName: string }>(
      `SELECT DISTINCT skill_name AS skillName
       FROM skill_usage
       WHERE agent_id = ? AND invoked_at >= ?`,
      agentId,
      sinceIso,
    );
    return rows.map(r => this.aggregateStats(r.skillName, days, agentId));
  }

  /** Session 内某 skill 的 usage（摘要生成 + Phase 3 Evolver 用） */
  listBySessionAndSkill(sessionKey: string, skillName: string): SkillUsageRow[] {
    return this.db.all<SkillUsageRow>(
      `SELECT
         id,
         skill_name      AS skillName,
         agent_id        AS agentId,
         session_key     AS sessionKey,
         invoked_at      AS invokedAt,
         trigger_type    AS triggerType,
         execution_mode  AS executionMode,
         tool_calls_count AS toolCallsCount,
         success,
         duration_ms     AS durationMs,
         input_tokens    AS inputTokens,
         output_tokens   AS outputTokens,
         error_summary   AS errorSummary,
         user_feedback   AS userFeedback,
         feedback_note   AS feedbackNote,
         conversational_feedback     AS conversationalFeedback,
         inline_review_triggered_at  AS inlineReviewTriggeredAt
       FROM skill_usage
       WHERE session_key = ? AND skill_name = ?
       ORDER BY invoked_at ASC`,
      sessionKey,
      skillName,
    );
  }

  /** Session 内所有出现过的 Skill（摘要生成器分组用） */
  listSkillsInSession(sessionKey: string): string[] {
    const rows = this.db.all<{ skillName: string }>(
      `SELECT DISTINCT skill_name AS skillName
       FROM skill_usage
       WHERE session_key = ?`,
      sessionKey,
    );
    return rows.map(r => r.skillName);
  }

  /** 列出某 skill 的最新 N 条 session 摘要（Phase 3 Evolver 证据） */
  listSummaries(skillName: string, limit: number = 5): SkillUsageSummaryRow[] {
    return this.db.all<SkillUsageSummaryRow>(
      `SELECT
         id,
         skill_name       AS skillName,
         session_key      AS sessionKey,
         agent_id         AS agentId,
         summary_text     AS summaryText,
         invocation_count AS invocationCount,
         success_rate     AS successRate,
         tools_used       AS toolsUsed,
         summarized_at    AS summarizedAt,
         model_used       AS modelUsed
       FROM skill_usage_summary
       WHERE skill_name = ?
       ORDER BY summarized_at DESC
       LIMIT ?`,
      skillName,
      limit,
    );
  }
}

/** PII 过滤（复用 M1 Secret Sanitizer）+ 长度裁剪 */
export function sanitizeErrorSummary(raw: string, maxLen: number = 200): string {
  // 去换行 + 压缩多空格 + 截断
  const compact = raw.replace(/\s+/g, ' ').trim();
  // 简单剥离疑似密钥（sk-xxx / Bearer xxx）
  const stripped = compact
    .replace(/sk-[a-zA-Z0-9_-]{10,}/g, 'sk-***')
    .replace(/Bearer\s+[a-zA-Z0-9._-]{10,}/g, 'Bearer ***');
  return stripped.slice(0, maxLen);
}
