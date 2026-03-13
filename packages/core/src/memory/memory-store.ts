/**
 * 记忆存储层 — 基于 SQLite 的记忆单元 CRUD 操作
 *
 * 负责 MemoryUnit (camelCase) 与数据库行 (snake_case) 之间的映射。
 */

import type { MemoryCategory, MemoryUnit, MemoryVisibility, MergeType } from '@evoclaw/shared';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { VectorStore } from '../infrastructure/db/vector-store.js';

/** 将数据库行 (snake_case) 映射为 MemoryUnit (camelCase) */
export function rowToUnit(row: Record<string, unknown>): MemoryUnit {
  return {
    id: row['id'] as string,
    agentId: row['agent_id'] as string,
    category: row['category'] as MemoryCategory,
    mergeType: row['merge_type'] as MergeType,
    mergeKey: (row['merge_key'] as string) ?? null,
    l0Index: row['l0_index'] as string,
    l1Overview: row['l1_overview'] as string,
    l2Content: row['l2_content'] as string,
    confidence: row['confidence'] as number,
    activation: row['activation'] as number,
    accessCount: row['access_count'] as number,
    visibility: row['visibility'] as MemoryVisibility,
    sourceConversationId: (row['source_session_key'] as string) ?? null,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
    archivedAt: (row['archived_at'] as string) ?? null,
  };
}

/** 将 MemoryUnit (camelCase) 映射为数据库行 (snake_case) 用于 INSERT */
export function unitToRow(unit: MemoryUnit): Record<string, unknown> {
  return {
    id: unit.id,
    agent_id: unit.agentId,
    category: unit.category,
    merge_type: unit.mergeType,
    merge_key: unit.mergeKey,
    l0_index: unit.l0Index,
    l1_overview: unit.l1Overview,
    l2_content: unit.l2Content,
    confidence: unit.confidence,
    activation: unit.activation,
    access_count: unit.accessCount,
    visibility: unit.visibility,
    source_session_key: unit.sourceConversationId,
    created_at: unit.createdAt,
    updated_at: unit.updatedAt,
    archived_at: unit.archivedAt,
  };
}

/** L1 精简投影类型 */
type L1Projection = Pick<MemoryUnit, 'id' | 'agentId' | 'category' | 'l0Index' | 'l1Overview' | 'confidence' | 'activation'>;

/** 列表查询过滤条件 */
interface ListFilter {
  category?: MemoryCategory;
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
}

/**
 * 记忆存储 — 封装 memory_units 表的所有 CRUD 操作
 */
export class MemoryStore {
  constructor(
    private db: SqliteStore,
    private vectorStore?: VectorStore,
  ) {}

  /** 插入一条新的记忆单元 */
  insert(unit: MemoryUnit): void {
    const row = unitToRow(unit);
    this.db.run(
      `INSERT INTO memory_units (
        id, agent_id, category, merge_type, merge_key,
        l0_index, l1_overview, l2_content,
        confidence, activation, access_count,
        visibility, source_session_key,
        created_at, updated_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.agent_id, row.category, row.merge_type, row.merge_key,
      row.l0_index, row.l1_overview, row.l2_content,
      row.confidence, row.activation, row.access_count,
      row.visibility, row.source_session_key,
      row.created_at, row.updated_at, row.archived_at,
    );

    // 异步索引 embedding（不阻塞写入）
    this.queueEmbeddingIndex(unit.id, `${unit.l0Index} ${unit.l1Overview}`);
  }

  /** 部分更新记忆单元的指定字段 */
  update(
    id: string,
    partial: Partial<Pick<MemoryUnit, 'l0Index' | 'l1Overview' | 'l2Content' | 'confidence' | 'activation' | 'visibility'>>,
  ): void {
    // 字段映射：camelCase → snake_case
    const fieldMap: Record<string, string> = {
      l0Index: 'l0_index',
      l1Overview: 'l1_overview',
      l2Content: 'l2_content',
      confidence: 'confidence',
      activation: 'activation',
      visibility: 'visibility',
    };

    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(partial)) {
      const column = fieldMap[key];
      if (column !== undefined) {
        setClauses.push(`${column} = ?`);
        values.push(value);
      }
    }

    if (setClauses.length === 0) return;

    // 同时更新 updated_at 时间戳
    setClauses.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db.run(
      `UPDATE memory_units SET ${setClauses.join(', ')} WHERE id = ?`,
      ...values,
    );

    // l0/l1 变化时重新索引 embedding
    if (partial.l0Index !== undefined || partial.l1Overview !== undefined) {
      const unit = this.getById(id);
      if (unit) {
        this.queueEmbeddingIndex(id, `${unit.l0Index} ${unit.l1Overview}`);
      }
    }
  }

  /** 根据 ID 查询单条记忆 */
  getById(id: string): MemoryUnit | null {
    const row = this.db.get<Record<string, unknown>>(
      'SELECT * FROM memory_units WHERE id = ?',
      id,
    );
    return row ? rowToUnit(row) : null;
  }

  /** 根据多个 ID 批量查询记忆（完整字段） */
  getByIds(ids: string[]): MemoryUnit[] {
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT * FROM memory_units WHERE id IN (${placeholders})`,
      ...ids,
    );
    return rows.map(rowToUnit);
  }

