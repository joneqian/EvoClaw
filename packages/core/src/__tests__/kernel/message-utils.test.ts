/**
 * 消息工具库测试
 *
 * 覆盖:
 * - MessageLookups 预计算查找表
 * - 消息查询（getLastAssistant, getText, hasToolCalls, isNotEmpty）
 * - 工具配对（getUnresolved, ensurePairing, mapToToolCallRecords）
 * - 合并/清理（mergeTextBlocks, filterEmpty, stripThinking）
 * - 工厂函数（SystemMessage, Tombstone, ToolUseSummary）
 */

import { describe, it, expect } from 'vitest';
import type { KernelMessage, ToolUseBlock, ToolResultBlock } from '../../agent/kernel/types.js';
import {
  buildMessageLookups,
  getLastAssistantMessage,
  getAssistantText,
  getUserText,
  hasToolCallsInLastTurn,
  isNotEmptyMessage,
  getUnresolvedToolUses,
  ensureToolResultPairing,
  mapToToolCallRecords,
  mapToToolCallRecordsLinear,
  mergeConsecutiveTextBlocks,
  filterEmptyMessages,
  stripThinkingBlocks,
  createToolUseSummaryMessage,
} from '../../agent/kernel/message-utils.js';

// ─── Helpers ───

function makeMsg(role: 'user' | 'assistant', blocks: KernelMessage['content']): KernelMessage {
  return { id: `msg-${Math.random()}`, role, content: blocks };
}

function makeToolUse(id: string, name: string): ToolUseBlock {
  return { type: 'tool_use', id, name, input: {} };
}

function makeToolResult(toolUseId: string, content: string, isError = false): ToolResultBlock {
  return { type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('MessageLookups', () => {
  it('应正确索引 tool_use 和 tool_result', () => {
    const messages: KernelMessage[] = [
      makeMsg('assistant', [makeToolUse('t1', 'read'), makeToolUse('t2', 'write')]),
      makeMsg('user', [makeToolResult('t1', 'ok'), makeToolResult('t2', 'fail', true)]),
    ];
    const lookups = buildMessageLookups(messages);

    expect(lookups.toolUseById.size).toBe(2);
    expect(lookups.toolResultByUseId.size).toBe(2);
    expect(lookups.resolvedToolUseIds.has('t1')).toBe(true);
    expect(lookups.resolvedToolUseIds.has('t2')).toBe(true);
    expect(lookups.erroredToolUseIds.has('t2')).toBe(true);
    expect(lookups.erroredToolUseIds.has('t1')).toBe(false);
  });

  it('空消息应返回空查找表', () => {
    const lookups = buildMessageLookups([]);
    expect(lookups.toolUseById.size).toBe(0);
    expect(lookups.toolResultByUseId.size).toBe(0);
  });

  it('未配对的 tool_use 不应出现在 resolved 中', () => {
    const messages: KernelMessage[] = [
      makeMsg('assistant', [makeToolUse('t1', 'read')]),
    ];
    const lookups = buildMessageLookups(messages);
    expect(lookups.toolUseById.has('t1')).toBe(true);
    expect(lookups.resolvedToolUseIds.has('t1')).toBe(false);
  });
});

describe('消息查询', () => {
  it('getLastAssistantMessage 应返回最后一条 assistant', () => {
    const messages: KernelMessage[] = [
      makeMsg('user', [{ type: 'text', text: 'hi' }]),
      makeMsg('assistant', [{ type: 'text', text: 'a1' }]),
      makeMsg('user', [{ type: 'text', text: 'bye' }]),
      makeMsg('assistant', [{ type: 'text', text: 'a2' }]),
    ];
    const last = getLastAssistantMessage(messages);
    expect(getAssistantText(last!)).toBe('a2');
  });

  it('无 assistant 消息时应返回 undefined', () => {
    expect(getLastAssistantMessage([makeMsg('user', [{ type: 'text', text: 'hi' }])])).toBeUndefined();
  });

  it('getAssistantText 应拼接多个 TextBlock', () => {
    const msg = makeMsg('assistant', [
      { type: 'text', text: 'Hello ' },
      makeToolUse('t1', 'read'),
      { type: 'text', text: 'World' },
    ]);
    expect(getAssistantText(msg)).toBe('Hello World');
  });

  it('getUserText 应提取 user 消息文本', () => {
    const msg = makeMsg('user', [{ type: 'text', text: 'question' }]);
    expect(getUserText(msg)).toBe('question');
  });

  it('hasToolCallsInLastTurn 应正确检测', () => {
    const withTools: KernelMessage[] = [
      makeMsg('assistant', [makeToolUse('t1', 'read')]),
    ];
    const withoutTools: KernelMessage[] = [
      makeMsg('assistant', [{ type: 'text', text: 'done' }]),
    ];
    expect(hasToolCallsInLastTurn(withTools)).toBe(true);
    expect(hasToolCallsInLastTurn(withoutTools)).toBe(false);
    expect(hasToolCallsInLastTurn([])).toBe(false);
  });

  it('isNotEmptyMessage 应识别空消息', () => {
    expect(isNotEmptyMessage(makeMsg('assistant', [{ type: 'text', text: '' }]))).toBe(false);
    expect(isNotEmptyMessage(makeMsg('assistant', [{ type: 'text', text: '  ' }]))).toBe(false);
    expect(isNotEmptyMessage(makeMsg('assistant', [{ type: 'text', text: 'hi' }]))).toBe(true);
    expect(isNotEmptyMessage(makeMsg('assistant', [makeToolUse('t1', 'read')]))).toBe(true);
  });
});

describe('工具配对', () => {
  it('getUnresolvedToolUses 应找到未配对的工具', () => {
    const messages: KernelMessage[] = [
      makeMsg('assistant', [makeToolUse('t1', 'read'), makeToolUse('t2', 'write')]),
      makeMsg('user', [makeToolResult('t1', 'ok')]),
    ];
    const unresolved = getUnresolvedToolUses(messages);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].id).toBe('t2');
  });

  it('全部配对时应返回空数组', () => {
    const messages: KernelMessage[] = [
      makeMsg('assistant', [makeToolUse('t1', 'read')]),
      makeMsg('user', [makeToolResult('t1', 'ok')]),
    ];
    expect(getUnresolvedToolUses(messages)).toHaveLength(0);
  });

  it('ensureToolResultPairing 应为缺失 result 补充占位符', () => {
    const messages: KernelMessage[] = [
      makeMsg('assistant', [makeToolUse('t1', 'read'), makeToolUse('t2', 'write')]),
      makeMsg('user', [makeToolResult('t1', 'ok')]),
    ];
    const patched = ensureToolResultPairing(messages);
    expect(patched.length).toBe(3); // 原 2 条 + 1 条占位符
    const lastContent = patched[2].content;
    expect(lastContent).toHaveLength(1);
    expect(lastContent[0].type).toBe('tool_result');
    expect((lastContent[0] as ToolResultBlock).is_error).toBe(true);
  });

  it('ensureToolResultPairing 无缺失时应原样返回', () => {
    const messages: KernelMessage[] = [
      makeMsg('assistant', [makeToolUse('t1', 'read')]),
      makeMsg('user', [makeToolResult('t1', 'ok')]),
    ];
    const result = ensureToolResultPairing(messages);
    expect(result).toBe(messages); // 同引用
  });

  it('mapToToolCallRecords 应用 lookups O(1) 查找', () => {
    const messages: KernelMessage[] = [
      makeMsg('assistant', [makeToolUse('t1', 'read'), makeToolUse('t2', 'edit')]),
      makeMsg('user', [makeToolResult('t1', 'file content'), makeToolResult('t2', 'error', true)]),
    ];
    const lookups = buildMessageLookups(messages);
    const toolBlocks = messages[0].content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    const records = mapToToolCallRecords(toolBlocks, lookups);

    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({ toolName: 'read', args: {}, result: 'file content', isError: false });
    expect(records[1]).toEqual({ toolName: 'edit', args: {}, result: 'error', isError: true });
  });

  it('mapToToolCallRecordsLinear 应与 lookups 版本结果一致', () => {
    const toolUses = [makeToolUse('t1', 'read')];
    const results = [makeToolResult('t1', 'ok')];
    const linear = mapToToolCallRecordsLinear(toolUses, results);

    const messages: KernelMessage[] = [
      makeMsg('assistant', toolUses),
      makeMsg('user', results),
    ];
    const lookups = buildMessageLookups(messages);
    const optimized = mapToToolCallRecords(toolUses, lookups);

    expect(linear).toEqual(optimized);
  });
});

