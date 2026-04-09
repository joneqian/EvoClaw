/**
 * 记忆反馈持久层 — 封装 memory_feedback 表的 CRUD
 *
 * 用户在前端记忆中心点"不准确 / 涉及隐私 / 过时"按钮时，路由层先调
 * insert() 写入反馈记录，再调 MemoryStore.update({ confidence }) 把
 * confidence 降权 — 衰减逻辑不在本 store 内部，保持单一职责。
 */

import crypto from 'node:crypto';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';

/** 反馈类型（与迁移 025 的 CHECK 约束保持一致） */
export type MemoryFeedbackType = 'inaccurate' | 'sensitive' | 'outdated';

/** 反馈记录（camelCase 视图） */
export interface MemoryFeedback {
  id: string;
  memoryId: string;
  agentId: string;
  type: MemoryFeedbackType;
  note: string | null;
  reportedAt: string;
  resolvedAt: string | null;
}

/** 新增反馈的输入参数 */
export interface InsertFeedbackInput {
  memoryId: string;
  agentId: string;
  type: MemoryFeedbackType;
  note?: string | null;
}

/** confidence 衰减步长 — 反馈一次扣 0.15 */
export const CONFIDENCE_DECAY_STEP = 0.15;

/** snake_case 行 → MemoryFeedback */
function rowToFeedback(row: Record<string, unknown>): MemoryFeedback {
  return {
    id: row['id'] as string,
    memoryId: row['memory_id'] as string,
    agentId: row['agent_id'] as string,
    type: row['type'] as MemoryFeedbackType,
    note: (row['note'] as string) ?? null,
    reportedAt: row['reported_at'] as string,
    resolvedAt: (row['resolved_at'] as string) ?? null,
  };
}

/**
 * 记忆反馈存储 — memory_feedback 表的所有操作
 */
export class MemoryFeedbackStore {
  constructor(private db: SqliteStore) {}

  /** 新增一条反馈记录 */
  insert(input: InsertFeedbackInput): MemoryFeedback {
    const id = crypto.randomUUID();
    const reportedAt = new Date().toISOString();
    this.db.run(
      `INSERT INTO memory_feedback (id, memory_id, agent_id, type, note, reported_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      input.memoryId,
      input.agentId,
      input.type,
      input.note ?? null,
      reportedAt,
    );
    return {
      id,
      memoryId: input.memoryId,
      agentId: input.agentId,
      type: input.type,
      note: input.note ?? null,
      reportedAt,
      resolvedAt: null,
    };
  }

  /** 根据 memory_id 列出所有反馈（按时间倒序，毫秒内 tie-break 用 rowid） */
  listByMemory(memoryId: string): MemoryFeedback[] {
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT * FROM memory_feedback WHERE memory_id = ? ORDER BY reported_at DESC, rowid DESC`,
      memoryId,
    );
    return rows.map(rowToFeedback);
  }

  /** 列出某 Agent 未解决的反馈（按时间倒序，毫秒内 tie-break 用 rowid） */
  listUnresolvedByAgent(agentId: string, limit: number = 50): MemoryFeedback[] {
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT * FROM memory_feedback
       WHERE agent_id = ? AND resolved_at IS NULL
       ORDER BY reported_at DESC, rowid DESC
       LIMIT ?`,
      agentId,
      limit,
    );
    return rows.map(rowToFeedback);
  }

  /** 列出某 Agent 全部反馈（含已解决，按时间倒序，毫秒内 tie-break 用 rowid） */
  listByAgent(agentId: string, limit: number = 100, offset: number = 0): MemoryFeedback[] {
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT * FROM memory_feedback
       WHERE agent_id = ?
       ORDER BY reported_at DESC, rowid DESC
       LIMIT ? OFFSET ?`,
      agentId,
      limit,
      offset,
    );
    return rows.map(rowToFeedback);
  }

  /** 根据 id 查询单条反馈 */
  getById(id: string): MemoryFeedback | null {
    const row = this.db.get<Record<string, unknown>>(
      `SELECT * FROM memory_feedback WHERE id = ?`,
      id,
    );
    return row ? rowToFeedback(row) : null;
  }

  /** 标记反馈已解决（resolved_at = now） */
  markResolved(id: string): void {
    this.db.run(
      `UPDATE memory_feedback SET resolved_at = ? WHERE id = ?`,
      new Date().toISOString(),
      id,
    );
  }

  /** 删除反馈记录（管理员/调试用，正常情况只会 markResolved） */
  delete(id: string): void {
    this.db.run(`DELETE FROM memory_feedback WHERE id = ?`, id);
  }
}
