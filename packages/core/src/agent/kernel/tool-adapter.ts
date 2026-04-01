/**
 * 工具适配器 — EvoClaw ToolDefinition → KernelTool
 *
 * 将 EvoClaw 的 1 参签名工具 (execute(args) → string) 适配为
 * KernelTool 接口，集成权限检查、安全守卫、审计日志。
 *
 * 同时负责构建完整的 KernelTool 池:
 * 内置工具 (read/write/edit/grep/find/ls) + 增强 bash + EvoClaw 自定义工具
 */

import type { ToolDefinition } from '../../bridge/tool-injector.js';
import type { KernelTool, ToolCallResult } from './types.js';
import type { ToolSafetyGuard } from '../tool-safety.js';
import { normalizeToolSchema } from '../schema-adapter.js';
import { createBuiltinTools } from './builtin-tools.js';
import { createEnhancedExecTool } from '../embedded-runner-tools.js';

// ═══════════════════════════════════════════════════════════════════════════
// Constants — 工具能力声明
// ═══════════════════════════════════════════════════════════════════════════

/** 只读工具集合 (不修改文件系统或外部状态) */
const READ_ONLY_TOOLS = new Set([
  'read', 'grep', 'find', 'ls',
  'web_search', 'web_fetch', 'image', 'pdf',
  'memory_search', 'memory_get', 'knowledge_query',
  'list_agents', 'yield_agents',
  'todo_write', // 虽然名为 write，但只修改内存中的任务列表
]);

/** 并发安全工具集合 (无副作用，可并行执行) */
const CONCURRENT_SAFE_TOOLS = new Set([
  'read', 'grep', 'find', 'ls',
  'web_search', 'web_fetch', 'image', 'pdf',
  'memory_search', 'memory_get', 'knowledge_query',
]);

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** 审计日志条目 */
export interface AuditLogEntry {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  status: 'success' | 'error' | 'denied';
  durationMs: number;
}

/** 工具适配依赖项 */
export interface ToolAdapterDeps {
  /** 权限拦截函数 — 返回 null 允许，返回字符串为拒绝原因 */
  permissionFn?: (toolName: string, args: Record<string, unknown>) => Promise<string | null>;
  /** 工具安全守卫 (循环检测 + 结果截断) */
  toolSafety: ToolSafetyGuard;
  /** 审计日志回调 */
  auditFn?: (entry: AuditLogEntry) => void;
  /** Provider ID (用于 schema 适配) */
  provider: string;
}

/** buildKernelTools 配置 */
export interface BuildToolsConfig {
  /** Context window 大小 (用于 adaptive read) */
  builtinContextWindow: number;
  /** EvoClaw 自定义工具 (阶段 3-4 注入) */
  evoClawTools?: ToolDefinition[];
  /** 权限拦截函数 */
  permissionFn?: (toolName: string, args: Record<string, unknown>) => Promise<string | null>;
  /** 工具安全守卫 */
  toolSafety: ToolSafetyGuard;
  /** 审计日志回调 */
  auditFn?: (entry: AuditLogEntry) => void;
  /** Provider ID */
  provider: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Adapter
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 将 EvoClaw ToolDefinition (1参签名) 适配为 KernelTool
 *
 * 集成层:
 * 1. 权限检查 (permissionFn)
 * 2. 安全检查 (ToolSafetyGuard.checkBeforeExecution)
 * 3. 执行原始工具
 * 4. 后处理: 无进展检测 + 结果截断
 * 5. 审计日志
 */
export function adaptEvoclawTool(
  tool: ToolDefinition,
  deps: ToolAdapterDeps,
): KernelTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: normalizeToolSchema(
      tool.parameters as Record<string, unknown>,
      deps.provider,
    ),

    async call(input: Record<string, unknown>): Promise<ToolCallResult> {
      const start = Date.now();

      // 1. 权限检查
      if (deps.permissionFn) {
        const rejection = await deps.permissionFn(tool.name, input);
        if (rejection) {
          deps.auditFn?.({
            toolName: tool.name, args: input,
            result: rejection, status: 'denied',
            durationMs: Date.now() - start,
          });
          return { content: `[权限拒绝] ${rejection}`, isError: true };
        }
      }

      // 2. 安全检查 (循环检测)
      const check = deps.toolSafety.checkBeforeExecution(tool.name, input);
      if (check.blocked) {
        deps.auditFn?.({
          toolName: tool.name, args: input,
          result: check.reason ?? '', status: 'denied',
          durationMs: Date.now() - start,
        });
        return { content: `⚠️ ${check.reason}`, isError: true };
      }

      // 3. 执行
      try {
        const rawResult = await tool.execute(input);

        // 4. 后处理: 无进展检测
        const noProgress = deps.toolSafety.recordResult(rawResult);
        if (noProgress.blocked) {
          deps.auditFn?.({
            toolName: tool.name, args: input,
            result: noProgress.reason ?? '', status: 'error',
            durationMs: Date.now() - start,
          });
          return { content: `⚠️ ${noProgress.reason}`, isError: true };
        }

        // 5. 结果截断
        const truncated = deps.toolSafety.truncateResult(rawResult);

        deps.auditFn?.({
          toolName: tool.name, args: input,
          result: truncated.slice(0, 500), status: 'success',
          durationMs: Date.now() - start,
        });

        return { content: truncated };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.auditFn?.({
          toolName: tool.name, args: input,
          result: msg, status: 'error',
          durationMs: Date.now() - start,
        });
        return { content: msg, isError: true };
      }
    },

