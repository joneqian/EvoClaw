/**
 * FeishuPeerBotRegistry cross-app 隔离测试（M13 修复）
 *
 * 核心保证：
 *   - 飞书 open_id 是 app-scoped 的，每个 viewer App 视角下同一机器人 open_id 不同
 *   - registry 必须按 viewer 维度隔离，不能让 A 视角学到的 openId 污染 B 视角
 *   - 冷启动期 viewer 没观察到 target 时，listInChat 返回 openId=undefined，
 *     调用方应降级纯文本 @<name>，**不能**用 binding.bot_open_id 兜底
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FeishuPeerBotRegistry } from '../../channel/adapters/feishu/common/peer-bot-registry.js';
import { BindingRouter } from '../../routing/binding-router.js';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../../infrastructure/db/migration-runner.js';

describe('FeishuPeerBotRegistry · cross-app 隔离', () => {
  let store: SqliteStore;
  let bindingRouter: BindingRouter;
  let registry: FeishuPeerBotRegistry;

  beforeEach(async () => {
    store = new SqliteStore(':memory:');
    await new MigrationRunner(store).run();
    bindingRouter = new BindingRouter(store);
    registry = new FeishuPeerBotRegistry({ bindingRouter });

    // 准备 4 个 agent + bindings（属于不同 App）
    for (const id of ['a-self', 'a-peer1', 'a-peer2', 'a-peer3']) {
      store.run(
        `INSERT INTO agents (id, name, emoji, status, created_at, updated_at) VALUES (?, ?, '🤖', 'active', datetime('now'), datetime('now'))`,
        id, id,
      );
    }
    bindingRouter.addBinding({ agentId: 'a-self', channel: 'feishu', accountId: 'cli_self', peerId: null, priority: 0, isDefault: false });
    bindingRouter.addBinding({ agentId: 'a-peer1', channel: 'feishu', accountId: 'cli_peer1', peerId: null, priority: 0, isDefault: false });
    bindingRouter.addBinding({ agentId: 'a-peer2', channel: 'feishu', accountId: 'cli_peer2', peerId: null, priority: 0, isDefault: false });
    bindingRouter.addBinding({ agentId: 'a-peer3', channel: 'feishu', accountId: 'cli_peer3', peerId: null, priority: 0, isDefault: false });
  });

  it('viewer A 学到的 openId 不会出现在 viewer B 视角下', () => {
    // viewer cli_self 学到 peer1 = ou_peer1_self_view
    registry.registerBotInChat({
      chatId: 'oc_x',
      viewerAppId: 'cli_self',
      targetAppId: 'cli_peer1',
      targetUnionId: 'un_peer1',
      openId: 'ou_peer1_self_view',
    });

    // viewer cli_peer2 还没学到 peer1 → 视角下 peer1 的 openId 应为 undefined
    const fromPeer2 = registry.listInChat('oc_x', 'cli_peer2', 'a-peer2');
    const peer1FromPeer2 = fromPeer2.find((p) => p.appId === 'cli_peer1');
    expect(peer1FromPeer2).toBeDefined();
    expect(peer1FromPeer2?.openId).toBeUndefined();   // 关键：不污染

    // viewer cli_self 视角下应能拿到 ou_peer1_self_view
    const fromSelf = registry.listInChat('oc_x', 'cli_self', 'a-self');
    const peer1FromSelf = fromSelf.find((p) => p.appId === 'cli_peer1');
    expect(peer1FromSelf?.openId).toBe('ou_peer1_self_view');
  });

  it('同一 union_id 在不同 viewer 视角下分别独立维护 openId', () => {
    // peer1 的 union_id 是 un_peer1（跨 viewer 一致）
    // 但 ou_xxx 在每个 viewer 视角下都不一样
    registry.registerBotInChat({
      chatId: 'oc_x',
      viewerAppId: 'cli_self',
      targetAppId: 'cli_peer1',
      targetUnionId: 'un_peer1',
      openId: 'ou_peer1_AS_SEEN_BY_self',
    });
    registry.registerBotInChat({
      chatId: 'oc_x',
      viewerAppId: 'cli_peer2',
      targetAppId: 'cli_peer1',
      targetUnionId: 'un_peer1',
      openId: 'ou_peer1_AS_SEEN_BY_peer2',
    });
    registry.registerBotInChat({
      chatId: 'oc_x',
      viewerAppId: 'cli_peer3',
      targetAppId: 'cli_peer1',
      targetUnionId: 'un_peer1',
      openId: 'ou_peer1_AS_SEEN_BY_peer3',
    });

    expect(
      registry.listInChat('oc_x', 'cli_self', 'a-self').find((p) => p.appId === 'cli_peer1')?.openId,
    ).toBe('ou_peer1_AS_SEEN_BY_self');

    expect(
      registry.listInChat('oc_x', 'cli_peer2', 'a-peer2').find((p) => p.appId === 'cli_peer1')?.openId,
    ).toBe('ou_peer1_AS_SEEN_BY_peer2');

    expect(
      registry.listInChat('oc_x', 'cli_peer3', 'a-peer3').find((p) => p.appId === 'cli_peer1')?.openId,
    ).toBe('ou_peer1_AS_SEEN_BY_peer3');

    // union_id 跨视角一致，做业务层去重时正确
    const fromSelf = registry.listInChat('oc_x', 'cli_self', 'a-self').find((p) => p.appId === 'cli_peer1');
    const fromPeer2 = registry.listInChat('oc_x', 'cli_peer2', 'a-peer2').find((p) => p.appId === 'cli_peer1');
    expect(fromSelf?.unionId).toBe(fromPeer2?.unionId);  // un_peer1
  });

  it('binding 兜底候选 openId 必为空（不再用 self-view 工号污染其他 viewer）', () => {
    // 没有任何观察事件，仅靠 bindings 表
    const result = registry.listInChat('oc_x', 'cli_self', 'a-self');
    // 应返回 peer1/peer2/peer3 候选（用于 prompt 让 LLM 知道有这些同事），但 openId 都空
    expect(result.map((p) => p.agentId).sort()).toEqual(['a-peer1', 'a-peer2', 'a-peer3']);
    for (const p of result) {
      expect(p.openId).toBeUndefined();
    }
  });

  it('classifyPeer 写入时按 viewer 隔离', () => {
    const result = registry.classifyPeer({
      viewerAccountId: 'cli_self',
      chatId: 'oc_x',
      senderAppId: 'cli_peer1',
      senderOpenId: 'ou_p1_self',
      senderUnionId: 'un_peer1',
    });
    expect(result?.agentId).toBe('a-peer1');
    expect(result?.openId).toBe('ou_p1_self');
    expect(result?.unionId).toBe('un_peer1');

    // viewer cli_peer2 视角下不会自动获得 ou_p1_self
    const fromPeer2 = registry.listInChat('oc_x', 'cli_peer2', 'a-peer2').find((p) => p.appId === 'cli_peer1');
    expect(fromPeer2?.openId).toBeUndefined();
  });

  it('占位（无 union_id）→ 升级（带 union_id + openId）', () => {
    // bot.added 事件先占位（仅 appId）
    registry.registerBotInChat({
      chatId: 'oc_x',
      viewerAppId: 'cli_self',
      targetAppId: 'cli_peer1',
    });
    // 这时 listInChat 仍能列出 candidate（占位 set + bindings 兜底，二者重复去重），openId 空
    const before = registry.listInChat('oc_x', 'cli_self', 'a-self').find((p) => p.appId === 'cli_peer1');
    expect(before?.openId).toBeUndefined();

    // 入站消息升级
    registry.registerBotInChat({
      chatId: 'oc_x',
      viewerAppId: 'cli_self',
      targetAppId: 'cli_peer1',
      targetUnionId: 'un_peer1',
      openId: 'ou_p1_real',
    });
    const after = registry.listInChat('oc_x', 'cli_self', 'a-self').find((p) => p.appId === 'cli_peer1');
    expect(after?.openId).toBe('ou_p1_real');
    expect(after?.unionId).toBe('un_peer1');
  });

  it('unregisterBotInChat 全 viewer 视角下清掉 target', () => {
    registry.registerBotInChat({
      chatId: 'oc_x',
      viewerAppId: 'cli_self',
      targetAppId: 'cli_peer1',
      targetUnionId: 'un_peer1',
      openId: 'ou_p1_self',
    });
    registry.registerBotInChat({
      chatId: 'oc_x',
      viewerAppId: 'cli_peer2',
      targetAppId: 'cli_peer1',
      targetUnionId: 'un_peer1',
      openId: 'ou_p1_peer2',
    });

    registry.unregisterBotInChat('oc_x', 'cli_peer1');

    // 两个 viewer 视角下 peer1 的 openId 都没了（仅余 bindings 兜底候选，openId 空）
    const fromSelf = registry.listInChat('oc_x', 'cli_self', 'a-self').find((p) => p.appId === 'cli_peer1');
    const fromPeer2 = registry.listInChat('oc_x', 'cli_peer2', 'a-peer2').find((p) => p.appId === 'cli_peer1');
    expect(fromSelf?.openId).toBeUndefined();
    expect(fromPeer2?.openId).toBeUndefined();
  });
});
