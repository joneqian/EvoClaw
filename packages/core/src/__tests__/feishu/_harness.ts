/**
 * 飞书 channel E2E 测试 harness
 *
 * 把 SDK 边界完全打桩（Client / WSClient / EventDispatcher），暴露给测试一个简洁
 * 的 "spin up adapter → 模拟入站 → 断言出站" 三段式 API，避免每个 test 文件重新
 * 拼一遍 mock 模板。
 *
 * 设计取舍：
 * - 不接真飞书 → 0 密钥、CI 友好、确定性
 * - 不模拟 LLM / agent loop → handler 用 vi.fn() 捕获，由测试自行断言
 * - 出站走真实的 outbound/index.ts → 限流码 / Retry-After 等行为是真行为
 */

import { vi } from 'vitest';
import type { ChannelMessage } from '@evoclaw/shared';
import { FeishuAdapter } from '../../channel/adapters/feishu/index.js';
import type { FeishuSdk } from '../../channel/adapters/feishu/client.js';
import { __clearInboundDedupe } from '../../channel/adapters/feishu/inbound/index.js';
import type { FeishuGroupSessionScope } from '../../channel/adapters/feishu/common/session-key.js';

// ─── Mock SDK 内部类型 ─────────────────────────────────────────────────

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
}

interface MockDispatcher {
  register: ReturnType<typeof vi.fn>;
  invoke: (eventType: string, data: unknown) => Promise<void>;
}

export interface FeishuMockSdkState {
  readonly sdk: FeishuSdk;
  lastClient: MockClient | null;
  lastWs: MockWSClient | null;
  lastDispatcher: MockDispatcher | null;
}

/**
 * 构造一份 mock SDK，捕获 Client/WSClient/Dispatcher 实例供测试断言
 *
 * 默认行为：
 * - client.im.v1.message.create → 返回 { code: 0, msg: 'ok', data: {message_id: 'om_*'} }
 * - client.request → 兜底返回 { code: 0, bot: {open_id: 'ou_bot'} }（覆盖 bot 身份发现）
 * - wsClient.start → resolves
 * - dispatcher.register → 累积 handlers，invoke 时按 eventType 分发
 */
export function createFeishuMockSdk(): FeishuMockSdkState {
  const state: FeishuMockSdkState = {
    sdk: {} as FeishuSdk,
    lastClient: null,
    lastWs: null,
    lastDispatcher: null,
  };

  class FakeClient {
    im = {
      v1: {
        message: {
          create: vi
            .fn()
            .mockResolvedValue({ code: 0, msg: 'ok', data: { message_id: 'om_send' } }),
        },
      },
    };
    request = vi.fn().mockResolvedValue({ code: 0, bot: { open_id: 'ou_bot' } });
    constructor() {
      state.lastClient = this as unknown as MockClient;
    }
  }

  class FakeWSClient {
    start = vi.fn().mockResolvedValue(undefined);
    close = vi.fn();
    constructor() {
      state.lastWs = this as unknown as MockWSClient;
    }
  }

  class FakeDispatcher {
    private handlers: Record<string, (data: unknown) => Promise<void>> = {};
    register = vi.fn(
      (h: Record<string, (data: unknown) => Promise<void>>) => {
        this.handlers = { ...this.handlers, ...h };
        return this;
      },
    );
    async invoke(eventType: string, data: unknown) {
      const h = this.handlers[eventType];
      if (h) await h(data);
    }
    constructor() {
      state.lastDispatcher = this as unknown as MockDispatcher;
    }
  }

  (state as { sdk: FeishuSdk }).sdk = {
    Client: FakeClient as unknown as FeishuSdk['Client'],
    WSClient: FakeWSClient as unknown as FeishuSdk['WSClient'],
    EventDispatcher: FakeDispatcher as unknown as FeishuSdk['EventDispatcher'],
    Domain: { Feishu: 0, Lark: 1 } as unknown as FeishuSdk['Domain'],
    LoggerLevel: { warn: 2 } as unknown as FeishuSdk['LoggerLevel'],
  };

  return state;
}

// ─── FeishuTestHarness ───────────────────────────────────────────────

