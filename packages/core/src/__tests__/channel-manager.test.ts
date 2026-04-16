import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChannelManager } from '../channel/channel-manager.js';
import type { ChannelAdapter, ChannelConfig, ChannelStatusInfo, MessageHandler } from '../channel/channel-adapter.js';
import type { ChannelType } from '@evoclaw/shared';

/** 模拟适配器 */
function createMockAdapter(type: ChannelType = 'feishu'): ChannelAdapter & {
  _handler: MessageHandler | null;
  _connected: boolean;
  _connectFn: ReturnType<typeof vi.fn>;
  _disconnectFn: ReturnType<typeof vi.fn>;
  _sendFn: ReturnType<typeof vi.fn>;
} {
  const connectFn = vi.fn<(config: ChannelConfig) => Promise<void>>();
  const disconnectFn = vi.fn<() => Promise<void>>();
  const sendFn = vi.fn<(peerId: string, content: string, chatType?: 'private' | 'group') => Promise<void>>();
  let handler: MessageHandler | null = null;
  let connected = false;

  return {
    type,
    _handler: handler,
    _connected: connected,
    _connectFn: connectFn,
    _disconnectFn: disconnectFn,
    _sendFn: sendFn,
    connect: async (config) => {
      await connectFn(config);
      connected = true;
    },
    disconnect: async () => {
      await disconnectFn();
      connected = false;
    },
    onMessage: (h) => { handler = h; },
    sendMessage: sendFn,
    getStatus: () => ({
      type,
      name: `Mock ${type}`,
      status: connected ? 'connected' : 'disconnected',
    } as ChannelStatusInfo),
  };
}

