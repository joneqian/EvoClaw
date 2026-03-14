import type {
  ChannelAdapter,
  ChannelConfig,
  ChannelStatusInfo,
  MessageHandler,
} from '../channel-adapter.js';
import { normalizeWecomMessage } from '../message-normalizer.js';

/** 企微凭证 */
interface WecomCredentials {
  corpId: string;
  agentId: string;
  secret: string;
  token?: string;       // 回调 Token
  encodingAESKey?: string;
}

/**
 * 企微 Channel 适配器
 *
 * 企业微信应用 API 集成：
 * - 回调消息接收（需外部 HTTP 服务器转发）
 * - 文本消息收发
 * - 私聊 + 群聊
 */
export class WecomAdapter implements ChannelAdapter {
  readonly type = 'wecom' as const;

  private handler: MessageHandler | null = null;
  private status: ChannelStatusInfo = {
    type: 'wecom',
    name: '企业微信',
    status: 'disconnected',
  };
  private credentials: WecomCredentials | null = null;
  private accessToken: string | null = null;
  private tokenTimer: ReturnType<typeof setInterval> | null = null;

  async connect(config: ChannelConfig): Promise<void> {
    this.credentials = {
      corpId: config.credentials['corpId'] ?? '',
      agentId: config.credentials['agentId'] ?? '',
      secret: config.credentials['secret'] ?? '',
      token: config.credentials['token'],
      encodingAESKey: config.credentials['encodingAESKey'],
    };

    if (!this.credentials.corpId || !this.credentials.secret) {
      this.status = { ...this.status, status: 'error', error: '缺少 Corp ID 或 Secret' };
      throw new Error('企微配置不完整：需要 corpId 和 secret');
    }

    this.status = { ...this.status, status: 'connecting', name: config.name };

    try {
      await this.refreshToken();
      // 每 100 分钟刷新（企微 Token 有效期 2 小时）
      this.tokenTimer = setInterval(() => this.refreshToken(), 100 * 60_000);

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
    this.accessToken = null;
    this.status = { ...this.status, status: 'disconnected', error: undefined };
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  /**
   * 处理企微回调消息
   * 由外部 HTTP 路由调用
   */
  async handleCallbackMessage(xmlData: Record<string, string>, isGroup: boolean = false): Promise<void> {
    if (!xmlData['Content'] && !xmlData['MsgId']) return;

    const accountId = this.credentials?.corpId ?? '';
    const normalized = normalizeWecomMessage(
      {
        MsgId: xmlData['MsgId'] ?? '',
        MsgType: xmlData['MsgType'] ?? 'text',
        Content: xmlData['Content'] ?? '',
        FromUserName: xmlData['FromUserName'] ?? '',
        ToUserName: xmlData['ToUserName'] ?? '',
        CreateTime: parseInt(xmlData['CreateTime'] ?? '0', 10),
        AgentID: parseInt(xmlData['AgentID'] ?? '0', 10),
      },
      accountId,
      isGroup,
    );

    if (this.handler) {
      await this.handler(normalized);
    }
  }

  async sendMessage(peerId: string, content: string, _chatType?: 'private' | 'group'): Promise<void> {
    if (!this.accessToken) {
      throw new Error('企微未连接');
    }

    const res = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${this.accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: peerId,
          msgtype: 'text',
          agentid: parseInt(this.credentials?.agentId ?? '0', 10),
          text: { content },
        }),
      },
    );

    if (!res.ok) {
      throw new Error(`企微发送失败: HTTP ${res.status}`);
    }

    const data = await res.json() as { errcode: number; errmsg: string };
    if (data.errcode !== 0) {
      throw new Error(`企微发送失败: ${data.errmsg}`);
    }
  }

  getStatus(): ChannelStatusInfo {
    return { ...this.status };
  }

  /** 刷新 Access Token */
  private async refreshToken(): Promise<void> {
    if (!this.credentials) throw new Error('企微未配置');

    const res = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.credentials.corpId}&corpsecret=${this.credentials.secret}`,
    );

    if (!res.ok) {
      throw new Error(`企微 Token 获取失败: HTTP ${res.status}`);
    }

    const data = await res.json() as { errcode: number; access_token?: string; errmsg?: string };
    if (data.errcode !== 0 || !data.access_token) {
      throw new Error(`企微 Token 错误: ${data.errmsg ?? 'unknown'}`);
    }

    this.accessToken = data.access_token;
  }
}
