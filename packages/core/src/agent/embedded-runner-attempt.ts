/**
 * 单次执行模块 — 参考 OpenClaw attempt.ts
 *
 * 从 embedded-runner.ts 的 runWithPI() 改造而来。
 * 核心改进：
 * - 返回结构化 AttemptResult（而非 throw/catch 控制流）
 * - createSmartTimeout（compaction 感知超时）
 * - abortable() 包装 session.prompt()
 * - 消息快照（pre-prompt + post-prompt + on-error）
 * - 完整 finally 清理保证
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_DATA_DIR } from '@evoclaw/shared';
import type { ThinkLevel } from '@evoclaw/shared';
import type { AgentRunConfig, AttemptResult, ProviderConfig, ToolCallRecord, MessageSnapshot, RuntimeEvent } from './types.js';
import { toPIProvider } from '../provider/pi-provider-map.js';
import { ToolSafetyGuard } from './tool-safety.js';
import { shouldTriggerFlush, buildMemoryFlushPrompt } from './memory-flush.js';
import { buildPIBuiltInTools, wrapToolsForPI, createToolXmlFilter } from './embedded-runner-tools.js';
import { buildSystemPrompt } from './embedded-runner-prompt.js';
import { classifyError, isAbortError } from './embedded-runner-errors.js';
import { createSmartTimeout, abortable } from './embedded-runner-timeout.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('embedded-runner-attempt');

type EventCallback = (event: RuntimeEvent) => void;

function emit(cb: EventCallback, event: Omit<RuntimeEvent, 'timestamp'>): void {
  cb({ ...event, timestamp: Date.now() } as RuntimeEvent);
}

/** 零值 usage 快照（pi-coding-agent 期望该字段始终存在） */
const ZERO_USAGE = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** 确保 assistant message 的 usage 字段存在 */
function ensureUsageOnAssistantMessages(agent: { state: { messages: Array<Record<string, unknown>> } }): void {
  for (const msg of agent.state.messages) {
    if (msg.role === 'assistant' && !msg.usage) {
      msg.usage = { ...ZERO_USAGE, cost: { ...ZERO_USAGE.cost } };
    }
  }
}

/** 从 PI session 中提取消息快照 */
function extractMessagesSnapshot(agent: any): MessageSnapshot[] {
  const messages: Array<Record<string, unknown>> = agent.state?.messages ?? [];
  return messages.map((msg) => ({
    role: (msg.role as string) ?? 'user',
    content: Array.isArray(msg.content)
      ? (msg.content as Array<any>)
          .filter((c: any) => c.type === 'text' || !c.type)
          .map((c: any) => c.text ?? '')
          .join('')
      : String(msg.content ?? ''),
  }));
}

/** PI 总超时（与 Lane Queue 默认超时对齐） */
const PI_TIMEOUT_MS = 600_000; // 10 分钟

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

/**
 * 执行单次 PI session.prompt()
 *
 * 不做重试（重试由外层 loop 负责），只负责：
 * 1. 创建 PI session
 * 2. 订阅事件
 * 3. abortable(session.prompt()) + smart timeout
 * 4. Memory Flush
 * 5. 返回结构化 AttemptResult
 */
