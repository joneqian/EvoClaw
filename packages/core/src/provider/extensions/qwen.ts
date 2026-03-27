import type { ProviderDefinition } from './types.js';

export const QWEN_PROVIDER: ProviderDefinition = {
  id: 'qwen',
  name: '通义千问',
  defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  api: 'openai-completions',
  models: [
    // Qwen3.5 系列（最新旗舰）
    { id: 'qwen3.5-plus', name: 'Qwen3.5 Plus', contextWindow: 1000000, maxTokens: 65536, input: ['text', 'image'], isDefault: true },
    { id: 'qwen3.5-flash', name: 'Qwen3.5 Flash', contextWindow: 1000000, maxTokens: 65536, input: ['text', 'image'] },
    // Qwen3 系列
    { id: 'qwen3-max', name: 'Qwen3 Max', contextWindow: 262144, maxTokens: 65536, input: ['text'] },
    // Qwen3 Coder 系列（编码优化）
    { id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus', contextWindow: 1000000, maxTokens: 65536, input: ['text'] },
    { id: 'qwen3-coder-next', name: 'Qwen3 Coder Next', contextWindow: 262144, maxTokens: 65536, input: ['text'] },
    // Embedding
    { id: 'text-embedding-v4', name: 'Text Embedding V4', contextWindow: 8192, maxTokens: 0, input: ['text'], toolUse: false, dimension: 1024 },
    { id: 'text-embedding-v3', name: 'Text Embedding V3', contextWindow: 8192, maxTokens: 0, input: ['text'], toolUse: false, dimension: 1024 },
  ],
};
