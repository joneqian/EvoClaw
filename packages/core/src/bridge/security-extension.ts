import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { PermissionCategory, PermissionScope } from '@evoclaw/shared';

/** 权限检查结果 */
export type PermissionResult = 'allow' | 'deny' | 'ask';

/** 权限授予记录 */
export interface PermissionRecord {
  id: string;
  agentId: string;
  category: PermissionCategory;
  scope: PermissionScope;
  resource: string;
  grantedAt: string;
  expiresAt: string | null;
  grantedBy: 'user' | 'system';
}

/**
 * 安全扩展 — 权限拦截与管理
 * 使用内存缓存加速频繁的权限检查
 */
export class SecurityExtension {
  /** 权限缓存: Map<agentId, Map<category:resource, PermissionRecord>> */
  private cache = new Map<string, Map<string, PermissionRecord>>();

  constructor(private db: SqliteStore) {
    this.loadCache();
  }

  /** 从数据库加载 always/deny/session 类型的权限到缓存 */
  private loadCache(): void {
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT * FROM permissions WHERE scope IN ('always', 'deny', 'session')`,
    );
    for (const row of rows) {
      const record = rowToRecord(row);
      this.setCacheEntry(record);
    }
  }

  private setCacheEntry(record: PermissionRecord): void {
    const key = `${record.category}:${record.resource}`;
    if (!this.cache.has(record.agentId)) {
      this.cache.set(record.agentId, new Map());
    }
    this.cache.get(record.agentId)!.set(key, record);
  }

  /**
   * 检查权限
   * 1. 查缓存中的 always/deny
   * 2. 查 session 级权限（DB）
   * 3. 返回 'ask' 让前端弹窗
   */
  checkPermission(agentId: string, category: PermissionCategory, resource: string = '*'): PermissionResult {
    // 检查缓存（always / deny）
    const agentCache = this.cache.get(agentId);
    if (agentCache) {
      // 精确匹配
      const exact = agentCache.get(`${category}:${resource}`);
      if (exact) {
        if (exact.expiresAt && new Date(exact.expiresAt) < new Date()) {
          this.revokePermission(exact.id);
        } else {
          return exact.scope === 'deny' ? 'deny' : 'allow';
        }
      }
      // 通配符匹配
      const wildcard = agentCache.get(`${category}:*`);
      if (wildcard) {
        if (wildcard.expiresAt && new Date(wildcard.expiresAt) < new Date()) {
          this.revokePermission(wildcard.id);
        } else {
          return wildcard.scope === 'deny' ? 'deny' : 'allow';
        }
      }
      // 类别级匹配：该类别下有任何 always 权限即放行（简化权限模型）
      for (const [key, record] of agentCache) {
        if (key.startsWith(`${category}:`) && record.scope === 'always') {
          if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
            this.revokePermission(record.id);
            continue;
          }
          return 'allow';
        }
      }
    }

    // 检查 session 级权限（缓存优先，降低 DB 查询）
    if (agentCache) {
      for (const [key, record] of agentCache) {
        if (key.startsWith(`${category}:`) && record.scope === 'session') {
          if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
            this.revokePermission(record.id);
            continue;
          }
          return 'allow';
        }
      }
    }
    // Fallback: 查 DB（缓存中可能没有——极端情况如进程重启后未加载）
    const session = this.db.get<Record<string, unknown>>(
      `SELECT * FROM permissions WHERE agent_id = ? AND category = ? AND (resource = ? OR resource = '*') AND scope = 'session' ORDER BY granted_at DESC LIMIT 1`,
      agentId, category, resource,
    );
    if (session) {
      // 写入缓存供后续快速查找
      this.setCacheEntry(rowToRecord(session));
      return 'allow';
    }

    // 检查 once 级权限
    const once = this.db.get<Record<string, unknown>>(
      `SELECT * FROM permissions WHERE agent_id = ? AND category = ? AND (resource = ? OR resource = '*') AND scope = 'once' ORDER BY granted_at DESC LIMIT 1`,
      agentId, category, resource,
    );
    if (once) {
      // 使用后删除
      this.db.run('DELETE FROM permissions WHERE id = ?', once['id']);
      return 'allow';
    }

    return 'ask';
  }

  /** 授予权限 */
  grantPermission(agentId: string, category: PermissionCategory, scope: PermissionScope, resource: string = '*', expiresAt?: string): string {
    const id = crypto.randomUUID();
    this.db.run(
      `INSERT INTO permissions (id, agent_id, category, scope, resource, granted_at, expires_at, granted_by)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?, 'user')`,
      id, agentId, category, scope, resource, expiresAt ?? null,
    );

    // 非 once 权限加入缓存（always/deny/session）
    if (scope !== 'once') {
      this.setCacheEntry({
        id, agentId, category, scope, resource,
        grantedAt: new Date().toISOString(),
        expiresAt: expiresAt ?? null,
        grantedBy: 'user',
      });
    }

    // 记录审计日志
    this.db.run(
      'INSERT INTO audit_log (agent_id, action, details) VALUES (?, ?, ?)',
      agentId, 'permission_grant',
      JSON.stringify({ category, scope, resource }),
    );

    return id;
  }

  /** 撤销权限 */
  revokePermission(id: string): void {
    // 先获取记录用于清除缓存
    const row = this.db.get<Record<string, unknown>>('SELECT * FROM permissions WHERE id = ?', id);
    if (!row) return;

    this.db.run('DELETE FROM permissions WHERE id = ?', id);

    // 清除缓存
    const record = rowToRecord(row);
    const agentCache = this.cache.get(record.agentId);
    if (agentCache) {
      agentCache.delete(`${record.category}:${record.resource}`);
    }
  }

  /** 列出 Agent 的所有权限 */
  listPermissions(agentId: string): PermissionRecord[] {
    const rows = this.db.all<Record<string, unknown>>(
      'SELECT * FROM permissions WHERE agent_id = ? ORDER BY granted_at DESC',
      agentId,
    );
    return rows.map(rowToRecord);
  }

  /** 清除缓存（用于测试） */
  clearCache(): void {
    this.cache.clear();
  }
}

/** 数据库行 → PermissionRecord */
function rowToRecord(row: Record<string, unknown>): PermissionRecord {
  return {
    id: row['id'] as string,
    agentId: row['agent_id'] as string,
    category: row['category'] as PermissionCategory,
    scope: row['scope'] as PermissionScope,
    resource: row['resource'] as string,
    grantedAt: row['granted_at'] as string,
    expiresAt: (row['expires_at'] as string) ?? null,
    grantedBy: row['granted_by'] as 'user' | 'system',
  };
}
