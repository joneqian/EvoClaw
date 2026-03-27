import type { ProviderDefinition } from './types.js';

export const KIMI_PROVIDER: ProviderDefinition = {
  id: 'kimi',
  name: 'Kimi (Moonshot)',
  defaultBaseUrl: 'https://api.moonshot.cn/v1',
  api: 'openai-completions',
  models: [
    // K2.5（最新旗舰，多模态）
    { id: 'kimi-k2.5', name: 'Kimi K2.5', contextWindow: 262144, maxTokens: 65535, input: ['text', 'image'], isDefault: true },
    // K2 系列
    { id: 'kimi-k2-0905-preview', name: 'Kimi K2', contextWindow: 262144, maxTokens: 65535, input: ['text'] },
    { id: 'kimi-k2-thinking', name: 'Kimi K2 Thinking', contextWindow: 262144, maxTokens: 65535, input: ['text'], reasoning: true },
    // Moonshot V1（旧版）
    { id: 'moonshot-v1-128k', name: 'Moonshot V1 128K', contextWindow: 131072, maxTokens: 8192, input: ['text'] },
    { id: 'moonshot-v1-32k', name: 'Moonshot V1 32K', contextWindow: 32768, maxTokens: 8192, input: ['text'] },
  ],
};
