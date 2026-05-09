/**
 * Binding 管理路由 — Channel → Agent 绑定规则 CRUD
 */

import { Hono } from 'hono';
import { BindingRouter } from '../routing/binding-router.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';

/** 创建 Binding 路由 */
export function createBindingRoutes(db: SqliteStore): Hono {
  const app = new Hono();
  const router = new BindingRouter(db);

  /** POST / — 创建 Binding */
  app.post('/', async (c) => {
    const body = await c.req.json<{
      agentId: string;
      channel: string;
      accountId?: string;
      peerId?: string;
      priority?: number;
      isDefault?: boolean;
      // M13 Phase 1 PR-1A/1D: DM 隔离粒度（main/per-peer/per-channel-peer/
      // per-account-channel-peer）+ per-task 群消息任务级隔离
      dmScope?: 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer' | 'per-task' | null;
    }>();

    try {
      const id = router.addBinding({
        agentId: body.agentId,
        channel: body.channel,
        accountId: body.accountId ?? null,
        peerId: body.peerId ?? null,
        priority: body.priority ?? 0,
        isDefault: body.isDefault ?? false,
        ...(body.dmScope !== undefined ? { dmScope: body.dmScope } : {}),
      });
      return c.json({ id }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  /**
   * M13 Phase 1 PR-1A/1D: PATCH /:id 更新 binding（当前仅支持 dm_scope）
   * 让员工在 UI 切换 DM 跨渠道连贯 vs 隔离 / 群消息按任务隔离。
   */
  app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{
      dmScope?: 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer' | 'per-task' | null;
    }>();
    if (body.dmScope === undefined) {
      return c.json({ error: 'no field to update' }, 400);
    }
    const changes = router.setDmScope(id, body.dmScope);
    return c.json({ ok: changes > 0, affected: changes });
  });

  /** GET / — 列表 */
  app.get('/', (c) => {
    const agentId = c.req.query('agentId');
    const bindings = router.listBindings(agentId ?? undefined);
    return c.json({ bindings });
  });

  /** DELETE /:id — 删除 */
  app.delete('/:id', (c) => {
    const id = c.req.param('id');
    router.removeBinding(id);
    return c.json({ success: true });
  });

  /** POST /resolve — 测试消息路由（调试用） */
  app.post('/resolve', async (c) => {
    const body = await c.req.json<{
      channel: string;
      accountId?: string;
      peerId?: string;
    }>();

    const agentId = router.resolveAgent({
      channel: body.channel,
      accountId: body.accountId,
      peerId: body.peerId,
    });

    return c.json({ agentId });
  });

  return app;
}
