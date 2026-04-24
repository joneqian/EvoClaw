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
import { createLogger } from '../../../infrastructure/logger.js';

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
      log.info(
        `[${acc()}] drive comment added file=${data.file_token} from=${data.from_open_id ?? '?'} whole=${data.is_whole}`,
      );
      await safeInvoke(ctx.getCallbacks().onDriveCommentAdd, data, acc());
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
