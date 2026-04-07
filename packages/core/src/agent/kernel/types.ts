/**
 * Agent Kernel 核心类型定义
 *
 * 参考 Claude Code 的消息模型和流式事件体系:
 * - ContentBlock: 与 Anthropic API content block 格式对齐
 * - StreamEvent: 统一 Anthropic SSE + OpenAI SSE 的归一化事件
 * - KernelTool: 统一工具接口 (fail-closed 安全默认值)
 * - QueryLoopConfig: Agent 循环的完整配置
 *
 * 参考文档: docs/research/02-message-model.md, 04-streaming.md
 */

import type { RuntimeEvent, ToolCallRecord } from '../types.js';
import type { ToolSafetyGuard } from '../tool-safety.js';

// ═══════════════════════════════════════════════════════════════════════════
// Content Blocks — 与 Anthropic API 格式对齐
// ═══════════════════════════════════════════════════════════════════════════

export interface TextBlock {
  readonly type: 'text';
  text: string;
}

export interface ToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ThinkingBlock {
  readonly type: 'thinking';
  thinking: string;
  /** 思考签名（Anthropic API 要求在后续轮次中回传） */
  signature?: string;
}

/**
 * 已编辑思考块 — Anthropic API 在多轮对话中返回，必须原样回传
 *
 * 参考 Claude Code: RedactedThinkingBlock { type: 'redacted_thinking', data: string }
 * API 合约要求: 后续轮次的 messages 中必须包含此块，否则报错
 */
export interface RedactedThinkingBlock {
  readonly type: 'redacted_thinking';
  /** 不透明数据（不可解码，仅需原样回传） */
  readonly data: string;
}

export interface ImageBlock {
  readonly type: 'image';
  readonly source: {
    readonly type: 'base64';
    readonly media_type: string;
    readonly data: string;
  };
}

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
  | RedactedThinkingBlock
  | ImageBlock;

// ═══════════════════════════════════════════════════════════════════════════
// Token Usage
// ═══════════════════════════════════════════════════════════════════════════

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Messages
// ═══════════════════════════════════════════════════════════════════════════

/** 消息来源标记 */
export type MessageOrigin = 'user' | 'skill' | 'hook' | 'channel' | 'cron' | 'heartbeat' | 'boot';

export interface KernelMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  content: ContentBlock[];
  usage?: TokenUsage;
  /** 消息来源（默认 undefined = 用户直接输入） */
  origin?: MessageOrigin;
  /** 元消息（不计入对话，仅用于内部控制） */
  isMeta?: boolean;
  /** 压缩摘要消息（由 autocompact 生成） */
  isCompactSummary?: boolean;
  /** API 请求 ID — 生产调试用 (Anthropic: request-id, OpenAI: x-request-id) */
  requestId?: string;
  /** 虚拟消息 — 系统注入的非真实用户输入，前端可区分展示 */
  isVirtual?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// System Message — 系统通知（参考 Claude Code 12 种子类型）
// ═══════════════════════════════════════════════════════════════════════════

export type SystemMessageSubtype =
  | 'informational'          // 通用信息
  | 'api_error'              // API 调用错误
  | 'compact_boundary'       // Autocompact 压缩边界
  | 'microcompact_boundary'  // Microcompact 截断边界
  | 'snip_boundary'          // Snip 删除边界
  | 'memory_saved'           // 记忆保存通知
  | 'turn_duration'          // 轮次耗时统计
  | 'permission_denied'      // 权限拒绝
  | 'tool_loop_detected';    // 工具循环检测

