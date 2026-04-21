import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSkillManageTool } from '../skill/skill-manage-tool.js';
import { readManifest, computeSkillHash } from '../skill/skill-manifest.js';

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function validSkill(name: string, body = 'body content'): string {
  return `---\nname: ${name}\ndescription: test description\n---\n\n${body}\n`;
}

async function call(
  tool: ReturnType<typeof createSkillManageTool>,
  args: Record<string, unknown>,
): Promise<{ success: boolean; error?: string; scan?: { riskLevel: string; findings: number }; path?: string; action?: string; name?: string }> {
  const raw = await tool.execute(args);
  return JSON.parse(raw);
}

describe('skill-manage-tool', () => {
  let userSkillsDir: string;
  let refreshedAgents: string[];
  let tool: ReturnType<typeof createSkillManageTool>;

  beforeEach(() => {
    userSkillsDir = mkTmpDir('skill-manage-test-');
    refreshedAgents = [];
    tool = createSkillManageTool({
      userSkillsDir,
      agentId: 'test-agent',
      refreshCache: (id) => refreshedAgents.push(id),
    });
  });

  afterEach(() => {
    fs.rmSync(userSkillsDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('合法参数 → 写入 + manifest + refreshCache', async () => {
      const r = await call(tool, {
        action: 'create',
        name: 'my-tool',
        content: validSkill('my-tool'),
      });
      expect(r.success).toBe(true);
      expect(r.scan?.riskLevel).toBe('low');
      expect(fs.existsSync(path.join(userSkillsDir, 'my-tool', 'SKILL.md'))).toBe(true);
      expect(readManifest(userSkillsDir).get('my-tool')?.source).toBe('agent-created');
      expect(refreshedAgents).toEqual(['test-agent']);
    });

    it('名字包含大写 → Zod 拒绝', async () => {
      const r = await call(tool, {
        action: 'create',
        name: 'MyTool',
        content: validSkill('mytool'),
      });
      expect(r.success).toBe(false);
      expect(r.error).toContain('参数校验失败');
    });

    it('名字含路径遍历 → Zod 拒绝', async () => {
      const r = await call(tool, {
        action: 'create',
        name: '../evil',
        content: validSkill('evil'),
      });
      expect(r.success).toBe(false);
    });

    it('content 含 eval → high 风险拒绝', async () => {
      const r = await call(tool, {
        action: 'create',
        name: 'bad-skill',
        content: validSkill('bad-skill', 'Use eval(userInput) here'),
      });
      expect(r.success).toBe(false);
      expect(r.scan?.riskLevel).toBe('high');
      expect(fs.existsSync(path.join(userSkillsDir, 'bad-skill'))).toBe(false);
    });

    it('content 缺失 → error', async () => {
      const r = await call(tool, { action: 'create', name: 'x-skill' });
      expect(r.success).toBe(false);
      expect(r.error).toContain('content');
    });

    it('frontmatter name 与参数 name 不一致 → 拒绝', async () => {
      const r = await call(tool, {
        action: 'create',
        name: 'actual',
        content: validSkill('wrong-name'),
      });
      expect(r.success).toBe(false);
    });

    it('已存在 → 拒绝', async () => {
      await call(tool, { action: 'create', name: 'dupe', content: validSkill('dupe') });
      const r = await call(tool, { action: 'create', name: 'dupe', content: validSkill('dupe', 'v2') });
      expect(r.success).toBe(false);
      expect(r.error).toContain('已存在');
    });
  });

  describe('edit', () => {
    it('修改现有 → 写入 + .bak + manifest hash 更新', async () => {
      await call(tool, { action: 'create', name: 's1', content: validSkill('s1', 'original') });
      const originalHash = readManifest(userSkillsDir).get('s1')?.sha256;

      const r = await call(tool, {
        action: 'edit',
        name: 's1',
        content: validSkill('s1', 'updated'),
      });
      expect(r.success).toBe(true);
      expect(fs.existsSync(path.join(userSkillsDir, 's1', 'SKILL.md.bak'))).toBe(true);
      expect(fs.readFileSync(path.join(userSkillsDir, 's1', 'SKILL.md'), 'utf-8')).toContain('updated');
      const newHash = readManifest(userSkillsDir).get('s1')?.sha256;
      expect(newHash).not.toBe(originalHash);
    });

    it('不存在 → error', async () => {
      const r = await call(tool, {
        action: 'edit',
        name: 'absent',
        content: validSkill('absent'),
      });
      expect(r.success).toBe(false);
      expect(r.error).toContain('不存在');
    });

    it('high 风险 → 拒绝 + 原文件不动', async () => {
      await call(tool, { action: 'create', name: 's2', content: validSkill('s2', 'safe') });
      const r = await call(tool, {
        action: 'edit',
        name: 's2',
        content: validSkill('s2', 'eval(x)'),
      });
      expect(r.success).toBe(false);
      const current = fs.readFileSync(path.join(userSkillsDir, 's2', 'SKILL.md'), 'utf-8');
      expect(current).toContain('safe');
    });
  });

  describe('patch', () => {
    it('精确子串匹配 → 替换', async () => {
      await call(tool, { action: 'create', name: 'p1', content: validSkill('p1', 'old marker here') });
      const r = await call(tool, {
        action: 'patch',
        name: 'p1',
        patch_old: 'old marker',
        patch_new: 'new marker',
      });
      expect(r.success).toBe(true);
      const content = fs.readFileSync(path.join(userSkillsDir, 'p1', 'SKILL.md'), 'utf-8');
      expect(content).toContain('new marker');
    });

    it('patch_old 不匹配 → error', async () => {
      await call(tool, { action: 'create', name: 'p2', content: validSkill('p2') });
      const r = await call(tool, {
        action: 'patch',
        name: 'p2',
        patch_old: 'nonexistent',
        patch_new: 'xxx',
      });
      expect(r.success).toBe(false);
      expect(r.error).toContain('不是当前 SKILL.md 的子串');
    });

    it('patch_old 出现多次 → error（避免歧义替换）', async () => {
      await call(tool, {
        action: 'create',
        name: 'p3',
        content: validSkill('p3', 'foo bar foo'),
      });
      const r = await call(tool, {
        action: 'patch',
        name: 'p3',
        patch_old: 'foo',
        patch_new: 'qux',
      });
      expect(r.success).toBe(false);
      expect(r.error).toContain('多次');
    });

    it('patch 后引入 high 风险 → 拒绝', async () => {
      await call(tool, { action: 'create', name: 'p4', content: validSkill('p4', 'body-text') });
      const r = await call(tool, {
        action: 'patch',
        name: 'p4',
        patch_old: 'body-text',
        patch_new: 'eval(x)',
      });
      expect(r.success).toBe(false);
      const content = fs.readFileSync(path.join(userSkillsDir, 'p4', 'SKILL.md'), 'utf-8');
      expect(content).not.toContain('eval(x)');
    });
  });

  describe('delete', () => {
    it('confirm=false → 拒绝', async () => {
      await call(tool, { action: 'create', name: 'd1', content: validSkill('d1') });
      const r = await call(tool, { action: 'delete', name: 'd1', confirm: false });
      expect(r.success).toBe(false);
      expect(r.error).toContain('confirm');
      expect(fs.existsSync(path.join(userSkillsDir, 'd1'))).toBe(true);
    });

    it('confirm=true → 删除 + manifest 清理', async () => {
      await call(tool, { action: 'create', name: 'd2', content: validSkill('d2') });
      const r = await call(tool, { action: 'delete', name: 'd2', confirm: true });
      expect(r.success).toBe(true);
      expect(fs.existsSync(path.join(userSkillsDir, 'd2'))).toBe(false);
      expect(readManifest(userSkillsDir).has('d2')).toBe(false);
    });

    it('不存在 → error', async () => {
      const r = await call(tool, { action: 'delete', name: 'gone', confirm: true });
      expect(r.success).toBe(false);
      expect(r.error).toContain('不存在');
    });
  });

  describe('content 上限', () => {
    it('>32 KiB → Zod 拒绝', async () => {
      const bigBody = 'x'.repeat(33 * 1024);
      const r = await call(tool, {
        action: 'create',
        name: 'big',
        content: validSkill('big', bigBody),
      });
      expect(r.success).toBe(false);
      expect(r.error).toContain('参数校验失败');
    });
  });

  describe('manifest 同步', () => {
    it('create 写入的 hash 与文件内容一致', async () => {
      const content = validSkill('hash-check', 'exact body');
      await call(tool, { action: 'create', name: 'hash-check', content });
      const entry = readManifest(userSkillsDir).get('hash-check');
      expect(entry?.sha256).toBe(computeSkillHash(content));
    });
  });
});
