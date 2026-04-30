import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { AgentManager } from '../agent/agent-manager.js';
import { AGENT_WORKSPACE_FILES } from '@evoclaw/shared';

/** 读取迁移 SQL */
const migrationsDir = path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations');
const MIGRATION_SQL = fs.readFileSync(path.join(migrationsDir, '001_initial.sql'), 'utf-8');
const MIGRATION_CONVLOG_SQL = fs.readFileSync(path.join(migrationsDir, '004_conversation_log.sql'), 'utf-8');
const MIGRATION_021_SQL = fs.readFileSync(path.join(migrationsDir, '021_conversation_log_hierarchy.sql'), 'utf-8');
const MIGRATION_WORKSPACE_STATE_SQL = fs.readFileSync(path.join(migrationsDir, '014_workspace_state.sql'), 'utf-8');
// M13 修改组 3：协调者表列
const MIGRATION_033_SQL = fs.readFileSync(path.join(migrationsDir, '033_agents_team_coordinator.sql'), 'utf-8');
// M13 PR1：team-mode 表（含 tasks，035 ALTER 需要前置）
const MIGRATION_031_SQL = fs.readFileSync(path.join(migrationsDir, '031_team_mode.sql'), 'utf-8');
// M13 Roster 驱动懒加载：tasks.expected_artifact_kinds + agents.team_workflow_json
const MIGRATION_035_SQL = fs.readFileSync(path.join(migrationsDir, '035_team_workflow_template.sql'), 'utf-8');

