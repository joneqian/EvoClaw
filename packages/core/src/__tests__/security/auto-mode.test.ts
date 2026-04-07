import { describe, it, expect } from 'vitest';
import { isSafeAutoTool, isPermissiveWorkspaceTool } from '../../security/auto-mode.js';

describe('auto-mode', () => {
  describe('isSafeAutoTool', () => {
    it('只读工具在白名单中', () => {
      expect(isSafeAutoTool('read')).toBe(true);
      expect(isSafeAutoTool('ls')).toBe(true);
      expect(isSafeAutoTool('find')).toBe(true);
      expect(isSafeAutoTool('grep')).toBe(true);
      expect(isSafeAutoTool('image')).toBe(true);
      expect(isSafeAutoTool('pdf')).toBe(true);
    });

    it('Agent 管理工具在白名单中', () => {
      expect(isSafeAutoTool('spawn_agent')).toBe(true);
      expect(isSafeAutoTool('list_agents')).toBe(true);
      expect(isSafeAutoTool('kill_agent')).toBe(true);
    });

    it('写操作不在白名单中', () => {
      expect(isSafeAutoTool('write')).toBe(false);
      expect(isSafeAutoTool('edit')).toBe(false);
      expect(isSafeAutoTool('bash')).toBe(false);
    });
  });

  describe('isPermissiveWorkspaceTool', () => {
    it('写操作工具在 permissive 列表中', () => {
      expect(isPermissiveWorkspaceTool('write')).toBe(true);
      expect(isPermissiveWorkspaceTool('edit')).toBe(true);
      expect(isPermissiveWorkspaceTool('apply_patch')).toBe(true);
      expect(isPermissiveWorkspaceTool('bash')).toBe(true);
    });

    it('只读工具不在 permissive 列表中', () => {
      expect(isPermissiveWorkspaceTool('read')).toBe(false);
      expect(isPermissiveWorkspaceTool('grep')).toBe(false);
    });
  });
});
