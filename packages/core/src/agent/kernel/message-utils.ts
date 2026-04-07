/**
 * 消息工具库 — 查询、配对、合并、清理、预计算查找表
 *
 * 参考 Claude Code messages.ts (5,512 行) 的核心函数集。
 * 提供 O(1) 工具调用关系查找 (MessageLookups) 和类型安全的消息操作。
 */

import crypto from 'node:crypto';
import type {
  KernelMessage,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ToolUseSummaryMessage,
  SystemMessage,
  SystemMessageSubtype,
  TombstoneMessage,
  MessageOrigin,
} from './types.js';
import type { ToolCallRecord } from '../types.js';

// ═══════════════════════════════════════════════════════════════════════════
// MessageLookups — 预计算 O(1) 查找表
// ═══════════════════════════════════════════════════════════════════════════

export interface MessageLookups {
  /** tool_use_id → ToolResultBlock */
  toolResultByUseId: Map<string, ToolResultBlock>;
  /** tool_use_id → ToolUseBlock */
  toolUseById: Map<string, ToolUseBlock>;
  /** 已完成（有对应 result）的 tool_use_id */
  resolvedToolUseIds: Set<string>;
  /** 执行出错的 tool_use_id */
  erroredToolUseIds: Set<string>;
  /** tool_use_id → 同一条 assistant 消息中的所有 tool_use_id（并行工具分组，UI 展示用） */
  siblingToolUseIds: Map<string, Set<string>>;
}

/**
 * 预计算消息中所有工具调用关系的 O(1) 查找表
 *
 * 遍历一次消息列表，构建 4 个 Map/Set。
 * 后续查询工具配对、未完成工具等全部 O(1)。
 */
export function buildMessageLookups(messages: readonly KernelMessage[]): MessageLookups {
  const toolResultByUseId = new Map<string, ToolResultBlock>();
  const toolUseById = new Map<string, ToolUseBlock>();
  const resolvedToolUseIds = new Set<string>();
  const erroredToolUseIds = new Set<string>();
  const siblingToolUseIds = new Map<string, Set<string>>();

  for (const msg of messages) {
    // 收集同一条消息中的所有 tool_use_id（并行工具分组）
    const msgToolUseIds: string[] = [];

    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        toolUseById.set(block.id, block);
        msgToolUseIds.push(block.id);
      } else if (block.type === 'tool_result') {
        toolResultByUseId.set(block.tool_use_id, block);
        resolvedToolUseIds.add(block.tool_use_id);
        if (block.is_error) {
          erroredToolUseIds.add(block.tool_use_id);
        }
      }
    }

    // 构建 sibling 关系：每个 tool_use_id 指向同消息中的所有兄弟
    if (msgToolUseIds.length > 1) {
      const siblingSet = new Set(msgToolUseIds);
      for (const id of msgToolUseIds) {
        siblingToolUseIds.set(id, siblingSet);
      }
    }
  }

  return { toolResultByUseId, toolUseById, resolvedToolUseIds, erroredToolUseIds, siblingToolUseIds };
}

// ═══════════════════════════════════════════════════════════════════════════
// 消息查询
// ═══════════════════════════════════════════════════════════════════════════

/** 获取最后一条 assistant 消息 */
export function getLastAssistantMessage(messages: readonly KernelMessage[]): KernelMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i];
  }
  return undefined;
}

/** 提取 assistant 消息中的所有文本 */
export function getAssistantText(message: KernelMessage): string {
  return message.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');
}

/** 提取 user 消息中的所有文本 */
export function getUserText(message: KernelMessage): string {
  return message.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');
}

/** 最后一条 assistant 消息是否包含工具调用 */
export function hasToolCallsInLastTurn(messages: readonly KernelMessage[]): boolean {
  const last = getLastAssistantMessage(messages);
  if (!last) return false;
  return last.content.some(b => b.type === 'tool_use');
}

