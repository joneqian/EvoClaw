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

  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        toolUseById.set(block.id, block);
      } else if (block.type === 'tool_result') {
        toolResultByUseId.set(block.tool_use_id, block);
        resolvedToolUseIds.add(block.tool_use_id);
        if (block.is_error) {
          erroredToolUseIds.add(block.tool_use_id);
        }
      }
    }
  }

  return { toolResultByUseId, toolUseById, resolvedToolUseIds, erroredToolUseIds };
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

/** 移除 ThinkingBlock（发送给 API 前，某些模型不支持） */
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
