import type { ProviderConfig, ModelConfig } from '@evoclaw/shared';
import { getProviderExtension, type ProviderDefinition, type ModelDefinition } from './extensions/index.js';

/** 已注册的 Provider 配置 */
const providers = new Map<string, ProviderConfig>();

/** 内置 Provider（PI 框架原生支持） */
const BUILTIN_PROVIDERS = ['openai', 'anthropic', 'google', 'groq'] as const;

/** 注册自定义 Provider（低级 API，直接传入完整配置） */
export function registerProvider(config: ProviderConfig): void {
  providers.set(config.id, config);
}

/**
 * 从 Extension 预设注册 Provider
 * 自动加载预设模型列表，用户只需提供 apiKeyRef
 */
export function registerFromExtension(providerId: string, apiKeyRef: string, baseUrlOverride?: string): boolean {
  const ext = getProviderExtension(providerId);
  if (!ext) return false;

  registerProvider({
    id: ext.id,
    name: ext.name,
    baseUrl: baseUrlOverride ?? ext.defaultBaseUrl,
    apiKeyRef,
    models: extensionToModelConfigs(ext),
  });
  return true;
}

/** 将 Extension ModelDefinition[] 转换为 ModelConfig[] */
function extensionToModelConfigs(ext: ProviderDefinition): ModelConfig[] {
  return ext.models.map((m: ModelDefinition) => ({
    id: m.id,
    name: m.name,
    provider: ext.id,
    maxContextLength: m.contextWindow,
    maxOutputTokens: m.maxTokens,
    supportsVision: m.input.includes('image'),
    supportsToolUse: m.toolUse !== false,
    isDefault: m.isDefault ?? false,
  }));
}

/** 注销 Provider */
export function unregisterProvider(id: string): void {
  providers.delete(id);
}

/** 获取所有已注册 Provider */
export function getProviders(): ProviderConfig[] {
  return Array.from(providers.values());
}

/** 获取 Provider */
export function getProvider(id: string): ProviderConfig | undefined {
  return providers.get(id);
}

/** 检查 Provider 是否为内置 */
export function isBuiltinProvider(id: string): boolean {
  return (BUILTIN_PROVIDERS as readonly string[]).includes(id);
}

/** 更新 Provider 的模型列表 */
export function updateProviderModels(
  id: string,
  models: ModelConfig[],
): boolean {
  const provider = providers.get(id);
  if (!provider) return false;
  provider.models = models;
  return true;
}

/** 清除所有注册（测试用） */
export function clearProviders(): void {
  providers.clear();
}

// ─── 向后兼容（deprecated） ───

/** @deprecated 使用 registerFromExtension('qwen', apiKeyRef) */
export function registerQwen(apiKeyRef: string): void { registerFromExtension('qwen', apiKeyRef); }
/** @deprecated 使用 registerFromExtension('glm', apiKeyRef) */
export function registerGLM(apiKeyRef: string): void { registerFromExtension('glm', apiKeyRef); }
/** @deprecated 使用 registerFromExtension('doubao', apiKeyRef) */
export function registerDoubao(apiKeyRef: string): void { registerFromExtension('doubao', apiKeyRef); }
/** @deprecated 使用 registerFromExtension('deepseek', apiKeyRef) */
export function registerDeepSeek(apiKeyRef: string): void { registerFromExtension('deepseek', apiKeyRef); }
/** @deprecated 使用 registerFromExtension('minimax', apiKeyRef) */
export function registerMiniMax(apiKeyRef: string): void { registerFromExtension('minimax', apiKeyRef); }
/** @deprecated 使用 registerFromExtension('kimi', apiKeyRef) */
export function registerKimi(apiKeyRef: string): void { registerFromExtension('kimi', apiKeyRef); }
/** @deprecated 使用 registerFromExtension('openai', apiKeyRef) */
export function registerOpenAI(apiKeyRef: string): void { registerFromExtension('openai', apiKeyRef); }
/** @deprecated 使用 registerFromExtension('anthropic', apiKeyRef) */
export function registerAnthropic(apiKeyRef: string): void { registerFromExtension('anthropic', apiKeyRef); }
