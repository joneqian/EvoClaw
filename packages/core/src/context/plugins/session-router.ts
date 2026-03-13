import type { ContextPlugin, TurnContext } from '../plugin.interface.js';
import type { SessionKey } from '@evoclaw/shared';

/** 解析后的 Session 信息 */
export interface SessionInfo {
  agentId: string;
  channel: string;
  chatType: string;
  peerId: string;
}

/** 解析 Session Key */
export function parseSessionKey(key: SessionKey): SessionInfo {
  const parts = key.split(':');
  return {
    agentId: parts[1] ?? '',
    channel: parts[2] ?? 'default',
    chatType: parts[3] ?? 'direct',
    peerId: parts[4] ?? '',
  };
}

/** Session 路由插件 — 解析 Session Key 并设置可见性范围 */
export const sessionRouterPlugin: ContextPlugin = {
  name: 'session-router',
  priority: 10,
  async beforeTurn(ctx: TurnContext) {
    const info = parseSessionKey(ctx.sessionKey);
    // 将 session 信息注入上下文（供后续插件使用）
    ctx.injectedContext.push(
      `[Session] channel=${info.channel} chatType=${info.chatType} peerId=${info.peerId}`
    );
  },
};
