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
import {
  buildFeishuGroupPeerId,
  type FeishuGroupSessionScope,
} from './session-key.js';
import {
  GroupHistoryBuffer,
  buildHistoryKey,
  formatGroupHistoryContext,
  type GroupHistoryConfig,
} from './group-history.js';

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
    thread_id?: string;
    root_id?: string;
    parent_id?: string;
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
  /** 群会话隔离策略（默认 'group'） */
  getGroupSessionScope?: () => FeishuGroupSessionScope;
  /** 群聊旁听缓冲实例（多机器人协作） */
  getGroupHistory?: () => GroupHistoryBuffer | null;
  /** 群聊旁听缓冲配置，null 或 disabled 时跳过 */
  getGroupHistoryConfig?: () => GroupHistoryConfig | null;
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
  const senderName = data.sender.sender_id?.user_id;
  const isGroup = message.chat_type === 'group';

  // 预解析正文供 buffer / downloader 复用
  const parsed = parseFeishuContent(message.message_type, message.content);

  // 群聊过滤：必须 @机器人 或 @所有人
  if (isGroup) {
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
    if (!mentioned) {
      // 未 @ 的群消息进入旁听缓冲（Phase A），不触发 agent
      recordToGroupHistory(ctx, message, {
        sender: senderOpenId,
        senderName: resolveSenderName(message.mentions, senderOpenId) ?? senderName,
        body: parsed.text,
        fromBot: false,
      });
      return;
    }
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

  // 群聊：按 session scope 重写 peerId
  if (normalized.chatType === 'group') {
    const scope = ctx.getGroupSessionScope?.() ?? 'group';
    normalized.peerId = buildFeishuGroupPeerId({
      scope,
      chatId: message.chat_id,
      ...(senderOpenId ? { senderOpenId } : {}),
      ...(message.thread_id ? { threadId: message.thread_id } : {}),
    });
  }

  // 媒体下载（如果有 key + downloader）
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

  // 群聊被 @ 时，前缀注入旁听缓冲作为前情提要（Phase A）
  if (isGroup) {
    const historyEntries = peekGroupHistory(ctx, message);
    if (historyEntries.length > 0) {
      normalized.content = formatGroupHistoryContext({
        entries: historyEntries,
        currentMessage: normalized.content,
      });
    }
    // 当前被 @ 的消息本身也写入 buffer，便于后续其他 Agent 被 @ 时看到
    recordToGroupHistory(ctx, message, {
      sender: senderOpenId,
      senderName: resolveSenderName(message.mentions, senderOpenId) ?? senderName,
      body: parsed.text,
      fromBot: false,
    });
  }

  await handler(normalized);
}

/** 把一条消息记入旁听缓冲（enabled=false / buffer 缺失时安静跳过） */
function recordToGroupHistory(
  ctx: InboundContext,
  message: FeishuReceiveEvent['message'],
  entry: {
    sender: string;
    senderName: string | undefined;
    body: string;
    fromBot: boolean;
  },
): void {
  const buffer = ctx.getGroupHistory?.() ?? null;
  const config = ctx.getGroupHistoryConfig?.() ?? null;
  if (!buffer || !config || !config.enabled) return;
  const historyKey = buildHistoryKey({
    chatId: message.chat_id,
    ...(message.thread_id ? { threadId: message.thread_id } : {}),
  });
  if (!historyKey) return;
  buffer.record(
    historyKey,
    {
      sender: entry.sender,
      ...(entry.senderName ? { senderName: entry.senderName } : {}),
      body: entry.body,
      timestamp: Date.now(),
      messageId: message.message_id,
      fromBot: entry.fromBot,
    },
    config,
  );
}

/** 读取旁听缓冲（enabled=false / 无配置 / 无条目时返回空数组） */
function peekGroupHistory(
  ctx: InboundContext,
  message: FeishuReceiveEvent['message'],
): ReturnType<GroupHistoryBuffer['peek']> {
  const buffer = ctx.getGroupHistory?.() ?? null;
  const config = ctx.getGroupHistoryConfig?.() ?? null;
  if (!buffer || !config || !config.enabled) return [];
  const historyKey = buildHistoryKey({
    chatId: message.chat_id,
    ...(message.thread_id ? { threadId: message.thread_id } : {}),
  });
  if (!historyKey) return [];
  return buffer.peek(historyKey, config);
}

/** 从 mentions 里找到发送者的展示名（飞书 mention 有 name 字段，sender 自己没有） */
function resolveSenderName(
  mentions: FeishuReceiveEvent['message']['mentions'],
  senderOpenId: string,
): string | undefined {
  if (!mentions || !senderOpenId) return undefined;
  const hit = mentions.find(
    (m) =>
      m.id.open_id === senderOpenId ||
      m.id.user_id === senderOpenId ||
      m.id.union_id === senderOpenId,
  );
  return hit?.name;
}
