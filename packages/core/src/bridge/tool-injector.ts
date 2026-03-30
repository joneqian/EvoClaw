import crypto from 'node:crypto';
import type { PermissionInterceptor, InterceptResult } from '../tools/permission-interceptor.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';

/** 工具审计日志条目 */
export interface ToolAuditEntry {
  id: string;
  agentId: string;
  sessionKey: string;
  toolName: string;
  inputJson: string | null;
  outputJson: string | null;
  status: 'success' | 'error' | 'denied' | 'timeout';
  durationMs: number | null;
  permissionId: string | null;
  createdAt: string;
}

/**
 * 工具审计器 — 记录每次工具执行到 tool_audit_log 表
 */
export class ToolAuditor {
  constructor(private db: SqliteStore) {}

  /** 记录工具执行（同步写入，适用于低频场景） */
  log(entry: {
    agentId: string;
    sessionKey: string;
    toolName: string;
    inputJson?: string;
    outputJson?: string;
    status: 'success' | 'error' | 'denied' | 'timeout';
    durationMs?: number;
    permissionId?: string;
  }): string {
    const id = crypto.randomUUID();
    this.db.run(
      `INSERT INTO tool_audit_log (id, agent_id, session_key, tool_name, input_json, output_json, status, duration_ms, permission_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      entry.agentId,
      entry.sessionKey,
      entry.toolName,
      entry.inputJson ?? null,
      entry.outputJson ?? null,
      entry.status,
      entry.durationMs ?? null,
      entry.permissionId ?? null,
    );
    return id;
  }

  /** 查询 Agent 的工具执行记录 */
  listByAgent(agentId: string, limit: number = 50): ToolAuditEntry[] {
    return this.db.all<ToolAuditEntry>(
      `SELECT id, agent_id AS agentId, session_key AS sessionKey, tool_name AS toolName,
              input_json AS inputJson, output_json AS outputJson, status,
              duration_ms AS durationMs, permission_id AS permissionId, created_at AS createdAt
       FROM tool_audit_log
       WHERE agent_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      agentId,
      limit,
    );
  }

  /** 查询 Session 的工具执行记录 */
  listBySession(sessionKey: string, limit: number = 50): ToolAuditEntry[] {
    return this.db.all<ToolAuditEntry>(
      `SELECT id, agent_id AS agentId, session_key AS sessionKey, tool_name AS toolName,
              input_json AS inputJson, output_json AS outputJson, status,
              duration_ms AS durationMs, permission_id AS permissionId, created_at AS createdAt
       FROM tool_audit_log
       WHERE session_key = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      sessionKey,
      limit,
    );
  }
}

/** 审计队列条目（内存中缓存，等待批量写入） */
interface AuditQueueEntry {
  id: string;
  agentId: string;
  sessionKey: string;
  toolName: string;
  inputJson: string | null;
  outputJson: string | null;
  status: string;
  durationMs: number | null;
  permissionId: string | null;
}

/**
 * 审计日志异步队列 — 内存缓存 + 批量写入
 *
 * 性能优化：将同步 DB INSERT（5-50ms/次）替换为内存 push（0.01ms/次），
 * 在 flush() 时用单个事务批量写入。
 *
 * 使用方式：
 *   const queue = new ToolAuditQueue(store);
 *   queue.push({ agentId, sessionKey, toolName, ... }); // 每次工具调用
 *   queue.flush(); // Agent 完成后调用
 */
export class ToolAuditQueue {
  private queue: AuditQueueEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private db: SqliteStore,
    /** 自动 flush 间隔（毫秒），0 表示不自动 flush */
    private autoFlushMs: number = 2000,
  ) {}

  /** 将审计条目加入队列（O(1)，无磁盘 I/O） */
  push(entry: {
    agentId: string;
    sessionKey: string;
    toolName: string;
    inputJson?: string;
    outputJson?: string;
    status: 'success' | 'error' | 'denied' | 'timeout';
    durationMs?: number;
    permissionId?: string;
  }): void {
    this.queue.push({
      id: crypto.randomUUID(),
      agentId: entry.agentId,
      sessionKey: entry.sessionKey,
      toolName: entry.toolName,
      inputJson: entry.inputJson ?? null,
      outputJson: entry.outputJson ?? null,
      status: entry.status,
      durationMs: entry.durationMs ?? null,
      permissionId: entry.permissionId ?? null,
    });

    // 启动自动 flush 定时器（首次 push 时）
    if (this.autoFlushMs > 0 && !this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.autoFlushMs);
    }
  }

  /** 批量写入所有缓存的审计条目（单个事务） */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0);
    try {
      this.db.transaction(() => {
        const stmt = `INSERT INTO tool_audit_log (id, agent_id, session_key, tool_name, input_json, output_json, status, duration_ms, permission_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        for (const e of batch) {
          this.db.run(stmt, e.id, e.agentId, e.sessionKey, e.toolName, e.inputJson, e.outputJson, e.status, e.durationMs, e.permissionId);
        }
      });
    } catch {
      // 审计日志写入失败不应影响 Agent 运行
    }
  }

  /** 检查队列中是否包含指定工具的调用记录 */
  hasToolCall(toolName: string): boolean {
    return this.queue.some(e => e.toolName === toolName);
  }

  /** 队列中的待写入条目数 */
  get pending(): number {
    return this.queue.length;
  }
}

/** 工具定义（简化版，兼容 PI AgentTool 接口） */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

/** 注入器配置 */
export interface ToolInjectorConfig {
  interceptor?: PermissionInterceptor;
  agentId?: string;
  /** 阶段 3: EvoClaw 特定工具 */
  evoClawTools?: ToolDefinition[];
  /** 阶段 4: Channel 工具 */
  channelTools?: ToolDefinition[];
}

/** 全局拦截器实例（由 server 启动时注入） */
let globalConfig: ToolInjectorConfig = {};

/** 设置全局拦截器配置 */
export function setToolInjectorConfig(config: ToolInjectorConfig): void {
  globalConfig = config;
}

/**
 * 工具注入器 — 5 阶段注入
 * 阶段 1: PI 内置工具（read/write/edit/bash）— PI 框架自行管理
 * 阶段 2: 权限拦截层 — 审计包装
 * 阶段 3: EvoClaw 特定工具 — memory_search/memory_get/knowledge_query
 * 阶段 4: Channel 工具 — feishu_send/wecom_send/desktop_notify
 * 阶段 5: Skill 工具目录 — 通过 tool-registry 插件注入 system prompt（非工具注册）
 */
export function getInjectedTools(): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // 阶段 3: EvoClaw 特定工具
  if (globalConfig.evoClawTools) {
    tools.push(...globalConfig.evoClawTools);
  }

  // 阶段 4: Channel 工具
  if (globalConfig.channelTools) {
    tools.push(...globalConfig.channelTools);
  }

  // 阶段 5: Skill 工具目录通过 system prompt 注入，不在此注册

  return tools;
}

/**
 * 权限拦截器 — 委托给 PermissionInterceptor
 * 若未配置拦截器，默认允许（向后兼容）
 */
export function permissionInterceptor(toolName: string, args: Record<string, unknown>): InterceptResult {
  if (!globalConfig.interceptor || !globalConfig.agentId) {
    // 未配置拦截器时默认允许（向后兼容 Sprint 2 行为）
    return { allowed: true };
  }
  return globalConfig.interceptor.intercept(globalConfig.agentId, toolName, args);
}
