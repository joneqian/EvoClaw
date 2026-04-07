/**
 * 智能会话恢复测试
 *
 * 验证三级恢复策略:
 * Level 1: compaction_boundary → boundary 后消息 + 摘要
 * Level 2: session_summary → 摘要 + 最近消息
 * Level 3: fallback → last-N 原始消息
 */
import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '@evoclaw/shared';
import type { MessageSnapshot } from '../../agent/types.js';

// ═══════════════════════════════════════════════════════════════════════════
// ChatMessage.isSummary 标记测试
// ═══════════════════════════════════════════════════════════════════════════

describe('ChatMessage.isSummary 标记', () => {
  it('普通消息 isSummary 为 undefined', () => {
    const msg: ChatMessage = {
      id: '1',
      conversationId: 'session-1',
      role: 'user',
      content: 'hello',
      createdAt: '2026-04-07T10:00:00Z',
    };
    expect(msg.isSummary).toBeUndefined();
  });

  it('摘要消息 isSummary 为 true', () => {
    const msg: ChatMessage = {
      id: 'summary-1',
      conversationId: 'session-1',
      role: 'user',
      content: '[会话摘要] 用户讨论了 A 和 B',
      isSummary: true,
      createdAt: '2026-04-07T10:00:00Z',
    };
    expect(msg.isSummary).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MessageSnapshot.isSummary 传递测试
// ═══════════════════════════════════════════════════════════════════════════

describe('MessageSnapshot.isSummary 传递', () => {
  it('ChatMessage.isSummary 映射到 MessageSnapshot.isSummary', () => {
    const chatMsg: ChatMessage = {
      id: 'summary-1',
      conversationId: 'session-1',
      role: 'user',
      content: '摘要内容',
      isSummary: true,
      createdAt: '2026-04-07T10:00:00Z',
    };

    const snapshot: MessageSnapshot = {
      role: chatMsg.role,
      content: chatMsg.content,
      isSummary: chatMsg.isSummary,
    };

    expect(snapshot.isSummary).toBe(true);
  });

  it('普通消息不设置 isSummary', () => {
    const chatMsg: ChatMessage = {
      id: '1',
      conversationId: 'session-1',
      role: 'user',
      content: 'hello',
      createdAt: '2026-04-07T10:00:00Z',
    };

    const snapshot: MessageSnapshot = {
      role: chatMsg.role,
      content: chatMsg.content,
      isSummary: chatMsg.isSummary,
    };

    expect(snapshot.isSummary).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 三级恢复策略逻辑测试（纯函数模拟）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 模拟 loadMessageHistory 的三级恢复逻辑（不依赖 SQLite）
 */
function simulateLoadMessageHistory(opts: {
  boundary?: { id: string; created_at: string };
  summary?: string;
  postBoundaryMessages?: ChatMessage[];
  recentMessages?: ChatMessage[];
}): ChatMessage[] {
  const { boundary, summary, postBoundaryMessages, recentMessages } = opts;

  // Level 1: boundary exists
  if (boundary) {
    const msgs = postBoundaryMessages ?? [];
    if (summary) {
      const summaryMsg: ChatMessage = {
        id: `summary-${boundary.id}`,
        conversationId: 'session-1',
        role: 'user',
        content: `[会话摘要 — 由系统在上下文压缩时生成]\n\n${summary}`,
        isSummary: true,
        createdAt: boundary.created_at,
      };
      return [summaryMsg, ...msgs];
    }
    return msgs;
  }

  // Level 2: no boundary, but has summary
  if (summary) {
    const recent = recentMessages ?? [];
    const summaryMsg: ChatMessage = {
      id: 'summary-fallback',
      conversationId: 'session-1',
      role: 'user',
      content: `[会话摘要 — 由系统周期性生成]\n\n${summary}`,
      isSummary: true,
      createdAt: recent[0]?.createdAt ?? new Date().toISOString(),
    };
    return [summaryMsg, ...recent];
  }

  // Level 3: fallback
  return recentMessages ?? [];
}

describe('三级恢复策略', () => {
  const postBoundaryMsgs: ChatMessage[] = [
    { id: '10', conversationId: 's', role: 'user', content: 'boundary 后消息 1', createdAt: '2026-04-07T11:00:00Z' },
    { id: '11', conversationId: 's', role: 'assistant', content: '回复 1', createdAt: '2026-04-07T11:00:01Z' },
  ];

  const recentMsgs: ChatMessage[] = [
    { id: '1', conversationId: 's', role: 'user', content: '消息 1', createdAt: '2026-04-07T09:00:00Z' },
    { id: '2', conversationId: 's', role: 'assistant', content: '回复', createdAt: '2026-04-07T09:00:01Z' },
    { id: '3', conversationId: 's', role: 'user', content: '消息 2', createdAt: '2026-04-07T09:01:00Z' },
  ];

  it('Level 1: boundary + summary → [摘要, boundary后消息...]', () => {
    const result = simulateLoadMessageHistory({
      boundary: { id: 'b-1', created_at: '2026-04-07T10:00:00Z' },
      summary: '## 核心需求\n用户在实现持久化系统',
      postBoundaryMessages: postBoundaryMsgs,
    });

    expect(result).toHaveLength(3); // 摘要 + 2 条 post-boundary
    expect(result[0].isSummary).toBe(true);
    expect(result[0].content).toContain('核心需求');
    expect(result[1].content).toBe('boundary 后消息 1');
  });

  it('Level 1: boundary 无 summary → 只返回 boundary 后消息', () => {
    const result = simulateLoadMessageHistory({
      boundary: { id: 'b-1', created_at: '2026-04-07T10:00:00Z' },
      postBoundaryMessages: postBoundaryMsgs,
    });

    expect(result).toHaveLength(2);
    expect(result[0].isSummary).toBeUndefined();
    expect(result[0].content).toBe('boundary 后消息 1');
  });

  it('Level 2: 无 boundary，有 summary → [摘要, 最近消息...]', () => {
    const result = simulateLoadMessageHistory({
      summary: '## 周期性摘要\n讨论了 A 和 B',
      recentMessages: recentMsgs,
    });

    expect(result).toHaveLength(4); // 摘要 + 3 条最近
    expect(result[0].isSummary).toBe(true);
    expect(result[0].content).toContain('周期性摘要');
    expect(result[1].content).toBe('消息 1');
  });

  it('Level 3: 无 boundary，无 summary → 回退到最近消息', () => {
    const result = simulateLoadMessageHistory({
      recentMessages: recentMsgs,
    });

    expect(result).toHaveLength(3);
    expect(result[0].isSummary).toBeUndefined();
    expect(result[0].content).toBe('消息 1');
  });

  it('Level 1: boundary 后无消息 + 有 summary → 只有摘要', () => {
    const result = simulateLoadMessageHistory({
      boundary: { id: 'b-1', created_at: '2026-04-07T10:00:00Z' },
      summary: '摘要',
      postBoundaryMessages: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0].isSummary).toBe(true);
  });

  it('全空 → 空数组', () => {
    const result = simulateLoadMessageHistory({});
    expect(result).toHaveLength(0);
  });
});
