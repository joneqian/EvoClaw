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

export interface KernelMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  content: ContentBlock[];
  usage?: TokenUsage;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool Interface — 统一签名，参考 Claude Code Tool 接口
// ═══════════════════════════════════════════════════════════════════════════

export interface ToolCallResult {
  content: string;
  isError?: boolean;
}

/**
 * Kernel 统一工具接口
 *
 * 安全默认值 (fail-closed):
 * - isReadOnly() 默认 false (假设可写)
 * - isConcurrencySafe() 默认 false (假设不安全)
 */
export interface KernelTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;

  call(input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolCallResult>;

  /** 是否只读 (默认 false — fail-closed) */
  isReadOnly(): boolean;

  /** 是否并发安全 (默认 false — fail-closed) */
  isConcurrencySafe(): boolean;
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
export type StreamEvent =
  | { readonly type: 'text_delta'; readonly delta: string }
  | { readonly type: 'thinking_delta'; readonly delta: string }
  | { readonly type: 'tool_use_start'; readonly id: string; readonly name: string }
  | { readonly type: 'tool_use_delta'; readonly id: string; readonly delta: string }
  | { readonly type: 'tool_use_end'; readonly id: string; readonly name: string; readonly input: Record<string, unknown> }
  | { readonly type: 'usage'; readonly usage: TokenUsage }
  | { readonly type: 'done'; readonly stopReason: string }
  | { readonly type: 'error'; readonly message: string; readonly status?: number };

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

export interface StreamConfig {
  readonly protocol: ApiProtocol;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly modelId: string;
  readonly systemPrompt: string;
  readonly messages: readonly KernelMessage[];
  readonly tools: readonly KernelTool[];
  readonly maxTokens: number;
  readonly thinking: boolean;
  readonly signal?: AbortSignal;
}

// ═══════════════════════════════════════════════════════════════════════════
// Query Loop Config & Result
// ═══════════════════════════════════════════════════════════════════════════

export interface QueryLoopConfig {
  // ─── API ───
  readonly protocol: ApiProtocol;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly modelId: string;
  readonly maxTokens: number;
  readonly contextWindow: number;
  readonly thinking: boolean;

  // ─── Tools ───
  readonly tools: readonly KernelTool[];

  // ─── System prompt ───
  readonly systemPrompt: string;

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
}

export interface QueryLoopResult {
  readonly fullResponse: string;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly messages: readonly KernelMessage[];
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
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
