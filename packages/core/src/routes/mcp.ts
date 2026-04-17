/**
 * MCP 管理 API — 服务器 CRUD + 状态查询 + 手动重连
 */

import { Hono } from 'hono';
import type { McpManager } from '../mcp/mcp-client.js';
import type { McpServerConfig } from '../mcp/mcp-config.js';

export function createMcpRoutes(mcpManager: McpManager): Hono {
  const app = new Hono();

  /** GET / — 所有 MCP 服务器状态 */
  app.get('/', (c) => {
    return c.json({ servers: mcpManager.getStates() });
  });

  /** GET /tools — 所有已发现的 MCP 工具 */
  app.get('/tools', (c) => {
    return c.json({ tools: mcpManager.getAllTools() });
  });

  /** GET /prompts — 所有已发现的 MCP prompts（M4 桥接后暴露） */
  app.get('/prompts', (c) => {
    return c.json({ prompts: mcpManager.getAllPrompts() });
  });

  /** POST /servers — 添加 MCP 服务器 */
  app.post('/servers', async (c) => {
    const config = await c.req.json<McpServerConfig>();
    if (!config.name || !config.type) {
      return c.json({ error: '缺少 name 或 type 字段' }, 400);
    }
    await mcpManager.addServer(config);
    return c.json({ success: true, name: config.name });
  });

  /** DELETE /servers/:name — 移除 MCP 服务器 */
  app.delete('/servers/:name', async (c) => {
    const name = c.req.param('name');
    await mcpManager.removeServer(name);
    return c.json({ success: true });
  });

  /**
   * POST /servers/:name/reconnect — 手动重连 MCP 服务器
   *
   * 复用 M4 的 startWithReconnect 指数退避（1s→2s→4s→8s→16s，最多 5 次）。
   * 返回时 client 可能仍在重试中；前端通过轮询 GET / 感知最终状态。
   */
  app.post('/servers/:name/reconnect', async (c) => {
    const name = c.req.param('name');
    const result = await mcpManager.reconnect(name);
    if (result === null) {
      return c.json({ error: `server "${name}" 不存在或已被移除` }, 404);
    }
    const state = mcpManager.getStates().find(s => s.name === name);
    return c.json({ success: result, state });
  });

  return app;
}
