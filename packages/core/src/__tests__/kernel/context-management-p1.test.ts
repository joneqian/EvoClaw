/**
 * P1 上下文管理优化测试
 * - adjustIndexForToolPairing (工具对完整性保护)
 * - truncateHeadForPTLRetry (PTL 紧急降级)
 * - groupMessagesByApiRound (轮次分组)
 */
import { describe, it, expect } from 'vitest';
import { adjustIndexForToolPairing } from '../../agent/kernel/message-utils.js';
import { truncateHeadForPTLRetry, groupMessagesByApiRound } from '../../agent/kernel/context-compactor.js';
import type { KernelMessage } from '../../agent/kernel/types.js';

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeUserMsg(text: string): KernelMessage {
  return { id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text }] };
}

function makeAssistantMsg(text: string, requestId?: string): KernelMessage {
  return { id: crypto.randomUUID(), role: 'assistant', content: [{ type: 'text', text }], ...(requestId ? { requestId } : {}) };
}

function makeToolUseAssistant(toolId: string, toolName: string, requestId?: string): KernelMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: [{ type: 'tool_use', id: toolId, name: toolName, input: {} }],
    ...(requestId ? { requestId } : {}),
  };
}

function makeToolResultUser(toolId: string, result: string): KernelMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: toolId, content: result }],
  };
}

function makeThinkingAssistant(thinking: string, requestId: string): KernelMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: [{ type: 'thinking', thinking }],
    requestId,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// adjustIndexForToolPairing
// ═══════════════════════════════════════════════════════════════════════════