describe('AgentManager', () => {
  let store: SqliteStore;
  let manager: AgentManager;
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-agent-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
    const agentsDir = path.join(tmpDir, 'agents');

    store = new SqliteStore(dbPath);
    store.exec(MIGRATION_SQL);
    store.exec(MIGRATION_CONVLOG_SQL);
    store.exec(MIGRATION_021_SQL);
    store.exec(MIGRATION_WORKSPACE_STATE_SQL);
    store.exec(MIGRATION_033_SQL);
    store.exec(MIGRATION_031_SQL);
    store.exec(MIGRATION_035_SQL);
    // 011: agents 表新增 last_chat_at 字段
    try { store.exec('ALTER TABLE agents ADD COLUMN last_chat_at TEXT'); } catch { /* 已存在 */ }
    manager = new AgentManager(store, agentsDir);
  });

  afterEach(() => {
    try {
      store.close();
    } catch {
      // 忽略
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('createAgent 应该创建数据库行和 8 个工作区文件', async () => {
    const agent = await manager.createAgent({ name: '测试助手', emoji: '🧪' });

    expect(agent.id).toBeDefined();
    expect(agent.name).toBe('测试助手');
    expect(agent.emoji).toBe('🧪');
    expect(agent.status).toBe('draft');

    // 验证数据库行
    const row = store.get<any>('SELECT * FROM agents WHERE id = ?', agent.id);
    expect(row).toBeDefined();
    expect(row.name).toBe('测试助手');

    // 验证 8 个工作区文件
    const wsPath = manager.getWorkspacePath(agent.id);
    expect(fs.existsSync(wsPath)).toBe(true);

    for (const file of AGENT_WORKSPACE_FILES) {
      const filePath = path.join(wsPath, file);
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });

  it('createAgent 使用默认 emoji', async () => {
    const agent = await manager.createAgent({ name: '默认 Agent' });
    expect(agent.emoji).toBe('🤖');
  });

  it('getAgent 应该返回正确的 AgentConfig', async () => {
    const created = await manager.createAgent({ name: '查询测试', modelId: 'gpt-4o', provider: 'openai' });
    const agent = manager.getAgent(created.id);

    expect(agent).toBeDefined();
    expect(agent!.id).toBe(created.id);
    expect(agent!.name).toBe('查询测试');
    expect(agent!.modelId).toBe('gpt-4o');
    expect(agent!.provider).toBe('openai');
  });

  it('getAgent 不存在的 ID 应该返回 undefined', () => {
    const agent = manager.getAgent('non-existent-id');
    expect(agent).toBeUndefined();
  });

  it('listAgents 应该返回所有 Agent', async () => {
    await manager.createAgent({ name: 'Agent A' });
    await manager.createAgent({ name: 'Agent B' });
    await manager.createAgent({ name: 'Agent C' });

    const agents = manager.listAgents();
    expect(agents).toHaveLength(3);
  });

  it('listAgents 按状态过滤', async () => {
    await manager.createAgent({ name: 'Draft Agent' });
    const b = await manager.createAgent({ name: 'Active Agent' });
    manager.updateAgentStatus(b.id, 'active');

    const drafts = manager.listAgents('draft');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.name).toBe('Draft Agent');

    const actives = manager.listAgents('active');
    expect(actives).toHaveLength(1);
    expect(actives[0]!.name).toBe('Active Agent');
  });

  it('updateAgentStatus 应该更新状态', async () => {
    const agent = await manager.createAgent({ name: '状态测试' });
    expect(agent.status).toBe('draft');

    manager.updateAgentStatus(agent.id, 'active');
    const updated = manager.getAgent(agent.id);
    expect(updated!.status).toBe('active');

    manager.updateAgentStatus(agent.id, 'paused');
    const paused = manager.getAgent(agent.id);
    expect(paused!.status).toBe('paused');
  });

  it('updateAgent 应该更新名称', async () => {
    const agent = await manager.createAgent({ name: '旧名称' });
    manager.updateAgent(agent.id, { name: '新名称' });

    const updated = manager.getAgent(agent.id);
    expect(updated!.name).toBe('新名称');
  });

  it('updateAgent 应该更新 emoji', async () => {
    const agent = await manager.createAgent({ name: 'Emoji 测试' });
    manager.updateAgent(agent.id, { emoji: '🚀' });

    const updated = manager.getAgent(agent.id);
    expect(updated!.emoji).toBe('🚀');
  });

  it('updateAgent 应该更新 modelId', async () => {
    const agent = await manager.createAgent({ name: 'Model 测试', modelId: 'gpt-4o-mini' });
    manager.updateAgent(agent.id, { modelId: 'gpt-4o' });

    const updated = manager.getAgent(agent.id);
    expect(updated!.modelId).toBe('gpt-4o');
  });

  // ─── M13 修改组 3：协调者配置 ─────────────────────────
  it('新建 Agent 默认 isTeamCoordinator=false', async () => {
    const agent = await manager.createAgent({ name: '协调者默认测试' });
    const fetched = manager.getAgent(agent.id);
    expect(fetched!.isTeamCoordinator).toBe(false);
  });

  it('updateAgent 设 isTeamCoordinator=true 后能读回', async () => {
    const agent = await manager.createAgent({ name: '协调者切换测试' });
    manager.updateAgent(agent.id, { isTeamCoordinator: true });

    const updated = manager.getAgent(agent.id);
    expect(updated!.isTeamCoordinator).toBe(true);
  });

  it('updateAgent 关闭 isTeamCoordinator 也生效', async () => {
    const agent = await manager.createAgent({ name: '协调者关闭测试' });
    manager.updateAgent(agent.id, { isTeamCoordinator: true });
    manager.updateAgent(agent.id, { isTeamCoordinator: false });

    const updated = manager.getAgent(agent.id);
    expect(updated!.isTeamCoordinator).toBe(false);
  });

  it('listAgents 返回的 Agent 包含 isTeamCoordinator 字段', async () => {
    const a1 = await manager.createAgent({ name: '协调者 A' });
    await manager.createAgent({ name: '普通 B' });
    manager.updateAgent(a1.id, { isTeamCoordinator: true });

    const list = manager.listAgents();
    const aFromList = list.find((x) => x.id === a1.id);
    expect(aFromList?.isTeamCoordinator).toBe(true);
    const bFromList = list.find((x) => x.name === '普通 B');
    expect(bFromList?.isTeamCoordinator).toBe(false);
  });

  // ─── M13 Roster 驱动懒加载：teamWorkflow 持久化 ─────────────
  it('新建 Agent 默认 teamWorkflow=undefined', async () => {
    const agent = await manager.createAgent({ name: '工作流默认测试' });
    const fetched = manager.getAgent(agent.id);
    expect(fetched!.teamWorkflow).toBeUndefined();
  });

  it('updateAgent 落盘 teamWorkflow 后能完整读回', async () => {
    const agent = await manager.createAgent({ name: '工作流落盘测试' });
    manager.updateAgent(agent.id, {
      teamWorkflow: {
        whenToUse: '产品功能/页面/系统类需求',
        phases: [
          {
            name: '需求',
            roleHints: ['产品经理', 'PM'],
            expectedArtifactKinds: ['markdown'],
            description: '产品经理产出 PRD',
          },
          {
            name: '视觉',
            roleHints: ['UI/UX'],
            expectedArtifactKinds: ['image', 'file'],
            description: '出视觉稿',
          },
        ],
        createdAt: '2026-04-28T01:00:00.000Z',
        approvedBy: 'user-leyi',
      },
    });
    const updated = manager.getAgent(agent.id);
    expect(updated!.teamWorkflow).toBeDefined();
    expect(updated!.teamWorkflow!.whenToUse).toBe('产品功能/页面/系统类需求');
    expect(updated!.teamWorkflow!.phases).toHaveLength(2);
    expect(updated!.teamWorkflow!.phases[0]).toEqual({
      name: '需求',
      roleHints: ['产品经理', 'PM'],
      expectedArtifactKinds: ['markdown'],
      description: '产品经理产出 PRD',
    });
    expect(updated!.teamWorkflow!.approvedBy).toBe('user-leyi');
    expect(updated!.teamWorkflow!.createdAt).toBe('2026-04-28T01:00:00.000Z');
  });

  it('listAgents 返回的 Agent 包含 teamWorkflow 字段', async () => {
    const a1 = await manager.createAgent({ name: '工作流 A' });
    await manager.createAgent({ name: '无工作流 B' });
    manager.updateAgent(a1.id, {
      teamWorkflow: {
        whenToUse: 'whatever',
        phases: [
          {
            name: 'x',
            roleHints: ['x'],
            expectedArtifactKinds: ['markdown'],
            description: 'x',
          },
        ],
        createdAt: '2026-04-28T00:00:00.000Z',
      },
    });

    const list = manager.listAgents();
    const aFromList = list.find((x) => x.id === a1.id);
    expect(aFromList?.teamWorkflow?.whenToUse).toBe('whatever');
    const bFromList = list.find((x) => x.name === '无工作流 B');
    expect(bFromList?.teamWorkflow).toBeUndefined();
  });

  it('updateAgent isTeamCoordinator 与 teamWorkflow 互不干扰', async () => {
    const agent = await manager.createAgent({ name: '混合测试' });
    manager.updateAgent(agent.id, {
      isTeamCoordinator: true,
      teamWorkflow: {
        whenToUse: 'x',
        phases: [
          {
            name: 'p',
            roleHints: ['p'],
            expectedArtifactKinds: ['markdown'],
            description: 'p',
          },
        ],
        createdAt: '2026-04-28T00:00:00.000Z',
      },
    });
    const r1 = manager.getAgent(agent.id);
    expect(r1?.isTeamCoordinator).toBe(true);
    expect(r1?.teamWorkflow).toBeDefined();

    // 关闭协调者，但保留工作流
    manager.updateAgent(agent.id, { isTeamCoordinator: false });
    const r2 = manager.getAgent(agent.id);
    expect(r2?.isTeamCoordinator).toBe(false);
    expect(r2?.teamWorkflow?.whenToUse).toBe('x'); // 工作流仍在
  });

  it('updateAgent 不存在的 Agent 应该抛出错误', () => {
    expect(() => manager.updateAgent('non-existent', { name: 'test' }))
      .toThrow('Agent non-existent not found');
  });

  it('deleteAgent 应该删除数据库行和工作区目录', async () => {
    const agent = await manager.createAgent({ name: '删除测试' });
    const wsPath = manager.getWorkspacePath(agent.id);
    expect(fs.existsSync(wsPath)).toBe(true);

    manager.deleteAgent(agent.id);

    // 数据库行已删除
    const row = manager.getAgent(agent.id);
    expect(row).toBeUndefined();

    // 工作区目录已删除
    expect(fs.existsSync(wsPath)).toBe(false);
  });

  it('readWorkspaceFile 应该读取文件内容', async () => {
    const agent = await manager.createAgent({ name: '读取测试' });
    const content = manager.readWorkspaceFile(agent.id, 'SOUL.md');
    expect(content).toBeDefined();
    expect(content).toContain('Philosophy');
  });

  it('readWorkspaceFile 不存在的文件返回 undefined', async () => {
    const agent = await manager.createAgent({ name: '读取测试' });
    const content = manager.readWorkspaceFile(agent.id, 'NOT_EXIST.md');
    expect(content).toBeUndefined();
  });

  it('writeWorkspaceFile 应该写入文件内容', async () => {
    const agent = await manager.createAgent({ name: '写入测试' });
    manager.writeWorkspaceFile(agent.id, 'USER.md', '# 用户偏好\n\n语言：中文');

    const content = manager.readWorkspaceFile(agent.id, 'USER.md');
    expect(content).toBe('# 用户偏好\n\n语言：中文');
  });

  it('IDENTITY.md 应该包含 Agent 名称和 emoji', async () => {
    const agent = await manager.createAgent({ name: '小明', emoji: '😎' });
    const content = manager.readWorkspaceFile(agent.id, 'IDENTITY.md');
    expect(content).toContain('小明');
    expect(content).toContain('😎');
  });

  // ─── 工作区状态 (workspace_state) ───

  it('setWorkspaceState / getWorkspaceState 应该正确读写', async () => {
    const agent = await manager.createAgent({ name: '状态测试' });
    manager.setWorkspaceState(agent.id, 'test_key', 'test_value');

    const value = manager.getWorkspaceState(agent.id, 'test_key');
    expect(value).toBe('test_value');
  });

  it('getWorkspaceState 不存在的 key 返回 null', async () => {
    const agent = await manager.createAgent({ name: '空状态测试' });
    const value = manager.getWorkspaceState(agent.id, 'nonexistent');
    expect(value).toBeNull();
  });

  it('setWorkspaceState 应该支持 upsert（覆盖更新）', async () => {
    const agent = await manager.createAgent({ name: 'Upsert 测试' });
    manager.setWorkspaceState(agent.id, 'my_key', 'first');
    manager.setWorkspaceState(agent.id, 'my_key', 'second');

    const value = manager.getWorkspaceState(agent.id, 'my_key');
    expect(value).toBe('second');
  });

  it('createAgent 应该记录 bootstrap_seeded_at', async () => {
    const agent = await manager.createAgent({ name: 'Bootstrap 测试' });
    const seeded = manager.getWorkspaceState(agent.id, 'bootstrap_seeded_at');
    expect(seeded).not.toBeNull();
    // 应该是有效的 ISO 时间戳
    expect(new Date(seeded!).toISOString()).toBe(seeded);
  });

  it('isSetupCompleted 默认返回 false', async () => {
    const agent = await manager.createAgent({ name: 'Setup 未完成' });
    expect(manager.isSetupCompleted(agent.id)).toBe(false);
  });

  it('isSetupCompleted 设置后返回 true', async () => {
    const agent = await manager.createAgent({ name: 'Setup 完成' });
    manager.setWorkspaceState(agent.id, 'setup_completed_at', new Date().toISOString());
    expect(manager.isSetupCompleted(agent.id)).toBe(true);
  });

  it('deleteAgent 应该级联删除 workspace_state', async () => {
    const agent = await manager.createAgent({ name: '级联删除测试' });
    manager.setWorkspaceState(agent.id, 'test_key', 'test_value');

    manager.deleteAgent(agent.id);

    // workspace_state 应该被级联删除
    const value = manager.getWorkspaceState(agent.id, 'test_key');
    expect(value).toBeNull();
  });

  // P1-A: sessionKey 门控（subagent / cron 不能读写 BOOTSTRAP/HEARTBEAT/MEMORY 根文件）
  describe('sessionKey 门控', () => {
    it('主 session 读 BOOTSTRAP.md 通过', async () => {
      const agent = await manager.createAgent({ name: '主 session' });
      const sessionKey = `agent:${agent.id}:default:direct:`;
      const content = manager.readWorkspaceFile(agent.id, 'BOOTSTRAP.md', sessionKey);
      expect(content).toBeDefined();
    });

    it('subagent 读 BOOTSTRAP.md 抛 WorkspaceAccessDeniedError', async () => {
      const agent = await manager.createAgent({ name: 'subagent 读受限' });
      const sessionKey = `agent:${agent.id}:local:subagent:t1`;
      expect(() => manager.readWorkspaceFile(agent.id, 'BOOTSTRAP.md', sessionKey)).toThrow(/Access denied/);
      expect(() => manager.readWorkspaceFile(agent.id, 'HEARTBEAT.md', sessionKey)).toThrow(/Access denied/);
      expect(() => manager.readWorkspaceFile(agent.id, 'MEMORY.md', sessionKey)).toThrow(/Access denied/);
    });

    it('subagent 读 SOUL/IDENTITY/USER 通过（非 RESTRICTED）', async () => {
      const agent = await manager.createAgent({ name: 'subagent 读放行' });
      const sessionKey = `agent:${agent.id}:local:subagent:t1`;
      expect(manager.readWorkspaceFile(agent.id, 'SOUL.md', sessionKey)).toBeDefined();
      expect(manager.readWorkspaceFile(agent.id, 'IDENTITY.md', sessionKey)).toBeDefined();
      expect(manager.readWorkspaceFile(agent.id, 'USER.md', sessionKey)).toBeDefined();
    });

    it('cron 写 MEMORY.md 抛 WorkspaceAccessDeniedError', async () => {
      const agent = await manager.createAgent({ name: 'cron 写受限' });
      const sessionKey = `agent:${agent.id}:cron:job-x`;
      expect(() => manager.writeWorkspaceFile(agent.id, 'MEMORY.md', 'pwn', sessionKey)).toThrow(/Access denied/);
      expect(() => manager.writeWorkspaceFile(agent.id, 'BOOTSTRAP.md', 'pwn', sessionKey)).toThrow(/Access denied/);
    });

    it('不传 sessionKey → 内部调用，门控豁免（reconciler 等）', async () => {
      const agent = await manager.createAgent({ name: '内部调用' });
      // bootstrap-reconciler 不传 sessionKey，应能读写 BOOTSTRAP/MEMORY
      expect(() => manager.readWorkspaceFile(agent.id, 'BOOTSTRAP.md')).not.toThrow();
      expect(() => manager.writeWorkspaceFile(agent.id, 'BOOTSTRAP.md', '')).not.toThrow();
      expect(() => manager.writeWorkspaceFile(agent.id, 'MEMORY.md', 'rendered')).not.toThrow();
    });

    it('heartbeat session（主 session 派生）→ 通过', async () => {
      const agent = await manager.createAgent({ name: 'heartbeat' });
      const sessionKey = `agent:${agent.id}:default:direct::heartbeat:p1`;
      expect(() => manager.readWorkspaceFile(agent.id, 'HEARTBEAT.md', sessionKey)).not.toThrow();
      expect(() => manager.readWorkspaceFile(agent.id, 'BOOTSTRAP.md', sessionKey)).not.toThrow();
    });
  });
});
