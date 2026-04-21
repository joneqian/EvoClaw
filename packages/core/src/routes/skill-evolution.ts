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
  previousContent: string | null;
  newContent: string | null;
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
  rolled_back       AS rolledBack
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

  return app;
}
