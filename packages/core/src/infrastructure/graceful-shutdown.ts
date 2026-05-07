/**
 * 优雅关闭协议
 *
 * SIGTERM/SIGINT → 宽限期（flush 队列、等待进行中的请求、关闭连接）→ 强制退出
 *
 * 参考 Claude Code: SIGTERM → 30s 宽限期 → SIGKILL
 *
 * Reentrant safety: signal handler 内部所有日志调用走 logSafe()，
 * 防止 logger I/O 异常（盘满 / socket 断 / 已关闭）破坏关闭流程导致 30s 超时强杀。
 */

import { createLogger, type LogLevel } from './logger.js';

const log = createLogger('shutdown');

/**
 * Reentrant-safe 日志：吞掉 logger 自身抛出的异常。
 *
 * 关闭流程里 logger 可能因为以下原因失败：
 * - 写盘失败（盘满 / 文件系统只读）
 * - stderr 已关闭
 * - 限流计数器内部状态异常
 *
 * 任何 logger 失败都不能影响后续 handler 执行——否则会卡到 30s 超时被 SIGKILL，
 * 此时 db.close() / persister.flush() 等关键操作可能未完成，造成数据损坏。
 */
function logSafe(level: LogLevel, message: string, extra?: unknown): void {
  try {
    log[level](message, extra);
  } catch {
    // 故意吞异常 - 关闭流程的稳定性优先于日志完整性
  }
}

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

/** 活跃的 IncrementalPersister 实例（关闭时 flush） */
const activePersisters = new Set<{ flush(): void }>();

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

/**
 * 注册活跃的 IncrementalPersister（关闭时自动 flush）
 */
export function registerActivePersister(persister: { flush(): void }): void {
  activePersisters.add(persister);
}

/**
 * 注销 IncrementalPersister（正常结束后调用）
 */
export function unregisterActivePersister(persister: { flush(): void }): void {
  activePersisters.delete(persister);
}

/** 是否正在关闭 */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * 执行关闭序列（不含 process.exit / 不含强制超时定时器）。
 *
 * 抽出来作为内部纯函数，便于单元测试 mock logger 抛异常验证 reentrant safety。
 * 调用方（installShutdownHandlers）负责套上 forceTimer 和 process.exit。
 */
async function runShutdownSequence(signal: string): Promise<void> {
  logSafe('info', `收到 ${signal}，开始优雅关闭（${GRACE_PERIOD_MS / 1000}s 宽限期）...`);

  // 优先 flush 所有活跃的 IncrementalPersister（在其他 handler 之前）
  if (activePersisters.size > 0) {
    logSafe('info', `Flush ${activePersisters.size} 个活跃 persister...`);
    for (const persister of activePersisters) {
      try {
        persister.flush();
      } catch (err) {
        logSafe('error', `Persister flush 失败: ${err instanceof Error ? err.message : err}`);
      }
    }
    activePersisters.clear();
    logSafe('info', 'Persister flush 完成');
  }

  // 按优先级排序执行（数字小的先执行）
  const sorted = [...handlers].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  for (const { name, handler } of sorted) {
    try {
      logSafe('info', `关闭: ${name}...`);
      await handler();
      logSafe('info', `关闭: ${name} ✓`);
    } catch (err) {
      logSafe('error', `关闭 ${name} 失败: ${err instanceof Error ? err.message : err}`);
    }
  }

  logSafe('info', '优雅关闭完成');
}

/**
 * 安装信号处理器（在 server 启动后调用一次）
 */
export function installShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      logSafe('warn', `重复收到 ${signal}，强制退出`);
      process.exit(1);
    }
    shuttingDown = true;

    // 强制退出定时器
    const forceTimer = setTimeout(() => {
      logSafe('error', '宽限期超时，强制退出');
      process.exit(1);
    }, GRACE_PERIOD_MS);
    // 不阻止进程退出
    if (forceTimer.unref) forceTimer.unref();

    await runShutdownSequence(signal);

    clearTimeout(forceTimer);
    process.exit(0);
  };

  // 移除旧的空 handler（server.ts 全局级的占位 handler）
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/**
 * 测试专用：内部 API 暴露给单元测试，业务代码不应使用。
 */
export const __testing = {
  runShutdownSequence,
  reset(): void {
    handlers.length = 0;
    activePersisters.clear();
    shuttingDown = false;
  },
};
