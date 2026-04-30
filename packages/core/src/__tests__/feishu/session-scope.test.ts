/**
 * PR3 Phase E 测试：4 档群会话隔离策略
 */

import { describe, it, expect } from 'vitest';
import {
  buildFeishuGroupPeerId,
  parseFeishuGroupPeerId,
  FEISHU_GROUP_SESSION_SCOPES,
  FEISHU_SCOPE_LABELS,
} from '../../channel/adapters/feishu/common/session-key.js';

describe('buildFeishuGroupPeerId', () => {
  it('group: 只用 chatId', () => {
    expect(
      buildFeishuGroupPeerId({ scope: 'group', chatId: 'oc_x' }),
    ).toBe('oc_x');
  });

  it('group_sender: chatId + sender', () => {
    expect(
      buildFeishuGroupPeerId({
        scope: 'group_sender',
        chatId: 'oc_x',
        senderOpenId: 'ou_u',
      }),
    ).toBe('oc_x:sender:ou_u');
  });

  it('group_sender 缺 sender 降级为 group', () => {
    expect(
      buildFeishuGroupPeerId({ scope: 'group_sender', chatId: 'oc_x' }),
    ).toBe('oc_x');
  });

  it('group_topic: chatId + topic', () => {
    expect(
      buildFeishuGroupPeerId({
        scope: 'group_topic',
        chatId: 'oc_x',
        threadId: 'omt_y',
      }),
    ).toBe('oc_x:topic:omt_y');
  });

  it('group_topic 缺 threadId 降级为 group', () => {
    expect(
      buildFeishuGroupPeerId({ scope: 'group_topic', chatId: 'oc_x' }),
    ).toBe('oc_x');
  });

  it('group_topic_sender: chatId + topic + sender', () => {
    expect(
      buildFeishuGroupPeerId({
        scope: 'group_topic_sender',
        chatId: 'oc_x',
        threadId: 'omt_y',
        senderOpenId: 'ou_u',
      }),
    ).toBe('oc_x:topic:omt_y:sender:ou_u');
  });

  it('group_topic_sender 缺 topic 仍保留 sender', () => {
    expect(
      buildFeishuGroupPeerId({
        scope: 'group_topic_sender',
        chatId: 'oc_x',
        senderOpenId: 'ou_u',
      }),
    ).toBe('oc_x:sender:ou_u');
  });
});

describe('parseFeishuGroupPeerId', () => {
  it('解析 group（只有 chatId）', () => {
    const r = parseFeishuGroupPeerId('oc_x');
    expect(r).toEqual({ chatId: 'oc_x' });
  });

  it('解析 group_sender', () => {
    const r = parseFeishuGroupPeerId('oc_x:sender:ou_u');
    expect(r?.chatId).toBe('oc_x');
    expect(r?.senderOpenId).toBe('ou_u');
    expect(r?.threadId).toBeUndefined();
  });

  it('解析 group_topic_sender', () => {
    const r = parseFeishuGroupPeerId('oc_x:topic:t1:sender:ou_u');
    expect(r).toEqual({ chatId: 'oc_x', threadId: 't1', senderOpenId: 'ou_u' });
  });

  it('空字符串返回 null', () => {
    expect(parseFeishuGroupPeerId('')).toBeNull();
  });
});

describe('常量', () => {
  it('4 档 scope 标签齐全', () => {
    for (const scope of FEISHU_GROUP_SESSION_SCOPES) {
      expect(FEISHU_SCOPE_LABELS[scope]).toBeTruthy();
    }
  });

  it('FEISHU_GROUP_SESSION_SCOPES 只含 4 档', () => {
    expect(FEISHU_GROUP_SESSION_SCOPES).toHaveLength(4);
  });
});
