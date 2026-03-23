/**
 * 通道状态持久化仓库
 * 基于 SQLite channel_state 表的通用 KV 存储
 */

import type { ChannelType } from '@evoclaw/shared';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';

/** 通道状态行 */
interface ChannelStateRow {
  channel: string;
  key: string;
  value: string;
  updated_at: string;
}

export class ChannelStateRepo {
  constructor(private readonly db: SqliteStore) {}

  /** 获取通道状态值 */
  getState(channel: ChannelType, key: string): string | null {
    const row = this.db.get<ChannelStateRow>(
      'SELECT value FROM channel_state WHERE channel = ? AND key = ?',
      channel,
      key,
    );
    return row?.value ?? null;
  }

  /** 设置通道状态值 (upsert) */
  setState(channel: ChannelType, key: string, value: string): void {
    this.db.run(
      `INSERT INTO channel_state (channel, key, value, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (channel, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      channel,
      key,
      value,
    );
  }

  /** 删除通道状态值 */
  deleteState(channel: ChannelType, key: string): void {
    this.db.run(
      'DELETE FROM channel_state WHERE channel = ? AND key = ?',
      channel,
      key,
    );
  }
}
