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
    }>();

    try {
      const id = router.addBinding({
        agentId: body.agentId,
        channel: body.channel,
        accountId: body.accountId ?? null,
        peerId: body.peerId ?? null,
        priority: body.priority ?? 0,
        isDefault: body.isDefault ?? false,
      });
      return c.json({ id }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
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
