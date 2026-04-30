/**
 * 其他飞书事件处理（非消息接收 / 非卡片按钮）
 *
 * 注册到 EventDispatcher：
 * - im.message.reaction.created_v1 / deleted_v1：通过可选回调传递给上层
 * - im.chat.member.bot.added_v1 / deleted_v1：机器人入群 / 被移出群
 * - im.chat.access_event.bot_p2p_chat_entered_v1：用户首次打开与机器人的单聊
 * - drive.notice.comment_add_v1：飞书文档新增评论（SDK 未强类型，走 custom key）
 *
 * 注意：这里注册的 event key 不能与 inbound.ts（im.message.receive_v1）或
 * card-action.ts（card.action.trigger）重复，否则 SDK 会 logger.error 告警。
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import type { ChannelMessage } from '@evoclaw/shared';
import type { MessageHandler } from '../../../channel-adapter.js';
import { createLogger } from '../../../../infrastructure/logger.js';
import { buildFeishuDocPeerId } from '../common/session-key.js';

const log = createLogger('feishu-events');

// ─── 事件载荷（SDK 的必要子集） ─────────────────────────────────────

export interface FeishuReactionEvent {
  message_id?: string;
  reaction_type?: { emoji_type: string };
  user_id?: { open_id?: string; user_id?: string; union_id?: string };
  action_time?: string;
}

export interface FeishuChatMemberBotEvent {
  chat_id?: string;
  operator_id?: { open_id?: string; user_id?: string; union_id?: string };
  name?: string;
  external?: boolean;
}

export interface FeishuP2pEnteredEvent {
  chat_id?: string;
  operator_id?: { open_id?: string; user_id?: string; union_id?: string };
  last_message_id?: string;
}

/** 飞书已知文档类型 */
export type FeishuDriveFileType = 'doc' | 'docx' | 'sheet' | 'bitable' | 'mindnote' | 'file' | 'slides';

/** 文档评论新增事件（对应 drive.notice.comment_add_v1） */
export interface FeishuDriveCommentEvent {
  /** 文档唯一标识（doc / docx / sheet 等） */
  file_token?: string;
  /**
   * 文档类型（`(string & {})` 保留字面量自动补全同时允许未来扩展值透传，
   * 不像纯 `| string` 会把前置枚举完全 widen）
   */
  file_type?: FeishuDriveFileType | (string & {});
  /** 评论 id（新建评论时即父评论 id） */
  comment_id?: string;
  /** 回复 id（仅在已有评论上回复时出现） */
  reply_id?: string;
  /** 评论者的 open_id */
  from_open_id?: string;
  /** 是否为全文评论 */
  is_whole?: boolean;
  /** 评论原文（富文本 JSON 字符串或纯文本，以飞书实际推送为准） */
  content?: string;
}

// ─── 可选回调 ────────────────────────────────────────────────────────

export interface FeishuEventCallbacks {
  onReactionCreated?: (event: FeishuReactionEvent) => void | Promise<void>;
  onReactionDeleted?: (event: FeishuReactionEvent) => void | Promise<void>;
  onBotAddedToChat?: (event: FeishuChatMemberBotEvent) => void | Promise<void>;
  onBotRemovedFromChat?: (event: FeishuChatMemberBotEvent) => void | Promise<void>;
  onP2pChatEntered?: (event: FeishuP2pEnteredEvent) => void | Promise<void>;
  /** 文档新评论（drive.notice.comment_add_v1） */
  onDriveCommentAdd?: (event: FeishuDriveCommentEvent) => void | Promise<void>;
}

/** 注册事件处理器上下文 */
export interface EventHandlerContext {
  getCallbacks: () => FeishuEventCallbacks;
  /** appId，日志前缀用（多 bot 场景下区分来源 adapter） */
  getAccountId: () => string;
  /**
   * 文档评论 → agent dispatch handler（M13 Phase 5 doc 闭环 C1）
   *
   * 由 FeishuAdapter 在 connect() 时注入：传入与 IM 同一份 MessageHandler。
   * 提供时：drive.comment_add_v1 经 dedupe + bot-self 过滤后合成 ChannelMessage
   * 调本 handler，让评论进入 agent 处理管线。
   * 未提供：drive 事件仅走旧的 onDriveCommentAdd 回调（向后兼容）。
   */
  getDocHandler?: () => MessageHandler | null;
  /** Bot 自身 open_id，过滤 bot 通过工具发评论后被 drive 事件回灌（防无限循环） */
  getBotOpenId?: () => string | null;
}

