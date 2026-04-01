/**
 * 三层上下文压缩 — 参考 Claude Code 压缩策略
 *
 * Layer 1: Snip (零成本) — 移除最旧的非关键消息
 * Layer 2: Microcompact (零成本) — 截断过大的 tool_result
 * Layer 3: Autocompact (1 次 LLM 调用) — 结构化摘要替换历史
 *
 * 参考 Claude Code:
 * - services/compact/autoCompact.ts: 阈值计算 + 熔断器
 * - services/compact/microCompact.ts: tool result 清理
 * - services/compact/prompt.ts: 9 段摘要模板
 * - services/compact/compact.ts: 完整压缩管道
 *
 * 参考文档: docs/research/16-context-management.md
 */

import crypto from 'node:crypto';
import type { KernelMessage, QueryLoopConfig } from './types.js';
import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('context-compactor');

// ═══════════════════════════════════════════════════════════════════════════
// Constants — 参考 Claude Code autoCompact.ts
// ═══════════════════════════════════════════════════════════════════════════

/**
 * P2-3: Token 阈值分级 (参考 Claude Code autoCompact.ts)
 *
 * warning:     90% — UI 警告
 * autoCompact: 93% — 触发自动压缩
 * hardLimit:   99% — 阻断输入
 */
const TOKEN_THRESHOLDS = {
  warning: 0.90,
  autoCompact: 0.93,
  hardLimit: 0.99,
};

/** Autocompact 缓冲 tokens (参考 Claude Code: 13_000) */
const AUTOCOMPACT_BUFFER_TOKENS = 13_000;

/** 最大连续 autocompact 失败次数 (熔断器) */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Snip 保留最后 N 条消息 */
const SNIP_KEEP_RECENT = 8;

/** Microcompact: tool_result 截断阈值 (5KB) */
const MICROCOMPACT_TRUNCATE_THRESHOLD = 5_000;

/** Microcompact: 截断后的头尾比例 */
const HEAD_RATIO = 0.7;

/** 粗略 token 估算: 每 token 平均字符数 */
const CHARS_PER_TOKEN = 4;

// ═══════════════════════════════════════════════════════════════════════════
// Token Estimation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 估算消息列表的 token 数
 *
 * 优先使用累积的 usage 字段 (真实值)，
 * 回退到 chars / 4 近似
 */
export function estimateTokens(messages: readonly KernelMessage[]): number {
  // 尝试从 usage 累积
  let totalFromUsage = 0;
  let hasUsage = false;
  for (const msg of messages) {
    if (msg.usage) {
      totalFromUsage += (msg.usage.inputTokens ?? 0) + (msg.usage.outputTokens ?? 0);
      hasUsage = true;
    }
  }
  if (hasUsage && totalFromUsage > 0) {
    return totalFromUsage;
  }

  // 回退: chars / 4
  let totalChars = 0;
  for (const msg of messages) {
    for (const block of msg.content) {
      switch (block.type) {
        case 'text': totalChars += block.text.length; break;
        case 'tool_use': totalChars += JSON.stringify(block.input).length + block.name.length; break;
        case 'tool_result': totalChars += block.content.length; break;
        case 'thinking': totalChars += block.thinking.length; break;
        case 'image': totalChars += 1000; break; // 图片固定估算
      }
    }
  }
  return Math.ceil(totalChars / CHARS_PER_TOKEN);
}

// ═══════════════════════════════════════════════════════════════════════════
// Layer 1: Snip (零成本)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 移除最旧的非关键消息
 *
 * 保留:
 * - 第 1 条 user 消息 (初始上下文)
 * - 最后 SNIP_KEEP_RECENT 条消息
 *
 * @returns 移除的消息数
 */
export function snipOldMessages(messages: KernelMessage[]): number {
  if (messages.length <= SNIP_KEEP_RECENT + 1) {
    return 0;
  }

  const keepFirst = messages[0]; // 初始上下文
  const keepRecent = messages.slice(-SNIP_KEEP_RECENT);
  const removed = messages.length - 1 - SNIP_KEEP_RECENT;

  messages.length = 0;
  if (keepFirst) messages.push(keepFirst);
  messages.push(...keepRecent);

  if (removed > 0) {
    log.info(`Snip: 移除 ${removed} 条旧消息，保留 ${messages.length} 条`);
  }

  return Math.max(0, removed);
}

