import { describe, it, expect } from 'vitest';
import { resolveSecondaryModelId, createSecondaryLLMCallFn } from '../agent/llm-client.js';
import type { ConfigManager } from '../infrastructure/config-manager.js';

/** 创建 mock ConfigManager */
function mockConfigManager(opts: {
  provider?: string;
  models?: Array<{ id: string; name: string; cost?: { input: number; output: number } }>;
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
  api?: string;
}): ConfigManager {
  return {
    getDefaultProvider: () => opts.provider ?? 'openai',
    getDefaultApiKey: () => opts.apiKey ?? 'sk-test',
    getDefaultBaseUrl: () => opts.baseUrl ?? 'https://api.openai.com/v1',
    getDefaultModelId: () => opts.modelId ?? 'gpt-4o',
    getDefaultApi: () => opts.api ?? 'openai-completions',
    getProvider: (id: string) => {
      if (id === (opts.provider ?? 'openai')) {
        return {
          baseUrl: opts.baseUrl ?? 'https://api.openai.com/v1',
          apiKey: opts.apiKey ?? 'sk-test',
          api: opts.api ?? 'openai-completions',
          models: opts.models ?? [],
        };
      }
      return undefined;
    },
  } as unknown as ConfigManager;
}

// ─── resolveSecondaryModelId ─────────────────────────────────────

describe('resolveSecondaryModelId', () => {
  it('应从 models 列表中选择 cost.input 最低的非主模型', () => {
    const cm = mockConfigManager({
      provider: 'openai',
      modelId: 'gpt-4o',
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', cost: { input: 5, output: 15 } },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', cost: { input: 0.15, output: 0.6 } },
        { id: 'o3', name: 'O3', cost: { input: 10, output: 40 } },
      ],
    });

    const result = resolveSecondaryModelId(cm, 'openai', 'gpt-4o');
    expect(result).toBe('gpt-4o-mini');
  });

  it('只有主模型有 cost 时应使用 hardcoded fallback', () => {
    const cm = mockConfigManager({
      provider: 'openai',
      modelId: 'gpt-4o',
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', cost: { input: 5, output: 15 } },
      ],
    });

    // gpt-4o 是主模型，被排除。无其他有 cost 的模型 → hardcoded fallback
    const result = resolveSecondaryModelId(cm, 'openai', 'gpt-4o');
    expect(result).toBe('gpt-4.1-nano');
  });

  it('models 列表无 cost 信息时应使用 hardcoded fallback', () => {
    const cm = mockConfigManager({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6-20260514',
      models: [
        { id: 'claude-sonnet-4-6-20260514', name: 'Sonnet 4.6' },
        { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
      ],
    });

    const result = resolveSecondaryModelId(cm, 'anthropic', 'claude-sonnet-4-6-20260514');
    expect(result).toBe('claude-haiku-4-5-20251001');
  });

  it('国产模型 qwen 应 fallback 到 qwen-turbo', () => {
    const cm = mockConfigManager({
      provider: 'qwen',
      modelId: 'qwen-max',
      models: [],
    });

    const result = resolveSecondaryModelId(cm, 'qwen', 'qwen-max');
    expect(result).toBe('qwen-turbo-latest');
  });

  it('国产模型 deepseek 应 fallback 到 deepseek-chat', () => {
    const cm = mockConfigManager({
      provider: 'deepseek',
      modelId: 'deepseek-reasoner',
      models: [],
    });

    const result = resolveSecondaryModelId(cm, 'deepseek', 'deepseek-reasoner');
    expect(result).toBe('deepseek-chat');
  });

  it('未知 provider 应降级到主模型', () => {
    const cm = mockConfigManager({
      provider: 'unknown-provider',
      modelId: 'some-model',
      models: [],
    });

    const result = resolveSecondaryModelId(cm, 'unknown-provider', 'some-model');
    expect(result).toBe('some-model');
  });

  it('主模型已经是便宜模型时（fallback 与主模型相同）应降级到主模型', () => {
    const cm = mockConfigManager({
      provider: 'openai',
      modelId: 'gpt-4.1-nano', // 本身就是最便宜模型
      models: [],
    });

    const result = resolveSecondaryModelId(cm, 'openai', 'gpt-4.1-nano');
    // hardcoded 返回 gpt-4.1-nano 但与主模型相同 → 跳过 → 降级到主模型
    expect(result).toBe('gpt-4.1-nano');
  });

  it('provider 名称匹配应不区分大小写', () => {
    const cm = mockConfigManager({
      provider: 'Anthropic',
      modelId: 'claude-opus-4-6-20260514',
      models: [],
    });

    const result = resolveSecondaryModelId(cm, 'Anthropic', 'claude-opus-4-6-20260514');
    expect(result).toBe('claude-haiku-4-5-20251001');
  });
});

// ─── createSecondaryLLMCallFn ────────────────────────────────────

describe('createSecondaryLLMCallFn', () => {
  it('应返回一个接受 (system, user) 的函数', () => {
    const cm = mockConfigManager({});
    const fn = createSecondaryLLMCallFn(cm);
    expect(typeof fn).toBe('function');
    expect(fn.length).toBe(2);
  });
});
