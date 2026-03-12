import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { ChatService } from '../application/chat-service.js'

export const chatRoutes = new Hono()

const chatService = new ChatService()

chatRoutes.post('/message', async (c) => {
  const body = await c.req.json<{
    agentId?: string
    conversationId?: string
    message: string
    model?: string
  }>()

  if (!body.message) {
    return c.json({ error: 'message is required' }, 400)
  }

  return streamSSE(c, async (stream) => {
    try {
      const result = await chatService.handleMessage({
        agentId: body.agentId || 'default',
        conversationId: body.conversationId,
        userMessage: body.message,
        model: body.model,
      })

      for await (const chunk of result.stream) {
        await stream.writeSSE({
          event: 'text',
          data: JSON.stringify({ content: chunk }),
        })
      }

      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          messageId: result.messageId,
          conversationId: result.conversationId,
        }),
      })
    } catch (err) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: String(err) }),
      })
    }
  })
})

chatRoutes.get('/conversations/:conversationId/messages', async (c) => {
  const conversationId = c.req.param('conversationId')
  const messages = chatService.getMessages(conversationId)
  return c.json({ messages })
})
