/**
 * propose_team_workflow 工具单元测试（M13 Roster 驱动懒加载）
 *
 * 覆盖：
 *   - 协调者落盘 → AgentConfig.teamWorkflow 反序列化得到原值
 *   - 非协调者拒绝
 *   - phases 入参校验：长度 0 / 字段缺失 / artifact kind 全非法
 *   - approvedBy 透传（来自 channel-message-handler 注入的 initiatorUserId）
 *   - 落盘后 createdAt 是 ISO 字符串
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../../infrastructure/db/migration-runner.js';
import { AgentManager } from '../../agent/agent-manager.js';
import { createProposeTeamWorkflowTool } from '../../agent/team-mode/team-workflow/tools.js';

async function setupDb(): Promise<{ store: SqliteStore; agentManager: AgentManager; tmpDir: string }> {
  const store = new SqliteStore(':memory:');
  const migRunner = new MigrationRunner(store);
  await migRunner.run();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm13-team-workflow-test-'));
  const agentManager = new AgentManager(store, tmpDir);
  return { store, agentManager, tmpDir };
}

function activate(store: SqliteStore, agentId: string): void {
  store.run(`UPDATE agents SET status = 'active' WHERE id = ?`, agentId);
}

describe('propose_team_workflow', () => {
  let store: SqliteStore;
  let agentManager: AgentManager;
  let tmpDir: string;
  let coordinatorId: string;
  let normalAgentId: string;

  beforeEach(async () => {
    const setup = await setupDb();
    store = setup.store;
    agentManager = setup.agentManager;
    tmpDir = setup.tmpDir;

    const coord = await agentManager.createAgent({ name: '项目经理' });
    const normal = await agentManager.createAgent({ name: '产品经理' });
    coordinatorId = coord.id;
    normalAgentId = normal.id;
    activate(store, coordinatorId);
    activate(store, normalAgentId);

    // 把 coordinator 标记为协调者
    agentManager.updateAgent(coordinatorId, { isTeamCoordinator: true });
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('协调者调用成功 → AgentConfig.teamWorkflow 已落盘且能读出原值', async () => {
    const tool = createProposeTeamWorkflowTool({ agentManager });
    const result = await tool.execute({
      agentId: coordinatorId,
      whenToUse: '产品功能/页面/系统类需求',
      phases: [
        {
          name: '需求',
          roleHints: ['产品经理'],
          expectedArtifactKinds: ['markdown'],
          description: '产品经理产出 PRD',
        },
        {
          name: '视觉',
          roleHints: ['UI/UX'],
          expectedArtifactKinds: ['image', 'file'],
          description: 'UI/UX 出视觉稿',
        },
      ],
      initiatorUserId: 'user-leyi',
    });

    expect(result).toContain('已落盘团队工作流模板');
    expect(result).toContain('共 2 阶段');
    expect(result).toContain('适用场景：产品功能/页面/系统类需求');

    const reread = agentManager.getAgent(coordinatorId);
    expect(reread?.teamWorkflow).toBeDefined();
    expect(reread?.teamWorkflow?.whenToUse).toBe('产品功能/页面/系统类需求');
    expect(reread?.teamWorkflow?.phases).toHaveLength(2);
    expect(reread?.teamWorkflow?.phases[0]).toEqual({
      name: '需求',
      roleHints: ['产品经理'],
      expectedArtifactKinds: ['markdown'],
      description: '产品经理产出 PRD',
    });
    expect(reread?.teamWorkflow?.phases[1]?.expectedArtifactKinds).toEqual(['image', 'file']);
    expect(reread?.teamWorkflow?.approvedBy).toBe('user-leyi');
    expect(reread?.teamWorkflow?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('非协调者调用 → 拒绝且不落盘', async () => {
    const tool = createProposeTeamWorkflowTool({ agentManager });
    const result = await tool.execute({
      agentId: normalAgentId,
      whenToUse: 'whatever',
      phases: [
        {
          name: 'x',
          roleHints: ['x'],
          expectedArtifactKinds: ['markdown'],
          description: 'x',
        },
      ],
    });
    expect(result).toMatch(/仅团队协调中心可设置工作流模板/);
    const reread = agentManager.getAgent(normalAgentId);
    expect(reread?.teamWorkflow).toBeUndefined();
  });

  it('phases 长度 0 → 拒绝', async () => {
    const tool = createProposeTeamWorkflowTool({ agentManager });
    const result = await tool.execute({
      agentId: coordinatorId,
      whenToUse: 'x',
      phases: [],
    });
    expect(result).toMatch(/phases 至少 1 项/);
  });

  it('phases[i].name 缺失 → 拒绝', async () => {
    const tool = createProposeTeamWorkflowTool({ agentManager });
    const result = await tool.execute({
      agentId: coordinatorId,
      whenToUse: 'x',
      phases: [
        {
          name: '',
          roleHints: ['x'],
          expectedArtifactKinds: ['markdown'],
          description: 'x',
        },
      ],
    });
    expect(result).toMatch(/phases\[0\]\.name/);
  });

  it('phases[i].roleHints 全空 → 拒绝', async () => {
    const tool = createProposeTeamWorkflowTool({ agentManager });
    const result = await tool.execute({
      agentId: coordinatorId,
      whenToUse: 'x',
      phases: [
        {
          name: '需求',
          roleHints: ['', '   '],
          expectedArtifactKinds: ['markdown'],
          description: 'x',
        },
      ],
    });
    expect(result).toMatch(/全部为空字符串/);
  });

  it('phases[i].expectedArtifactKinds 全非法 → 拒绝', async () => {
    const tool = createProposeTeamWorkflowTool({ agentManager });
    const result = await tool.execute({
      agentId: coordinatorId,
      whenToUse: 'x',
      phases: [
        {
          name: '需求',
          roleHints: ['产品经理'],
          expectedArtifactKinds: ['xxxx', 'banana'],
          description: 'x',
        },
      ],
    });
    expect(result).toMatch(/没有合法值/);
  });

  it('phases[i].expectedArtifactKinds 部分合法 → 过滤后继续', async () => {
    const tool = createProposeTeamWorkflowTool({ agentManager });
    const result = await tool.execute({
      agentId: coordinatorId,
      whenToUse: 'x',
      phases: [
        {
          name: '需求',
          roleHints: ['产品经理'],
          expectedArtifactKinds: ['markdown', 'banana', 'doc'],
          description: 'x',
        },
      ],
    });
    expect(result).toContain('已落盘');
    const reread = agentManager.getAgent(coordinatorId);
    expect(reread?.teamWorkflow?.phases[0]?.expectedArtifactKinds).toEqual(['markdown', 'doc']);
  });

  it('whenToUse 空字符串 → 拒绝', async () => {
    const tool = createProposeTeamWorkflowTool({ agentManager });
    const result = await tool.execute({
      agentId: coordinatorId,
      whenToUse: '   ',
      phases: [
        {
          name: '需求',
          roleHints: ['产品经理'],
          expectedArtifactKinds: ['markdown'],
          description: 'x',
        },
      ],
    });
    expect(result).toMatch(/whenToUse 必填/);
  });

  it('agentId 缺失 → 报错', async () => {
    const tool = createProposeTeamWorkflowTool({ agentManager });
    const result = await tool.execute({
      whenToUse: 'x',
      phases: [
        {
          name: '需求',
          roleHints: ['产品经理'],
          expectedArtifactKinds: ['markdown'],
          description: 'x',
        },
      ],
    });
    expect(result).toMatch(/缺少 agentId/);
  });

  it('caller agent 不存在 → 拒绝', async () => {
    const tool = createProposeTeamWorkflowTool({ agentManager });
    const result = await tool.execute({
      agentId: 'ghost-agent-id',
      whenToUse: 'x',
      phases: [
        {
          name: '需求',
          roleHints: ['产品经理'],
          expectedArtifactKinds: ['markdown'],
          description: 'x',
        },
      ],
    });
    expect(result).toMatch(/caller agent 不存在/);
  });
});
