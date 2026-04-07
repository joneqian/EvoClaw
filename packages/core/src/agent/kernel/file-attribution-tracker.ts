/**
 * 文件操作追踪器 — 持久化 Agent 会话中的文件操作记录
 *
 * 用途:
 * - Autocompact 后注入 "本次会话修改的文件列表" 到摘要
 * - Fork Session 时复制文件操作历史
 * - 审计: 追踪 Agent 对文件系统的修改范围
 *
 * 生命周期: chat.ts 创建 → 通过 QueryLoopConfig 传递 → 工具执行时记录
 */

import crypto from 'node:crypto';
import type { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('file-attribution');

/** 文件操作类型 */
export type FileAction = 'read' | 'write' | 'edit' | 'create' | 'delete';

/**
 * 文件操作追踪器
 */
export class FileAttributionTracker {
  private readonly queue: Array<{
    filePath: string;
    action: FileAction;
    contentHash?: string;
    turnIndex: number;
  }> = [];

  constructor(
    private readonly store: SqliteStore,
    private readonly agentId: string,
    private readonly sessionKey: string,
  ) {}

  /**
   * 记录一次文件操作
   */
  record(filePath: string, action: FileAction, turnIndex: number, contentHash?: string): void {
    this.queue.push({ filePath, action, turnIndex, contentHash });

    // 每 10 条批量写入
    if (this.queue.length >= 10) {
      this.flush();
    }
  }

  /**
   * 批量写入所有待记录的操作
   */
  flush(): void {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0);
    try {
      this.store.transaction(() => {
        for (const entry of batch) {
          this.store.run(
            `INSERT INTO file_attributions (id, agent_id, session_key, file_path, action, content_hash, turn_index, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            crypto.randomUUID(),
            this.agentId,
            this.sessionKey,
            entry.filePath,
            entry.action,
            entry.contentHash ?? null,
            entry.turnIndex,
          );
        }
      });
    } catch (err) {
      log.warn(`文件操作记录写入失败 (${batch.length} 条): ${err instanceof Error ? err.message : err}`);
    }
  }

  // ─── Static: 查询接口 ───

  /**
   * 获取会话中修改过的文件列表（去重，按最近操作排序）
   *
   * 用于 autocompact 摘要注入。
   */
  static getModifiedFiles(
    store: SqliteStore,
    agentId: string,
    sessionKey: string,
    limit: number = 20,
  ): string[] {
    const rows = store.all<{ file_path: string }>(
      `SELECT DISTINCT file_path
       FROM file_attributions
       WHERE agent_id = ? AND session_key = ? AND action IN ('write', 'edit', 'create')
       ORDER BY MAX(created_at) DESC
       LIMIT ?`,
      agentId, sessionKey, limit,
    );
    return rows.map(r => r.file_path);
  }

  /**
   * 获取会话中所有文件操作（含 read）
   */
  static getAllOperations(
    store: SqliteStore,
    agentId: string,
    sessionKey: string,
  ): Array<{ filePath: string; action: FileAction; turnIndex: number; createdAt: string }> {
    const rows = store.all<{
      file_path: string; action: string; turn_index: number; created_at: string;
    }>(
      `SELECT file_path, action, turn_index, created_at
       FROM file_attributions
       WHERE agent_id = ? AND session_key = ?
       ORDER BY created_at ASC`,
      agentId, sessionKey,
    );
    return rows.map(r => ({
      filePath: r.file_path,
      action: r.action as FileAction,
      turnIndex: r.turn_index,
      createdAt: r.created_at,
    }));
  }
}
