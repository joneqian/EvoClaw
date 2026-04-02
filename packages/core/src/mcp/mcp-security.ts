/**
 * MCP 安全策略 — 白名单/黑名单
 *
 * 参考 Claude Code MCP 安全模型:
 * - 黑名单绝对优先（不可覆盖）
 * - 空白名单 = 阻止所有服务器
 * - 用户可单独禁用服务器
 */

import type { McpServerConfig } from './mcp-config.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('mcp-security');

export interface McpSecurityPolicy {
  /** 允许的服务器名称（空数组 = 阻止所有） */
  allowlist?: string[];
  /** 禁止的服务器名称（绝对优先） */
  denylist?: string[];
  /** 单独禁用的服务器 */
  disabled?: string[];
}

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
    // 黑名单绝对优先
    if (policy.denylist?.includes(config.name)) {
      log.warn(`MCP "${config.name}" 被黑名单阻止`);
      return { ...config, enabled: false };
    }

    // 单独禁用
    if (policy.disabled?.includes(config.name)) {
      log.info(`MCP "${config.name}" 已被用户禁用`);
      return { ...config, enabled: false };
    }

    // 白名单检查（有白名单时，不在白名单中的被拒绝）
    if (policy.allowlist && policy.allowlist.length > 0) {
      if (!policy.allowlist.includes(config.name)) {
        log.warn(`MCP "${config.name}" 不在白名单中，跳过`);
        return { ...config, enabled: false };
      }
    }

    return config;
  });
}
