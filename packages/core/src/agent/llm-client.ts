/**
 * LLM Client — 非流式一次性调用工具
 *
 * 用于 Agent 工作区文件生成等后台任务，不需要流式输出的场景。
 *
 * 提供两级调用：
 * - callLLM：使用默认（主）模型
 * - callLLMSecondary：使用同 Provider 最便宜的模型，用于摘要/提取等辅助任务
 */

import type { ConfigManager } from '../infrastructure/config-manager.js';
import { createLogger } from '../infrastructure/logger.js';
import { markKeyFailed, type KeyFailureReason } from '../infrastructure/provider-key-state.js';

const log = createLogger('llm-client');

/** M6 T1: HTTP status → 失败原因映射 */
function classifyHttpError(status: number): KeyFailureReason {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status === 503 || status === 502 || status === 504) return 'service-unavailable';
  return 'unknown';
}

/** M6 T1: LLM HTTP 错误类 — 携带 status，上层可判断是否需要 failover */
export class LLMHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'LLMHttpError';
  }
}

/** M6 T1: 哪些状态码会触发 failover 重试 */
function isRetriableStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * M6 T1: Provider 凭据池 failover 通用包装
 *
 * 若 task 抛 LLMHttpError 且状态码可重试、且走的是 pool（keyId 非 null）、
 * 且本次调用尚未重试过，则调 markKeyFailed 并用下一把 key 重试一次。
 *
 * 最多重试 1 次（同一调用中总共最多尝试 2 把 key）。
 */
async function withProviderFailover<T>(
  configManager: ConfigManager,
  providerId: string,
  task: (apiKey: string, keyId: string | null) => Promise<T>,
): Promise<T> {
  let lastKeyId: string | undefined;
  let attempt = 0;
  // 第一次正常调；若 HTTP 错误可重试且走的是 pool，至多重试 1 次
  while (true) {
    const { apiKey, keyId } = configManager.resolveProviderCredential(providerId, lastKeyId);
    if (!apiKey) throw new Error('LLM 未配置：未找到可用的 API Key');
    try {
      return await task(apiKey, keyId);
    } catch (err) {
      if (!(err instanceof LLMHttpError) || !keyId || !isRetriableStatus(err.status)) throw err;
      const reason = classifyHttpError(err.status);
      // 无论是否继续重试，先标记本把 key 失败
      markKeyFailed(providerId, keyId, reason);
      if (attempt >= 1) {
        // 已用过备 key，仍失败 → 抛出
        log.warn(`[failover] provider=${providerId} keyId=${keyId} status=${err.status} reason=${reason}，备 key 也失败，放弃`);
        throw err;
      }
      log.warn(`[failover] provider=${providerId} keyId=${keyId} status=${err.status} reason=${reason}，尝试下一把 key`);
      lastKeyId = keyId;
      attempt++;
    }
  }
}

// ── 二级模型 — Provider→最便宜模型的 hardcoded fallback ──

/** 已知 Provider 的低成本模型映射（当 models 列表无 cost 信息时使用） */
const SECONDARY_MODEL_FALLBACK: Record<string, string> = {
  // Anthropic — Haiku 4.5 ($1/M input)
  anthropic: 'claude-haiku-4-5-20251001',
  // OpenAI — GPT-4.1 Nano ($0.10/M input，比 gpt-4o-mini 更便宜)
  openai: 'gpt-4.1-nano',
  // 国产模型
  qwen: 'qwen-turbo-latest',                // 通义千问 Turbo (~¥0.3/M input)
  doubao: 'doubao-seed-2-0-mini-260215',     // 豆包 Seed 2.0 Mini (~¥0.2/M input)
  glm: 'glm-4-flash-250414',                // 智谱 GLM-4 Flash (免费额度)
  deepseek: 'deepseek-v4-flash',             // DeepSeek V4 Flash (¥1/M input，缓存命中 ¥0.2/M)
  minimax: 'MiniMax-M2.5',                   // MiniMax M2.5 ($0.12/M input)
  moonshot: 'kimi-k2-turbo-preview',         // 月之暗面 Kimi K2 Turbo ($0.39/M input)
  zhipu: 'glm-4-flash-250414',              // 同 glm
};

