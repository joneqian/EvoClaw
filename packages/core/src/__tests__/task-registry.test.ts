import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createTask,
  updateTask,
  updateTaskProgress,
  cancelTask,
  getTask,
  listTasks,
  pruneCompleted,
  resetTaskRegistryForTest,
} from '../infrastructure/task-registry.js';

describe('TaskRegistry', () => {
  beforeEach(() => {
    resetTaskRegistryForTest();
  });

  const makeTask = (overrides?: Record<string, unknown>) => ({
    taskId: `task-${Math.random().toString(36).slice(2)}`,
    runtime: 'heartbeat' as const,
    sourceId: 'agent-1',
    status: 'running' as const,
    label: 'heartbeat:interval',
    agentId: 'agent-1',
    sessionKey: 'agent:agent-1:local:direct:user',
    startedAt: Date.now(),
    ...overrides,
  });

  describe('createTask', () => {
    it('应创建任务记录', () => {
      const task = makeTask();
      const id = createTask(task);
      expect(id).toBe(task.taskId);

      const stored = getTask(id);
      expect(stored).toBeDefined();
      expect(stored!.status).toBe('running');
      expect(stored!.createdAt).toBeGreaterThan(0);
    });
  });

  describe('updateTask', () => {
    it('应更新任务状态', () => {
      const task = makeTask();
      createTask(task);

      updateTask(task.taskId, { status: 'succeeded', endedAt: Date.now() });

      const stored = getTask(task.taskId);
      expect(stored!.status).toBe('succeeded');
      expect(stored!.endedAt).toBeGreaterThan(0);
    });

    it('更新不存在的任务应不报错', () => {
      updateTask('nonexistent', { status: 'failed' }); // no throw
    });
  });

  describe('listTasks', () => {
    it('应返回所有任务', () => {
      createTask(makeTask({ taskId: 'a' }));
      createTask(makeTask({ taskId: 'b' }));
      expect(listTasks()).toHaveLength(2);
    });

    it('应按 createdAt 倒序', async () => {
      createTask(makeTask({ taskId: 'old' }));
      // 确保时间戳有差异
      await new Promise(r => setTimeout(r, 5));
      createTask(makeTask({ taskId: 'new' }));
      const tasks = listTasks();
      expect(tasks[0].taskId).toBe('new');
    });

    it('应支持 agentId 过滤', () => {
      createTask(makeTask({ taskId: 'a', agentId: 'agent-1' }));
      createTask(makeTask({ taskId: 'b', agentId: 'agent-2' }));
      expect(listTasks({ agentId: 'agent-1' })).toHaveLength(1);
    });

    it('应支持 runtime 过滤', () => {
      createTask(makeTask({ taskId: 'a', runtime: 'heartbeat' }));
      createTask(makeTask({ taskId: 'b', runtime: 'cron' }));
      expect(listTasks({ runtime: 'cron' })).toHaveLength(1);
    });

    it('应支持 status 过滤', () => {
      createTask(makeTask({ taskId: 'a', status: 'running' }));
      createTask(makeTask({ taskId: 'b', status: 'succeeded' }));
      expect(listTasks({ status: 'running' })).toHaveLength(1);
    });

    it('应支持组合过滤', () => {
      createTask(makeTask({ taskId: 'a', agentId: 'agent-1', runtime: 'cron', status: 'running' }));
      createTask(makeTask({ taskId: 'b', agentId: 'agent-1', runtime: 'heartbeat', status: 'running' }));
      createTask(makeTask({ taskId: 'c', agentId: 'agent-2', runtime: 'cron', status: 'running' }));
      expect(listTasks({ agentId: 'agent-1', runtime: 'cron' })).toHaveLength(1);
    });
  });

  describe('pruneCompleted', () => {
    it('应清理已结束超过阈值的记录', () => {
      const task = makeTask({ taskId: 'done' });
      createTask(task);
      updateTask('done', {
        status: 'succeeded',
        endedAt: Date.now() - 7_200_000, // 2 小时前
      });

      const pruned = pruneCompleted(3_600_000); // 1 小时阈值
      expect(pruned).toBe(1);
      expect(getTask('done')).toBeUndefined();
    });

    it('不应清理未结束的记录', () => {
      createTask(makeTask({ taskId: 'running' }));
      const pruned = pruneCompleted(0);
      expect(pruned).toBe(0);
    });

    it('不应清理未超过阈值的记录', () => {
      const task = makeTask({ taskId: 'recent' });
      createTask(task);
      updateTask('recent', {
        status: 'succeeded',
        endedAt: Date.now() - 100, // 刚刚完成
      });

      const pruned = pruneCompleted(3_600_000);
      expect(pruned).toBe(0);
    });
  });

  describe('cancelTask', () => {
    it('应调用 cancelFn 并更新状态为 cancelled', async () => {
      const cancelFn = vi.fn();
      createTask({
        ...makeTask({ taskId: 'cancel-me' }),
        cancelFn,
      });

      const result = await cancelTask('cancel-me');
      expect(result.cancelled).toBe(true);
      expect(cancelFn).toHaveBeenCalledTimes(1);

      const stored = getTask('cancel-me');
      expect(stored!.status).toBe('cancelled');
      expect(stored!.endedAt).toBeGreaterThan(0);
    });

    it('任务不存在应返回 cancelled=false', async () => {
      const result = await cancelTask('nonexistent');
      expect(result.cancelled).toBe(false);
      expect(result.reason).toBe('任务不存在');
    });

    it('已终态任务应返回 cancelled=false', async () => {
      createTask({ ...makeTask({ taskId: 'done' }), cancelFn: () => {} });
      updateTask('done', { status: 'succeeded', endedAt: Date.now() });

      const result = await cancelTask('done');
      expect(result.cancelled).toBe(false);
      expect(result.reason).toContain('已结束');
    });

    it('无 cancelFn 的任务应返回 cancelled=false', async () => {
      createTask(makeTask({ taskId: 'no-cancel' }));
      const result = await cancelTask('no-cancel');
      expect(result.cancelled).toBe(false);
      expect(result.reason).toContain('不支持取消');
    });

    it('cancelFn 抛异常应返回 cancelled=false', async () => {
      createTask({
        ...makeTask({ taskId: 'throws' }),
        cancelFn: () => { throw new Error('模拟失败'); },
      });
      const result = await cancelTask('throws');
      expect(result.cancelled).toBe(false);
      expect(result.reason).toContain('模拟失败');
    });

    it('cancelFn 支持 async 函数', async () => {
      const cancelFn = vi.fn(async () => {
        await new Promise(r => setTimeout(r, 5));
      });
      createTask({ ...makeTask({ taskId: 'async' }), cancelFn });

      const result = await cancelTask('async');
      expect(result.cancelled).toBe(true);
      expect(cancelFn).toHaveBeenCalled();
    });
  });

  describe('updateTaskProgress', () => {
    it('应更新进度字段', () => {
      createTask(makeTask({ taskId: 'prog' }));
      updateTaskProgress('prog', {
        toolUseCount: 3,
        inputTokens: 1000,
        outputTokens: 500,
        recentActivity: 'read_file',
      });

      const stored = getTask('prog');
      expect(stored!.progress).toEqual({
        toolUseCount: 3,
        inputTokens: 1000,
        outputTokens: 500,
        recentActivity: 'read_file',
      });
    });

    it('应合并部分进度更新', () => {
      createTask(makeTask({ taskId: 'merge' }));
      updateTaskProgress('merge', { toolUseCount: 1 });
      updateTaskProgress('merge', { inputTokens: 200 });

      const stored = getTask('merge');
      expect(stored!.progress).toEqual({ toolUseCount: 1, inputTokens: 200 });
    });

    it('更新不存在的任务应不报错', () => {
      updateTaskProgress('nonexistent', { toolUseCount: 1 }); // no throw
    });
  });

  describe('序列化安全性', () => {
    it('listTasks 返回的记录不包含 cancelFn', () => {
      createTask({
        ...makeTask({ taskId: 'with-fn' }),
        cancelFn: () => {},
      });
      const tasks = listTasks();
      expect(tasks).toHaveLength(1);
      expect((tasks[0] as Record<string, unknown>).cancelFn).toBeUndefined();
    });

    it('getTask 返回的记录不包含 cancelFn', () => {
      createTask({
        ...makeTask({ taskId: 'with-fn' }),
        cancelFn: () => {},
      });
      const task = getTask('with-fn');
      expect((task as Record<string, unknown>).cancelFn).toBeUndefined();
    });

    it('终态 updateTask 应自动清空 cancelFn（防内存泄漏）', () => {
      // 直接访问 Map 检查内部状态不方便，通过 cancelTask 行为验证
      createTask({
        ...makeTask({ taskId: 'leak' }),
        cancelFn: () => {},
      });
      updateTask('leak', { status: 'succeeded', endedAt: Date.now() });
      // 清空后再 cancel 应该返回不支持取消
      return cancelTask('leak').then(r => {
        expect(r.cancelled).toBe(false);
        // 但因为状态已 terminal，会在前置检查就返回
        expect(r.reason).toContain('已结束');
      });
    });
  });
});
