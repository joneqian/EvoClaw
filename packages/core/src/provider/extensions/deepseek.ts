import type { ProviderDefinition } from './types.js';

export const DEEPSEEK_PROVIDER: ProviderDefinition = {
  id: 'deepseek',
  name: 'DeepSeek',
  defaultBaseUrl: 'https://api.deepseek.com/v1',
  api: 'openai-completions',
  models: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat', contextWindow: 131072, maxTokens: 8192, input: ['text'], isDefault: true },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', contextWindow: 131072, maxTokens: 65536, input: ['text'], reasoning: true },
  ],
};
