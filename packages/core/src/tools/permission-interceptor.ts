import type { SecurityExtension, PermissionResult } from '../bridge/security-extension.js';
import type { PermissionCategory } from '@evoclaw/shared';

/** 危险命令模式 */
const DANGEROUS_PATTERNS = [
  /rm\s+(-rf?|--recursive)\s+/i,
  /rmdir\s+/i,
  /DROP\s+(TABLE|DATABASE|INDEX)/i,
  /DELETE\s+FROM\s+\w+\s*(;|$)/i,  // DELETE without WHERE
  /TRUNCATE\s+TABLE/i,
  /format\s+[a-z]:/i,
  /mkfs\./i,
  /dd\s+if=/i,
  />\s*\/dev\//i,
  /chmod\s+777/i,
  /sudo\s+/i,
];

/** 消息发送类工具（需要强制确认） */
const MESSAGE_TOOLS = new Set([
  'send_message', 'send_email', 'post_tweet', 'send_notification',
  'slack_send', 'telegram_send', 'wechat_send',
]);

/** 工具名称 → 权限类别映射 */
const TOOL_CATEGORY_MAP: Record<string, PermissionCategory> = {
  read: 'file_read',
  write: 'file_write',
  edit: 'file_write',
  bash: 'shell',
  shell: 'shell',
  browse: 'browser',
  fetch: 'network',
  http: 'network',
};

/** 拦截结果 */
export interface InterceptResult {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
  permissionCategory?: PermissionCategory;
}

/**
 * 工具权限拦截器
 * 检查工具执行的安全性和权限
 */
export class PermissionInterceptor {
  constructor(private security: SecurityExtension) {}

  /**
   * 拦截工具调用
   * @returns InterceptResult — 是否允许执行及原因
   */
  intercept(agentId: string, toolName: string, params: Record<string, unknown>): InterceptResult {
    // 1. 确定权限类别
    const category = this.resolveCategory(toolName);

    // 2. 检查危险命令
    if (toolName === 'bash' || toolName === 'shell') {
      const command = (params['command'] as string) ?? '';
      if (this.isDangerousCommand(command)) {
        return {
          allowed: false,
          reason: `检测到危险命令: ${command.slice(0, 100)}`,
          requiresConfirmation: true,
          permissionCategory: 'shell',
        };
      }
    }

    // 3. 消息发送类工具强制确认
    if (MESSAGE_TOOLS.has(toolName)) {
      const result = this.security.checkPermission(agentId, 'network', toolName);
      if (result === 'ask') {
        return {
          allowed: false,
          reason: `消息发送工具 "${toolName}" 需要用户确认`,
          requiresConfirmation: true,
          permissionCategory: 'network',
        };
      }
      return { allowed: result === 'allow' };
    }

    // 4. 文件系统路径检查
    if (category === 'file_read' || category === 'file_write') {
      const filePath = (params['path'] as string) ?? (params['file_path'] as string) ?? '';
      if (this.isRestrictedPath(filePath)) {
        return {
          allowed: false,
          reason: `访问受限路径: ${filePath}`,
          requiresConfirmation: true,
          permissionCategory: category,
        };
      }
    }

    // 5. 常规权限检查
    const result = this.security.checkPermission(agentId, category);
    if (result === 'deny') {
      return { allowed: false, reason: `Agent 没有 ${category} 权限` };
    }
    if (result === 'ask') {
      return {
        allowed: false,
        requiresConfirmation: true,
        permissionCategory: category,
      };
    }

    return { allowed: true };
  }

  /** 检测危险命令 */
  isDangerousCommand(command: string): boolean {
    return DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
  }

  /** 检测受限路径 */
  isRestrictedPath(filePath: string): boolean {
    const restricted = ['/etc/', '/usr/', '/bin/', '/sbin/', '/System/', '/Library/', '~/.ssh/', '~/.gnupg/'];
    return restricted.some(r => filePath.startsWith(r) || filePath.includes(r));
  }

  /** 工具名 → 权限类别 */
  private resolveCategory(toolName: string): PermissionCategory {
    return TOOL_CATEGORY_MAP[toolName] ?? 'skill';
  }
}
