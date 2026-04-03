/**
 * 统一安全策略评估器 — 纯函数实现
 *
 * 评估优先级: denylist 绝对优先 → disabled → allowlist → 允许
 */

import type { NameSecurityPolicy, SecurityDecision } from '@evoclaw/shared';

/**
 * 评估单个名称是否允许访问
 *
 * @param name 待检查的名称（Skill 名称或 MCP Server 名称）
 * @param policy 安全策略（undefined = 无限制，全部允许）
 */
export function evaluateAccess(name: string, policy: NameSecurityPolicy | undefined): SecurityDecision {
  if (!policy) return 'allowed';

  // 1. denylist 绝对优先
  if (policy.denylist?.includes(name)) {
    return 'denied_by_denylist';
  }

  // 2. disabled 检查
  if (policy.disabled?.includes(name)) {
    return 'disabled';
  }

  // 3. allowlist 检查（有 allowlist 时，不在其中的被拒绝；空数组 = 阻止所有）
  if (policy.allowlist) {
    if (!policy.allowlist.includes(name)) {
      return 'denied_by_allowlist';
    }
  }

  return 'allowed';
}

/** 过滤结果 */
export interface FilterResult<T> {
  /** 允许的项 */
  allowed: T[];
  /** 被拒绝的项及原因 */
  denied: Array<{ item: T; reason: SecurityDecision }>;
}

/**
 * 批量过滤 — 泛型设计，同时支持 Skill 和 MCP Server
 *
 * @param items 待过滤列表
 * @param nameExtractor 从项中提取名称的函数
 * @param policy 安全策略
 */
export function filterByPolicy<T>(
  items: readonly T[],
  nameExtractor: (item: T) => string,
  policy: NameSecurityPolicy | undefined,
): FilterResult<T> {
  const allowed: T[] = [];
  const denied: Array<{ item: T; reason: SecurityDecision }> = [];

  for (const item of items) {
    const decision = evaluateAccess(nameExtractor(item), policy);
    if (decision === 'allowed') {
      allowed.push(item);
    } else {
      denied.push({ item, reason: decision });
    }
  }

  return { allowed, denied };
}

/**
 * 合并两个安全策略（用于扩展包安装）
 *
 * 合并规则：
 * - denylist 取并集（安全优先）
 * - allowlist 取交集（最严格）
 * - disabled 取并集
 */
export function mergeSecurityPolicies(
  base: NameSecurityPolicy | undefined,
  overlay: NameSecurityPolicy | undefined,
): NameSecurityPolicy | undefined {
  if (!base && !overlay) return undefined;
  if (!base) return overlay;
  if (!overlay) return base;

  const result: NameSecurityPolicy = {};

  // denylist 取并集
  const denySet = new Set([...(base.denylist ?? []), ...(overlay.denylist ?? [])]);
  if (denySet.size > 0) result.denylist = [...denySet];

  // allowlist 取交集（最严格）
  if (base.allowlist && overlay.allowlist) {
    const overlaySet = new Set(overlay.allowlist);
    result.allowlist = base.allowlist.filter(name => overlaySet.has(name));
  } else if (base.allowlist) {
    result.allowlist = [...base.allowlist];
  } else if (overlay.allowlist) {
    result.allowlist = [...overlay.allowlist];
  }

  // disabled 取并集
  const disabledSet = new Set([...(base.disabled ?? []), ...(overlay.disabled ?? [])]);
  if (disabledSet.size > 0) result.disabled = [...disabledSet];

  return result;
}
