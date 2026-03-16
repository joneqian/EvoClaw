/**
 * 模型列表动态拉取 — 从 Provider API 获取可用模型
 *
 * 大多数 OpenAI 兼容 Provider 支持 GET /v1/models 端点。
 * 拉取后转换为 ModelConfig 格式，与硬编码 fallback 合并。
 */

import type { ModelConfig } from '@evoclaw/shared';

/** Provider API 返回的原始模型数据 */
interface ApiModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  // 部分 Provider 扩展字段
  max_context_length?: number;
  context_window?: number;
  max_tokens?: number;
  capabilities?: {
    vision?: boolean;
    tool_use?: boolean;
    function_calling?: boolean;
  };
}

/** API 响应格式 */
interface ModelsResponse {
  data: ApiModel[];
  object?: string;
}

/** 拉取结果 */
export interface FetchModelsResult {
  success: boolean;
  models: ModelConfig[];
  error?: string;
  /** 来源：api（远程拉取）或 fallback（使用硬编码） */
  source: 'api' | 'fallback';
}

/**
 * 从 Provider API 拉取模型列表
 *
 * @param baseUrl Provider 的 API Base URL（如 https://api.minimaxi.com/v1）
 * @param apiKey API Key
 * @param providerId Provider ID（用于填充 ModelConfig.provider）
 * @param timeoutMs 超时毫秒数，默认 10 秒
 */
export async function fetchModelsFromApi(
  baseUrl: string,
  apiKey: string,
  providerId: string,
  timeoutMs = 10_000,
): Promise<FetchModelsResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${baseUrl}/models`;
    const isAnthropic = providerId === 'anthropic' || baseUrl.includes('anthropic.com');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (isAnthropic) {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return {
        success: false,
        models: [],
        error: `HTTP ${response.status}: ${errText.slice(0, 200)}`,
        source: 'fallback',
      };
    }

    const json = await response.json() as ModelsResponse;

    if (!json.data || !Array.isArray(json.data)) {
      return {
        success: false,
        models: [],
        error: 'API 返回格式异常：缺少 data 数组',
        source: 'fallback',
      };
    }

    // 过滤出聊天模型（排除 embedding、whisper、tts 等非对话模型）
    const chatModels = json.data.filter((m) => filterChatModel(m));

    const models: ModelConfig[] = chatModels.map((m, index) => ({
      id: m.id,
      name: formatModelName(m.id),
      provider: providerId,
      maxContextLength: m.max_context_length ?? m.context_window ?? 128_000,
      maxOutputTokens: m.max_tokens ?? 8192,
      supportsVision: m.capabilities?.vision ?? guessVision(m.id),
      supportsToolUse: m.capabilities?.tool_use ?? m.capabilities?.function_calling ?? guessToolUse(m.id),
      isDefault: index === 0,
    }));

    return { success: true, models, source: 'api' };
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      models: [],
      error: message,
      source: 'fallback',
    };
  }
}

/** 过滤出聊天/对话类模型 */
function filterChatModel(model: ApiModel): boolean {
  const id = model.id.toLowerCase();
  // 排除 embedding 模型
  if (id.includes('embedding') || id.includes('embo-')) return false;
  // 排除语音模型
  if (id.includes('whisper') || id.includes('tts') || id.includes('speech')) return false;
  // 排除图片生成模型
  if (id.includes('dall-e') || id.includes('dalle')) return false;
  // 排除审核模型
  if (id.includes('moderation')) return false;
  return true;
}

/** 模型 ID → 友好名称 */
function formatModelName(id: string): string {
  // 常见模式：将连字符/下划线替换为空格并首字母大写
  return id
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** 根据模型 ID 猜测是否支持 vision */
function guessVision(id: string): boolean {
  const lower = id.toLowerCase();
  return lower.includes('vision') ||
    lower.includes('-vl') ||
    lower.includes('4o') ||
    lower.includes('claude') ||
    lower.includes('gemini');
}

/** 根据模型 ID 猜测是否支持 tool use */
function guessToolUse(id: string): boolean {
  const lower = id.toLowerCase();
  // 大部分现代对话模型支持 tool use，仅排除已知不支持的
  if (lower.includes('reasoner') || lower.includes('o1-preview') || lower.includes('o1-mini')) return false;
  return true;
}
