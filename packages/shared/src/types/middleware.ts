import type { ChatContext, ChatResponse } from './message.js'

export interface Middleware {
  name: string
  before?(ctx: ChatContext): Promise<ChatContext>
  after?(ctx: ChatContext, response: ChatResponse): Promise<void>
}
