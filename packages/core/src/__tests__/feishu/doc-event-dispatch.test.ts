/**
 * Phase C1: drive 评论事件 → agent dispatch 单测
 *
 * 覆盖：
 * - synthesizeDocComment 字段映射（含 content JSON 解析）
 * - registerOtherEventHandlers 的 drive.comment_add_v1 路径：
 *   - 缺字段不 dispatch
 *   - bot 自己的评论被过滤（防无限循环）
 *   - 同 comment_id 重复推送 dedupe
 *   - 旧 onDriveCommentAdd 回调向后兼容
 *   - 成功路径：handler 收到 ChannelMessage + feishuDoc 元数据
 * - buildFeishuDocPeerId / parseFeishuDocPeerId roundtrip
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as Lark from '@larksuiteoapi/node-sdk';
import type { ChannelMessage } from '@evoclaw/shared';

import {
  registerOtherEventHandlers,
  synthesizeDocComment,
  __clearDocCommentDedupe,
  type FeishuDriveCommentEvent,
} from '../../channel/adapters/feishu/inbound/event-handlers.js';
import {
  buildFeishuDocPeerId,
  parseFeishuDocPeerId,
} from '../../channel/adapters/feishu/common/session-key.js';

// ─── mock dispatcher ────────────────────────────────────────────────

interface MockDispatcher {
  handlers: Record<string, (data: unknown) => Promise<void>>;
  register: (h: Record<string, (data: unknown) => Promise<void>>) => MockDispatcher;
  invoke: (key: string, data: unknown) => Promise<void>;
}

function makeDispatcher(): MockDispatcher {
  const d: MockDispatcher = {
    handlers: {},
    register(h) {
      this.handlers = { ...this.handlers, ...h };
      return this;
    },
    async invoke(key, data) {
      const fn = this.handlers[key];
      if (fn) await fn(data);
    },
  };
  return d;
}

describe('buildFeishuDocPeerId / parseFeishuDocPeerId', () => {
  it('roundtrip', () => {
    const peerId = buildFeishuDocPeerId('doctoken_abc');
    expect(peerId).toBe('doc:doctoken_abc');
    expect(parseFeishuDocPeerId(peerId)).toEqual({ fileToken: 'doctoken_abc' });
  });

  it('非 doc 前缀返回 null', () => {
    expect(parseFeishuDocPeerId('oc_chat_id')).toBeNull();
    expect(parseFeishuDocPeerId('doc:')).toBeNull(); // 空 token
    expect(parseFeishuDocPeerId('')).toBeNull();
  });
});

describe('synthesizeDocComment', () => {
  it('成功路径：纯文本 content 直接透传', () => {
    const ev: FeishuDriveCommentEvent = {
      file_token: 'tok_a',
      file_type: 'docx',
      comment_id: 'cmt_1',
      from_open_id: 'ou_user',
      is_whole: false,
      content: '帮我看一下',
    };
    const msg = synthesizeDocComment(ev, 'cli_app');
    expect(msg).not.toBeNull();
    expect(msg!.channel).toBe('feishu');
    expect(msg!.chatType).toBe('private');
    expect(msg!.accountId).toBe('cli_app');
    expect(msg!.peerId).toBe('doc:tok_a');
    expect(msg!.senderId).toBe('ou_user');
    expect(msg!.content).toBe('帮我看一下');
    expect(msg!.messageId).toBe('cmt_1');
    expect(msg!.feishuDoc).toEqual({
      fileToken: 'tok_a',
      fileType: 'docx',
      commentId: 'cmt_1',
      isWhole: false,
    });
  });

  it('JSON elements content：扁平化为可读文本', () => {
    const ev: FeishuDriveCommentEvent = {
      file_token: 'tok',
      file_type: 'docx',
      comment_id: 'c',
      from_open_id: 'ou',
      content: JSON.stringify({
        elements: [
          { type: 'text_run', text_run: { text: '请看 ' } },
          { type: 'docs_link', docs_link: { url: 'https://x.com' } },
          { type: 'person', person: { user_id: 'u_bob' } },
        ],
      }),
    };
    const msg = synthesizeDocComment(ev, 'cli');
    expect(msg!.content).toBe('请看 https://x.com<user:u_bob>');
  });

  it('reply_id 存在时 messageId 拼接 + feishuDoc.replyId 字段填', () => {
    const ev: FeishuDriveCommentEvent = {
      file_token: 'tok',
      file_type: 'docx',
      comment_id: 'cmt',
      reply_id: 'rep_1',
      from_open_id: 'ou',
      is_whole: true,
      content: 'hi',
    };
    const msg = synthesizeDocComment(ev, 'cli');
    expect(msg!.messageId).toBe('cmt:rep_1');
    expect(msg!.feishuDoc!.replyId).toBe('rep_1');
    expect(msg!.feishuDoc!.isWhole).toBe(true);
  });

  it('content 为空时 fallback 为「(空评论)」防 LLM 拿到空字符串', () => {
    const ev: FeishuDriveCommentEvent = {
      file_token: 'tok',
      file_type: 'docx',
      comment_id: 'c',
      from_open_id: 'ou',
    };
    const msg = synthesizeDocComment(ev, 'cli');
    expect(msg!.content).toBe('(空评论)');
  });

  it('缺必填字段返回 null', () => {
    expect(synthesizeDocComment({ comment_id: 'c', from_open_id: 'ou' }, 'cli')).toBeNull();
    expect(synthesizeDocComment({ file_token: 'tok', from_open_id: 'ou' }, 'cli')).toBeNull();
    expect(synthesizeDocComment({ file_token: 'tok', comment_id: 'c' }, 'cli')).toBeNull();
  });
});

describe('registerOtherEventHandlers — drive.notice.comment_add_v1 dispatch', () => {
  beforeEach(() => {
    __clearDocCommentDedupe();
  });

  it('成功路径：handler 收到合成的 ChannelMessage', async () => {
    const dispatcher = makeDispatcher();
    const handler = vi.fn(async (_: ChannelMessage) => {});
    registerOtherEventHandlers(dispatcher as unknown as Lark.EventDispatcher, {
      getCallbacks: () => ({}),
      getAccountId: () => 'cli_x',
      getDocHandler: () => handler,
      getBotOpenId: () => 'ou_bot',
    });

    await dispatcher.invoke('drive.notice.comment_add_v1', {
      file_token: 'tok_a',
      file_type: 'docx',
      comment_id: 'cmt_1',
      from_open_id: 'ou_user',
      content: '问题',
      is_whole: false,
    } satisfies FeishuDriveCommentEvent);

    // dispatch 是 fire-and-forget，handler 被异步调用
    await new Promise((r) => setImmediate(r));
    expect(handler).toHaveBeenCalledOnce();
    const msg = handler.mock.calls[0]![0];
    expect(msg.feishuDoc?.fileToken).toBe('tok_a');
    expect(msg.peerId).toBe('doc:tok_a');
  });

  it('bot 自己的评论被过滤（防 agent 回评 → 事件回灌死循环）', async () => {
    const dispatcher = makeDispatcher();
    const handler = vi.fn();
    registerOtherEventHandlers(dispatcher as unknown as Lark.EventDispatcher, {
      getCallbacks: () => ({}),
      getAccountId: () => 'cli',
      getDocHandler: () => handler,
      getBotOpenId: () => 'ou_bot_self',
    });

    await dispatcher.invoke('drive.notice.comment_add_v1', {
      file_token: 'tok',
      file_type: 'docx',
      comment_id: 'c',
      from_open_id: 'ou_bot_self',
      content: '我自己评的',
    });
    await new Promise((r) => setImmediate(r));
    expect(handler).not.toHaveBeenCalled();
  });

  it('同 comment_id 重复推送只 dispatch 一次', async () => {
    const dispatcher = makeDispatcher();
    const handler = vi.fn();
    registerOtherEventHandlers(dispatcher as unknown as Lark.EventDispatcher, {
      getCallbacks: () => ({}),
      getAccountId: () => 'cli',
      getDocHandler: () => handler,
      getBotOpenId: () => 'ou_bot',
    });

    const ev: FeishuDriveCommentEvent = {
      file_token: 'tok',
      file_type: 'docx',
      comment_id: 'c',
      from_open_id: 'ou_user',
      content: 'x',
    };
    await dispatcher.invoke('drive.notice.comment_add_v1', ev);
    await dispatcher.invoke('drive.notice.comment_add_v1', ev);
    await new Promise((r) => setImmediate(r));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('reply_id 不同视为新事件（评论树里多次回复不被误删）', async () => {
    const dispatcher = makeDispatcher();
    const handler = vi.fn();
    registerOtherEventHandlers(dispatcher as unknown as Lark.EventDispatcher, {
      getCallbacks: () => ({}),
      getAccountId: () => 'cli',
      getDocHandler: () => handler,
      getBotOpenId: () => 'ou_bot',
    });

    const base: FeishuDriveCommentEvent = {
      file_token: 'tok',
      file_type: 'docx',
      comment_id: 'c',
      from_open_id: 'ou_user',
      content: 'x',
    };
    await dispatcher.invoke('drive.notice.comment_add_v1', { ...base, reply_id: 'r1' });
    await dispatcher.invoke('drive.notice.comment_add_v1', { ...base, reply_id: 'r2' });
    await new Promise((r) => setImmediate(r));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('缺必填字段不 dispatch（且不抛错）', async () => {
    const dispatcher = makeDispatcher();
    const handler = vi.fn();
    registerOtherEventHandlers(dispatcher as unknown as Lark.EventDispatcher, {
      getCallbacks: () => ({}),
      getAccountId: () => 'cli',
      getDocHandler: () => handler,
    });

    await dispatcher.invoke('drive.notice.comment_add_v1', { file_token: 'tok' }); // 缺 comment/from_open
    await dispatcher.invoke('drive.notice.comment_add_v1', { comment_id: 'c', from_open_id: 'u' }); // 缺 file_token
    await new Promise((r) => setImmediate(r));
    expect(handler).not.toHaveBeenCalled();
  });

  it('未注入 getDocHandler 时仅走旧 onDriveCommentAdd（向后兼容）', async () => {
    const dispatcher = makeDispatcher();
    const onDriveCommentAdd = vi.fn();
    registerOtherEventHandlers(dispatcher as unknown as Lark.EventDispatcher, {
      getCallbacks: () => ({ onDriveCommentAdd }),
      getAccountId: () => 'cli',
      // 不注入 getDocHandler
    });

    await dispatcher.invoke('drive.notice.comment_add_v1', {
      file_token: 'tok',
      file_type: 'docx',
      comment_id: 'c',
      from_open_id: 'ou',
      content: 'x',
    });
    await new Promise((r) => setImmediate(r));
    expect(onDriveCommentAdd).toHaveBeenCalledOnce();
  });

  it('注入 getDocHandler 时旧 callback 仍触发（双路并存）', async () => {
    const dispatcher = makeDispatcher();
    const onDriveCommentAdd = vi.fn();
    const handler = vi.fn();
    registerOtherEventHandlers(dispatcher as unknown as Lark.EventDispatcher, {
      getCallbacks: () => ({ onDriveCommentAdd }),
      getAccountId: () => 'cli',
      getDocHandler: () => handler,
      getBotOpenId: () => 'ou_bot',
    });

    await dispatcher.invoke('drive.notice.comment_add_v1', {
      file_token: 'tok',
      file_type: 'docx',
      comment_id: 'c',
      from_open_id: 'ou_user',
      content: 'x',
    });
    await new Promise((r) => setImmediate(r));
    expect(onDriveCommentAdd).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledOnce();
  });
});
