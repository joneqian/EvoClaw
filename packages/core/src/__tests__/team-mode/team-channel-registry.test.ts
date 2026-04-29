/**
 * TeamChannelRegistry 单元测试
 *
 * 覆盖点：
 * - 注册 / 取出 adapter
 * - resolve 按前缀分发（feishu:... → feishu）
 * - resolve 错误格式 / 未注册 channel → null
 * - 重复注册替换 + 警告
 * - 成员变更事件订阅 / 转发 / 退订
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TeamChannelRegistry } from '../../agent/team-mode/team-channel-registry.js';
import type {
  TeamChannelAdapter,
  GroupSessionKey,
  MessageClassification,
  PeerBotIdentity,
  ChannelOutboundMessage,
  TaskPlanSnapshot,
} from '../../channel/team-mode/team-channel.js';

function makeMockAdapter(channelType: string): TeamChannelAdapter & {
  _membershipHandler?: (key: GroupSessionKey) => void;
} {
  let storedHandler: ((k: GroupSessionKey) => void) | undefined;
  return {
    channelType,
    classifyInboundMessage: async (): Promise<MessageClassification> => ({
      kind: 'stranger',
    }),
    listPeerBots: async (): Promise<PeerBotIdentity[]> => [],
    buildMention: async (): Promise<ChannelOutboundMessage> => ({
      channelType,
      fallbackText: '',
      payload: null,
    }),
    renderTaskBoard: (_plan: TaskPlanSnapshot): ChannelOutboundMessage => ({
      channelType,
      fallbackText: '',
      payload: null,
    }),
    updateTaskBoard: async () => ({ cardId: 'mock' }),
    onGroupMembershipChanged(handler) {
      storedHandler = handler;
    },
    get _membershipHandler() {
      return storedHandler;
    },
  };
}

describe('TeamChannelRegistry', () => {
  let registry: TeamChannelRegistry;

  beforeEach(() => {
    registry = new TeamChannelRegistry();
  });

  it('register + resolveByType 基本功能', () => {
    const adapter = makeMockAdapter('feishu');
    registry.register('feishu', adapter);
    expect(registry.resolveByType('feishu')).toBe(adapter);
    expect(registry.listChannelTypes()).toEqual(['feishu']);
  });

  it('resolve 按 GroupSessionKey 前缀分发', () => {
    const feishu = makeMockAdapter('feishu');
    const slack = makeMockAdapter('slack');
    registry.register('feishu', feishu);
    registry.register('slack', slack);

    expect(registry.resolve('feishu:chat:oc_abc123')).toBe(feishu);
    expect(registry.resolve('slack:channel:C12345')).toBe(slack);
  });

  it('resolve 未注册 channel 返回 null（graceful 降级）', () => {
    expect(registry.resolve('discord:guild:1:channel:2')).toBeNull();
  });

  it('resolve 格式错误（无冒号）返回 null', () => {
    expect(registry.resolve('garbage')).toBeNull();
    expect(registry.resolve('')).toBeNull();
  });

  it('重复注册替换旧实例', () => {
    const a1 = makeMockAdapter('feishu');
    const a2 = makeMockAdapter('feishu');
    registry.register('feishu', a1);
    registry.register('feishu', a2);
    expect(registry.resolveByType('feishu')).toBe(a2);
  });

  it('unregister 移除 adapter', () => {
    registry.register('feishu', makeMockAdapter('feishu'));
    registry.unregister('feishu');
    expect(registry.resolveByType('feishu')).toBeNull();
  });

  it('成员变更事件：adapter → registry → 订阅者', () => {
    const adapter = makeMockAdapter('feishu');
    registry.register('feishu', adapter);

    const handler = vi.fn();
    const unsubscribe = registry.onMembershipChanged(handler);

    // 模拟 adapter 上报成员变更
    expect(adapter._membershipHandler).toBeDefined();
    adapter._membershipHandler!('feishu:chat:oc_abc');

    expect(handler).toHaveBeenCalledWith('feishu:chat:oc_abc');

    // 退订
    unsubscribe();
    adapter._membershipHandler!('feishu:chat:oc_def');
    expect(handler).toHaveBeenCalledTimes(1); // 没再触发
  });

  it('订阅者抛错不影响其他订阅者', () => {
    const adapter = makeMockAdapter('feishu');
    registry.register('feishu', adapter);

    const errHandler = vi.fn(() => {
      throw new Error('boom');
    });
    const okHandler = vi.fn();
    registry.onMembershipChanged(errHandler);
    registry.onMembershipChanged(okHandler);

    adapter._membershipHandler!('feishu:chat:x');

    expect(errHandler).toHaveBeenCalled();
    expect(okHandler).toHaveBeenCalled();
  });

  it('notifyMembershipChanged 主动触发（BindingRouter 用）', () => {
    const handler = vi.fn();
    registry.onMembershipChanged(handler);

    registry.notifyMembershipChanged('feishu:chat:manual');

    expect(handler).toHaveBeenCalledWith('feishu:chat:manual');
  });

  it('reset 清空 adapter 和订阅者', () => {
    registry.register('feishu', makeMockAdapter('feishu'));
    registry.onMembershipChanged(vi.fn());

    registry.reset();

    expect(registry.listChannelTypes()).toEqual([]);
    expect(registry.resolveByType('feishu')).toBeNull();
  });
});
