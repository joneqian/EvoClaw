/**
 * Mann-Whitney U 检验（手写实现，无外部依赖）— M7-Tier3 PR-T3-1b
 *
 * 用途：A-B 测试样本量 N=30~200 时检验"两组数据是否来自同一分布"。
 * 适用场景：success（0/1 二值）+ duration_ms（右偏分布）。
 *
 * 算法（参考 Mann & Whitney 1947）：
 *   1. 把两组数据合并按值升序排序
 *   2. 给每个样本分配秩（1-indexed），相等值取平均秩
 *   3. 计算两组秩和 R1、R2
 *   4. U1 = R1 - n1(n1+1)/2，U2 = n1*n2 - U1
 *   5. U = min(U1, U2)
 *   6. 大样本 (n1, n2 >= 8) 用正态近似：
 *        Z = (U - n1*n2/2) / sqrt(n1*n2*(n1+n2+1)/12)
 *      双尾 p = 2 * (1 - Φ(|Z|))
 *
 * 小样本 (n < 8) 也使用正态近似 — power 较低但不报错；
 * 调用方应另行校验 n >= MIN_SAMPLE 才信任 p 值（D6 默认 30）。
 *
 * 不处理 ties 修正（Newcombe 调整）— EvoClaw 数据 ties 比例小，影响可忽略。
 */

import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('mann-whitney');

export interface MannWhitneyResult {
  /** 较小的 U 统计量（U = min(U1, U2)） */
  u: number;
  /** 双尾 p 值（正态近似） */
  pValue: number;
  /** A 组样本数 */
  n1: number;
  /** B 组样本数 */
  n2: number;
  /** A 组平均秩（用于判断方向） */
  meanRankA: number;
  /** B 组平均秩（meanRankB > meanRankA → B 整体大于 A） */
  meanRankB: number;
}

/**
 * 计算 Mann-Whitney U 统计量 + 双尾 p 值。
 *
 * @param a A 组数据
 * @param b B 组数据
 * @returns u/pValue/n1/n2/meanRankA/meanRankB；输入为空时返回 pValue=1
 */
export function mannWhitneyU(a: number[], b: number[]): MannWhitneyResult {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 === 0 || n2 === 0) {
    return { u: 0, pValue: 1, n1, n2, meanRankA: 0, meanRankB: 0 };
  }

  // 1. 合并 + 标记来源
  const combined: { value: number; group: 'A' | 'B' }[] = [];
  for (const v of a) combined.push({ value: v, group: 'A' });
  for (const v of b) combined.push({ value: v, group: 'B' });
  combined.sort((x, y) => x.value - y.value);

  // 2. 平均秩（处理 ties）
  const ranks: number[] = Array.from({ length: combined.length });
  let i = 0;
  while (i < combined.length) {
    let j = i;
    while (j < combined.length - 1 && combined[j + 1]!.value === combined[i]!.value) j++;
    // 区间 [i..j] 是同值 ties；分配平均秩 (i+1 + j+1) / 2 = (i+j)/2 + 1
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = avgRank;
    i = j + 1;
  }

  // 3. 秩和
  let r1 = 0;
  for (let k = 0; k < combined.length; k++) {
    if (combined[k]!.group === 'A') r1 += ranks[k]!;
  }
  const r2 = (n1 + n2) * (n1 + n2 + 1) / 2 - r1;

  // 4. U 统计量
  const u1 = r1 - n1 * (n1 + 1) / 2;
  const u2 = n1 * n2 - u1;
  const u = Math.min(u1, u2);

  // 5. 正态近似（无 ties 修正版本）
  const meanU = (n1 * n2) / 2;
  const sdU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  let pValue = 1;
  if (sdU > 0) {
    const z = (u - meanU) / sdU;
    pValue = 2 * (1 - normalCdf(Math.abs(z)));
    if (pValue < 0) pValue = 0;
    if (pValue > 1) pValue = 1;
  }

  const meanRankA = r1 / n1;
  const meanRankB = r2 / n2;

  log.debug('mannWhitneyU', { n1, n2, u, pValue, meanRankA, meanRankB });
  return { u, pValue, n1, n2, meanRankA, meanRankB };
}

/**
 * 标准正态 CDF Φ(z) = (1 + erf(z/√2)) / 2
 *
 * erf 近似用 Abramowitz & Stegun 7.1.26（最大误差 1.5e-7，对统计检验足够）。
 */
export function normalCdf(z: number): number {
  return (1 + erf(z / Math.SQRT2)) / 2;
}

/**
 * Error function 近似（Abramowitz & Stegun 7.1.26）。
 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);

  // A&S constants
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}
