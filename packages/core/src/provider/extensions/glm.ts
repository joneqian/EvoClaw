import type { ProviderDefinition } from './types.js';

export const GLM_PROVIDER: ProviderDefinition = {
  id: 'glm',
  name: '智谱 GLM',
  defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  api: 'openai-completions',
  models: [
    // GLM-5（最新旗舰）
    { id: 'glm-5', name: 'GLM-5', contextWindow: 200000, maxTokens: 131072, input: ['text'], isDefault: true },
    // GLM-4.7 系列（CoT 推理）
    { id: 'glm-4.7', name: 'GLM-4.7', contextWindow: 202752, maxTokens: 65535, input: ['text'], reasoning: true },
    { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash', contextWindow: 131072, maxTokens: 65535, input: ['text'], reasoning: true },
    // GLM-4.6 系列
    { id: 'glm-4.6', name: 'GLM-4.6', contextWindow: 200000, maxTokens: 128000, input: ['text'], reasoning: true },
    { id: 'glm-4.6v', name: 'GLM-4.6V', contextWindow: 128000, maxTokens: 4096, input: ['text', 'image'] },
    // GLM-4 系列
    { id: 'glm-4-plus', name: 'GLM-4 Plus', contextWindow: 128000, maxTokens: 4096, input: ['text'] },
    { id: 'glm-4-air', name: 'GLM-4 Air', contextWindow: 128000, maxTokens: 4096, input: ['text'] },
    { id: 'glm-4-long', name: 'GLM-4 Long', contextWindow: 1000000, maxTokens: 4096, input: ['text'] },
    { id: 'glm-4-flash', name: 'GLM-4 Flash', contextWindow: 128000, maxTokens: 4096, input: ['text'] },
    // Z1 推理系列
    { id: 'glm-z1-air', name: 'GLM-Z1 Air', contextWindow: 128000, maxTokens: 16384, input: ['text'], reasoning: true },
    { id: 'glm-z1-flash', name: 'GLM-Z1 Flash', contextWindow: 128000, maxTokens: 16384, input: ['text'], reasoning: true },
  ],
};
