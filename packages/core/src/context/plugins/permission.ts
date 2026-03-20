import type { ContextPlugin, TurnContext } from '../plugin.interface.js';
import type { SecurityExtension, PermissionResult } from '../../bridge/security-extension.js';

/**
 * 创建权限检查插件
 * 每轮对话前检查 agent 是否有 'skill' 权限
 * deny → 抛错阻止对话，ask/allow → 通过
 */
export function createPermissionPlugin(security: SecurityExtension): ContextPlugin {
  return {
    name: 'permission',
    priority: 20,
    async beforeTurn(ctx: TurnContext) {
      const result: PermissionResult = security.checkPermission(ctx.agentId, 'skill', '*');
      if (result === 'deny') {
        throw new Error(`Agent ${ctx.agentId} 的技能权限被拒绝`);
      }
      // 'ask' 和 'allow' 均通过 — 工具级别的权限由 PermissionInterceptor 在执行时检查
    },
  };
}

// ─── 向后兼容导出 ───

/** @deprecated 使用 createPermissionPlugin(security) 代替 */
export const permissionPlugin: ContextPlugin = {
  name: 'permission',
  priority: 20,
  async beforeTurn() {
    // 旧版空操作，保持向后兼容
  },
};

/** @deprecated */
export function checkPermission(_agentId: string, _category: string): boolean {
  return true;
}

/** @deprecated */
export function setPermission(_agentId: string, _category: string, _allowed: boolean): void {
  // no-op
}
