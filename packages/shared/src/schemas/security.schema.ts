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

/** M7 Phase 3 Skill 自动进化策略 */
export const skillEvolverSchema = z.object({
  /** 是否启用（默认关，用户显式开启） */
  enabled: z.boolean().default(false),
  /** Cron 调度表达式（默认每日 03:00） */
  cronSchedule: z.string().default('0 3 * * *'),
  /** 最少证据条数才进入 Evolver（默认 2） */
  minEvidenceCount: z.number().int().min(1).default(2),
  /** 成功率阈值，低于此值才触发进化（默认 0.8） */
  successRateThreshold: z.number().min(0).max(1).default(0.8),
  /** 单次 cycle 最多进化几个 Skill（默认 5，硬上限 20） */
  maxCandidatesPerRun: z.number().int().min(1).max(20).default(5),
  /** 辅助模型标识（未配置则走 ModelRouter 默认辅助模型） */
  model: z.string().optional(),
});

/** M8 env 沙箱策略 */
export const envSandboxPolicySchema = z.object({
  /** 额外敏感变量名正则（字符串形式，和默认 SENSITIVE_PATTERNS 取并集） */
  customSensitivePatterns: z.array(z.string()).optional(),
  /** whitelist 模式下的额外放行变量名（仅 MCP 等白名单模式生效） */
  extraPassthrough: z.array(z.string()).optional(),
});

/** 统一扩展安全策略 */
export const extensionSecurityPolicySchema = z.object({
  skills: nameSecurityPolicySchema.optional(),
  mcpServers: nameSecurityPolicySchema.optional(),
  /** Skill 安装策略矩阵覆盖 */
  skillInstallPolicy: skillInstallPolicySchema.optional(),
  /** M8: env 沙箱策略 */
  env: envSandboxPolicySchema.optional(),
  /**
   * M8: 域名黑名单（web_fetch / MCP HTTP 等网络访问都会过滤）
   * 支持 "example.com" 精确 / "*.example.com" 前缀通配
   */
  domainDenylist: z.array(z.string()).optional(),
  /** M7 Phase 3: Skill 自动进化配置 */
  skillEvolver: skillEvolverSchema.optional(),
});

/** 安全解析安全策略 */
export function safeParseSecurityPolicy(data: unknown) {
  return extensionSecurityPolicySchema.safeParse(data);
}
