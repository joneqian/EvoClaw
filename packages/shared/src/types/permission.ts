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

/**
 * 权限模式 — 运行时安全级别
 *
 * default:    标准确认模式（ask→提示用户）
 * strict:     严格模式（ask→自动 deny，适合生产环境/无人值守）
 * permissive: 宽松模式（工作区内 file_write/shell 自动放行，工作区外保持 ask）
 */
export type PermissionMode = 'default' | 'strict' | 'permissive';

/** 权限模式元信息（供 UI 展示） */
export const PERMISSION_MODE_META: Record<PermissionMode, { label: string; description: string }> = {
  default: {
    label: '标准模式',
    description: '工具执行前需要用户确认授权，提供安全与效率的平衡',
  },
  strict: {
    label: '严格模式',
    description: '未明确授权的操作自动拒绝，适合生产环境和无人值守场景',
  },
  permissive: {
    label: '宽松模式',
    description: '工作区内的文件修改和命令执行自动放行，适合开发测试',
  },
};

/**
 * 权限决策原因 — 结构化追踪（供审计和调试）
 *
 * 参考 Claude Code PermissionDecisionReason 联合类型
 */
export type PermissionDecisionReason =
  | { type: 'auto_allow'; tool: string }
  | { type: 'workspace_safe_zone'; path: string }
  | { type: 'safe_bin'; command: string }
  | { type: 'mode'; mode: PermissionMode; action: 'deny' | 'allow' }
  | { type: 'rule'; scope: PermissionScope; resource: string }
  | { type: 'dangerous_command'; pattern: string }
  | { type: 'dangerous_path'; path: string }
  | { type: 'restricted_path'; path: string }
  | { type: 'misparsing'; detail: string }
  | { type: 'unicode_confusion'; issues: string[] }
  | { type: 'message_tool'; tool: string }
  | { type: 'preapproved_domain'; url: string }
  | { type: 'denial_limit'; count: number; limit: number }
  | { type: 'other'; reason: string };

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
