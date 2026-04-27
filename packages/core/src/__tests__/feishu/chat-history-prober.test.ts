/**
 * chat-history-prober 单元测试（M13 cross-app 修复）
 *
 * 覆盖：
 *   - 拉历史消息提取 sender_type='app' → 写入 registry
 *   - 自己（viewer === target）跳过
 *   - 陌生 bot（不在 bindings）跳过
 *   - 用户消息（sender_type='user'）跳过
 *   - API 抛错 / 业务错码静默吞掉返回零结果
 *   - cache TTL 内不重复 probe
 *   - in-flight 并发去重
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { probeChatHistory, ChatHistoryProberCache } from '../../channel/adapters/feishu/chat-history-prober.js';
import { FeishuPeerBotRegistry } from '../../channel/adapters/feishu/peer-bot-registry.js';
import { BindingRouter } from '../../routing/binding-router.js';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../../infrastructure/db/migration-runner.js';
import type * as Lark from '@larksuiteoapi/node-sdk';

// Mock Lark Client — prober 走 client.request 低层 API（SDK 高层在 Bun 下 socket close）
function makeMockClient(messageListResponse: unknown): Lark.Client {
  const request = vi.fn().mockResolvedValue(messageListResponse);
  return { request } as unknown as Lark.Client;
}

async function setupRegistry() {
  const store = new SqliteStore(':memory:');
  await new MigrationRunner(store).run();
  const bindingRouter = new BindingRouter(store);
  // 建 agents 行 + bindings
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
  const registry = new FeishuPeerBotRegistry({ bindingRouter });
  return { bindingRouter, registry };
}

describe('probeChatHistory', () => {
  let setup: Awaited<ReturnType<typeof setupRegistry>>;

  beforeEach(async () => {
    setup = await setupRegistry();
  });

  it('从历史消息提取 sender_type=app + 写入 registry（viewer=cli_self 视角）', async () => {
    const client = makeMockClient({
      code: 0,
      data: {
        items: [
          {
            message_id: 'om_1',
            sender: {
              sender_type: 'app',
              sender_id: { open_id: 'ou_p1_self_view', app_id: 'cli_peer1', union_id: 'un_peer1' },
            },
          },
          {
            message_id: 'om_2',
            sender: {
              sender_type: 'app',
              sender_id: { open_id: 'ou_p2_self_view', app_id: 'cli_peer2', union_id: 'un_peer2' },
            },
          },
        ],
      },
    });

    const result = await probeChatHistory({
      client,
      chatId: 'oc_x',
      viewerAccountId: 'cli_self',
      bindingRouter: setup.bindingRouter,
      registry: setup.registry,
    });

    expect(result.scanned).toBe(2);
    expect(result.learned).toBe(2);
    expect(result.learnedAgents).toBe(2);

    // registry 应有 viewer=cli_self 视角的 entry
    const peers = setup.registry.listInChat('oc_x', 'cli_self', 'a-self');
    expect(peers.find((p) => p.agentId === 'a-peer1')?.openId).toBe('ou_p1_self_view');
    expect(peers.find((p) => p.agentId === 'a-peer2')?.openId).toBe('ou_p2_self_view');
  });

  it('SDK 兼容：sender.id 字段名也能识别（除 sender_id 外）', async () => {
    const client = makeMockClient({
      code: 0,
      data: {
        items: [
          {
            message_id: 'om_alt',
            sender: {
              sender_type: 'app',
              id: { open_id: 'ou_p1', app_id: 'cli_peer1', union_id: 'un_peer1' },
            },
          },
        ],
      },
    });

    const result = await probeChatHistory({
      client,
      chatId: 'oc_x',
      viewerAccountId: 'cli_self',
      bindingRouter: setup.bindingRouter,
      registry: setup.registry,
    });

    expect(result.learned).toBe(1);
  });

  it('用户消息（sender_type=user）跳过', async () => {
    const client = makeMockClient({
      code: 0,
      data: {
        items: [
          {
            message_id: 'om_u',
            sender: {
              sender_type: 'user',
              sender_id: { open_id: 'ou_user', user_id: 'u_xxx' },
            },
          },
        ],
      },
    });

    const result = await probeChatHistory({
      client,
      chatId: 'oc_x',
      viewerAccountId: 'cli_self',
      bindingRouter: setup.bindingRouter,
      registry: setup.registry,
    });

    expect(result.scanned).toBe(1);
    expect(result.learned).toBe(0);
  });

  it('陌生 bot（不在 bindings）跳过', async () => {
    const client = makeMockClient({
      code: 0,
      data: {
        items: [
          {
            sender: {
              sender_type: 'app',
              sender_id: { open_id: 'ou_outsider', app_id: 'cli_outsider', union_id: 'un_outsider' },
            },
          },
        ],
      },
    });

    const result = await probeChatHistory({
      client,
      chatId: 'oc_x',
      viewerAccountId: 'cli_self',
      bindingRouter: setup.bindingRouter,
      registry: setup.registry,
    });

    expect(result.learned).toBe(0);
  });

  it('自己 App 发的消息（viewer === sender）跳过', async () => {
    const client = makeMockClient({
      code: 0,
      data: {
        items: [
          {
            sender: {
              sender_type: 'app',
              sender_id: { open_id: 'ou_self', app_id: 'cli_self', union_id: 'un_self' },
            },
          },
        ],
      },
    });

    const result = await probeChatHistory({
      client,
      chatId: 'oc_x',
      viewerAccountId: 'cli_self',
      bindingRouter: setup.bindingRouter,
      registry: setup.registry,
    });

    expect(result.learned).toBe(0);
  });

  it('API 抛网络错 → 静默吞掉返回零', async () => {
    const client = {
      request: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
    } as unknown as Lark.Client;

    const result = await probeChatHistory({
      client,
      chatId: 'oc_x',
      viewerAccountId: 'cli_self',
      bindingRouter: setup.bindingRouter,
      registry: setup.registry,
    });

    expect(result.scanned).toBe(0);
    expect(result.learned).toBe(0);
  });

  it('API 业务错码（code != 0）→ 静默吞掉返回零', async () => {
    const client = makeMockClient({
      code: 99991663,
      msg: 'permission denied',
      data: { items: [] },
    });

    const result = await probeChatHistory({
      client,
      chatId: 'oc_x',
      viewerAccountId: 'cli_self',
      bindingRouter: setup.bindingRouter,
      registry: setup.registry,
    });

    expect(result.scanned).toBe(0);
  });

  it('混合消息：用户 + 多个 bot + 陌生 → 仅 known peer bot 写入', async () => {
    const client = makeMockClient({
      code: 0,
      data: {
        items: [
          { sender: { sender_type: 'user', sender_id: { open_id: 'ou_u' } } },
          { sender: { sender_type: 'app', sender_id: { open_id: 'ou_p1', app_id: 'cli_peer1', union_id: 'un_p1' } } },
          { sender: { sender_type: 'app', sender_id: { open_id: 'ou_alien', app_id: 'cli_alien', union_id: 'un_a' } } },
          { sender: { sender_type: 'app', sender_id: { open_id: 'ou_p3', app_id: 'cli_peer3', union_id: 'un_p3' } } },
          { sender: { sender_type: 'user', sender_id: { open_id: 'ou_u2' } } },
        ],
      },
    });

    const result = await probeChatHistory({
      client,
      chatId: 'oc_x',
      viewerAccountId: 'cli_self',
      bindingRouter: setup.bindingRouter,
      registry: setup.registry,
    });

    expect(result.scanned).toBe(5);
    expect(result.learned).toBe(2);   // peer1 + peer3
    expect(result.learnedAgents).toBe(2);
  });
});

describe('ChatHistoryProberCache', () => {
  let setup: Awaited<ReturnType<typeof setupRegistry>>;

  beforeEach(async () => {
    setup = await setupRegistry();
  });

  it('TTL 内同 (chatId, viewer) 不重复 probe', async () => {
    const list = vi.fn().mockResolvedValue({
      code: 0,
      data: { items: [{ sender: { sender_type: 'app', sender_id: { open_id: 'ou_p1', app_id: 'cli_peer1', union_id: 'un_p1' } } }] },
    });
    const client = { request: list } as unknown as Lark.Client;

    const cache = new ChatHistoryProberCache(60_000);  // 60s TTL
    const args = {
      client,
      chatId: 'oc_x',
      viewerAccountId: 'cli_self',
      bindingRouter: setup.bindingRouter,
      registry: setup.registry,
    };

    const r1 = await cache.probeOnce(args);
    expect(r1).not.toBeNull();
    expect(list).toHaveBeenCalledTimes(1);

    // 第二次同 key 应命中缓存返回 null
    const r2 = await cache.probeOnce(args);
    expect(r2).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('不同 viewer 各自维护 TTL', async () => {
    const list = vi.fn().mockResolvedValue({
      code: 0,
      data: { items: [{ sender: { sender_type: 'app', sender_id: { open_id: 'ou_p1', app_id: 'cli_peer1', union_id: 'un_p1' } } }] },
    });
    const client = { request: list } as unknown as Lark.Client;

    const cache = new ChatHistoryProberCache();

    await cache.probeOnce({
      client, chatId: 'oc_x', viewerAccountId: 'cli_self',
      bindingRouter: setup.bindingRouter, registry: setup.registry,
    });
    await cache.probeOnce({
      client, chatId: 'oc_x', viewerAccountId: 'cli_peer2',
      bindingRouter: setup.bindingRouter, registry: setup.registry,
    });

    // 两个不同 viewer，各 probe 一次
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('并发同 key probe → 仅发一次 RPC（in-flight 去重）', async () => {
    let resolveListCall: ((v: unknown) => void) | undefined;
    const list = vi.fn().mockReturnValue(
      new Promise((res) => {
        resolveListCall = res;
      }),
    );
    const client = { request: list } as unknown as Lark.Client;

    const cache = new ChatHistoryProberCache();
    const args = {
      client, chatId: 'oc_x', viewerAccountId: 'cli_self',
      bindingRouter: setup.bindingRouter, registry: setup.registry,
    };

    const p1 = cache.probeOnce(args);
    const p2 = cache.probeOnce(args);
    const p3 = cache.probeOnce(args);

    // 并发调用，仅 list 一次
    expect(list).toHaveBeenCalledTimes(1);

    // 解锁
    resolveListCall!({ code: 0, data: { items: [] } });
    await Promise.all([p1, p2, p3]);

    // 后续仍然命中缓存
    const r4 = await cache.probeOnce(args);
    expect(r4).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('reset() 清空缓存允许立即重 probe', async () => {
    const list = vi.fn().mockResolvedValue({ code: 0, data: { items: [] } });
    const client = { request: list } as unknown as Lark.Client;

    const cache = new ChatHistoryProberCache(60_000);
    const args = {
      client, chatId: 'oc_x', viewerAccountId: 'cli_self',
      bindingRouter: setup.bindingRouter, registry: setup.registry,
    };

    await cache.probeOnce(args);
    expect(list).toHaveBeenCalledTimes(1);

    cache.reset();
    await cache.probeOnce(args);
    expect(list).toHaveBeenCalledTimes(2);
  });
});