export interface LLMCallOptions {
  systemPrompt: string;
  userMessage: string;
  /** 可选：最大 token 数（默认 4096） */
  maxTokens?: number;
  /** 可选：fetch 超时毫秒数（默认 60_000）。reasoning 模型 + 大输出可能需要更长，例如 SOP 标签生成传 300_000 */
  timeoutMs?: number;
}

/** 默认 fetch 超时（60s），调用方可通过 LLMCallOptions.timeoutMs 覆盖 */
const DEFAULT_LLM_TIMEOUT_MS = 60_000;

/**
 * 非流式调用 LLM — 从 ConfigManager 解析默认模型的 API Key、Base URL、协议
 *
 * M6 T1: 若 Provider 配置了 credentialPool，首次失败（401/403/429/503）时
 *        自动 markKeyFailed 并用下一把 key 重试一次。
 */
export async function callLLM(
  configManager: ConfigManager,
  options: LLMCallOptions,
): Promise<string> {
  const providerId = configManager.getDefaultProvider();
  const baseUrl = configManager.getDefaultBaseUrl();
  const modelId = configManager.getDefaultModelId();
  const protocol = configManager.getDefaultApi();

  if (!providerId || !baseUrl || !modelId) {
    throw new Error('LLM 未配置：请先在设置中配置 Provider 和模型');
  }

  const maxTokens = options.maxTokens ?? 4096;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;

  return withProviderFailover(configManager, providerId, async (apiKey, keyId) => {
    log.info(`调用 LLM: model=${modelId} protocol=${protocol} baseUrl=${baseUrl}${keyId ? ` keyId=${keyId}` : ''} timeoutMs=${timeoutMs}`);
    if (protocol === 'anthropic-messages' || protocol === 'anthropic') {
      const anthropicUrl = /\/v1\/?$/.test(baseUrl) ? baseUrl.replace(/\/+$/, '') : `${baseUrl.replace(/\/+$/, '')}/v1`;
      return callAnthropic(anthropicUrl, apiKey, modelId, options.systemPrompt, options.userMessage, maxTokens, timeoutMs);
    }
    return callOpenAI(baseUrl, apiKey, modelId, options.systemPrompt, options.userMessage, maxTokens, timeoutMs);
  });
}

/**
 * 使用二级（低成本）模型调用 LLM
 *
 * 选择策略（按优先级）：
 * 1. 同 Provider models 列表中 cost.input 最低的模型（排除主模型自身）
 * 2. hardcoded Provider→便宜模型映射
 * 3. 降级到默认模型
 */
export async function callLLMSecondary(
  configManager: ConfigManager,
  options: LLMCallOptions,
): Promise<string> {
  const provider = configManager.getDefaultProvider();
  const baseUrl = configManager.getDefaultBaseUrl();
  const protocol = configManager.getDefaultApi();
  const primaryModelId = configManager.getDefaultModelId();

  if (!provider || !baseUrl || !primaryModelId) {
    throw new Error('LLM 未配置：请先在设置中配置 Provider 和模型');
  }

  const secondaryModelId = resolveSecondaryModelId(configManager, provider, primaryModelId);
  const maxTokens = options.maxTokens ?? 4096;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;

  return withProviderFailover(configManager, provider, async (apiKey, keyId) => {
    log.info(`调用 LLM (辅助/低成本): model=${secondaryModelId} (主模型=${primaryModelId}) protocol=${protocol}${keyId ? ` keyId=${keyId}` : ''}`);
    if (protocol === 'anthropic-messages' || protocol === 'anthropic') {
      const anthropicUrl = /\/v1\/?$/.test(baseUrl) ? baseUrl.replace(/\/+$/, '') : `${baseUrl.replace(/\/+$/, '')}/v1`;
      return callAnthropic(anthropicUrl, apiKey, secondaryModelId, options.systemPrompt, options.userMessage, maxTokens, timeoutMs);
    }
    return callOpenAI(baseUrl, apiKey, secondaryModelId, options.systemPrompt, options.userMessage, maxTokens, timeoutMs);
  });
}