/** 消息是否非空（至少有一个有内容的 block） */
export function isNotEmptyMessage(message: KernelMessage): boolean {
  return message.content.some(block => {
    if (block.type === 'text') return block.text.trim().length > 0;
    if (block.type === 'thinking') return block.thinking.trim().length > 0;
    return true; // tool_use, tool_result, image 都算非空
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 工具配对
// ═══════════════════════════════════════════════════════════════════════════

/** 获取未完成（无对应 result）的 ToolUseBlock */
export function getUnresolvedToolUses(messages: readonly KernelMessage[]): ToolUseBlock[] {
  const lookups = buildMessageLookups(messages);
  const unresolved: ToolUseBlock[] = [];
  for (const [id, block] of lookups.toolUseById) {
    if (!lookups.resolvedToolUseIds.has(id)) {
      unresolved.push(block);
    }
  }
  return unresolved;
}

/**
 * 确保每个 tool_use 都有对应的 tool_result
 * 对缺失的 result 补充占位符，避免 API 报错
 */
export function ensureToolResultPairing(messages: KernelMessage[]): KernelMessage[] {
  const unresolved = getUnresolvedToolUses(messages);
  if (unresolved.length === 0) return messages;

  const placeholders: ToolResultBlock[] = unresolved.map(block => ({
    type: 'tool_result' as const,
    tool_use_id: block.id,
    content: '[工具执行被中断]',
    is_error: true,
  }));

  return [
    ...messages,
    {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content: placeholders,
    },
  ];
}

/**
 * 用 MessageLookups 将 ToolUseBlock[] 映射为 ToolCallRecord[]
 * O(1) 查找替代 O(n) .find()
 */
export function mapToToolCallRecords(
  toolUseBlocks: readonly ToolUseBlock[],
  lookups: MessageLookups,
): ToolCallRecord[] {
  return toolUseBlocks.map(block => {
    const result = lookups.toolResultByUseId.get(block.id);
    return {
      toolName: block.name,
      args: block.input,
      result: result?.content ?? '',
      isError: result?.is_error ?? false,
    };
  });
}

/**
 * 传统版本: 用数组 find 映射（兼容不使用 lookups 的场景）
 */
export function mapToToolCallRecordsLinear(
  toolUseBlocks: readonly ToolUseBlock[],
  toolResults: readonly ToolResultBlock[],
): ToolCallRecord[] {
  return toolUseBlocks.map(block => {
    const result = toolResults.find(r => r.tool_use_id === block.id);
    return {
      toolName: block.name,
      args: block.input,
      result: result?.content ?? '',
      isError: result?.is_error ?? false,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 压缩边界工具对完整性保护
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 修正压缩切割索引，确保不会切断 tool_use/tool_result 对
 *
 * 参考 Claude Code: adjustIndexToPreserveAPIInvariants()
 * API 要求每个 tool_result 都有对应的 tool_use，反之亦然。
 * 压缩切割可能破坏这个不变量。
 *
 * Step 1: 扫描保留范围 [startIndex, end] 内的 tool_result，
 *         向前查找对应的 tool_use，如果在范围外则前移 startIndex。
 * Step 2: 扫描保留范围内的 assistant 消息，
 *         向前查找共享同一 requestId 的 thinking block 消息，前移 startIndex。
 *         (流式传输会将一个 assistant 响应拆分为多条消息)
 *
 * @param messages 完整消息列表
 * @param startIndex 初始切割索引（保留 [startIndex, end]）
 * @returns 修正后的切割索引（可能前移）
 */
export function adjustIndexForToolPairing(
  messages: readonly KernelMessage[],
  startIndex: number,
): number {
  if (startIndex <= 0) return 0;

  const lookups = buildMessageLookups(messages);
  let adjusted = startIndex;

  // Step 1: tool_result → tool_use 回溯
  for (let i = adjusted; i < messages.length; i++) {
    const msg = messages[i]!;
    for (const block of msg.content) {
      if (block.type !== 'tool_result') continue;
      // 如果此 tool_result 的 tool_use 不在保留范围内，前移
      if (!lookups.toolUseById.has(block.tool_use_id)) continue;
      for (let j = 0; j < adjusted; j++) {
        const candidate = messages[j]!;
        if (candidate.role !== 'assistant') continue;
        if (candidate.content.some(b => b.type === 'tool_use' && b.id === block.tool_use_id)) {
          adjusted = j;
          break;
        }
      }
    }
  }

  // Step 2: thinking block 合并回溯
  // 流式传输可能将一个 assistant 响应拆分为多条消息（thinking + text + tool_use）
  const requestIds = new Set<string>();
  for (let i = adjusted; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.role === 'assistant' && msg.requestId) {
      requestIds.add(msg.requestId);
    }
  }
  if (requestIds.size > 0) {
    for (let i = 0; i < adjusted; i++) {
      const msg = messages[i]!;
      if (msg.role === 'assistant' && msg.requestId && requestIds.has(msg.requestId)) {
        adjusted = i;
        break; // 找到最前的即可
      }
    }
  }

  return adjusted;
}

// ═══════════════════════════════════════════════════════════════════════════
// 消息合并 & 清理
// ═══════════════════════════════════════════════════════════════════════════

/** 合并消息内连续的 TextBlock */
export function mergeConsecutiveTextBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const merged: ContentBlock[] = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (block.type === 'text' && last?.type === 'text') {
      (last as TextBlock).text += block.text;
    } else {
      merged.push({ ...block } as ContentBlock);
    }
  }
  return merged;
}

/** 过滤空白 assistant 消息 */
export function filterEmptyMessages(messages: KernelMessage[]): KernelMessage[] {
  return messages.filter(isNotEmptyMessage);
}

/**
 * 移除 ThinkingBlock（发送给 API 前，某些模型不支持）
 * 注意: 保留 RedactedThinkingBlock — Anthropic API 要求后续轮次原样回传
 */
export function stripThinkingBlocks(message: KernelMessage): KernelMessage {
  const filtered = message.content.filter(b => b.type !== 'thinking');
  return { ...message, content: filtered };
}

// ═══════════════════════════════════════════════════════════════════════════
// 工厂函数
// ═══════════════════════════════════════════════════════════════════════════

/** 创建工具调用摘要消息 */
export function createToolUseSummaryMessage(
  summary: string,
  toolUseIds: string[],
): ToolUseSummaryMessage {
  return {
    type: 'tool_use_summary',
    id: crypto.randomUUID(),
    summary,
    precedingToolUseIds: toolUseIds,
    timestamp: new Date().toISOString(),
  };
}

/** 创建用户消息 */
export function createUserMessage(
  content: ContentBlock[] | string,
  options?: { origin?: MessageOrigin; isMeta?: boolean; isVirtual?: boolean; isCompactSummary?: boolean },
): KernelMessage {
  const blocks: ContentBlock[] = typeof content === 'string'
    ? [{ type: 'text' as const, text: content }]
    : content;
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: blocks,
    ...options,
  };
}

/** 创建助手消息 */
export function createAssistantMessage(
  content: ContentBlock[] | string,
  options?: { requestId?: string; isVirtual?: boolean },
): KernelMessage {
  const blocks: ContentBlock[] = typeof content === 'string'
    ? [{ type: 'text' as const, text: content }]
    : content;
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: blocks,
    ...options,
  };
}

/** 创建系统消息 */
export function createSystemMessage(
  subtype: SystemMessageSubtype,
  content: string,
  level: 'info' | 'warning' | 'error' = 'info',
  detail?: Record<string, unknown>,
): SystemMessage {
  return {
    type: 'system',
    subtype,
    id: crypto.randomUUID(),
    content,
    level,
    timestamp: new Date().toISOString(),
    ...(detail ? { detail } : {}),
  };
}

/** 创建墓碑消息（流式回退场景，标记移除的原始消息） */
export function createTombstone(original: KernelMessage, reason: string): TombstoneMessage {
  return {
    type: 'tombstone',
    id: crypto.randomUUID(),
    original,
    reason,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 消息规范化 — 拆分多块消息为 UI 渲染单元
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 规范化消息 — 将多 ContentBlock 的消息拆分为单块 UI 单元
 *
 * 参考 Claude Code normalizeMessages():
 * - 原始: AssistantMessage { content: [ThinkingBlock, TextBlock, ToolUseBlock, TextBlock] }
 * - 规范化: 4 条 NormalizedMessage，每条只含一个主块
 * - ToolResultBlock 附着到对应的 ToolUseBlock 上（通过 lookups O(1) 查找）
 *
 * 用途: 前端逐块独立渲染（thinking 折叠、工具调用权限对话框、消息级操作）
 */
export interface NormalizedMessage {
  /** 原始消息 ID */
  readonly parentId: string;
  /** 在原始消息 content 中的索引 */
  readonly index: number;
  /** 原始消息角色 */
  readonly role: 'user' | 'assistant';
  /** 主内容块 */
  readonly block: ContentBlock;
  /** 工具执行结果（仅 ToolUseBlock 有，附着的 ToolResultBlock） */
  readonly toolResult?: ToolResultBlock;
}

export function normalizeMessages(
  messages: readonly KernelMessage[],
  lookups?: MessageLookups,
): NormalizedMessage[] {
  const effectiveLookups = lookups ?? buildMessageLookups(messages);
  const normalized: NormalizedMessage[] = [];

  for (const msg of messages) {
    let index = 0;
    for (const block of msg.content) {
      // 跳过 ToolResultBlock — 它们会被附着到对应的 ToolUseBlock 上
      if (block.type === 'tool_result') {
        index++;
        continue;
      }

      const entry: NormalizedMessage = {
        parentId: msg.id,
        index,
        role: msg.role,
        block,
        toolResult: block.type === 'tool_use'
          ? effectiveLookups.toolResultByUseId.get(block.id)
          : undefined,
      };
      normalized.push(entry);
      index++;
    }
  }

  return normalized;
}
