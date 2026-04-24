/**
 * PR4 测试：流式卡片 (Phase G) + 事件处理器 (Phase H)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { beginStreamingCard } from '../../channel/adapters/feishu/cardkit-streaming.js';
import {
  registerOtherEventHandlers,
  type FeishuEventCallbacks,
} from '../../channel/adapters/feishu/event-handlers.js';
import { FeishuApiError } from '../../channel/adapters/feishu/outbound.js';

// ─── 流式卡片 ────────────────────────────────────────────────────────

function makeStreamingClient(overrides?: {
  createCard?: any;
  updateCard?: any;
  updateContent?: any;
  sendMessage?: any;
}) {
  return {
    cardkit: {
      v1: {
        card: {
          create:
            overrides?.createCard ??
            vi.fn().mockResolvedValue({ code: 0, data: { card_id: 'card_1' } }),
          update: overrides?.updateCard ?? vi.fn().mockResolvedValue({ code: 0 }),
        },
        cardElement: {
          content:
            overrides?.updateContent ?? vi.fn().mockResolvedValue({ code: 0 }),
        },
      },
    },
    im: {
      v1: {
        message: {
          create:
            overrides?.sendMessage ??
            vi.fn().mockResolvedValue({
              code: 0,
              data: { message_id: 'om_stream_1' },
            }),
        },
      },
    },
  };
}

describe('beginStreamingCard', () => {
  it('创建 card + 发送消息，返回 handle', async () => {
    const client = makeStreamingClient();
    const h = await beginStreamingCard(client as any, 'ou_u', {
      placeholder: '思考中…',
      idleTimeoutMs: 0,
    }, 'private');

    expect(client.cardkit.v1.card.create).toHaveBeenCalled();
    expect(client.im.v1.message.create).toHaveBeenCalled();
    expect(h.cardId).toBe('card_1');
    expect(h.messageId).toBe('om_stream_1');
    expect(h.closed).toBe(false);
    await h.finish();
    expect(h.closed).toBe(true);
  });

  it('发送路径使用 resolveFeishuReceiveId 剥离群 scope 后缀', async () => {
    const client = makeStreamingClient();
    await beginStreamingCard(
      client as any,
      'oc_x:sender:ou_u',
      { idleTimeoutMs: 0 },
      'group',
    );
    const call = client.im.v1.message.create.mock.calls[0][0];
    expect(call.params.receive_id_type).toBe('chat_id');
    expect(call.data.receive_id).toBe('oc_x');
    expect(call.data.msg_type).toBe('interactive');
    // content 指向 card_id 而非卡 JSON
    const content = JSON.parse(call.data.content);
    expect(content.type).toBe('card');
    expect(content.data.card_id).toBe('card_1');
  });

  it('CardKit.create 失败抛 FeishuApiError', async () => {
    const client = makeStreamingClient({
      createCard: vi
        .fn()
        .mockResolvedValue({ code: 404010, msg: 'quota' }),
    });
    await expect(
      beginStreamingCard(client as any, 'ou_u', { idleTimeoutMs: 0 }),
    ).rejects.toBeInstanceOf(FeishuApiError);
  });

  it('append 调用 cardElement.content 且 sequence 递增', async () => {
    const client = makeStreamingClient();
    const h = await beginStreamingCard(client as any, 'ou_u', { idleTimeoutMs: 0 });

    await h.append('第一段');
    await h.append('第一段第二段');

    expect(client.cardkit.v1.cardElement.content).toHaveBeenCalledTimes(2);
    const seq1 = client.cardkit.v1.cardElement.content.mock.calls[0][0].data
      .sequence;
    const seq2 = client.cardkit.v1.cardElement.content.mock.calls[1][0].data
      .sequence;
    expect(seq2).toBeGreaterThan(seq1);
  });

  it('finish 调用 card.update 关闭流式，closed=true', async () => {
    const client = makeStreamingClient();
    const h = await beginStreamingCard(client as any, 'ou_u', { idleTimeoutMs: 0 });
    await h.append('hello');
    await h.finish();
    expect(client.cardkit.v1.card.update).toHaveBeenCalled();
    expect(h.closed).toBe(true);
  });

  it('finish 后再 append 抛错', async () => {
    const client = makeStreamingClient();
    const h = await beginStreamingCard(client as any, 'ou_u', { idleTimeoutMs: 0 });
    await h.finish();
    await expect(h.append('x')).rejects.toThrow(/已关闭/);
  });

  it('abort 标记卡片为"已取消"', async () => {
    const client = makeStreamingClient();
    const h = await beginStreamingCard(client as any, 'ou_u', { idleTimeoutMs: 0 });
    await h.abort('user-cancelled');
    const updateCall = client.cardkit.v1.card.update.mock.calls[0][0];
    const card = JSON.parse(updateCall.data.card.data);
    const body = card.body.elements[0].content;
    expect(body).toContain('已取消');
    expect(h.closed).toBe(true);
  });

  it('空闲看门狗超时后自动 finish', async () => {
    const client = makeStreamingClient();
    const h = await beginStreamingCard(client as any, 'ou_u', {
      idleTimeoutMs: 50,
    });
    await new Promise((r) => setTimeout(r, 120));
    expect(h.closed).toBe(true);
    // update 被触发
    expect(client.cardkit.v1.card.update).toHaveBeenCalled();
    const card = JSON.parse(
      client.cardkit.v1.card.update.mock.calls[0][0].data.card.data,
    );
    const body = card.body.elements[0].content;
    expect(body).toContain('已超时');
  });

  it('append 失败抛 FeishuApiError', async () => {
    const client = makeStreamingClient({
      updateContent: vi.fn().mockResolvedValue({ code: 10001, msg: 'bad' }),
    });
    const h = await beginStreamingCard(client as any, 'ou_u', { idleTimeoutMs: 0 });
    await expect(h.append('x')).rejects.toBeInstanceOf(FeishuApiError);
  });
});

// ─── 事件处理器 ──────────────────────────────────────────────────────

describe('registerOtherEventHandlers', () => {
  let handlers: Record<string, (data: unknown) => Promise<void>>;
  let callbacks: FeishuEventCallbacks;
  const dispatcher = {
    register: (h: Record<string, (data: unknown) => Promise<void>>) => {
      handlers = { ...handlers, ...h };
      return dispatcher;
    },
  } as any;

  beforeEach(() => {
    handlers = {};
    callbacks = {};
    registerOtherEventHandlers(dispatcher, {
      getCallbacks: () => callbacks,
      getAccountId: () => 'cli_test',
    });
  });

  it('reaction.created_v1 触发 onReactionCreated', async () => {
    const spy = vi.fn();
    callbacks.onReactionCreated = spy;
    await handlers['im.message.reaction.created_v1']!({
      message_id: 'om_x',
      reaction_type: { emoji_type: 'LAUGH' },
      user_id: { open_id: 'ou_u' },
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0].reaction_type.emoji_type).toBe('LAUGH');
  });

  it('reaction.deleted_v1 触发 onReactionDeleted', async () => {
    const spy = vi.fn();
    callbacks.onReactionDeleted = spy;
    await handlers['im.message.reaction.deleted_v1']!({
      message_id: 'om_x',
      reaction_type: { emoji_type: 'HEART' },
    });
    expect(spy).toHaveBeenCalledOnce();
  });

  it('bot.added_v1 触发 onBotAddedToChat', async () => {
    const spy = vi.fn();
    callbacks.onBotAddedToChat = spy;
    await handlers['im.chat.member.bot.added_v1']!({
      chat_id: 'oc_x',
      operator_id: { open_id: 'ou_admin' },
    });
    expect(spy).toHaveBeenCalledOnce();
  });

  it('bot.deleted_v1 触发 onBotRemovedFromChat', async () => {
    const spy = vi.fn();
    callbacks.onBotRemovedFromChat = spy;
    await handlers['im.chat.member.bot.deleted_v1']!({
      chat_id: 'oc_x',
    });
    expect(spy).toHaveBeenCalledOnce();
  });

  it('bot_p2p_chat_entered_v1 触发 onP2pChatEntered', async () => {
    const spy = vi.fn();
    callbacks.onP2pChatEntered = spy;
    await handlers['im.chat.access_event.bot_p2p_chat_entered_v1']!({
      chat_id: 'p2p_x',
    });
    expect(spy).toHaveBeenCalledOnce();
  });

  it('未注册回调不抛错（仅记日志）', async () => {
    // 无 callbacks 设置
    await expect(
      handlers['im.message.reaction.created_v1']!({
        message_id: 'om_x',
        reaction_type: { emoji_type: 'OK' },
      }),
    ).resolves.toBeUndefined();
  });

  it('回调抛错被吞（不影响事件链）', async () => {
    callbacks.onReactionCreated = () => {
      throw new Error('business error');
    };
    await expect(
      handlers['im.message.reaction.created_v1']!({
        message_id: 'om_x',
        reaction_type: { emoji_type: 'OK' },
      }),
    ).resolves.toBeUndefined();
  });
});
