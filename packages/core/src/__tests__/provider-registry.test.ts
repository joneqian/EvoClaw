import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerProvider,
  unregisterProvider,
  getProvider,
  getProviders,
  isBuiltinProvider,
  clearProviders,
  updateProviderModels,
  registerQwen,
  registerGLM,
  registerDoubao,
  registerDeepSeek,
  registerMiniMax,
  registerKimi,
  registerOpenAI,
  registerAnthropic,
} from '../provider/provider-registry.js';

describe('ProviderRegistry', () => {
  beforeEach(() => {
    clearProviders();
  });

  it('registerQwen 应该正确注册通义千问', () => {
    registerQwen('qwen-key');

    const provider = getProvider('qwen');
    expect(provider).toBeDefined();
    expect(provider!.name).toBe('通义千问');
    expect(provider!.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(provider!.apiKeyRef).toBe('qwen-key');
    expect(provider!.models.length).toBeGreaterThanOrEqual(4);

    // 默认模型应该是 qwen-max
    const defaultModel = provider!.models.find(m => m.isDefault);
    expect(defaultModel).toBeDefined();
    expect(defaultModel!.id).toBe('qwen3.5-plus');
  });

  it('registerGLM 应该正确注册智谱 GLM', () => {
    registerGLM('glm-key');

    const provider = getProvider('glm');
    expect(provider).toBeDefined();
    expect(provider!.name).toBe('智谱 GLM');
    expect(provider!.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');
    expect(provider!.models.length).toBeGreaterThanOrEqual(2);

    const defaultModel = provider!.models.find(m => m.isDefault);
    expect(defaultModel!.id).toBe('glm-5');
  });

  it('registerDoubao 应该正确注册字节豆包', () => {
    registerDoubao('doubao-key');

    const provider = getProvider('doubao');
    expect(provider).toBeDefined();
    expect(provider!.name).toBe('字节豆包');
    expect(provider!.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/v3');
    expect(provider!.models.length).toBeGreaterThanOrEqual(2);

    const defaultModel = provider!.models.find(m => m.isDefault);
    expect(defaultModel).toBeDefined();
  });

  it('getProvider 应该返回正确的配置', () => {
    registerQwen('qwen-key');
    const provider = getProvider('qwen');
    expect(provider).toBeDefined();
    expect(provider!.id).toBe('qwen');
  });

  it('getProvider 不存在的 Provider 应该返回 undefined', () => {
    const provider = getProvider('non-existent');
    expect(provider).toBeUndefined();
  });

  it('getProviders 应该列出所有已注册 Provider', () => {
    registerQwen('qwen-key');
    registerGLM('glm-key');
    registerDoubao('doubao-key');

    const providers = getProviders();
    expect(providers).toHaveLength(3);

    const ids = providers.map(p => p.id);
    expect(ids).toContain('qwen');
    expect(ids).toContain('glm');
    expect(ids).toContain('doubao');
  });

  it('unregisterProvider 应该移除 Provider', () => {
    registerQwen('qwen-key');
    expect(getProvider('qwen')).toBeDefined();

    unregisterProvider('qwen');
    expect(getProvider('qwen')).toBeUndefined();
    expect(getProviders()).toHaveLength(0);
  });

  it('isBuiltinProvider 对 openai/anthropic 返回 true', () => {
    expect(isBuiltinProvider('openai')).toBe(true);
    expect(isBuiltinProvider('anthropic')).toBe(true);
    expect(isBuiltinProvider('google')).toBe(true);
    expect(isBuiltinProvider('groq')).toBe(true);
  });

  it('isBuiltinProvider 对 qwen/glm 返回 false', () => {
    expect(isBuiltinProvider('qwen')).toBe(false);
    expect(isBuiltinProvider('glm')).toBe(false);
    expect(isBuiltinProvider('doubao')).toBe(false);
  });

  it('clearProviders 应该清除所有注册', () => {
    registerQwen('qwen-key');
    registerGLM('glm-key');
    expect(getProviders()).toHaveLength(2);

    clearProviders();
    expect(getProviders()).toHaveLength(0);
  });

  it('registerProvider 应该支持自定义 Provider', () => {
    registerProvider({
      id: 'custom',
      name: '自定义模型',
      baseUrl: 'https://example.com/v1',
      apiKeyRef: 'custom-key',
      models: [
        { id: 'custom-model', name: 'Custom Model', provider: 'custom', maxContextLength: 4096, maxOutputTokens: 1024, supportsVision: false, supportsToolUse: false, isDefault: true },
      ],
    });

    const provider = getProvider('custom');
    expect(provider).toBeDefined();
    expect(provider!.name).toBe('自定义模型');
    expect(provider!.models).toHaveLength(1);
  });

  // Sprint 7: 新增 Provider 测试
  it('registerDeepSeek 应正确注册', () => {
    registerDeepSeek('deepseek-key');
    const p = getProvider('deepseek');
    expect(p).toBeDefined();
    expect(p!.name).toBe('DeepSeek');
    expect(p!.models.some(m => m.id === 'deepseek-chat')).toBe(true);
    expect(p!.models.some(m => m.id === 'deepseek-reasoner')).toBe(true);
  });

  it('registerMiniMax 应正确注册', () => {
    registerMiniMax('minimax-key');
    const p = getProvider('minimax');
    expect(p).toBeDefined();
    expect(p!.name).toBe('MiniMax');
    expect(p!.baseUrl).toBe('https://api.minimaxi.com/v1');
    expect(p!.models.some(m => m.id === 'MiniMax-M2.7')).toBe(true);
    expect(p!.models.some(m => m.id === 'MiniMax-M2.7-highspeed')).toBe(true);
  });

  it('registerKimi 应正确注册', () => {
    registerKimi('kimi-key');
    const p = getProvider('kimi');
    expect(p).toBeDefined();
    expect(p!.name).toBe('Kimi (Moonshot)');
    expect(p!.models.length).toBeGreaterThanOrEqual(4);
    expect(p!.models.some(m => m.id === 'kimi-k2.5')).toBe(true);
    expect(p!.models.some(m => m.id === 'kimi-k2-thinking')).toBe(true);
  });

  it('registerOpenAI 应显式注册模型列表', () => {
    registerOpenAI('openai-key');
    const p = getProvider('openai');
    expect(p).toBeDefined();
    expect(p!.models.some(m => m.id === 'gpt-4o')).toBe(true);
    expect(p!.models.some(m => m.id === 'gpt-4o-mini')).toBe(true);
    // gpt-4o 支持 vision
    expect(p!.models.find(m => m.id === 'gpt-4o')!.supportsVision).toBe(true);
  });

  it('registerAnthropic 应显式注册模型列表', () => {
    registerAnthropic('anthropic-key');
    const p = getProvider('anthropic');
    expect(p).toBeDefined();
    expect(p!.models.some(m => m.supportsVision)).toBe(true);
    expect(p!.models.some(m => m.supportsToolUse)).toBe(true);
  });

  it('updateProviderModels 应动态更新模型列表', () => {
    registerMiniMax('minimax-key');

    const newModels = [
      { id: 'new-model-1', name: 'New Model 1', provider: 'minimax', maxContextLength: 128000, maxOutputTokens: 8192, supportsVision: false, supportsToolUse: true, isDefault: true },
      { id: 'new-model-2', name: 'New Model 2', provider: 'minimax', maxContextLength: 64000, maxOutputTokens: 4096, supportsVision: true, supportsToolUse: true, isDefault: false },
    ];
    const updated = updateProviderModels('minimax', newModels);
    expect(updated).toBe(true);

    const after = getProvider('minimax')!;
    expect(after.models).toHaveLength(2);
    expect(after.models[0]!.id).toBe('new-model-1');
    expect(after.models[1]!.id).toBe('new-model-2');
  });

  it('updateProviderModels 不存在的 Provider 返回 false', () => {
    const result = updateProviderModels('nonexistent', []);
    expect(result).toBe(false);
  });

  it('所有 8 个 Provider 可同时注册', () => {
    registerOpenAI('k1');
    registerAnthropic('k2');
    registerQwen('k3');
    registerGLM('k4');
    registerDoubao('k5');
    registerDeepSeek('k6');
    registerMiniMax('k7');
    registerKimi('k8');

    expect(getProviders()).toHaveLength(8);
  });
});
