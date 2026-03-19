import os from 'node:os';
import type { AgentRunConfig, RuntimeEvent } from './types.js';
import { toPIProvider } from '../provider/pi-provider-map.js';
import { ToolSafetyGuard } from './tool-safety.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('embedded-runner');

type EventCallback = (event: RuntimeEvent) => void;

function emit(cb: EventCallback, event: Omit<RuntimeEvent, 'timestamp'>): void {
  cb({ ...event, timestamp: Date.now() } as RuntimeEvent);
}

/** 沉默回复 token — Agent 返回此 token 表示无需回复用户 */
export const NO_REPLY_TOKEN = 'NO_REPLY';

/**
 * 运行嵌入式 Agent
 * 优先使用 PI 框架的 createAgentSession（对标 OpenClaw 模式），
 * 失败则回退到直接 fetch 调用 LLM API
 */
export async function runEmbeddedAgent(
  config: AgentRunConfig,
  message: string,
  onEvent: EventCallback,
  abortSignal?: AbortSignal,
): Promise<void> {
  emit(onEvent, { type: 'agent_start' });

  try {
    log.info('开始运行 PI');
    await Promise.race([
      runWithPI(config, message, onEvent, abortSignal),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('PI 超时 (120s)')), 120_000),
      ),
    ]);
    log.info('PI 调用完成');
  } catch (piError) {
    const piMsg = piError instanceof Error ? piError.message : String(piError);
    log.warn(`PI 失败: ${piMsg}`);
    log.info(
      `回退 fetch (protocol=${config.apiProtocol}, baseUrl=${config.baseUrl})`,
    );
    try {
      await runWithFetch(config, message, onEvent, abortSignal);
      log.info('fetch 完成');
    } catch (fetchError) {
      log.error('fetch 失败:', fetchError);
      emit(onEvent, { type: 'error', error: String(fetchError) });
    }
  }

  emit(onEvent, { type: 'agent_done' });
}

/** 零值 usage 快照（参考 OpenClaw 的 makeZeroUsageSnapshot，pi-coding-agent 期望该字段始终存在） */
const ZERO_USAGE = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * 确保 assistant message 的 usage 字段存在。
 * pi-coding-agent 的 _checkCompaction 假定 usage 非 undefined，
 * 但某些 provider 或异常路径可能不填充它。OpenClaw 的做法是防御性补零。
 */
function ensureUsageOnAssistantMessages(agent: { state: { messages: Array<Record<string, unknown>> } }): void {
  for (const msg of agent.state.messages) {
    if (msg.role === 'assistant' && !msg.usage) {
      msg.usage = { ...ZERO_USAGE, cost: { ...ZERO_USAGE.cost } };
    }
  }
}

// ─── 错误分类辅助函数（导出供测试） ───

/** 是否为 overload/rate-limit 错误 */
export function isOverloadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b(429|529)\b/.test(msg)) return true;
  if (/overloaded|rate.?limit/i.test(msg)) return true;
  return false;
}

/** 是否为 thinking/reasoning 不支持错误 */
export function isThinkingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /thinking|reasoning.*not.*support|extended.*thinking/i.test(msg);
}

/** 是否为上下文溢出错误 */
export function isContextOverflowError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /context.?length.?exceed|max.?context|too.?many.?tokens/i.test(msg);
}

/** 计算指数退避延迟（含 jitter） */
export function calculateBackoff(attempt: number, opts?: {
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: number;
}): number {
  const { initialDelayMs = 250, maxDelayMs = 1500, factor = 2, jitter = 0.2 } = opts ?? {};
  const base = Math.min(initialDelayMs * Math.pow(factor, attempt), maxDelayMs);
  const jitterRange = base * jitter;
  return base + (Math.random() * 2 - 1) * jitterRange;
}

/** 最大重试次数 */
const MAX_RETRIES = 3;

/**
 * PI 框架运行路径 — 使用 createAgentSession（对标 OpenClaw）
 * 完整启用 SessionManager + compaction + auto-retry 等 AgentSession 能力
 * 包含多级错误恢复：overload 退避 + thinking 降级 + context overflow 裁剪
 */
