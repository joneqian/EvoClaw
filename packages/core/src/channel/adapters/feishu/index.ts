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

      this.status = {
        ...this.status,
        status: 'connected',
        connectedAt: new Date().toISOString(),
        error: undefined,
      };
      log.info(`飞书 Channel 已连接 appId=${credentials.appId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.status = { ...this.status, status: 'error', error: message };
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    try {
      this.bundle?.wsClient.close();
    } catch (err) {
      log.warn(`关闭飞书 WS 失败: ${err instanceof Error ? err.message : err}`);
    }
    this.bundle = null;
    this.credentials = null;
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

  /** 手动设置机器人 open_id（用于群聊 @ 检测；Phase H 会改为 SDK 自动发现） */
  setBotOpenId(openId: string | null): void {
    this.botOpenId = openId;
  }

  private requireClient(): Lark.Client {
    if (!this.bundle || this.status.status !== 'connected') {
      throw new Error('飞书 Channel 未连接');
    }
    return this.bundle.client;
  }
}