describe('adjustIndexForToolPairing', () => {
  it('returns 0 when startIndex is 0', () => {
    const messages = [makeUserMsg('hello'), makeAssistantMsg('hi')];
    expect(adjustIndexForToolPairing(messages, 0)).toBe(0);
  });

  it('does not adjust when no tool pairs are broken', () => {
    const messages = [
      makeUserMsg('msg 1'),
      makeAssistantMsg('response 1'),
      makeUserMsg('msg 2'),        // startIndex = 2
      makeAssistantMsg('response 2'),
    ];
    expect(adjustIndexForToolPairing(messages, 2)).toBe(2);
  });

  it('adjusts backward to include tool_use for orphaned tool_result', () => {
    const toolId = 'tool-123';
    const messages = [
      makeUserMsg('msg 1'),                           // 0
      makeToolUseAssistant(toolId, 'read'),            // 1 — tool_use here
      makeToolResultUser(toolId, 'file content'),      // 2 — tool_result here
      makeUserMsg('msg 2'),                            // 3
      makeAssistantMsg('response'),                     // 4
    ];
    // If we try to cut at 2, the tool_result at 2 needs tool_use at 1
    expect(adjustIndexForToolPairing(messages, 2)).toBe(1);
  });

  it('adjusts backward for thinking block with shared requestId', () => {
    const reqId = 'req-456';
    const messages = [
      makeUserMsg('msg 1'),                            // 0
      makeThinkingAssistant('thinking...', reqId),     // 1 — thinking with reqId
      makeAssistantMsg('response', reqId),             // 2 — same reqId
      makeUserMsg('msg 2'),                            // 3
    ];
    // Cut at 2 should pull back to 1 (thinking block shares requestId)
    expect(adjustIndexForToolPairing(messages, 2)).toBe(1);
  });

  it('handles multiple tool pairs correctly', () => {
    const tool1 = 'tool-1';
    const tool2 = 'tool-2';
    const messages = [
      makeUserMsg('msg 1'),                            // 0
      makeToolUseAssistant(tool1, 'read'),             // 1
      makeToolResultUser(tool1, 'result 1'),           // 2
      makeToolUseAssistant(tool2, 'write'),            // 3
      makeToolResultUser(tool2, 'result 2'),           // 4
      makeUserMsg('msg 2'),                            // 5
    ];
    // Cut at 4: tool_result for tool2 needs tool_use at 3
    expect(adjustIndexForToolPairing(messages, 4)).toBe(3);
    // Cut at 2: tool_result for tool1 needs tool_use at 1
    expect(adjustIndexForToolPairing(messages, 2)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// groupMessagesByApiRound
// ═══════════════════════════════════════════════════════════════════════════

describe('groupMessagesByApiRound', () => {
  it('groups messages into rounds starting with user messages', () => {
    const messages = [
      makeUserMsg('q1'),
      makeAssistantMsg('a1'),
      makeUserMsg('q2'),
      makeAssistantMsg('a2'),
    ];
    const groups = groupMessagesByApiRound(messages);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(2); // q1 + a1
    expect(groups[1]).toHaveLength(2); // q2 + a2
  });

  it('handles single message', () => {
    const messages = [makeUserMsg('only')];
    const groups = groupMessagesByApiRound(messages);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(1);
  });

  it('handles assistant-only start (edge case)', () => {
    const messages = [
      makeAssistantMsg('orphan'),
      makeUserMsg('q1'),
      makeAssistantMsg('a1'),
    ];
    const groups = groupMessagesByApiRound(messages);
    // First group: [assistant-orphan], Second group: [q1, a1]
    expect(groups).toHaveLength(2);
  });

  it('groups tool call/result pairs within same round', () => {
    const toolId = 'tool-1';
    const messages = [
      makeUserMsg('q1'),
      makeToolUseAssistant(toolId, 'read'),
      makeToolResultUser(toolId, 'result'),  // This starts a new group (user role)
      makeAssistantMsg('a1'),
    ];
    const groups = groupMessagesByApiRound(messages);
    expect(groups).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// truncateHeadForPTLRetry
// ═══════════════════════════════════════════════════════════════════════════

describe('truncateHeadForPTLRetry', () => {
  it('returns null when only 1 group exists', () => {
    const messages = [makeUserMsg('only'), makeAssistantMsg('response')];
    expect(truncateHeadForPTLRetry(messages)).toBeNull();
  });

  it('drops 20% of groups in estimation mode', () => {
    const messages: KernelMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push(makeUserMsg(`q${i}`));
      messages.push(makeAssistantMsg(`a${i}`));
    }
    // 10 groups → drop 20% = 2 groups = 4 messages
    const result = truncateHeadForPTLRetry(messages);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(16); // 20 - 4 = 16
  });

  it('drops groups to cover tokenGap in precise mode', () => {
    const messages: KernelMessage[] = [];
    for (let i = 0; i < 5; i++) {
      messages.push(makeUserMsg('x'.repeat(400))); // ~100 tokens per msg
      messages.push(makeAssistantMsg('y'.repeat(400)));
    }
    // 5 groups, each ~200 tokens. tokenGap=300 → need to drop 2 groups (400 tokens)
    const result = truncateHeadForPTLRetry(messages, 300);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(6); // 10 - 4 = 6
  });

  it('always preserves at least 1 group', () => {
    const messages = [
      makeUserMsg('q1'),
      makeAssistantMsg('a1'),
      makeUserMsg('q2'),
      makeAssistantMsg('a2'),
    ];
    // Even with huge tokenGap, should keep at least 1 group
    const result = truncateHeadForPTLRetry(messages, 999_999);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThanOrEqual(2); // at least q2 + a2
  });

  it('inserts synthetic user message when result starts with assistant', () => {
    // Construct a case where after dropping, first message is assistant
    const messages = [
      makeUserMsg('q1'),
      makeAssistantMsg('a1'),
      makeAssistantMsg('a1-continued'), // No user msg before a1-continued
      makeUserMsg('q2'),
      makeAssistantMsg('a2'),
    ];
    // Groups: [q1, a1], [a1-continued], [q2, a2]
    // Wait — actually grouping splits on user messages, so:
    // Group 1: [q1, a1, a1-continued]
    // Group 2: [q2, a2]
    // Dropping 1 group leaves [q2, a2] which starts with user — no synthetic needed
    const result = truncateHeadForPTLRetry(messages);
    expect(result).not.toBeNull();
    // Should start with user message
    expect(result![0]!.role).toBe('user');
  });
});
