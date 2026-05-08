/**
 * Curator REST 路由 — Skill 生命周期治理外部 API
 *
 * Endpoints（commit 4）：
 *   GET  /status                 当前状态 + 各 state 计数 + 最近 run 摘要
 *   POST /pause                  暂停（lastRunAt 不动）
 *   POST /resume                 恢复
 *   POST /archive/:name          手动归档（不调 LLM）
 *   POST /restore/:name          从 .archive/ 恢复
 *   POST /prune                  批量归档：body { days, dryRun }
 *
 * Endpoints（M7-Tier1 PR1）：
 *   GET  /lifecycle              批量返回所有 lifecycle entries（前端列表渲染状态徽章 + pin 标志）
 *   POST /pin/:name              钉住单个 skill：跳过 evolver / inline review / curator 自动归档
 *   POST /unpin/:name            取消钉住
 *
 * /run 留给 commit 5 跟 scheduler 一起做（需要 LLM provider 解析）
 */

import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { DEFAULT_DATA_DIR, skillCuratorSchema } from '@evoclaw/shared';
import type { ConfigManager } from '../infrastructure/config-manager.js';
import { createLogger } from '../infrastructure/logger.js';
import {
  readCuratorState,
  updateCuratorState,
  shouldRunCurator,
} from '../skill/skill-curator-state.js';
import {
  listLifecycleEntries,
  getEntry,
  setPinned,
  archiveSkill,
  restoreSkill,
  type SkillLifecycleEntry,
} from '../skill/skill-curator-lifecycle.js';
import { readManifest } from '../skill/skill-manifest.js';
import type { SkillCuratorScheduler } from '../skill/skill-curator-scheduler.js';

const log = createLogger('curator-routes');

export interface CuratorRouteDeps {
  /** 自定义 skills 根目录（测试 / 自定义部署用） */
  userSkillsDir?: string;
  /** 默认 interval 天数（用于 status 显示距离下次运行；PR6 起优先从 ConfigManager 读，未注入时兜底） */
  intervalDays?: number;
  /** 注入的 scheduler getter（可选）— 注入后 /run endpoint 可用；用 getter 支持延迟初始化 */
  getScheduler?: () => SkillCuratorScheduler | undefined;
  /** PR6: ConfigManager — GET/POST /config + /status 读 intervalDays 用 */
  configManager?: ConfigManager;
}

