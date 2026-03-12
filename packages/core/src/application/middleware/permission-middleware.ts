import type { ChatContext } from '@evoclaw/shared'
import { permissionService } from '../../domain/security/permission-model.js'

export class PermissionMiddleware {
  name = 'permission'

  async before(ctx: ChatContext): Promise<ChatContext> {
    // For Sprint 2, basic permission check: verify the agent is allowed to chat
    const result = permissionService.check({
      agentId: ctx.agentId,
      category: 'network',
      resource: 'llm-api',
    })

    if (result === 'denied') {
      throw new Error(`Agent "${ctx.agentId}" is denied network access to LLM API.`)
    }

    // 'prompt' and 'allowed' both proceed — UI layer handles prompting
    return ctx
  }
}
