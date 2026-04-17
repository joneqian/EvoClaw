/**
 * MCP Client — 真实 MCP 协议实现
 *
 * 使用 @modelcontextprotocol/sdk 连接 MCP Server，
 * 支持 stdio + SSE 两种传输。
 *
 * 参考 Claude Code MCP 客户端（docs/research/21-mcp-client.md）
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig } from './mcp-config.js';
import type { McpPromptInfo } from './mcp-prompt-bridge.js';
import { buildMcpEnv } from './mcp-env.js';
import { wrapWithWarningIfSuspicious } from '../security/prompt-injection-detector.js';
import { startWithReconnect } from './mcp-reconnect.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('mcp-client');

/** MCP 工具信息 */
export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
  searchHint?: string;
  alwaysLoad?: boolean;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

/** MCP 工具调用结果 */
export interface McpToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

/** MCP 服务器状态 */
export type McpServerStatus = 'stopped' | 'starting' | 'running' | 'error';

/** 指令截断限制 */
const MAX_INSTRUCTIONS_LENGTH = 2048;
const CONNECT_TIMEOUT_MS = 30_000;

/**
 * MCP 客户端 — 管理单个 MCP Server 连接
 */
export class McpClient {
  private client: Client | null = null;
  private _status: McpServerStatus = 'stopped';
  private _tools: McpToolInfo[] = [];
  private _prompts: McpPromptInfo[] = [];
  private _error?: string;
  private _instructions?: string;

  constructor(private readonly config: McpServerConfig) {}

  get status(): McpServerStatus { return this._status; }
  get tools(): ReadonlyArray<McpToolInfo> { return this._tools; }
  get prompts(): ReadonlyArray<McpPromptInfo> { return this._prompts; }
  get error(): string | undefined { return this._error; }
  get instructions(): string | undefined { return this._instructions; }
  get serverName(): string { return this.config.name; }

  /** 连接 MCP Server 并发现工具 */
  async start(): Promise<void> {
    if (this._status === 'running') return;
    this._status = 'starting';
    this._error = undefined;

    try {
      // 创建传输
      let transport: StdioClientTransport | StreamableHTTPClientTransport;
      if (this.config.type === 'stdio') {
        if (!this.config.command) throw new Error('stdio 类型需要 command 字段');
        const { env, stripped } = buildMcpEnv(
          process.env,
          this.config.env,
          this.config.envPassthrough,
        );
        if (stripped.length > 0) {
          log.warn(`MCP "${this.config.name}" envPassthrough 中含敏感变量被剥离: ${stripped.join(', ')}`);
        }
        transport = new StdioClientTransport({
          command: this.config.command,
          args: this.config.args,
          env,
        });
      } else if (this.config.type === 'sse') {
        if (!this.config.url) throw new Error('sse 类型需要 url 字段');
        transport = new StreamableHTTPClientTransport(new URL(this.config.url));
      } else {
        throw new Error(`不支持的传输类型: ${(this.config as any).type}`);
      }

      // 创建客户端并连接
      this.client = new Client({ name: 'evoclaw', version: '1.0.0' }, { capabilities: {} });

      const timeoutMs = this.config.startupTimeoutMs ?? CONNECT_TIMEOUT_MS;
      await Promise.race([
        this.client.connect(transport),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`连接超时 (${timeoutMs}ms)`)), timeoutMs)),
      ]);

      const serverInfo = this.client.getServerVersion();
      log.info(`MCP "${this.config.name}" 已连接: ${serverInfo?.name ?? 'unknown'} v${serverInfo?.version ?? '?'}`);

      // 发现工具和 Prompts
      await this.refreshTools();
      await this.refreshPrompts();
      this._status = 'running';
    } catch (err) {
      this._status = 'error';
      this._error = err instanceof Error ? err.message : String(err);
      log.error(`MCP "${this.config.name}" 连接失败: ${this._error}`);
      await this.dispose().catch(() => {});
    }
  }

  /** 刷新工具列表 */
  async refreshTools(): Promise<void> {
    if (!this.client) return;
    try {
      const result = await this.client.listTools();
      this._tools = (result.tools ?? []).map(tool => ({
        name: tool.name,
        description: (tool.description ?? '').slice(0, MAX_INSTRUCTIONS_LENGTH),
        inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
        serverName: this.config.name,
        searchHint: (tool as any)._meta?.['anthropic/searchHint'],
        alwaysLoad: (tool as any)._meta?.['anthropic/alwaysLoad'],
        readOnlyHint: (tool as any).annotations?.readOnlyHint,
        destructiveHint: (tool as any).annotations?.destructiveHint,
      }));
      log.info(`MCP "${this.config.name}" 发现 ${this._tools.length} 个工具`);
    } catch (err) {
      log.warn(`MCP "${this.config.name}" 工具发现失败: ${err instanceof Error ? err.message : err}`);
      this._tools = [];
    }
  }

  /** 刷新 Prompts 列表（部分 MCP 服务器不支持，降级为空数组） */
  async refreshPrompts(): Promise<void> {
    if (!this.client) return;
    try {
      const result = await this.client.listPrompts();
      this._prompts = (result.prompts ?? []).map(p => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments?.map(a => ({ name: a.name, description: a.description, required: a.required })),
        serverName: this.config.name,
      }));
      if (this._prompts.length > 0) {
        log.info(`MCP "${this.config.name}" 发现 ${this._prompts.length} 个 prompts`);
      }
    } catch {
      // 部分 MCP 服务器不支持 listPrompts，降级为空
      this._prompts = [];
    }
  }

  /** 获取单个 MCP Prompt 的内容 */
  async getPrompt(promptName: string, args?: Record<string, string>): Promise<string> {
    if (!this.client || this._status !== 'running') {
      return `MCP "${this.config.name}" 未运行`;
    }
    try {
      const result = await this.client.getPrompt({ name: promptName, arguments: args });
      // 拼接 prompt messages 的文本内容
      const joined = (result.messages ?? [])
        .map(m => {
          if (typeof m.content === 'string') return m.content;
          if (m.content && typeof m.content === 'object' && 'text' in m.content) return (m.content as { text: string }).text;
          return '';
        })
        .filter(Boolean)
        .join('\n\n');
      // Prompt 注入扫描：可疑则包 <warning> 标签让 LLM 自行判断（不杀进程）
      return wrapWithWarningIfSuspicious(joined, `MCP server "${this.config.name}" prompt "${promptName}"`);
    } catch (err) {
      return `MCP prompt 获取失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** 调用 MCP 工具 */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (!this.client || this._status !== 'running') {
      return { content: [{ type: 'text', text: `MCP "${this.config.name}" 未运行` }], isError: true };
    }
    try {
      const result = await this.client.callTool({ name: toolName, arguments: args });
      return { content: (result.content ?? []) as McpToolResult['content'], isError: result.isError === true };
    } catch (err) {
      return { content: [{ type: 'text', text: `MCP 调用失败: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }

  /** 断开连接 */
  async dispose(): Promise<void> {
    try { if (this.client) await this.client.close(); } catch { /* ignore */ }
    this.client = null;
    this._status = 'stopped';
    this._tools = [];
    this._prompts = [];
  }
}

