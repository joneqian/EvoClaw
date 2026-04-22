/** 通道类型 */
export type ChannelType = 'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq' | 'weixin';

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
  /** 媒体文件本地路径 (CDN 下载解密后) */
  mediaPath?: string;
  /** 媒体 MIME 类型 */
  mediaType?: string;
  /**
   * 广播 fanout 目标 agent 列表
   *
   * 若设置（非空数组），路由层会跳过 BindingRouter，按列表向每个 agentId 派发
   * 一次 handleChannelMessage 调用（各自独立 session）。
   *
   * 用于"一群多机器人同时响应一条消息"的场景（如 AI 圆桌 / 会议室），由 channel
   * adapter 根据 broadcast 配置在 inbound 时决定。未设置时走正常 binding 路径。
   */
  broadcastTargets?: string[];
}
