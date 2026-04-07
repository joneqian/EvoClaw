/**
 * /debug — 切换 debug 模式
 */

import type { ChannelCommand } from '../types.js';

export const debugCommand: ChannelCommand = {
  name: 'debug',
  aliases: ['toggle-debug'],
  description: '切换调试模式',
  async execute(_args, ctx) {
    if (!ctx.stateRepo) {
      return { handled: true, response: '调试模式不可用（缺少状态仓库）' };
    }

    const key = `debug:${ctx.accountId}`;
    const current = ctx.stateRepo.getState(ctx.channel, key);
    const enabled = current !== 'true';
    ctx.stateRepo.setState(ctx.channel, key, enabled ? 'true' : 'false');
    return { handled: true, response: enabled ? 'Debug 模式已开启' : 'Debug 模式已关闭' };
  },
};
