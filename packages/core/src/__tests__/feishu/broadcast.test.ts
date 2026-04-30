/**
 * 飞书 Broadcast 模式单元测试（Phase B）
 */

import { describe, it, expect } from 'vitest';
import {
  resolveBroadcastTargets,
  extractMentionedAgentIds,
  buildBroadcastDedupeKey,
  DEFAULT_BROADCAST_CONFIG,
  BROADCAST_TRIGGER_MODES,
  BROADCAST_TRIGGER_LABELS,
  type BroadcastConfig,
} from '../../channel/adapters/feishu/outbound/broadcast.js';
import type { FeishuReceiveEvent } from '../../channel/adapters/feishu/inbound/index.js';

type Mentions = FeishuReceiveEvent['message']['mentions'];

function cfg(overrides: Partial<BroadcastConfig> = {}): BroadcastConfig {
  return { ...DEFAULT_BROADCAST_CONFIG, ...overrides };
}

describe('resolveBroadcastTargets', () => {
  const botIdToAgentId: Record<string, string> = {
    ou_bot_a: 'agent-a',
    ou_bot_b: 'agent-b',
    ou_bot_c: 'agent-c',
  };

  it('enabled=false 时返回 null', () => {
    const r = resolveBroadcastTargets({
      config: cfg({ enabled: false, peerAgents: { oc_x: ['agent-a'] } }),
      peerId: 'oc_x',
      mentions: [],
    });
    expect(r).toBeNull();
  });

  it('peerId 不在 peerAgents 中返回 null', () => {
    const r = resolveBroadcastTargets({
      config: cfg({ enabled: true, peerAgents: { oc_x: ['agent-a'] } }),
      peerId: 'oc_other',
      mentions: [],
    });
    expect(r).toBeNull();
  });

  it('peerAgents 列表为空返回 null', () => {
    const r = resolveBroadcastTargets({
      config: cfg({ enabled: true, peerAgents: { oc_x: [] } }),
      peerId: 'oc_x',
      mentions: [],
    });
    expect(r).toBeNull();
  });

  it('triggerMode=always 无视 mentions，始终返回全体配置 agent', () => {
    const r = resolveBroadcastTargets({
      config: cfg({
        enabled: true,
        triggerMode: 'always',
        peerAgents: { oc_x: ['agent-a', 'agent-b', 'agent-c'] },
      }),
      peerId: 'oc_x',
      mentions: [],
    });
    expect(r).toEqual(['agent-a', 'agent-b', 'agent-c']);
  });

  describe('triggerMode=mention-first', () => {
    it('@ 了列表中两个 agent，只激活那两个', () => {
      const mentions: Mentions = [
        { key: '@_a', id: { open_id: 'ou_bot_a' }, name: 'A' },
        { key: '@_b', id: { open_id: 'ou_bot_b' }, name: 'B' },
      ];
      const r = resolveBroadcastTargets({
        config: cfg({
          enabled: true,
          triggerMode: 'mention-first',
          peerAgents: { oc_x: ['agent-a', 'agent-b', 'agent-c'] },
        }),
        peerId: 'oc_x',
        botIdToAgentId,
        mentions,
      });
      expect(r).toEqual(['agent-a', 'agent-b']);
    });

    it('@ 了一个非列表 agent，返回 null', () => {
      const mentions: Mentions = [
        { key: '@_x', id: { open_id: 'ou_bot_unknown' }, name: 'X' },
      ];
      const r = resolveBroadcastTargets({
        config: cfg({
          enabled: true,
          triggerMode: 'mention-first',
          peerAgents: { oc_x: ['agent-a', 'agent-b'] },
        }),
        peerId: 'oc_x',
        botIdToAgentId,
        mentions,
      });
      expect(r).toBeNull();
    });

    it('@_all 不算激活（mention-first 仅看显式 @）', () => {
      const r = resolveBroadcastTargets({
        config: cfg({
          enabled: true,
          triggerMode: 'mention-first',
          peerAgents: { oc_x: ['agent-a'] },
        }),
        peerId: 'oc_x',
        botIdToAgentId,
        mentions: [{ key: '@_all', id: {}, name: '@所有人' }],
        mentionedAll: true,
      });
      expect(r).toBeNull();
    });

    it('保持配置顺序（即使 mentions 顺序不同）', () => {
      const mentions: Mentions = [
        { key: '@_c', id: { open_id: 'ou_bot_c' }, name: 'C' },
        { key: '@_a', id: { open_id: 'ou_bot_a' }, name: 'A' },
      ];
      const r = resolveBroadcastTargets({
        config: cfg({
          enabled: true,
          triggerMode: 'mention-first',
          peerAgents: { oc_x: ['agent-a', 'agent-b', 'agent-c'] },
        }),
        peerId: 'oc_x',
        botIdToAgentId,
        mentions,
      });
      expect(r).toEqual(['agent-a', 'agent-c']);
    });
  });

  describe('triggerMode=any-mention', () => {
    it('@ 一个列表 agent → 激活全体', () => {
      const mentions: Mentions = [
        { key: '@_a', id: { open_id: 'ou_bot_a' }, name: 'A' },
      ];
      const r = resolveBroadcastTargets({
        config: cfg({
          enabled: true,
          triggerMode: 'any-mention',
          peerAgents: { oc_x: ['agent-a', 'agent-b', 'agent-c'] },
        }),
        peerId: 'oc_x',
        botIdToAgentId,
        mentions,
      });
      expect(r).toEqual(['agent-a', 'agent-b', 'agent-c']);
    });

    it('@_all → 激活全体', () => {
      const r = resolveBroadcastTargets({
        config: cfg({
          enabled: true,
          triggerMode: 'any-mention',
          peerAgents: { oc_x: ['agent-a', 'agent-b'] },
        }),
        peerId: 'oc_x',
        botIdToAgentId,
        mentions: [{ key: '@_all', id: {}, name: '@所有人' }],
        mentionedAll: true,
      });
      expect(r).toEqual(['agent-a', 'agent-b']);
    });

    it('只 @ 了非列表 agent，不激活', () => {
      const mentions: Mentions = [
        { key: '@_x', id: { open_id: 'ou_bot_unknown' }, name: 'X' },
      ];
      const r = resolveBroadcastTargets({
        config: cfg({
          enabled: true,
          triggerMode: 'any-mention',
          peerAgents: { oc_x: ['agent-a', 'agent-b'] },
        }),
        peerId: 'oc_x',
        botIdToAgentId,
        mentions,
      });
      expect(r).toBeNull();
    });

    it('没有任何 mention，不激活', () => {
      const r = resolveBroadcastTargets({
        config: cfg({
          enabled: true,
          triggerMode: 'any-mention',
          peerAgents: { oc_x: ['agent-a'] },
        }),
        peerId: 'oc_x',
        botIdToAgentId,
        mentions: [],
      });
      expect(r).toBeNull();
    });
  });

  it('配置列表含重复 agentId 时去重保序', () => {
    const r = resolveBroadcastTargets({
      config: cfg({
        enabled: true,
        triggerMode: 'always',
        peerAgents: { oc_x: ['agent-a', 'agent-b', 'agent-a', 'agent-c'] },
      }),
      peerId: 'oc_x',
      mentions: [],
    });
    expect(r).toEqual(['agent-a', 'agent-b', 'agent-c']);
  });
});

