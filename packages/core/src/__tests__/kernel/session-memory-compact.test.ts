/**
 * Session Memory Compact 测试
 */
import { describe, it, expect } from 'vitest';
import { trySessionMemoryCompact, DEFAULT_SM_COMPACT_CONFIG } from '../../agent/kernel/session-memory-compact.js';
import type { SMCompactConfig, MemoryQueryFn, EstimateTokensFn } from '../../agent/kernel/session-memory-compact.js';
import type { KernelMessage } from '../../agent/kernel/types.js';
import type { MemoryUnit } from '@evoclaw/shared';

/** 简单 token 估算（chars / 4） */
const mockEstimateTokens: EstimateTokensFn = (messages) => {
  let chars = 0;
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'text') chars += block.text.length;
    }
  }
  return Math.ceil(chars / 4);
};

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeUserMsg(text: string, opts?: Partial<KernelMessage>): KernelMessage {
  return { id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text }], ...opts };
}

function makeAssistantMsg(text: string, opts?: Partial<KernelMessage>): KernelMessage {
  return { id: crypto.randomUUID(), role: 'assistant', content: [{ type: 'text', text }], ...opts };
}

function makeMemory(overrides: Partial<MemoryUnit> = {}): MemoryUnit {
  return {
    id: crypto.randomUUID(),
    agentId: 'agent-1',
    category: 'entity',
    mergeType: 'independent',
    mergeKey: null,
    l0Index: 'test memory',
    l1Overview: 'This is a detailed overview of the test memory entry with enough content to pass the minimum threshold for SM compact.',
    l2Content: 'Full content of the memory unit.',
    confidence: 0.9,
    activation: 0.8,
    accessCount: 5,
    visibility: 'private',
    sourceConversationId: 'session-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
    ...overrides,
  };
}

function makeQueryFn(memories: MemoryUnit[]): MemoryQueryFn {
  return (_agentId: string, _sessionKey: string) => memories;
}

