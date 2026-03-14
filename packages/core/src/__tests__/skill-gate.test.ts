import { describe, it, expect } from 'vitest';
import { checkGates, allGatesPassed } from '../skill/skill-gate.js';
import type { SkillMetadata } from '@evoclaw/shared';

describe('skill-gate', () => {
  describe('checkGates', () => {
    it('无 requires 字段时返回空数组', () => {
      const metadata: SkillMetadata = {
        name: 'test',
        description: 'test',
      };
      expect(checkGates(metadata)).toEqual([]);
    });

    it('应检测已存在的二进制工具（node）', () => {
      const metadata: SkillMetadata = {
        name: 'test',
        description: 'test',
        requires: { bins: ['node'] },
      };
      const results = checkGates(metadata);
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('bin');
      expect(results[0].name).toBe('node');
      expect(results[0].satisfied).toBe(true);
    });

    it('应检测不存在的二进制工具', () => {
      const metadata: SkillMetadata = {
        name: 'test',
        description: 'test',
        requires: { bins: ['nonexistent_binary_xyz_12345'] },
      };
      const results = checkGates(metadata);
      expect(results).toHaveLength(1);
      expect(results[0].satisfied).toBe(false);
      expect(results[0].message).toContain('未找到命令');
    });

    it('应检测环境变量', () => {
      // PATH 始终存在
      const metadata: SkillMetadata = {
        name: 'test',
        description: 'test',
        requires: { env: ['PATH', 'NONEXISTENT_VAR_XYZ'] },
      };
      const results = checkGates(metadata);
      expect(results).toHaveLength(2);
      expect(results[0].satisfied).toBe(true);
      expect(results[1].satisfied).toBe(false);
    });

    it('应检测操作系统', () => {
      const metadata: SkillMetadata = {
        name: 'test',
        description: 'test',
        requires: { os: ['macos', 'linux'] },
      };
      const results = checkGates(metadata);
      expect(results).toHaveLength(1);
      // macOS 上应通过
      if (process.platform === 'darwin') {
        expect(results[0].satisfied).toBe(true);
      }
    });

    it('不匹配的 OS 应返回 false', () => {
      const metadata: SkillMetadata = {
        name: 'test',
        description: 'test',
        requires: { os: ['plan9'] },
      };
      const results = checkGates(metadata);
      expect(results[0].satisfied).toBe(false);
      expect(results[0].message).toContain('不在支持列表');
    });
  });

  describe('allGatesPassed', () => {
    it('空结果返回 true', () => {
      expect(allGatesPassed([])).toBe(true);
    });

    it('全部通过返回 true', () => {
      expect(allGatesPassed([
        { type: 'bin', name: 'node', satisfied: true },
        { type: 'env', name: 'PATH', satisfied: true },
      ])).toBe(true);
    });

    it('有一个未通过返回 false', () => {
      expect(allGatesPassed([
        { type: 'bin', name: 'node', satisfied: true },
        { type: 'bin', name: 'missing', satisfied: false },
      ])).toBe(false);
    });
  });
});