async function runWithPI(
  config: AgentRunConfig,
  message: string,
  onEvent: EventCallback,
  signal?: AbortSignal,
): Promise<void> {
  const piAi = await import('@mariozechner/pi-ai');
  const piCoding = await import('@mariozechner/pi-coding-agent');

  if (!config.apiKey) {
    throw new Error('PI 运行需要 API key');
  }

  // 注册内置 API providers（Anthropic, OpenAI, Google 等流式处理器）
  piAi.registerBuiltInApiProviders();

  // 将 EvoClaw 的 api 协议映射到 PI 的 Api 类型
  const apiProtocolMap: Record<string, string> = {
    anthropic: 'anthropic-messages',
    'anthropic-messages': 'anthropic-messages',
    'openai-completions': 'openai-completions',
    'openai-responses': 'openai-responses',
    google: 'google-generative-ai',
  };
  const piApi =
    apiProtocolMap[config.apiProtocol ?? 'openai-completions'] ??
    'openai-completions';

  // EvoClaw 配置的 baseUrl 含 /v1 后缀（给 fetch fallback 用），
  // 但 PI 的 provider SDK（Anthropic/OpenAI）内部会自己加 /v1 路径，
  // 直接传入会导致 /v1/v1/messages 404。需要去掉尾部的 /v1。
  const modelBaseUrl = config.baseUrl
    ? config.baseUrl.replace(/\/v1\/?$/, '')
    : '';

  // EvoClaw provider ID → PI provider ID（如 glm → zai）
  const piProvider = toPIProvider(config.provider);

  // 构造 Model 对象（reasoning 可在重试时降级）
  let reasoning = false;

  const buildModel = () => ({
    id: config.modelId,
    name: config.modelId,
    api: piApi,
    provider: piProvider,
    baseUrl: modelBaseUrl,
    reasoning,
    input: ['text'] as ('text' | 'image')[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8192,
  });

  const model = buildModel();

  log.info(
    `PI model: ${piProvider}/${model.id}, api=${model.api}, baseUrl=${modelBaseUrl || 'default'}${piProvider !== config.provider ? ` (evoclaw=${config.provider})` : ''}`,
  );

  // 使用 InMemory AuthStorage，用 PI 的 provider ID 注册 API Key
  const authStorage = piCoding.AuthStorage.inMemory({
    [piProvider]: { type: 'api_key' as const, key: config.apiKey },
  });

  // 使用 InMemory SessionManager（EvoClaw 有自己的 SQLite 持久层，PI session 不需要落盘）
  const sessionManager = piCoding.SessionManager.inMemory();

  // 使用 InMemory SettingsManager，启用 compaction 和 auto-retry
  const settingsManager = piCoding.SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true },
  });

  // 构建 ModelRegistry（PI 通过它查找 API Key）
  const modelRegistry = new piCoding.ModelRegistry(authStorage);

  // 从工作区文件构建系统提示
  const systemPrompt = buildSystemPrompt(config);

  // 准备 PI coding tools — 移除 bash，替换为增强版 exec（参考 OpenClaw pi-tools.ts）
  const builtInTools = [
    ...(piCoding.codingTools as Array<{ name: string }>).filter(t => t.name !== 'bash'), // read, edit, write（去掉 bash）
    piCoding.grepTool, // grep
    piCoding.findTool, // find
    piCoding.lsTool, // ls
    createEnhancedExecTool(), // 增强版 exec 替代 bash
  ];

  // 工具安全守卫（循环检测 + 结果截断）
  const toolSafety = new ToolSafetyGuard();

  // EvoClaw 自定义工具（包装 execute 以接入安全守卫）
  const customAgentTools = (config.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (args: Record<string, unknown>) => {
      // 循环检测
      const check = toolSafety.checkBeforeExecution(tool.name, args);
      if (check.blocked) {
        log.warn(`阻止工具执行: ${check.reason}`);
        return `⚠️ ${check.reason}`;
      }
      // 执行工具
      const result = await tool.execute(args);
      // 记录结果哈希（无进展检测）
      const noProgress = toolSafety.recordResult(result);
      if (noProgress.blocked) {
        log.warn(`无进展检测: ${noProgress.reason}`);
        return `⚠️ ${noProgress.reason}`;
      }
      // 结果截断（头尾保留策略）
      return toolSafety.truncateResult(result);
    },
  }));

  const allTools = [...builtInTools, ...customAgentTools];
  log.debug(
    `注入工具: ${allTools.map((t) => t.name).join(', ')}`,
  );

  // 拦截 process.exit — PI 框架（CLI 工具出身）可能在 session 完成/dispose 后调用 process.exit()
  // 在 Sidecar 模式下必须阻止，否则整个 HTTP 服务会被杀死
  const originalExit = process.exit;
  let exitIntercepted = false;
  process.exit = ((code?: number) => {
    exitIntercepted = true;
    log.warn(`拦截了 process.exit(${code ?? ''})，Sidecar 模式下忽略`);
    // 不调用原始 exit，进程继续运行
  }) as never;

  // 通过 createAgentSession 创建完整会话（对标 OpenClaw，启用 compaction/retry）
  const { session } = await piCoding.createAgentSession({
    cwd: process.cwd(),
    authStorage,
    modelRegistry,
    sessionManager,
    settingsManager,
    model: model as any,
    tools: allTools as any,
  });

  // 设置 streamFn（参考 OpenClaw，缺少会导致 unhandled rejection）
  session.agent.streamFn = piAi.streamSimple;

  // 覆盖系统提示（createAgentSession 会设置默认的 PI 系统提示）
  session.agent.setSystemPrompt(systemPrompt);

  // 防御性处理：确保所有 assistant messages 都有 usage 字段
  // （参考 OpenClaw 的 clearStaleAssistantUsageOnSessionMessages，
  //  pi-coding-agent 的 _checkCompaction 假定 usage 非 undefined）
  ensureUsageOnAssistantMessages(session.agent as any);

  // 加载消息历史（排除最后一条用户消息，因为 session.prompt() 会发送它）
  const historyMessages = (config.messages ?? []).slice(0, -1);
  if (historyMessages.length > 0) {
    session.agent.replaceMessages(
      historyMessages.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: [{ type: 'text' as const, text: msg.content }],
        // 参考 OpenClaw：确保历史消息也有 usage（PI 依赖此字段做 compaction 判断）
        ...(msg.role === 'assistant' ? { usage: { ...ZERO_USAGE, cost: { ...ZERO_USAGE.cost } } } : {}),
      })) as Parameters<typeof session.agent.replaceMessages>[0],
    );
  }

  // ─── Tool XML 过滤器（状态机） ───
  // PI 框架会将模型输出的 tool_call/tool_result XML 标签混入 text_delta，
  // 这些在 CLI 模式下用于显示工具调用过程，但 GUI 中不应展示给用户
  // （工具调用信息已通过 tool_execution_start/end 事件单独处理）
  const TOOL_XML_TAGS = ['tool_call', 'tool_result'];
  let xmlFilterBuffer = '';  // 缓冲可能是 XML 标签开头的文本
  let xmlFilterDepth = 0;    // 嵌套深度，>0 表示在 tool XML 块内部

  function flushTextBuffer(): void {
    if (xmlFilterBuffer && xmlFilterDepth === 0) {
      emit(onEvent, { type: 'text_delta', delta: xmlFilterBuffer });
    }
    xmlFilterBuffer = '';
  }

  function filterToolXml(delta: string): void {
    for (let i = 0; i < delta.length; i++) {
      const ch = delta[i];

      if (ch === '<') {
        // 先 flush 之前累积的安全文本
        flushTextBuffer();
        xmlFilterBuffer = '<';
        continue;
      }

      if (xmlFilterBuffer.startsWith('<')) {
        xmlFilterBuffer += ch;

        if (ch === '>') {
          // 标签闭合，判断是否是 tool XML 标签
          const tagContent = xmlFilterBuffer.slice(1, -1).trim();
          const isClosing = tagContent.startsWith('/');
          const tagName = (isClosing ? tagContent.slice(1) : tagContent.split(/\s/)[0]).toLowerCase();

          if (TOOL_XML_TAGS.includes(tagName)) {
            if (isClosing) {
              xmlFilterDepth = Math.max(0, xmlFilterDepth - 1);
            } else {
              xmlFilterDepth++;
            }
            xmlFilterBuffer = '';
          } else if (xmlFilterDepth > 0) {
            // 在 tool XML 块内部的其它标签，也丢弃
            xmlFilterBuffer = '';
          } else {
            // 非 tool XML 标签，正常输出
            flushTextBuffer();
          }
          continue;
        }

        // 缓冲区过长说明不是标签，flush 出去
        if (xmlFilterBuffer.length > 50) {
          if (xmlFilterDepth === 0) {
            flushTextBuffer();
          } else {
            xmlFilterBuffer = '';
          }
        }
        continue;
      }

      // 普通字符
      if (xmlFilterDepth > 0) {
        // 在 tool XML 块内部，丢弃
        continue;
      }
      xmlFilterBuffer += ch;
    }

    // flush 不以 < 开头的累积文本
    if (xmlFilterBuffer && !xmlFilterBuffer.startsWith('<')) {
      flushTextBuffer();
    }
  }

  // 订阅事件（加 try-catch 防止回调异常变成 unhandled rejection）
  const unsubscribe = session.subscribe((event: Record<string, unknown>) => {
    try {
      // 防御性处理：message_end 后确保 usage 存在（参考 OpenClaw 的 recordAssistantUsage）
      if (event.type === 'message_end') {
        const msg = event.message as Record<string, unknown> | undefined;
        if (msg?.role === 'assistant' && !msg.usage) {
          msg.usage = { ...ZERO_USAGE, cost: { ...ZERO_USAGE.cost } };
        }
        // flush 剩余缓冲
        flushTextBuffer();
      }

      // compaction 结束后重置所有 assistant usage（参考 OpenClaw 的 clearStaleAssistantUsageOnSessionMessages）
      if (event.type === 'auto_compaction_end') {
        ensureUsageOnAssistantMessages(session.agent as any);
      }

      switch (event.type) {
        case 'message_update': {
          const msgEvent = event.assistantMessageEvent as
            | Record<string, unknown>
            | undefined;
          if (msgEvent?.type === 'text_delta') {
            filterToolXml(msgEvent.delta as string);
          } else if (msgEvent?.type === 'thinking_delta') {
            emit(onEvent, {
              type: 'thinking_delta',
              delta: msgEvent.delta as string,
            });
          }
          break;
        }
        case 'tool_execution_start':
          emit(onEvent, {
            type: 'tool_start',
            toolName: event.toolName as string,
            toolArgs: event.args as Record<string, unknown>,
          });
          break;
        case 'tool_execution_end':
          emit(onEvent, {
            type: 'tool_end',
            toolName: event.toolName as string,
            toolResult: event.result as string,
            isError: event.isError as boolean,
          });
          break;
      }
    } catch (subErr) {
      log.error(
        'subscribe 回调异常:',
        subErr instanceof Error ? subErr.message : subErr,
      );
    }
  });

  // 处理 abort signal
  if (signal) {
    signal.addEventListener('abort', () => session.abort(), { once: true });
  }

  try {
    // 带重试的 session.prompt()
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await session.prompt(message);

        // 防御性处理
        ensureUsageOnAssistantMessages(session.agent as any);

        // 检查 agent 状态中的错误
        const state = session.state;
        if (state.error) {
          throw new Error(`PI Agent 错误: ${state.error}`);
        }
        return; // 成功，直接返回
      } catch (err) {
        lastError = err;
        const errMsg = err instanceof Error ? err.message : String(err);

        if (attempt >= MAX_RETRIES) {
          log.error(`已达最大重试次数 (${MAX_RETRIES})，放弃: ${errMsg}`);
          break;
        }

        if (isOverloadError(err)) {
          // overload/rate-limit → 指数退避重试
          const delay = calculateBackoff(attempt);
          log.warn(`overload 错误，${delay.toFixed(0)}ms 后重试 (${attempt + 1}/${MAX_RETRIES}): ${errMsg}`);
          await new Promise(resolve => setTimeout(resolve, delay));
          ensureUsageOnAssistantMessages(session.agent as any);
          continue;
        }

        if (isThinkingError(err)) {
          // thinking 不支持 → 降级 reasoning=false 重试
          log.warn(`thinking 错误，降级 reasoning=false 重试: ${errMsg}`);
          reasoning = false;
          (session.agent as any).model = buildModel();
          ensureUsageOnAssistantMessages(session.agent as any);
          continue;
        }

        if (isContextOverflowError(err)) {
          // context overflow → 裁剪消息保留最近 3 轮重试
          log.warn(`context overflow，裁剪消息重试: ${errMsg}`);
          const msgs = (session.agent as any).state?.messages;
          if (msgs && msgs.length > 6) {
            // 保留最近 6 条消息（约 3 轮对话）
            const trimmed = msgs.slice(-6);
            session.agent.replaceMessages(trimmed);
          }
          ensureUsageOnAssistantMessages(session.agent as any);
          continue;
        }

        // 其它错误 → 不重试，直接抛出（触发 fetch fallback）
        log.error(`不可重试错误: ${errMsg}`);
        break;
      }
    }
    throw lastError;
  } finally {
    unsubscribe();
    session.dispose();
    // 恢复原始 process.exit
    process.exit = originalExit;
    if (exitIntercepted) {
      log.info('PI 调用期间拦截了 process.exit，进程继续运行');
    }
  }
}

