import Database from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'

let db: Database.Database | null = null

function getDataDir(): string {
  const dir = join(homedir(), '.evoclaw')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function initDatabase(dbPath?: string): Database.Database {
  const path = dbPath || join(getDataDir(), 'evoclaw.db')
  db = new Database(path)

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  return db
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
