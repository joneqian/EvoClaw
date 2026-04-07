/**
 * /echo — 回显消息（用于通道连通性测试）
 */

import type { ChannelCommand } from '../types.js';

export const echoCommand: ChannelCommand = {
  name: 'echo',
  description: '回显消息（通道测试）',
  async execute(args) {
    const message = args.trim();
    return { handled: true, response: message || '(空消息)' };
  },
};
