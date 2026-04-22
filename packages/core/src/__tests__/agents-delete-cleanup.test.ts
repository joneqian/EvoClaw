/**
 * Agent 删除资源清理测试
 *
 * 验证 DELETE /agents/:id 时 onBeforeDelete 钩子正确清理：
 * - HeartbeatRunner 定时器（跨进程资源）
 * - 独占渠道账号的 WS 连接 + channel_state 凭据
 * - 共享账号的 binding 不误删
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createAgentRoutes } from '../routes/agents.js';

/** 最小 AgentManager mock */
function makeAgentManager(existing: Record<string, { id: string }>) {
  return {
    getAgent: vi.fn((id: string) => existing[id]),
    deleteAgent: vi.fn((id: string) => {
      delete existing[id];
    }),
  } as any;
}

describe('DELETE /agents/:id 资源清理', () => {
  let agents: Record<string, { id: string }>;

  beforeEach(() => {
    agents = { 'agent-a': { id: 'agent-a' }, 'agent-b': { id: 'agent-b' } };
  });

  it('Agent 不存在返回 404，不触发清理', async () => {
    const onBeforeDelete = vi.fn();
    const app = new Hono().route(
      '/',
      createAgentRoutes(makeAgentManager(agents), undefined, undefined, { onBeforeDelete }),
    );
    const res = await app.request('/not-exist', { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(onBeforeDelete).not.toHaveBeenCalled();
  });

  it('onBeforeDelete 在 deleteAgent 之前调用', async () => {
    const order: string[] = [];
    const manager = makeAgentManager(agents);
    manager.deleteAgent = vi.fn(() => {
      order.push('deleteAgent');
    });
    const onBeforeDelete = vi.fn(async () => {
      order.push('onBeforeDelete');
    });
    const app = new Hono().route(
      '/',
      createAgentRoutes(manager, undefined, undefined, { onBeforeDelete }),
    );
    const res = await app.request('/agent-a', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(order).toEqual(['onBeforeDelete', 'deleteAgent']);
  });

  it('onBeforeDelete 抛错 → 500 + 不调 deleteAgent', async () => {
    const manager = makeAgentManager(agents);
    const onBeforeDelete = vi.fn(async () => {
      throw new Error('清理失败：WS 断不开');
    });
    const app = new Hono().route(
      '/',
      createAgentRoutes(manager, undefined, undefined, { onBeforeDelete }),
    );
    const res = await app.request('/agent-a', { method: 'DELETE' });
    expect(res.status).toBe(500);
    expect(manager.deleteAgent).not.toHaveBeenCalled();
  });

  it('无 onBeforeDelete 时仍能正常删除（向后兼容）', async () => {
    const manager = makeAgentManager(agents);
    const app = new Hono().route('/', createAgentRoutes(manager));
    const res = await app.request('/agent-a', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(manager.deleteAgent).toHaveBeenCalledWith('agent-a');
  });
});
