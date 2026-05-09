/**
 * Skill 进化日志路由 — M7.1
 *
 * 前端 "进化历史" Tab 的数据源：
 * - GET  /log?skill=X&limit=50     列表（支持按 skill 过滤）
 * - GET  /log/:id                  单条详情（含 previous/new content）
 * - POST /log/:id/rollback         一键回滚（refine 决策才能回滚）
 *
 * M7-Tier1 PR3 — 配置 + 手动触发：
 * - GET  /config                   读 evolver 配置（与 security.skillEvolver schema 对齐）
 * - POST /config                   写配置（zod validate + cron-parser 校验 + 热重载）
 * - POST /run-now                  立即触发一次 evolver cycle（不影响 cron 周期）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';
import { CronExpressionParser } from 'cron-parser';
import { DEFAULT_DATA_DIR, skillEvolverSchema } from '@evoclaw/shared';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { ConfigManager } from '../infrastructure/config-manager.js';
import type { SkillEvolverScheduler } from '../skill/skill-evolver-scheduler.js';
import type { SkillAbEvaluatorScheduler } from '../skill/skill-ab-scheduler.js';
import { createLogger } from '../infrastructure/logger.js';
import { createSkillInternal, editSkillInternal } from '../skill/skill-manage-tool.js';
import { computeSkillHash } from '../skill/skill-manifest.js';

const log = createLogger('skill-evolution-routes');

export interface SkillEvolutionRouteDeps {
  db: SqliteStore;
  /** 覆盖默认 Skills 目录（测试 / 自定义部署用） */
  userSkillsDir?: string;
  /** ConfigManager — 读写 security.skillEvolver；未注入时 GET /config 返回 schema 默认值，POST 拒 */
  configManager?: ConfigManager;
  /** SkillEvolverScheduler getter — 注入后 /run-now 可用；用 getter 支持延迟初始化 */
  getScheduler?: () => SkillEvolverScheduler | undefined;
  /** M7-Tier3 PR-T3-1b: A-B 评估器调度器 getter — 注入后 /ab-evaluate-now 可用 */
  getAbEvaluatorScheduler?: () => SkillAbEvaluatorScheduler | undefined;
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
  /** M7-Tier3 PR-T3-2a: dryRun 模式产生的待审决策 */
  pendingApproval: number;
  approvalDecidedAt: string | null;
  approvalDecidedBy: string | null;
}

const LIST_COLUMNS = `
  id,
  skill_name           AS skillName,
  evolved_at           AS evolvedAt,
  decision,
  reasoning,
  evidence_count       AS evidenceCount,
  evidence_summary     AS evidenceSummary,
  patches_applied      AS patchesApplied,
  previous_hash        AS previousHash,
  new_hash             AS newHash,
  model_used           AS modelUsed,
  duration_ms          AS durationMs,
  error_message        AS errorMessage,
  rolled_back          AS rolledBack,
  trigger_source       AS triggerSource,
  pending_approval     AS pendingApproval,
  approval_decided_at  AS approvalDecidedAt,
  approval_decided_by  AS approvalDecidedBy
`;

const DETAIL_COLUMNS = `
  ${LIST_COLUMNS},
  previous_content  AS previousContent,
  new_content       AS newContent
`;

