/**
 * 通道状态持久化仓库
 * 基于 SQLite channel_state 表的通用 KV 存储（主键 channel + account_id + key）
 *
 * 多账号支持（migration 030 之后）：
 * - 每个 (channel, accountId) 元组一份独立状态
 * - 老数据的 account_id 列暂填 ''，由 server.ts recoverChannels 启动恢复时自动修复
 */

import type { ChannelType } from '@evoclaw/shared';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';

/** 通道状态行 */
interface ChannelStateRow {
  channel: string;
  account_id: string;
  key: string;
  value: string;
  updated_at: string;
}

export class ChannelStateRepo {
  constructor(private readonly db: SqliteStore) {}

  /** 获取通道状态值 */
  getState(channel: ChannelType, accountId: string, key: string): string | null {
    const row = this.db.get<ChannelStateRow>(
      'SELECT value FROM channel_state WHERE channel = ? AND account_id = ? AND key = ?',
      channel,
      accountId,
      key,
    );
    return row?.value ?? null;
  }

  /** 设置通道状态值 (upsert) */
  setState(channel: ChannelType, accountId: string, key: string, value: string): void {
    this.db.run(
      `INSERT INTO channel_state (channel, account_id, key, value, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT (channel, account_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      channel,
      accountId,
      key,
      value,
    );
  }

  /** 删除通道状态值 */
  deleteState(channel: ChannelType, accountId: string, key: string): void {
    this.db.run(
      'DELETE FROM channel_state WHERE channel = ? AND account_id = ? AND key = ?',
      channel,
      accountId,
      key,
    );
  }

  /**
   * 列出某 channel 下所有已知 accountId
   *
   * 用途：server.ts 启动时枚举每个应用，分别 new adapter 并 connect。
   * 过滤掉空串 '' 的老数据行由调用方处理（启动恢复时一次性修复）。
   */
  listAccounts(channel: ChannelType): string[] {
    const rows = this.db.all<{ account_id: string }>(
      'SELECT DISTINCT account_id FROM channel_state WHERE channel = ?',
      channel,
    );
    return rows.map((r) => r.account_id);
  }

  /**
   * 批量迁移某 channel 下 `fromAccountId` 的所有 key 到 `toAccountId`
   *
   * 用途：启动恢复时把 migration 030 留下的 `account_id=''` 老行改写为真实 appId。
   * SQLite 不支持 UPDATE 改复合主键，用 "INSERT new + DELETE old" 组合，两步都在
   * 同一个调用里保证原子性（由调用方包事务）。
   *
   * 幂等：如果 `toAccountId` 下已有相同 key，冲突时保留旧（通常 to 是空的）。
   */
  reassignAccountId(
    channel: ChannelType,
    fromAccountId: string,
    toAccountId: string,
  ): void {
    if (fromAccountId === toAccountId) return;
    this.db.run(
      `INSERT OR IGNORE INTO channel_state (channel, account_id, key, value, updated_at)
       SELECT channel, ?, key, value, updated_at
         FROM channel_state
        WHERE channel = ? AND account_id = ?`,
      toAccountId,
      channel,
      fromAccountId,
    );
    this.db.run(
      'DELETE FROM channel_state WHERE channel = ? AND account_id = ?',
      channel,
      fromAccountId,
    );
  }
}
