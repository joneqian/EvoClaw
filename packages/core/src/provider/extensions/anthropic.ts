import type { ProviderDefinition } from './types.js';

export const ANTHROPIC_PROVIDER: ProviderDefinition = {
  id: 'anthropic',
  name: 'Anthropic',
  defaultBaseUrl: 'https://api.anthropic.com/v1',
  api: 'anthropic-messages',
  models: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200000, maxTokens: 16384, input: ['text', 'image'], isDefault: true },
    { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', contextWindow: 200000, maxTokens: 16384, input: ['text', 'image'] },
    { id: 'claude-haiku-4-20250514', name: 'Claude Haiku 4', contextWindow: 200000, maxTokens: 16384, input: ['text', 'image'] },
  ],
};
