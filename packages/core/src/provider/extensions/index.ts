/**
 * Model Extensions — 统一注册入口
 *
 * 所有 provider 的预设模型定义在此汇总。
 * 用户添加 provider 时从这里加载模型列表，不走 API 同步。
 */

import type { ProviderDefinition, ModelDefinition } from './types.js';
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

/** 查找指定 provider 的指定模型定义 */
export function lookupModelDefinition(providerId: string, modelId: string): ModelDefinition | undefined {
  return PROVIDER_EXTENSIONS.get(providerId)?.models.find(m => m.id === modelId);
}

/** 检查 provider 是否有预设 */
export function hasProviderExtension(providerId: string): boolean {
  return PROVIDER_EXTENSIONS.has(providerId);
}

// Re-export types
export type { ProviderDefinition, ModelDefinition, ModelInputModality, ModelApi } from './types.js';
