export type AgentStatus = 'draft' | 'active' | 'paused' | 'archived' | 'testing'

export interface Soul {
  name: string
  role: string
  avatar?: string

  personality: {
    tone: 'formal' | 'friendly' | 'humorous' | 'concise'
    expertise: string[]
    language: string[]
  }

  constraints: {
    always: string[]
    never: string[]
  }

  interaction: {
    responseLength: 'short' | 'medium' | 'detailed'
    proactiveAsk: boolean
    citeSources: boolean
  }

  capabilities: {
    skills: string[]
    knowledgeBases: string[]
    tools: string[]
  }

  evolution: {
    memoryDistillation: boolean
    feedbackLearning: boolean
    autoSkillDiscovery: boolean
  }

  model: {
    preferred?: string
    fallback?: string
  }
}

export interface Agent {
  id: string
  name: string
  status: AgentStatus
  soulContent: string
  createdAt: number
  updatedAt: number
}
