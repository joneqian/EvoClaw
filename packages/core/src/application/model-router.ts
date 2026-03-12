import { providerRegistry } from '@evoclaw/model-providers'
import { getDatabase } from '../infrastructure/db/sqlite-store.js'
import { agentRepository } from '../domain/agent/agent.js'
import { parseSoul } from '../domain/agent/soul.js'
import { readSoulFile } from '../domain/agent/agent-fs.js'

export interface ModelSelection {
  provider: string
  modelId: string
}

export class ModelRouter {
  /**
   * Select model by: Agent config → User preference → System default
   */
  select(agentId: string, userOverride?: string): ModelSelection {
    // 1. User explicit override
    if (userOverride) {
      return this.parseModelString(userOverride)
    }

    // 2. Agent-level soul preference
    const soulMd = readSoulFile(agentId)
    if (soulMd) {
      const soul = parseSoul(soulMd)
      if (soul.model.preferred) {
        const sel = this.parseModelString(soul.model.preferred)
        if (providerRegistry.has(sel.provider)) return sel

        // Try fallback
        if (soul.model.fallback) {
          const fb = this.parseModelString(soul.model.fallback)
          if (providerRegistry.has(fb.provider)) return fb
        }
      }
    }

    // 3. System default from model_configs
    const db = getDatabase()
    const defaultModel = db.prepare(
      `SELECT provider, model_id as modelId FROM model_configs WHERE is_default = 1 LIMIT 1`
    ).get() as { provider: string; modelId: string } | undefined

    if (defaultModel && providerRegistry.has(defaultModel.provider)) {
      return { provider: defaultModel.provider, modelId: defaultModel.modelId }
    }

    // 4. Fallback: first available provider
    const available = providerRegistry.list()
    if (available.length > 0) {
      const provider = available[0]
      const defaults: Record<string, string> = {
        openai: 'gpt-4o-mini',
        anthropic: 'claude-sonnet-4-20250514',
        deepseek: 'deepseek-chat',
      }
      return { provider, modelId: defaults[provider] || 'default' }
    }

    throw new Error('No model providers configured. Please add an API key in Settings.')
  }

  private parseModelString(str: string): ModelSelection {
    const [provider, ...rest] = str.split('/')
    return { provider, modelId: rest.join('/') || 'default' }
  }
}

export const modelRouter = new ModelRouter()
