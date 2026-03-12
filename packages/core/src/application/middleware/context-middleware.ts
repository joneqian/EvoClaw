import type { ChatContext } from '@evoclaw/shared'
import { getDatabase } from '../../infrastructure/db/sqlite-store.js'

export class ContextMiddleware {
  name = 'context'

  async before(ctx: ChatContext): Promise<ChatContext> {
    const db = getDatabase()

    // Load recent conversation history (last 20 messages)
    const rows = db.prepare(
      `SELECT role, content FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at DESC LIMIT 20`
    ).all(ctx.conversationId) as Array<{ role: string; content: string }>

    // Reverse to chronological order
    ctx.messages = rows.reverse().map((r) => ({
      role: r.role as 'user' | 'assistant' | 'system',
      content: r.content,
    }))

    // Load agent's soul content as system message
    const agent = db.prepare(
      `SELECT soul_content FROM agents WHERE id = ?`
    ).get(ctx.agentId) as { soul_content: string } | undefined

    if (agent?.soul_content) {
      ctx.soul = agent.soul_content
      ctx.messages.unshift({
        role: 'system',
        content: agent.soul_content,
      })
    }

    return ctx
  }
}
