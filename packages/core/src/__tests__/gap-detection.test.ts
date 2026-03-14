import { describe, it, expect } from 'vitest';
import { detectGap, createGapDetectionPlugin } from '../context/plugins/gap-detection.js';
import type { TurnContext } from '../context/plugin.interface.js';

describe('gap-detection', () => {
  describe('detectGap', () => {
    it('应检测中文 "无法完成" 信号', () => {
      const result = detectGap('很抱歉，我目前无法直接完成这个任务。');
      expect(result.detected).toBe(true);
      expect(result.snippet).toBeDefined();
    });

    it('应检测 "没有能力" 信号', () => {
      const result = detectGap('我没有这个能力来处理PDF文件。');
      expect(result.detected).toBe(true);
    });

    it('应检测 "超出能力范围" 信号', () => {
      const result = detectGap('这超出了我的能力范围。');
      expect(result.detected).toBe(true);
    });

    it('应检测英文 inability 信号', () => {
      const result = detectGap("I can't process audio files directly.");
      expect(result.detected).toBe(true);
    });

    it('应检测 "缺少工具" 信号', () => {
      const result = detectGap('需要安装额外的工具来处理此操作。');
      expect(result.detected).toBe(true);
    });

    it('正常回复不应触发', () => {
      const result = detectGap('好的，我已经帮你完成了文件编辑。结果如下...');
      expect(result.detected).toBe(false);
    });

    it('简单回复不应触发', () => {
      const result = detectGap('Hello! How can I help you today?');
      expect(result.detected).toBe(false);
    });
  });

  describe('createGapDetectionPlugin', () => {
    it('应有正确的 name 和 priority', () => {
      const plugin = createGapDetectionPlugin();
      expect(plugin.name).toBe('gap-detection');
      expect(plugin.priority).toBe(80);
    });

    it('afterTurn 应检测最后一条 assistant 消息', async () => {
      const plugin = createGapDetectionPlugin();

      const ctx: TurnContext = {
        agentId: 'agent-1',
        sessionKey: 'agent:agent-1:local:dm:user1',
        messages: [
          { id: '1', conversationId: 'c1', role: 'user', content: '帮我处理PDF', createdAt: '' },
          { id: '2', conversationId: 'c1', role: 'assistant', content: '我目前无法处理PDF文件。', createdAt: '' },
        ],
        systemPrompt: '',
        injectedContext: [],
        estimatedTokens: 0,
        tokenLimit: 100000,
      };

      // 应不抛异常
      await plugin.afterTurn!(ctx);
    });

    it('afterTurn 对正常回复不应有副作用', async () => {
      const plugin = createGapDetectionPlugin();

      const ctx: TurnContext = {
        agentId: 'agent-1',
        sessionKey: 'agent:agent-1:local:dm:user1',
        messages: [
          { id: '1', conversationId: 'c1', role: 'user', content: '你好', createdAt: '' },
          { id: '2', conversationId: 'c1', role: 'assistant', content: '你好！有什么可以帮你的吗？', createdAt: '' },
        ],
        systemPrompt: '',
        injectedContext: [],
        estimatedTokens: 0,
        tokenLimit: 100000,
      };

      await plugin.afterTurn!(ctx);
      // 不抛异常即可
    });
  });
});
