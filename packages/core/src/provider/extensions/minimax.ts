import type { ProviderDefinition } from './types.js';

export const MINIMAX_PROVIDER: ProviderDefinition = {
  id: 'minimax',
  name: 'MiniMax',
  defaultBaseUrl: 'https://api.minimaxi.com/v1',
  api: 'openai-completions',
  models: [
    { id: 'MiniMax-M2.7', name: 'MiniMax M2.7', contextWindow: 204800, maxTokens: 131072, input: ['text'], reasoning: true, isDefault: true },
    { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', contextWindow: 196608, maxTokens: 65536, input: ['text'], reasoning: true },
  ],
};
