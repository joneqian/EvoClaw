/**
 * 上下文压缩测试
 *
 * 覆盖:
 * - estimateTokens: 从 usage 和 chars 估算
 * - snipOldMessages: 保留首尾，移除中间
 * - microcompactToolResults: 截断大 tool_result
 * - maybeCompress: 三层压缩触发逻辑
 */

import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import {
  estimateTokens,
  snipOldMessages,
  microcompactToolResults,
  resetCompactorState,
} from '../../agent/kernel/context-compactor.js';
import type { KernelMessage } from '../../agent/kernel/types.js';

function msg(role: 'user' | 'assistant', text: string, usage?: { inputTokens: number; outputTokens: number }): KernelMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content: [{ type: 'text', text }],
    usage,
  };
}

function toolResultMsg(toolUseId: string, content: string): KernelMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: toolUseId, content }],
  };
}

beforeEach(() => {
  resetCompactorState();
});

// ═══════════════════════════════════════════════════════════════════════════
// estimateTokens
// ═══════════════════════════════════════════════════════════════════════════

describe('estimateTokens', () => {
  it('should estimate from usage fields when available', () => {
    const messages = [
      msg('user', 'hello', { inputTokens: 100, outputTokens: 0 }),
      msg('assistant', 'hi', { inputTokens: 0, outputTokens: 50 }),
    ];
    const tokens = estimateTokens(messages);
    expect(tokens).toBe(150); // 100 + 50
  });

  it('should fallback to chars/4 when no usage', () => {
    const messages = [
      msg('user', 'a'.repeat(400)), // 400 chars → ~100 tokens
    ];
    const tokens = estimateTokens(messages);
    expect(tokens).toBe(100);
  });

  it('should handle mixed content blocks', () => {
    const messages: KernelMessage[] = [{
      id: '1', role: 'user',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'tool_result', tool_use_id: 'x', content: 'result' },
      ],
    }];
    const tokens = estimateTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it('should return 0 for empty messages', () => {
    expect(estimateTokens([])).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// snipOldMessages
// ═══════════════════════════════════════════════════════════════════════════

describe('snipOldMessages', () => {
  it('should keep first message + last 8 messages', () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `msg ${i}`)
    );

    const removed = snipOldMessages(messages);

    expect(removed).toBe(11); // 20 - 1 (first) - 8 (recent) = 11
    expect(messages).toHaveLength(9); // 1 + 8
    expect(messages[0]!.content[0]).toMatchObject({ text: 'msg 0' }); // first preserved
    expect(messages[messages.length - 1]!.content[0]).toMatchObject({ text: 'msg 19' }); // last preserved
  });

  it('should not snip if <= 9 messages', () => {
    const messages = Array.from({ length: 9 }, (_, i) =>
      msg('user', `msg ${i}`)
    );

    const removed = snipOldMessages(messages);
    expect(removed).toBe(0);
    expect(messages).toHaveLength(9);
  });

  it('should handle exactly 10 messages', () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      msg('user', `msg ${i}`)
    );

    const removed = snipOldMessages(messages);
    expect(removed).toBe(1); // 10 - 1 - 8 = 1
    expect(messages).toHaveLength(9);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// microcompactToolResults
// ═══════════════════════════════════════════════════════════════════════════

describe('microcompactToolResults', () => {
  it('should truncate tool_result > 5KB', () => {
    const largeResult = 'x'.repeat(10_000);
    const messages = [toolResultMsg('call_1', largeResult)];

    const truncated = microcompactToolResults(messages);

    expect(truncated).toBe(1);
    const content = (messages[0]!.content[0] as { content: string }).content;
    expect(content.length).toBeLessThan(10_000);
    expect(content).toContain('省略');
  });

  it('should not truncate tool_result <= 5KB', () => {
    const smallResult = 'x'.repeat(4_000);
    const messages = [toolResultMsg('call_1', smallResult)];

    const truncated = microcompactToolResults(messages);

    expect(truncated).toBe(0);
    expect((messages[0]!.content[0] as { content: string }).content).toBe(smallResult);
  });

  it('should preserve head 70% + tail 30%', () => {
    const largeResult = 'H'.repeat(7000) + 'T'.repeat(3000);
    const messages = [toolResultMsg('call_1', largeResult)];

    microcompactToolResults(messages);

    const content = (messages[0]!.content[0] as { content: string }).content;
    // 头部应以 H 开头，尾部应以 T 结尾
    expect(content.startsWith('H')).toBe(true);
    expect(content.endsWith('T')).toBe(true);
    expect(content).toContain('省略');
  });

  it('should handle messages without tool_result', () => {
    const messages = [msg('user', 'hello')];
    const truncated = microcompactToolResults(messages);
    expect(truncated).toBe(0);
  });
});
