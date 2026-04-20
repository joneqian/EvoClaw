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
  /** session 作用域的会话键；always/deny/once 为 null */
  sessionKey: string | null;
}

/**
 * 安全扩展 — 权限拦截与管理
 * 使用内存缓存加速频繁的权限检查
 *
 * M8 会话隔离：
 * - always/deny 权限：agent 级缓存，跨 session 复用
 * - session 权限：按 (agentId, sessionKey) 分片存储，session 间隔离
 */
export class SecurityExtension {
  /** Agent 级权限缓存（always/deny）: Map<agentId, Map<category:resource, PermissionRecord>> */
  private cache = new Map<string, Map<string, PermissionRecord>>();

  /** Session 级权限缓存: Map<sessionKey, Map<agentId, Map<category:resource, PermissionRecord>>> */
  private sessionCache = new Map<string, Map<string, Map<string, PermissionRecord>>>();

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
    if (record.scope === 'session' && record.sessionKey) {
      let perSession = this.sessionCache.get(record.sessionKey);
      if (!perSession) {
        perSession = new Map();
        this.sessionCache.set(record.sessionKey, perSession);
      }
      let perAgent = perSession.get(record.agentId);
      if (!perAgent) {
        perAgent = new Map();
        perSession.set(record.agentId, perAgent);
      }
      perAgent.set(key, record);
      return;
    }
    if (!this.cache.has(record.agentId)) {
      this.cache.set(record.agentId, new Map());
    }
    this.cache.get(record.agentId)!.set(key, record);
  }

  /**
   * 检查权限
   * 1. 查 agent 级缓存（always/deny）
   * 2. 查 session 级缓存（按 sessionKey 隔离）
   * 3. DB fallback
   * 4. once 消费
   * 5. 返回 'ask' 让前端弹窗
   */
  checkPermission(
    agentId: string,
    category: PermissionCategory,
    resource: string = '*',
    sessionKey?: string,
  ): PermissionResult {
    // 1. 检查 agent 级缓存（always / deny）— 跨 session 共享
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
      // 模式匹配
      for (const [key, record] of agentCache) {
        if (!key.startsWith(`${category}:`)) continue;
        if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
          this.revokePermission(record.id);
          continue;
        }
        const ruleResource = key.slice(category.length + 1);
        if (matchResourcePattern(ruleResource, resource)) {
          return record.scope === 'deny' ? 'deny' : 'allow';
        }
      }
    }

    // 2. 检查 session 级缓存（按 sessionKey 隔离）
    if (sessionKey) {
      const sessionAgentCache = this.sessionCache.get(sessionKey)?.get(agentId);
      if (sessionAgentCache) {
        for (const [key, record] of sessionAgentCache) {
          if (!key.startsWith(`${category}:`)) continue;
          if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
            this.revokePermission(record.id);
            continue;
          }
          const ruleResource = key.slice(category.length + 1);
          if (matchResourcePattern(ruleResource, resource)) {
            return 'allow';
          }
        }
      }

      // 3. DB fallback（仅在 session 模式下查询 scope='session'）
      const session = this.db.get<Record<string, unknown>>(
        `SELECT * FROM permissions
         WHERE agent_id = ? AND session_key = ? AND category = ?
           AND (resource = ? OR resource = '*') AND scope = 'session'
         ORDER BY granted_at DESC LIMIT 1`,
        agentId, sessionKey, category, resource,
      );
      if (session) {
        this.setCacheEntry(rowToRecord(session));
        return 'allow';
      }
    }

    // 4. 检查 once 级权限（不区分 session）
    const once = this.db.get<Record<string, unknown>>(
      `SELECT * FROM permissions WHERE agent_id = ? AND category = ? AND (resource = ? OR resource = '*') AND scope = 'once' ORDER BY granted_at DESC LIMIT 1`,
      agentId, category, resource,
    );
    if (once) {
      this.db.run('DELETE FROM permissions WHERE id = ?', once['id']);
      return 'allow';
    }

    return 'ask';
  }

  /**
   * 授予权限
   *
   * @param sessionKey 当 scope='session' 时必填，用于会话隔离
   */
  grantPermission(
    agentId: string,
    category: PermissionCategory,
    scope: PermissionScope,
    resource: string = '*',
    expiresAt?: string,
    sessionKey?: string,
  ): string {
    if (scope === 'session' && !sessionKey) {
      throw new Error(`grantPermission: scope='session' 需要提供 sessionKey`);
    }
    const id = crypto.randomUUID();
    const effectiveSessionKey = scope === 'session' ? sessionKey! : null;
    this.db.run(
      `INSERT INTO permissions (id, agent_id, category, scope, resource, granted_at, expires_at, granted_by, session_key)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?, 'user', ?)`,
      id, agentId, category, scope, resource, expiresAt ?? null, effectiveSessionKey,
    );

    // 非 once 权限加入缓存（always/deny/session）
    if (scope !== 'once') {
      this.setCacheEntry({
        id, agentId, category, scope, resource,
        grantedAt: new Date().toISOString(),
        expiresAt: expiresAt ?? null,
        grantedBy: 'user',
        sessionKey: effectiveSessionKey,
      });
    }

    // 记录审计日志（含 session_key）
    this.db.run(
      'INSERT INTO audit_log (agent_id, action, details, session_key) VALUES (?, ?, ?, ?)',
      agentId, 'permission_grant',
      JSON.stringify({ category, scope, resource }),
      effectiveSessionKey,
    );

    return id;
  }

  /** 撤销权限 */
  revokePermission(id: string): void {
    const row = this.db.get<Record<string, unknown>>('SELECT * FROM permissions WHERE id = ?', id);
    if (!row) return;

    this.db.run('DELETE FROM permissions WHERE id = ?', id);

    const record = rowToRecord(row);
    if (record.scope === 'session' && record.sessionKey) {
      this.sessionCache.get(record.sessionKey)?.get(record.agentId)
        ?.delete(`${record.category}:${record.resource}`);
    } else {
      this.cache.get(record.agentId)?.delete(`${record.category}:${record.resource}`);
    }
  }

  /**
   * 清除指定 session 的所有 scope='session' 权限
   *
   * 语义说明（M8）：
   * - Session 权限的 TTL 绑定 sessionKey 物理会话（如 `agent:X:wechat:dm:user1`），
   *   一条 sessionKey 在多个 chat 请求间保持稳定 → 跨请求复用授权是预期行为。
   * - 本函数不会在 chat 请求结束时自动调用。需要显式触发的场景：
   *     * Channel 解绑 / 退出登录（Agent 在该 channel 的 sessionKey 失效）
   *     * Agent 删除（DB 已通过 ON DELETE CASCADE 处理，此处清内存缓存）
   *     * IT 管理员通过 API 强制回收
   * - 进程重启会丢失所有 session 缓存（DB 仍保留），首次使用触发 DB fallback 重建。
   */
  clearSessionPermissions(sessionKey: string): void {
    this.db.run(`DELETE FROM permissions WHERE session_key = ? AND scope = 'session'`, sessionKey);
    this.sessionCache.delete(sessionKey);
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
    this.sessionCache.clear();
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
    sessionKey: (row['session_key'] as string) ?? null,
  };
}

