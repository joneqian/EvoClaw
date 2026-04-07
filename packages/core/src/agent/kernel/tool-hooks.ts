/**
 * 工具钩子生命周期 — PreToolUse / PostToolUse / PostToolUseFailure
 *
 * 参考 Claude Code: src/services/tools/toolHooks.ts
 *
 * 核心设计:
 * - PreToolUse: Zod 验证 + validateInput 之后、权限决策之前
 *   可以: allow/deny/ask、修改输入、阻断执行、阻止继续、注入上下文
 * - PostToolUse: tool.call() 之后、结果处理之前
 *   可以: 注入上下文、阻止继续、修改 MCP 工具输出
 * - PostToolUseFailure: tool.call() 抛出异常后
 *   可以: 注入上下文、阻止继续
 *
 * 安全不变式:
 * - Hook 的 allow ≠ 绕过规则 (由 resolveHookPermissionDecision 保证)
 * - 权限聚合: deny > ask > allow (最严格者胜出)
 * - 所有 Hook 执行受超时保护，默认 30s
 */

import type { ToolCallResult } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════════════════

/** 单个 Hook 执行的默认超时 (毫秒) */
const DEFAULT_HOOK_TIMEOUT_MS = 30_000;

// ═══════════════════════════════════════════════════════════════════════════
// Hook Context
// ═══════════════════════════════════════════════════════════════════════════

