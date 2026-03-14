import { describe, it, expect } from 'vitest';
import { detectSatisfaction } from '../evolution/feedback-detector.js';

describe('detectSatisfaction', () => {
  it('应检测中文正面信号', () => {
    const messages = [{ role: 'user', content: '谢谢你，太棒了！' }];
    const result = detectSatisfaction(messages);
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.signals).toContain('谢谢');
    expect(result.signals).toContain('太棒了');
  });

  it('应检测英文正面信号', () => {
    const messages = [{ role: 'user', content: 'That was perfect, thanks!' }];
    const result = detectSatisfaction(messages);
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.signals).toContain('perfect');
    expect(result.signals).toContain('thanks');
  });

  it('应检测中文负面信号', () => {
    const messages = [{ role: 'user', content: '不对，重来' }];
    const result = detectSatisfaction(messages);
    expect(result.score).toBeLessThan(0.5);
    expect(result.signals).toContain('不对');
    expect(result.signals).toContain('重来');
  });

  it('应检测英文负面信号', () => {
    const messages = [{ role: 'user', content: 'This is wrong, please redo' }];
    const result = detectSatisfaction(messages);
    expect(result.score).toBeLessThan(0.5);
  });

  it('混合信号应产生中性分数', () => {
    const messages = [
      { role: 'user', content: '不错，但有些地方不对' },
    ];
    const result = detectSatisfaction(messages);
    // 不错 +0.15, 不对 -0.3 → 0.5 + (-0.15) = 0.35
    expect(result.score).toBeLessThan(0.5);
  });

  it('空消息应返回默认 0.5', () => {
    const result = detectSatisfaction([]);
    expect(result.score).toBe(0.5);
    expect(result.signals).toEqual([]);
  });

  it('应仅分析用户消息', () => {
    const messages = [
      { role: 'assistant', content: '谢谢你的提问' },
      { role: 'user', content: '你好' },
    ];
    const result = detectSatisfaction(messages);
    // assistant 消息中的 "谢谢" 不应被检测
    expect(result.score).toBe(0.5);
  });

  it('应检测 emoji 信号', () => {
    const messages = [{ role: 'user', content: '👍 很好' }];
    const result = detectSatisfaction(messages);
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.signals).toContain('👍');
  });
});