export interface SystemMessage {
  readonly type: 'system';
  readonly subtype: SystemMessageSubtype;
  readonly id: string;
  content: string;
  level: 'info' | 'warning' | 'error';
  timestamp: string;
  /** 附加数据（子类型特定） */
  detail?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tombstone Message — 标记移除（流式回退场景）
// ═══════════════════════════════════════════════════════════════════════════

export interface TombstoneMessage {
  readonly type: 'tombstone';
  readonly id: string;
  /** 被标记移除的原始消息 */
  readonly original: KernelMessage;
  reason: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool Use Summary — 工具调用序列摘要（上下文压缩用）
// ═══════════════════════════════════════════════════════════════════════════

export interface ToolUseSummaryMessage {
  readonly type: 'tool_use_summary';
  readonly id: string;
  /** 摘要文本（git-commit-subject 风格） */
  summary: string;
  /** 关联的工具调用 ID 列表 */
  precedingToolUseIds: string[];
  timestamp: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Progress Message — 工具执行进度（长时间运行工具的实时状态）
// ═══════════════════════════════════════════════════════════════════════════

export interface ProgressMessage {
  readonly type: 'progress';
  readonly id: string;
  /** 关联的工具调用 ID */
  readonly parentToolUseId: string;
  /** 进度数据（工具特定） */
  data: { message: string; percentage?: number; [key: string]: unknown };
  timestamp: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Attachment Message — 附件（Hook 结果、任务输出、记忆提取等）
// ═══════════════════════════════════════════════════════════════════════════

/** 附件来源 */
export type AttachmentSource = 'hook' | 'task' | 'memory' | 'channel';

export interface AttachmentMessage {
  readonly type: 'attachment';
  readonly id: string;
  /** 附件来源 */
  source: AttachmentSource;
  /** 附件内容 */
  content: string;
  /** 结构化数据（可选） */
  data?: Record<string, unknown>;
  timestamp: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Message Union — 所有消息类型的联合
// ═══════════════════════════════════════════════════════════════════════════

export type Message =
  | KernelMessage
  | SystemMessage
  | TombstoneMessage
  | ToolUseSummaryMessage
  | ProgressMessage
  | AttachmentMessage;

// ═══════════════════════════════════════════════════════════════════════════
// Tool Interface — 统一签名，参考 Claude Code Tool 接口
// ═══════════════════════════════════════════════════════════════════════════

/** 工具进度回调 */
export type ToolProgressCallback = (progress: { message: string; data?: unknown }) => void;

export interface ToolCallResult {
  content: string;
  isError?: boolean;
  /** 上下文修改器（仅非并行工具可用，如 cd 命令修改 cwd） */
  contextModifier?: (ctx: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Kernel 统一工具接口
 *
 * 安全默认值 (fail-closed):
 * - isReadOnly() 默认 false (假设可写)
 * - isConcurrencySafe() 默认 false (假设不安全)
 * - isDestructive() 默认 false
 * - shouldDefer 默认 false (全量加载)
 */
export interface KernelTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;

  /** 向后兼容别名（旧名称映射到此工具） */
  readonly aliases?: readonly string[];

  /** 搜索提示词（3-10 词能力描述，供 ToolSearchTool 匹配） */
  readonly searchHint?: string;

  /** 是否延迟加载（true = 初始 prompt 不含完整 schema，需通过 ToolSearch 发现） */
  readonly shouldDefer?: boolean;

  call(input: Record<string, unknown>, signal?: AbortSignal, onProgress?: ToolProgressCallback): Promise<ToolCallResult>;

  /** 是否只读 (默认 false — fail-closed) */
  isReadOnly(): boolean;

  /** 是否并发安全 (默认 false — fail-closed) */
  isConcurrencySafe(): boolean;

  /** 是否不可逆操作 (默认 false) — true 时前端显示确认对话框 */
  isDestructive?(input: Record<string, unknown>): boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Streaming Events — 从 SSE 解析后的归一化事件
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 归一化流式事件，统一 Anthropic 和 OpenAI 两种 SSE 格式。
 *
 * Anthropic SSE 事件序列:
 *   message_start → content_block_start → content_block_delta(多次)
 *   → content_block_stop → message_delta → message_stop
 *
 * OpenAI SSE 事件序列:
 *   data: { choices: [{ delta: { content, tool_calls } }] }
 *   data: { choices: [{ finish_reason: 'stop' | 'tool_calls' }] }
 *   data: [DONE]
 */
/** 流式延迟检查点 */
export interface StreamLatencyCheckpoints {
  /** fetch 发出前 */
  requestSentAt: number;
  /** HTTP 响应头到达 (TTFB) */
  headersReceivedAt?: number;
  /** 首个 SSE 事件到达 */
  firstChunkAt?: number;
  /** 流结束 */
  doneAt?: number;
}

/** 流式可观测性指标 */
export interface StreamingMetrics {
  /** 卡顿次数 (>30s 事件间隔) */
  stallCount: number;
  /** 卡顿总时长 (ms) */
  totalStallMs: number;
  /** SSE 事件总数 */
  eventCount: number;
  /** 总耗时 (ms) */
  totalDurationMs: number;
  /** 使用的协议 */
  protocol: ApiProtocol;
  /** 是否使用了非流式回退 */
  fallbackUsed: boolean;
  /** 延迟检查点 */
  latency: StreamLatencyCheckpoints;
  /** abort 传播延迟 (ms)，仅超时时有值 — 参考 Claude Code exit_delay_ms */
  abortExitDelayMs?: number;
  /** abort 退出路径: clean=正常循环退出后检测, catch=异常捕获 */
  abortExitPath?: 'clean' | 'catch';
}

export type StreamEvent =
  | { readonly type: 'text_delta'; readonly delta: string }
  | { readonly type: 'thinking_delta'; readonly delta: string }
  | { readonly type: 'redacted_thinking'; readonly data: string }
  | { readonly type: 'tool_use_start'; readonly id: string; readonly name: string }
  | { readonly type: 'tool_use_delta'; readonly id: string; readonly delta: string }
  | { readonly type: 'tool_use_end'; readonly id: string; readonly name: string; readonly input: Record<string, unknown> }
  | { readonly type: 'usage'; readonly usage: TokenUsage }
  | { readonly type: 'thinking_signature'; readonly signature: string }
  | { readonly type: 'done'; readonly stopReason: string }
  | { readonly type: 'error'; readonly message: string; readonly status?: number }
  | { readonly type: 'latency'; readonly checkpoints: StreamLatencyCheckpoints }
  | { readonly type: 'metrics'; readonly metrics: StreamingMetrics };

// ═══════════════════════════════════════════════════════════════════════════
// Raw SSE Event — SSE 解析器输出
// ═══════════════════════════════════════════════════════════════════════════

export interface RawSSEEvent {
  /** Anthropic SSE 的 event: 行值 (OpenAI 无此字段) */
  event?: string;
  /** data: 行的 JSON 字符串 */
  data: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Stream Client Config
// ═══════════════════════════════════════════════════════════════════════════

export type ApiProtocol = 'anthropic-messages' | 'openai-completions';

/** 思考配置（参考 Claude Code ThinkingConfig） */
export type ThinkingConfig =
  | { type: 'adaptive' }                         // 模型自主决定（4.6+ 模型）
  | { type: 'enabled'; budgetTokens?: number }    // 固定预算模式
  | { type: 'disabled' };                         // 禁用

/**
 * Prompt Cache 作用域
 *
 * 参考 Claude Code splitSysPromptPrefix() 的三种缓存模式:
 * - 'global': 跨用户共享（Anthropic 1P 专属，命中费用 1/10）
 * - 'org': 组织级缓存（Anthropic 默认，无需传 scope）
 * - null/undefined: 不缓存
 *
 * OpenAI 协议路径忽略 scope（API 不支持）。
 */
export type CacheScope = 'global' | 'org';

/** 系统提示词分块（支持 Anthropic cache_control + 三级 scope） */
export interface SystemPromptBlock {
  /** 文本内容 */
  text: string;
  /**
   * Anthropic cache 控制
   * - undefined/null = 不缓存（动态段落）
   * - { type: 'ephemeral' } = 可缓存，org 级（默认）
   * - { type: 'ephemeral', scope: 'global' } = 全局缓存（静态段落，1P 专属）
   */
  cacheControl?: { type: 'ephemeral'; scope?: CacheScope } | null;
  /** 段落标识（用于调试和缓存击穿根因分析） */
  label?: string;
}

/** 将 SystemPromptBlock[] 合并为单字符串（OpenAI 兼容） */
export function systemPromptBlocksToString(blocks: readonly SystemPromptBlock[]): string {
  return blocks.map(b => b.text).join('\n\n');
}

export interface StreamConfig {
  readonly protocol: ApiProtocol;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly modelId: string;
  /** 系统提示词：字符串（兼容）或分块数组（支持 Anthropic cache_control） */
  readonly systemPrompt: string | readonly SystemPromptBlock[];
  readonly messages: readonly KernelMessage[];
  readonly tools: readonly KernelTool[];
  readonly maxTokens: number;
  /** 思考配置（adaptive/enabled/disabled） */
  readonly thinkingConfig: ThinkingConfig;
  readonly signal?: AbortSignal;
  /** Eager Input Streaming — 允许工具 JSON 输入在完成前开始流式传输（仅 Anthropic 第一方 API） */
  readonly eagerInputStreaming?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Query Loop Config & Result
// ═══════════════════════════════════════════════════════════════════════════

/** 循环退出原因 */
export type ExitReason =
  | 'completed'             // 正常完成（无工具调用）
  | 'max_turns'             // 达到轮次上限
  | 'max_tokens_exhausted'  // max_output_tokens 恢复次数用尽
  | 'abort'                 // 外部中止
  | 'stop_hook_prevented'   // Stop Hook 阻止继续
  | 'token_budget_exhausted' // Token Budget 耗尽
  | 'error';                // 未恢复的错误

/** 循环转换原因（记录为什么进入下一轮） */
export type TransitionReason =
  | 'tool_use'              // 有工具调用，继续执行
  | 'max_tokens_recovery'   // max_output_tokens 恢复重试
  | 'overflow_retry'        // 413 压缩重试
  | 'stop_hook_blocking'    // Stop Hook 报告阻断性错误，继续修复
  | 'token_budget_continue' // Token Budget 有余额，自动续行
  | 'model_fallback';       // 模型回退（主模型失败，切换备用）

/**
 * 循环状态快照 — 每轮结束时构建新对象，不可变追踪
 *
 * 参考 Claude Code query.ts 的 State 对象:
 * 每轮迭代结束后构建新 state 赋值回变量，循环继续。
 * messages 数组本身保持 mutable（性能），LoopState 对象每轮重建。
 */
export interface LoopState {
  readonly messages: KernelMessage[];
  readonly turnCount: number;
  readonly transition: TransitionReason | null;
  readonly overflowRetries: number;
  readonly maxOutputRecoveryCount: number;
  readonly effectiveMaxTokens: number;
  /** 当前生效的模型 ID（模型回退时会变化） */
  readonly effectiveModelId: string;
}

export interface QueryLoopResult {
  readonly fullResponse: string;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly messages: readonly KernelMessage[];
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  /** 循环退出原因 */
  readonly exitReason: ExitReason;
  /** 轮次数 */
  readonly turnCount: number;
  /** 最后一次转换原因（调试用） */
  readonly lastTransition: TransitionReason | null;
}

/** Stop Hook 检查结果 */
export interface StopHookResult {
  /** 是否有阻断性错误（循环继续修复） */
  blockingErrors: string[];
  /** 是否阻止继续（终止循环） */
  preventContinuation: boolean;
}

/** Stop Hook 回调类型 */
export type StopHookFn = (
  assistantMessage: KernelMessage,
  messages: readonly KernelMessage[],
) => Promise<StopHookResult>;

/** Token Budget 检查结果 */
export interface TokenBudgetDecision {
  action: 'continue' | 'stop';
  /** continue 时注入的提示消息 */
  nudgeMessage?: string;
  /** 停止原因 */
  stopReason?: 'budget_exhausted' | 'diminishing_returns' | 'natural_stop';
}

/** Token Budget 回调类型 */
export type TokenBudgetFn = (
  turnCount: number,
  totalInputTokens: number,
  totalOutputTokens: number,
) => TokenBudgetDecision;

/** 附件收集回调类型 */
export type AttachmentCollectorFn = (
  toolCalls: readonly ToolCallRecord[],
  messages: readonly KernelMessage[],
) => Promise<string | null>;

export interface QueryLoopConfig {
  // ─── API ───
  readonly protocol: ApiProtocol;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly modelId: string;
  readonly maxTokens: number;
  readonly contextWindow: number;
  /** 思考配置（adaptive/enabled/disabled） */
  readonly thinkingConfig: ThinkingConfig;

  // ─── Tools ───
  readonly tools: readonly KernelTool[];

  // ─── System prompt ───
  readonly systemPrompt: string | readonly SystemPromptBlock[];

  // ─── History (初始消息，循环内部会追加) ───
  readonly messages: KernelMessage[];

  // ─── Limits ───
  readonly maxTurns: number;
  readonly timeoutMs: number;

  // ─── Callbacks — 桥接到 RuntimeEvent ───
  readonly onEvent: (event: RuntimeEvent) => void;

  // ─── Safety ───
  readonly toolSafety: ToolSafetyGuard;

  // ─── Abort ───
  readonly abortSignal?: AbortSignal;

  // ─── Compaction (可选: 用于 autocompact 的轻量模型) ───
  readonly compaction?: {
    readonly protocol: ApiProtocol;
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly modelId: string;
  };

  // ─── Model Fallback (可选: 主模型失败时循环内切换) ───
  readonly fallbackModel?: FallbackModelConfig;

  // ─── Stop Hook (可选: assistant 响应后执行检查) ───
  readonly stopHook?: StopHookFn;

  // ─── Token Budget (可选: 无工具调用时检查是否自动续行) ───
  readonly tokenBudget?: TokenBudgetFn;

  // ─── Attachment Collector (可选: 工具执行后收集附件) ───
  readonly attachmentCollector?: AttachmentCollectorFn;

  // ─── Tool Summary Generator (可选: LLM 驱动的工具摘要) ───
  readonly toolSummaryGenerator?: {
    generateAsync(tools: Array<{ toolName: string; toolInput: Record<string, unknown>; toolResult?: string; isError?: boolean }>): Promise<string>;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Error Types
// ═══════════════════════════════════════════════════════════════════════════

/** 模型回退配置（循环内切换备用模型） */
export interface FallbackModelConfig {
  readonly modelId: string;
  readonly protocol?: ApiProtocol;
  readonly baseUrl?: string;
  readonly apiKey?: string;
}

/** API 调用错误 (携带 HTTP 状态码) */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseBody?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 流式空闲超时错误 */
export class IdleTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`流式空闲超时: ${timeoutMs / 1000}s 无数据`);
    this.name = 'IdleTimeoutError';
  }
}

/** 外部中止错误 */
export class AbortError extends Error {
  constructor(message = '外部中止') {
    super(message);
    this.name = 'AbortError';
  }
}
