import type { ChannelMessage } from '@evoclaw/shared';
import type {
  ChannelAdapter,
  ChannelConfig,
  ChannelStatusInfo,
  MessageHandler,
} from '../channel-adapter.js';
import { normalizeFeishuMessage } from '../message-normalizer.js';

/** 飞书凭证 */
interface FeishuCredentials {
  appId: string;
  appSecret: string;
}

/**
 * 飞书 Channel 适配器
 *
 * 集成飞书机器人 API：
 * - Webhook 消息接收（需外部 HTTP 服务器转发）
 * - 文本消息收发
 * - 私聊 + 群聊，@机器人触发检测
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
  private tenantAccessToken: string | null = null;
  private tokenTimer: ReturnType<typeof setInterval> | null = null;

  async connect(config: ChannelConfig): Promise<void> {
    this.credentials = {
      appId: config.credentials['appId'] ?? '',
      appSecret: config.credentials['appSecret'] ?? '',
    };

    if (!this.credentials.appId || !this.credentials.appSecret) {
      this.status = { ...this.status, status: 'error', error: '缺少 App ID 或 App Secret' };
      throw new Error('飞书配置不完整：需要 appId 和 appSecret');
    }

    this.status = { ...this.status, status: 'connecting', name: config.name };

    try {
      // 获取 Tenant Access Token
      await this.refreshToken();

      // 每 90 分钟刷新 Token（飞书 Token 有效期 2 小时）
      this.tokenTimer = setInterval(() => this.refreshToken(), 90 * 60_000);

      this.status = {
        ...this.status,
        status: 'connected',
        connectedAt: new Date().toISOString(),
        error: undefined,
      };
    } catch (err) {
      this.status = {
        ...this.status,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.tokenTimer) {
      clearInterval(this.tokenTimer);
      this.tokenTimer = null;
    }
    this.tenantAccessToken = null;
    this.status = { ...this.status, status: 'disconnected', error: undefined };
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  /**
   * 处理飞书 Webhook 事件
   * 由外部 HTTP 路由调用，将飞书事件转为 ChannelMessage
   */
  async handleWebhookEvent(event: Record<string, unknown>): Promise<string | null> {
    // URL 验证（challenge）
    if (event['type'] === 'url_verification') {
      return event['challenge'] as string;
    }

    // 消息事件
    const header = event['header'] as Record<string, unknown> | undefined;
    if (header?.['event_type'] !== 'im.message.receive_v1') return null;

    const eventBody = event['event'] as Record<string, unknown> | undefined;
    if (!eventBody) return null;

    const message = eventBody['message'] as Record<string, unknown>;
    const sender = eventBody['sender'] as Record<string, unknown>;

    if (!message || !sender) return null;

    // 忽略机器人自己发的消息
    const senderType = (sender as any)?.sender_type;
    if (senderType === 'app') return null;

    const accountId = this.credentials?.appId ?? '';
    const normalized = normalizeFeishuMessage(
      {
        message_id: message['message_id'] as string,
        chat_type: message['chat_type'] as string,
        chat_id: message['chat_id'] as string,
        sender: {
          sender_id: { open_id: (sender['sender_id'] as any)?.open_id ?? '' },
          sender_type: senderType ?? '',
        },
        content: message['content'] as string,
        msg_type: message['message_type'] as string,
      },
      accountId,
    );

    // 群聊中检测 @机器人
    if (normalized.chatType === 'group') {
      const mentions = message['mentions'] as any[] | undefined;
      const isMentioned = mentions?.some(
        (m) => m.id?.open_id === this.credentials?.appId || m.key === '@_all',
      );
      if (!isMentioned) return null; // 群聊中未 @ 不处理
    }

    if (this.handler) {
      await this.handler(normalized);
    }

    return null;
  }

  async sendMessage(peerId: string, content: string, chatType?: 'private' | 'group'): Promise<void> {
    if (!this.tenantAccessToken) {
      throw new Error('飞书未连接');
    }

    const receiveIdType = chatType === 'group' ? 'chat_id' : 'open_id';

    const res = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.tenantAccessToken}`,
        },
        body: JSON.stringify({
          receive_id: peerId,
          msg_type: 'text',
          content: JSON.stringify({ text: content }),
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`飞书发送失败: HTTP ${res.status} ${body.slice(0, 200)}`);
    }
  }

  getStatus(): ChannelStatusInfo {
    return { ...this.status };
  }

  /** 刷新 Tenant Access Token */
  private async refreshToken(): Promise<void> {
    if (!this.credentials) throw new Error('飞书未配置');

    const res = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: this.credentials.appId,
          app_secret: this.credentials.appSecret,
        }),
      },
    );

    if (!res.ok) {
      throw new Error(`飞书 Token 获取失败: HTTP ${res.status}`);
    }

    const data = await res.json() as { code: number; tenant_access_token?: string; msg?: string };
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`飞书 Token 错误: ${data.msg ?? 'unknown'}`);
    }

    this.tenantAccessToken = data.tenant_access_token;
  }
}
