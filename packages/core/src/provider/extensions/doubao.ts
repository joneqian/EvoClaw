import type { ProviderDefinition } from './types.js';

export const DOUBAO_PROVIDER: ProviderDefinition = {
  id: 'doubao',
  name: '字节豆包',
  defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  api: 'openai-completions',
  models: [
    { id: 'doubao-1.5-pro-256k', name: 'Doubao 1.5 Pro 256K', contextWindow: 262144, maxTokens: 12288, input: ['text'], isDefault: true },
    { id: 'doubao-1.5-pro-32k', name: 'Doubao 1.5 Pro 32K', contextWindow: 32768, maxTokens: 12288, input: ['text'] },
    { id: 'doubao-1.5-lite-32k', name: 'Doubao 1.5 Lite 32K', contextWindow: 32768, maxTokens: 12288, input: ['text'] },
    { id: 'doubao-pro-32k', name: 'Doubao Pro 32K', contextWindow: 32768, maxTokens: 4096, input: ['text'] },
    { id: 'doubao-lite-32k', name: 'Doubao Lite 32K', contextWindow: 32768, maxTokens: 4096, input: ['text'] },
    { id: 'doubao-1.5-vision-pro-32k', name: 'Doubao 1.5 Vision Pro', contextWindow: 32768, maxTokens: 12288, input: ['text', 'image'], toolUse: false },
  ],
};