/**
 * MCP Manager — 管理多个 MCP Server 连接
 */
export class McpManager {
  private readonly clients = new Map<string, McpClient>();
  /** 保留每个 server 的原始 config，供 reconnect 重建 client 使用 */
  private readonly configs = new Map<string, McpServerConfig>();

  async addServer(config: McpServerConfig): Promise<void> {
    if (this.clients.has(config.name)) await this.removeServer(config.name);
    const client = new McpClient(config);
    this.clients.set(config.name, client);
    this.configs.set(config.name, config);
    // 首启失败时自动指数退避重试（1s→2s→4s→8s→16s，最多 5 次）；
    // 5 次全失败后返回 false，client.status 为 'error'，不阻塞其它 server 启动。
    if (config.enabled !== false) await startWithReconnect(client);
  }

  async removeServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client) { await client.dispose(); this.clients.delete(name); }
    this.configs.delete(name);
  }

  /**
   * 手动重连：dispose 现有 client → 用原 config 新建 → 走 startWithReconnect 指数退避。
   * 返回 true = 恢复成功；false = 5 次全失败；null = server 不存在或无原 config。
   */
  async reconnect(name: string): Promise<boolean | null> {
    const config = this.configs.get(name);
    if (!config) return null;
    const existing = this.clients.get(name);
    if (existing) { await existing.dispose(); }
    const client = new McpClient(config);
    this.clients.set(name, client);
    if (config.enabled === false) return true;
    return startWithReconnect(client);
  }

  getAllTools(): McpToolInfo[] {
    const tools: McpToolInfo[] = [];
    for (const client of this.clients.values()) {
      if (client.status === 'running') tools.push(...client.tools);
    }
    return tools;
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const client = this.clients.get(serverName);
    if (!client) return { content: [{ type: 'text', text: `MCP "${serverName}" 不存在` }], isError: true };
    return client.callTool(toolName, args);
  }

  /** 获取所有 MCP 服务器的 Prompts */
  getAllPrompts(): McpPromptInfo[] {
    const prompts: McpPromptInfo[] = [];
    for (const client of this.clients.values()) {
      if (client.status === 'running') prompts.push(...client.prompts);
    }
    return prompts;
  }

  /** 获取指定 MCP 服务器的 Prompt 内容 */
  async getPrompt(serverName: string, promptName: string, args?: Record<string, string>): Promise<string> {
    const client = this.clients.get(serverName);
    if (!client) return `MCP "${serverName}" 不存在`;
    return client.getPrompt(promptName, args);
  }

  getStates(): Array<{ name: string; status: McpServerStatus; toolCount: number; error?: string }> {
    return [...this.clients.values()].map(c => ({
      name: c.serverName, status: c.status, toolCount: c.tools.length, error: c.error,
    }));
  }

  getAllInstructions(): Array<{ name: string; instructions: string }> {
    return [...this.clients.values()]
      .filter(c => c.instructions)
      .map(c => ({ name: c.serverName, instructions: c.instructions! }));
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.clients.values()].map(c => c.dispose()));
    this.clients.clear();
  }
}
