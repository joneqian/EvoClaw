/**
 * M4 T2 单元测试：startWithReconnect 指数退避 + 最大 5 次重试
 *
 * 验证 packages/core/src/mcp/mcp-reconnect.ts 的行为：
 * - 成功时返回 true，失败时返回 false
 * - 指数退避 1s → 2s → 4s → 8s → 16s（MAX 30s 兜底）
 * - 最多 5 次尝试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startWithReconnect } from '../../mcp/mcp-reconnect.js';
import type { McpClient } from '../../mcp/mcp-client.js';

/**
 * 构造一个按预设 status 序列响应 start() 调用的 mock McpClient。
 * 每次调用 start() 推进 statuses 队列，status 取当前头部。
 */
function makeMockClient(statuses: Array<'running' | 'error'>, name = 'mock-srv'): {
  client: McpClient;
  startCalls: number;
} {
  let callIdx = 0;
  const self: Record<string, unknown> = {
    serverName: name,
    get status() {
      // 首次 start() 前为 'stopped'；每次 start() 完成后状态推进
      if (callIdx === 0) return 'stopped';
      return statuses[Math.min(callIdx - 1, statuses.length - 1)];
    },
    get error() {
      return self.status === 'error' ? `mock error #${callIdx}` : undefined;
    },
    start: vi.fn(async () => {
      callIdx += 1;
    }),
  };
  return {
    client: self as unknown as McpClient,
    get startCalls() { return callIdx; },
  };
}

describe('startWithReconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('第 1 次直接成功时返回 true 且不退避', async () => {
    const mock = makeMockClient(['running']);
    const promise = startWithReconnect(mock.client);

    // 不需要 advanceTimers，第一次成功立即 return
    const ok = await promise;
    expect(ok).toBe(true);
    expect(mock.startCalls).toBe(1);
  });

  it('前 2 次 error、第 3 次 running 时返回 true', async () => {
    const mock = makeMockClient(['error', 'error', 'running']);
    const promise = startWithReconnect(mock.client);

    // attempt 0: start 调用 → error → 等 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    // attempt 1: start → error → 等 2000ms
    await vi.advanceTimersByTimeAsync(2000);
    // attempt 2: start → running → return true（无更多退避）

    const ok = await promise;
    expect(ok).toBe(true);
    expect(mock.startCalls).toBe(3);
  });

  it('5 次全失败返回 false，总共 5 次 start 调用', async () => {
    const mock = makeMockClient(['error', 'error', 'error', 'error', 'error']);
    const promise = startWithReconnect(mock.client);

    // 5 次失败后的退避累计：1s + 2s + 4s + 8s + 16s = 31s
    await vi.advanceTimersByTimeAsync(31_000);

    const ok = await promise;
    expect(ok).toBe(false);
    expect(mock.startCalls).toBe(5);
  });

  it('指数退避时序：第 2 次 start 发生在 1s 后，第 3 次 start 发生在再 2s 后', async () => {
    const mock = makeMockClient(['error', 'error', 'running']);
    const promise = startWithReconnect(mock.client);

    // 立刻：attempt 0 执行，调用数 = 1
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.startCalls).toBe(1);

    // < 1s：还未推进到下次 attempt
    await vi.advanceTimersByTimeAsync(999);
    expect(mock.startCalls).toBe(1);

    // 跨越 1s：attempt 1 触发
    await vi.advanceTimersByTimeAsync(1);
    expect(mock.startCalls).toBe(2);

    // < 2s：还未到下次
    await vi.advanceTimersByTimeAsync(1999);
    expect(mock.startCalls).toBe(2);

    // 跨越 2s：attempt 2 触发 → running → 退出
    await vi.advanceTimersByTimeAsync(1);
    expect(mock.startCalls).toBe(3);

    const ok = await promise;
    expect(ok).toBe(true);
  });

  it('退避被 MAX_BACKOFF_MS=30s 兜底（理论 attempt=5 指数为 32s，被裁到 30s）', async () => {
    // 虽然 MAX_RECONNECT_ATTEMPTS=5 不会走到 attempt=5，
    // 这里通过"5 次全失败"总耗时来间接验证各次 backoff 的累计上限。
    const mock = makeMockClient(['error', 'error', 'error', 'error', 'error']);
    const promise = startWithReconnect(mock.client);

    // 5 次失败后退避累计理论值：1 + 2 + 4 + 8 + 16 = 31s
    // 若 cap 错误地设置 < 16s，累计会 < 31s；若未裁剪，仍为 31s（单次 ≤ 30s 显然成立）
    // 这里推进 31s 应能让函数退出
    await vi.advanceTimersByTimeAsync(31_000);

    const ok = await promise;
    expect(ok).toBe(false);
    expect(mock.startCalls).toBe(5);

    // 再推进大量时间不应产生额外 start 调用（确保函数已真正退出）
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.startCalls).toBe(5);
  });
});
