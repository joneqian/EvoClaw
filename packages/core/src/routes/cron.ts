/**
 * Cron 路由 — 定时任务 CRUD
 */

import { Hono } from 'hono';
import type { CronRunner } from '../scheduler/cron-runner.js';

/** 创建 Cron 路由 */
export function createCronRoutes(cronRunner: CronRunner): Hono {
  const app = new Hono();

  /** POST / — 创建任务 */
  app.post('/', async (c) => {
    const body = await c.req.json<{
      agentId: string;
      name: string;
      cronExpression: string;
      actionType: string;
      actionConfig?: Record<string, unknown>;
    }>();

    try {
      const job = cronRunner.scheduleJob(body.agentId, {
        name: body.name,
        cronExpression: body.cronExpression,
        actionType: body.actionType,
        actionConfig: body.actionConfig,
      });
      return c.json({ job }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  /** GET / — 任务列表 */
  app.get('/', (c) => {
    const agentId = c.req.query('agentId');
    if (!agentId) {
      return c.json({ error: 'agentId is required' }, 400);
    }
    const jobs = cronRunner.listJobs(agentId);
    return c.json({ jobs });
  });

  /** PUT /:id — 更新任务 */
  app.put('/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      cronExpression?: string;
      actionType?: string;
      actionConfig?: Record<string, unknown>;
      enabled?: boolean;
    }>();

    const success = cronRunner.updateJob(id, body);
    if (!success) {
      return c.json({ error: 'Job not found' }, 404);
    }
    return c.json({ success: true });
  });

  /** DELETE /:id — 删除任务 */
  app.delete('/:id', (c) => {
    const id = c.req.param('id');
    const success = cronRunner.removeJob(id);
    if (!success) {
      return c.json({ error: 'Job not found' }, 404);
    }
    return c.json({ success: true });
  });

  return app;
}
