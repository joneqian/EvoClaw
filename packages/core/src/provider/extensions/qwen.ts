import type { ProviderDefinition } from './types.js';

export const QWEN_PROVIDER: ProviderDefinition = {
  id: 'qwen',
  name: '通义千问',
  defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  api: 'openai-completions',
  models: [
    { id: 'qwen-max', name: 'Qwen Max', contextWindow: 32768, maxTokens: 8192, input: ['text'], isDefault: true },
    { id: 'qwen-plus', name: 'Qwen Plus', contextWindow: 131072, maxTokens: 8192, input: ['text'] },
    { id: 'qwen-turbo', name: 'Qwen Turbo', contextWindow: 131072, maxTokens: 8192, input: ['text'] },
    { id: 'qwen-long', name: 'Qwen Long', contextWindow: 10000000, maxTokens: 8192, input: ['text'] },
    { id: 'qwen-vl-max', name: 'Qwen VL Max', contextWindow: 32768, maxTokens: 4096, input: ['text', 'image'], toolUse: false },
    { id: 'qwen-vl-plus', name: 'Qwen VL Plus', contextWindow: 32768, maxTokens: 4096, input: ['text', 'image'], toolUse: false },
  ],
};
