import type { ResolvedModel } from '@evoclaw/shared';
import { FALLBACK_MODEL } from '@evoclaw/shared';
import { getProvider, isBuiltinProvider, getProviders } from './provider-registry.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';

export interface ModelResolverOptions {
  /** Agent 配置的模型 */
  agentModelId?: string;
  agentProvider?: string;
  /** 用户偏好（从 model_configs 表查） */
  store?: SqliteStore;
}

/** 解析最终使用的模型 */
export function resolveModel(options: ModelResolverOptions): ResolvedModel {
  // 优先级 1：Agent 指定模型
  if (options.agentModelId && options.agentProvider) {
    const resolved = tryResolve(options.agentProvider, options.agentModelId);
    if (resolved) return resolved;
  }

  // 优先级 2：用户设定的默认模型
  if (options.store) {
    const defaultConfig = options.store.get<{
      provider: string;
      model_id: string;
      api_key_ref: string;
      config_json: string;
    }>(
      'SELECT provider, model_id, api_key_ref, config_json FROM model_configs WHERE is_default = 1 LIMIT 1'
    );
    if (defaultConfig) {
      const config = JSON.parse(defaultConfig.config_json || '{}') as { baseUrl?: string };
      return {
        provider: defaultConfig.provider,
        modelId: defaultConfig.model_id,
        apiKeyRef: defaultConfig.api_key_ref,
        baseUrl: config.baseUrl || '',
      };
    }
  }

  // 优先级 3：第一个有 API Key 的 Provider 的默认模型
  for (const provider of getProviders()) {
    const defaultModel = provider.models.find(m => m.isDefault);
    if (defaultModel) {
      return {
        provider: provider.id,
        modelId: defaultModel.id,
        apiKeyRef: provider.apiKeyRef,
        baseUrl: provider.baseUrl,
      };
    }
  }

  // 优先级 4：Fallback
  return {
    provider: FALLBACK_MODEL.provider,
    modelId: FALLBACK_MODEL.modelId,
    apiKeyRef: 'openai-api-key',
    baseUrl: 'https://api.openai.com/v1',
  };
}

function tryResolve(providerId: string, modelId: string): ResolvedModel | null {
  // Built-in providers（PI 原生支持）
  if (isBuiltinProvider(providerId)) {
    return {
      provider: providerId,
      modelId,
      apiKeyRef: `${providerId}-api-key`,
      baseUrl: '', // PI 处理内置 URL
    };
  }

  // 自定义注册的 Provider
  const provider = getProvider(providerId);
  if (!provider) return null;

  const model = provider.models.find(m => m.id === modelId);
  if (!model) return null;

  return {
    provider: provider.id,
    modelId: model.id,
    apiKeyRef: provider.apiKeyRef,
    baseUrl: provider.baseUrl,
  };
}
