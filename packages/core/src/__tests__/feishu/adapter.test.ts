/**
 * FeishuAdapter 单元测试（PR1 Phase A+B 覆盖）
 *
 * 覆盖：
 * - connect / disconnect 生命周期
 * - sendMessage 通过 SDK Client 调用
 * - 入站事件桥接：群聊 @ 过滤、忽略机器人自发、私聊直通
 * - 凭据 Zod 校验
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MessageHandler } from '../../channel/channel-adapter.js';
import { FeishuAdapter } from '../../channel/adapters/feishu/index.js';
import type { FeishuSdk } from '../../channel/adapters/feishu/client.js';
import {
  handleReceiveMessage,
  type FeishuReceiveEvent,
  type InboundContext,
} from '../../channel/adapters/feishu/inbound.js';
import {
  parseFeishuCredentials,
  FeishuCredentialsSchema,
} from '../../channel/adapters/feishu/config.js';
import { inferReceiveIdType } from '../../channel/adapters/feishu/outbound.js';

// ─── 伪 SDK 构造器 ──────────────────────────────────────────────────────

interface MockClient {
  im: {
    v1: {
      message: {
        create: ReturnType<typeof vi.fn>;
      };
    };
  };
  request: ReturnType<typeof vi.fn>;
}

interface MockWSClient {
  start: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  _dispatcher?: unknown;
}

interface MockDispatcher {
  register: ReturnType<typeof vi.fn>;
  _handlers: Record<string, (data: unknown) => Promise<void>>;
  invoke: (eventType: string, data: unknown) => Promise<void>;
}

function createMockSdk(): {
  sdk: FeishuSdk;
  lastClient: MockClient | null;
  lastWs: MockWSClient | null;
  lastDispatcher: MockDispatcher | null;
} {
  const state: {
    sdk: FeishuSdk;
    lastClient: MockClient | null;
    lastWs: MockWSClient | null;
    lastDispatcher: MockDispatcher | null;
  } = { sdk: {} as FeishuSdk, lastClient: null, lastWs: null, lastDispatcher: null };

  class FakeClient {
    im = {
      v1: {
        message: {
          create: vi.fn().mockResolvedValue({ code: 0, msg: 'ok' }),
        },
      },
    };
    // bot 身份发现默认返回合法 bot
    request = vi.fn().mockResolvedValue({ code: 0, bot: { open_id: 'ou_bot' } });
    constructor() {
      state.lastClient = this as unknown as MockClient;
    }
  }

  class FakeWSClient {
    start = vi.fn().mockResolvedValue(undefined);
    close = vi.fn();
    _dispatcher: unknown;
    constructor() {
      state.lastWs = this as unknown as MockWSClient;
    }
  }

  class FakeDispatcher {
    _handlers: Record<string, (data: unknown) => Promise<void>> = {};
    register = vi.fn((handlers: Record<string, (data: unknown) => Promise<void>>) => {
      this._handlers = { ...this._handlers, ...handlers };
      return this;
    });
    async invoke(eventType: string, data: unknown) {
      const h = this._handlers[eventType];
      if (h) await h(data);
    }
    constructor() {
      state.lastDispatcher = this as unknown as MockDispatcher;
    }
  }

  state.sdk = {
    Client: FakeClient as unknown as FeishuSdk['Client'],
    WSClient: FakeWSClient as unknown as FeishuSdk['WSClient'],
    EventDispatcher: FakeDispatcher as unknown as FeishuSdk['EventDispatcher'],
    Domain: { Feishu: 0, Lark: 1 } as unknown as FeishuSdk['Domain'],
    LoggerLevel: { warn: 2 } as unknown as FeishuSdk['LoggerLevel'],
  };

  return state;
}

// ─── 凭据 schema ──────────────────────────────────────────────────────────

describe('FeishuCredentialsSchema', () => {
  it('最小凭据应通过验证', () => {
    const parsed = FeishuCredentialsSchema.parse({
      appId: 'cli_123',
      appSecret: 'secret_xxx',
    });
    expect(parsed.appId).toBe('cli_123');
    expect(parsed.domain).toBe('feishu'); // 默认值
  });

  it('缺少 appId 应拒绝', () => {
    expect(() =>
      FeishuCredentialsSchema.parse({ appId: '', appSecret: 'x' }),
    ).toThrow();
  });

  it('parseFeishuCredentials 应支持原始 record', () => {
    const creds = parseFeishuCredentials({
      appId: 'cli_123',
      appSecret: 'secret',
      domain: 'lark',
      encryptKey: 'abc',
    });
    expect(creds.domain).toBe('lark');
    expect(creds.encryptKey).toBe('abc');
  });
});

// ─── 出站辅助 ────────────────────────────────────────────────────────────

describe('inferReceiveIdType', () => {
  it('群聊返回 chat_id', () => {
    expect(inferReceiveIdType('group')).toBe('chat_id');
  });

  it('私聊返回 open_id', () => {
    expect(inferReceiveIdType('private')).toBe('open_id');
  });

  it('未指定默认 open_id', () => {
    expect(inferReceiveIdType()).toBe('open_id');
  });
});

// ─── FeishuAdapter 生命周期 ────────────────────────────────────────────

describe('FeishuAdapter', () => {
  let mock: ReturnType<typeof createMockSdk>;
  let adapter: FeishuAdapter;

  beforeEach(() => {
    mock = createMockSdk();
    adapter = new FeishuAdapter({ sdk: mock.sdk });
  });

  it('connect 成功应启动 WS 并转为 connected 状态', async () => {
    await adapter.connect({
      type: 'feishu',
      name: '飞书测试',
      credentials: { appId: 'cli_1', appSecret: 'sec_1' },
    });

    expect(mock.lastWs?.start).toHaveBeenCalledOnce();
    expect(adapter.getStatus().status).toBe('connected');
    expect(adapter.getStatus().name).toBe('飞书测试');
  });

  it('connect 缺失凭据应抛错且状态为 error', async () => {
    await expect(
      adapter.connect({ type: 'feishu', name: '空', credentials: {} }),
    ).rejects.toThrow(/appId/);
    expect(adapter.getStatus().status).toBe('error');
  });

  it('connect 应自动拉取 bot open_id 并用于群 @ 过滤', async () => {
    const handler = vi.fn();
    adapter.onMessage(handler);
    await adapter.connect({
      type: 'feishu',
      name: '飞书',
      credentials: { appId: 'cli_bot', appSecret: 's' },
    });

    // bot 发现 API 被调用
    expect(mock.lastClient?.request).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/open-apis/bot/v3/info' }),
    );

    // 群聊 @机器人 消息应通过
    await mock.lastDispatcher!.invoke('im.message.receive_v1', {
      sender: { sender_id: { open_id: 'ou_user' }, sender_type: 'user' },
      message: {
        message_id: 'om_1',
        chat_id: 'oc_x',
        chat_type: 'group',
        message_type: 'text',
        content: '{"text":"hi"}',
        mentions: [{ key: '@_bot', id: { open_id: 'ou_bot' }, name: 'Bot' }],
      },
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('bot hydrate 失败不应阻塞 connect', async () => {
    await adapter.connect({
      type: 'feishu',
      name: '飞书',
      credentials: { appId: 'cli_x', appSecret: 's' },
    });
    // 覆盖 request 为失败
    mock.lastClient!.request.mockRejectedValueOnce(new Error('403'));
    await adapter.disconnect();
    mock = createMockSdk();
    const adapter2 = new FeishuAdapter({ sdk: mock.sdk });
    mock.sdk.Client = class {
      im = { v1: { message: { create: vi.fn() } } };
      request = vi.fn().mockRejectedValue(new Error('403'));
    } as unknown as FeishuSdk['Client'];
    await adapter2.connect({
      type: 'feishu',
      name: '飞书',
      credentials: { appId: 'a', appSecret: 'b' },
    });
    expect(adapter2.getStatus().status).toBe('connected');
  });

  it('重复 connect 应清理旧 WS（防 leak）', async () => {
    await adapter.connect({
      type: 'feishu',
      name: '飞书',
      credentials: { appId: 'a', appSecret: 'b' },
    });
    const firstWs = mock.lastWs!;
    await adapter.connect({
      type: 'feishu',
      name: '飞书',
      credentials: { appId: 'a', appSecret: 'b' },
    });
    expect(firstWs.close).toHaveBeenCalled();
  });

  it('disconnect 应幂等（未连接时不抛错）', async () => {
    await expect(adapter.disconnect()).resolves.toBeUndefined();
    await expect(adapter.disconnect()).resolves.toBeUndefined();
  });

  it('domain=lark 应通过校验并构造 WS', async () => {
    await adapter.connect({
      type: 'feishu',
      name: 'Lark',
      credentials: { appId: 'a', appSecret: 'b', domain: 'lark' },
    });
    expect(adapter.getStatus().status).toBe('connected');
  });

  it('WSClient start 失败应进入 error 状态', async () => {
    mock = createMockSdk();
    // 覆盖 WSClient 让 start 抛错
    const sdk = mock.sdk;
    const OrigWSClient = sdk.WSClient;
    sdk.WSClient = class extends (OrigWSClient as unknown as new () => {
      start: (...args: unknown[]) => Promise<void>;
      close: () => void;
    }) {
      constructor() {
        super();
        this.start = vi.fn().mockRejectedValue(new Error('网络错误'));
      }
    } as unknown as FeishuSdk['WSClient'];
    adapter = new FeishuAdapter({ sdk });

    await expect(
      adapter.connect({
        type: 'feishu',
        name: '测试',
        credentials: { appId: 'a', appSecret: 'b' },
      }),
    ).rejects.toThrow('网络错误');
    expect(adapter.getStatus().status).toBe('error');
    expect(adapter.getStatus().error).toBe('网络错误');
  });

  it('disconnect 应关闭 WS 并转为 disconnected', async () => {
    await adapter.connect({
      type: 'feishu',
      name: '飞书',
      credentials: { appId: 'a', appSecret: 'b' },
    });
    const wsBefore = mock.lastWs!;
    await adapter.disconnect();
    expect(wsBefore.close).toHaveBeenCalled();
    expect(adapter.getStatus().status).toBe('disconnected');
  });

  it('sendMessage 应调用 SDK client 正确的 receive_id_type', async () => {
    await adapter.connect({
      type: 'feishu',
      name: '飞书',
      credentials: { appId: 'a', appSecret: 'b' },
    });

    await adapter.sendMessage('ou_user', '你好', 'private');
    expect(mock.lastClient?.im.v1.message.create).toHaveBeenCalledWith({
      params: { receive_id_type: 'open_id' },
      data: {
        receive_id: 'ou_user',
        msg_type: 'text',
        content: JSON.stringify({ text: '你好' }),
      },
    });

    await adapter.sendMessage('oc_group', '大家好', 'group');
    expect(mock.lastClient?.im.v1.message.create).toHaveBeenLastCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'oc_group',
        msg_type: 'text',
        content: JSON.stringify({ text: '大家好' }),
      },
    });
  });

  it('未连接时 sendMessage 应抛错', async () => {
    await expect(adapter.sendMessage('ou_x', 'hi')).rejects.toThrow('未连接');
  });

  it('SDK 返回非 0 code 应抛错', async () => {
    await adapter.connect({
      type: 'feishu',
      name: '飞书',
      credentials: { appId: 'a', appSecret: 'b' },
    });
    mock.lastClient!.im.v1.message.create.mockResolvedValueOnce({
      code: 230001,
      msg: 'permission denied',
    });
    await expect(adapter.sendMessage('ou_x', 'hi', 'private')).rejects.toThrow(
      /230001/,
    );
  });

  it('入站事件应桥接到 onMessage handler', async () => {
    const handler = vi.fn();
    adapter.onMessage(handler);
    await adapter.connect({
      type: 'feishu',
      name: '飞书',
      credentials: { appId: 'cli_bot', appSecret: 's' },
    });

    // 触发 im.message.receive_v1
    const event: FeishuReceiveEvent = {
      sender: {
        sender_id: { open_id: 'ou_user' },
        sender_type: 'user',
      },
      message: {
        message_id: 'om_1',
        chat_id: 'oc_x',
        chat_type: 'p2p',
        message_type: 'text',
        content: '{"text":"你好"}',
      },
    };
    await mock.lastDispatcher!.invoke('im.message.receive_v1', event);

    expect(handler).toHaveBeenCalledOnce();
    const msg = handler.mock.calls[0]![0];
    expect(msg.channel).toBe('feishu');
    expect(msg.content).toBe('你好');
    expect(msg.accountId).toBe('cli_bot');
  });
});

// ─── handleReceiveMessage 直接测试 ────────────────────────────────────

describe('handleReceiveMessage', () => {
  function makeCtx(overrides: Partial<InboundContext> = {}): {
    ctx: InboundContext;
    handler: ReturnType<typeof vi.fn>;
  } {
    const handler = vi.fn();
    return {
      ctx: {
        getAccountId: () => 'app',
        getBotOpenId: () => null,
        getHandler: () => handler,
        ...overrides,
      },
      handler,
    };
  }

  function buildEvent(
    partial: Partial<FeishuReceiveEvent['message']> & {
      chat_type?: string;
      mentions?: FeishuReceiveEvent['message']['mentions'];
      sender_type?: string;
    } = {},
  ): FeishuReceiveEvent {
    return {
      sender: {
        sender_id: { open_id: 'ou_user' },
        sender_type: partial.sender_type ?? 'user',
      },
      message: {
        message_id: partial.message_id ?? 'om_x',
        chat_id: partial.chat_id ?? 'oc_x',
        chat_type: partial.chat_type ?? 'p2p',
        message_type: partial.message_type ?? 'text',
        content: partial.content ?? '{"text":"hi"}',
        mentions: partial.mentions,
      },
    };
  }

  it('sender_type=app 应被忽略', async () => {
    const { ctx, handler } = makeCtx();
    await handleReceiveMessage(buildEvent({ sender_type: 'app' }), ctx);
    expect(handler).not.toHaveBeenCalled();
  });

  it('无 handler 时应安静返回', async () => {
    const ctx: InboundContext = {
      getAccountId: () => 'a',
      getBotOpenId: () => null,
      getHandler: () => null,
    };
    // 不抛错
    await expect(handleReceiveMessage(buildEvent(), ctx)).resolves.toBeUndefined();
  });

  it('私聊应直接通过', async () => {
    const { ctx, handler } = makeCtx();
    await handleReceiveMessage(buildEvent({ chat_type: 'p2p' }), ctx);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('群聊未 @ 应被过滤', async () => {
    const { ctx, handler } = makeCtx({ getBotOpenId: () => 'ou_bot' });
    await handleReceiveMessage(
      buildEvent({ chat_type: 'group', mentions: [] }),
      ctx,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('群聊 @机器人 应通过', async () => {
    const { ctx, handler } = makeCtx({ getBotOpenId: () => 'ou_bot' });
    await handleReceiveMessage(
      buildEvent({
        chat_type: 'group',
        mentions: [
          { key: '@_bot', id: { open_id: 'ou_bot' }, name: 'Bot' },
        ],
      }),
      ctx,
    );
    expect(handler).toHaveBeenCalledOnce();
  });

  it('群聊 @所有人 应通过', async () => {
    const { ctx, handler } = makeCtx({ getBotOpenId: () => 'ou_bot' });
    await handleReceiveMessage(
      buildEvent({
        chat_type: 'group',
        mentions: [{ key: '@_all', id: {}, name: '@所有人' }],
      }),
      ctx,
    );
    expect(handler).toHaveBeenCalledOnce();
  });

  it('群聊 @其他人 应被过滤', async () => {
    const { ctx, handler } = makeCtx({ getBotOpenId: () => 'ou_bot' });
    await handleReceiveMessage(
      buildEvent({
        chat_type: 'group',
        mentions: [{ key: '@_other', id: { open_id: 'ou_other' }, name: '他人' }],
      }),
      ctx,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('群聊 mention 用 union_id 应通过（鲁棒性）', async () => {
    const { ctx, handler } = makeCtx({ getBotOpenId: () => 'on_bot_union' });
    await handleReceiveMessage(
      buildEvent({
        chat_type: 'group',
        mentions: [
          { key: '@_bot', id: { union_id: 'on_bot_union' }, name: 'Bot' },
        ],
      }),
      ctx,
    );
    expect(handler).toHaveBeenCalledOnce();
  });

  it('image 消息若有 downloader 应下载并挂载 mediaPath', async () => {
    const handler = vi.fn();
    const downloader = vi.fn().mockResolvedValue({
      path: '/tmp/img.png',
      mimeType: 'image/png',
    });
    const ctx: InboundContext = {
      getAccountId: () => 'app',
      getBotOpenId: () => null,
      getHandler: () => handler,
      getMediaDownloader: () => downloader,
    };

    const event: FeishuReceiveEvent = {
      sender: { sender_id: { open_id: 'ou_user' }, sender_type: 'user' },
      message: {
        message_id: 'om_1',
        chat_id: 'oc_x',
        chat_type: 'p2p',
        message_type: 'image',
        content: '{"image_key":"img_x"}',
      },
    };
    await handleReceiveMessage(event, ctx);

    expect(downloader).toHaveBeenCalledWith({
      messageId: 'om_1',
      fileKey: 'img_x',
      msgType: 'image',
    });
    const msg = handler.mock.calls[0]![0];
    expect(msg.mediaPath).toBe('/tmp/img.png');
    expect(msg.mediaType).toBe('image/png');
    expect(msg.content).toBe('[图片]');
  });

  it('file 消息 downloader 失败不阻塞 handler', async () => {
    const handler = vi.fn();
    const downloader = vi.fn().mockRejectedValue(new Error('403'));
    const ctx: InboundContext = {
      getAccountId: () => 'app',
      getBotOpenId: () => null,
      getHandler: () => handler,
      getMediaDownloader: () => downloader,
    };

    await handleReceiveMessage(
      {
        sender: { sender_id: { open_id: 'ou_user' }, sender_type: 'user' },
        message: {
          message_id: 'om_2',
          chat_id: 'oc_x',
          chat_type: 'p2p',
          message_type: 'file',
          content: '{"file_key":"f1","file_name":"a.pdf"}',
        },
      },
      ctx,
    );

    expect(downloader).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledOnce();
    const msg = handler.mock.calls[0]![0];
    expect(msg.content).toBe('[文件: a.pdf]');
    expect(msg.mediaPath).toBeUndefined();
  });

  it('无 downloader 时 image 消息仍正常发给 handler', async () => {
    const handler = vi.fn();
    const ctx: InboundContext = {
      getAccountId: () => 'app',
      getBotOpenId: () => null,
      getHandler: () => handler,
    };

    await handleReceiveMessage(
      {
        sender: { sender_id: { open_id: 'ou_user' }, sender_type: 'user' },
        message: {
          message_id: 'om_3',
          chat_id: 'oc_x',
          chat_type: 'p2p',
          message_type: 'image',
          content: '{"image_key":"img_x"}',
        },
      },
      ctx,
    );
    expect(handler).toHaveBeenCalledOnce();
    const msg = handler.mock.calls[0]![0];
    expect(msg.content).toBe('[图片]');
    expect(msg.mediaPath).toBeUndefined();
  });

  it('sender.sender_id.open_id 缺失不应抛错', async () => {
    const { ctx, handler } = makeCtx();
    const event: FeishuReceiveEvent = {
      sender: { sender_type: 'user' }, // 缺 sender_id
      message: {
        message_id: 'om_x',
        chat_id: 'oc_x',
        chat_type: 'p2p',
        message_type: 'text',
        content: '{"text":"hi"}',
      },
    };
    await expect(handleReceiveMessage(event, ctx)).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('handler 运行期变化应动态生效', async () => {
    let h: MessageHandler | null = null;
    const ctx: InboundContext = {
      getAccountId: () => 'app',
      getBotOpenId: () => null,
      getHandler: () => h,
    };

    // 第一次：无 handler
    await handleReceiveMessage(buildEvent(), ctx);

    // 设置 handler
    const handlerSpy = vi.fn<MessageHandler>();
    h = handlerSpy;
    await handleReceiveMessage(buildEvent(), ctx);
    expect(handlerSpy).toHaveBeenCalledOnce();
  });
});