export function createSkillEvolutionRoutes(deps: SkillEvolutionRouteDeps): Hono {
  const app = new Hono();
  const baseSkillsDir = deps.userSkillsDir ?? path.join(os.homedir(), DEFAULT_DATA_DIR, 'skills');

  /**
   * GET /log?skill=X&limit=50&offset=0&pending=1
   *
   * pending=1 时只返 pending_approval=1 的待审决策（PR-T3-2a dryRun 模式产物）。
   */
  app.get('/log', (c) => {
    const skill = c.req.query('skill');
    const pending = c.req.query('pending');
    const limit = Math.min(Number(c.req.query('limit')) || 50, 500);
    const offset = Math.max(Number(c.req.query('offset')) || 0, 0);
    const params: unknown[] = [];
    const whereClauses: string[] = [];
    if (skill) {
      whereClauses.push('skill_name = ?');
      params.push(skill);
    }
    if (pending === '1') {
      whereClauses.push('pending_approval = 1');
    }
    const where = whereClauses.length ? whereClauses.join(' AND ') : '1=1';
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

  /** GET /log/pending-count — 用于左侧徽章数字 */
  app.get('/log/pending-count', (c) => {
    const row = deps.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM skill_evolution_log WHERE pending_approval = 1`,
    );
    return c.json({ count: row?.count ?? 0 });
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
   * POST /log/:id/apply
   *
   * 应用一条 dryRun 模式产生的待审决策：
   *   - refine：调 editSkillInternal 写回 new_content
   *   - create：调 createSkillInternal 创建新 skill
   * 写入前做 hash 防覆盖检查（refine 才有意义）：
   *   磁盘当前 hash != previous_hash → 用户在 dryRun 期手动改过 SKILL.md →
   *   返回 409 + 提示用户重新决策（不强行覆盖用户编辑）。
   */
  app.post('/log/:id/apply', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) {
      return c.json({ error: 'invalid id' }, 400);
    }
    const row = deps.db.get<EvolutionLogRow>(
      `SELECT ${DETAIL_COLUMNS} FROM skill_evolution_log WHERE id = ?`,
      id,
    );
    if (!row) return c.json({ error: 'not found' }, 404);

    if (row.pendingApproval !== 1) {
      return c.json({ error: 'not pending approval' }, 400);
    }
    if (row.decision !== 'refine' && row.decision !== 'create') {
      return c.json({ error: `cannot apply decision='${row.decision}'` }, 400);
    }
    if (!row.newContent) {
      return c.json({ error: 'new_content missing' }, 400);
    }

    if (row.decision === 'refine') {
      // hash 防覆盖：检查磁盘是否在 dryRun 期间已被手动修改
      const skillMdPath = path.join(baseSkillsDir, row.skillName, 'SKILL.md');
      if (fs.existsSync(skillMdPath)) {
        try {
          const onDisk = fs.readFileSync(skillMdPath, 'utf-8');
          const onDiskHash = computeSkillHash(onDisk);
          if (row.previousHash && onDiskHash !== row.previousHash) {
            log.warn('apply 拒绝：磁盘 hash 已变（用户在 dryRun 期间修改过）', {
              id, skill: row.skillName,
              previousHash: row.previousHash, onDiskHash,
            });
            return c.json({
              error: 'SKILL.md changed since decision was made — please reject this decision and re-evolve',
              previousHash: row.previousHash,
              onDiskHash,
            }, 409);
          }
        } catch (err) {
          log.warn('hash 防覆盖检查失败', { err: String(err) });
          // 读盘失败不阻塞 apply（editSkillInternal 自身会处理）
        }
      }

      const res = await editSkillInternal({
        name: row.skillName,
        content: row.newContent,
        userSkillsDir: baseSkillsDir,
      });
      if (!res.success) {
        log.warn('apply (refine) 失败', { id, err: res.error });
        return c.json({ error: res.error ?? 'apply failed' }, 500);
      }
    } else {
      // create
      const res = await createSkillInternal({
        name: row.skillName,
        content: row.newContent,
        userSkillsDir: baseSkillsDir,
      });
      if (!res.success) {
        log.warn('apply (create) 失败', { id, err: res.error });
        return c.json({ error: res.error ?? 'apply failed' }, 500);
      }
    }

    deps.db.run(
      `UPDATE skill_evolution_log
       SET pending_approval = 0,
           approval_decided_at = datetime('now'),
           approval_decided_by = 'manual-apply'
       WHERE id = ?`,
      id,
    );
    log.info('[/log/:id/apply] manual apply', { id, skill: row.skillName, decision: row.decision });
    return c.json({ ok: true, appliedId: id });
  });

  /**
   * POST /log/:id/reject
   *
   * 拒绝一条待审决策：标 pending=0 + rolled_back=1 + decided_by='manual-reject'。
   * 不写盘（dryRun 本来就没写）。
   */
  app.post('/log/:id/reject', (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id <= 0) {
      return c.json({ error: 'invalid id' }, 400);
    }
    const row = deps.db.get<{ pendingApproval: number; skillName: string; decision: string }>(
      `SELECT pending_approval AS pendingApproval, skill_name AS skillName, decision
       FROM skill_evolution_log WHERE id = ?`,
      id,
    );
    if (!row) return c.json({ error: 'not found' }, 404);
    if (row.pendingApproval !== 1) {
      return c.json({ error: 'not pending approval' }, 400);
    }
    deps.db.run(
      `UPDATE skill_evolution_log
       SET pending_approval = 0,
           rolled_back = 1,
           approval_decided_at = datetime('now'),
           approval_decided_by = 'manual-reject'
       WHERE id = ?`,
      id,
    );
    log.info('[/log/:id/reject] manual reject', { id, skill: row.skillName, decision: row.decision });
    return c.json({ ok: true, rejectedId: id });
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

  // ─── M7-Tier1 PR3: 配置 + 手动触发 ───────────────────────────────────

  /**
   * GET /config
   *
   * 返回当前 evolver 配置（与 security.skillEvolver schema 对齐）。
   * 未注入 ConfigManager 时返回 schema 默认值（运行环境异常时的降级）。
   */
  app.get('/config', (c) => {
    try {
      const stored = deps.configManager?.getConfig()?.security?.skillEvolver;
      // skillEvolverSchema.parse({}) 用 schema 默认值填充缺失字段
      const merged = skillEvolverSchema.parse(stored ?? {});
      return c.json({ evolver: merged });
    } catch (err) {
      log.warn(`[/config GET] error: ${err instanceof Error ? err.message : String(err)}`);
      // 配置层损坏时也给一份 schema 默认（保 UI 可用）
      return c.json({ evolver: skillEvolverSchema.parse({}) });
    }
  });

  /**
   * POST /config
   *
   * Body: { evolver: SkillEvolverConfig }
   * 写流程：zod validate → cron-parser 校验 cronSchedule → 合并到 user 配置层 → saveToDisk
   * Scheduler 通过 getConfig() 自动热重载，无需重启 sidecar。
   */
  app.post('/config', async (c) => {
    if (!deps.configManager) {
      return c.json({ error: 'ConfigManager not available' }, 503);
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const evolverInput = body['evolver'] ?? body;

    const parsed = skillEvolverSchema.safeParse(evolverInput);
    if (!parsed.success) {
      return c.json({ error: 'invalid evolver config', issues: parsed.error.issues }, 400);
    }

    // 双重校验 cron 表达式（schema 只能校验是 string，CronExpressionParser 才能验语法）
    try {
      CronExpressionParser.parse(parsed.data.cronSchedule);
    } catch (err) {
      return c.json({
        error: `invalid cronSchedule: ${err instanceof Error ? err.message : String(err)}`,
      }, 400);
    }

    try {
      const cur = deps.configManager.getConfig();
      const next = {
        ...cur,
        security: {
          ...cur.security,
          skillEvolver: parsed.data,
        },
      };
      deps.configManager.updateConfig(next);
      log.info('[/config POST] skillEvolver updated', {
        enabled: parsed.data.enabled,
        cronSchedule: parsed.data.cronSchedule,
      });
      return c.json({ ok: true, evolver: parsed.data });
    } catch (err) {
      log.error(`[/config POST] write failed: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ error: 'write config failed' }, 500);
    }
  });

  /**
   * POST /run-now
   *
   * 立即触发一次 evolution cycle（不影响 cron 周期）。
   * 仅当注入了 SkillEvolverScheduler 才可用（启动时 server 已配 LLM provider 才能跑）。
   */
  app.post('/run-now', async (c) => {
    const scheduler = deps.getScheduler?.();
    if (!scheduler) {
      return c.json({ error: 'scheduler not configured (no LLM provider?)' }, 503);
    }
    try {
      await scheduler.triggerNow();
      log.info('[/run-now] manual trigger ok');
      return c.json({ ok: true });
    } catch (err) {
      log.error(`[/run-now] error: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ error: 'trigger failed' }, 500);
    }
  });

  // ─── M7-Tier3 PR-T3-1b: A-B 测试状态 + 手动触发评估 ─────────────────

  /**
   * GET /ab-status?skillName=X
   *
   * skillName 可选：传入时返回该 skill 的 active 测试详情 + outcome 计数；
   * 不传时返回所有 active 测试 + 历史 5 条决策摘要。
   */
  app.get('/ab-status', (c) => {
    const skillName = c.req.query('skill') ?? c.req.query('skillName');
    try {
      if (skillName) {
        const active = deps.db.get<{
          id: number; skillName: string; status: string;
          variantAHash: string; variantBHash: string; startedAt: string;
          minCallsPerVariant: number; maxTestDays: number;
        }>(
          `SELECT id, skill_name AS skillName, status,
                  variant_a_hash AS variantAHash, variant_b_hash AS variantBHash,
                  started_at AS startedAt,
                  min_calls_per_variant AS minCallsPerVariant,
                  max_test_days AS maxTestDays
           FROM skill_ab_test
           WHERE skill_name = ? AND status = 'active'
           ORDER BY started_at DESC LIMIT 1`,
          skillName,
        );
        const history = deps.db.all<{
          id: number; skillName: string; status: string;
          startedAt: string; endedAt: string | null;
          decisionReason: string | null; pValue: number | null; effectSize: number | null;
        }>(
          `SELECT id, skill_name AS skillName, status,
                  started_at AS startedAt, ended_at AS endedAt,
                  decision_reason AS decisionReason, p_value AS pValue,
                  effect_size AS effectSize
           FROM skill_ab_test
           WHERE skill_name = ? AND status != 'active'
           ORDER BY ended_at DESC LIMIT 10`,
          skillName,
        );
        if (!active) {
          return c.json({ active: null, history });
        }
        const counts = deps.db.all<{ variant: string; cnt: number }>(
          `SELECT variant, COUNT(*) AS cnt FROM skill_ab_outcome
           WHERE ab_test_id = ? GROUP BY variant`,
          active.id,
        );
        const aCount = counts.find(r => r.variant === 'A')?.cnt ?? 0;
        const bCount = counts.find(r => r.variant === 'B')?.cnt ?? 0;
        return c.json({
          active: {
            ...active,
            outcomeCounts: { A: aCount, B: bCount },
            progress: Math.min(1, Math.min(aCount, bCount) / Math.max(1, active.minCallsPerVariant)),
          },
          history,
        });
      }

      // 不带 skillName：列全部 active + 最近 5 条历史
      const activeRows = deps.db.all<{
        id: number; skillName: string; status: string;
        variantAHash: string; variantBHash: string; startedAt: string;
        minCallsPerVariant: number; maxTestDays: number;
      }>(
        `SELECT id, skill_name AS skillName, status,
                variant_a_hash AS variantAHash, variant_b_hash AS variantBHash,
                started_at AS startedAt,
                min_calls_per_variant AS minCallsPerVariant,
                max_test_days AS maxTestDays
         FROM skill_ab_test
         WHERE status = 'active' ORDER BY started_at ASC`,
      );
      // 为每条 active 拉 outcome 计数 — N 条 active 通常 < 20，N+1 不构成性能问题
      const active = activeRows.map(row => {
        const counts = deps.db.all<{ variant: string; cnt: number }>(
          `SELECT variant, COUNT(*) AS cnt FROM skill_ab_outcome
           WHERE ab_test_id = ? GROUP BY variant`,
          row.id,
        );
        const a = counts.find(r => r.variant === 'A')?.cnt ?? 0;
        const b = counts.find(r => r.variant === 'B')?.cnt ?? 0;
        return {
          ...row,
          outcomeCounts: { A: a, B: b },
          progress: Math.min(1, Math.min(a, b) / Math.max(1, row.minCallsPerVariant)),
        };
      });
      const history = deps.db.all<{
        id: number; skillName: string; status: string;
        startedAt: string; endedAt: string | null;
        decisionReason: string | null; pValue: number | null; effectSize: number | null;
      }>(
        `SELECT id, skill_name AS skillName, status,
                started_at AS startedAt, ended_at AS endedAt,
                decision_reason AS decisionReason, p_value AS pValue,
                effect_size AS effectSize
         FROM skill_ab_test
         WHERE status != 'active'
         ORDER BY ended_at DESC LIMIT 5`,
      );
      return c.json({ active, history });
    } catch (err) {
      log.warn(`[/ab-status] error: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  /**
   * POST /ab-evaluate-now
   * 立即跑一次评估器（不影响 cron）。返回本次 cycle 的统计摘要。
   */
  app.post('/ab-evaluate-now', async (c) => {
    const scheduler = deps.getAbEvaluatorScheduler?.();
    if (!scheduler) {
      return c.json({ error: 'ab-evaluator scheduler not configured' }, 503);
    }
    try {
      const result = await scheduler.triggerNow();
      log.info('[/ab-evaluate-now] manual trigger', { ...result });
      return c.json(result);
    } catch (err) {
      log.error(`[/ab-evaluate-now] error: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ error: 'trigger failed' }, 500);
    }
  });

  return app;
}
