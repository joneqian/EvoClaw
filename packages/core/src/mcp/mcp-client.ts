/**
 * MCP Client — MCP Server 生命周期管理
 *
 * 通过 stdio 启动 MCP Server 子进程，发现工具，代理工具调用。
 *
 * 注意：当前 @modelcontextprotocol/sdk 未安装，此模块为占位实现。
 * 安装 SDK 后可替换为真实的 Client + StdioClientTransport 实现。
 *
 * TODO: 安装 @modelcontextprotocol/sdk 后：
 * 1. import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 * 2. import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
 * 3. 替换 start/listTools/callTool/dispose 的占位实现
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { McpServerConfig, McpToolInfo, McpToolResult, McpServerState, McpServerStatus } from '@evoclaw/shared';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('mcp-client');

/**
 * MCP 客户端 — 管理单个 MCP Server 的连接
 */
export class McpClient {
  private status: McpServerStatus = 'stopped';
  private tools: McpToolInfo[] = [];
  private error?: string;
  private process?: ChildProcess;

  constructor(private readonly config: McpServerConfig) {}

  /** 获取当前状态 */
  getState(): McpServerState {
    return {
      config: this.config,
      status: this.status,
      tools: [...this.tools],
      error: this.error,
    };
  }

  /**
   * 启动 MCP Server 并发现工具
   *
   * TODO: 当 @modelcontextprotocol/sdk 可用时，替换为：
   * ```
   * const transport = new StdioClientTransport({ command, args, env });
   * const client = new Client({ name: 'evoclaw', version: '1.0' });
   * await client.connect(transport);
   * const { tools } = await client.listTools();
   * ```
   */
  async start(): Promise<void> {
    if (this.status === 'running') return;

    this.status = 'starting';
    this.error = undefined;

    try {
      const timeoutMs = this.config.startupTimeoutMs ?? 30_000;

      // 占位实现：启动子进程但不进行 MCP 协议通信
      // 真实实现需要 @modelcontextprotocol/sdk 的 Client + StdioClientTransport
      log.warn(
        `MCP Server "${this.config.name}" 启动跳过：@modelcontextprotocol/sdk 未安装。` +
        `命令: ${this.config.command} ${(this.config.args ?? []).join(' ')}`,
      );

      // 标记为错误状态，提示用户安装 SDK
      this.status = 'error';
      this.error = '@modelcontextprotocol/sdk 未安装，请运行: pnpm add @modelcontextprotocol/sdk';
      this.tools = [];
    } catch (err) {
      this.status = 'error';
      this.error = err instanceof Error ? err.message : String(err);
      log.error(`MCP Server "${this.config.name}" 启动失败:`, this.error);
    }
  }

  /** 获取已发现的工具列表 */
  listTools(): ReadonlyArray<McpToolInfo> {
    return this.tools;
  }

  /**
   * 调用 MCP 工具
   *
   * TODO: 当 @modelcontextprotocol/sdk 可用时，替换为：
   * ```
   * const result = await client.callTool({ name, arguments: args });
   * return result;
   * ```
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (this.status !== 'running') {
      return {
        content: [{ type: 'text', text: `MCP Server "${this.config.name}" 未运行 (status=${this.status})` }],
        isError: true,
      };
    }

    // 占位实现
    return {
      content: [{ type: 'text', text: `MCP 工具调用未实现：需要安装 @modelcontextprotocol/sdk` }],
      isError: true,
    };
  }

  /** 停止 MCP Server */
  async dispose(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = undefined;
    }
    this.status = 'stopped';
    this.tools = [];
    log.info(`MCP Server "${this.config.name}" 已停止`);
  }
}

/**
 * MCP Manager — 管理多个 MCP Server 连接
 */
export class McpManager {
  private readonly clients = new Map<string, McpClient>();

  /** 添加并启动一个 MCP Server */
  async addServer(config: McpServerConfig): Promise<void> {
    if (this.clients.has(config.name)) {
      await this.removeServer(config.name);
    }

    const client = new McpClient(config);
    this.clients.set(config.name, client);

    if (config.enabled !== false) {
      await client.start();
    }
  }

  /** 移除一个 MCP Server */
  async removeServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client) {
      await client.dispose();
      this.clients.delete(name);
    }
  }

  /** 获取所有已发现的工具 */
  getAllTools(): McpToolInfo[] {
    const tools: McpToolInfo[] = [];
    for (const client of this.clients.values()) {
      tools.push(...client.listTools());
    }
    return tools;
  }

  /** 调用工具（自动路由到对应的 MCP Server） */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const client = this.clients.get(serverName);
    if (!client) {
      return {
        content: [{ type: 'text', text: `MCP Server "${serverName}" 不存在` }],
        isError: true,
      };
    }
    return client.callTool(toolName, args);
  }

  /** 获取所有 Server 状态 */
  getStates(): McpServerState[] {
    return Array.from(this.clients.values()).map((c) => c.getState());
  }

  /** 停止所有 MCP Server */
  async disposeAll(): Promise<void> {
    const promises = Array.from(this.clients.values()).map((c) => c.dispose());
    await Promise.all(promises);
    this.clients.clear();
  }
}
