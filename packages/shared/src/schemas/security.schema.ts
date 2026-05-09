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
  /**
   * M7-Tier3 PR-T3-2a: 进化执行模式
   *   - apply（默认）：LLM 决策直接生效，行为与 PR-T3-1c 之前一致
   *   - dryRun：决策落 evolution_log 但不写 SKILL.md，需用户在 UI 应用/拒绝
   *   - PR-T3-2b 将扩 'canary'（灰度推送 N% 流量到新版本）
   */
  mode: z.enum(['apply', 'dryRun']).default('apply'),
  // ─── M7-Tier3 PR-T3-1a/b: A-B 对照实验配置 ───
  /** refine 决策后是否启动 A-B（默认 true） */
  abTestEnabled: z.boolean().default(true),
  /** 每变体最少调用次数才检验（默认 30） */
  abMinCallsPerVariant: z.number().int().min(5).max(1000).default(30),
  /** 测试期上限（天）（默认 7） */
  abMaxTestDays: z.number().int().min(1).max(365).default(7),
  /** 评估器 cron（默认 '30 4 * * *'，错峰 evolver 03:00） */
  abEvaluatorCron: z.string().default('30 4 * * *'),
  /** B success 提升阈值（≥ 此值且 p<0.05 → promote），默认 0.05 */
  abPromoteSuccessDeltaMin: z.number().min(0).max(1).default(0.05),
  /** B success 退化阈值（≥ 此值且 p<0.05 → rollback），默认 0.10 */
  abRollbackSuccessDeltaMin: z.number().min(0).max(1).default(0.10),
  /** p 值阈值，默认 0.05 */
  abPValueThreshold: z.number().min(0).max(1).default(0.05),
  /** B duration ratio rollback 阈值（B 慢 50%+ 触发），默认 1.5 */
  abDurationRatioRollback: z.number().min(1).max(10).default(1.5),
}).refine(
  (cfg) => !(cfg.mode === 'dryRun' && cfg.abTestEnabled),
  {
    message: 'mode=dryRun 与 abTestEnabled=true 互斥（dryRun 不写 SKILL.md → 没法启动 A-B 对照）',
    path: ['abTestEnabled'],
  },
);

/** M7-Tier1 PR6 Skill Curator 子代理配置（跨 session umbrella consolidation + 三态生命周期） */
export const skillCuratorSchema = z.object({
  /** 是否启用（默认 false，需显式开启；与 paused 区分：enabled=false 完全关，paused=true 只是临时停） */
  enabled: z.boolean().default(false),
  /** Curator 触发间隔（天），默认 7 */
  intervalDays: z.number().int().min(1).max(365).default(7),
  /** N 天未用 → stale，默认 30 */
  staleDays: z.number().int().min(1).max(3650).default(30),
  /** N 天未用 → 物理归档（移到 .archive/），默认 90 */
  archivedDays: z.number().int().min(1).max(3650).default(90),
  /** bundled 来源是否豁免自动归档，默认 true（始终保护内置 skill） */
  protectBundled: z.boolean().default(true),
}).refine(
  (cfg) => cfg.archivedDays > cfg.staleDays,
  { message: 'archivedDays 必须大于 staleDays（先 stale 后 archive）', path: ['archivedDays'] },
);

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
  /** M7-Tier1 PR6: Skill Curator 子代理配置 */
  skillCurator: skillCuratorSchema.optional(),
});

/** 安全解析安全策略 */
export function safeParseSecurityPolicy(data: unknown) {
  return extensionSecurityPolicySchema.safeParse(data);
}
