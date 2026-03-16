import { Hono } from 'hono';
import crypto from 'node:crypto';
import { AgentManager } from '../agent/agent-manager.js';
import { AgentBuilder, type BuilderState, type LLMGenerateFn } from '../agent/agent-builder.js';

/** 创建 Agent CRUD 路由 */
export function createAgentRoutes(agentManager: AgentManager, llmGenerate?: LLMGenerateFn) {
  const app = new Hono();

  /** GET / — 列出所有 Agent */
  app.get('/', (c) => {
    const status = c.req.query('status');
    const validStatuses = ['draft', 'active', 'paused', 'archived'] as const;
    const agents = status && validStatuses.includes(status as typeof validStatuses[number])
      ? agentManager.listAgents(status as typeof validStatuses[number])
      : agentManager.listAgents();
    return c.json({ agents });
  });

  /** GET /:id — 获取单个 Agent */
  app.get('/:id', (c) => {
    const id = c.req.param('id');
    const agent = agentManager.getAgent(id);
    if (!agent) {
      return c.json({ error: 'Agent 不存在' }, 404);
    }
    return c.json({ agent });
  });

  /** POST / — 创建 Agent（简单模式，非引导式） */
  app.post('/', async (c) => {
    const body = await c.req.json<{ name?: string; emoji?: string; modelId?: string; provider?: string }>().catch(() => ({}));

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

    const body = await c.req.json<{ name?: string; emoji?: string; modelId?: string; provider?: string }>().catch(() => ({}));
    agentManager.updateAgent(id, body);

    const updated = agentManager.getAgent(id);
    return c.json({ agent: updated });
  });

  /** GET /:id/workspace — 列出工作区所有文件 */
  app.get('/:id/workspace', (c) => {
    const id = c.req.param('id');
    const agent = agentManager.getAgent(id);
    if (!agent) return c.json({ error: 'Agent 不存在' }, 404);

    const files: Record<string, string> = {};
    const fileNames = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'HEARTBEAT.md', 'USER.md', 'MEMORY.md', 'BOOTSTRAP.md'];
    for (const name of fileNames) {
      const content = agentManager.readWorkspaceFile(id, name);
      if (content !== undefined) files[name] = content;
    }
    return c.json({ files });
  });

  /** PUT /:id/workspace/:file — 更新工作区文件 */
  app.put('/:id/workspace/:file', async (c) => {
    const id = c.req.param('id');
    const file = c.req.param('file');
    const agent = agentManager.getAgent(id);
    if (!agent) return c.json({ error: 'Agent 不存在' }, 404);

    const allowedFiles = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'HEARTBEAT.md', 'BOOTSTRAP.md'];
    if (!allowedFiles.includes(file)) {
      return c.json({ error: '该文件不允许手动编辑' }, 400);
    }

    const body = await c.req.json<{ content: string }>().catch(() => ({ content: '' }));
    agentManager.writeWorkspaceFile(id, file, body.content);
    return c.json({ success: true });
  });

  /** DELETE /:id — 删除 Agent */
  app.delete('/:id', (c) => {
    const id = c.req.param('id');
    const existing = agentManager.getAgent(id);
    if (!existing) {
      return c.json({ error: 'Agent 不存在' }, 404);
    }

    agentManager.deleteAgent(id);
    return c.json({ deleted: true });
  });

  // --- 引导式创建 ---
  const builder = new AgentBuilder(agentManager, llmGenerate);
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

  return app;
}
