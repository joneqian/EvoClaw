import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { AgentManager } from '../agent/agent-manager.js';
import { AGENT_WORKSPACE_FILES } from '@evoclaw/shared';

/** 读取初始迁移 SQL */
const MIGRATION_SQL = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '001_initial.sql'),
  'utf-8'
);

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
    const a = await manager.createAgent({ name: 'Draft Agent' });
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
    expect(content).toContain('行为哲学');
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
});
