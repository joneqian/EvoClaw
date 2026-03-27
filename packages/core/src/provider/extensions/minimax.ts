import type { ProviderDefinition } from './types.js';

export const MINIMAX_PROVIDER: ProviderDefinition = {
  id: 'minimax',
  name: 'MiniMax',
  defaultBaseUrl: 'https://api.minimaxi.com/v1',
  api: 'openai-completions',
  models: [
    { id: 'MiniMax-M2.5-highspeed', name: 'MiniMax M2.5 Highspeed', contextWindow: 1048576, maxTokens: 16384, input: ['text'], reasoning: true, isDefault: true },
    { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', contextWindow: 1048576, maxTokens: 16384, input: ['text'] },
    { id: 'MiniMax-Text-01', name: 'MiniMax Text 01', contextWindow: 1048576, maxTokens: 16384, input: ['text'] },
    { id: 'abab6.5s-chat', name: 'ABAB 6.5s', contextWindow: 245760, maxTokens: 8192, input: ['text'] },
  ],
};
