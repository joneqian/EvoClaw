import type { ProviderDefinition } from './types.js';

export const ANTHROPIC_PROVIDER: ProviderDefinition = {
  id: 'anthropic',
  name: 'Anthropic',
  defaultBaseUrl: 'https://api.anthropic.com/v1',
  api: 'anthropic-messages',
  models: [
    // 4.6 系列（最新，支持 adaptive thinking）
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', contextWindow: 1000000, maxTokens: 128000, maxOutputLimit: 128000, input: ['text', 'image'], reasoning: true, isDefault: true },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 1000000, maxTokens: 128000, maxOutputLimit: 128000, input: ['text', 'image'], reasoning: true },
    // 4.5 系列（支持 enabled thinking，固定预算）
    { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', contextWindow: 200000, maxTokens: 16384, maxOutputLimit: 64000, input: ['text', 'image'], reasoning: true },
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextWindow: 200000, maxTokens: 16384, maxOutputLimit: 64000, input: ['text', 'image'], reasoning: true },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200000, maxTokens: 16384, maxOutputLimit: 64000, input: ['text', 'image'], reasoning: true },
  ],
};
