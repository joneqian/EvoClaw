/**
 * /forget <keyword> — 用户兜底命令：按关键词批量软删除当前 Agent 的记忆
 *
 * 与 LLM 工具 memory_forget_topic 走相同逻辑，但用 LIKE 模式匹配
 * 而非 FTS5（slash 命令避免依赖 FtsStore 实例）。匹配 l0_index OR l1_overview。
 */

import type { ChannelCommand } from '../types.js';

const USAGE = '用法：/forget <关键词>\n例：/forget 客户 X';

interface MemoryRow {
  id: string;
  l0_index: string;
}

export const forgetCommand: ChannelCommand = {
  name: 'forget',
  aliases: ['忘记', 'forget'],
  description: '按关键词批量遗忘 Agent 记忆库中的相关条目',
  async execute(args, ctx) {
    const keyword = args.trim();
    if (!keyword) {
      return { handled: true, response: USAGE };
    }

    // LIKE 模式匹配 l0_index 或 l1_overview，仅当前 agent 且未归档
    const likePattern = `%${keyword}%`;
    const matches = ctx.store.all<MemoryRow>(
      `SELECT id, l0_index FROM memory_units
       WHERE agent_id = ?
         AND archived_at IS NULL
         AND (l0_index LIKE ? OR l1_overview LIKE ?)`,
      ctx.agentId,
      likePattern,
      likePattern,
    );

    if (matches.length === 0) {
      return {
        handled: true,
        response: `未找到与 "${keyword}" 相关的记忆，归档 0 条`,
      };
    }

    const now = new Date().toISOString();
    for (const row of matches) {
      ctx.store.run(
        'UPDATE memory_units SET archived_at = ?, updated_at = ? WHERE id = ?',
        now,
        now,
        row.id,
      );
    }

    const sample = matches.slice(0, 3).map(r => r.l0_index).join('、');
    const more = matches.length > 3 ? `…等 ${matches.length} 条` : '';
    return {
      handled: true,
      response: `已遗忘 ${matches.length} 条与 "${keyword}" 相关的记忆\n样例：${sample}${more}`,
    };
  },
};
