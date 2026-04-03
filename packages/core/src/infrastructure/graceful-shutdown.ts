/**
 * 优雅关闭协议
 *
 * SIGTERM/SIGINT → 宽限期（flush 队列、等待进行中的请求、关闭连接）→ 强制退出
 *
 * 参考 Claude Code: SIGTERM → 30s 宽限期 → SIGKILL
 */

import { createLogger } from './logger.js';

const log = createLogger('shutdown');

/** 关闭阶段回调 */
export interface ShutdownHandler {
  /** 处理器名称（日志用） */
  name: string;
  /** 关闭回调（应在合理时间内完成） */
  handler: () => Promise<void> | void;
  /** 优先级（数字越小越先执行，默认 100） */
  priority?: number;
}

/** 宽限期（毫秒） */
const GRACE_PERIOD_MS = 30_000;

/** 已注册的关闭处理器 */
const handlers: ShutdownHandler[] = [];

/** 是否已开始关闭 */
let shuttingDown = false;

/**
 * 注册关闭处理器
 *
 * @example
 * registerShutdownHandler({ name: 'db', handler: () => store.close(), priority: 90 });
 */
export function registerShutdownHandler(handler: ShutdownHandler): void {
  handlers.push(handler);
}

/** 是否正在关闭 */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * 安装信号处理器（在 server 启动后调用一次）
 */
export function installShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      log.warn(`重复收到 ${signal}，强制退出`);
      process.exit(1);
    }
    shuttingDown = true;
    log.info(`收到 ${signal}，开始优雅关闭（${GRACE_PERIOD_MS / 1000}s 宽限期）...`);

    // 强制退出定时器
    const forceTimer = setTimeout(() => {
      log.error('宽限期超时，强制退出');
      process.exit(1);
    }, GRACE_PERIOD_MS);
    // 不阻止进程退出
    if (forceTimer.unref) forceTimer.unref();

    // 按优先级排序执行（数字小的先执行）
    const sorted = [...handlers].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

    for (const { name, handler } of sorted) {
      try {
        log.info(`关闭: ${name}...`);
        await handler();
        log.info(`关闭: ${name} ✓`);
      } catch (err) {
        log.error(`关闭 ${name} 失败: ${err instanceof Error ? err.message : err}`);
      }
    }

    clearTimeout(forceTimer);
    log.info('优雅关闭完成');
    process.exit(0);
  };

  // 移除旧的空 handler（server.ts 全局级的占位 handler）
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
