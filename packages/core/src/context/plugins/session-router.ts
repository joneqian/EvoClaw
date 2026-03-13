import type { ContextPlugin, TurnContext } from '../plugin.interface.js';
import { parseSessionKey } from '../../routing/session-key.js';

// 重新导出以保持向后兼容
export { parseSessionKey };
export type { ParsedSession as SessionInfo } from '../../routing/session-key.js';

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
