import type { SqliteStore } from './sqlite-store.js';

/**
 * FTS5 全文搜索索引 — 用于记忆单元的关键词检索
 * better-sqlite3 内置 FTS5 支持，无需额外扩展
 */
export class FtsStore {
  constructor(private db: SqliteStore) {
    this.ensureTable();
  }

  /** 确保 FTS5 虚拟表存在 */
  private ensureTable(): void {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts
      USING fts5(memory_id UNINDEXED, l0_index, l1_overview, tokenize='unicode61')
    `);
  }

  /** 索引一条记忆 */
  indexMemory(memoryId: string, l0: string, l1: string): void {
    // 先删除旧索引（如果存在）再插入
    this.db.run('DELETE FROM memory_fts WHERE memory_id = ?', memoryId);
    this.db.run(
      'INSERT INTO memory_fts (memory_id, l0_index, l1_overview) VALUES (?, ?, ?)',
      memoryId,
      l0,
      l1,
    );
  }

  /** 更新索引 */
  updateIndex(memoryId: string, l0: string, l1: string): void {
    this.indexMemory(memoryId, l0, l1); // 同逻辑
  }

  /** BM25 全文搜索 */
  search(
    query: string,
    limit: number = 20,
  ): Array<{ memoryId: string; score: number }> {
    if (!query.trim()) return [];
    // 转义 FTS5 特殊字符
    const safeQuery = query.replace(/['"*(){}[\]^~\\]/g, ' ').trim();
    if (!safeQuery) return [];

    const rows = this.db.all<{ memory_id: string; score: number }>(
      `SELECT memory_id, rank AS score FROM memory_fts
       WHERE memory_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
      safeQuery,
      limit,
    );
    return rows.map((r) => ({ memoryId: r.memory_id, score: r.score }));
  }

  /** 删除索引 */
  removeIndex(memoryId: string): void {
    this.db.run('DELETE FROM memory_fts WHERE memory_id = ?', memoryId);
  }
}
