/**
 * MCP 子进程环境变量白名单 — 防止 API Key 被恶意 MCP server 读取并外发
 *
 * M8 后：底层逻辑迁移到 @evoclaw/shared 的 sanitizeEnv（whitelist 模式），
 * 本文件保留同名 API 以保持向后兼容。
 */

import { sanitizeEnv, isSensitiveEnvName as sharedIsSensitiveEnvName } from '@evoclaw/shared';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('mcp-env');

/** 判断 env 名是否敏感（即使在用户白名单也拒） */
export function isSensitiveEnvName(name: string): boolean {
  return sharedIsSensitiveEnvName(name);
}

/** 构建 MCP 子进程的安全 env */
export function buildMcpEnv(
  processEnv: NodeJS.ProcessEnv | Record<string, string | undefined>,
  serverEnv?: Record<string, string>,
  userPassthrough?: readonly string[],
): { env: Record<string, string>; stripped: string[] } {
  // 检查 serverEnv（显式配置的敏感凭据会被透传，提示管理员注意）
  if (serverEnv) {
    const sensitive = Object.keys(serverEnv).filter((k) => sharedIsSensitiveEnvName(k));
    if (sensitive.length > 0) {
      log.warn(
        `MCP server 显式配置了敏感变量（将原样传给子进程，确认信任该 server）: ${sensitive.join(', ')}`,
      );
    }
  }
  return sanitizeEnv(processEnv, {
    mode: 'whitelist',
    userPassthrough,
    extraEnv: serverEnv,
  });
}
