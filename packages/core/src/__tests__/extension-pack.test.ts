import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

describe('extension-pack', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-pack-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('pack-parser', () => {
    it('应解析有效的扩展包 ZIP', async () => {
      const { parseExtensionPack } = await import('../extension-pack/pack-parser.js');

      // 创建扩展包结构
      const packDir = path.join(tempDir, 'pack');
      fs.mkdirSync(path.join(packDir, 'skills', 'test-skill'), { recursive: true });
      fs.writeFileSync(path.join(packDir, 'skills', 'test-skill', 'SKILL.md'), `---
name: test-skill
description: A test skill
---

Do something.`);
      fs.writeFileSync(path.join(packDir, 'evoclaw-pack.json'), JSON.stringify({
        manifestVersion: 1,
        name: 'test-pack',
        description: 'Test extension pack',
        version: '1.0.0',
        skills: ['test-skill'],
      }));

      // 打包为 ZIP
      const zipPath = path.join(tempDir, 'test.zip');
      execSync(`cd "${packDir}" && zip -r "${zipPath}" .`);

      const result = await parseExtensionPack(zipPath);
      expect(result.errors).toHaveLength(0);
      expect(result.manifest.name).toBe('test-pack');
      expect(result.manifest.version).toBe('1.0.0');
      expect(result.skillDirs).toHaveLength(1);

      // 清理
      fs.rmSync(result.tempDir, { recursive: true, force: true });
    });

    it('缺少 manifest 应报错', async () => {
      const { parseExtensionPack } = await import('../extension-pack/pack-parser.js');

      // 空 ZIP
      const packDir = path.join(tempDir, 'empty');
      fs.mkdirSync(packDir, { recursive: true });
      fs.writeFileSync(path.join(packDir, 'dummy.txt'), 'hello');
      const zipPath = path.join(tempDir, 'empty.zip');
      execSync(`cd "${packDir}" && zip -r "${zipPath}" .`);

      const result = await parseExtensionPack(zipPath);
      expect(result.errors.some(e => e.includes('evoclaw-pack.json'))).toBe(true);

      fs.rmSync(result.tempDir, { recursive: true, force: true });
    });
  });

  describe('pack-registry', () => {
    it('注册和列出扩展包', async () => {
      // 动态导入以避免全局状态污染
      // 注意: 注册表路径是固定的，此测试在 CI 中可能有副作用
      const { registerInstalledPack, listInstalledPacks, unregisterPack } = await import('../extension-pack/pack-registry.js');

      const testPack = {
        name: `_test_pack_${Date.now()}`,
        version: '1.0.0',
        description: 'Test',
        installedAt: new Date().toISOString(),
        skills: ['skill-a'],
        mcpServers: [],
      };

      registerInstalledPack(testPack);
      const list = listInstalledPacks();
      expect(list.some(p => p.name === testPack.name)).toBe(true);

      // 清理
      unregisterPack(testPack.name);
      const listAfter = listInstalledPacks();
      expect(listAfter.some(p => p.name === testPack.name)).toBe(false);
    });
  });
});
