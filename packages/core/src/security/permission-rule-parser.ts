/**
 * 权限规则解析器 — 子命令级规则语法
 *
 * 规则字符串格式:
 *   shell                       → 匹配所有 shell 命令
 *   shell(git)                  → 匹配 git 开头的命令
 *   shell(git push)             → 精确匹配 git push
 *   shell(git push --force)     → 精确匹配含 --force 的 git push
 *   file_write(/etc/*)          → 匹配 /etc/ 下文件写入
 *   network(domain:*.internal)  → 匹配内部域名
 *
 * 括号内容需转义: \( \) \\
 *
 * 参考 Claude Code permissionRuleParser.ts
 */

import type { PermissionCategory } from '@evoclaw/shared';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface PermissionRuleValue {
  /** 权限类别 */
  category: PermissionCategory;
  /** 规则内容（可选 — 无则匹配整个类别） */
  ruleContent?: string;
}

export interface PermissionRule {
  /** 规则行为 */
  behavior: 'allow' | 'deny' | 'ask';
  /** 规则值 */
  value: PermissionRuleValue;
  /** 规则来源 */
  source: 'config' | 'session' | 'managed';
}

// ═══════════════════════════════════════════════════════════════════════════
// 解析
// ═══════════════════════════════════════════════════════════════════════════

const VALID_CATEGORIES = new Set<string>([
  'file_read', 'file_write', 'network', 'shell', 'browser', 'mcp', 'skill',
]);

/**
 * 解析规则字符串
 *
 * @param rule 规则字符串 (如 "shell(git push)")
 * @returns 解析结果或 null（格式无效）
 */
export function parsePermissionRule(rule: string): PermissionRuleValue | null {
  const trimmed = rule.trim();
  if (!trimmed) return null;

  // 查找第一个未转义的 (
  let parenStart = -1;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '(' && (i === 0 || trimmed[i - 1] !== '\\')) {
      parenStart = i;
      break;
    }
  }

  // 无括号 — 纯类别匹配
  if (parenStart === -1) {
    if (!VALID_CATEGORIES.has(trimmed)) return null;
    return { category: trimmed as PermissionCategory };
  }

  // 有括号 — 提取类别和内容
  const category = trimmed.slice(0, parenStart);
  if (!VALID_CATEGORIES.has(category)) return null;

  // 查找最后一个未转义的 )
  let parenEnd = -1;
  for (let i = trimmed.length - 1; i > parenStart; i--) {
    if (trimmed[i] === ')' && (i === 0 || trimmed[i - 1] !== '\\')) {
      parenEnd = i;
      break;
    }
  }

  if (parenEnd === -1) return null; // 未闭合

  const content = trimmed.slice(parenStart + 1, parenEnd);

  // 空内容或 * 等价于纯类别
  if (!content || content === '*') {
    return { category: category as PermissionCategory };
  }

  // 反转义: \( → (, \) → ), \\ → \
  const unescaped = content
    .replace(/\\\)/g, ')')
    .replace(/\\\(/g, '(')
    .replace(/\\\\/g, '\\');

  return { category: category as PermissionCategory, ruleContent: unescaped };
}

// ═══════════════════════════════════════════════════════════════════════════
// 匹配
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 检查资源是否匹配规则
 *
 * 匹配逻辑:
 * 1. 类别必须一致
 * 2. 规则无 ruleContent → 匹配整个类别
 * 3. 规则有 ruleContent → 检查资源是否以 ruleContent 开头（前缀匹配）
 * 4. ruleContent 末尾有 * → 通配符匹配
 */
export function matchRule(rule: PermissionRuleValue, category: PermissionCategory, resource: string): boolean {
  // 类别必须匹配
  if (rule.category !== category) return false;

  // 无子命令规则 → 匹配整个类别
  if (!rule.ruleContent) return true;

  const ruleContent = rule.ruleContent;

  // 通配符: "git *" 匹配 "git status", "git push" 等
  if (ruleContent.endsWith('*')) {
    const prefix = ruleContent.slice(0, -1);
    return resource.startsWith(prefix) || resource === prefix.trimEnd();
  }

  // domain 前缀: "domain:*.internal" 匹配 "domain:api.internal"
  if (ruleContent.startsWith('domain:') && ruleContent.includes('*')) {
    const pattern = ruleContent.slice(7).replace(/\./g, '\\.').replace(/\*/g, '.*');
    return new RegExp(`^${pattern}$`).test(resource.replace(/^domain:/, ''));
  }

  // 精确匹配或前缀匹配
  return resource === ruleContent || resource.startsWith(ruleContent + ' ');
}
