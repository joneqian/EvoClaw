/**
 * 统一扩展安全策略 — 覆盖 Skills + MCP Servers
 *
 * IT 管理员通过此策略统一管控 Agent 可用的扩展。
 * denylist 绝对优先 → disabled → allowlist → 允许。
 */

/** 统一扩展安全策略（存储在 evo_claw.json 的 security 字段） */
export interface ExtensionSecurityPolicy {
  /** Skill 安全策略 */
  skills?: NameSecurityPolicy;
  /** MCP Server 安全策略 */
  mcpServers?: NameSecurityPolicy;
}

/** 基于名称的安全策略 */
export interface NameSecurityPolicy {
  /** 允许列表（设置后仅允许列表中的项，空数组 = 阻止所有） */
  allowlist?: string[];
  /** 拒绝列表（绝对优先，不可覆盖） */
  denylist?: string[];
  /** 单独禁用的项 */
  disabled?: string[];
}

/** 安全决策结果 */
export type SecurityDecision =
  | 'allowed'
  | 'denied_by_denylist'
  | 'denied_by_allowlist'
  | 'disabled';
