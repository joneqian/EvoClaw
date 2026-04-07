/**
 * Fork Session 路由 — 基于现有会话创建独立副本
 *
 * POST /:agentId/fork
 * Body: { sourceSessionKey: string; newSessionName?: string }
 *
 * 通过 INSERT...SELECT 单事务复制:
 * - conversation_log 全部消息（新 id, 新 session_key）
 * - session_summaries（如有）
 * - session_runtime_state（如有）
 *
 * 参考 Claude Code: --fork-session 保留内容创建新 session
 */

import crypto from 'node:crypto';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('fork-session');

export interface ForkResult {
  success: boolean;
  newSessionKey?: string;
  messageCount?: number;
  error?: string;
}

/**
 * Fork 会话 — 复制全部消息到新 session
 */
export function forkSession(
  store: SqliteStore,
  agentId: string,
  sourceSessionKey: string,
  newSessionKey?: string,
): ForkResult {
  const targetSessionKey = newSessionKey ?? generateForkSessionKey(sourceSessionKey);

  try {
    let messageCount = 0;

    store.transaction(() => {
      // 1. 复制 conversation_log（新 id，新 session_key）
      const result = store.run(
        `INSERT INTO conversation_log
           (id, agent_id, session_key, role, content, tool_name, tool_input, tool_output,
            compaction_status, compaction_ref, token_count, created_at,
            parent_message_id, is_sidechain, entry_type,
            turn_index, kernel_message_json, persist_status)
         SELECT
           ? || ':' || rowid, agent_id, ?, role, content, tool_name, tool_input, tool_output,
           compaction_status, compaction_ref, token_count, created_at,
           parent_message_id, is_sidechain, entry_type,
           turn_index, kernel_message_json, persist_status
         FROM conversation_log
         WHERE agent_id = ? AND session_key = ?`,
        crypto.randomUUID(), targetSessionKey, agentId, sourceSessionKey,
      );
      messageCount = result.changes;

      // 2. 复制 session_summaries（如有）
      store.run(
        `INSERT OR IGNORE INTO session_summaries
           (agent_id, session_key, summary_markdown, token_count_at, turn_count_at, tool_call_count_at, created_at, updated_at)
         SELECT
           agent_id, ?, summary_markdown, token_count_at, turn_count_at, tool_call_count_at, created_at, updated_at
         FROM session_summaries
         WHERE agent_id = ? AND session_key = ?`,
        targetSessionKey, agentId, sourceSessionKey,
      );

      // 3. 复制 session_runtime_state（如有）
      store.run(
        `INSERT OR IGNORE INTO session_runtime_state
           (agent_id, session_key, state_key, state_value, updated_at)
         SELECT
           agent_id, ?, state_key, state_value, updated_at
         FROM session_runtime_state
         WHERE agent_id = ? AND session_key = ?`,
        targetSessionKey, agentId, sourceSessionKey,
      );

      // 4. 复制 file_attributions（如有）
      store.run(
        `INSERT OR IGNORE INTO file_attributions
           (id, agent_id, session_key, file_path, action, content_hash, turn_index, created_at)
         SELECT
           ? || ':' || rowid, agent_id, ?, file_path, action, content_hash, turn_index, created_at
         FROM file_attributions
         WHERE agent_id = ? AND session_key = ?`,
        crypto.randomUUID(), targetSessionKey, agentId, sourceSessionKey,
      );
    });

    log.info(`Fork 完成: ${sourceSessionKey} → ${targetSessionKey} (${messageCount} 条消息)`);

    return { success: true, newSessionKey: targetSessionKey, messageCount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Fork 失败: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * 生成 fork session key — 在源 key 基础上追加 fork 标识
 *
 * 格式: <source-key>:fork:<短 UUID>
 */
function generateForkSessionKey(sourceKey: string): string {
  const shortId = crypto.randomUUID().slice(0, 8);
  return `${sourceKey}:fork:${shortId}`;
}
