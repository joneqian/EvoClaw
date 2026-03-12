import { streamText } from 'ai'
import { nanoid } from 'nanoid'
import { providerRegistry } from '@evoclaw/model-providers'
import { MiddlewarePipeline } from './middleware/pipeline.js'
import { ContextMiddleware } from './middleware/context-middleware.js'
import { PermissionMiddleware } from './middleware/permission-middleware.js'
import { modelRouter } from './model-router.js'
import { getDatabase } from '../infrastructure/db/sqlite-store.js'
import type { ChatContext, Message } from '@evoclaw/shared'

interface HandleMessageInput {
  agentId: string
  conversationId?: string
  userMessage: string
  model?: string
}

interface HandleMessageResult {
  messageId: string
  conversationId: string
  stream: AsyncIterable<string>
}

export class ChatService {
  private pipeline: MiddlewarePipeline

  constructor() {
    this.pipeline = new MiddlewarePipeline()
      .use(new PermissionMiddleware())
      .use(new ContextMiddleware())
  }

  async handleMessage(input: HandleMessageInput): Promise<HandleMessageResult> {
    const db = getDatabase()
    const conversationId = input.conversationId || nanoid()
    const userMessageId = nanoid()
    const assistantMessageId = nanoid()

    // Ensure conversation exists
    if (!input.conversationId) {
      db.prepare(
        `INSERT INTO conversations (id, agent_id, channel, title, created_at, updated_at)
         VALUES (?, ?, 'desktop', ?, ?, ?)`
      ).run(conversationId, input.agentId, input.userMessage.slice(0, 50), Date.now(), Date.now())
    }

    // Save user message
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, created_at)
       VALUES (?, ?, 'user', ?, ?)`
    ).run(userMessageId, conversationId, input.userMessage, Date.now())

    // Build context
    let ctx: ChatContext = {
      agentId: input.agentId,
      conversationId,
      userMessage: input.userMessage,
      messages: [],
      model: input.model,
    }

    // Run middleware before hooks
    ctx = await this.pipeline.before(ctx)

    // Use ModelRouter to select model
    const selection = modelRouter.select(input.agentId, input.model)
    const { provider, modelId } = selection

    if (!providerRegistry.has(provider)) {
      throw new Error(`Provider "${provider}" not configured. Please set your API key in Settings.`)
    }

    const model = providerRegistry.getModel(provider, modelId)

    // Build messages for LLM
    const llmMessages = ctx.messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }))
    llmMessages.push({ role: 'user', content: input.userMessage })

    // Stream response
    const result = streamText({
      model,
      messages: llmMessages,
    })

    const self = this
    const stream = (async function* () {
      let fullContent = ''
      const textStream = (await result).textStream
      for await (const chunk of textStream) {
        fullContent += chunk
        yield chunk
      }

      const modelStr = `${provider}/${modelId}`

      // Save assistant message
      db.prepare(
        `INSERT INTO messages (id, conversation_id, role, content, model_id, created_at)
         VALUES (?, ?, 'assistant', ?, ?, ?)`
      ).run(assistantMessageId, conversationId, fullContent, modelStr, Date.now())

      // Update conversation timestamp
      db.prepare(
        `UPDATE conversations SET updated_at = ? WHERE id = ?`
      ).run(Date.now(), conversationId)

      // Run middleware after hooks (async, non-blocking)
      self.pipeline.after(ctx, {
        messageId: assistantMessageId,
        content: fullContent,
        modelId: modelStr,
      }).catch((err) => console.error('Middleware after error:', err))
    })()

    return {
      messageId: assistantMessageId,
      conversationId,
      stream,
    }
  }

  getMessages(conversationId: string): Message[] {
    const db = getDatabase()
    return db.prepare(
      `SELECT id, conversation_id as conversationId, role, content, model_id as modelId, token_count as tokenCount, created_at as createdAt
       FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`
    ).all(conversationId) as Message[]
  }
}
