import { describe, it, expect } from 'vitest';
import { ToolSafetyGuard } from '../agent/tool-safety.js';

describe('ToolSafetyGuard', () => {
  describe('循环检测', () => {
    it('正常调用不应阻止', () => {
      const guard = new ToolSafetyGuard();
      const result = guard.checkBeforeExecution('read', { path: '/a.ts' });
      expect(result.blocked).toBe(false);
    });

    it('重复模式: 同一工具+相同参数连续调用应阻止', () => {
      const guard = new ToolSafetyGuard({ repeatThreshold: 3 });
      guard.checkBeforeExecution('read', { path: '/a.ts' });
      guard.checkBeforeExecution('read', { path: '/a.ts' });
      const result = guard.checkBeforeExecution('read', { path: '/a.ts' });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('重复调用');
    });

    it('不同参数不应触发重复检测', () => {
      const guard = new ToolSafetyGuard({ repeatThreshold: 3 });
      guard.checkBeforeExecution('read', { path: '/a.ts' });
      guard.checkBeforeExecution('read', { path: '/b.ts' });
      const result = guard.checkBeforeExecution('read', { path: '/c.ts' });
      expect(result.blocked).toBe(false);
    });

    it('乒乓模式: 两个工具交替调用应阻止', () => {
      const guard = new ToolSafetyGuard({ pingPongThreshold: 2 });
      guard.checkBeforeExecution('read', { path: '/a.ts' });
      guard.checkBeforeExecution('write', { path: '/a.ts' });
      guard.checkBeforeExecution('read', { path: '/a.ts' });
      const result = guard.checkBeforeExecution('write', { path: '/a.ts' });
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('乒乓');
    });

    it('全局熔断: 超过阈值应阻止', () => {
      const guard = new ToolSafetyGuard({ circuitBreakerThreshold: 5 });
      for (let i = 0; i < 5; i++) {
        guard.checkBeforeExecution(`tool${i}`, { i });
      }
      const result = guard.checkBeforeExecution('another', {});
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('熔断');
    });

    it('默认熔断阈值为 30', () => {
      const guard = new ToolSafetyGuard();
      for (let i = 0; i < 30; i++) {
        guard.checkBeforeExecution(`tool${i}`, { i });
      }
      const result = guard.checkBeforeExecution('overflow', {});
      expect(result.blocked).toBe(true);
    });
  });

  describe('结果截断', () => {
    it('短结果不应截断', () => {
      const guard = new ToolSafetyGuard({ maxResultLength: 100 });
      const result = guard.truncateResult('hello');
      expect(result).toBe('hello');
    });

    it('长结果应截断并添加提示', () => {
      const guard = new ToolSafetyGuard({ maxResultLength: 10 });
      const long = 'a'.repeat(100);
      const result = guard.truncateResult(long);
      expect(result.length).toBeLessThan(100);
      expect(result).toContain('已截断');
      expect(result).toContain('100');
    });

    it('默认截断长度为 50000', () => {
      const guard = new ToolSafetyGuard();
      const text = 'x'.repeat(60000);
      const result = guard.truncateResult(text);
      expect(result).toContain('已截断');
    });
  });

  describe('统计信息', () => {
    it('应返回正确的统计', () => {
      const guard = new ToolSafetyGuard();
      guard.checkBeforeExecution('read', {});
      guard.checkBeforeExecution('write', {});
      guard.checkBeforeExecution('read', {});

      const stats = guard.getStats();
      expect(stats.totalCalls).toBe(3);
      expect(stats.uniqueTools).toBe(2);
      expect(stats.recentCalls).toEqual(['read', 'write', 'read']);
    });
  });

  describe('重置', () => {
    it('重置后应清除所有状态', () => {
      const guard = new ToolSafetyGuard();
      guard.checkBeforeExecution('read', {});
      guard.checkBeforeExecution('write', {});
      guard.reset();

      const stats = guard.getStats();
      expect(stats.totalCalls).toBe(0);
      expect(stats.recentCalls).toEqual([]);
    });
  });
});
