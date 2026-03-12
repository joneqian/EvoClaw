export type MessageRole = 'user' | 'assistant' | 'system'

export interface Message {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  modelId?: string
  tokenCount?: number
  createdAt: number
}

export interface Conversation {
  id: string
  agentId: string
  channel: 'desktop' | 'feishu' | 'wecom' | 'qq'
  channelSessionId?: string
  title?: string
  createdAt: number
  updatedAt: number
}

export interface ChatContext {
  agentId: string
  conversationId: string
  userMessage: string
  soul?: string
  messages: Array<{ role: MessageRole; content: string }>
  model?: string
}

export interface ChatResponse {
  messageId: string
  content: string
  modelId: string
  tokenCount?: number
}