/** 工具钩子执行上下文 */
export interface ToolHookContext {
  /** Agent ID */
  readonly agentId?: string;
  /** 会话 ID */
  readonly sessionId?: string;
  /** 是否 MCP 工具 (PostToolUse 中 MCP 工具允许修改输出) */
  readonly isMcp?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Hook 策略 (企业管控)
// ═══════════════════════════════════════════════════════════════════════════

/** Hook 策略配置 — 由 managed.json 控制 */
export interface HookPolicy {
  /** 禁用所有非系统 Hook */
  readonly disableAllHooks?: boolean;
  /** 仅允许管理员配置的 Hook (managed.json 中定义的) */
  readonly allowManagedHooksOnly?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// PreToolUse Hook
// ═══════════════════════════════════════════════════════════════════════════

/**
 * PreToolUse 钩子结果
 *
 * 参考 Claude Code 6 种结果类型:
 * permissionBehavior (allow/deny/ask) + updatedInput + blockingError + preventContinuation + additionalContexts
 */
export interface PreToolUseHookResult {
  /** 权限建议 (注意: allow 不绕过 deny/ask 规则) */
  permissionBehavior?: 'allow' | 'deny' | 'ask';
  /** 修改后的工具输入 (可与 permission 决策配合) */
  updatedInput?: Record<string, unknown>;
  /** 阻断错误 — 阻止执行并返回错误给 LLM */
  blockingError?: string;
  /** 阻止 LLM 继续生成 (执行完后不再 loop) */
  preventContinuation?: boolean;
  /** 注入额外上下文给 LLM */
  additionalContexts?: readonly string[];
}

/** PreToolUse 钩子函数签名 */
export type PreToolUseHook = (
  toolName: string,
  input: Record<string, unknown>,
  context: ToolHookContext,
) => Promise<PreToolUseHookResult | null>;

// ═══════════════════════════════════════════════════════════════════════════
// PostToolUse Hook
// ═══════════════════════════════════════════════════════════════════════════

/** PostToolUse 钩子结果 */
export interface PostToolUseHookResult {
  /** 注入额外上下文给 LLM */
  additionalContexts?: readonly string[];
  /** 阻止 LLM 继续生成 */
  preventContinuation?: boolean;
  /** 修改 MCP 工具输出 (仅当 context.isMcp = true 时生效) */
  updatedOutput?: string;
}

/** PostToolUse 钩子函数签名 */
export type PostToolUseHook = (
  toolName: string,
  input: Record<string, unknown>,
  result: ToolCallResult,
  context: ToolHookContext,
) => Promise<PostToolUseHookResult | null>;

// ═══════════════════════════════════════════════════════════════════════════
// PostToolUseFailure Hook
// ═══════════════════════════════════════════════════════════════════════════

/** PostToolUseFailure 钩子结果 */
export interface PostToolUseFailureHookResult {
  /** 注入额外上下文给 LLM (错误修复建议等) */
  additionalContexts?: readonly string[];
  /** 阻止 LLM 继续生成 */
  preventContinuation?: boolean;
}

/** PostToolUseFailure 钩子函数签名 */
export type PostToolUseFailureHook = (
  toolName: string,
  input: Record<string, unknown>,
  error: string,
  context: ToolHookContext,
) => Promise<PostToolUseFailureHookResult | null>;

// ═══════════════════════════════════════════════════════════════════════════
// 权限优先级: deny > ask > allow (最严格者胜出)
// ═══════════════════════════════════════════════════════════════════════════

const PERMISSION_PRIORITY: Record<string, number> = { deny: 3, ask: 2, allow: 1 };

/**
 * 返回两个权限行为中更严格的一个
 *
 * 安全不变式: deny > ask > allow
 * 确保单个 Hook 无法通过 allow 绕过其他 Hook 的 deny/ask 约束
 */
export function stricterPermission(
  a: 'allow' | 'deny' | 'ask' | undefined,
  b: 'allow' | 'deny' | 'ask' | undefined,
): 'allow' | 'deny' | 'ask' | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return (PERMISSION_PRIORITY[b] ?? 0) > (PERMISSION_PRIORITY[a] ?? 0) ? b : a;
}

// ═══════════════════════════════════════════════════════════════════════════
// 超时执行器
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 带超时的 Hook 执行包装器
 *
 * 超时后返回 null (等同于 Hook 无返回)，并在 stderr 记录警告。
 * 使用 AbortSignal.timeout() 实现，支持外部取消。
 */
async function executeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  hookLabel: string,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error(`Hook "${hookLabel}" 超时 (${timeoutMs}ms)`));
        });
      }),
    ]);
    return result;
  } catch (err) {
    if (controller.signal.aborted) {
      // 超时 → 静默返回 null，不阻断管线
      console.warn(`[ToolHookRegistry] ${err instanceof Error ? err.message : err}`);
      return null;
    }
    // 非超时错误 → 同样静默，防止 Hook bug 阻断工具执行
    console.warn(`[ToolHookRegistry] Hook "${hookLabel}" 执行异常: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ToolHookRegistry
// ═══════════════════════════════════════════════════════════════════════════

/** Hook 注册项 — 包含 Hook 函数和可选元数据 */
interface HookEntry<T> {
  readonly hook: T;
  /** 来源标识 (如 skill 名称)，用于日志和管控 */
  readonly source?: string;
  /** 是否为管理员 (managed) 来源的 Hook */
  readonly managed?: boolean;
  /** 单个 Hook 超时覆盖 (毫秒) */
  readonly timeoutMs?: number;
}

/**
 * 工具钩子注册表
 *
 * 管理 PreToolUse / PostToolUse / PostToolUseFailure 钩子的注册和执行。
 * 合并策略:
 * - permissionBehavior: 最严格者胜出 (deny > ask > allow)
 * - updatedInput/updatedOutput: 最后一个非 undefined 值生效（链式修改）
 * - blockingError: 第一个非 undefined 值立即中断
 * - preventContinuation: 任一 true 则 true
 * - additionalContexts: 合并所有
 */
export class ToolHookRegistry {
  private readonly preHooks: HookEntry<PreToolUseHook>[] = [];
  private readonly postHooks: HookEntry<PostToolUseHook>[] = [];
  private readonly failureHooks: HookEntry<PostToolUseFailureHook>[] = [];

  /** Hook 策略 (由 managed.json 控制) */
  private policy: HookPolicy = {};

  /** 默认超时 (毫秒) */
  private readonly defaultTimeoutMs: number;

  constructor(options?: { defaultTimeoutMs?: number; policy?: HookPolicy }) {
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
    if (options?.policy) this.policy = options.policy;
  }

  /** 更新 Hook 策略 (运行时) */
  updatePolicy(policy: HookPolicy): void {
    this.policy = { ...policy };
  }

  /** 注册 PreToolUse 钩子 */
  registerPre(hook: PreToolUseHook, meta?: Omit<HookEntry<PreToolUseHook>, 'hook'>): void {
    this.preHooks.push({ hook, ...meta });
  }

  /** 注册 PostToolUse 钩子 */
  registerPost(hook: PostToolUseHook, meta?: Omit<HookEntry<PostToolUseHook>, 'hook'>): void {
    this.postHooks.push({ hook, ...meta });
  }

  /** 注册 PostToolUseFailure 钩子 */
  registerFailure(hook: PostToolUseFailureHook, meta?: Omit<HookEntry<PostToolUseFailureHook>, 'hook'>): void {
    this.failureHooks.push({ hook, ...meta });
  }

  /** 当前注册的 pre hook 数量 */
  get preHookCount(): number {
    return this.preHooks.length;
  }

  /** 当前注册的 post hook 数量 */
  get postHookCount(): number {
    return this.postHooks.length;
  }

  /** 当前注册的 failure hook 数量 */
  get failureHookCount(): number {
    return this.failureHooks.length;
  }

  /**
   * 按策略过滤 Hook 列表
   */
  private filterByPolicy<T>(hooks: readonly HookEntry<T>[]): readonly HookEntry<T>[] {
    if (this.policy.disableAllHooks) return [];
    if (this.policy.allowManagedHooksOnly) return hooks.filter(h => h.managed);
    return hooks;
  }

  /**
   * 执行所有 PreToolUse 钩子
   *
   * 合并策略:
   * - permissionBehavior: 最严格者胜出 (deny > ask > allow)
   * - updatedInput: 最后一个非 undefined 值生效（链式修改）
   * - blockingError: 第一个非 undefined 值立即中断
   * - preventContinuation: 任一 true 则 true
   * - additionalContexts: 合并所有
   */
  async runPreHooks(
    toolName: string,
    input: Record<string, unknown>,
    context: ToolHookContext,
  ): Promise<PreToolUseHookResult | null> {
    const hooks = this.filterByPolicy(this.preHooks);
    if (hooks.length === 0) return null;

    let merged: PreToolUseHookResult | null = null;

    for (const entry of hooks) {
      const timeoutMs = entry.timeoutMs ?? this.defaultTimeoutMs;
      const label = entry.source ? `PreToolUse[${entry.source}]` : `PreToolUse[${toolName}]`;

      const result = await executeWithTimeout(
        () => entry.hook(toolName, input, context),
        timeoutMs,
        label,
      );
      if (result === null) continue;

      if (merged === null) {
        merged = { ...result };
      } else {
        // permissionBehavior: 最严格者胜出 (deny > ask > allow)
        if (result.permissionBehavior !== undefined) {
          merged.permissionBehavior = stricterPermission(merged.permissionBehavior, result.permissionBehavior);
        }
        if (result.updatedInput !== undefined) {
          merged.updatedInput = result.updatedInput;
        }
        if (result.preventContinuation) {
          merged.preventContinuation = true;
        }
        if (result.additionalContexts?.length) {
          merged.additionalContexts = [
            ...(merged.additionalContexts ?? []),
            ...result.additionalContexts,
          ];
        }
      }

      // blockingError 立即中断
      if (result.blockingError) {
        merged.blockingError = result.blockingError;
        break;
      }
    }

    return merged;
  }

  /**
   * 执行所有 PostToolUse 钩子
   *
   * 合并策略:
   * - updatedOutput: 最后一个生效
   * - preventContinuation: 任一 true 则 true
   * - additionalContexts: 合并所有
   */
  async runPostHooks(
    toolName: string,
    input: Record<string, unknown>,
    result: ToolCallResult,
    context: ToolHookContext,
  ): Promise<PostToolUseHookResult | null> {
    const hooks = this.filterByPolicy(this.postHooks);
    if (hooks.length === 0) return null;

    let merged: PostToolUseHookResult | null = null;

    for (const entry of hooks) {
      const timeoutMs = entry.timeoutMs ?? this.defaultTimeoutMs;
      const label = entry.source ? `PostToolUse[${entry.source}]` : `PostToolUse[${toolName}]`;

      const hookResult = await executeWithTimeout(
        () => entry.hook(toolName, input, result, context),
        timeoutMs,
        label,
      );
      if (hookResult === null) continue;

      if (merged === null) {
        merged = { ...hookResult };
      } else {
        if (hookResult.updatedOutput !== undefined) {
          merged.updatedOutput = hookResult.updatedOutput;
        }
        if (hookResult.preventContinuation) {
          merged.preventContinuation = true;
        }
        if (hookResult.additionalContexts?.length) {
          merged.additionalContexts = [
            ...(merged.additionalContexts ?? []),
            ...hookResult.additionalContexts,
          ];
        }
      }
    }

    return merged;
  }

  /**
   * 执行所有 PostToolUseFailure 钩子
   *
   * 工具执行失败后触发，用于错误恢复链。
   * 合并策略:
   * - preventContinuation: 任一 true 则 true
   * - additionalContexts: 合并所有
   */
  async runFailureHooks(
    toolName: string,
    input: Record<string, unknown>,
    error: string,
    context: ToolHookContext,
  ): Promise<PostToolUseFailureHookResult | null> {
    const hooks = this.filterByPolicy(this.failureHooks);
    if (hooks.length === 0) return null;

    let merged: PostToolUseFailureHookResult | null = null;

    for (const entry of hooks) {
      const timeoutMs = entry.timeoutMs ?? this.defaultTimeoutMs;
      const label = entry.source ? `PostToolUseFailure[${entry.source}]` : `PostToolUseFailure[${toolName}]`;

      const hookResult = await executeWithTimeout(
        () => entry.hook(toolName, input, error, context),
        timeoutMs,
        label,
      );
      if (hookResult === null) continue;

      if (merged === null) {
        merged = { ...hookResult };
      } else {
        if (hookResult.preventContinuation) {
          merged.preventContinuation = true;
        }
        if (hookResult.additionalContexts?.length) {
          merged.additionalContexts = [
            ...(merged.additionalContexts ?? []),
            ...hookResult.additionalContexts,
          ];
        }
      }
    }

    return merged;
  }
}