    isReadOnly: () => READ_ONLY_TOOLS.has(tool.name),
    isConcurrencySafe: () => CONCURRENT_SAFE_TOOLS.has(tool.name),
  };
}

/**
 * 适配 KernelTool (内置工具) — 包装权限 + 安全守卫
 *
 * 内置工具已实现 KernelTool 接口，但需要包装权限检查和安全守卫
 */
function wrapBuiltinTool(tool: KernelTool, deps: ToolAdapterDeps): KernelTool {
  const originalCall = tool.call.bind(tool);

  return {
    ...tool,
    inputSchema: normalizeToolSchema(
      tool.inputSchema as Record<string, unknown>,
      deps.provider,
    ),

    async call(input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolCallResult> {
      const start = Date.now();

      // 权限检查
      if (deps.permissionFn) {
        const rejection = await deps.permissionFn(tool.name, input);
        if (rejection) {
          deps.auditFn?.({
            toolName: tool.name, args: input,
            result: rejection, status: 'denied',
            durationMs: Date.now() - start,
          });
          return { content: `[权限拒绝] ${rejection}`, isError: true };
        }
      }

      // 安全检查
      const check = deps.toolSafety.checkBeforeExecution(tool.name, input);
      if (check.blocked) {
        deps.auditFn?.({
          toolName: tool.name, args: input,
          result: check.reason ?? '', status: 'denied',
          durationMs: Date.now() - start,
        });
        return { content: `⚠️ ${check.reason}`, isError: true };
      }

      // 执行
      const result = await originalCall(input, signal);

      // 后处理
      if (!result.isError) {
        const noProgress = deps.toolSafety.recordResult(result.content);
        if (noProgress.blocked) {
          return { content: `⚠️ ${noProgress.reason}`, isError: true };
        }
        result.content = deps.toolSafety.truncateResult(result.content);
      }

      deps.auditFn?.({
        toolName: tool.name, args: input,
        result: result.content.slice(0, 500),
        status: result.isError ? 'error' : 'success',
        durationMs: Date.now() - start,
      });

      return result;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API — 构建完整 KernelTool 池
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 构建完整的 KernelTool 池
 *
 * 5 阶段注入 (参考 CLAUDE.md):
 * 1. 内置工具 (read/write/edit/grep/find/ls)
 * 2. 增强 bash (复用 createEnhancedExecTool)
 * 3. EvoClaw 自定义工具 (web_search, web_fetch, image, memory_*, etc.)
 * 4. 权限 + 安全守卫包装
 *
 * @returns KernelTool 数组 (去重，后注入覆盖先注入)
 */
export function buildKernelTools(config: BuildToolsConfig): KernelTool[] {
  const deps: ToolAdapterDeps = {
    permissionFn: config.permissionFn,
    toolSafety: config.toolSafety,
    auditFn: config.auditFn,
    provider: config.provider,
  };

  // 1. 内置工具 (包装权限 + 安全)
  const builtinTools = createBuiltinTools(config.builtinContextWindow)
    .map(tool => wrapBuiltinTool(tool, deps));

  // 2. 增强 bash (适配为 KernelTool)
  const bashDef = createEnhancedExecTool();
  const bashTool = adaptEvoclawTool({
    name: bashDef.name,
    description: bashDef.description,
    parameters: bashDef.parameters,
    execute: bashDef.execute,
  }, deps);

  // 3. EvoClaw 自定义工具
  const customTools = (config.evoClawTools ?? []).map(tool =>
    adaptEvoclawTool(tool, deps)
  );

  // 合并 (去重: 后注入覆盖先注入)
  const toolMap = new Map<string, KernelTool>();
  for (const tool of [...builtinTools, bashTool, ...customTools]) {
    toolMap.set(tool.name, tool);
  }

  return [...toolMap.values()];
}
