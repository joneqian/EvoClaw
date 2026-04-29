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

    // M13 修复：原 circuitBreakerThreshold=30 退役，改为 runawayHardCap=500（默认）
    it('绝对上限: 超过 runawayHardCap 应阻止（兜底真死循环）', () => {
      const guard = new ToolSafetyGuard({ runawayHardCap: 5 });
      for (let i = 0; i < 5; i++) {
        guard.checkBeforeExecution(`tool${i}`, { i });
      }
      const result = guard.checkBeforeExecution('another', {});
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('绝对上限');
      expect(result.reason).toContain('update_task_status'); // 引导上报
    });

    it('40 次正常推进的工具调用不再被阻止（之前 30 次熔断已退役）', () => {
      const guard = new ToolSafetyGuard();
      for (let i = 0; i < 40; i++) {
        const result = guard.checkBeforeExecution(`tool${i}`, { i });
        expect(result.blocked).toBe(false);
      }
    });

    it('默认 runawayHardCap 为 500', () => {
      const guard = new ToolSafetyGuard();
      // 499 次都应放行
      for (let i = 0; i < 499; i++) {
        guard.checkBeforeExecution(`tool${i}`, { i });
      }
      // 第 500 次仍放行（>500 才阻）
      const at500 = guard.checkBeforeExecution('tool499b', {});
      expect(at500.blocked).toBe(false);
      // 第 501 次应阻止
      const overflow = guard.checkBeforeExecution('overflow', {});
      expect(overflow.blocked).toBe(true);
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

    it('重置清掉连续错误流（fix #1）', () => {
      const guard = new ToolSafetyGuard({ consecutiveErrorsThreshold: 3 });
      guard.recordError('write');
      guard.recordError('write');
      expect(guard.getErrorStreak('write')).toBe(2);
      guard.reset();
      expect(guard.getErrorStreak('write')).toBe(0);
    });
  });

  describe('连续错误熔断（fix #1：DeepSeek 反复丢字段场景）', () => {
    it('同 tool 连续报错达阈值即熔断', () => {
      const guard = new ToolSafetyGuard({ consecutiveErrorsThreshold: 3 });
      // 模拟架构师 / UI/UX 实测情况：write 反复缺 file_path
      expect(guard.recordError('write').blocked).toBe(false); // 1
      expect(guard.recordError('write').blocked).toBe(false); // 2
      const r = guard.recordError('write'); // 3 → 触发
      expect(r.blocked).toBe(true);
      expect(r.reason).toContain('write');
      expect(r.reason).toContain('已连续报错 3 次');
      expect(r.reason).toContain("update_task_status('blocked'");
    });

    it('错误流仅按 tool 名计数，互不影响', () => {
      const guard = new ToolSafetyGuard({ consecutiveErrorsThreshold: 3 });
      guard.recordError('write');
      guard.recordError('write');
      guard.recordError('read'); // 不同 tool 不累加 write 流
      expect(guard.getErrorStreak('write')).toBe(2);
      expect(guard.getErrorStreak('read')).toBe(1);
      expect(guard.recordError('write').blocked).toBe(true); // 第 3 次 write 报错触发熔断
    });

    it('成功一次清零该 tool 的错误流（不影响其他 tool）', () => {
      const guard = new ToolSafetyGuard({ consecutiveErrorsThreshold: 3 });
      guard.recordError('write');
      guard.recordError('write');
      guard.recordError('read');

      // write 调用一次后 recordResult 应清零 write 流
      guard.checkBeforeExecution('write', { file_path: '/x', content: 'ok' });
      guard.recordResult('已写入');
      expect(guard.getErrorStreak('write')).toBe(0);
      // read 流不受影响
      expect(guard.getErrorStreak('read')).toBe(1);
    });

    it('架构师场景：write 错 → write 错 → write 错 → read 成功 → write 错 第 4 次仍熔断', () => {
      // 架构师实测序列: write-err × 3 (跨 read 间隔), read-success, write-err
      // 期望：read 成功不该清掉 write 的错误流
      const guard = new ToolSafetyGuard({ consecutiveErrorsThreshold: 4 });
      guard.recordError('write');
      guard.recordError('write');
      guard.recordError('write');
      // read 成功夹在中间
      guard.checkBeforeExecution('read', { file_path: '/y' });
      guard.recordResult('文件内容');
      expect(guard.getErrorStreak('write')).toBe(3); // read 不清 write
      // 第 4 次 write 错 → 触发熔断
      expect(guard.recordError('write').blocked).toBe(true);
    });

    it('默认阈值是 3', () => {
      const guard = new ToolSafetyGuard();
      guard.recordError('x');
      guard.recordError('x');
      expect(guard.recordError('x').blocked).toBe(true);
    });
  });
});
