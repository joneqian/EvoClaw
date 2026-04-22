/**
 * ChannelManager 多账号支持测试
 *
 * 验证同 ChannelType 下多个 (accountId → adapter) 独立共存：
 * - factory 按需 lazy 创建 adapter 实例
 * - 精确的 disconnect 不误伤其他账号
 * - getStatuses 展平每个 (type, accountId)
 * - resolveAdapter 按 accountId 定位正确实例
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelManager } from '../../channel/channel-manager.js';
import type { ChannelAdapter, ChannelConfig, ChannelStatusInfo, MessageHandler } from '../../channel/channel-adapter.js';
import type { ChannelType } from '@evoclaw/shared';

/** 创建一个最小可用 adapter，connect 后状态切到 connected */
function makeMockAdapter(type: ChannelType = 'feishu'): ChannelAdapter {
  const status: ChannelStatusInfo = { type, name: `${type}-bot`, status: 'disconnected' };
  let currentConfig: ChannelConfig | null = null;
  return {
    type,
    async connect(config) {
      currentConfig = config;
      status.status = 'connected';
      status.connectedAt = new Date().toISOString();
    },
    async disconnect() {
      status.status = 'disconnected';
      delete status.connectedAt;
    },
    onMessage(_handler: MessageHandler) {},
    async sendMessage() {},
    getStatus() {
      return { ...status, accountId: currentConfig?.accountId };
    },
  };
}

describe('ChannelManager 多账号', () => {
  let manager: ChannelManager;

  beforeEach(() => {
    manager = new ChannelManager();
  });

  it('同 channel 两个账号 connect 后各自独立 adapter', async () => {
    const a = makeMockAdapter();
    const b = makeMockAdapter();
    const factory = vi.fn(() => {
      return factory.mock.calls.length === 1 ? a : b;
    });
    manager.registerFactory('feishu', factory);

    await manager.connect({
      type: 'feishu', accountId: 'cli_x', name: '飞书-龙虾', credentials: { appId: 'cli_x' },
    });
    await manager.connect({
      type: 'feishu', accountId: 'cli_y', name: '飞书-小柠', credentials: { appId: 'cli_y' },
    });

    expect(manager.listAccounts('feishu')).toEqual(['cli_x', 'cli_y']);
    expect(manager.getAdapter('feishu', 'cli_x')).toBe(a);
    expect(manager.getAdapter('feishu', 'cli_y')).toBe(b);
    expect(a).not.toBe(b);
  });

  it('disconnect 某账号不影响其他账号', async () => {
    const a = makeMockAdapter();
    const b = makeMockAdapter();
    manager.registerFactory('feishu', () => (a.getStatus().connectedAt ? b : a));

    await manager.connect({ type: 'feishu', accountId: 'cli_x', name: 'a', credentials: {} });
    await manager.connect({ type: 'feishu', accountId: 'cli_y', name: 'b', credentials: {} });

    await manager.disconnect('feishu', 'cli_x');

    expect(manager.getAdapter('feishu', 'cli_x')?.getStatus().status).toBe('disconnected');
    expect(manager.getAdapter('feishu', 'cli_y')?.getStatus().status).toBe('connected');
  });

  it('getStatuses 展平返回每个 (type, accountId)', async () => {
    manager.registerFactory('feishu', () => makeMockAdapter());
    await manager.connect({ type: 'feishu', accountId: 'cli_x', name: 'a', credentials: {} });
    await manager.connect({ type: 'feishu', accountId: 'cli_y', name: 'b', credentials: {} });

    const statuses = manager.getStatuses();
    expect(statuses).toHaveLength(2);
    const ids = statuses.map((s) => s.accountId).sort();
    expect(ids).toEqual(['cli_x', 'cli_y']);
  });

  it('resolveAdapter 找不到 accountId → sendMessage 抛错', async () => {
    manager.registerFactory('feishu', () => makeMockAdapter());
    await manager.connect({ type: 'feishu', accountId: 'cli_x', name: 'a', credentials: {} });

    await expect(
      manager.sendMessage('feishu', 'cli_not_exist', 'peer', 'msg', 'private'),
    ).rejects.toThrow(/未注册/);
  });

  it('getAdapter 无 accountId 时 fallback 到第一个（单账号兼容）', async () => {
    const a = makeMockAdapter();
    manager.registerFactory('feishu', () => a);
    await manager.connect({ type: 'feishu', accountId: 'cli_x', name: 'a', credentials: {} });

    expect(manager.getAdapter('feishu')).toBe(a);
    expect(manager.getAdapter('feishu', '')).toBe(a);
  });

  it('onMessage 注册后新建的 adapter 自动接 handler', async () => {
    const onMsg: MessageHandler = vi.fn(async () => {});
    manager.onMessage(onMsg);

    const adapter = makeMockAdapter();
    const onMessageSpy = vi.spyOn(adapter, 'onMessage');
    manager.registerFactory('feishu', () => adapter);
    await manager.connect({ type: 'feishu', accountId: 'cli_x', name: 'a', credentials: {} });

    expect(onMessageSpy).toHaveBeenCalledWith(onMsg);
  });

  it('未注册 factory → connect 抛带诊断信息的错', async () => {
    await expect(
      manager.connect({ type: 'feishu', accountId: 'cli_x', name: 'a', credentials: {} }),
    ).rejects.toThrow(/未注册 feishu/);
  });
});
