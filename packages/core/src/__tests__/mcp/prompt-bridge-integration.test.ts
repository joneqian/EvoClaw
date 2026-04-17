/**
 * M4 T1 集成测试：MCP Prompt → Skill 桥接接线
 *
 * 验证 createToolRegistryPlugin 注入 mcpPromptsProvider 后，
 * MCP prompts 作为 `mcp:{serverName}:{promptName}` 出现在 <available_skills> 目录。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createToolRegistryPlugin, refreshSkillCache } from '../../context/plugins/tool-registry.js';
import type { TurnContext, BootstrapContext } from '../../context/plugin.interface.js';
import type { InstalledSkill } from '@evoclaw/shared';
import { bridgeAllMcpPrompts, type McpPromptInfo } from '../../mcp/mcp-prompt-bridge.js';

describe('MCP prompt bridge 接线到 tool-registry', () => {
  let tempUserDir: string;
  let tempAgentDir: string;
  const agentId = 'test-agent-mcp-bridge';

  beforeEach(() => {
    tempUserDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bridge-user-'));
    tempAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bridge-agent-'));
    refreshSkillCache(agentId);
  });

  afterEach(() => {
    fs.rmSync(tempUserDir, { recursive: true, force: true });
    fs.rmSync(tempAgentDir, { recursive: true, force: true });
  });

  function createPlugin(mcpPromptsProvider?: () => InstalledSkill[]) {
    return createToolRegistryPlugin({
      paths: {
        userDir: tempUserDir,
        agentDirTemplate: path.join(tempAgentDir, '{agentId}', 'skills'),
        bundledDir: path.join(os.tmpdir(), 'nonexistent-bundled-dir-mcp-bridge'),
      },
      mcpPromptsProvider,
    });
  }

  function makeBootstrapCtx(): BootstrapContext {
    return {
      agentId,
      sessionKey: `agent:${agentId}:local:dm:user1`,
      workspacePath: '/tmp/workspace',
    };
  }

  function makeTurnCtx(): TurnContext {
    return {
      agentId,
      sessionKey: `agent:${agentId}:local:dm:user1`,
      messages: [{ id: '1', conversationId: 'c1', role: 'user', content: 'hello', createdAt: '' }],
      systemPrompt: '',
      injectedContext: [],
      warnings: [],
      estimatedTokens: 0,
      tokenLimit: 100000,
    };
  }

  it('mcpPromptsProvider 返回的 prompts 被合并进 <available_skills> 目录', async () => {
    const mcpPrompts: McpPromptInfo[] = [
      { name: 'summarize', description: 'Summarize text', serverName: 'docs' },
      { name: 'translate', description: 'Translate text', serverName: 'docs' },
    ];

    const plugin = createPlugin(() => bridgeAllMcpPrompts(mcpPrompts));
    const ctx = makeTurnCtx();

    await plugin.bootstrap!(makeBootstrapCtx());
    await plugin.beforeTurn!(ctx);

    expect(ctx.injectedContext).toHaveLength(1);
    const catalog = ctx.injectedContext[0];
    expect(catalog).toContain('<available_skills>');
    expect(catalog).toContain('mcp:docs:summarize');
    expect(catalog).toContain('mcp:docs:translate');
    expect(catalog).toContain('Summarize text');
    expect(catalog).toContain('Translate text');
  });

  it('未提供 mcpPromptsProvider 时目录不受影响（无 MCP 条目）', async () => {
    // 放一个本地技能，保证 activeSkills 非空 → 才会生成目录
    const skillDir = path.join(tempUserDir, 'local-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: local-skill
description: A local skill only
---

Local.`);

    const plugin = createPlugin(/* 无 provider */);
    const ctx = makeTurnCtx();

    await plugin.bootstrap!(makeBootstrapCtx());
    await plugin.beforeTurn!(ctx);

    expect(ctx.injectedContext).toHaveLength(1);
    const catalog = ctx.injectedContext[0];
    expect(catalog).toContain('local-skill');
    expect(catalog).not.toContain('mcp:');
  });

  it('mcpPromptsProvider 返回空数组时不追加任何 MCP 条目', async () => {
    const skillDir = path.join(tempUserDir, 'solo-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: solo-skill
description: Solo
---

Solo.`);

    const plugin = createPlugin(() => []);
    const ctx = makeTurnCtx();

    await plugin.bootstrap!(makeBootstrapCtx());
    await plugin.beforeTurn!(ctx);

    expect(ctx.injectedContext).toHaveLength(1);
    const catalog = ctx.injectedContext[0];
    expect(catalog).toContain('solo-skill');
    expect(catalog).not.toContain('mcp:');
  });

  it('本地 skill 与 MCP prompt 同名时本地优先（回归保护）', async () => {
    // 本地 skill 名字故意取为 mcp:x:dup 来模拟冲突
    const skillDir = path.join(tempUserDir, 'dup-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: mcp:x:dup
description: Local wins
---

Local.`);

    const mcpPrompts: McpPromptInfo[] = [
      { name: 'dup', description: 'MCP loses', serverName: 'x' },
      { name: 'unique', description: 'MCP unique', serverName: 'x' },
    ];

    const plugin = createPlugin(() => bridgeAllMcpPrompts(mcpPrompts));
    const ctx = makeTurnCtx();

    await plugin.bootstrap!(makeBootstrapCtx());
    await plugin.beforeTurn!(ctx);

    const catalog = ctx.injectedContext[0];
    // 同名冲突：本地版本胜出
    expect(catalog).toContain('Local wins');
    expect(catalog).not.toContain('MCP loses');
    // 非冲突的 MCP prompt 仍被注入
    expect(catalog).toContain('mcp:x:unique');
    expect(catalog).toContain('MCP unique');
  });

  it('mcpPromptsProvider 每轮重算（runtime 动态可见）', async () => {
    // 模拟 MCP server 在第一轮之后上线 → 第二轮才有 prompts
    let promptsAvailable = false;
    const plugin = createPlugin(() => {
      if (!promptsAvailable) return [];
      return bridgeAllMcpPrompts([
        { name: 'late', description: 'Loaded later', serverName: 'srv' },
      ]);
    });

    await plugin.bootstrap!(makeBootstrapCtx());

    // 第 1 轮：MCP 还没 ready
    // 放一个本地 skill 让第一轮产生 catalog
    const skillDir = path.join(tempUserDir, 'anchor');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: anchor
description: anchor
---

anchor.`);
    refreshSkillCache(agentId);

    const ctx1 = makeTurnCtx();
    await plugin.beforeTurn!(ctx1);
    expect(ctx1.injectedContext[0]).not.toContain('mcp:srv:late');

    // 第 2 轮：MCP 上线
    promptsAvailable = true;
    const ctx2 = makeTurnCtx();
    await plugin.beforeTurn!(ctx2);
    expect(ctx2.injectedContext[0]).toContain('mcp:srv:late');
  });
});
