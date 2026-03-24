import { describe, it, expect } from 'vitest';
import { calculateAdaptiveMaxBytes } from '../agent/adaptive-read.js';

describe('calculateAdaptiveMaxBytes', () => {
  it('小 context window 使用默认下限 (50KB)', () => {
    // 8K tokens → 8000 * 4 * 0.2 = 6400 bytes → 远低于 50KB
    const result = calculateAdaptiveMaxBytes(8_000);
    expect(result).toBe(50 * 1024);
  });

  it('128K context window 计算自适应值', () => {
    // 128000 * 4 * 0.2 = 102400 bytes ≈ 100KB
    const result = calculateAdaptiveMaxBytes(128_000);
    expect(result).toBe(102_400);
  });

  it('1M context window 受上限约束 (512KB)', () => {
    // 1000000 * 4 * 0.2 = 800000 → 超过 512KB 上限
    const result = calculateAdaptiveMaxBytes(1_000_000);
    expect(result).toBe(512 * 1024);
  });

  it('200K context window 在合理范围', () => {
    // 200000 * 4 * 0.2 = 160000 → 在 50KB-512KB 之间
    const result = calculateAdaptiveMaxBytes(200_000);
    expect(result).toBe(160_000);
  });
});
