/**
 * MCP 重连机制
 *
 * 参考 Claude Code useManageMCPConnections():
 * - 最多 5 次重连
 * - 指数退避（1s → 30s）
 * - 连续 3 次错误 → 强制关闭 → 重连
 */

import type { McpClient } from './mcp-client.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('mcp-reconnect');

const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * 带重连的 MCP 客户端启动
 *
 * @param client MCP 客户端实例
 * @returns 是否最终连接成功
 */
export async function startWithReconnect(client: McpClient): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
    await client.start();

    if (client.status === 'running') {
      if (attempt > 0) {
        log.info(`MCP "${client.serverName}" 重连成功 (第 ${attempt + 1} 次尝试)`);
      }
      return true;
    }

    // 计算退避时间
    const backoffMs = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
    log.warn(`MCP "${client.serverName}" 连接失败 (${attempt + 1}/${MAX_RECONNECT_ATTEMPTS}), ${backoffMs}ms 后重试: ${client.error}`);

    await new Promise(resolve => setTimeout(resolve, backoffMs));
  }

  log.error(`MCP "${client.serverName}" 重连失败，已达最大尝试次数 (${MAX_RECONNECT_ATTEMPTS})`);
  return false;
}
