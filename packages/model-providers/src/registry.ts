import type { LanguageModelV1 } from 'ai'

export type ProviderFactory = (modelId: string) => LanguageModelV1

export class ProviderRegistry {
  private providers = new Map<string, ProviderFactory>()

  register(name: string, factory: ProviderFactory): void {
    this.providers.set(name, factory)
  }

  get(name: string): ProviderFactory {
    const factory = this.providers.get(name)
    if (!factory) {
      throw new Error(`Provider "${name}" not registered. Available: ${[...this.providers.keys()].join(', ')}`)
    }
    return factory
  }

  getModel(provider: string, modelId: string): LanguageModelV1 {
    return this.get(provider)(modelId)
  }

  has(name: string): boolean {
    return this.providers.has(name)
  }

  list(): string[] {
    return [...this.providers.keys()]
  }
}

export const providerRegistry = new ProviderRegistry()