  /** 根据多个 ID 批量查询 L1 精简投影（减少数据传输） */
  getL1ByIds(ids: string[]): L1Projection[] {
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT id, agent_id, category, l0_index, l1_overview, confidence, activation
       FROM memory_units WHERE id IN (${placeholders})`,
      ...ids,
    );
    return rows.map((row) => ({
      id: row['id'] as string,
      agentId: row['agent_id'] as string,
      category: row['category'] as MemoryCategory,
      l0Index: row['l0_index'] as string,
      l1Overview: row['l1_overview'] as string,
      confidence: row['confidence'] as number,
      activation: row['activation'] as number,
    }));
  }

  /** 根据合并键查找记忆（用于去重和合并） */
  findByMergeKey(agentId: string, mergeKey: string): MemoryUnit | null {
    const row = this.db.get<Record<string, unknown>>(
      'SELECT * FROM memory_units WHERE agent_id = ? AND merge_key = ?',
      agentId,
      mergeKey,
    );
    return row ? rowToUnit(row) : null;
  }

  /** 列出指定 Agent 的记忆，支持分类过滤和分页 */
  listByAgent(agentId: string, filter?: ListFilter): MemoryUnit[] {
    const conditions = ['agent_id = ?'];
    const params: unknown[] = [agentId];

    // 默认不包含已归档的记忆
    if (!filter?.includeArchived) {
      conditions.push('archived_at IS NULL');
    }

    if (filter?.category) {
      conditions.push('category = ?');
      params.push(filter.category);
    }

    const limit = filter?.limit ?? 100;
    const offset = filter?.offset ?? 0;

    const rows = this.db.all<Record<string, unknown>>(
      `SELECT * FROM memory_units
       WHERE ${conditions.join(' AND ')}
       ORDER BY activation DESC, updated_at DESC
       LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    return rows.map(rowToUnit);
  }

  /** 归档记忆（软删除） */
  archive(id: string): void {
    this.db.run(
      'UPDATE memory_units SET archived_at = ?, updated_at = ? WHERE id = ?',
      new Date().toISOString(),
      new Date().toISOString(),
      id,
    );
  }

  /** 置顶记忆 */
  pin(id: string): void {
    this.db.run(
      'UPDATE memory_units SET pinned = 1, updated_at = ? WHERE id = ?',
      new Date().toISOString(),
      id,
    );
  }

  /** 取消置顶 */
  unpin(id: string): void {
    this.db.run(
      'UPDATE memory_units SET pinned = 0, updated_at = ? WHERE id = ?',
      new Date().toISOString(),
      id,
    );
  }

  /** 批量提升激活度：access_count += 1, activation += 0.1 */
  bumpActivation(ids: string[]): void {
    if (ids.length === 0) return;

    const now = new Date().toISOString();
    this.db.transaction(() => {
      for (const id of ids) {
        this.db.run(
          `UPDATE memory_units
           SET access_count = access_count + 1,
               activation = activation + 0.1,
               last_access_at = ?,
               updated_at = ?
           WHERE id = ?`,
          now,
          now,
          id,
        );
      }
    });
  }

  /** 永久删除记忆 */
  delete(id: string): void {
    this.db.run('DELETE FROM memory_units WHERE id = ?', id);
    this.vectorStore?.removeEmbedding(id);
  }

  /** 异步队列索引 embedding */
  private queueEmbeddingIndex(id: string, text: string): void {
    if (!this.vectorStore) return;
    this.vectorStore.indexText(id, text, 'memory').catch(() => {
      // embedding 失败不影响主流程
    });
  }
}
