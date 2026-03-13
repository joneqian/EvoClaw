import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerProvider,
  unregisterProvider,
  getProvider,
  getProviders,
  isBuiltinProvider,
  clearProviders,
  registerQwen,
  registerGLM,
  registerDoubao,
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
    expect(provider!.models).toHaveLength(4);

    // 默认模型应该是 qwen-max
    const defaultModel = provider!.models.find(m => m.isDefault);
    expect(defaultModel).toBeDefined();
    expect(defaultModel!.id).toBe('qwen-max');
  });

  it('registerGLM 应该正确注册智谱 GLM', () => {
    registerGLM('glm-key');

    const provider = getProvider('glm');
    expect(provider).toBeDefined();
    expect(provider!.name).toBe('智谱 GLM');
    expect(provider!.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');
    expect(provider!.models).toHaveLength(2);

    const defaultModel = provider!.models.find(m => m.isDefault);
    expect(defaultModel!.id).toBe('glm-4-plus');
  });

  it('registerDoubao 应该正确注册字节豆包', () => {
    registerDoubao('doubao-key');

    const provider = getProvider('doubao');
    expect(provider).toBeDefined();
    expect(provider!.name).toBe('字节豆包');
    expect(provider!.baseUrl).toBe('https://ark.cn-beijing.volces.com/api/v3');
    expect(provider!.models).toHaveLength(2);

    const defaultModel = provider!.models.find(m => m.isDefault);
    expect(defaultModel!.id).toBe('doubao-pro-32k');
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
});
