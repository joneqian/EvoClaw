/**
 * 工具适配器 — EvoClaw ToolDefinition → KernelTool
 *
 * 将 EvoClaw 的 1 参签名工具 (execute(args) → string) 适配为
 * KernelTool 接口，集成权限检查、安全守卫、审计日志。
 *
 * 同时负责构建完整的 KernelTool 池:
 * 内置工具 (read/write/edit/grep/find/ls) + 增强 bash + EvoClaw 自定义工具
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ToolDefinition, ToolExecContext } from '../../bridge/tool-injector.js';
// SkillTool 由调用方注入（避免 agent → skill 层级违反）
import type { KernelTool, ToolCallResult } from './types.js';
import type { ToolSafetyGuard } from '../tool-safety.js';
import type { ToolHookRegistry, ToolHookContext } from './tool-hooks.js';
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

/** P2-2: 大结果持久化阈值 (参考 Claude Code BashTool: 30K) */
const LARGE_RESULT_THRESHOLD = 30_000;

/**
 * 空结果占位 — 防止模型误判 turn boundary 提前结束回复
 * 参考 Claude Code: processToolResultBlock() 空结果注入
 */
function ensureNonEmptyResult(content: string, toolName: string): string {
  if (!content || content.trim() === '') {
    return `(${toolName} completed with no output)`;
  }
  return content;
}

/**
 * P2-2: 大结果持久化 — 超过阈值的结果写入临时文件
 * 参考 Claude Code: persistedOutputPath + persistedOutputSize
 */
