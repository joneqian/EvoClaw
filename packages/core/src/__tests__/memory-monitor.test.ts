/**
 * MemoryMonitor 单元测试
 */
import { describe, it, expect, afterEach } from 'vitest';
import { MemoryMonitor, type MemorySample } from '../infrastructure/memory-monitor.js';

/** 生成模拟样本 */
function makeSample(overrides: Partial<MemorySample> = {}): MemorySample {
  return {
    timestamp: Date.now(),
    rss: 100 * 1024 * 1024,
    heapUsed: 50 * 1024 * 1024,
    heapTotal: 80 * 1024 * 1024,
    external: 5 * 1024 * 1024,
    arrayBuffers: 2 * 1024 * 1024,
    v8HeapUsed: 48 * 1024 * 1024,
    v8HeapTotal: 78 * 1024 * 1024,
    v8MallocedMemory: 3 * 1024 * 1024,
    ...overrides,
  };
}

describe('MemoryMonitor', () => {
  let monitor: MemoryMonitor;

  afterEach(() => {
    monitor?.stop();
  });

  it('采样应返回有效结构', () => {
    monitor = new MemoryMonitor();
    const sample = monitor.takeSample();
    expect(sample.timestamp).toBeGreaterThan(0);
    expect(sample.rss).toBeGreaterThan(0);
    expect(sample.heapUsed).toBeGreaterThan(0);
    expect(sample.heapTotal).toBeGreaterThan(0);
    expect(sample.v8HeapUsed).toBeGreaterThan(0);
  });

  it('平坦样本 → slope ≈ 0', () => {
    monitor = new MemoryMonitor();
    const baseHeap = 50 * 1024 * 1024;
    const baseTime = Date.now() - 3 * 60 * 60 * 1000; // 3 hours ago

    const samples: MemorySample[] = [];
    for (let i = 0; i < 36; i++) {
      // 5分钟间隔，heapUsed 保持稳定（小波动）
      samples.push(makeSample({
        timestamp: baseTime + i * 5 * 60 * 1000,
        heapUsed: baseHeap + (Math.random() - 0.5) * 1024 * 1024, // ±0.5MB 波动
      }));
    }

    monitor._injectSamples(samples);
    const trend = monitor.computeTrend();
    expect(Math.abs(trend.slopePerHour)).toBeLessThan(2); // 接近 0
    expect(trend.isLeaking).toBe(false);
  });

  it('线性增长样本 → 检测泄漏', () => {
    monitor = new MemoryMonitor();
    const baseHeap = 50 * 1024 * 1024;
    const baseTime = Date.now() - 3 * 60 * 60 * 1000;

    const samples: MemorySample[] = [];
    for (let i = 0; i < 36; i++) {
      // 每 5 分钟增加 ~1MB → ~12MB/hour
      samples.push(makeSample({
        timestamp: baseTime + i * 5 * 60 * 1000,
        heapUsed: baseHeap + i * 1024 * 1024,
      }));
    }

    monitor._injectSamples(samples);
    const trend = monitor.computeTrend();
    expect(trend.slopePerHour).toBeGreaterThan(10);
    expect(trend.r2).toBeGreaterThan(0.9);
    expect(trend.durationHours).toBeGreaterThanOrEqual(2);
    expect(trend.isLeaking).toBe(true);
  });

  it('环形缓冲区溢出 → 丢弃最旧样本', () => {
    monitor = new MemoryMonitor({ maxSamples: 5 });

    for (let i = 0; i < 8; i++) {
      monitor.takeSample();
    }

    expect(monitor._getSampleCount()).toBe(5);
  });

  it('start/stop 生命周期', () => {
    monitor = new MemoryMonitor({ intervalMs: 100 });
    monitor.start();
    expect(monitor._getSampleCount()).toBe(1); // start 立即采集一次

    monitor.stop();
    const count = monitor._getSampleCount();
    // stop 后不应再增加
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('getReport 应返回完整报告', () => {
    monitor = new MemoryMonitor();
    const report = monitor.getReport();
    expect(report.current).toBeDefined();
    expect(report.trend).toBeDefined();
    expect(report.stats.sampleCount).toBeGreaterThan(0);
    expect(report.stats.newestSample).not.toBeNull();
  });

  it('少于 2 个样本时趋势为零', () => {
    monitor = new MemoryMonitor();
    const trend = monitor.computeTrend();
    expect(trend.slopePerHour).toBe(0);
    expect(trend.isLeaking).toBe(false);
  });
});
