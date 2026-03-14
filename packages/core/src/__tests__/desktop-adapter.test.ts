import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DesktopAdapter } from '../channel/adapters/desktop.js';

describe('DesktopAdapter', () => {
  let adapter: DesktopAdapter;

  beforeEach(() => {
    adapter = new DesktopAdapter();
  });

  it('初始状态应该是 disconnected', () => {
    const status = adapter.getStatus();
    expect(status.type).toBe('local');
    expect(status.name).toBe('桌面');
    expect(status.status).toBe('disconnected');
  });

  it('connect 后应该变成 connected', async () => {
    await adapter.connect({ type: 'local', name: '桌面', credentials: {} });
    const status = adapter.getStatus();
    expect(status.status).toBe('connected');
    expect(status.connectedAt).toBeDefined();
  });

  it('disconnect 后应该变成 disconnected', async () => {
    await adapter.connect({ type: 'local', name: '桌面', credentials: {} });
    await adapter.disconnect();
    expect(adapter.getStatus().status).toBe('disconnected');
  });

  it('sendMessage 应该是 no-op（不抛错）', async () => {
    await expect(adapter.sendMessage('peer1', 'hello')).resolves.toBeUndefined();
  });

  it('handleIncomingMessage 有 handler 时应该调用', async () => {
    const handler = vi.fn();
    adapter.onMessage(handler);
    await adapter.handleIncomingMessage('测试消息', 'user1');

    expect(handler).toHaveBeenCalledOnce();
    const msg = handler.mock.calls[0]![0];
    expect(msg.channel).toBe('local');
    expect(msg.content).toBe('测试消息');
    expect(msg.peerId).toBe('user1');
  });

  it('handleIncomingMessage 无 handler 时应该静默', async () => {
    await expect(adapter.handleIncomingMessage('test')).resolves.toBeUndefined();
  });

  it('getStatus 应该返回副本', () => {
    const s1 = adapter.getStatus();
    const s2 = adapter.getStatus();
    expect(s1).not.toBe(s2);
    expect(s1).toEqual(s2);
  });
});
