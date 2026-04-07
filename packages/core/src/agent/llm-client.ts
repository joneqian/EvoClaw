/**
 * LLM Client — 非流式一次性调用工具
 *
 * 用于 Agent 工作区文件生成等后台任务，不需要流式输出的场景。
 */

import type { ConfigManager } from '../infrastructure/config-manager.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('llm-client');

export interface LLMCallOptions {
  systemPrompt: string;
  userMessage: string;
  /** 可选：最大 token 数（默认 4096） */
  maxTokens?: number;
}

/**
 * 非流式调用 LLM — 从 ConfigManager 解析默认模型的 API Key、Base URL、协议
 */
export async function callLLM(
  configManager: ConfigManager,
  options: LLMCallOptions,
): Promise<string> {
  const apiKey = configManager.getDefaultApiKey();
  const baseUrl = configManager.getDefaultBaseUrl();
  const modelId = configManager.getDefaultModelId();
  const protocol = configManager.getDefaultApi();

  if (!apiKey || !baseUrl || !modelId) {
    throw new Error('LLM 未配置：请先在设置中配置 Provider 和模型');
  }

  const maxTokens = options.maxTokens ?? 4096;

  log.info(`调用 LLM: model=${modelId} protocol=${protocol} baseUrl=${baseUrl}`);

  if (protocol === 'anthropic-messages' || protocol === 'anthropic') {
    // 兼容第三方 Anthropic 端点（如 MiniMax）：baseUrl 不含 /v1 时自动补上
    const anthropicUrl = /\/v1\/?$/.test(baseUrl) ? baseUrl.replace(/\/+$/, '') : `${baseUrl.replace(/\/+$/, '')}/v1`;
    return callAnthropic(anthropicUrl, apiKey, modelId, options.systemPrompt, options.userMessage, maxTokens);
  }
  return callOpenAI(baseUrl, apiKey, modelId, options.systemPrompt, options.userMessage, maxTokens);
}

/** OpenAI Chat Completions 协议（非流式） */
async function callOpenAI(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
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
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`LLM 调用失败: HTTP ${response.status} ${errText.slice(0, 200)}`);
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
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`LLM 调用失败: HTTP ${response.status} ${errText.slice(0, 200)}`);
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
  const apiKey = configManager.getDefaultApiKey();
  const baseUrl = configManager.getDefaultBaseUrl();
  const modelId = configManager.getDefaultModelId();
  const protocol = configManager.getDefaultApi();

  if (!apiKey || !baseUrl || !modelId) {
    throw new Error('LLM 未配置：请先在设置中配置 Provider 和模型');
  }

  log.info(`调用 LLM (blocks): model=${modelId} protocol=${protocol} blocks=${systemBlocks.length}`);

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
      throw new Error(`LLM 调用失败: HTTP ${response.status} ${errText.slice(0, 200)}`);
    }

    const data = await response.json() as {
      content?: Array<{ type: string; text?: string }>;
    };
    return data.content?.find(b => b.type === 'text')?.text ?? '';
  }

  // OpenAI: 拼接 blocks 为纯文本
  const systemPrompt = systemBlocks.map(b => b.text).join('\n\n');
  return callOpenAI(baseUrl, apiKey, modelId, systemPrompt, userMessage, maxTokens);
}