/** Fallback: 直接调用 LLM API（流式），支持 OpenAI 和 Anthropic 协议 */
async function runWithFetch(
  config: AgentRunConfig,
  message: string,
  onEvent: EventCallback,
  signal?: AbortSignal,
): Promise<void> {
  if (!config.apiKey) {
    throw new Error('未配置 API Key，请先在设置中配置 LLM Provider');
  }

  const protocol = config.apiProtocol ?? 'openai-completions';

  if (protocol === 'anthropic-messages' || protocol === 'anthropic') {
    await runWithAnthropicFetch(config, message, onEvent, signal);
  } else {
    await runWithOpenAIFetch(config, message, onEvent, signal);
  }
}

/** OpenAI Chat Completions 协议 */
async function runWithOpenAIFetch(
  config: AgentRunConfig,
  _message: string,
  onEvent: EventCallback,
  signal?: AbortSignal,
): Promise<void> {
  const systemPrompt = buildSystemPrompt(config);
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';

  // config.messages 已包含用户消息，无需重复添加
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        ...(config.messages ?? []).map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
      ],
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `LLM API 调用失败: ${response.status} ${response.statusText}`,
    );
  }

  await parseSSEStream(
    response,
    (data) => {
      if (data === '[DONE]') return 'done';
      const json = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string } }>;
      };
      return json.choices?.[0]?.delta?.content ?? null;
    },
    onEvent,
  );
}