export interface HarnessOptions {
  appId?: string;
  appSecret?: string;
  groupSessionScope?: FeishuGroupSessionScope;
  /**
   * bot 自己的 open_id；用于群 @ 过滤
   *
   * 默认 'ou_bot' 与 createFeishuMockSdk 默认 client.request 返回值对齐；
   * 自定义此值时需注意：bot 身份发现在 boot() 内部走 adapter.connect()，必须
   * 与 mock client.request 一致才能正确识别 @
   */
  botOpenId?: string;
  channelName?: string;
  /**
   * 是否启用入站文本合并器（debounce）
   *
   * 默认 false——大部分 journey 测试假设消息立即 deliver。要测 debounce 行为
   * 时显式开启（journey 加 vi.useFakeTimers + 推进 timer）。
   */
  debounceEnabled?: boolean;
}

interface ResolvedHarnessOptions {
  appId: string;
  appSecret: string;
  groupSessionScope: FeishuGroupSessionScope;
  botOpenId: string;
  channelName: string;
  debounceEnabled: boolean;
}

/** 入站事件载荷（飞书 SDK im.message.receive_v1 的最小子集） */
interface InboundEvent {
  sender: {
    sender_id: { open_id: string; user_id?: string };
    sender_type: 'user' | 'app';
  };
  message: {
    message_id: string;
    chat_id: string;
    chat_type: 'p2p' | 'group';
    message_type: 'text' | 'post' | 'image' | 'file' | 'audio' | 'media' | 'interactive';
    content: string;
    mentions?: Array<{ key: string; id: { open_id?: string }; name?: string }>;
    create_time?: string;
  };
}

/**
 * E2E 测试 harness：boot → simulate → assert
 *
 * @example
 *   const h = new FeishuTestHarness();
 *   await h.boot();
 *   await h.simulateP2PText({ text: '你好' });
 *   expect(h.inboundMessages).toHaveLength(1);
 *   await h.shutdown();
 */
export class FeishuTestHarness {
  readonly mock: FeishuMockSdkState;
  readonly adapter: FeishuAdapter;
  readonly handler: ReturnType<typeof vi.fn>;
  readonly opts: ResolvedHarnessOptions;

  constructor(opts: HarnessOptions = {}) {
    this.opts = {
      appId: opts.appId ?? 'cli_test',
      appSecret: opts.appSecret ?? 'secret_test',
      groupSessionScope: opts.groupSessionScope ?? 'group',
      botOpenId: opts.botOpenId ?? 'ou_bot',
      channelName: opts.channelName ?? '飞书测试',
      debounceEnabled: opts.debounceEnabled ?? false,
    };
    this.mock = createFeishuMockSdk();
    this.adapter = new FeishuAdapter({ sdk: this.mock.sdk });
    this.handler = vi.fn(async (_: ChannelMessage) => {});
    this.adapter.onMessage(this.handler as unknown as (m: ChannelMessage) => Promise<void>);
  }

  /**
   * 启动 adapter（含 connect + bot 身份注入）
   *
   * 副作用：清空入站 dedupe 表，避免跨测试 message_id 冲突
   */
  async boot(): Promise<void> {
    __clearInboundDedupe();
    await this.adapter.connect({
      type: 'feishu',
      name: this.opts.channelName,
      credentials: {
        appId: this.opts.appId,
        appSecret: this.opts.appSecret,
        groupSessionScope: this.opts.groupSessionScope,
        debounceEnabled: this.opts.debounceEnabled ? 'true' : 'false',
      },
    });
  }

  /** 关闭 adapter，释放 ws 连接句柄 */
  async shutdown(): Promise<void> {
    await this.adapter.disconnect();
  }

  // ─── 入站场景模拟 ───────────────────────────────────────────────────

