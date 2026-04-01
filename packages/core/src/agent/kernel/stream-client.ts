/**
 * 流式 LLM 客户端 — 双协议 (Anthropic Messages + OpenAI Chat Completions)
 *
 * 核心设计:
 * - 原生 fetch() + ReadableStream，不依赖 SDK
 * - 归一化 StreamEvent async generator 输出
 * - 90 秒空闲看门狗 + 非流式回退
 * - OpenAI ToolCallAccumulator 处理增量 JSON 拼接
 *
 * 参考 Claude Code:
 * - services/api/claude.ts: queryModelWithStreaming
 * - 空闲看门狗: STREAM_IDLE_TIMEOUT_MS = 90_000
 * - 非流式回退: getNonstreamingFallbackTimeoutMs() → 300s / 120s
 *
 * 参考文档: docs/research/04-streaming.md, 25-api-integration.md
 */

import { parseSSE, safeParseJSON } from './stream-parser.js';
import { buildAuthHeaders } from '../../provider/model-fetcher.js';
import type {
  StreamConfig,
  StreamEvent,
  KernelMessage,
  ContentBlock,
  ToolUseBlock,
} from './types.js';
import { ApiError, IdleTimeoutError } from './types.js';
import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('stream-client');

// ═══════════════════════════════════════════════════════════════════════════
// Constants — 参考 Claude Code 精确值
// ═══════════════════════════════════════════════════════════════════════════

/** 流式空闲超时 (参考 Claude Code: 90s) */
const STREAM_IDLE_TIMEOUT_MS = 90_000;

/** 非流式回退超时 */
const NONSTREAMING_FALLBACK_TIMEOUT_MS = 300_000;

/** 空闲警告时间 (超时的一半) */
const STREAM_IDLE_WARNING_MS = STREAM_IDLE_TIMEOUT_MS / 2;

// ═══════════════════════════════════════════════════════════════════════════
// Idle Watchdog — 参考 Claude Code 的两级看门狗
// ═══════════════════════════════════════════════════════════════════════════

interface IdleWatchdog {
  reset(): void;
  clear(): void;
  readonly aborted: boolean;
}

