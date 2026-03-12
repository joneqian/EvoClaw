import { Hono } from 'hono'
import { permissionService, type PermissionCategory, type PermissionScope } from '../domain/security/permission-model.js'

export const permissionRoutes = new Hono()

// List grants for an agent
permissionRoutes.get('/:agentId', (c) => {
  const grants = permissionService.listGrants(c.req.param('agentId'))
  return c.json({ grants })
})

// Check permission
permissionRoutes.post('/check', async (c) => {
  const body = await c.req.json<{ agentId: string; category: PermissionCategory; resource?: string }>()
  const result = permissionService.check(body)
  return c.json({ result })
})

// Grant permission
permissionRoutes.post('/grant', async (c) => {
  const body = await c.req.json<{
    agentId: string
    category: PermissionCategory
    scope: PermissionScope
    resource?: string
  }>()
  permissionService.grant(
    { agentId: body.agentId, category: body.category, resource: body.resource },
    body.scope,
  )
  return c.json({ ok: true })
})

// Revoke permissions
permissionRoutes.post('/revoke', async (c) => {
  const body = await c.req.json<{ agentId: string; category?: PermissionCategory }>()
  permissionService.revoke(body.agentId, body.category)
  return c.json({ ok: true })
})
