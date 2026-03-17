import { describe, it, expect } from 'vitest';
import {
  isOverloadError,
  isThinkingError,
  isContextOverflowError,
  calculateBackoff,
  NO_REPLY_TOKEN,
  buildSystemPrompt,
} from '../agent/embedded-runner.js';

describe('错误分类辅助函数', () => {
  describe('isOverloadError', () => {
    it('应该识别 429 状态码', () => {
      expect(isOverloadError(new Error('HTTP 429 Too Many Requests'))).toBe(true);
    });

    it('应该识别 529 状态码', () => {
      expect(isOverloadError(new Error('HTTP 529 Overloaded'))).toBe(true);
    });

    it('应该识别 overloaded 关键词', () => {
      expect(isOverloadError(new Error('The API is overloaded'))).toBe(true);
    });

    it('应该识别 rate limit 关键词', () => {
      expect(isOverloadError(new Error('Rate limit exceeded'))).toBe(true);
      expect(isOverloadError(new Error('rate_limit_error'))).toBe(true);
    });

    it('不应该误判普通错误', () => {
      expect(isOverloadError(new Error('Network error'))).toBe(false);
      expect(isOverloadError(new Error('Invalid API key'))).toBe(false);
    });
  });

  describe('isThinkingError', () => {
    it('应该识别 thinking 不支持错误', () => {
      expect(isThinkingError(new Error('thinking is not supported for this model'))).toBe(true);
      expect(isThinkingError(new Error('Extended thinking not available'))).toBe(true);
    });

    it('应该识别 reasoning 不支持错误', () => {
      expect(isThinkingError(new Error('reasoning is not supported'))).toBe(true);
    });

    it('不应该误判普通错误', () => {
      expect(isThinkingError(new Error('Network error'))).toBe(false);
    });
  });

  describe('isContextOverflowError', () => {
    it('应该识别 context_length_exceeded', () => {
      expect(isContextOverflowError(new Error('context_length_exceeded'))).toBe(true);
    });

    it('应该识别 max context 错误', () => {
      expect(isContextOverflowError(new Error('max context window exceeded'))).toBe(true);
    });

    it('应该识别 too many tokens', () => {
      expect(isContextOverflowError(new Error('too many tokens in the request'))).toBe(true);
    });

    it('不应该误判普通错误', () => {
      expect(isContextOverflowError(new Error('Network error'))).toBe(false);
    });
  });
});

describe('calculateBackoff', () => {
  it('应该返回正数', () => {
    const delay = calculateBackoff(0);
    expect(delay).toBeGreaterThan(0);
  });

  it('延迟应随重试次数增长', () => {
    const delays = Array.from({ length: 5 }, (_, i) => calculateBackoff(i, { jitter: 0 }));
    for (let i = 1; i < delays.length - 1; i++) {
      expect(delays[i]!).toBeGreaterThanOrEqual(delays[i - 1]!);
    }
  });

  it('不应超过 maxDelayMs', () => {
    const delay = calculateBackoff(100, { maxDelayMs: 1500, jitter: 0 });
    expect(delay).toBeLessThanOrEqual(1500);
  });

  it('默认初始延迟约为 250ms', () => {
    const delay = calculateBackoff(0, { jitter: 0 });
    expect(delay).toBe(250);
  });

  it('jitter 应该引入变化', () => {
    // 多次调用应产生不同结果（概率性，取 20 次）
    const delays = Array.from({ length: 20 }, () => calculateBackoff(2));
    const unique = new Set(delays);
    expect(unique.size).toBeGreaterThan(1);
  });
});

describe('NO_REPLY_TOKEN', () => {
  it('应该是 NO_REPLY', () => {
    expect(NO_REPLY_TOKEN).toBe('NO_REPLY');
  });
});

