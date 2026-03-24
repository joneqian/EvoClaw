/**
 * 工具调用 Hook -- 允许在工具执行前后拦截/修改
 */

import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('tool-hooks');

export type BeforeToolCallHook = (toolName: string, args: Record<string, unknown>) =>
  Promise<{ modified?: Record<string, unknown>; denied?: string } | null>;

export type AfterToolCallHook = (toolName: string, args: Record<string, unknown>, result: string) =>
  Promise<string | null>; // null = 不修改, string = 替换结果

/** Hook 注册表 */
const beforeHooks: BeforeToolCallHook[] = [];
const afterHooks: AfterToolCallHook[] = [];

/** 注册 before hook */
export function registerBeforeToolCall(hook: BeforeToolCallHook): void {
  beforeHooks.push(hook);
}

/** 注册 after hook */
export function registerAfterToolCall(hook: AfterToolCallHook): void {
  afterHooks.push(hook);
}

/** 执行 before hooks */
export async function runBeforeHooks(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ args: Record<string, unknown>; denied?: string }> {
  let currentArgs = { ...args };

  for (const hook of beforeHooks) {
    try {
      const result = await hook(toolName, currentArgs);
      if (result?.denied) {
        return { args: currentArgs, denied: result.denied };
      }
      if (result?.modified) {
        currentArgs = result.modified;
      }
    } catch (err) {
      log.warn(`beforeToolCall hook 错误: ${err}`);
    }
  }

  return { args: currentArgs };
}

/** 执行 after hooks */
export async function runAfterHooks(
  toolName: string,
  args: Record<string, unknown>,
  result: string,
): Promise<string> {
  let currentResult = result;

  for (const hook of afterHooks) {
    try {
      const modified = await hook(toolName, args, currentResult);
      if (modified !== null) {
        currentResult = modified;
      }
    } catch (err) {
      log.warn(`afterToolCall hook 错误: ${err}`);
    }
  }

  return currentResult;
}

/** 清除所有 hooks（测试用） */
export function clearHooks(): void {
  beforeHooks.length = 0;
  afterHooks.length = 0;
}
