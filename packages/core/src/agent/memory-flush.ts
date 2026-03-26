/**
 * Memory Flush — Context 耗尽前的记忆持久化
 *
 * 参考 OpenClaw 四层防护设计：
 * - Layer 1: write 工具包裹 — 精确路径匹配只允许 memory/YYYY-MM-DD.md
 * - Layer 2: 工具过滤 — flush 期间只保留 read + write
 * - Layer 3: 提示层 — safety hints 强制注入，bootstrap 文件只读
 * - Layer 4: 读取过滤 — 记忆加载时忽略非 .md 文件
 */

import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('memory-flush');

// ─── Layer 3: Safety Hints（不可覆盖的安全提示） ───

const MEMORY_FLUSH_SAFETY_HINTS = [
  '仅将值得长期保留的信息写入 memory/YYYY-MM-DD.md（如需创建 memory/ 目录，请先创建）',
  '如果 memory/YYYY-MM-DD.md 已存在，只能追加新内容，不要覆盖已有条目',
  'MEMORY.md、SOUL.md、TOOLS.md、AGENTS.md 等引导文件在此期间为只读，禁止修改',
] as const;

/** Memory flush 提示词（含强制 safety hints） */
export function buildMemoryFlushPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  const safetyBlock = MEMORY_FLUSH_SAFETY_HINTS.map(h => `- ${h.replace(/YYYY-MM-DD/g, today)}`).join('\n');

  return `[Pre-compaction memory flush]

会话即将被压缩。请将当前对话中重要的上下文持久化。

你可以做的：
- 读取任何文件 (read)
- 将重要信息追加到 memory/${today}.md

规则（不可违反）：
${safetyBlock}
- 如果没有需要存储的内容，回复 NO_REPLY

写入格式建议：
## HH:MM - 主题
简要描述...`;
}

// ─── Layer 1: Write 工具路径守卫 ───

/**
 * 检查 write 目标路径是否在允许范围内
 * 仅允许 memory/YYYY-MM-DD.md 格式
 */
export function isAllowedFlushWritePath(targetPath: string): boolean {
  const normalized = targetPath.replace(/\\/g, '/');
  // 从路径末尾提取 memory/YYYY-MM-DD.md
  const match = normalized.match(/memory\/\d{4}-\d{2}-\d{2}\.md$/);
  return match !== null;
}

/**
 * Memory Flush 模式的 write 路径守卫
 * 在 flush 模式下调用，拒绝非 memory/YYYY-MM-DD.md 的写入
 */
export function guardFlushWritePath(targetPath: string): void {
  if (!isAllowedFlushWritePath(targetPath)) {
    const today = new Date().toISOString().slice(0, 10);
    throw new Error(
      `Memory flush writes are restricted to memory/${today}.md; use that path only.`,
    );
  }
}

// ─── Layer 2: 工具过滤 ───

/** Memory Flush 期间允许的工具名称 */
export const MEMORY_FLUSH_ALLOWED_TOOLS = new Set(['read', 'write']);

/**
 * 创建 Memory Flush 模式的权限拦截器
 * - 只允许 read + write 工具
 * - write 只允许写 memory/YYYY-MM-DD.md
 * - 拒绝 bootstrap 文件的写入（MEMORY.md, SOUL.md 等）
 */
export function createFlushPermissionInterceptor(): (toolName: string, args: Record<string, unknown>) => Promise<string | null> {
  return async (toolName: string, args: Record<string, unknown>): Promise<string | null> => {
    // Layer 2: 工具过滤
    if (!MEMORY_FLUSH_ALLOWED_TOOLS.has(toolName)) {
      return `Memory flush 期间禁止使用 ${toolName} 工具，仅允许 read 和 write`;
    }

    // Layer 1: write 路径守卫
    if (toolName === 'write' || toolName === 'edit') {
      const filePath = (args['path'] as string) ?? (args['file_path'] as string) ?? '';
      if (!filePath) {
        return 'write 工具缺少 path 参数';
      }

      // 禁止写入 bootstrap 文件
      const basename = path.basename(filePath);
      if (BOOTSTRAP_READONLY_FILES.has(basename)) {
        return `Memory flush 期间 ${basename} 为只读`;
      }

      // 只允许 memory/YYYY-MM-DD.md
      if (!isAllowedFlushWritePath(filePath)) {
        const today = new Date().toISOString().slice(0, 10);
        return `Memory flush writes are restricted to memory/${today}.md`;
      }
    }

    return null; // 允许
  };
}

/** Bootstrap 只读文件集合 */
const BOOTSTRAP_READONLY_FILES = new Set([
  'MEMORY.md', 'SOUL.md', 'TOOLS.md', 'AGENTS.md',
  'IDENTITY.md', 'HEARTBEAT.md', 'BOOTSTRAP.md',
]);

// ─── Layer 4: 记忆读取过滤 ───

/**
 * 检查文件是否是允许的记忆文件（仅 .md）
 * 过滤掉 memory/ 目录中的非 .md 文件（HTML/PDF/PNG 等垃圾）
 */
export function isAllowedMemoryFile(filePath: string): boolean {
  return filePath.endsWith('.md');
}

/**
 * 检查 memory/ 目录中的文件是否是日期格式的日记文件
 * 匹配 memory/YYYY-MM-DD.md 或 memory/YYYY-MM-DD-slug.md
 */
export function isDatedMemoryFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return /memory\/\d{4}-\d{2}-\d{2}(-[a-z0-9-]+)?\.md$/.test(normalized);
}

/**
 * 列出 memory 目录中的有效记忆文件（仅 .md）
 * 过滤掉非 .md 文件
 */
export function listValidMemoryFiles(memoryDir: string): string[] {
  if (!fs.existsSync(memoryDir)) return [];

  return fs.readdirSync(memoryDir)
    .filter(f => {
      const fullPath = path.join(memoryDir, f);
      if (!fs.statSync(fullPath).isFile()) return false;
      if (!isAllowedMemoryFile(f)) {
        log.warn(`记忆目录中存在非 .md 文件，已忽略: ${f}`);
        return false;
      }
      return true;
    })
    .sort();
}

// ─── 已有功能保留 ───

/** 判断 memory flush 是否应该触发 (基于 token 使用率) */
export function shouldTriggerFlush(
  totalTokens: number,
  maxContextTokens: number,
  threshold = 0.85,
): boolean {
  if (maxContextTokens <= 0) return false;
  return totalTokens / maxContextTokens >= threshold;
}

/** 确保 memory 目录存在 */
export function ensureMemoryDir(workspacePath: string): string {
  const memoryDir = path.join(workspacePath, 'memory');
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
  return memoryDir;
}

/** 追加内容到今天的日记文件 */
export function appendToTodayMemory(workspacePath: string, content: string): void {
  const memoryDir = ensureMemoryDir(workspacePath);
  const today = new Date().toISOString().slice(0, 10);
  const filePath = path.join(memoryDir, `${today}.md`);

  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  const separator = existing.length > 0 ? '\n\n' : '';
  fs.writeFileSync(filePath, existing + separator + content, 'utf-8');
}

/** @deprecated 使用 createFlushPermissionInterceptor 替代 */
export function enhanceWriteDescriptionForFlush(originalDescription: string): string {
  return `${originalDescription}\n[Memory Flush 模式] 当前只能追加写入 memory/YYYY-MM-DD.md，其他文件为只读。`;
}

/** @deprecated 使用 MEMORY_FLUSH_ALLOWED_TOOLS 替代 */
export const MEMORY_FLUSH_TOOL_NAMES = MEMORY_FLUSH_ALLOWED_TOOLS;
