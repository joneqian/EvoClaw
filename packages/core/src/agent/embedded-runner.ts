import os from 'node:os';
import type { AgentRunConfig, RuntimeEvent } from './types.js';
import { toPIProvider } from '../provider/pi-provider-map.js';

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
    console.log('[embedded-runner] 开始运行 PI');
    await Promise.race([
      runWithPI(config, message, onEvent, abortSignal),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('PI 超时 (120s)')), 120_000),
      ),
    ]);
    console.log('[embedded-runner] PI 调用完成');
  } catch (piError) {
    const piMsg = piError instanceof Error ? piError.message : String(piError);
    console.log(`[embedded-runner] PI 失败: ${piMsg}`);
    console.log(
      `[embedded-runner] 回退 fetch (protocol=${config.apiProtocol}, baseUrl=${config.baseUrl})`,
    );
    try {
      await runWithFetch(config, message, onEvent, abortSignal);
      console.log('[embedded-runner] fetch 完成');
    } catch (fetchError) {
      console.error('[embedded-runner] fetch 失败:', fetchError);
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

  console.log(
    `[embedded-runner] PI model: ${piProvider}/${model.id}, api=${model.api}, baseUrl=${modelBaseUrl || 'default'}${piProvider !== config.provider ? ` (evoclaw=${config.provider})` : ''}`,
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

  // 准备 PI coding tools（全部 7 个内置工具）
  const builtInTools = [
    ...piCoding.codingTools, // read, bash, edit, write
    piCoding.grepTool, // grep
    piCoding.findTool, // find
    piCoding.lsTool, // ls
  ];

  // EvoClaw 自定义工具
  const customAgentTools = (config.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: tool.execute,
  }));

  const allTools = [...builtInTools, ...customAgentTools];
  console.log(
    `[embedded-runner] 注入工具: ${allTools.map((t) => t.name).join(', ')}`,
  );

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

  // 订阅事件（加 try-catch 防止回调异常变成 unhandled rejection）
  const unsubscribe = session.subscribe((event: Record<string, unknown>) => {
    try {
      // 防御性处理：message_end 后确保 usage 存在（参考 OpenClaw 的 recordAssistantUsage）
      if (event.type === 'message_end') {
        const msg = event.message as Record<string, unknown> | undefined;
        if (msg?.role === 'assistant' && !msg.usage) {
          msg.usage = { ...ZERO_USAGE, cost: { ...ZERO_USAGE.cost } };
        }
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
            emit(onEvent, {
              type: 'text_delta',
              delta: msgEvent.delta as string,
            });
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
      console.error(
        '[embedded-runner] subscribe 回调异常:',
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
          console.error(`[embedded-runner] 已达最大重试次数 (${MAX_RETRIES})，放弃: ${errMsg}`);
          break;
        }

        if (isOverloadError(err)) {
          // overload/rate-limit → 指数退避重试
          const delay = calculateBackoff(attempt);
          console.log(`[embedded-runner] overload 错误，${delay.toFixed(0)}ms 后重试 (${attempt + 1}/${MAX_RETRIES}): ${errMsg}`);
          await new Promise(resolve => setTimeout(resolve, delay));
          ensureUsageOnAssistantMessages(session.agent as any);
          continue;
        }

        if (isThinkingError(err)) {
          // thinking 不支持 → 降级 reasoning=false 重试
          console.log(`[embedded-runner] thinking 错误，降级 reasoning=false 重试: ${errMsg}`);
          reasoning = false;
          (session.agent as any).model = buildModel();
          ensureUsageOnAssistantMessages(session.agent as any);
          continue;
        }

        if (isContextOverflowError(err)) {
          // context overflow → 裁剪消息保留最近 3 轮重试
          console.log(`[embedded-runner] context overflow，裁剪消息重试: ${errMsg}`);
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
        console.log(`[embedded-runner] 不可重试错误: ${errMsg}`);
        break;
      }
    }
    throw lastError;
  } finally {
    unsubscribe();
    session.dispose();
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
  console.log(
    `[embedded-runner] Anthropic 请求: ${url}, model=${config.modelId}, messages=${msgCount}`,
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

  console.log(
    `[embedded-runner] Anthropic 响应: ${response.status} ${response.statusText}`,
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    console.error(`[embedded-runner] Anthropic 错误响应体:`, errorBody);
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
      console.log(
        `[embedded-runner] SSE 流结束, chunks=${chunkCount}, textLen=${fullText.length}`,
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

  // § 4 操作规程
  if (config.workspaceFiles['AGENTS.md']) {
    sections.push(`<operating_procedures>\n${config.workspaceFiles['AGENTS.md']}\n</operating_procedures>`);
  }

  // § 5 记忆召回指令
  sections.push(`<memory_recall>
在回答用户问题之前，你应该：
1. 先使用 memory_search 工具搜索相关记忆，了解用户的偏好、历史和上下文
2. 如需详情，使用 memory_get 获取完整记忆内容
3. 结合记忆中的信息来提供更个性化、更准确的回答
4. 如果用户提到之前讨论过的话题，务必先搜索记忆
</memory_recall>`);

  // § 6 工具使用指导
  sections.push(`<tool_usage>
工具调用规范：
- 默认静默调用工具，不需要向用户解释每一步操作
- 对于复杂或有风险的操作，先简要说明再执行
- 工具执行失败时，分析原因并尝试替代方案，而非简单重试
- 搜索记忆和知识图谱是低成本操作，在不确定时应主动使用
</tool_usage>`);

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
