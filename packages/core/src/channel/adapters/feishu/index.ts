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
import {
  registerInboundHandlers,
  type MediaDownloader,
  type FeishuMessageFetcher,
  type InboundContext,
} from './inbound.js';
import { createFeishuMessageCache } from './message-cache.js';
import { parseFeishuContent } from './parse-content.js';
import { sendMediaMessage, sendSmartMessage } from './outbound.js';
import {
  GroupHistoryBuffer,
  buildHistoryKey,
  type GroupHistoryEntry,
} from './group-history.js';
import { parseFeishuGroupPeerId } from './session-key.js';
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
import { createFeishuSdkLogger, type FeishuWsStatusEvent } from './ws-logger.js';

const log = createLogger('feishu-adapter');
const wsLog = createLogger('feishu-ws');

/** FeishuAdapter 可选注入（测试用） */
export interface FeishuAdapterOptions {
  sdk?: FeishuSdk;
  /** 覆盖 bot 身份自动发现（测试用） */
  hydrateBotOpenId?: (client: Lark.Client) => Promise<string | null>;
}

/**
 * 按 messageId 取被引用消息快照 —— inbound LRU miss 时的兜底回查
 *
 * 走 `client.request` 低层 API（与 bot/v3/info 自动发现同路径）而非 SDK 的
 * `im.v1.message.get` 强类型包装。实测 Bun 运行时下 SDK 包装层的 axios 调用
 * 在部分路径参数场景触发 `ECONNRESET`，但同一 client 的 `request` 调用正常。
 *
 * 调用失败时抛出原始错误（含飞书 code/msg、网络层 ECONNRESET 等），
 * inbound 的 describeFetchError 会展开诊断字段。
 */
