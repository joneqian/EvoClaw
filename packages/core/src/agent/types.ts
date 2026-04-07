import type { AgentConfig, ChatMessage, ThinkLevel } from '@evoclaw/shared';
import type { ToolDefinition } from '../bridge/tool-injector.js';
import type { ErrorType } from './embedded-runner-errors.js';
import type { McpManager } from '../mcp/mcp-client.js';

// ─── Provider Failover 配置 ───

/** 单个 Provider 配置（用于 failover 链路） */
export interface ProviderConfig {
  provider: string;
  modelId: string;
  apiKey: string;
  baseUrl: string;
  apiProtocol?: AgentRunConfig['apiProtocol'];
  contextWindow?: number;
  maxTokens?: number;
}

// ─── Agent 运行配置 ───

/** Agent 运行配置 */
export interface AgentRunConfig {
  agent: AgentConfig;
  systemPrompt: string;
  workspaceFiles: Record<string, string>;
  /** Agent 工作目录 (cwd) — 工具执行和 PI session 的工作目录 */
  workspacePath?: string;
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
  /** Fallback provider 列表（按优先级排序），用于 billing/auth/overload 错误时自动切换 */
  fallbackProviders?: ProviderConfig[];
  /** 模型上下文窗口大小 (tokens) — 从 extension 预设或用户配置获取 */
  contextWindow?: number;
  /** 模型最大输出 tokens — 从 extension 预设或用户配置获取 */
  maxTokens?: number;
  /** 响应语言偏好（从全局配置读取，优先级: 用户配置 > 品牌默认 > 'zh'） */
  language?: 'zh' | 'en';
  /** 思考模式: auto=模型支持就开, on=强制开, off=强制关（默认 auto） */
  thinkingMode?: 'auto' | 'on' | 'off';
  /** 系统提示词覆盖列表（5 级优先级链） */
  promptOverrides?: Array<{
    level: 'override' | 'coordinator' | 'agent' | 'custom' | 'default';
    content: string;
    mode: 'replace' | 'append';
  }>;
  /** Tool Use Summary LLM 调用函数（可选，用于生成工具摘要） */
  toolSummaryGeneratorFn?: (system: string, user: string) => Promise<string>;
  /** 模型解析器（将 skill 的 model 字段 "provider/modelId" 解析为 API 配置） */
  modelResolver?: (modelRef: string) => { protocol: string; baseUrl: string; apiKey: string; modelId: string; contextWindow: number } | undefined;
  /** 会话标识（用于 Kernel SM Compact + compact boundary 持久化） */
  sessionKey?: string;
  /** Compact 前置钩子（可选: 压缩前检查/阻止） */
  preCompactHook?: import('./kernel/types.js').PreCompactHookFn;
  /** Compact 后置钩子（可选: 持久化压缩边界 + 摘要） */
  postCompactHook?: import('./kernel/types.js').PostCompactHookFn;
  /** SQLite store（可选: 用于增量持久化） */
  store?: import('../infrastructure/db/sqlite-store.js').SqliteStore;
  /** MCP Manager 实例（可选: 用于 MCP 工具执行和 Prompt 桥接） */
  mcpManager?: McpManager;
}

// ─── 单次执行结果 ───

/** 轻量消息快照（跨 provider failover 传递上下文） */
export interface MessageSnapshot {
  role: string;
  content: string;
  /** 标记为压缩摘要消息 */
  isSummary?: boolean;
}

/** 工具调用记录（用于消息快照传递） */
export interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  isError: boolean;
}

/** 单次 attempt 的执行结果 — 外层循环根据此结果决定恢复策略 */
export interface AttemptResult {
  /** 是否成功完成 */
  success: boolean;
  /** 错误类型（成功时为 undefined） */
  errorType?: ErrorType;
  /** 错误信息 */
  error?: string;
  /** 是否超时 */
  timedOut: boolean;
  /** 超时是否发生在 compaction 期间 */
  timedOutDuringCompaction: boolean;
  /** 是否被外部中止 */
  aborted: boolean;
  /** 消息快照（供 failover/重试使用） */
  messagesSnapshot?: MessageSnapshot[];
  /** 收集的完整文本 */
  fullResponse: string;
  /** 收集的工具调用记录 */
  toolCalls: ToolCallRecord[];
}

/** Agent 事件类型 */
export type RuntimeEventType =
  | 'queued'
  | 'agent_start'
  | 'text_delta'
  | 'text_done'
  | 'thinking_delta'
  | 'tool_start'
  | 'tool_update'
  | 'tool_end'
  | 'agent_done'
  | 'error'
  | 'message_start'
  | 'message_end'
  | 'compaction_start'
  | 'compaction_end'
  | 'usage'
  | 'stream_metrics'
  | 'tombstone';

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
  /** 工具是否不可逆操作（前端显示确认对话框） */
  isDestructive?: boolean;
  /** Token 使用量（type='usage' 时） */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    estimatedCostMilli: number;
    turnCount: number;
  };
  /** 流式指标（type='stream_metrics' 时） */
  streamMetrics?: {
    /** 卡顿次数 (>30s 事件间隔) */
    stallCount: number;
    /** 卡顿总时长 (ms) */
    totalStallMs: number;
    /** SSE 事件总数 */
    eventCount: number;
    /** 总耗时 (ms) */
    totalDurationMs: number;
    /** TTFB (ms) — HTTP 响应头到达延迟 */
    ttfbMs?: number;
    /** 首个 SSE 事件延迟 (ms) — 从请求发出到首个内容事件 */
    firstChunkMs?: number;
    /** 是否使用了非流式回退 */
    fallbackUsed: boolean;
    /** abort 传播延迟 (ms)，仅超时时有值 */
    abortExitDelayMs?: number;
    /** abort 退出路径 */
    abortExitPath?: 'clean' | 'catch';
  };
}
