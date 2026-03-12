import { describe, it, expect } from 'vitest'
import { ProviderRegistry } from '@evoclaw/model-providers'

describe('ProviderRegistry', () => {
  it('should register and retrieve providers', () => {
    const registry = new ProviderRegistry()
    const mockFactory = (modelId: string) => ({ modelId } as any)

    registry.register('test', mockFactory)

    expect(registry.has('test')).toBe(true)
    expect(registry.list()).toContain('test')
  })

  it('should throw on unknown provider', () => {
    const registry = new ProviderRegistry()
    expect(() => registry.get('unknown')).toThrow('Provider "unknown" not registered')
  })

  it('should get model from provider', () => {
    const registry = new ProviderRegistry()
    const mockFactory = (modelId: string) => ({ modelId } as any)

    registry.register('test', mockFactory)
    const model = registry.getModel('test', 'my-model')
    expect((model as any).modelId).toBe('my-model')
  })
})
