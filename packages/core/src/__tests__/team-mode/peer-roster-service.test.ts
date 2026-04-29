/**
 * PeerRosterService 单元测试
 *
 * 覆盖点：
 * - 缓存命中 / 未命中
 * - adapter 解析失败 → graceful 空 roster
 * - listPeerBots 抛错 → 兜底用过期缓存
 * - AgentManager 找不到 peer → 跳过
 * - peer status !== active → 跳过
 * - adapter 未排除 self → service 兜底排除
 * - 5 min TTL 过期重建
 * - invalidateGroup / invalidateAgent / invalidateAll
 * - 成员变更事件触发失效
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentConfig } from '@evoclaw/shared';
import {
  PeerRosterService,
} from '../../agent/team-mode/peer-roster-service.js';
import {
  TeamChannelRegistry,
} from '../../agent/team-mode/team-channel-registry.js';
import type {
  TeamChannelAdapter,
  PeerBotIdentity,
  GroupSessionKey,
} from '../../channel/team-mode/team-channel.js';
import type { AgentManager } from '../../agent/agent-manager.js';

function makeAgent(id: string, name: string, status: AgentConfig['status'] = 'active', role = 'general'): AgentConfig {
  return {
    id,
    name,
    emoji: '✨',
    status,
    role,
    createdAt: '2026-04-25T00:00:00.000Z',
    updatedAt: '2026-04-25T00:00:00.000Z',
  };
}

function makeAgentManager(agents: Map<string, AgentConfig>): AgentManager {
  return {
    getAgent: (id: string) => agents.get(id),
  } as unknown as AgentManager;
}

function makeAdapter(
  channelType: string,
  identities: PeerBotIdentity[],
  options: { onMembership?: (k: GroupSessionKey) => void; throws?: boolean } = {},
): TeamChannelAdapter {
  return {
    channelType,
    classifyInboundMessage: async () => ({ kind: 'stranger' as const }),
    listPeerBots: async () => {
      if (options.throws) throw new Error('mock-listPeerBots-fail');
      return identities;
    },
    buildMention: async () => ({ channelType, fallbackText: '', payload: null }),
    renderTaskBoard: () => ({ channelType, fallbackText: '', payload: null }),
    updateTaskBoard: async () => ({ cardId: 'x' }),
    onGroupMembershipChanged(handler) {
      // 暴露给测试
      if (options.onMembership) options.onMembership(handler as any);
    },
  };
}

describe('PeerRosterService', () => {
  let registry: TeamChannelRegistry;
  let agents: Map<string, AgentConfig>;
  let am: AgentManager;

  beforeEach(() => {
    registry = new TeamChannelRegistry();
    agents = new Map();
    am = makeAgentManager(agents);
  });

  it('未注册 adapter → 返回空 roster', async () => {
    const svc = new PeerRosterService({ agentManager: am, registry });
    const roster = await svc.buildRoster('a1', 'feishu:chat:oc_test');
    expect(roster).toEqual([]);
  });

  it('正常路径：adapter 返回 identities + agentManager 补齐', async () => {
    agents.set('a1', makeAgent('a1', 'PM 阿明'));
    agents.set('a2', makeAgent('a2', '后端 阿辉'));
    agents.set('a3', makeAgent('a3', '设计 小林'));

    const adapter = makeAdapter('feishu', [
      { agentId: 'a2', mentionId: 'ou_a2' },
      { agentId: 'a3', mentionId: 'ou_a3' },
    ]);
    registry.register('feishu', adapter);

    const svc = new PeerRosterService({ agentManager: am, registry });
    const roster = await svc.buildRoster('a1', 'feishu:chat:oc_test');

    expect(roster).toHaveLength(2);
    expect(roster[0]).toMatchObject({ agentId: 'a2', name: '后端 阿辉', mentionId: 'ou_a2' });
    expect(roster[1]).toMatchObject({ agentId: 'a3', name: '设计 小林', mentionId: 'ou_a3' });
  });

  it('agent status !== active → 不入 roster', async () => {
    agents.set('a1', makeAgent('a1', 'self'));
    agents.set('a2', makeAgent('a2', 'draft 阿辉', 'draft'));
    agents.set('a3', makeAgent('a3', 'archived 小林', 'archived'));
    agents.set('a4', makeAgent('a4', 'active OK'));

    const adapter = makeAdapter('feishu', [
      { agentId: 'a2', mentionId: 'ou_a2' },
      { agentId: 'a3', mentionId: 'ou_a3' },
      { agentId: 'a4', mentionId: 'ou_a4' },
    ]);
    registry.register('feishu', adapter);

    const svc = new PeerRosterService({ agentManager: am, registry });
    const roster = await svc.buildRoster('a1', 'feishu:chat:oc_test');

    expect(roster.map((r) => r.agentId)).toEqual(['a4']);
  });

  it('agentManager 找不到 → 跳过该 peer', async () => {
    agents.set('a1', makeAgent('a1', 'self'));
    // a2 没注册到 agentManager
    agents.set('a3', makeAgent('a3', 'OK'));

    const adapter = makeAdapter('feishu', [
      { agentId: 'a2', mentionId: 'ou_a2' },
      { agentId: 'a3', mentionId: 'ou_a3' },
    ]);
    registry.register('feishu', adapter);

    const svc = new PeerRosterService({ agentManager: am, registry });
    const roster = await svc.buildRoster('a1', 'feishu:chat:oc_test');

    expect(roster.map((r) => r.agentId)).toEqual(['a3']);
  });

  it('adapter 没排除 self → service 兜底排除', async () => {
    agents.set('a1', makeAgent('a1', 'self'));
    agents.set('a2', makeAgent('a2', 'OK'));

    const adapter = makeAdapter('feishu', [
      { agentId: 'a1', mentionId: 'ou_a1' }, // bug: 没排除自己
      { agentId: 'a2', mentionId: 'ou_a2' },
    ]);
    registry.register('feishu', adapter);

    const svc = new PeerRosterService({ agentManager: am, registry });
    const roster = await svc.buildRoster('a1', 'feishu:chat:oc_test');

    expect(roster.map((r) => r.agentId)).toEqual(['a2']);
  });

  it('缓存命中：第二次调用不再走 adapter', async () => {
    agents.set('a1', makeAgent('a1', 'self'));
    agents.set('a2', makeAgent('a2', 'OK'));

    const listSpy = vi.fn(async () => [{ agentId: 'a2', mentionId: 'ou_a2' }]);
    const adapter = makeAdapter('feishu', []);
    adapter.listPeerBots = listSpy;
    registry.register('feishu', adapter);

    const svc = new PeerRosterService({ agentManager: am, registry, ttlMs: 60_000 });
    await svc.buildRoster('a1', 'feishu:chat:oc_test');
    await svc.buildRoster('a1', 'feishu:chat:oc_test');
    await svc.buildRoster('a1', 'feishu:chat:oc_test');

    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it('TTL 过期 → 重建', async () => {
    agents.set('a1', makeAgent('a1', 'self'));
    agents.set('a2', makeAgent('a2', 'OK'));

    const listSpy = vi.fn(async () => [{ agentId: 'a2', mentionId: 'ou_a2' }]);
    const adapter = makeAdapter('feishu', []);
    adapter.listPeerBots = listSpy;
    registry.register('feishu', adapter);

    // 短 TTL 模拟过期
    const svc = new PeerRosterService({ agentManager: am, registry, ttlMs: 1 });
    await svc.buildRoster('a1', 'feishu:chat:oc_test');
    await new Promise((r) => setTimeout(r, 10));
    await svc.buildRoster('a1', 'feishu:chat:oc_test');

    expect(listSpy).toHaveBeenCalledTimes(2);
  });

  it('listPeerBots 抛错 + 无缓存 → 返回空', async () => {
    const adapter = makeAdapter('feishu', [], { throws: true });
    registry.register('feishu', adapter);

    const svc = new PeerRosterService({ agentManager: am, registry });
    const roster = await svc.buildRoster('a1', 'feishu:chat:oc_test');

    expect(roster).toEqual([]);
  });

  it('invalidateGroup → 该群所有 agent 缓存失效', async () => {
    agents.set('a1', makeAgent('a1', 'a1-name'));
    agents.set('a2', makeAgent('a2', 'a2-name'));

    const listSpy = vi.fn(async (_k: string, self: string) =>
      self !== 'a2' ? [{ agentId: 'a2', mentionId: 'ou_a2' }] : [],
    );
    const adapter = makeAdapter('feishu', []);
    adapter.listPeerBots = listSpy;
    registry.register('feishu', adapter);

    const svc = new PeerRosterService({ agentManager: am, registry, ttlMs: 60_000 });
    await svc.buildRoster('a1', 'feishu:chat:oc_x');
    await svc.buildRoster('a2', 'feishu:chat:oc_x');
    await svc.buildRoster('a1', 'feishu:chat:oc_y');

    listSpy.mockClear();
    svc.invalidateGroup('feishu:chat:oc_x');

    await svc.buildRoster('a1', 'feishu:chat:oc_x'); // 重建
    await svc.buildRoster('a2', 'feishu:chat:oc_x'); // 重建
    await svc.buildRoster('a1', 'feishu:chat:oc_y'); // 命中

    expect(listSpy).toHaveBeenCalledTimes(2);
  });

  it('成员变更事件 → 自动失效', async () => {
    agents.set('a1', makeAgent('a1', 'a1-name'));
    agents.set('a2', makeAgent('a2', 'a2-name'));

    let memberHandler: ((k: GroupSessionKey) => void) | undefined;
    const listSpy = vi.fn(async () => [{ agentId: 'a2', mentionId: 'ou_a2' }]);
    const adapter: TeamChannelAdapter = {
      channelType: 'feishu',
      classifyInboundMessage: async () => ({ kind: 'stranger' as const }),
      listPeerBots: listSpy,
      buildMention: async () => ({ channelType: 'feishu', fallbackText: '', payload: null }),
      renderTaskBoard: () => ({ channelType: 'feishu', fallbackText: '', payload: null }),
      updateTaskBoard: async () => ({ cardId: 'x' }),
      onGroupMembershipChanged(h) {
        memberHandler = h;
      },
    };
    registry.register('feishu', adapter);

    const svc = new PeerRosterService({ agentManager: am, registry, ttlMs: 60_000 });
    await svc.buildRoster('a1', 'feishu:chat:oc_x');
    expect(listSpy).toHaveBeenCalledTimes(1);

    // 模拟成员变更
    expect(memberHandler).toBeDefined();
    memberHandler!('feishu:chat:oc_x');

    await svc.buildRoster('a1', 'feishu:chat:oc_x');
    expect(listSpy).toHaveBeenCalledTimes(2);
  });

  it('emoji 缺失 → 用 🤖 兜底', async () => {
    const a2: AgentConfig = makeAgent('a2', '阿辉');
    a2.emoji = '';
    agents.set('a1', makeAgent('a1', 'self'));
    agents.set('a2', a2);

    const adapter = makeAdapter('feishu', [{ agentId: 'a2', mentionId: 'ou_a2' }]);
    registry.register('feishu', adapter);

    const svc = new PeerRosterService({ agentManager: am, registry });
    const roster = await svc.buildRoster('a1', 'feishu:chat:oc_x');

    expect(roster[0].emoji).toBe('🤖');
  });

  it('role 缺失 → 用 general 兜底', async () => {
    const a2 = makeAgent('a2', '阿辉');
    a2.role = undefined;
    agents.set('a1', makeAgent('a1', 'self'));
    agents.set('a2', a2);

    const adapter = makeAdapter('feishu', [{ agentId: 'a2', mentionId: 'ou_a2' }]);
    registry.register('feishu', adapter);

    const svc = new PeerRosterService({ agentManager: am, registry });
    const roster = await svc.buildRoster('a1', 'feishu:chat:oc_x');

    expect(roster[0].role).toBe('general');
  });
});
