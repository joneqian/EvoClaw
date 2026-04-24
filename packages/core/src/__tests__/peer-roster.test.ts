/**
 * 群聊 peer roster 构造器单元测试
 *
 * 覆盖点:
 * - 单 agent / 无 peer → 返回 null
 * - 多 agent 同 channel → 列出,排除 self
 * - 其他 channel 的 binding → 不列
 * - draft / archived peer → 不列
 * - bindingRouter undefined → 返回 null(graceful)
 * - emoji 缺失 → 用 🤖 兜底
 * - channel label 映射(feishu→飞书 / slack→Slack / unknown→原值)
 */

import { describe, it, expect } from 'vitest';
import type { AgentConfig, AgentStatus } from '@evoclaw/shared';
import type { BindingRouter, Binding } from '../routing/binding-router.js';
import type { AgentManager } from '../agent/agent-manager.js';
import { buildGroupPeerRoster } from '../agent/peer-roster.js';

// ─── 测试工具 ────────────────────────────────────────────

function makeBinding(agentId: string, channel: string, accountId: string | null = null): Binding {
  return {
    id: `b-${agentId}-${channel}`,
    agentId,
    channel,
    accountId,
    peerId: null,
    priority: 0,
    isDefault: false,
    createdAt: new Date().toISOString(),
  };
}

