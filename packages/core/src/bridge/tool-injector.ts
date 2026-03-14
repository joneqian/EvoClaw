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

  /** 记录工具执行 */
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