/**
 * 解析二级模型 ID
 *
 * 优先从 Provider 的 models 列表中选 cost.input 最低且非主模型的；
 * 无 cost 数据时回退到 hardcoded 映射；
 * 都没有则降级到主模型
 */
export function resolveSecondaryModelId(
  configManager: ConfigManager,
  provider: string,
  primaryModelId: string,
): string {
  // 尝试从 Provider 的 models 列表按 cost.input 选最便宜
  const providerEntry = configManager.getProvider(provider);
  if (providerEntry?.models && providerEntry.models.length > 0) {
    const modelsWithCost = providerEntry.models
      .filter(m => m.cost?.input !== undefined && m.id !== primaryModelId);
    if (modelsWithCost.length > 0) {
      modelsWithCost.sort((a, b) => (a.cost!.input) - (b.cost!.input));
      return modelsWithCost[0]!.id;
    }
    // 有 models 但没有 cost → 检查是否有已知的便宜模型名称
  }

  // hardcoded fallback
  const providerLower = provider.toLowerCase();
  for (const [key, modelId] of Object.entries(SECONDARY_MODEL_FALLBACK)) {
    if (providerLower.includes(key)) {
      // 确认该模型和主模型不同（否则无意义）
      if (modelId !== primaryModelId) return modelId;
    }
  }

  // 最后降级到主模型
  return primaryModelId;
}

/**
 * 创建二级模型的 LLMCallFn 闭包
 * 便于注入 createWebFetchTool 等工具
 */
export function createSecondaryLLMCallFn(
  configManager: ConfigManager,
): (systemPrompt: string, userMessage: string) => Promise<string> {
  return (systemPrompt: string, userMessage: string) =>
    callLLMSecondary(configManager, { systemPrompt, userMessage, maxTokens: 4096 });
}

// ── ��助任务固定 System Prompt（启用 Prompt Cache） ──

/**
 * 辅助任务类型 → 固定 system prompt 映射
 *
 * 同类型的连续调用复用相同 system prompt 前缀 → Anthropic prompt cache 命中
 * 预期收益：辅助调用占总 token 10-15%，cache 命中后输入成本降低 90%
 */
const AUXILIARY_SYSTEM_PROMPTS: Record<string, string> = {
  summarize: `You are a concise summarization assistant.
Extract the key points and produce a brief summary. Preserve factual accuracy.
Output in the same language as the input.`,

  extract: `You are a structured data extraction assistant.
Extract the requested information from the input and return it in the specified format.
Be precise and complete. Output in the same language as the input.`,

  render: `You are a document rendering assistant.
Generate well-formatted Markdown content based on the provided data and template.
Follow the template structure precisely. Output in the same language as the input.`,

  tool_summary: `You are a tool call summarization assistant.
Given a tool name, arguments, and result, produce a one-line summary of what happened.
Be concise and factual. Output in the same language as the input.`,
};

/**
 * 使用固定 system prompt + cache_control 调用二级 LLM
 *
 * 相比 callLLMSecondary:
 * - system prompt 从预定义常量中取（保证字节一致 → cache 命中）
 * - Anthropic 协议自动附加 cache_control: ephemeral
 * - 支持自定义 system prompt 附加内容（追加在固定前缀后面）
 */
export async function callLLMSecondaryCached(
  configManager: ConfigManager,
  taskType: keyof typeof AUXILIARY_SYSTEM_PROMPTS,
  userMessage: string,
  options?: { appendToSystem?: string; maxTokens?: number },
): Promise<string> {
  const basePrompt = AUXILIARY_SYSTEM_PROMPTS[taskType];
  if (!basePrompt) {
    // 未知类型，降级到普通调用
    return callLLMSecondary(configManager, {
      systemPrompt: options?.appendToSystem ?? '',
      userMessage,
      maxTokens: options?.maxTokens ?? 4096,
    });
  }

  const blocks: Array<{ text: string; cacheControl?: { type: string; scope?: string } | null }> = [
    // 固定前缀 — 启用 ephemeral cache
    { text: basePrompt, cacheControl: { type: 'ephemeral' } },
  ];

  // 可选附加内容（如 Agent 特定上下文）— 不缓存
  if (options?.appendToSystem) {
    blocks.push({ text: options.appendToSystem, cacheControl: null });
  }

  return callLLMWithBlocks(configManager, blocks, userMessage, options?.maxTokens ?? 4096);
}

