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

/** M5 T2: Skill 安装策略矩阵覆盖（部分单元格，key 形如 `clawhub:low`） */
export const skillInstallPolicySchema = z.record(
  z.string(),
  z.enum(['auto', 'require-confirm', 'block']),
);

/** 统一扩展安全策略 */
export const extensionSecurityPolicySchema = z.object({
  skills: nameSecurityPolicySchema.optional(),
  mcpServers: nameSecurityPolicySchema.optional(),
  /** Skill 安装策略矩阵覆盖 */
  skillInstallPolicy: skillInstallPolicySchema.optional(),
});

/** 安全解析安全策略 */
export function safeParseSecurityPolicy(data: unknown) {
  return extensionSecurityPolicySchema.safeParse(data);
}
