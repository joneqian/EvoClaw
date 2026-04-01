/**
 * Agent 循环 — 参考 Claude Code query.ts 的 while(true) 架构
 *
 * 核心流程:
 * while(true) {
 *   1. 中止检查
 *   2. 上下文压缩 (三层)
 *   3. 流式 API 调用 + 流中工具预执行
 *   4. 累积文本 + 工具结果收集
 *   5. 有 tool_use? → 构建 tool result message → continue
 *      无 tool_use? → break (模型完成)
 * }
 *
 * 选择 async function + onEvent 回调 而非 async generator:
 * EvoClaw 的 embedded-runner-loop.ts 期望 runSingleAttempt() 返回 AttemptResult，
 * 不消费 generator。
 *
 * 参考 Claude Code:
 * - query.ts: queryLoop() while(true), needsFollowUp, state immutability
 * - StreamingToolExecutor 集成
 * - 413 恢复 + max_output_tokens 恢复
 *
 * 参考文档: docs/research/03-agentic-loop.md
 */

import crypto from 'node:crypto';
import type {
  KernelMessage,
  ContentBlock,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,
  TokenUsage,
  QueryLoopConfig,
  QueryLoopResult,
} from './types.js';
import { ApiError, AbortError } from './types.js';
import { streamLLM } from './stream-client.js';
import { StreamingToolExecutor } from './streaming-tool-executor.js';
import { maybeCompress } from './context-compactor.js';
import { classifyApiError, isRecoverableInLoop, isAbortLike } from './error-recovery.js';
import type { ToolCallRecord } from '../types.js';
import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('query-loop');

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** 413 压缩重试最大次数 */
const MAX_OVERFLOW_RETRIES = 2;

// ═══════════════════════════════════════════════════════════════════════════
// Helper: Content Block Accumulation
// ═══════════════════════════════════════════════════════════════════════════

function appendOrCreateTextBlock(blocks: ContentBlock[], delta: string): void {
  const last = blocks[blocks.length - 1];
  if (last && last.type === 'text') {
    (last as TextBlock).text += delta;
  } else {
    blocks.push({ type: 'text', text: delta });
  }
}

function appendOrCreateThinkingBlock(blocks: ContentBlock[], delta: string): void {
  const last = blocks[blocks.length - 1];
  if (last && last.type === 'thinking') {
    (last as ThinkingBlock).thinking += delta;
  } else {
    blocks.push({ type: 'thinking', thinking: delta });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper: Tool Result Message (双协议适配)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 构建 tool result message
 *
 * Anthropic: tool_result 放在 user message content 数组
 * OpenAI: tool_result 也放在 user message content 数组
 *         (在 buildOpenAIRequest 时展开为独立 role:'tool' messages)
 */
function buildToolResultMessage(results: ToolResultBlock[]): KernelMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: results,
  };
}

