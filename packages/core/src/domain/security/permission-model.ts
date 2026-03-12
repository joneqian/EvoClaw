import { nanoid } from 'nanoid'
import { getDatabase } from '../../infrastructure/db/sqlite-store.js'

export type PermissionCategory = 'filesystem' | 'network' | 'exec' | 'clipboard' | 'notification' | 'keychain' | 'agent-comm'
export type PermissionScope = 'once' | 'session' | 'always' | 'deny'

export interface PermissionGrant {
  id: string
  agentId: string
  category: PermissionCategory
  scope: PermissionScope
  resource?: string
  grantedBy: 'user-prompt' | 'user-settings' | 'system-default'
  grantedAt: number
  expiresAt?: number
}

export interface PermissionCheck {
  agentId: string
  category: PermissionCategory
  resource?: string
}

export type PermissionResult = 'allowed' | 'denied' | 'prompt'

export class PermissionService {
  private sessionCache = new Map<string, PermissionScope>()

  private cacheKey(check: PermissionCheck): string {
    return `${check.agentId}:${check.category}:${check.resource || '*'}`
  }

  check(check: PermissionCheck): PermissionResult {
    // 1. Check session cache
    const cached = this.sessionCache.get(this.cacheKey(check))
    if (cached === 'always') return 'allowed'
    if (cached === 'deny') return 'denied'
    if (cached === 'session') return 'allowed'

    // 2. Check persistent grants
    const db = getDatabase()
    const grant = db.prepare(
      `SELECT scope, expires_at as expiresAt FROM permissions
       WHERE agent_id = ? AND category = ? AND (resource IS NULL OR resource = ?)
       ORDER BY granted_at DESC LIMIT 1`
    ).get(check.agentId, check.category, check.resource || null) as { scope: PermissionScope; expiresAt?: number } | undefined

    if (grant) {
      if (grant.expiresAt && grant.expiresAt < Date.now()) {
        // Expired, need to prompt
        return 'prompt'
      }
      if (grant.scope === 'always') {
        this.sessionCache.set(this.cacheKey(check), 'always')
        return 'allowed'
      }
      if (grant.scope === 'deny') {
        this.sessionCache.set(this.cacheKey(check), 'deny')
        return 'denied'
      }
    }

    // 3. No grant found, need to prompt
    return 'prompt'
  }

  grant(check: PermissionCheck, scope: PermissionScope, grantedBy: PermissionGrant['grantedBy'] = 'user-prompt'): void {
    const db = getDatabase()

    // Persist if not "once"
    if (scope !== 'once') {
      const id = nanoid()
      db.prepare(
        `INSERT INTO permissions (id, agent_id, category, scope, resource, granted_by, granted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, check.agentId, check.category, scope, check.resource || null, grantedBy, Date.now())
    }

    // Cache
    this.sessionCache.set(this.cacheKey(check), scope)

    // Audit
    this.audit(check.agentId, 'permission_grant', check.category, check.resource, scope)
  }

  revoke(agentId: string, category?: PermissionCategory): void {
    const db = getDatabase()
    if (category) {
      db.prepare(`DELETE FROM permissions WHERE agent_id = ? AND category = ?`).run(agentId, category)
    } else {
      db.prepare(`DELETE FROM permissions WHERE agent_id = ?`).run(agentId)
    }
    // Clear cache for this agent
    for (const [key] of this.sessionCache) {
      if (key.startsWith(`${agentId}:`)) {
        this.sessionCache.delete(key)
      }
    }
  }

  listGrants(agentId: string): PermissionGrant[] {
    const db = getDatabase()
    return db.prepare(
      `SELECT id, agent_id as agentId, category, scope, resource, granted_by as grantedBy, granted_at as grantedAt, expires_at as expiresAt
       FROM permissions WHERE agent_id = ? ORDER BY granted_at DESC`
    ).all(agentId) as PermissionGrant[]
  }

  private audit(agentId: string, action: string, category: string, resource?: string, result?: string): void {
    const db = getDatabase()
    db.prepare(
      `INSERT INTO audit_log (agent_id, action, category, resource, result, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(agentId, action, category, resource || null, result || 'ok', Date.now())
  }

  clearSession(): void {
    this.sessionCache.clear()
  }
}

export const permissionService = new PermissionService()
