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
  LoopState,
} from './types.js';
import { ApiError } from './types.js';
import { streamLLM } from './stream-client.js';
import { StreamingToolExecutor } from './streaming-tool-executor.js';
import { maybeCompress, maybeCompressPhased, contextCollapseDrain, createCollapseState, truncateHeadForPTLRetry } from './context-compactor.js';
import type { CollapseState } from './context-compactor.js';
import { Feature } from '../../infrastructure/feature.js';
import { classifyApiError, isRecoverableInLoop, isFallbackTrigger, isAbortLike, MAX_OUTPUT_RECOVERY_MESSAGE, MAX_OUTPUT_RECOVERY_LIMIT } from './error-recovery.js';
import { PromptCacheMonitor } from './prompt-cache-monitor.js';
import { buildMessageLookups, mapToToolCallRecords as mapToolCalls, createToolUseSummaryMessage, stripThinkingBlocks, ensureToolResultPairing } from './message-utils.js';
import { maybeGraceCall } from './grace-call.js';
import type { ToolCallRecord, RuntimeEvent } from '../types.js';
import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('query-loop');

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** 413 压缩重试最大次数 — 增加到 3 以支持 PTL 紧急降级作为第三阶段 */
const MAX_OVERFLOW_RETRIES = 3;

/** P1-1: max_output_tokens 升级目标 (64k) */
const ESCALATED_MAX_TOKENS = 64_000;

/**
 * 默认 max_output_tokens 上限 (8K)
 *
 * 参考 Claude Code: CAPPED_DEFAULT_MAX_TOKENS = 8_000
 * P99 输出仅 ~5K tokens，8K 覆盖 >99% 的请求。
 * 被截断时自动升级到 ESCALATED_MAX_TOKENS (64K)。
 * 更低的 slot 预留 → 更多并发容量 → 更少排队延迟。
 *
 * EvoClaw 通过 model-fetcher.ts maxTokens 默认 8192 实现。
 */
const _CAPPED_DEFAULT_MAX_TOKENS = 8_000; // eslint-disable-line @typescript-eslint/no-unused-vars

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
// Helper: Shadow Microcompact — 延迟截断
// ═══════════════════════════════════════════════════════════════════════════

/** Microcompact 截断阈值 (5KB) — 与 context-compactor.ts 保持一致 */
const MC_TRUNCATE_THRESHOLD = 5 * 1024;
/** 头部保留比例 */
const MC_HEAD_RATIO = 0.7;

/**
 * 对标记了 microcompacted 的消息创建截断副本
 *
 * Shadow Microcompact: 原始消息 content 不变（保护 Prompt Cache），
 * 仅在发送给 API 时创建截断版本。
 */
