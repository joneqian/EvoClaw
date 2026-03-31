import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTask,
  updateTask,
  getTask,
  listTasks,
  pruneCompleted,
  resetTaskRegistryForTest,
} from '../scheduler/task-registry.js';

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
});