/** Anthropic Messages 协议 */
async function runWithAnthropicFetch(
  config: AgentRunConfig,
  _message: string,
  onEvent: EventCallback,
  signal?: AbortSignal,
): Promise<void> {
  const systemPrompt = buildSystemPrompt(config);
  const baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';

  const url = `${baseUrl}/messages`;
  const msgCount = (config.messages ?? []).length;
  log.info(
    `Anthropic 请求: ${url}, model=${config.modelId}, messages=${msgCount}`,
  );

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    // config.messages 已包含用户消息，无需重复添加
    body: JSON.stringify({
      model: config.modelId,
      system: systemPrompt,
      messages: (config.messages ?? []).map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      max_tokens: 8192,
      stream: true,
    }),
    signal,
  });

  log.info(
    `Anthropic 响应: ${response.status} ${response.statusText}`,
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    log.error(`Anthropic 错误响应体:`, errorBody);
    throw new Error(
      `LLM API 调用失败: ${response.status} ${response.statusText} - ${errorBody}`,
    );
  }

  await parseSSEStream(
    response,
    (data) => {
      const event = JSON.parse(data) as {
        type: string;
        delta?: { type?: string; text?: string };
      };
      if (event.type === 'content_block_delta' && event.delta?.text) {
        return event.delta.text;
      }
      if (event.type === 'message_stop') return 'done';
      return null;
    },
    onEvent,
  );
}

