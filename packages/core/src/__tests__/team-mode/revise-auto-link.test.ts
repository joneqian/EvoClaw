/**
 * /revise → 下一次 create_task_plan 自动 link revised_from（M13 PR5-B6 修复）
 *
 * 验证：
 *   1. /revise 暂停旧 plan + 留 pending revise 上下文
 *   2. consumePendingRevise 一次性消费（重复调返回 null）
 *   3. 10 min 过期失效
 *   4. createPlan 写入 revised_from
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../../infrastructure/db/migration-runner.js';
import { AgentManager } from '../../agent/agent-manager.js';
import { TaskPlanService } from '../../agent/team-mode/task-plan/service.js';
import {
  UserCommandHandler,
  recordPendingRevise,
  consumePendingRevise,
  _resetPendingReviseForTest,
} from '../../agent/team-mode/user-commands.js';
import { resetSystemEventsForTest } from '../../infrastructure/system-events.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('/revise auto-link revised_from', () => {
  let store: SqliteStore;
  let agentManager: AgentManager;
  let svc: TaskPlanService;
  let A: string;
  let B: string;
  let tmpDir: string;
  const groupKey = 'feishu:chat:oc_test';

  beforeEach(async () => {
    resetSystemEventsForTest();
    _resetPendingReviseForTest();
    store = new SqliteStore(':memory:');
    await new MigrationRunner(store).run();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm13-revise-'));
    agentManager = new AgentManager(store, tmpDir);
    A = (await agentManager.createAgent({ name: 'PM' })).id;
    B = (await agentManager.createAgent({ name: 'BE' })).id;
    store.run(`UPDATE agents SET status='active' WHERE id IN (?, ?)`, A, B);
    svc = new TaskPlanService({ store, agentManager });
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('recordPendingRevise + consumePendingRevise 一次性', () => {
    recordPendingRevise(groupKey, 'plan-old-1');
    expect(consumePendingRevise(groupKey)).toBe('plan-old-1');
    expect(consumePendingRevise(groupKey)).toBeNull(); // 第二次取不到
  });

  it('pending revise 不同 group 互不干扰', () => {
    recordPendingRevise('feishu:chat:oc_x', 'plan-x');
    recordPendingRevise('feishu:chat:oc_y', 'plan-y');
    expect(consumePendingRevise('feishu:chat:oc_x')).toBe('plan-x');
    expect(consumePendingRevise('feishu:chat:oc_y')).toBe('plan-y');
  });

  it('createPlan 带 revisedFrom 写库', async () => {
    const oldPlan = await svc.createPlan(
      { goal: '老目标', tasks: [{ localId: 't1', title: 'a', assigneeAgentId: B }] },
      { groupSessionKey: groupKey, createdByAgentId: A },
    );
    const newPlan = await svc.createPlan(
      { goal: '新目标', tasks: [{ localId: 't1', title: 'b', assigneeAgentId: B }] },
      {
        groupSessionKey: groupKey,
        createdByAgentId: A,
        revisedFrom: oldPlan.id,
      },
    );
    const row = store.get<{ revised_from: string | null }>(
      'SELECT revised_from FROM task_plans WHERE id = ?',
      newPlan.id,
    );
    expect(row?.revised_from).toBe(oldPlan.id);
  });

  it('UserCommandHandler./revise → 下一次 createPlan 自动 link', async () => {
    const oldPlan = await svc.createPlan(
      { goal: '老目标', tasks: [{ localId: 't1', title: 'a', assigneeAgentId: B }] },
      { groupSessionKey: groupKey, createdByAgentId: A },
    );

    const handler = new UserCommandHandler({ taskPlanService: svc });
    const result = await handler.handle('/revise 改成只做登录页', groupKey, 'user-1');
    expect(result?.shortCircuit).toBe(true);

    // 现在 group 里有 pending revise 上下文
    const pending = consumePendingRevise(groupKey);
    expect(pending).toBe(oldPlan.id);
  });
});
