/**
 * MCP 安全策略 — 白名单/黑名单
 *
 * 基于统一安全策略评估器实现。
 * 黑名单绝对优先 → 禁用 → 白名单 → 允许。
 */

import type { McpServerConfig } from './mcp-config.js';
import type { NameSecurityPolicy } from '@evoclaw/shared';
import { evaluateAccess } from '../security/extension-security.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('mcp-security');

/** MCP 安全策略（NameSecurityPolicy 的别名，向后兼容） */
export type McpSecurityPolicy = NameSecurityPolicy;

/**
 * 根据安全策略过滤 MCP 服务器配置
 *
 * @param configs 原始配置列表
 * @param policy 安全策略
 * @returns 过滤后的配置（被拒绝的服务器标记为 enabled=false）
 */
export function applySecurityPolicy(
  configs: McpServerConfig[],
  policy: McpSecurityPolicy,
): McpServerConfig[] {
  return configs.map(config => {
    const decision = evaluateAccess(config.name, policy);

    if (decision === 'allowed') return config;

    const reasons: Record<string, string> = {
      denied_by_denylist: '被黑名单阻止',
      denied_by_allowlist: '不在白名单中',
      disabled: '已被禁用',
    };
    log.warn(`MCP "${config.name}" ${reasons[decision] ?? decision}，跳过`);
    return { ...config, enabled: false };
  });
}