// ─── drive 评论 dedupe（pattern 与 inbound 消息 dedupe 一致） ───────────

const SEEN_COMMENT_KEYS = new Map<string, number>();
const SEEN_COMMENT_TTL_MS = 10 * 60_000;
const SEEN_COMMENT_MAX = 2000;

function commentDedupeKey(accountId: string, ev: FeishuDriveCommentEvent): string {
  const sep = '';
  return `${accountId}${sep}${ev.file_token ?? ''}${sep}${ev.comment_id ?? ''}${sep}${ev.reply_id ?? ''}`;
}

function isCommentDuplicate(accountId: string, ev: FeishuDriveCommentEvent): boolean {
  const now = Date.now();
  if (SEEN_COMMENT_KEYS.size >= SEEN_COMMENT_MAX) {
    const cutoff = now - SEEN_COMMENT_TTL_MS;
    for (const [k, ts] of SEEN_COMMENT_KEYS.entries()) {
      if (ts < cutoff) SEEN_COMMENT_KEYS.delete(k);
    }
    if (SEEN_COMMENT_KEYS.size >= SEEN_COMMENT_MAX) {
      const entries = [...SEEN_COMMENT_KEYS.entries()].sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < entries.length / 2; i++) {
        SEEN_COMMENT_KEYS.delete(entries[i]![0]);
      }
    }
  }
  const key = commentDedupeKey(accountId, ev);
  const prev = SEEN_COMMENT_KEYS.get(key);
  if (prev !== undefined && now - prev < SEEN_COMMENT_TTL_MS) return true;
  SEEN_COMMENT_KEYS.set(key, now);
  return false;
}

/** 测试用：清空 dedupe 状态 */
export function __clearDocCommentDedupe(): void {
  SEEN_COMMENT_KEYS.clear();
}

// ─── content 解析 + ChannelMessage 合成 ────────────────────────────────

/**
 * 把 drive comment 的 content 字段解析为可读文本
 *
 * 飞书实际推送可能是 JSON elements 或纯文本——尝试 JSON 失败时退化纯文本。
 */
function parseDriveCommentText(rawContent: string | undefined): string {
  if (!rawContent) return '';
  try {
    const obj = JSON.parse(rawContent) as { elements?: unknown[] };
    if (obj && Array.isArray(obj.elements)) {
      return obj.elements
        .map((el) => {
          const e = el as {
            type?: string;
            text_run?: { text?: string };
            docs_link?: { url?: string };
            person?: { user_id?: string };
          };
          if (e.type === 'text_run') return e.text_run?.text ?? '';
          if (e.type === 'docs_link') return e.docs_link?.url ?? '';
          if (e.type === 'person') return `<user:${e.person?.user_id ?? '?'}>`;
          return '';
        })
        .join('');
    }
  } catch {
    // 非 JSON，按纯文本处理
  }
  return rawContent;
}

/**
 * 把 drive comment 事件合成为 ChannelMessage
 *
 * 必填字段缺失时返回 null（调用方应跳过 dispatch）。
 */
export function synthesizeDocComment(
  event: FeishuDriveCommentEvent,
  accountId: string,
): ChannelMessage | null {
  if (!event.file_token || !event.comment_id || !event.from_open_id) return null;
  const text = parseDriveCommentText(event.content);
  return {
    channel: 'feishu',
    chatType: 'private',
    accountId,
    peerId: buildFeishuDocPeerId(event.file_token),
    senderId: event.from_open_id,
    senderName: '',
    content: text || '(空评论)',
    messageId: event.reply_id ? `${event.comment_id}:${event.reply_id}` : event.comment_id,
    timestamp: Date.now(),
    feishuDoc: {
      fileToken: event.file_token,
      fileType: typeof event.file_type === 'string' ? event.file_type : '',
      commentId: event.comment_id,
      ...(event.reply_id ? { replyId: event.reply_id } : {}),
      isWhole: event.is_whole ?? false,
    },
  };
}

/**
 * 注册所有非消息 / 非卡片事件
 */
