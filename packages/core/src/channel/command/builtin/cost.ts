/**
 * /cost — 显示当前 Agent 的 token 用量和费用
 */

import type { ChannelCommand } from '../types.js';

export const costCommand: ChannelCommand = {
  name: 'cost',
  description: '查看费用统计',
  async execute(_args, ctx) {
    // 查询今日统计
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayRow = ctx.store.get<{
      input: number; output: number; cache_r: number; cache_w: number; cost: number; cnt: number;
    }>(
      `SELECT
        COALESCE(SUM(input_tokens), 0) as input,
        COALESCE(SUM(output_tokens), 0) as output,
        COALESCE(SUM(cache_read_tokens), 0) as cache_r,
        COALESCE(SUM(cache_write_tokens), 0) as cache_w,
        COALESCE(SUM(estimated_cost_milli), 0) as cost,
        COUNT(*) as cnt
      FROM usage_tracking
      WHERE agent_id = ? AND created_at >= ?`,
      ctx.agentId,
      todayStart.toISOString(),
    );

    // 查询本月统计
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthRow = ctx.store.get<{
      input: number; output: number; cache_r: number; cache_w: number; cost: number; cnt: number;
    }>(
      `SELECT
        COALESCE(SUM(input_tokens), 0) as input,
        COALESCE(SUM(output_tokens), 0) as output,
        COALESCE(SUM(cache_read_tokens), 0) as cache_r,
        COALESCE(SUM(cache_write_tokens), 0) as cache_w,
        COALESCE(SUM(estimated_cost_milli), 0) as cost,
        COUNT(*) as cnt
      FROM usage_tracking
      WHERE agent_id = ? AND created_at >= ?`,
      ctx.agentId,
      monthStart.toISOString(),
    );

    // 获取当前 Agent 信息
    const agent = ctx.agentManager.getAgent(ctx.agentId);
    const modelName = agent?.modelId ?? '未配置';
    const provider = agent?.provider ?? '未指定';

    // 格式化成本（毫分 → 分）
    const formatCost = (milli: number): string => {
      const yuan = milli / 1000 / 100; // milli/1000 = fen, fen/100 = yuan
      return yuan.toFixed(4);
    };

    // 构建回复文本
    const lines = [
      '━━━ 费用统计 ━━━',
      '',
      `当前模型: ${modelName} (${provider})`,
      '',
      `今日统计:`,
      `  输入: ${(todayRow?.input ?? 0).toLocaleString()} tokens`,
      `  输出: ${(todayRow?.output ?? 0).toLocaleString()} tokens`,
      `  缓存读: ${(todayRow?.cache_r ?? 0).toLocaleString()} tokens`,
      `  缓存写: ${(todayRow?.cache_w ?? 0).toLocaleString()} tokens`,
      `  调用次数: ${todayRow?.cnt ?? 0}`,
      `  估算费用: ¥${formatCost(todayRow?.cost ?? 0)}`,
      '',
      `本月统计:`,
      `  输入: ${(monthRow?.input ?? 0).toLocaleString()} tokens`,
      `  输出: ${(monthRow?.output ?? 0).toLocaleString()} tokens`,
      `  缓存读: ${(monthRow?.cache_r ?? 0).toLocaleString()} tokens`,
      `  缓存写: ${(monthRow?.cache_w ?? 0).toLocaleString()} tokens`,
      `  调用次数: ${monthRow?.cnt ?? 0}`,
      `  估算费用: ¥${formatCost(monthRow?.cost ?? 0)}`,
    ];

    return { handled: true, response: lines.join('\n') };
  },
};
