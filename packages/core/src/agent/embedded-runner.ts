import type { AgentRunConfig, RuntimeEvent } from './types.js';

type EventCallback = (event: RuntimeEvent) => void;

function emit(cb: EventCallback, event: Omit<RuntimeEvent, 'timestamp'>): void {
  cb({ ...event, timestamp: Date.now() } as RuntimeEvent);
}

/**
 * 运行嵌入式 Agent
 * 尝试使用 PI 框架，如果未安装则使用 OpenAI 兼容的直接调用
 */
export async function runEmbeddedAgent(
  config: AgentRunConfig,
  message: string,
  onEvent: EventCallback,
  abortSignal?: AbortSignal,
): Promise<void> {
  emit(onEvent, { type: 'agent_start' });

  try {
    // 尝试 PI 框架路径（带 30s 超时防止挂起）
    console.log(`[embedded-runner] 尝试 PI 框架 (provider=${config.provider}, model=${config.modelId})`);
    await Promise.race([
      runWithPI(config, message, onEvent, abortSignal),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('PI 超时 (30s)')), 30_000)),
    ]);
    console.log('[embedded-runner] PI 调用完成');
  } catch (piError) {
    // 回退: 直接调用 LLM API
    console.log(`[embedded-runner] PI 失败: ${piError instanceof Error ? piError.message : String(piError)}`);
    console.log(`[embedded-runner] 使用 fetch fallback (provider=${config.provider}, model=${config.modelId}, protocol=${config.apiProtocol}, baseUrl=${config.baseUrl})`);
    try {
      await runWithFetch(config, message, onEvent, abortSignal);
      console.log('[embedded-runner] fetch fallback 完成');
    } catch (fetchError) {
      console.error('[embedded-runner] fetch fallback 失败:', fetchError);
      emit(onEvent, { type: 'error', error: String(fetchError) });
    }
  }

  emit(onEvent, { type: 'agent_done' });
}

