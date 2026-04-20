import type { SecurityExtension } from '../bridge/security-extension.js';
import type { PermissionCategory, PermissionMode } from '@evoclaw/shared';
import { detectUnicodeConfusion } from '../security/unicode-detector.js';
import { analyzeCommand } from '../security/bash-parser/security-analyzer.js';
import { isPreapprovedURL } from './preapproved-domains.js';
import { validateCommandPaths, checkDangerousRemovalPaths, getBaseCommand } from '../security/path-validation.js';
import { detectDestructive, type DestructiveCategory } from '../security/destructive-detector.js';
import { checkCommandFlags } from '../security/command-allowlist.js';
import path from 'node:path';
import os from 'node:os';

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
  />\s*\/dev\/(?!null\b)/i,         // 写 /dev/sda 等设备，但排除安全的 /dev/null
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
  // Legacy 降级路径保留 — AST 主路径的 pre-checks 已覆盖以下 3 项，
  // 但 parse-unavailable 降级时仍需要这些正则兜底
  // eslint-disable-next-line no-control-regex -- 故意包含控制字符作为安全检查 pattern
  /[\x00-\x08\x0b\x0c\x0e-\x1f]/,                            // 控制字符（排除 \t\n\r）→ pre-checks: control_characters
  /[\u00A0\u2000-\u200B\u2028\u2029\u202F\u205F\u3000]/,      // Unicode 伪空格 → pre-checks: unicode_whitespace
  /\{[^}]*,[^}]*\}/,                                          // 花括号展开 {a,b} → pre-checks: brace_expansion_with_quotes
  /(?:^|[;&|])\s*['"][^'"]*$/,                                // 不完整命令（未闭合引号）
];

/** 消息发送类工具（需要强制确认） */
const MESSAGE_TOOLS = new Set([
  'send_message', 'send_email', 'post_tweet', 'send_notification',
  'slack_send', 'telegram_send', 'wechat_send',
]);

/** 安全二进制白名单 — 这些命令免授权执行 */
const SAFE_BINS = new Set([
  // 版本控制
  'git',
  // Node.js 生态
  'node', 'npm', 'pnpm', 'npx', 'yarn', 'bun',
  // Python 生态
  'python', 'python3', 'pip', 'pip3',
  // 文件操作（只读/安全）
  'ls', 'cat', 'head', 'tail', 'wc', 'file', 'stat',
  'find', 'mdfind', 'grep', 'rg', 'ag',
  'sort', 'uniq', 'diff', 'tr', 'cut', 'awk', 'sed',
  // 目录操作
  'mkdir', 'cp', 'mv', 'touch',
  // 网络（只读）
  'curl', 'wget', 'ping', 'dig', 'nslookup',
  // 其他安全工具
  'echo', 'printf', 'date', 'whoami', 'pwd', 'env',
  'which', 'type', 'man',
  'tar', 'gzip', 'gunzip', 'zip', 'unzip',
  'jq', 'yq',
]);

/**
 * 自动放行的工具 — 不需要权限确认
 *
 * 包含两类：
 * (1) 真正的只读工具（read/ls/find/grep/image/pdf）
 * (2) Agent 自管理工具（操作 Agent 自己的资源，每个工具内部有 agentId 越权检查）：
 *     - 子 Agent 管理：spawn/list/kill/steer/yield
 *     - 记忆库管理：memory_* + knowledge_query
 *       记忆工具操作的是 Agent 自己的 SQLite 记忆库，不涉及外部系统/文件/网络。
 *       memory_delete / memory_forget_topic 是软删除（archived_at），可恢复。
 *       用户说"请记住/忘掉"本身就是显式授权——每次再弹权限框是糟糕的 UX。
 */
