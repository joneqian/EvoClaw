/**
 * Provider 直接调用工具 — 绕过 PI 框架
 * PI（pi-ai）不支持 document/image content type，
 * 多媒体工具需要直接构造 provider 特定的请求体调用 API。
 * 参考 OpenClaw pdf-native-providers.ts
 */

/** Provider 配置（工具调用所需） */
export interface ProviderConfig {
  apiKey: string;
  provider: string;
  modelId: string;
  baseUrl: string;
  apiProtocol?: string;
}

/** 支持原生 PDF 输入的 provider */
export const NATIVE_PDF_PROVIDERS = new Set(['anthropic', 'google']);

/**
 * 判定 provider 是否支持 vision（图片）输入
 *
 * 两个放行通道：
 * 1. 硬编码白名单（anthropic / openai / google）—— 各自专有 API
 * 2. `apiProtocol === 'openai-completions'` —— OpenAI 兼容协议（qwen / glm /
 *    minimax / doubao 等国产模型走自定义 baseUrl 接入），它们的 OpenAI 兼容
 *    endpoint 原生支持 `image_url` content type，与 openai 本家同路径
 *
 * 注意：放行后具体模型是否支持 vision 仍取决于模型本身（如 qwen-turbo 不支持，
 * qwen3.6-plus 支持）。不支持的模型 API 层会报 400，让调用方看到真实错误。
 */
export function supportsVision(config: ProviderConfig): boolean {
  if (config.provider === 'anthropic') return true;
  if (config.provider === 'google') return true;
  if (config.provider === 'openai') return true;
  if (config.apiProtocol === 'openai-completions') return true;
  return false;
}

/** 请求超时 */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * 调用 Anthropic Messages API（直接 fetch，绕过 PI）
 * 支持 document 和 image content type
 */
export async function callAnthropic(
  config: ProviderConfig,
  contentBlocks: AnthropicContent[],
  betaHeaders?: string[],
): Promise<string> {
  const baseUrl = (config.baseUrl || 'https://api.anthropic.com/v1').replace(/\/v1\/?$/, '');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
  };
  if (betaHeaders?.length) {
    headers['anthropic-beta'] = betaHeaders.join(',');
  }

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.modelId,
      max_tokens: 4096,
      messages: [{ role: 'user', content: contentBlocks }],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Anthropic API 错误: ${response.status} ${response.statusText} - ${body.slice(0, 300)}`);
  }

  const data = await response.json() as AnthropicResponse;
  return data.content?.map(b => b.type === 'text' ? b.text : '').join('') || '';
}

/**
 * 调用 Google Gemini API（直接 fetch，绕过 PI）
 * 支持 inline_data（PDF/图片）
 */
export async function callGoogle(
  config: ProviderConfig,
  parts: GooglePart[],
): Promise<string> {
  const baseUrl = (config.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/v1\/?$/, '').replace(/\/v1beta\/?$/, '');

  const response = await fetch(`${baseUrl}/v1beta/models/${config.modelId}:generateContent?key=${config.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Google API 错误: ${response.status} ${response.statusText} - ${body.slice(0, 300)}`);
  }

  const data = await response.json() as GoogleResponse;
  return data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') || '';
}

/**
 * 调用 OpenAI Chat Completions API（直接 fetch，绕过 PI）
 * 支持 image_url content type
 */
export async function callOpenAI(
  config: ProviderConfig,
  contentBlocks: OpenAIContent[],
): Promise<string> {
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.modelId,
      max_tokens: 4096,
      messages: [{ role: 'user', content: contentBlocks }],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI API 错误: ${response.status} ${response.statusText} - ${body.slice(0, 300)}`);
  }

  const data = await response.json() as OpenAIResponse;
  return data.choices?.[0]?.message?.content || '';
}

// ─── Anthropic 类型 ───

export type AnthropicContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } };

interface AnthropicResponse {
  content?: Array<{ type: string; text: string }>;
}

// ─── Google 类型 ───

export type GooglePart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

interface GoogleResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

// ─── OpenAI 类型 ───

export type OpenAIContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface OpenAIResponse {
  choices?: Array<{ message?: { content: string } }>;
}
