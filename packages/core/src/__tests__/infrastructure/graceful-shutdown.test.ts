/**
 * graceful-shutdown reentrant safety 测试
 *
 * 验证 logSafe() 在 logger 抛异常时仍能完成关闭流程。
 * 这是 #8 Hermes hardening：signal handler 内部不能因为日志失败而崩。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 受测模块在 import 时会调用 createLogger('shutdown')，因此必须在 import
// 之前 mock。throwOnLog 通过 vi.hoisted 在 mock factory 内可见。
const { throwOnLog } = vi.hoisted(() => ({
  throwOnLog: { value: false },
}));

vi.mock('../../infrastructure/logger.js', () => ({
  createLogger: () => ({
    debug: () => {
      if (throwOnLog.value) throw new Error('logger.debug 故意爆炸');
    },
    info: () => {
      if (throwOnLog.value) throw new Error('logger.info 故意爆炸');
    },
    warn: () => {
      if (throwOnLog.value) throw new Error('logger.warn 故意爆炸');
    },
    error: () => {
      if (throwOnLog.value) throw new Error('logger.error 故意爆炸');
    },
  }),
  closeLogger: () => undefined,
}));

// 必须在 mock 之后 import
const {
  __testing,
  registerShutdownHandler,
  registerActivePersister,
  unregisterActivePersister,
  isShuttingDown,
} = await import('../../infrastructure/graceful-shutdown.js');

describe('graceful-shutdown reentrant safety', () => {
  beforeEach(() => {
    __testing.reset();
    throwOnLog.value = false;
  });

  it('logger 全部抛异常时，所有 handler 仍按优先级顺序执行完毕', async () => {
    const callOrder: string[] = [];

    registerShutdownHandler({
      name: '渠道',
      priority: 20,
      handler: () => {
        callOrder.push('channel');
      },
    });
    registerShutdownHandler({
      name: '调度器',
      priority: 10,
      handler: () => {
        callOrder.push('scheduler');
      },
    });
    registerShutdownHandler({
      name: '数据库',
      priority: 80,
      handler: () => {
        callOrder.push('db');
      },
    });

    // 让所有 logger 调用抛异常
    throwOnLog.value = true;

    // runShutdownSequence 不应该 throw
    await expect(__testing.runShutdownSequence('SIGTERM')).resolves.toBeUndefined();

    // 优先级 10 → 20 → 80
    expect(callOrder).toEqual(['scheduler', 'channel', 'db']);
  });

  it('某个 handler 自身抛异常时，后续 handler 仍执行', async () => {
    const callOrder: string[] = [];

    registerShutdownHandler({
      name: '会爆的',
      priority: 10,
      handler: () => {
        callOrder.push('boom');
        throw new Error('handler 故意爆炸');
      },
    });
    registerShutdownHandler({
      name: '后续',
      priority: 20,
      handler: () => {
        callOrder.push('after');
      },
    });

    await expect(__testing.runShutdownSequence('SIGTERM')).resolves.toBeUndefined();
    expect(callOrder).toEqual(['boom', 'after']);
  });

  it('logger 抛异常 + handler 也抛异常时，仍能继续后续 handler', async () => {
    const callOrder: string[] = [];

    registerShutdownHandler({
      name: '会爆的',
      priority: 10,
      handler: () => {
        callOrder.push('boom');
        throw new Error('handler 爆炸');
      },
    });
    registerShutdownHandler({
      name: '后续',
      priority: 20,
      handler: () => {
        callOrder.push('after');
      },
    });

    throwOnLog.value = true;

    // 此前若没有 logSafe，logSafe('error', ...) 在记录"关闭 X 失败"时会再抛，
    // 直接打断 for 循环 → '后续' handler 永远不会跑。
    await expect(__testing.runShutdownSequence('SIGTERM')).resolves.toBeUndefined();
    expect(callOrder).toEqual(['boom', 'after']);
  });

  it('Persister flush 在 handler 之前执行，且 logger 异常不影响', async () => {
    const callOrder: string[] = [];
    const persister = {
      flush: () => {
        callOrder.push('flush');
      },
    };
    registerActivePersister(persister);

    registerShutdownHandler({
      name: 'db',
      priority: 50,
      handler: () => {
        callOrder.push('db');
      },
    });

    throwOnLog.value = true;
    await __testing.runShutdownSequence('SIGTERM');

    expect(callOrder).toEqual(['flush', 'db']);
  });

  it('Persister.flush 抛异常时，handler 仍执行', async () => {
    const callOrder: string[] = [];
    registerActivePersister({
      flush: () => {
        callOrder.push('flush-fail');
        throw new Error('flush 爆炸');
      },
    });
    registerShutdownHandler({
      name: 'db',
      priority: 50,
      handler: () => {
        callOrder.push('db');
      },
    });

    await __testing.runShutdownSequence('SIGTERM');
    expect(callOrder).toEqual(['flush-fail', 'db']);
  });

  it('未注册任何 handler 也不抛', async () => {
    throwOnLog.value = true;
    await expect(__testing.runShutdownSequence('SIGTERM')).resolves.toBeUndefined();
  });

  it('unregisterActivePersister 后不再 flush', async () => {
    const callOrder: string[] = [];
    const persister = {
      flush: () => {
        callOrder.push('should-not-run');
      },
    };
    registerActivePersister(persister);
    unregisterActivePersister(persister);

    await __testing.runShutdownSequence('SIGTERM');
    expect(callOrder).toEqual([]);
  });

  it('isShuttingDown 初始为 false（reset 后）', () => {
    expect(isShuttingDown()).toBe(false);
  });

  it('handler 异步抛 promise rejection 仍被捕获', async () => {
    const callOrder: string[] = [];
    registerShutdownHandler({
      name: 'async-boom',
      priority: 10,
      handler: async () => {
        callOrder.push('boom');
        throw new Error('async 爆炸');
      },
    });
    registerShutdownHandler({
      name: 'next',
      priority: 20,
      handler: () => {
        callOrder.push('next');
      },
    });

    await __testing.runShutdownSequence('SIGTERM');
    expect(callOrder).toEqual(['boom', 'next']);
  });
});