export async function runSingleAttempt(params: AttemptParams): Promise<AttemptResult> {
  const { config, providerOverride, thinkLevel, messagesOverride, message, onEvent, abortSignal } = params;
  const reasoning = thinkLevel !== 'off';

  // 结果收集器
  let fullResponse = '';
  const toolCalls: ToolCallRecord[] = [];

  // 使用 provider override（failover 时）或 config 中的默认值
  const effectiveProvider = providerOverride?.provider ?? config.provider;
  const effectiveModelId = providerOverride?.modelId ?? config.modelId;
  const effectiveApiKey = providerOverride?.apiKey ?? config.apiKey;
  const effectiveBaseUrl = providerOverride?.baseUrl ?? config.baseUrl;
  const effectiveApiProtocol = providerOverride?.apiProtocol ?? config.apiProtocol;

  // ─── 动态导入 PI ───
  const piAi = await import('@mariozechner/pi-ai');
  const piCoding = await import('@mariozechner/pi-coding-agent');

  if (!effectiveApiKey) {
    return {
      success: false, errorType: 'auth', error: 'PI 运行需要 API key',
      timedOut: false, timedOutDuringCompaction: false, aborted: false,
      fullResponse: '', toolCalls: [],
    };
  }

  // 注册内置 API providers
  piAi.registerBuiltInApiProviders();

  // API 协议映射
  const apiProtocolMap: Record<string, string> = {
    anthropic: 'anthropic-messages',
    'anthropic-messages': 'anthropic-messages',
    'openai-completions': 'openai-completions',
    'openai-responses': 'openai-responses',
    google: 'google-generative-ai',
  };
  const piApi = apiProtocolMap[effectiveApiProtocol ?? 'openai-completions'] ?? 'openai-completions';

  // baseUrl 去掉尾部 /v1（PI SDK 内部会拼接）
  const modelBaseUrl = effectiveBaseUrl
    ? effectiveBaseUrl.replace(/\/v1\/?$/, '')
    : '';

  // EvoClaw provider ID → PI provider ID（如 glm → zai）
  const piProvider = toPIProvider(effectiveProvider);

  // 构造 Model 对象
  const model = {
    id: effectiveModelId,
    name: effectiveModelId,
    api: piApi,
    provider: piProvider,
    baseUrl: modelBaseUrl,
    reasoning,
    input: ['text'] as ('text' | 'image')[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8192,
  };

  log.info(
    `attempt: ${piProvider}/${model.id}, api=${model.api}, reasoning=${reasoning}` +
    `${piProvider !== effectiveProvider ? ` (evoclaw=${effectiveProvider})` : ''}`,
  );

  // ─── PI session 基础设施 ───
  const authStorage = piCoding.AuthStorage.inMemory({
    [piProvider]: { type: 'api_key' as const, key: effectiveApiKey },
  });
  const sessionManager = piCoding.SessionManager.inMemory();
  const settingsManager = piCoding.SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true },
  });
  const modelRegistry = new piCoding.ModelRegistry(authStorage);

  // 系统提示
  const systemPrompt = buildSystemPrompt(config);

  // 工具
  const piBuiltInTools = buildPIBuiltInTools(piCoding, model.contextWindow ?? 128_000);
  const toolSafety = new ToolSafetyGuard();
  const allCustomTools = wrapToolsForPI(piBuiltInTools, {
    permissionFn: config.permissionInterceptFn,
    toolSafety,
    onEvent,
    auditFn: config.auditLogFn,
    provider: effectiveProvider,
    evoClawTools: config.tools,
  });

  // ─── process.exit 拦截 ───
  const originalExit = process.exit;
  let exitIntercepted = false;
  process.exit = ((code?: number) => {
    exitIntercepted = true;
    log.warn(`拦截了 process.exit(${code ?? ''})，Sidecar 模式下忽略`);
  }) as never;

  // ─── 工作目录切换 ───
  const prevCwd = process.cwd();
  const effectiveWorkspace = config.workspacePath ?? prevCwd;
  try { process.chdir(effectiveWorkspace); } catch { /* 目录不存在时保持原 cwd */ }

  // ─── ResourceLoader ───
  const agentDir = path.join(os.homedir(), DEFAULT_DATA_DIR, 'agent');
  if (!fs.existsSync(agentDir)) {
    fs.mkdirSync(agentDir, { recursive: true });
  }
  if (!process.env.PI_CODING_AGENT_DIR) {
    process.env.PI_CODING_AGENT_DIR = agentDir;
  }
  const resourceLoader = new piCoding.DefaultResourceLoader({
    cwd: effectiveWorkspace,
    agentDir,
    settingsManager,
    noSkills: true,
    agentsFilesOverride: () => ({ agentsFiles: [] }),
  } as any);
  await resourceLoader.reload();

  // ─── 创建 PI session ───
  const { session } = await piCoding.createAgentSession({
    cwd: effectiveWorkspace,
    agentDir,
    resourceLoader,
    authStorage,
    modelRegistry,
    sessionManager,
    settingsManager,
    model: model as any,
    tools: [] as any,
    customTools: allCustomTools as any,
  });

  session.agent.streamFn = piAi.streamSimple;

  // 覆盖系统提示
  session.agent.setSystemPrompt(systemPrompt);
  const mutableSession = session as any;
  if (mutableSession._rebuildSystemPrompt) {
    let lastKnownMessageCount = 0;
    mutableSession._baseSystemPrompt = systemPrompt;
    mutableSession._rebuildSystemPrompt = () => {
      const currentMessages = (session.agent as any).messages;
      const currentCount = Array.isArray(currentMessages) ? currentMessages.length : 0;
      const wasCompacted = lastKnownMessageCount > 4 && currentCount < lastKnownMessageCount * 0.5;
      lastKnownMessageCount = currentCount;

      if (wasCompacted) {
        const today = new Date().toISOString().slice(0, 10);
        return systemPrompt + `\n\n[Post-compaction context refresh]

会话刚刚被压缩。上面的对话摘要只是提示，不能替代你的启动流程。

请立即执行：
1. 读取 AGENTS.md — 你的操作规程
2. 读取 MEMORY.md — 你的长期记忆
3. 读取今天的 memory/${today}.md — 今日笔记（如果存在）

从最新的文件状态恢复上下文，然后继续对话。`;
      }
      return systemPrompt;
    };
  }

  // 确保 usage 字段
  ensureUsageOnAssistantMessages(session.agent as any);

  // ─── 加载消息历史 ───
  // messagesOverride 来自 failover 快照（MessageSnapshot），config.messages 来自 ChatMessage
  // 两者都有 role + content，统一为 { role, content } 处理
  const effectiveMessages: MessageSnapshot[] = messagesOverride
    ?? (config.messages ?? []).map(m => ({ role: m.role, content: m.content }));
  const historyMessages = effectiveMessages.slice(0, -1);
  if (historyMessages.length > 0) {
    session.agent.replaceMessages(
      historyMessages.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: [{ type: 'text' as const, text: msg.content }],
        ...(msg.role === 'assistant' ? { usage: { ...ZERO_USAGE, cost: { ...ZERO_USAGE.cost } } } : {}),
      })) as Parameters<typeof session.agent.replaceMessages>[0],
    );
  }

  // ─── Tool XML 过滤器 ───
  const { filterToolXml, flushTextBuffer } = createToolXmlFilter(onEvent);

  // ─── Compaction 检测 ───
  let isCompacting = false;

  // ─── 工具参数缓存（tool_execution_start → tool_execution_end 传递） ───
  const pendingToolArgs = new Map<string, Record<string, unknown>>();

  // ─── 事件订阅 ───
  const unsubscribe = session.subscribe((event: Record<string, unknown>) => {
    try {
      if (event.type === 'message_start') {
        emit(onEvent, { type: 'message_start' });
      }

      if (event.type === 'message_end') {
        const msg = event.message as Record<string, unknown> | undefined;
        if (msg?.role === 'assistant' && !msg.usage) {
          msg.usage = { ...ZERO_USAGE, cost: { ...ZERO_USAGE.cost } };
        }
        flushTextBuffer();
        emit(onEvent, { type: 'message_end' });
      }

      if (event.type === 'auto_compaction_start') {
        isCompacting = true;
        emit(onEvent, { type: 'compaction_start' });
      }
      if (event.type === 'auto_compaction_end') {
        isCompacting = false;
        ensureUsageOnAssistantMessages(session.agent as any);
        emit(onEvent, { type: 'compaction_end' });
      }

      switch (event.type) {
        case 'message_update': {
          const msgEvent = event.assistantMessageEvent as Record<string, unknown> | undefined;
          if (msgEvent?.type === 'text_delta') {
            const delta = msgEvent.delta as string;
            fullResponse += delta;
            filterToolXml(delta);
          } else if (msgEvent?.type === 'thinking_delta') {
            emit(onEvent, { type: 'thinking_delta', delta: msgEvent.delta as string });
          }
          break;
        }
        case 'tool_execution_start': {
          const toolName = event.toolName as string;
          const toolArgs = event.args as Record<string, unknown>;
          pendingToolArgs.set(toolName, toolArgs);
          emit(onEvent, { type: 'tool_start', toolName, toolArgs });
          break;
        }
        case 'tool_execution_end': {
          const toolName = event.toolName as string;
          const toolResult = event.result as string;
          const isError = event.isError as boolean;
          const args = pendingToolArgs.get(toolName) ?? {};
          pendingToolArgs.delete(toolName);
          toolCalls.push({ toolName, args, result: toolResult, isError });
          emit(onEvent, { type: 'tool_end', toolName, toolResult, isError });
          break;
        }
      }
    } catch (subErr) {
      log.error('subscribe 回调异常:', subErr instanceof Error ? subErr.message : subErr);
    }
  });

  // ─── Smart Timeout + AbortController ───
  const timeoutController = new AbortController();
  const smartTimeout = createSmartTimeout({
    timeoutMs: PI_TIMEOUT_MS,
    isCompacting: () => isCompacting,
    onTimeout: () => timeoutController.abort('PI 超时'),
  });

  // 合并外部 abort 和超时 abort
  const mergedSignal = abortSignal
    ? AbortSignal.any([abortSignal, timeoutController.signal])
    : timeoutController.signal;

  // 处理 abort signal → session.abort()
  const onAbort = () => session.abort();
  mergedSignal.addEventListener('abort', onAbort, { once: true });

  // ─── 捕获 pre-prompt 消息快照 ───
  let messagesSnapshot: MessageSnapshot[] = extractMessagesSnapshot(session.agent);

  try {
    // ─── 执行 session.prompt() ───
    await abortable(session.prompt(message), mergedSignal);

    // 防御性处理
    ensureUsageOnAssistantMessages(session.agent as any);

    // ─── 捕获 post-prompt 消息快照（最完整） ───
    messagesSnapshot = extractMessagesSnapshot(session.agent);

    // ─── Memory Flush ───
    const agentMessages: Array<Record<string, unknown>> = (session.agent as any).state?.messages ?? [];
    const totalTokensFromMessages = agentMessages.reduce(
      (sum: number, msg: Record<string, unknown>) => {
        const u = msg.usage as Record<string, number> | undefined;
        return sum + (u?.totalTokens ?? u?.total_tokens ?? 0);
      },
      0,
    );
    const lastUsage = (session.agent as any)._lastUsage;
    const flushTokens = lastUsage?.total_tokens ?? totalTokensFromMessages;
    const contextLimit = model.contextWindow ?? 128_000;

    if (shouldTriggerFlush(flushTokens, contextLimit)) {
      log.warn(
        `Memory Flush 触发: totalTokens=${flushTokens}, contextLimit=${contextLimit}, ` +
        `使用率=${(flushTokens / contextLimit * 100).toFixed(1)}%`,
      );
      try {
        const flushPrompt = buildMemoryFlushPrompt();
        await abortable(session.prompt(flushPrompt), mergedSignal);
        ensureUsageOnAssistantMessages(session.agent as any);
        log.info('Memory Flush turn 完成');
      } catch (flushErr) {
        log.warn('Memory Flush turn 失败，降级跳过:', flushErr);
      }
    }

    // ─── 检查 session 错误 ───
    const state = session.state;
    if (state.error) {
      const classified = classifyError(new Error(String(state.error)));
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
    // ─── 捕获 on-error 快照（使用最近可用的） ───
    try {
      messagesSnapshot = extractMessagesSnapshot(session.agent);
    } catch { /* session 已 disposed，用之前的快照 */ }

    // 超时
    if (smartTimeout.timedOut) {
      log.warn(`PI 超时 (${PI_TIMEOUT_MS / 1000}s, compaction=${smartTimeout.timedOutDuringCompaction})`);
      return {
        success: false,
        errorType: 'timeout',
        error: `PI 超时 (${PI_TIMEOUT_MS / 1000}s)`,
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
      log.warn('PI 被外部中止');
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

    // AbortError（可能来自 abortable 包装）
    if (isAbortError(err)) {
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
    // ─── 资源清理保证 ───
    smartTimeout.clear();
    mergedSignal.removeEventListener('abort', onAbort);
    try { unsubscribe(); } catch { /* 忽略 */ }
    try { session.dispose(); } catch { /* 忽略 dispose 异常 */ }
    process.exit = originalExit;
    try { process.chdir(prevCwd); } catch { /* 忽略 */ }
    if (exitIntercepted) {
      log.info('PI 调用期间拦截了 process.exit，进程继续运行');
    }
  }
}
