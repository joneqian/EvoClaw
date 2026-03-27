import type { ProviderDefinition } from './types.js';

export const OPENAI_PROVIDER: ProviderDefinition = {
  id: 'openai',
  name: 'OpenAI',
  defaultBaseUrl: 'https://api.openai.com/v1',
  api: 'openai-completions',
  models: [
    { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxTokens: 16384, input: ['text', 'image'], isDefault: true },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, maxTokens: 16384, input: ['text', 'image'] },
    { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1047576, maxTokens: 32768, input: ['text', 'image'] },
    { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', contextWindow: 1047576, maxTokens: 32768, input: ['text', 'image'] },
    { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', contextWindow: 1047576, maxTokens: 32768, input: ['text', 'image'] },
    { id: 'o3-mini', name: 'o3 Mini', contextWindow: 200000, maxTokens: 100000, input: ['text'], reasoning: true },
    { id: 'o4-mini', name: 'o4 Mini', contextWindow: 200000, maxTokens: 100000, input: ['text', 'image'], reasoning: true },
  ],
};
