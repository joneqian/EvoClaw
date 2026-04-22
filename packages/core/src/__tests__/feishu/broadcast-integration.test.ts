/**
 * 飞书 Broadcast inbound 集成测试（Phase B）
 *
 * 覆盖：
 * - SC7: any-mention 模式下 @ 任一配置 agent → fanout 全体
 * - SC8: mention-first 模式下按 @ 精确激活
 * - SC9: 未命中 peerId → 不激活广播（msg.broadcastTargets 留空）
 * - SC10: @_all 触发 any-mention
 * - SC11: peerId 经 session scope 重写后仍按原始 chat_id 匹配配置
 * - SC12: enabled=false 完全跳过
 */

import { describe, it, expect, vi } from 'vitest';
import {
  handleReceiveMessage,
  type FeishuReceiveEvent,
  type InboundContext,
} from '../../channel/adapters/feishu/inbound.js';
import {
  DEFAULT_BROADCAST_CONFIG,
  type BroadcastConfig,
} from '../../channel/adapters/feishu/broadcast.js';
import {
  GroupHistoryBuffer,
  DEFAULT_GROUP_HISTORY_CONFIG,
} from '../../channel/adapters/feishu/group-history.js';

function buildCtx(overrides: {
  broadcast?: Partial<BroadcastConfig>;
  botOpenId?: string | null;
  botIdToAgentId?: Record<string, string>;
  scope?: 'group' | 'group_sender' | 'group_topic' | 'group_topic_sender';
  historyEnabled?: boolean;
} = {}): {
  ctx: InboundContext;
  handler: ReturnType<typeof vi.fn>;
} {
  const handler = vi.fn();
  const broadcastConfig: BroadcastConfig = {
    ...DEFAULT_BROADCAST_CONFIG,
    ...overrides.broadcast,
  };
  const ctx: InboundContext = {
    getAccountId: () => 'cli_test',
    getBotOpenId: () => overrides.botOpenId ?? 'ou_bot',
    getHandler: () => handler,
    getGroupSessionScope: () => overrides.scope ?? 'group',
    getGroupHistory: () => new GroupHistoryBuffer(),
    getGroupHistoryConfig: () => ({
      ...DEFAULT_GROUP_HISTORY_CONFIG,
      enabled: overrides.historyEnabled ?? true,
    }),
    getBroadcastConfig: () => broadcastConfig,
    getBotIdToAgentId: () => overrides.botIdToAgentId ?? {},
  };
  return { ctx, handler };
}

function ev(opts: {
  chat_id?: string;
  chat_type?: string;
  message_id?: string;
  content?: string;
  mentions?: FeishuReceiveEvent['message']['mentions'];
  senderOpenId?: string;
  thread_id?: string;
}): FeishuReceiveEvent {
  return {
    sender: {
      sender_id: { open_id: opts.senderOpenId ?? 'ou_alice' },
      sender_type: 'user',
    },
    message: {
      message_id: opts.message_id ?? 'om_x',
      chat_id: opts.chat_id ?? 'oc_g',
      chat_type: opts.chat_type ?? 'group',
      message_type: 'text',
      content: opts.content ?? '{"text":"hi"}',
      mentions: opts.mentions,
      thread_id: opts.thread_id,
    },
  };
}

describe('SC7: any-mention 模式下 @ 任一配置 agent → fanout 全体', () => {
  it('@ 共享 bot 且 botIdToAgentId 有映射时激活全体', async () => {
    const { ctx, handler } = buildCtx({
      broadcast: {
        enabled: true,
        triggerMode: 'any-mention',
        peerAgents: { oc_g: ['agent-a', 'agent-b', 'agent-c'] },
      },
      botIdToAgentId: { ou_bot: 'agent-a' },
    });
    await handleReceiveMessage(
      ev({
        mentions: [{ key: '@_bot', id: { open_id: 'ou_bot' }, name: 'Bot' }],
      }),
      ctx,
    );
    expect(handler).toHaveBeenCalledOnce();
    const msg = handler.mock.calls[0]![0];
    expect(msg.broadcastTargets).toEqual(['agent-a', 'agent-b', 'agent-c']);
  });

  it('@ 未映射的 bot（botIdToAgentId 空）时不激活广播', async () => {
    const { ctx, handler } = buildCtx({
      broadcast: {
        enabled: true,
        triggerMode: 'any-mention',
        peerAgents: { oc_g: ['agent-a', 'agent-b'] },
      },
      botIdToAgentId: {},
    });
    await handleReceiveMessage(
      ev({
        mentions: [{ key: '@_bot', id: { open_id: 'ou_bot' }, name: 'Bot' }],
      }),
      ctx,
    );
    const msg = handler.mock.calls[0]![0];
    expect(msg.broadcastTargets).toBeUndefined();
  });
});

