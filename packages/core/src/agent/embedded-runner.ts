/**
 * 嵌入式 Agent 入口 — 双层架构（loop + attempt）
 *
 * 架构：
 *   embedded-runner.ts (入口)
 *   └─ embedded-runner-loop.ts (外层重试循环 + Provider Failover)
 *      └─ embedded-runner-attempt.ts (单次 PI session.prompt())
 *
 * 辅助模块：
 *   - embedded-runner-errors.ts — 错误分类器
 *   - embedded-runner-timeout.ts — Compaction 感知超时 + abortable()
 *   - embedded-runner-tools.ts — 工具构建/包装
 *   - embedded-runner-prompt.ts — 系统提示构建
 */

import type { AgentRunConfig, RuntimeEvent } from './types.js';
import { runEmbeddedLoop } from './embedded-runner-loop.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('embedded-runner');

type EventCallback = (event: RuntimeEvent) => void;

function emit(cb: EventCallback, event: Omit<RuntimeEvent, 'timestamp'>): void {
  cb({ ...event, timestamp: Date.now() } as RuntimeEvent);
}

/**
 * 运行嵌入式 Agent — 公共入口
 *
 * 委托给 runEmbeddedLoop() 处理所有重试/failover/恢复逻辑。
 */
export async function runEmbeddedAgent(
  config: AgentRunConfig,
  message: string,
  onEvent: EventCallback,
  externalAbortSignal?: AbortSignal,
): Promise<void> {
  emit(onEvent, { type: 'agent_start' });

  try {
    log.info(`开始运行 Agent: provider=${config.provider}/${config.modelId}`);
    await runEmbeddedLoop(config, message, onEvent, externalAbortSignal);
    log.info('Agent 运行完成');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Agent 运行异常: ${msg}`);
    emit(onEvent, { type: 'error', error: msg });
  }

  emit(onEvent, { type: 'agent_done' });
}

// ─── Re-exports ───
// 保持向后兼容，外部消费者（测试/路由/子模块）可以从此处导入

export { NO_REPLY_TOKEN, buildSystemPrompt } from './embedded-runner-prompt.js';
export { classifyError, isAbortError, isNonRetryableError } from './embedded-runner-errors.js';
export type { ClassifiedError, ErrorType } from './embedded-runner-errors.js';
export { createSmartTimeout, abortable } from './embedded-runner-timeout.js';
export type { SmartTimeoutHandle } from './embedded-runner-timeout.js';

// 旧版辅助函数 — 向后兼容导出（实际逻辑已迁移到 errors.ts / loop.ts）
// 这些函数被 error-recovery.test.ts 直接引用

import { classifyError as _classifyError } from './embedded-runner-errors.js';

/** @deprecated 使用 classifyError() 替代 */
export function isOverloadError(err: unknown): boolean {
  return _classifyError(err).type === 'overload';
}

/** @deprecated 使用 classifyError() 替代 */
export function isThinkingError(err: unknown): boolean {
  return _classifyError(err).type === 'thinking';
}

/** @deprecated 使用 classifyError() 替代 */
export function isContextOverflowError(err: unknown): boolean {
  return _classifyError(err).type === 'overflow';
}

/** @deprecated 使用 embedded-runner-loop.ts 中的 calculateBackoff 替代 */
export function calculateBackoff(attempt: number, opts?: {
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: number;
}): number {
  const { initialDelayMs = 250, maxDelayMs = 5000, factor = 2, jitter = 0.2 } = opts ?? {};
  const base = Math.min(initialDelayMs * Math.pow(factor, attempt), maxDelayMs);
  const jitterRange = base * jitter;
  return base + (Math.random() * 2 - 1) * jitterRange;
}
