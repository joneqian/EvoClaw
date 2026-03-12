import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PermissionService } from '../domain/security/permission-model.js'
import { initDatabase, closeDatabase } from '../infrastructure/db/sqlite-store.js'
import { runMigrations } from '../infrastructure/db/migration-runner.js'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

describe('PermissionService', () => {
  let tmpDir: string
  let service: PermissionService

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'evoclaw-test-'))
    const db = initDatabase(join(tmpDir, 'test.db'), true)
    runMigrations(db)
    service = new PermissionService()
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should return prompt for unknown permission', () => {
    const result = service.check({ agentId: 'agent-1', category: 'filesystem' })
    expect(result).toBe('prompt')
  })

  it('should allow after granting always', () => {
    service.grant({ agentId: 'agent-1', category: 'filesystem' }, 'always')
    const result = service.check({ agentId: 'agent-1', category: 'filesystem' })
    expect(result).toBe('allowed')
  })

  it('should deny after granting deny', () => {
    service.grant({ agentId: 'agent-1', category: 'network' }, 'deny')
    const result = service.check({ agentId: 'agent-1', category: 'network' })
    expect(result).toBe('denied')
  })

  it('should list grants', () => {
    service.grant({ agentId: 'agent-1', category: 'filesystem' }, 'always')
    service.grant({ agentId: 'agent-1', category: 'network' }, 'session')
    const grants = service.listGrants('agent-1')
    expect(grants).toHaveLength(2)
  })

  it('should revoke all grants for an agent', () => {
    service.grant({ agentId: 'agent-1', category: 'filesystem' }, 'always')
    service.grant({ agentId: 'agent-1', category: 'network' }, 'always')
    service.revoke('agent-1')
    const grants = service.listGrants('agent-1')
    expect(grants).toHaveLength(0)
    // Should be prompt again after revoke
    const result = service.check({ agentId: 'agent-1', category: 'filesystem' })
    expect(result).toBe('prompt')
  })

  it('should revoke specific category', () => {
    service.grant({ agentId: 'agent-1', category: 'filesystem' }, 'always')
    service.grant({ agentId: 'agent-1', category: 'network' }, 'always')
    service.revoke('agent-1', 'filesystem')
    const grants = service.listGrants('agent-1')
    expect(grants).toHaveLength(1)
    expect(grants[0].category).toBe('network')
  })
})