describe('合并 & 清理', () => {
  it('mergeConsecutiveTextBlocks 应合并连续 text', () => {
    const blocks = [
      { type: 'text' as const, text: 'Hello ' },
      { type: 'text' as const, text: 'World' },
      makeToolUse('t1', 'read'),
      { type: 'text' as const, text: 'Done' },
    ];
    const merged = mergeConsecutiveTextBlocks(blocks);
    expect(merged).toHaveLength(3);
    expect((merged[0] as any).text).toBe('Hello World');
    expect(merged[1].type).toBe('tool_use');
    expect((merged[2] as any).text).toBe('Done');
  });

  it('filterEmptyMessages 应过滤空消息', () => {
    const messages: KernelMessage[] = [
      makeMsg('assistant', [{ type: 'text', text: '' }]),
      makeMsg('assistant', [{ type: 'text', text: 'content' }]),
      makeMsg('assistant', [{ type: 'text', text: '   ' }]),
    ];
    const filtered = filterEmptyMessages(messages);
    expect(filtered).toHaveLength(1);
    expect(getAssistantText(filtered[0])).toBe('content');
  });

  it('stripThinkingBlocks 应移除 thinking', () => {
    const msg = makeMsg('assistant', [
      { type: 'thinking', thinking: 'hmm...' },
      { type: 'text', text: 'answer' },
    ]);
    const stripped = stripThinkingBlocks(msg);
    expect(stripped.content).toHaveLength(1);
    expect(stripped.content[0].type).toBe('text');
    // 原消息不受影响
    expect(msg.content).toHaveLength(2);
  });
});

describe('工厂函数', () => {
  it('createToolUseSummaryMessage 应包含工具 ID', () => {
    const msg = createToolUseSummaryMessage('Searched auth/ and fixed NPE', ['t1', 't2', 't3']);
    expect(msg.type).toBe('tool_use_summary');
    expect(msg.summary).toBe('Searched auth/ and fixed NPE');
    expect(msg.precedingToolUseIds).toEqual(['t1', 't2', 't3']);
  });
});
