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
  ExitReason,
} from './types.js';
import { ApiError } from './types.js';
import { streamLLM } from './stream-client.js';
import { StreamingToolExecutor } from './streaming-tool-executor.js';
import { maybeCompress, contextCollapseDrain } from './context-compactor.js';
import { classifyApiError, isRecoverableInLoop, isAbortLike, MAX_OUTPUT_RECOVERY_MESSAGE, MAX_OUTPUT_RECOVERY_LIMIT } from './error-recovery.js';
import { PromptCacheMonitor } from './prompt-cache-monitor.js';
import { buildMessageLookups, mapToToolCallRecords as mapToolCalls, createToolUseSummaryMessage, stripThinkingBlocks, ensureToolResultPairing } from './message-utils.js';
import type { ToolCallRecord } from '../types.js';
import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('query-loop');

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** 413 压缩重试最大次数 */
const MAX_OVERFLOW_RETRIES = 2;

/** P1-1: max_output_tokens 升级目标 (64k) */
const ESCALATED_MAX_TOKENS = 64_000;

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

// mapToToolCallRecords 已移至 message-utils.ts（使用 MessageLookups O(1) 查找）

// ═══════════════════════════════════════════════════════════════════════════
// streamOneRound — 单轮流式调用 + 流中工具预执行
// ═══════════════════════════════════════════════════════════════════════════

