import type Database from 'better-sqlite3'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `)

  const currentVersion = (
    db.prepare('SELECT MAX(version) as version FROM _migrations').get() as { version: number | null }
  ).version ?? 0

  const migrationsDir = join(__dirname, 'migrations')

  let files: string[]
  try {
    files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
  } catch {
    // migrations dir may not exist in dist yet — use inline fallback
    files = []
  }

  for (const file of files) {
    const match = file.match(/^(\d+)_/)
    if (!match) continue

    const version = parseInt(match[1], 10)
    if (version <= currentVersion) continue

    const sql = readFileSync(join(migrationsDir, file), 'utf-8')
    db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        version,
        file,
        Date.now()
      )
    })()

    console.log(`Migration applied: ${file}`)
  }
}
