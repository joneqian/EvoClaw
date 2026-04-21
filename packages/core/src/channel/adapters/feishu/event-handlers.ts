/**
 * 其他飞书事件处理（非消息接收 / 非卡片按钮）
 *
 * 注册到 EventDispatcher：
 * - im.message.reaction.created_v1 / deleted_v1：通过可选回调传递给上层
 * - im.chat.member.bot.added_v1 / deleted_v1：机器人入群 / 被移出群
 * - im.chat.access_event.bot_p2p_chat_entered_v1：用户首次打开与机器人的单聊
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

// ─── 可选回调 ────────────────────────────────────────────────────────

export interface FeishuEventCallbacks {
  onReactionCreated?: (event: FeishuReactionEvent) => void | Promise<void>;
  onReactionDeleted?: (event: FeishuReactionEvent) => void | Promise<void>;
  onBotAddedToChat?: (event: FeishuChatMemberBotEvent) => void | Promise<void>;
  onBotRemovedFromChat?: (event: FeishuChatMemberBotEvent) => void | Promise<void>;
  onP2pChatEntered?: (event: FeishuP2pEnteredEvent) => void | Promise<void>;
}

/** 注册事件处理器上下文 */
export interface EventHandlerContext {
  getCallbacks: () => FeishuEventCallbacks;
}

/**
 * 注册所有非消息 / 非卡片事件
 */
export function registerOtherEventHandlers(
  dispatcher: Lark.EventDispatcher,
  ctx: EventHandlerContext,
): Lark.EventDispatcher {
  dispatcher.register({
    // 反应事件
    'im.message.reaction.created_v1': async (data: FeishuReactionEvent) => {
      log.info(
        `reaction added emoji=${data.reaction_type?.emoji_type} msg=${data.message_id}`,
      );
      await safeInvoke(ctx.getCallbacks().onReactionCreated, data);
    },
    'im.message.reaction.deleted_v1': async (data: FeishuReactionEvent) => {
      log.info(
        `reaction removed emoji=${data.reaction_type?.emoji_type} msg=${data.message_id}`,
      );
      await safeInvoke(ctx.getCallbacks().onReactionDeleted, data);
    },
    // 机器人入群
    'im.chat.member.bot.added_v1': async (data: FeishuChatMemberBotEvent) => {
      log.info(`bot added to chat=${data.chat_id} by ${data.operator_id?.open_id ?? '?'}`);
      await safeInvoke(ctx.getCallbacks().onBotAddedToChat, data);
    },
    // 机器人被踢
    'im.chat.member.bot.deleted_v1': async (data: FeishuChatMemberBotEvent) => {
      log.info(`bot removed from chat=${data.chat_id} by ${data.operator_id?.open_id ?? '?'}`);
      await safeInvoke(ctx.getCallbacks().onBotRemovedFromChat, data);
    },
    // 用户首次进入单聊
    'im.chat.access_event.bot_p2p_chat_entered_v1': async (data: FeishuP2pEnteredEvent) => {
      log.info(`p2p chat entered chat=${data.chat_id} by ${data.operator_id?.open_id ?? '?'}`);
      await safeInvoke(ctx.getCallbacks().onP2pChatEntered, data);
    },
  } as unknown as Parameters<typeof dispatcher.register>[0]);
  return dispatcher;
}

/** 调用可选回调，异常只记日志不外抛 */
async function safeInvoke<T>(
  fn: ((event: T) => void | Promise<void>) | undefined,
  event: T,
): Promise<void> {
  if (!fn) return;
  try {
    await fn(event);
  } catch (err) {
    log.warn(`事件回调异常: ${err instanceof Error ? err.message : err}`);
  }
}
