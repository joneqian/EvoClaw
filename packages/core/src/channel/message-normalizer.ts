import type { ChannelType, ChannelMessage } from '@evoclaw/shared';

/**
 * 飞书事件消息 → ChannelMessage
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

  // 飞书消息 content 是 JSON 字符串
  let text = '';
  try {
    const parsed = JSON.parse(event.content);
    text = parsed.text ?? event.content;
  } catch {
    text = event.content;
  }

  return {
    channel: 'feishu' as ChannelType,
    chatType,
    accountId,
    peerId,
    senderId: event.sender.sender_id.open_id,
    senderName: '',
    content: text,
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
