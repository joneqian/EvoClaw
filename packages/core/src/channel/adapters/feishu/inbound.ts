/**
 * 入站消息处理
 *
 * 职责：
 * - 订阅 SDK 事件（im.message.receive_v1）
 * - 把 SDK 事件载荷桥接到 `normalizeFeishuMessage`
 * - 群聊过滤：未 @机器人 的消息直接忽略
 * - 忽略机器人自己发送的消息
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import type { MessageHandler } from '../../channel-adapter.js';
import { normalizeFeishuMessage } from '../../message-normalizer.js';

/** im.message.receive_v1 事件载荷（与 SDK 类型同构，取必要字段） */
export interface FeishuReceiveEvent {
  sender: {
    sender_id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
    mentions?: Array<{
      key: string;
      id: { open_id?: string; user_id?: string; union_id?: string };
      name: string;
      tenant_key?: string;
    }>;
  };
}

/** 入站处理所需的上下文（用函数而非快照，支持运行时变化） */
export interface InboundContext {
  getAccountId: () => string;
  getBotOpenId: () => string | null;
  getHandler: () => MessageHandler | null;
}

/**
 * 把 EventDispatcher 的 im.message.receive_v1 回调接入到 handler
 */
export function registerInboundHandlers(
  dispatcher: Lark.EventDispatcher,
  ctx: InboundContext,
): Lark.EventDispatcher {
  dispatcher.register({
    'im.message.receive_v1': async (data: FeishuReceiveEvent) => {
      await handleReceiveMessage(data, ctx);
    },
  });
  return dispatcher;
}

/**
 * 处理单条入站消息
 *
 * 导出用于测试 / Phase H 扩展复用
 */
export async function handleReceiveMessage(
  data: FeishuReceiveEvent,
  ctx: InboundContext,
): Promise<void> {
  const handler = ctx.getHandler();
  if (!handler) return;

  // 忽略机器人自己的消息
  if (data.sender.sender_type === 'app') return;

  const message = data.message;
  const senderOpenId = data.sender.sender_id?.open_id ?? '';

  // 群聊过滤：必须 @机器人 或 @所有人
  if (message.chat_type === 'group') {
    const mentions = message.mentions ?? [];
    const botOpenId = ctx.getBotOpenId();
    const mentioned = mentions.some((m) => {
      if (m.key === '@_all') return true;
      if (botOpenId === null) return false;
      // 鲁棒性：同时匹配 open_id / user_id / union_id 的任一（飞书通常只填 open_id）
      return (
        m.id.open_id === botOpenId ||
        m.id.user_id === botOpenId ||
        m.id.union_id === botOpenId
      );
    });
    if (!mentioned) return;
  }

  const normalized = normalizeFeishuMessage(
    {
      message_id: message.message_id,
      chat_type: message.chat_type,
      chat_id: message.chat_id,
      sender: {
        sender_id: { open_id: senderOpenId },
        sender_type: data.sender.sender_type,
      },
      content: message.content,
      msg_type: message.message_type,
    },
    ctx.getAccountId(),
  );

  await handler(normalized);
}