interface RoundResult {
  assistantMessage: KernelMessage;
  usage: TokenUsage;
  stopReason: string;
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
  maxTokensOverride?: number,
): Promise<RoundResult> {
  const blocks: ContentBlock[] = [];
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let stopReason = 'end_turn';

  // 当前累积中的 tool_use (用于跨事件追踪)
  const pendingToolUses = new Map<string, { id: string; name: string }>();

  // Thinking 块跨轮次清理：如果 thinking 已禁用，从历史消息中剥离 thinking 块避免 API 错误
  const messagesForApi = config.thinkingConfig.type === 'disabled'
    ? messages.map(stripThinkingBlocks)
    : messages;

  for await (const event of streamLLM({
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    modelId: config.modelId,
    systemPrompt: config.systemPrompt,
    messages: messagesForApi,
    tools: config.tools,
    maxTokens: maxTokensOverride ?? config.maxTokens,
    thinkingConfig: config.thinkingConfig,
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

      case 'thinking_signature': {
        // 将 signature 附加到最后一个 thinking 块（Anthropic 要求后续轮次回传）
        const lastBlock = blocks[blocks.length - 1];
        if (lastBlock && lastBlock.type === 'thinking') {
          (lastBlock as import('./types.js').ThinkingBlock).signature = event.signature;
        }
        break;
      }

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

        // 检查工具是否不可逆，附带到事件供前端显示确认
        const matchedTool = config.tools.find(t => t.name === event.name);
        const destructive = matchedTool?.isDestructive?.(event.input) ?? false;
        if (destructive) {
          config.onEvent({ type: 'tool_start', toolName: event.name, toolArgs: event.input, isDestructive: true, timestamp: Date.now() });
        }

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
        stopReason = event.stopReason;
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
    stopReason,
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
  let maxOutputRecoveryCount = 0;
  let effectiveMaxTokens = config.maxTokens;
  let fullResponse = '';
  const allToolCalls: ToolCallRecord[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  let overflowRetries = 0;
  let exitReason: ExitReason = 'completed';
  const cacheMonitor = new PromptCacheMonitor();

  log.info(`queryLoop 开始: model=${config.modelId}, maxTurns=${config.maxTurns}, tools=${config.tools.length}`);

  const buildResult = (): QueryLoopResult => ({
    fullResponse,
    toolCalls: allToolCalls,
    // 确保每个 tool_use 都有配对的 tool_result（中断时补占位符）
    messages: ensureToolResultPairing(messages),
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    exitReason,
    turnCount,
  });

  while (true) {
    // ─── 1. 中止检查 ───
    if (config.abortSignal?.aborted) {
      exitReason = 'abort';
      log.info('外部中止');
      return buildResult();
    }
    if (turnCount >= config.maxTurns) {
      exitReason = 'max_turns';
      log.info(`达到最大 turn 数 (${config.maxTurns})，退出`);
      return buildResult();
    }

    // ─── 2. 上下文压缩 (turn > 0 时检查) ───
    if (turnCount > 0) {
      try {
        // 压缩边界事件由 context-compactor 内部发射（每层独立发射 start/end）
        const compressed = await maybeCompress(messages, config);
        if (compressed) cacheMonitor.notifyCompaction();
      } catch (err) {
        log.warn(`压缩失败，继续: ${err instanceof Error ? err.message : err}`);
      }
    }

    // ─── 3. 流式 API 调用 + 流中工具预执行 ───
    config.onEvent({ type: 'message_start', timestamp: Date.now() });

    const executor = new StreamingToolExecutor(config.tools);

    // Cache Monitor: 记录调用前状态
    const systemPromptStr = typeof config.systemPrompt === 'string'
      ? config.systemPrompt
      : config.systemPrompt.map(b => b.text).join('\n');
    cacheMonitor.recordPreCallState({
      systemPrompt: systemPromptStr,
      tools: config.tools,
      modelId: config.modelId,
      thinkingEnabled: config.thinkingConfig.type !== 'disabled',
    });

    let roundResult: RoundResult;
    try {
      roundResult = await streamOneRound(config, messages, executor, effectiveMaxTokens);
      overflowRetries = 0;
    } catch (err) {
      // 413 overflow → Context Collapse Drain (轻量) → 完整压缩 (重量)
      const classified = classifyApiError(err);
      if (isRecoverableInLoop(classified) && overflowRetries < MAX_OVERFLOW_RETRIES) {
        overflowRetries++;
        executor.discard();

        // 第 1 次: 尝试轻量 Context Collapse Drain（零 API 成本）
        if (overflowRetries === 1) {
          log.warn(`413 overflow, 尝试 Context Collapse Drain (${overflowRetries}/${MAX_OVERFLOW_RETRIES})`);
          const collapsed = contextCollapseDrain(messages);
          if (collapsed) {
            cacheMonitor.notifyCompaction();
            continue;
          }
        }

        // 第 2 次或 collapse 无效: 完整压缩
        log.warn(`413 overflow, 完整压缩重试 (${overflowRetries}/${MAX_OVERFLOW_RETRIES})`);
        try {
          await maybeCompress(messages, config);
          cacheMonitor.notifyCompaction();
        } catch {
          throw err;
        }
        continue; // transition: overflow_retry
      }

      if (isAbortLike(err)) {
        exitReason = 'abort';
        return buildResult();
      }

      exitReason = 'error';
      throw err;
    }

    messages.push(roundResult.assistantMessage);
    turnCount++;
    totalInput += roundResult.usage.inputTokens;
    totalOutput += roundResult.usage.outputTokens;

    // Cache Monitor: 检测断裂
    cacheMonitor.checkForBreak({
      cacheReadTokens: roundResult.usage.cacheReadTokens ?? 0,
      cacheWriteTokens: roundResult.usage.cacheWriteTokens ?? 0,
      systemPrompt: systemPromptStr,
      tools: config.tools,
      modelId: config.modelId,
      thinkingEnabled: config.thinkingConfig.type !== 'disabled',
    });

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
      // ─── 5a. Stop Hook 检查 (参考 Claude Code query.ts stopHookResult) ───
      if (config.stopHook) {
        try {
          const hookResult = await config.stopHook(roundResult.assistantMessage, messages);
          if (hookResult.preventContinuation) {
            exitReason = 'stop_hook_prevented';
            log.info('Stop Hook 阻止继续');
            return buildResult();
          }
          if (hookResult.blockingErrors.length > 0) {
            // Hook 报告阻断性错误 → 注入错误信息，继续循环修复
            log.info(`Stop Hook 报告 ${hookResult.blockingErrors.length} 个阻断性错误，继续修复`);
            messages.push({
              id: crypto.randomUUID(),
              role: 'user',
              content: [{ type: 'text', text: `以下检查未通过，请修复:\n${hookResult.blockingErrors.join('\n')}` }],
              isMeta: true,
            });
            continue; // transition: stop_hook_blocking
          }
        } catch (err) {
          log.warn(`Stop Hook 执行失败，忽略: ${err instanceof Error ? err.message : err}`);
        }
      }

      // ─── 5b. max_output_tokens 恢复 ───
      if (roundResult.stopReason === 'max_tokens' && maxOutputRecoveryCount < MAX_OUTPUT_RECOVERY_LIMIT) {
        maxOutputRecoveryCount++;

        if (maxOutputRecoveryCount === 1 && effectiveMaxTokens < ESCALATED_MAX_TOKENS) {
          effectiveMaxTokens = ESCALATED_MAX_TOKENS;
          log.info(`max_output_tokens 恢复: 升级到 ${ESCALATED_MAX_TOKENS} tokens (attempt ${maxOutputRecoveryCount})`);
        } else {
          log.info(`max_output_tokens 恢复: 注入 Resume 消息 (attempt ${maxOutputRecoveryCount})`);
        }

        messages.push({
          id: crypto.randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: MAX_OUTPUT_RECOVERY_MESSAGE }],
          isMeta: true,
        });
        continue; // transition: max_tokens_recovery
      }

      if (roundResult.stopReason === 'max_tokens') {
        exitReason = 'max_tokens_exhausted';
        log.info(`max_output_tokens 恢复次数用尽 (${MAX_OUTPUT_RECOVERY_LIMIT})`);
        return buildResult();
      }

      // ─── 5c. Token Budget 连续执行 (参考 Claude Code TOKEN_BUDGET feature) ───
      if (config.tokenBudget) {
        const decision = config.tokenBudget(turnCount, totalInput, totalOutput);
        if (decision.action === 'continue' && decision.nudgeMessage) {
          log.info(`Token Budget 续行: ${decision.nudgeMessage.slice(0, 50)}...`);
          messages.push({
            id: crypto.randomUUID(),
            role: 'user',
            content: [{ type: 'text', text: decision.nudgeMessage }],
            isMeta: true,
          });
          continue; // transition: token_budget_continue
        }
        if (decision.action === 'stop' && decision.stopReason === 'budget_exhausted') {
          exitReason = 'token_budget_exhausted';
          log.info('Token Budget 耗尽');
          return buildResult();
        }
      }

      // 模型完成，无工具调用
      exitReason = 'completed';
      log.info(`模型完成 (turn ${turnCount})，无工具调用`);
      return buildResult();
    }

    // ─── 6. 收集工具结果 ───
    const toolResults = await executor.collectResults({
      onEvent: config.onEvent,
      signal: config.abortSignal,
    });

    const toolResultMsg = buildToolResultMessage(toolResults);
    const lookups = buildMessageLookups([roundResult.assistantMessage, toolResultMsg]);
    allToolCalls.push(...mapToolCalls(toolUseBlocks, lookups));

    messages.push(toolResultMsg);

    // ─── 6b. 工具调用摘要 (参考 Claude Code ToolUseSummaryMessage) ───
    // 生成 git-commit-subject 风格的简短摘要，用于上下文压缩和 UI 展示
    const toolNames = toolUseBlocks.map(b => b.name);
    const toolIds = toolUseBlocks.map(b => b.id);
    const hasErrors = toolResults.some(r => r.is_error);
    const summaryText = hasErrors
      ? `${toolNames.join(', ')} (${toolResults.length} 次调用, 有错误)`
      : `${toolNames.join(', ')} (${toolResults.length} 次调用)`;
    // 生成工具摘要并通过 onEvent 广播（可用于上下文压缩和 UI 展示）
    createToolUseSummaryMessage(summaryText, toolIds); // 保留创建以便未来持久化
    config.onEvent({ type: 'tool_end', toolName: summaryText, timestamp: Date.now() });

    // ─── 7. 附件收集 (参考 Claude Code 附件与延续阶段) ───
    if (config.attachmentCollector) {
      try {
        const attachment = await config.attachmentCollector(allToolCalls, messages);
        if (attachment) {
          messages.push({
            id: crypto.randomUUID(),
            role: 'user',
            content: [{ type: 'text', text: attachment }],
            isMeta: true,
          });
          log.info('附件已注入下一轮上下文');
        }
      } catch (err) {
        log.warn(`附件收集失败，忽略: ${err instanceof Error ? err.message : err}`);
      }
    }

    const calledTools = toolUseBlocks.map(b => b.name).join(', ');
    log.info(`turn ${turnCount}: ${toolUseBlocks.length} 个工具调用完成 [${calledTools}]，继续`);
    // transition: tool_use → continue
  }
}
