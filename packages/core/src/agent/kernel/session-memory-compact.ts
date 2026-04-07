/**
 * Session Memory Compact — 零 API 成本的压缩路径
 *
 * 参考 Claude Code: sessionMemoryCompact.ts (630 行)
 *
 * 核心思路: 不调用 LLM，直接复用 Memory Extract 插件已提取的
 * L1 概览作为对话摘要。比 Autocompact 便宜（零 API 调用），
 * 比 Snip 信息保留更完整（有结构化的记忆摘要）。
 *
 * 优先级链: SM Compact (零成本) → 传统三层 (Snip/MC/AC)
 * SM 失败时静默回退到传统路径，不阻塞用户。
 */

import crypto from 'node:crypto';
import type { KernelMessage } from './types.js';
import type { MemoryUnit, MemoryCategory } from '@evoclaw/shared';
import { estimateTokens } from './context-compactor.js';
import { adjustIndexForToolPairing } from './message-utils.js';
import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('session-memory-compact');

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

/** SM Compact 配置 */
export interface SMCompactConfig {
  /** 压缩后至少保留的 token 数 */
  readonly minTokens: number;
  /** 至少保留的含文本 block 的消息数 */
  readonly minTextBlockMessages: number;
  /** 最多保留的 token 数 */
  readonly maxTokens: number;
}

/** 默认配置 (参考 Claude Code: minTokens=10K, minTextBlockMessages=5, maxTokens=40K) */
export const DEFAULT_SM_COMPACT_CONFIG: SMCompactConfig = {
  minTokens: 10_000,
  minTextBlockMessages: 5,
  maxTokens: 40_000,
};

/** SM Compact 结果 */
export interface SMCompactResult {
  readonly success: boolean;
  readonly messages: KernelMessage[];
  readonly tokensFreed: number;
  readonly reason?: string;
}

/** SM 摘要最低 token 阈值 — 记忆太少不值得做 SM Compact */
const MIN_SUMMARY_TOKENS = 500;

/** 每个类别最多包含的记忆条目数 */
const MAX_ENTRIES_PER_CATEGORY = 20;

/**
 * 记忆查询函数类型
 *
 * 解耦 MemoryStore 依赖：由调用方注入查询函数，
 * 避免 kernel 模块直接引用 memory 模块。
 */
export type MemoryQueryFn = (agentId: string, sessionKey: string) => MemoryUnit[];

// ═══════════════════════════════════════════════════════════════════════════
// Core Algorithm
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 尝试 Session Memory Compact
 *
 * 算法:
 * 1. 查询本 session 已提取的记忆
 * 2. 如果记忆不足，返回 { success: false }
 * 3. 从尾部向前扩展保留窗口
 * 4. 工具对完整性修正
 * 5. 构造: [SM 摘要] + [保留的消息]
 *
 * @param messages 当前消息列表
 * @param agentId Agent ID
 * @param sessionKey 会话标识
 * @param queryMemories 记忆查询函数（解耦 MemoryStore）
 * @param config SM Compact 配置
 * @returns 压缩结果（success=false 时消息列表为空数组）
 */
export function trySessionMemoryCompact(
  messages: readonly KernelMessage[],
  agentId: string,
  sessionKey: string,
  queryMemories: MemoryQueryFn,
  config: SMCompactConfig = DEFAULT_SM_COMPACT_CONFIG,
): SMCompactResult {
  // Step 1: 查询本 session 已提取的记忆
  const memories = queryMemories(agentId, sessionKey);

  if (memories.length === 0) {
    return { success: false, messages: [], tokensFreed: 0, reason: '无已提取的记忆' };
  }

  // Step 2: 构建 SM 摘要，检查是否足够
  const summary = buildSMSummary(memories);
  const summaryTokens = Math.ceil(summary.length / 4); // 粗略估算

  if (summaryTokens < MIN_SUMMARY_TOKENS) {
    return { success: false, messages: [], tokensFreed: 0, reason: `记忆摘要过短 (${summaryTokens} tokens)` };
  }

  // Step 3: 保留窗口回溯（从尾部向前扩展）
  let startIndex = calculateKeepIndex(messages, config);

  // Step 4: 工具对完整性修正
  startIndex = adjustIndexForToolPairing(messages, startIndex);

  // 如果修正后保留了几乎所有消息，SM Compact 无意义
  if (startIndex <= 1) {
    return { success: false, messages: [], tokensFreed: 0, reason: '保留窗口覆盖全部消息，无需压缩' };
  }

  // Step 5: 构造输出
  const kept = messages.slice(startIndex);
  const tokensFreed = estimateTokens(messages.slice(0, startIndex));

  const summaryMessage: KernelMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: summary }],
    isCompactSummary: true,
  };

  const resultMessages = [summaryMessage, ...kept];

  log.info(
    `SM Compact: ${memories.length} 条记忆 → ${summary.length} 字符摘要, ` +
    `保留 ${kept.length} 条消息 (从 ${messages.length}), ` +
    `释放 ~${tokensFreed} tokens (零 API 成本)`,
  );

  return { success: true, messages: resultMessages, tokensFreed };
}

