/**
 * 微信个人号 Channel 适配器
 *
 * 通过 iLink Bot 平台 (ilinkai.weixin.qq.com) 接入微信个人号。
 * 与 feishu/wecom 的 Webhook 推送不同，微信使用**长轮询拉取**模式获取消息。
 *
 * 核心流程:
 * 1. QR 扫码登录获取 botToken
 * 2. 长轮询 getUpdates 拉取消息
 * 3. context_token 缓存 + 回传
 * 4. sendMessage 发送回复
 */

import type {
  ChannelAdapter,
  ChannelConfig,
  ChannelStatusInfo,
  MessageHandler,
} from '../channel-adapter.js';
import { normalizeWeixinMessage } from '../message-normalizer.js';
import type { ChannelStateRepo } from '../channel-state-repo.js';
import { createLogger } from '../../infrastructure/logger.js';

import type { WeixinCredentials, WeixinGetUpdatesResp, WeixinMessageItem } from './weixin-types.js';
import {
  DEFAULT_WEIXIN_BASE_URL,
  WeixinMessageType,
  WeixinMessageState,
  WeixinItemType,
  SESSION_EXPIRED_ERRCODE,
} from './weixin-types.js';
import {
  getUpdates,
  sendTextMessage,
  sendTypingIndicator,
  getConfig,
} from './weixin-api.js';
import { downloadMediaFromItem } from './weixin-cdn.js';
import { sendWeixinMediaFile } from './weixin-send-media.js';
import { downloadRemoteToTemp } from './weixin-upload.js';
import { markdownToPlainText } from './weixin-markdown.js';

const log = createLogger('weixin-adapter');

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 游标持久化 key */
const STATE_KEY_BUF = 'get_updates_buf';

/** 最大文本分块长度 (微信限制) */
const TEXT_CHUNK_LIMIT = 4000;

/** 最大连续失败次数 (触发退避) */
const MAX_CONSECUTIVE_FAILURES = 3;

/** 退避延迟上限 (ms) */
const MAX_BACKOFF_MS = 30_000;

/** 基础退避延迟 (ms) */
const BASE_BACKOFF_MS = 2_000;

/**
 * 微信个人号 Channel 适配器
 */
export class WeixinAdapter implements ChannelAdapter {
  readonly type = 'weixin' as const;

  private handler: MessageHandler | null = null;
  private status: ChannelStatusInfo = {
    type: 'weixin',
    name: '微信',
    status: 'disconnected',
  };
  private credentials: WeixinCredentials | null = null;

  // 长轮询状态
  private pollingActive = false;
  private pollingAbortController: AbortController | null = null;
  private getUpdatesBuf = '';
  private consecutiveFailures = 0;

  // context_token 缓存: fromUserId → 最新 context_token
  // 回复时必须回传对应用户的 context_token
  private readonly contextTokenCache = new Map<string, string>();

  // typing ticket 缓存: fromUserId → typing_ticket
  private readonly typingTicketCache = new Map<string, string>();

  constructor(private readonly stateRepo: ChannelStateRepo) {}

  // ---------------------------------------------------------------------------
  // ChannelAdapter 接口实现
  // ---------------------------------------------------------------------------

