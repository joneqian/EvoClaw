import { nanoid } from 'nanoid'
import { getDatabase } from '../../infrastructure/db/sqlite-store.js'

export interface PreferenceEntry {
  id: string
  agentId: string
  category: string
  key: string
  value: string
  confidence: number
  observedCount: number
  source: 'inferred' | 'explicit'
  createdAt: number
  updatedAt: number
}

export interface KnowledgeEntry {
  id: string
  agentId: string
  topic: string
  content: string
  source: 'conversation' | 'knowledge_base' | 'skill'
  confidence: number
  createdAt: number
  updatedAt: number
}

export interface CorrectionEntry {
  id: string
  agentId: string
  original: string
  corrected: string
  rule: string
  appliedCount: number
  createdAt: number
}

export type MemoryEntry = {
  id: string
  agentId: string
  type: 'preference' | 'knowledge' | 'correction'
  category?: string
  key?: string
  value: string
  confidence: number
  observedCount: number
  source: string
  createdAt: number
  updatedAt: number
}

export class MemoryRepository {
  getByAgent(agentId: string, type?: string): MemoryEntry[] {
    const db = getDatabase()
    if (type) {
      return db.prepare(
        `SELECT id, agent_id as agentId, type, category, key, value, confidence, observed_count as observedCount, source, created_at as createdAt, updated_at as updatedAt
         FROM memories WHERE agent_id = ? AND type = ? ORDER BY confidence DESC`
      ).all(agentId, type) as MemoryEntry[]
    }
    return db.prepare(
      `SELECT id, agent_id as agentId, type, category, key, value, confidence, observed_count as observedCount, source, created_at as createdAt, updated_at as updatedAt
       FROM memories WHERE agent_id = ? ORDER BY confidence DESC`
    ).all(agentId) as MemoryEntry[]
  }

  upsert(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): MemoryEntry {
    const db = getDatabase()
    const now = Date.now()
    const id = nanoid()
    db.prepare(
      `INSERT INTO memories (id, agent_id, type, category, key, value, confidence, observed_count, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, entry.agentId, entry.type, entry.category ?? null, entry.key ?? null, entry.value, entry.confidence, entry.observedCount, entry.source, now, now)
    return { ...entry, id, createdAt: now, updatedAt: now }
  }

  delete(id: string): boolean {
    const db = getDatabase()
    return db.prepare(`DELETE FROM memories WHERE id = ?`).run(id).changes > 0
  }
}

export const memoryRepository = new MemoryRepository()