describe('ChannelManager', () => {
  let manager: ChannelManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new ChannelManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('registerAdapter / unregisterAdapter', () => {
    it('应该成功注册适配器', () => {
      const adapter = createMockAdapter('feishu');
      manager.registerAdapter(adapter);
      expect(manager.getRegisteredTypes()).toContain('feishu');
    });

    it('应该成功注销适配器', () => {
      const adapter = createMockAdapter('feishu');
      manager.registerAdapter(adapter);
      manager.unregisterAdapter('feishu');
      expect(manager.getRegisteredTypes()).not.toContain('feishu');
    });

    it('注册时应自动绑定已有的消息回调', () => {
      const handler = vi.fn();
      manager.onMessage(handler);

      const adapter = createMockAdapter('feishu');
      const onMessageSpy = vi.spyOn(adapter, 'onMessage');
      manager.registerAdapter(adapter);

      expect(onMessageSpy).toHaveBeenCalledWith(handler);
    });
  });

  describe('connect / disconnect', () => {
    it('应该成功连接已注册的 Channel', async () => {
      const adapter = createMockAdapter('feishu');
      manager.registerAdapter(adapter);

      const config: ChannelConfig = {
        type: 'feishu',
        name: '测试飞书',
        credentials: { appId: 'test', appSecret: 'secret' },
      };
      await manager.connect(config);
      expect(adapter._connectFn).toHaveBeenCalled();
    });

    it('连接未注册的 Channel 应抛出错误', async () => {
      const config: ChannelConfig = {
        type: 'wecom',
        name: '企微',
        credentials: {},
      };
      await expect(manager.connect(config)).rejects.toThrow('未注册');
    });

    it('应该成功断开连接', async () => {
      const adapter = createMockAdapter('feishu');
      manager.registerAdapter(adapter);
      await manager.connect({ type: 'feishu', name: '飞书', credentials: {} });
      await manager.disconnect('feishu');
      expect(adapter._disconnectFn).toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    it('Channel 未注册时应抛出错误', async () => {
      await expect(manager.sendMessage('feishu', 'peer1', 'hello')).rejects.toThrow('未注册');
    });

    it('Channel 未连接时应抛出错误', async () => {
      const adapter = createMockAdapter('feishu');
      manager.registerAdapter(adapter);
      await expect(manager.sendMessage('feishu', 'peer1', 'hello')).rejects.toThrow('未连接');
    });
  });

  describe('getStatuses', () => {
    it('应该返回所有已注册适配器的状态', () => {
      manager.registerAdapter(createMockAdapter('feishu'));
      manager.registerAdapter(createMockAdapter('local'));

      const statuses = manager.getStatuses();
      expect(statuses).toHaveLength(2);
    });

    it('应该返回单个 Channel 状态', () => {
      manager.registerAdapter(createMockAdapter('feishu'));
      const status = manager.getStatus('feishu');
      expect(status).toBeDefined();
      expect(status!.type).toBe('feishu');
    });

    it('未注册的 Channel 应返回 undefined', () => {
      expect(manager.getStatus('wecom')).toBeUndefined();
    });
  });

  describe('disconnectAll', () => {
    it('应该断开所有 Channel', async () => {
      const a1 = createMockAdapter('feishu');
      const a2 = createMockAdapter('local');
      manager.registerAdapter(a1);
      manager.registerAdapter(a2);

      await manager.connect({ type: 'feishu', name: '飞书', credentials: {} });
      await manager.connect({ type: 'local', name: '桌面', credentials: {} });
      await manager.disconnectAll();

      expect(a1._disconnectFn).toHaveBeenCalled();
      expect(a2._disconnectFn).toHaveBeenCalled();
    });
  });

  describe('onMessage', () => {
    it('设置全局回调后应注册到所有已有适配器', () => {
      const a1 = createMockAdapter('feishu');
      const a2 = createMockAdapter('local');
      manager.registerAdapter(a1);
      manager.registerAdapter(a2);

      const spy1 = vi.spyOn(a1, 'onMessage');
      const spy2 = vi.spyOn(a2, 'onMessage');

      const handler = vi.fn();
      manager.onMessage(handler);

      expect(spy1).toHaveBeenCalledWith(handler);
      expect(spy2).toHaveBeenCalledWith(handler);
    });
  });

  describe('自动重连', () => {
    it('连接失败后应调度重连', async () => {
      let callCount = 0;
      const adapter: ChannelAdapter = {
        type: 'feishu',
        connect: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount <= 1) throw new Error('网络错误');
          // 第二次成功
        }),
        disconnect: vi.fn(),
        onMessage: vi.fn(),
        sendMessage: vi.fn(),
        getStatus: () => ({ type: 'feishu', name: '飞书', status: callCount > 1 ? 'connected' : 'disconnected' }),
      };
      manager.registerAdapter(adapter);

      // 首次连接失败 → 触发 scheduleReconnect
      await expect(
        manager.connect({ type: 'feishu', name: '飞书', credentials: {} }),
      ).rejects.toThrow('网络错误');
      expect(callCount).toBe(1);

      // 快进 5 秒（首次重连延迟）
      await vi.advanceTimersByTimeAsync(5_000);
      expect(callCount).toBe(2); // 重连成功
    });

    it('disconnect 后应停止重连', async () => {
      let callCount = 0;
      const adapter: ChannelAdapter = {
        type: 'feishu',
        connect: vi.fn().mockImplementation(async () => {
          callCount++;
          throw new Error('始终失败');
        }),
        disconnect: vi.fn(),
        onMessage: vi.fn(),
        sendMessage: vi.fn(),
        getStatus: () => ({ type: 'feishu', name: '飞书', status: 'disconnected' }),
      };
      manager.registerAdapter(adapter);

      await expect(
        manager.connect({ type: 'feishu', name: '飞书', credentials: {} }),
      ).rejects.toThrow();
      expect(callCount).toBe(1);

      // 手动断开 → 清除重连定时器
      await manager.disconnect('feishu');

      // 快进足够长时间，不应再重连
      await vi.advanceTimersByTimeAsync(60_000);
      expect(callCount).toBe(1); // 仍然只有初始的 1 次
    });

    it('重连次数达上限后应停止', async () => {
      let callCount = 0;
      const adapter: ChannelAdapter = {
        type: 'feishu',
        connect: vi.fn().mockImplementation(async () => {
          callCount++;
          throw new Error('始终失败');
        }),
        disconnect: vi.fn(),
        onMessage: vi.fn(),
        sendMessage: vi.fn(),
        getStatus: () => ({ type: 'feishu', name: '飞书', status: 'error' }),
      };
      manager.registerAdapter(adapter);

      await expect(
        manager.connect({ type: 'feishu', name: '飞书', credentials: {} }),
      ).rejects.toThrow();

      // 快进足够多时间触发所有重连（指数退避: 5s, 7.5s, 11.25s, ...）
      // 最多 10 次重连
      for (let i = 0; i < 12; i++) {
        await vi.advanceTimersByTimeAsync(100_000);
      }

      // 1 次初始 + 最多 10 次重连 = 最多 11
      expect(callCount).toBeLessThanOrEqual(11);
    });
  });
});
