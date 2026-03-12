import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AgentBuilder } from '../application/agent-builder.js'
import { initDatabase, closeDatabase } from '../infrastructure/db/sqlite-store.js'
import { runMigrations } from '../infrastructure/db/migration-runner.js'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

describe('AgentBuilder', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'evoclaw-test-'))
    const db = initDatabase(join(tmpDir, 'test.db'))
    runMigrations(db)
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should create initial state at role phase', () => {
    const builder = new AgentBuilder()
    const state = builder.createInitialState()
    expect(state.phase).toBe('role')
    expect(state.conversationHistory).toHaveLength(0)
  })

  it('should progress through phases', () => {
    const builder = new AgentBuilder()
    let state = builder.createInitialState()

    // Phase 1: role
    let result = builder.processInput(state, '编程助手小助')
    expect(result.state.phase).toBe('expertise')
    expect(result.state.soul.name).toBe('编程助手小助')

    // Phase 2: expertise
    result = builder.processInput(result.state, 'TypeScript, React, Node.js')
    expect(result.state.phase).toBe('style')
    expect(result.state.soul.personality!.expertise).toContain('TypeScript')

    // Phase 3: style
    result = builder.processInput(result.state, '简洁直接')
    expect(result.state.phase).toBe('constraints')
    expect(result.state.soul.personality!.tone).toBe('concise')

    // Phase 4: constraints
    result = builder.processInput(result.state, '无')
    expect(result.state.phase).toBe('preview')

    // Phase 5: confirm
    result = builder.processInput(result.state, '确认')
    expect(result.state.phase).toBe('done')
    expect(result.agentId).toBeDefined()
  })

  it('should allow going back from preview', () => {
    const builder = new AgentBuilder()
    let state = builder.createInitialState()

    builder.processInput(state, 'Test Agent')
    const r2 = builder.processInput(state, 'Testing')
    const r3 = builder.processInput(r2.state, 'friendly')
    const r4 = builder.processInput(r3.state, '无')
    expect(r4.state.phase).toBe('preview')

    const r5 = builder.processInput(r4.state, '修改')
    expect(r5.state.phase).toBe('constraints')
  })
})
