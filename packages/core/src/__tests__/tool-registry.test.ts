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

  // ─── G3: argument-hint XML 注入 ───
  it('G3: argument-hint 应注入到 XML 目录的 <argument-hint> 子节点', async () => {
    const skillDir = path.join(tempUserDir, 'report-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: report-skill
description: Generate weekly report
argument-hint: "month=4 week=1"
arguments:
  - month
  - week
---

Generate report for \${month} month week \${week}.`);

    const plugin = createPlugin();
    const ctx = makeTurnCtx();

    await plugin.bootstrap!(makeBootstrapCtx());
    await plugin.beforeTurn!(ctx);

    expect(ctx.injectedContext).toHaveLength(1);
    const catalog = ctx.injectedContext[0];
    expect(catalog).toContain('<argument-hint>month=4 week=1</argument-hint>');
    expect(catalog).toContain('<arguments>month, week</arguments>');
  });

  // ─── G1: Bundled 技能预算豁免 ───
  describe('G1: Bundled 预算豁免', () => {
    let tempBundledDir: string;

    beforeEach(() => {
      tempBundledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-registry-bundled-'));
      refreshSkillCache(agentId);
    });

    afterEach(() => {
      fs.rmSync(tempBundledDir, { recursive: true, force: true });
    });

    function createPluginWithBundled() {
      return createToolRegistryPlugin({
        paths: {
          userDir: tempUserDir,
          agentDirTemplate: path.join(tempAgentDir, '{agentId}', 'skills'),
          bundledDir: tempBundledDir,
        },
      });
    }

    /** 创建一个技能目录 + SKILL.md */
    function writeSkill(baseDir: string, name: string, descLen = 120): void {
      const skillDir = path.join(baseDir, name);
      fs.mkdirSync(skillDir, { recursive: true });
      const description = `desc_${name}_` + 'x'.repeat(Math.max(0, descLen - name.length - 5));
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: ${name}
description: ${description}
---

Body for ${name}.`);
    }

    it('预算充足时 bundled 和 user 技能都以 full 模式注入', async () => {
      writeSkill(tempBundledDir, 'bundled-a');
      writeSkill(tempBundledDir, 'bundled-b');
      writeSkill(tempUserDir, 'user-a');

      const plugin = createPluginWithBundled();
      const ctx = makeTurnCtx();

      await plugin.bootstrap!(makeBootstrapCtx());
      await plugin.beforeTurn!(ctx);

      expect(ctx.injectedContext).toHaveLength(1);
      const catalog = ctx.injectedContext[0];
      // 三个技能都在完整模式（含 description）
      expect(catalog).toContain('<description>');
      expect(catalog).toContain('bundled-a');
      expect(catalog).toContain('bundled-b');
      expect(catalog).toContain('user-a');
    });

    it('预算不足时 bundled 始终以 full 模式保留，others 降级或截断', async () => {
      // 200 个 user 技能 + 32 个 bundled 技能（模拟 EvoClaw 实际场景）
      for (let i = 0; i < 32; i++) {
        writeSkill(tempBundledDir, `bundled-${String(i).padStart(2, '0')}`, 200);
      }
      for (let i = 0; i < 200; i++) {
        writeSkill(tempUserDir, `user-${String(i).padStart(3, '0')}`, 200);
      }

      const plugin = createPluginWithBundled();
      const ctx = makeTurnCtx();

      await plugin.bootstrap!(makeBootstrapCtx());
      await plugin.beforeTurn!(ctx);

      expect(ctx.injectedContext).toHaveLength(1);
      const catalog = ctx.injectedContext[0];

      // 断言 1：所有 bundled 技能都出现
      for (let i = 0; i < 32; i++) {
        const bundledName = `bundled-${String(i).padStart(2, '0')}`;
        expect(
          catalog.includes(`<name>${bundledName}</name>`),
          `bundled 技能 ${bundledName} 必须保留`,
        ).toBe(true);
      }

      // 断言 2：所有 bundled 技能以 full 模式（含 description）存在
      // 具体检查每个 bundled 条目后面跟着 <description>
      for (let i = 0; i < 32; i++) {
        const bundledName = `bundled-${String(i).padStart(2, '0')}`;
        const pattern = new RegExp(
          `<name>${bundledName}</name>\\s*\\n\\s*<description>`,
          'm',
        );
        expect(
          pattern.test(catalog),
          `bundled 技能 ${bundledName} 必须以 full 模式（含 description）存在`,
        ).toBe(true);
      }
    });

    it('极端情况：bundled 占满预算时 others 可被完全舍弃但 bundled 保留', async () => {
      // 创建超大 bundled 技能池（单技能 description 接近 1000 字符）
      // 使 bundled 足以占满 30k 预算
      for (let i = 0; i < 100; i++) {
        writeSkill(tempBundledDir, `big-bundled-${String(i).padStart(3, '0')}`, 1000);
      }
      writeSkill(tempUserDir, 'victim-user-skill');

      const plugin = createPluginWithBundled();
      const ctx = makeTurnCtx();

      await plugin.bootstrap!(makeBootstrapCtx());
      await plugin.beforeTurn!(ctx);

      expect(ctx.injectedContext).toHaveLength(1);
      const catalog = ctx.injectedContext[0];

      // bundled 技能（至少一部分）必须存在
      // 由于 MAX_SKILLS_IN_PROMPT=150 也会先截断，这里 100 < 150 所以不会被截断
      expect(catalog).toContain('big-bundled-000');
      expect(catalog).toContain('big-bundled-099');
    });
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
