import { AgentConfig, AgentStatus, AGENT_WORKSPACE_FILES, DEFAULT_DATA_DIR, AGENTS_DIR } from '@evoclaw/shared';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Agent 生命周期管理器 — CRUD + 工作区目录管理
 */
export class AgentManager {
  private store: SqliteStore;
  private agentsBaseDir: string;

  constructor(store: SqliteStore, agentsBaseDir?: string) {
    this.store = store;
    this.agentsBaseDir = agentsBaseDir ?? path.join(os.homedir(), DEFAULT_DATA_DIR, AGENTS_DIR);
  }

  /** 创建 Agent */
  async createAgent(config: Partial<AgentConfig> & { name: string }): Promise<AgentConfig> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const agent: AgentConfig = {
      id,
      name: config.name,
      emoji: config.emoji ?? '🤖',
      status: 'draft',
      modelId: config.modelId,
      provider: config.provider,
      createdAt: now,
      updatedAt: now,
    };

    // 插入数据库
    this.store.run(
      'INSERT INTO agents (id, name, emoji, status, config_json, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      agent.id, agent.name, agent.emoji, agent.status,
      JSON.stringify({ modelId: agent.modelId, provider: agent.provider }),
      this.getWorkspacePath(id), now, now
    );

    // 创建工作区目录 + 8 个模板文件
    this.initWorkspace(id, agent);

    return agent;
  }

  /** 获取 Agent */
  getAgent(id: string): AgentConfig | undefined {
    const row = this.store.get<any>('SELECT * FROM agents WHERE id = ?', id);
    if (!row) return undefined;
    return this.rowToConfig(row);
  }

  /** 列出所有 Agent */
  listAgents(status?: AgentStatus): AgentConfig[] {
    const rows = status
      ? this.store.all<any>('SELECT * FROM agents WHERE status = ? ORDER BY updated_at DESC', status)
      : this.store.all<any>('SELECT * FROM agents ORDER BY updated_at DESC');
    return rows.map(r => this.rowToConfig(r));
  }

  /** 更新 Agent 状态 */
  updateAgentStatus(id: string, status: AgentStatus): void {
    this.store.run('UPDATE agents SET status = ?, updated_at = ? WHERE id = ?', status, new Date().toISOString(), id);
  }

  /** 更新 Agent 配置 */
  updateAgent(id: string, updates: Partial<Pick<AgentConfig, 'name' | 'emoji' | 'modelId' | 'provider'>>): void {
    const agent = this.getAgent(id);
    if (!agent) throw new Error(`Agent ${id} not found`);

    const now = new Date().toISOString();
    if (updates.name) this.store.run('UPDATE agents SET name = ?, updated_at = ? WHERE id = ?', updates.name, now, id);
    if (updates.emoji) this.store.run('UPDATE agents SET emoji = ?, updated_at = ? WHERE id = ?', updates.emoji, now, id);
    if (updates.modelId || updates.provider) {
      const configRow = this.store.get<any>('SELECT config_json FROM agents WHERE id = ?', id);
      const config = JSON.parse(configRow?.config_json ?? '{}');
      if (updates.modelId) config.modelId = updates.modelId;
      if (updates.provider) config.provider = updates.provider;
      this.store.run('UPDATE agents SET config_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(config), now, id);
    }
  }

  /** 删除 Agent */
  deleteAgent(id: string): void {
    this.store.run('DELETE FROM agents WHERE id = ?', id);
    // 同时删除工作区目录
    const wsPath = this.getWorkspacePath(id);
    if (fs.existsSync(wsPath)) {
      fs.rmSync(wsPath, { recursive: true, force: true });
    }
  }

  /** 获取工作区路径 */
  getWorkspacePath(agentId: string): string {
    return path.join(this.agentsBaseDir, agentId, 'workspace');
  }

  /** 读取工作区文件 */
  readWorkspaceFile(agentId: string, file: string): string | undefined {
    const filePath = path.join(this.getWorkspacePath(agentId), file);
    if (!fs.existsSync(filePath)) return undefined;
    return fs.readFileSync(filePath, 'utf-8');
  }

  /** 写入工作区文件 */
  writeWorkspaceFile(agentId: string, file: string, content: string): void {
    const filePath = path.join(this.getWorkspacePath(agentId), file);
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  private initWorkspace(id: string, config: AgentConfig): void {
    const wsPath = this.getWorkspacePath(id);
    fs.mkdirSync(wsPath, { recursive: true });

    // 创建默认模板文件
    this.writeWorkspaceFile(id, 'SOUL.md', DEFAULT_SOUL_MD);
    this.writeWorkspaceFile(id, 'IDENTITY.md', generateIdentityMd(config));
    this.writeWorkspaceFile(id, 'AGENTS.md', DEFAULT_AGENTS_MD);
    this.writeWorkspaceFile(id, 'TOOLS.md', DEFAULT_TOOLS_MD);
    this.writeWorkspaceFile(id, 'HEARTBEAT.md', DEFAULT_HEARTBEAT_MD);
    this.writeWorkspaceFile(id, 'USER.md', '');
    this.writeWorkspaceFile(id, 'MEMORY.md', '');
    this.writeWorkspaceFile(id, 'BOOTSTRAP.md', DEFAULT_BOOTSTRAP_MD);
  }

  private rowToConfig(row: any): AgentConfig {
    const config = JSON.parse(row.config_json || '{}');
    return {
      id: row.id,
      name: row.name,
      emoji: row.emoji,
      status: row.status,
      modelId: config.modelId,
      provider: config.provider,
      bindings: config.bindings,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// 默认模板内容
const DEFAULT_SOUL_MD = `# 行为哲学

你是一个友善、专业的 AI 助手。你的核心价值观：

1. **诚实透明** — 不确定时坦诚说明，不编造信息
2. **用户优先** — 理解用户真实意图，给出最有帮助的回答
3. **持续学习** — 从每次对话中积累经验，不断进化
4. **安全负责** — 拒绝有害请求，保护用户隐私
`;

function generateIdentityMd(config: AgentConfig): string {
  return `---
name: ${config.name}
emoji: ${config.emoji}
version: 1
---

# ${config.emoji} ${config.name}

这是 ${config.name} 的身份配置文件。
`;
}

const DEFAULT_AGENTS_MD = `# 操作规程

## 对话规范
- 使用中文回复用户
- 回答简洁准确，避免冗余
- 需要使用工具时，先说明意图再执行

## 工具使用
- 优先使用专用工具而非通用命令
- 操作前确认影响范围
- 完成后报告结果
`;

const DEFAULT_TOOLS_MD = `# 可用工具

工具列表将在启动时动态注入。
`;

const DEFAULT_HEARTBEAT_MD = `# 定时任务

暂无配置的定时任务。
`;

const DEFAULT_BOOTSTRAP_MD = `# 启动流程

Agent 启动时自动执行以下步骤：
1. 加载 SOUL.md 和 IDENTITY.md
2. 加载 AGENTS.md 操作规程
3. 渲染 USER.md 和 MEMORY.md
4. 注入工具集
`;