/**
 * 资源模式匹配（参考 Claude Code 规则语法）
 *
 * 支持:
 * - 精确匹配: "git push" === "git push"
 * - 通配符: "*" 匹配任何资源
 * - 前缀+冒号: "git:*" 匹配 "git status", "git push" 等
 * - 路径通配: "/src/**" 匹配 /src 下所有文件
 * - 空格通配: "npm *" 匹配 "npm install", "npm test" 等
 */
function matchResourcePattern(pattern: string, resource: string): boolean {
  if (pattern === '*') return true;
  if (pattern === resource) return true;

  // 前缀+冒号通配: "git:*" → 匹配 "git status", "git push --force"
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2);
    return resource.startsWith(prefix + ' ') || resource === prefix;
  }

  // 空格通配: "npm *" → 匹配 "npm install"
  if (pattern.endsWith(' *')) {
    const prefix = pattern.slice(0, -2);
    return resource.startsWith(prefix + ' ') || resource === prefix;
  }

  // 路径通配: "/src/**" → 匹配 "/src/foo/bar.ts"
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return resource.startsWith(prefix + '/') || resource === prefix;
  }

  // 简单通配符: "python*" → 匹配 "python3"
  if (pattern.endsWith('*')) {
    return resource.startsWith(pattern.slice(0, -1));
  }

  return false;
}
