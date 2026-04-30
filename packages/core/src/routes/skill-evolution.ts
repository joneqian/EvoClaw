/**
 * Skill 进化日志路由 — M7.1
 *
 * 前端 "进化历史" Tab 的数据源：
 * - GET  /log?skill=X&limit=50     列表（支持按 skill 过滤）
 * - GET  /log/:id                  单条详情（含 previous/new content）
 * - POST /log/:id/rollback         一键回滚（refine 决策才能回滚）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';
import { DEFAULT_DATA_DIR } from '@evoclaw/shared';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { createLogger } from '../infrastructure/logger.js';
import { editSkillInternal } from '../skill/skill-manage-tool.js';

const log = createLogger('skill-evolution-routes');

export interface SkillEvolutionRouteDeps {
  db: SqliteStore;
  /** 覆盖默认 Skills 目录（测试 / 自定义部署用） */
  userSkillsDir?: string;
}

interface EvolutionLogRow {
  id: number;
  skillName: string;
  evolvedAt: string;
  decision: string;
  reasoning: string | null;
  evidenceCount: number;
  evidenceSummary: string | null;
  patchesApplied: string | null;
  previousHash: string | null;
  newHash: string | null;
  modelUsed: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  rolledBack: number;
  /** P1-B: 'cron' | 'inline' */
  triggerSource: string;
  previousContent: string | null;
  newContent: string | null;
  /** P1-B: 触发本条 inline review 的用户对话原文（仅 trigger_source='inline' 可能有） */
  conversationalFeedback?: string | null;
}

const LIST_COLUMNS = `
  id,
  skill_name        AS skillName,
  evolved_at        AS evolvedAt,
  decision,
  reasoning,
  evidence_count    AS evidenceCount,
  evidence_summary  AS evidenceSummary,
  patches_applied   AS patchesApplied,
  previous_hash     AS previousHash,
  new_hash          AS newHash,
  model_used        AS modelUsed,
  duration_ms       AS durationMs,
  error_message     AS errorMessage,
  rolled_back       AS rolledBack,
  trigger_source    AS triggerSource
`;

const DETAIL_COLUMNS = `
  ${LIST_COLUMNS},
  previous_content  AS previousContent,
  new_content       AS newContent
`;