const AUTO_ALLOW_TOOLS = new Set([
  'read', 'ls', 'find', 'grep',       // 文件只读
  'image', 'pdf',                       // 多媒体只读
  'spawn_agent', 'list_agents', 'kill_agent', 'steer_agent', 'yield_agents',  // 子 Agent 管理
  // 记忆库自管理（Agent 自己的 DB，工具内部已做 agentId 越权检查）
  'memory_search', 'memory_get', 'knowledge_query',
  'memory_write', 'memory_update', 'memory_delete', 'memory_forget_topic', 'memory_pin',
]);

/**
 * 工具名称 → 权限类别映射（M3-T3a 迁移至 routes/command-manifest.ts 作为唯一来源）。
 * 这里保留一个局部常量引用，调用点零改动。
 */
import { TOOL_CATEGORY_MAP as _TOOL_MANIFEST_CATEGORY_MAP } from '../routes/command-manifest.js';
const TOOL_CATEGORY_MAP = _TOOL_MANIFEST_CATEGORY_MAP;

/** 拦截结果 */
export interface InterceptResult {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
  permissionCategory?: PermissionCategory;
  /** 破坏性操作标记 — 允许执行但需要用户确认 */
  isDestructive?: boolean;
  /** 破坏性类别 */
  destructiveCategory?: DestructiveCategory;
  /** 破坏性警告信息 */
  destructiveWarning?: string;
}

/**
 * 工具权限拦截器
 * 检查工具执行的安全性和权限
 */
export class PermissionInterceptor {
  /** 当前权限模式 */
  private mode: PermissionMode = 'default';

  constructor(
    private security: SecurityExtension,
    /** 获取 Agent 工作区路径（用于安全区自动放行） */
    private getWorkspacePath?: (agentId: string) => string,
  ) {}

  /** 设置权限模式 */
  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  /** 获取当前权限模式 */
  getMode(): PermissionMode {
    return this.mode;
  }