// ═══════════════════════════════════════════════════════════════════════════
// Layer 2: Microcompact (零成本)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 截断过大的 tool_result blocks
 *
 * 策略 (参考 Claude Code + ToolSafetyGuard):
 * - tool_result > 5KB → 头 70% + 尾 30%
 * - 中间插入省略标记
 *
 * @returns 截断的 block 数
 */
export function microcompactToolResults(messages: KernelMessage[]): number {
  let truncatedCount = 0;

  for (const msg of messages) {
    for (let i = 0; i < msg.content.length; i++) {
      const block = msg.content[i]!;
      if (block.type !== 'tool_result') continue;
      if (block.content.length <= MICROCOMPACT_TRUNCATE_THRESHOLD) continue;

      const original = block.content;
      const headBudget = Math.floor(MICROCOMPACT_TRUNCATE_THRESHOLD * HEAD_RATIO);
      const tailBudget = MICROCOMPACT_TRUNCATE_THRESHOLD - headBudget;
      const head = original.slice(0, headBudget);
      const tail = original.slice(-tailBudget);
      const omitted = original.length - headBudget - tailBudget;

      // 直接修改 (mutable — 性能优先)
      (block as { content: string }).content =
        `${head}\n\n... [省略 ${omitted} 字符] ...\n\n${tail}`;
      truncatedCount++;
    }
  }

  if (truncatedCount > 0) {
    log.info(`Microcompact: 截断 ${truncatedCount} 个 tool_result`);
  }

  return truncatedCount;
}

// ═══════════════════════════════════════════════════════════════════════════
// Layer 3: Autocompact (1 次 LLM 调用)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 9 段结构化摘要模板 (参考 Claude Code prompt.ts)
 */
const AUTOCOMPACT_SYSTEM_PROMPT = '你是对话摘要助手。请用中文生成准确、详细的对话摘要。';

const AUTOCOMPACT_TEMPLATE = `请总结以下对话，使用以下 9 个章节:

1. **用户核心需求** — 所有用户的明确请求和意图
2. **关键技术概念** — 涉及的框架、技术、工具
3. **文件和代码** — 读取、修改、创建的文件，包含关键代码片段
4. **错误与修复** — 遇到的错误及解决方式，特别是用户反馈
5. **问题解决** — 已解决的问题和进行中的排查
6. **用户消息摘要** — 所有非工具结果的用户消息
7. **待办任务** — 明确被要求但尚未完成的工作
8. **当前工作** — 摘要前正在进行的具体工作，含文件名和代码
9. **下一步** — 与最近工作直接相关的下一步计划

对话内容:
`;

/**
 * 将消息序列化为摘要输入文本
 */
function serializeMessagesForSummary(messages: readonly KernelMessage[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    const textParts: string[] = [];

    for (const block of msg.content) {
      switch (block.type) {
        case 'text':
          textParts.push(block.text);
          break;
        case 'tool_use':
          textParts.push(`[调用工具 ${block.name}: ${JSON.stringify(block.input).slice(0, 200)}]`);
          break;
        case 'tool_result':
          // 截断工具结果以节省摘要输入空间
          textParts.push(`[工具结果: ${block.content.slice(0, 500)}${block.content.length > 500 ? '...' : ''}]`);
          break;
        case 'thinking':
          // 跳过 thinking — 不需要在摘要中
          break;
      }
    }

    if (textParts.length > 0) {
      parts.push(`${role}: ${textParts.join('\n')}`);
    }
  }

  return parts.join('\n\n---\n\n');
}

/**
 * 执行 autocompact
 *
 * 1. 序列化消息为文本
 * 2. 调用 LLM 生成 9 段摘要
 * 3. 替换: 保留最后 4 条消息，前面替换为摘要
 * 4. 注入 post-compaction 恢复指令
 */