describe('SC8: mention-first 只激活被 @ 的 agent', () => {
  it('@ agent-a 只激活 agent-a', async () => {
    const { ctx, handler } = buildCtx({
      broadcast: {
        enabled: true,
        triggerMode: 'mention-first',
        peerAgents: { oc_g: ['agent-a', 'agent-b', 'agent-c'] },
      },
      botIdToAgentId: { ou_bot_a: 'agent-a', ou_bot_b: 'agent-b' },
      botOpenId: 'ou_bot_a',
    });
    await handleReceiveMessage(
      ev({
        mentions: [{ key: '@_a', id: { open_id: 'ou_bot_a' }, name: 'A' }],
      }),
      ctx,
    );
    const msg = handler.mock.calls[0]![0];
    expect(msg.broadcastTargets).toEqual(['agent-a']);
  });

  it('@ agent-a 与 agent-b 激活两者', async () => {
    const { ctx, handler } = buildCtx({
      broadcast: {
        enabled: true,
        triggerMode: 'mention-first',
        peerAgents: { oc_g: ['agent-a', 'agent-b', 'agent-c'] },
      },
      botIdToAgentId: {
        ou_bot_a: 'agent-a',
        ou_bot_b: 'agent-b',
      },
      botOpenId: 'ou_bot_a', // inbound @ 过滤放行需要任一被匹配
    });
    await handleReceiveMessage(
      ev({
        mentions: [
          { key: '@_a', id: { open_id: 'ou_bot_a' }, name: 'A' },
          { key: '@_b', id: { open_id: 'ou_bot_b' }, name: 'B' },
        ],
      }),
      ctx,
    );
    const msg = handler.mock.calls[0]![0];
    expect(msg.broadcastTargets).toEqual(['agent-a', 'agent-b']);
  });
});

describe('SC9: peerId 不在 peerAgents → broadcastTargets 未设置', () => {
  it('其他群不受影响', async () => {
    const { ctx, handler } = buildCtx({
      broadcast: {
        enabled: true,
        triggerMode: 'any-mention',
        peerAgents: { oc_other: ['agent-a'] },
      },
      botIdToAgentId: { ou_bot: 'agent-a' },
    });
    await handleReceiveMessage(
      ev({
        chat_id: 'oc_g',
        mentions: [{ key: '@_bot', id: { open_id: 'ou_bot' }, name: 'Bot' }],
      }),
      ctx,
    );
    const msg = handler.mock.calls[0]![0];
    expect(msg.broadcastTargets).toBeUndefined();
  });
});

describe('SC10: @_all 在 any-mention 下激活全体', () => {
  it('@_all 触发', async () => {
    const { ctx, handler } = buildCtx({
      broadcast: {
        enabled: true,
        triggerMode: 'any-mention',
        peerAgents: { oc_g: ['agent-a', 'agent-b'] },
      },
    });
    await handleReceiveMessage(
      ev({
        mentions: [{ key: '@_all', id: {}, name: '@所有人' }],
      }),
      ctx,
    );
    const msg = handler.mock.calls[0]![0];
    expect(msg.broadcastTargets).toEqual(['agent-a', 'agent-b']);
  });
});

describe('SC11: peerId 使用原始 chat_id 匹配配置', () => {
  it('group_sender scope 下 peerId 被重写但 broadcast 仍按 chat_id 匹配', async () => {
    const { ctx, handler } = buildCtx({
      scope: 'group_sender',
      broadcast: {
        enabled: true,
        triggerMode: 'any-mention',
        peerAgents: { oc_g: ['agent-a', 'agent-b'] },
      },
      botIdToAgentId: { ou_bot: 'agent-a' },
    });
    await handleReceiveMessage(
      ev({
        chat_id: 'oc_g',
        senderOpenId: 'ou_alice',
        mentions: [{ key: '@_bot', id: { open_id: 'ou_bot' }, name: 'Bot' }],
      }),
      ctx,
    );
    const msg = handler.mock.calls[0]![0];
    expect(msg.peerId).toBe('oc_g:sender:ou_alice'); // scope 重写
    expect(msg.broadcastTargets).toEqual(['agent-a', 'agent-b']); // broadcast 命中
  });
});

describe('SC12: broadcast.enabled=false 完全跳过', () => {
  it('不会设置 broadcastTargets', async () => {
    const { ctx, handler } = buildCtx({
      broadcast: {
        enabled: false,
        triggerMode: 'always',
        peerAgents: { oc_g: ['agent-a', 'agent-b'] },
      },
    });
    await handleReceiveMessage(
      ev({
        mentions: [{ key: '@_bot', id: { open_id: 'ou_bot' }, name: 'Bot' }],
      }),
      ctx,
    );
    const msg = handler.mock.calls[0]![0];
    expect(msg.broadcastTargets).toBeUndefined();
  });
});

describe('私聊 chat_type=p2p 不受 broadcast 影响', () => {
  it('p2p 消息不设置 broadcastTargets', async () => {
    const { ctx, handler } = buildCtx({
      broadcast: {
        enabled: true,
        triggerMode: 'always',
        peerAgents: { oc_g: ['agent-a'] },
      },
    });
    await handleReceiveMessage(
      ev({ chat_type: 'p2p', chat_id: 'oc_g' }),
      ctx,
    );
    const msg = handler.mock.calls[0]![0];
    expect(msg.broadcastTargets).toBeUndefined();
  });
});

describe('always 模式：任何 @ 过滤后的群消息都 fanout', () => {
  it('触发全体 agent', async () => {
    const { ctx, handler } = buildCtx({
      broadcast: {
        enabled: true,
        triggerMode: 'always',
        peerAgents: { oc_g: ['agent-a', 'agent-b'] },
      },
    });
    await handleReceiveMessage(
      ev({
        mentions: [{ key: '@_bot', id: { open_id: 'ou_bot' }, name: 'Bot' }],
      }),
      ctx,
    );
    const msg = handler.mock.calls[0]![0];
    expect(msg.broadcastTargets).toEqual(['agent-a', 'agent-b']);
  });
});
