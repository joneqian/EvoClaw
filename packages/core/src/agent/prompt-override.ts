/**
 * 系统提示词优先级覆盖机制
 *
 * 参考 Claude Code utils/systemPrompt.ts::buildEffectiveSystemPrompt():
 * 5 级优先级链，每级可替换或追加。
 *
 * 优先级 (高 → 低):
 * 1. override — 最高优先级（loop mode、--system-prompt-file）
 * 2. coordinator — 协调器模式
 * 3. agent — Agent 定义（AGENTS.md 内嵌提示词）
 * 4. custom — API 级自定义（config.systemPrompt）
 * 5. default — 默认（buildSystemPrompt 输出）
 */

// 避免循环依赖: agent/types.ts → prompt-override.ts → kernel/types.ts → agent/types.ts
// 使用轻量接口替代 import
interface PromptBlock {
  text: string;
  cacheControl?: { type: 'ephemeral' } | null;
  label?: string;
}

export type PromptOverrideLevel =
  | 'override'
  | 'coordinator'
  | 'agent'
  | 'custom'
  | 'default';

export interface PromptOverride {
  level: PromptOverrideLevel;
  content: string;
  /** replace = 替换全部默认提示词，append = 追加到末尾 */
  mode: 'replace' | 'append';
}

/** 优先级排序（数字越小越高） */
const PRIORITY_ORDER: Record<PromptOverrideLevel, number> = {
  override: 0,
  coordinator: 1,
  agent: 2,
  custom: 3,
  default: 4,
};

/**
 * 按优先级合并系统提示词
 *
 * 逻辑:
 * 1. 从 overrides 中找到最高优先级的 'replace' 类型覆盖
 * 2. 如果找到 → 用它替换全部默认提示词
 * 3. 收集所有 'append' 类型覆盖，按优先级追加到末尾
 * 4. 如果没有 replace → 使用默认提示词 + 所有 append
 */
export function resolvePromptOverrides(
  defaultPrompt: PromptBlock[],
  overrides: PromptOverride[],
): PromptBlock[] {
  if (overrides.length === 0) return defaultPrompt;

  // 按优先级排序
  const sorted = [...overrides].sort(
    (a, b) => PRIORITY_ORDER[a.level] - PRIORITY_ORDER[b.level],
  );

  // 找到最高优先级的 replace
  const firstReplace = sorted.find(o => o.mode === 'replace');

  // 基础提示词：如果有 replace 则替换，否则使用默认
  let base: PromptBlock[];
  if (firstReplace) {
    base = [{
      text: firstReplace.content,
      cacheControl: null,
      label: `override:${firstReplace.level}`,
    }];
  } else {
    base = [...defaultPrompt];
  }

  // 收集所有 append
  const appends = sorted.filter(o => o.mode === 'append');
  for (const override of appends) {
    base.push({
      text: override.content,
      cacheControl: null,
      label: `append:${override.level}`,
    });
  }

  return base;
}
