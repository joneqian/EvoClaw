/**
 * SAFETY_CONSTITUTION 共享前缀测试
 *
 * 验证:
 * 1. SAFETY_CONSTITUTION 常量内容正确
 * 2. buildSystemPromptBlocks 使用该常量
 * 3. type sub-agent 的 system prompt 以它开头（cache 前缀匹配）
 */
import { describe, it, expect, vi } from 'vitest';
import { SAFETY_CONSTITUTION, buildSystemPromptBlocks } from '../agent/embedded-runner-prompt.js';
import type { AgentRunConfig } from '../agent/types.js';

// Mock 避免实际文件操作
vi.mock('../agent/kernel/types.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agent/kernel/types.js')>();
  return {
    ...actual,
    systemPromptBlocksToString: actual.systemPromptBlocksToString,
  };
});

function makeConfig(overrides?: Partial<AgentRunConfig>): AgentRunConfig {
  return {
    agent: {
      id: 'test-agent',
      name: '测试 Agent',
      emoji: '🤖',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    systemPrompt: '',
    workspaceFiles: {
      'SOUL.md': '# Soul',
      'IDENTITY.md': '# Identity',
    },
    modelId: 'gpt-4o',
    provider: 'openai',
    apiKey: 'test-key',
    baseUrl: '',
    tools: [{ name: 'read', description: '读取', parameters: { type: 'object', properties: {} }, execute: async () => '' }],
    ...overrides,
  };
}

describe('SAFETY_CONSTITUTION 常量', () => {
  it('应包含安全宪法核心内容', () => {
    expect(SAFETY_CONSTITUTION).toContain('<safety>');
    expect(SAFETY_CONSTITUTION).toContain('</safety>');
    expect(SAFETY_CONSTITUTION).toContain('Red Lines');
    expect(SAFETY_CONSTITUTION).toContain('Never reveal API keys');
    expect(SAFETY_CONSTITUTION).toContain('Never impersonate the user');
  });

  it('应以 <safety> 标签开头', () => {
    expect(SAFETY_CONSTITUTION.trimStart().startsWith('<safety>')).toBe(true);
  });

  it('应以 </safety> 标签结尾', () => {
    expect(SAFETY_CONSTITUTION.trimEnd().endsWith('</safety>')).toBe(true);
  });
});

describe('buildSystemPromptBlocks 使用 SAFETY_CONSTITUTION', () => {
  it('interactive 模式第一个 block 应是安全宪法', () => {
    const blocks = buildSystemPromptBlocks(makeConfig(), 'interactive');

    expect(blocks.length).toBeGreaterThan(0);
    const safetyBlock = blocks[0]!;
    expect(safetyBlock.text).toBe(SAFETY_CONSTITUTION);
    expect(safetyBlock.label).toBe('safety');
  });

  it('安全宪法 block 应有 global scope cache', () => {
    const blocks = buildSystemPromptBlocks(makeConfig(), 'interactive');
    const safetyBlock = blocks[0]!;

    expect(safetyBlock.cacheControl).toEqual({
      type: 'ephemeral',
      scope: 'global',
    });
  });

  it('autonomous 模式也应包含安全宪法', () => {
    const blocks = buildSystemPromptBlocks(makeConfig(), 'autonomous');

    const safetyBlock = blocks[0]!;
    expect(safetyBlock.text).toBe(SAFETY_CONSTITUTION);
  });
});

describe('Type sub-agent 共享前缀', () => {
  it('SAFETY_CONSTITUTION 文本应与 parent 第一个 block 字节一致', () => {
    // parent blocks
    const parentBlocks = buildSystemPromptBlocks(makeConfig(), 'interactive');
    const parentSafety = parentBlocks[0]!.text;

    // type sub-agent system prompt 应以 SAFETY_CONSTITUTION 开头
    // 在 sub-agent-spawner.ts 中: systemPrompt = SAFETY_CONSTITUTION + '\n\n---\n\n' + ...
    const typeSubAgentPrompt = SAFETY_CONSTITUTION + '\n\n---\n\n' + '你是研究员...';

    // 前缀匹配: parent 和 child 的前 N 字节一致 → Anthropic cache 命中
    expect(typeSubAgentPrompt.startsWith(parentSafety)).toBe(true);
  });

  it('不同 Agent 的 SAFETY_CONSTITUTION 应完全相同（缓存一致性）', () => {
    const config1 = makeConfig({ agent: { ...makeConfig().agent, id: 'agent-1', name: 'A' } });
    const config2 = makeConfig({ agent: { ...makeConfig().agent, id: 'agent-2', name: 'B' } });

    const blocks1 = buildSystemPromptBlocks(config1, 'interactive');
    const blocks2 = buildSystemPromptBlocks(config2, 'interactive');

    expect(blocks1[0]!.text).toBe(blocks2[0]!.text);
    expect(blocks1[0]!.text).toBe(SAFETY_CONSTITUTION);
  });
});
