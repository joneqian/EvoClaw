import type { ProviderDefinition } from './types.js';

export const GLM_PROVIDER: ProviderDefinition = {
  id: 'glm',
  name: '智谱 GLM',
  defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  api: 'openai-completions',
  models: [
    // GLM-5 系列（最新旗舰）
    { id: 'glm-5', name: 'GLM-5', contextWindow: 202800, maxTokens: 131100, input: ['text'], reasoning: true, isDefault: true },
    { id: 'glm-5-turbo', name: 'GLM-5 Turbo', contextWindow: 202800, maxTokens: 131100, input: ['text'], reasoning: true },
    // GLM-4.7 系列
    { id: 'glm-4.7', name: 'GLM-4.7', contextWindow: 204800, maxTokens: 131072, input: ['text'], reasoning: true },
    { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash', contextWindow: 200000, maxTokens: 131072, input: ['text'], reasoning: true },
    { id: 'glm-4.7-flashx', name: 'GLM-4.7 FlashX', contextWindow: 200000, maxTokens: 128000, input: ['text'], reasoning: true },
    // GLM-4.6 系列
    { id: 'glm-4.6', name: 'GLM-4.6', contextWindow: 204800, maxTokens: 131072, input: ['text'], reasoning: true },
    { id: 'glm-4.6v', name: 'GLM-4.6V', contextWindow: 128000, maxTokens: 32768, input: ['text', 'image'], reasoning: true },
    // GLM-4.5 系列
    { id: 'glm-4.5', name: 'GLM-4.5', contextWindow: 131072, maxTokens: 98304, input: ['text'], reasoning: true },
    { id: 'glm-4.5-air', name: 'GLM-4.5 Air', contextWindow: 131072, maxTokens: 98304, input: ['text'], reasoning: true },
    { id: 'glm-4.5-flash', name: 'GLM-4.5 Flash', contextWindow: 131072, maxTokens: 98304, input: ['text'], reasoning: true },
    { id: 'glm-4.5v', name: 'GLM-4.5V', contextWindow: 64000, maxTokens: 16384, input: ['text', 'image'], reasoning: true },
    // Embedding
    { id: 'embedding-3', name: 'Embedding 3', contextWindow: 8192, maxTokens: 0, input: ['text'], toolUse: false, dimension: 2048 },
  ],
};
