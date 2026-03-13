/** 通道类型 */
export type ChannelType = 'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq';

/** 通道消息 — 从 IM 平台收到的消息 */
export interface ChannelMessage {
  channel: ChannelType;
  chatType: 'private' | 'group';
  accountId: string;
  peerId: string;
  senderId: string;
  senderName: string;
  content: string;
  messageId: string;
  timestamp: number;
}
