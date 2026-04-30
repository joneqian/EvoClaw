/**
 * DebounceCoalescer 单元测试
 *
 * 用 vi.useFakeTimers() 控制 setTimeout，确定性测安静窗口 / maxWait / 合并行为。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChannelMessage } from '@evoclaw/shared';

import {
  DebounceCoalescer,
  DEFAULT_DEBOUNCE_CONFIG,
  type DebounceConfig,
} from '../../channel/adapters/feishu/inbound/debounce-coalescer.js';

function makeMsg(overrides: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    channel: 'feishu',
    chatType: 'private',
    accountId: 'cli_x',
    peerId: 'ou_user',
    senderId: 'ou_user',
    senderName: '用户',
    content: 'hi',
    messageId: `om_${Math.random()}`,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('DebounceCoalescer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('disabled 直通模式 → 每条消息立即 deliver', async () => {
    const handler = vi.fn();
    const c = new DebounceCoalescer({ ...DEFAULT_DEBOUNCE_CONFIG, enabled: false }, handler);
    c.enqueue(makeMsg({ content: 'a' }));
    c.enqueue(makeMsg({ content: 'b' }));
    await vi.runAllTimersAsync();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('单条消息：安静窗口结束后 flush', async () => {
    const handler = vi.fn();
    const c = new DebounceCoalescer(DEFAULT_DEBOUNCE_CONFIG, handler);
    c.enqueue(makeMsg({ content: 'hello' }));
    expect(handler).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_CONFIG.quietWindowMs + 10);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0].content).toBe('hello');
  });

  it('连续 3 条文本：安静窗口 reset，最终合并为一条', async () => {
    const handler = vi.fn();
    const c = new DebounceCoalescer(DEFAULT_DEBOUNCE_CONFIG, handler);
    c.enqueue(makeMsg({ content: '你好' }));
    await vi.advanceTimersByTimeAsync(2000);
    c.enqueue(makeMsg({ content: '我想问一下' }));
    await vi.advanceTimersByTimeAsync(2000);
    c.enqueue(makeMsg({ content: '天气怎么样' }));
    expect(handler).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_CONFIG.quietWindowMs + 10);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0].content).toBe('你好\n我想问一下\n天气怎么样');
  });

  it('maxWait 硬上限：连发不停 → 30s 时强 flush', async () => {
    const handler = vi.fn();
    const config: DebounceConfig = { enabled: true, quietWindowMs: 4000, maxWaitMs: 10_000 };
    const c = new DebounceCoalescer(config, handler);

    // 每 1s 发一条，连续 12s
    for (let i = 0; i < 12; i += 1) {
      c.enqueue(makeMsg({ content: `m${i}` }));
      await vi.advanceTimersByTimeAsync(1000);
    }
    // 12s 内 maxWait=10s 已触发
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0].content.split('\n').length).toBeGreaterThanOrEqual(10);
  });

  it('多 session 独立：A 和 B 各自合并不串', async () => {
    const handler = vi.fn();
    const c = new DebounceCoalescer(DEFAULT_DEBOUNCE_CONFIG, handler);
    c.enqueue(makeMsg({ peerId: 'A', content: 'A1' }));
    c.enqueue(makeMsg({ peerId: 'B', content: 'B1' }));
    c.enqueue(makeMsg({ peerId: 'A', content: 'A2' }));
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_CONFIG.quietWindowMs + 10);

    expect(handler).toHaveBeenCalledTimes(2);
    const contents = handler.mock.calls.map((c) => c[0].content).sort();
    expect(contents).toEqual(['A1\nA2', 'B1']);
  });

  it('mediaPath 消息绕过合并 + 立即 flush 当前 buffer', async () => {
    const handler = vi.fn();
    const c = new DebounceCoalescer(DEFAULT_DEBOUNCE_CONFIG, handler);
    c.enqueue(makeMsg({ content: 'pre1' }));
    c.enqueue(makeMsg({ content: 'pre2' }));
    c.enqueue(makeMsg({ content: '看图', mediaPath: '/tmp/img.jpg' }));
    // mediaPath 消息触发：先 flush pre1+pre2 合并，再独立 deliver media 消息
    await vi.advanceTimersByTimeAsync(0);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0]![0].content).toBe('pre1\npre2');
    expect(handler.mock.calls[1]![0].content).toBe('看图');
    expect(handler.mock.calls[1]![0].mediaPath).toBe('/tmp/img.jpg');
  });

  it('quoted 引用消息：上一窗口立即 flush，新消息独立 deliver', async () => {
    const handler = vi.fn();
    const c = new DebounceCoalescer(DEFAULT_DEBOUNCE_CONFIG, handler);
    c.enqueue(makeMsg({ content: '我刚才说错了' }));
    c.enqueue(
      makeMsg({
        content: '应该是这样',
        quoted: { messageId: 'om_orig', senderName: '我', content: '原文' } as never,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0]![0].content).toBe('我刚才说错了');
    expect(handler.mock.calls[1]![0].content).toBe('应该是这样');
    expect(handler.mock.calls[1]![0].quoted).toBeDefined();
  });

  it('broadcastTargets 消息绕过合并', async () => {
    const handler = vi.fn();
    const c = new DebounceCoalescer(DEFAULT_DEBOUNCE_CONFIG, handler);
    c.enqueue(makeMsg({ content: 'normal' }));
    c.enqueue(
      makeMsg({
        content: 'fanout',
        broadcastTargets: ['agent_a', 'agent_b'],
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0]![0].content).toBe('normal');
    expect(handler.mock.calls[1]![0].broadcastTargets).toEqual(['agent_a', 'agent_b']);
  });

  it('shutdown 立即 flush 所有 buffer', async () => {
    const handler = vi.fn();
    const c = new DebounceCoalescer(DEFAULT_DEBOUNCE_CONFIG, handler);
    c.enqueue(makeMsg({ peerId: 'A', content: 'a' }));
    c.enqueue(makeMsg({ peerId: 'B', content: 'b' }));
    expect(c.pendingSessionCount).toBe(2);

    c.shutdown();
    await vi.advanceTimersByTimeAsync(0);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(c.pendingSessionCount).toBe(0);
  });

  it('handler 抛错被吞掉：不影响后续消息', async () => {
    const handler = vi.fn().mockRejectedValueOnce(new Error('boom'));
    const c = new DebounceCoalescer(DEFAULT_DEBOUNCE_CONFIG, handler);
    c.enqueue(makeMsg({ content: 'first' }));
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_CONFIG.quietWindowMs + 10);
    // handler 抛错但不抛出到 enqueue 之外
    c.enqueue(makeMsg({ content: 'second' }));
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_CONFIG.quietWindowMs + 10);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
