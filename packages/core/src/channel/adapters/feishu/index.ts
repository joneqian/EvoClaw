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
import { registerInboundHandlers, type MediaDownloader } from './inbound.js';
import { sendMediaMessage, sendSmartMessage } from './outbound.js';
import { downloadMessageResource } from './media.js';
import {
  ApprovalRegistry,
  requestApprovalViaCard,
  type ApprovalRequestOptions,
  type ApprovalDecision,
} from './send-approval.js';
import { registerCardActionHandlers } from './card-action.js';
import {
  beginStreamingCard,
  type StreamingCardHandle,
  type StreamingCardOptions,
} from './cardkit-streaming.js';
import {
  registerOtherEventHandlers,
  type FeishuEventCallbacks,
} from './event-handlers.js';
import { withFeishuRetry } from './retry.js';
import {
  addWholeCommentReply as apiAddWholeCommentReply,
  replyToComment as apiReplyToComment,
  listCommentReplies as apiListCommentReplies,
  type FeishuFileType as DocFileType,
} from './doc-api.js';

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
  /** 媒体下载器，connect() 时构造，disconnect() 后置空 */
  private mediaDownloader: MediaDownloader | null = null;
  /** 审批注册表（每个 adapter 实例独立，跨重连保留 */
  private readonly approvalRegistry = new ApprovalRegistry();
  /** 非消息事件回调（reactions / 入群 / 离群 / p2p_entered） */
  private eventCallbacks: FeishuEventCallbacks = {};

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
        getMediaDownloader: () => this.mediaDownloader,
        getGroupSessionScope: () => this.credentials?.groupSessionScope ?? 'group',
      });

      registerCardActionHandlers(bundle.dispatcher, {
        getRegistry: () => this.approvalRegistry,
        getClient: () => this.bundle?.client ?? null,
      });

      registerOtherEventHandlers(bundle.dispatcher, {
        getCallbacks: () => this.eventCallbacks,
      });

      await bundle.wsClient.start({ eventDispatcher: bundle.dispatcher });

      // 重连后允许 registry 再次 register（上次 disconnect 调用过 cancelAll）
      this.approvalRegistry.reopen();

      // 绑定媒体下载器（闭包捕获 client）
      this.mediaDownloader = async (p) => {
        return await downloadMessageResource(bundle.client, {
          messageId: p.messageId,
          fileKey: p.fileKey,
          msgType: p.msgType,
          ...(p.fileName !== undefined ? { fileName: p.fileName } : {}),
        });
      };

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
    this.mediaDownloader = null;
    // 取消所有待审批，释放等待的 Promise
    this.approvalRegistry.cancelAll();
    this.status = { ...this.status, status: 'disconnected', error: undefined };
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  /**
   * 发送消息（外层 retry + 内层 smart 降级）
   *
   * 行为：
   * - 内层 sendSmart：Markdown 自动 Post，Post 内容非法（230001 族）时降级为纯文本
   * - 外层 withFeishuRetry：网络 / 限流（99991400 族）时最多 3 次指数退避
   *
   * **注意**：Markdown 内容在限流场景下最坏情况会发起 3 次 Post 请求（每次重试
   * 都会重走 Markdown→Post 路径），属可接受成本。如未来发现 Post 与限流叠加
   * 造成雪崩，可把 retry 下沉到 sendPost/sendText 原子调用处，把 sendSmart
   * 降级为无重试的组合器。
   */
  async sendMessage(
    peerId: string,
    content: string,
    chatType?: 'private' | 'group',
  ): Promise<void> {
    const client = this.requireClient();
    await withFeishuRetry(
      () => sendSmartMessage(client, peerId, content, chatType),
      { label: 'sendMessage' },
    );
  }

  /**
   * 显式发起流式卡片（供外部 SSE / 逐步输出场景使用）
   *
   * 返回 handle，调用方负责 append / finish / abort。
   * 调用方应自行保证 append 串行（每次 await 后再发下一条）以避免乱序。
   */
  async beginStreaming(
    peerId: string,
    options: StreamingCardOptions = {},
    chatType?: 'private' | 'group',
  ): Promise<StreamingCardHandle> {
    const client = this.requireClient();
    return await beginStreamingCard(client, peerId, options, chatType);
  }

  async sendMediaMessage(
    peerId: string,
    filePath: string,
    text?: string,
    chatType?: 'private' | 'group',
  ): Promise<void> {
    const client = this.requireClient();
    await withFeishuRetry(
      () => sendMediaMessage(client, peerId, filePath, chatType),
      { label: 'sendMedia' },
    );
    if (text && text.trim()) {
      // 媒体后紧跟一条文本说明（飞书无 caption 字段）
      await withFeishuRetry(
        () => sendSmartMessage(client, peerId, text, chatType),
        { label: 'sendMediaCaption' },
      );
    }
  }

  /**
   * 请求用户审批（发送审批卡，等待按钮点击）
   *
   * @returns Promise<{decision, operatorOpenId?}>  超时或拒绝返回对应值
   */
  async requestApproval(
    peerId: string,
    options: ApprovalRequestOptions,
    chatType?: 'private' | 'group',
  ): Promise<{ decision: ApprovalDecision; operatorOpenId?: string }> {
    const client = this.requireClient();
    return await requestApprovalViaCard(client, this.approvalRegistry, {
      peerId,
      ...(chatType !== undefined ? { chatType } : {}),
      ...options,
    });
  }

  /**
   * 对整篇文档追加一条全文评论（代理到 doc-api）
   * @returns 新建的 comment_id
   */
  async addWholeCommentReply(params: {
    fileToken: string;
    fileType: 'doc' | 'docx';
    text: string;
  }): Promise<string | null> {
    const client = this.requireClient();
    return await withFeishuRetry(
      () => apiAddWholeCommentReply(client, params),
      { label: 'addWholeCommentReply' },
    );
  }

  /**
   * 对已有文档评论追加回复（代理到 doc-api）
   * @returns 新建的 reply_id
   */
  async replyToComment(params: {
    fileToken: string;
    commentId: string;
    fileType: DocFileType;
    text: string;
  }): Promise<string | null> {
    const client = this.requireClient();
    return await withFeishuRetry(
      () => apiReplyToComment(client, params),
      { label: 'replyToComment' },
    );
  }

  /** 列出文档评论的所有回复（代理到 doc-api） */
  async listCommentReplies(params: {
    fileToken: string;
    commentId: string;
    fileType: DocFileType;
    pageSize?: number;
    pageToken?: string;
  }): ReturnType<typeof apiListCommentReplies> {
    const client = this.requireClient();
    return await apiListCommentReplies(client, params);
  }

  getStatus(): ChannelStatusInfo {
    return { ...this.status };
  }

  /** 覆盖 bot open_id（测试场景用；生产环境通过 connect() 自动拉取） */
  setBotOpenId(openId: string | null): void {
    this.botOpenId = openId;
  }

  /**
   * 注册非消息事件回调（reactions / 入群 / 离群 / p2p_entered）
   *
   * 注意：**完全替换旧 callbacks**。多订阅者场景请在外层自行聚合（EventEmitter 等）。
   */
  setEventCallbacks(callbacks: FeishuEventCallbacks): void {
    this.eventCallbacks = callbacks;
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
