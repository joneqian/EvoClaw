import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillInstaller } from '../skill/skill-installer.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('skill-installer', () => {
  let tempDir: string;
  let installer: SkillInstaller;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-installer-test-'));
    installer = new SkillInstaller(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('confirm', () => {
    it('不存在的 prepareId 应抛出错误', () => {
      expect(() => installer.confirm('nonexistent')).toThrow('未找到待确认的安装');
    });
  });

  describe('cancel', () => {
    it('取消不存在的 prepareId 不抛异常', () => {
      expect(() => installer.cancel('nonexistent')).not.toThrow();
    });
  });

  describe('uninstall', () => {
    it('应卸载已安装的 Skill', () => {
      const skillDir = path.join(tempDir, 'test-skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'content');

      const success = installer.uninstall('test-skill');
      expect(success).toBe(true);
      expect(fs.existsSync(skillDir)).toBe(false);
    });

    it('卸载不存在的 Skill 返回 false', () => {
      const success = installer.uninstall('nonexistent');
      expect(success).toBe(false);
    });

    it('应卸载 Agent 级 Skill', () => {
      const agentSkillDir = path.join(tempDir, '..', 'agents', 'agent1', 'workspace', 'skills', 'test-skill');
      fs.mkdirSync(agentSkillDir, { recursive: true });
      fs.writeFileSync(path.join(agentSkillDir, 'SKILL.md'), 'content');

      const success = installer.uninstall('test-skill', 'agent1');
      expect(success).toBe(true);
      expect(fs.existsSync(agentSkillDir)).toBe(false);
    });
  });
});
