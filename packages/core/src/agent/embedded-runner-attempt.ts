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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ThinkLevel } from '@evoclaw/shared';
import type { AgentRunConfig, AttemptResult, ProviderConfig, ToolCallRecord, MessageSnapshot, RuntimeEvent } from './types.js';
import type { ThinkingConfig } from './kernel/types.js';
import { resolveModelDefinition } from '../provider/extensions/index.js';
import { ToolSafetyGuard } from './tool-safety.js';
import { shouldTriggerFlush, buildMemoryFlushPrompt, createFlushPermissionInterceptor } from './memory-flush.js';
import { buildSystemPrompt } from './embedded-runner-prompt.js';
import { classifyError, isAbortError } from './embedded-runner-errors.js';
import { createSmartTimeout, RUNNER_WALLCLOCK_MS, RUNNER_WALLCLOCK_WARNING_RATIO } from './embedded-runner-timeout.js';
import { IdleWatchdog } from './kernel/idle-watchdog.js';
import { queryLoop } from './kernel/query-loop.js';
import { buildKernelTools } from './kernel/tool-adapter.js';
import { resetCompactorState } from './kernel/context-compactor.js';
import type { QueryLoopConfig, KernelMessage, ApiProtocol } from './kernel/types.js';
import { AbortError } from './kernel/types.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('embedded-runner-attempt');

type EventCallback = (event: RuntimeEvent) => void | Promise<void>;

/** 扩展名 → MIME 映射（仅覆盖主流位图） */
const IMAGE_EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

/** 图片上限 10MB —— 超出不读，避免 base64 膨胀打爆上下文 */
const MAX_INPUT_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * 把本地图片文件读成 ImageBlock；失败（文件不存在 / 过大 / IO 错）时返回 null，
 * 调用方吞掉该附件继续跑（用户至少还能看到文本部分，不中断对话）
 */
