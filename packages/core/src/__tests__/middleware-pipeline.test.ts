import { describe, it, expect, vi } from 'vitest'
import { MiddlewarePipeline } from '../application/middleware/pipeline.js'
import type { ChatContext, ChatResponse, Middleware } from '@evoclaw/shared'

function makeCtx(overrides?: Partial<ChatContext>): ChatContext {
  return {
    agentId: 'test-agent',
    conversationId: 'test-conv',
    userMessage: 'hello',
    messages: [],
    ...overrides,
  }
}

function makeResponse(overrides?: Partial<ChatResponse>): ChatResponse {
  return {
    messageId: 'msg-1',
    content: 'response',
    modelId: 'openai/gpt-4o-mini',
    ...overrides,
  }
}

describe('MiddlewarePipeline', () => {
  it('should execute before hooks in order', async () => {
    const pipeline = new MiddlewarePipeline()
    const order: string[] = []

    const mw1: Middleware = {
      name: 'first',
      async before(ctx) {
        order.push('first')
        return { ...ctx, userMessage: ctx.userMessage + ' [1]' }
      },
    }

    const mw2: Middleware = {
      name: 'second',
      async before(ctx) {
        order.push('second')
        return { ...ctx, userMessage: ctx.userMessage + ' [2]' }
      },
    }

    pipeline.use(mw1).use(mw2)
    const result = await pipeline.before(makeCtx())

    expect(order).toEqual(['first', 'second'])
    expect(result.userMessage).toBe('hello [1] [2]')
  })

  it('should execute after hooks concurrently', async () => {
    const pipeline = new MiddlewarePipeline()
    const called: string[] = []

    pipeline
      .use({
        name: 'a',
        async after() {
          called.push('a')
        },
      })
      .use({
        name: 'b',
        async after() {
          called.push('b')
        },
      })

    await pipeline.after(makeCtx(), makeResponse())
    expect(called).toContain('a')
    expect(called).toContain('b')
  })

  it('should skip middleware without before/after', async () => {
    const pipeline = new MiddlewarePipeline()
    pipeline.use({ name: 'noop' })

    const ctx = makeCtx()
    const result = await pipeline.before(ctx)
    expect(result).toEqual(ctx)

    // Should not throw
    await pipeline.after(ctx, makeResponse())
  })
})