function applyDeferredTruncation(msg: KernelMessage): KernelMessage {
  const newContent = msg.content.map(block => {
    if (block.type !== 'tool_result') return block;
    if (block.content.length <= MC_TRUNCATE_THRESHOLD) return block;

    const headBudget = Math.floor(MC_TRUNCATE_THRESHOLD * MC_HEAD_RATIO);
    const tailBudget = MC_TRUNCATE_THRESHOLD - headBudget;
    const head = block.content.slice(0, headBudget);
    const tail = block.content.slice(-tailBudget);
    const omitted = block.content.length - headBudget - tailBudget;

    return {
      ...block,
      content: `${head}\n\n... [省略 ${omitted} 字符] ...\n\n${tail}`,
    };
  });

  return { ...msg, content: newContent, microcompacted: undefined };
}

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
  /** 模型覆盖（模型回退时使用 fallbackModel 的配置） */
  modelOverride?: { modelId: string; protocol?: string; baseUrl?: string; apiKey?: string },
): Promise<RoundResult> {
  const blocks: ContentBlock[] = [];
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let stopReason = 'end_turn';

  // 当前累积中的 tool_use (用于跨事件追踪)
  const pendingToolUses = new Map<string, { id: string; name: string }>();

  // 模型回退时覆盖连接参数
  const effectiveModelId = modelOverride?.modelId ?? config.modelId;
  const effectiveProtocol = (modelOverride?.protocol ?? config.protocol) as import('./types.js').ApiProtocol;
  const effectiveBaseUrl = modelOverride?.baseUrl ?? config.baseUrl;
  const effectiveApiKey = modelOverride?.apiKey ?? config.apiKey;

  // Thinking 块跨轮次清理：如果 thinking 已禁用，从历史消息中剥离 thinking 块避免 API 错误
  // Shadow Microcompact: microcompacted 消息需要创建截断副本发送给 API
  const messagesForApi = messages.map(msg => {
    let result = msg;

    // Strip thinking blocks if disabled
    if (config.thinkingConfig.type === 'disabled') {
      result = stripThinkingBlocks(result);
    }

    // Shadow Microcompact: 对标记了 microcompacted 的消息创建截断副本
    if (result.microcompacted) {
      result = applyDeferredTruncation(result);
    }

    return result;
  });

  for await (const event of streamLLM({
    protocol: effectiveProtocol,
    baseUrl: effectiveBaseUrl,
    apiKey: effectiveApiKey,
    modelId: effectiveModelId,
    systemPrompt: config.systemPrompt,
    messages: messagesForApi,
    tools: config.tools,
    maxTokens: maxTokensOverride ?? config.maxTokens,
    thinkingConfig: config.thinkingConfig,
    signal: config.abortSignal,
    discoveredToolNames: config.discoveredToolNames,
  })) {
    switch (event.type) {
      case 'text_delta':
        await config.onEvent({ type: 'text_delta', delta: event.delta, timestamp: Date.now() });
        appendOrCreateTextBlock(blocks, event.delta);
        break;

      case 'thinking_delta':
        await config.onEvent({ type: 'thinking_delta', delta: event.delta, timestamp: Date.now() });
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

      case 'redacted_thinking':
        // 已编辑思考块 — 原样存入 content blocks，后续轮次回传给 API
        blocks.push({ type: 'redacted_thinking' as const, data: event.data });
        break;

      case 'tool_use_start':
        pendingToolUses.set(event.id, { id: event.id, name: event.name });
        await config.onEvent({ type: 'tool_start', toolName: event.name, toolArgs: {}, timestamp: Date.now() });
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
          await config.onEvent({ type: 'tool_start', toolName: event.name, toolArgs: event.input, isDestructive: true, timestamp: Date.now() });
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

      case 'metrics':
        await config.onEvent({
          type: 'stream_metrics',
          timestamp: Date.now(),
          streamMetrics: {
            stallCount: event.metrics.stallCount,
            totalStallMs: event.metrics.totalStallMs,
            eventCount: event.metrics.eventCount,
            totalDurationMs: event.metrics.totalDurationMs,
            ttfbMs: event.metrics.latency.headersReceivedAt && event.metrics.latency.requestSentAt
              ? event.metrics.latency.headersReceivedAt - event.metrics.latency.requestSentAt
              : undefined,
            firstChunkMs: event.metrics.latency.firstChunkAt && event.metrics.latency.requestSentAt
              ? event.metrics.latency.firstChunkAt - event.metrics.latency.requestSentAt
              : undefined,
            fallbackUsed: event.metrics.fallbackUsed,
            abortExitDelayMs: event.metrics.abortExitDelayMs,
            abortExitPath: event.metrics.abortExitPath,
          },
        });
        break;

      case 'latency':
        // 延迟检查点已包含在 metrics 事件中，无需单独转发
        break;
    }
  }

  return {
    assistantMessage: {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: blocks,
      usage,
      createdAt: Date.now(),
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
  // ─── 不可变状态快照（参考 Claude Code query.ts State 模式） ───
  let state: LoopState = {
    messages: [...config.messages],
    turnCount: 0,
    transition: null,
    overflowRetries: 0,
    maxOutputRecoveryCount: 0,
    effectiveMaxTokens: config.maxTokens,
    effectiveModelId: config.modelId,
  };

  let fullResponse = '';
  const allToolCalls: ToolCallRecord[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  let exitReason: ExitReason = 'completed';
  let fallbackActivated = false;
  let collapseState: CollapseState = createCollapseState();
  /** 缓存断点索引 — 最后一次 cacheWriteTokens > 0 时的消息数组长度 */
  let cacheBreakpointIndex = 0;
  const cacheMonitor = new PromptCacheMonitor();

  log.info(`queryLoop 开始: model=${state.effectiveModelId}, maxTurns=${config.maxTurns}, tools=${config.tools.length}`);

  const buildResult = (): QueryLoopResult => {
    config.persister?.finalize();
    return {
      fullResponse,
      toolCalls: allToolCalls,
      // 确保每个 tool_use 都有配对的 tool_result（中断时补占位符）
      messages: ensureToolResultPairing(state.messages),
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      exitReason,
      turnCount: state.turnCount,
      maxTurns: config.maxTurns,
      lastTransition: state.transition,
    };
  };

  /**
   * 预算耗尽退出前尝试发起一次 grace call（收尾摘要）。
   * 触发时机：maxTurns / max_tokens_exhausted / token_budget_exhausted 三处。
   * 失败/禁用/中止均吞错返回空字符串，不影响原退出语义。
   */
  const applyGraceCallAndBuild = async (reason: ExitReason): Promise<QueryLoopResult> => {
    const tail = await maybeGraceCall(config, state, reason);
    if (tail) fullResponse += tail;
    exitReason = reason;
    return buildResult();
  };

  while (true) {
    // ─── 1. 中止检查 ───
    if (config.abortSignal?.aborted) {
      exitReason = 'abort';
      log.info('外部中止');
      return buildResult();
    }
    if (state.turnCount >= config.maxTurns) {
      log.info(`达到最大 turn 数 (${config.maxTurns})，退出`);
      return applyGraceCallAndBuild('max_turns');
    }

    // ─── 2. 上下文压缩 (turn > 0 时检查) ───
    if (state.turnCount > 0) {
      try {
        if (Feature.REACTIVE_COMPACT) {
          // 渐进式压缩（按阈值分阶段，含主动 snip）
          const prevPhase = collapseState.phase;
          collapseState = await maybeCompressPhased(state.messages, config, collapseState);
          if (collapseState.phase !== 'normal' && collapseState.phase !== 'warning' && collapseState.phase !== prevPhase) {
            cacheMonitor.notifyCompaction();
          }
        } else {
          // 传统压缩（全有全无）
          const compressed = await maybeCompress(state.messages, config);
          if (compressed) cacheMonitor.notifyCompaction();
        }
      } catch (err) {
        log.warn(`压缩失败，继续: ${err instanceof Error ? err.message : err}`);
      }
    }

    // ─── 3. 流式 API 调用 + 流中工具预执行 ───
    await config.onEvent({ type: 'message_start', timestamp: Date.now() });

    const executor = new StreamingToolExecutor(config.tools, 8, config.abortSignal);

    // Cache Monitor: 记录调用前状态
    const systemPromptStr = typeof config.systemPrompt === 'string'
      ? config.systemPrompt
      : config.systemPrompt.map(b => b.text).join('\n');
    cacheMonitor.recordPreCallState({
      systemPrompt: systemPromptStr,
      tools: config.tools,
      modelId: state.effectiveModelId,
      thinkingEnabled: config.thinkingConfig.type !== 'disabled',
    });

    let roundResult: RoundResult;
    try {
      // 模型回退时传递 fallback 配置
      const modelOverride = fallbackActivated && config.fallbackModel
        ? { modelId: config.fallbackModel.modelId, protocol: config.fallbackModel.protocol, baseUrl: config.fallbackModel.baseUrl, apiKey: config.fallbackModel.apiKey }
        : undefined;
      roundResult = await streamOneRound(config, state.messages, executor, state.effectiveMaxTokens, modelOverride);
      state = { ...state, overflowRetries: 0 };
    } catch (err) {
      // 413 overflow → Context Collapse Drain (轻量) → 完整压缩 (重量)
      const classified = classifyApiError(err);
      if (isRecoverableInLoop(classified) && state.overflowRetries < MAX_OVERFLOW_RETRIES) {
        const nextOverflowRetries = state.overflowRetries + 1;
        executor.discard();

        // 第 1 次: 尝试轻量 Context Collapse Drain（零 API 成本）
        if (nextOverflowRetries === 1) {
          log.warn(`413 overflow, 尝试 Context Collapse Drain (${nextOverflowRetries}/${MAX_OVERFLOW_RETRIES})`);
          const collapsed = contextCollapseDrain(state.messages);
          if (collapsed) {
            cacheMonitor.notifyCompaction();
            state = { ...state, overflowRetries: nextOverflowRetries, transition: 'overflow_retry' };
            log.info(`transition: ${state.transition}`);
            continue;
          }
        }

        // 第 2 次或 collapse 无效: 完整压缩
        if (nextOverflowRetries <= 2) {
          log.warn(`413 overflow, 完整压缩重试 (${nextOverflowRetries}/${MAX_OVERFLOW_RETRIES})`);
          try {
            await maybeCompress(state.messages, config);
            cacheMonitor.notifyCompaction();
          } catch {
            throw err;
          }
          state = { ...state, overflowRetries: nextOverflowRetries, transition: 'overflow_retry' };
          log.info(`transition: ${state.transition}`);
          continue;
        }

        // 第 3 次: PTL 紧急降级 — 按轮次分组精确删除
        log.warn(`413 overflow, PTL 紧急降级 (${nextOverflowRetries}/${MAX_OVERFLOW_RETRIES})`);
        const truncated = truncateHeadForPTLRetry(state.messages);
        if (truncated) {
          state.messages.length = 0;
          state.messages.push(...truncated);
          cacheMonitor.notifyCompaction();
          state = { ...state, overflowRetries: nextOverflowRetries, transition: 'overflow_retry' };
          log.info(`transition: ${state.transition} (PTL 降级)`);
          continue;
        }
        throw err; // 无法进一步截断
      }

      if (isAbortLike(err)) {
        exitReason = 'abort';
        return buildResult();
      }

      // ─── 模型回退 (参考 Claude Code attemptWithFallback) ───
      if (config.fallbackModel && !fallbackActivated && isFallbackTrigger(classified)) {
        fallbackActivated = true;
        executor.discard();

        // Tombstone: 通知 UI 丢弃本轮已发送的 partial text_delta
        await config.onEvent({ type: 'tombstone', timestamp: Date.now() });

        state = { ...state, effectiveModelId: config.fallbackModel.modelId, transition: 'model_fallback' };
        log.warn(`模型回退: ${config.modelId} → ${config.fallbackModel.modelId}, 原因: ${classified.type}`);
        continue;
      }

      exitReason = 'error';
      throw err;
    }

    state.messages.push(roundResult.assistantMessage);
    config.persister?.persistTurn(state.turnCount, [roundResult.assistantMessage]);
    state = { ...state, turnCount: state.turnCount + 1 };
    totalInput += roundResult.usage.inputTokens;
    totalOutput += roundResult.usage.outputTokens;

    // Cache Monitor: 检测断裂 + 追踪缓存断点
    cacheMonitor.checkForBreak({
      cacheReadTokens: roundResult.usage.cacheReadTokens ?? 0,
      cacheWriteTokens: roundResult.usage.cacheWriteTokens ?? 0,
      systemPrompt: systemPromptStr,
      tools: config.tools,
      modelId: state.effectiveModelId,
      thinkingEnabled: config.thinkingConfig.type !== 'disabled',
    });
    // 追踪缓存断点（用于缓存感知微压缩）
    if ((roundResult.usage.cacheWriteTokens ?? 0) > 0) {
      cacheBreakpointIndex = state.messages.length;
      collapseState = { ...collapseState, cacheBreakpointIndex };
    }

    // ─── 4. 累积文本 ───
    for (const block of roundResult.assistantMessage.content) {
      if (block.type === 'text') fullResponse += block.text;
    }

    await config.onEvent({ type: 'message_end', timestamp: Date.now() });

    // ─── 5. 检查 tool_use → 收集结果或退出 ───
    const toolUseBlocks = roundResult.assistantMessage.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use',
    );

    if (toolUseBlocks.length === 0) {
      // ─── 5a. Stop Hook 检查 (参考 Claude Code query.ts stopHookResult) ───
      if (config.stopHook) {
        try {
          const hookResult = await config.stopHook(roundResult.assistantMessage, state.messages);
          if (hookResult.preventContinuation) {
            exitReason = 'stop_hook_prevented';
            log.info('Stop Hook 阻止继续');
            return buildResult();
          }
          if (hookResult.blockingErrors.length > 0) {
            // Hook 报告阻断性错误 → 注入错误信息，继续循环修复
            log.info(`Stop Hook 报告 ${hookResult.blockingErrors.length} 个阻断性错误，继续修复`);
            state.messages.push({
              id: crypto.randomUUID(),
              role: 'user',
              content: [{ type: 'text', text: `以下检查未通过，请修复:\n${hookResult.blockingErrors.join('\n')}` }],
              isMeta: true,
            });
            state = { ...state, transition: 'stop_hook_blocking' };
            log.info(`transition: ${state.transition}`);
            continue;
          }
        } catch (err) {
          log.warn(`Stop Hook 执行失败，忽略: ${err instanceof Error ? err.message : err}`);
        }
      }

      // ─── 5b. max_output_tokens 恢复 ───
      if (roundResult.stopReason === 'max_tokens' && state.maxOutputRecoveryCount < MAX_OUTPUT_RECOVERY_LIMIT) {
        const nextRecoveryCount = state.maxOutputRecoveryCount + 1;

        if (nextRecoveryCount === 1 && state.effectiveMaxTokens < ESCALATED_MAX_TOKENS) {
          state = { ...state, effectiveMaxTokens: ESCALATED_MAX_TOKENS, maxOutputRecoveryCount: nextRecoveryCount, transition: 'max_tokens_recovery' };
          log.info(`max_output_tokens 恢复: 升级到 ${ESCALATED_MAX_TOKENS} tokens (attempt ${nextRecoveryCount})`);
        } else {
          state = { ...state, maxOutputRecoveryCount: nextRecoveryCount, transition: 'max_tokens_recovery' };
          log.info(`max_output_tokens 恢复: 注入 Resume 消息 (attempt ${nextRecoveryCount})`);
        }

        state.messages.push({
          id: crypto.randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: MAX_OUTPUT_RECOVERY_MESSAGE }],
          isMeta: true,
        });
        log.info(`transition: ${state.transition}`);
        continue;
      }

      if (roundResult.stopReason === 'max_tokens') {
        log.info(`max_output_tokens 恢复次数用尽 (${MAX_OUTPUT_RECOVERY_LIMIT})`);
        return applyGraceCallAndBuild('max_tokens_exhausted');
      }

      // ─── 5c. Token Budget 连续执行 (参考 Claude Code TOKEN_BUDGET feature) ───
      if (config.tokenBudget) {
        const decision = config.tokenBudget(state.turnCount, totalInput, totalOutput);
        if (decision.action === 'continue' && decision.nudgeMessage) {
          log.info(`Token Budget 续行: ${decision.nudgeMessage.slice(0, 50)}...`);
          state.messages.push({
            id: crypto.randomUUID(),
            role: 'user',
            content: [{ type: 'text', text: decision.nudgeMessage }],
            isMeta: true,
          });
          state = { ...state, transition: 'token_budget_continue' };
          log.info(`transition: ${state.transition}`);
          continue;
        }
        if (decision.action === 'stop' && decision.stopReason === 'budget_exhausted') {
          log.info('Token Budget 耗尽');
          return applyGraceCallAndBuild('token_budget_exhausted');
        }
      }

      // 模型完成，无工具调用
      exitReason = 'completed';
      log.info(`模型完成 (turn ${state.turnCount})，无工具调用`);
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

    state.messages.push(toolResultMsg);
    config.persister?.persistTurn(state.turnCount, [toolResultMsg]);

    // ─── 6b. 工具调用摘要 (参考 Claude Code ToolUseSummaryMessage) ───
    // 生成 git-commit-subject 风格的简短摘要，用于上下文压缩和 UI 展示
    const toolNames = toolUseBlocks.map(b => b.name);
    const toolIds = toolUseBlocks.map(b => b.id);
    const hasErrors = toolResults.some(r => r.is_error);
    const summaryText = hasErrors
      ? `${toolNames.join(', ')} (${toolResults.length} 次调用, 有错误)`
      : `${toolNames.join(', ')} (${toolResults.length} 次调用)`;
    // 生成工具摘要并通过 onEvent 广播（可用于上下文压缩和 UI 展示）
    createToolUseSummaryMessage(summaryText, toolIds);
    // 先发送简单摘要（即时），然后异步用 LLM 生成更好的摘要
    await config.onEvent({ type: 'tool_end', toolName: summaryText, timestamp: Date.now() });
    if (config.toolSummaryGenerator) {
      const summaryTools = toolUseBlocks.map((b, i) => ({
        toolName: b.name,
        toolInput: b.input as Record<string, unknown>,
        toolResult: toolResults[i]?.content?.slice(0, 300),
        isError: toolResults[i]?.is_error,
      }));
      config.toolSummaryGenerator.generateAsync(summaryTools).then(async llmSummary => {
        if (llmSummary && llmSummary !== summaryText) {
          await config.onEvent({ type: 'tool_end', toolName: llmSummary, timestamp: Date.now() });
        }
      }).catch(() => { /* 非关键，忽略 */ });
    }

    // ─── 7. 附件收集 (参考 Claude Code 附件与延续阶段) ───
    if (config.attachmentCollector) {
      try {
        const attachment = await config.attachmentCollector(allToolCalls, state.messages);
        if (attachment) {
          state.messages.push({
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

    // ─── 8. 工具结果后渐进式压缩检查 ───
    // 大工具结果可能导致 token 突破阈值，提前压缩避免下轮 413
    if (Feature.REACTIVE_COMPACT) {
      try {
        collapseState = await maybeCompressPhased(state.messages, config, collapseState);
        if (collapseState.phase !== 'normal' && collapseState.phase !== 'warning') {
          cacheMonitor.notifyCompaction();
        }
      } catch {
        // 非关键，忽略
      }
    }

    const calledTools = toolUseBlocks.map(b => b.name).join(', ');
    log.info(`turn ${state.turnCount}: ${toolUseBlocks.length} 个工具调用完成 [${calledTools}]，继续`);
    state = { ...state, transition: 'tool_use' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AsyncIterableQueue — 有界背压队列
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 简单的 push/pull 异步队列
 *
 * - push 侧: 事件入队（同步，无阻塞）
 * - pull 侧: for-await 消费，队列空时等待
 * - done(): 标记生产者结束
 */
class AsyncIterableQueue<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private resolve: (() => void) | null = null;
  private finished = false;

  push(item: T): void {
    this.queue.push(item);
    this.resolve?.();
    this.resolve = null;
  }

  done(): void {
    this.finished = true;
    this.resolve?.();
    this.resolve = null;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.finished) return;
      await new Promise<void>(r => { this.resolve = r; });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// queryLoopGenerator — Async Generator 兼容层
// ═══════════════════════════════════════════════════════════════════════════

/**
 * queryLoop 的 async generator 包装
 *
 * 通过 AsyncIterableQueue 提供有界背压。
 * 不改变现有 queryLoop 实现，仅包装事件流。
 *
 * 用法:
 * ```
 * for await (const event of queryLoopGenerator(config)) {
 *   res.write(`data: ${JSON.stringify(event)}\n\n`);
 * }
 * ```
 */
export async function* queryLoopGenerator(
  config: Omit<QueryLoopConfig, 'onEvent'>,
): AsyncGenerator<RuntimeEvent, QueryLoopResult, undefined> {
  const queue = new AsyncIterableQueue<RuntimeEvent>();

  const resultPromise = queryLoop({
    ...config,
    onEvent: (event: RuntimeEvent) => queue.push(event),
  } as QueryLoopConfig).finally(() => queue.done());

  for await (const event of queue) {
    yield event;
  }

  return await resultPromise;
}
