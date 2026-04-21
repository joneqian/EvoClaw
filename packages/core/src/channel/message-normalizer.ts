import type { ChannelType, ChannelMessage } from '@evoclaw/shared';
import type { WeixinMessage } from './adapters/weixin-types.js';
import { WeixinItemType } from './adapters/weixin-types.js';
import { parseFeishuContent } from './adapters/feishu/parse-content.js';

/**
 * 飞书事件消息 → ChannelMessage
 *
 * 支持的 msg_type: text / post / image / file / audio / media / sticker /
 * interactive / merge_forward / share_chat（未知类型降级为文本描述）
 */
export function normalizeFeishuMessage(event: {
  message_id: string;
  chat_type: string;
  chat_id: string;
  sender: { sender_id: { open_id: string }; sender_type: string; tenant_key?: string };
  content: string;
  msg_type: string;
}, accountId: string): ChannelMessage {
  const chatType = event.chat_type === 'p2p' ? 'private' : 'group';
  const peerId = chatType === 'private'
    ? event.sender.sender_id.open_id
    : event.chat_id;

  const parsed = parseFeishuContent(event.msg_type, event.content);

  return {
    channel: 'feishu' as ChannelType,
    chatType,
    accountId,
    peerId,
    senderId: event.sender.sender_id.open_id,
    senderName: '',
    content: parsed.text,
    messageId: event.message_id,
    timestamp: Date.now(),
  };
}

/**
 * 企微事件消息 → ChannelMessage
 */
export function normalizeWecomMessage(event: {
  MsgId: string;
  MsgType: string;
  Content: string;
  FromUserName: string;
  ToUserName: string;
  CreateTime: number;
  AgentID?: number;
}, accountId: string, isGroup: boolean): ChannelMessage {
  return {
    channel: 'wecom' as ChannelType,
    chatType: isGroup ? 'group' : 'private',
    accountId,
    peerId: event.FromUserName,
    senderId: event.FromUserName,
    senderName: '',
    content: event.Content ?? '',
    messageId: event.MsgId,
    timestamp: event.CreateTime * 1000,
  };
}

/**
 * 微信 iLink Bot 消息 → ChannelMessage
 * iLink Bot 仅支持私聊 (direct message)
 *
 * 处理:
 * - 文本消息: 拼接所有 TEXT 项
 * - 语音转文字: 如果 voice_item 有 text 字段，使用文字内容
 * - 引用消息: 如果 ref_msg 是文本引用，前置 [引用: title | content]
 */
export function normalizeWeixinMessage(
  msg: WeixinMessage,
  accountId: string,
): ChannelMessage {
  const content = extractWeixinContent(msg.item_list ?? []);

  return {
    channel: 'weixin' as ChannelType,
    chatType: 'private',
    accountId,
    peerId: msg.from_user_id ?? '',
    senderId: msg.from_user_id ?? '',
    senderName: '',
    content,
    messageId: String(msg.message_id ?? ''),
    timestamp: msg.create_time_ms ?? Date.now(),
  };
}

/**
 * 从消息项列表中提取文本内容
 * 优先级: TEXT 文本 > VOICE 语音转文字
 * 附加处理: ref_msg 引用消息
 */
function extractWeixinContent(items: import('./adapters/weixin-types.js').WeixinMessageItem[]): string {
  // 先收集文本项
  const textParts: string[] = [];
  let refPrefix = '';

  for (const item of items) {
    if (item.type === WeixinItemType.TEXT) {
      const text = item.text_item?.text ?? '';

      // 处理引用消息 (仅文本引用，媒体引用跳过)
      if (item.ref_msg && text) {
        const ref = item.ref_msg;
        const refItem = ref.message_item;

        // 如果引用的是媒体类型，不添加引用前缀 (媒体会通过 mediaPath 传递)
        const mediaTypes = [WeixinItemType.IMAGE, WeixinItemType.VIDEO, WeixinItemType.FILE, WeixinItemType.VOICE];
        const isMediaRef = refItem?.type && (mediaTypes as readonly number[]).includes(refItem.type);

        if (!isMediaRef) {
          // 构建引用前缀
          const parts: string[] = [];
          if (ref.title) parts.push(ref.title);
          if (refItem) {
            const refContent = extractRefItemText(refItem);
            if (refContent) parts.push(refContent);
          }
          if (parts.length > 0) {
            refPrefix = `[引用: ${parts.join(' | ')}]\n`;
          }
        }
      }

      textParts.push(text);
    }

    // 语音转文字: 如果 voice_item 有 text 字段，使用文字内容
    if (item.type === WeixinItemType.VOICE && item.voice_item?.text) {
      textParts.push(item.voice_item.text);
    }
  }

  const body = textParts.join('');
  return refPrefix + body;
}

/** 从引用消息项中提取文本 */
function extractRefItemText(item: import('./adapters/weixin-types.js').WeixinMessageItem): string {
  if (item.type === WeixinItemType.TEXT && item.text_item?.text) {
    return item.text_item.text;
  }
  return '';
}

/**
 * 桌面本地消息 → ChannelMessage
 */
export function normalizeDesktopMessage(
  content: string,
  userId: string = 'local-user',
): ChannelMessage {
  return {
    channel: 'local' as ChannelType,
    chatType: 'private',
    accountId: 'desktop',
    peerId: userId,
    senderId: userId,
    senderName: '本地用户',
    content,
    messageId: crypto.randomUUID(),
    timestamp: Date.now(),
  };
}
