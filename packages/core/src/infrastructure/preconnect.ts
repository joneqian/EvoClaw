/**
 * API 预连接 — 提前建立 TCP+TLS 到 LLM API 端点
 *
 * 在 HTTP 服务就绪后、首次 LLM 调用前执行。
 * 减少首次请求的 TCP 握手 + TLS 协商延迟 (~100-300ms)。
 *
 * 参考 Claude Code init.ts — mTLS + HTTP proxy + API preconnect。
 */

import https from 'node:https';
import http from 'node:http';
import type { ConfigManager } from './config-manager.js';
import { createLogger } from './logger.js';

const log = createLogger('preconnect');

/**
 * 对所有已配置 Provider 的 baseUrl 发起预连接
 * 仅建立 TCP+TLS，不发送实际请求
 */
export function preconnectProviders(configManager: ConfigManager): void {
  const providerIds = configManager.getProviderIds();
  const origins = new Set<string>();

  for (const id of providerIds) {
    const provider = configManager.getProvider(id);
    if (provider?.baseUrl) {
      try {
        const parsed = new URL(provider.baseUrl);
        origins.add(parsed.origin);
      } catch {
        // 无效 URL，跳过
      }
    }
  }

  for (const origin of origins) {
    const parsed = new URL(origin);
    const mod = parsed.protocol === 'https:' ? https : http;
    const defaultPort = parsed.protocol === 'https:' ? 443 : 80;
    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || defaultPort,
        method: 'HEAD',
        path: '/',
        timeout: 5_000,
      },
      (res) => { res.resume(); },
    );
    req.on('error', () => { /* 预连接失败不影响正常运行 */ });
    req.on('timeout', () => { req.destroy(); });
    req.end();
    log.info(`预连接: ${origin}`);
  }
}
