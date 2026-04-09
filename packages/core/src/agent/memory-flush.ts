/**
 * Memory Flush — Context 耗尽前的记忆持久化
 *
 * 设计（Phase A.4 之后，2026-04-09 重构）：
 * - 旧版用 write 工具写 memory/YYYY-MM-DD.md 日记文件，已退役
 * - 新版用 memory_write LLM 工具直接写入 DB 的 memory_units 表
 * - 同样的"context 用到 85% 时给一个紧急 turn 把重要信息保存下来"语义，
 *   但走的是 EvoClaw 自己的工具链，无文件污染、无 shell 权限弹窗、无数据冗余
 *
 * 三层防护：
 * - Layer 1: 工具白名单 — flush 期间只允许 read + memory_search + memory_write
 * - Layer 2: 提示层 — safety hints 强制注入，bootstrap 文件全部为只读
 * - Layer 3: 触发条件 — totalTokens / contextWindow >= 0.85
 */

import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('memory-flush');

// ─── Layer 2: Safety Hints ───

const MEMORY_FLUSH_SAFETY_HINTS = [
  '只用 memory_write 工具把值得长期保留的信息写入 DB（每条调一次工具，不要堆在一条里）',
  '调用前先想清楚 l0（一行摘要）、l1（结构化概览）、category（profile/preference/entity/event/case/skill 等），不要用 write/edit 工具创建文件',
  'SOUL.md / IDENTITY.md / AGENTS.md / TOOLS.md / HEARTBEAT.md / MEMORY.md / USER.md 在此期间为只读，禁止修改',
  '不要重复保存已经存在的记忆——存疑时先用 memory_search 查一下',
] as const;

/** Memory flush 提示词（含强制 safety hints） */
export function buildMemoryFlushPrompt(): string {
  const safetyBlock = MEMORY_FLUSH_SAFETY_HINTS.map(h => `- ${h}`).join('\n');

  return `[Pre-compaction memory flush]

会话即将被压缩。请将当前对话中重要的上下文持久化到长期记忆 DB。

可以用的工具：
- read（只读，确认细节）
- memory_search（查询是否已有相关记忆，避免重复）
- memory_write（写入新的长期记忆）

规则（不可违反）：
${safetyBlock}
- 如果没有需要存储的内容，回复 NO_REPLY

memory_write 调用示例：
{
  "l0": "用户女儿叫小满，5月3日生日",
  "l1": "用户的女儿名叫小满，生日是5月3日，喜欢吃葡萄",
  "category": "profile"
}`;
}

// ─── Layer 1: 工具白名单 ───

/** Memory Flush 期间允许的工具名称 */
export const MEMORY_FLUSH_ALLOWED_TOOLS = new Set([
  'read',
  'memory_search',
  'memory_write',
]);

/**
 * 创建 Memory Flush 模式的权限拦截器
 * - 只允许 read / memory_search / memory_write 工具
 * - 拒绝其他所有工具（包括 write、edit、bash、memory_delete 等）
 */
export function createFlushPermissionInterceptor(): (toolName: string, args: Record<string, unknown>) => Promise<string | null> {
  return async (toolName: string, _args: Record<string, unknown>): Promise<string | null> => {
    if (!MEMORY_FLUSH_ALLOWED_TOOLS.has(toolName)) {
      log.debug(`flush 拦截: 禁止 ${toolName}`);
      return `Memory flush 期间禁止使用 ${toolName} 工具，仅允许 read / memory_search / memory_write`;
    }
    return null; // 允许
  };
}

// ─── Layer 3: 触发条件 ───

/** 判断 memory flush 是否应该触发 (基于 token 使用率) */
export function shouldTriggerFlush(
  totalTokens: number,
  maxContextTokens: number,
  threshold = 0.85,
): boolean {
  if (maxContextTokens <= 0) return false;
  return totalTokens / maxContextTokens >= threshold;
}
