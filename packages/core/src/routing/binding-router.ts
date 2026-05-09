import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { createLogger } from '../infrastructure/logger.js';
import type { DmScope } from './session-key.js';

const log = createLogger('binding-router');

/** Binding 记录 */
export interface Binding {
  id: string;
  agentId: string;
  channel: string;         // e.g., 'wechat', 'telegram', 'default'
  accountId: string | null; // 账号ID（群号等）
  peerId: string | null;    // 对方ID（精确匹配）
  priority: number;         // 匹配优先级（越高越优先）
  isDefault: boolean;       // 是否为默认 Agent
  createdAt: string;
  /**
   * Bot 自身在该渠道的"用户身份"标识（M13 多 Agent 团队协作）
   *
   * 飞书：`open_id`（ou_xxx），用于跨 bot @ 的真·原生 mention 元素 `<at user_id="ou_xxx"/>`。
   * 在 channel.connect 成功后由 adapter 拉 /open-apis/bot/v3/info 写回。
   * 其它渠道按需扩展（slack→user_id、企微→userid）。
   */
  botOpenId: string | null;
  /**
   * M13 Phase 1 PR-1A: DM 跨渠道隔离粒度（仅 chatType='direct' 生效）
   *
   * NULL → 走全局默认 DEFAULT_DM_SCOPE='main'（跨渠道连贯）
   * 'per-peer' / 'per-channel-peer' / 'per-account-channel-peer' → 显式隔离
   * 详见 routing/session-key.ts 的 DmScope。
   */
  dmScope: DmScope | null;
}

/** 渠道消息（用于匹配） */
export interface ChannelMessage {
  channel: string;
  accountId?: string;
  peerId?: string;
}

/**
 * Binding 路由器 — 根据消息来源匹配最合适的 Agent
 * 匹配优先级：peerId 精确匹配 > accountId + channel > channel > 默认 Agent
 */
export class BindingRouter {
  constructor(private db: SqliteStore) {}

