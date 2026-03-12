import Database from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync, unlinkSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

let db: Database.Database | null = null
let encryptedDbPath: string | null = null
let tempDbPath: string | null = null
let dbEncryptionKey: Buffer | null = null

function getDataDir(): string {
  const dir = join(homedir(), '.evoclaw')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * Get or generate the database encryption key.
 * In production, the Rust Keychain plugin provides the key via EVOCLAW_DB_KEY env var.
 * For dev/test fallback, a key file is used at ~/.evoclaw/.db-key (chmod 600).
 */
function getEncryptionKey(): Buffer {
  const envKey = process.env['EVOCLAW_DB_KEY']
  if (envKey) return Buffer.from(envKey, 'hex')

  const keyPath = join(getDataDir(), '.db-key')
  if (existsSync(keyPath)) {
    return Buffer.from(readFileSync(keyPath, 'utf-8').trim(), 'hex')
  }

  // First run: generate a 256-bit key
  const key = randomBytes(32)
  writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 })
  chmodSync(keyPath, 0o600)
  return key
}

/**
 * AES-256-GCM encrypt a buffer.
 * Format: [12-byte IV][16-byte auth tag][ciphertext]
 */
function encryptBuffer(data: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted])
}

/**
 * AES-256-GCM decrypt a buffer.
 */
function decryptBuffer(data: Buffer, key: Buffer): Buffer {
  const iv = data.subarray(0, 12)
  const authTag = data.subarray(12, 28)
  const ciphertext = data.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/**
 * Initialize the database. If an encrypted DB file exists, it is decrypted
 * to a temp file which better-sqlite3 opens. On close, the DB is re-encrypted.
 *
 * @param dbPath - Path for the encrypted database (default: ~/.evoclaw/evoclaw.db)
 * @param skipEncryption - If true, skip encryption (for testing)
 */
export function initDatabase(dbPath?: string, skipEncryption?: boolean): Database.Database {
  if (skipEncryption) {
    // Test mode: plain SQLite, no encryption
    const path = dbPath || join(getDataDir(), 'evoclaw.db')
    db = new Database(path)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    return db
  }

  const storedPath = dbPath || join(getDataDir(), 'evoclaw.db')
  const tmpPath = storedPath + '.tmp'

  dbEncryptionKey = getEncryptionKey()
  encryptedDbPath = storedPath
  tempDbPath = tmpPath

  // Decrypt existing DB if it exists
  if (existsSync(storedPath)) {
    try {
      const encryptedData = readFileSync(storedPath)
      const decrypted = decryptBuffer(encryptedData, dbEncryptionKey)
      writeFileSync(tmpPath, decrypted, { mode: 0o600 })
    } catch {
      // Decryption failed — could be first run with unencrypted DB, or corrupted.
      // Try opening as plain SQLite (migration from unencrypted → encrypted).
      copyFileSync(storedPath, tmpPath)
    }
  }

  db = new Database(tmpPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  return db
}

/**
 * Flush the current database state to the encrypted file on disk.
 */
export function flushDatabase(): void {
  if (!db || !encryptedDbPath || !tempDbPath || !dbEncryptionKey) return

  // Checkpoint WAL to ensure all data is in the main DB file
  db.pragma('wal_checkpoint(TRUNCATE)')

  const plainData = readFileSync(tempDbPath)
  const encrypted = encryptBuffer(plainData, dbEncryptionKey)
  writeFileSync(encryptedDbPath, encrypted, { mode: 0o600 })
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function closeDatabase(): void {
  if (db) {
    // Flush encrypted version before closing
    if (encryptedDbPath && dbEncryptionKey) {
      flushDatabase()
    }

    db.close()
    db = null

    // Clean up temp file
    if (tempDbPath && existsSync(tempDbPath)) {
      unlinkSync(tempDbPath)
      // Also clean WAL/SHM files
      if (existsSync(tempDbPath + '-wal')) unlinkSync(tempDbPath + '-wal')
      if (existsSync(tempDbPath + '-shm')) unlinkSync(tempDbPath + '-shm')
    }

    encryptedDbPath = null
    tempDbPath = null
    dbEncryptionKey = null
  }
}
