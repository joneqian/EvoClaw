/**
 * System Events 路由 — 手动注入事件到 Agent 会话
 */

import { Hono } from 'hono';
import { enqueueSystemEvent, peekSystemEvents } from '../infrastructure/system-events.js';
import { generateSessionKey } from '../routing/session-key.js';

export function createSystemEventRoutes(): Hono {
  const app = new Hono();

  /** POST /:agentId/events — 注入系统事件 */
  app.post('/:agentId/events', async (c) => {
    const agentId = c.req.param('agentId');
    const body = await c.req.json<{ text?: string; sessionKey?: string }>().catch(() => ({ text: undefined, sessionKey: undefined }));
    const text = body.text?.trim();

    if (!text) {
      return c.json({ error: '事件文本不能为空' }, 400);
    }

    const sessionKey = body.sessionKey ?? generateSessionKey(agentId, 'local', 'direct', 'local-user');
    const ok = enqueueSystemEvent(text, sessionKey);

    return c.json({ success: ok, sessionKey });
  });

  /** GET /:agentId/events — 查看待处理事件（不消费） */
  app.get('/:agentId/events', (c) => {
    const agentId = c.req.param('agentId');
    const sessionKey = c.req.query('sessionKey') ?? generateSessionKey(agentId, 'local', 'direct', 'local-user');
    const events = peekSystemEvents(sessionKey);
    return c.json({ events, sessionKey });
  });

  return app;
}