// ═══════════════════════════════════════════════════════════════════════════
// 保留窗口计算
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 计算保留窗口起始索引
 *
 * 从尾部向前扫描，满足以下任一条件停止:
 * - totalTokens >= maxTokens (硬上限)
 * - totalTokens >= minTokens AND textBlockMsgCount >= minTextBlockMessages (软下限)
 * - 遇到上一个 compact_boundary (floor 约束)
 *
 * @returns 保留范围的起始索引 (messages[startIndex] 是保留的第一条消息)
 */
function calculateKeepIndex(
  messages: readonly KernelMessage[],
  config: SMCompactConfig,
): number {
  let totalTokens = 0;
  let textBlockCount = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;

    // floor: 不越过上一个 compact_boundary
    if (msg.isCompactSummary) {
      return i + 1;
    }

    const msgTokens = estimateMessageTokens(msg);
    totalTokens += msgTokens;

    if (hasTextBlock(msg)) {
      textBlockCount++;
    }

    // 硬上限: 保留够了
    if (totalTokens >= config.maxTokens) {
      return i;
    }

    // 软下限: token 和消息数都满足
    if (totalTokens >= config.minTokens && textBlockCount >= config.minTextBlockMessages) {
      return i;
    }
  }

  // 全部消息都没超过 maxTokens — 保留全部（调用方会判断 startIndex <= 1 时跳过）
  return 0;
}

/** 估算单条消息的 token 数 */
function estimateMessageTokens(msg: KernelMessage): number {
  let chars = 0;
  for (const block of msg.content) {
    switch (block.type) {
      case 'text': chars += block.text.length; break;
      case 'tool_use': chars += JSON.stringify(block.input).length + block.name.length; break;
      case 'tool_result': chars += block.content.length; break;
      case 'thinking': chars += block.thinking.length; break;
      case 'image': chars += 1000; break;
    }
  }
  return Math.ceil(chars / 4);
}

/** 消息是否包含文本块（非纯工具调用/结果） */
function hasTextBlock(msg: KernelMessage): boolean {
  return msg.content.some(b => b.type === 'text' && b.text.trim().length > 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// SM 摘要构建
// ═══════════════════════════════════════════════════════════════════════════

/** 类别显示名称 */
const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  event: '事件经历',
  entity: '实体知识',
  case: '问题解决案例',
  pattern: '行为模式',
  tool: '工具使用',
  skill: '技能知识',
  preference: '偏好习惯',
  profile: '个人信息',
  correction: '纠错反馈',
};

/** 类别排序权重（越小越靠前，信息密度高的优先） */
const CATEGORY_ORDER: Record<MemoryCategory, number> = {
  event: 0,
  entity: 1,
  case: 2,
  pattern: 3,
  tool: 4,
  skill: 5,
  preference: 6,
  profile: 7,
  correction: 8,
};

/**
 * 从记忆列表构建 SM 摘要文本
 *
 * 按类别分组，每类最多 20 条，使用 l1Overview（一行摘要）。
 * l1 是最佳平衡: l2Content 太长，l0Index 太短。
 */
function buildSMSummary(memories: readonly MemoryUnit[]): string {
  // 按类别分组
  const grouped = new Map<MemoryCategory, MemoryUnit[]>();
  for (const m of memories) {
    const list = grouped.get(m.category);
    if (list) {
      list.push(m);
    } else {
      grouped.set(m.category, [m]);
    }
  }

  const sections: string[] = ['[Session Memory 摘要 — 零成本压缩]'];
  sections.push('以下是从对话中自动提取的记忆，替代了之前的完整对话历史。\n');

  // 按重要性排序
  const sortedCategories = [...grouped.entries()]
    .sort(([a], [b]) => CATEGORY_ORDER[a] - CATEGORY_ORDER[b]);

  for (const [category, units] of sortedCategories) {
    const label = CATEGORY_LABELS[category];
    sections.push(`### ${label}`);

    // 按 activation 降序（最活跃的优先），截取前 N 条
    const sorted = units
      .sort((a, b) => b.activation - a.activation)
      .slice(0, MAX_ENTRIES_PER_CATEGORY);

    for (const unit of sorted) {
      // 使用 l1Overview（结构化概览），如果为空回退到 l0Index
      const text = unit.l1Overview.trim() || unit.l0Index.trim();
      if (text) {
        sections.push(`- ${text}`);
      }
    }
    sections.push(''); // 空行分隔
  }

  return sections.join('\n');
}
