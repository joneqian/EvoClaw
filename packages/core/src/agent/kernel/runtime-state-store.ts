/**
 * 运行时状态持久化 — 保存/恢复 Agent 循环的非消息级别状态
 *
 * 持久化内容:
 * - FileStateCache: 文件读取记录（避免 compact 后丢失 "是否已读取" 信息）
 * - CollapseState: 压缩阶段状态（避免恢复后从零开始计数）
 * - 模型覆盖: fallback 后的有效模型 ID
 * - 压缩器失败计数: 熔断器状态
 *
 * 存储于 session_runtime_state 表（KV 结构），每个 state_key 一行。
 */

import type { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import type { FileState } from './file-state-cache.js';
import type { CollapseState } from './context-compactor.js';
import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('runtime-state-store');

/** 运行时状态快照 */
export interface RuntimeStateSnapshot {
  fileStateCache?: Record<string, FileState>;
  collapseState?: CollapseState;
  modelOverride?: { modelId: string; protocol?: string };
  compactorFailures?: number;
}

/** State key 枚举 */
const STATE_KEYS = {
  FILE_STATE_CACHE: 'file_state_cache',
  COLLAPSE_STATE: 'collapse_state',
  MODEL_OVERRIDE: 'model_override',
  COMPACTOR_FAILURES: 'compactor_failures',
} as const;

/**
 * 保存运行时状态快照
 */
export function saveRuntimeState(
  store: SqliteStore,
  agentId: string,
  sessionKey: string,
  snapshot: RuntimeStateSnapshot,
): void {
  try {
    store.transaction(() => {
      const entries: Array<[string, unknown]> = [];

      if (snapshot.fileStateCache) {
        entries.push([STATE_KEYS.FILE_STATE_CACHE, snapshot.fileStateCache]);
      }
      if (snapshot.collapseState) {
        entries.push([STATE_KEYS.COLLAPSE_STATE, snapshot.collapseState]);
      }
      if (snapshot.modelOverride) {
        entries.push([STATE_KEYS.MODEL_OVERRIDE, snapshot.modelOverride]);
      }
      if (snapshot.compactorFailures !== undefined) {
        entries.push([STATE_KEYS.COMPACTOR_FAILURES, snapshot.compactorFailures]);
      }

      for (const [key, value] of entries) {
        store.run(
          `INSERT INTO session_runtime_state (agent_id, session_key, state_key, state_value, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'))
           ON CONFLICT (agent_id, session_key, state_key)
           DO UPDATE SET state_value = excluded.state_value, updated_at = excluded.updated_at`,
          agentId, sessionKey, key, JSON.stringify(value),
        );
      }
    });
  } catch (err) {
    log.warn(`保存运行时状态失败: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * 加载运行时状态快照
 */
export function loadRuntimeState(
  store: SqliteStore,
  agentId: string,
  sessionKey: string,
): RuntimeStateSnapshot | null {
  try {
    const rows = store.all<{ state_key: string; state_value: string }>(
      `SELECT state_key, state_value FROM session_runtime_state
       WHERE agent_id = ? AND session_key = ?`,
      agentId, sessionKey,
    );

    if (rows.length === 0) return null;

    const snapshot: RuntimeStateSnapshot = {};
    for (const row of rows) {
      try {
        const value = JSON.parse(row.state_value);
        switch (row.state_key) {
          case STATE_KEYS.FILE_STATE_CACHE:
            snapshot.fileStateCache = value;
            break;
          case STATE_KEYS.COLLAPSE_STATE:
            snapshot.collapseState = value;
            break;
          case STATE_KEYS.MODEL_OVERRIDE:
            snapshot.modelOverride = value;
            break;
          case STATE_KEYS.COMPACTOR_FAILURES:
            snapshot.compactorFailures = value;
            break;
        }
      } catch {
        log.warn(`反序列化 state_key=${row.state_key} 失败，跳过`);
      }
    }

    log.info(`恢复运行时状态: ${Object.keys(snapshot).filter(k => (snapshot as any)[k] !== undefined).join(', ')}`);
    return snapshot;
  } catch (err) {
    log.warn(`加载运行时状态失败: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