describe('extractMentionedAgentIds', () => {
  const botIdToAgentId: Record<string, string> = {
    ou_bot_a: 'agent-a',
    ou_bot_b: 'agent-b',
  };
  const configured = ['agent-a', 'agent-b'] as const;

  it('无 mentions 返回空数组', () => {
    expect(extractMentionedAgentIds(undefined, botIdToAgentId, configured)).toEqual([]);
    expect(extractMentionedAgentIds([], botIdToAgentId, configured)).toEqual([]);
  });

  it('@ 了 union_id / user_id 也能识别', () => {
    const r = extractMentionedAgentIds(
      [
        { key: '@_a', id: { union_id: 'ou_bot_a' }, name: 'A' },
        { key: '@_b', id: { user_id: 'ou_bot_b' }, name: 'B' },
      ],
      botIdToAgentId,
      configured,
    );
    expect(r).toEqual(['agent-a', 'agent-b']);
  });

  it('同一 agent 被 @ 多次只记一次', () => {
    const r = extractMentionedAgentIds(
      [
        { key: '@_a1', id: { open_id: 'ou_bot_a' }, name: 'A' },
        { key: '@_a2', id: { open_id: 'ou_bot_a' }, name: 'A' },
      ],
      botIdToAgentId,
      configured,
    );
    expect(r).toEqual(['agent-a']);
  });

  it('@ 的 bot 不在 configured 列表中则忽略', () => {
    const r = extractMentionedAgentIds(
      [{ key: '@_x', id: { open_id: 'ou_bot_a' }, name: 'A' }],
      botIdToAgentId,
      ['agent-b'],
    );
    expect(r).toEqual([]);
  });
});

describe('buildBroadcastDedupeKey', () => {
  it('稳定、包含三个维度', () => {
    const k1 = buildBroadcastDedupeKey({
      channel: 'feishu',
      peerId: 'oc_x',
      messageId: 'om_1',
    });
    const k2 = buildBroadcastDedupeKey({
      channel: 'feishu',
      peerId: 'oc_x',
      messageId: 'om_1',
    });
    expect(k1).toBe(k2);
    expect(k1).toBe('broadcast:feishu:oc_x:om_1');
  });

  it('不同 messageId → 不同 key', () => {
    const k1 = buildBroadcastDedupeKey({
      channel: 'feishu',
      peerId: 'oc_x',
      messageId: 'om_1',
    });
    const k2 = buildBroadcastDedupeKey({
      channel: 'feishu',
      peerId: 'oc_x',
      messageId: 'om_2',
    });
    expect(k1).not.toBe(k2);
  });
});

describe('常量', () => {
  it('3 种 triggerMode 全部有标签', () => {
    for (const m of BROADCAST_TRIGGER_MODES) {
      expect(BROADCAST_TRIGGER_LABELS[m]).toBeTruthy();
    }
  });

  it('BROADCAST_TRIGGER_MODES 列表稳定', () => {
    expect(BROADCAST_TRIGGER_MODES).toEqual([
      'mention-first',
      'any-mention',
      'always',
    ]);
  });
});
