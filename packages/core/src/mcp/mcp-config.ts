/**
 * MCP 配置发现 — 从 .mcp.json + evo_claw.json 双入口加载 MCP 服务器配置
 *
 * 优先级: 项目级 .mcp.json > 全局 evo_claw.json mcp_servers
 * 参考 Claude Code getAllMcpConfigs()
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DEFAULT_DATA_DIR } from '@evoclaw/shared';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('mcp-config');

/** MCP 服务器配置（单个） */
export interface McpServerConfig {
  name: string;
  type: 'stdio' | 'sse';
  /** stdio: 启动命令 */
  command?: string;
  /** stdio: 命令参数 */
  args?: string[];
  /** stdio: 环境变量 */
  env?: Record<string, string>;
  /** sse: 远程 URL */
  url?: string;
  /** sse: 请求 headers */
  headers?: Record<string, string>;
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 启动超时 ms（默认 30000） */
  startupTimeoutMs?: number;
}

/** .mcp.json 文件格式 */
interface McpJsonFile {
  mcpServers?: Record<string, Omit<McpServerConfig, 'name'>>;
}

/**
 * 发现所有 MCP 服务器配置
 *
 * 搜索顺序:
 * 1. 项目根目录 .mcp.json
 * 2. Agent 工作区 .mcp.json
 * 3. 全局 evo_claw.json 的 mcp_servers
 *
 * @param projectRoot 项目根目录（可选）
 * @param workspacePath Agent 工作区路径（可选）
 */
export function discoverMcpConfigs(projectRoot?: string, workspacePath?: string): McpServerConfig[] {
  const configs = new Map<string, McpServerConfig>();

  // 1. 项目级 .mcp.json
  if (projectRoot) {
    loadMcpJson(path.join(projectRoot, '.mcp.json'), configs);
  }

  // 2. Agent 工作区 .mcp.json
  if (workspacePath && workspacePath !== projectRoot) {
    loadMcpJson(path.join(workspacePath, '.mcp.json'), configs);
  }

  // 3. 全局 evo_claw.json
  const globalConfigPath = path.join(os.homedir(), DEFAULT_DATA_DIR, 'evo_claw.json');
  loadGlobalConfig(globalConfigPath, configs);

  const result = [...configs.values()];
  if (result.length > 0) {
    log.info(`发现 ${result.length} 个 MCP 服务器: ${result.map(c => c.name).join(', ')}`);
  }
  return result;
}

/** 从 .mcp.json 加载配置 */
function loadMcpJson(filePath: string, configs: Map<string, McpServerConfig>): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(raw) as McpJsonFile;

    if (!json.mcpServers) return;

    for (const [name, server] of Object.entries(json.mcpServers)) {
      if (configs.has(name)) continue; // 高优先级已定义，跳过
      configs.set(name, { name, ...server });
    }
    log.info(`加载 MCP 配置: ${filePath} (${Object.keys(json.mcpServers).length} 个服务器)`);
  } catch (err) {
    log.warn(`MCP 配置加载失败: ${filePath} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 从全局 evo_claw.json 加载 mcp_servers */
function loadGlobalConfig(filePath: string, configs: Map<string, McpServerConfig>): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(raw) as { mcp_servers?: McpServerConfig[] };

    if (!json.mcp_servers || !Array.isArray(json.mcp_servers)) return;

    for (const server of json.mcp_servers) {
      if (!server.name) continue;
      if (configs.has(server.name)) continue;
      configs.set(server.name, server);
    }
  } catch {
    // 配置文件不存在或格式错误，跳过
  }
}
