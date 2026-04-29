/**
 * group-key-utils 单元测试（M13 PR5-B3 修复）
 *
 * 验证 GroupSessionKey 一定剥掉 sender/topic 后缀，否则飞书 group_sender 等
 * 隔离模式下团队 plan 会按 sender 分裂。
 */

import { describe, it, expect } from 'vitest';
import { extractRawChatId, buildGroupSessionKey } from '../../agent/team-mode/group-key-utils.js';

describe('extractRawChatId', () => {
  it('飞书裸 chatId 原样返回', () => {
    expect(extractRawChatId('feishu', 'oc_abc123')).toBe('oc_abc123');
  });

  it('飞书 group_sender 后缀剥掉', () => {
    expect(extractRawChatId('feishu', 'oc_abc:sender:ou_xyz')).toBe('oc_abc');
  });

  it('飞书 group_topic_sender 后缀剥掉', () => {
    expect(extractRawChatId('feishu', 'oc_abc:topic:om_zzz:sender:ou_xyz')).toBe('oc_abc');
  });

  it('lark 同飞书规则', () => {
    expect(extractRawChatId('lark', 'oc_abc:sender:ou_xyz')).toBe('oc_abc');
  });

  it('其他 channel（ilink / wecom 等）原样返回', () => {
    expect(extractRawChatId('ilink', 'wxid_room123')).toBe('wxid_room123');
    expect(extractRawChatId('wecom', 'wrcorp_xx')).toBe('wrcorp_xx');
    expect(extractRawChatId('slack', 'C12345:thread:T1')).toBe('C12345:thread:T1'); // 非飞书不剥
  });

  it('空 peerId → 空字符串', () => {
    expect(extractRawChatId('feishu', '')).toBe('');
  });
});

describe('buildGroupSessionKey', () => {
  it('飞书 group_sender → 剥后缀拼 GroupSessionKey', () => {
    expect(buildGroupSessionKey('feishu', 'oc_abc:sender:ou_xyz')).toBe('feishu:chat:oc_abc');
  });

  it('飞书裸 chatId → 直接拼', () => {
    expect(buildGroupSessionKey('feishu', 'oc_abc')).toBe('feishu:chat:oc_abc');
  });

  it('其他 channel → 原 peerId 直接拼', () => {
    expect(buildGroupSessionKey('ilink', 'wr_xxx')).toBe('ilink:chat:wr_xxx');
  });
});
