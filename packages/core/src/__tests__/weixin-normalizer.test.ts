import { describe, it, expect } from 'vitest';
import { normalizeWeixinMessage } from '../channel/message-normalizer.js';
import type { WeixinMessage } from '../channel/adapters/weixin-types.js';

describe('normalizeWeixinMessage', () => {
  const accountId = 'test-bot-id';

  it('应正确标准化文本消息', () => {
    const msg: WeixinMessage = {
      message_id: 12345,
      from_user_id: 'user123@im.wechat',
      create_time_ms: 1711200000000,
      item_list: [{ type: 1, text_item: { text: '你好世界' } }],
    };

    const result = normalizeWeixinMessage(msg, accountId);

    expect(result.channel).toBe('weixin');
    expect(result.chatType).toBe('private');
    expect(result.accountId).toBe(accountId);
    expect(result.peerId).toBe('user123@im.wechat');
    expect(result.senderId).toBe('user123@im.wechat');
    expect(result.content).toBe('你好世界');
    expect(result.messageId).toBe('12345');
    expect(result.timestamp).toBe(1711200000000);
  });

  it('应处理空 item_list', () => {
    const msg: WeixinMessage = {
      message_id: 1,
      from_user_id: 'user@im.wechat',
      item_list: [],
    };

    const result = normalizeWeixinMessage(msg, accountId);
    expect(result.content).toBe('');
  });

  it('应处理 undefined item_list', () => {
    const msg: WeixinMessage = {
      message_id: 1,
      from_user_id: 'user@im.wechat',
    };

    const result = normalizeWeixinMessage(msg, accountId);
    expect(result.content).toBe('');
  });

  it('应拼接多个文本项', () => {
    const msg: WeixinMessage = {
      message_id: 1,
      from_user_id: 'user@im.wechat',
      item_list: [
        { type: 1, text_item: { text: '第一行' } },
        { type: 1, text_item: { text: '第二行' } },
      ],
    };

    const result = normalizeWeixinMessage(msg, accountId);
    expect(result.content).toBe('第一行第二行');
  });

  it('应忽略非文本消息项', () => {
    const msg: WeixinMessage = {
      message_id: 1,
      from_user_id: 'user@im.wechat',
      item_list: [
        { type: 2 },  // IMAGE
        { type: 1, text_item: { text: '图片说明' } },
        { type: 3 },  // VOICE
      ],
    };

    const result = normalizeWeixinMessage(msg, accountId);
    expect(result.content).toBe('图片说明');
  });

  it('应处理 text_item 为 undefined 的情况', () => {
    const msg: WeixinMessage = {
      message_id: 1,
      from_user_id: 'user@im.wechat',
      item_list: [{ type: 1 }],  // text_item 缺失
    };

    const result = normalizeWeixinMessage(msg, accountId);
    expect(result.content).toBe('');
  });

  it('应处理 from_user_id 缺失', () => {
    const msg: WeixinMessage = {
      message_id: 1,
      item_list: [{ type: 1, text_item: { text: 'test' } }],
    };

    const result = normalizeWeixinMessage(msg, accountId);
    expect(result.peerId).toBe('');
    expect(result.senderId).toBe('');
  });

  it('chatType 始终为 private', () => {
    const msg: WeixinMessage = {
      message_id: 1,
      from_user_id: 'user@im.wechat',
      item_list: [{ type: 1, text_item: { text: 'test' } }],
    };

    const result = normalizeWeixinMessage(msg, accountId);
    expect(result.chatType).toBe('private');
  });

  it('应在 create_time_ms 缺失时使用当前时间', () => {
    const before = Date.now();
    const msg: WeixinMessage = {
      message_id: 1,
      from_user_id: 'user@im.wechat',
    };

    const result = normalizeWeixinMessage(msg, accountId);
    expect(result.timestamp).toBeGreaterThanOrEqual(before);
  });
});
