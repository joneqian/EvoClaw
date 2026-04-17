/**
 * M5 T4: Skill 安全策略生产接线验证
 *
 * 验证 createToolRegistryPlugin 注入的 securityPolicy（由 IT 管理员通过
 * configManager.security.skills 配置）在 beforeTurn 过滤 <available_skills>。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createToolRegistryPlugin, refreshSkillCache } from '../../context/plugins/tool-registry.js';
import type { TurnContext, BootstrapContext } from '../../context/plugin.interface.js';
import type { NameSecurityPolicy } from '@evoclaw/shared';

describe('M5 T4 — tool-registry.securityPolicy 生产接线', () => {
  let tempUserDir: string;
  let tempAgentDir: string;
  const agentId = 'test-agent-t4-policy';

  beforeEach(() => {
    tempUserDir = fs.mkdtempSync(path.join(os.tmpdir(), 't4-user-'));
    tempAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), 't4-agent-'));
    refreshSkillCache(agentId);
    // 放三个本地 skill
    for (const name of ['alpha', 'beta', 'gamma']) {
      const dir = path.join(tempUserDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'SKILL.md'),
        `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${name} body.`,
      );
    }
  });

  afterEach(() => {
    fs.rmSync(tempUserDir, { recursive: true, force: true });
    fs.rmSync(tempAgentDir, { recursive: true, force: true });
    refreshSkillCache(agentId);
  });

  function makePlugin(securityPolicy?: NameSecurityPolicy) {
    return createToolRegistryPlugin({
      paths: {
        userDir: tempUserDir,
        agentDirTemplate: path.join(tempAgentDir, '{agentId}', 'skills'),
        bundledDir: path.join(os.tmpdir(), 'nonexistent-t4-bundled'),
      },
      securityPolicy,
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
      messages: [{ id: '1', conversationId: 'c1', role: 'user', content: 'hi', createdAt: '' }],
      systemPrompt: '',
      injectedContext: [],
      warnings: [],
      estimatedTokens: 0,
      tokenLimit: 100000,
    };
  }

  it('未注入 securityPolicy 时所有 skill 均进入目录（baseline）', async () => {
    const plugin = makePlugin(undefined);
    const ctx = makeTurnCtx();

    await plugin.bootstrap!(makeBootstrapCtx());
    await plugin.beforeTurn!(ctx);

    const catalog = ctx.injectedContext[0] ?? '';
    expect(catalog).toContain('alpha');
    expect(catalog).toContain('beta');
    expect(catalog).toContain('gamma');
  });

  it('denylist 命中的 skill 不出现在 available_skills 目录', async () => {
    const plugin = makePlugin({ denylist: ['beta'] });
    const ctx = makeTurnCtx();

    await plugin.bootstrap!(makeBootstrapCtx());
    await plugin.beforeTurn!(ctx);

    const catalog = ctx.injectedContext[0] ?? '';
    expect(catalog).toContain('alpha');
    expect(catalog).not.toContain('beta');
    expect(catalog).toContain('gamma');
  });

  it('allowlist 配置时仅允许的 skill 出现在目录', async () => {
    const plugin = makePlugin({ allowlist: ['alpha'] });
    const ctx = makeTurnCtx();

    await plugin.bootstrap!(makeBootstrapCtx());
    await plugin.beforeTurn!(ctx);

    const catalog = ctx.injectedContext[0] ?? '';
    expect(catalog).toContain('alpha');
    expect(catalog).not.toContain('beta');
    expect(catalog).not.toContain('gamma');
  });

  it('denylist 优先于 allowlist（即使同时命中也拒绝）', async () => {
    const plugin = makePlugin({ allowlist: ['alpha', 'beta'], denylist: ['beta'] });
    const ctx = makeTurnCtx();

    await plugin.bootstrap!(makeBootstrapCtx());
    await plugin.beforeTurn!(ctx);

    const catalog = ctx.injectedContext[0] ?? '';
    expect(catalog).toContain('alpha');
    expect(catalog).not.toContain('beta');
    expect(catalog).not.toContain('gamma');
  });

  it('空 policy 对象等价于无策略（所有 skill 通过）', async () => {
    const plugin = makePlugin({});
    const ctx = makeTurnCtx();

    await plugin.bootstrap!(makeBootstrapCtx());
    await plugin.beforeTurn!(ctx);

    const catalog = ctx.injectedContext[0] ?? '';
    expect(catalog).toContain('alpha');
    expect(catalog).toContain('beta');
    expect(catalog).toContain('gamma');
  });
});
