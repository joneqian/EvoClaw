import type { ChannelType, ChannelMessage } from '@evoclaw/shared';

/** Channel 连接配置 */
export interface ChannelConfig {
  /** 通道类型 */
  type: ChannelType;
  /**
   * 账号标识 —— 同 channel type 下区分不同应用的 key
   *
   * 飞书：appId（`cli_xxx`），企微：corpId，微信：token 后缀等。
   * 允许空串作为"未指派 accountId"的过渡态（migration 030 迁移老数据用），
   * 启动恢复会把 `''` 改写为真实 accountId。
   *
   * 可选过渡期：Phase B 之后所有调用路径都会显式传 accountId；
   * 这里保留 `?` 是为了避免重构期间老 callsite 大面积编译错。
   */
  accountId?: string;
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
  /**
   * 账号标识（同 `ChannelConfig.accountId`）
   *
   * 一个 ChannelType 可能对应多个账号（多飞书应用 / 多企微主体），
   * 每个账号一条 `ChannelStatusInfo`；前端按 `(type, accountId)` 渲染独立子卡。
   *
   * 过渡期可选，Phase B 之后所有返回路径都会显式带上真实 accountId。
   */
  accountId?: string;
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
