/**
 * 工具钩子生命周期 — PreToolUse / PostToolUse
 *
 * 参考 Claude Code: src/services/tools/toolHooks.ts
 *
 * 核心设计:
 * - PreToolUse: Zod 验证 + validateInput 之后、权限决策之前
 *   可以: allow/deny/ask、修改输入、阻断执行、阻止继续、注入上下文
 * - PostToolUse: tool.call() 之后、结果处理之前
 *   可以: 注入上下文、阻止继续、修改 MCP 工具输出
 *
 * 安全不变式: Hook 的 allow ≠ 绕过规则 (由 resolveHookPermissionDecision 保证)
 */

import type { ToolCallResult } from './types.js';

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
// ToolHookRegistry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 工具钩子注册表
 *
 * 管理 PreToolUse / PostToolUse 钩子的注册和执行。
 * 钩子按注册顺序执行，第一个返回非 null 结果的钩子生效（short-circuit）。
 * 对于累积型字段 (additionalContexts)，所有钩子的结果会合并。
 */
export class ToolHookRegistry {
  private readonly preHooks: PreToolUseHook[] = [];
  private readonly postHooks: PostToolUseHook[] = [];

  /** 注册 PreToolUse 钩子 */
  registerPre(hook: PreToolUseHook): void {
    this.preHooks.push(hook);
  }

  /** 注册 PostToolUse 钩子 */
  registerPost(hook: PostToolUseHook): void {
    this.postHooks.push(hook);
  }

  /** 当前注册的 pre hook 数量 */
  get preHookCount(): number {
    return this.preHooks.length;
  }

  /** 当前注册的 post hook 数量 */
  get postHookCount(): number {
    return this.postHooks.length;
  }

  /**
   * 执行所有 PreToolUse 钩子
   *
   * 合并策略:
   * - permissionBehavior: 第一个非 undefined 值生效
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
    if (this.preHooks.length === 0) return null;

    let merged: PreToolUseHookResult | null = null;

    for (const hook of this.preHooks) {
      const result = await hook(toolName, input, context);
      if (result === null) continue;

      if (merged === null) {
        merged = { ...result };
      } else {
        // 累积合并
        if (result.permissionBehavior !== undefined && merged.permissionBehavior === undefined) {
          merged.permissionBehavior = result.permissionBehavior;
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
   * 合并策略与 runPreHooks 类似:
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
    if (this.postHooks.length === 0) return null;

    let merged: PostToolUseHookResult | null = null;

    for (const hook of this.postHooks) {
      const hookResult = await hook(toolName, input, result, context);
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
}
