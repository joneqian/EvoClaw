/**
 * FeishuTeamChannel + FeishuPeerBotRegistry 单元测试（M13 PR3）
 *
 * 覆盖：
 *   - classifyInboundMessage 四分支（user / self / peer / stranger）
 *   - 被动缓存：classifyPeer 副作用更新 registry
 *   - listPeerBots 按 chatId + bindings 取交集 + 排除 self
 *   - openId 缺失时 fallback 用 appId
 *   - notifyMembershipChange 触发订阅者
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../../infrastructure/db/migration-runner.js';
import { BindingRouter } from '../../routing/binding-router.js';
import { FeishuPeerBotRegistry } from '../../channel/adapters/feishu/common/peer-bot-registry.js';
import { FeishuTeamChannel } from '../../channel/adapters/feishu/team-channel.js';

async function setupBindings(): Promise<{
  store: SqliteStore;
  bindingRouter: BindingRouter;
  registry: FeishuPeerBotRegistry;
  adapter: FeishuTeamChannel;
}> {
  const store = new SqliteStore(':memory:');
  await new MigrationRunner(store).run();

  // 创建 3 个 agent 用 SQL 直插（绕过 AgentManager 的 workspace 创建）
  store.run(
    `INSERT INTO agents (id, name, emoji, status, config_json) VALUES
       ('a-self', 'Self', '🤖', 'active', '{}'),
       ('a-peer1', 'Peer1', '✨', 'active', '{}'),
       ('a-peer2', 'Peer2', '🎨', 'active', '{}')`,
  );

  const bindingRouter = new BindingRouter(store);
  bindingRouter.addBinding({
    agentId: 'a-self',
    channel: 'feishu',
    accountId: 'cli_self',
    peerId: null,
    priority: 0,
    isDefault: false,
  });
  bindingRouter.addBinding({
    agentId: 'a-peer1',
    channel: 'feishu',
    accountId: 'cli_peer1',
    peerId: null,
    priority: 0,
    isDefault: false,
  });
  bindingRouter.addBinding({
    agentId: 'a-peer2',
    channel: 'feishu',
    accountId: 'cli_peer2',
    peerId: null,
    priority: 0,
    isDefault: false,
  });

  const registry = new FeishuPeerBotRegistry({ bindingRouter });
  const adapter = new FeishuTeamChannel({ peerBotRegistry: registry, bindingRouter });
  return { store, bindingRouter, registry, adapter };
}

describe('FeishuTeamChannel · classifyInboundMessage', () => {
  let setup: Awaited<ReturnType<typeof setupBindings>>;

  beforeEach(async () => {
    setup = await setupBindings();
  });

  it('真人用户 → kind=user', async () => {
    const event = {
      sender: { sender_type: 'user', sender_id: { open_id: 'ou_user' } },
      message: { chat_id: 'oc_x' },
    };
    const result = await setup.adapter.classifyInboundMessage(event, {
      agentId: 'a-self',
      accountId: 'cli_self',
    });
    expect(result.kind).toBe('user');
    if (result.kind === 'user') expect(result.userId).toBe('ou_user');
  });

  it('自己 bot → kind=self', async () => {
    const event = {
      sender: {
        sender_type: 'app',
        sender_id: { open_id: 'ou_self', app_id: 'cli_self' },
      },
      message: { chat_id: 'oc_x' },
    };
    const result = await setup.adapter.classifyInboundMessage(event, {
      agentId: 'a-self',
      accountId: 'cli_self',
    });
    expect(result.kind).toBe('self');
  });

  it('同事 bot（在 bindings 表） → kind=peer + 副作用注册到 registry', async () => {
    const event = {
      sender: {
        sender_type: 'app',
        sender_id: { open_id: 'ou_peer1', app_id: 'cli_peer1', union_id: 'un_peer1' },
      },
      message: { chat_id: 'oc_x' },
    };
    const result = await setup.adapter.classifyInboundMessage(event, {
      agentId: 'a-self',
      accountId: 'cli_self',
    });
    expect(result.kind).toBe('peer');
    if (result.kind === 'peer') expect(result.senderAgentId).toBe('a-peer1');

    // 副作用：registry 已学到 peer1 在 oc_x（含 viewer=cli_self 视角的 openId）
    // bootstrap 修复后 listInChat 还会兜底加 a-peer2（bindings 候选），
    // 但 a-peer1 一定在前（来自精确观察），且唯一带 openId 的是它
    const inChat = setup.registry.listInChat('oc_x', 'cli_self', 'a-self');
    expect(inChat.map((p) => p.agentId).sort()).toEqual(['a-peer1', 'a-peer2']);
    const peer1Entry = inChat.find((p) => p.agentId === 'a-peer1');
    expect(peer1Entry?.openId).toBe('ou_peer1');
    const peer2Entry = inChat.find((p) => p.agentId === 'a-peer2');
    expect(peer2Entry?.openId).toBeUndefined(); // bootstrap 候选，未观察过
  });

  it('陌生 app（不在 bindings） → kind=stranger', async () => {
    const event = {
      sender: {
        sender_type: 'app',
        sender_id: { open_id: 'ou_unk', app_id: 'cli_outsider' },
      },
      message: { chat_id: 'oc_x' },
    };
    const result = await setup.adapter.classifyInboundMessage(event, {
      agentId: 'a-self',
      accountId: 'cli_self',
    });
    expect(result.kind).toBe('stranger');
  });

  it('缺 sender → stranger', async () => {
    const result = await setup.adapter.classifyInboundMessage({}, {
      agentId: 'a-self',
      accountId: 'cli_self',
    });
    expect(result.kind).toBe('stranger');
  });

  it('app 无 app_id → stranger', async () => {
    const event = {
      sender: { sender_type: 'app', sender_id: { open_id: 'ou_ghost' } },
      message: { chat_id: 'oc_x' },
    };
    const result = await setup.adapter.classifyInboundMessage(event, {
      agentId: 'a-self',
      accountId: 'cli_self',
    });
    expect(result.kind).toBe('stranger');
  });
});

describe('FeishuTeamChannel · listPeerBots', () => {
  let setup: Awaited<ReturnType<typeof setupBindings>>;

  beforeEach(async () => {
    setup = await setupBindings();
  });

  it('被动缓存空 → bootstrap 兜底用 bindings 候选，但 mentionId 为空（cross-app 安全）', async () => {
    // M13 cross-app 修复：即使没观察到任何 bot，listPeerBots 也返回所有 bindings 候选 agent
    // 但 mentionId 为空字符串——因为没有 viewer 视角的 openId，调用方应降级纯文本 @<name>
    const peers = await setup.adapter.listPeerBots('feishu:chat:oc_x', 'a-self');
    expect(peers.map((p) => p.agentId).sort()).toEqual(['a-peer1', 'a-peer2']);
    expect(peers.find((p) => p.agentId === 'a-peer1')?.mentionId).toBe('');
    expect(peers.find((p) => p.agentId === 'a-peer2')?.mentionId).toBe('');
  });

  it('两个 peer 在 viewer=cli_self 视角下被观察 → mentionId 是 viewer 视角的 openId', async () => {
    setup.registry.registerBotInChat({
      chatId: 'oc_x',
      viewerAppId: 'cli_self',
      targetAppId: 'cli_peer1',
      targetUnionId: 'un_peer1',
      openId: 'ou_peer1_self_view',
    });
    setup.registry.registerBotInChat({
      chatId: 'oc_x',
      viewerAppId: 'cli_self',
      targetAppId: 'cli_peer2',
      targetUnionId: 'un_peer2',
      openId: 'ou_peer2_self_view',
    });

    const peers = await setup.adapter.listPeerBots('feishu:chat:oc_x', 'a-self');
    const peer1 = peers.find((p) => p.agentId === 'a-peer1');
    const peer2 = peers.find((p) => p.agentId === 'a-peer2');
    expect(peer1?.mentionId).toBe('ou_peer1_self_view');
    expect(peer2?.mentionId).toBe('ou_peer2_self_view');
  });

  it('openId 未学到 → mentionId 为空（不再用 appId 兜底）', async () => {
    // 占位：仅有 appId，没有 union_id / openId
    setup.registry.registerBotInChat({
      chatId: 'oc_x',
      viewerAppId: 'cli_self',
      targetAppId: 'cli_peer1',
    });
    const peers = await setup.adapter.listPeerBots('feishu:chat:oc_x', 'a-self');
    const peer1 = peers.find((p) => p.agentId === 'a-peer1');
    expect(peer1?.mentionId).toBe('');  // 空字符串 → 调用方降级纯文本
  });

  it('陌生 bot 出现在群 → 不进 list（仅返回 bindings 候选）', async () => {
    setup.registry.registerBotInChat({
      chatId: 'oc_x',
      viewerAppId: 'cli_self',
      targetAppId: 'cli_outsider',
      targetUnionId: 'un_outsider',
      openId: 'ou_unk',
    });
    const peers = await setup.adapter.listPeerBots('feishu:chat:oc_x', 'a-self');
    expect(peers.map((p) => p.agentId).sort()).toEqual(['a-peer1', 'a-peer2']);
    // 陌生 outsider 没在 bindings 里，不会出现
    expect(peers.find((p) => p.mentionId === 'ou_unk')).toBeUndefined();
  });

  // M13 cross-app 修复关键回归
  it('viewer 隔离：viewer=A 学到的 openId 不会污染 viewer=B 视角', async () => {
    // viewer cli_self 视角：peer1 = ou_peer1_self_view
    setup.registry.registerBotInChat({
      chatId: 'oc_x',
      viewerAppId: 'cli_self',
      targetAppId: 'cli_peer1',
      targetUnionId: 'un_peer1',
      openId: 'ou_peer1_self_view',
    });
    // viewer cli_peer2 视角：peer1 = ou_peer1_peer2_view（同一个机器人，不同视角）
    setup.registry.registerBotInChat({
      chatId: 'oc_x',
      viewerAppId: 'cli_peer2',
      targetAppId: 'cli_peer1',
      targetUnionId: 'un_peer1',
      openId: 'ou_peer1_peer2_view',
    });

    // a-self（cli_self 视角）应得 self_view
    const fromSelf = await setup.adapter.listPeerBots('feishu:chat:oc_x', 'a-self');
    expect(fromSelf.find((p) => p.agentId === 'a-peer1')?.mentionId).toBe('ou_peer1_self_view');

    // a-peer2（cli_peer2 视角）应得 peer2_view
    const fromPeer2 = await setup.adapter.listPeerBots('feishu:chat:oc_x', 'a-peer2');
    expect(fromPeer2.find((p) => p.agentId === 'a-peer1')?.mentionId).toBe('ou_peer1_peer2_view');
  });

  it('groupSessionKey 格式错误 → 空', async () => {
    const peers = await setup.adapter.listPeerBots('garbage', 'a-self');
    expect(peers).toEqual([]);
  });
});

describe('FeishuTeamChannel · onGroupMembershipChanged', () => {
  let setup: Awaited<ReturnType<typeof setupBindings>>;

  beforeEach(async () => {
    setup = await setupBindings();
  });

  it('notifyMembershipChange 通知所有订阅者', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    setup.adapter.onGroupMembershipChanged(handler1);
    setup.adapter.onGroupMembershipChanged(handler2);

    setup.adapter.notifyMembershipChange('oc_x', 'added');

    expect(handler1).toHaveBeenCalledWith('feishu:chat:oc_x');
    expect(handler2).toHaveBeenCalledWith('feishu:chat:oc_x');
  });

  it('订阅者抛错不影响其他', () => {
    const errH = vi.fn(() => {
      throw new Error('boom');
    });
    const okH = vi.fn();
    setup.adapter.onGroupMembershipChanged(errH);
    setup.adapter.onGroupMembershipChanged(okH);
    setup.adapter.notifyMembershipChange('oc_x', 'deleted');
    expect(errH).toHaveBeenCalled();
    expect(okH).toHaveBeenCalled();
  });
});

describe('FeishuTeamChannel · buildMention / renderTaskBoard', () => {
  let setup: Awaited<ReturnType<typeof setupBindings>>;

  beforeEach(async () => {
    setup = await setupBindings();
  });

  it('buildMention 真·@（mentionId 是 ou_xxx）→ <at user_id> 标记', async () => {
    const out = await setup.adapter.buildMention(
      'feishu:chat:oc_x',
      {
        agentId: 'a-peer1',
        mentionId: 'ou_peer1',
        name: '阿辉',
        emoji: '✨',
        role: 'backend',
      },
      '请实现登录接口',
      { taskId: 't1' },
    );
    expect(out.channelType).toBe('feishu');
    // S2 修复后：fallbackText 是 <at user_id="ou_xxx"/> 走 markdown-to-post 真·@
    expect(out.fallbackText).toBe('<at user_id="ou_peer1"/> 请实现登录接口');
    expect(out.metadata?.taskId).toBe('t1');
  });

  it('buildMention 退化（mentionId 是 appId，openId 还没学到）→ plain @', async () => {
    const out = await setup.adapter.buildMention(
      'feishu:chat:oc_x',
      {
        agentId: 'a-peer1',
        mentionId: 'cli_peer1', // 还是 appId，不是 ou_
        name: '阿辉',
        emoji: '✨',
        role: 'backend',
      },
      'hello',
    );
    // 不是 ou_ 开头 → 退到纯文本
    expect(out.fallbackText).toBe('@阿辉 hello');
  });

  it('renderTaskBoard 返回带 fallbackText + payload', () => {
    const out = setup.adapter.renderTaskBoard({
      id: 'p1',
      groupSessionKey: 'feishu:chat:oc_x',
      channelType: 'feishu',
      goal: '做一个落地页',
      status: 'active',
      tasks: [
        {
          id: 'task-uuid-1',
          localId: 't1',
          title: '设计稿',
          assignee: { agentId: 'a-peer2', name: '小林', emoji: '🎨' },
          status: 'pending',
          dependsOn: [],
          artifacts: [],
        },
      ],
      createdBy: { agentId: 'a-self', name: 'PM', emoji: '🤖' },
      createdAt: 0,
      updatedAt: 0,
    });
    expect(out.fallbackText).toContain('做一个落地页');
    expect(out.fallbackText).toContain('设计稿');
    expect(out.payload).toBeTruthy();
  });
});
