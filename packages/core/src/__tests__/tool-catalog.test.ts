import { describe, it, expect } from 'vitest';
import {
  CORE_TOOLS,
  listToolsBySection,
  getToolMeta,
  getAllToolIds,
  type ToolSection,
} from '../agent/tool-catalog.js';

describe('tool-catalog', () => {
  describe('CORE_TOOLS', () => {
    it('包含所有预期的分区', () => {
      const sections = new Set(CORE_TOOLS.map(t => t.section));
      expect(sections).toEqual(new Set(['fs', 'runtime', 'web', 'memory', 'agent', 'media', 'channel']));
    });

    it('工具 ID 不重复', () => {
      const ids = CORE_TOOLS.map(t => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('每个工具都有 label 和 description', () => {
      for (const tool of CORE_TOOLS) {
        expect(tool.label.length).toBeGreaterThan(0);
        expect(tool.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('listToolsBySection', () => {
    it('返回 fs 分区的工具', () => {
      const fsTools = listToolsBySection('fs');
      expect(fsTools.length).toBeGreaterThanOrEqual(3);
      expect(fsTools.map(t => t.id)).toContain('read');
      expect(fsTools.map(t => t.id)).toContain('write');
      expect(fsTools.map(t => t.id)).toContain('edit');
    });

    it('返回 agent 分区的工具', () => {
      const agentTools = listToolsBySection('agent');
      expect(agentTools.map(t => t.id)).toContain('spawn_agent');
      expect(agentTools.map(t => t.id)).toContain('yield_agents');
    });

    it('返回 channel 分区的工具', () => {
      const channelTools = listToolsBySection('channel');
      expect(channelTools.length).toBeGreaterThanOrEqual(3);
      expect(channelTools.map(t => t.id)).toContain('feishu_send');
      expect(channelTools.map(t => t.id)).toContain('wecom_send');
    });

    it('不存在的分区返回空数组', () => {
      const result = listToolsBySection('nonexistent' as ToolSection);
      expect(result).toEqual([]);
    });
  });

  describe('getToolMeta', () => {
    it('返回已知工具的元数据', () => {
      const meta = getToolMeta('bash');
      expect(meta).toBeDefined();
      expect(meta!.section).toBe('runtime');
      expect(meta!.label).toBe('命令');
    });

    it('未知工具返回 undefined', () => {
      expect(getToolMeta('nonexistent_tool')).toBeUndefined();
    });
  });

  describe('getAllToolIds', () => {
    it('返回所有工具 ID', () => {
      const ids = getAllToolIds();
      expect(ids.length).toBe(CORE_TOOLS.length);
      expect(ids).toContain('read');
      expect(ids).toContain('bash');
      expect(ids).toContain('memory_search');
      expect(ids).toContain('spawn_agent');
    });
  });
});