/** PI 框架运行路径 */
async function runWithPI(
  config: AgentRunConfig,
  message: string,
  onEvent: EventCallback,
  signal?: AbortSignal,
): Promise<void> {
  // 动态 import PI 包 — 未安装时会抛出错误，触发 fallback
  const piAi = await import('@mariozechner/pi-ai');
  const piCore = await import('@mariozechner/pi-agent-core');

  // 验证 API key 存在（PI 框架缺少 key 时会产生 unhandled rejection）
  if (!config.apiKey) {
    throw new Error('PI 运行需要 API key');
  }

  // PI 框架通过环境变量读取 API Key，需要在调用前注入
  const envKeyMap: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GOOGLE_API_KEY',
  };
  const envKey = envKeyMap[config.provider] ?? `${config.provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
  const prevEnvVal = process.env[envKey];
  process.env[envKey] = config.apiKey;
  // 同时设置 base URL（自定义端点）
  const prevBaseUrl = config.baseUrl ? process.env[`${config.provider.toUpperCase().replace(/-/g, '_')}_BASE_URL`] : undefined;
  if (config.baseUrl) {
    const baseUrlKey = `${config.provider.toUpperCase().replace(/-/g, '_')}_BASE_URL`;
    process.env[baseUrlKey] = config.baseUrl;
  }

  // 注册内置 API providers（确保 PI 知道 anthropic/openai/google 等）
  piAi.registerBuiltInApiProviders();

  const model = piAi.getModel(config.provider, config.modelId);
  if (!model) {
    throw new Error(`PI getModel 失败: provider=${config.provider}, model=${config.modelId}`);
  }
  console.log(`[embedded-runner] PI model 解析成功: ${model.provider}/${model.id}`);

  // 从工作区文件构建系统提示
  const systemPrompt = buildSystemPrompt(config);

  // 构建 PI 工具列表
  const piTools = (config.tools ?? []).map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: tool.execute,
  }));

  // 创建 Agent 并通过 setter 配置
  const agent = new piCore.Agent();
  agent.setSystemPrompt(systemPrompt);
  agent.setModel(model);
  if (piTools.length > 0) {
    agent.setTools(piTools as Parameters<typeof agent.setTools>[0]);
  }

  // 加载消息历史（排除最后一条用户消息，因为 prompt() 会发送它）
  const historyMessages = (config.messages ?? []).slice(0, -1);
  if (historyMessages.length > 0) {
    agent.replaceMessages(historyMessages.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: [{ type: 'text' as const, text: msg.content }],
    })) as Parameters<typeof agent.replaceMessages>[0]);
  }

  // 订阅事件
  const unsubscribe = agent.subscribe((event: Record<string, unknown>) => {
    switch (event.type) {
      case 'message_update': {
        const msgEvent = event.assistantMessageEvent as Record<string, unknown> | undefined;
        if (msgEvent?.type === 'text_delta') {
          emit(onEvent, { type: 'text_delta', delta: msgEvent.delta as string });
        } else if (msgEvent?.type === 'thinking_delta') {
          emit(onEvent, { type: 'thinking_delta', delta: msgEvent.delta as string });
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
  });

  // 处理 abort signal
  if (signal) {
    signal.addEventListener('abort', () => agent.abort(), { once: true });
  }

  try {
    await agent.prompt(message);
    // 等待 agent 处理完成
    await agent.waitForIdle();
    // PI 静默吞错误，需要主动检查
    const stateError = (agent as unknown as { state: { error?: string } }).state.error;
    if (stateError) {
      throw new Error(`PI Agent 错误: ${stateError}`);
    }
  } finally {
    unsubscribe();
    // 恢复环境变量
    if (prevEnvVal === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = prevEnvVal;
    }
    if (config.baseUrl) {
      const baseUrlKey = `${config.provider.toUpperCase().replace(/-/g, '_')}_BASE_URL`;
      if (prevBaseUrl === undefined) {
        delete process.env[baseUrlKey];
      } else {
        process.env[baseUrlKey] = prevBaseUrl;
      }
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
  message: string,
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
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        ...(config.messages ?? []).map(msg => ({ role: msg.role, content: msg.content })),
      ],
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`LLM API 调用失败: ${response.status} ${response.statusText}`);
  }

  await parseSSEStream(response, (data) => {
    if (data === '[DONE]') return 'done';
    const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
    return json.choices?.[0]?.delta?.content ?? null;
  }, onEvent);
}

/** Anthropic Messages 协议 */
async function runWithAnthropicFetch(
  config: AgentRunConfig,
  message: string,
  onEvent: EventCallback,
  signal?: AbortSignal,
): Promise<void> {
  const systemPrompt = buildSystemPrompt(config);
  const baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';

  const url = `${baseUrl}/messages`;
  const msgCount = (config.messages ?? []).length;
  console.log(`[embedded-runner] Anthropic 请求: ${url}, model=${config.modelId}, messages=${msgCount}`);

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
      messages: (config.messages ?? []).map(msg => ({ role: msg.role, content: msg.content })),
      max_tokens: 8192,
      stream: true,
    }),
    signal,
  });

  console.log(`[embedded-runner] Anthropic 响应: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    console.error(`[embedded-runner] Anthropic 错误响应体:`, errorBody);
    throw new Error(`LLM API 调用失败: ${response.status} ${response.statusText} - ${errorBody}`);
  }

  await parseSSEStream(response, (data) => {
    const event = JSON.parse(data) as {
      type: string;
      delta?: { type?: string; text?: string };
    };
    if (event.type === 'content_block_delta' && event.delta?.text) {
      return event.delta.text;
    }
    if (event.type === 'message_stop') return 'done';
    return null;
  }, onEvent);
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
      console.log(`[embedded-runner] SSE 流结束, chunks=${chunkCount}, textLen=${fullText.length}`);
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

/** 从工作区文件构建系统提示 */
export function buildSystemPrompt(config: AgentRunConfig): string {
  const parts: string[] = [];

  if (config.workspaceFiles['SOUL.md']) {
    parts.push(config.workspaceFiles['SOUL.md']);
  }
  if (config.workspaceFiles['IDENTITY.md']) {
    parts.push(config.workspaceFiles['IDENTITY.md']);
  }
  if (config.workspaceFiles['AGENTS.md']) {
    parts.push(config.workspaceFiles['AGENTS.md']);
  }
  if (config.systemPrompt) {
    parts.push(config.systemPrompt);
  }

  return parts.join('\n\n---\n\n');
}
