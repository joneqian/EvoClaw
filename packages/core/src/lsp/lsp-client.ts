/**
 * LSP Client -- 语言服务器协议客户端
 * 通过 stdio 连接 LSP server，支持 hover/definition/references
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('lsp-client');

export interface LspServerConfig {
  name: string;
  command: string;
  args?: string[];
  rootUri?: string;
}

export interface LspCapabilities {
  hoverProvider?: boolean;
  definitionProvider?: boolean;
  referencesProvider?: boolean;
}

export class LspClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private buffer = '';
  capabilities: LspCapabilities = {};

  constructor(private config: LspServerConfig) {}

  async start(): Promise<void> {
    log.info(`LSP server "${this.config.name}" 启动: ${this.config.command} ${(this.config.args ?? []).join(' ')}`);

    try {
      this.process = spawn(this.config.command, this.config.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        log.debug(`LSP stderr: ${data.toString().trim()}`);
      });

      this.process.on('error', (err) => {
        log.error(`LSP process error: ${err.message}`);
      });

      // 发送 initialize 请求
      const result = await this.sendRequest('initialize', {
        processId: process.pid,
        rootUri: this.config.rootUri ?? null,
        capabilities: {},
      });

      this.capabilities = result?.capabilities ?? {};
      await this.sendNotification('initialized', {});

      log.info(`LSP "${this.config.name}" 初始化完成:`, this.capabilities);
    } catch (err) {
      log.error(`LSP "${this.config.name}" 启动失败: ${err}`);
    }
  }

  async hover(uri: string, line: number, character: number): Promise<string | null> {
    if (!this.capabilities.hoverProvider) return null;
    try {
      const result = await this.sendRequest('textDocument/hover', {
        textDocument: { uri },
        position: { line, character },
      });
      return result?.contents?.value ?? result?.contents ?? null;
    } catch { return null; }
  }

  async definition(uri: string, line: number, character: number): Promise<any | null> {
    if (!this.capabilities.definitionProvider) return null;
    try {
      return await this.sendRequest('textDocument/definition', {
        textDocument: { uri },
        position: { line, character },
      });
    } catch { return null; }
  }

  async references(uri: string, line: number, character: number): Promise<any[] | null> {
    if (!this.capabilities.referencesProvider) return null;
    try {
      return await this.sendRequest('textDocument/references', {
        textDocument: { uri },
        position: { line, character },
        context: { includeDeclaration: true },
      });
    } catch { return null; }
  }

  async dispose(): Promise<void> {
    if (this.process) {
      try {
        await this.sendRequest('shutdown', null);
        this.sendNotification('exit', null);
      } catch { /* ignore */ }
      this.process.kill();
      this.process = null;
    }
  }

  private async sendRequest(method: string, params: any): Promise<any> {
    const id = ++this.requestId;
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP 请求超时 (10s): ${method}`));
      }, 10000);

      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });

      this.process?.stdin?.write(header + message);
    });
  }

  private sendNotification(method: string, params: any): void {
    const message = JSON.stringify({ jsonrpc: '2.0', method, params });
    const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;
    this.process?.stdin?.write(header + message);
  }

  private processBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) { this.buffer = this.buffer.slice(headerEnd + 4); continue; }

      const contentLength = parseInt(match[1], 10);
      const contentStart = headerEnd + 4;
      if (this.buffer.length < contentStart + contentLength) break;

      const content = this.buffer.slice(contentStart, contentStart + contentLength);
      this.buffer = this.buffer.slice(contentStart + contentLength);

      try {
        const msg = JSON.parse(content);
        if (msg.id != null && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        }
      } catch { /* ignore parse errors */ }
    }
  }
}
