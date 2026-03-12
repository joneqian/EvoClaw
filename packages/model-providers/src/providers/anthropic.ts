import { createOpenAI } from '@ai-sdk/openai'
import { providerRegistry, type ProviderFactory } from '../registry.js'

/**
 * Register Anthropic via OpenAI-compatible proxy.
 * For native Anthropic SDK support, install @ai-sdk/anthropic separately.
 */
export function registerAnthropic(apiKey: string): void {
  // Anthropic's API is not directly OpenAI-compatible,
  // so we register a placeholder that throws with instructions.
  // Users who need Anthropic should install @ai-sdk/anthropic.
  const factory: ProviderFactory = (_modelId: string) => {
    throw new Error(
      'Anthropic provider requires @ai-sdk/anthropic. Install: pnpm add @ai-sdk/anthropic'
    )
  }
  providerRegistry.register('anthropic', factory)
}

/**
 * Try to dynamically load @ai-sdk/anthropic, fallback to placeholder.
 */
export async function registerAnthropicAsync(apiKey: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const modPath = '@ai-sdk/anthropic'
    const mod = await (Function('p', 'return import(p)')(modPath) as Promise<{ createAnthropic: Function }>)
    const anthropic = mod.createAnthropic({ apiKey })
    const factory: ProviderFactory = (modelId: string) => anthropic(modelId)
    providerRegistry.register('anthropic', factory)
  } catch {
    registerAnthropic(apiKey)
  }
}
