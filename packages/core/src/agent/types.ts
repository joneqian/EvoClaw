import type { AgentConfig, ChatMessage } from '@evoclaw/shared';
import type { ToolDefinition } from '../bridge/tool-injector.js';

/** Agent 运行配置 */
export interface AgentRunConfig {
  agent: AgentConfig;
  systemPrompt: string;
  workspaceFiles: Record<string, string>;
  modelId: string;
  provider: string;
  apiKey: string;
  baseUrl: string;
  /** API 协议 */
  apiProtocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'anthropic' | 'google';
  /** 注入的工具（阶段 3-4） */
  tools?: ToolDefinition[];
  /** 消息历史 */
  messages?: ChatMessage[];
  /** 权限拦截函数 — 工具执行前调用，返回 null 表示允许，返回字符串表示拒绝（拒绝原因） */
  permissionInterceptFn?: (toolName: string, args: Record<string, unknown>) => Promise<string | null>;
  /** 审计日志回调 — 工具执行后调用 */
  auditLogFn?: (entry: { toolName: string; args: Record<string, unknown>; result: string; status: 'success' | 'error' | 'denied'; durationMs: number }) => void;
}

/** Agent 事件类型 */
export type RuntimeEventType =
  | 'agent_start'
  | 'text_delta'
  | 'text_done'
  | 'thinking_delta'
  | 'tool_start'
  | 'tool_update'
  | 'tool_end'
  | 'agent_done'
  | 'error';

/** Agent 运行时事件 */
export interface RuntimeEvent {
  type: RuntimeEventType;
  timestamp: number;
  /** 文本增量 */
  delta?: string;
  /** 完整文本 */
  text?: string;
  /** 工具名称 */
  toolName?: string;
  /** 工具参数 */
  toolArgs?: Record<string, unknown>;
  /** 工具结果 */
  toolResult?: string;
  /** 是否工具执行出错 */
  isError?: boolean;
  /** 错误信息 */
  error?: string;
}
