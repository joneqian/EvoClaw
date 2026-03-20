import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SkillDiscoverer } from '../skill/skill-discoverer.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('skill-discoverer', () => {
  let tempDir: string;
  let discoverer: SkillDiscoverer;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-discoverer-test-'));
    discoverer = new SkillDiscoverer(tempDir);
    // Mock 远程 API 调用，避免网络超时
    vi.spyOn(discoverer, 'browse').mockResolvedValue({ results: [], total: 0 });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('listLocal', () => {
    it('空目录返回空数组', () => {
      const results = discoverer.listLocal();
      expect(results).toEqual([]);
    });

    it('应扫描子目录中的 SKILL.md', () => {
      const skillDir = path.join(tempDir, 'my-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: my-skill
description: A test skill
version: 1.0.0
---

Instructions.`);

      const results = discoverer.listLocal();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('my-skill');
      expect(results[0].description).toBe('A test skill');
      expect(results[0].source).toBe('local');
      expect(results[0].localPath).toBe(skillDir);
    });

    it('应忽略根目录文件（只扫描子目录）', () => {
      fs.writeFileSync(path.join(tempDir, 'quick-skill.md'), `---
name: quick-skill
description: A quick skill
---

Quick instructions.`);

      const results = discoverer.listLocal();
      expect(results).toHaveLength(0); // 根目录文件不扫描
    });

    it('无效 SKILL.md 应用目录名作 fallback', () => {
      const skillDir = path.join(tempDir, 'bad-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'No frontmatter here');

      const results = discoverer.listLocal();
      // 无法解析 frontmatter → 用目录名作为 name
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('bad-skill');
    });

    it('不存在的目录返回空数组', () => {
      const d = new SkillDiscoverer('/nonexistent/path/12345');
      expect(d.listLocal()).toEqual([]);
    });
  });

  describe('search', () => {
    it('应搜索本地 Skill（按名称匹配）', async () => {
      const skillDir = path.join(tempDir, 'docker-deploy');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: docker-deploy
description: Deploy with docker
---

Deploy.`);

      const results = await discoverer.search('docker');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(r => r.name === 'docker-deploy')).toBe(true);
    });

    it('应搜索本地 Skill（按描述匹配）', async () => {
      const skillDir = path.join(tempDir, 'deploy-tool');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: deploy-tool
description: Kubernetes deployment helper
---

K8s deploy.`);

      const results = await discoverer.search('kubernetes');
      expect(results.some(r => r.name === 'deploy-tool')).toBe(true);
    });
  });

  describe('listLocalWithGates', () => {
    it('应返回含门控结果的列表', () => {
      const skillDir = path.join(tempDir, 'gated-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: gated-skill
description: Needs env
---

Instructions.`);

      const results = discoverer.listLocalWithGates();
      expect(results).toHaveLength(1);
      expect(results[0].gatesPassed).toBe(true);
      expect(results[0].gateResults).toEqual([]);
    });
  });
});
