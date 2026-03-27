import type { ProviderDefinition } from './types.js';

export const OPENAI_PROVIDER: ProviderDefinition = {
  id: 'openai',
  name: 'OpenAI',
  defaultBaseUrl: 'https://api.openai.com/v1',
  api: 'openai-completions',
  models: [
    // GPT-5.4 系列（最新旗舰）
    { id: 'gpt-5.4', name: 'GPT-5.4', contextWindow: 1050000, maxTokens: 128000, input: ['text', 'image'], reasoning: true, isDefault: true },
    { id: 'gpt-5.4-pro', name: 'GPT-5.4 Pro', contextWindow: 1050000, maxTokens: 128000, input: ['text', 'image'], reasoning: true },
    { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', contextWindow: 400000, maxTokens: 128000, input: ['text', 'image'], reasoning: true },
    { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano', contextWindow: 200000, maxTokens: 64000, input: ['text', 'image'], reasoning: true },
    // GPT-4.1 系列
    { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1000000, maxTokens: 32768, input: ['text', 'image'] },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', contextWindow: 1000000, maxTokens: 32768, input: ['text', 'image'] },
    { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', contextWindow: 1000000, maxTokens: 32768, input: ['text', 'image'] },
    // 推理系列
    { id: 'o3', name: 'o3', contextWindow: 200000, maxTokens: 100000, input: ['text', 'image'], reasoning: true },
    { id: 'o4-mini', name: 'o4 Mini', contextWindow: 200000, maxTokens: 100000, input: ['text', 'image'], reasoning: true },
    // GPT-4o 系列（旧版）
    { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxTokens: 16384, input: ['text', 'image'] },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, maxTokens: 16384, input: ['text', 'image'] },
    // Embedding
    { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small', contextWindow: 8191, maxTokens: 0, input: ['text'], toolUse: false, dimension: 1536 },
    { id: 'text-embedding-3-large', name: 'Text Embedding 3 Large', contextWindow: 8191, maxTokens: 0, input: ['text'], toolUse: false, dimension: 3072 },
  ],
};
