/**
 * 增量持久化器 — queryLoop 逐轮消息写入 SQLite
 *
 * 核心策略:
 * - 100ms 批量写入，利用 SQLite WAL 模式高并发写入能力
 * - try-catch 包裹，写入失败不阻塞 Agent 循环
 * - flush() 同步写入，供优雅关闭和异常退出路径调用
 * - 崩溃后 orphaned 消息可自动恢复
 *
 * 生命周期: runSingleAttempt 创建 → queryLoop 使用 → finally flush → finalize/dispose
 */

import crypto from 'node:crypto';
import type { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import type { KernelMessage } from './types.js';
import { createLogger } from '../../infrastructure/logger.js';
import { registerActivePersister, unregisterActivePersister } from '../../infrastructure/graceful-shutdown.js';

const log = createLogger('incremental-persister');

/** 批量刷盘间隔 (ms) */
const FLUSH_INTERVAL_MS = 100;

/** 待写入条目 */
interface PendingEntry {
  readonly id: string;
  readonly agentId: string;
  readonly sessionKey: string;
  readonly role: string;
  readonly content: string;
  readonly turnIndex: number;
  readonly kernelMessageJson: string;
}

/**
 * 增量持久化器
 *
 * 在 queryLoop 每轮消息产生后，将 KernelMessage 异步批量写入 SQLite。
 * 崩溃后残留的 streaming 记录可通过 loadOrphaned() 恢复。
 */
export class IncrementalPersister {
  private readonly queue: PendingEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** 本次执行批次 ID — 用于 finalize 时精确定位 */
  private readonly batchId: string;

  constructor(
    private readonly store: SqliteStore,
    private readonly agentId: string,
    private readonly sessionKey: string,
  ) {
    this.batchId = crypto.randomUUID();
    registerActivePersister(this);
  }

  /**
   * 记录一轮的消息（assistant + tool_result）
   *
   * 消息进入内存队列，100ms 后批量写入 SQLite。
   * 写入失败仅 log.warn，不抛异常。
   */
  persistTurn(turnIndex: number, messages: readonly KernelMessage[]): void {
    if (this.disposed) return;

    for (const msg of messages) {
      // 提取纯文本内容（用于 conversation_log.content 兼容旧查询）
      const textContent = msg.content
        .filter(b => b.type === 'text')
        .map(b => (b as { text: string }).text)
        .join('\n');

      this.queue.push({
        id: `${this.batchId}:${turnIndex}:${msg.id}`,
        agentId: this.agentId,
        sessionKey: this.sessionKey,
        role: msg.role,
        content: textContent || `[${msg.role} message with ${msg.content.length} blocks]`,
        turnIndex,
        kernelMessageJson: JSON.stringify(msg),
      });
    }

    this.scheduleDrain();
  }

  /**
   * 同步 flush 所有待写入数据
   *
   * 用于:
   * - 优雅关闭 (SIGTERM/SIGINT)
   * - runSingleAttempt finally 块
   * - 异常退出前最后一搏
   */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.drainQueue();
  }

  /**
   * 标记本次执行的所有 streaming → final
   *
   * 在 queryLoop 正常结束时调用。
   */
  finalize(): void {
    // 先 flush 残余
    this.flush();

    try {
      this.store.run(
        `UPDATE conversation_log
         SET persist_status = 'final'
         WHERE agent_id = ? AND session_key = ? AND persist_status = 'streaming'
           AND id LIKE ?`,
        this.agentId,
        this.sessionKey,
        `${this.batchId}:%`,
      );
    } catch (err) {
      log.warn(`finalize 失败: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.flush();
    this.disposed = true;
    unregisterActivePersister(this);
  }

  // ─── Static: 崩溃恢复 ───

  /**
   * 加载上次崩溃残留的 streaming 消息
   *
   * 将 streaming → orphaned，然后反序列化为 KernelMessage[]。
   * 调用方可将这些消息合并到历史中。
   */
  static loadOrphaned(
    store: SqliteStore,
    agentId: string,
    sessionKey: string,
  ): KernelMessage[] {
    // 标记残留为 orphaned
    store.run(
      `UPDATE conversation_log
       SET persist_status = 'orphaned'
       WHERE agent_id = ? AND session_key = ? AND persist_status = 'streaming'`,
      agentId,
      sessionKey,
    );

    // 加载 orphaned 消息
    const rows = store.all<{ kernel_message_json: string; turn_index: number }>(
      `SELECT kernel_message_json, turn_index
       FROM conversation_log
       WHERE agent_id = ? AND session_key = ? AND persist_status = 'orphaned'
         AND kernel_message_json IS NOT NULL
       ORDER BY turn_index ASC, rowid ASC`,
      agentId,
      sessionKey,
    );

    if (rows.length === 0) return [];

    log.info(`恢复 ${rows.length} 条 orphaned 消息 (agent=${agentId}, session=${sessionKey})`);

    const messages: KernelMessage[] = [];
    for (const row of rows) {
      try {
        messages.push(JSON.parse(row.kernel_message_json) as KernelMessage);
      } catch {
        log.warn(`orphaned 消息反序列化失败，跳过`);
      }
    }

    // 标记为 final（已恢复）
    store.run(
      `UPDATE conversation_log
       SET persist_status = 'final'
       WHERE agent_id = ? AND session_key = ? AND persist_status = 'orphaned'`,
      agentId,
      sessionKey,
    );

    return messages;
  }

  // ─── Private ───

  private scheduleDrain(): void {
    if (this.flushTimer || this.disposed) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.drainQueue();
    }, FLUSH_INTERVAL_MS);
  }

  private drainQueue(): void {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0);

    try {
      this.store.transaction(() => {
        for (const entry of batch) {
          this.store.run(
            `INSERT OR IGNORE INTO conversation_log
             (id, agent_id, session_key, role, content, turn_index, kernel_message_json, persist_status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'streaming', datetime('now'))`,
            entry.id,
            entry.agentId,
            entry.sessionKey,
            entry.role,
            entry.content,
            entry.turnIndex,
            entry.kernelMessageJson,
          );
        }
      });
    } catch (err) {
      log.warn(`批量写入失败 (${batch.length} 条): ${err instanceof Error ? err.message : err}`);
      // 不重试，不阻塞 — 降级跳过
    }
  }
}
