import crypto from 'node:crypto';
import type { KnowledgeGraphEntry } from '@evoclaw/shared';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';

/** 知识图谱 DB 行类型（snake_case） */
interface KnowledgeGraphRow {
  id: string;
  agent_id: string;
  user_id: string | null;
  subject_id: string;
  predicate: string;
  object_id: string;
  object_literal: string | null;
  confidence: number;
  source_memory_id: string | null;
  created_at: string;
  updated_at: string;
}

/** 将 DB 行映射为 TS 接口（snake_case → camelCase，predicate → relation） */
function rowToEntry(row: KnowledgeGraphRow): KnowledgeGraphEntry {
  return {
    id: row.id,
    agentId: row.agent_id,
    subjectId: row.subject_id,
    relation: row.predicate,
    objectId: row.object_id,
    confidence: row.confidence,
    createdAt: row.created_at,
  };
}

/**
 * 知识图谱存储 — 基于 SQLite 的实体关系三元组管理
 *
 * 表 knowledge_graph 存储 (subject, predicate, object) 三元组，
 * 支持按主语、宾语查询以及实体扩展。
 */
export class KnowledgeGraphStore {
  constructor(private db: SqliteStore) {}

  /**
   * 插入一条关系三元组，返回生成的 ID
   */
  insertRelation(relation: {
    agentId: string;
    subjectId: string;
    predicate: string;
    objectId: string;
    objectLiteral?: string;
    confidence: number;
    sourceMemoryId?: string;
  }): string {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO knowledge_graph
        (id, agent_id, subject_id, predicate, object_id, object_literal, confidence, source_memory_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      relation.agentId,
      relation.subjectId,
      relation.predicate,
      relation.objectId,
      relation.objectLiteral ?? null,
      relation.confidence,
      relation.sourceMemoryId ?? null,
      now,
      now,
    );

    return id;
  }

  /**
   * 按主语查询关系，可选按谓词过滤
   */
  queryBySubject(subjectId: string, predicate?: string): KnowledgeGraphEntry[] {
    if (predicate) {
      const rows = this.db.all<KnowledgeGraphRow>(
        `SELECT * FROM knowledge_graph WHERE subject_id = ? AND predicate = ? ORDER BY created_at DESC`,
        subjectId,
        predicate,
      );
      return rows.map(rowToEntry);
    }

    const rows = this.db.all<KnowledgeGraphRow>(
      `SELECT * FROM knowledge_graph WHERE subject_id = ? ORDER BY created_at DESC`,
      subjectId,
    );
    return rows.map(rowToEntry);
  }

  /**
   * 按宾语查询关系，可选按谓词过滤
   */
  queryByObject(objectId: string, predicate?: string): KnowledgeGraphEntry[] {
    if (predicate) {
      const rows = this.db.all<KnowledgeGraphRow>(
        `SELECT * FROM knowledge_graph WHERE object_id = ? AND predicate = ? ORDER BY created_at DESC`,
        objectId,
        predicate,
      );
      return rows.map(rowToEntry);
    }

    const rows = this.db.all<KnowledgeGraphRow>(
      `SELECT * FROM knowledge_graph WHERE object_id = ? ORDER BY created_at DESC`,
      objectId,
    );
    return rows.map(rowToEntry);
  }

  /**
   * 查询实体作为主语或宾语的所有关系（并集）
   */
  queryBoth(entityId: string): KnowledgeGraphEntry[] {
    const rows = this.db.all<KnowledgeGraphRow>(
      `SELECT * FROM knowledge_graph
       WHERE subject_id = ? OR object_id = ?
       ORDER BY created_at DESC`,
      entityId,
      entityId,
    );
    return rows.map(rowToEntry);
  }

  /**
   * 扩展实体列表 — 返回涉及任意给定实体的所有关系
   */
  expandEntities(entityIds: string[]): KnowledgeGraphEntry[] {
    if (entityIds.length === 0) return [];

    // 构建占位符列表
    const placeholders = entityIds.map(() => '?').join(', ');
    const params = [...entityIds, ...entityIds];

    const rows = this.db.all<KnowledgeGraphRow>(
      `SELECT * FROM knowledge_graph
       WHERE subject_id IN (${placeholders}) OR object_id IN (${placeholders})
       ORDER BY created_at DESC`,
      ...params,
    );
    return rows.map(rowToEntry);
  }

  /**
   * 按来源记忆 ID 删除关系 — 当记忆被清除时级联清理图谱
   */
  deleteByMemorySource(sourceMemoryId: string): void {
    this.db.run(
      `DELETE FROM knowledge_graph WHERE source_memory_id = ?`,
      sourceMemoryId,
    );
  }
}
