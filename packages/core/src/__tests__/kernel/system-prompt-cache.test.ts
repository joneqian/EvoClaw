import { describe, it, expect } from 'vitest';
import { dedupeCacheBreakpoints, ANTHROPIC_CACHE_BREAKPOINT_LIMIT } from '../../agent/kernel/system-prompt-cache.js';
import type { SystemPromptBlock } from '../../agent/kernel/types.js';

/**
 * cache_control 去重 / 上限保护测试
 *
 * 背景：Anthropic API 单请求 cache_control breakpoint 上限 = 4。
 * EvoClaw embedded-runner-prompt.ts 在 interactive 模式下会产生 9-10 个标记
 * （safety/memory_recall/skill_memorization/tool_style/silent_reply/language/
 *  personality/identity/procedures），直接发送会触发 SDK 校验失败或被 silent 截断。
 *
 * 解决方式：相邻同 scope 的 block 视为一个连续段，只在段尾保留 cache_control。
 * 段尾的标记表示"该段之前的 prefix 整段视为一个缓存段"——这是 Anthropic 推荐用法。
 */

describe('dedupeCacheBreakpoints', () => {
  it('相邻同 global scope → 只保留最后一个标记', () => {
    const blocks: SystemPromptBlock[] = [
      { text: 'a', cacheControl: { type: 'ephemeral', scope: 'global' } },
      { text: 'b', cacheControl: { type: 'ephemeral', scope: 'global' } },
      { text: 'c', cacheControl: { type: 'ephemeral', scope: 'global' } },
    ];

    const result = dedupeCacheBreakpoints(blocks);

    expect(result).toHaveLength(3);
    expect(result[0]!.cacheControl).toBeUndefined();
    expect(result[1]!.cacheControl).toBeUndefined();
    expect(result[2]!.cacheControl).toEqual({ type: 'ephemeral', scope: 'global' });
    // 文本不变
    expect(result.map(b => b.text)).toEqual(['a', 'b', 'c']);
  });

  it('相邻同 org scope → 只保留最后一个标记', () => {
    const blocks: SystemPromptBlock[] = [
      { text: 'a', cacheControl: { type: 'ephemeral', scope: 'org' } },
      { text: 'b', cacheControl: { type: 'ephemeral', scope: 'org' } },
    ];

    const result = dedupeCacheBreakpoints(blocks);

    expect(result[0]!.cacheControl).toBeUndefined();
    expect(result[1]!.cacheControl).toEqual({ type: 'ephemeral', scope: 'org' });
  });

  it('global 段后接 org 段 → 段尾各自保留一个标记', () => {
    const blocks: SystemPromptBlock[] = [
      { text: 'g1', cacheControl: { type: 'ephemeral', scope: 'global' } },
      { text: 'g2', cacheControl: { type: 'ephemeral', scope: 'global' } },
      { text: 'o1', cacheControl: { type: 'ephemeral', scope: 'org' } },
      { text: 'o2', cacheControl: { type: 'ephemeral', scope: 'org' } },
    ];

    const result = dedupeCacheBreakpoints(blocks);

    const breakpoints = result.filter(b => b.cacheControl);
    expect(breakpoints).toHaveLength(2);
    expect(breakpoints[0]!.text).toBe('g2');
    expect(breakpoints[0]!.cacheControl?.scope).toBe('global');
    expect(breakpoints[1]!.text).toBe('o2');
    expect(breakpoints[1]!.cacheControl?.scope).toBe('org');
  });

  it('null/undefined cacheControl 的 block 不参与去重 → 不加新标记', () => {
    const blocks: SystemPromptBlock[] = [
      { text: 'g', cacheControl: { type: 'ephemeral', scope: 'global' } },
      { text: 'd1', cacheControl: null },
      { text: 'd2', cacheControl: null },
      { text: 'd3' }, // undefined
    ];

    const result = dedupeCacheBreakpoints(blocks);

    expect(result[0]!.cacheControl?.scope).toBe('global');
    expect(result[1]!.cacheControl).toBeNull();
    expect(result[2]!.cacheControl).toBeNull();
    expect(result[3]!.cacheControl).toBeUndefined();
  });

  it('夹在两个 global 段之间的 no-scope ephemeral → 三段独立保留 3 个标记', () => {
    // 这是 EvoClaw 的实际场景：silent_reply 在 global tool_style 后、global feishu 前
    const blocks: SystemPromptBlock[] = [
      { text: 'safety', cacheControl: { type: 'ephemeral', scope: 'global' } },
      { text: 'tool_style', cacheControl: { type: 'ephemeral', scope: 'global' } },
      { text: 'silent_reply', cacheControl: { type: 'ephemeral' } }, // no scope
      { text: 'feishu', cacheControl: { type: 'ephemeral', scope: 'global' } },
    ];

    const result = dedupeCacheBreakpoints(blocks);

    const breakpoints = result.filter(b => b.cacheControl);
    expect(breakpoints).toHaveLength(3);
    expect(breakpoints.map(b => b.text)).toEqual(['tool_style', 'silent_reply', 'feishu']);
  });

  it('breakpoint 数 > 上限 4 → 保留靠后的 4 个并 warn', () => {
    const blocks: SystemPromptBlock[] = [
      { text: 'g', cacheControl: { type: 'ephemeral', scope: 'global' } },
      { text: 'sr1', cacheControl: { type: 'ephemeral' } },
      { text: 'g2', cacheControl: { type: 'ephemeral', scope: 'global' } },
      { text: 'sr2', cacheControl: { type: 'ephemeral' } },
      { text: 'g3', cacheControl: { type: 'ephemeral', scope: 'global' } },
      { text: 'org', cacheControl: { type: 'ephemeral', scope: 'org' } },
    ];

    const result = dedupeCacheBreakpoints(blocks);

    const breakpoints = result.filter(b => b.cacheControl);
    expect(breakpoints.length).toBeLessThanOrEqual(ANTHROPIC_CACHE_BREAKPOINT_LIMIT);
    // 保留最靠后的几个（最大 prefix 覆盖最优）
    expect(breakpoints[breakpoints.length - 1]!.text).toBe('org');
  });

  it('空数组 / 单元素 → 无副作用', () => {
    expect(dedupeCacheBreakpoints([])).toEqual([]);
    const single: SystemPromptBlock[] = [{ text: 'x', cacheControl: { type: 'ephemeral', scope: 'global' } }];
    const result = dedupeCacheBreakpoints(single);
    expect(result).toHaveLength(1);
    expect(result[0]!.cacheControl?.scope).toBe('global');
  });

  it('返回新数组，不修改入参（immutability）', () => {
    const blocks: SystemPromptBlock[] = [
      { text: 'a', cacheControl: { type: 'ephemeral', scope: 'global' } },
      { text: 'b', cacheControl: { type: 'ephemeral', scope: 'global' } },
    ];
    const snapshot = JSON.stringify(blocks);

    const result = dedupeCacheBreakpoints(blocks);

    expect(JSON.stringify(blocks)).toBe(snapshot); // 入参未变
    expect(result).not.toBe(blocks);
  });
});