function maybePersistLargeResult(content: string, toolName: string, threshold: number): string {
  if (threshold === Infinity || content.length <= threshold) return content;

  try {
    const dir = path.join(os.tmpdir(), '.evoclaw-tool-results');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${toolName}-${crypto.randomUUID().slice(0, 8)}.txt`);
    fs.writeFileSync(filePath, content, 'utf-8');
    return `[结果已持久化: ${filePath} (${content.length} 字符)]\n\n${content.slice(0, 2000)}\n\n... [完整结果见上述文件]`;
  } catch {
    return content; // 持久化失败回退原内容
  }
}

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
  /** 权限决策原因（拒绝/阻断时记录） */
  reason?: string;
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
  /** 工具钩子注册表 (PreToolUse / PostToolUse) */
  hookRegistry?: ToolHookRegistry;
  /** 钩子执行上下文 */
  hookContext?: ToolHookContext;
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
  /** 额外 KernelTool（如 SkillTool、ToolSearchTool，由调用方创建注入） */
  extraTools?: KernelTool[];
  /** 工具钩子注册表 */
  hookRegistry?: ToolHookRegistry;
  /** 钩子执行上下文 */
  hookContext?: ToolHookContext;
}

// ═══════════════════════════════════════════════════════════════════════════
// Adapter
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 将 EvoClaw ToolDefinition (1参签名) 适配为 KernelTool
 *
 * 集成层:
 * 1. Schema 验证
 * 2. 安全检查 (ToolSafetyGuard.checkBeforeExecution)
 * 3. PreToolUse hooks → Hook-Rule-Permission 三方协调
 * 4. 执行原始工具
 * 5. PostToolUse hooks
 * 6. 后处理: 无进展检测 + 结果截断 + 空结果占位 + 大结果持久化
 * 7. 审计日志
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

    async call(input: Record<string, unknown>, signal?: AbortSignal, onProgress?: (p: { message: string; data?: unknown }) => void): Promise<ToolCallResult> {
      const start = Date.now();
      let effectiveInput = input;

      // 1. Schema 验证（统一校验 required + 类型）
      const { validateInput } = await import('./schema-validator.js');
      const validation = validateInput(input, tool.parameters as Record<string, unknown>);
      if (!validation.valid) {
        return { content: `参数校验失败: ${validation.errors.join('; ')}`, isError: true };
      }

      // 2. 安全检查 (循环检测)
      const check = deps.toolSafety.checkBeforeExecution(tool.name, input);
      if (check.blocked) {
        deps.auditFn?.({
          toolName: tool.name, args: input,
          result: check.reason ?? '', status: 'denied',
          durationMs: Date.now() - start,
          reason: `safety_block: ${check.reason ?? 'unknown'}`,
        });
        return { content: `⚠️ ${check.reason}`, isError: true };
      }

      // 3. PreToolUse hooks → Hook-Rule-Permission 三方协调
      const hookCtx = deps.hookContext ?? {};
      if (deps.hookRegistry) {
        const hookResult = await deps.hookRegistry.runPreHooks(tool.name, input, hookCtx);

        // blockingError 立即中断
        if (hookResult?.blockingError) {
          deps.auditFn?.({
            toolName: tool.name, args: input,
            result: hookResult.blockingError, status: 'denied',
            durationMs: Date.now() - start,
            reason: `hook_blocked: ${hookResult.blockingError}`,
          });
          return { content: hookResult.blockingError, isError: true };
        }

        // 三方协调: hook 的 allow/deny/ask + permissionFn (deny 规则)
        const permDecision = await resolveHookPermissionDecision(
          hookResult, deps.permissionFn, tool.name, input,
        );
        if (!permDecision.allowed) {
          deps.auditFn?.({
            toolName: tool.name, args: input,
            result: permDecision.reason ?? '', status: 'denied',
            durationMs: Date.now() - start,
            reason: `permission_denied: ${permDecision.reason ?? 'unknown'}`,
          });
          return { content: `[权限拒绝] ${permDecision.reason}`, isError: true };
        }
        effectiveInput = permDecision.input;
      } else if (deps.permissionFn) {
        // 无钩子时直接走权限检查
        const rejection = await deps.permissionFn(tool.name, input);
        if (rejection) {
          deps.auditFn?.({
            toolName: tool.name, args: input,
            result: rejection, status: 'denied',
            durationMs: Date.now() - start,
            reason: `permission_denied: ${rejection}`,
          });
          return { content: `[权限拒绝] ${rejection}`, isError: true };
        }
      }

      // 4. 执行 (传递 signal/onProgress 给支持上下文的工具，如 bash)
      const execCtx: ToolExecContext = { signal, onProgress };
      try {
        const rawResult = await tool.execute(effectiveInput, execCtx);
        let result: ToolCallResult = { content: rawResult };

        // 5. PostToolUse hooks
        if (deps.hookRegistry) {
          const postResult = await deps.hookRegistry.runPostHooks(tool.name, effectiveInput, result, hookCtx);
          if (postResult?.updatedOutput !== undefined && hookCtx.isMcp) {
            result = { ...result, content: postResult.updatedOutput };
          }
          if (postResult?.additionalContexts?.length) {
            result = {
              ...result,
              content: result.content + '\n\n' + postResult.additionalContexts.join('\n'),
            };
          }
        }

        // 6. 后处理: 无进展检测
        const noProgress = deps.toolSafety.recordResult(result.content);
        if (noProgress.blocked) {
          deps.auditFn?.({
            toolName: tool.name, args: effectiveInput,
            result: noProgress.reason ?? '', status: 'error',
            durationMs: Date.now() - start,
          });
          return { content: `⚠️ ${noProgress.reason}`, isError: true };
        }

        // 7. 结果截断 + 空结果占位 + 大结果持久化
        result.content = deps.toolSafety.truncateResult(result.content);
        result.content = ensureNonEmptyResult(result.content, tool.name);
        result.content = maybePersistLargeResult(result.content, tool.name, LARGE_RESULT_THRESHOLD);

        deps.auditFn?.({
          toolName: tool.name, args: effectiveInput,
          result: result.content.slice(0, 500), status: 'success',
          durationMs: Date.now() - start,
        });

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        // PostToolUseFailure hooks — 错误恢复链
        let failureContent = msg;
        if (deps.hookRegistry) {
          const failResult = await deps.hookRegistry.runFailureHooks(tool.name, effectiveInput, msg, hookCtx);
          if (failResult?.additionalContexts?.length) {
            failureContent = msg + '\n\n' + failResult.additionalContexts.join('\n');
          }
        }

        deps.auditFn?.({
          toolName: tool.name, args: effectiveInput,
          result: msg, status: 'error',
          durationMs: Date.now() - start,
        });
        return { content: failureContent, isError: true };
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
      let effectiveInput = input;
      const hookCtx = deps.hookContext ?? {};

      // 1. 安全检查 (循环检测)
      const check = deps.toolSafety.checkBeforeExecution(tool.name, input);
      if (check.blocked) {
        deps.auditFn?.({
          toolName: tool.name, args: input,
          result: check.reason ?? '', status: 'denied',
          durationMs: Date.now() - start,
          reason: `safety_block: ${check.reason ?? 'unknown'}`,
        });
        return { content: `⚠️ ${check.reason}`, isError: true };
      }

      // 2. backfillObservableInput — hooks 看扩展版，call 看原始版
      const observableInput = tool.backfillObservableInput
        ? tool.backfillObservableInput({ ...input })
        : input;

      // 3. PreToolUse hooks → Hook-Rule-Permission 三方协调
      if (deps.hookRegistry) {
        const hookResult = await deps.hookRegistry.runPreHooks(tool.name, observableInput, hookCtx);

        if (hookResult?.blockingError) {
          deps.auditFn?.({
            toolName: tool.name, args: input,
            result: hookResult.blockingError, status: 'denied',
            durationMs: Date.now() - start,
            reason: `hook_blocked: ${hookResult.blockingError}`,
          });
          return { content: hookResult.blockingError, isError: true };
        }

        const permDecision = await resolveHookPermissionDecision(
          hookResult, deps.permissionFn, tool.name, input,
        );
        if (!permDecision.allowed) {
          deps.auditFn?.({
            toolName: tool.name, args: input,
            result: permDecision.reason ?? '', status: 'denied',
            durationMs: Date.now() - start,
            reason: `permission_denied: ${permDecision.reason ?? 'unknown'}`,
          });
          return { content: `[权限拒绝] ${permDecision.reason}`, isError: true };
        }
        effectiveInput = permDecision.input;
      } else if (deps.permissionFn) {
        const rejection = await deps.permissionFn(tool.name, input);
        if (rejection) {
          deps.auditFn?.({
            toolName: tool.name, args: input,
            result: rejection, status: 'denied',
            durationMs: Date.now() - start,
            reason: `permission_denied: ${rejection}`,
          });
          return { content: `[权限拒绝] ${rejection}`, isError: true };
        }
      }

      // 4. validateInput (自定义业务验证)
      if (tool.validateInput) {
        const customValidation = await tool.validateInput(effectiveInput);
        if (!customValidation.valid) {
          return { content: customValidation.error ?? 'Input validation failed', isError: true };
        }
      }

      // 5. 执行
      const result = await originalCall(effectiveInput, signal);

      // 6. PostToolUse hooks
      if (deps.hookRegistry && !result.isError) {
        const postResult = await deps.hookRegistry.runPostHooks(tool.name, effectiveInput, result, hookCtx);
        if (postResult?.updatedOutput !== undefined && hookCtx.isMcp) {
          result.content = postResult.updatedOutput;
        }
        if (postResult?.additionalContexts?.length) {
          result.content = result.content + '\n\n' + postResult.additionalContexts.join('\n');
        }
      }

      // 7. 后处理
      if (!result.isError) {
        const noProgress = deps.toolSafety.recordResult(result.content);
        if (noProgress.blocked) {
          return { content: `⚠️ ${noProgress.reason}`, isError: true };
        }
        result.content = deps.toolSafety.truncateResult(result.content);
        result.content = ensureNonEmptyResult(result.content, tool.name);
        const threshold = tool.maxResultSizeChars ?? LARGE_RESULT_THRESHOLD;
        result.content = maybePersistLargeResult(result.content, tool.name, threshold);
      }

      deps.auditFn?.({
        toolName: tool.name, args: effectiveInput,
        result: result.content.slice(0, 500),
        status: result.isError ? 'error' : 'success',
        durationMs: Date.now() - start,
      });

      return result;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Hook-Rule-Permission 三方协调
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 三方协调: Hook 权限建议 + Rule 规则 + PermissionFn
 *
 * 核心安全不变式: Hook 的 allow ≠ 绕过规则
 * - Hook allow 跳过交互提示，但 deny/ask 规则仍然适用
 * - Hook deny 直接拒绝
 * - Hook ask 或无 hook → 走正常权限流程
 *
 * 参考 Claude Code: resolveHookPermissionDecision()
 */
async function resolveHookPermissionDecision(
  hookResult: import('./tool-hooks.js').PreToolUseHookResult | null,
  permissionFn: ((toolName: string, args: Record<string, unknown>) => Promise<string | null>) | undefined,
  toolName: string,
  input: Record<string, unknown>,
): Promise<{ allowed: boolean; input: Record<string, unknown>; reason?: string }> {
  const effectiveInput = hookResult?.updatedInput ?? input;

  // Hook deny → 直接拒绝
  if (hookResult?.permissionBehavior === 'deny') {
    return { allowed: false, input: effectiveInput, reason: 'Denied by pre-tool hook' };
  }

  // Hook allow → 仍需检查 permissionFn (deny 规则优先于 hook allow)
  if (hookResult?.permissionBehavior === 'allow') {
    if (permissionFn) {
      const denied = await permissionFn(toolName, effectiveInput);
      if (denied) return { allowed: false, input: effectiveInput, reason: denied };
    }
    return { allowed: true, input: effectiveInput };
  }

  // hookResult === null 或 permissionBehavior === 'ask' → 走正常权限流程
  if (permissionFn) {
    const denied = await permissionFn(toolName, effectiveInput);
    if (denied) return { allowed: false, input: effectiveInput, reason: denied };
  }
  return { allowed: true, input: effectiveInput };
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
    hookRegistry: config.hookRegistry,
    hookContext: config.hookContext,
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

  // 4. 额外工具（SkillTool、ToolSearchTool 等，由调用方注入）
  const extraTools = config.extraTools ?? [];

  // 分区: 内置工具 vs 外部工具 (EvoClaw 自定义 + MCP + extra)
  const builtinPool = [...builtinTools, bashTool];
  const externalPool = [...customTools, ...extraTools];

  // 去重 (内置优先, 同名时内置工具覆盖外部工具 — 参考 Claude Code uniqBy 首次出现)
  const seen = new Set<string>();
  const dedup = (tools: KernelTool[]) => {
    const result: KernelTool[] = [];
    for (const tool of tools) {
      if (!seen.has(tool.name)) {
        seen.add(tool.name);
        result.push(tool);
      }
      // 注册别名（旧名称指向同一工具）
      if (tool.aliases) {
        for (const alias of tool.aliases) {
          if (!seen.has(alias)) {
            seen.add(alias);
          }
        }
      }
    }
    return result;
  };
  const dedupBuiltin = dedup(builtinPool);
  const dedupExternal = dedup(externalPool);

  // 分区排序: 内置在前 + 外部在后，各自按 name 排序
  // 增减外部/MCP 工具不影响内置工具的相对顺序，最大化 prompt cache 命中
  const byName = (a: KernelTool, b: KernelTool) => a.name.localeCompare(b.name);
  return [...dedupBuiltin.sort(byName), ...dedupExternal.sort(byName)];
}
