/** 消息角色 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

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
