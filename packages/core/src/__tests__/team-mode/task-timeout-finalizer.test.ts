/**
 * task-timeout-finalizer 单元测试（M13 重构）
 *
 * 覆盖：
 *   - sessionKey 解析正确 → 更新 in_progress task 为 blocked
 *   - 非群聊 sessionKey → 跳过返回空数组
 *   - sessionKey 不完整 → 跳过返回空数组
 *   - 无 in_progress 任务（仅 pending / blocked）→ 跳过
 *   - 多个 in_progress 任务全部更新
 *   - listOpenTasksForAssignee 抛错 → 吞错返回空数组
 *   - updateTaskStatus 单个失败 → 其他继续
 *   - reason note 含 idle/wallclock 区分
 */

import { describe, it, expect, vi } from 'vitest';
import { createTaskTimeoutFinalizer } from '../../agent/team-mode/task-timeout-finalizer.js';
import type { TaskPlanService } from '../../agent/team-mode/task-plan/service.js';
import type { TaskNodeSnapshot } from '../../channel/team-mode/team-channel.js';

function makeTask(overrides: Partial<TaskNodeSnapshot> = {}): TaskNodeSnapshot {
  return {
    id: 'task-uuid-1',
    localId: 't1',
    title: 'PRD 撰写',
    assignee: { agentId: 'a-prod', name: '产品经理', emoji: '📈' },
    status: 'in_progress',
    dependsOn: [],
    artifacts: [],
    ...overrides,
  };
}

function makeMockService(opts: {
  openTasks?: TaskNodeSnapshot[];
  updateResult?: { ok: true; taskId: string } | { ok: false; reason: string };
  listThrows?: Error;
  updateThrows?: Error;
} = {}): TaskPlanService {
  const list = vi.fn(() => {
    if (opts.listThrows) throw opts.listThrows;
    return opts.openTasks ?? [];
  });
  const update = vi.fn(() => {
    if (opts.updateThrows) throw opts.updateThrows;
    return opts.updateResult ?? { ok: true, taskId: 'task-uuid-1' };
  });
  return {
    listOpenTasksForAssignee: list,
    updateTaskStatus: update,
  } as unknown as TaskPlanService;
}

describe('createTaskTimeoutFinalizer', () => {
  it('group sessionKey + 1 个 in_progress 任务 → 标 blocked，返回 [{ taskId, localId }]', () => {
    const svc = makeMockService({ openTasks: [makeTask()] });
    const finalize = createTaskTimeoutFinalizer({ taskPlanService: svc });

    const result = finalize('agent:a-prod:feishu:group:oc_x', 'idle');
    expect(result).toEqual([{ taskId: 'task-uuid-1', localId: 't1' }]);

    expect(svc.listOpenTasksForAssignee).toHaveBeenCalledWith('a-prod', 'feishu:chat:oc_x');
    expect(svc.updateTaskStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-uuid-1',
        status: 'blocked',
        note: expect.stringContaining('idle'),
      }),
      'a-prod',
    );
  });

  it('wallclock 超时 → note 含 wallclock 字样', () => {
    const svc = makeMockService({ openTasks: [makeTask()] });
    const finalize = createTaskTimeoutFinalizer({ taskPlanService: svc });

    finalize('agent:a-prod:feishu:group:oc_x', 'wallclock');
    expect(svc.updateTaskStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        note: expect.stringContaining('wallclock'),
      }),
      'a-prod',
    );
  });

  it('非群聊 sessionKey → 直接跳过，不查 DB', () => {
    const svc = makeMockService();
    const finalize = createTaskTimeoutFinalizer({ taskPlanService: svc });

    const result = finalize('agent:a-prod:feishu:direct:user_x', 'idle');
    expect(result).toEqual([]);
    expect(svc.listOpenTasksForAssignee).not.toHaveBeenCalled();
  });

  it('sessionKey 不完整（缺 peerId）→ 跳过', () => {
    const svc = makeMockService();
    const finalize = createTaskTimeoutFinalizer({ taskPlanService: svc });

    const result = finalize('agent:a-prod:feishu:group:', 'idle');
    expect(result).toEqual([]);
    expect(svc.listOpenTasksForAssignee).not.toHaveBeenCalled();
  });

  it('无 in_progress 任务（只有 pending / blocked）→ 返回空，不更新', () => {
    const svc = makeMockService({
      openTasks: [
        makeTask({ id: 'p1', localId: 'tp', status: 'pending' }),
        makeTask({ id: 'b1', localId: 'tb', status: 'blocked' }),
      ],
    });
    const finalize = createTaskTimeoutFinalizer({ taskPlanService: svc });

    const result = finalize('agent:a-prod:feishu:group:oc_x', 'idle');
    expect(result).toEqual([]);
    expect(svc.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('多个 in_progress 任务 → 全部标 blocked', () => {
    const svc = makeMockService({
      openTasks: [
        makeTask({ id: 'a', localId: 't1', status: 'in_progress' }),
        makeTask({ id: 'b', localId: 't2', status: 'in_progress' }),
        makeTask({ id: 'c', localId: 't3', status: 'pending' }),
      ],
    });
    // 让每次 updateTaskStatus 都返回 ok（默认行为）
    const finalize = createTaskTimeoutFinalizer({ taskPlanService: svc });

    const result = finalize('agent:a-prod:feishu:group:oc_x', 'idle');
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.localId).sort()).toEqual(['t1', 't2']);
    expect(svc.updateTaskStatus).toHaveBeenCalledTimes(2);
  });

  it('listOpenTasksForAssignee 抛错 → 吞错返回空数组', () => {
    const svc = makeMockService({ listThrows: new Error('DB connection lost') });
    const finalize = createTaskTimeoutFinalizer({ taskPlanService: svc });

    const result = finalize('agent:a-prod:feishu:group:oc_x', 'idle');
    expect(result).toEqual([]);
    expect(svc.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('updateTaskStatus 抛错 → 该任务跳过，其他任务继续', () => {
    let callCount = 0;
    const svc = {
      listOpenTasksForAssignee: vi.fn(() => [
        makeTask({ id: 'a', localId: 't1' }),
        makeTask({ id: 'b', localId: 't2' }),
      ]),
      updateTaskStatus: vi.fn(() => {
        callCount++;
        if (callCount === 1) throw new Error('FK 约束失败');
        return { ok: true, taskId: 'b' };
      }),
    } as unknown as TaskPlanService;

    const finalize = createTaskTimeoutFinalizer({ taskPlanService: svc });
    const result = finalize('agent:a-prod:feishu:group:oc_x', 'idle');
    expect(result).toHaveLength(1);
    expect(result[0]?.localId).toBe('t2');
  });

  it('updateTaskStatus 返回 { ok: false } → 该任务跳过', () => {
    const svc = makeMockService({
      openTasks: [makeTask()],
      updateResult: { ok: false, reason: '只有 assignee 能更新' },
    });
    const finalize = createTaskTimeoutFinalizer({ taskPlanService: svc });

    const result = finalize('agent:a-prod:feishu:group:oc_x', 'idle');
    expect(result).toEqual([]);
  });
});
