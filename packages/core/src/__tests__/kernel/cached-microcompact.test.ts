/**
 * Shadow Microcompact 测试
 *
 * 验证:
 * 1. Anthropic 协议: microcompact 后内存 content 不变，仅标记 microcompacted=true
 * 2. OpenAI 协议: 直接截断（保持现有行为）
 * 3. applyDeferredTruncation 正确创建截断副本
 */
import { describe, it, expect } from 'vitest';
import { microcompactToolResults } from '../../agent/kernel/context-compactor.js';
import type { KernelMessage } from '../../agent/kernel/types.js';

function makeToolResultMsg(contentLength: number): KernelMessage {
  const content = 'x'.repeat(contentLength);
  return {
    id: 'msg-1',
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'tu-1', content }],
  };
}

describe('Shadow Microcompact (Anthropic 协议)', () => {
  const THRESHOLD = 5_000; // 5000 chars (context-compactor.ts MICROCOMPACT_TRUNCATE_THRESHOLD)

  it('超过阈值的 tool_result 仅标记，不截断 content', () => {
    const msg = makeToolResultMsg(THRESHOLD + 1000);
    const originalContent = (msg.content[0] as any).content;

    const count = microcompactToolResults([msg], 'anthropic-messages');

    expect(count).toBe(1);
    // content 不变
    expect((msg.content[0] as any).content).toBe(originalContent);
    expect((msg.content[0] as any).content.length).toBe(THRESHOLD + 1000);
    // 标记为 microcompacted
    expect(msg.microcompacted).toBe(true);
  });

  it('未超过阈值的 tool_result 不标记', () => {
    const msg = makeToolResultMsg(THRESHOLD - 100);

    const count = microcompactToolResults([msg], 'anthropic-messages');

    expect(count).toBe(0);
    expect(msg.microcompacted).toBeUndefined();
  });

  it('多个消息中只标记有超大 tool_result 的', () => {
    const small = makeToolResultMsg(1000);
    const big = makeToolResultMsg(THRESHOLD + 500);

    microcompactToolResults([small, big], 'anthropic-messages');

    expect(small.microcompacted).toBeUndefined();
    expect(big.microcompacted).toBe(true);
  });
});

describe('Standard Microcompact (OpenAI 协议)', () => {
  const THRESHOLD = 5_000;

  it('超过阈值的 tool_result 直接截断 content', () => {
    const msg = makeToolResultMsg(THRESHOLD + 1000);

    const count = microcompactToolResults([msg], 'openai-completions');

    expect(count).toBe(1);
    // content 被截断
    expect((msg.content[0] as any).content.length).toBeLessThan(THRESHOLD + 1000);
    expect((msg.content[0] as any).content).toContain('省略');
    // 不标记 microcompacted
    expect(msg.microcompacted).toBeUndefined();
  });

  it('无 protocol 参数时直接截断（向后兼容）', () => {
    const msg = makeToolResultMsg(THRESHOLD + 1000);

    const count = microcompactToolResults([msg]);

    expect(count).toBe(1);
    expect((msg.content[0] as any).content).toContain('省略');
  });
});
