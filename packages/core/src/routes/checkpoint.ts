/**
 * Checkpoint REST 路由 — 暴露给前端 / agent 调用的撤销接口
 *
 * Endpoints:
 *   GET  /checkpoint/recent?limit=N      最近 N 条 checkpoint（UI 列表用）
 *   GET  /checkpoint/:invocationId       单条详情（diff 展示用）
 *   POST /checkpoint/:invocationId/revert 手动撤销（需要前端二次确认）
 *   POST /checkpoint/gc                   立即触发 GC（诊断用，cron 每天自动跑）
 */

import { Hono } from 'hono';
import { createLogger } from '../infrastructure/logger.js';
import type { CheckpointManager } from '../agent/checkpoint/checkpoint-manager.js';

const log = createLogger('checkpoint-routes');

export interface CheckpointRouteDeps {
  manager: CheckpointManager;
}

export function createCheckpointRoutes(deps: CheckpointRouteDeps): Hono {
  const router = new Hono();
  const { manager } = deps;

  /** GET /checkpoint/recent?limit=50 */
  router.get('/recent', (c) => {
    const limitParam = c.req.query('limit');
    const limit = limitParam ? Math.min(Math.max(1, parseInt(limitParam, 10) || 50), 200) : 50;
    const list = manager.listRecent(limit);
    return c.json({
      success: true,
      data: list.map((r) => ({
        toolInvocationId: r.toolInvocationId,
        toolName: r.toolName,
        agentId: r.agentId,
        sessionKey: r.sessionKey,
        files: r.files.map((f) => ({
          path: f.path,
          existedBefore: f.existedBefore,
          shaBefore: f.shaBefore,
        })),
        createdAt: r.createdAt,
        revertedAt: r.revertedAt,
      })),
    });
  });

  /** GET /checkpoint/:invocationId */
  router.get('/:invocationId', (c) => {
    const id = c.req.param('invocationId');
    const record = manager.get(id);
    if (!record) {
      return c.json({ success: false, error: 'checkpoint not found' }, 404);
    }
    return c.json({ success: true, data: record });
  });

  /** POST /checkpoint/:invocationId/revert */
  router.post('/:invocationId/revert', async (c) => {
    const id = c.req.param('invocationId');
    log.info(`[routes] manual revert request invocation=${id}`);
    const restored = await manager.revert(id);
    if (restored === -1) {
      return c.json({ success: false, error: 'checkpoint not found' }, 404);
    }
    return c.json({ success: true, restored });
  });

  /** POST /checkpoint/gc — 立即触发 GC，body 可选 { retentionDays } */
  router.post('/gc', async (c) => {
    let retentionMs: number | undefined;
    try {
      const body = (await c.req.json().catch(() => null)) as
        | { retentionDays?: number }
        | null;
      if (body?.retentionDays && Number.isFinite(body.retentionDays)) {
        retentionMs = body.retentionDays * 24 * 60 * 60 * 1000;
      }
    } catch {
      /* 无 body 走默认 7 天 */
    }
    const result = await manager.gc(retentionMs);
    log.info(
      `[routes] gc invoked deletedRefs=${result.deletedRefs} deletedObjects=${result.deletedObjects}`,
    );
    return c.json({ success: true, ...result });
  });

  return router;
}