function makeAgent(
  id: string,
  name: string,
  emoji: string,
  status: AgentStatus = 'active',
): AgentConfig {
  return {
    id,
    name,
    emoji,
    status,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function mockRouter(bindings: Binding[]): BindingRouter {
  return {
    listBindings: (agentId?: string) =>
      agentId ? bindings.filter((b) => b.agentId === agentId) : bindings,
  } as unknown as BindingRouter;
}

function mockManager(agents: Record<string, AgentConfig | undefined>): AgentManager {
  return {
    getAgent: (id: string) => agents[id],
  } as unknown as AgentManager;
}

// ─── 测试 ────────────────────────────────────────────

describe('buildGroupPeerRoster', () => {
  it('bindingRouter undefined → null', () => {
    const mgr = mockManager({});
    expect(buildGroupPeerRoster('a1', 'feishu', undefined, mgr)).toBeNull();
  });

  it('单 agent 群(只有自己 binding)→ null', () => {
    const router = mockRouter([makeBinding('a1', 'feishu')]);
    const mgr = mockManager({ a1: makeAgent('a1', 'Solo', '🐟') });
    expect(buildGroupPeerRoster('a1', 'feishu', router, mgr)).toBeNull();
  });

  it('两个 peer 同 channel → 列出两个,排除 self', () => {
    const router = mockRouter([
      makeBinding('a1', 'feishu'),
      makeBinding('a2', 'feishu'),
      makeBinding('a3', 'feishu'),
    ]);
    const mgr = mockManager({
      a1: makeAgent('a1', 'Me', '🙂'),
      a2: makeAgent('a2', 'UX设计师', '🎨'),
      a3: makeAgent('a3', '后端专家', '🐟'),
    });

    const result = buildGroupPeerRoster('a1', 'feishu', router, mgr);
    expect(result).not.toBeNull();
    expect(result).toContain('🎨 UX设计师');
    expect(result).toContain('🐟 后端专家');
    expect(result).not.toContain('🙂 Me'); // self 不列
    expect(result).toContain('飞书'); // channel label
  });

  it('其他 channel 的 peer 不进入 roster', () => {
    const router = mockRouter([
      makeBinding('a1', 'feishu'),
      makeBinding('a2', 'feishu'),
      makeBinding('a3', 'wechat'), // 不同 channel
    ]);
    const mgr = mockManager({
      a1: makeAgent('a1', 'Me', '🙂'),
      a2: makeAgent('a2', '飞书同事', '🤝'),
      a3: makeAgent('a3', '微信里的人', '💬'),
    });

    const result = buildGroupPeerRoster('a1', 'feishu', router, mgr);
    expect(result).toContain('🤝 飞书同事');
    expect(result).not.toContain('💬 微信里的人');
  });

  it('draft / archived peer 不列入', () => {
    const router = mockRouter([
      makeBinding('a1', 'feishu'),
      makeBinding('a2', 'feishu'),
      makeBinding('a3', 'feishu'),
      makeBinding('a4', 'feishu'),
    ]);
    const mgr = mockManager({
      a1: makeAgent('a1', 'Me', '🙂'),
      a2: makeAgent('a2', 'Active', '✅', 'active'),
      a3: makeAgent('a3', 'Draft', '📝', 'draft'),
      a4: makeAgent('a4', 'Archived', '📦', 'archived'),
    });

    const result = buildGroupPeerRoster('a1', 'feishu', router, mgr);
    expect(result).toContain('✅ Active');
    expect(result).not.toContain('📝 Draft');
    expect(result).not.toContain('📦 Archived');
  });

  it('所有 peer 都 draft → 返回 null', () => {
    const router = mockRouter([
      makeBinding('a1', 'feishu'),
      makeBinding('a2', 'feishu'),
    ]);
    const mgr = mockManager({
      a1: makeAgent('a1', 'Me', '🙂'),
      a2: makeAgent('a2', 'Draft', '📝', 'draft'),
    });
    expect(buildGroupPeerRoster('a1', 'feishu', router, mgr)).toBeNull();
  });

  it('agentManager 查不到 peer(DB 不一致)→ 跳过,不崩溃', () => {
    const router = mockRouter([
      makeBinding('a1', 'feishu'),
      makeBinding('a2', 'feishu'),
      makeBinding('a3', 'feishu'),
    ]);
    const mgr = mockManager({
      a1: makeAgent('a1', 'Me', '🙂'),
      a2: makeAgent('a2', 'Real', '🎨'),
      // a3 查不到
    });

    const result = buildGroupPeerRoster('a1', 'feishu', router, mgr);
    expect(result).toContain('🎨 Real');
    expect(result).not.toContain('a3');
  });

  it('emoji 为空串 → 用 🤖 兜底', () => {
    const router = mockRouter([
      makeBinding('a1', 'feishu'),
      makeBinding('a2', 'feishu'),
    ]);
    const mgr = mockManager({
      a1: makeAgent('a1', 'Me', '🙂'),
      a2: makeAgent('a2', 'NoEmojiBot', ''),
    });

    const result = buildGroupPeerRoster('a1', 'feishu', router, mgr);
    expect(result).toContain('🤖 NoEmojiBot');
  });

  it('重复 binding(同一 agent 多条 binding)→ 只列一次', () => {
    const router = mockRouter([
      makeBinding('a1', 'feishu'),
      makeBinding('a2', 'feishu', 'cli_x'),
      makeBinding('a2', 'feishu', 'cli_y'), // 同 agent 两个 accountId(理论上不会,防御性)
    ]);
    const mgr = mockManager({
      a1: makeAgent('a1', 'Me', '🙂'),
      a2: makeAgent('a2', 'DupBot', '🔁'),
    });

    const result = buildGroupPeerRoster('a1', 'feishu', router, mgr);
    const matches = result?.match(/DupBot/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('channel label: wechat → 微信', () => {
    const router = mockRouter([
      makeBinding('a1', 'wechat'),
      makeBinding('a2', 'wechat'),
    ]);
    const mgr = mockManager({
      a1: makeAgent('a1', 'Me', '🙂'),
      a2: makeAgent('a2', 'Peer', '👤'),
    });

    const result = buildGroupPeerRoster('a1', 'wechat', router, mgr);
    expect(result).toContain('微信');
    expect(result).not.toContain('wechat group'); // 不留英文残影
  });

  it('channel label: wecom → 企业微信', () => {
    const router = mockRouter([
      makeBinding('a1', 'wecom'),
      makeBinding('a2', 'wecom'),
    ]);
    const mgr = mockManager({
      a1: makeAgent('a1', 'Me', '🙂'),
      a2: makeAgent('a2', 'Peer', '👤'),
    });

    const result = buildGroupPeerRoster('a1', 'wecom', router, mgr);
    expect(result).toContain('企业微信');
  });

  it('未知 channel → 兜底用原值(不报错)', () => {
    const router = mockRouter([
      makeBinding('a1', 'mystery-channel'),
      makeBinding('a2', 'mystery-channel'),
    ]);
    const mgr = mockManager({
      a1: makeAgent('a1', 'Me', '🙂'),
      a2: makeAgent('a2', 'Peer', '👤'),
    });

    const result = buildGroupPeerRoster('a1', 'mystery-channel', router, mgr);
    expect(result).toContain('mystery-channel');
    expect(result).toContain('👤 Peer');
  });

  it('输出含完整引导文案(防御性检查关键指令没漏)', () => {
    const router = mockRouter([
      makeBinding('a1', 'feishu'),
      makeBinding('a2', 'feishu'),
    ]);
    const mgr = mockManager({
      a1: makeAgent('a1', 'Me', '🙂'),
      a2: makeAgent('a2', 'Peer', '👤'),
    });

    const result = buildGroupPeerRoster('a1', 'feishu', router, mgr);
    expect(result).toContain('<group_peers>');
    expect(result).toContain('</group_peers>');
    expect(result).toContain('Not my area');
    expect(result).toContain('teammate');
    expect(result).toContain("Don't try to answer it yourself");
  });
});
