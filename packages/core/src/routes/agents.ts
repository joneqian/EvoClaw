import { Hono } from 'hono';
import crypto from 'node:crypto';
import { AgentManager } from '../agent/agent-manager.js';
import { AgentBuilder, type BuilderState } from '../agent/agent-builder.js';

/** 创建 Agent CRUD 路由 */
export function createAgentRoutes(agentManager: AgentManager) {
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
  const builder = new AgentBuilder(agentManager);
  const builderSessions = new Map<string, BuilderState>();

  /** POST /create-guided — 启动或推进引导式创建 */
  app.post('/create-guided', async (c) => {
    const { sessionId, message } = await c.req.json<{ sessionId?: string; message?: string }>();

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

    const response = await builder.advance(state, message || '');

    if (response.done) {
      builderSessions.delete(sid);
    }

    return c.json({ sessionId: sid, response });
  });

  return app;
}
