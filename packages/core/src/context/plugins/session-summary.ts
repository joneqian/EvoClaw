/**
 * 会话摘要插件 — afterTurn 周期性生成会话摘要，beforeTurn 恢复注入
 *
 * 触发阈值：
 * - 首次：累计 10K tokens
 * - 后续：每增加 5K tokens 或每 3 次工具调用
 */

import type { ContextPlugin, TurnContext } from '../plugin.interface.js';
import type { SessionSummarizer } from '../../memory/session-summarizer.js';
import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('session-summary');

const INIT_THRESHOLD = 10_000;
const UPDATE_THRESHOLD = 5_000;
const TOOL_CALL_THRESHOLD = 3;

/** 创建会话摘要插件 */
export function createSessionSummaryPlugin(summarizer: SessionSummarizer): ContextPlugin {
  // 闭包状态 — 每个插件实例跟踪一个会话
  let cumulativeTokens = 0;
  let cumulativeToolCalls = 0;
  let lastSummaryAtTokens = 0;
  let lastSummaryAtToolCalls = 0;
  let hasSummarized = false;

  return {
    name: 'session-summary',
    priority: 91, // 在 memory-extract (90) 之后

    async beforeTurn(ctx: TurnContext) {
      // 首轮时检查是否有已保存的摘要（用于会话恢复）
      if (cumulativeTokens === 0) {
        const existing = summarizer.getExisting(ctx.agentId, ctx.sessionKey);
        if (existing) {
          ctx.injectedContext.push(`## 上次会话摘要\n${existing}`);
          log.info(`已注入上次会话摘要: agent=${ctx.agentId}`);
        }
      }
    },

    async afterTurn(ctx: TurnContext) {
      // 累加 token 估算（简单按字符数 / 4）
      const turnTokens = ctx.messages.reduce((sum, m) => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return sum + Math.ceil(content.length / 4);
      }, 0);
      cumulativeTokens += turnTokens;

      // 累加工具调用数
      const turnToolCalls = ctx.messages.reduce((sum, m) => {
        if (m.role !== 'assistant') return sum;
        if (Array.isArray(m.content)) {
          return sum + (m.content as Array<{ type?: string }>).filter(b => b.type === 'tool_use').length;
        }
        return sum;
      }, 0);
      cumulativeToolCalls += turnToolCalls;

      // 检查是否达到触发阈值
      const tokensSinceLast = cumulativeTokens - lastSummaryAtTokens;
      const toolCallsSinceLast = cumulativeToolCalls - lastSummaryAtToolCalls;

      let shouldSummarize = false;
      if (!hasSummarized && cumulativeTokens >= INIT_THRESHOLD) {
        shouldSummarize = true;
      } else if (hasSummarized && tokensSinceLast >= UPDATE_THRESHOLD) {
        shouldSummarize = true;
      } else if (hasSummarized && toolCallsSinceLast >= TOOL_CALL_THRESHOLD) {
        shouldSummarize = true;
      }

      if (!shouldSummarize) return;

      log.info(`触发会话摘要: tokens=${cumulativeTokens}, toolCalls=${cumulativeToolCalls}, since_last_tokens=${tokensSinceLast}`);

      // 异步执行摘要（不阻塞）
      const existingSummary = summarizer.getExisting(ctx.agentId, ctx.sessionKey) ?? undefined;
      summarizer.summarize(ctx.agentId, ctx.sessionKey, ctx.messages, existingSummary).catch(err => {
        log.error(`会话摘要生成失败: ${err instanceof Error ? err.message : String(err)}`);
      });

      // 更新状态
      lastSummaryAtTokens = cumulativeTokens;
      lastSummaryAtToolCalls = cumulativeToolCalls;
      hasSummarized = true;
    },
  };
}
