import { createOpenAI } from '@ai-sdk/openai'
import { providerRegistry, type ProviderFactory } from '../registry.js'

export function registerOpenAI(apiKey: string, baseURL?: string): void {
  const openai = createOpenAI({
    apiKey,
    ...(baseURL && { baseURL }),
  })

  const factory: ProviderFactory = (modelId: string) => openai(modelId)
  providerRegistry.register('openai', factory)
}