export function registerOtherEventHandlers(
  dispatcher: Lark.EventDispatcher,
  ctx: EventHandlerContext,
): Lark.EventDispatcher {
  const acc = () => ctx.getAccountId();
  dispatcher.register({
    // 反应事件
    'im.message.reaction.created_v1': async (data: FeishuReactionEvent) => {
      log.info(
        `[${acc()}] reaction added emoji=${data.reaction_type?.emoji_type} msg=${data.message_id}`,
      );
      await safeInvoke(ctx.getCallbacks().onReactionCreated, data, acc());
    },
    'im.message.reaction.deleted_v1': async (data: FeishuReactionEvent) => {
      log.info(
        `[${acc()}] reaction removed emoji=${data.reaction_type?.emoji_type} msg=${data.message_id}`,
      );
      await safeInvoke(ctx.getCallbacks().onReactionDeleted, data, acc());
    },
    // 机器人入群
    'im.chat.member.bot.added_v1': async (data: FeishuChatMemberBotEvent) => {
      log.info(`[${acc()}] bot added to chat=${data.chat_id} by ${data.operator_id?.open_id ?? '?'}`);
      await safeInvoke(ctx.getCallbacks().onBotAddedToChat, data, acc());
    },
    // 机器人被踢
    'im.chat.member.bot.deleted_v1': async (data: FeishuChatMemberBotEvent) => {
      log.info(`[${acc()}] bot removed from chat=${data.chat_id} by ${data.operator_id?.open_id ?? '?'}`);
      await safeInvoke(ctx.getCallbacks().onBotRemovedFromChat, data, acc());
    },
    // 用户首次进入单聊
    'im.chat.access_event.bot_p2p_chat_entered_v1': async (data: FeishuP2pEnteredEvent) => {
      log.info(`[${acc()}] p2p chat entered chat=${data.chat_id} by ${data.operator_id?.open_id ?? '?'}`);
      await safeInvoke(ctx.getCallbacks().onP2pChatEntered, data, acc());
    },
    // 文档新评论（SDK 未强类型，key 透传）
    'drive.notice.comment_add_v1': async (data: FeishuDriveCommentEvent) => {
      const accountId = acc();
      log.info(
        `[${accountId}] drive comment added file=${data.file_token} from=${data.from_open_id ?? '?'} whole=${data.is_whole}`,
      );
      // 1. 旧 callback：保持向后兼容，外层 server.ts 仍能拿到原始事件
      await safeInvoke(ctx.getCallbacks().onDriveCommentAdd, data, accountId);

      // 2. 新路径（M13 Phase 5 C1）：dispatch 到 agent
      const handler = ctx.getDocHandler?.();
      if (!handler) return;

      // 必填字段检查
      if (!data.file_token || !data.comment_id || !data.from_open_id) {
        log.debug(
          `[${accountId}] drive comment 缺必填字段（file_token/comment_id/from_open_id），跳过 dispatch`,
        );
        return;
      }

      // 过滤 bot 自己写的评论（agent 用工具回评后 drive 事件会回灌，防止无限循环）
      const botOpenId = ctx.getBotOpenId?.();
      if (botOpenId && data.from_open_id === botOpenId) {
        log.debug(`[${accountId}] drive comment 来自 bot 自身 (${botOpenId})，跳过`);
        return;
      }

      // 去重：comment_id + reply_id 维度
      if (isCommentDuplicate(accountId, data)) {
        log.debug(
          `[${accountId}] drive comment 重复推送，跳过 comment=${data.comment_id} reply=${data.reply_id ?? '-'}`,
        );
        return;
      }

      // 合成 + dispatch（fire-and-forget，与 inbound IM 一致）
      const msg = synthesizeDocComment(data, accountId);
      if (!msg) return;
      Promise.resolve(handler(msg)).catch((err) => {
        log.error(
          `[${accountId}] doc comment dispatch 失败 comment=${data.comment_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    },
  } as unknown as Parameters<typeof dispatcher.register>[0]);
  return dispatcher;
}

/** 调用可选回调，异常只记日志不外抛 */
async function safeInvoke<T>(
  fn: ((event: T) => void | Promise<void>) | undefined,
  event: T,
  accountId: string,
): Promise<void> {
  if (!fn) return;
  try {
    await fn(event);
  } catch (err) {
    log.warn(`[${accountId}] 事件回调异常: ${err instanceof Error ? err.message : err}`);
  }
}
