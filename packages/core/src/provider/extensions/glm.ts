import type { ProviderDefinition } from './types.js';

export const GLM_PROVIDER: ProviderDefinition = {
  id: 'glm',
  name: '智谱 GLM',
  defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  api: 'openai-completions',
  models: [
    { id: 'glm-4-plus', name: 'GLM-4 Plus', contextWindow: 128000, maxTokens: 4096, input: ['text'], isDefault: true },
    { id: 'glm-4-long', name: 'GLM-4 Long', contextWindow: 1000000, maxTokens: 4096, input: ['text'] },
    { id: 'glm-4-flash', name: 'GLM-4 Flash', contextWindow: 128000, maxTokens: 4096, input: ['text'] },
    { id: 'glm-4-flashx', name: 'GLM-4 FlashX', contextWindow: 128000, maxTokens: 4096, input: ['text'] },
    { id: 'glm-4v-plus', name: 'GLM-4V Plus', contextWindow: 8192, maxTokens: 4096, input: ['text', 'image'], toolUse: false },
    { id: 'glm-4v', name: 'GLM-4V', contextWindow: 4096, maxTokens: 4096, input: ['text', 'image'], toolUse: false },
  ],
};
