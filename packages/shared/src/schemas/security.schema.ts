/**
 * ExtensionSecurityPolicy Zod Schema
 */

import { z } from 'zod';

/** 基于名称的安全策略 */
export const nameSecurityPolicySchema = z.object({
  allowlist: z.array(z.string()).optional(),
  denylist: z.array(z.string()).optional(),
  disabled: z.array(z.string()).optional(),
});

/** 统一扩展安全策略 */
export const extensionSecurityPolicySchema = z.object({
  skills: nameSecurityPolicySchema.optional(),
  mcpServers: nameSecurityPolicySchema.optional(),
});

/** 安全解析安全策略 */
export function safeParseSecurityPolicy(data: unknown) {
  return extensionSecurityPolicySchema.safeParse(data);
}