describe('buildSystemPrompt', () => {
  it('应该包含安全宪法段落', () => {
    const result = buildSystemPrompt({
      agent: { id: 'test', name: '测试' } as any,
      systemPrompt: '',
      workspaceFiles: {},
      modelId: 'gpt-4o',
      provider: 'openai',
      apiKey: '',
      baseUrl: '',
    });
    expect(result).toContain('<safety>');
    expect(result).toContain('安全');
  });

  it('应该包含运行时信息', () => {
    const result = buildSystemPrompt({
      agent: { id: 'agent-1', name: '小明' } as any,
      systemPrompt: '',
      workspaceFiles: {},
      modelId: 'gpt-4o',
      provider: 'openai',
      apiKey: '',
      baseUrl: '',
    });
    expect(result).toContain('<runtime>');
    expect(result).toContain('agent-1');
    expect(result).toContain('小明');
    expect(result).toContain('openai/gpt-4o');
  });

  it('应该包含人格（SOUL.md + IDENTITY.md）', () => {
    const result = buildSystemPrompt({
      agent: { id: 'test', name: '测试' } as any,
      systemPrompt: '',
      workspaceFiles: {
        'SOUL.md': '我是一个友好的助手',
        'IDENTITY.md': '我的名字是小明',
      },
      modelId: 'gpt-4o',
      provider: 'openai',
      apiKey: '',
      baseUrl: '',
    });
    expect(result).toContain('<personality>');
    expect(result).toContain('友好的助手');
    expect(result).toContain('<identity>');
    expect(result).toContain('小明');
  });

  it('应该包含操作规程（AGENTS.md）', () => {
    const result = buildSystemPrompt({
      agent: { id: 'test', name: '测试' } as any,
      systemPrompt: '',
      workspaceFiles: {
        'AGENTS.md': '总是用中文回答',
      },
      modelId: 'gpt-4o',
      provider: 'openai',
      apiKey: '',
      baseUrl: '',
    });
    expect(result).toContain('<operating_procedures>');
    expect(result).toContain('总是用中文回答');
  });

  it('应该包含记忆召回指令', () => {
    const result = buildSystemPrompt({
      agent: { id: 'test', name: '测试' } as any,
      systemPrompt: '',
      workspaceFiles: {},
      modelId: 'gpt-4o',
      provider: 'openai',
      apiKey: '',
      baseUrl: '',
    });
    expect(result).toContain('<memory_recall>');
    expect(result).toContain('memory_search');
  });

  it('应该包含工具使用指导', () => {
    const result = buildSystemPrompt({
      agent: { id: 'test', name: '测试' } as any,
      systemPrompt: '',
      workspaceFiles: {},
      modelId: 'gpt-4o',
      provider: 'openai',
      apiKey: '',
      baseUrl: '',
    });
    expect(result).toContain('<tool_usage>');
    expect(result).toContain('静默调用');
  });

  it('应该包含沉默回复 token', () => {
    const result = buildSystemPrompt({
      agent: { id: 'test', name: '测试' } as any,
      systemPrompt: '',
      workspaceFiles: {},
      modelId: 'gpt-4o',
      provider: 'openai',
      apiKey: '',
      baseUrl: '',
    });
    expect(result).toContain('<silent_reply>');
    expect(result).toContain('NO_REPLY');
  });

  it('应该附加自定义 systemPrompt', () => {
    const result = buildSystemPrompt({
      agent: { id: 'test', name: '测试' } as any,
      systemPrompt: '这是自定义提示',
      workspaceFiles: {},
      modelId: 'gpt-4o',
      provider: 'openai',
      apiKey: '',
      baseUrl: '',
    });
    expect(result).toContain('这是自定义提示');
  });

  it('没有工作区文件时不应包含对应段落', () => {
    const result = buildSystemPrompt({
      agent: { id: 'test', name: '测试' } as any,
      systemPrompt: '',
      workspaceFiles: {},
      modelId: 'gpt-4o',
      provider: 'openai',
      apiKey: '',
      baseUrl: '',
    });
    expect(result).not.toContain('<personality>');
    expect(result).not.toContain('<identity>');
    expect(result).not.toContain('<operating_procedures>');
  });
});
