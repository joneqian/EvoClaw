import { createOpenAI } from '@ai-sdk/openai'
import { providerRegistry, type ProviderFactory } from '../registry.js'

interface OpenAICompatibleConfig {
  name: string
  apiKey: string
  baseURL: string
}

export function registerOpenAICompatible(config: OpenAICompatibleConfig): void {
  const provider = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  })
  const factory: ProviderFactory = (modelId: string) => provider(modelId)
  providerRegistry.register(config.name, factory)
}

export function registerDeepSeek(apiKey: string): void {
  registerOpenAICompatible({
    name: 'deepseek',
    apiKey,
    baseURL: 'https://api.deepseek.com/v1',
  })
}

export function registerMiniMax(apiKey: string): void {
  registerOpenAICompatible({
    name: 'minimax',
    apiKey,
    baseURL: 'https://api.minimax.chat/v1',
  })
}

export function registerGLM(apiKey: string): void {
  registerOpenAICompatible({
    name: 'glm',
    apiKey,
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  })
}

export function registerDoubao(apiKey: string): void {
  registerOpenAICompatible({
    name: 'doubao',
    apiKey,
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  })
}

export function registerQwen(apiKey: string): void {
  registerOpenAICompatible({
    name: 'qwen',
    apiKey,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  })
}
