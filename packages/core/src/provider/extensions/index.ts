/**
 * Provider Extensions — 公共查询 API
 *
 * 数据来源: catalog.ts (PROVIDER_CATALOG)
 * - 加新模型: 在 catalog.ts 对应 provider 的 models 数组追加一条
 * - 加新 provider: 在 catalog.ts 的 PROVIDER_CATALOG 数组追加一项
 */

import type { ProviderDefinition, ModelDefinition } from './types.js';
import { findForwardCompatTemplate } from './forward-compat.js';
import { PROVIDER_CATALOG } from './catalog.js';

/** 所有预设 provider（按 ID 索引） */
const PROVIDER_EXTENSIONS = new Map<string, ProviderDefinition>(
  PROVIDER_CATALOG.map(p => [p.id, p]),
);

/** 获取预设 provider 定义 */
export function getProviderExtension(providerId: string): ProviderDefinition | undefined {
  return PROVIDER_EXTENSIONS.get(providerId);
}

/** 获取所有预设 provider 定义 */
export function getAllProviderExtensions(): ProviderDefinition[] {
  return [...PROVIDER_EXTENSIONS.values()];
}

/** 获取所有预设 provider ID 列表 */
export function getExtensionProviderIds(): string[] {
  return [...PROVIDER_EXTENSIONS.keys()];
}

/** 精确匹配指定 provider 的模型定义（不做 forward-compat） */
export function lookupModelDefinition(providerId: string, modelId: string): ModelDefinition | undefined {
  return PROVIDER_EXTENSIONS.get(providerId)?.models.find(m => m.id === modelId);
}

/**
 * 解析模型定义：精确匹配优先，失败时回退到同 provider 内最接近的模板（forward-compat）。
 *
 * 用于运行时获取 contextWindow / reasoning / maxTokens 等能力位——
 * 当用户配置了清单未收录的新模型 ID 时，回退到同家族最近模板比 undefined 安全。
 */
export function resolveModelDefinition(providerId: string, modelId: string): ModelDefinition | undefined {
  const provider = PROVIDER_EXTENSIONS.get(providerId);
  if (!provider) return undefined;
  const exact = provider.models.find(m => m.id === modelId);
  if (exact) return exact;
  return findForwardCompatTemplate(provider, modelId);
}

/** 检查 provider 是否有预设 */
export function hasProviderExtension(providerId: string): boolean {
  return PROVIDER_EXTENSIONS.has(providerId);
}

// Re-export types
export type { ProviderDefinition, ModelDefinition, ModelInputModality, ModelApi } from './types.js';
