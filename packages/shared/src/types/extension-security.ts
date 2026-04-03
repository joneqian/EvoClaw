/**
 * 扩展安全策略类型 — 从 Zod Schema 推断（单一事实来源）
 *
 * Schema 定义在 schemas/security.schema.ts
 */

import type { z } from 'zod';
import type {
  extensionSecurityPolicySchema,
  nameSecurityPolicySchema,
} from '../schemas/security.schema.js';

/** 统一扩展安全策略（存储在 evo_claw.json 的 security 字段） */
export type ExtensionSecurityPolicy = z.infer<typeof extensionSecurityPolicySchema>;

/** 基于名称的安全策略 */
export type NameSecurityPolicy = z.infer<typeof nameSecurityPolicySchema>;

/** 安全决策结果 */
export type SecurityDecision =
  | 'allowed'
  | 'denied_by_denylist'
  | 'denied_by_allowlist'
  | 'disabled';
