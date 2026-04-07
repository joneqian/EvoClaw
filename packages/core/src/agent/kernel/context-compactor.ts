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
import type { KernelMessage, QueryLoopConfig, CompactTrigger } from './types.js';
import { createLogger } from '../../infrastructure/logger.js';
import { Feature } from '../../infrastructure/feature.js';
import { trySessionMemoryCompact, type MemoryQueryFn } from './session-memory-compact.js';
import type { FileStateCache } from './file-state-cache.js';

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

/** 主动 Snip 阈值 (91%) — 渐进式折叠新增 */
const PROACTIVE_SNIP_THRESHOLD = 0.91;

// ═══════════════════════════════════════════════════════════════════════════
// Collapse State — 渐进式折叠状态追踪
// ═══════════════════════════════════════════════════════════════════════════

/** 折叠阶段 */
export type CollapsePhase =
  | 'normal'          // < 90%
  | 'warning'         // 90-91%
  | 'proactive_snip'  // 91-93% — 主动 snip（不等 413）
  | 'autocompact'     // 93%+ — 完整压缩
  | 'emergency'       // 413 后
  | 'exhausted';      // 多次 emergency 仍失败

/** 折叠状态快照 */
export interface CollapseState {
  readonly phase: CollapsePhase;
  readonly emergencyCount: number;
  readonly lastCompactionTurn: number;
  /** 连续 autocompact 失败次数（从模块级变量迁移至此） */
  readonly consecutiveFailures: number;
  /** 缓存断点索引（用于缓存感知微压缩） */
  readonly cacheBreakpointIndex: number;
}

/** 创建初始折叠状态 */
export function createCollapseState(): CollapseState {
  return { phase: 'normal', emergencyCount: 0, lastCompactionTurn: 0, consecutiveFailures: 0, cacheBreakpointIndex: 0 };
}

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
// Layer 1.5: Strip Old Thinking Blocks (零成本)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 清除旧 assistant 消息中的 thinking/redacted_thinking 块
 *
 * Anthropic API 约束: thinking 块只需在最近的 tool_use 链路中保留。
 * 压缩时清除旧 turn 的 thinking 块可回收大量 token。
 *
 * 策略: 仅保留最后一条 assistant 消息的 thinking 块，其余全部移除。
 *
 * @returns 清除的 thinking 块数量
 */
export function stripOldThinkingBlocks(messages: KernelMessage[]): number {
  let stripped = 0;
  // 找到最后一条 assistant 消息的索引
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.role !== 'assistant' || i === lastAssistantIdx) continue;

    const filtered = msg.content.filter(b => {
      if (b.type === 'thinking' || b.type === 'redacted_thinking') {
        stripped++;
        return false;
      }
      return true;
    });

    if (filtered.length !== msg.content.length) {
      messages[i] = { ...msg, content: filtered };
    }
  }

  if (stripped > 0) {
    log.info(`Strip thinking: 清除 ${stripped} 个旧 thinking 块`);
  }
  return stripped;
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
 * Shadow 模式 (Anthropic 协议):
 * - 不直接截断 content，仅标记 microcompacted=true
 * - 实际截断延迟到 streamOneRound 构建 messagesForApi 时
 * - 保护 Prompt Cache 命中率（本地消息结构不变）
 *
 * @param protocol API 协议 — anthropic-messages 时使用 Shadow 模式
 * @returns 截断/标记的 block 数
 */
export function microcompactToolResults(
  messages: KernelMessage[],
  protocol?: import('./types.js').ApiProtocol,
): number {
  const useShadow = protocol === 'anthropic-messages';
  let truncatedCount = 0;

  for (const msg of messages) {
    let hasOversized = false;
    for (const block of msg.content) {
      if (block.type !== 'tool_result') continue;
      if (block.content.length <= MICROCOMPACT_TRUNCATE_THRESHOLD) continue;

      hasOversized = true;

      if (!useShadow) {
        // 直接截断 (OpenAI 协议: 无 cache 机制)
        const original = block.content;
        const headBudget = Math.floor(MICROCOMPACT_TRUNCATE_THRESHOLD * HEAD_RATIO);
        const tailBudget = MICROCOMPACT_TRUNCATE_THRESHOLD - headBudget;
        const head = original.slice(0, headBudget);
        const tail = original.slice(-tailBudget);
        const omitted = original.length - headBudget - tailBudget;
        (block as { content: string }).content =
          `${head}\n\n... [省略 ${omitted} 字符] ...\n\n${tail}`;
      }
      truncatedCount++;
    }

    // Shadow 模式: 仅标记消息，不修改 content
    if (useShadow && hasOversized) {
      (msg as { microcompacted: boolean }).microcompacted = true;
    }
  }

  if (truncatedCount > 0) {
    log.info(`Microcompact: ${useShadow ? '标记' : '截断'} ${truncatedCount} 个 tool_result`);
  }

  return truncatedCount;
}

