/**
 * MCP Prompt → Skill 桥接
 *
 * 将 MCP 服务器的 prompts 自动转换为 InstalledSkill，
 * 使其出现在 <available_skills> 目录中。
 * 命名规则: mcp:{serverName}:{promptName}
 */

import type { InstalledSkill } from '@evoclaw/shared';

/** MCP Prompt 信息（从 MCP SDK listPrompts 返回） */
export interface McpPromptInfo {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  /** 来源 MCP 服务器名称 */
  serverName: string;
}

/**
 * 将单个 MCP Prompt 转换为 InstalledSkill
 */
export function mcpPromptToSkill(prompt: McpPromptInfo): InstalledSkill {
  const skillName = `mcp:${prompt.serverName}:${prompt.name}`;
  const description = prompt.description ?? `MCP prompt from ${prompt.serverName}`;

  return {
    name: skillName,
    description,
    source: 'mcp',
    installPath: `mcp://${prompt.serverName}/${prompt.name}`,
    gatesPassed: true,  // MCP 服务器已连接即视为门控通过
    disableModelInvocation: false,
    executionMode: 'inline',
  };
}

/**
 * 批量转换所有 MCP prompts 为 InstalledSkill
 */
export function bridgeAllMcpPrompts(prompts: readonly McpPromptInfo[]): InstalledSkill[] {
  return prompts.map(mcpPromptToSkill);
}
