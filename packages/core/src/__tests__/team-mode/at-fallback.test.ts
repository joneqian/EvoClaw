/**
 * applyAtFallbackPrefix 单测（M13 协议层 reply-to 兜底）
 *
 * 第二轮深化：去应用层假设——不再扫描正文 <at>，永远兜底前缀。
 * "reply-to 信息送达"和"LLM 决策性 @ 第三方"是两件事，互不影响。
 *
 * 决策表（chatType / fromPeerOpenId / 期望）：
 *   group  | ou_x | 注入 <at user_id="ou_x"/> 前缀（无论正文如何）
 *   group  | 无   | 不注入（非 peer 入站）
 *   private| ou_x | 不注入（私聊无 @ 推送概念）
 *   空响应 / NO_REPLY → 不注入
 */

import { describe, it, expect } from 'vitest';
import { applyAtFallbackPrefix } from '../../routes/channel-message-handler.js';

describe('applyAtFallbackPrefix', () => {
  it('group + fromPeerOpenId + 正文无 <at> → 前缀注入', () => {
    const result = applyAtFallbackPrefix({
      cleanResponse: 'PRD 已收到，3 个问题逐一回复...',
      chatType: 'group',
      fromPeerOpenId: 'ou_designer',
    });
    expect(result.applied).toBe(true);
    expect(result.text).toBe('<at user_id="ou_designer"/> PRD 已收到，3 个问题逐一回复...');
  });

  it('group + fromPeerOpenId + 正文已含 <at> 第三方 → 仍兜底注入提问者（"reply-to" vs "决策性 @" 是两件事）', () => {
    const result = applyAtFallbackPrefix({
      cleanResponse: 'Q1 答 xxx；<at user_id="ou_arch"/> Q3 你来看',
      chatType: 'group',
      fromPeerOpenId: 'ou_designer',
    });
    expect(result.applied).toBe(true);
    expect(result.text).toBe(
      '<at user_id="ou_designer"/> Q1 答 xxx；<at user_id="ou_arch"/> Q3 你来看',
    );
  });

  it('group + 无 fromPeerOpenId（非 peer 入站）→ 不动', () => {
    const result = applyAtFallbackPrefix({
      cleanResponse: '正文',
      chatType: 'group',
    });
    expect(result.applied).toBe(false);
    expect(result.text).toBe('正文');
  });

  it('private 聊天 → 不动（无 @ 推送概念）', () => {
    const result = applyAtFallbackPrefix({
      cleanResponse: '正文',
      chatType: 'private',
      fromPeerOpenId: 'ou_user',
    });
    expect(result.applied).toBe(false);
    expect(result.text).toBe('正文');
  });

  it('空响应 → 不动', () => {
    const result = applyAtFallbackPrefix({
      cleanResponse: '',
      chatType: 'group',
      fromPeerOpenId: 'ou_designer',
    });
    expect(result.applied).toBe(false);
    expect(result.text).toBe('');
  });

  it('NO_REPLY token → 不动', () => {
    const result = applyAtFallbackPrefix({
      cleanResponse: 'NO_REPLY',
      chatType: 'group',
      fromPeerOpenId: 'ou_designer',
    });
    expect(result.applied).toBe(false);
    expect(result.text).toBe('NO_REPLY');
  });

  it('正文已嵌任何 <at> 形式 → 仍兜底（不再做 <at> 扫描）', () => {
    const result = applyAtFallbackPrefix({
      cleanResponse: '前文 <at user_id="ou_A"/> 中间 后文',
      chatType: 'group',
      fromPeerOpenId: 'ou_B',
    });
    expect(result.applied).toBe(true);
    expect(result.text.startsWith('<at user_id="ou_B"/>')).toBe(true);
  });
});