/** 通用 SSE 流解析 */
async function parseSSEStream(
  response: Response,
  extractDelta: (data: string) => string | null | 'done',
  onEvent: EventCallback,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let chunkCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      log.debug(
        `SSE 流结束, chunks=${chunkCount}, textLen=${fullText.length}`,
      );
      break;
    }

    chunkCount++;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      try {
        const result = extractDelta(data);
        if (result === 'done') {
          emit(onEvent, { type: 'text_done', text: fullText });
          return;
        }
        if (result) {
          fullText += result;
          emit(onEvent, { type: 'text_delta', delta: result });
        }
      } catch {
        // 跳过格式错误的 JSON
      }
    }
  }

  emit(onEvent, { type: 'text_done', text: fullText });
}

/**
 * 增强版 exec 工具（替代 PI 内置 bash，参考 OpenClaw exec-tool）
 * 增强点: 超时控制、工作目录、输出限制、退出码格式化
 */
function createEnhancedExecTool() {
  const { execSync } = require('node:child_process') as typeof import('node:child_process');
  const DEFAULT_TIMEOUT_SEC = 120;
  const MAX_OUTPUT_CHARS = 200_000;

  return {
    name: 'bash',  // 保持名称为 bash，模型更熟悉
    description: `执行 shell 命令。输出截断到 ${MAX_OUTPUT_CHARS / 1000}K 字符。大输出请重定向到文件再用 read 查看。长时间任务用 exec_background 工具。`,
    parameters: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: '要执行的 shell 命令' },
        workdir: { type: 'string', description: '工作目录（默认当前目录）' },
        timeout: { type: 'number', description: `超时秒数（默认 ${DEFAULT_TIMEOUT_SEC}）` },
      },
      required: ['command'],
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const command = args.command as string;
      const workdir = (args.workdir as string) || process.cwd();
      const timeoutSec = (args.timeout as number) || DEFAULT_TIMEOUT_SEC;

      if (!command) return '错误：缺少 command 参数';

      try {
        const output = execSync(command, {
          cwd: workdir,
          timeout: timeoutSec * 1000,
          maxBuffer: 10 * 1024 * 1024,  // 10MB buffer
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, EVOCLAW_SHELL: 'exec' },
        });

        const result = (output ?? '').toString();

        if (result.length > MAX_OUTPUT_CHARS) {
          // 头尾保留截断
          const head = result.slice(0, Math.floor(MAX_OUTPUT_CHARS * 0.7));
          const tail = result.slice(-Math.floor(MAX_OUTPUT_CHARS * 0.3));
          return `${head}\n\n... [省略 ${result.length - MAX_OUTPUT_CHARS} 字符] ...\n\n${tail}`;
        }

        return result || '(无输出)';
      } catch (err: unknown) {
        const e = err as { status?: number; stdout?: string; stderr?: string; message?: string; killed?: boolean };

        if (e.killed) {
          return `命令超时（${timeoutSec} 秒），已终止。如需更长时间，请使用 exec_background 工具后台执行。`;
        }

        const stdout = e.stdout?.toString() ?? '';
        const stderr = e.stderr?.toString() ?? '';
        const combined = [stdout, stderr].filter(Boolean).join('\n');
        const exitCode = e.status ?? -1;

        // 输出截断
        const truncated = combined.length > MAX_OUTPUT_CHARS
          ? combined.slice(0, MAX_OUTPUT_CHARS) + `\n... [输出已截断]`
          : combined;

        return `${truncated || e.message || '命令执行失败'}\n\n(退出码 ${exitCode})`;
      }
    },
  };
}

