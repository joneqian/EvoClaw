export type Provider =
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'minimax'
  | 'glm'
  | 'doubao'
  | 'qwen'

export interface ModelConfig {
  id: string
  name: string
  provider: Provider
  modelId: string
  config?: Record<string, unknown>
  isDefault: boolean
  createdAt: number
}
