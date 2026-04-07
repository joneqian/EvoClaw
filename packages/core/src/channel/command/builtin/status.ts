/**
 * /status — 显示 Agent 运行状态
 */

import type { ChannelCommand } from '../types.js';

export const statusCommand: ChannelCommand = {
  name: 'status',
  description: '运行状态',
  async execute(_args, ctx) {
    const agent = ctx.agentManager.getAgent(ctx.agentId);
    if (!agent) {
      return { handled: true, response: '未找到 Agent' };
    }

    // 统计今日会话数
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const sessionRow = ctx.store.get<{ cnt: number }>(
      `SELECT COUNT(DISTINCT session_key) as cnt
       FROM conversation_log
       WHERE agent_id = ? AND created_at >= ?`,
      ctx.agentId,
      todayStart.toISOString(),
    );

    const lines = [
      '━━━ Agent 状态 ━━━',
      `名称: ${agent.name}`,
      `模型: ${agent.modelId ?? '未配置'}`,
      `今日会话: ${sessionRow?.cnt ?? 0}`,
      `渠道: ${ctx.channel}`,
    ];

    return { handled: true, response: lines.join('\n') };
  },
};
