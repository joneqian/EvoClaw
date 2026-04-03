import { describe, it, expect } from 'vitest';
import { mcpPromptToSkill, bridgeAllMcpPrompts, type McpPromptInfo } from '../mcp/mcp-prompt-bridge.js';

describe('mcpPromptToSkill', () => {
  it('基本转换格式正确', () => {
    const prompt: McpPromptInfo = {
      name: 'summarize',
      description: 'Summarize a document',
      serverName: 'docs-server',
    };

    const skill = mcpPromptToSkill(prompt);
    expect(skill.name).toBe('mcp:docs-server:summarize');
    expect(skill.description).toBe('Summarize a document');
    expect(skill.source).toBe('mcp');
    expect(skill.installPath).toBe('mcp://docs-server/summarize');
    expect(skill.gatesPassed).toBe(true);
    expect(skill.disableModelInvocation).toBe(false);
    expect(skill.executionMode).toBe('inline');
  });

  it('无 description 时使用默认值', () => {
    const prompt: McpPromptInfo = {
      name: 'test',
      serverName: 'my-server',
    };
    const skill = mcpPromptToSkill(prompt);
    expect(skill.description).toBe('MCP prompt from my-server');
  });
});

describe('bridgeAllMcpPrompts', () => {
  it('批量转换', () => {
    const prompts: McpPromptInfo[] = [
      { name: 'a', description: 'Prompt A', serverName: 'server1' },
      { name: 'b', description: 'Prompt B', serverName: 'server2' },
    ];
    const skills = bridgeAllMcpPrompts(prompts);
    expect(skills).toHaveLength(2);
    expect(skills[0].name).toBe('mcp:server1:a');
    expect(skills[1].name).toBe('mcp:server2:b');
  });

  it('空列表返回空数组', () => {
    expect(bridgeAllMcpPrompts([])).toEqual([]);
  });
});
