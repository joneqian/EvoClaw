/**
 * 飞书 Channel 适配器
 *
 * 基于 @larksuiteoapi/node-sdk 的 WebSocket 长连接模式：
 * - connect() 构造 SDK Client + WSClient + EventDispatcher，启动长连接
 * - disconnect() 关闭长连接
 * - sendMessage() 通过 client.im.v1.message.create 发送
 *
 * 不支持 Webhook 模式（EvoClaw 桌面 sidecar 无公网 IP）
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import type {
  ChannelAdapter,
  ChannelConfig,
  ChannelStatusInfo,
  MessageHandler,
} from '../../channel-adapter.js';
import { createLogger } from '../../../infrastructure/logger.js';
import {
  createFeishuSdkBundle,
  type FeishuSdk,
  type FeishuSdkBundle,
} from './client.js';
import { parseFeishuCredentials, type FeishuCredentials } from './config.js';
import { registerInboundHandlers } from './inbound.js';
import { sendTextMessage } from './outbound.js';

const log = createLogger('feishu-adapter');

/** FeishuAdapter 可选注入（测试用） */
export interface FeishuAdapterOptions {
  sdk?: FeishuSdk;
  /** 覆盖 bot 身份自动发现（测试用） */
  hydrateBotOpenId?: (client: Lark.Client) => Promise<string | null>;
}

/** 默认的 bot 身份发现：调用 /open-apis/bot/v3/info */
async function defaultHydrateBotOpenId(client: Lark.Client): Promise<string | null> {
  try {
    const res = await client.request<{
      code?: number;
      bot?: { open_id?: string };
    }>({
      url: '/open-apis/bot/v3/info',
      method: 'GET',
    });
    if (res.code !== 0) return null;
    return res.bot?.open_id ?? null;
  } catch (err) {
    log.warn(`bot 身份发现失败: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * 飞书 Channel 适配器（ChannelAdapter 实现）
 */
export class FeishuAdapter implements ChannelAdapter {
  readonly type = 'feishu' as const;

  private handler: MessageHandler | null = null;
  private status: ChannelStatusInfo = {
    type: 'feishu',
    name: '飞书',
    status: 'disconnected',
  };

  private credentials: FeishuCredentials | null = null;
  private bundle: FeishuSdkBundle | null = null;
  private botOpenId: string | null = null;

  constructor(private readonly options: FeishuAdapterOptions = {}) {}

  async connect(config: ChannelConfig): Promise<void> {
    // 防泄漏：若存在旧 bundle（上次 connect 失败或 ChannelManager 触发重连），先清理
    await this.cleanupBundle();

    this.status = { ...this.status, status: 'connecting', name: config.name };
    try {
      const credentials = parseFeishuCredentials(config.credentials);
      this.credentials = credentials;

      const bundle = createFeishuSdkBundle(credentials, this.options.sdk);
      this.bundle = bundle;

      registerInboundHandlers(bundle.dispatcher, {
        getAccountId: () => this.credentials?.appId ?? '',
        getBotOpenId: () => this.botOpenId,
        getHandler: () => this.handler,
      });

      await bundle.wsClient.start({ eventDispatcher: bundle.dispatcher });

      // 连接成功后拉 bot 身份（失败不阻塞，只会让群 @ 过滤偏保守）
      const hydrate = this.options.hydrateBotOpenId ?? defaultHydrateBotOpenId;
      this.botOpenId = await hydrate(bundle.client);
      if (!this.botOpenId) {
        log.warn('未能发现 bot open_id，群聊 @ 过滤将仅放行 @所有人');
      }

      this.status = {
        ...this.status,
        status: 'connected',
        connectedAt: new Date().toISOString(),
        error: undefined,
      };
      log.info(`飞书 Channel 已连接 appId=${credentials.appId} bot=${this.botOpenId ?? '未知'}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.status = { ...this.status, status: 'error', error: message };
      await this.cleanupBundle();
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await this.cleanupBundle();
    this.credentials = null;
    this.botOpenId = null;
    this.status = { ...this.status, status: 'disconnected', error: undefined };
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async sendMessage(
    peerId: string,
    content: string,
    chatType?: 'private' | 'group',
  ): Promise<void> {
    const client = this.requireClient();
    await sendTextMessage(client, peerId, content, chatType);
  }

  getStatus(): ChannelStatusInfo {
    return { ...this.status };
  }

  /** 覆盖 bot open_id（测试 / Phase H 场景用，正常通过 connect() 自动拉取） */
  setBotOpenId(openId: string | null): void {
    this.botOpenId = openId;
  }

  private requireClient(): Lark.Client {
    if (!this.bundle || this.status.status !== 'connected') {
      throw new Error('飞书 Channel 未连接');
    }
    return this.bundle.client;
  }

  /** 清理已有 WS 连接（幂等） */
  private async cleanupBundle(): Promise<void> {
    const bundle = this.bundle;
    if (!bundle) return;
    this.bundle = null;
    try {
      await Promise.resolve(bundle.wsClient.close());
    } catch (err) {
      log.warn(`关闭飞书 WS 失败: ${err instanceof Error ? err.message : err}`);
    }
  }
}
