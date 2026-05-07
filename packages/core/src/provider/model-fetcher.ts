/**
 * 模型列表动态拉取 — 从 Provider API 获取可用模型
 *
 * 大多数 OpenAI 兼容 Provider 支持 GET /v1/models 端点。
 * 拉取后转换为 ModelConfig 格式，与硬编码 fallback 合并。
 */

import { createHmac } from 'node:crypto';
import type { ModelConfig } from '@evoclaw/shared';
import { createLogger } from '../infrastructure/logger.js';
import { PROVIDER_CATALOG } from './extensions/catalog.js';
import type { AuthStrategy } from './extensions/types.js';

const log = createLogger('provider-auth');

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
    // 智谱 GLM: 用户可能配了兼容端点（/api/anthropic 或 /api/paas/v4），
    // 但模型列表只在 /api/paas/v4/models 上可用
    let modelsBaseUrl = baseUrl;
    if (baseUrl.includes('bigmodel.cn') && !baseUrl.includes('/api/paas/')) {
      modelsBaseUrl = baseUrl.replace(/\/api\/[^/]+$/, '/api/paas/v4');
    }
    const url = `${modelsBaseUrl}/models`;
    const headers = buildAuthHeaders(apiKey, providerId, modelsBaseUrl);

    // 打印最终请求信息（避免泄露完整密钥，仅打印 header key 和 Authorization 前缀）
    console.log('[model-fetcher] 请求模型列表详情:', {
      provider: providerId,
      url,
      timeoutMs,
      headerKeys: Object.keys(headers),
      authorizationPreview: headers.Authorization
        ? `${headers.Authorization.slice(0, 16)}***`
        : undefined,
    });

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timer);

    // 打印 fetch 实际使用的最终地址（考虑到可能的重定向）
    console.log('[model-fetcher] 最终请求地址:', {
      requestedUrl: url,
      finalUrl: response.url,
      status: response.status,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return {
        success: false,
        models: [],
        error: `HTTP ${response.status}: ${errText.slice(0, 200)}`,
        source: 'fallback',
      };
    }

    const json = (await response.json()) as Record<string, unknown>;

    // 兼容多种返回格式：
    // - OpenAI 标准: { data: [...] }
    // - 部分 Provider: { models: [...] }
    // - 部分 Provider: { result: { data: [...] } }
    // - 部分 Provider: 直接返回数组 [...]
    let rawModels: ApiModel[] | undefined;
    if (Array.isArray(json.data)) {
      rawModels = json.data as ApiModel[];
    } else if (
      Array.isArray((json as unknown as ModelsResponse & { models?: unknown }).models)
    ) {
      rawModels = (json as unknown as { models: ApiModel[] }).models;
    } else if (
      json.result &&
      typeof json.result === 'object' &&
      Array.isArray((json.result as Record<string, unknown>).data)
    ) {
      rawModels = (json.result as { data: ApiModel[] }).data;
    } else if (Array.isArray(json)) {
      rawModels = json as unknown as ApiModel[];
    }

    if (!rawModels || rawModels.length === 0) {
      return {
        success: false,
        models: [],
        error: `API 返回格式异常：无法识别模型列表。响应 keys: ${Object.keys(json).join(', ')}`,
        source: 'fallback',
      };
    }

    // 过滤出聊天模型（排除 embedding、whisper、tts 等非对话模型）
    const chatModels = rawModels.filter((m) => filterChatModel(m));

    const models: ModelConfig[] = chatModels.map((m, index) => ({
      id: m.id,
      name: formatModelName(m.id),
      provider: providerId,
      maxContextLength: m.max_context_length ?? m.context_window ?? 128_000,
      maxOutputTokens: m.max_tokens ?? 8192,
      supportsVision: m.capabilities?.vision ?? guessVision(m.id),
      supportsToolUse:
        m.capabilities?.tool_use ??
        m.capabilities?.function_calling ??
        guessToolUse(m.id),
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

/** 判断是否为智谱 GLM API Key（格式: {id}.{secret}） */
function isGlmApiKey(apiKey: string): boolean {
  const parts = apiKey.split('.');
  return (
    parts.length === 2 &&
    parts[0]!.length > 0 &&
    parts[1]!.length > 0 &&
    !apiKey.startsWith('sk-')
  );
}

/** 为智谱 GLM 生成 JWT Token */
function generateGlmToken(apiKey: string, expireSeconds = 300): string {
  const [id, secret] = apiKey.split('.');
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'HS256', sign_type: 'SIGN' };
  const payload = { api_key: id, exp: now + expireSeconds, timestamp: now };

  const b64url = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');

  const headerB64 = b64url(header);
  const payloadB64 = b64url(payload);
  const signature = createHmac('sha256', secret!)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * 解析 provider 的认证策略
 *
 * 决策顺序（先显式后兜底）：
 *   1) catalog 中显式声明 authStrategy → 直接用
 *   2) 否则按 baseUrl 嗅探（向后兼容老配置 / 用户自填的 anthropic.com / bigmodel.cn）
 *   3) 最终默认 → 'bearer'
 *
 * 嗅探规则：
 *   - 包含 `anthropic.com` 或路径含 `/anthropic` → 'anthropic'（兼容 DeepSeek /anthropic 等）
 *   - 包含 `bigmodel.cn` 且 apiKey 是 `{id}.{secret}` 格式 → 'glm-jwt'
 *
 * 暴露为 export 主要供测试与外部诊断使用，业务代码请用 buildAuthHeaders。
 */
export function resolveAuthStrategy(
  apiKey: string,
  providerId: string,
  baseUrl: string,
): AuthStrategy {
  // 1) catalog 显式声明优先
  const catalogProvider = PROVIDER_CATALOG.find((p) => p.id === providerId);
  if (catalogProvider?.authStrategy) {
    return catalogProvider.authStrategy;
  }

  // 2) baseUrl 兜底嗅探
  if (
    providerId === 'anthropic' ||
    baseUrl.includes('anthropic.com') ||
    /\/anthropic(\/|$)/.test(baseUrl)
  ) {
    return 'anthropic';
  }
  if ((providerId === 'glm' || baseUrl.includes('bigmodel.cn')) && isGlmApiKey(apiKey)) {
    return 'glm-jwt';
  }

  // 3) 兜底
  return 'bearer';
}

/**
 * 构建认证 headers（按 catalog 声明的 AuthStrategy 分发）
 *
 * - 'anthropic'   : x-api-key + anthropic-version
 * - 'bearer'      : Authorization: Bearer ${apiKey}
 * - 'glm-jwt'     : Authorization: Bearer ${JWT(apiKey)}
 * - { kind:'custom', customHeaders } : 函数返回的任意 header
 *
 * 详见 provider/extensions/types.ts AuthStrategy。
 */
export function buildAuthHeaders(
  apiKey: string,
  providerId: string,
  baseUrl: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const strategy = resolveAuthStrategy(apiKey, providerId, baseUrl);
  log.debug(
    `[auth] resolved strategy=${typeof strategy === 'string' ? strategy : 'custom'} provider=${providerId}`,
  );

  if (strategy === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (strategy === 'glm-jwt') {
    // 防御：apiKey 不是 {id}.{secret} 格式时降级为普通 Bearer
    // 兼容老用户配置 providerId=glm 但用了非 GLM 格式 key（自建网关代理等）
    if (isGlmApiKey(apiKey)) {
      headers['Authorization'] = `Bearer ${generateGlmToken(apiKey)}`;
    } else {
      log.warn('[auth] strategy=glm-jwt 但 apiKey 不是 {id}.{secret} 格式，降级 Bearer');
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
  } else if (strategy === 'bearer') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else {
    // strategy.kind === 'custom'
    Object.assign(headers, strategy.customHeaders(apiKey));
  }
  return headers;
}

/** 过滤出聊天/对话类模型 */
function filterChatModel(model: ApiModel): boolean {
  const id = model.id.toLowerCase();
  // 排除 embedding 模型
  if (id.includes('embedding') || id.includes('embo-')) return false;
  // 排除语音模型
  if (id.includes('whisper') || id.includes('tts') || id.includes('speech'))
    return false;
  // 排除图片生成模型
  if (id.includes('dall-e') || id.includes('dalle')) return false;
  // 排除审核模型
  if (id.includes('moderation')) return false;
  return true;
}

/** 模型 ID → 友好名称 */
function formatModelName(id: string): string {
  // 常见模式：将连字符/下划线替换为空格并首字母大写
  return id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** 根据模型 ID 猜测是否支持 vision */
function guessVision(id: string): boolean {
  const lower = id.toLowerCase();
  return (
    lower.includes('vision') ||
    lower.includes('-vl') ||
    lower.includes('4o') ||
    lower.includes('claude') ||
    lower.includes('gemini')
  );
}

/** 根据模型 ID 猜测是否支持 tool use */
function guessToolUse(id: string): boolean {
  const lower = id.toLowerCase();
  // 大部分现代对话模型支持 tool use，仅排除已知不支持的
  if (
    lower.includes('reasoner') ||
    lower.includes('o1-preview') ||
    lower.includes('o1-mini')
  )
    return false;
  return true;
}