/**
 * 缓存感知微压缩 — 优先截断缓存断点之后的 tool_result
 *
 * Phase 1: 截断 cacheBreakpointIndex 之后的消息（不影响 Prompt Cache 前缀）
 * Phase 2: 仅在 Phase 1 不够时，截断之前的消息（导致缓存失效）
 *
 * @param cacheBreakpointIndex 最后一次 cacheWriteTokens > 0 时的消息数组长度
 * @returns 截断的 block 数
 */
export function microcompactCacheAware(
  messages: KernelMessage[],
  cacheBreakpointIndex: number,
): number {
  let truncatedCount = 0;

  // Phase 1: 截断缓存断点之后的 tool_result（这些不在缓存前缀中）
  for (let m = cacheBreakpointIndex; m < messages.length; m++) {
    truncatedCount += truncateToolResultsInMessage(messages[m]!);
  }

  // Phase 2: 如果仍然超标，截断缓存断点之前的 tool_result
  const estimated = estimateTokens(messages);
  if (estimated > messages.length * CHARS_PER_TOKEN) { // 仍然过大
    for (let m = 0; m < cacheBreakpointIndex && m < messages.length; m++) {
      truncatedCount += truncateToolResultsInMessage(messages[m]!);
    }
  }

  if (truncatedCount > 0) {
    log.info(`缓存感知 Microcompact: 截断 ${truncatedCount} 个 tool_result (breakpoint=${cacheBreakpointIndex})`);
  }

  return truncatedCount;
}

/** 截断单条消息中的超标 tool_result blocks */
function truncateToolResultsInMessage(msg: KernelMessage): number {
  let count = 0;
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

    (block as { content: string }).content =
      `${head}\n\n... [省略 ${omitted} 字符] ...\n\n${tail}`;
    count++;
  }
  return count;
}

// ═══════════════════════════════════════════════════════════════════════════
// Context Collapse Drain — 413 时的轻量紧急折叠
// ═══════════════════════════════════════════════════════════════════════════

/** 紧急折叠后保留的最近消息数 */
const COLLAPSE_KEEP_RECENT = 4;

/** tool_result 紧急截断限制 */
const COLLAPSE_TRUNCATE_LIMIT = 1_000;

/**
 * Context Collapse Drain — 413 时先尝试的轻量折叠
 *
 * 比 Snip+Microcompact 更激进（保留更少消息 + 更短截断），
 * 但比 Autocompact 便宜（零 API 调用）。
 *
 * 参考 Claude Code: 413 → Context Collapse Drain → Reactive Compact
 *
 * @returns 折叠是否有效（消息数减少了）
 */
