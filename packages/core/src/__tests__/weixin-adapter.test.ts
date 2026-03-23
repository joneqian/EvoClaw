import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WeixinAdapter } from '../channel/adapters/weixin.js';
import type { ChannelStateRepo } from '../channel/channel-state-repo.js';

// Mock ChannelStateRepo
function createMockStateRepo(): ChannelStateRepo {
  const store = new Map<string, string>();
  return {
    getState: vi.fn((channel: string, key: string) => store.get(`${channel}:${key}`) ?? null),
    setState: vi.fn((channel: string, key: string, value: string) => { store.set(`${channel}:${key}`, value); }),
    deleteState: vi.fn((channel: string, key: string) => { store.delete(`${channel}:${key}`); }),
  } as unknown as ChannelStateRepo;
}

describe('WeixinAdapter', () => {
  let adapter: WeixinAdapter;
  let stateRepo: ChannelStateRepo;

  beforeEach(() => {
    stateRepo = createMockStateRepo();
    adapter = new WeixinAdapter(stateRepo);
    // Mock fetch 以防止真实网络请求
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('初始状态', () => {
    it('类型应为 weixin', () => {
      expect(adapter.type).toBe('weixin');
    });

    it('初始状态应为 disconnected', () => {
      const status = adapter.getStatus();
      expect(status.type).toBe('weixin');
      expect(status.name).toBe('微信');
      expect(status.status).toBe('disconnected');
    });
  });

  describe('connect', () => {
    it('缺少 botToken 应抛出错误', async () => {
      await expect(
        adapter.connect({ type: 'weixin', name: '微信', credentials: {} }),
      ).rejects.toThrow('botToken');

      expect(adapter.getStatus().status).toBe('error');
    });

    it('有效凭证应连接成功', async () => {
      // Mock getUpdates — 长轮询会被调用，返回空响应
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ ret: 0, msgs: [], get_updates_buf: 'buf1' })),
      });
      vi.stubGlobal('fetch', mockFetch);

      await adapter.connect({
        type: 'weixin',
        name: '微信',
        credentials: {
          botToken: 'test-token',
          ilinkBotId: 'bot-123',
          baseUrl: 'https://test.example.com',
        },
      });

      expect(adapter.getStatus().status).toBe('connected');
      expect(adapter.getStatus().connectedAt).toBeTruthy();
    });

    it('应从 stateRepo 恢复游标', async () => {
      // 预存游标
      stateRepo.setState('weixin' as any, 'get_updates_buf', 'saved-cursor');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ ret: 0, msgs: [] })),
      });
      vi.stubGlobal('fetch', mockFetch);

      await adapter.connect({
        type: 'weixin',
        name: '微信',
        credentials: { botToken: 'tk', ilinkBotId: 'bot', baseUrl: 'https://test.example.com' },
      });

      expect(stateRepo.getState).toHaveBeenCalledWith('weixin', 'get_updates_buf');
    });
  });

  describe('disconnect', () => {
    it('应设置状态为 disconnected', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ ret: 0, msgs: [] })),
      });
      vi.stubGlobal('fetch', mockFetch);

      await adapter.connect({
        type: 'weixin',
        name: '微信',
        credentials: { botToken: 'tk', ilinkBotId: 'bot', baseUrl: 'https://test.example.com' },
      });

      await adapter.disconnect();
      expect(adapter.getStatus().status).toBe('disconnected');
    });
  });

  describe('sendMessage', () => {
    it('未连接时应抛出错误', async () => {
      await expect(adapter.sendMessage('user@im.wechat', '你好')).rejects.toThrow('未连接');
    });

    it('应发送文本消息', async () => {
      const fetchCalls: { url: string; body: string }[] = [];
      const mockFetch = vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
        if (opts?.body) fetchCalls.push({ url, body: opts.body as string });
        return {
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ ret: 0, msgs: [] })),
        };
      });
      vi.stubGlobal('fetch', mockFetch);

      await adapter.connect({
        type: 'weixin',
        name: '微信',
        credentials: { botToken: 'tk', ilinkBotId: 'bot', baseUrl: 'https://test.example.com' },
      });

      await adapter.sendMessage('user@im.wechat', '测试消息');

      // 查找 sendmessage 调用
      const sendCall = fetchCalls.find(c => c.url.includes('sendmessage'));
      expect(sendCall).toBeTruthy();

      const body = JSON.parse(sendCall!.body);
      expect(body.msg.to_user_id).toBe('user@im.wechat');
      expect(body.msg.item_list[0].type).toBe(1);
      expect(body.msg.item_list[0].text_item.text).toBe('测试消息');
    });

    it('应对超长文本分块发送', async () => {
      const sendCalls: string[] = [];
      const mockFetch = vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
        if (typeof url === 'string' && url.includes('sendmessage') && opts?.body) {
          sendCalls.push(opts.body as string);
        }
        return {
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ ret: 0, msgs: [] })),
        };
      });
      vi.stubGlobal('fetch', mockFetch);

      await adapter.connect({
        type: 'weixin',
        name: '微信',
        credentials: { botToken: 'tk', ilinkBotId: 'bot', baseUrl: 'https://test.example.com' },
      });

      // 生成超过 4000 字符的文本
      const longText = 'a'.repeat(5000);
      await adapter.sendMessage('user@im.wechat', longText);

      // 应该被分成 2 块发送
      expect(sendCalls.length).toBe(2);

      const firstBody = JSON.parse(sendCalls[0]);
      expect(firstBody.msg.item_list[0].text_item.text.length).toBe(4000);

      const secondBody = JSON.parse(sendCalls[1]);
      expect(secondBody.msg.item_list[0].text_item.text.length).toBe(1000);
    });
  });

  describe('onMessage', () => {
    it('应注册消息回调', () => {
      const handler = vi.fn();
      adapter.onMessage(handler);
      // handler 被保存，将在轮询收到消息时调用
      expect(() => adapter.onMessage(handler)).not.toThrow();
    });
  });
});
