import type { SystemPromptBlock, CacheScope } from './types.js';

/**
 * Anthropic 单请求 cache_control breakpoint 上限
 * 参考：Anthropic Prompt Caching 文档
 *
 * 超出此数量会触发 SDK 校验失败或被 silent 截断（取决于 SDK 版本）。
 */
export const ANTHROPIC_CACHE_BREAKPOINT_LIMIT = 4;

/**
 * 去重相邻同 scope 的 cache_control 标记 + 上限保护
 *
 * 背景：embedded-runner-prompt.ts 在 interactive 模式下产生 9-10 个
 * cache_control 标记（safety/memory_recall/skill_memorization/tool_style
 * /silent_reply/language/personality/identity/procedures），远超 Anthropic
 * 上限。直接发送会被截断或拒绝。
 *
 * 策略：
 * 1. 相邻同 scope 的 block 视为同一缓存段，只在段尾保留 cache_control。
 *    Anthropic 的语义是"breakpoint 之前的整段 prefix 视为一个缓存键"，
 *    段中间的标记是冗余的（仍占 breakpoint 配额）。
 * 2. 如果去重后仍 > 4，保留**最靠后**的 4 个（覆盖最大 prefix）。
 *
 * 注：返回**新数组**，入参 immutable。
 */
export function dedupeCacheBreakpoints(blocks: readonly SystemPromptBlock[]): SystemPromptBlock[] {
  if (blocks.length === 0) return [];

  // Step 1：相邻同 scope 去重 — 段中间的 cache_control 移除
  const stripped: SystemPromptBlock[] = blocks.map(b => ({ ...b }));
  for (let i = 0; i < stripped.length - 1; i++) {
    const cur = stripped[i]!;
    const next = stripped[i + 1]!;
    if (sameScope(cur, next) && cur.cacheControl) {
      // 当前 block 与下一个同 scope 且当前有标记 → 移除当前标记，保留下一个
      stripped[i] = { ...cur, cacheControl: undefined };
    }
  }

  // Step 2：上限保护 — 超过 LIMIT 时保留最靠后的 LIMIT 个
  const breakpointIndices = stripped
    .map((b, i) => (b.cacheControl ? i : -1))
    .filter(i => i >= 0);

  if (breakpointIndices.length <= ANTHROPIC_CACHE_BREAKPOINT_LIMIT) {
    return stripped;
  }

  // eslint-disable-next-line no-console
  console.warn(
    `[system-prompt-cache] ${breakpointIndices.length} cache breakpoints exceed Anthropic limit ${ANTHROPIC_CACHE_BREAKPOINT_LIMIT}; ` +
      `keeping last ${ANTHROPIC_CACHE_BREAKPOINT_LIMIT}`,
  );

  const keepIndices = new Set(breakpointIndices.slice(-ANTHROPIC_CACHE_BREAKPOINT_LIMIT));
  return stripped.map((b, i) => (b.cacheControl && !keepIndices.has(i) ? { ...b, cacheControl: undefined } : b));
}

/**
 * 同 scope 判定：
 * - 都有 cache_control 且 scope 字段相等（包括都没 scope）
 * - 一方 null/undefined 一方有标记 → 不同
 */
function sameScope(a: SystemPromptBlock, b: SystemPromptBlock): boolean {
  const ac = a.cacheControl;
  const bc = b.cacheControl;
  if (!ac || !bc) return false;
  return scopeOf(ac.scope) === scopeOf(bc.scope);
}

function scopeOf(scope: CacheScope | undefined): string {
  return scope ?? '__none__';
}
