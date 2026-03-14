import { describe, it, expect, beforeEach } from 'vitest';
import { CapabilityGraph } from '../evolution/capability-graph.js';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../infrastructure/db/migration-runner.js';

describe('CapabilityGraph', () => {
  let db: SqliteStore;
  let graph: CapabilityGraph;
  const agentId = 'test-agent-001';

  beforeEach(async () => {
    db = new SqliteStore(':memory:');
    const runner = new MigrationRunner(db);
    await runner.run();
    // 确保 agent 存在（外键约束）
    db.run(
      "INSERT INTO agents (id, name, emoji, status, config_json, created_at, updated_at) VALUES (?, 'Test', '🤖', 'active', '{}', datetime('now'), datetime('now'))",
      agentId,
    );
    graph = new CapabilityGraph(db);
  });

  describe('detectCapabilities', () => {
    it('应通过中文关键词识别编程能力', () => {
      const messages = [{ role: 'user', content: '请帮我实现一个函数' }];
      const caps = graph.detectCapabilities(messages);
      expect(caps).toContain('coding');
    });

    it('应通过英文关键词识别分析能力', () => {
      const messages = [{ role: 'user', content: 'Can you analyze this data?' }];
      const caps = graph.detectCapabilities(messages);
      expect(caps).toContain('analysis');
    });

    it('应能同时识别多个能力维度', () => {
      const messages = [
        { role: 'user', content: '帮我分析这段代码的问题并调试修复' },
      ];
      const caps = graph.detectCapabilities(messages);
      expect(caps).toContain('analysis');
      expect(caps).toContain('debugging');
    });

    it('应通过工具调用识别能力', () => {
      const messages = [{ role: 'user', content: '你好' }];
      const toolCalls = [{ toolName: 'Write' }, { toolName: 'Grep' }];
      const caps = graph.detectCapabilities(messages, toolCalls);
      expect(caps).toContain('coding');
      expect(caps).toContain('research');
    });

    it('空消息应返回空数组', () => {
      const caps = graph.detectCapabilities([]);
      expect(caps).toEqual([]);
    });

    it('应识别写作能力', () => {
      const messages = [{ role: 'user', content: '帮我写一篇文章' }];
      const caps = graph.detectCapabilities(messages);
      expect(caps).toContain('writing');
    });
  });

  describe('updateCapability', () => {
    it('应创建新能力记录', () => {
      graph.updateCapability(agentId, 'coding', true);
      const nodes = graph.getCapabilityGraph(agentId);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].name).toBe('coding');
      expect(nodes[0].useCount).toBe(1);
      expect(nodes[0].successRate).toBe(1.0);
    });

    it('应更新已有能力记录', () => {
      graph.updateCapability(agentId, 'coding', true);
      graph.updateCapability(agentId, 'coding', false);
      const nodes = graph.getCapabilityGraph(agentId);
      expect(nodes).toHaveLength(1);
      expect(nodes[0].useCount).toBe(2);
      expect(nodes[0].successRate).toBe(0.5);
    });

    it('失败记录应降低成功率', () => {
      graph.updateCapability(agentId, 'coding', true);
      graph.updateCapability(agentId, 'coding', true);
      graph.updateCapability(agentId, 'coding', false);
      const nodes = graph.getCapabilityGraph(agentId);
      expect(nodes[0].successRate).toBeCloseTo(2 / 3, 2);
    });
  });

  describe('getTopCapabilities', () => {
    it('应按 level 降序返回 top N', () => {
      // 多次使用提升 level
      for (let i = 0; i < 5; i++) graph.updateCapability(agentId, 'coding', true);
      for (let i = 0; i < 3; i++) graph.updateCapability(agentId, 'analysis', true);
      graph.updateCapability(agentId, 'writing', true);

      const top = graph.getTopCapabilities(agentId, 2);
      expect(top).toHaveLength(2);
      expect(top[0].name).toBe('coding');
      expect(top[1].name).toBe('analysis');
    });

    it('空图谱应返回空数组', () => {
      const top = graph.getTopCapabilities(agentId);
      expect(top).toEqual([]);
    });
  });
});
