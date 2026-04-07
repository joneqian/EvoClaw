/**
 * 路径安全验证 — 命令级路径检查 + Symlink 双路径 + 危险删除保护
 *
 * 参考 Claude Code pathValidation.ts 设计:
 * 1. 从命令 argv 中提取路径参数
 * 2. Tilde 展开 + 规范化
 * 3. Symlink 双路径检查（真实路径 + 符号链接路径都必须安全）
 * 4. 危险删除路径保护（即使有 allow 也拦截关键系统目录的删除）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  extractPaths,
  expandTilde,
  getGlobBaseDirectory,
  containsPathTraversal,
} from './path-extractors.js';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface PathValidationResult {
  /** 是否安全 */
  safe: boolean;
  /** 不安全原因 */
  reason?: string;
  /** 涉及的危险路径 */
  dangerousPaths?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// 危险删除路径（即使有 allow 规则也不能自动放行）
// ═══════════════════════════════════════════════════════════════════════════

/** macOS/Linux 关键系统目录 — rm/rmdir 绝对不能删除 */
const DANGEROUS_REMOVAL_PATHS = new Set([
  '/',
  '/bin', '/sbin', '/usr', '/usr/bin', '/usr/sbin', '/usr/lib',
  '/etc', '/var', '/tmp',
  '/System', '/Library', '/Applications',
  '/home', '/Users',
  os.homedir(),
  path.join(os.homedir(), '.ssh'),
  path.join(os.homedir(), '.gnupg'),
  path.join(os.homedir(), '.config'),
  path.join(os.homedir(), 'Documents'),
  path.join(os.homedir(), 'Desktop'),
]);

/** 受限路径前缀 — 需要权限确认 */
const RESTRICTED_PATH_PREFIXES = [
  '/etc/', '/usr/', '/bin/', '/sbin/',
  '/System/', '/Library/',
  `${os.homedir()}/.ssh/`,
  `${os.homedir()}/.gnupg/`,
];

// ═══════════════════════════════════════════════════════════════════════════
// Symlink 解析
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 获取路径的所有表示（原始路径 + 解析 symlink 后的真实路径）
 * 两个路径都必须通过安全检查
 */
function getPathsForCheck(filePath: string): string[] {
  const resolved = path.resolve(expandTilde(filePath));
  const paths = [resolved];

  try {
    const realPath = fs.realpathSync(resolved);
    if (realPath !== resolved) {
      paths.push(realPath);
    }
  } catch {
    // 文件不存在时 realpath 会失败 — 只检查原始路径
  }

  return paths;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 检查命令是否尝试删除危险路径
 *
 * 对 rm/rmdir 命令做额外保护:
 * - 提取所有目标路径
 * - 展开 tilde，解析为绝对路径
 * - 检测关键系统目录
 * - 即使有 allow 规则也不能自动放行
 *
 * @param commandName 命令名 (rm, rmdir)
 * @param args 命令参数
 * @returns 验证结果
 */
export function checkDangerousRemovalPaths(commandName: string, args: string[]): PathValidationResult {
  if (commandName !== 'rm' && commandName !== 'rmdir') {
    return { safe: true };
  }

  const targetPaths = extractPaths(commandName, args);
  const dangerous: string[] = [];

  for (const rawPath of targetPaths) {
    const expanded = expandTilde(rawPath);
    const resolved = path.resolve(expanded);
    // 不解析 symlink — 防止 ln -s / /tmp/innocent && rm -rf /tmp/innocent 绕过
    if (isDangerousRemovalPath(resolved)) {
      dangerous.push(resolved);
    }
  }

  if (dangerous.length > 0) {
    return {
      safe: false,
      reason: `尝试删除关键系统路径: ${dangerous.join(', ')}`,
      dangerousPaths: dangerous,
    };
  }

  return { safe: true };
}

/**
 * 检测路径是否是危险的删除目标
 */
export function isDangerousRemovalPath(resolvedPath: string): boolean {
  const normalized = path.normalize(resolvedPath);
  return DANGEROUS_REMOVAL_PATHS.has(normalized);
}

/**
 * 对命令中的路径参数做完整安全检查
 *
 * 流程:
 * 1. 提取命令中的路径参数
 * 2. 路径穿越检测
 * 3. Glob 基目录检查
 * 4. Symlink 双路径检查
 * 5. 受限路径检查
 *
 * @param commandName 命令名称
 * @param args 命令参数
 * @returns 验证结果
 */
export function validateCommandPaths(commandName: string, args: string[]): PathValidationResult {
  const rawPaths = extractPaths(commandName, args);
  if (rawPaths.length === 0) return { safe: true };

  for (const rawPath of rawPaths) {
    // 路径穿越检测
    if (containsPathTraversal(rawPath)) {
      return {
        safe: false,
        reason: `检测到路径穿越: ${rawPath}`,
        dangerousPaths: [rawPath],
      };
    }

    // Glob 基目录检查
    const globBase = getGlobBaseDirectory(rawPath);
    const pathsToCheck = globBase
      ? getPathsForCheck(globBase)
      : getPathsForCheck(rawPath);

    // Symlink 双路径 — 每个表示都必须安全
    for (const resolved of pathsToCheck) {
      if (isRestrictedPathResolved(resolved)) {
        return {
          safe: false,
          reason: `访问受限路径: ${resolved}`,
          dangerousPaths: [resolved],
        };
      }
    }
  }

  // 危险删除路径额外保护
  const removalCheck = checkDangerousRemovalPaths(commandName, args);
  if (!removalCheck.safe) return removalCheck;

  return { safe: true };
}

/**
 * 检测已解析的绝对路径是否受限
 */
function isRestrictedPathResolved(resolvedPath: string): boolean {
  return RESTRICTED_PATH_PREFIXES.some(prefix => resolvedPath.startsWith(prefix));
}

/**
 * 从 SimpleCommand argv 中提取命令名（basename）
 */
export function getBaseCommand(argv0: string): string {
  return path.basename(argv0);
}
