/**
 * task-plan tools 单元测试（M13 修复 — "先派活后宣告"错位）
 *
 * 重点：update_task_status status='done' 时强制 outputSummary 必填且 ≥ 30 字
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../../infrastructure/db/migration-runner.js';
import { AgentManager } from '../../agent/agent-manager.js';
import { TaskPlanService } from '../../agent/team-mode/task-plan/service.js';
import {
  createUpdateTaskStatusTool,
  DONE_OUTPUT_SUMMARY_MIN_LENGTH,
} from '../../agent/team-mode/task-plan/tools.js';

async function setupDb() {
  const store = new SqliteStore(':memory:');
  const migRunner = new MigrationRunner(store);
  await migRunner.run();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm13-tools-test-'));
  const agentManager = new AgentManager(store, tmpDir);
  return { store, agentManager, tmpDir };
}

function activate(store: SqliteStore, agentId: string): void {
  store.run(`UPDATE agents SET status = 'active' WHERE id = ?`, agentId);
}

describe('update_task_status tool · outputSummary 必填校验', () => {
  let store: SqliteStore;
  let agentManager: AgentManager;
  let svc: TaskPlanService;
  let tmpDir: string;
  let pmId: string;
  let assigneeId: string;
  let taskId: string;
  const groupKey = 'feishu:chat:oc_test_tools';
  const sessionKey = `agent:__assignee__:feishu:group:oc_test_tools`;

  beforeEach(async () => {
    const setup = await setupDb();
    store = setup.store;
    agentManager = setup.agentManager;
    tmpDir = setup.tmpDir;
    const pm = await agentManager.createAgent({ name: 'PM' });
    const assignee = await agentManager.createAgent({ name: '产品经理' });
    pmId = pm.id;
    assigneeId = assignee.id;
    activate(store, pmId);
    activate(store, assigneeId);
    svc = new TaskPlanService({ store, agentManager, boardRefreshDebounceMs: 0 });
    const snap = await svc.createPlan(
      { goal: 'g', tasks: [{ localId: 't1', title: 'PRD', assigneeAgentId: assigneeId }] },
      { groupSessionKey: groupKey, createdByAgentId: pmId },
    );
    taskId = store.get<{ id: string }>(
      'SELECT id FROM tasks WHERE plan_id = ? AND local_id = ?',
      snap.id,
      't1',
    )!.id;
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      agentId: assigneeId,
      sessionKey: sessionKey.replace('__assignee__', assigneeId),
      taskId,
      status: 'done',
      ...overrides,
    };
  }

  it('DONE_OUTPUT_SUMMARY_MIN_LENGTH 阈值是 30', () => {
    expect(DONE_OUTPUT_SUMMARY_MIN_LENGTH).toBe(30);
  });

  it('status="done" 不传 outputSummary → 拒绝', async () => {
    const tool = createUpdateTaskStatusTool(svc);
    const result = await tool.execute(makeArgs());
    expect(result).toMatch(/status='done' 时 outputSummary 必填/);
    // 任务状态不应被改
    const row = store.get<{ status: string }>('SELECT status FROM tasks WHERE id = ?', taskId);
    expect(row?.status).toBe('pending');
  });

  it('status="done" outputSummary 过短（<30 字）→ 拒绝', async () => {
    const tool = createUpdateTaskStatusTool(svc);
    const result = await tool.execute(makeArgs({ outputSummary: '完成' }));
    expect(result).toMatch(/至少 30 字/);
    const row = store.get<{ status: string }>('SELECT status FROM tasks WHERE id = ?', taskId);
    expect(row?.status).toBe('pending');
  });

  it('status="done" outputSummary 全空白 → 拒绝（trim 后 = 0 字）', async () => {
    const tool = createUpdateTaskStatusTool(svc);
    const result = await tool.execute(
      makeArgs({ outputSummary: '   \n\t   '.repeat(20) }),
    );
    expect(result).toMatch(/至少 30 字/);
  });

  it('status="done" outputSummary 充足（≥30 字）→ 接受', async () => {
    const tool = createUpdateTaskStatusTool(svc);
    const result = await tool.execute(
      makeArgs({
        outputSummary: 'PRD v1.0 已交付，5 模块覆盖完整链路，10 验收项全部通过。',
      }),
    );
    expect(result).toMatch(/已更新任务/);
    const row = store.get<{ status: string; output_summary: string | null }>(
      'SELECT status, output_summary FROM tasks WHERE id = ?',
      taskId,
    );
    expect(row?.status).toBe('done');
    expect(row?.output_summary).toContain('PRD v1.0 已交付');
  });

  it('status="in_progress" 不强制 outputSummary（仅 done 限制）', async () => {
    const tool = createUpdateTaskStatusTool(svc);
    const result = await tool.execute(makeArgs({ status: 'in_progress' }));
    expect(result).toMatch(/已更新任务/);
    const row = store.get<{ status: string }>('SELECT status FROM tasks WHERE id = ?', taskId);
    expect(row?.status).toBe('in_progress');
  });

  it('status="blocked" 不强制 outputSummary', async () => {
    const tool = createUpdateTaskStatusTool(svc);
    const result = await tool.execute(
      makeArgs({ status: 'blocked', note: 'Sandbox 拒绝' }),
    );
    expect(result).toMatch(/已更新任务/);
  });
});
