/**
 * 飞书文档块编辑审计日志（M13 Phase 5 C4）
 *
 * 每次 agent 通过 feishu_replace_block_text / feishu_delete_block / feishu_append_block
 * 工具修改 docx 时，记录 (timestamp, agentId, accountId, fileToken, blockId, action,
 * before_text, after_text, document_revision_id) 到 SQLite。
 *
 * v1 仅落盘，不暴露撤销工具——出错时人工查日志手动恢复。撤销工具留 v2。
 *
 * 写入失败不阻塞 agent edit：record() 内部 swallow 异常 + log.warn，避免一次
 * SQLite 抖动让用户的 doc edit 整个失败。
 */

import type { SqliteStore } from '../../../../infrastructure/db/sqlite-store.js';
import { createLogger } from '../../../../infrastructure/logger.js';

const log = createLogger('feishu-doc-audit');

/** doc edit audit 单条记录 */
export interface DocEditAuditRecord {
  /** 编辑发生时刻 ms */
  ts: number;
  /** 触发 agent ID（agent 工具调用上下文）；不可用时 null */
  agentId?: string | null;
  /** 飞书 appId（多 bot 区分） */
  accountId: string;
  /** docx file_token */
  fileToken: string;
  /** 被编辑的 block_id */
  blockId: string;
  /** 动作类型 */
  action: 'replace' | 'delete' | 'append';
  /** 编辑前的 block 文本（replace/delete 时填；append 为 null）*/
  beforeText?: string | null;
  /** 编辑后的 block 文本（replace/append 时填；delete 为 null）*/
  afterText?: string | null;
  /** 编辑后的文档 revision_id（飞书返回；append 时记录 children 的新版本）*/
  documentRevisionId?: number | null;
}

/**
 * 文档编辑审计仓储
 *
 * 单例：FeishuAdapter 接受为可选构造参数。未注入时 record() 静默 no-op。
 */
export class DocEditAuditLog {
  constructor(private readonly store: SqliteStore) {}

  /**
   * 记录一次 doc edit
   *
   * 写入失败不抛——swallow + log.warn，避免阻塞 agent 工具
   */
  record(rec: DocEditAuditRecord): void {
    try {
      this.store.run(
        `INSERT INTO doc_edit_audit
          (ts, agent_id, account_id, file_token, block_id, action, before_text, after_text, document_revision_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rec.ts,
        rec.agentId ?? null,
        rec.accountId,
        rec.fileToken,
        rec.blockId,
        rec.action,
        rec.beforeText ?? null,
        rec.afterText ?? null,
        rec.documentRevisionId ?? null,
      );
    } catch (err) {
      log.warn(
        `记录失败 file_token=${rec.fileToken} block_id=${rec.blockId} action=${rec.action}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 列出某文档最近 N 条编辑（按 ts 降序），供撤销 / 调试
   *
   * v1 不暴露给 agent；v2 加 feishu_undo_doc_edit 工具时复用。
   */
  listRecent(fileToken: string, limit = 20): DocEditAuditRecord[] {
    const rows = this.store.all<{
      ts: number;
      agent_id: string | null;
      account_id: string;
      file_token: string;
      block_id: string;
      action: 'replace' | 'delete' | 'append';
      before_text: string | null;
      after_text: string | null;
      document_revision_id: number | null;
    }>(
      `SELECT ts, agent_id, account_id, file_token, block_id, action, before_text, after_text, document_revision_id
       FROM doc_edit_audit
       WHERE file_token = ?
       ORDER BY ts DESC
       LIMIT ?`,
      fileToken,
      limit,
    );
    return rows.map((r) => ({
      ts: r.ts,
      agentId: r.agent_id,
      accountId: r.account_id,
      fileToken: r.file_token,
      blockId: r.block_id,
      action: r.action,
      beforeText: r.before_text,
      afterText: r.after_text,
      documentRevisionId: r.document_revision_id,
    }));
  }
}
