/**
 * /memory — 显示 Agent 记忆统计
 */

import type { ChannelCommand } from '../types.js';

export const memoryCommand: ChannelCommand = {
  name: 'memory',
  description: '记忆统计',
  async execute(_args, ctx) {
    // 按类别统计记忆数量
    const rows = ctx.store.all<{ category: string; cnt: number }>(
      `SELECT category, COUNT(*) as cnt
       FROM memory_units
       WHERE agent_id = ?
       GROUP BY category
       ORDER BY cnt DESC`,
      ctx.agentId,
    );

    if (rows.length === 0) {
      return { handled: true, response: '暂无记忆数据' };
    }

    const total = rows.reduce((sum, r) => sum + r.cnt, 0);
    const lines = [`━━━ 记忆统计 (共 ${total} 条) ━━━`];
    for (const row of rows) {
      lines.push(`${row.category}: ${row.cnt}`);
    }

    return { handled: true, response: lines.join('\n') };
  },
};
