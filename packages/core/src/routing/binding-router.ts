import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';

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
  addBinding(binding: Omit<Binding, 'id' | 'createdAt'>): string {
    const id = crypto.randomUUID();
    this.db.run(
      `INSERT INTO bindings (id, agent_id, channel, account_id, peer_id, priority, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      id, binding.agentId, binding.channel, binding.accountId ?? null,
      binding.peerId ?? null, binding.priority, binding.isDefault ? 1 : 0,
    );
    return id;
  }

  /** 移除 Binding */
  removeBinding(id: string): void {
    this.db.run('DELETE FROM bindings WHERE id = ?', id);
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
    // 1. peerId 精确匹配
    if (message.peerId) {
      const exact = this.db.get<Record<string, unknown>>(
        'SELECT * FROM bindings WHERE channel = ? AND peer_id = ? ORDER BY priority DESC LIMIT 1',
        message.channel, message.peerId,
      );
      if (exact) return exact['agent_id'] as string;
    }

    // 2. accountId + channel 匹配
    if (message.accountId) {
      const account = this.db.get<Record<string, unknown>>(
        'SELECT * FROM bindings WHERE channel = ? AND account_id = ? AND peer_id IS NULL ORDER BY priority DESC LIMIT 1',
        message.channel, message.accountId,
      );
      if (account) return account['agent_id'] as string;
    }

    // 3. channel 匹配
    const channelMatch = this.db.get<Record<string, unknown>>(
      'SELECT * FROM bindings WHERE channel = ? AND account_id IS NULL AND peer_id IS NULL AND is_default = 0 ORDER BY priority DESC LIMIT 1',
      message.channel,
    );
    if (channelMatch) return channelMatch['agent_id'] as string;

    // 4. 默认 Agent
    const defaultAgent = this.db.get<Record<string, unknown>>(
      'SELECT * FROM bindings WHERE is_default = 1 ORDER BY priority DESC LIMIT 1',
    );
    return defaultAgent ? (defaultAgent['agent_id'] as string) : null;
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
  };
}
