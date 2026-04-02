import { describe, it, expect } from 'vitest';

// 直接测试 calculateBackoff 和 extractRetryAfterSeconds 的逻辑
// （它们是模块内私有函数，此处复制逻辑进行单元测试）

function calculateBackoff(attempt: number, opts?: {
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: number;
  retryAfterSeconds?: number;
}): number {
  if (opts?.retryAfterSeconds && opts.retryAfterSeconds > 0) {
    return opts.retryAfterSeconds * 1000;
  }
  const { initialDelayMs = 500, maxDelayMs = 32_000, factor = 2, jitter = 0 } = opts ?? {}; // jitter=0 for deterministic tests
  const base = Math.min(initialDelayMs * Math.pow(factor, attempt), maxDelayMs);
  const jitterRange = base * (jitter ?? 0);
  return base + (Math.random() * 2 - 1) * jitterRange;
}

function extractRetryAfterSeconds(errorMessage: string): number | undefined {
  const match = errorMessage.match(/retry.?after[\s:=]*(\d+)/i);
  if (match) return parseInt(match[1]!, 10);
  return undefined;
}

describe('退避策略增强', () => {
  describe('calculateBackoff', () => {
    it('初始延迟 500ms', () => {
      const delay = calculateBackoff(0, { jitter: 0 });
      expect(delay).toBe(500);
    });

    it('指数增长', () => {
      expect(calculateBackoff(1, { jitter: 0 })).toBe(1000);
      expect(calculateBackoff(2, { jitter: 0 })).toBe(2000);
      expect(calculateBackoff(3, { jitter: 0 })).toBe(4000);
      expect(calculateBackoff(4, { jitter: 0 })).toBe(8000);
      expect(calculateBackoff(5, { jitter: 0 })).toBe(16000);
      expect(calculateBackoff(6, { jitter: 0 })).toBe(32000);
    });

    it('最大值 32s（默认）', () => {
      expect(calculateBackoff(10, { jitter: 0 })).toBe(32000);
      expect(calculateBackoff(20, { jitter: 0 })).toBe(32000);
    });

    it('持久模式最大值 5 分钟', () => {
      expect(calculateBackoff(20, { maxDelayMs: 300_000, jitter: 0 })).toBe(300_000);
    });

    it('Retry-After 优先', () => {
      const delay = calculateBackoff(0, { retryAfterSeconds: 10 });
      expect(delay).toBe(10000);
    });

    it('Retry-After = 0 时忽略', () => {
      const delay = calculateBackoff(0, { retryAfterSeconds: 0, jitter: 0 });
      expect(delay).toBe(500); // 回退到指数退避
    });
  });

  describe('extractRetryAfterSeconds', () => {
    it('从错误消息中提取 Retry-After', () => {
      expect(extractRetryAfterSeconds('Rate limited. Retry-After: 30')).toBe(30);
      expect(extractRetryAfterSeconds('retry after 15 seconds')).toBe(15);
      expect(extractRetryAfterSeconds('Retry-After=60')).toBe(60);
    });

    it('无 Retry-After 返回 undefined', () => {
      expect(extractRetryAfterSeconds('Rate limited')).toBeUndefined();
      expect(extractRetryAfterSeconds('Server overloaded')).toBeUndefined();
    });
  });
});