export async function autocompact(
  messages: KernelMessage[],
  config: QueryLoopConfig,
): Promise<void> {
  const serialized = serializeMessagesForSummary(messages);

  // 限制摘要输入长度 (防止摘要请求本身溢出)
  const maxInputChars = Math.floor(config.contextWindow * CHARS_PER_TOKEN * 0.5);
  const truncatedInput = serialized.length > maxInputChars
    ? serialized.slice(0, maxInputChars) + '\n\n[... 对话内容已截断]'
    : serialized;

  // 使用 compaction 配置的模型 (可选) 或主模型
  const compaction = config.compaction;
  let summary: string;

  if (compaction) {
    // 使用专用 compaction 模型 (如 Haiku)
    const protocol = compaction.protocol;
    const baseUrl = compaction.baseUrl;
    const apiKey = compaction.apiKey;
    const modelId = compaction.modelId;

    // 简单实现: 构建非流式请求
    const isAnthropic = protocol === 'anthropic-messages';
    const url = isAnthropic
      ? `${baseUrl.replace(/\/v1\/?$/, '')}/v1/messages`
      : `${baseUrl}/chat/completions`;

    const { buildAuthHeaders } = await import('../../provider/model-fetcher.js');
    const headers = buildAuthHeaders(apiKey, isAnthropic ? 'anthropic' : 'openai', baseUrl);

    const body = isAnthropic
      ? { model: modelId, system: AUTOCOMPACT_SYSTEM_PROMPT, messages: [{ role: 'user', content: AUTOCOMPACT_TEMPLATE + truncatedInput }], max_tokens: 4096, stream: false }
      : { model: modelId, messages: [{ role: 'system', content: AUTOCOMPACT_SYSTEM_PROMPT }, { role: 'user', content: AUTOCOMPACT_TEMPLATE + truncatedInput }], max_tokens: 4096, stream: false };

    const response = await fetch(url, {
      method: 'POST', headers, body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(`Autocompact LLM 调用失败: HTTP ${response.status}`);
    }

    const data = await response.json() as Record<string, unknown>;
    if (isAnthropic) {
      const content = data.content as Array<{ type: string; text?: string }> | undefined;
      summary = content?.find(b => b.type === 'text')?.text ?? '';
    } else {
      const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
      summary = choices?.[0]?.message?.content ?? '';
    }
  } else {
    // 回退: 使用主模型
    // 需要 ConfigManager，但这里没有直接访问 → 使用 fetch 直接调用
    const isAnthropic = config.protocol === 'anthropic-messages';
    const url = isAnthropic
      ? `${config.baseUrl.replace(/\/v1\/?$/, '')}/v1/messages`
      : `${config.baseUrl}/chat/completions`;

    const { buildAuthHeaders } = await import('../../provider/model-fetcher.js');
    const headers = buildAuthHeaders(config.apiKey, isAnthropic ? 'anthropic' : 'openai', config.baseUrl);

    const body = isAnthropic
      ? { model: config.modelId, system: AUTOCOMPACT_SYSTEM_PROMPT, messages: [{ role: 'user', content: AUTOCOMPACT_TEMPLATE + truncatedInput }], max_tokens: 4096, stream: false }
      : { model: config.modelId, messages: [{ role: 'system', content: AUTOCOMPACT_SYSTEM_PROMPT }, { role: 'user', content: AUTOCOMPACT_TEMPLATE + truncatedInput }], max_tokens: 4096, stream: false };

    const response = await fetch(url, {
      method: 'POST', headers, body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(`Autocompact LLM 调用失败: HTTP ${response.status}`);
    }

    const data = await response.json() as Record<string, unknown>;
    if (isAnthropic) {
      const content = data.content as Array<{ type: string; text?: string }> | undefined;
      summary = content?.find(b => b.type === 'text')?.text ?? '';
    } else {
      const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
      summary = choices?.[0]?.message?.content ?? '';
    }
  }

  if (!summary) {
    throw new Error('Autocompact 摘要为空');
  }

  // 替换消息: 保留最后 4 条，前面替换为摘要
  const keepCount = Math.min(4, messages.length);
  const recentMessages = messages.slice(-keepCount);

  messages.length = 0;

  // 摘要消息
  messages.push({
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: `[对话摘要 — 由系统生成]\n\n${summary}` }],
  });

  // 保留的最近消息
  messages.push(...recentMessages);

  // Post-compaction 恢复指令
  const today = new Date().toISOString().slice(0, 10);
  messages.push({
    id: crypto.randomUUID(),
    role: 'user',
    content: [{
      type: 'text',
      text: `[Post-compaction context refresh]
会话刚刚被压缩。上面的对话摘要只是提示，不能替代你的启动流程。

请立即执行：
1. 读取 AGENTS.md — 你的操作规程
2. 读取 MEMORY.md — 你的长期记忆
3. 读取今天的 memory/${today}.md — 今日笔记（如果存在）

从最新的文件状态恢复上下文，然后继续对话。`,
    }],
  });

  log.info(`Autocompact: 摘要 ${summary.length} 字符，保留 ${keepCount} 条最近消息`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Entry — maybeCompress
// ═══════════════════════════════════════════════════════════════════════════

/** Autocompact 连续失败追踪 */
let consecutiveAutocompactFailures = 0;

/**
 * 三层压缩入口
 *
 * 触发条件: token 估算超过 contextWindow 的 85%
 * 三层逐级尝试，每层成功后检查是否已降到阈值以下
 *
 * @returns 是否执行了压缩
 */
export async function maybeCompress(
  messages: KernelMessage[],
  config: QueryLoopConfig,
): Promise<boolean> {
  const estimated = estimateTokens(messages);
  const contextWindow = config.contextWindow;

  // P2-3: 三级阈值
  const warningThreshold = contextWindow * TOKEN_THRESHOLDS.warning;
  const autoCompactThreshold = contextWindow * TOKEN_THRESHOLDS.autoCompact;
  const hardLimitThreshold = contextWindow * TOKEN_THRESHOLDS.hardLimit;

  if (estimated < warningThreshold) {
    return false;
  }

  if (estimated >= warningThreshold && estimated < autoCompactThreshold) {
    log.warn(`Token 警告: ${estimated}/${contextWindow} (${(estimated / contextWindow * 100).toFixed(0)}%)，接近压缩阈值`);
    return false; // 警告但不压缩
  }

  if (estimated >= hardLimitThreshold) {
    log.error(`Token 硬限制: ${estimated}/${contextWindow} (${(estimated / contextWindow * 100).toFixed(0)}%)，强制压缩`);
  }

  const threshold = contextWindow - AUTOCOMPACT_BUFFER_TOKENS;
  log.info(`压缩触发: estimated=${estimated}, threshold=${threshold}, messages=${messages.length}`);

  // Layer 1: Snip (零成本)
  snipOldMessages(messages);
  if (estimateTokens(messages) < threshold) {
    return true;
  }

  // Layer 2: Microcompact (零成本)
  microcompactToolResults(messages);
  if (estimateTokens(messages) < threshold) {
    return true;
  }

  // Layer 3: Autocompact (1 次 LLM 调用)
  // 熔断器: 连续失败 N 次后停止
  if (consecutiveAutocompactFailures >= MAX_CONSECUTIVE_FAILURES) {
    log.warn(`Autocompact 熔断器触发: 连续 ${consecutiveAutocompactFailures} 次失败，跳过`);
    return true; // snip + microcompact 已执行
  }

  try {
    await autocompact(messages, config);
    consecutiveAutocompactFailures = 0; // 重置
    return true;
  } catch (err) {
    consecutiveAutocompactFailures++;
    log.warn(`Autocompact 失败 (${consecutiveAutocompactFailures}/${MAX_CONSECUTIVE_FAILURES}): ${err instanceof Error ? err.message : err}`);
    return true; // snip + microcompact 已执行
  }
}

/** 重置熔断器状态 (新会话时调用) */
export function resetCompactorState(): void {
  consecutiveAutocompactFailures = 0;
}