describe('集成：buildSystemPromptBlocks → dedupe 后 ≤ 4 breakpoints', () => {
  it('interactive 模式真实 build 后 breakpoint 数应 ≤ 4', async () => {
    // 引入 build 函数 — 用最少必要 config
    const { buildSystemPromptBlocks } = await import('../../agent/embedded-runner-prompt.js');

    const blocks = buildSystemPromptBlocks(
      {
        agent: { id: 'test-agent', name: 'Test', emoji: '🤖' } as never,
        modelId: 'gpt-4',
        provider: 'openai',
        permissionMode: 'auto',
        workspacePath: '/tmp/test',
        workspaceFiles: {
          'SOUL.md': '# soul',
          'IDENTITY.md': '# identity',
          'AGENTS.md': '# agents',
        },
        tools: [],
      } as never,
      'interactive',
    );

    // build 出来的原始数 (无 dedupe) — 应该有 7+ 个 cache_control
    const rawBreakpoints = blocks.filter(b => b.cacheControl).length;
    expect(rawBreakpoints).toBeGreaterThan(4);

    // dedupe 后 ≤ 4
    const deduped = dedupeCacheBreakpoints(blocks);
    const finalBreakpoints = deduped.filter(b => b.cacheControl).length;
    expect(finalBreakpoints).toBeLessThanOrEqual(ANTHROPIC_CACHE_BREAKPOINT_LIMIT);
  });
});
