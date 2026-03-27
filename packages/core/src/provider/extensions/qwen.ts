import type { ProviderDefinition } from './types.js';

export const QWEN_PROVIDER: ProviderDefinition = {
  id: 'qwen',
  name: '通义千问',
  defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  api: 'openai-completions',
  models: [
    // Qwen3.5 系列（最新）
    { id: 'qwen3.5-plus', name: 'Qwen3.5 Plus', contextWindow: 1000000, maxTokens: 65536, input: ['text', 'image'], reasoning: true, isDefault: true },
    // Qwen3 系列
    { id: 'qwen3-max', name: 'Qwen3 Max', contextWindow: 262144, maxTokens: 32768, input: ['text'], reasoning: true },
    // Qwen2.5 系列
    { id: 'qwen-max', name: 'Qwen Max', contextWindow: 32768, maxTokens: 8192, input: ['text'] },
    { id: 'qwen-plus', name: 'Qwen Plus', contextWindow: 131072, maxTokens: 8192, input: ['text'] },
    { id: 'qwen-turbo', name: 'Qwen Turbo', contextWindow: 1000000, maxTokens: 8192, input: ['text'] },
    { id: 'qwen-long', name: 'Qwen Long', contextWindow: 10000000, maxTokens: 6144, input: ['text'] },
    // 多模态
    { id: 'qwen-vl-max', name: 'Qwen VL Max', contextWindow: 131072, maxTokens: 32768, input: ['text', 'image'] },
    { id: 'qwen-vl-plus', name: 'Qwen VL Plus', contextWindow: 131072, maxTokens: 8192, input: ['text', 'image'], toolUse: false },
  ],
};
