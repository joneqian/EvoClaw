/**
 * 自动模式 Phase 1 — 安全工具白名单 + 快速路径
 *
 * permissive 模式下的增强自动放行逻辑:
 * 1. 安全工具白名单 — 只读工具跳过所有权限检查（零 API 成本）
 * 2. 工作区快速路径 — file_write/edit/apply_patch 在工作区内跳过权限检查
 *
 * 参考 Claude Code classifierDecision.ts SAFE_YOLO_ALLOWLISTED_TOOLS
 */

/** 安全工具白名单 — 跳过所有权限检查 */
export const SAFE_AUTO_TOOLS = new Set([
  // 只读文件
  'read', 'ls', 'find', 'grep',
  // 多媒体只读
  'image', 'pdf',
  // Agent 管理
  'spawn_agent', 'list_agents', 'kill_agent', 'steer_agent', 'yield_agents',
  // 技能（只列出/调用，不修改）
  'invoke_skill', 'list_skills',
  // 计划/UI
  'ask_user',
]);

/** permissive 模式下工作区内自动放行的工具 */
export const PERMISSIVE_WORKSPACE_TOOLS = new Set([
  'write', 'edit', 'apply_patch',
  'bash', 'shell',
]);

/**
 * 检查工具是否在安全白名单中（任何模式都跳过权限检查）
 */
export function isSafeAutoTool(toolName: string): boolean {
  return SAFE_AUTO_TOOLS.has(toolName);
}

/**
 * 检查工具是否在 permissive 模式下可自动放行
 */
export function isPermissiveWorkspaceTool(toolName: string): boolean {
  return PERMISSIVE_WORKSPACE_TOOLS.has(toolName);
}