export function createSkillEvolutionRoutes(deps: SkillEvolutionRouteDeps): Hono {
  const app = new Hono();
  const baseSkillsDir = deps.userSkillsDir ?? path.join(os.homedir(), DEFAULT_DATA_DIR, 'skills');

  /** GET /log?skill=X&limit=50&offset=0 */
  app.get('/log', (c) => {
    const skill = c.req.query('skill');
    const limit = Math.min(Number(c.req.query('limit')) || 50, 500);
    const offset = Math.max(Number(c.req.query('offset')) || 0, 0);
    const params: unknown[] = [];
    let where = '1=1';
    if (skill) {
      where = 'skill_name = ?';
      params.push(skill);
    }
    params.push(limit, offset);
    const rows = deps.db.all<Omit<EvolutionLogRow, 'previousContent' | 'newContent'>>(
      `SELECT ${LIST_COLUMNS}
       FROM skill_evolution_log
       WHERE ${where}
       ORDER BY evolved_at DESC
       LIMIT ? OFFSET ?`,
      ...params,
    );
    return c.json({ entries: rows });
  });

  /** GET /log/:id */
  app.get('/log/:id', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) {
      return c.json({ error: 'invalid id' }, 400);
    }
    const row = deps.db.get<EvolutionLogRow>(
      `SELECT ${DETAIL_COLUMNS} FROM skill_evolution_log WHERE id = ?`,
      id,
    );
    if (!row) return c.json({ error: 'not found' }, 404);

    // P1-B: 关联 inline review 的用户对话原文（最近一条同 skill 的 conversational_feedback）
    if (row.triggerSource === 'inline') {
      const fb = deps.db.get<{ feedback: string | null }>(
        `SELECT conversational_feedback AS feedback
         FROM skill_usage
         WHERE skill_name = ?
           AND conversational_feedback IS NOT NULL
           AND datetime(invoked_at) <= datetime(?)
         ORDER BY invoked_at DESC, id DESC
         LIMIT 1`,
        row.skillName,
        row.evolvedAt,
      );
      row.conversationalFeedback = fb?.feedback ?? null;
    }

    return c.json({ entry: row });
  });

  /**
   * POST /log/:id/rollback
   *
   * 仅 refine 决策且未回滚过的记录可以回滚：
   * - 把 previous_content 写回磁盘
   * - 标记 rolled_back=1
   * - 写一条新的 audit 条目（decision='skip'，reasoning="manual rollback of #N"）
   */
  app.post('/log/:id/rollback', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) {
      return c.json({ error: 'invalid id' }, 400);
    }

    const row = deps.db.get<EvolutionLogRow>(
      `SELECT ${DETAIL_COLUMNS} FROM skill_evolution_log WHERE id = ?`,
      id,
    );
    if (!row) return c.json({ error: 'not found' }, 404);

    if (row.decision !== 'refine') {
      return c.json({ error: `cannot rollback decision='${row.decision}' (only 'refine' is rollbackable)` }, 400);
    }
    if (row.rolledBack === 1) {
      return c.json({ error: 'already rolled back' }, 400);
    }
    if (!row.previousContent) {
      return c.json({ error: 'previous_content missing (legacy record or skip)' }, 400);
    }

    // 复用 editSkillInternal（完整 scan + atomic write + manifest 更新）
    const res = await editSkillInternal({
      name: row.skillName,
      content: row.previousContent,
      userSkillsDir: baseSkillsDir,
    });
    if (!res.success) {
      log.warn('rollback 失败', { id, err: res.error });
      return c.json({ error: res.error ?? 'rollback failed' }, 500);
    }

    // 标记 rolled_back
    deps.db.run(`UPDATE skill_evolution_log SET rolled_back = 1 WHERE id = ?`, id);

    // 追加 audit 条目
    deps.db.run(
      `INSERT INTO skill_evolution_log (
         skill_name, decision, reasoning,
         evidence_count, evidence_summary,
         previous_hash, new_hash,
         previous_content, new_content
       ) VALUES (?, ?, ?, 0, NULL, ?, ?, ?, ?)`,
      row.skillName,
      'skip',
      `manual rollback of #${id}`,
      row.newHash,           // 此时磁盘上原本是 newHash，现在被覆盖回 previousContent
      row.previousHash,      // 新状态 hash
      row.newContent ?? null,
      row.previousContent,
    );

    // 验证路径是否在沙箱内（防御性检查）
    const skillMd = path.join(baseSkillsDir, row.skillName, 'SKILL.md');
    if (!fs.existsSync(skillMd)) {
      log.warn('rollback 后 SKILL.md 不存在', { path: skillMd });
    }

    return c.json({ ok: true, rolledBackId: id });
  });

  /**
   * GET /inline-stats?days=7
   *
   * P1-B 触发率观测：聚合 trigger_source='inline' 的记录给前端 / 排查用。
   *
   * 返回：
   * - total: 时间窗口内 inline review 总数
   * - byDecision: { refine, create, skip } 三档计数
   * - errorCount: error_message 非空的记录数
   * - topSkills: 触发最多的 skill TOP 5
   * - byDate: 最近 N 天每日计数（含 0 的日子）
   */
  app.get('/inline-stats', (c) => {
    const days = Math.max(1, Math.min(Number(c.req.query('days')) || 7, 90));
    const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();

    const totalRow = deps.db.get<{ total: number; errorCount: number }>(
      `SELECT
         COUNT(*)                                            AS total,
         SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END) AS errorCount
       FROM skill_evolution_log
       WHERE trigger_source = 'inline' AND datetime(evolved_at) >= datetime(?)`,
      sinceIso,
    );

    const decisionRows = deps.db.all<{ decision: string; cnt: number }>(
      `SELECT decision, COUNT(*) AS cnt
       FROM skill_evolution_log
       WHERE trigger_source = 'inline' AND datetime(evolved_at) >= datetime(?)
       GROUP BY decision`,
      sinceIso,
    );
    const byDecision = { refine: 0, create: 0, skip: 0 };
    for (const r of decisionRows) {
      if (r.decision === 'refine') byDecision.refine = r.cnt;
      else if (r.decision === 'create') byDecision.create = r.cnt;
      else if (r.decision === 'skip') byDecision.skip = r.cnt;
    }

    const topSkills = deps.db.all<{ skillName: string; count: number }>(
      `SELECT skill_name AS skillName, COUNT(*) AS count
       FROM skill_evolution_log
       WHERE trigger_source = 'inline' AND datetime(evolved_at) >= datetime(?)
       GROUP BY skill_name
       ORDER BY count DESC, skill_name ASC
       LIMIT 5`,
      sinceIso,
    );

    const dateRows = deps.db.all<{ date: string; count: number }>(
      `SELECT strftime('%Y-%m-%d', evolved_at) AS date, COUNT(*) AS count
       FROM skill_evolution_log
       WHERE trigger_source = 'inline' AND datetime(evolved_at) >= datetime(?)
       GROUP BY date
       ORDER BY date ASC`,
      sinceIso,
    );

    // 把缺失的日期补 0，让前端折线图无断点
    const byDate: Array<{ date: string; count: number }> = [];
    const dateMap = new Map(dateRows.map(r => [r.date, r.count]));
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000);
      const iso = d.toISOString().slice(0, 10);
      byDate.push({ date: iso, count: dateMap.get(iso) ?? 0 });
    }

    return c.json({
      windowDays: days,
      total: totalRow?.total ?? 0,
      errorCount: totalRow?.errorCount ?? 0,
      byDecision,
      topSkills,
      byDate,
    });
  });

  return app;
}
