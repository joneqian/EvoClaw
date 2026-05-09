/**
 * M13 Phase 1 PR-1A — generateSessionKey 4 种 dmScope 格式 + main fallback 测试
 */
import { describe, it, expect } from 'vitest';
import {
  generateSessionKey,
  generateMainSessionKey,
  isMainSessionKey,
  parseSessionKey,
  DEFAULT_DM_SCOPE,
} from '../../routing/session-key.js';

describe('generateSessionKey - dmScope 4 格式', () => {
  it('dmScope=main → agent:{id}:main（与 generateMainSessionKey 等价）', () => {
    const k = generateSessionKey('alice', 'feishu', 'direct', 'ou_xxx', { dmScope: 'main' });
    expect(k).toBe('agent:alice:main');
    expect(k).toBe(generateMainSessionKey('alice'));
  });

  it('dmScope=per-peer → agent:{id}:direct:{peer}（不区分 channel）', () => {
    const k1 = generateSessionKey('alice', 'feishu', 'direct', 'ou_xxx', { dmScope: 'per-peer' });
    const k2 = generateSessionKey('alice', 'wecom', 'direct', 'ou_xxx', { dmScope: 'per-peer' });
    expect(k1).toBe('agent:alice:direct:ou_xxx');
    expect(k2).toBe('agent:alice:direct:ou_xxx');
    // 同 peerId 跨渠道合并
    expect(k1).toBe(k2);
  });

  it('dmScope=per-channel-peer → agent:{id}:{ch}:direct:{peer}（PR-1A 之前等价行为）', () => {
    const k = generateSessionKey('alice', 'feishu', 'direct', 'ou_xxx', { dmScope: 'per-channel-peer' });
    expect(k).toBe('agent:alice:feishu:direct:ou_xxx');
  });

  it('dmScope=per-account-channel-peer → agent:{id}:{ch}:{acc}:direct:{peer}（最细）', () => {
    const k = generateSessionKey('alice', 'feishu', 'direct', 'ou_xxx', {
      dmScope: 'per-account-channel-peer',
      accountId: 'bot_a',
    });
    expect(k).toBe('agent:alice:feishu:bot_a:direct:ou_xxx');
  });

  it('options 不传 → 回退 per-channel-peer（向后兼容旧调用）', () => {
    const k = generateSessionKey('alice', 'feishu', 'direct', 'ou_xxx');
    expect(k).toBe('agent:alice:feishu:direct:ou_xxx');
  });

  it('群聊 chatType=group 不受 dmScope 影响（强制 channel:kind:peer 格式）', () => {
    const k = generateSessionKey('alice', 'feishu', 'group', 'oc_xxx', { dmScope: 'main' });
    expect(k).toBe('agent:alice:feishu:group:oc_xxx');
  });

  it('DEFAULT_DM_SCOPE 是 main（D3 决策）', () => {
    expect(DEFAULT_DM_SCOPE).toBe('main');
  });
});

describe('generateMainSessionKey', () => {
  it('返回 agent:{id}:main 3 段格式', () => {
    expect(generateMainSessionKey('alice')).toBe('agent:alice:main');
    expect(generateMainSessionKey('agent-with-dash')).toBe('agent:agent-with-dash:main');
  });
});

describe('isMainSessionKey', () => {
  it('main 格式严格 3 段 → true', () => {
    expect(isMainSessionKey('agent:alice:main')).toBe(true);
    expect(isMainSessionKey(generateMainSessionKey('bob'))).toBe(true);
  });

  it('其他格式 → false', () => {
    expect(isMainSessionKey('agent:alice:feishu:direct:ou_xxx')).toBe(false);
    expect(isMainSessionKey('agent:alice:feishu:group:oc_xxx')).toBe(false);
    expect(isMainSessionKey('agent:alice:direct:ou_xxx')).toBe(false);  // per-peer
    expect(isMainSessionKey('agent:alice:main:extra')).toBe(false);  // 多段
  });
});

