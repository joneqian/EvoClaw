/**
 * UserCommandHandler / parseUserCommand 单元测试
 *
 * 覆盖：
 *   - 命令识别（大小写不敏感、前导空白、参数解析）
 *   - /pause /cancel 调用 service 的 pausePlan / cancelPlan
 *   - /revise 通知 plan 创建者并暂停旧 plan
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseUserCommand, UserCommandHandler } from '../../agent/team-mode/user-commands.js';
import type { TaskPlanService } from '../../agent/team-mode/task-plan/service.js';
import type { TaskPlanSnapshot } from '../../channel/team-mode/team-channel.js';
import { resetSystemEventsForTest, peekSystemEvents } from '../../infrastructure/system-events.js';

describe('parseUserCommand', () => {
  it('/pause 命中', () => {
    expect(parseUserCommand('/pause')).toEqual({ kind: 'pause' });
    expect(parseUserCommand('  /pause  ')).toEqual({ kind: 'pause' });
    expect(parseUserCommand('/PAUSE')).toEqual({ kind: 'pause' });
    expect(parseUserCommand('/pause 多余文字')).toEqual({ kind: 'pause' });
  });

  it('/cancel 命中', () => {
    expect(parseUserCommand('/cancel')).toEqual({ kind: 'cancel' });
    expect(parseUserCommand('/Cancel')).toEqual({ kind: 'cancel' });
  });

  it('/revise 必须有非空参数', () => {
    expect(parseUserCommand('/revise')).toBeNull();
    expect(parseUserCommand('/revise   ')).toBeNull();
    expect(parseUserCommand('/revise 改成只做登录页')).toEqual({
      kind: 'revise',
      newGoal: '改成只做登录页',
    });
    expect(parseUserCommand('/REVISE 加个注册页')).toEqual({
      kind: 'revise',
      newGoal: '加个注册页',
    });
  });

  it('非命令文本返回 null', () => {
    expect(parseUserCommand('帮我做个落地页')).toBeNull();
    expect(parseUserCommand('/pizzeria')).toBeNull(); // 不是 /pause
    expect(parseUserCommand('')).toBeNull();
    expect(parseUserCommand('/')).toBeNull();
  });
});

function makeMockService(): {
  service: TaskPlanService;
  pauseSpy: ReturnType<typeof vi.fn>;
  cancelSpy: ReturnType<typeof vi.fn>;
  listSpy: ReturnType<typeof vi.fn>;
} {
  const pauseSpy = vi.fn(() => 1);
  const cancelSpy = vi.fn(() => 1);
  const listSpy = vi.fn();
  const service = {
    pausePlan: pauseSpy,
    cancelPlan: cancelSpy,
    listGroupPlans: listSpy,
  } as unknown as TaskPlanService;
  return { service, pauseSpy, cancelSpy, listSpy };
}

describe('UserCommandHandler', () => {
  beforeEach(() => {
    resetSystemEventsForTest();
  });

  it('/pause 调 pausePlan 每个 active plan', async () => {
    const { service, pauseSpy, listSpy } = makeMockService();
    listSpy.mockReturnValue([
      makeSnapshot('p1'),
      makeSnapshot('p2'),
    ]);
    const handler = new UserCommandHandler({ taskPlanService: service });
    const result = await handler.handle('/pause', 'feishu:chat:oc_x', 'user-1');
    expect(result?.shortCircuit).toBe(true);
    expect(result?.affectedPlans).toBe(2);
    expect(pauseSpy).toHaveBeenCalledTimes(2);
    expect(pauseSpy).toHaveBeenCalledWith('p1');
    expect(pauseSpy).toHaveBeenCalledWith('p2');
  });

  it('/pause 群里没 active plan → 友好提示', async () => {
    const { service, listSpy } = makeMockService();
    listSpy.mockReturnValue([]);
    const handler = new UserCommandHandler({ taskPlanService: service });
    const result = await handler.handle('/pause', 'feishu:chat:oc_x', 'user-1');
    expect(result?.shortCircuit).toBe(true);
    expect(result?.affectedPlans).toBe(0);
    expect(result?.replyText).toContain('没有活跃');
  });

  it('/cancel 调 cancelPlan', async () => {
    const { service, cancelSpy, listSpy } = makeMockService();
    listSpy.mockReturnValue([makeSnapshot('p1')]);
    const handler = new UserCommandHandler({ taskPlanService: service });
    await handler.handle('/cancel', 'feishu:chat:oc_x', 'user-1');
    expect(cancelSpy).toHaveBeenCalledWith('p1');
  });

  it('/revise 暂停旧 plan + 投递 system event 给 creator', async () => {
    const { service, pauseSpy, listSpy } = makeMockService();
    listSpy.mockReturnValue([makeSnapshot('p1', 'creator-a')]);
    const handler = new UserCommandHandler({ taskPlanService: service });
    const result = await handler.handle(
      '/revise 改成只做登录页',
      'feishu:chat:oc_x',
      'user-1',
    );
    expect(result?.shortCircuit).toBe(true);
    expect(pauseSpy).toHaveBeenCalledWith('p1');
    // system event 应投递到 creator-a 的 sessionKey
    const events = peekSystemEvents('agent:creator-a:feishu:group:oc_x');
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toContain('plan_revision_requested');
    expect(events[0]).toContain('改成只做登录页');
  });

  it('/revise 群里没 active plan → 提示用户重新发起', async () => {
    const { service, listSpy } = makeMockService();
    listSpy.mockReturnValue([]);
    const handler = new UserCommandHandler({ taskPlanService: service });
    const result = await handler.handle(
      '/revise 加个注册页',
      'feishu:chat:oc_x',
      'user-1',
    );
    expect(result?.shortCircuit).toBe(true);
    expect(result?.replyText).toContain('没有活跃计划');
  });

  it('非命令文本 → 返回 null（不短路）', async () => {
    const { service } = makeMockService();
    const handler = new UserCommandHandler({ taskPlanService: service });
    const result = await handler.handle('帮我做个落地页', 'feishu:chat:oc_x', 'user-1');
    expect(result).toBeNull();
  });
});

function makeSnapshot(id: string, createdByAgentId = 'creator-a'): TaskPlanSnapshot {
  return {
    id,
    groupSessionKey: 'feishu:chat:oc_x',
    channelType: 'feishu',
    goal: 'mock goal',
    status: 'active',
    tasks: [],
    createdBy: { agentId: createdByAgentId, name: 'Creator', emoji: '✨' },
    createdAt: 0,
    updatedAt: 0,
  };
}