/** OpenAI Chat Completions 协议（非流式） */
async function callOpenAI(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  timeoutMs: number = DEFAULT_LLM_TIMEOUT_MS,
): Promise<string> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: maxTokens,
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new LLMHttpError(response.status, `LLM 调用失败: HTTP ${response.status} ${errText.slice(0, 200)}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? '';
}

/** Anthropic Messages 协议（非流式） */
async function callAnthropic(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  timeoutMs: number = DEFAULT_LLM_TIMEOUT_MS,
): Promise<string> {
  const response = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: modelId,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      max_tokens: maxTokens,
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new LLMHttpError(response.status, `LLM 调用失败: HTTP ${response.status} ${errText.slice(0, 200)}`);
  }

  const data = await response.json() as {
    content?: Array<{ type: string; text?: string }>;
  };
  const textBlock = data.content?.find(b => b.type === 'text');
  return textBlock?.text ?? '';
}

/**
 * 支持 SystemPromptBlock[] 的 LLM 调用 — 用于 Prompt Cache 共享
 *
 * Anthropic 协议: system 字段传递 blocks 数组，含 cache_control
 * OpenAI 协议: 将 blocks 拼接为纯文本（无 cache_control 支持）
 */
export async function callLLMWithBlocks(
  configManager: ConfigManager,
  systemBlocks: Array<{ text: string; cacheControl?: { type: string; scope?: string } | null }>,
  userMessage: string,
  maxTokens = 4096,
): Promise<string> {
  const providerId = configManager.getDefaultProvider();
  const baseUrl = configManager.getDefaultBaseUrl();
  const modelId = configManager.getDefaultModelId();
  const protocol = configManager.getDefaultApi();

  if (!providerId || !baseUrl || !modelId) {
    throw new Error('LLM 未配置：请先在设置中配置 Provider 和模型');
  }

  return withProviderFailover(configManager, providerId, async (apiKey, keyId) => {
    log.info(`调用 LLM (系统默认模型, blocks): model=${modelId} protocol=${protocol} blocks=${systemBlocks.length}${keyId ? ` keyId=${keyId}` : ''}`);

    if (protocol === 'anthropic-messages' || protocol === 'anthropic') {
      const anthropicUrl = /\/v1\/?$/.test(baseUrl) ? baseUrl.replace(/\/+$/, '') : `${baseUrl.replace(/\/+$/, '')}/v1`;

      // Anthropic: 传递 system blocks 含 cache_control + scope
      const systemContent = systemBlocks.map(b => ({
        type: 'text' as const,
        text: b.text,
        ...(b.cacheControl ? {
          cache_control: {
            type: b.cacheControl.type,
            ...(b.cacheControl.scope === 'global' ? { scope: 'global' } : {}),
          },
        } : {}),
      }));

      const response = await fetch(`${anthropicUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelId,
          system: systemContent,
          messages: [{ role: 'user', content: userMessage }],
          max_tokens: maxTokens,
          stream: false,
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new LLMHttpError(response.status, `LLM 调用失败: HTTP ${response.status} ${errText.slice(0, 200)}`);
      }

      const data = await response.json() as {
        content?: Array<{ type: string; text?: string }>;
      };
      return data.content?.find(b => b.type === 'text')?.text ?? '';
    }

    // OpenAI: 拼接 blocks 为纯文本
    const systemPrompt = systemBlocks.map(b => b.text).join('\n\n');
    return callOpenAI(baseUrl, apiKey, modelId, systemPrompt, userMessage, maxTokens);
  });
}