function readImageBlock(
  filePath: string,
  mimeHint: string | undefined,
): import('./kernel/types.js').ContentBlock | null {
  try {
    if (!fs.existsSync(filePath)) {
      log.warn(`图片附件不存在: ${filePath}`);
      return null;
    }
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_INPUT_IMAGE_BYTES) {
      log.warn(`图片附件过大（${(stat.size / 1024 / 1024).toFixed(1)}MB > 10MB），跳过: ${filePath}`);
      return null;
    }
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = mimeHint ?? IMAGE_EXT_MIME[ext] ?? 'image/png';
    return {
      type: 'image',
      source: { type: 'base64', media_type: mimeType, data: buffer.toString('base64') },
    };
  } catch (err) {
    log.warn(`读取图片附件失败 path=${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Runner 总超时层（M13 重构）
 *
 * - **Wallclock 兜底**：30 分钟（RUNNER_WALLCLOCK_MS），防真死循环跑死 sidecar
 *   - 警告阈值 75%（22.5 分钟）注入软警告 system_event 让 LLM 主动收尾
 * - **Idle Watchdog 主超时**：120s 无任何 stream event / tool 推进 → abort
 *   - 警告阈值 70%（84s）同样注入软警告
 *   - 兼容 compaction：compaction_start/end 自动 pause/resume
 *
 * 替代原 ATTEMPT_TIMEOUT_MS=600s 一刀切——600s 把多步推进任务（codegen 30 文件、长 bash）
 * 也一并砍了，是误伤。
 */
const RUNNER_IDLE_MS = 120_000;
const RUNNER_IDLE_WARNING_RATIO = 0.7;

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
  /** SQLite store（可选: 用于增量持久化） */
  store?: import('../infrastructure/db/sqlite-store.js').SqliteStore;
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
  const content: import('./kernel/types.js').ContentBlock[] = [
    { type: 'text', text: snapshot.content },
  ];
  // 还原历史消息里的图片附件（让后续轮次的 LLM 仍能看到之前引用过的图）
  for (const att of snapshot.attachments ?? []) {
    if (att.type !== 'image' || !att.base64) continue;
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: att.mimeType, data: att.base64 },
    });
  }
  return {
    id: crypto.randomUUID(),
    role: snapshot.role as 'user' | 'assistant',
    content,
    ...(snapshot.isSummary ? { isCompactSummary: true } : undefined),
  };
}

/** KernelMessage → MessageSnapshot */
function kernelMessageToSnapshot(msg: KernelMessage): MessageSnapshot {
  const text = msg.content
    .filter(b => b.type === 'text')
    .map(b => (b as { text: string }).text)
    .join('');
  const images = msg.content
    .filter(b => b.type === 'image')
    .map(b => {
      const img = b as { source: { media_type: string; data: string } };
      return {
        type: 'image' as const,
        mimeType: img.source.media_type,
        base64: img.source.data,
      };
    });
  const snap: MessageSnapshot = { role: msg.role, content: text };
  if (images.length > 0) snap.attachments = images;
  return snap;
}

/**
 * 根据 ThinkLevel + 模型能力解析 ThinkingConfig
 *
 * - thinkLevel === 'off' → disabled
 * - thinkLevel === 'adaptive' 且模型 thinkingLevels 包含 'adaptive' → adaptive
 * - 其他等级（minimal/low/medium/high/xhigh/max）→ enabled（固定预算）
 *
 * 模型的 thinkingLevels 数组由 catalog 显式声明，去掉 4.6 硬编码的历史包袱。
 */
function resolveThinkingConfig(
  thinkLevel: ThinkLevel,
  provider: string,
  modelId: string,
  maxTokens: number,
): ThinkingConfig {
  if (thinkLevel === 'off') return { type: 'disabled' };

  const modelDef = resolveModelDefinition(provider, modelId);

  // adaptive: 仅在 thinkLevel='adaptive' 且模型显式声明支持时使用
  if (thinkLevel === 'adaptive' && modelDef?.thinkingLevels?.includes('adaptive')) {
    return { type: 'adaptive' };
  }

  // 固定预算模式 — 使用模型最大输出能力上限（而非默认 maxTokens）
  const outputLimit = modelDef?.maxOutputLimit ?? modelDef?.maxTokens ?? maxTokens;
  const budget = Math.max(outputLimit - 1, 1024);
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
  const { config, providerOverride, thinkLevel, messagesOverride, message, onEvent, abortSignal, store } = params;

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
  const { BUNDLED_SKILLS_DIR } = await import('../context/plugins/tool-registry.js');
  const skillSearchPaths = [
    path.join(os.homedir(), DEFAULT_DATA_DIR, 'skills'),
    ...(config.workspacePath ? [path.join(config.workspacePath, 'skills')] : []),
    BUNDLED_SKILLS_DIR,  // Bundled 技能最低优先级
  ];
  // Fork 配置（允许技能在子代理中独立执行）
  const forkConfig = {
    enabled: true,
    apiConfig: {
      protocol: effectiveProtocol ?? 'openai-completions',
      baseUrl: effectiveBaseUrl,
      apiKey: effectiveApiKey,
      modelId: effectiveModelId,
      contextWindow,
    },
  };

  // MCP Prompt 执行器（如果有 McpManager）
  const mcpManager = config.mcpManager;
  const mcpPromptExecutor = mcpManager
    ? (serverName: string, promptName: string, args?: Record<string, string>) =>
        mcpManager.getPrompt(serverName, promptName, args)
    : undefined;

  // 模型解析器（将 skill 的 model 字段解析为 API 配置）
  const modelResolverFn = (config as unknown as Record<string, unknown>).modelResolver as
    import('../skill/skill-tool.js').ModelResolverFn | undefined;

  // M7 Phase 2: Skill 调用 telemetry sink（store 可用时启用）
  let skillTelemetry: import('../skill/skill-usage-store.js').SkillTelemetrySink | undefined;
  if (store) {
    const { SkillUsageStore } = await import('../skill/skill-usage-store.js');
    skillTelemetry = new SkillUsageStore(store);
  }

  const skillTool = createSkillTool(skillSearchPaths, {
    forkConfig,
    mcpPromptExecutor,
    modelResolver: modelResolverFn,
    telemetry: skillTelemetry,
    agentId: config.agent?.id,
    sessionKey: config.sessionKey,
  }) as import('./kernel/types.js').KernelTool;

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
  const deferredTools = baseTools.filter(t => t.shouldDefer);
  const toolSearchTool = createToolSearchTool(() => deferredTools);
  const kernelTools = [...baseTools, toolSearchTool];

  // ─── 消息历史 ───
  const effectiveMessages: MessageSnapshot[] = messagesOverride
    ?? (config.messages ?? []).map(m => ({
      role: m.role,
      content: m.content,
      ...(m.isSummary ? { isSummary: m.isSummary } : {}),
      ...(m.attachments ? { attachments: m.attachments } : {}),
    }));

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
  const userContent: import('./kernel/types.js').ContentBlock[] = [
    { type: 'text', text: message },
  ];
  // 把 IM 渠道下载到本地的图片附件作为 ImageBlock 追加，直接走多模态
  // 协议（Anthropic image / OpenAI image_url），免去 Agent 调 image 工具绕路。
  for (const att of config.inputAttachments ?? []) {
    if (att.type !== 'image') continue;
    const block = readImageBlock(att.path, att.mimeType);
    if (block) userContent.push(block);
  }
  kernelMessages.push({
    id: crypto.randomUUID(),
    role: 'user',
    content: userContent,
  });

  // ─── 双层超时（M13 重构）───
  //
  //   1. **Idle Watchdog**（主超时，120s）：每个 stream chunk / tool 推进重置
  //      —— 抓"真死循环"（stream 卡住、模型一直思考不输出）
  //   2. **Wallclock 兜底**（30 分钟）：单个 attempt 总时长上限
  //      —— 防"持续输出但无意义"的死循环跑死 sidecar / 烧光预算
  //
  // 两者各司其职，不再像旧实现那样 600s 一刀切误伤 codegen 长任务。
  const timeoutController = new AbortController();
  let isCompacting = false;

  // 软警告注入器 — 撞警告阈值时通过 inboundMessageQueue 把 system_event 喂给下一轮 LLM
  const inboundMessageQueue: string[] = [];
  const injectSoftWarning = (kind: 'idle' | 'wallclock', elapsedMs: number) => {
    inboundMessageQueue.push(buildWarningSystemEvent(kind, elapsedMs));
  };

  const idleWatchdog = new IdleWatchdog({
    idleMs: RUNNER_IDLE_MS,
    warningRatio: RUNNER_IDLE_WARNING_RATIO,
    onWarning: (elapsedMs) => injectSoftWarning('idle', elapsedMs),
    onTimeout: () => timeoutController.abort('idle 超时'),
  });
  idleWatchdog.start();

  const smartTimeout = createSmartTimeout({
    timeoutMs: RUNNER_WALLCLOCK_MS,
    warningRatio: RUNNER_WALLCLOCK_WARNING_RATIO,
    isCompacting: () => isCompacting,
    onWarning: (elapsedMs) => injectSoftWarning('wallclock', elapsedMs),
    onTimeout: () => timeoutController.abort('wallclock 超时'),
  });

  const mergedSignal = abortSignal
    ? AbortSignal.any([abortSignal, timeoutController.signal])
    : timeoutController.signal;

  // 包装 onEvent 追踪 compaction 状态 + 收集结果
  const wrappedOnEvent = async (event: RuntimeEvent) => {
    if (event.type === 'compaction_start') {
      isCompacting = true;
      idleWatchdog.pause();   // compaction 期间不算 idle
    }
    if (event.type === 'compaction_end') {
      isCompacting = false;
      idleWatchdog.resume();
    }
    if (event.type === 'text_delta' && event.delta) fullResponse += event.delta;
    await onEvent(event);
  };

  // 重置压缩器状态 (新 attempt)
  resetCompactorState();

  // ─── Runtime State Restore (可选: 恢复 FileStateCache / CollapseState) ───
  let restoredFileStateCache: import('./kernel/file-state-cache.js').FileStateCache | undefined;
  if (store && config.agent?.id && config.sessionKey) {
    const { loadRuntimeState } = await import('./kernel/runtime-state-store.js');
    const snapshot = loadRuntimeState(store, config.agent.id, config.sessionKey);
    if (snapshot?.fileStateCache) {
      const { FileStateCache } = await import('./kernel/file-state-cache.js');
      restoredFileStateCache = FileStateCache.fromJSON(snapshot.fileStateCache);
    }
  }

  // ─── Incremental Persister (可选: 流式持久化) ───
  let persister: import('./kernel/incremental-persister.js').IncrementalPersister | undefined;
  if (store && config.agent?.id && config.sessionKey) {
    const { IncrementalPersister: PersisterClass } = await import('./kernel/incremental-persister.js');
    persister = new PersisterClass(store, config.agent.id, config.sessionKey);
  }

  // ─── Tool Summary Generator (可选: LLM 驱动工具摘要) ───
  let toolSummaryGenerator: QueryLoopConfig['toolSummaryGenerator'];
  if (config.toolSummaryGeneratorFn) {
    const { ToolUseSummaryGenerator } = await import('../cost/tool-use-summary.js');
    toolSummaryGenerator = new ToolUseSummaryGenerator(config.toolSummaryGeneratorFn);
  }

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
    timeoutMs: RUNNER_WALLCLOCK_MS,
    onEvent: wrappedOnEvent,
    toolSafety,
    abortSignal: mergedSignal,
    idleWatchdog,
    pendingInboundMessages: inboundMessageQueue,
    toolSummaryGenerator,
    // Compact Hooks — 从 AgentRunConfig 透传到 Kernel
    preCompactHook: config.preCompactHook,
    postCompactHook: config.postCompactHook,
    // Agent Context — SM Compact + 重注入需要
    agentId: config.agent?.id,
    sessionKey: config.sessionKey,
    fileStateCache: restoredFileStateCache,
    // Incremental Persistence
    persister,
    // Grace Call — 预算耗尽时生成收尾摘要（M3-T1）。默认启用；chat.ts
    // 对 heartbeat/cron/boot 等自主会话显式传 false。
    graceCall: { enabled: config.graceCallEnabled !== false },
  };

  // 追踪最新的 kernel 消息（catch 块中用于构建 messagesSnapshot）
  let lastKnownMessages: KernelMessage[] = kernelMessages;

  try {
    // ─── 执行 Agent 循环 ───
    const result = await queryLoop(loopConfig);
    // queryLoop 正常返回（含 abort 在轮次间检测到的情况）→ 更新已知消息
    lastKnownMessages = result.messages as KernelMessage[];

    // 收集工具调用记录
    toolCalls.push(...result.toolCalls);
    // fullResponse 已在 wrappedOnEvent 中累积

    // ─── 消息快照 (供 failover 使用) ───
    const messagesSnapshot = result.messages.map(kernelMessageToSnapshot);

    // ─── Usage Event — 发送 token 使用量给前端 ───
    const { calculateCostMilli } = await import('../cost/model-pricing.js');
    const totalCacheRead = result.messages.reduce((sum, m) => sum + (m.usage?.cacheReadTokens ?? 0), 0);
    const totalCacheWrite = result.messages.reduce((sum, m) => sum + (m.usage?.cacheWriteTokens ?? 0), 0);
    const costMilli = calculateCostMilli(effectiveModelId, result.totalInputTokens, result.totalOutputTokens, totalCacheRead, totalCacheWrite);
    await onEvent({
      type: 'usage',
      timestamp: Date.now(),
      usage: {
        inputTokens: result.totalInputTokens,
        outputTokens: result.totalOutputTokens,
        cacheReadTokens: totalCacheRead,
        cacheWriteTokens: totalCacheWrite,
        totalTokens: result.totalInputTokens + result.totalOutputTokens,
        estimatedCostMilli: costMilli,
        turnCount: result.turnCount,
        // M3-T2: 让前端能展示"剩余 M 轮"
        maxTurns: result.maxTurns,
        remainingTurns: Math.max(0, result.maxTurns - result.turnCount),
      },
    });

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

    // ─── Runtime State Save (成功时持久化) ───
    if (store && config.agent?.id && config.sessionKey && loopConfig.fileStateCache) {
      const { saveRuntimeState } = await import('./kernel/runtime-state-store.js');
      saveRuntimeState(store, config.agent.id, config.sessionKey, {
        fileStateCache: loopConfig.fileStateCache.toJSON(),
      });
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
    // ─── 消息快照 (即使失败也尝试提供，使用最新已知消息) ───
    const messagesSnapshot = lastKnownMessages.map(kernelMessageToSnapshot);

    // 超时
    if (idleWatchdog.timedOut || smartTimeout.timedOut) {
      const kind: 'idle' | 'wallclock' = idleWatchdog.timedOut ? 'idle' : 'wallclock';
      const totalSec = kind === 'idle' ? RUNNER_IDLE_MS / 1000 : RUNNER_WALLCLOCK_MS / 1000;
      log.warn(`attempt 超时 (kind=${kind}, ${totalSec}s, compaction=${smartTimeout.timedOutDuringCompaction})`);

      // 任务收尾责任链 — 自动 update_task_status('blocked')，避免 task 永远卡 in_progress
      // 收尾失败不影响主流程
      if (config.taskTimeoutFinalizer && config.sessionKey) {
        try {
          const finalized = config.taskTimeoutFinalizer(config.sessionKey, kind);
          if (finalized.length > 0) {
            log.info(`runner 超时后自动标 blocked: ${finalized.map((t: { localId: string }) => t.localId).join(',')}`);
          }
        } catch (finalErr) {
          log.warn('任务收尾失败:', finalErr);
        }
      }

      return {
        success: false,
        errorType: 'timeout',
        error: `Agent ${kind === 'idle' ? 'idle' : 'wallclock'} 超时 (${totalSec}s)`,
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
    idleWatchdog.stop();
    // 确保异常退出时也 flush 未写入的消息
    persister?.dispose();
  }
}

/**
 * 构建软警告 system_event（M13 重构）
 *
 * idle/wallclock 撞警告阈值时通过 inboundMessageQueue 喂给下一轮 LLM，
 * 提示主动调 update_task_status / mention_peer 收尾，最大化任务完成度。
 */
function buildWarningSystemEvent(kind: 'idle' | 'wallclock', elapsedMs: number): string {
  const elapsedSec = Math.floor(elapsedMs / 1000);
  if (kind === 'idle') {
    return `<system_event kind="runner_idle_warning">
你已经 ${elapsedSec} 秒没有新的工具调用或文本输出。即将（再 ~36 秒）触发 idle 超时被中断。
建议立即三选一：
(1) 调 update_task_status('in_progress', note='当前进度: ...') 上报已完成的部分；
(2) 调 update_task_status('blocked', note='原因: ...') 让责任链兜底；
(3) 调 mention_peer 把剩余工作转交给同事。
</system_event>`;
  }
  const elapsedMin = Math.floor(elapsedSec / 60);
  return `<system_event kind="runner_wallclock_warning">
你已经运行 ${elapsedMin} 分钟。还剩约 7 分钟会撞总时长上限被强制中断。
任务量较大时建议分批：调 update_task_status('blocked', note='已完成 X，剩余 Y 待续') 让其他 Agent 接力，或自行换会话续写。
</system_event>`;
}