async function fetchFeishuMessageSnapshot(
  client: Lark.Client,
  messageId: string,
): Promise<import('./message-cache.js').FeishuMessageCacheEntry | null> {
  const res = await client.request<{
    code?: number;
    msg?: string;
    data?: {
      items?: Array<{
        message_id?: string;
        msg_type?: string;
        create_time?: string;
        sender?: { id?: string; id_type?: string };
        body?: { content?: string };
      }>;
    };
  }>({
    url: `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`,
    method: 'GET',
  });

  // 飞书业务错误：code !== 0 时抛出，让上层看到具体 code/msg
  if (res.code !== 0) {
    const err = new Error(`飞书 message.get 返回非零 code`);
    (err as unknown as Record<string, unknown>).code = res.code;
    (err as unknown as Record<string, unknown>).msg = res.msg;
    throw err;
  }
  const item = res.data?.items?.[0];
  if (!item) {
    log.warn(`message.get 成功但 items 为空 messageId=${messageId}`);
    return null;
  }

  const msgType = item.msg_type ?? 'text';
  const rawContent = item.body?.content ?? '';
  const parsed = parseFeishuContent(msgType, rawContent);
  const ts = item.create_time ? Number(item.create_time) : Date.now();

  return {
    messageId: item.message_id ?? messageId,
    senderId: item.sender?.id ?? '',
    content: parsed.text,
    timestamp: Number.isFinite(ts) ? ts : Date.now(),
  };
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
  /**
   * 入站消息 LRU 缓存（供引用消息 O(1) 命中）
   *
   * adapter 实例内单例，跨重连保留（引用回查的命中率只增不减）。
   */
  private readonly messageCache = createFeishuMessageCache();
  /** LRU miss 时回查 im/v1/messages/:message_id 的兜底 fetcher，disconnect 后置空 */
  private messageFetcher: FeishuMessageFetcher | null = null;
  /** 审批注册表（每个 adapter 实例独立，跨重连保留 */
  private readonly approvalRegistry = new ApprovalRegistry();
  /** 非消息事件回调（reactions / 入群 / 离群 / p2p_entered） */
  private eventCallbacks: FeishuEventCallbacks = {};
  /** 群聊旁听缓冲（多机器人协作） */
  private readonly groupHistory = new GroupHistoryBuffer();
  /**
   * Team mode 入站分类器（M13 PR4 注入）
   *
   * 由外层（server.ts）按"FeishuPeerBotRegistry.classifyPeer + 自身 accountId 比对"
   * 装配；未注入时退化为旧行为（一刀切丢 sender_type=app）。
   */
  private classifyAppSender:
    | InboundContext['classifyAppSender']
    | undefined = undefined;
  /**
   * 反查同事 bot 对应的 EvoClaw Agent ID（M13 多 Agent 协作 — 兜底 @ 回提问者）
   *
   * 由外层 server.ts 注入（用 FeishuPeerBotRegistry.listInChat 反查），
   * 让 inbound 把 peer agentId 透传到 ChannelMessage.fromPeerAgentId。
   */
  private resolvePeerAgentId:
    | InboundContext['resolvePeerAgentId']
    | undefined = undefined;
  /**
   * 广播场景下把 feishu bot open_id 映射到 agentId（可选）
   *
   * 常见单 adapter 模型下用户不必配置（`mention-first` 会因映射为空而退化为
   * "仅列表中 agent 被 @ 视为生效"，实际命中由 `any-mention` / `always` 模式
   * 补齐）。跨 adapter 场景预留扩展点，由外层注入。
   */
  private botIdToAgentId: Record<string, string> = {};

  constructor(private readonly options: FeishuAdapterOptions = {}) {}

  async connect(config: ChannelConfig): Promise<void> {
    // 防泄漏：若存在旧 bundle（上次 connect 失败或 ChannelManager 触发重连），先清理
    await this.cleanupBundle();

    this.status = { ...this.status, status: 'connecting', name: config.name };
    try {
      const credentials = parseFeishuCredentials(config.credentials);
      this.credentials = credentials;

      const bundle = createFeishuSdkBundle(credentials, {
        ...(this.options.sdk ? { sdk: this.options.sdk } : {}),
        wsLogger: createFeishuSdkLogger(wsLog, (ev) => this.onWsStatus(ev)),
      });
      this.bundle = bundle;

      registerInboundHandlers(bundle.dispatcher, {
        getAccountId: () => this.credentials?.appId ?? '',
        getBotOpenId: () => this.botOpenId,
        getHandler: () => this.handler,
        getMediaDownloader: () => this.mediaDownloader,
        getGroupSessionScope: () => this.credentials?.groupSessionScope ?? 'group',
        getGroupHistory: () => this.groupHistory,
        getGroupHistoryConfig: () => this.credentials?.groupHistory ?? null,
        getBroadcastConfig: () => this.credentials?.broadcast ?? null,
        getBotIdToAgentId: () => this.botIdToAgentId,
        getMessageCache: () => this.messageCache,
        getMessageFetcher: () => this.messageFetcher,
        // M13 team-mode：未注入时为 undefined → inbound 走旧丢 app 行为
        classifyAppSender: this.classifyAppSender,
        resolvePeerAgentId: this.resolvePeerAgentId,
      });

      registerCardActionHandlers(bundle.dispatcher, {
        getRegistry: () => this.approvalRegistry,
        getClient: () => this.bundle?.client ?? null,
      });

      registerOtherEventHandlers(bundle.dispatcher, {
        getCallbacks: () => this.eventCallbacks,
        getAccountId: () => this.credentials?.appId ?? '',
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

      // 绑定引用消息兜底回查：im.v1.message.get，解析首条 item 为 cache entry
      this.messageFetcher = async (messageId) => {
        return await fetchFeishuMessageSnapshot(bundle.client, messageId);
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
    this.messageFetcher = null;
    // 取消所有待审批，释放等待的 Promise
    this.approvalRegistry.cancelAll();
    // 清空群聊旁听缓冲（断开视为会话边界重置）
    this.groupHistory.clear();
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
    this.recordBotReplyToGroupHistory(peerId, content, chatType);
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
    this.recordBotReplyToGroupHistory(peerId, '[机器人发送了媒体消息]', chatType);
    if (text && text.trim()) {
      // 媒体后紧跟一条文本说明（飞书无 caption 字段）
      await withFeishuRetry(
        () => sendSmartMessage(client, peerId, text, chatType),
        { label: 'sendMediaCaption' },
      );
      this.recordBotReplyToGroupHistory(peerId, text, chatType);
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

  /** 列出文档评论的所有回复（代理到 doc-api；读操作也套 retry，幂等代价低） */
  async listCommentReplies(params: {
    fileToken: string;
    commentId: string;
    fileType: DocFileType;
    pageSize?: number;
    pageToken?: string;
  }): ReturnType<typeof apiListCommentReplies> {
    const client = this.requireClient();
    return await withFeishuRetry(
      () => apiListCommentReplies(client, params),
      { label: 'listCommentReplies' },
    );
  }

  getStatus(): ChannelStatusInfo {
    return { ...this.status };
  }

  /** 覆盖 bot open_id（测试场景用；生产环境通过 connect() 自动拉取） */
  setBotOpenId(openId: string | null): void {
    this.botOpenId = openId;
  }

  /**
   * 读取本 adapter 在 connect 时拉到的 bot 自身 open_id
   *
   * 用于：M13 多 Agent 团队协作 — server.ts connect 成功后通过 BindingRouter.setBotOpenId
   * 把它回填到 binding 行，listInChat 兜底冷启动时的 mention_id。
   *
   * 返回 null：connect 还未完成 / `/open-apis/bot/v3/info` 失败。
   */
  getBotOpenId(): string | null {
    return this.botOpenId;
  }

  /**
   * 设置 bot open_id → agentId 映射（广播 `mention-first` 模式用）
   *
   * 单 Feishu app + 多 agent 场景下无需调用（@ 到共享 bot 时由 `any-mention`
   * / `always` 触发 fanout）。跨 app 时由 ChannelManager / 启动层注入。
   */
  setBotIdToAgentId(map: Record<string, string>): void {
    this.botIdToAgentId = { ...map };
  }

  /**
   * 注册非消息事件回调（reactions / 入群 / 离群 / p2p_entered）
   *
   * 注意：**完全替换旧 callbacks**。多订阅者场景请在外层自行聚合（EventEmitter 等）。
   */
  setEventCallbacks(callbacks: FeishuEventCallbacks): void {
    this.eventCallbacks = callbacks;
  }

  /**
   * 注入 team-mode 入站分类器（M13 PR4）
   *
   * 调用方（server.ts）传入 `(params) => peerBotRegistry.classifyPeer(...) ? 'peer' : 'self/stranger'`
   * 的具体逻辑。未注入时 inbound 走旧行为（丢所有 sender_type=app）。
   */
  setPeerAgentResolver(resolver: InboundContext['resolvePeerAgentId']): void {
    this.resolvePeerAgentId = resolver;
  }

  setTeamModeClassifier(classifier: InboundContext['classifyAppSender']): void {
    this.classifyAppSender = classifier;
  }

  /**
   * 暴露当前 Lark client 给 team-mode 主动 API（如 chat-history-prober）。
   * 未连接时返回 null，调用方应静默跳过 probe。
   */
  getLarkClient(): Lark.Client | null {
    return this.bundle?.client ?? null;
  }

  /**
   * 列出当前 bot 加入的所有群（用于启动 prebake 枚举）
   *
   * 返回 (chatId, chatName) 列表。仅包含 chat_type='group'（私聊不需要 prebake）。
   * 失败时返回空数组——上层应静默跳过 prebake，不阻塞 connect。
   *
   * 注意：必须用 `client.request()` 低层 API。SDK 高层 `client.im.chat.list` 在
   * Bun runtime 下会触发 "socket closed unexpectedly" 错误（OpenClaw 同样踩过，
   * 见 defaultHydrateBotOpenId 处的注释）。
   */
  async listChats(pageSize = 100): Promise<Array<{ chatId: string; name?: string }>> {
    const client = this.bundle?.client;
    if (!client) return [];
    try {
      const res = await client.request<{
        code?: number;
        msg?: string;
        data?: { items?: Array<{ chat_id?: string; name?: string; chat_mode?: string }> };
      }>({
        method: 'GET',
        url: '/open-apis/im/v1/chats',
        params: { page_size: Math.min(Math.max(1, pageSize), 100) },
      });
      if (res.code !== 0) {
        log.warn(`listChats 业务错 code=${res.code} msg=${res.msg}`);
        return [];
      }
      const items = res.data?.items ?? [];
      const out: Array<{ chatId: string; name?: string }> = [];
      for (const c of items) {
        // chat_mode 'group' 是群聊；'p2p' 是私聊（跳过）；'topic' 是话题（保留）
        if (!c.chat_id) continue;
        if (c.chat_mode === 'p2p') continue;
        out.push({ chatId: c.chat_id, ...(c.name ? { name: c.name } : {}) });
      }
      return out;
    } catch (err) {
      log.warn(`listChats 抛错（已忽略）: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private requireClient(): Lark.Client {
    if (!this.bundle || this.status.status !== 'connected') {
      throw new Error('飞书 Channel 未连接');
    }
    return this.bundle.client;
  }

  /**
   * 响应 SDK WSClient 的真实状态变化（见 ws-logger.ts）
   *
   * 注意 `client_ready` 的语义坑：SDK 在 reConnect(isStart=true) 末尾**无论成功
   * 失败都会打 `[ws] ws client ready`**（见 node-sdk lib/index.js L85436），所以
   * 它不代表连接成功，只代表首次 start() 流程已结束。**不要**用它改 status。
   *
   * disconnect 后 bundle 已清空；此时仍可能收到旧 WSClient 残留日志（SDK 内部
   * reconnect 定时器），用 bundle 为空作为信号忽略，避免把 status 打回 error。
   */
  private onWsStatus(ev: FeishuWsStatusEvent): void {
    if (!this.bundle) return; // disconnect 之后的残留回调丢弃

    switch (ev.kind) {
      case 'connect_success':
      case 'reconnect_success':
        if (this.status.status !== 'connected') {
          this.status = {
            ...this.status,
            status: 'connected',
            connectedAt: this.status.connectedAt ?? new Date().toISOString(),
            error: undefined,
          };
          log.info(`飞书 WS 已恢复连接 (${ev.kind})`);
        }
        break;
      case 'client_ready':
        // 仅 start() 流程结束信号，不代表连接真实建立。只记 debug 不改 status，
        // 防止失败路径下把 error 覆盖为 connected（见日志里 connect_failed →
        // client_ready 的 false recovery）。
        log.debug('飞书 WS start 流程结束 (client_ready)');
        break;
      case 'reconnecting':
        // 保守起见不立刻降级为 error —— reconnect 可能很快成功。仅在 client_closed 降级。
        if (this.status.status === 'connected') {
          this.status = { ...this.status, status: 'connecting', error: undefined };
          log.warn('飞书 WS 正在重连');
        }
        break;
      case 'client_closed':
        // 断连：标记为 error 让前端能看到，描述保持简短给非开发者
        this.status = {
          ...this.status,
          status: 'error',
          error: '飞书长连接已断开，正在尝试重连',
        };
        log.warn('飞书 WS 已断开 (client_closed)');
        break;
      case 'connect_failed':
        this.status = {
          ...this.status,
          status: 'error',
          error: `飞书长连接失败：${ev.reason}`,
        };
        log.error(`飞书 WS 连接失败: ${ev.reason}`);
        break;
      case 'ws_error':
        // 运行期 error 事件通常紧跟 close，不单独改 status（等 close 事件统一处理）
        log.warn(`飞书 WS 运行期错误: ${ev.reason}`);
        break;
    }
  }

  /**
   * 发送成功后把本 Agent 的回复写入群聊旁听缓冲
   *
   * 条件：
   * - chatType === 'group'
   * - groupHistory.enabled && includeBotMessages
   * - botOpenId 已知（否则 sender 字段无意义）
   *
   * 不抛错：记录失败不应阻塞后续流程。
   */
  private recordBotReplyToGroupHistory(
    peerId: string,
    content: string,
    chatType?: 'private' | 'group',
  ): void {
    if (chatType !== 'group') return;
    const config = this.credentials?.groupHistory;
    if (!config || !config.enabled || !config.includeBotMessages) return;
    const parsed = parseFeishuGroupPeerId(peerId);
    const chatId = parsed?.chatId ?? peerId;
    const historyKey = buildHistoryKey({
      chatId,
      ...(parsed?.threadId ? { threadId: parsed.threadId } : {}),
    });
    if (!historyKey) return;
    const botOpenId = this.botOpenId ?? 'bot';
    const entry: GroupHistoryEntry = {
      sender: botOpenId,
      senderName: this.status.name,
      body: content,
      timestamp: Date.now(),
      messageId: `outbound:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      fromBot: true,
    };
    this.groupHistory.record(historyKey, entry, config);
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
