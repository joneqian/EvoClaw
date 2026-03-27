import type { ProviderDefinition } from './types.js';

export const ANTHROPIC_PROVIDER: ProviderDefinition = {
  id: 'anthropic',
  name: 'Anthropic',
  defaultBaseUrl: 'https://api.anthropic.com/v1',
  api: 'anthropic-messages',
  models: [
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', contextWindow: 1000000, maxTokens: 128000, input: ['text', 'image'], reasoning: true, isDefault: true },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 1000000, maxTokens: 64000, input: ['text', 'image'], reasoning: true },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200000, maxTokens: 64000, input: ['text', 'image'], reasoning: true },
  ],
};
