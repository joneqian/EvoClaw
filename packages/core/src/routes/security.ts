/**
 * 安全管理路由 — 权限和审计日志 API
 */
import { Hono } from 'hono';
import { SecurityExtension } from '../bridge/security-extension.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { PermissionCategory, PermissionScope } from '@evoclaw/shared';

export function createSecurityRoutes(db: SqliteStore): Hono {
  const app = new Hono();
  const security = new SecurityExtension(db);

  // GET /:id/permissions — 列出权限
  app.get('/:id/permissions', (c) => {
    const agentId = c.req.param('id');
    const permissions = security.listPermissions(agentId);
    return c.json({ permissions });
  });

  // POST /:id/permissions — 授予权限
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

  // DELETE /:id/permissions/:permId — 撤销权限
  app.delete('/:id/permissions/:permId', (c) => {
    const permId = c.req.param('permId');
    security.revokePermission(permId);
    return c.json({ success: true });
  });

  // GET /:id/permission-stats — 按 category/scope 聚合统计
  app.get('/:id/permission-stats', (c) => {
    const agentId = c.req.param('id');
    const permissions = security.listPermissions(agentId);

    // 按 category 聚合
    const byCategory: Record<string, number> = {};
    const byScope: Record<string, number> = {};
    for (const p of permissions) {
      byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
      byScope[p.scope] = (byScope[p.scope] ?? 0) + 1;
    }

    return c.json({
      total: permissions.length,
      byCategory,
      byScope,
    });
  });

  // POST /:id/permissions/bulk-revoke — 批量撤销
  app.post('/:id/permissions/bulk-revoke', async (c) => {
    const agentId = c.req.param('id');
    const body = await c.req.json<{
      scope?: PermissionScope;   // 按 scope 批量撤销
      ids?: string[];            // 按 id 列表撤销
    }>();

    let revokedCount = 0;

    if (body.ids && body.ids.length > 0) {
      // 按 id 列表撤销
      for (const id of body.ids) {
        security.revokePermission(id);
        revokedCount++;
      }
    } else if (body.scope) {
      // 按 scope 撤销
      const permissions = security.listPermissions(agentId);
      for (const p of permissions) {
        if (p.scope === body.scope) {
          security.revokePermission(p.id);
          revokedCount++;
        }
      }
    } else {
      return c.json({ error: '需要提供 scope 或 ids 参数' }, 400);
    }

    return c.json({ revokedCount });
  });

  // GET /:id/audit-log — 审计日志（增强版：支持过滤）
  app.get('/:id/audit-log', (c) => {
    const agentId = c.req.param('id');
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);
    const toolName = c.req.query('toolName');
    const status = c.req.query('status');
    const from = c.req.query('from');
    const to = c.req.query('to');

    // 构建动态查询
    const conditions: string[] = ['agent_id = ?'];
    const params: unknown[] = [agentId];

    if (toolName) {
      conditions.push('tool_name = ?');
      params.push(toolName);
    }
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (from) {
      conditions.push('created_at >= ?');
      params.push(from);
    }
    if (to) {
      conditions.push('created_at <= ?');
      params.push(to);
    }

    const whereClause = conditions.join(' AND ');

    // 获取总数
    const countRow = db.get<{ total: number }>(
      `SELECT COUNT(*) as total FROM tool_audit_log WHERE ${whereClause}`,
      ...params,
    );
    const total = countRow?.total ?? 0;

    // 获取数据
    const entries = db.all<{
      id: string;
      agentId: string;
      toolName: string;
      status: string;
      durationMs: number;
      createdAt: string;
    }>(
      `SELECT id, agent_id AS agentId, tool_name AS toolName, status,
              duration_ms AS durationMs, created_at AS createdAt
       FROM tool_audit_log
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    );

    return c.json({ entries, total });
  });

  return app;
}
