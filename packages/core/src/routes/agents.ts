import { Hono } from 'hono';
import crypto from 'node:crypto';
import { AgentManager } from '../agent/agent-manager.js';
import { AgentBuilder, type BuilderState, type LLMGenerateFn } from '../agent/agent-builder.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { SkillDiscoverer } from '../skill/skill-discoverer.js';

/** 创建 Agent CRUD 路由 */
export function createAgentRoutes(
  agentManager: AgentManager,
  llmGenerate?: LLMGenerateFn,
  db?: SqliteStore,
  options?: {
    /**
     * DELETE /:id 调用 deleteAgent 之前的外部资源清理钩子
     *
     * 用于断开该 Agent 独占的渠道（WS 连接 + channel_state 凭据）、
     * 停止 HeartbeatRunner 定时器等 AgentManager 本身不感知的资源。
     * 抛错会使整个删除请求 500，调用方自己决定是否吞错继续。
     */
    onBeforeDelete?: (agentId: string) => Promise<void> | void;
  },
) {
  const app = new Hono();

  /** GET / — 列出所有 Agent */
  app.get('/', (c) => {
    const status = c.req.query('status');
    const validStatuses = ['draft', 'active', 'paused', 'archived'] as const;
    const agents = status && validStatuses.includes(status as typeof validStatuses[number])
      ? agentManager.listAgents(status as typeof validStatuses[number])
      : agentManager.listAgents();
    const agentsWithSetup = agents.map(agent => ({
      ...agent,
      setupCompleted: agentManager.isSetupCompleted(agent.id),
    }));
    return c.json({ agents: agentsWithSetup });
  });

  /** GET /:id — 获取单个 Agent */
  app.get('/:id', (c) => {
    const id = c.req.param('id');
    const agent = agentManager.getAgent(id);
    if (!agent) {
      return c.json({ error: 'Agent 不存在' }, 404);
    }
    return c.json({
      agent,
      setupCompleted: agentManager.isSetupCompleted(id),
    });
  });

  /** POST / — 创建 Agent（简单模式，非引导式） */
  app.post('/', async (c) => {
    type AgentBody = { name?: string; emoji?: string; modelId?: string; provider?: string };
    const body: AgentBody = await c.req.json<AgentBody>().catch(() => ({}));

    if (!body.name) {
      return c.json({ error: 'name 字段必填' }, 400);
    }

    const agent = await agentManager.createAgent({
      name: body.name,
      emoji: body.emoji,
      modelId: body.modelId,
      provider: body.provider,
    });

    return c.json({ agent }, 201);
  });

  /** PATCH /:id — 更新 Agent */
  app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const existing = agentManager.getAgent(id);
    if (!existing) {
      return c.json({ error: 'Agent 不存在' }, 404);
    }

    type AgentPatchBody = { name?: string; emoji?: string; modelId?: string; provider?: string; permissionMode?: 'default' | 'strict' | 'permissive'; mcpServers?: string[]; isTeamCoordinator?: boolean };
    const body: AgentPatchBody = await c.req.json<AgentPatchBody>().catch(() => ({}));
    agentManager.updateAgent(id, body);

    const updated = agentManager.getAgent(id);
    return c.json({ agent: updated });
  });

  /** GET /:id/workspace — 列出工作区所有文件（含内容 + 最后修改时间） */
  app.get('/:id/workspace', (c) => {
    const id = c.req.param('id');
    const agent = agentManager.getAgent(id);
    if (!agent) return c.json({ error: 'Agent 不存在' }, 404);

    const files: Record<string, string> = {};
    const mtimes: Record<string, string> = {};
    const fileNames = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'HEARTBEAT.md', 'USER.md', 'MEMORY.md', 'BOOTSTRAP.md'];
    for (const name of fileNames) {
      const content = agentManager.readWorkspaceFile(id, name);
      if (content !== undefined) {
        files[name] = content;
        const mtime = agentManager.getWorkspaceFileMtime(id, name);
        if (mtime) mtimes[name] = mtime;
      }
    }
    return c.json({ files, mtimes });
  });

  /** PUT /:id/workspace/:file — 更新工作区文件 */
  app.put('/:id/workspace/:file', async (c) => {
    const id = c.req.param('id');
    const file = c.req.param('file');
    const agent = agentManager.getAgent(id);
    if (!agent) return c.json({ error: 'Agent 不存在' }, 404);

    const allowedFiles = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'HEARTBEAT.md'];
    if (!allowedFiles.includes(file)) {
      return c.json({ error: '该文件不允许手动编辑' }, 400);
    }

    const body = await c.req.json<{ content: string }>().catch(() => ({ content: '' }));
    agentManager.writeWorkspaceFile(id, file, body.content);
    return c.json({ success: true });
  });

  /** DELETE /:id — 删除 Agent */
  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const existing = agentManager.getAgent(id);
    if (!existing) {
      return c.json({ error: 'Agent 不存在' }, 404);
    }

    // 先清理外部资源（渠道 WS / heartbeat 定时器 / 独占凭据），再删 DB 行。
    // onBeforeDelete 抛错会中断请求返回 500，由调用方决定是否吞错继续。
    if (options?.onBeforeDelete) {
      await options.onBeforeDelete(id);
    }

    agentManager.deleteAgent(id);
    return c.json({ deleted: true });
  });

  // --- 引导式创建 ---
  // 默认模型解析器：从 model_configs 表读取 is_default=1 的配置
  const resolveDefaultModel = db ? () => {
    const row = db.get<{ provider: string; model_id: string }>(
      'SELECT provider, model_id FROM model_configs WHERE is_default = 1 LIMIT 1',
    );
    return row ? { provider: row.provider, modelId: row.model_id } : null;
  } : undefined;

  const builder = new AgentBuilder(agentManager, llmGenerate, resolveDefaultModel);
  const builderSessions = new Map<string, BuilderState>();

  /** POST /create-guided — 启动或推进引导式创建 */
  app.post('/create-guided', async (c) => {
    const { sessionId, message, editedPreview } = await c.req.json<{
      sessionId?: string;
      message?: string;
      editedPreview?: Record<string, string>;
    }>();

    let state: BuilderState;
    let sid: string;

    if (sessionId && builderSessions.has(sessionId)) {
      sid = sessionId;
      state = builderSessions.get(sessionId)!;
    } else {
      sid = crypto.randomUUID();
      state = builder.createSession();
      builderSessions.set(sid, state);
    }

    // 新会话且无消息时，返回开场提示
    if (!message && state.stage === 'role') {
      return c.json({
        sessionId: sid,
        response: {
          stage: 'role',
          message: '让我们来创建一个新的 Agent！首先，你想让它扮演什么角色？比如：资深程序员、英语老师、数据分析师...',
          done: false,
        },
      });
    }

    // 合并前端编辑的预览文件到 state（preview 阶段确认时）
    if (editedPreview && state.stage === 'preview') {
      Object.assign(state.preview, editedPreview);
    }

    const response = await builder.advance(state, message || '');

    if (response.done) {
      builderSessions.delete(sid);
    }

    return c.json({ sessionId: sid, response });
  });

  // --- Agent 技能启用/禁用 ---
  const skillDiscoverer = new SkillDiscoverer();

  /** GET /:id/skills — 获取 Agent 的技能列表（全部已安装 + 启用状态） */
  app.get('/:id/skills', (c) => {
    const agentId = c.req.param('id');
    const agent = agentManager.getAgent(agentId);
    if (!agent) {
      return c.json({ error: 'Agent 不存在' }, 404);
    }

    // 获取所有已安装技能
    const installed = skillDiscoverer.listLocal();

    // 查询该 Agent 显式禁用的技能
    const disabledRows = db
      ? db.all<{ skill_name: string }>(
          'SELECT skill_name FROM agent_skills WHERE agent_id = ? AND enabled = 0',
          agentId,
        )
      : [];
    const disabledSet = new Set(disabledRows.map(r => r.skill_name));

    // 合并：默认启用，除非显式禁用
    const skills = installed.map(s => ({
      name: s.name,
      slug: s.slug,
      description: s.description,
      enabled: !disabledSet.has(s.name),
    }));

    return c.json({ skills });
  });

  /** PUT /:id/skills/:skillName — 启用/禁用某个技能 */
  app.put('/:id/skills/:skillName', async (c) => {
    const agentId = c.req.param('id');
    const skillName = c.req.param('skillName');
    const agent = agentManager.getAgent(agentId);
    if (!agent) {
      return c.json({ error: 'Agent 不存在' }, 404);
    }

    if (!db) {
      return c.json({ error: '数据库不可用' }, 500);
    }

    const { enabled } = await c.req.json<{ enabled: boolean }>();
    const enabledInt = enabled ? 1 : 0;

    db.run(
      `INSERT INTO agent_skills (agent_id, skill_name, enabled, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (agent_id, skill_name)
       DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
      agentId, skillName, enabledInt,
    );

    return c.json({ success: true });
  });

  return app;
}
