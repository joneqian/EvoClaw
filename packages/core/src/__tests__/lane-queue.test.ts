import { describe, it, expect } from 'vitest';
import { LaneQueue } from '../agent/lane-queue.js';

/** 创建延迟 Promise 的辅助函数 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('LaneQueue', () => {
  it('基本入队和执行', async () => {
    const queue = new LaneQueue();
    const result = await queue.enqueue({
      id: 'task-1',
      sessionKey: 'session-1',
      lane: 'main',
      task: async () => 42,
    });
    expect(result).toBe(42);
  });

  it('任务错误应该被传播', async () => {
    const queue = new LaneQueue();
    await expect(
      queue.enqueue({
        id: 'task-err',
        sessionKey: 'session-1',
        lane: 'main',
        task: async () => { throw new Error('任务失败'); },
      })
    ).rejects.toThrow('任务失败');
  });

  it('并发限制：main 车道限制 2 时只有 2 个任务同时运行', async () => {
    const queue = new LaneQueue({ main: 2 });
    let concurrent = 0;
    let maxConcurrent = 0;

    const makeTask = (id: string) =>
      queue.enqueue({
        id,
        sessionKey: id, // 不同 sessionKey 以允许并行
        lane: 'main',
        task: async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await delay(50);
          concurrent--;
          return id;
        },
      });

    const results = await Promise.all([
      makeTask('t1'),
      makeTask('t2'),
      makeTask('t3'),
      makeTask('t4'),
    ]);

    expect(results).toEqual(['t1', 't2', 't3', 't4']);
    expect(maxConcurrent).toBe(2);
  });

  it('相同 sessionKey 的任务串行执行', async () => {
    const queue = new LaneQueue({ main: 4 });
    const executionOrder: string[] = [];

    const makeTask = (id: string, sessionKey: string) =>
      queue.enqueue({
        id,
        sessionKey,
        lane: 'main',
        task: async () => {
          executionOrder.push(`${id}-start`);
          await delay(30);
          executionOrder.push(`${id}-end`);
          return id;
        },
      });

    // 两个任务共享 sessionKey，应该串行
    await Promise.all([
      makeTask('a1', 'shared-session'),
      makeTask('a2', 'shared-session'),
    ]);

    // a1 应该在 a2 开始前完成
    const a1EndIdx = executionOrder.indexOf('a1-end');
    const a2StartIdx = executionOrder.indexOf('a2-start');
    expect(a1EndIdx).toBeLessThan(a2StartIdx);
  });

  it('不同 sessionKey 的任务并行执行', async () => {
    const queue = new LaneQueue({ main: 4 });
    const executionOrder: string[] = [];

    const makeTask = (id: string, sessionKey: string) =>
      queue.enqueue({
        id,
        sessionKey,
        lane: 'main',
        task: async () => {
          executionOrder.push(`${id}-start`);
          await delay(30);
          executionOrder.push(`${id}-end`);
          return id;
        },
      });

    await Promise.all([
      makeTask('x1', 'session-x'),
      makeTask('y1', 'session-y'),
    ]);

    // 两个任务应该几乎同时开始（交错执行）
    const x1StartIdx = executionOrder.indexOf('x1-start');
    const y1StartIdx = executionOrder.indexOf('y1-start');
    // 两个 start 应该在两个 end 之前
    const x1EndIdx = executionOrder.indexOf('x1-end');
    expect(y1StartIdx).toBeLessThan(x1EndIdx);
  });

  it('cancel 应该移除排队中的任务', async () => {
    const queue = new LaneQueue({ main: 1 });
    const results: string[] = [];

    // 第一个任务占住 main 车道
    const p1 = queue.enqueue({
      id: 'blocker',
      sessionKey: 'session-a',
      lane: 'main',
      task: async () => {
        await delay(50);
        results.push('blocker');
        return 'blocker';
      },
    });

    // 第二个任务排队中，立即 catch 避免 unhandled rejection
    let p2Error: Error | undefined;
    const p2 = queue.enqueue({
      id: 'victim',
      sessionKey: 'session-b',
      lane: 'main',
      task: async () => {
        results.push('victim');
        return 'victim';
      },
    }).catch((err: Error) => {
      p2Error = err;
    });

    // 取消排队中的任务
    const cancelled = queue.cancel('victim');
    expect(cancelled).toBe(true);

    await p1;
    await p2;
    expect(p2Error?.message).toBe('Task cancelled');

    expect(results).toEqual(['blocker']);
  });

  it('cancel 不存在的任务返回 false', () => {
    const queue = new LaneQueue();
    expect(queue.cancel('non-existent')).toBe(false);
  });

  it('超时应该拒绝任务', async () => {
    const queue = new LaneQueue();
    await expect(
      queue.enqueue({
        id: 'slow-task',
        sessionKey: 'session-1',
        lane: 'main',
        task: () => delay(500).then(() => 'done'),
        timeoutMs: 30,
      })
    ).rejects.toThrow(/timed out/);
  });

  it('getStatus 应该返回正确的计数', async () => {
    const queue = new LaneQueue({ main: 1 });

    // 初始状态
    const initial = queue.getStatus();
    expect(initial.main.running).toBe(0);
    expect(initial.main.queued).toBe(0);
    expect(initial.main.concurrency).toBe(1);
    expect(initial.subagent.concurrency).toBe(8);
    expect(initial.cron.concurrency).toBe(2);

    // 添加一个阻塞任务和一个排队任务
    let resolveBlocker: () => void;
    const blockerReady = new Promise<void>(r => { resolveBlocker = r; });

    const p1 = queue.enqueue({
      id: 'running-task',
      sessionKey: 'session-1',
      lane: 'main',
      task: () => new Promise<string>(resolve => {
        resolveBlocker!();
        // 保持运行直到外部解除
        setTimeout(() => resolve('done'), 100);
      }),
    });

    // 等待第一个任务开始运行
    await blockerReady;

    queue.enqueue({
      id: 'queued-task',
      sessionKey: 'session-2',
      lane: 'main',
      task: async () => 'queued',
    });

    // 允许一个微任务周期让 drain 调度
    await delay(5);

    const status = queue.getStatus();
    expect(status.main.running).toBe(1);
    expect(status.main.queued).toBe(1);

    // 等待所有任务完成
    await p1;
    await delay(150);
  });
});
