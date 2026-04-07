/**
 * Time-based Microcompact 测试
 *
 * 验证:
 * 1. Anthropic 协议下，超时的 tool_result 被标记（即使未超大小阈值）
 * 2. 未超时的 tool_result 不被标记
 * 3. OpenAI 协议下时间维度不生效
 */
import { describe, it, expect } from 'vitest';
import { microcompactToolResults } from '../../agent/kernel/context-compactor.js';
import type { KernelMessage } from '../../agent/kernel/types.js';

/** 创建带 createdAt 的 tool_result 消息 */
function makeTimedToolResultMsg(contentLength: number, ageMs: number): KernelMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'x'.repeat(contentLength) }],
    createdAt: Date.now() - ageMs,
  };
}

describe('Time-based Microcompact', () => {
  const FIVE_MINUTES = 5 * 60 * 1000;

  it('Anthropic: 超 5 分钟 + 内容 >500 字符 → 标记 microcompacted', () => {
    const msg = makeTimedToolResultMsg(1000, FIVE_MINUTES + 1000);

    const count = microcompactToolResults([msg], 'anthropic-messages');

    expect(count).toBe(1);
    expect(msg.microcompacted).toBe(true);
    // content 不变（Shadow 模式）
    expect((msg.content[0] as any).content.length).toBe(1000);
  });

  it('Anthropic: 超 5 分钟但内容 ≤500 字符 → 不标记', () => {
    const msg = makeTimedToolResultMsg(200, FIVE_MINUTES + 1000);

    const count = microcompactToolResults([msg], 'anthropic-messages');

    expect(count).toBe(0);
    expect(msg.microcompacted).toBeUndefined();
  });

  it('Anthropic: 未超 5 分钟 + 内容 <5000 字符 → 不标记', () => {
    const msg = makeTimedToolResultMsg(1000, 60_000); // 1 分钟

    const count = microcompactToolResults([msg], 'anthropic-messages');

    expect(count).toBe(0);
    expect(msg.microcompacted).toBeUndefined();
  });

  it('OpenAI: 超 5 分钟不影响（无 cache 机制，时间维度无意义）', () => {
    const msg = makeTimedToolResultMsg(1000, FIVE_MINUTES + 1000);

    const count = microcompactToolResults([msg], 'openai-completions');

    // OpenAI 下不触发（只有 size > 5000 才触发）
    expect(count).toBe(0);
  });

  it('无 createdAt 的消息不受时间维度影响', () => {
    const msg: KernelMessage = {
      id: 'msg-no-time',
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'x'.repeat(1000) }],
      // 无 createdAt
    };

    const count = microcompactToolResults([msg], 'anthropic-messages');

    expect(count).toBe(0);
    expect(msg.microcompacted).toBeUndefined();
  });
});
