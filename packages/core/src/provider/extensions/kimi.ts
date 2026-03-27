import type { ProviderDefinition } from './types.js';

export const KIMI_PROVIDER: ProviderDefinition = {
  id: 'kimi',
  name: 'Kimi (Moonshot)',
  defaultBaseUrl: 'https://api.moonshot.ai/v1',
  api: 'openai-completions',
  models: [
    // K2.5（最新旗舰，多模态）
    { id: 'kimi-k2.5', name: 'Kimi K2.5', contextWindow: 262144, maxTokens: 262144, input: ['text', 'image'], isDefault: true },
    // K2 推理系列
    { id: 'kimi-k2-thinking', name: 'Kimi K2 Thinking', contextWindow: 262144, maxTokens: 262144, input: ['text'], reasoning: true },
    { id: 'kimi-k2-thinking-turbo', name: 'Kimi K2 Thinking Turbo', contextWindow: 262144, maxTokens: 262144, input: ['text'], reasoning: true },
    // K2 快速
    { id: 'kimi-k2-turbo', name: 'Kimi K2 Turbo', contextWindow: 256000, maxTokens: 16384, input: ['text'] },
  ],
};
