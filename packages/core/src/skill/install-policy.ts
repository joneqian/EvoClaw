/**
 * M5 T2: Skill 安装策略决策矩阵（渐进式）
 *
 * 根据 (来源, 风险等级) 二维矩阵决定安装放行方式：
 *
 *            low                 medium             high
 * bundled    auto                auto               auto     ← 内置，绝对可信
 * local      auto                auto               auto     ← 用户自己放的，可信
 * clawhub    auto                require-confirm    block    ← 审核过，但不完全豁免
 * github     require-confirm     require-confirm    block    ← 第三方，总是需确认
 * mcp        auto                auto               auto     ← 由 mcpSecurity 另外门控
 *
 * 单元格可通过 configManager.security.skillInstallPolicy 覆盖（部分）。
 */

import type {
  SkillSource,
  SkillSecurityReport,
  SkillInstallPolicy,
  SkillInstallPolicyDecision,
} from '@evoclaw/shared';

type RiskLevel = SkillSecurityReport['riskLevel'];

type MatrixKey = `${SkillSource}:${RiskLevel}`;

/**
 * 单元格覆盖（部分）。key 形如 `clawhub:low` → 'auto' | 'require-confirm' | 'block'。
 * 未覆盖的单元格走默认矩阵。
 */
export type SkillInstallPolicyOverride = Partial<Record<MatrixKey, SkillInstallPolicy>>;

/** 默认矩阵（渐进式） */
const DEFAULT_MATRIX: Record<MatrixKey, SkillInstallPolicy> = {
  'bundled:low': 'auto',
  'bundled:medium': 'auto',
  'bundled:high': 'auto',
  'local:low': 'auto',
  'local:medium': 'auto',
  'local:high': 'auto',
  'clawhub:low': 'auto',
  'clawhub:medium': 'require-confirm',
  'clawhub:high': 'block',
  'github:low': 'require-confirm',
  'github:medium': 'require-confirm',
  'github:high': 'block',
  'mcp:low': 'auto',
  'mcp:medium': 'auto',
  'mcp:high': 'auto',
};

/** 构造人类可读原因（中文） */
function reasonFor(source: SkillSource, riskLevel: RiskLevel, policy: SkillInstallPolicy): string {
  if (policy === 'block') {
    if (riskLevel === 'high') return `威胁扫描发现高风险行为，来自 ${source} 的 Skill 已被安装策略阻止。`;
    return `安装策略配置为阻止该来源（${source}）+ 风险（${riskLevel}）组合。`;
  }
  if (policy === 'require-confirm') {
    if (source === 'github') return '来自第三方 GitHub 仓库，未经审核。请核实代码无异常后再确认安装。';
    if (riskLevel === 'medium') return '威胁扫描发现中等风险行为，请核实具体发现项后再确认安装。';
    return '按当前安装策略需手动确认。';
  }
  // auto
  if (source === 'bundled') return '内置 Skill，直接安装。';
  if (source === 'local') return '本地 Skill，直接安装。';
  return '风险等级较低，直接安装。';
}

/**
 * 决策安装策略
 *
 * @param source 来源
 * @param riskLevel 威胁扫描的总体风险等级
 * @param override 可选：单元格覆盖（企业管理员配置）
 */
export function decideInstallPolicy(
  source: SkillSource,
  riskLevel: RiskLevel,
  override?: SkillInstallPolicyOverride,
): SkillInstallPolicyDecision {
  const key = `${source}:${riskLevel}` as MatrixKey;
  const policy = override?.[key] ?? DEFAULT_MATRIX[key] ?? 'require-confirm';
  return { policy, reason: reasonFor(source, riskLevel, policy) };
}
