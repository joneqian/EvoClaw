import { describe, it, expect, vi } from 'vitest';
import { createChannelTools, getChannelToolNames } from '../tools/channel-tools.js';
import type { ChannelManager } from '../channel/channel-manager.js';

/** 模拟 ChannelManager */
function createMockChannelManager(): ChannelManager {
  return {
    sendMessage: vi.fn(),
  } as unknown as ChannelManager;
}

describe('createChannelTools', () => {
  it('local channel 应该只有 desktop_notify', () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'local');
    expect(tools.map((t) => t.name)).toEqual(['desktop_notify']);
  });

  it('feishu channel 应该有 desktop_notify + feishu_send + feishu_card', () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'feishu');
    const names = tools.map((t) => t.name);
    expect(names).toContain('desktop_notify');
    expect(names).toContain('feishu_send');
    expect(names).toContain('feishu_card');
    expect(names).toHaveLength(3);
  });

  it('wecom channel 应该有 desktop_notify + wecom_send', () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'wecom');
    const names = tools.map((t) => t.name);
    expect(names).toContain('desktop_notify');
    expect(names).toContain('wecom_send');
    expect(names).toHaveLength(2);
  });

  it('desktop_notify 应该返回成功标记', async () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'local');
    const notifyTool = tools.find((t) => t.name === 'desktop_notify')!;

    const result = await notifyTool.execute({ title: '测试', body: '消息体' });
    const parsed = JSON.parse(result);
    expect(parsed.sent).toBe(true);
    expect(parsed.title).toBe('测试');
    expect(parsed.body).toBe('消息体');
  });

  it('feishu_send 缺少参数应返回错误提示', async () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'feishu');
    const sendTool = tools.find((t) => t.name === 'feishu_send')!;

    const result = await sendTool.execute({});
    expect(result).toContain('错误');
  });

  it('feishu_send 正常调用应发送消息', async () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'feishu');
    const sendTool = tools.find((t) => t.name === 'feishu_send')!;

    await sendTool.execute({ peerId: 'ou_123', content: '你好', chatType: 'private' });
    expect(cm.sendMessage).toHaveBeenCalledWith('feishu', 'ou_123', '你好', 'private');
  });

  it('wecom_send 缺少参数应返回错误提示', async () => {
    const cm = createMockChannelManager();
    const tools = createChannelTools(cm, 'wecom');
    const sendTool = tools.find((t) => t.name === 'wecom_send')!;

    const result = await sendTool.execute({});
    expect(result).toContain('错误');
  });
});

describe('getChannelToolNames', () => {
  it('local 返回 [desktop_notify]', () => {
    expect(getChannelToolNames('local')).toEqual(['desktop_notify']);
  });

  it('feishu 返回 3 个工具名', () => {
    const names = getChannelToolNames('feishu');
    expect(names).toEqual(['desktop_notify', 'feishu_send', 'feishu_card']);
  });

  it('wecom 返回 2 个工具名', () => {
    const names = getChannelToolNames('wecom');
    expect(names).toEqual(['desktop_notify', 'wecom_send']);
  });

  it('未知 channel 返回 [desktop_notify]', () => {
    expect(getChannelToolNames('dingtalk')).toEqual(['desktop_notify']);
  });
});
