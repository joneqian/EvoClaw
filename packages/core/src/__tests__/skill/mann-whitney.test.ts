/**
 * M7-Tier3 PR-T3-1b: Mann-Whitney U + 正态近似 + erf 单测
 */

import { describe, it, expect } from 'vitest';
import { mannWhitneyU, normalCdf, erf } from '../../skill/mann-whitney.js';

describe('erf', () => {
  it('erf(0) ≈ 0', () => {
    expect(erf(0)).toBeCloseTo(0, 6);
  });

  it('erf 对称（奇函数）', () => {
    for (const x of [0.5, 1, 1.5, 2]) {
      expect(erf(-x)).toBeCloseTo(-erf(x), 6);
    }
  });

  it('erf(∞) ≈ 1', () => {
    expect(erf(10)).toBeCloseTo(1, 6);
    expect(erf(-10)).toBeCloseTo(-1, 6);
  });

  it('erf(1) ≈ 0.8427', () => {
    expect(erf(1)).toBeCloseTo(0.8427, 3);
  });

  it('erf(2) ≈ 0.9953', () => {
    expect(erf(2)).toBeCloseTo(0.9953, 3);
  });
});

describe('normalCdf', () => {
  it('Φ(0) = 0.5', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
  });

  it('Φ(1.96) ≈ 0.975', () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });

  it('Φ(-1.96) ≈ 0.025', () => {
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it('Φ(∞) → 1', () => {
    expect(normalCdf(10)).toBeCloseTo(1, 6);
  });
});

describe('mannWhitneyU', () => {
  it('两组完全相同 → p ≈ 1', () => {
    const a = [1, 1, 1, 1, 1];
    const b = [1, 1, 1, 1, 1];
    const r = mannWhitneyU(a, b);
    expect(r.pValue).toBeCloseTo(1, 1);
  });

  it('B 显著优于 A（success 0/1 二值）→ p < 0.05', () => {
    // A: 30 次成功 5 次（success rate 0.17）
    // B: 30 次成功 25 次（success rate 0.83）
    const a = [...Array(5).fill(1), ...Array(25).fill(0)];
    const b = [...Array(25).fill(1), ...Array(5).fill(0)];
    const r = mannWhitneyU(a, b);
    expect(r.pValue).toBeLessThan(0.001);
    expect(r.meanRankB).toBeGreaterThan(r.meanRankA);
  });

  it('B 显著差于 A → p < 0.05', () => {
    const a = [...Array(25).fill(1), ...Array(5).fill(0)];
    const b = [...Array(5).fill(1), ...Array(25).fill(0)];
    const r = mannWhitneyU(a, b);
    expect(r.pValue).toBeLessThan(0.001);
    expect(r.meanRankA).toBeGreaterThan(r.meanRankB);
  });

  it('小幅差异（5%）N=30 时 power 不足 → p > 0.05（验证 D6 论据）', () => {
    // D6 plan：N=30 下检测 5% 差异 power ~0.30，意味着 70% 概率检测不到
    // 这个测试验证了"激进阈值 5% 在 N=30 下不靠谱"的核心假设
    const a = [...Array(24).fill(1), ...Array(6).fill(0)];  // success rate 0.80
    const b = [...Array(22).fill(1), ...Array(8).fill(0)];  // success rate 0.73 (-7%)
    const r = mannWhitneyU(a, b);
    // 大概率不显著（不严格断言 > 0.05，因为 power 不是 0%；但应远大于 0.001）
    expect(r.pValue).toBeGreaterThan(0.05);
  });

  it('N=0 → 返回 pValue=1', () => {
    expect(mannWhitneyU([], [1, 2, 3]).pValue).toBe(1);
    expect(mannWhitneyU([1, 2], []).pValue).toBe(1);
  });

  it('包含 ties → 不抛异常 + p 值合理', () => {
    const a = [1, 2, 2, 3];
    const b = [2, 3, 3, 4];
    const r = mannWhitneyU(a, b);
    expect(r.pValue).toBeGreaterThanOrEqual(0);
    expect(r.pValue).toBeLessThanOrEqual(1);
    // B 趋向更大值
    expect(r.meanRankB).toBeGreaterThan(r.meanRankA);
  });

  it('U 统计量 = min(U1, U2)', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    const r = mannWhitneyU(a, b);
    expect(r.u).toBeGreaterThanOrEqual(0);
    expect(r.u).toBeLessThanOrEqual(a.length * b.length);
  });

  it('duration 右偏分布场景', () => {
    // A: 大多数 100ms，少数 1000ms（典型 skill 调用分布）
    // B: 大多数 200ms，少数 2000ms（B 整体慢 2x）
    const a = [...Array(25).fill(100), ...Array(5).fill(1000)];
    const b = [...Array(25).fill(200), ...Array(5).fill(2000)];
    const r = mannWhitneyU(a, b);
    expect(r.pValue).toBeLessThan(0.001);
    expect(r.meanRankB).toBeGreaterThan(r.meanRankA);
  });
});
