/**
 * 系统提示词优先级覆盖测试
 */

import { describe, it, expect } from 'vitest';
import { resolvePromptOverrides } from '../agent/prompt-override.js';
import type { PromptOverride } from '../agent/prompt-override.js';

const defaultPrompt = [
  { text: 'You are an AI assistant.', cacheControl: { type: 'ephemeral' } as const, label: 'intro' },
  { text: 'Be helpful.', cacheControl: null, label: 'style' },
];

describe('resolvePromptOverrides', () => {
  it('无覆盖时应返回默认提示词', () => {
    const result = resolvePromptOverrides(defaultPrompt, []);
    expect(result).toEqual(defaultPrompt);
  });

  it('replace 应替换全部默认提示词', () => {
    const overrides: PromptOverride[] = [
      { level: 'override', content: 'Custom system prompt.', mode: 'replace' },
    ];
    const result = resolvePromptOverrides(defaultPrompt, overrides);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Custom system prompt.');
    expect(result[0].label).toBe('override:override');
  });

  it('append 应追加到默认提示词末尾', () => {
    const overrides: PromptOverride[] = [
      { level: 'custom', content: 'Extra instruction.', mode: 'append' },
    ];
    const result = resolvePromptOverrides(defaultPrompt, overrides);
    expect(result).toHaveLength(3); // 2 默认 + 1 追加
    expect(result[2].text).toBe('Extra instruction.');
  });

  it('最高优先级的 replace 应覆盖较低优先级的', () => {
    const overrides: PromptOverride[] = [
      { level: 'custom', content: 'Custom.', mode: 'replace' },
      { level: 'override', content: 'Override.', mode: 'replace' },
    ];
    const result = resolvePromptOverrides(defaultPrompt, overrides);
    expect(result[0].text).toBe('Override.'); // override > custom
  });

  it('replace + append 应先替换再追加', () => {
    const overrides: PromptOverride[] = [
      { level: 'coordinator', content: 'Coordinator mode.', mode: 'replace' },
      { level: 'agent', content: 'Agent extra.', mode: 'append' },
    ];
    const result = resolvePromptOverrides(defaultPrompt, overrides);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Coordinator mode.');
    expect(result[1].text).toBe('Agent extra.');
  });

  it('多个 append 应按优先级排序', () => {
    const overrides: PromptOverride[] = [
      { level: 'custom', content: 'Custom append.', mode: 'append' },
      { level: 'agent', content: 'Agent append.', mode: 'append' },
    ];
    const result = resolvePromptOverrides(defaultPrompt, overrides);
    expect(result).toHaveLength(4); // 2 默认 + 2 追加
    // agent (priority 2) 先于 custom (priority 3)
    expect(result[2].text).toBe('Agent append.');
    expect(result[3].text).toBe('Custom append.');
  });
});
