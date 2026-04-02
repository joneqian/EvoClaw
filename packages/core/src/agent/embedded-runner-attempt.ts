/**
 * 单次执行模块 — 自研 Agent Kernel 版本
 *
 * 替代原 PI 框架 (pi-ai + pi-agent-core + pi-coding-agent)，
 * 使用 kernel/query-loop.ts 实现 ReAct 循环。
 *
 * 职责:
 * 1. 从 AttemptParams 构建 QueryLoopConfig
 * 2. 调用 queryLoop() 执行 Agent 循环
 * 3. Memory Flush (token 使用率 ≥ 85%)
 * 4. 返回结构化 AttemptResult
 *
 * 不做重试 (重试由 embedded-runner-loop.ts 负责)
 */

import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { ThinkLevel } from '@evoclaw/shared';
import type { AgentRunConfig, AttemptResult, ProviderConfig, ToolCallRecord, MessageSnapshot, RuntimeEvent } from './types.js';
import type { ThinkingConfig } from './kernel/types.js';
import { lookupModelDefinition } from '../provider/extensions/index.js';
import { ToolSafetyGuard } from './tool-safety.js';
import { shouldTriggerFlush, buildMemoryFlushPrompt, createFlushPermissionInterceptor } from './memory-flush.js';
import { buildSystemPrompt } from './embedded-runner-prompt.js';
import { classifyError, isAbortError } from './embedded-runner-errors.js';
import { createSmartTimeout } from './embedded-runner-timeout.js';
import { queryLoop } from './kernel/query-loop.js';
import { buildKernelTools } from './kernel/tool-adapter.js';
import { resetCompactorState } from './kernel/context-compactor.js';
import type { QueryLoopConfig, KernelMessage, ApiProtocol } from './kernel/types.js';
import { AbortError } from './kernel/types.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('embedded-runner-attempt');

type EventCallback = (event: RuntimeEvent) => void;

/** 总超时 (与 Lane Queue 默认超时对齐) */
const ATTEMPT_TIMEOUT_MS = 600_000; // 10 分钟

/** 单次执行参数 */
export interface AttemptParams {
  config: AgentRunConfig;
  /** 当前 provider 配置（failover 时由外层循环切换） */
  providerOverride?: ProviderConfig;
  /** Thinking 级别（渐进降级: high → medium → low → off） */
  thinkLevel: ThinkLevel;
  /** 外部消息历史（failover 时由外层循环传入快照） */
  messagesOverride?: MessageSnapshot[];
  /** 用户消息 */
  message: string;
  /** 事件回调 */
  onEvent: EventCallback;
  /** 外部 abort signal */
  abortSignal?: AbortSignal;
}

// ─── Protocol Normalization ───

/** 将 AgentRunConfig 的 apiProtocol 归一化为 kernel 支持的协议 */
function normalizeProtocol(protocol: string | undefined): ApiProtocol {
  switch (protocol) {
    case 'anthropic':
    case 'anthropic-messages':
      return 'anthropic-messages';
    case 'openai-completions':
    case 'openai-responses':
    default:
      return 'openai-completions';
  }
}

// ─── Message Conversion ───

/** MessageSnapshot → KernelMessage */
function snapshotToKernelMessage(snapshot: MessageSnapshot): KernelMessage {
  return {
    id: crypto.randomUUID(),
    role: snapshot.role as 'user' | 'assistant',
    content: [{ type: 'text', text: snapshot.content }],
  };
}

/** KernelMessage → MessageSnapshot */
function kernelMessageToSnapshot(msg: KernelMessage): MessageSnapshot {
  const text = msg.content
    .filter(b => b.type === 'text')
    .map(b => (b as { text: string }).text)
    .join('');
  return { role: msg.role, content: text };
}

/**
 * 根据 ThinkLevel + 模型能力解析 ThinkingConfig
 *
 * - thinkLevel === 'off' → disabled
 * - 模型支持 adaptive (4.6+ Anthropic) → adaptive
 * - 否则 → enabled (固定预算)
 */
function resolveThinkingConfig(
  thinkLevel: ThinkLevel,
  provider: string,
  modelId: string,
  maxTokens: number,
): ThinkingConfig {
  if (thinkLevel === 'off') return { type: 'disabled' };

  // 检测是否支持 adaptive（Anthropic 4.6+ 模型）
  const modelDef = lookupModelDefinition(provider, modelId);
  const isAdaptiveCapable = provider === 'anthropic' && (
    modelId.includes('opus-4-6') ||
    modelId.includes('sonnet-4-6') ||
    modelId.includes('opus-4-5') ||
    modelId.includes('sonnet-4-5')
  );

  if (isAdaptiveCapable) {
    return { type: 'adaptive' };
  }

  // 固定预算模式
  const budget = modelDef?.maxTokens
    ? Math.max(modelDef.maxTokens - 1, 1024)
    : Math.max(maxTokens - 1, 1024);
  return { type: 'enabled', budgetTokens: budget };
}