// ─── M13 Phase 1 PR-1B: identityLookup 集成 ───
describe('generateSessionKey - identityLookup 替换 peerId', () => {
  const lookup = (channel: string, peerId: string): string | null => {
    if (channel === 'feishu' && peerId === 'ou_xxx') return 'self';
    if (channel === 'wecom' && peerId === 'userid_yyy') return 'self';
    return null;
  };

  it('per-peer + identityLookup 命中 → peerId 替换为 canonicalId', () => {
    const k1 = generateSessionKey('alice', 'feishu', 'direct', 'ou_xxx', {
      dmScope: 'per-peer', identityLookup: lookup,
    });
    const k2 = generateSessionKey('alice', 'wecom', 'direct', 'userid_yyy', {
      dmScope: 'per-peer', identityLookup: lookup,
    });
    expect(k1).toBe('agent:alice:direct:self');
    expect(k2).toBe('agent:alice:direct:self');
    // 跨渠道同员工合并到同一 sessionKey
    expect(k1).toBe(k2);
  });

  it('per-channel-peer + identityLookup 命中 → peerId 替换但 channel 仍区分', () => {
    const k1 = generateSessionKey('alice', 'feishu', 'direct', 'ou_xxx', {
      dmScope: 'per-channel-peer', identityLookup: lookup,
    });
    const k2 = generateSessionKey('alice', 'wecom', 'direct', 'userid_yyy', {
      dmScope: 'per-channel-peer', identityLookup: lookup,
    });
    expect(k1).toBe('agent:alice:feishu:direct:self');
    expect(k2).toBe('agent:alice:wecom:direct:self');
    expect(k1).not.toBe(k2);  // channel 还分开
  });

  it('lookup 不命中 → peerId 不变', () => {
    const k = generateSessionKey('alice', 'feishu', 'direct', 'ou_unknown', {
      dmScope: 'per-peer', identityLookup: lookup,
    });
    expect(k).toBe('agent:alice:direct:ou_unknown');
  });

  it('main 模式 identityLookup 不影响（main 不含 peerId）', () => {
    const k = generateSessionKey('alice', 'feishu', 'direct', 'ou_xxx', {
      dmScope: 'main', identityLookup: lookup,
    });
    expect(k).toBe('agent:alice:main');
  });

  it('群聊不受 identityLookup 影响', () => {
    const k = generateSessionKey('alice', 'feishu', 'group', 'oc_xxx', {
      identityLookup: lookup,
    });
    expect(k).toBe('agent:alice:feishu:group:oc_xxx');
  });

  it('lookup 抛错 → 不影响（防御性，但当前实现不 catch）', () => {
    // lookup 抛错时按上层 try/catch 决定，本测试仅文档预期：lookup 应该永不抛
    const safeLookup = () => null;
    const k = generateSessionKey('alice', 'feishu', 'direct', 'ou_xxx', {
      dmScope: 'per-peer', identityLookup: safeLookup,
    });
    expect(k).toBe('agent:alice:direct:ou_xxx');
  });
});

describe('parseSessionKey - main 格式特殊处理', () => {
  it('main 格式 → chatType="main" channel="main"', () => {
    const parsed = parseSessionKey('agent:alice:main');
    expect(parsed.agentId).toBe('alice');
    expect(parsed.chatType).toBe('main');
    expect(parsed.channel).toBe('main');
    expect(parsed.peerId).toBe('');
  });

  it('per-channel-peer 格式正常 5 段解析', () => {
    const parsed = parseSessionKey('agent:alice:feishu:direct:ou_xxx');
    expect(parsed.agentId).toBe('alice');
    expect(parsed.channel).toBe('feishu');
    expect(parsed.chatType).toBe('direct');
    expect(parsed.peerId).toBe('ou_xxx');
  });

  it('群聊格式 5 段解析', () => {
    const parsed = parseSessionKey('agent:alice:feishu:group:oc_xxx');
    expect(parsed.chatType).toBe('group');
    expect(parsed.peerId).toBe('oc_xxx');
  });
});