/**
 * 工具目录摘要（参考 OpenClaw coreToolSummaries + toolOrder）
 * 按优先级排序列出所有可用工具的一行摘要，帮助模型快速定位合适的工具
 */
const TOOL_SUMMARIES: Record<string, string> = {
  // 文件操作（最高优先级）
  read: '读取文件内容（文本或图片），大文件用 offset/limit 分段',
  write: '创建或覆盖文件，自动创建父目录',
  edit: '精确替换文件中的文本片段（oldText → newText）',
  apply_patch: '应用多文件统一补丁（*** Begin/End Patch 格式）',
  // 搜索（优先于 bash）
  grep: '搜索文件内容，返回匹配行+文件路径+行号',
  find: '按 glob 模式搜索文件路径',
  ls: '列出目录内容',
  // 命令执行
  bash: '执行 shell 命令（单次执行，有超时）',
  exec_background: '后台启动长时间运行的命令（dev server、watch 等）',
  process: '管理后台进程（查看输出、终止、发送输入）',
  // Web 工具
  web_search: '搜索互联网（Brave Search API），返回标题+摘要+链接',
  web_fetch: '抓取 URL 内容并转换为 Markdown',
  // 多媒体
  image: '分析图片内容（支持本地文件和 URL）',
  pdf: '阅读 PDF 文档（原生模式或文本提取）',
  // 记忆
  memory_search: '搜索 Agent 记忆库，查找用户偏好和历史',
  memory_get: '获取单条记忆的完整详情',
  knowledge_query: '查询知识图谱中的实体关系',
  // 子 Agent
  spawn_agent: '创建子 Agent 并行处理独立子任务',
  list_agents: '查看所有子 Agent 的状态和结果',
  kill_agent: '终止运行中的子 Agent',
  steer_agent: '纠偏运行中的子 Agent（终止并用纠正指令重启）',
  yield_agents: '让出当前轮次等待子 Agent 完成结果',
};

