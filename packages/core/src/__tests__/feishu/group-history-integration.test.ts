/**
 * 飞书群聊旁听缓冲 inbound 集成测试（Phase A）
 *
 * 覆盖场景：
 * - SC1: 真人未 @ 的消息写入 buffer
 * - SC2: Agent 被 @ 时 content 前缀包含前情提要
 * - SC3: 不同 thread 的 buffer 互不串
 * - SC4: scope=group_sender 时 buffer 仍群级共享
 * - SC5: 私聊不写 buffer
 * - SC6: enabled=false 时完全跳过
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleReceiveMessage,
  __clearInboundDedupe,
  type FeishuReceiveEvent,
  type InboundContext,
} from '../../channel/adapters/feishu/inbound/index.js';
import {
  GroupHistoryBuffer,
  DEFAULT_GROUP_HISTORY_CONFIG,
  type GroupHistoryConfig,
} from '../../channel/adapters/feishu/inbound/group-history.js';

function buildCtx(overrides: {
  buffer?: GroupHistoryBuffer;
  config?: Partial<GroupHistoryConfig>;
  botOpenId?: string | null;
  scope?: 'group' | 'group_sender' | 'group_topic' | 'group_topic_sender';
} = {}): {
  ctx: InboundContext;
  handler: ReturnType<typeof vi.fn>;
  buffer: GroupHistoryBuffer;
  config: GroupHistoryConfig;
} {
  const handler = vi.fn();
  const buffer = overrides.buffer ?? new GroupHistoryBuffer();
  const config: GroupHistoryConfig = {
    ...DEFAULT_GROUP_HISTORY_CONFIG,
    ...overrides.config,
  };
  const ctx: InboundContext = {
    getAccountId: () => 'cli_test',
    getBotOpenId: () => overrides.botOpenId ?? 'ou_bot',
    getHandler: () => handler,
    getGroupSessionScope: () => overrides.scope ?? 'group',
    getGroupHistory: () => buffer,
    getGroupHistoryConfig: () => config,
  };
  return { ctx, handler, buffer, config };
}

function buildEvent(opts: {
  chat_type?: string;
  chat_id?: string;
  message_id?: string;
  content?: string;
  thread_id?: string;
  mentions?: FeishuReceiveEvent['message']['mentions'];
  senderOpenId?: string;
  senderUserId?: string;
}): FeishuReceiveEvent {
  return {
    sender: {
      sender_id: {
        open_id: opts.senderOpenId ?? 'ou_alice',
        user_id: opts.senderUserId,
      },
      sender_type: 'user',
    },
    message: {
      message_id: opts.message_id ?? 'om_1',
      chat_id: opts.chat_id ?? 'oc_group',
      chat_type: opts.chat_type ?? 'group',
      message_type: 'text',
      content: opts.content ?? '{"text":"hi"}',
      mentions: opts.mentions,
      thread_id: opts.thread_id,
    },
  };
}

// 全局去重重置：inbound 模块级 SEEN_MESSAGE_IDS 会跨测试泄露
// 若不清，不同 describe 里复用的 `om_x` 等 messageId 会被当成重复推送忽略
beforeEach(() => {
  __clearInboundDedupe();
});

describe('SC1: 群内真人未 @ 消息写入 buffer', () => {
  it('未 @ 机器人，消息进 buffer 但不触发 handler', async () => {
    const { ctx, handler, buffer } = buildCtx();
    await handleReceiveMessage(
      buildEvent({
        chat_type: 'group',
        chat_id: 'oc_g',
        message_id: 'om_x',
        content: '{"text":"大家看下 X 需求"}',
        mentions: [],
      }),
      ctx,
    );
    expect(handler).not.toHaveBeenCalled();
    const entries = buffer.peek('oc_g', DEFAULT_GROUP_HISTORY_CONFIG);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.body).toBe('大家看下 X 需求');
    expect(entries[0]!.fromBot).toBe(false);
  });
});

describe('SC2: Agent 被 @ 时 content 前缀包含前情提要', () => {
  it('前情提要 + 当前消息拼接', async () => {
    const { ctx, handler, buffer, config } = buildCtx();
    // 先灌 2 条旁听
    buffer.record(
      'oc_g',
      {
        sender: 'ou_alice',
        senderName: '爱丽丝',
        body: '需求是 X',
        timestamp: Date.now() - 60_000,
        messageId: 'om_prev1',
        fromBot: false,
      },
      config,
    );
    buffer.record(
      'oc_g',
      {
        sender: 'ou_bot_a',
        senderName: 'Agent-A',
        body: '收到，评估中',
        timestamp: Date.now() - 30_000,
        messageId: 'om_prev2',
        fromBot: true,
      },
      config,
    );

    await handleReceiveMessage(
      buildEvent({
        chat_type: 'group',
        chat_id: 'oc_g',
        message_id: 'om_now',
        content: '{"text":"帮我看 A 的评估"}',
        mentions: [{ key: '@_bot', id: { open_id: 'ou_bot' }, name: 'Bot' }],
      }),
      ctx,
    );

    expect(handler).toHaveBeenCalledOnce();
    const normalized = handler.mock.calls[0]![0];
    expect(normalized.content).toContain('[群聊前情提要（最近 2 条，不含本条）]');
    expect(normalized.content).toContain('需求是 X');
    expect(normalized.content).toContain('Agent-A（机器人）：收到，评估中');
    expect(normalized.content).toContain('[当前 @ 你的消息]');
    expect(normalized.content).toContain('帮我看 A 的评估');
  });

  it('buffer 空时不加前缀，content 保持原样', async () => {
    const { ctx, handler } = buildCtx();
    await handleReceiveMessage(
      buildEvent({
        chat_type: 'group',
        chat_id: 'oc_g',
        content: '{"text":"开始"}',
        mentions: [{ key: '@_bot', id: { open_id: 'ou_bot' }, name: 'Bot' }],
      }),
      ctx,
    );
    const normalized = handler.mock.calls[0]![0];
    expect(normalized.content).toBe('开始');
    expect(normalized.content).not.toContain('[群聊前情提要');
  });

  it('被 @ 的当前消息写回 buffer 供后续 Agent 看到', async () => {
    const { ctx, buffer, config } = buildCtx();
    await handleReceiveMessage(
      buildEvent({
        chat_type: 'group',
        chat_id: 'oc_g',
        message_id: 'om_at_a',
        content: '{"text":"@A 请评估"}',
        senderOpenId: 'ou_alice',
        mentions: [{ key: '@_bot', id: { open_id: 'ou_bot' }, name: 'Bot' }],
      }),
      ctx,
    );
    const entries = buffer.peek('oc_g', config);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.body).toBe('@A 请评估');
    expect(entries[0]!.fromBot).toBe(false);
  });
});

describe('SC3: 不同 thread 的 buffer 互不串', () => {
  it('thread_id=t1 与 thread_id=t2 分开存', async () => {
    const { ctx, buffer, config } = buildCtx();
    await handleReceiveMessage(
      buildEvent({
        chat_type: 'group',
        chat_id: 'oc_g',
        thread_id: 't1',
        message_id: 'm_t1',
        content: '{"text":"T1 消息"}',
      }),
      ctx,
    );
    await handleReceiveMessage(
      buildEvent({
        chat_type: 'group',
        chat_id: 'oc_g',
        thread_id: 't2',
        message_id: 'm_t2',
        content: '{"text":"T2 消息"}',
      }),
      ctx,
    );
    expect(buffer.peek('oc_g:topic:t1', config)).toHaveLength(1);
    expect(buffer.peek('oc_g:topic:t2', config)).toHaveLength(1);
    expect(buffer.peek('oc_g', config)).toEqual([]);
    expect(buffer.peek('oc_g:topic:t1', config)[0]!.body).toBe('T1 消息');
  });
});

describe('SC4: scope=group_sender 时 buffer 仍按 chatId 级共享', () => {
  it('两个不同 sender 的消息都落到 chatId 键上', async () => {
    const { ctx, buffer, config } = buildCtx({ scope: 'group_sender' });
    await handleReceiveMessage(
      buildEvent({
        chat_type: 'group',
        chat_id: 'oc_g',
        message_id: 'm1',
        content: '{"text":"Alice"}',
        senderOpenId: 'ou_alice',
      }),
      ctx,
    );
    await handleReceiveMessage(
      buildEvent({
        chat_type: 'group',
        chat_id: 'oc_g',
        message_id: 'm2',
        content: '{"text":"Bob"}',
        senderOpenId: 'ou_bob',
      }),
      ctx,
    );
    expect(buffer.peek('oc_g', config)).toHaveLength(2);
    // 不会错存到 sender 后缀的 key
    expect(buffer.peek('oc_g:sender:ou_alice', config)).toEqual([]);
  });
});

describe('SC5: 私聊不写 buffer', () => {
  it('p2p 消息走正常 handler，但不落 buffer', async () => {
    const { ctx, handler, buffer } = buildCtx();
    await handleReceiveMessage(
      buildEvent({
        chat_type: 'p2p',
        chat_id: 'oc_p',
        content: '{"text":"私聊"}',
      }),
      ctx,
    );
    expect(handler).toHaveBeenCalledOnce();
    expect(buffer.size()).toBe(0);
  });
});

describe('SC6: enabled=false 时完全跳过 buffer', () => {
  it('未 @ 消息直接丢弃（维持旧行为），不落 buffer', async () => {
    const { ctx, handler, buffer } = buildCtx({
      config: { enabled: false },
    });
    await handleReceiveMessage(
      buildEvent({
        chat_type: 'group',
        chat_id: 'oc_g',
        content: '{"text":"未 @"}',
        mentions: [],
      }),
      ctx,
    );
    expect(handler).not.toHaveBeenCalled();
    expect(buffer.size()).toBe(0);
  });

  it('已 @ 消息正常处理但 content 不加前缀，也不落 buffer', async () => {
    const { ctx, handler, buffer } = buildCtx({
      config: { enabled: false },
    });
    await handleReceiveMessage(
      buildEvent({
        chat_type: 'group',
        chat_id: 'oc_g',
        content: '{"text":"你好"}',
        mentions: [{ key: '@_bot', id: { open_id: 'ou_bot' }, name: 'Bot' }],
      }),
      ctx,
    );
    const normalized = handler.mock.calls[0]![0];
    expect(normalized.content).toBe('你好');
    expect(buffer.size()).toBe(0);
  });
});

describe('getGroupHistory 缺失时回退为旧行为', () => {
  it('无 buffer 时未 @ 消息被丢弃（历史行为保真）', async () => {
    const handler = vi.fn();
    const ctx: InboundContext = {
      getAccountId: () => 'a',
      getBotOpenId: () => 'ou_bot',
      getHandler: () => handler,
      // 不提供 getGroupHistory / getGroupHistoryConfig
    };
    await handleReceiveMessage(
      buildEvent({
        chat_type: 'group',
        chat_id: 'oc_g',
        content: '{"text":"丢"}',
        mentions: [],
      }),
      ctx,
    );
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('messageId 重复去重', () => {
  it('同 messageId 重复入口只存一次', async () => {
    const { ctx, buffer, config } = buildCtx();
    for (let i = 0; i < 3; i++) {
      await handleReceiveMessage(
        buildEvent({
          chat_type: 'group',
          chat_id: 'oc_g',
          message_id: 'om_dup',
          content: '{"text":"重复"}',
          mentions: [],
        }),
        ctx,
      );
    }
    expect(buffer.peek('oc_g', config)).toHaveLength(1);
  });

  it('飞书服务端重推 —— 相同 messageId 的已 @ 消息只触发 handler 一次', async () => {
    const { ctx, handler } = buildCtx();
    // 第 1 次推送
    await handleReceiveMessage(
      buildEvent({
        chat_type: 'group',
        chat_id: 'oc_g',
        message_id: 'om_same',
        content: '{"text":"你好"}',
        mentions: [{ key: '@_bot', id: { open_id: 'ou_bot' }, name: 'Bot' }],
      }),
      ctx,
    );
    // 服务端重推（18 秒后那种场景）
    await handleReceiveMessage(
      buildEvent({
        chat_type: 'group',
        chat_id: 'oc_g',
        message_id: 'om_same',
        content: '{"text":"你好"}',
        mentions: [{ key: '@_bot', id: { open_id: 'ou_bot' }, name: 'Bot' }],
      }),
      ctx,
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('adapter 发送回写 buffer（通过单独模块测试更稳定，这里占位）', () => {
  beforeEach(() => {
    // 实际 adapter 层的回写逻辑由 adapter.test.ts 覆盖
  });
  it('占位：adapter 层 recordBotReplyToGroupHistory 在 adapter.test.ts 覆盖', () => {
    expect(true).toBe(true);
  });
});
