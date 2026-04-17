/**
 * EvoClawConfig Zod Schema
 */

import { z } from 'zod';
import { extensionSecurityPolicySchema } from './security.schema.js';

/** 模型费用 */
export const modelCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
});

/** 模型条目 */
export const modelEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  reasoning: z.boolean().optional(),
  input: z.array(z.string()).optional(),
  cost: modelCostSchema.optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  dimension: z.number().int().positive().optional(),
});

/** API 协议 */
export const apiProtocolSchema = z.enum(['openai-completions', 'anthropic-messages']);

/** Provider 配置条目 */
export const providerEntrySchema = z.object({
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  api: apiProtocolSchema,
  models: z.array(modelEntrySchema),
});

/** 模型配置 */
export const modelsConfigSchema = z.object({
  default: z.string().optional(),
  embedding: z.string().optional(),
  providers: z.record(z.string(), providerEntrySchema).optional(),
}).optional();

/** EvoClawConfig 完整 schema */
export const configSchema = z.object({
  models: modelsConfigSchema,
  services: z.object({
    brave: z.object({ apiKey: z.string() }).optional(),
  }).optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  language: z.enum(['zh', 'en']).optional(),
  thinking: z.enum(['auto', 'on', 'off']).optional(),
  /** 权限模式（全局默认） — default | strict | permissive */
  permissionMode: z.enum(['default', 'strict', 'permissive']).optional(),
  security: extensionSecurityPolicySchema.optional(),
  /** Hook 策略 — managed.json 中的 IT 管理员控制 */
  hooks: z.object({
    /** 禁用所有非系统 Hook */
    disableAllHooks: z.boolean().optional(),
    /** 仅允许管理员 (managed.json) 配置的 Hook */
    allowManagedHooksOnly: z.boolean().optional(),
  }).optional(),
}).passthrough();  // 允许未知字段（向前兼容）

/** 安全解析 EvoClawConfig（不抛异常） */
export function safeParseConfig(data: unknown) {
  return configSchema.safeParse(data);
}
