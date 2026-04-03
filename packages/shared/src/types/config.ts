/**
 * 配置类型定义 — 从 Zod Schema 推断（单一事实来源）
 *
 * Schema 定义在 schemas/config.schema.ts
 * 此文件通过 z.infer 导出类型，保持 import 路径不变
 */

import type { z } from 'zod';
import type {
  configSchema,
  modelsConfigSchema,
  providerEntrySchema,
  modelEntrySchema,
  modelCostSchema,
  apiProtocolSchema,
} from '../schemas/config.schema.js';
/** evo_claw.json 配置文件结构 */
export type EvoClawConfig = z.infer<typeof configSchema>;

/** 模型配置 */
export type ModelsConfig = z.infer<typeof modelsConfigSchema>;

/** Provider 配置条目 */
export type ProviderEntry = z.infer<typeof providerEntrySchema>;

/** 模型条目 */
export type ModelEntry = z.infer<typeof modelEntrySchema>;

/** 模型费用 */
export type ModelCost = z.infer<typeof modelCostSchema>;

/** 支持的 API 协议 */
export type ApiProtocol = z.infer<typeof apiProtocolSchema>;

/** 模型引用解析结果 */
export interface ModelReference {
  provider: string;
  modelId: string;
}

/** 配置校验结果 */
export interface ConfigValidation {
  valid: boolean;
  missing: string[];
  /** 非致命警告（如 embedding 配置不完整），不影响 valid */
  warnings?: string[];
}

/** 解析 "providerId/modelId" 格式的模型引用 */
export function parseModelRef(ref: string): ModelReference | null {
  const slashIdx = ref.indexOf('/');
  if (slashIdx <= 0 || slashIdx === ref.length - 1) return null;
  return {
    provider: ref.slice(0, slashIdx),
    modelId: ref.slice(slashIdx + 1),
  };
}
