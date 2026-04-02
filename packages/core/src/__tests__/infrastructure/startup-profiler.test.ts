/**
 * StartupProfiler 测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StartupProfiler } from '../../infrastructure/startup-profiler.js';

describe('StartupProfiler', () => {
  let profiler: StartupProfiler;

  beforeEach(() => {
    profiler = new StartupProfiler();
  });

  it('应记录检查点并计算耗时', () => {
    profiler.checkpoint('start');
    profiler.checkpoint('end');
    const report = profiler.getReport();
    expect(report.checkpoints).toHaveLength(2);
    expect(report.checkpoints[0].name).toBe('start');
    expect(report.checkpoints[1].name).toBe('end');
    expect(report.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('每个检查点应有相对于起点的耗时', () => {
    profiler.checkpoint('a');
    profiler.checkpoint('b');
    const report = profiler.getReport();
    expect(report.checkpoints[0].elapsedMs).toBe(0);
    expect(report.checkpoints[1].elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('应计算相邻检查点间的 delta', () => {
    profiler.checkpoint('a');
    profiler.checkpoint('b');
    profiler.checkpoint('c');
    const report = profiler.getReport();
    expect(report.checkpoints[0].deltaMs).toBe(0);
    expect(report.checkpoints[1].deltaMs).toBeGreaterThanOrEqual(0);
    expect(report.checkpoints[2].deltaMs).toBeGreaterThanOrEqual(0);
  });

  it('formatReport 应返回可读字符串', () => {
    profiler.checkpoint('config_loaded');
    profiler.checkpoint('db_ready');
    const text = profiler.formatReport();
    expect(text).toContain('config_loaded');
    expect(text).toContain('db_ready');
    expect(text).toContain('ms');
  });

  it('空 profiler 应返回空报告', () => {
    const report = profiler.getReport();
    expect(report.checkpoints).toHaveLength(0);
    expect(report.totalMs).toBe(0);
  });

  it('空 profiler formatReport 应返回提示文本', () => {
    expect(profiler.formatReport()).toBe('(no checkpoints)');
  });
});
