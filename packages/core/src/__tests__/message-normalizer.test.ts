import { describe, it, expect } from 'vitest';
import {
  normalizeFeishuMessage,
  normalizeWecomMessage,
  normalizeDesktopMessage,
} from '../channel/message-normalizer.js';

describe('normalizeFeishuMessage', () => {
  it('应该正确解析私聊消息', () => {
    const msg = normalizeFeishuMessage(
      {
        message_id: 'msg-001',
        chat_type: 'p2p',
        chat_id: 'chat-001',
        sender: {
          sender_id: { open_id: 'ou_user1' },
          sender_type: 'user',
        },
        content: '{"text":"你好"}',
        msg_type: 'text',
      },
      'app-feishu-001',
    );

    expect(msg.channel).toBe('feishu');
    expect(msg.chatType).toBe('private');
    expect(msg.peerId).toBe('ou_user1'); // 私聊 peerId = sender
    expect(msg.senderId).toBe('ou_user1');
    expect(msg.content).toBe('你好');
    expect(msg.messageId).toBe('msg-001');
    expect(msg.accountId).toBe('app-feishu-001');
  });

  it('应该正确解析群聊消息', () => {
    const msg = normalizeFeishuMessage(
      {
        message_id: 'msg-002',
        chat_type: 'group',
        chat_id: 'oc_group1',
        sender: {
          sender_id: { open_id: 'ou_user2' },
          sender_type: 'user',
        },
        content: '{"text":"大家好"}',
        msg_type: 'text',
      },
      'app-feishu-001',
    );

    expect(msg.chatType).toBe('group');
    expect(msg.peerId).toBe('oc_group1'); // 群聊 peerId = chat_id
    expect(msg.senderId).toBe('ou_user2');
    expect(msg.content).toBe('大家好');
  });

  it('应该处理非 JSON content', () => {
    const msg = normalizeFeishuMessage(
      {
        message_id: 'msg-003',
        chat_type: 'p2p',
        chat_id: 'chat-001',
        sender: {
          sender_id: { open_id: 'ou_user1' },
          sender_type: 'user',
        },
        content: '纯文本内容',
        msg_type: 'text',
      },
      'app-001',
    );

    expect(msg.content).toBe('纯文本内容');
  });
});

describe('normalizeWecomMessage', () => {
  it('应该正确解析私聊消息', () => {
    const msg = normalizeWecomMessage(
      {
        MsgId: 'wecom-msg-001',
        MsgType: 'text',
        Content: '你好企微',
        FromUserName: 'user-001',
        ToUserName: 'corp-bot',
        CreateTime: 1700000000,
        AgentID: 1000001,
      },
      'corp-001',
      false,
    );

    expect(msg.channel).toBe('wecom');
    expect(msg.chatType).toBe('private');
    expect(msg.peerId).toBe('user-001');
    expect(msg.senderId).toBe('user-001');
    expect(msg.content).toBe('你好企微');
    expect(msg.messageId).toBe('wecom-msg-001');
    expect(msg.timestamp).toBe(1700000000000); // 秒→毫秒
    expect(msg.accountId).toBe('corp-001');
  });

  it('应该正确解析群聊消息', () => {
    const msg = normalizeWecomMessage(
      {
        MsgId: 'wecom-msg-002',
        MsgType: 'text',
        Content: '群消息',
        FromUserName: 'user-002',
        ToUserName: 'corp-bot',
        CreateTime: 1700000100,
      },
      'corp-001',
      true,
    );

    expect(msg.chatType).toBe('group');
  });

  it('应该处理空 Content', () => {
    const msg = normalizeWecomMessage(
      {
        MsgId: 'wecom-msg-003',
        MsgType: 'text',
        Content: '',
        FromUserName: 'user-003',
        ToUserName: 'corp-bot',
        CreateTime: 1700000200,
      },
      'corp-001',
      false,
    );

    expect(msg.content).toBe('');
  });
});

describe('normalizeDesktopMessage', () => {
  it('应该生成本地桌面消息', () => {
    const msg = normalizeDesktopMessage('测试消息', 'test-user');

    expect(msg.channel).toBe('local');
    expect(msg.chatType).toBe('private');
    expect(msg.accountId).toBe('desktop');
    expect(msg.peerId).toBe('test-user');
    expect(msg.senderId).toBe('test-user');
    expect(msg.senderName).toBe('本地用户');
    expect(msg.content).toBe('测试消息');
    expect(msg.messageId).toBeDefined();
    expect(msg.timestamp).toBeGreaterThan(0);
  });

  it('应该使用默认 userId', () => {
    const msg = normalizeDesktopMessage('hello');
    expect(msg.peerId).toBe('local-user');
    expect(msg.senderId).toBe('local-user');
  });
});
