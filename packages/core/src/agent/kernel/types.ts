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
// Message Union — 所有消息类型的联合
// ═══════════════════════════════════════════════════════════════════════════

export type Message =
  | KernelMessage
  | SystemMessage
  | TombstoneMessage
  | ToolUseSummaryMessage;

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
}

export type StreamEvent =
  | { readonly type: 'text_delta'; readonly delta: string }
  | { readonly type: 'thinking_delta'; readonly delta: string }
  | { readonly type: 'tool_use_start'; readonly id: string; readonly name: string }
  | { readonly type: 'tool_use_delta'; readonly id: string; readonly delta: string }
  | { readonly type: 'tool_use_end'; readonly id: string; readonly name: string; readonly input: Record<string, unknown> }
  | { readonly type: 'usage'; readonly usage: TokenUsage }
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

/** 系统提示词分块（支持 Anthropic cache_control） */
export interface SystemPromptBlock {
  /** 文本内容 */
  text: string;
  /** Anthropic cache 控制。undefined = 不设置，ephemeral = 可缓存 */
  cacheControl?: { type: 'ephemeral' } | null;
  /** 段落标识（用于调试） */
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
  | 'token_budget_continue'; // Token Budget 有余额，自动续行

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
  /** 被标记移除的消息（流式回退/压缩重试时产生） */
  readonly tombstones: readonly TombstoneMessage[];
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

  // ─── Stop Hook (可选: assistant 响应后执行检查) ───
  readonly stopHook?: StopHookFn;

  // ─── Token Budget (可选: 无工具调用时检查是否自动续行) ───
  readonly tokenBudget?: TokenBudgetFn;

  // ─── Attachment Collector (可选: 工具执行后收集附件) ───
  readonly attachmentCollector?: AttachmentCollectorFn;
}

// ═══════════════════════════════════════════════════════════════════════════
// Error Types
// ═══════════════════════════════════════════════════════════════════════════

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