export function contextCollapseDrain(messages: KernelMessage[]): boolean {
  const beforeCount = messages.length;

  // 1. 激进 Snip — 只保留首条 + 最近 4 条
  if (messages.length > COLLAPSE_KEEP_RECENT + 1) {
    const keepFirst = messages[0];
    const keepRecent = messages.slice(-COLLAPSE_KEEP_RECENT);
    messages.length = 0;
    if (keepFirst) messages.push(keepFirst);
    messages.push(...keepRecent);
  }

  // 2. 激进截断所有 tool_result（1000 字符上限）
  for (const msg of messages) {
    for (let i = 0; i < msg.content.length; i++) {
      const block = msg.content[i]!;
      if (block.type === 'tool_result' && block.content.length > COLLAPSE_TRUNCATE_LIMIT) {
        (block as { content: string }).content =
          block.content.slice(0, COLLAPSE_TRUNCATE_LIMIT) + '\n... [紧急截断]';
      }
    }
  }

  const removed = beforeCount - messages.length;
  if (removed > 0) {
    log.info(`Context Collapse: ${beforeCount} → ${messages.length} 消息 (移除 ${removed})`);
  }
  return removed > 0;
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

// ═══════════════════════════════════════════════════════════════════════════
// 压缩后重注入 — 精确预算控制
// ═══════════════════════════════════════════════════════════════════════════

/** 重注入总 token 预算 */
const POST_COMPACT_TOKEN_BUDGET = 50_000;
/** 单个文件最大 token 数 */
const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000;
/** 最多重注入的文件数 */
const POST_COMPACT_MAX_FILES = 5;
/** 每 token 字符数估算（重注入使用） */
const REINJECTION_CHARS_PER_TOKEN = 4;

/**
 * 构建压缩后重注入附件
 *
 * 参考 Claude Code: compact.ts 重注入机制
 * 从 FileStateCache 获取最近读取的文件路径，
 * 重新读取并截断到预算范围内注入。
 *
 * @param fileStateCache 文件状态缓存
 * @returns 重注入消息，无可用文件时返回 null
 */
function buildReinjectionAttachment(fileStateCache: FileStateCache): KernelMessage | null {
  const recentPaths = fileStateCache.getRecentlyReadPaths(POST_COMPACT_MAX_FILES);
  if (recentPaths.length === 0) return null;

  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const attachments: string[] = [];
  let usedTokens = 0;

  for (const filePath of recentPaths) {
    if (usedTokens >= POST_COMPACT_TOKEN_BUDGET) break;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const maxChars = POST_COMPACT_MAX_TOKENS_PER_FILE * REINJECTION_CHARS_PER_TOKEN;
      const truncated = content.length > maxChars
        ? content.slice(0, maxChars) + `\n... [截断: ${content.length} 字符, 显示前 ${maxChars}]`
        : content;

      const tokens = Math.ceil(truncated.length / REINJECTION_CHARS_PER_TOKEN);
      if (usedTokens + tokens > POST_COMPACT_TOKEN_BUDGET) continue;

      attachments.push(`<file path="${path.basename(filePath)}" full_path="${filePath}">\n${truncated}\n</file>`);
      usedTokens += tokens;
    } catch {
      // 文件可能已被删除，跳过
    }
  }

  if (attachments.length === 0) return null;

  log.info(`重注入: ${attachments.length} 个文件, ~${usedTokens} tokens`);
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: `[Post-compaction 文件恢复 — 最近读取的关键文件]\n\n${attachments.join('\n\n')}` }],
    isMeta: true,
  };
}

/**
 * 执行 autocompact
 *
 * 1. 序列化消息为文本
 * 2. 调用 LLM 生成 9 段摘要
 * 3. 替换: 保留最后 4 条消息，前面替换为摘要
 * 4. 注入 post-compaction 恢复指令 + 文件重注入
 */
export async function autocompact(
  messages: KernelMessage[],
  config: QueryLoopConfig,
): Promise<string> {
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

  // Post-compaction 恢复指令 + 关键内容重注入（参考 Claude Code compact.ts）
  const today = new Date().toISOString().slice(0, 10);
  const refreshParts = [
    `[Post-compaction context refresh]`,
    `会话刚刚被压缩。上面的对话摘要是对之前内容的总结。`,
    ``,
    `请立即执行以恢复工作上下文：`,
    `1. 读取 AGENTS.md — 你的操作规程`,
    `2. 读取 MEMORY.md — 你的长期记忆`,
    `3. 读取今天的 memory/${today}.md — 今日笔记（如果存在）`,
    `4. 如果摘要中提到了正在编辑的文件，重新读取这些文件`,
    `5. 检查 <available_skills> 确认可用技能`,
    ``,
    `然后继续完成用户最新的请求。不要重新自我介绍。`,
  ];
  messages.push({
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: refreshParts.join('\n') }],
    isMeta: true,
  });

  // Post-compaction 重注入（如果有 fileStateCache）
  if (config.fileStateCache) {
    const reinjection = buildReinjectionAttachment(config.fileStateCache);
    if (reinjection) {
      messages.push(reinjection);
    }
  }

  log.info(`Autocompact: 摘要 ${summary.length} 字符，保留 ${keepCount} 条最近消息`);
  return summary;
}