function generateLongMessages(count: number): KernelMessage[] {
  const msgs: KernelMessage[] = [];
  for (let i = 0; i < count; i++) {
    msgs.push(makeUserMsg('x'.repeat(2000))); // ~500 tokens each
    msgs.push(makeAssistantMsg('y'.repeat(2000)));
  }
  return msgs;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('trySessionMemoryCompact', () => {
  it('returns success=false when no memories exist', () => {
    const messages = generateLongMessages(10);
    const result = trySessionMemoryCompact(messages, 'agent-1', 'session-1', makeQueryFn([]), mockEstimateTokens);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('无已提取的记忆');
  });

  it('returns success=false when memories are too few', () => {
    const messages = generateLongMessages(10);
    const shortMemory = makeMemory({ l1Overview: 'short', l0Index: 'x' });
    const result = trySessionMemoryCompact(messages, 'agent-1', 'session-1', makeQueryFn([shortMemory]), mockEstimateTokens);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('记忆摘要过短');
  });

  it('successfully compacts with sufficient memories', () => {
    const messages = generateLongMessages(30); // 60 messages, ~30K tokens total
    const memories = Array.from({ length: 20 }, (_, i) =>
      makeMemory({ l1Overview: `Memory entry ${i}: detailed info about topic. ` + 'a'.repeat(200), category: i < 5 ? 'event' : 'entity' }),
    );

    // Use smaller config so keep window doesn't cover all messages
    const config: SMCompactConfig = { minTokens: 2000, minTextBlockMessages: 3, maxTokens: 5000 };
    const result = trySessionMemoryCompact(messages, 'agent-1', 'session-1', makeQueryFn(memories), mockEstimateTokens, config);
    expect(result.success).toBe(true);
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages.length).toBeLessThan(60); // compressed
    expect(result.tokensFreed).toBeGreaterThan(0);

    // First message should be the SM summary
    const summary = result.messages[0]!;
    expect(summary.isCompactSummary).toBe(true);
    expect(summary.content[0]!.type).toBe('text');
    expect((summary.content[0] as { type: 'text'; text: string }).text).toContain('Session Memory 摘要');
  });

  it('preserves recent messages according to config', () => {
    const messages = generateLongMessages(30);
    // Need enough memory text to pass MIN_SUMMARY_TOKENS (500)
    const memories = Array.from({ length: 30 }, (_, i) =>
      makeMemory({ l1Overview: `Memory entry ${i}: detailed description of an important fact. ` + 'a'.repeat(200) }),
    );

    const config: SMCompactConfig = { minTokens: 500, minTextBlockMessages: 2, maxTokens: 2000 };
    const result = trySessionMemoryCompact(messages, 'agent-1', 'session-1', makeQueryFn(memories), mockEstimateTokens, config);
    expect(result.success).toBe(true);
    expect(result.messages.length).toBeLessThan(60);
    expect(result.messages.length).toBeGreaterThan(1); // at least summary + some kept
  });

  it('respects compact_boundary floor', () => {
    const messages = [
      makeUserMsg('old msg 1'),
      makeAssistantMsg('old response 1'),
      makeUserMsg('[对话摘要 — 由系统生成]\n\nPrevious summary', { isCompactSummary: true }),
      makeUserMsg('new msg after compact'),
      makeAssistantMsg('new response'),
      makeUserMsg('latest msg'),
      makeAssistantMsg('latest response'),
    ];
    const memories = Array.from({ length: 10 }, () =>
      makeMemory({ l1Overview: 'Memory: ' + 'a'.repeat(100) }),
    );

    const config: SMCompactConfig = { minTokens: 1, minTextBlockMessages: 1, maxTokens: 100_000 };
    const result = trySessionMemoryCompact(messages, 'agent-1', 'session-1', makeQueryFn(memories), mockEstimateTokens, config);

    if (result.success) {
      // Should not include messages before the compact boundary
      const keptTexts = result.messages.map(m =>
        m.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join(''),
      );
      expect(keptTexts.some(t => t.includes('old msg 1'))).toBe(false);
    }
  });

  it('returns success=false when all messages fit in window', () => {
    // Very few messages — SM compact would keep all
    const messages = [makeUserMsg('hello'), makeAssistantMsg('hi')];
    const memories = Array.from({ length: 30 }, (_, i) =>
      makeMemory({ l1Overview: `Memory entry ${i}: detailed description. ` + 'a'.repeat(200) }),
    );

    const result = trySessionMemoryCompact(messages, 'agent-1', 'session-1', makeQueryFn(memories), mockEstimateTokens);
    expect(result.success).toBe(false);
    // startIndex=0 means we'd keep all messages, so SM compact is pointless
    expect(result.reason).toContain('无需压缩');
  });

  it('groups memories by category with correct labels', () => {
    const memories = [
      ...Array.from({ length: 10 }, () => makeMemory({ category: 'event', l1Overview: 'Event memory: important historical event. ' + 'e'.repeat(150), activation: 0.9 })),
      ...Array.from({ length: 10 }, () => makeMemory({ category: 'preference', l1Overview: 'Preference memory: user likes this. ' + 'p'.repeat(150), activation: 0.7 })),
      ...Array.from({ length: 10 }, () => makeMemory({ category: 'correction', l1Overview: 'Correction memory: fix applied here. ' + 'c'.repeat(150), activation: 0.5 })),
    ];
    const messages = generateLongMessages(30);
    const config: SMCompactConfig = { minTokens: 2000, minTextBlockMessages: 3, maxTokens: 5000 };

    const result = trySessionMemoryCompact(messages, 'agent-1', 'session-1', makeQueryFn(memories), mockEstimateTokens, config);
    expect(result.success).toBe(true);

    const summaryText = (result.messages[0]!.content[0] as { type: 'text'; text: string }).text;
    expect(summaryText).toContain('事件经历');
    expect(summaryText).toContain('偏好习惯');
    expect(summaryText).toContain('纠错反馈');
  });
});

describe('DEFAULT_SM_COMPACT_CONFIG', () => {
  it('has expected default values', () => {
    expect(DEFAULT_SM_COMPACT_CONFIG.minTokens).toBe(10_000);
    expect(DEFAULT_SM_COMPACT_CONFIG.minTextBlockMessages).toBe(5);
    expect(DEFAULT_SM_COMPACT_CONFIG.maxTokens).toBe(40_000);
  });
});
