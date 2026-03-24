/**
 * Memory Flush — Context 耗尽前的记忆持久化
 *
 * 参考 OpenClaw 的 memory flush 设计：
 * - 在 context window 即将被压缩前触发
 * - 限制工具为 read + append-only write
 * - write 只能追加到 memory/YYYY-MM-DD.md
 * - Bootstrap 文件（SOUL/AGENTS/TOOLS/MEMORY）强制只读
 */

import fs from 'node:fs';
import path from 'node:path';

/** Memory flush 提示词 */
export function buildMemoryFlushPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `[Pre-compaction memory flush]

会话即将被压缩。请将当前对话中重要的上下文持久化。

你可以做的：
- 读取任何文件 (read)
- 将重要信息追加到 memory/${today}.md

规则：
- 仅将值得长期保留的信息写入日记文件
- MEMORY.md、SOUL.md、TOOLS.md、AGENTS.md 等引导文件在此期间为只读
- 不要覆盖已有内容，只能追加
- 如果没有需要存储的内容，回复 NO_REPLY

写入格式建议：
## HH:MM - 主题
简要描述...`;
}

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

/** 修改 write 工具的描述，追加 Memory Flush 限制说明 */
export function enhanceWriteDescriptionForFlush(originalDescription: string): string {
  return `${originalDescription}\n[Memory Flush 模式] 当前只能追加写入 memory/YYYY-MM-DD.md，其他文件为只读。`;
}

/** Memory Flush 工具的路径限制 — 参考 OpenClaw wrapToolMemoryFlushAppendOnlyWrite */
export const MEMORY_FLUSH_TOOL_NAMES = new Set(['read', 'write']);

/**
 * 检查 write 目标路径是否在允许范围内 (仅 memory/YYYY-MM-DD.md)
 */
export function isAllowedFlushWritePath(targetPath: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const allowedPattern = `memory/${today}.md`;
  return targetPath.includes(allowedPattern);
}
