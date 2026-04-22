/**
 * Channel 管理路由 — 连接/断开/状态 + Webhook 接收 + Binding 联动
 */

import { Hono } from 'hono';
import type { ChannelManager } from '../channel/channel-manager.js';
import type { ChannelConfig } from '../channel/channel-adapter.js';
import type { ChannelType } from '@evoclaw/shared';
import type { BindingRouter } from '../routing/binding-router.js';
import type { ChannelStateRepo } from '../channel/channel-state-repo.js';
import type { WecomAdapter } from '../channel/adapters/wecom.js';
import { Feature } from '../infrastructure/feature.js';
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
      // 允许"编辑配置但不改 appSecret"场景：appSecret 留空时从已存 credentials
      // 取旧值补上，避免用户每次改群会话策略 / 广播配置都要重填 secret。
      if (channelStateRepo) {
        const existing = channelStateRepo.getState(body.type as any, 'credentials');
        if (existing) {
          let prev: Record<string, string>;
          try {
            prev = JSON.parse(existing) as Record<string, string>;
          } catch {
            prev = {};
          }
          // 仅对"空字符串 / 缺字段"的敏感字段做沿用，保留用户显式新值
          const SECRET_KEYS = ['appSecret', 'encryptKey', 'verificationToken', 'corpSecret'];
          const merged = { ...body.credentials };
          for (const key of SECRET_KEYS) {
            const provided = merged[key];
            if ((provided === undefined || provided === '') && prev[key]) {
              merged[key] = prev[key];
            }
          }
          body.credentials = merged;
        }
      }

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

  /**
   * POST /disconnect — 断开 Channel 并移除关联绑定
   *
   * 默认只断 WS / 长轮询，**保留**持久化凭据（方便下次快速重连和二次编辑）。
   * 传 `purge: true` 才彻底清除 channel_state 里的凭据。
   */
  app.post('/disconnect', async (c) => {
    const body = await c.req.json<{ type: ChannelType; purge?: boolean }>();
    await channelManager.disconnect(body.type);

    // 只有显式 purge 时才清除持久化凭据
    if (channelStateRepo && body.purge === true) {
      channelStateRepo.deleteState(body.type as any, 'credentials');
      channelStateRepo.deleteState(body.type as any, 'name');
      log.info(`Channel ${body.type} 凭据已清除 (purge)`);
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

  /**
   * GET /credentials/:type — 获取已保存的 Channel 凭据（脱敏）
   *
   * 用途：前端重连 / 编辑配置时预填表单。
   *
   * 脱敏策略：
   * - 敏感字段（appSecret / encryptKey / verificationToken / corpSecret 等）不返回
   * - 非敏感字段（appId / domain / groupSessionScope / groupHistory* / broadcast*）原样返回
   * - 返回 `hasSecret: true/false` 让前端知道是否有已存 secret，可渲染"已保存"占位符
   */
  app.get('/credentials/:type', (c) => {
    const type = c.req.param('type') as ChannelType;
    if (!channelStateRepo) {
      return c.json({ credentials: null, hasSecret: false });
    }
    const raw = channelStateRepo.getState(type as any, 'credentials');
    if (!raw) {
      return c.json({ credentials: null, hasSecret: false });
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return c.json({ credentials: null, hasSecret: false });
    }
    const SENSITIVE_KEYS = new Set([
      'appSecret',
      'encryptKey',
      'verificationToken',
      'corpSecret',
      'secret',
      'token',
      'password',
    ]);
    const hasSecret =
      typeof parsed['appSecret'] === 'string' && (parsed['appSecret'] as string).length > 0;
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!SENSITIVE_KEYS.has(k)) safe[k] = v;
    }
    const name = channelStateRepo.getState(type as any, 'name') ?? undefined;
    return c.json({ credentials: safe, hasSecret, name });
  });

  // 注：飞书 Channel 使用 WebSocket 长连接，无 Webhook 路由（桌面 sidecar 无公网 IP）

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
  // 微信 QR 码登录代理 (避免前端 CORS) — Feature.WEIXIN 门控
  // ---------------------------------------------------------------------------

  if (Feature.WEIXIN) {
    /** GET /weixin/qrcode — 获取微信登录二维码 */
    app.get('/weixin/qrcode', async (c) => {
      try {
        const { getQrCode } = await import('../channel/adapters/weixin-api.js');
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
        const { pollQrStatus } = await import('../channel/adapters/weixin-api.js');
        const data = await pollQrStatus(undefined, qrcode);
        return c.json(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('轮询微信 QR 状态失败', err);
        return c.json({ error: message }, 500);
      }
    });
  }

  return app;
}
