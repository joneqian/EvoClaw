/**
 * Channel 管理路由 — 连接/断开/状态 + Webhook 接收 + Binding 联动
 */

import { Hono } from 'hono';
import type { ChannelManager } from '../channel/channel-manager.js';
import type { ChannelConfig } from '../channel/channel-adapter.js';
import type { ChannelType } from '@evoclaw/shared';
import type { BindingRouter } from '../routing/binding-router.js';
import type { ChannelStateRepo } from '../channel/channel-state-repo.js';
import type { FeishuAdapter } from '../channel/adapters/feishu.js';
import type { WecomAdapter } from '../channel/adapters/wecom.js';
import { getQrCode, pollQrStatus } from '../channel/adapters/weixin-api.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('channel-webhook');

/** 创建 Channel 路由 */
export function createChannelRoutes(
  channelManager: ChannelManager,
  bindingRouter?: BindingRouter,
  channelStateRepo?: ChannelStateRepo,
): Hono {
  const app = new Hono();

  /** POST /connect — 连接 Channel（可选绑定 agentId） */
  app.post('/connect', async (c) => {
    const body = await c.req.json<ChannelConfig & { agentId?: string }>();
    try {
      await channelManager.connect(body);

      // 持久化凭证到 channel_state（启动时自动恢复连接用）
      if (channelStateRepo) {
        channelStateRepo.setState(body.type as any, 'credentials', JSON.stringify(body.credentials));
        channelStateRepo.setState(body.type as any, 'name', body.name);
      }

      // 如果提供了 agentId，创建 Channel → Agent 绑定
      if (body.agentId && bindingRouter) {
        // 移除该 Channel 类型已有的绑定（一个 Channel 对应一个 Agent）
        const existing = bindingRouter.listBindings().filter(b => b.channel === body.type);
        for (const b of existing) {
          bindingRouter.removeBinding(b.id);
        }
        // 创建新绑定
        bindingRouter.addBinding({
          agentId: body.agentId,
          channel: body.type,
          accountId: null,
          peerId: null,
          priority: 0,
          isDefault: false,
        });
        log.info(`Channel ${body.type} 已绑定 Agent ${body.agentId}`);
      }

      return c.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  /** POST /disconnect — 断开 Channel 并移除关联绑定 */
  app.post('/disconnect', async (c) => {
    const body = await c.req.json<{ type: ChannelType }>();
    await channelManager.disconnect(body.type);

    // 清除持久化的凭证
    if (channelStateRepo) {
      channelStateRepo.deleteState(body.type as any, 'credentials');
      channelStateRepo.deleteState(body.type as any, 'name');
    }

    // 移除该 Channel 类型的绑定
    if (bindingRouter) {
      const bindings = bindingRouter.listBindings().filter(b => b.channel === body.type);
      for (const b of bindings) {
        bindingRouter.removeBinding(b.id);
      }
      if (bindings.length > 0) {
        log.info(`Channel ${body.type} 断开，已移除 ${bindings.length} 条绑定`);
      }
    }

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

  /** GET /bindings — 当前所有 Channel-Agent 绑定 */
  app.get('/bindings', (c) => {
    const bindings = bindingRouter ? bindingRouter.listBindings() : [];
    return c.json({ bindings });
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
      log.error('feishu webhook 处理失败', err);
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
      log.error('wecom webhook 处理失败', err);
    }

    return c.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // 微信 QR 码登录代理 (避免前端 CORS)
  // ---------------------------------------------------------------------------

  /** GET /weixin/qrcode — 获取微信登录二维码 */
  app.get('/weixin/qrcode', async (c) => {
    try {
      const data = await getQrCode();
      return c.json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('获取微信二维码失败', err);
      return c.json({ error: message }, 500);
    }
  });

  /** GET /weixin/qrcode-status — 轮询二维码扫描状态 */
  app.get('/weixin/qrcode-status', async (c) => {
    const qrcode = c.req.query('qrcode');
    if (!qrcode) {
      return c.json({ error: '缺少 qrcode 参数' }, 400);
    }
    try {
      const data = await pollQrStatus(undefined, qrcode);
      return c.json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('轮询微信 QR 状态失败', err);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
