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

/**
 * 从连接配置推断账号标识（accountId）
 *
 * - 飞书：`credentials.appId`
 * - 企微：`credentials.corpId`
 * - 微信 / 其他：用户显式 body.accountId 或空串（单账号语义）
 *
 * 用户通过 `body.accountId` 显式指定优先于派生。
 */
function deriveAccountId(body: ChannelConfig): string {
  if (body.accountId && body.accountId !== '') return body.accountId;
  const creds = body.credentials ?? {};
  if (body.type === 'feishu' && typeof creds['appId'] === 'string') return creds['appId'];
  if (body.type === 'wecom' && typeof creds['corpId'] === 'string') return creds['corpId'];
  return '';
}

/** 创建 Channel 路由 */
export function createChannelRoutes(
  channelManager: ChannelManager,
  bindingRouter?: BindingRouter,
  channelStateRepo?: ChannelStateRepo,
): Hono {
  const app = new Hono();

  /**
   * POST /connect — 连接 Channel（多账号 + 可选绑定 agentId）
   *
   * 多账号语义：
   * - `body.accountId` 由前端或后端从 credentials 派生（飞书=appId / 企微=corpId）
   * - 同 (type, accountId) 多次 connect 会替换该账号的凭据与 WS 连接，不影响其他账号
   * - agentId 绑定按 (agent, channel) 1:1，已绑定其他账号时**只替换该 agent 的
   *   binding**，不动其他 agent（修防误伤）
   */
  app.post('/connect', async (c) => {
    const body = await c.req.json<ChannelConfig & { agentId?: string }>();
    try {
      // 从 credentials 派生 accountId：飞书=appId，企微=corpId，其他 fallback 到 ''
      const accountId = deriveAccountId(body);
      body.accountId = accountId;

      // 允许"编辑配置但不改 appSecret"场景：按 (type, accountId) 取已存凭据补 secret
      // 老数据 fallback：accountId 下查不到时回退到 accountId=''（migration 030
      // 迁移期间可能存在），让第一次带真实 appId connect 也能沿用老 secret
      if (channelStateRepo) {
        let existing = channelStateRepo.getState(body.type as any, accountId, 'credentials');
        if (!existing && accountId !== '') {
          existing = channelStateRepo.getState(body.type as any, '', 'credentials');
        }
        if (existing) {
          let prev: Record<string, string>;
          try {
            prev = JSON.parse(existing) as Record<string, string>;
          } catch {
            prev = {};
          }
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
        channelStateRepo.setState(body.type as any, accountId, 'credentials', JSON.stringify(body.credentials));
        channelStateRepo.setState(body.type as any, accountId, 'name', body.name);
      }

      // 如果提供了 agentId，创建 Channel → Agent 绑定（Agent ↔ accountId 1:1）
      if (body.agentId && bindingRouter) {
        // 移除该 agent 在此 channel 已有的绑定（不动其他 agent 的绑定）
        const existing = bindingRouter
          .listBindings(body.agentId)
          .filter((b) => b.channel === body.type);
        for (const b of existing) {
          bindingRouter.removeBinding(b.id);
        }
        // 创建新绑定，带 accountId
        bindingRouter.addBinding({
          agentId: body.agentId,
          channel: body.type,
          accountId: accountId || null,
          peerId: null,
          priority: 0,
          isDefault: false,
        });
        log.info(`Channel ${body.type}[${accountId}] 已绑定 Agent ${body.agentId}`);
      }

      return c.json({ success: true, accountId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  /**
   * POST /disconnect — 断开 Channel 某账号并移除该账号的关联绑定
   *
   * body 参数：
   * - `type`: ChannelType 必填
   * - `accountId`: string 可选（不传时断该 type 下的默认账号，多账号场景下建议显式传）
   * - `purge`: 是否清除 channel_state 里的凭据（默认 false）
   *
   * 修防误伤：只移除 `(channel=type, account_id=accountId)` 精确匹配的 binding，
   * 不动同 channel type 下其他账号的 binding。
   */
  app.post('/disconnect', async (c) => {
    const body = await c.req.json<{ type: ChannelType; accountId?: string; purge?: boolean }>();
    const accountId = body.accountId ?? '';
    await channelManager.disconnect(body.type, accountId);

    if (channelStateRepo && body.purge === true) {
      channelStateRepo.deleteState(body.type as any, accountId, 'credentials');
      channelStateRepo.deleteState(body.type as any, accountId, 'name');
      log.info(`Channel ${body.type}[${accountId}] 凭据已清除 (purge)`);
    }

    // 仅移除该 (channel, account_id) 的绑定，不误伤同 channel type 其他账号
    if (bindingRouter) {
      const bindings = bindingRouter
        .listBindings()
        .filter((b) => b.channel === body.type && (b.accountId ?? '') === accountId);
      for (const b of bindings) {
        bindingRouter.removeBinding(b.id);
      }
      if (bindings.length > 0) {
        log.info(`Channel ${body.type}[${accountId}] 断开，已移除 ${bindings.length} 条绑定`);
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
   * GET /credentials/:type[/:accountId] — 获取已保存的某渠道/账号凭据（脱敏）
   *
   * 用途：前端重连 / 编辑配置时预填表单。
   *
   * 路径：
   * - 单账号兼容：`GET /credentials/feishu` → 取该渠道第一个账号的凭据
   * - 多账号精确：`GET /credentials/feishu/cli_xxx` → 取该 appId 的凭据
   *
   * 脱敏策略：敏感字段（appSecret/encryptKey/verificationToken/corpSecret 等）不返回，
   * 仅返回非敏感字段 + `hasSecret: bool` 让前端判断是否已保存密码。
   */
  const respondCredentials = (type: ChannelType, accountId: string) => {
    if (!channelStateRepo) {
      return { credentials: null, hasSecret: false, accountId };
    }
    const raw = channelStateRepo.getState(type as any, accountId, 'credentials');
    if (!raw) {
      return { credentials: null, hasSecret: false, accountId };
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { credentials: null, hasSecret: false, accountId };
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
    const name = channelStateRepo.getState(type as any, accountId, 'name') ?? undefined;
    return { credentials: safe, hasSecret, name, accountId };
  };

  /** GET /credentials/:type — 兼容老路径（返回第一个账号） */
  app.get('/credentials/:type', (c) => {
    const type = c.req.param('type') as ChannelType;
    if (!channelStateRepo) {
      return c.json({ credentials: null, hasSecret: false });
    }
    const accounts = channelStateRepo.listAccounts(type as any);
    const firstAccount = accounts[0] ?? '';
    return c.json(respondCredentials(type, firstAccount));
  });

  /** GET /credentials/:type/:accountId — 按 accountId 精确查询 */
  app.get('/credentials/:type/:accountId', (c) => {
    const type = c.req.param('type') as ChannelType;
    const accountId = c.req.param('accountId');
    return c.json(respondCredentials(type, accountId));
  });

  /** GET /accounts/:type — 列出某渠道下所有已保存的账号（含凭据脱敏） */
  app.get('/accounts/:type', (c) => {
    const type = c.req.param('type') as ChannelType;
    if (!channelStateRepo) {
      return c.json({ accounts: [] });
    }
    const accountIds = channelStateRepo.listAccounts(type as any);
    const accounts = accountIds.map((accId) => respondCredentials(type, accId));
    return c.json({ accounts });
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