// ═══════════════════════════════════════════════════════════════════════════
// Session Memory Compact — 模块级记忆查询注入
// ═══════════════════════════════════════════════════════════════════════════

/** 注入的记忆查询函数（解耦 MemoryStore 依赖） */
let _memoryQueryFn: MemoryQueryFn | null = null;

/**
 * 注入记忆查询函数（在 sidecar 启动时调用一次）
 *
 * 用于 SM Compact: 查询本 session 已提取的记忆。
 * 解耦 kernel 模块与 memory 模块的循环依赖。
 */
export function setMemoryQueryFn(fn: MemoryQueryFn): void {
  _memoryQueryFn = fn;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Entry — maybeCompress
// ═══════════════════════════════════════════════════════════════════════════

/** Autocompact 连续失败追踪 */
let consecutiveAutocompactFailures = 0;

/**
 * 压缩入口 — 优先级链: SM Compact → 传统三层
 *
 * SM Compact (零 API 成本): 复用已提取的记忆作为摘要
 * 传统三层: Snip → Microcompact → Autocompact
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

  // ──── 优先级 1: Session Memory Compact（零 API 成本）────
  if (Feature.SESSION_MEMORY_COMPACT && _memoryQueryFn && config.agentId && config.sessionKey) {
    const smResult = trySessionMemoryCompact(
      messages, config.agentId, config.sessionKey, _memoryQueryFn,
    );
    if (smResult.success) {
      messages.length = 0;
      messages.push(...smResult.messages);
      config.onEvent({ type: 'compaction_start', timestamp: Date.now() });
      config.onEvent({ type: 'compaction_end', timestamp: Date.now() });
      log.info(`SM Compact: 释放 ~${smResult.tokensFreed} tokens (零 API 成本)`);
      return true;
    }
    log.debug?.(`SM Compact 跳过: ${smResult.reason}`);
  }

  // ──── 优先级 2: 传统三层压缩 ────
  const threshold = contextWindow - AUTOCOMPACT_BUFFER_TOKENS;
  const msgCountBefore = messages.length;
  const trigger: CompactTrigger = estimated >= hardLimitThreshold ? 'hard_limit' : 'auto';
  log.info(`压缩触发: estimated=${estimated}, threshold=${threshold}, messages=${msgCountBefore}`);

  // PreCompact Hook — 压缩前检查
  if (config.preCompactHook) {
    try {
      const preResult = await config.preCompactHook(trigger, estimated, contextWindow);
      if (preResult.blockCompaction && trigger !== 'hard_limit') {
        log.info('PreCompact Hook 阻止了本次压缩');
        return false;
      }
    } catch (err) {
      log.warn(`PreCompact Hook 执行失败，继续压缩: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Layer 1: Snip (零成本)
  const snipped = snipOldMessages(messages);
  if (snipped > 0) {
    config.onEvent({ type: 'compaction_start', timestamp: Date.now() });
    config.onEvent({ type: 'compaction_end', timestamp: Date.now() });
    log.info(`Snip 边界: ${msgCountBefore} → ${messages.length} 消息 (移除 ${snipped})`);
  }
  if (estimateTokens(messages) < threshold) {
    return true;
  }

  // Layer 1.5: Strip old thinking blocks (零成本)
  const thinkingStripped = stripOldThinkingBlocks(messages);
  if (thinkingStripped > 0 && estimateTokens(messages) < threshold) {
    return true;
  }

  // Layer 2: Microcompact (零成本, Anthropic 协议下使用 Shadow 模式保护缓存)
  const truncated = microcompactToolResults(messages, config.protocol);
  if (truncated > 0) {
    config.onEvent({ type: 'compaction_start', timestamp: Date.now() });
    config.onEvent({ type: 'compaction_end', timestamp: Date.now() });
    log.info(`Microcompact 边界: 截断 ${truncated} 个 tool_result`);
  }
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
    config.onEvent({ type: 'compaction_start', timestamp: Date.now() });
    const summaryText = await autocompact(messages, config);
    consecutiveAutocompactFailures = 0;
    config.onEvent({ type: 'compaction_end', timestamp: Date.now() });
    const tokensAfter = estimateTokens(messages);
    log.info(`Autocompact 边界: ${msgCountBefore} → ${messages.length} 消息`);

    // PostCompact Hook — 压缩后通知（含摘要文本）
    if (config.postCompactHook) {
      try {
        await config.postCompactHook(trigger, estimated, tokensAfter, summaryText);
      } catch (err) {
        log.warn(`PostCompact Hook 执行失败: ${err instanceof Error ? err.message : err}`);
      }
    }
    return true;
  } catch (err) {
    consecutiveAutocompactFailures++;
    config.onEvent({ type: 'compaction_end', timestamp: Date.now() });
    log.warn(`Autocompact 失败 (${consecutiveAutocompactFailures}/${MAX_CONSECUTIVE_FAILURES}): ${err instanceof Error ? err.message : err}`);
    return true; // snip + microcompact 已执行
  }
}

/** 重置压缩器状态 (新会话时调用) */
export function resetCompactorState(): void {
  consecutiveAutocompactFailures = 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// PTL 紧急降级 — 压缩后仍溢出时的逐轮次删除
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 按 API 轮次分组消息
 *
 * 一轮 = 一条 user 消息 + 其后的 assistant 消息（含工具调用/结果对）
 */
export function groupMessagesByApiRound(messages: readonly KernelMessage[]): KernelMessage[][] {
  const groups: KernelMessage[][] = [];
  let current: KernelMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'user' && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(msg);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * PTL 紧急降级 — 按 API 轮次分组，逐组删除最老消息直到覆盖 tokenGap
 *
 * 参考 Claude Code: truncateHeadForPTLRetry()
 *
 * 比 contextCollapseDrain 更精确:
 * - 不是一刀切 keep 4，而是基于实际 token 差距删除
 * - 按轮次分组保持语义完整性
 * - 支持精确模式（有 tokenGap）和估算模式（删 20%）
 *
 * @param messages 当前消息列表
 * @param tokenGap API 返回的超出 token 数（如果有）
 * @returns 截断后的消息列表，null 表示无法进一步截断
 */
export function truncateHeadForPTLRetry(
  messages: readonly KernelMessage[],
  tokenGap?: number,
): KernelMessage[] | null {
  const groups = groupMessagesByApiRound(messages);
  if (groups.length < 2) return null; // 至少保留 1 组

  let dropCount: number;
  if (tokenGap !== undefined && tokenGap > 0) {
    // 精确模式: 贪心删除最老的组，直到覆盖 tokenGap
    let acc = 0;
    dropCount = 0;
    for (const g of groups) {
      acc += estimateTokens(g);
      dropCount++;
      if (acc >= tokenGap) break;
    }
  } else {
    // 估算模式: 删除 20% 的组
    dropCount = Math.max(1, Math.floor(groups.length * 0.2));
  }

  dropCount = Math.min(dropCount, groups.length - 1); // 至少保留 1 组
  const sliced = groups.slice(dropCount).flat();

  // 如果结果以 assistant 消息开头，插入合成 user 消息
  if (sliced.length > 0 && sliced[0]!.role === 'assistant') {
    return [
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: '[earlier conversation truncated for compaction retry]' }],
        isMeta: true,
      },
      ...sliced,
    ];
  }

  log.info(`PTL 降级: 删除 ${dropCount}/${groups.length} 组，剩余 ${sliced.length} 条消息`);
  return sliced;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phased Compression — 渐进式压缩（Feature.REACTIVE_COMPACT 门控）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 渐进式压缩入口 — 按 token 占比分阶段执行
 *
 * 相比 maybeCompress() 的改进:
 * - 91-93% 区间主动 Snip（不等 413）
 * - CollapseState 追踪折叠阶段（消除模块级全局状态）
 * - 工具结果收集后可再次调用检查
 *
 * @returns 更新后的 CollapseState
 */
export async function maybeCompressPhased(
  messages: KernelMessage[],
  config: QueryLoopConfig,
  collapseState: CollapseState,
): Promise<CollapseState> {
  const estimated = estimateTokens(messages);
  const contextWindow = config.contextWindow;
  const ratio = estimated / contextWindow;

  // < 90%: 正常
  if (ratio < TOKEN_THRESHOLDS.warning) {
    return { ...collapseState, phase: 'normal' };
  }

  // 90-91%: 警告
  if (ratio < PROACTIVE_SNIP_THRESHOLD) {
    log.warn(`Token 警告: ${estimated}/${contextWindow} (${(ratio * 100).toFixed(0)}%)`);
    return { ...collapseState, phase: 'warning' };
  }

  // 91-93%: 主动 Snip（不等 413）
  if (ratio < TOKEN_THRESHOLDS.autoCompact) {
    const snipped = snipOldMessages(messages);
    if (snipped > 0) {
      config.onEvent({ type: 'compaction_start', timestamp: Date.now() });
      config.onEvent({ type: 'compaction_end', timestamp: Date.now() });
      log.info(`主动 Snip: 移除 ${snipped} 条消息 (${(ratio * 100).toFixed(0)}% → 缓解中)`);
    }
    return { ...collapseState, phase: 'proactive_snip' };
  }

  // >= 93%: 完整三层压缩
  const msgCountBefore = messages.length;
  log.info(`渐进压缩触发: estimated=${estimated}, ratio=${(ratio * 100).toFixed(0)}%, messages=${msgCountBefore}`);

  // Layer 1: Snip
  const snipped = snipOldMessages(messages);
  if (snipped > 0) {
    config.onEvent({ type: 'compaction_start', timestamp: Date.now() });
    config.onEvent({ type: 'compaction_end', timestamp: Date.now() });
  }
  if (estimateTokens(messages) < contextWindow - AUTOCOMPACT_BUFFER_TOKENS) {
    return { ...collapseState, phase: 'autocompact' };
  }

  // Layer 1.5: Strip old thinking blocks (零成本)
  stripOldThinkingBlocks(messages);
  if (estimateTokens(messages) < contextWindow - AUTOCOMPACT_BUFFER_TOKENS) {
    return { ...collapseState, phase: 'autocompact' };
  }

  // Layer 2: Microcompact（缓存感知版或标准版, Anthropic 协议下使用 Shadow 模式）
  const truncated = Feature.CACHED_MICROCOMPACT
    ? microcompactCacheAware(messages, collapseState.cacheBreakpointIndex)
    : microcompactToolResults(messages, config.protocol);
  if (truncated > 0) {
    config.onEvent({ type: 'compaction_start', timestamp: Date.now() });
    config.onEvent({ type: 'compaction_end', timestamp: Date.now() });
  }
  if (estimateTokens(messages) < contextWindow - AUTOCOMPACT_BUFFER_TOKENS) {
    return { ...collapseState, phase: 'autocompact' };
  }

  // Layer 3: Autocompact（含熔断器）
  if (collapseState.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    log.warn(`Autocompact 熔断器: 连续 ${collapseState.consecutiveFailures} 次失败，跳过`);
    return { ...collapseState, phase: 'exhausted' };
  }

  try {
    config.onEvent({ type: 'compaction_start', timestamp: Date.now() });
    const summaryText = await autocompact(messages, config);
    config.onEvent({ type: 'compaction_end', timestamp: Date.now() });
    const tokensAfter = estimateTokens(messages);
    log.info(`Autocompact: ${msgCountBefore} → ${messages.length} 消息`);

    // PostCompact Hook — 压缩后通知（含摘要文本）
    if (config.postCompactHook) {
      try {
        await config.postCompactHook('auto', estimated, tokensAfter, summaryText);
      } catch (err) {
        log.warn(`PostCompact Hook 执行失败: ${err instanceof Error ? err.message : err}`);
      }
    }

    return { ...collapseState, phase: 'autocompact', consecutiveFailures: 0 };
  } catch (err) {
    config.onEvent({ type: 'compaction_end', timestamp: Date.now() });
    const nextFailures = collapseState.consecutiveFailures + 1;
    log.warn(`Autocompact 失败 (${nextFailures}/${MAX_CONSECUTIVE_FAILURES}): ${err instanceof Error ? err.message : err}`);
    return { ...collapseState, phase: 'autocompact', consecutiveFailures: nextFailures };
  }
}