/** 将 ToolUseBlock + ToolResultBlock 映射为 ToolCallRecord */
function mapToToolCallRecords(
  toolUseBlocks: ToolUseBlock[],
  toolResults: ToolResultBlock[],
): ToolCallRecord[] {
  return toolUseBlocks.map(block => {
    const result = toolResults.find(r => r.tool_use_id === block.id);
    return {
      toolName: block.name,
      args: block.input,
      result: result?.content ?? '',
      isError: result?.is_error ?? false,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// streamOneRound — 单轮流式调用 + 流中工具预执行
// ═══════════════════════════════════════════════════════════════════════════

interface RoundResult {
  assistantMessage: KernelMessage;
  usage: TokenUsage;
}

/**
 * 执行一轮流式 API 调用
 *
 * 1. 调用 streamLLM() 获取归一化 StreamEvent
 * 2. 遍历事件，累积 content blocks
 * 3. 工具 block 完成时入队 StreamingToolExecutor
 * 4. 返回完整的 assistant message + usage
 */
async function streamOneRound(
  config: QueryLoopConfig,
  messages: readonly KernelMessage[],
  executor: StreamingToolExecutor,
): Promise<RoundResult> {
  const blocks: ContentBlock[] = [];
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  // 当前累积中的 tool_use (用于跨事件追踪)
  const pendingToolUses = new Map<string, { id: string; name: string }>();

  for await (const event of streamLLM({
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    modelId: config.modelId,
    systemPrompt: config.systemPrompt,
    messages,
    tools: config.tools,
    maxTokens: config.maxTokens,
    thinking: config.thinking,
    signal: config.abortSignal,
  })) {
    switch (event.type) {
      case 'text_delta':
        config.onEvent({ type: 'text_delta', delta: event.delta, timestamp: Date.now() });
        appendOrCreateTextBlock(blocks, event.delta);
        break;

      case 'thinking_delta':
        config.onEvent({ type: 'thinking_delta', delta: event.delta, timestamp: Date.now() });
        appendOrCreateThinkingBlock(blocks, event.delta);
        break;

      case 'tool_use_start':
        pendingToolUses.set(event.id, { id: event.id, name: event.name });
        config.onEvent({ type: 'tool_start', toolName: event.name, toolArgs: {}, timestamp: Date.now() });
        break;

      case 'tool_use_end': {
        const toolBlock: ToolUseBlock = {
          type: 'tool_use',
          id: event.id,
          name: event.name,
          input: event.input,
        };
        blocks.push(toolBlock);
        pendingToolUses.delete(event.id);

        // 入队 StreamingToolExecutor — 并发安全工具立即开始
        executor.enqueue(toolBlock);
        break;
      }

      case 'usage':
        usage = event.usage;
        break;

      case 'error':
        throw new ApiError(event.message, event.status);

      case 'done':
        // 流正常结束
        break;
    }
  }

  return {
    assistantMessage: {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: blocks,
      usage,
    },
    usage,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// queryLoop — Agent 主循环
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Agent 主循环
 *
 * 参考 Claude Code query.ts 的 while(true) + state 模式:
 * - 每轮: 压缩检查 → 流式调用 → 工具执行 → 继续/退出
 * - 413 错误在循环内恢复 (压缩重试)
 * - 其他错误抛出，由外层 embedded-runner-attempt.ts 捕获
 */
export async function queryLoop(config: QueryLoopConfig): Promise<QueryLoopResult> {
  const messages: KernelMessage[] = [...config.messages];
  let turnCount = 0;
  let fullResponse = '';
  const allToolCalls: ToolCallRecord[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  let overflowRetries = 0;

  log.info(`queryLoop 开始: model=${config.modelId}, maxTurns=${config.maxTurns}, tools=${config.tools.length}`);

  while (true) {
    // ─── 1. 中止检查 ───
    if (config.abortSignal?.aborted) {
      throw new AbortError('外部中止');
    }
    if (turnCount >= config.maxTurns) {
      log.info(`达到最大 turn 数 (${config.maxTurns})，退出`);
      break;
    }

    // ─── 2. 上下文压缩 (turn > 0 时检查) ───
    if (turnCount > 0) {
      try {
        const compressed = await maybeCompress(messages, config);
        if (compressed) {
          config.onEvent({ type: 'compaction_start', timestamp: Date.now() });
          config.onEvent({ type: 'compaction_end', timestamp: Date.now() });
        }
      } catch (err) {
        log.warn(`压缩失败，继续: ${err instanceof Error ? err.message : err}`);
      }
    }

    // ─── 3. 流式 API 调用 + 流中工具预执行 ───
    config.onEvent({ type: 'message_start', timestamp: Date.now() });

    const executor = new StreamingToolExecutor(config.tools);

    let roundResult: RoundResult;
    try {
      roundResult = await streamOneRound(config, messages, executor);
      overflowRetries = 0; // 成功后重置
    } catch (err) {
      // 413 overflow → 循环内压缩重试
      const classified = classifyApiError(err);
      if (isRecoverableInLoop(classified) && overflowRetries < MAX_OVERFLOW_RETRIES) {
        overflowRetries++;
        log.warn(`413 overflow, 压缩重试 (${overflowRetries}/${MAX_OVERFLOW_RETRIES})`);
        executor.discard();

        // 强制压缩
        try {
          await maybeCompress(messages, config);
        } catch {
          // 压缩也失败 → 抛出原始错误
          throw err;
        }
        continue; // 重试本轮
      }

      // 中止错误
      if (isAbortLike(err)) {
        throw err instanceof AbortError ? err : new AbortError();
      }

      // 其他错误 → 抛给外层
      throw err;
    }

    messages.push(roundResult.assistantMessage);
    turnCount++;
    totalInput += roundResult.usage.inputTokens;
    totalOutput += roundResult.usage.outputTokens;

    // ─── 4. 累积文本 ───
    for (const block of roundResult.assistantMessage.content) {
      if (block.type === 'text') fullResponse += block.text;
    }

    config.onEvent({ type: 'message_end', timestamp: Date.now() });

    // ─── 5. 检查 tool_use → 收集结果或退出 ───
    const toolUseBlocks = roundResult.assistantMessage.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use',
    );

    if (toolUseBlocks.length === 0) {
      // 模型完成，无工具调用
      log.info(`模型完成 (turn ${turnCount})，无工具调用`);
      break;
    }

    // 收集工具结果 (流中已预执行的直接获取)
    const toolResults = await executor.collectResults({
      onEvent: config.onEvent,
      signal: config.abortSignal,
    });

    allToolCalls.push(...mapToToolCallRecords(toolUseBlocks, toolResults));

    // ─── 6. 构建 tool result message → continue ───
    messages.push(buildToolResultMessage(toolResults));

    log.info(`turn ${turnCount}: ${toolUseBlocks.length} 个工具调用完成，继续`);
  }

  log.info(`queryLoop 结束: turns=${turnCount}, toolCalls=${allToolCalls.length}`);

  return {
    fullResponse,
    toolCalls: allToolCalls,
    messages,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
  };
}