function createIdleWatchdog(
  timeoutMs: number,
  onTimeout: () => void,
): IdleWatchdog {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let warningTimer: ReturnType<typeof setTimeout> | null = null;
  let _aborted = false;

  function clearTimers(): void {
    if (timer) { clearTimeout(timer); timer = null; }
    if (warningTimer) { clearTimeout(warningTimer); warningTimer = null; }
  }

  return {
    reset() {
      clearTimers();
      warningTimer = setTimeout(() => {
        log.warn(`流式空闲警告: ${STREAM_IDLE_WARNING_MS / 1000}s 无数据`);
      }, STREAM_IDLE_WARNING_MS);
      timer = setTimeout(() => {
        _aborted = true;
        log.error(`流式空闲超时: ${timeoutMs / 1000}s 无数据，中断流`);
        onTimeout();
      }, timeoutMs);
    },
    clear() {
      clearTimers();
    },
    get aborted() { return _aborted; },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// OpenAI ToolCallAccumulator — 处理增量 JSON 拼接
// ═══════════════════════════════════════════════════════════════════════════

interface ToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

/**
 * 累积 OpenAI 流式 tool_calls delta
 *
 * OpenAI 将 tool_calls 分为多个 chunk:
 * - 第一个 chunk: { index, id, type, function: { name, arguments: '' } }
 * - 后续 chunk: { index, function: { arguments: '{"par' } }
 * - 直到 finish_reason: 'tool_calls'
 */
class ToolCallAccumulator {
  private calls = new Map<number, { id: string; name: string; args: string }>();

  /** 喂入一个 delta，返回是否有新的 tool_call 开始 */
  feed(delta: ToolCallDelta): { started: boolean; index: number; id: string; name: string } | null {
    const existing = this.calls.get(delta.index);

    if (!existing) {
      // 新 tool_call 开始
      const entry = {
        id: delta.id ?? '',
        name: delta.function?.name ?? '',
        args: delta.function?.arguments ?? '',
      };
      this.calls.set(delta.index, entry);
      return { started: true, index: delta.index, id: entry.id, name: entry.name };
    }

    // 后续 delta: 累积
    if (delta.id) existing.id = delta.id;
    if (delta.function?.name) existing.name += delta.function.name;
    if (delta.function?.arguments) existing.args += delta.function.arguments;
    return null;
  }

  /** flush 所有累积的 tool_calls，解析 JSON 参数 */
  flush(): Array<{ id: string; name: string; input: Record<string, unknown> }> {
    const results = [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([_, c]) => ({
        id: c.id,
        name: c.name,
        input: safeParseJSON<Record<string, unknown>>(c.args) ?? {},
      }));
    this.calls.clear();
    return results;
  }

  /** 获取指定 index 的当前累积状态 */
  get(index: number): { id: string; name: string; args: string } | undefined {
    return this.calls.get(index);
  }

  get size(): number {
    return this.calls.size;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Request Builders
// ═══════════════════════════════════════════════════════════════════════════

interface RequestSpec {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/**
 * 构建 Anthropic Messages API 请求
 *
 * POST {baseUrl}/messages
 * Headers: x-api-key, anthropic-version
 * Body: { model, system, messages, tools, max_tokens, stream: true }
 */
function buildAnthropicRequest(config: StreamConfig): RequestSpec {
  // baseUrl 自动补 /v1 (复用 llm-client.ts 的逻辑)
  const anthropicUrl = /\/v1\/?$/.test(config.baseUrl)
    ? config.baseUrl.replace(/\/+$/, '')
    : `${config.baseUrl.replace(/\/+$/, '')}/v1`;

  const headers = buildAuthHeaders(config.apiKey, 'anthropic', config.baseUrl);

  // 构建 messages (Anthropic 格式)
  const messages = config.messages.map(msg => ({
    role: msg.role,
    content: serializeContentForAnthropic(msg.content),
  }));

  // 构建 tools
  const tools = config.tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));

  const body: Record<string, unknown> = {
    model: config.modelId,
    system: config.systemPrompt,
    messages,
    max_tokens: config.maxTokens,
    stream: true,
  };

  if (tools.length > 0) {
    body.tools = tools;
  }

  // Extended thinking
  if (config.thinking) {
    body.thinking = {
      type: 'enabled',
      budget_tokens: Math.max(config.maxTokens - 1, 1024),
    };
  }

  return { url: `${anthropicUrl}/messages`, headers, body };
}

/**
 * 构建 OpenAI Chat Completions 请求
 *
 * POST {baseUrl}/chat/completions
 * Headers: Authorization: Bearer {apiKey}
 * Body: { model, messages, tools, max_tokens, stream: true }
 */
function buildOpenAIRequest(config: StreamConfig): RequestSpec {
  const headers = buildAuthHeaders(config.apiKey, 'openai', config.baseUrl);

  // 构建 messages (OpenAI 格式: system + user/assistant + tool)
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: config.systemPrompt },
  ];

  for (const msg of config.messages) {
    const serialized = serializeMessageForOpenAI(msg);
    messages.push(...serialized);
  }

  // 构建 tools (OpenAI function calling 格式)
  const tools = config.tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));

  const body: Record<string, unknown> = {
    model: config.modelId,
    messages,
    max_tokens: config.maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (tools.length > 0) {
    body.tools = tools;
  }

  return { url: `${config.baseUrl}/chat/completions`, headers, body };
}

// ═══════════════════════════════════════════════════════════════════════════
// Message Serialization
// ═══════════════════════════════════════════════════════════════════════════

