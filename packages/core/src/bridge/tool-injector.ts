/** 工具定义（简化版，兼容 PI AgentTool 接口） */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * 工具注入器 — 5 阶段注入（Sprint 2 仅实现阶段 1-3 桩）
 * 阶段 1: PI 内置工具（read/write/edit/bash）— 通过 PI 直接提供
 * 阶段 2: 权限拦截层 — 暂时 auto-allow
 * 阶段 3: EvoClaw 特定工具 — 桩实现
 */
export function getInjectedTools(): ToolDefinition[] {
  // Sprint 2: 返回空数组，PI 内置工具由 PI 框架自行管理
  // 后续 Sprint 会在此添加 EvoClaw 特定工具
  return [];
}

/** 权限拦截器（桩实现，暂时全部允许） */
export function permissionInterceptor(toolName: string, _args: Record<string, unknown>): 'allow' | 'deny' | 'ask' {
  // Sprint 2: auto-allow all
  return 'allow';
}
