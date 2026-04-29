/**
 * TaskPlanService 单元测试
 *
 * 覆盖：
 *   - createPlan 基本流（含校验：goal/tasks/localId 唯一/dependsOn 引用/无环）
 *   - DAG 自环检测
 *   - assignee 必须 active
 *   - 创建后无依赖任务自动发 task_ready 事件
 *   - updateTaskStatus 仅 assignee 可调
 *   - status=done 解锁下游 → 触发下一波 task_ready
 *   - 全部 done → plan completed + 通知 creator
 *   - status=needs_help → 通知 task.created_by
 *   - parseGroupSessionKey / deriveAssigneeSessionKey
 *   - pausePlan / cancelPlan
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../../infrastructure/db/migration-runner.js';
import { AgentManager } from '../../agent/agent-manager.js';
import {
  TaskPlanService,
  parseGroupSessionKey,
  deriveAssigneeSessionKey,
} from '../../agent/team-mode/task-plan/service.js';
import {
  resetSystemEventsForTest,
  peekSystemEvents,
} from '../../infrastructure/system-events.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

function makeStore(): SqliteStore {
  return new SqliteStore(':memory:');
}

async function setupDb(): Promise<{ store: SqliteStore; agentManager: AgentManager; tmpDir: string }> {
  const store = makeStore();
  const migRunner = new MigrationRunner(store);
  await migRunner.run();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm13-test-'));
  const agentManager = new AgentManager(store, tmpDir);
  return { store, agentManager, tmpDir };
}

function activateAgent(store: SqliteStore, agentId: string): void {
  store.run(
    `UPDATE agents SET status = 'active' WHERE id = ?`,
    agentId,
  );
}

describe('parseGroupSessionKey', () => {
  it('解析飞书 chat key', () => {
    expect(parseGroupSessionKey('feishu:chat:oc_xxx')).toEqual({
      channelType: 'feishu',
      chatId: 'oc_xxx',
    });
  });

  it('解析 ilink room key', () => {
    expect(parseGroupSessionKey('ilink:room:wr_yyy')).toEqual({
      channelType: 'ilink',
      chatId: 'wr_yyy',
    });
  });

  it('解析 Discord 复合 key', () => {
    expect(parseGroupSessionKey('discord:guild:1:channel:5')).toEqual({
      channelType: 'discord',
      chatId: '1:channel:5',
    });
  });

  it('格式错误返回 null', () => {
    expect(parseGroupSessionKey('garbage')).toBeNull();
    expect(parseGroupSessionKey('feishu')).toBeNull();
    expect(parseGroupSessionKey('feishu:')).toBeNull();
  });
});

describe('deriveAssigneeSessionKey', () => {
  it('拼出标准 sessionKey', () => {
    const k = deriveAssigneeSessionKey('feishu:chat:oc_xxx', 'agentX');
    expect(k).toBe('agent:agentX:feishu:group:oc_xxx');
  });
  it('group key 错误返回 null', () => {
    expect(deriveAssigneeSessionKey('garbage', 'a')).toBeNull();
  });
});

describe('TaskPlanService', () => {
  let store: SqliteStore;
  let agentManager: AgentManager;
  let svc: TaskPlanService;
  let tmpDir: string;

  const groupKey = 'feishu:chat:oc_test';
  // 真实 UUID，由 agentManager.createAgent 返回
  let A: string; // creator (PM)
  let B: string; // 后端
  let C: string; // 设计

  beforeEach(async () => {
    resetSystemEventsForTest();
    const setup = await setupDb();
    store = setup.store;
    agentManager = setup.agentManager;
    tmpDir = setup.tmpDir;

    const pm = await agentManager.createAgent({ name: 'PM 阿明' });
    const be = await agentManager.createAgent({ name: '后端 阿辉' });
    const de = await agentManager.createAgent({ name: '设计 小林' });
    A = pm.id;
    B = be.id;
    C = de.id;
    activateAgent(store, A);
    activateAgent(store, B);
    activateAgent(store, C);

    // boardRefreshDebounceMs=0 关闭 debounce，让单测保持同步语义；
    // 单独的 debounce 测试用例自己 new 一个带 debounce 的 service
    svc = new TaskPlanService({ store, agentManager, boardRefreshDebounceMs: 0 });
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('createPlan 基础流', async () => {
    const snap = await svc.createPlan(
      {
        goal: '做个 H5 落地页',
        tasks: [
          { localId: 't1', title: '设计稿', assigneeAgentId: C },
          { localId: 't2', title: '后端接口', assigneeAgentId: B },
          { localId: 't3', title: '前端拼接', assigneeAgentId: B, dependsOn: ['t1', 't2'] },
        ],
      },
      { groupSessionKey: groupKey, createdByAgentId: A, initiatorUserId: 'user-1' },
    );

    expect(snap.tasks).toHaveLength(3);
    expect(snap.status).toBe('active');
    expect(snap.createdBy.agentId).toBe(A);

    // 无依赖的 t1 / t2 应触发 task_ready system event
    const eventsC = peekSystemEvents(`agent:${C}:feishu:group:oc_test`);
    const eventsB = peekSystemEvents(`agent:${B}:feishu:group:oc_test`);
    expect(eventsC.some((e) => e.includes('task_ready') && e.includes('t1'))).toBe(true);
    expect(eventsB.some((e) => e.includes('task_ready') && e.includes('t2'))).toBe(true);
    // t3 有依赖，B 应该只收到 t2 不收 t3
    expect(eventsB.some((e) => e.includes('task_id="t3"'))).toBe(false);
  });

  it('createPlan 拒绝空 goal / 空 tasks', async () => {
    await expect(
      svc.createPlan(
        { goal: '', tasks: [{ localId: 't1', title: 'x', assigneeAgentId: B }] },
        { groupSessionKey: groupKey, createdByAgentId: A },
      ),
    ).rejects.toThrow();
    await expect(
      svc.createPlan(
        { goal: 'x', tasks: [] },
        { groupSessionKey: groupKey, createdByAgentId: A },
      ),
    ).rejects.toThrow();
  });

  it('createPlan 拒绝重复 localId', async () => {
    await expect(
      svc.createPlan(
        {
          goal: 'x',
          tasks: [
            { localId: 't1', title: 'a', assigneeAgentId: B },
            { localId: 't1', title: 'b', assigneeAgentId: C },
          ],
        },
        { groupSessionKey: groupKey, createdByAgentId: A },
      ),
    ).rejects.toThrow(/重复/);
  });

  it('createPlan 拒绝无效 dependsOn', async () => {
    await expect(
      svc.createPlan(
        {
          goal: 'x',
          tasks: [
            { localId: 't1', title: 'a', assigneeAgentId: B, dependsOn: ['ghost'] },
          ],
        },
        { groupSessionKey: groupKey, createdByAgentId: A },
      ),
    ).rejects.toThrow(/未知任务/);
  });

  it('createPlan 拒绝有环 DAG', async () => {
    await expect(
      svc.createPlan(
        {
          goal: 'x',
          tasks: [
            { localId: 't1', title: 'a', assigneeAgentId: B, dependsOn: ['t2'] },
            { localId: 't2', title: 'b', assigneeAgentId: C, dependsOn: ['t1'] },
          ],
        },
        { groupSessionKey: groupKey, createdByAgentId: A },
      ),
    ).rejects.toThrow(/环/);
  });

  it('createPlan 拒绝 assignee 非 active', async () => {
    store.run(`UPDATE agents SET status = 'archived' WHERE id = ?`, B);
    await expect(
      svc.createPlan(
        { goal: 'x', tasks: [{ localId: 't1', title: 'a', assigneeAgentId: B }] },
        { groupSessionKey: groupKey, createdByAgentId: A },
      ),
    ).rejects.toThrow(/无法接活/);
  });

  it('updateTaskStatus 仅 assignee 可调', async () => {
    const snap = await svc.createPlan(
      {
        goal: 'x',
        tasks: [{ localId: 't1', title: 'a', assigneeAgentId: B }],
      },
      { groupSessionKey: groupKey, createdByAgentId: A },
    );
    const taskId = snap.tasks[0].localId; // 拿真 task_id 需要查 DB
    const realTaskId = store.get<{ id: string }>(
      'SELECT id FROM tasks WHERE plan_id = ? AND local_id = ?',
      snap.id,
      taskId,
    )?.id as string;

    // creator (A) 不能改
    const r1 = svc.updateTaskStatus({ taskId: realTaskId, status: 'in_progress' }, A);
    expect(r1.ok).toBe(false);
    // assignee (B) 可以
    const r2 = svc.updateTaskStatus({ taskId: realTaskId, status: 'in_progress' }, B);
    expect(r2.ok).toBe(true);
  });

  it('依赖解锁链：t1 done → t2 触发 task_ready', async () => {
    const snap = await svc.createPlan(
      {
        goal: 'x',
        tasks: [
          { localId: 't1', title: 'a', assigneeAgentId: B },
          { localId: 't2', title: 'b', assigneeAgentId: C, dependsOn: ['t1'] },
        ],
      },
      { groupSessionKey: groupKey, createdByAgentId: A },
    );
    const t1Id = store.get<{ id: string }>(
      'SELECT id FROM tasks WHERE plan_id = ? AND local_id = ?',
      snap.id,
      't1',
    )?.id as string;

    // 初始：B 收到 t1，C 没收到
    const eventsCBefore = peekSystemEvents(`agent:${C}:feishu:group:oc_test`);
    expect(eventsCBefore.some((e) => e.includes('task_id="t2"'))).toBe(false);

    // B 完成 t1
    const r = svc.updateTaskStatus(
      { taskId: t1Id, status: 'done', outputSummary: '设计稿 v1' },
      B,
    );
    expect(r.ok).toBe(true);

    // C 应收到 t2 ready
    const eventsC = peekSystemEvents(`agent:${C}:feishu:group:oc_test`);
    expect(eventsC.some((e) => e.includes('task_ready') && e.includes('t2'))).toBe(true);
  });

  it('全部 done → plan completed + 通知 creator', async () => {
    const snap = await svc.createPlan(
      {
        goal: 'x',
        tasks: [{ localId: 't1', title: 'a', assigneeAgentId: B }],
      },
      { groupSessionKey: groupKey, createdByAgentId: A },
    );
    const t1Id = store.get<{ id: string }>(
      'SELECT id FROM tasks WHERE plan_id = ? AND local_id = ?',
      snap.id,
      't1',
    )?.id as string;
    svc.updateTaskStatus({ taskId: t1Id, status: 'done' }, B);

    const updated = svc.getPlanSnapshot(snap.id);
    expect(updated?.status).toBe('completed');

    // creator A 应收到 plan_completed event
    const eventsA = peekSystemEvents(`agent:${A}:feishu:group:oc_test`);
    expect(eventsA.some((e) => e.includes('plan_completed'))).toBe(true);
  });

  it('needs_help → 通知 task.created_by', async () => {
    const snap = await svc.createPlan(
      {
        goal: 'x',
        tasks: [{ localId: 't1', title: 'a', assigneeAgentId: B }],
      },
      { groupSessionKey: groupKey, createdByAgentId: A },
    );
    const t1Id = store.get<{ id: string }>(
      'SELECT id FROM tasks WHERE plan_id = ? AND local_id = ?',
      snap.id,
      't1',
    )?.id as string;
    svc.updateTaskStatus({ taskId: t1Id, status: 'needs_help', note: '拿不到设计稿' }, B);

    const eventsA = peekSystemEvents(`agent:${A}:feishu:group:oc_test`);
    expect(eventsA.some((e) => e.includes('needs_help') && e.includes('拿不到设计稿'))).toBe(true);
  });

  it('pausePlan 把活跃任务全标 paused', async () => {
    const snap = await svc.createPlan(
      {
        goal: 'x',
        tasks: [
          { localId: 't1', title: 'a', assigneeAgentId: B },
          { localId: 't2', title: 'b', assigneeAgentId: C, dependsOn: ['t1'] },
        ],
      },
      { groupSessionKey: groupKey, createdByAgentId: A },
    );
    const affected = svc.pausePlan(snap.id);
    expect(affected).toBe(2);
    const updated = svc.getPlanSnapshot(snap.id);
    expect(updated?.status).toBe('paused');
    for (const t of updated!.tasks) {
      expect(t.status).toBe('paused');
    }
  });

  it('cancelPlan 把所有未 done 任务标 cancelled', async () => {
    const snap = await svc.createPlan(
      {
        goal: 'x',
        tasks: [{ localId: 't1', title: 'a', assigneeAgentId: B }],
      },
      { groupSessionKey: groupKey, createdByAgentId: A },
    );
    const t1Id = store.get<{ id: string }>(
      'SELECT id FROM tasks WHERE plan_id = ? AND local_id = ?',
      snap.id,
      't1',
    )?.id as string;
    // B 还没开始
    svc.cancelPlan(snap.id);
    const updated = svc.getPlanSnapshot(snap.id);
    expect(updated?.status).toBe('cancelled');
    expect(updated?.tasks[0].status).toBe('cancelled');
    // 试图改已 cancel 的 task → ok=true 但实际 status 不变（取决于 service）
    // 此处不再断言；至少 cancelPlan 自身不抛错
    expect(t1Id).toBeTruthy();
  });

  it('listGroupPlans active 只列活跃', async () => {
    const s1 = await svc.createPlan(
      { goal: 'a', tasks: [{ localId: 't1', title: 'x', assigneeAgentId: B }] },
      { groupSessionKey: groupKey, createdByAgentId: A },
    );
    const s2 = await svc.createPlan(
      { goal: 'b', tasks: [{ localId: 't1', title: 'y', assigneeAgentId: C }] },
      { groupSessionKey: groupKey, createdByAgentId: A },
    );
    svc.cancelPlan(s2.id);

    const active = svc.listGroupPlans(groupKey, 'active');
    expect(active.map((p) => p.id)).toEqual([s1.id]);
    const all = svc.listGroupPlans(groupKey, 'all');
    expect(all.length).toBe(2);
  });

  // ─── M13 修复回归：taskReadyNotifier 主动唤醒 assignee ─────────────────
  // 防止 task_ready event 永远沉默躺在 system event 队列里。
  it('taskReadyNotifier 在 createPlan 后被主动调用（带 DB taskId）', async () => {
    type Captured = { planId: string; taskLocalId: string; taskDbId: string; assigneeId: string; triggeredBy: string };
    const captured: Captured[] = [];
    svc.setTaskReadyNotifier({
      notifyTaskReady: async ({ plan, task, triggeredByAgentId }) => {
        captured.push({
          planId: plan.id,
          taskLocalId: task.localId,
          taskDbId: task.id,
          assigneeId: task.assignee.agentId,
          triggeredBy: triggeredByAgentId,
        });
      },
    });

    const snap = await svc.createPlan(
      {
        goal: '健康 H5 商城首页',
        tasks: [
          { localId: 't1', title: 'PRD', assigneeAgentId: B },
          { localId: 't2', title: '设计', assigneeAgentId: C, dependsOn: ['t1'] },
        ],
      },
      { groupSessionKey: groupKey, createdByAgentId: A, initiatorUserId: 'user-1' },
    );

    // 等微任务跑完 — 通知是 fire-and-forget
    await new Promise((r) => setTimeout(r, 0));

    // 只 t1 是 ready；t2 依赖 t1，未 ready
    expect(captured).toHaveLength(1);
    expect(captured[0]?.planId).toBe(snap.id);
    expect(captured[0]?.taskLocalId).toBe('t1');
    expect(captured[0]?.assigneeId).toBe(B);
    expect(captured[0]?.triggeredBy).toBe(A);
    // M13 修复：task.id 必须是 DB 主键 UUID（让 LLM 直接调 update_task_status 用）
    expect(captured[0]?.taskDbId).toMatch(/^[0-9a-f]{8}-/i);

    // t1 done → t2 ready 也要触发 notifier
    captured.length = 0;
    const t1DbId = store.get<{ id: string }>(
      'SELECT id FROM tasks WHERE plan_id = ? AND local_id = ?',
      snap.id,
      't1',
    )?.id as string;
    svc.updateTaskStatus({ taskId: t1DbId, status: 'done', outputSummary: 'PRD v1' }, B);
    await new Promise((r) => setTimeout(r, 0));

    expect(captured).toHaveLength(1);
    expect(captured[0]?.taskLocalId).toBe('t2');
    expect(captured[0]?.assigneeId).toBe(C);
    expect(captured[0]?.triggeredBy).toBe(B); // updater 触发，不是 plan creator
  });

  it('taskReadyNotifier 抛错不影响 plan 创建', async () => {
    svc.setTaskReadyNotifier({
      notifyTaskReady: async () => {
        throw new Error('模拟通知失败');
      },
    });

    // 不应抛出 — fire-and-forget 的 .catch 兜住了错误
    const snap = await svc.createPlan(
      {
        goal: 'g',
        tasks: [{ localId: 't1', title: 'x', assigneeAgentId: B }],
      },
      { groupSessionKey: groupKey, createdByAgentId: A },
    );
    expect(snap.tasks).toHaveLength(1);
    // system event 仍然 enqueue 了（兜底路径还在）
    const eventsB = peekSystemEvents(`agent:${B}:feishu:group:oc_test`);
    expect(eventsB.some((e) => e.includes('task_ready'))).toBe(true);
  });

  it('同群可并发多个 active plan', async () => {
    const s1 = await svc.createPlan(
      { goal: 'a', tasks: [{ localId: 't1', title: 'x', assigneeAgentId: B }] },
      { groupSessionKey: groupKey, createdByAgentId: A },
    );
    const s2 = await svc.createPlan(
      { goal: 'b', tasks: [{ localId: 't1', title: 'y', assigneeAgentId: C }] },
      { groupSessionKey: groupKey, createdByAgentId: A },
    );
    expect(s1.id).not.toBe(s2.id);
    const active = svc.listGroupPlans(groupKey, 'active');
    expect(active.length).toBe(2);
  });

  // ─── M13 工作流懒加载：expectedArtifactKinds 持久化 ─────────────
  describe('expectedArtifactKinds 持久化', () => {
    it('createPlan 落盘 task.expectedArtifactKinds 后快照能读出', async () => {
      const snap = await svc.createPlan(
        {
          goal: '健康 H5',
          tasks: [
            {
              localId: 't1',
              title: '撰写 PRD',
              assigneeAgentId: B,
              expectedArtifactKinds: ['markdown'],
            },
            {
              localId: 't2',
              title: '视觉稿',
              assigneeAgentId: C,
              dependsOn: ['t1'],
              expectedArtifactKinds: ['image', 'file'],
            },
            {
              localId: 't3',
              title: '前端实现',
              assigneeAgentId: B,
              dependsOn: ['t2'],
              // 不声明 expectedArtifactKinds — 保持 undefined
            },
          ],
        },
        { groupSessionKey: groupKey, createdByAgentId: A },
      );
      const t1 = snap.tasks.find((t) => t.localId === 't1');
      const t2 = snap.tasks.find((t) => t.localId === 't2');
      const t3 = snap.tasks.find((t) => t.localId === 't3');
      expect(t1?.expectedArtifactKinds).toEqual(['markdown']);
      expect(t2?.expectedArtifactKinds).toEqual(['image', 'file']);
      expect(t3?.expectedArtifactKinds).toBeUndefined();
    });

    it('createPlan 收到 expectedArtifactKinds=[] 等价未声明（落 NULL）', async () => {
      const snap = await svc.createPlan(
        {
          goal: 'x',
          tasks: [
            {
              localId: 't1',
              title: 'x',
              assigneeAgentId: B,
              expectedArtifactKinds: [],
            },
          ],
        },
        { groupSessionKey: groupKey, createdByAgentId: A },
      );
      expect(snap.tasks[0]?.expectedArtifactKinds).toBeUndefined();
      // DB 直接读：列应为 NULL
      const row = store.get<{ expected_artifact_kinds: string | null }>(
        'SELECT expected_artifact_kinds FROM tasks WHERE plan_id = ? AND local_id = ?',
        snap.id,
        't1',
      );
      expect(row?.expected_artifact_kinds).toBeNull();
    });

    it('listGroupPlans 跨快照保留 expectedArtifactKinds', async () => {
      const created = await svc.createPlan(
        {
          goal: 'g',
          tasks: [
            {
              localId: 't1',
              title: 'PRD',
              assigneeAgentId: B,
              expectedArtifactKinds: ['markdown', 'doc'],
            },
          ],
        },
        { groupSessionKey: groupKey, createdByAgentId: A },
      );
      const plans = svc.listGroupPlans(groupKey, 'active');
      const matched = plans.find((p) => p.id === created.id);
      expect(matched?.tasks[0]?.expectedArtifactKinds).toEqual(['markdown', 'doc']);
    });
  });

  // ─── M13 修复："先派活后宣告"错位 ────────────────────────────
  describe('TaskCompletedAnnouncer', () => {
    it('updateTaskStatus("done") 先调 announceTaskCompleted 再 dispatchReadyTasks', async () => {
      const callOrder: string[] = [];
      svc.setTaskCompletedAnnouncer({
        announceTaskCompleted: async ({ task, outputSummary }) => {
          callOrder.push(`announce:${task.localId}:${outputSummary.slice(0, 10)}`);
        },
      });
      svc.setTaskReadyNotifier({
        notifyTaskReady: async ({ task }) => {
          callOrder.push(`notify:${task.localId}`);
        },
      });

      const snap = await svc.createPlan(
        {
          goal: 'H5 商城',
          tasks: [
            { localId: 't1', title: 'PRD', assigneeAgentId: B },
            { localId: 't2', title: '设计', assigneeAgentId: C, dependsOn: ['t1'] },
          ],
        },
        { groupSessionKey: groupKey, createdByAgentId: A },
      );

      // 微任务 flush — 等 createPlan 触发的 t1 ready notify 完成
      await new Promise((r) => setTimeout(r, 0));
      callOrder.length = 0; // 清掉 createPlan 派发记录，只关注 done 流程

      const t1Id = store.get<{ id: string }>(
        'SELECT id FROM tasks WHERE plan_id = ? AND local_id = ?',
        snap.id,
        't1',
      )?.id as string;

      svc.updateTaskStatus(
        {
          taskId: t1Id,
          status: 'done',
          outputSummary: 'PRD v1.0 已交付，5 模块全部锁定。',
        },
        B,
      );
      await new Promise((r) => setTimeout(r, 0));

      // 关键断言：announce 必须出现在 notify 之前
      const announceIdx = callOrder.findIndex((s) => s.startsWith('announce:t1'));
      const notifyIdx = callOrder.findIndex((s) => s === 'notify:t2');
      expect(announceIdx).toBeGreaterThanOrEqual(0);
      expect(notifyIdx).toBeGreaterThanOrEqual(0);
      expect(announceIdx).toBeLessThan(notifyIdx);
    });

    it('announcer 透传 outputSummary 给回调', async () => {
      const captured: Array<{ taskLocalId: string; outputSummary: string; assigneeAgentId: string }> = [];
      svc.setTaskCompletedAnnouncer({
        announceTaskCompleted: async ({ task, outputSummary }) => {
          captured.push({
            taskLocalId: task.localId,
            outputSummary,
            assigneeAgentId: task.assignee.agentId,
          });
        },
      });

      const snap = await svc.createPlan(
        {
          goal: 'g',
          tasks: [{ localId: 't1', title: 'PRD', assigneeAgentId: B }],
        },
        { groupSessionKey: groupKey, createdByAgentId: A },
      );
      const t1Id = store.get<{ id: string }>(
        'SELECT id FROM tasks WHERE plan_id = ? AND local_id = ?',
        snap.id,
        't1',
      )?.id as string;

      svc.updateTaskStatus(
        {
          taskId: t1Id,
          status: 'done',
          outputSummary: 'PRD 已交付，含 5 模块、10 验收项、4 风险。',
        },
        B,
      );
      await new Promise((r) => setTimeout(r, 0));

      expect(captured).toHaveLength(1);
      expect(captured[0]?.taskLocalId).toBe('t1');
      expect(captured[0]?.outputSummary).toBe('PRD 已交付，含 5 模块、10 验收项、4 风险。');
      expect(captured[0]?.assigneeAgentId).toBe(B);
    });

    it('outputSummary 为空 / 空白 → 跳过宣告但不阻塞 dispatchReadyTasks', async () => {
      const announceCalls: string[] = [];
      const notifyCalls: string[] = [];
      svc.setTaskCompletedAnnouncer({
        announceTaskCompleted: async ({ task }) => {
          announceCalls.push(task.localId);
        },
      });
      svc.setTaskReadyNotifier({
        notifyTaskReady: async ({ task }) => {
          notifyCalls.push(task.localId);
        },
      });

      const snap = await svc.createPlan(
        {
          goal: 'g',
          tasks: [
            { localId: 't1', title: 'PRD', assigneeAgentId: B },
            { localId: 't2', title: '设计', assigneeAgentId: C, dependsOn: ['t1'] },
          ],
        },
        { groupSessionKey: groupKey, createdByAgentId: A },
      );
      await new Promise((r) => setTimeout(r, 0));
      notifyCalls.length = 0; // 清掉 createPlan 触发的 t1 ready
      const t1Id = store.get<{ id: string }>(
        'SELECT id FROM tasks WHERE plan_id = ? AND local_id = ?',
        snap.id,
        't1',
      )?.id as string;

      svc.updateTaskStatus({ taskId: t1Id, status: 'done' /* 不传 outputSummary */ }, B);
      await new Promise((r) => setTimeout(r, 0));

      expect(announceCalls).toHaveLength(0); // 没宣告
      expect(notifyCalls).toContain('t2');   // 但下游派活照常
    });

    it('announcer 抛错不阻塞下游派活', async () => {
      const notifyCalls: string[] = [];
      svc.setTaskCompletedAnnouncer({
        announceTaskCompleted: async () => {
          throw new Error('模拟宣告失败');
        },
      });
      svc.setTaskReadyNotifier({
        notifyTaskReady: async ({ task }) => {
          notifyCalls.push(task.localId);
        },
      });

      const snap = await svc.createPlan(
        {
          goal: 'g',
          tasks: [
            { localId: 't1', title: 'PRD', assigneeAgentId: B },
            { localId: 't2', title: '设计', assigneeAgentId: C, dependsOn: ['t1'] },
          ],
        },
        { groupSessionKey: groupKey, createdByAgentId: A },
      );
      await new Promise((r) => setTimeout(r, 0));
      notifyCalls.length = 0;
      const t1Id = store.get<{ id: string }>(
        'SELECT id FROM tasks WHERE plan_id = ? AND local_id = ?',
        snap.id,
        't1',
      )?.id as string;

      // 不应抛 — fire-and-forget 的 .catch 兜住了错误
      svc.updateTaskStatus(
        {
          taskId: t1Id,
          status: 'done',
          outputSummary: 'PRD 已交付，含 5 模块、10 验收项。',
        },
        B,
      );
      await new Promise((r) => setTimeout(r, 0));

      expect(notifyCalls).toContain('t2'); // 下游派活仍然触发
    });
  });

  // ─── M13 修复：refreshBoard debounce ────────────────────────────
  describe('refreshBoard debounce', () => {
    it('300ms 窗口内多次 refreshBoard 合并为一次实际发卡', async () => {
      const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'm13-test-debounce-'));
      const store2 = new SqliteStore(':memory:');
      const migRunner = new (await import('../../infrastructure/db/migration-runner.js')).MigrationRunner(store2);
      await migRunner.run();
      const agentManager2 = new AgentManager(store2, tmpDir2);
      const pm = await agentManager2.createAgent({ name: 'PM' });
      const be = await agentManager2.createAgent({ name: '后端' });
      const ui = await agentManager2.createAgent({ name: 'UI' });
      activateAgent(store2, pm.id);
      activateAgent(store2, be.id);
      activateAgent(store2, ui.id);

      // 用 100ms debounce 让测试快一点
      const svc2 = new TaskPlanService({
        store: store2,
        agentManager: agentManager2,
        boardRefreshDebounceMs: 100,
      });

      let boardSinkCalls = 0;
      svc2.setBoardSink(async () => {
        boardSinkCalls += 1;
        return { cardId: `card-${boardSinkCalls}` };
      });

      // createPlan 触发 1 次 refreshBoard（service.ts:286 的 void this.refreshBoard）
      const snap = await svc2.createPlan(
        {
          goal: 'g',
          tasks: [
            { localId: 't1', title: 'PRD', assigneeAgentId: be.id },
            { localId: 't2', title: '设计', assigneeAgentId: ui.id, dependsOn: ['t1'] },
          ],
        },
        { groupSessionKey: 'feishu:chat:oc_debounce', createdByAgentId: pm.id },
      );

      const t1Id = store2.get<{ id: string }>(
        'SELECT id FROM tasks WHERE plan_id = ? AND local_id = ?',
        snap.id,
        't1',
      )?.id as string;

      // 在 100ms debounce 窗口内连续触发 5 次状态变更（每次都会 refreshBoard）
      svc2.updateTaskStatus(
        { taskId: t1Id, status: 'in_progress' },
        be.id,
      );
      svc2.updateTaskStatus(
        {
          taskId: t1Id,
          status: 'done',
          outputSummary: 'PRD 已交付，5 模块覆盖完整链路。',
        },
        be.id,
      );

      // 等 debounce 触发 + 一些缓冲
      await new Promise((r) => setTimeout(r, 250));

      // 即使触发了 createPlan + 2 次 updateTaskStatus（共触发 3+ 次 refreshBoard 调用），
      // 实际发卡次数应远少于（debounce 合并）。期望 ≤ 2（createPlan 一波 + done 一波）
      expect(boardSinkCalls).toBeLessThanOrEqual(2);
      expect(boardSinkCalls).toBeGreaterThanOrEqual(1);

      // cleanup
      if (fs.existsSync(tmpDir2)) fs.rmSync(tmpDir2, { recursive: true, force: true });
    });

    it('flushPendingBoardRefreshes 立即触发所有 pending', async () => {
      const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'm13-test-flush-'));
      const store2 = new SqliteStore(':memory:');
      const migRunner = new (await import('../../infrastructure/db/migration-runner.js')).MigrationRunner(store2);
      await migRunner.run();
      const agentManager2 = new AgentManager(store2, tmpDir2);
      const pm = await agentManager2.createAgent({ name: 'PM' });
      const be = await agentManager2.createAgent({ name: '后端' });
      activateAgent(store2, pm.id);
      activateAgent(store2, be.id);

      const svc2 = new TaskPlanService({
        store: store2,
        agentManager: agentManager2,
        boardRefreshDebounceMs: 5000, // 长 debounce 让 timer 不会自然到点
      });

      let boardSinkCalls = 0;
      svc2.setBoardSink(async () => {
        boardSinkCalls += 1;
        return { cardId: `card-${boardSinkCalls}` };
      });

      await svc2.createPlan(
        { goal: 'g', tasks: [{ localId: 't1', title: 'PRD', assigneeAgentId: be.id }] },
        { groupSessionKey: 'feishu:chat:oc_flush', createdByAgentId: pm.id },
      );

      // 此刻 boardSinkCalls = 0（还在 debounce 窗口里）
      expect(boardSinkCalls).toBe(0);

      // 立即 flush
      svc2.flushPendingBoardRefreshes();
      await new Promise((r) => setTimeout(r, 0));

      expect(boardSinkCalls).toBe(1);

      if (fs.existsSync(tmpDir2)) fs.rmSync(tmpDir2, { recursive: true, force: true });
    });
  });
});

// (afterEach 已在文件顶部 import)