  /** 模拟 1对1 用户发文本给 bot */
  async simulateP2PText(opts: {
    senderId?: string;
    text: string;
    messageId?: string;
  }): Promise<void> {
    await this.dispatchInbound({
      sender: {
        sender_id: { open_id: opts.senderId ?? 'ou_user_1' },
        sender_type: 'user',
      },
      message: {
        message_id: opts.messageId ?? this.nextMessageId(),
        chat_id: 'p2p_default',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: opts.text }),
      },
    });
  }

  /**
   * 模拟群聊收到文本消息
   *
   * 默认 mention=true（@bot），mention=false 用于测试"群里没 @ 不应触发"路径
   */
  async simulateGroupText(opts: {
    chatId?: string;
    senderId?: string;
    text: string;
    messageId?: string;
    mentionBot?: boolean;
  }): Promise<void> {
    const mentionBot = opts.mentionBot ?? true;
    await this.dispatchInbound({
      sender: {
        sender_id: { open_id: opts.senderId ?? 'ou_user_1' },
        sender_type: 'user',
      },
      message: {
        message_id: opts.messageId ?? this.nextMessageId(),
        chat_id: opts.chatId ?? 'oc_default',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: opts.text }),
        mentions: mentionBot
          ? [
              {
                key: '@_user_1',
                id: { open_id: this.opts.botOpenId },
                name: 'Bot',
              },
            ]
          : [],
      },
    });
  }

  /** 直接派发任意入站事件（高级用法 / 媒体类型） */
  async dispatchInbound(event: InboundEvent): Promise<void> {
    if (!this.mock.lastDispatcher) {
      throw new Error('FeishuTestHarness: 必须先 boot() 再 dispatchInbound()');
    }
    await this.mock.lastDispatcher.invoke('im.message.receive_v1', event);
  }

  /**
   * 模拟飞书文档评论事件（drive.notice.comment_add_v1）
   *
   * 用于 M13 Phase 5 doc 闭环测试。事件经 dedupe + bot-self 过滤后会合成
   * ChannelMessage 调 handler，与 IM 同一份 handler 共享 agent 路径。
   */
  async simulateDocComment(opts: {
    fileToken: string;
    fileType?: 'doc' | 'docx' | 'sheet' | 'file' | 'slides';
    commentId?: string;
    replyId?: string;
    fromOpenId?: string;
    isWhole?: boolean;
    content?: string;
  }): Promise<void> {
    if (!this.mock.lastDispatcher) {
      throw new Error('FeishuTestHarness: 必须先 boot() 再 simulateDocComment()');
    }
    await this.mock.lastDispatcher.invoke('drive.notice.comment_add_v1', {
      file_token: opts.fileToken,
      file_type: opts.fileType ?? 'docx',
      comment_id: opts.commentId ?? `cmt_${Date.now()}`,
      ...(opts.replyId !== undefined ? { reply_id: opts.replyId } : {}),
      from_open_id: opts.fromOpenId ?? 'ou_user_doc',
      is_whole: opts.isWhole ?? false,
      content: opts.content ?? 'hello from doc',
    });
    // dispatch 是 fire-and-forget；等一个 microtask + setImmediate 让 handler 跑完
    await new Promise((r) => setImmediate(r));
  }

  // ─── 出站故障注入 ───────────────────────────────────────────────────

  /**
   * 让下一次 message.create 调用返回限流错（code=99991400），错误信息含 Retry-After
   *
   * 用于测试 withFeishuRetry 的 Retry-After 解析路径
   */
  injectRateLimit(opts: { retryAfter?: number; code?: number } = {}): void {
    const retryAfter = opts.retryAfter ?? 5;
    const code = opts.code ?? 99991400;
    if (!this.mock.lastClient) {
      throw new Error('FeishuTestHarness: 必须先 boot() 再 injectRateLimit()');
    }
    const create = this.mock.lastClient.im.v1.message.create;
    create.mockResolvedValueOnce({
      code,
      msg: `Rate limited. Retry-After: ${retryAfter}`,
    });
  }

  // ─── 断言便捷访问 ───────────────────────────────────────────────────

  /** 入站 handler 被调用时收到的所有消息（按调用顺序） */
  get inboundMessages(): ChannelMessage[] {
    return this.handler.mock.calls.map((c) => c[0] as ChannelMessage);
  }

  /** message.create 调用记录（按调用顺序） */
  get outboundCalls(): Array<{ params: Record<string, unknown>; data: Record<string, unknown> }> {
    if (!this.mock.lastClient) return [];
    return (
      this.mock.lastClient.im.v1.message.create.mock.calls.map((args) => ({
        params: (args[0]?.params ?? {}) as Record<string, unknown>,
        data: (args[0]?.data ?? {}) as Record<string, unknown>,
      })) ?? []
    );
  }

  // ─── 内部 ───────────────────────────────────────────────────────────

  private msgIdCounter = 0;
  private nextMessageId(): string {
    this.msgIdCounter += 1;
    return `om_test_${this.msgIdCounter}`;
  }
}
