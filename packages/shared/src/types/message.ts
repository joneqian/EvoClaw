/** 消息角色 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * 多模态附件（当前只支持 image，预留扩展）
 *
 * - 入站时由 channel adapter 填充（带 path 指向本地文件），经 embedded-runner
 *   读文件转 base64 塞进 KernelMessage 的 ImageBlock
 * - 从 DB 重载历史时，loadMessageHistory 从 kernel_message_json 的 ImageBlock
 *   抽出 mimeType + base64 填充（path 此时可能丢失）
 * - 前端 MessageBubble 识别后渲染图片缩略图
 */
export interface ChatMessageAttachment {
  type: 'image';
  /** MIME 类型，如 image/png / image/jpeg */
  mimeType: string;
  /** 本地文件路径（入站侧有；DB 重载后可能缺失） */
  path?: string;
  /** 内联 base64 数据（DB 重载时有；入站侧留空由 runner 读文件后填充） */
  base64?: string;
}

/** 聊天消息 */
export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  /** 工具调用结果 */
  toolCalls?: ToolCall[];
  /** 标记为压缩摘要消息（恢复时由 loadMessageHistory 注入，kernel 中映射为 isCompactSummary） */
  isSummary?: boolean;
  /**
   * 多模态附件（如图片）
   *
   * 入站：IM 渠道把下载到本地的图片作为 attachment 挂上，runner 会转成
   * ImageBlock 直接喂给多模态模型；重载历史时从 kernel_message_json 里恢复
   * 供后续轮次继续看到图片。
   */
  attachments?: ChatMessageAttachment[];
  createdAt: string;
}

/** 工具调用 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
}

/** Agent 事件 — SSE 推送用 */
export interface AgentEvent {
  type: AgentEventType;
  timestamp: number;
  /** 文本增量 */
  delta?: string;
  /** 完整消息 */
  message?: ChatMessage;
  /** 工具执行 */
  toolCall?: ToolCall;
  /** 错误信息 */
  error?: string;
}

export type AgentEventType =
  | 'agent_start'
  | 'text_delta'
  | 'text_done'
  | 'tool_start'
  | 'tool_result'
  | 'agent_done'
  | 'error';

/** 会话键 — 格式: agent:{id}:{channel}:{chatType}:{peerId} */
export type SessionKey = `agent:${string}:${string}:${string}:${string}`;
