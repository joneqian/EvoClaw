import { describe, it, expect, vi } from 'vitest';

import {
  withChannelRetry,
  extractRetryAfterSeconds,
  computeBackoffDelay,
  looksLikeTransientNetworkError,
  DEFAULT_MAX_DELAY_MS,
} from '../../channel/common/retry.js';

describe('channel/common/retry — 通用层单元', () => {
  describe('extractRetryAfterSeconds', () => {
    it('解析多种 Retry-After 格式', () => {
      expect(extractRetryAfterSeconds('Rate limited. Retry-After: 30')).toBe(30);
      expect(extractRetryAfterSeconds('retry after 15 seconds')).toBe(15);
      expect(extractRetryAfterSeconds('Retry-After=60')).toBe(60);
    });

    it('无关键词或非 string/Error 输入返回 undefined', () => {
      expect(extractRetryAfterSeconds('Rate limited')).toBeUndefined();
      expect(extractRetryAfterSeconds(null)).toBeUndefined();
      expect(extractRetryAfterSeconds(0)).toBeUndefined();
      expect(extractRetryAfterSeconds({})).toBeUndefined();
    });

    it('Error 实例从 message 抽取', () => {
      expect(extractRetryAfterSeconds(new Error('retry after 5'))).toBe(5);
    });
  });

  describe('looksLikeTransientNetworkError', () => {
    it('识别 Node 系列网络异常 code', () => {
      const err = Object.assign(new Error('boom'), { code: 'ECONNRESET' });
      expect(looksLikeTransientNetworkError(err)).toBe(true);
    });

    it('识别 HTTP 5xx 状态', () => {
      const err = { statusCode: 503, message: 'Service Unavailable' };
      expect(looksLikeTransientNetworkError(err)).toBe(true);
    });

    it('400 客户端错不视为瞬态', () => {
      const err = { statusCode: 400 };
      expect(looksLikeTransientNetworkError(err)).toBe(false);
    });

    it('普通 Error message 含 timeout 关键词识别', () => {
      expect(looksLikeTransientNetworkError(new Error('socket hang up'))).toBe(true);
      expect(looksLikeTransientNetworkError(new Error('request timeout'))).toBe(true);
    });
  });

  describe('withChannelRetry', () => {
    it('isRetryable=false 立即上抛，不重试', async () => {
      const sleep = vi.fn();
      const fn = vi.fn(async () => {
        throw new Error('fatal');
      });
      await expect(
        withChannelRetry(fn, { isRetryable: () => false, sleep }),
      ).rejects.toThrow('fatal');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it('isRetryable=true 重试到达 maxAttempts 后上抛', async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const fn = vi.fn(async () => {
        throw new Error('keep failing');
      });
      await expect(
        withChannelRetry(fn, { isRetryable: () => true, sleep, maxAttempts: 3 }),
      ).rejects.toThrow('keep failing');
      expect(fn).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenCalledTimes(2); // 失败 N 次需要 sleep N-1 次
    });

    it('Retry-After hint 优先于退避', async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      let count = 0;
      const fn = vi.fn(async () => {
        count += 1;
        if (count === 1) throw new Error('Rate limited. Retry-After: 7');
        return 'ok';
      });
      const res = await withChannelRetry(fn, { isRetryable: () => true, sleep });
      expect(res).toBe('ok');
      expect(sleep).toHaveBeenCalledOnce();
      expect(sleep).toHaveBeenCalledWith(7000);
    });

    it('Retry-After 超 maxDelayMs 默认上限被截断到 60_000', async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      let count = 0;
      const fn = vi.fn(async () => {
        count += 1;
        if (count === 1) throw new Error('Retry-After: 999');
        return 'ok';
      });
      await withChannelRetry(fn, { isRetryable: () => true, sleep });
      expect(sleep).toHaveBeenCalledWith(DEFAULT_MAX_DELAY_MS);
    });

    it('自定义 maxDelayMs 优先 → Retry-After 截断到自定义上限', async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      let count = 0;
      const fn = vi.fn(async () => {
        count += 1;
        if (count === 1) throw new Error('Retry-After: 30');
        return 'ok';
      });
      await withChannelRetry(fn, {
        isRetryable: () => true,
        sleep,
        maxDelayMs: 5000,
      });
      expect(sleep).toHaveBeenCalledWith(5000);
    });

    it('无 Retry-After 时走 equal-jitter（行为可与 computeBackoffDelay 复算对齐）', async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      const random = vi.fn().mockReturnValue(0.5);
      let count = 0;
      const fn = vi.fn(async () => {
        count += 1;
        if (count === 1) throw new Error('network blip'); // 不含 retry-after
        return 'ok';
      });
      await withChannelRetry(fn, { isRetryable: () => true, sleep, random });
      const expected = computeBackoffDelay(0, 1000, () => 0.5);
      expect(sleep).toHaveBeenCalledWith(expected);
    });
  });
});
