import { nanoid } from 'nanoid'
import type { Agent, AgentStatus } from '@evoclaw/shared'
import { getDatabase } from '../../infrastructure/db/sqlite-store.js'

export class AgentRepository {
  create(name: string, soulContent: string): Agent {
    const db = getDatabase()
    const agent: Agent = {
      id: nanoid(),
      name,
      status: 'draft',
      soulContent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    db.prepare(
      `INSERT INTO agents (id, name, status, soul_content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(agent.id, agent.name, agent.status, agent.soulContent, agent.createdAt, agent.updatedAt)
    return agent
  }

  get(id: string): Agent | null {
    const db = getDatabase()
    const row = db.prepare(
      `SELECT id, name, status, soul_content as soulContent, created_at as createdAt, updated_at as updatedAt
       FROM agents WHERE id = ?`
    ).get(id) as Agent | undefined
    return row ?? null
  }

  list(status?: AgentStatus): Agent[] {
    const db = getDatabase()
    if (status) {
      return db.prepare(
        `SELECT id, name, status, soul_content as soulContent, created_at as createdAt, updated_at as updatedAt
         FROM agents WHERE status = ? ORDER BY updated_at DESC`
      ).all(status) as Agent[]
    }
    return db.prepare(
      `SELECT id, name, status, soul_content as soulContent, created_at as createdAt, updated_at as updatedAt
       FROM agents ORDER BY updated_at DESC`
    ).all() as Agent[]
  }

  update(id: string, updates: Partial<Pick<Agent, 'name' | 'status' | 'soulContent'>>): Agent | null {
    const db = getDatabase()
    const existing = this.get(id)
    if (!existing) return null

    const name = updates.name ?? existing.name
    const status = updates.status ?? existing.status
    const soulContent = updates.soulContent ?? existing.soulContent
    const now = Date.now()

    db.prepare(
      `UPDATE agents SET name = ?, status = ?, soul_content = ?, updated_at = ? WHERE id = ?`
    ).run(name, status, soulContent, now, id)

    return { ...existing, name, status, soulContent, updatedAt: now }
  }

  archive(id: string): boolean {
    const db = getDatabase()
    const result = db.prepare(
      `UPDATE agents SET status = 'archived', updated_at = ? WHERE id = ?`
    ).run(Date.now(), id)
    return result.changes > 0
  }

  delete(id: string): boolean {
    const db = getDatabase()
    const result = db.prepare(`DELETE FROM agents WHERE id = ?`).run(id)
    return result.changes > 0
  }
}

export const agentRepository = new AgentRepository()
