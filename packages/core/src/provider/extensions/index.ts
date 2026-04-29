/**
 * Model Extensions — 统一注册入口
 *
 * 所有 provider 的预设模型定义在此汇总。
 * 用户添加 provider 时从这里加载模型列表，不走 API 同步。
 */

import type { ProviderDefinition, ModelDefinition } from './types.js';
import { findForwardCompatTemplate } from './forward-compat.js';
import { QWEN_PROVIDER } from './qwen.js';
import { GLM_PROVIDER } from './glm.js';
import { DOUBAO_PROVIDER } from './doubao.js';
import { DEEPSEEK_PROVIDER } from './deepseek.js';
import { MINIMAX_PROVIDER } from './minimax.js';
import { KIMI_PROVIDER } from './kimi.js';
import { OPENAI_PROVIDER } from './openai.js';
import { ANTHROPIC_PROVIDER } from './anthropic.js';

/** 所有预设 provider（按 ID 索引） */
const PROVIDER_EXTENSIONS = new Map<string, ProviderDefinition>();

// 注册所有预设
for (const def of [
  QWEN_PROVIDER,
  GLM_PROVIDER,
  DOUBAO_PROVIDER,
  DEEPSEEK_PROVIDER,
  MINIMAX_PROVIDER,
  KIMI_PROVIDER,
  OPENAI_PROVIDER,
  ANTHROPIC_PROVIDER,
]) {
  PROVIDER_EXTENSIONS.set(def.id, def);
}

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
