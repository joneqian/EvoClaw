import type { ProviderDefinition } from './types.js';

export const DOUBAO_PROVIDER: ProviderDefinition = {
  id: 'doubao',
  name: '字节豆包',
  defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  api: 'openai-completions',
  models: [
    // Seed 2.0 系列（最新旗舰）
    { id: 'doubao-seed-2-0-pro', name: 'Doubao Seed 2.0 Pro', contextWindow: 256000, maxTokens: 16384, input: ['text'], reasoning: true, isDefault: true },
    { id: 'doubao-seed-code', name: 'Doubao Seed Code', contextWindow: 256000, maxTokens: 16384, input: ['text'], reasoning: true },
    // Seed 1.8（超长输出）
    { id: 'doubao-seed-1-8', name: 'Doubao Seed 1.8', contextWindow: 256000, maxTokens: 224000, input: ['text', 'image'], reasoning: true },
    // 1.5 Pro 系列
    { id: 'doubao-1-5-pro-256k', name: 'Doubao 1.5 Pro 256K', contextWindow: 256000, maxTokens: 12288, input: ['text'] },
    { id: 'doubao-1-5-pro-32k', name: 'Doubao 1.5 Pro 32K', contextWindow: 32000, maxTokens: 12288, input: ['text'] },
    // 多模态
    { id: 'doubao-1-5-vision-pro', name: 'Doubao 1.5 Vision Pro', contextWindow: 128000, maxTokens: 16384, input: ['text', 'image'], reasoning: true },
  ],
};
