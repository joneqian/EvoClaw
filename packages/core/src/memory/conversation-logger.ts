import { SqliteStore } from '../infrastructure/db/sqlite-store.js';

/** 日志条目类型 — 区分普通消息和系统事件 */
export type LogEntryType =
  | 'message'              // 普通对话消息
  | 'compaction_boundary'  // Autocompact/Snip/Microcompact 压缩边界
  | 'memory_saved'         // 记忆保存事件
  | 'agent_spawned'        // 子代理启动
  | 'agent_completed'      // 子代理完成
  | 'error_snapshot';      // 错误快照

/**
 * 对话日志条目 — 记录每一轮会话消息，用于后续记忆提取
 */
export interface ConversationLogEntry {
  id: string;
  agentId: string;
  sessionKey: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  tokenCount: number;
  /** 父消息 ID — 子代理结果关联到父上下文（多 Agent 消息追踪） */
  parentMessageId?: string;
  /** 是否子代理侧链消息（区分主链和子代理消息流） */
  isSidechain?: boolean;
  /** 日志条目类型（默认 'message'） */
  entryType?: LogEntryType;
}

/** DB 行类型（snake_case） */
interface ConversationLogRow {
  id: string;
  agent_id: string;
  session_key: string;
  role: string;
  content: string;
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  token_count: number;
  compaction_status: string;
  compaction_ref: string | null;
  parent_message_id: string | null;
  is_sidechain: number;  // SQLite boolean: 0/1
  entry_type: string;
  created_at: string;
}

/** 将 DB 行映射为 TS 接口（snake_case → camelCase） */
function rowToEntry(row: ConversationLogRow): ConversationLogEntry {
  return {
    id: row.id,
    agentId: row.agent_id,
    sessionKey: row.session_key,
    role: row.role as ConversationLogEntry['role'],
    content: row.content,
    toolName: row.tool_name ?? undefined,
    toolInput: row.tool_input ?? undefined,
    toolOutput: row.tool_output ?? undefined,
    tokenCount: row.token_count,
    parentMessageId: row.parent_message_id ?? undefined,
    isSidechain: row.is_sidechain === 1 ? true : undefined,
    entryType: (row.entry_type ?? 'message') as LogEntryType,
  };
}

/**
 * 对话日志记录器 — 将会话消息持久化到 conversation_log 表
 *
 * 支持记忆提取流水线：raw → extracted → compacted 三态流转。
 */
export class ConversationLogger {
  constructor(private db: SqliteStore) {}

  /**
   * 记录一条对话消息
   */
  log(entry: ConversationLogEntry): void {
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO conversation_log
        (id, agent_id, session_key, role, content, tool_name, tool_input, tool_output, token_count, compaction_status, parent_message_id, is_sidechain, entry_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'raw', ?, ?, ?, ?)`,
      entry.id,
      entry.agentId,
      entry.sessionKey,
      entry.role,
      entry.content,
      entry.toolName ?? null,
      entry.toolInput ?? null,
      entry.toolOutput ?? null,
      entry.tokenCount,
      entry.parentMessageId ?? null,
      entry.isSidechain ? 1 : 0,
      entry.entryType ?? 'message',
      now,
    );
  }

  /**
   * 获取待提取的原始消息（compaction_status = 'raw'）
   */
  getPendingMessages(
    agentId: string,
    sessionKey: string,
  ): Array<ConversationLogEntry & { compactionStatus: string }> {
    const rows = this.db.all<ConversationLogRow>(
      `SELECT * FROM conversation_log
       WHERE agent_id = ? AND session_key = ? AND compaction_status = 'raw'
       ORDER BY created_at ASC`,
      agentId,
      sessionKey,
    );

    return rows.map((row) => ({
      ...rowToEntry(row),
      compactionStatus: row.compaction_status,
    }));
  }

  /**
   * 标记消息为已提取，关联记忆单元 ID
   */
  markExtracted(ids: string[], memoryUnitId: string): void {
    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(', ');
    this.db.run(
      `UPDATE conversation_log
       SET compaction_status = 'extracted', compaction_ref = ?
       WHERE id IN (${placeholders})`,
      memoryUnitId,
      ...ids,
    );
  }

  /**
   * 标记消息为已压缩，关联摘要 ID
   */
  markCompacted(ids: string[], summaryId: string): void {
    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(', ');
    this.db.run(
      `UPDATE conversation_log
       SET compaction_status = 'compacted', compaction_ref = ?
       WHERE id IN (${placeholders})`,
      summaryId,
      ...ids,
    );
  }

  /**
   * 按会话获取日志，支持限制条数
   */
  getBySession(
    agentId: string,
    sessionKey: string,
    limit?: number,
  ): ConversationLogEntry[] {
    if (limit !== undefined) {
      const rows = this.db.all<ConversationLogRow>(
        `SELECT * FROM conversation_log
         WHERE agent_id = ? AND session_key = ?
         ORDER BY created_at ASC
         LIMIT ?`,
        agentId,
        sessionKey,
        limit,
      );
      return rows.map(rowToEntry);
    }

    const rows = this.db.all<ConversationLogRow>(
      `SELECT * FROM conversation_log
       WHERE agent_id = ? AND session_key = ?
       ORDER BY created_at ASC`,
      agentId,
      sessionKey,
    );
    return rows.map(rowToEntry);
  }
}
