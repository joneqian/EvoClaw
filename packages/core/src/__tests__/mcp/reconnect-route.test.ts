/**
 * M4.1 T2 后端测试：POST /api/mcp/servers/:name/reconnect
 *
 * 只测路由逻辑（mock McpManager.reconnect），不启真实 stdio server。
 */

import { describe, it, expect, vi } from 'vitest';
import { createMcpRoutes } from '../../routes/mcp.js';
import type { McpManager } from '../../mcp/mcp-client.js';

function createMockManager(overrides: Partial<McpManager> = {}): McpManager {
  return {
    getStates: vi.fn().mockReturnValue([
      { name: 'srv1', status: 'running', toolCount: 3 },
    ]),
    getAllTools: vi.fn().mockReturnValue([]),
    getAllPrompts: vi.fn().mockReturnValue([]),
    addServer: vi.fn(),
    removeServer: vi.fn(),
    reconnect: vi.fn(),
    ...overrides,
  } as unknown as McpManager;
}

describe('POST /api/mcp/servers/:name/reconnect', () => {
  it('server 存在且重连成功 → 200 + success=true + state', async () => {
    const manager = createMockManager({
      reconnect: vi.fn().mockResolvedValue(true),
      getStates: vi.fn().mockReturnValue([
        { name: 'srv1', status: 'running', toolCount: 5 },
      ]),
    });
    const app = createMcpRoutes(manager);
    const res = await app.request('/servers/srv1/reconnect', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; state: { name: string; status: string } };
    expect(body.success).toBe(true);
    expect(body.state.name).toBe('srv1');
    expect(body.state.status).toBe('running');
    expect(manager.reconnect).toHaveBeenCalledWith('srv1');
  });

  it('server 不存在 → 404', async () => {
    const manager = createMockManager({
      reconnect: vi.fn().mockResolvedValue(null),
    });
    const app = createMcpRoutes(manager);
    const res = await app.request('/servers/nonexistent/reconnect', { method: 'POST' });

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/不存在|已被移除/);
  });

  it('重连 5 次全失败 → 200 + success=false + state status=error', async () => {
    const manager = createMockManager({
      reconnect: vi.fn().mockResolvedValue(false),
      getStates: vi.fn().mockReturnValue([
        { name: 'flaky', status: 'error', toolCount: 0, error: '连接超时' },
      ]),
    });
    const app = createMcpRoutes(manager);
    const res = await app.request('/servers/flaky/reconnect', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; state: { status: string; error?: string } };
    expect(body.success).toBe(false);
    expect(body.state.status).toBe('error');
  });
});

describe('GET /api/mcp/prompts', () => {
  it('返回所有 MCP 服务器的 prompts', async () => {
    const manager = createMockManager({
      getAllPrompts: vi.fn().mockReturnValue([
        { name: 'summarize', description: '总结', serverName: 'docs' },
      ]),
    });
    const app = createMcpRoutes(manager);
    const res = await app.request('/prompts');

    expect(res.status).toBe(200);
    const body = await res.json() as { prompts: Array<{ name: string; serverName: string }> };
    expect(body.prompts).toHaveLength(1);
    expect(body.prompts[0].name).toBe('summarize');
    expect(body.prompts[0].serverName).toBe('docs');
  });
});
