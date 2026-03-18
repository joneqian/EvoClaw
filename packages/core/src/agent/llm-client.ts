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

  log.info(`调用 LLM: model=${modelId} protocol=${protocol}`);

  if (protocol === 'anthropic-messages' || protocol === 'anthropic') {
    return callAnthropic(baseUrl, apiKey, modelId, options.systemPrompt, options.userMessage, maxTokens);
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
