/** 通道类型 */
export type ChannelType = 'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq' | 'weixin';

/**
 * 被引用消息（用户在 IM 中"引用回复"时携带的原始消息快照）
 *
 * 平台差异：飞书用 `parent_id` 指向被引用消息；企微/钉钉类似；微信个人号无此概念。
 * adapter 负责填充：通常先查入站 LRU，miss 时调 API 兜底，仍失败降级为 `[引用消息]`。
 */
export interface QuotedMessage {
  /** 被引用消息在平台的原始 messageId（用于前端跳转定位） */
  messageId: string;
  /** 被引用消息的发送者 ID（open_id / user_id / 机器人 bot_id 等） */
  senderId: string;
  /** 发送者展示名（可选，取不到时前端显示 senderId） */
  senderName?: string;
  /** 被引用的正文（媒体已归一为 `[图片]` / `[文件: xxx]` 等占位） */
  content: string;
  /** 被引用消息的时间戳（毫秒），可选 */
  timestamp?: number;
}

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
   * 引用的原始消息（若本条是"引用回复"）
   *
   * 由 adapter 在入站阶段填充。handler 会把它拼成文本前缀注入 Agent context，
   * 前端也会据此渲染"回复 xxx: ..."的引用块。
   */
  quoted?: QuotedMessage;
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
  /**
   * peer @ 来源信息（M13 多 Agent 协作 — 兜底 @ 回提问者）
   *
   * 当本条入站消息是**同事 Agent 通过 mention_peer @ 我**时，由 adapter 在 inbound
   * 分类（kind === 'peer'）阶段填充：
   *   - peerAgentId: 提问者的 EvoClaw Agent ID
   *   - peerOpenId: 提问者 bot 的 open_id（飞书等渠道 @ 用）
   *
   * channel-message-handler 在发主回复前用它做兜底：若 LLM 主回复正文里没有任何
   * `<at user_id="ou_..."/>` 标记，则前缀注入 `<at user_id="${peerOpenId}"/>`，确保
   * 提问者 bot 收到推送、对话链不断。
   *
   * 非 peer 消息（用户消息 / 单聊 / 非 mention）不填，handler 兜底逻辑直接跳过。
   */
  fromPeerAgentId?: string;
  fromPeerOpenId?: string;
}