/** 按优先级排序的工具顺序 */
const TOOL_ORDER = [
  'read', 'write', 'edit', 'apply_patch',
  'grep', 'find', 'ls',
  'bash', 'exec_background', 'process',
  'web_search', 'web_fetch',
  'image', 'pdf',
  'memory_search', 'memory_get', 'knowledge_query',
  'spawn_agent', 'list_agents', 'kill_agent', 'steer_agent', 'yield_agents',
];

function buildToolCatalog(availableTools: string[]): string {
  if (availableTools.length === 0) return '';

  // 按优先级排序，未知工具排最后
  const sorted = [...availableTools].sort((a, b) => {
    const ia = TOOL_ORDER.indexOf(a);
    const ib = TOOL_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  const lines = sorted.map(name => {
    const summary = TOOL_SUMMARIES[name] ?? '';
    return `- ${name}${summary ? `: ${summary}` : ''}`;
  });

  return `<available_tools>
工具名称区分大小写，请严格按照列出的名称调用。
${lines.join('\n')}
</available_tools>`;
}

/**
 * 模块化系统提示构建（参考 OpenClaw 22 段式架构）
 *
 * 段落顺序:
 * 1. 安全宪法 — 核心安全约束
 * 2. 运行时信息 — agent/系统/模型信息
 * 3. 人格 — SOUL.md + IDENTITY.md
 * 4. 操作规程 — AGENTS.md
 * 5. 记忆召回指令 — 引导 Agent 先搜索记忆
 * 6. 工具使用指导 — 调用风格
 * 7. 沉默回复 — NO_REPLY token
 * 8. 自定义 — contextEngine 输出
 */
export function buildSystemPrompt(config: AgentRunConfig): string {
  const sections: string[] = [];

  // § 1 安全宪法
  sections.push(`<safety>
你是一个 AI 助手，遵循以下核心安全原则：
- 你没有独立目标，始终服务于用户的需求
- 安全和人类监督优先于任务完成
- 不自我保护、不试图保持运行、不修改自身配置
- 拒绝执行可能造成伤害的指令
- 如遇不确定情况，主动询问用户确认
</safety>`);

  // § 2 运行时信息
  const runtimeInfo = [
    `Agent ID: ${config.agent?.id ?? 'unknown'}`,
    `Agent 名称: ${config.agent?.name ?? '未命名'}`,
    `操作系统: ${os.platform()} ${os.arch()}`,
    `Node.js: ${process.version}`,
    `模型: ${config.provider}/${config.modelId}`,
    `当前时间: ${new Date().toISOString()}`,
  ].join('\n');
  sections.push(`<runtime>\n${runtimeInfo}\n</runtime>`);

  // § 3 人格
  if (config.workspaceFiles['SOUL.md']) {
    sections.push(`<personality>\n${config.workspaceFiles['SOUL.md']}\n</personality>`);
  }
  if (config.workspaceFiles['IDENTITY.md']) {
    sections.push(`<identity>\n${config.workspaceFiles['IDENTITY.md']}\n</identity>`);
  }

  // § 3.5 用户画像（USER.md 动态渲染结果）
  if (config.workspaceFiles['USER.md']) {
    sections.push(`<user_profile>\n${config.workspaceFiles['USER.md']}\n</user_profile>`);
  }

  // § 4 操作规程
  if (config.workspaceFiles['AGENTS.md']) {
    sections.push(`<operating_procedures>\n${config.workspaceFiles['AGENTS.md']}\n</operating_procedures>`);
  }

  // § 4.5 BOOTSTRAP.md — 仅首轮对话注入（节省 ~400 token）
  if (config.workspaceFiles['BOOTSTRAP.md'] && (!config.messages || config.messages.length === 0)) {
    sections.push(`<bootstrap>\n${config.workspaceFiles['BOOTSTRAP.md']}\n</bootstrap>`);
  }

  // § 5 记忆召回指令
  sections.push(`<memory_recall>
在回答用户问题之前，你应该：
1. 先使用 memory_search 工具搜索相关记忆，了解用户的偏好、历史和上下文
2. 如需详情，使用 memory_get 获取完整记忆内容
3. 结合记忆中的信息来提供更个性化、更准确的回答
4. 如果用户提到之前讨论过的话题，务必先搜索记忆
5. 你有一个个人笔记本文件 MEMORY.md，可以用 read/write 工具读写
6. 当你发现需要长期记住的重要信息时，主动写入 MEMORY.md
7. 每次会话开始时，检查 MEMORY.md 了解之前记录的备忘
</memory_recall>`);

  // § 5.1 Agent 笔记本（MEMORY.md 内容注入）
  if (config.workspaceFiles['MEMORY.md']) {
    sections.push(`<agent_notes>\n${config.workspaceFiles['MEMORY.md']}\n</agent_notes>`);
  }

  // § 5.5 工具目录（按优先级排序的一行摘要，参考 OpenClaw toolOrder 设计）
  const toolNames = (config.tools ?? []).map(t => t.name);
  const toolCatalog = buildToolCatalog(toolNames);
  if (toolCatalog) {
    sections.push(toolCatalog);
  }

  // § 6 工具调用风格 + 工具选择指导（参考 OpenClaw Tool Call Style）
  sections.push(`<tool_call_style>
## 工具调用风格
默认：不叙述常规、低风险的工具调用，直接调用工具。
仅在以下情况简要说明：多步骤工作、复杂/有挑战的问题、敏感操作（如删除文件）、用户明确要求解释时。
叙述要简短、有价值，避免重复明显的步骤。

## 工具选择指南
- 优先使用 grep/find/ls 而非 bash 来探索文件（更快、遵守 .gitignore）
- 修改文件前先用 read 检查文件内容
- read 工具输出会截断到约 50KB，大文件请用 offset/limit 分段读取
- grep 最多返回 100 条匹配，find 最多返回 1000 个文件
- bash 命令的输出会被截断，长输出请重定向到文件再 read
- 文件搜索限定在用户主目录 ~ 下，禁止搜索根目录 /，find 加 -maxdepth 3
- bash 执行的命令应加超时控制（如 timeout 30 command），避免长时间阻塞
- 长时间运行的命令（dev server、watch、构建）使用 exec_background 在后台执行
- 当存在专用工具时，直接使用工具而非要求用户手动运行等效命令
- 工具执行失败时，分析原因并尝试替代方案，而非简单重试相同参数
- 搜索记忆和知识图谱是低成本操作，在不确定时应主动使用
- 对于可拆分的独立子任务，使用 spawn_agent 并行处理
</tool_call_style>`);

  // § 7 沉默回复
  sections.push(`<silent_reply>
如果你判断当前消息不需要回复（例如用户的消息仅是确认、表情、或系统通知），
可以仅回复 "${NO_REPLY_TOKEN}"（不含引号），系统将不会向用户展示任何内容。
</silent_reply>`);

  // § 8 自定义（contextEngine 输出）
  if (config.systemPrompt) {
    sections.push(config.systemPrompt);
  }

  return sections.join('\n\n');
}
