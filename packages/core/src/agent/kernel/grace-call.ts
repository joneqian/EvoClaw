/**
 * Grace Call — 预算耗尽时生成收尾摘要
 *
 * 主循环在 maxTurns / token_budget_exhausted / max_tokens_exhausted 三处退出时
 * `fullResponse` 可能为空字符串，用户视角 Agent "静默消失"。对标 Claude Code /
 * hermes 的 grace call 机制：允许一次额外 LLM 调用生成中文收尾摘要（≤300 字），
 * 拼接到 fullResponse 末尾，用统一的 `\n\n---\n**本次任务总结:**\n…` 标记便于
 * 前端识别。
 *
 * 设计要点：
 * - 不扣预算：不计入 `state.turnCount`，不触发 tokenBudget 回调
 * - 不工具化：传空 tools，禁用 thinking，maxTokens 默认 512
 * - 容错：任意异常/中止/error event 吞错返回空字符串，不影响原 exitReason
 * - 可关：`config.graceCall?.enabled === false` 直接跳过；Heartbeat/Cron/BOOT
 *   调用方显式关闭，避免无人值守会话浪费 token
 */

import crypto from 'node:crypto';
import { streamLLM } from './stream-client.js';
import type {
  QueryLoopConfig,
  LoopState,
  ExitReason,
  StreamConfig,
  KernelMessage,
} from './types.js';
import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('grace-call');

/** 摘要前缀标记（前端据此识别） */
export const GRACE_CALL_SUMMARY_MARKER = '\n\n---\n**本次任务总结:**\n';

/** 默认输出 token 上限 */
const DEFAULT_MAX_TOKENS = 512;

/** Grace call 触发时的退出原因白名单 */
const ELIGIBLE_EXIT_REASONS = new Set<ExitReason>([
  'max_turns',
  'max_tokens_exhausted',
  'token_budget_exhausted',
]);

/** 中文原因描述（注入 meta message） */
const EXIT_REASON_TEXT: Record<string, string> = {
  max_turns: '已达到最大工具调用轮次上限',
  max_tokens_exhausted: '单轮输出 token 已用完且多次恢复失败',
  token_budget_exhausted: '会话总 Token 预算已耗尽',
};

/**
 * 构造 grace call 的 meta user message。
 *
 * 导出为纯函数便于测试。
 */
export function buildGraceCallMessage(exitReason: ExitReason): KernelMessage {
  const reasonText = EXIT_REASON_TEXT[exitReason] ?? '预算已耗尽';
  const instruction =
    `[系统提示：${reasonText}，无法继续执行。]\n\n` +
    `请基于目前已经完成的工作，用中文生成一段简短的收尾总结（**不超过 300 字**）：\n` +
    `1. 用户最初的请求是什么\n` +
    `2. 你已经完成了哪些步骤 / 取得哪些中间结果\n` +
    `3. 还有哪些子任务未完成\n` +
    `4. 建议的下一步行动（例如：拆分任务重发、提高预算、人工介入）\n\n` +
    `不要继续调用任何工具，只输出总结文本。`;
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: instruction }],
    isMeta: true,
  };
}

/**
 * 从 QueryLoopConfig + state 构造 grace call 的 StreamConfig。
 *
 * 导出为纯函数便于测试。
 */
export function buildGraceCallStreamConfig(
  config: QueryLoopConfig,
  state: LoopState,
  exitReason: ExitReason,
  maxTokens: number = DEFAULT_MAX_TOKENS,
): StreamConfig {
  const metaMessage = buildGraceCallMessage(exitReason);
  return {
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    modelId: state.effectiveModelId,
    systemPrompt: config.systemPrompt,
    messages: [...state.messages, metaMessage],
    tools: [],                          // 不允许调工具
    maxTokens,
    thinkingConfig: { type: 'disabled' }, // 省 token
    signal: config.abortSignal,
  };
}

/**
 * 在预算耗尽时尝试生成收尾摘要。
 *
 * @returns 摘要字符串（含前缀标记）或空字符串（未触发 / 已禁用 / 异常）
 */
export async function maybeGraceCall(
  config: QueryLoopConfig,
  state: LoopState,
  exitReason: ExitReason,
): Promise<string> {
  // 不在白名单退出原因里 → 跳过
  if (!ELIGIBLE_EXIT_REASONS.has(exitReason)) return '';

  // 显式禁用 → 跳过（默认启用）
  if (config.graceCall?.enabled === false) {
    log.debug(`grace call 已禁用 (exitReason=${exitReason})`);
    return '';
  }

  // 已被外部中止 → 跳过
  if (config.abortSignal?.aborted) {
    log.debug(`grace call 跳过：abortSignal 已触发`);
    return '';
  }

  const maxTokens = config.graceCall?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const streamConfig = buildGraceCallStreamConfig(config, state, exitReason, maxTokens);

  log.info(`grace call 触发: exitReason=${exitReason}, maxTokens=${maxTokens}`);

  let summary = '';
  try {
    for await (const event of streamLLM(streamConfig)) {
      if (event.type === 'text_delta') {
        summary += event.delta;
      } else if (event.type === 'error') {
        log.warn(`grace call 收到 error 事件: ${event.message}`);
        return '';
      }
      // 其他事件（usage/done/latency/metrics/thinking_*）忽略；工具事件不应出现（tools 为空）
    }
  } catch (err) {
    log.warn(`grace call 异常: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }

  const trimmed = summary.trim();
  if (!trimmed) {
    log.warn('grace call 返回空摘要，跳过拼接');
    return '';
  }

  // 如果 abort 在流中发生，stream 可能已中断但 summary 有部分内容 — 不拼接（保守）
  if (config.abortSignal?.aborted) {
    log.debug('grace call 流结束时 abortSignal 已触发，丢弃部分摘要');
    return '';
  }

  log.info(`grace call 成功: 摘要长度 ${trimmed.length} 字符`);
  return GRACE_CALL_SUMMARY_MARKER + trimmed;
}
