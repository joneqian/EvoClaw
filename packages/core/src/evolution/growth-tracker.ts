import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { GrowthEvent, GrowthVector } from '@evoclaw/shared';

/**
 * 成长追踪器 — 记录 Agent 能力进化事件
 * 复用 audit_log 表（action='evolution'）
 */
export class GrowthTracker {
  constructor(private db: SqliteStore) {}

  /** 记录成长事件 */
  recordEvent(agentId: string, event: GrowthEvent): void {
    this.db.run(
      `INSERT INTO audit_log (agent_id, action, details, created_at)
       VALUES (?, 'evolution', ?, ?)`,
      agentId,
      JSON.stringify(event),
      event.timestamp,
    );
  }

  /** 计算最近 N 天的成长向量 */
  computeGrowthVector(agentId: string, days = 7): GrowthVector[] {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.db.all<{ details: string }>(
      `SELECT details FROM audit_log
       WHERE agent_id = ? AND action = 'evolution' AND created_at >= ?
       ORDER BY created_at ASC`,
      agentId,
      since,
    );

    // 按维度聚合 delta
    const deltas = new Map<string, number>();
    for (const row of rows) {
      const event = JSON.parse(row.details) as GrowthEvent;
      const current = deltas.get(event.capability) ?? 0;
      deltas.set(event.capability, current + event.delta);
    }

    return Array.from(deltas.entries()).map(([dimension, delta]) => ({
      dimension,
      delta,
      trend: delta > 0.01 ? 'up' : delta < -0.01 ? 'down' : 'stable',
    }));
  }

  /** 获取最近的进化事件 */
  getRecentEvents(agentId: string, limit = 20): GrowthEvent[] {
    const rows = this.db.all<{ details: string }>(
      `SELECT details FROM audit_log
       WHERE agent_id = ? AND action = 'evolution'
       ORDER BY created_at DESC LIMIT ?`,
      agentId,
      limit,
    );

    return rows.map((r) => JSON.parse(r.details) as GrowthEvent);
  }
}
