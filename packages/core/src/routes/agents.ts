import { Hono } from 'hono'
import { agentRepository } from '../domain/agent/agent.js'
import { agentBuilder, type BuilderState } from '../application/agent-builder.js'
import type { AgentStatus } from '@evoclaw/shared'

export const agentRoutes = new Hono()

// List agents
agentRoutes.get('/', (c) => {
  const status = c.req.query('status') as AgentStatus | undefined
  const agents = agentRepository.list(status)
  return c.json({ agents })
})

// Get agent
agentRoutes.get('/:id', (c) => {
  const agent = agentRepository.get(c.req.param('id'))
  if (!agent) return c.json({ error: 'Agent not found' }, 404)
  return c.json({ agent })
})

// Create agent (direct)
agentRoutes.post('/', async (c) => {
  const body = await c.req.json<{ name: string; soulContent: string }>()
  if (!body.name || !body.soulContent) {
    return c.json({ error: 'name and soulContent are required' }, 400)
  }
  const agent = agentRepository.create(body.name, body.soulContent)
  return c.json({ agent }, 201)
})

// Update agent
agentRoutes.patch('/:id', async (c) => {
  const body = await c.req.json<{ name?: string; status?: AgentStatus; soulContent?: string }>()
  const agent = agentRepository.update(c.req.param('id'), body)
  if (!agent) return c.json({ error: 'Agent not found' }, 404)
  return c.json({ agent })
})

// Archive agent
agentRoutes.post('/:id/archive', (c) => {
  const ok = agentRepository.archive(c.req.param('id'))
  if (!ok) return c.json({ error: 'Agent not found' }, 404)
  return c.json({ ok: true })
})

// Delete agent
agentRoutes.delete('/:id', (c) => {
  const ok = agentRepository.delete(c.req.param('id'))
  if (!ok) return c.json({ error: 'Agent not found' }, 404)
  return c.json({ ok: true })
})

// Agent Builder — conversational creation
const builderSessions = new Map<string, BuilderState>()

agentRoutes.post('/builder/start', (c) => {
  const sessionId = crypto.randomUUID()
  const state = agentBuilder.createInitialState()
  builderSessions.set(sessionId, state)
  return c.json({
    sessionId,
    phase: state.phase,
    message: agentBuilder.getPrompt(state),
  })
})

agentRoutes.post('/builder/:sessionId/message', async (c) => {
  const sessionId = c.req.param('sessionId')
  const state = builderSessions.get(sessionId)
  if (!state) return c.json({ error: 'Session not found' }, 404)

  const body = await c.req.json<{ message: string }>()
  if (!body.message) return c.json({ error: 'message is required' }, 400)

  const result = agentBuilder.processInput(state, body.message)
  builderSessions.set(sessionId, result.state)

  if (result.state.phase === 'done') {
    builderSessions.delete(sessionId)
  }

  return c.json({
    phase: result.state.phase,
    message: result.response,
    agentId: result.agentId,
  })
})