/** Anthropic content blocks 序列化 */
function serializeContentForAnthropic(
  blocks: readonly ContentBlock[],
): Array<Record<string, unknown>> {
  return blocks.map(block => {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };
      case 'tool_use':
        return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
      case 'tool_result':
        return { type: 'tool_result', tool_use_id: block.tool_use_id, content: block.content, is_error: block.is_error };
      case 'thinking':
        return { type: 'thinking', thinking: block.thinking };
      case 'image':
        return { type: 'image', source: block.source };
      default:
        return { type: 'text', text: '' };
    }
  });
}

/** OpenAI message 序列化 — 将 KernelMessage 转为 OpenAI messages 数组 */
function serializeMessageForOpenAI(
  msg: KernelMessage,
): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];

  // tool_result blocks → 独立的 role: 'tool' messages
  const toolResults = msg.content.filter(b => b.type === 'tool_result');
  const nonToolResults = msg.content.filter(b => b.type !== 'tool_result');

  if (nonToolResults.length > 0) {
    if (msg.role === 'assistant') {
      // assistant message: text + tool_calls
      const textParts = nonToolResults.filter(b => b.type === 'text');
      const toolUses = nonToolResults.filter(b => b.type === 'tool_use') as ToolUseBlock[];
      const content = textParts.map(b => (b as { text: string }).text).join('');

      const assistantMsg: Record<string, unknown> = { role: 'assistant' };
      if (content) assistantMsg.content = content;
      if (toolUses.length > 0) {
        assistantMsg.tool_calls = toolUses.map(t => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: JSON.stringify(t.input) },
        }));
      }
      results.push(assistantMsg);
    } else {
      // user message: text content
      const text = nonToolResults
        .filter(b => b.type === 'text')
        .map(b => (b as { text: string }).text)
        .join('');
      if (text) {
        results.push({ role: 'user', content: text });
      }
    }
  }

  // tool_result → role: 'tool' messages
  for (const block of toolResults) {
    if (block.type === 'tool_result') {
      results.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: block.content,
      });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// Anthropic Stream Processing
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 处理 Anthropic SSE 流 → 归一化 StreamEvent
 *
 * 事件序列:
 * message_start → content_block_start → content_block_delta(多次)
 * → content_block_stop → message_delta → message_stop
 */
