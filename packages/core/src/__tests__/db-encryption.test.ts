import { describe, it, expect, afterEach } from 'vitest'
import { initDatabase, closeDatabase } from '../infrastructure/db/sqlite-store.js'
import { runMigrations } from '../infrastructure/db/migration-runner.js'
import { join } from 'node:path'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

describe('Database at-rest encryption', () => {
  let tmpDir: string

  afterEach(() => {
    closeDatabase()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should encrypt the database file on close', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'evoclaw-enc-'))
    const dbPath = join(tmpDir, 'test.db')
    const key = randomBytes(32).toString('hex')

    // Set encryption key via env
    process.env['EVOCLAW_DB_KEY'] = key

    const db = initDatabase(dbPath)
    runMigrations(db)

    // Insert test data
    db.prepare('INSERT INTO agents (id, name, status, soul_content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      'test-id', 'Test Agent', 'active', '# Test Soul', Date.now(), Date.now()
    )

    // Close → triggers encryption
    closeDatabase()

    // The encrypted file should exist and NOT be valid SQLite
    expect(existsSync(dbPath)).toBe(true)
    const fileHeader = readFileSync(dbPath).subarray(0, 16).toString('utf-8')
    expect(fileHeader).not.toContain('SQLite format')

    // The temp file should be cleaned up
    expect(existsSync(dbPath + '.tmp')).toBe(false)

    // Reopen → should decrypt successfully
    const db2 = initDatabase(dbPath)
    runMigrations(db2)
    const row = db2.prepare('SELECT name FROM agents WHERE id = ?').get('test-id') as { name: string }
    expect(row.name).toBe('Test Agent')

    delete process.env['EVOCLAW_DB_KEY']
  })

  it('should work without encryption in test mode', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'evoclaw-plain-'))
    const dbPath = join(tmpDir, 'test.db')

    const db = initDatabase(dbPath, true)
    runMigrations(db)

    db.prepare('INSERT INTO agents (id, name, status, soul_content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      'test-id', 'Plain Agent', 'active', '# Plain', Date.now(), Date.now()
    )

    closeDatabase()

    // Plain mode: file should be valid SQLite
    const fileHeader = readFileSync(dbPath).subarray(0, 16).toString('utf-8')
    expect(fileHeader).toContain('SQLite format')
  })
})
