import type { SecurityExtension, PermissionResult } from '../bridge/security-extension.js';
import type { PermissionCategory } from '@evoclaw/shared';
import { detectUnicodeConfusion } from '../security/unicode-detector.js';

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
  // Sprint 12: 编码攻击 + 链式注入
  /echo\s+.*\|\s*base64\s+-d\s*\|\s*(?:sh|bash)/i,          // Base64 解码执行
  /[;&|]\s*(?:rm\s+-rf|mkfs|dd\s+if=)/i,                     // 管道/链式注入
  /export\s+(?:PATH|LD_PRELOAD|DYLD_\w+)\s*=/i,              // 环境变量篡改
  /(?:curl|wget)\s+.*\|\s*(?:sh|bash|python)/i,              // 远程代码执行
  /(?:python|node|ruby)\s+-[ce]\s/i,                          // 解释器 eval
  /(?:rm\s+-rf|mkfs|dd\s+if=|chmod\s+777).*&\s*$/i,          // 后台执行危险命令
  /[><]\(.*(?:rm\s+-rf|mkfs|dd\s+if=)/i,                     // 进程替换
  /crontab\s+-[re]/i,                                         // 定时任务篡改
];

/** 消息发送类工具（需要强制确认） */
const MESSAGE_TOOLS = new Set([
  'send_message', 'send_email', 'post_tweet', 'send_notification',
  'slack_send', 'telegram_send', 'wechat_send',
]);

/** 自动放行的只读工具 — 不需要权限确认 */
const AUTO_ALLOW_TOOLS = new Set([
  'read', 'ls', 'find', 'grep',       // 文件只读
  'image', 'pdf',                       // 多媒体只读
  'spawn_agent', 'list_agents', 'kill_agent', 'steer_agent', 'yield_agents',  // Agent 管理
]);

/** 工具名称 → 权限类别映射（仅需拦截的工具） */
const TOOL_CATEGORY_MAP: Record<string, PermissionCategory> = {
  // 文件修改
  write: 'file_write',
  edit: 'file_write',
  apply_patch: 'file_write',
  // 命令执行
  bash: 'shell',
  shell: 'shell',
  exec_background: 'shell',
  process: 'shell',
  // 网络
  web_search: 'network',
  web_fetch: 'network',
  fetch: 'network',
  http: 'network',
  // 浏览器
  browse: 'browser',
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
    // 0. 只读工具自动放行（但仍检查受限路径）
    if (AUTO_ALLOW_TOOLS.has(toolName)) {
      const filePath = (params['path'] as string) ?? (params['file_path'] as string) ?? '';
      if (filePath && this.isRestrictedPath(filePath)) {
        return {
          allowed: false,
          reason: `访问受限路径: ${filePath}`,
          requiresConfirmation: true,
          permissionCategory: 'file_read',
        };
      }
      return { allowed: true };
    }

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

    // 3. Unicode 混淆检测（命令/路径参数）
    const textToCheck = (params['command'] ?? params['path'] ?? params['file_path'] ?? '') as string;
    if (textToCheck) {
      const unicode = detectUnicodeConfusion(textToCheck);
      if (unicode.detected) {
        return {
          allowed: false,
          reason: `检测到 Unicode 混淆: ${unicode.issues.join(', ')}`,
          requiresConfirmation: true,
          permissionCategory: category,
        };
      }
    }

    // 4. 消息发送类工具强制确认
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

    // 5. 文件系统路径检查
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

    // 6. 常规权限检查（先查具体资源，再查通配符 — SecurityExtension 内部处理）
    const resource = (params['command'] as string) ?? (params['path'] as string) ?? (params['file_path'] as string) ?? (params['url'] as string) ?? (params['query'] as string) ?? '*';
    const result = this.security.checkPermission(agentId, category, resource);
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