  async connect(config: ChannelConfig): Promise<void> {
    const botToken = config.credentials['botToken'] ?? '';
    const ilinkBotId = config.credentials['ilinkBotId'] ?? '';
    const baseUrl = config.credentials['baseUrl'] ?? DEFAULT_WEIXIN_BASE_URL;

    if (!botToken) {
      this.status = { ...this.status, status: 'error', error: '缺少 botToken' };
      throw new Error('微信配置不完整：需要 botToken（请先扫码登录）');
    }

    this.credentials = { botToken, ilinkBotId, baseUrl };
    this.status = { ...this.status, status: 'connecting', name: config.name };

    // 加载上次的游标 (断点续传)
    const savedBuf = this.stateRepo.getState('weixin', STATE_KEY_BUF);
    if (savedBuf) {
      this.getUpdatesBuf = savedBuf;
      log.info(`恢复上次游标 (${savedBuf.length} bytes)`);
    }

    try {
      // 验证 token 有效性：尝试调用 getConfig
      // 首次连接可能没有 userId，跳过验证
      log.info(`微信连接中... baseUrl=${baseUrl} ilinkBotId=${ilinkBotId}`);

      this.status = {
        ...this.status,
        status: 'connected',
        connectedAt: new Date().toISOString(),
        error: undefined,
      };

      // 启动长轮询
      this.startPolling();
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
    log.info('微信断开连接');

    // 停止轮询
    this.pollingActive = false;
    this.pollingAbortController?.abort();
    this.pollingAbortController = null;

    // 持久化游标
    if (this.getUpdatesBuf) {
      this.stateRepo.setState('weixin', STATE_KEY_BUF, this.getUpdatesBuf);
      log.info(`已保存游标 (${this.getUpdatesBuf.length} bytes)`);
    }

    // 清理状态
    this.contextTokenCache.clear();
    this.typingTicketCache.clear();
    this.credentials = null;
    this.consecutiveFailures = 0;

    this.status = { ...this.status, status: 'disconnected', error: undefined };
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async sendMessage(peerId: string, content: string, _chatType?: 'private' | 'group'): Promise<void> {
    if (!this.credentials) {
      throw new Error('微信未连接');
    }

    const contextToken = this.contextTokenCache.get(peerId);
    if (!contextToken) {
      log.warn(`发送消息缺少 context_token: peerId=${peerId}`);
    }

    // Markdown → 纯文本 (微信不支持 Markdown 渲染)
    const plainText = markdownToPlainText(content);

    // 分块发送 (微信限制 4000 字符)
    const chunks = this.splitText(plainText, TEXT_CHUNK_LIMIT);

    for (const chunk of chunks) {
      await sendTextMessage({
        baseUrl: this.credentials.baseUrl,
        token: this.credentials.botToken,
        toUserId: peerId,
        text: chunk,
        contextToken,
      });
    }

    log.info(`已发送消息到 ${peerId} (${chunks.length} 块)`);
  }

  async sendMediaMessage(peerId: string, filePath: string, text?: string): Promise<void> {
    if (!this.credentials) {
      throw new Error('微信未连接');
    }

    const contextToken = this.contextTokenCache.get(peerId);
    if (!contextToken) {
      log.warn(`发送媒体消息缺少 context_token: peerId=${peerId}`);
    }

    // 处理远程 URL (http/https 开头)
    let localPath = filePath;
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      log.info(`下载远程文件: ${filePath.substring(0, 100)}`);
      localPath = await downloadRemoteToTemp(filePath);
    }

    await sendWeixinMediaFile({
      filePath: localPath,
      toUserId: peerId,
      text: text ? markdownToPlainText(text) : undefined,
      credentials: this.credentials,
      contextToken,
    });

    log.info(`已发送媒体消息到 ${peerId}: ${localPath}`);
  }

  getStatus(): ChannelStatusInfo {
    return { ...this.status };
  }

  // ---------------------------------------------------------------------------
  // Typing 指示器 (可选扩展)
  // ---------------------------------------------------------------------------

  /**
   * 发送/取消输入状态指示
   * 需要先通过 getConfig 获取 typing_ticket
   */
  async sendTyping(peerId: string, cancel = false): Promise<void> {
    if (!this.credentials) return;

    let ticket = this.typingTicketCache.get(peerId);

    // 如果没有缓存的 ticket，尝试获取
    if (!ticket) {
      try {
        const contextToken = this.contextTokenCache.get(peerId);
        const resp = await getConfig({
          baseUrl: this.credentials.baseUrl,
          token: this.credentials.botToken,
          ilinkUserId: peerId,
          contextToken,
        });
        if (resp.typing_ticket) {
          ticket = resp.typing_ticket;
          this.typingTicketCache.set(peerId, ticket);
        }
      } catch (err) {
        log.debug(`获取 typing_ticket 失败: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }

    if (!ticket) return;

    try {
      await sendTypingIndicator({
        baseUrl: this.credentials.baseUrl,
        token: this.credentials.botToken,
        ilinkUserId: peerId,
        typingTicket: ticket,
        cancel,
      });
    } catch (err) {
      log.debug(`发送 typing 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 长轮询核心
  // ---------------------------------------------------------------------------

  /**
   * 启动长轮询循环 (后台运行，不阻塞)
   * 通过 AbortController 控制停止
   */
  private startPolling(): void {
    this.pollingActive = true;
    this.consecutiveFailures = 0;

    // 异步启动，不阻塞 connect()
    void this.pollingLoop();
  }

  private async pollingLoop(): Promise<void> {
    log.info('长轮询循环已启动');

    while (this.pollingActive) {
      try {
        this.pollingAbortController = new AbortController();

        const resp = await getUpdates({
          baseUrl: this.credentials!.baseUrl,
          token: this.credentials!.botToken,
          getUpdatesBuf: this.getUpdatesBuf,
        });

        // 成功 → 重置失败计数
        this.consecutiveFailures = 0;

        // 处理 API 错误
        if (this.isApiError(resp)) {
          await this.handleApiError(resp);
          continue;
        }

        // 更新游标
        if (resp.get_updates_buf) {
          this.getUpdatesBuf = resp.get_updates_buf;
          // 定期持久化游标
          this.stateRepo.setState('weixin', STATE_KEY_BUF, this.getUpdatesBuf);
        }

        // 处理消息
        const msgs = resp.msgs ?? [];
        for (const msg of msgs) {
          await this.processMessage(msg);
        }
      } catch (err) {
        if (!this.pollingActive) {
          log.info('轮询循环已停止 (主动断开)');
          return;
        }

        this.consecutiveFailures++;
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error(`轮询错误 (${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${errMsg}`);

        // 指数退避
        const backoff = Math.min(
          MAX_BACKOFF_MS,
          BASE_BACKOFF_MS * Math.pow(2, this.consecutiveFailures - 1),
        );
        await this.sleep(backoff);
      }
    }

    log.info('长轮询循环已结束');
  }

  /**
   * 处理单条入站消息
   */
  private async processMessage(msg: import('./weixin-types.js').WeixinMessage): Promise<void> {
    // 跳过 BOT 自己的消息
    if (msg.message_type === WeixinMessageType.BOT) return;

    // 跳过 GENERATING 中间态 (流式输出中间状态)
    if (msg.message_state === WeixinMessageState.GENERATING) return;

    const fromUserId = msg.from_user_id ?? '';
    if (!fromUserId) {
      log.warn('忽略无 from_user_id 的消息');
      return;
    }

    // 缓存 context_token (回复时必须回传)
    if (msg.context_token) {
      this.contextTokenCache.set(fromUserId, msg.context_token);
    }

    // 标准化 → 分发给 handler
    const normalized = normalizeWeixinMessage(msg, this.credentials?.ilinkBotId ?? '');

    // 下载媒体附件 (图片 > 视频 > 文件 > 语音)
    // 语音如果有 text 字段 (语音转文字)，跳过下载
    try {
      const mediaItem = this.findMediaItem(msg.item_list ?? []);
      if (mediaItem) {
        const result = await downloadMediaFromItem(mediaItem, {
          cdnBaseUrl: this.credentials?.baseUrl,
        });
        if (result) {
          normalized.mediaPath = result.filePath;
          normalized.mediaType = result.mimeType;
          log.info(`媒体下载完成: type=${result.mimeType} path=${result.filePath}`);
        }
      }

      // 检查引用消息中的媒体
      if (!normalized.mediaPath) {
        const refMediaItem = this.findRefMediaItem(msg.item_list ?? []);
        if (refMediaItem) {
          const result = await downloadMediaFromItem(refMediaItem, {
            cdnBaseUrl: this.credentials?.baseUrl,
          });
          if (result) {
            normalized.mediaPath = result.filePath;
            normalized.mediaType = result.mimeType;
            log.info(`引用媒体下载完成: type=${result.mimeType} path=${result.filePath}`);
          }
        }
      }
    } catch (err) {
      // 媒体下载失败不应阻塞文本消息的传递
      log.warn(`媒体下载失败 (不影响文本传递): ${err instanceof Error ? err.message : String(err)}`);
    }

    log.info(
      `入站消息: from=${fromUserId} contentLen=${normalized.content.length} messageId=${normalized.messageId} hasMedia=${Boolean(normalized.mediaPath)}`,
    );

    if (this.handler) {
      try {
        await this.handler(normalized);
      } catch (err) {
        log.error(`消息处理失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 错误处理
  // ---------------------------------------------------------------------------

  /** 检查 API 响应是否为错误 */
  private isApiError(resp: WeixinGetUpdatesResp): boolean {
    return (resp.ret !== undefined && resp.ret !== 0) ||
           (resp.errcode !== undefined && resp.errcode !== 0);
  }

  /** 处理 API 错误响应 */
  private async handleApiError(resp: WeixinGetUpdatesResp): Promise<void> {
    const isSessionExpired =
      resp.errcode === SESSION_EXPIRED_ERRCODE ||
      resp.ret === SESSION_EXPIRED_ERRCODE;

    if (isSessionExpired) {
      log.error('会话已过期，停止轮询。请重新扫码登录。');
      this.status = {
        ...this.status,
        status: 'error',
        error: '会话已过期，请重新扫码登录',
      };
      this.pollingActive = false;
      return;
    }

    this.consecutiveFailures++;
    log.error(
      `API 错误: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ''} (${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`,
    );

    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      log.error(`连续 ${MAX_CONSECUTIVE_FAILURES} 次失败，退避 ${MAX_BACKOFF_MS / 1000}s`);
      this.consecutiveFailures = 0;
      await this.sleep(MAX_BACKOFF_MS);
    } else {
      await this.sleep(BASE_BACKOFF_MS);
    }
  }

  // ---------------------------------------------------------------------------
  // 工具方法
  // ---------------------------------------------------------------------------

  /**
   * 从消息项列表中查找优先级最高的媒体项
   * 优先级: IMAGE > VIDEO > FILE > VOICE
   * 语音项如果有 text 字段 (语音转文字)，跳过下载
   */
  private findMediaItem(items: WeixinMessageItem[]): WeixinMessageItem | null {
    const priority = [WeixinItemType.IMAGE, WeixinItemType.VIDEO, WeixinItemType.FILE, WeixinItemType.VOICE];

    for (const type of priority) {
      const item = items.find((i) => i.type === type);
      if (item) {
        // 语音有转文字结果时，跳过下载 (文字内容会通过 normalizer 处理)
        if (type === WeixinItemType.VOICE && item.voice_item?.text) {
          continue;
        }
        return item;
      }
    }
    return null;
  }

  /**
   * 从消息项的引用消息中查找媒体项
   */
  private findRefMediaItem(items: WeixinMessageItem[]): WeixinMessageItem | null {
    for (const item of items) {
      const refItem = item.ref_msg?.message_item;
      if (refItem) {
        const mediaTypes = [WeixinItemType.IMAGE, WeixinItemType.VIDEO, WeixinItemType.FILE, WeixinItemType.VOICE];
        if (refItem.type && (mediaTypes as readonly number[]).includes(refItem.type)) {
          return refItem;
        }
      }
    }
    return null;
  }

  /** 将文本按限制分块 */
  private splitText(text: string, limit: number): string[] {
    if (text.length <= limit) return [text];

    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      chunks.push(remaining.substring(0, limit));
      remaining = remaining.substring(limit);
    }
    return chunks;
  }

  /** 可中断的 sleep */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      // 如果轮询被中止，立即 resolve
      if (this.pollingAbortController) {
        this.pollingAbortController.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      }
    });
  }
}
