/**
 * 飞书 Topic Threading 测试
 *
 * 验证 topic 内消息走 reply API（让回复留在话题），非 topic 走 create API。
 *
 * 对应修复：Hermes commit 441ef75d1 — 飞书话题内消息必须用 reply API + reply_in_thread:true
 * 才能保持线程，普通 create 即使带 receive_id_type='thread_id' 也不被 API 接受。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordThreadAnchor,
  getThreadAnchor,
  clearThreadAnchors,
  getThreadAnchorSize,
} from '../../channel/adapters/feishu/outbound/thread-anchor.js';
import {
  resolveFeishuOutboundRoute,
  sendByRoute,
  sendTextMessage,
  inferReceiveIdType,
  resolveFeishuReceiveId,
  FeishuApiError,
} from '../../channel/adapters/feishu/outbound/index.js';
import { sendInteractiveCard } from '../../channel/adapters/feishu/card/send-card.js';

// ─── thread-anchor 注册表 ────────────────────────────────────────────────

describe('thread-anchor registry', () => {
  beforeEach(() => clearThreadAnchors());

  it('记录后能查到', () => {
    recordThreadAnchor('oc_chat1', 'omt_t1', 'om_msg1');
    expect(getThreadAnchor('oc_chat1', 'omt_t1')).toBe('om_msg1');
  });

  it('未注册返回 null', () => {
    expect(getThreadAnchor('oc_chat1', 'omt_t1')).toBeNull();
  });

  it('同 (chatId, threadId) 重复 record 用最新 messageId', () => {
    recordThreadAnchor('oc_chat1', 'omt_t1', 'om_old');
    recordThreadAnchor('oc_chat1', 'omt_t1', 'om_new');
    expect(getThreadAnchor('oc_chat1', 'omt_t1')).toBe('om_new');
  });

  it('不同话题各自独立', () => {
    recordThreadAnchor('oc_chat1', 'omt_a', 'om_a');
    recordThreadAnchor('oc_chat1', 'omt_b', 'om_b');
    recordThreadAnchor('oc_chat2', 'omt_a', 'om_c'); // 不同 chat 同 threadId
    expect(getThreadAnchor('oc_chat1', 'omt_a')).toBe('om_a');
    expect(getThreadAnchor('oc_chat1', 'omt_b')).toBe('om_b');
    expect(getThreadAnchor('oc_chat2', 'omt_a')).toBe('om_c');
  });

  it('空参数静默跳过（防止意外清空）', () => {
    recordThreadAnchor('', 'omt_t1', 'om1');
    recordThreadAnchor('oc_chat1', '', 'om1');
    recordThreadAnchor('oc_chat1', 'omt_t1', '');
    expect(getThreadAnchorSize()).toBe(0);
  });

  it('LRU 重排：访问活跃话题刷新位置', () => {
    // 先放两条
    recordThreadAnchor('oc_chat', 'omt_old', 'om_old');
    recordThreadAnchor('oc_chat', 'omt_new', 'om_new');

    // 访问 omt_old → 它被刷到末尾
    getThreadAnchor('oc_chat', 'omt_old');

    // 再访问 omt_new 不影响 omt_old 的"最近访问"地位
    expect(getThreadAnchor('oc_chat', 'omt_old')).toBe('om_old');
    expect(getThreadAnchor('oc_chat', 'omt_new')).toBe('om_new');
  });
});

// ─── resolveFeishuOutboundRoute 决策 ─────────────────────────────────────

describe('resolveFeishuOutboundRoute', () => {
  beforeEach(() => clearThreadAnchors());

  it('private 走 create + open_id', () => {
    const route = resolveFeishuOutboundRoute('ou_user', 'private');
    expect(route).toEqual({
      kind: 'create',
      receiveId: 'ou_user',
      receiveIdType: 'open_id',
    });
  });

  it('未指定 chatType 走 create + open_id', () => {
    const route = resolveFeishuOutboundRoute('anything');
    expect(route).toEqual({
      kind: 'create',
      receiveId: 'anything',
      receiveIdType: 'open_id',
    });
  });

  it('group 无后缀走 create + chat_id', () => {
    const route = resolveFeishuOutboundRoute('oc_chat1', 'group');
    expect(route).toEqual({
      kind: 'create',
      receiveId: 'oc_chat1',
      receiveIdType: 'chat_id',
    });
  });

  it('group_sender 后缀剥离后走 create + chat_id', () => {
    const route = resolveFeishuOutboundRoute('oc_chat1:sender:ou_u', 'group');
    expect(route).toEqual({
      kind: 'create',
      receiveId: 'oc_chat1',
      receiveIdType: 'chat_id',
    });
  });

  it('group_topic 有锚点：走 reply', () => {
    recordThreadAnchor('oc_chat1', 'omt_t1', 'om_anchor');
    const route = resolveFeishuOutboundRoute('oc_chat1:topic:omt_t1', 'group');
    expect(route).toEqual({
      kind: 'reply',
      parentMessageId: 'om_anchor',
    });
  });

  it('group_topic_sender 有锚点：走 reply', () => {
    recordThreadAnchor('oc_chat1', 'omt_t1', 'om_anchor');
    const route = resolveFeishuOutboundRoute('oc_chat1:topic:omt_t1:sender:ou_u', 'group');
    expect(route).toEqual({
      kind: 'reply',
      parentMessageId: 'om_anchor',
    });
  });

  it('group_topic 无锚点：降级 chat_id（让消息至少能发出去）', () => {
    const route = resolveFeishuOutboundRoute('oc_chat1:topic:omt_t1', 'group');
    expect(route).toEqual({
      kind: 'create',
      receiveId: 'oc_chat1',
      receiveIdType: 'chat_id',
    });
  });
});

// ─── sendByRoute API 分发 ────────────────────────────────────────────────

function makeReplyClient(replyImpl?: (args: unknown) => unknown) {
  const create = vi.fn().mockResolvedValue({ code: 0, data: { message_id: 'om_create_1' } });
  const reply = vi
    .fn()
    .mockImplementation(
      replyImpl ??
        (() => Promise.resolve({ code: 0, data: { message_id: 'om_reply_1' } })),
    );
  return {
    im: { v1: { message: { create, reply } } },
    create,
    reply,
  };
}

describe('sendByRoute dispatch', () => {
  it('reply 路径：调 message.reply 带 reply_in_thread:true', async () => {
    const c = makeReplyClient();
    const result = await sendByRoute(
      c as never,
      { kind: 'reply', parentMessageId: 'om_parent' },
      'text',
      JSON.stringify({ text: 'hi' }),
    );
    expect(c.reply).toHaveBeenCalledTimes(1);
    expect(c.create).not.toHaveBeenCalled();
    const call = c.reply.mock.calls[0]![0] as {
      path: { message_id: string };
      data: { content: string; msg_type: string; reply_in_thread: boolean };
    };
    expect(call.path.message_id).toBe('om_parent');
    expect(call.data.msg_type).toBe('text');
    expect(call.data.reply_in_thread).toBe(true);
    expect(result.messageId).toBe('om_reply_1');
  });

  it('create 路径：调 message.create 带 receive_id_type', async () => {
    const c = makeReplyClient();
    const result = await sendByRoute(
      c as never,
      { kind: 'create', receiveId: 'oc_chat1', receiveIdType: 'chat_id' },
      'text',
      JSON.stringify({ text: 'hi' }),
    );
    expect(c.create).toHaveBeenCalledTimes(1);
    expect(c.reply).not.toHaveBeenCalled();
    const call = c.create.mock.calls[0]![0] as {
      params: { receive_id_type: string };
      data: { receive_id: string };
    };
    expect(call.params.receive_id_type).toBe('chat_id');
    expect(call.data.receive_id).toBe('oc_chat1');
    expect(result.messageId).toBe('om_create_1');
  });

  it('reply 失败 → 抛 FeishuApiError', async () => {
    const c = makeReplyClient(() =>
      Promise.resolve({ code: 230003, msg: 'parent message not found' }),
    );
    await expect(
      sendByRoute(c as never, { kind: 'reply', parentMessageId: 'om_x' }, 'text', '{}'),
    ).rejects.toBeInstanceOf(FeishuApiError);
  });
});

// ─── 集成：sendTextMessage / sendInteractiveCard 端到端 ──────────────────

describe('sendTextMessage 集成', () => {
  beforeEach(() => clearThreadAnchors());

  it('group_topic peerId + 锚点：走 reply API（消息留在话题内）', async () => {
    recordThreadAnchor('oc_chat1', 'omt_t1', 'om_anchor');
    const c = makeReplyClient();
    await sendTextMessage(c as never, 'oc_chat1:topic:omt_t1', '回复', 'group');
    expect(c.reply).toHaveBeenCalledTimes(1);
    expect(c.create).not.toHaveBeenCalled();
    const call = c.reply.mock.calls[0]![0] as {
      data: { reply_in_thread: boolean };
    };
    expect(call.data.reply_in_thread).toBe(true);
  });

  it('group_topic peerId 无锚点：降级 create（避免抛错让用户白等）', async () => {
    const c = makeReplyClient();
    await sendTextMessage(c as never, 'oc_chat1:topic:omt_t1', '回复', 'group');
    expect(c.create).toHaveBeenCalledTimes(1);
    expect(c.reply).not.toHaveBeenCalled();
    const call = c.create.mock.calls[0]![0] as {
      data: { receive_id: string };
    };
    expect(call.data.receive_id).toBe('oc_chat1');
  });

  it('group 无 topic 后缀：走 create + chat_id（旧行为保持不变）', async () => {
    const c = makeReplyClient();
    await sendTextMessage(c as never, 'oc_chat1', '群消息', 'group');
    expect(c.create).toHaveBeenCalledTimes(1);
    const call = c.create.mock.calls[0]![0] as {
      data: { receive_id: string };
      params: { receive_id_type: string };
    };
    expect(call.data.receive_id).toBe('oc_chat1');
    expect(call.params.receive_id_type).toBe('chat_id');
  });

  it('private peerId：走 create + open_id（旧行为保持不变）', async () => {
    const c = makeReplyClient();
    await sendTextMessage(c as never, 'ou_user', '私聊', 'private');
    expect(c.create).toHaveBeenCalledTimes(1);
    const call = c.create.mock.calls[0]![0] as {
      params: { receive_id_type: string };
    };
    expect(call.params.receive_id_type).toBe('open_id');
  });
});

describe('sendInteractiveCard 集成', () => {
  beforeEach(() => clearThreadAnchors());

  it('topic 内卡片走 reply API + reply_in_thread:true', async () => {
    recordThreadAnchor('oc_chat1', 'omt_t1', 'om_anchor');
    const c = makeReplyClient();
    const card = { elements: [], header: { title: { tag: 'plain_text' as const, content: 'X' } } };
    const id = await sendInteractiveCard(c as never, 'oc_chat1:topic:omt_t1', card, 'group');
    expect(c.reply).toHaveBeenCalledTimes(1);
    expect(c.create).not.toHaveBeenCalled();
    const call = c.reply.mock.calls[0]![0] as {
      data: { msg_type: string; reply_in_thread: boolean };
    };
    expect(call.data.msg_type).toBe('interactive');
    expect(call.data.reply_in_thread).toBe(true);
    expect(id).toBe('om_reply_1');
  });

  it('非 topic 卡片走 create API（兼容旧行为）', async () => {
    const c = makeReplyClient();
    const card = { elements: [] };
    await sendInteractiveCard(c as never, 'oc_chat1', card, 'group');
    expect(c.create).toHaveBeenCalledTimes(1);
    expect(c.reply).not.toHaveBeenCalled();
  });
});

// ─── 旧 API 向后兼容 ─────────────────────────────────────────────────────

describe('旧 API 向后兼容', () => {
  it('inferReceiveIdType 行为不变', () => {
    expect(inferReceiveIdType('group')).toBe('chat_id');
    expect(inferReceiveIdType('private')).toBe('open_id');
    expect(inferReceiveIdType()).toBe('open_id');
  });

  it('resolveFeishuReceiveId 行为不变（topic 仍返回 chatId 是已知 buggy 行为，仅向后兼容）', () => {
    expect(resolveFeishuReceiveId('oc_x', 'group')).toBe('oc_x');
    expect(resolveFeishuReceiveId('oc_x:sender:ou_u', 'group')).toBe('oc_x');
    expect(resolveFeishuReceiveId('oc_x:topic:t1', 'group')).toBe('oc_x'); // 已知不识别 topic
    expect(resolveFeishuReceiveId('ou_user', 'private')).toBe('ou_user');
    expect(resolveFeishuReceiveId('anything')).toBe('anything');
  });
});
