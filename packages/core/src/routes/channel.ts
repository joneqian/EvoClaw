/**
 * Channel 管理路由 — 连接/断开/状态 + Webhook 接收
 */

import { Hono } from 'hono';
import type { ChannelManager } from '../channel/channel-manager.js';
import type { ChannelConfig } from '../channel/channel-adapter.js';
import type { ChannelType } from '@evoclaw/shared';
import type { FeishuAdapter } from '../channel/adapters/feishu.js';
import type { WecomAdapter } from '../channel/adapters/wecom.js';

/** 创建 Channel 路由 */
export function createChannelRoutes(channelManager: ChannelManager): Hono {
  const app = new Hono();

  /** POST /connect — 连接 Channel */
  app.post('/connect', async (c) => {
    const body = await c.req.json<ChannelConfig>();
    try {
      await channelManager.connect(body);
      return c.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  /** POST /disconnect — 断开 Channel */
  app.post('/disconnect', async (c) => {
    const body = await c.req.json<{ type: ChannelType }>();
    await channelManager.disconnect(body.type);
    return c.json({ success: true });
  });

  /** GET /status — 所有 Channel 状态 */
  app.get('/status', (c) => {
    const statuses = channelManager.getStatuses();
    return c.json({ channels: statuses });
  });

  /** GET /status/:type — 单个 Channel 状态 */
  app.get('/status/:type', (c) => {
    const type = c.req.param('type') as ChannelType;
    const status = channelManager.getStatus(type);
    if (!status) {
      return c.json({ error: 'Channel not found' }, 404);
    }
    return c.json({ channel: status });
  });

  /** POST /webhook/feishu — 飞书 Webhook 接收 */
  app.post('/webhook/feishu', async (c) => {
    const event = await c.req.json();

    // URL 验证
    if (event.type === 'url_verification') {
      return c.json({ challenge: event.challenge });
    }

    const adapter = channelManager.getStatus('feishu');
    if (!adapter || adapter.status !== 'connected') {
      return c.json({ error: '飞书 Channel 未连接' }, 503);
    }

    // 获取飞书适配器实例并处理事件
    try {
      // 通过 ChannelManager 内部的适配器处理
      const feishuAdapter = (channelManager as any).adapters.get('feishu') as FeishuAdapter | undefined;
      if (feishuAdapter) {
        const challenge = await feishuAdapter.handleWebhookEvent(event);
        if (challenge) return c.json({ challenge });
      }
    } catch (err) {
      console.error('[channel/webhook/feishu]', err);
    }

    return c.json({ success: true });
  });

  /** POST /webhook/wecom — 企微回调接收 */
  app.post('/webhook/wecom', async (c) => {
    const body = await c.req.json();

    const adapter = channelManager.getStatus('wecom');
    if (!adapter || adapter.status !== 'connected') {
      return c.json({ error: '企微 Channel 未连接' }, 503);
    }

    try {
      const wecomAdapter = (channelManager as any).adapters.get('wecom') as WecomAdapter | undefined;
      if (wecomAdapter) {
        const isGroup = body['ChatType'] === 'group' || !!body['ChatId'];
        await wecomAdapter.handleCallbackMessage(body, isGroup);
      }
    } catch (err) {
      console.error('[channel/webhook/wecom]', err);
    }

    return c.json({ success: true });
  });

  return app;
}