export function createCuratorRoutes(deps: CuratorRouteDeps = {}): Hono {
  const app = new Hono();
  const userSkillsDir = deps.userSkillsDir ?? path.join(os.homedir(), DEFAULT_DATA_DIR, 'skills');

  /** PR6: 优先从 ConfigManager 读，回退到构造时 deps.intervalDays，最后默认 7 */
  function resolveIntervalDays(): number {
    return deps.configManager?.getConfig()?.security?.skillCurator?.intervalDays
      ?? deps.intervalDays
      ?? 7;
  }

  /**
   * GET /status
   * 返回 curator 状态 + 各 state 计数 + agent-created skill 摘要
   */
  app.get('/status', (c) => {
    try {
      const state = readCuratorState(userSkillsDir);
      const lifecycle = listLifecycleEntries(userSkillsDir);
      const manifest = readManifest(userSkillsDir);

      // 按 source 统计
      const counts: Record<string, number> = {
        bundled: 0, 'agent-created': 0, local: 0, clawhub: 0, github: 0,
      };
      for (const e of manifest.values()) {
        counts[e.source] = (counts[e.source] ?? 0) + 1;
      }

      // agent-created 的状态分布
      const agentCreatedNames = new Set<string>();
      for (const e of manifest.values()) {
        if (e.source === 'agent-created') agentCreatedNames.add(e.name);
      }
      const stateCounts: Record<SkillLifecycleEntry['state'], number> = {
        active: 0, stale: 0, archived: 0,
      };
      let pinnedCount = 0;
      for (const lc of lifecycle) {
        if (!agentCreatedNames.has(lc.name)) continue;
        stateCounts[lc.state]++;
        if (lc.pinned) pinnedCount++;
      }
      // 没有 lifecycle 条目的 agent-created skill 默认 active
      const knownLifecycleNames = new Set(lifecycle.map(e => e.name));
      for (const name of agentCreatedNames) {
        if (!knownLifecycleNames.has(name)) stateCounts.active++;
      }

      const intervalDays = resolveIntervalDays();
      const sched = shouldRunCurator({ intervalDays, skillsBaseDir: userSkillsDir });

      return c.json({
        state: {
          lastRunAt: state.lastRunAt,
          lastRunSummary: state.lastRunSummary,
          lastRunDurationMs: state.lastRunDurationMs,
          paused: state.paused,
          runCount: state.runCount,
        },
        nextRun: {
          shouldRun: sched.shouldRun,
          reason: sched.reason,
        },
        skillsBySource: counts,
        agentCreatedStateCounts: stateCounts,
        pinnedCount,
        intervalDays,
      });
    } catch (err) {
      log.error(`[/status] error: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  /** POST /pause */
  app.post('/pause', (c) => {
    try {
      const next = updateCuratorState({ paused: true }, userSkillsDir);
      log.info('[/pause] paused');
      return c.json({ paused: next.paused });
    } catch (err) {
      log.error(`[/pause] error: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  /** POST /resume */
  app.post('/resume', (c) => {
    try {
      const next = updateCuratorState({ paused: false }, userSkillsDir);
      log.info('[/resume] resumed');
      return c.json({ paused: next.paused });
    } catch (err) {
      log.error(`[/resume] error: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  /** POST /archive/:name */
  app.post('/archive/:name', (c) => {
    const name = c.req.param('name');
    try {
      // 防止 archive bundled / clawhub / github / local（仅 agent-created 可由 curator 触发）
      const manifest = readManifest(userSkillsDir);
      const entry = manifest.get(name);
      if (!entry) {
        return c.json({ error: `skill '${name}' not found in manifest` }, 404);
      }
      if (entry.source !== 'agent-created') {
        return c.json({
          error: `refuse to archive: source=${entry.source} (only agent-created allowed)`,
        }, 403);
      }
      const r = archiveSkill(name, userSkillsDir);
      if (!r.ok) {
        return c.json({ error: r.message }, 400);
      }
      log.info(`[/archive] ${name} → ${r.archivedPath}`);
      return c.json({ ok: true, archivedPath: r.archivedPath, message: r.message });
    } catch (err) {
      log.error(`[/archive] error: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  /**
   * GET /lifecycle
   * 批量返回所有 agent-created skill 的 lifecycle entries（含未持久化条目以默认 active 兜底）。
   * 前端列表渲染 pin 按钮 + 状态徽章用一次拉齐。
   */
  app.get('/lifecycle', (c) => {
    try {
      const manifest = readManifest(userSkillsDir);
      const persisted = listLifecycleEntries(userSkillsDir);
      const persistedByName = new Map(persisted.map(e => [e.name, e] as const));

      const out: Array<{
        name: string;
        source: string;
        state: SkillLifecycleEntry['state'];
        pinned: boolean;
        archivedAt: string | null;
        updatedAt: string;
      }> = [];

      for (const entry of manifest.values()) {
        // 仅 agent-created 进 lifecycle 治理范围；其他来源默认 active 但不暴露 pin 操作
        const lc = persistedByName.get(entry.name);
        out.push({
          name: entry.name,
          source: entry.source,
          state: lc?.state ?? 'active',
          pinned: lc?.pinned ?? false,
          archivedAt: lc?.archivedAt ?? null,
          updatedAt: lc?.updatedAt ?? entry.createdAt,
        });
      }

      // 也包含已 archived 的（manifest 里可能已被剔除，从 lifecycle JSON 里补上）
      for (const lc of persisted) {
        if (lc.state === 'archived' && !manifest.has(lc.name)) {
          out.push({
            name: lc.name,
            source: 'agent-created',
            state: 'archived',
            pinned: lc.pinned,
            archivedAt: lc.archivedAt,
            updatedAt: lc.updatedAt,
          });
        }
      }

      return c.json({ entries: out });
    } catch (err) {
      log.error(`[/lifecycle] error: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  /**
   * POST /pin/:name
   * 钉住单个 skill：evolver/inline review/curator 自动归档全部跳过该 skill。
   * 仅 agent-created 来源可 pin（其他来源由用户/系统直接管理，不需要 pin 保护）。
   */
  app.post('/pin/:name', (c) => {
    const name = c.req.param('name');
    try {
      const manifest = readManifest(userSkillsDir);
      const entry = manifest.get(name);
      if (!entry) {
        return c.json({ error: `skill '${name}' not found in manifest` }, 404);
      }
      if (entry.source !== 'agent-created') {
        return c.json({
          error: `refuse to pin: source=${entry.source} (only agent-created allowed)`,
        }, 403);
      }
      const next = setPinned(name, true, userSkillsDir);
      log.info(`[/pin] ${name} pinned=true`);
      return c.json({ ok: true, name, pinned: next.pinned, state: next.state });
    } catch (err) {
      log.error(`[/pin] error: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  /** POST /unpin/:name — 反向操作；非 pinned 也允许（幂等） */
  app.post('/unpin/:name', (c) => {
    const name = c.req.param('name');
    try {
      const next = setPinned(name, false, userSkillsDir);
      log.info(`[/unpin] ${name} pinned=false`);
      return c.json({ ok: true, name, pinned: next.pinned, state: next.state });
    } catch (err) {
      log.error(`[/unpin] error: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  /** POST /restore/:name */
  app.post('/restore/:name', (c) => {
    const name = c.req.param('name');
    try {
      const r = restoreSkill(name, userSkillsDir);
      if (!r.ok) {
        return c.json({ error: r.message }, 400);
      }
      log.info(`[/restore] ${name} ← ${r.restoredPath}`);
      return c.json({ ok: true, restoredPath: r.restoredPath, message: r.message });
    } catch (err) {
      log.error(`[/restore] error: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  /**
   * POST /prune
   * 批量归档：body { days?: number = 90, dryRun?: boolean = false }
   */
  const pruneSchema = z.object({
    days: z.coerce.number().int().min(1).max(3650).optional(),
    dryRun: z.coerce.boolean().optional(),
  });
  app.post('/prune', async (c) => {
    let body: { days?: number; dryRun?: boolean };
    try {
      const raw = await c.req.json().catch(() => ({}));
      const parsed = pruneSchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: parsed.error.message }, 400);
      }
      body = parsed.data;
    } catch {
      body = {};
    }
    const days = body.days ?? 90;
    const dryRun = body.dryRun ?? false;
    const cutoffMs = Date.now() - days * 86400_000;

    try {
      // 仅 agent-created 进入 prune 候选
      const manifest = readManifest(userSkillsDir);
      const candidates: { name: string; reason: string }[] = [];
      for (const entry of manifest.values()) {
        if (entry.source !== 'agent-created') continue;
        const lc = getEntry(entry.name, userSkillsDir);
        if (lc.pinned) continue;
        if (lc.state === 'archived') continue;
        // 用 manifest createdAt 作锚点（简化：本 endpoint 不查 skill_usage）
        const anchorMs = Date.parse(entry.createdAt);
        if (Number.isFinite(anchorMs) && anchorMs <= cutoffMs) {
          candidates.push({ name: entry.name, reason: `createdAt=${entry.createdAt} <= ${days}d ago` });
        }
      }

      if (dryRun) {
        return c.json({
          dryRun: true,
          days,
          wouldArchive: candidates,
          count: candidates.length,
        });
      }

      const archived: { name: string; archivedPath?: string }[] = [];
      const failed: { name: string; error: string }[] = [];
      for (const cand of candidates) {
        const r = archiveSkill(cand.name, userSkillsDir);
        if (r.ok) {
          archived.push({ name: cand.name, ...(r.archivedPath ? { archivedPath: r.archivedPath } : {}) });
        } else {
          failed.push({ name: cand.name, error: r.message });
        }
      }
      log.info(`[/prune] days=${days} archived=${archived.length} failed=${failed.length}`);
      return c.json({
        days,
        archived,
        failed,
        count: archived.length,
      });
    } catch (err) {
      log.error(`[/prune] error: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  /**
   * POST /run
   * body: { dryRun?: boolean }
   * 仅当注入了 scheduler 才可用（启动时 server 已配 LLM provider 才能跑）
   */
  const runSchema = z.object({
    dryRun: z.coerce.boolean().optional(),
  });
  app.post('/run', async (c) => {
    const scheduler = deps.getScheduler?.();
    if (!scheduler) {
      return c.json({ error: 'scheduler not configured (no LLM provider?)' }, 503);
    }
    let body: { dryRun?: boolean };
    try {
      const raw = await c.req.json().catch(() => ({}));
      const parsed = runSchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: parsed.error.message }, 400);
      }
      body = parsed.data;
    } catch {
      body = {};
    }

    try {
      const result = await scheduler.triggerNow({ dryRun: body.dryRun ?? false });
      return c.json(result);
    } catch (err) {
      log.error(`[/run] error: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ error: 'internal error' }, 500);
    }
  });

  // ─── M7-Tier1 PR6: Curator 完整配置 ────────────────────────────────

  /**
   * GET /config
   * 返回当前 Curator 配置（与 security.skillCurator schema 对齐）。
   * ConfigManager 未注入时返回 schema 默认值（保 UI 降级可用）。
   */
  app.get('/config', (c) => {
    try {
      const stored = deps.configManager?.getConfig()?.security?.skillCurator;
      const merged = skillCuratorSchema.parse(stored ?? {});
      return c.json({ curator: merged });
    } catch (err) {
      log.warn(`[/config GET] error: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ curator: skillCuratorSchema.parse({}) });
    }
  });

  /**
   * POST /config
   *
   * Body: { curator: SkillCuratorConfig }
   * 写流程：zod validate（含 archivedDays > staleDays refine）→ 合并到 user 配置层 →
   * saveToDisk。Scheduler 通过 getConfig() 自动热重载，无需重启 sidecar。
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
    const curatorInput = body['curator'] ?? body;

    const parsed = skillCuratorSchema.safeParse(curatorInput);
    if (!parsed.success) {
      return c.json({ error: 'invalid curator config', issues: parsed.error.issues }, 400);
    }

    try {
      const cur = deps.configManager.getConfig();
      const next = {
        ...cur,
        security: {
          ...cur.security,
          skillCurator: parsed.data,
        },
      };
      deps.configManager.updateConfig(next);
      log.info('[/config POST] skillCurator updated', {
        enabled: parsed.data.enabled,
        intervalDays: parsed.data.intervalDays,
        staleDays: parsed.data.staleDays,
        archivedDays: parsed.data.archivedDays,
      });
      return c.json({ ok: true, curator: parsed.data });
    } catch (err) {
      log.error(`[/config POST] write failed: ${err instanceof Error ? err.message : String(err)}`);
      return c.json({ error: 'write config failed' }, 500);
    }
  });

  return app;
}
