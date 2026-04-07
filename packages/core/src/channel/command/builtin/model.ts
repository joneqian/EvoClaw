/**
 * /model — 查看或切换当前模型
 */

import type { ChannelCommand } from '../types.js';

export const modelCommand: ChannelCommand = {
  name: 'model',
  description: '查看/切换模型',
  async execute(args, ctx) {
    const agent = ctx.agentManager.getAgent(ctx.agentId);
    if (!agent) {
      return { handled: true, response: '未找到 Agent 配置' };
    }

    const modelArg = args.trim();

    // 无参数 → 查看当前模型
    if (!modelArg) {
      const current = agent.modelId ?? '未配置';
      return { handled: true, response: `当前模型: ${current}` };
    }

    // 有参数 → 切换模型
    ctx.agentManager.updateAgent(ctx.agentId, {
      modelId: modelArg,
    });
    return { handled: true, response: `模型已切换为: ${modelArg}` };
  },
};