async function* processAnthropicStream(
  body: ReadableStream<Uint8Array>,
  watchdog: IdleWatchdog,
): AsyncGenerator<StreamEvent> {
  // 累积中的 content blocks (按 index)
  const contentBlocks = new Map<number, { type: string; id?: string; name?: string; input: string; text: string; thinking: string }>();

  watchdog.reset();

  for await (const raw of parseSSE(body)) {
    watchdog.reset();

    const data = safeParseJSON<Record<string, unknown>>(raw.data);
    if (!data) continue;

    const eventType = (data.type as string) ?? raw.event;

    switch (eventType) {
      case 'message_start': {
        // 提取初始 usage
        const message = data.message as Record<string, unknown> | undefined;
        const usage = message?.usage as Record<string, number> | undefined;
        if (usage) {
          yield {
            type: 'usage',
            usage: {
              inputTokens: usage.input_tokens ?? 0,
              outputTokens: usage.output_tokens ?? 0,
              cacheReadTokens: usage.cache_read_input_tokens,
              cacheWriteTokens: usage.cache_creation_input_tokens,
            },
          };
        }
        break;
      }

      case 'content_block_start': {
        const index = data.index as number;
        const block = data.content_block as Record<string, unknown>;
        const blockType = block?.type as string;

        contentBlocks.set(index, {
          type: blockType,
          id: block?.id as string | undefined,
          name: block?.name as string | undefined,
          input: '',
          text: '',
          thinking: '',
        });

        if (blockType === 'tool_use') {
          yield { type: 'tool_use_start', id: block.id as string, name: block.name as string };
        }
        break;
      }

      case 'content_block_delta': {
        const index = data.index as number;
        const delta = data.delta as Record<string, unknown>;
        const deltaType = delta?.type as string;
        const block = contentBlocks.get(index);
        if (!block) break;

        switch (deltaType) {
          case 'text_delta': {
            const text = delta.text as string;
            block.text += text;
            yield { type: 'text_delta', delta: text };
            break;
          }
          case 'input_json_delta': {
            const partialJson = delta.partial_json as string;
            block.input += partialJson;
            yield { type: 'tool_use_delta', id: block.id ?? '', delta: partialJson };
            break;
          }
          case 'thinking_delta': {
            const thinking = delta.thinking as string;
            block.thinking += thinking;
            yield { type: 'thinking_delta', delta: thinking };
            break;
          }
        }
        break;
      }

      case 'content_block_stop': {
        const index = data.index as number;
        const block = contentBlocks.get(index);
        if (!block) break;

        if (block.type === 'tool_use') {
          // 解析累积的 JSON input
          const input = safeParseJSON<Record<string, unknown>>(block.input) ?? {};
          yield {
            type: 'tool_use_end',
            id: block.id ?? '',
            name: block.name ?? '',
            input,
          };
        }

        contentBlocks.delete(index);
        break;
      }

      case 'message_delta': {
        const delta = data.delta as Record<string, unknown> | undefined;
        const usage = data.usage as Record<string, number> | undefined;

        if (usage) {
          yield {
            type: 'usage',
            usage: {
              inputTokens: usage.input_tokens ?? 0,
              outputTokens: usage.output_tokens ?? 0,
              cacheReadTokens: usage.cache_read_input_tokens,
              cacheWriteTokens: usage.cache_creation_input_tokens,
            },
          };
        }

        if (delta?.stop_reason) {
          yield { type: 'done', stopReason: delta.stop_reason as string };
        }
        break;
      }

      case 'message_stop': {
        // 流正常结束
        break;
      }

      case 'error': {
        const error = data.error as Record<string, unknown> | undefined;
        yield {
          type: 'error',
          message: (error?.message as string) ?? 'Unknown Anthropic error',
          status: undefined,
        };
        break;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OpenAI Stream Processing
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 处理 OpenAI SSE 流 → 归一化 StreamEvent
 *
 * OpenAI 格式:
 * data: { choices: [{ delta: { content, tool_calls }, finish_reason }], usage? }
 */
async function* processOpenAIStream(
  body: ReadableStream<Uint8Array>,
  watchdog: IdleWatchdog,
): AsyncGenerator<StreamEvent> {
  const accumulator = new ToolCallAccumulator();

  watchdog.reset();

  for await (const raw of parseSSE(body)) {
    watchdog.reset();

    const data = safeParseJSON<Record<string, unknown>>(raw.data);
    if (!data) continue;

    // Usage (stream_options: { include_usage: true })
    const usage = data.usage as Record<string, number> | undefined;
    if (usage) {
      yield {
        type: 'usage',
        usage: {
          inputTokens: usage.prompt_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? 0,
          cacheReadTokens: (usage as Record<string, unknown>).prompt_tokens_details
            ? ((usage as Record<string, unknown>).prompt_tokens_details as Record<string, number>)?.cached_tokens
            : undefined,
        },
      };
    }

    const choices = data.choices as Array<Record<string, unknown>> | undefined;
    if (!choices || choices.length === 0) continue;

    const choice = choices[0]!;
    const delta = choice.delta as Record<string, unknown> | undefined;
    const finishReason = choice.finish_reason as string | null;

    if (delta) {
      // Text content
      const content = delta.content as string | undefined;
      if (content) {
        yield { type: 'text_delta', delta: content };
      }

      // Reasoning content (部分 OpenAI 兼容模型支持)
      const reasoningContent = delta.reasoning_content as string | undefined;
      if (reasoningContent) {
        yield { type: 'thinking_delta', delta: reasoningContent };
      }

      // Tool calls delta
      const toolCalls = delta.tool_calls as ToolCallDelta[] | undefined;
      if (toolCalls) {
        for (const tc of toolCalls) {
          const started = accumulator.feed(tc);
          if (started) {
            yield { type: 'tool_use_start', id: started.id, name: started.name };
          }
          // 累积中的 arguments delta
          if (tc.function?.arguments) {
            const entry = accumulator.get(tc.index);
            if (entry) {
              yield { type: 'tool_use_delta', id: entry.id, delta: tc.function.arguments };
            }
          }
        }
      }
    }

    // finish_reason
    if (finishReason) {
      // flush 所有累积的 tool calls
      if (finishReason === 'tool_calls' || finishReason === 'stop') {
        if (accumulator.size > 0) {
          const tools = accumulator.flush();
          for (const tool of tools) {
            yield { type: 'tool_use_end', id: tool.id, name: tool.name, input: tool.input };
          }
        }
      }
      yield { type: 'done', stopReason: finishReason };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Entry — streamLLM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 统一双协议流式 LLM 调用
 *
 * @param config - 流式调用配置
 * @yields StreamEvent - 归一化的流式事件
 *
 * 特性:
 * - 90 秒空闲看门狗 (参考 Claude Code)
 * - HTTP 错误码直接作为 ApiError 抛出
 * - 看门狗超时抛出 IdleTimeoutError
 */
export async function* streamLLM(config: StreamConfig): AsyncGenerator<StreamEvent> {
  const { protocol } = config;

  // 构建请求
  const spec = protocol === 'anthropic-messages'
    ? buildAnthropicRequest(config)
    : buildOpenAIRequest(config);

  log.info(`流式调用: ${protocol} ${spec.url} model=${config.modelId}`);

  // 看门狗
  const abortController = new AbortController();
  const watchdog = createIdleWatchdog(STREAM_IDLE_TIMEOUT_MS, () => {
    abortController.abort('idle_timeout');
  });

  // 合并外部 signal 和看门狗 signal
  const mergedSignal = config.signal
    ? AbortSignal.any([config.signal, abortController.signal])
    : abortController.signal;

  try {
    const response = await fetch(spec.url, {
      method: 'POST',
      headers: spec.headers,
      body: JSON.stringify(spec.body),
      signal: mergedSignal,
    });

    // HTTP 错误
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      watchdog.clear();

      // 如果 body 中有结构化错误信息，提取
      const parsed = safeParseJSON<Record<string, unknown>>(errText);
      const errorMessage = ((parsed?.error as Record<string, unknown>)?.message as string)
        ?? (errText.slice(0, 500) || `HTTP ${response.status}`);

      throw new ApiError(errorMessage, response.status, errText);
    }

    if (!response.body) {
      watchdog.clear();
      throw new ApiError('响应无 body', undefined);
    }

    // 解析 SSE 流 → 归一化 StreamEvent
    if (protocol === 'anthropic-messages') {
      yield* processAnthropicStream(response.body, watchdog);
    } else {
      yield* processOpenAIStream(response.body, watchdog);
    }
  } catch (err) {
    // 看门狗超时
    if (watchdog.aborted) {
      throw new IdleTimeoutError(STREAM_IDLE_TIMEOUT_MS);
    }

    // 外部中止
    if (config.signal?.aborted) {
      throw err;
    }

    // 其他错误直接抛出
    throw err;
  } finally {
    watchdog.clear();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Exports for testing
// ═══════════════════════════════════════════════════════════════════════════

/** @internal 仅供测试使用 */
export const _testing = {
  ToolCallAccumulator,
  buildAnthropicRequest,
  buildOpenAIRequest,
  processAnthropicStream,
  processOpenAIStream,
  serializeContentForAnthropic,
  serializeMessageForOpenAI,
  createIdleWatchdog,
  STREAM_IDLE_TIMEOUT_MS,
  NONSTREAMING_FALLBACK_TIMEOUT_MS,
};
