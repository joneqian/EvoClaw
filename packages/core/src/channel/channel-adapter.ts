import type { ChannelType, ChannelMessage } from '@evoclaw/shared';

/** Channel 连接配置 */
export interface ChannelConfig {
  /** 通道类型 */
  type: ChannelType;
  /** 显示名称 */
  name: string;
  /** 凭证 / 配置（各适配器自定义） */
  credentials: Record<string, string>;
}

/** Channel 连接状态 */
export type ChannelStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Channel 状态信息 */
export interface ChannelStatusInfo {
  type: ChannelType;
  name: string;
  status: ChannelStatus;
  error?: string;
  connectedAt?: string;
}

/** 消息处理回调 */
export type MessageHandler = (message: ChannelMessage) => Promise<void>;

/**
 * Channel 适配器接口 — 各 IM 平台的统一抽象
 */
export interface ChannelAdapter {
  /** 通道类型 */
  readonly type: ChannelType;

  /** 建立连接 */
  connect(config: ChannelConfig): Promise<void>;

  /** 断开连接 */
  disconnect(): Promise<void>;

  /** 注册消息回调 */
  onMessage(handler: MessageHandler): void;

  /** 发送消息 */
  sendMessage(peerId: string, content: string, chatType?: 'private' | 'group'): Promise<void>;

  /** 发送媒体消息 (可选，仅部分渠道支持) */
  sendMediaMessage?(peerId: string, filePath: string, text?: string, chatType?: 'private' | 'group'): Promise<void>;

  /** 发送/取消输入状态指示 (可选，仅部分渠道支持) */
  sendTyping?(peerId: string, cancel?: boolean): Promise<void>;

  /** 获取连接状态 */
  getStatus(): ChannelStatusInfo;
}
