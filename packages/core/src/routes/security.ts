/**
 * 安全管理路由 — 权限和审计日志 API
 */
import { Hono } from 'hono';
import { SecurityExtension } from '../bridge/security-extension.js';
import { ToolAuditor } from '../bridge/tool-injector.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { PermissionCategory, PermissionScope } from '@evoclaw/shared';

export function createSecurityRoutes(db: SqliteStore): Hono {
  const app = new Hono();
  const security = new SecurityExtension(db);
  const auditor = new ToolAuditor(db);

  // GET /agents/:id/permissions — 列出权限
  app.get('/:id/permissions', (c) => {
    const agentId = c.req.param('id');
    const permissions = security.listPermissions(agentId);
    return c.json({ permissions });
  });

  // POST /agents/:id/permissions — 授予权限
  app.post('/:id/permissions', async (c) => {
    const agentId = c.req.param('id');
    const body = await c.req.json<{
      category: PermissionCategory;
      scope: PermissionScope;
      resource?: string;
    }>();
    const id = security.grantPermission(agentId, body.category, body.scope, body.resource);
    return c.json({ id });
  });

  // DELETE /agents/:id/permissions/:permId — 撤销权限
  app.delete('/:id/permissions/:permId', (c) => {
    const permId = c.req.param('permId');
    security.revokePermission(permId);
    return c.json({ success: true });
  });

  // GET /agents/:id/audit-log — 审计日志
  app.get('/:id/audit-log', (c) => {
    const agentId = c.req.param('id');
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const entries = auditor.listByAgent(agentId, limit);
    return c.json({ entries });
  });

  return app;
}