  /**
   * 拦截工具调用
   * @param sessionKey 会话级权限隔离键（scope='session' 权限按此隔离）
   * @returns InterceptResult — 是否允许执行及原因
   */
  intercept(
    agentId: string,
    toolName: string,
    params: Record<string, unknown>,
    sessionKey?: string,
  ): InterceptResult {
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

    // 0.5 Workspace 安全区快速路径（提前检查，跳过后续所有检查）
    // write/edit/bash 等工具在 Agent 工作区内操作时，无需 DB 权限查询
    if (this.getWorkspacePath) {
      const wsFilePath = (params['path'] as string) ?? (params['file_path'] as string) ?? '';
      if (wsFilePath && this.isInWorkspace(agentId, wsFilePath)) {
        return { allowed: true };
      }
      // permissive 模式扩展：工作区内 shell 命令也自动放行（仍需通过危险命令检测）
      if (this.mode === 'permissive' && (toolName === 'bash' || toolName === 'shell')) {
        const command = (params['command'] as string) ?? '';
        // 仅当命令不包含危险模式时才自动放行
        if (command && !this.isDangerousCommand(command)) {
          return { allowed: true };
        }
      }
    }

    // 1. 确定权限类别
    const category = this.resolveCategory(toolName);

    // 2. 双路径安全检查 (AST 主路径 + Legacy 正则降级)
    if (toolName === 'bash' || toolName === 'shell') {
      const command = (params['command'] as string) ?? '';
      const securityResult = this.analyzeShellCommand(command);

      if (securityResult) {
        return securityResult;
      }
    }

    // 2.5 命令级路径验证（AST 解析后，利用 argv 提取路径参数）
    if (category === 'shell') {
      const command = (params['command'] as string) ?? '';
      const pathResult = this.validateShellPaths(command);
      if (pathResult) return pathResult;
    }

    // 2.6 flag 级白名单 + safeBins：安全命令免授权执行
    if (category === 'shell') {
      const command = (params['command'] as string) ?? '';
      const flagResult = checkCommandFlags(command);
      if (flagResult === 'ask') {
        // flag 级检测到危险 flag — 需要确认
        return {
          allowed: false,
          reason: `命令包含危险参数，需要确认`,
          requiresConfirmation: true,
          permissionCategory: 'shell',
        };
      }
      if (flagResult === 'safe') {
        return { allowed: true };
      }
      // flagResult === 'skip' — 不在 flag 白名单中，退回 safeBins
      if (isSafeBinCommand(command)) {
        return { allowed: true };
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

    // 3.5 预批准域名自动放行（web_fetch/web_search）
    if (toolName === 'web_fetch' || toolName === 'web_search') {
      const url = (params['url'] as string) ?? '';
      if (url && isPreapprovedURL(url)) {
        return { allowed: true };
      }
    }

    // 4. 消息发送类工具强制确认
    if (MESSAGE_TOOLS.has(toolName)) {
      const result = this.security.checkPermission(agentId, 'network', toolName, sessionKey);
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

    // 4.5 (已提前到步骤 0.5)

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
    // web 工具使用 domain:{hostname} 粒度
    let resource: string;
    if ((toolName === 'web_fetch' || toolName === 'web_search' || toolName === 'fetch') && params['url']) {
      try {
        const hostname = new URL(params['url'] as string).hostname;
        resource = `domain:${hostname}`;
      } catch {
        resource = (params['url'] as string) ?? '*';
      }
    } else {
      resource = (params['command'] as string) ?? (params['path'] as string) ?? (params['file_path'] as string) ?? (params['url'] as string) ?? (params['query'] as string) ?? '*';
    }
    const result = this.security.checkPermission(agentId, category, resource, sessionKey);
    if (result === 'deny') {
      return { allowed: false, reason: `Agent 没有 ${category} 权限` };
    }
    if (result === 'ask') {
      // strict 模式: ask → 自动 deny（无需用户确认）
      if (this.mode === 'strict') {
        return {
          allowed: false,
          reason: `[严格模式] 未授权的 ${category} 操作被自动拒绝`,
          permissionCategory: category,
        };
      }
      return {
        allowed: false,
        requiresConfirmation: true,
        permissionCategory: category,
      };
    }

    // 7. 破坏性操作检测（信息性标记，不阻断）
    if (category === 'shell') {
      const command = (params['command'] as string) ?? '';
      const destructive = detectDestructive(command);
      if (destructive.isDestructive) {
        return {
          allowed: true,
          isDestructive: true,
          destructiveCategory: destructive.category,
          destructiveWarning: destructive.warning,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * 双路径安全分析
   *
   * 主路径 (AST): analyzeCommand → 白名单制分析 + 变量追踪 + pre-checks
   * 降级路径 (Legacy): 解析失败时回退到正则黑名单
   *
   * @returns InterceptResult 如果需要拦截，null 如果通过（继续后续检查）
   */
  private analyzeShellCommand(command: string): InterceptResult | null {
    // AST 主路径
    const analysis = analyzeCommand(command);

    if (analysis.kind === 'deny') {
      return {
        allowed: false,
        reason: analysis.reason ?? '命令被安全分析拒绝',
        requiresConfirmation: false,
        permissionCategory: 'shell',
      };
    }

    if (analysis.kind === 'ask') {
      // Misparsing → 阻断整个流程，不能走 safeBins 绕过
      if (analysis.isMisparsing) {
        return {
          allowed: false,
          reason: `⚠️ 命令解析差异检测: ${analysis.reason}`,
          requiresConfirmation: true,
          permissionCategory: 'shell',
        };
      }

      // AST 分析返回 too-complex → 降级到 legacy 正则路径
      if (analysis.parseResult.kind === 'too-complex' || analysis.parseResult.kind === 'parse-unavailable') {
        return this.legacyDangerousCheck(command);
      }

      // Non-misparsing pre-check 警告 → 需要确认但非阻断
      return {
        allowed: false,
        reason: analysis.reason,
        requiresConfirmation: true,
        permissionCategory: 'shell',
      };
    }

    // AST 分析通过 → 仍然对原始命令做 legacy 正则双保险
    // （legacy 正则可检测跨管道的组合攻击如 curl|sh）
    const legacyResult = this.legacyDangerousCheck(command);
    if (legacyResult) return legacyResult;

    // 安全 → 返回 null（继续后续 safeBins/权限检查）
    return null;
  }

  /** Legacy 降级路径 — 对原始命令字符串做正则匹配 */
  private legacyDangerousCheck(command: string): InterceptResult | null {
    if (this.isDangerousCommand(command)) {
      return {
        allowed: false,
        reason: `检测到危险命令: ${command.slice(0, 100)}`,
        requiresConfirmation: true,
        permissionCategory: 'shell',
      };
    }
    return null;
  }

  /**
   * 命令级路径安全验证
   *
   * 从 shell 命令中提取路径参数，做受限路径 + 危险删除检查。
   * 利用简单的 split 提取 argv（AST 解析已在 step 2 完成）。
   *
   * @returns InterceptResult 如果需要拦截，null 如果通过
   */
  private validateShellPaths(command: string): InterceptResult | null {
    const trimmed = command.trim();
    if (!trimmed) return null;

    // 简单 split 提取 argv（空格分割，不处理引号 — 引号场景已由 AST 处理）
    const tokens = trimmed.split(/\s+/);
    const cmdName = getBaseCommand(tokens[0] ?? '');
    const args = tokens.slice(1);

    // 1. 危险删除路径保护（即使有 allow 也拦截）
    const removalCheck = checkDangerousRemovalPaths(cmdName, args);
    if (!removalCheck.safe) {
      return {
        allowed: false,
        reason: removalCheck.reason ?? '尝试删除关键系统路径',
        requiresConfirmation: true,
        permissionCategory: 'shell',
      };
    }

    // 2. 命令路径参数的受限路径检查
    const pathCheck = validateCommandPaths(cmdName, args);
    if (!pathCheck.safe) {
      return {
        allowed: false,
        reason: pathCheck.reason ?? '访问受限路径',
        requiresConfirmation: true,
        permissionCategory: 'shell',
      };
    }

    return null;
  }

  /** 检测危险命令 (Legacy 正则路径) */
  isDangerousCommand(command: string): boolean {
    return DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
  }

  /** 检测受限路径 */
  isRestrictedPath(filePath: string): boolean {
    const restricted = ['/etc/', '/usr/', '/bin/', '/sbin/', '/System/', '/Library/', '~/.ssh/', '~/.gnupg/'];
    return restricted.some(r => filePath.startsWith(r) || filePath.includes(r));
  }

  /** 检测路径是否在 Agent 工作区内（安全区自动放行） */
  private isInWorkspace(agentId: string, filePath: string): boolean {
    if (!this.getWorkspacePath) return false;
    const wsPath = this.getWorkspacePath(agentId);
    // 解析绝对路径（处理 ~ 开头和相对路径）
    const resolved = filePath.startsWith('~/')
      ? path.resolve(os.homedir(), filePath.slice(2))
      : path.resolve(filePath);
    // 路径穿越防护：规范化后比较前缀
    return resolved.startsWith(path.resolve(wsPath));
  }

  /** 工具名 → 权限类别 */
  private resolveCategory(toolName: string): PermissionCategory {
    return TOOL_CATEGORY_MAP[toolName] ?? 'skill';
  }
}

/**
 * 检查命令是否以安全二进制开头
 * 注意：危险命令检查（DANGEROUS_PATTERNS）应先于此检查执行，
 * 防止 `curl xxx | sh` 等伪装安全的危险命令通过
 */
export function isSafeBinCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  // 提取第一个命令（处理 cd xxx && 前缀）
  const firstCmd = trimmed.replace(/^cd\s+[^\s;|&]+\s*[;&|]+\s*/, '');
  const bin = firstCmd.split(/\s/)[0] ?? '';
  // 去掉路径前缀（/usr/bin/git → git）
  const baseBin = bin.split('/').pop() ?? bin;
  return SAFE_BINS.has(baseBin);
}
