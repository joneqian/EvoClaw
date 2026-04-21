/**
 * 入站消息处理
 *
 * 职责：
 * - 订阅 SDK 事件（im.message.receive_v1）
 * - 把 SDK 事件载荷桥接到 `normalizeFeishuMessage`
 * - 群聊过滤：未 @机器人 的消息直接忽略
 * - 忽略机器人自己发送的消息
 * - 媒体消息（image/file/audio/media）可选通过 downloader 下载到本地
 */

import type * as Lark from '@larksuiteoapi/node-sdk';
import type { MessageHandler } from '../../channel-adapter.js';
import { normalizeFeishuMessage } from '../../message-normalizer.js';
import { parseFeishuContent } from './parse-content.js';

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

/** 媒体下载回调签名 */
export type MediaDownloader = (params: {
  messageId: string;
  fileKey: string;
  msgType: string;
  fileName?: string;
}) => Promise<{ path: string; mimeType: string | null } | null>;

/** 入站处理所需的上下文（用函数而非快照，支持运行时变化） */
export interface InboundContext {
  getAccountId: () => string;
  getBotOpenId: () => string | null;
  getHandler: () => MessageHandler | null;
  getMediaDownloader?: () => MediaDownloader | null;
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

  // 媒体下载（如果有 key + downloader）
  const parsed = parseFeishuContent(message.message_type, message.content);
  if (parsed.mediaKey) {
    const downloader = ctx.getMediaDownloader?.() ?? null;
    if (downloader) {
      try {
        const downloaded = await downloader({
          messageId: message.message_id,
          fileKey: parsed.mediaKey,
          msgType: message.message_type,
          ...(parsed.fileName !== undefined ? { fileName: parsed.fileName } : {}),
        });
        if (downloaded) {
          normalized.mediaPath = downloaded.path;
          if (downloaded.mimeType) normalized.mediaType = downloaded.mimeType;
        }
      } catch {
        // 下载失败不阻塞消息流，normalized.content 里已有占位文本（如 "[图片]"）
      }
    }
  }

  await handler(normalized);
}
