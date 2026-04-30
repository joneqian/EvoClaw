import { describe, it, expect, vi } from 'vitest';

import {
  extractRetryAfterSeconds,
  withFeishuRetry,
  computeBackoffDelay,
  DEFAULT_MAX_DELAY_MS,
} from '../channel/adapters/feishu/common/retry.js';
import { FeishuApiError } from '../channel/adapters/feishu/outbound/index.js';

describe('extractRetryAfterSeconds', () => {
  it('解析 "Retry-After: <n>" 形式', () => {
    expect(extractRetryAfterSeconds('Rate limited. Retry-After: 30')).toBe(30);
  });

  it('解析 "retry after <n>" 形式（容忍空格分隔）', () => {
    expect(extractRetryAfterSeconds('retry after 15 seconds')).toBe(15);
  });

  it('解析 "Retry-After=<n>" 形式（key=value）', () => {
    expect(extractRetryAfterSeconds('Retry-After=60')).toBe(60);
  });

  it('无 Retry-After 关键词时返回 undefined', () => {
    expect(extractRetryAfterSeconds('Rate limited')).toBeUndefined();
    expect(extractRetryAfterSeconds('Server overloaded')).toBeUndefined();
  });

  it('支持直接传入 Error 实例（从 message 抽取）', () => {
    const err = new Error('retry after 15');
    expect(extractRetryAfterSeconds(err)).toBe(15);
  });

  it('对 null/undefined/数字/对象输入返回 undefined 而不抛', () => {
    expect(extractRetryAfterSeconds(null)).toBeUndefined();
    expect(extractRetryAfterSeconds(undefined)).toBeUndefined();
    expect(extractRetryAfterSeconds(0)).toBeUndefined();
    expect(extractRetryAfterSeconds({})).toBeUndefined();
  });
});

describe('withFeishuRetry — Retry-After 接入', () => {
  it('限流错带 Retry-After: 5 → sleep 5000ms（服务端建议优先于退避）', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new FeishuApiError('send', 99991400, 'Rate limited. Retry-After: 5');
      }
      return 'ok';
    });

    const result = await withFeishuRetry(fn, { sleep, label: 'test' });

    expect(result).toBe('ok');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it('限流错无 Retry-After → 走 equal-jitter 退避（行为等价改前）', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const random = vi.fn().mockReturnValue(0.5); // 固定 jitter
    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new FeishuApiError('send', 99991663, 'Too many requests');
      }
      return 'ok';
    });

    await withFeishuRetry(fn, { sleep, random, label: 'test' });

    // computeBackoffDelay(0, 1000, () => 0.5) = floor(500 + 0.5*500) = 750
    const expected = computeBackoffDelay(0, 1000, () => 0.5);
    expect(sleep).toHaveBeenCalledWith(expected);
  });

  it('限流错带 Retry-After: 999 → sleep 截断到默认 60_000ms', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new FeishuApiError('send', 99991400, 'Rate limited. Retry-After: 999');
      }
      return 'ok';
    });

    await withFeishuRetry(fn, { sleep, label: 'test' });

    expect(sleep).toHaveBeenCalledWith(DEFAULT_MAX_DELAY_MS);
  });

  it('自定义 maxDelayMs 优先 → Retry-After 被截断到自定义上限', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new FeishuApiError('send', 99991400, 'Rate limited. Retry-After: 30');
      }
      return 'ok';
    });

    await withFeishuRetry(fn, { sleep, maxDelayMs: 5000, label: 'test' });

    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it('网络瞬态错（非限流）无 Retry-After → 走 equal-jitter，不读 Retry-After', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const random = vi.fn().mockReturnValue(0.5);
    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        const err = new Error('socket hang up');
        (err as { code?: string }).code = 'ECONNRESET';
        throw err;
      }
      return 'ok';
    });

    await withFeishuRetry(fn, { sleep, random, label: 'test' });

    const expected = computeBackoffDelay(0, 1000, () => 0.5);
    expect(sleep).toHaveBeenCalledWith(expected);
  });
});
