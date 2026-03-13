import type { ContextPlugin, TurnContext } from '../plugin.interface.js';

/** 权限缓存（内存缓存，后续对接 Rust 层） */
const permissionCache = new Map<string, Map<string, boolean>>();

/** 检查权限 */
export function checkPermission(agentId: string, category: string): boolean {
  const agentPerms = permissionCache.get(agentId);
  if (!agentPerms) return true; // 默认允许
  return agentPerms.get(category) ?? true;
}

/** 设置权限（供测试和初始化用） */
export function setPermission(agentId: string, category: string, allowed: boolean): void {
  if (!permissionCache.has(agentId)) {
    permissionCache.set(agentId, new Map());
  }
  permissionCache.get(agentId)!.set(category, allowed);
}

/** 权限检查插件 */
export const permissionPlugin: ContextPlugin = {
  name: 'permission',
  priority: 20,
  async beforeTurn(ctx: TurnContext) {
    // 当前实现：检查 agent 级别权限，全部通过
    // 后续对接 Rust Keychain 层的权限弹窗
    const allowed = checkPermission(ctx.agentId, 'chat');
    if (!allowed) {
      throw new Error(`Agent ${ctx.agentId} 没有聊天权限`);
    }
  },
};
