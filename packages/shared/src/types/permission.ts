/** 权限类别 — 7 类 */
export type PermissionCategory =
  | 'file_read'
  | 'file_write'
  | 'network'
  | 'shell'
  | 'browser'
  | 'mcp'
  | 'skill';

/** 权限作用域 */
export type PermissionScope = 'once' | 'session' | 'always' | 'deny';

/** 权限授予记录 */
export interface PermissionGrant {
  id: string;
  agentId: string;
  category: PermissionCategory;
  scope: PermissionScope;
  resource: string;
  grantedAt: string;
  expiresAt: string | null;
  grantedBy: 'user' | 'system';
}
