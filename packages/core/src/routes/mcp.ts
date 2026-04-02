/**
 * MCP 管理 API — 服务器 CRUD + 状态查询
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

  return app;
}