/**
 * 执行单次 Agent 循环
 *
 * 不做重试（重试由外层 loop 负责），只负责：
 * 1. 构建 QueryLoopConfig
 * 2. 调用 queryLoop()
 * 3. Memory Flush
 * 4. 返回结构化 AttemptResult
 */
export async function runSingleAttempt(params: AttemptParams): Promise<AttemptResult> {
  const { config, providerOverride, thinkLevel, messagesOverride, message, onEvent, abortSignal } = params;

  // 结果收集器
  let fullResponse = '';
  const toolCalls: ToolCallRecord[] = [];

  // ─── Effective Provider 配置 ───
  const effectiveProvider = providerOverride?.provider ?? config.provider;
  const effectiveModelId = providerOverride?.modelId ?? config.modelId;
  const effectiveApiKey = providerOverride?.apiKey ?? config.apiKey;
  const effectiveBaseUrl = providerOverride?.baseUrl ?? config.baseUrl;
  const effectiveProtocol = providerOverride?.apiProtocol ?? config.apiProtocol;
  const contextWindow = providerOverride?.contextWindow ?? config.contextWindow ?? 128_000;
  const maxTokens = providerOverride?.maxTokens ?? config.maxTokens ?? 8192;

  if (!effectiveApiKey) {
    return {
      success: false, errorType: 'auth', error: 'API key 未配置',
      timedOut: false, timedOutDuringCompaction: false, aborted: false,
      fullResponse: '', toolCalls: [],
    };
  }

  log.info(
    `attempt: ${effectiveProvider}/${effectiveModelId}, ` +
    `protocol=${normalizeProtocol(effectiveProtocol)}, thinking=${thinkLevel !== 'off'}`,
  );

  // ─── 系统提示 ───
  let systemPrompt = buildSystemPrompt(config);

  // 优先级覆盖（如果有 promptOverrides）
  if (config.promptOverrides && config.promptOverrides.length > 0) {
    const { resolvePromptOverrides } = await import('./prompt-override.js');
    const { buildSystemPromptBlocks } = await import('./embedded-runner-prompt.js');
    const blocks = buildSystemPromptBlocks(config);
    const resolved = resolvePromptOverrides(blocks, config.promptOverrides as any);
    const { systemPromptBlocksToString } = await import('./kernel/types.js');
    systemPrompt = systemPromptBlocksToString(resolved);
  }

  // ─── 工具池 ───
  const toolSafety = new ToolSafetyGuard();
  // Skill 搜索路径 + SkillTool 创建（避免 agent→skill 层级违反，在此处桥接）
  const { DEFAULT_DATA_DIR } = await import('@evoclaw/shared');
  const { createSkillTool } = await import('../skill/skill-tool.js');
  const { createToolSearchTool } = await import('./kernel/tool-search.js');
  const skillSearchPaths = [
    path.join(os.homedir(), DEFAULT_DATA_DIR, 'skills'),
    ...(config.workspacePath ? [path.join(config.workspacePath, 'skills')] : []),
  ];
  const skillTool = createSkillTool(skillSearchPaths) as import('./kernel/types.js').KernelTool;

  // 先构建基础工具池（不含 ToolSearch，因为 ToolSearch 需要完整工具列表）
  const baseTools = buildKernelTools({
    builtinContextWindow: contextWindow,
    evoClawTools: config.tools,
    permissionFn: config.permissionInterceptFn,
    toolSafety,
    auditFn: config.auditLogFn,
    provider: effectiveProvider,
    extraTools: [skillTool],
  });

  // ToolSearchTool 需要完整工具列表才能搜索（包含 deferred 工具）
  const toolSearchTool = createToolSearchTool(baseTools);
  const kernelTools = [...baseTools, toolSearchTool];

  // ─── 消息历史 ───
  const effectiveMessages: MessageSnapshot[] = messagesOverride
    ?? (config.messages ?? []).map(m => ({ role: m.role, content: m.content }));

  // 转为 KernelMessage + 追加当前用户消息
  const kernelMessages: KernelMessage[] = effectiveMessages.map(snapshotToKernelMessage);

  // 大内容移至用户消息（USER.md/MEMORY.md → <system-reminder>，避免破坏 prompt cache）
  const { buildUserContextReminder } = await import('./embedded-runner-prompt.js');
  const contextReminder = buildUserContextReminder(config.workspaceFiles ?? {});
  if (contextReminder && kernelMessages.length > 0 && kernelMessages[0].role === 'user') {
    const first = kernelMessages[0];
    const firstText = first.content.find(b => b.type === 'text');
    if (firstText && firstText.type === 'text') {
      (firstText as { text: string }).text = contextReminder + '\n' + firstText.text;
    }
  }
  kernelMessages.push({
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: message }],
  });

  // ─── Smart Timeout ───
  const timeoutController = new AbortController();
  let isCompacting = false;
  const smartTimeout = createSmartTimeout({
    timeoutMs: ATTEMPT_TIMEOUT_MS,
    isCompacting: () => isCompacting,
    onTimeout: () => timeoutController.abort('超时'),
  });

  const mergedSignal = abortSignal
    ? AbortSignal.any([abortSignal, timeoutController.signal])
    : timeoutController.signal;

  // 包装 onEvent 追踪 compaction 状态 + 收集结果
  const wrappedOnEvent = (event: RuntimeEvent) => {
    if (event.type === 'compaction_start') isCompacting = true;
    if (event.type === 'compaction_end') isCompacting = false;
    if (event.type === 'text_delta' && event.delta) fullResponse += event.delta;
    onEvent(event);
  };

  // 重置压缩器状态 (新 attempt)
  resetCompactorState();

  // ─── 构建 QueryLoopConfig ───
  const loopConfig: QueryLoopConfig = {
    protocol: normalizeProtocol(effectiveProtocol),
    baseUrl: effectiveBaseUrl,
    apiKey: effectiveApiKey,
    modelId: effectiveModelId,
    maxTokens,
    contextWindow,
    thinkingConfig: resolveThinkingConfig(thinkLevel, effectiveProvider, effectiveModelId, maxTokens),
    tools: kernelTools,
    systemPrompt,
    messages: kernelMessages,
    maxTurns: 50,
    timeoutMs: ATTEMPT_TIMEOUT_MS,
    onEvent: wrappedOnEvent,
    toolSafety,
    abortSignal: mergedSignal,
  };

  try {
    // ─── 执行 Agent 循环 ───
    const result = await queryLoop(loopConfig);

    // 收集工具调用记录
    toolCalls.push(...result.toolCalls);
    // fullResponse 已在 wrappedOnEvent 中累积

    // ─── 消息快照 (供 failover 使用) ───
    const messagesSnapshot = result.messages.map(kernelMessageToSnapshot);

    // ─── Memory Flush ───
    const totalTokens = result.totalInputTokens + result.totalOutputTokens;
    if (shouldTriggerFlush(totalTokens, contextWindow)) {
      log.warn(
        `Memory Flush 触发: totalTokens=${totalTokens}, contextLimit=${contextWindow}, ` +
        `使用率=${(totalTokens / contextWindow * 100).toFixed(1)}%`,
      );
      try {
        const flushToolSafety = new ToolSafetyGuard();
        const flushTools = buildKernelTools({
          builtinContextWindow: contextWindow,
          evoClawTools: config.tools,
          permissionFn: createFlushPermissionInterceptor(),
          toolSafety: flushToolSafety,
          auditFn: config.auditLogFn,
          provider: effectiveProvider,
        });

        await queryLoop({
          ...loopConfig,
          tools: flushTools,
          messages: [...result.messages as KernelMessage[], {
            id: crypto.randomUUID(),
            role: 'user',
            content: [{ type: 'text', text: buildMemoryFlushPrompt() }],
          }],
          maxTurns: 5,
          toolSafety: flushToolSafety,
        });
        log.info('Memory Flush turn 完成');
      } catch (flushErr) {
        log.warn('Memory Flush turn 失败，降级跳过:', flushErr);
      }
    }

    // ─── 成功 ───
    return {
      success: true,
      timedOut: false,
      timedOutDuringCompaction: false,
      aborted: false,
      messagesSnapshot,
      fullResponse,
      toolCalls,
    };
  } catch (err) {
    // ─── 消息快照 (即使失败也尝试提供) ───
    const messagesSnapshot = kernelMessages.map(kernelMessageToSnapshot);

    // 超时
    if (smartTimeout.timedOut) {
      log.warn(`attempt 超时 (${ATTEMPT_TIMEOUT_MS / 1000}s, compaction=${smartTimeout.timedOutDuringCompaction})`);
      return {
        success: false,
        errorType: 'timeout',
        error: `Agent 超时 (${ATTEMPT_TIMEOUT_MS / 1000}s)`,
        timedOut: true,
        timedOutDuringCompaction: smartTimeout.timedOutDuringCompaction,
        aborted: false,
        messagesSnapshot,
        fullResponse,
        toolCalls,
      };
    }

    // 外部中止
    if (abortSignal?.aborted) {
      log.warn('attempt 被外部中止');
      return {
        success: false,
        errorType: 'abort',
        error: '外部中止',
        timedOut: false,
        timedOutDuringCompaction: false,
        aborted: true,
        messagesSnapshot,
        fullResponse,
        toolCalls,
      };
    }

    // AbortError (可能来自 kernel)
    if (err instanceof AbortError || isAbortError(err)) {
      return {
        success: false,
        errorType: 'abort',
        error: '中止',
        timedOut: false,
        timedOutDuringCompaction: false,
        aborted: true,
        messagesSnapshot,
        fullResponse,
        toolCalls,
      };
    }

    // 其他错误 → 分类
    const classified = classifyError(err);
    log.warn(`attempt 错误: type=${classified.type}, msg=${classified.message}`);
    return {
      success: false,
      errorType: classified.type,
      error: classified.message,
      timedOut: false,
      timedOutDuringCompaction: false,
      aborted: false,
      messagesSnapshot,
      fullResponse,
      toolCalls,
    };
  } finally {
    smartTimeout.clear();
  }
}
