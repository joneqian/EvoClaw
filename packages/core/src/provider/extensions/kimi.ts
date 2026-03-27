import type { ProviderDefinition } from './types.js';

export const KIMI_PROVIDER: ProviderDefinition = {
  id: 'kimi',
  name: 'Kimi (Moonshot)',
  defaultBaseUrl: 'https://api.moonshot.cn/v1',
  api: 'openai-completions',
  models: [
    { id: 'moonshot-v1-128k', name: 'Moonshot V1 128K', contextWindow: 131072, maxTokens: 8192, input: ['text'], isDefault: true },
    { id: 'moonshot-v1-32k', name: 'Moonshot V1 32K', contextWindow: 32768, maxTokens: 8192, input: ['text'] },
    { id: 'moonshot-v1-8k', name: 'Moonshot V1 8K', contextWindow: 8192, maxTokens: 4096, input: ['text'] },
  ],
};
