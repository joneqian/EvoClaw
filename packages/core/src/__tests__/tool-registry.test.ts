import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createToolRegistryPlugin, refreshSkillCache, getLoadedSkills } from '../context/plugins/tool-registry.js';
import type { TurnContext, BootstrapContext } from '../context/plugin.interface.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('tool-registry plugin', () => {
  let tempUserDir: string;
  let tempAgentDir: string;
  const agentId = 'test-agent-1';

  beforeEach(() => {
    tempUserDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-registry-user-'));
    tempAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-registry-agent-'));
    refreshSkillCache(agentId);
  });

  afterEach(() => {
    fs.rmSync(tempUserDir, { recursive: true, force: true });
    fs.rmSync(tempAgentDir, { recursive: true, force: true });
  });

  function createPlugin() {
    return createToolRegistryPlugin({
      paths: {
        userDir: tempUserDir,
        agentDirTemplate: path.join(tempAgentDir, '{agentId}', 'skills'),
        bundledDir: path.join(os.tmpdir(), 'nonexistent-bundled-dir'),
      },
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

  it('应有正确的 name 和 priority', () => {
    const plugin = createPlugin();
    expect(plugin.name).toBe('tool-registry');
    expect(plugin.priority).toBe(60);
  });

  it('无 Skill 时 beforeTurn 不注入', async () => {
    const plugin = createPlugin();
    const ctx = makeTurnCtx();

    await plugin.bootstrap!(makeBootstrapCtx());
    await plugin.beforeTurn!(ctx);

    expect(ctx.injectedContext).toHaveLength(0);
  });

  it('有 Skill 时 beforeTurn 应注入 XML 目录', async () => {
    // 创建一个 Skill
    const skillDir = path.join(tempUserDir, 'test-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: test-skill
description: A test skill for testing
version: 1.0.0
---

Use Read tool.`);

    const plugin = createPlugin();
    const ctx = makeTurnCtx();

    await plugin.bootstrap!(makeBootstrapCtx());
    await plugin.beforeTurn!(ctx);

    expect(ctx.injectedContext).toHaveLength(1);
    expect(ctx.injectedContext[0]).toContain('<available_skills>');
    expect(ctx.injectedContext[0]).toContain('test-skill');
    expect(ctx.injectedContext[0]).toContain('A test skill for testing');
    expect(ctx.injectedContext[0]).toContain('</available_skills>');
    expect(ctx.estimatedTokens).toBeGreaterThan(0);
  });

  it('disable-model-invocation 的 Skill 不应出现在目录中', async () => {
    const skillDir = path.join(tempUserDir, 'hidden-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: hidden-skill
description: A hidden skill
disable-model-invocation: true
---

Only manual.`);

    const plugin = createPlugin();
    const ctx = makeTurnCtx();

    await plugin.bootstrap!(makeBootstrapCtx());
    await plugin.beforeTurn!(ctx);

    // 不应注入（唯一的 skill 被过滤了）
    expect(ctx.injectedContext).toHaveLength(0);
  });

  it('Agent 级 Skill 应覆盖用户级同名 Skill', async () => {
    // 用户级 Skill
    const userSkillDir = path.join(tempUserDir, 'override-skill');
    fs.mkdirSync(userSkillDir, { recursive: true });
    fs.writeFileSync(path.join(userSkillDir, 'SKILL.md'), `---
name: override-skill
description: User level version
---

User version.`);

    // Agent 级 Skill
    const agentSkillDir = path.join(tempAgentDir, agentId, 'skills', 'override-skill');
    fs.mkdirSync(agentSkillDir, { recursive: true });
    fs.writeFileSync(path.join(agentSkillDir, 'SKILL.md'), `---
name: override-skill
description: Agent level version
---

Agent version.`);

    const plugin = createPlugin();
    await plugin.bootstrap!(makeBootstrapCtx());

    const loaded = getLoadedSkills(agentId);
    const matched = loaded.filter(s => s.name === 'override-skill');
    expect(matched).toHaveLength(1);
    expect(matched[0].description).toBe('Agent level version');
  });

  it('refreshSkillCache 应清除缓存', async () => {
    const skillDir = path.join(tempUserDir, 'refresh-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: refresh-skill
description: Will be removed
---

Remove me.`);

    const plugin = createPlugin();
    await plugin.bootstrap!(makeBootstrapCtx());
    expect(getLoadedSkills(agentId).length).toBe(1);

    // 删除并刷新
    fs.rmSync(skillDir, { recursive: true, force: true });
    refreshSkillCache(agentId);

    // 下次 beforeTurn 应重新扫描
    const ctx = makeTurnCtx();
    await plugin.beforeTurn!(ctx);
    expect(ctx.injectedContext).toHaveLength(0);
  });
});
