import type { ProviderDefinition } from './types.js';

export const DEEPSEEK_PROVIDER: ProviderDefinition = {
  id: 'deepseek',
  name: 'DeepSeek',
  // Anthropic 协议端点（原生支持 prompt caching，降低成本）
  defaultBaseUrl: 'https://api.deepseek.com/anthropic',
  api: 'anthropic-messages',
  models: [
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 1000000, maxTokens: 384000, maxOutputLimit: 384000, input: ['text'], reasoning: true, isDefault: true },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: 1000000, maxTokens: 384000, maxOutputLimit: 384000, input: ['text'], reasoning: true },
  ],
};