  /** 添加 Binding */
  addBinding(
    binding: Omit<Binding, 'id' | 'createdAt' | 'botOpenId' | 'dmScope'> & {
      botOpenId?: string | null;
      dmScope?: DmScope | null;
    },
  ): string {
    const id = crypto.randomUUID();
    this.db.run(
      `INSERT INTO bindings (id, agent_id, channel, account_id, peer_id, priority, is_default, bot_open_id, dm_scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      id, binding.agentId, binding.channel, binding.accountId ?? null,
      binding.peerId ?? null, binding.priority, binding.isDefault ? 1 : 0,
      binding.botOpenId ?? null,
      binding.dmScope ?? null,
    );
    return id;
  }

  /**
   * M13 Phase 1 PR-1A: 更新 binding 的 dm_scope（员工 BindingsPage UI 用）
   */
  setDmScope(id: string, dmScope: DmScope | null): number {
    const result = this.db.run(
      `UPDATE bindings SET dm_scope = ? WHERE id = ?`,
      dmScope, id,
    );
    const changes = result.changes ?? 0;
    log.info(`dm_scope updated id=${id} dmScope=${dmScope ?? '(null)'} affected=${changes}`);
    return changes;
  }

  /** 移除 Binding */
  removeBinding(id: string): void {
    this.db.run('DELETE FROM bindings WHERE id = ?', id);
  }

  /**
   * 写入 / 刷新某个 binding 的 bot_open_id（M13 @ 死锁修复）
   *
   * 触发：飞书 channel connect 成功后 server.ts 拉到 botOpenId → 调本方法回填。
   * 影响范围：(channel, accountId) 全匹配的所有行（同 accountId 一般只对应一个 agent，
   * 但保险起见 UPDATE 而不是只改一行）。
   */
  setBotOpenId(channel: string, accountId: string, botOpenId: string | null): number {
    const result = this.db.run(
      `UPDATE bindings SET bot_open_id = ? WHERE channel = ? AND account_id = ?`,
      botOpenId, channel, accountId,
    );
    const changes = result.changes ?? 0;
    if (changes > 0) {
      log.info(
        `bot_open_id 已写入 channel=${channel} accountId=${accountId} ` +
          `botOpenId=${botOpenId ?? '(null)'} affected=${changes}`,
      );
    } else {
      log.debug(
        `bot_open_id 写入未命中 binding channel=${channel} accountId=${accountId} ` +
          `（可能尚未创建该账号对应的 binding）`,
      );
    }
    return changes;
  }

  /** 列出所有 Bindings */
  listBindings(agentId?: string): Binding[] {
    let sql = 'SELECT * FROM bindings';
    const params: unknown[] = [];
    if (agentId) {
      sql += ' WHERE agent_id = ?';
      params.push(agentId);
    }
    sql += ' ORDER BY priority DESC';
    const rows = this.db.all<Record<string, unknown>>(sql, ...params);
    return rows.map(rowToBinding);
  }

  /**
   * 解析消息 → 匹配最合适的 Agent
   * 优先级：peerId 精确 > accountId + channel > channel > 默认
   */
  resolveAgent(message: ChannelMessage): string | null {
    const binding = this.resolveBinding(message);
    return binding?.agentId ?? null;
  }

  /**
   * M13 Phase 1 PR-1A: 按 (agentId, channel) 找该 agent 在该渠道的 binding
   *
   * broadcast 场景（dispatchBroadcastMessage）下不能用 resolveBinding（resolveBinding 按
   * peerId/accountId 全局匹配，不按目标 agent 过滤）。本方法专为"已知 agent 求 dmScope"
   * 场景设计。返回最高 priority 的 binding，未匹配返回 null。
   */
  findByAgentAndChannel(agentId: string, channel: string): Binding | null {
    const row = this.db.get<Record<string, unknown>>(
      `SELECT * FROM bindings WHERE agent_id = ? AND channel = ? ORDER BY priority DESC LIMIT 1`,
      agentId, channel,
    );
    return row ? rowToBinding(row) : null;
  }

  /**
   * M13 Phase 1 PR-1A: 解析消息 → 匹配最合适的 Binding（含 dmScope）
   *
   * 与 resolveAgent 共享匹配优先级，但返回完整 Binding 让调用方拿到 dmScope。
   * channel-message-handler 用 binding.dmScope 决定 sessionKey 隔离粒度。
   */
  resolveBinding(message: ChannelMessage): Binding | null {
    // 1. peerId 精确匹配
    if (message.peerId) {
      const exact = this.db.get<Record<string, unknown>>(
        'SELECT * FROM bindings WHERE channel = ? AND peer_id = ? ORDER BY priority DESC LIMIT 1',
        message.channel, message.peerId,
      );
      if (exact) return rowToBinding(exact);
    }

    // 2. accountId + channel 匹配
    if (message.accountId) {
      const account = this.db.get<Record<string, unknown>>(
        'SELECT * FROM bindings WHERE channel = ? AND account_id = ? AND peer_id IS NULL ORDER BY priority DESC LIMIT 1',
        message.channel, message.accountId,
      );
      if (account) return rowToBinding(account);
    }

    // 3. channel 匹配
    const channelMatch = this.db.get<Record<string, unknown>>(
      'SELECT * FROM bindings WHERE channel = ? AND account_id IS NULL AND peer_id IS NULL AND is_default = 0 ORDER BY priority DESC LIMIT 1',
      message.channel,
    );
    if (channelMatch) return rowToBinding(channelMatch);

    // 4. 默认 Agent
    const defaultAgent = this.db.get<Record<string, unknown>>(
      'SELECT * FROM bindings WHERE is_default = 1 ORDER BY priority DESC LIMIT 1',
    );
    return defaultAgent ? rowToBinding(defaultAgent) : null;
  }
}

/** 数据库行 → Binding 对象 */
function rowToBinding(row: Record<string, unknown>): Binding {
  return {
    id: row['id'] as string,
    agentId: row['agent_id'] as string,
    channel: row['channel'] as string,
    accountId: (row['account_id'] as string) ?? null,
    peerId: (row['peer_id'] as string) ?? null,
    priority: row['priority'] as number,
    isDefault: (row['is_default'] as number) === 1,
    createdAt: row['created_at'] as string,
    botOpenId: (row['bot_open_id'] as string | null) ?? null,
    // M13 Phase 1 PR-1A: dm_scope 列（NULL 时回退到 DEFAULT_DM_SCOPE）
    dmScope: ((row['dm_scope'] as string | null) ?? null) as DmScope | null,
  };
}
