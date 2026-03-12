import type { Middleware, ChatContext, ChatResponse } from '@evoclaw/shared'

export class MiddlewarePipeline {
  private middlewares: Middleware[] = []

  use(middleware: Middleware): this {
    this.middlewares.push(middleware)
    return this
  }

  async before(ctx: ChatContext): Promise<ChatContext> {
    for (const mw of this.middlewares) {
      if (mw.before) {
        ctx = await mw.before(ctx)
      }
    }
    return ctx
  }

  async after(ctx: ChatContext, response: ChatResponse): Promise<void> {
    await Promise.all(
      this.middlewares.map((mw) => mw.after?.(ctx, response))
    )
  }
}
