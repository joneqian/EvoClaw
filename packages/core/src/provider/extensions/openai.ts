import type { ProviderDefinition } from './types.js';

export const OPENAI_PROVIDER: ProviderDefinition = {
  id: 'openai',
  name: 'OpenAI',
  defaultBaseUrl: 'https://api.openai.com/v1',
  api: 'openai-completions',
  models: [
    // GPT-4.1 系列（1M 上下文）
    { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1000000, maxTokens: 32768, input: ['text', 'image'], isDefault: true },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', contextWindow: 1000000, maxTokens: 32768, input: ['text', 'image'] },
    { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', contextWindow: 1000000, maxTokens: 32768, input: ['text', 'image'] },
    // 推理系列
    { id: 'o3', name: 'o3', contextWindow: 200000, maxTokens: 100000, input: ['text', 'image'], reasoning: true },
    { id: 'o4-mini', name: 'o4 Mini', contextWindow: 200000, maxTokens: 100000, input: ['text', 'image'], reasoning: true },
    // GPT-4o 系列
    { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxTokens: 16384, input: ['text', 'image'] },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, maxTokens: 16384, input: ['text', 'image'] },
  ],
};
