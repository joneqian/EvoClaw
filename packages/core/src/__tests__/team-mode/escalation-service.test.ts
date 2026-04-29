/**
 * EscalationService 单元测试
 *
 * 重点验证 fix #2：
 *   - pending 任务的 dependsOn 上游未完成时跳过（不再算 idle）
 *   - dependsOn 全部 done 后 pending 任务恢复参与扫描
 *   - in_progress 任务（自己有动静义务）不被该规则放过
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../../infrastructure/db/migration-runner.js';
import { AgentManager } from '../../agent/agent-manager.js';
import { TaskPlanService } from '../../agent/team-mode/task-plan/service.js';
import { EscalationService } from '../../agent/team-mode/escalation-service.js';
import { resetSystemEventsForTest, peekSystemEvents } from '../../infrastructure/system-events.js';
import type { ChannelManager } from '../../channel/channel-manager.js';
import type { BindingRouter } from '../../routing/binding-router.js';

function fakeChannelManager(): ChannelManager {
  return {
    sendMessage: async () => undefined,
  } as unknown as ChannelManager;
}

function fakeBindingRouter(): BindingRouter {
  return {
    listBindings: () => [],
  } as unknown as BindingRouter;
}

describe('EscalationService — pending 任务 dependsOn 跳过（fix #2）', () => {
  let store: SqliteStore;
  let agentManager: AgentManager;
  let taskPlanService: TaskPlanService;
  let escalation: EscalationService;
  let tmpDir: string;
  let pmId: string;
  let assigneeAId: string;
  let assigneeBId: string;
  const groupKey = 'feishu:chat:oc_escalation_test';

  beforeEach(async () => {
    resetSystemEventsForTest();
    store = new SqliteStore(':memory:');
    await new MigrationRunner(store).run();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'escalation-test-'));
    agentManager = new AgentManager(store, tmpDir);

    const pm = await agentManager.createAgent({ name: 'PM' });
    const a = await agentManager.createAgent({ name: '上游 A' });
    const b = await agentManager.createAgent({ name: '下游 B' });
    pmId = pm.id;
    assigneeAId = a.id;
    assigneeBId = b.id;
    for (const id of [pmId, assigneeAId, assigneeBId]) {
      store.run(`UPDATE agents SET status = 'active' WHERE id = ?`, id);
    }

    taskPlanService = new TaskPlanService({ store, agentManager, boardRefreshDebounceMs: 0 });

    escalation = new EscalationService({
      store,
      taskPlanService,
      agentManager,
      channelManager: fakeChannelManager(),
      bindingRouter: fakeBindingRouter(),
      tickIntervalMs: 999_999, // 永不自动 tick，测试手动调
    });
  });

  afterEach(() => {
    escalation.stop();
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** 把指定 task 的 updated_at / created_at 强制改成 N 分钟前，模拟 idle */
  function backdateTask(taskId: string, minutesAgo: number): void {
    const ts = new Date(Date.now() - minutesAgo * 60_000).toISOString();
    store.run(`UPDATE tasks SET updated_at = ?, created_at = ? WHERE id = ?`, ts, ts, taskId);
  }

  function getRealTaskId(planId: string, localId: string): string {
    return store.get<{ id: string }>(
      'SELECT id FROM tasks WHERE plan_id = ? AND local_id = ?',
      planId,
      localId,
    )!.id;
  }

  it('pending + dependsOn 上游未完成 → 不算 idle，escalation 跳过', async () => {
    const snap = await taskPlanService.createPlan(
      {
        goal: 'goal',
        tasks: [
          { localId: 't1', title: '上游', assigneeAgentId: assigneeAId },
          { localId: 't2', title: '下游', assigneeAgentId: assigneeBId, dependsOn: ['t1'] },
        ],
      },
      { groupSessionKey: groupKey, createdByAgentId: pmId },
    );

    const t1Id = getRealTaskId(snap.id, 't1');
    const t2Id = getRealTaskId(snap.id, 't2');

    // 把 t1 / t2 都拨到 35 分钟前（红色阈值 30 min 之外）
    backdateTask(t1Id, 35);
    backdateTask(t2Id, 35);

    // 清空创建时发的 task_ready 事件，避免干扰 escalation 事件统计
    resetSystemEventsForTest();

    await escalation.tick();

    // t1 (pending, 无 dependsOn) → 算 idle，应该触发升级（创建 stale 事件 → 进 PM session）
    const pmEvents = peekSystemEvents(`agent:${pmId}:feishu:group:oc_escalation_test`);
    const pmStaleHits = pmEvents.filter((e) => e.includes('task_stale'));
    expect(pmStaleHits.length).toBeGreaterThan(0);
    // 而且这条提醒讲的是 t1（"上游"）— 用 task title 反查
    expect(pmStaleHits.some((e) => e.includes('上游'))).toBe(true);

    // t2 (pending, dependsOn=['t1'] 未完成) → 完全不该出现在 stale 提醒里
    expect(pmStaleHits.some((e) => e.includes('下游'))).toBe(false);
  });

  it('上游 done 后，下游 pending 就重新参与扫描（不再被跳过）', async () => {
    const snap = await taskPlanService.createPlan(
      {
        goal: 'goal',
        tasks: [
          { localId: 't1', title: '上游', assigneeAgentId: assigneeAId },
          { localId: 't2', title: '下游', assigneeAgentId: assigneeBId, dependsOn: ['t1'] },
        ],
      },
      { groupSessionKey: groupKey, createdByAgentId: pmId },
    );

    const t1Id = getRealTaskId(snap.id, 't1');
    const t2Id = getRealTaskId(snap.id, 't2');

    // 上游标 done（带合规 outputSummary）
    const r = taskPlanService.updateTaskStatus(
      {
        taskId: t1Id,
        status: 'done',
        outputSummary: '上游交付完毕，主要内容已落盘并附上 artifact 链接，请下游使用。',
      },
      assigneeAId,
    );
    expect(r.ok).toBe(true);

    // 把 t2 拨到 35 分钟前（pending 但 dependsOn 已满足）
    backdateTask(t2Id, 35);

    resetSystemEventsForTest();
    await escalation.tick();

    // t2 现在应该被算作 idle（PM 应收到 stale 提醒）
    const pmEvents = peekSystemEvents(`agent:${pmId}:feishu:group:oc_escalation_test`);
    expect(pmEvents.some((e) => e.includes('task_stale') && e.includes('下游'))).toBe(true);
  });

  it('in_progress 任务即使有 dependsOn 也不被该规则跳过（自己有动静义务）', async () => {
    const snap = await taskPlanService.createPlan(
      {
        goal: 'goal',
        tasks: [
          { localId: 't1', title: '上游', assigneeAgentId: assigneeAId },
          { localId: 't2', title: '下游', assigneeAgentId: assigneeBId, dependsOn: ['t1'] },
        ],
      },
      { groupSessionKey: groupKey, createdByAgentId: pmId },
    );

    const t1Id = getRealTaskId(snap.id, 't1');
    const t2Id = getRealTaskId(snap.id, 't2');

    // 把 t2 强行改成 in_progress（绕过依赖检查只为模拟）
    store.run(`UPDATE tasks SET status = 'in_progress' WHERE id = ?`, t2Id);

    backdateTask(t1Id, 35);
    backdateTask(t2Id, 35);

    resetSystemEventsForTest();
    await escalation.tick();

    // t2 in_progress → 即使上游 t1 还 pending，依然该被升级
    const pmEvents = peekSystemEvents(`agent:${pmId}:feishu:group:oc_escalation_test`);
    expect(pmEvents.some((e) => e.includes('task_stale') && e.includes('下游'))).toBe(true);
  });
});
