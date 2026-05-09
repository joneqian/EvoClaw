/**
 * M13 Phase 1 PR-1B — identityLinks 跨渠道员工身份聚合
 *
 * 业务场景：员工在飞书 ou_xxx / 企微 userid_yyy / 微信 wxid_zzz，三个不同 ID
 * 实际是同一员工（canonical_id='self'）。本 store 提供 CRUD + lookup，让
 * generateSessionKey 在拼 sessionKey 前命中替换 peerId 为 canonical（让跨渠道
 * 同一员工合并到同一 sessionKey），让 memory_extractor 在 LLM extract 后填
 * canonical_user_id 锚定记忆层。
 *
 * 设计：
 * - lookupCanonical(channel, peerId) 是热路径（每条入站消息一次），加内存缓存
 *   + invalidate 机制（任何 CRUD 后失效）
 * - 桌面应用单租户特性：identity_links 表行数一般 1-3 行，全表加载也 OK
 *
 * 文件路径：packages/core/src/routing/identity-links-store.ts
 */

import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('identity-links-store');

export interface IdentityLink {
  id: number;
  canonicalId: string;
  channel: string;
  peerId: string;
  createdAt: string;
}

export class IdentityLinksStore {
  /** 缓存：channel:peerId → canonicalId（热路径优化，CRUD 时失效） */
  private cache: Map<string, string> | null = null;

  constructor(private db: SqliteStore) {}

  /** 添加身份链；同 (channel, peerId) 已存在时更新 canonical_id（UPSERT 语义） */
  link(canonicalId: string, channel: string, peerId: string): void {
    if (!canonicalId || !channel || !peerId) {
      throw new Error('canonicalId / channel / peerId 必填');
    }
    this.db.run(
      `INSERT INTO identity_links (canonical_id, channel, peer_id) VALUES (?, ?, ?)
       ON CONFLICT(channel, peer_id) DO UPDATE SET canonical_id = excluded.canonical_id`,
      canonicalId, channel, peerId,
    );
    this.invalidateCache();
    log.info(`identity link added/updated canonical=${canonicalId} channel=${channel} peer=${peerId}`);
  }

  /** 移除指定渠道身份；返回受影响行数 */
  unlink(channel: string, peerId: string): number {
    const result = this.db.run(
      `DELETE FROM identity_links WHERE channel = ? AND peer_id = ?`,
      channel, peerId,
    );
    const changes = result.changes ?? 0;
    if (changes > 0) {
      this.invalidateCache();
      log.info(`identity link removed channel=${channel} peer=${peerId}`);
    }
    return changes;
  }

  /** 移除整个 canonical（员工解绑全部） */
  unlinkCanonical(canonicalId: string): number {
    const result = this.db.run(
      `DELETE FROM identity_links WHERE canonical_id = ?`,
      canonicalId,
    );
    const changes = result.changes ?? 0;
    if (changes > 0) {
      this.invalidateCache();
      log.info(`identity canonical removed canonical=${canonicalId} affected=${changes}`);
    }
    return changes;
  }

  /**
   * 热路径：(channel, peerId) → canonicalId。未命中返回 null。
   *
   * 用法：generateSessionKey 在拼 sessionKey 前调用，命中时把 peerId 替换为
   * canonicalId 让跨渠道同一员工 sessionKey 合并。
   */
  lookupCanonical(channel: string, peerId: string): string | null {
    if (!channel || !peerId) return null;
    const cache = this.ensureCache();
    return cache.get(`${channel}:${peerId}`) ?? null;
  }

  /** 列出所有身份链（UI 用） */
  listAll(): IdentityLink[] {
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT * FROM identity_links ORDER BY canonical_id, channel, peer_id`,
    );
    return rows.map(rowToLink);
  }

  /** 列出某 canonical 下的所有身份链 */
  listByCanonical(canonicalId: string): IdentityLink[] {
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT * FROM identity_links WHERE canonical_id = ? ORDER BY channel, peer_id`,
      canonicalId,
    );
    return rows.map(rowToLink);
  }

  /** 主动失效缓存（CRUD 后调用 + 测试用） */
  invalidateCache(): void {
    this.cache = null;
  }

  /** 全表加载并构建 cache（桌面单租户场景一般 1-3 行，全表加载 OK） */
  private ensureCache(): Map<string, string> {
    if (this.cache !== null) return this.cache;
    const rows = this.db.all<Record<string, unknown>>(`SELECT * FROM identity_links`);
    const cache = new Map<string, string>();
    for (const row of rows) {
      const channel = row['channel'] as string;
      const peerId = row['peer_id'] as string;
      const canonicalId = row['canonical_id'] as string;
      cache.set(`${channel}:${peerId}`, canonicalId);
    }
    this.cache = cache;
    log.debug(`identity cache rebuilt size=${cache.size}`);
    return cache;
  }
}

function rowToLink(row: Record<string, unknown>): IdentityLink {
  return {
    id: row['id'] as number,
    canonicalId: row['canonical_id'] as string,
    channel: row['channel'] as string,
    peerId: row['peer_id'] as string,
    createdAt: row['created_at'] as string,
  };
}
