/**
 * Channel routes 针对"凭据持久化 + 编辑配置"新行为的单元测试
 *
 * 覆盖：
 * - POST /disconnect 默认保留 credentials，purge=true 才清除
 * - GET /credentials/:type 脱敏（appSecret 等敏感字段不返回）+ hasSecret 标志
 * - POST /connect 当 appSecret 留空 + DB 有旧值时自动沿用
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChannelRoutes } from '../../routes/channel.js';
import type { ChannelManager } from '../../channel/channel-manager.js';
import type { ChannelStateRepo } from '../../channel/channel-state-repo.js';
import type { BindingRouter } from '../../routing/binding-router.js';

/** 内存版 ChannelStateRepo，足够本次测试 */
function createMemRepo(): ChannelStateRepo & {
  _store: Map<string, string>;
} {
  const store = new Map<string, string>();
  const repo = {
    getState: (channel: string, key: string) => store.get(`${channel}:${key}`) ?? null,
    setState: (channel: string, key: string, value: string) => {
      store.set(`${channel}:${key}`, value);
    },
    deleteState: (channel: string, key: string) => {
      store.delete(`${channel}:${key}`);
    },
    _store: store,
  };
  return repo as unknown as ChannelStateRepo & { _store: Map<string, string> };
}

function createFakeManager() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getStatuses: vi.fn().mockReturnValue([]),
    getStatus: vi.fn().mockReturnValue(null),
    sendMessage: vi.fn(),
    onMessage: vi.fn(),
  } as unknown as ChannelManager;
}

function createFakeBindingRouter() {
  return {
    listBindings: vi.fn().mockReturnValue([]),
    removeBinding: vi.fn(),
    addBinding: vi.fn().mockReturnValue('id_1'),
  } as unknown as BindingRouter;
}

describe('POST /channel/disconnect', () => {
  let repo: ReturnType<typeof createMemRepo>;
  let manager: ReturnType<typeof createFakeManager>;
  let binding: ReturnType<typeof createFakeBindingRouter>;

  beforeEach(() => {
    repo = createMemRepo();
    manager = createFakeManager();
    binding = createFakeBindingRouter();
    repo.setState('feishu', 'credentials', JSON.stringify({ appId: 'cli_x', appSecret: 'sec_x' }));
    repo.setState('feishu', 'name', '飞书');
  });

  it('默认不清除 credentials', async () => {
    const app = createChannelRoutes(manager, binding, repo);
    const res = await app.request('/disconnect', {
      method: 'POST',
      body: JSON.stringify({ type: 'feishu' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(repo.getState('feishu', 'credentials')).toBeTruthy();
    expect(repo.getState('feishu', 'name')).toBe('飞书');
  });

  it('purge=true 清除 credentials', async () => {
    const app = createChannelRoutes(manager, binding, repo);
    const res = await app.request('/disconnect', {
      method: 'POST',
      body: JSON.stringify({ type: 'feishu', purge: true }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(repo.getState('feishu', 'credentials')).toBeNull();
    expect(repo.getState('feishu', 'name')).toBeNull();
  });
});

describe('GET /channel/credentials/:type', () => {
  let repo: ReturnType<typeof createMemRepo>;
  let manager: ReturnType<typeof createFakeManager>;

  beforeEach(() => {
    repo = createMemRepo();
    manager = createFakeManager();
  });

  it('无任何存储 → credentials=null, hasSecret=false', async () => {
    const app = createChannelRoutes(manager, undefined, repo);
    const res = await app.request('/credentials/feishu');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.credentials).toBeNull();
    expect(body.hasSecret).toBe(false);
  });

  it('有 credentials 时脱敏返回 + hasSecret=true', async () => {
    repo.setState(
      'feishu',
      'credentials',
      JSON.stringify({
        appId: 'cli_x',
        appSecret: 'super_secret',
        encryptKey: 'enc_key',
        verificationToken: 'token',
        groupSessionScope: 'group',
        groupHistoryEnabled: 'true',
      }),
    );
    repo.setState('feishu', 'name', '飞书');

    const app = createChannelRoutes(manager, undefined, repo);
    const res = await app.request('/credentials/feishu');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasSecret).toBe(true);
    expect(body.name).toBe('飞书');
    expect(body.credentials.appId).toBe('cli_x');
    expect(body.credentials.groupSessionScope).toBe('group');
    expect(body.credentials.groupHistoryEnabled).toBe('true');
    // 敏感字段必须被去掉
    expect(body.credentials.appSecret).toBeUndefined();
    expect(body.credentials.encryptKey).toBeUndefined();
    expect(body.credentials.verificationToken).toBeUndefined();
  });

  it('credentials 非法 JSON 时返回 null', async () => {
    repo.setState('feishu', 'credentials', 'not valid json');
    const app = createChannelRoutes(manager, undefined, repo);
    const res = await app.request('/credentials/feishu');
    const body = await res.json();
    expect(body.credentials).toBeNull();
    expect(body.hasSecret).toBe(false);
  });

  it('appSecret 为空字符串时 hasSecret=false', async () => {
    repo.setState(
      'feishu',
      'credentials',
      JSON.stringify({ appId: 'cli_x', appSecret: '' }),
    );
    const app = createChannelRoutes(manager, undefined, repo);
    const res = await app.request('/credentials/feishu');
    const body = await res.json();
    expect(body.hasSecret).toBe(false);
  });

  it('channelStateRepo 未提供时返回空对象', async () => {
    const app = createChannelRoutes(manager, undefined, undefined);
    const res = await app.request('/credentials/feishu');
    const body = await res.json();
    expect(body.credentials).toBeNull();
    expect(body.hasSecret).toBe(false);
  });
});

describe('POST /channel/connect appSecret 留空沿用旧值', () => {
  let repo: ReturnType<typeof createMemRepo>;
  let manager: ReturnType<typeof createFakeManager>;

  beforeEach(() => {
    repo = createMemRepo();
    manager = createFakeManager();
  });

  it('appSecret 空 + DB 有旧值 → connect 收到的 credentials 被补上旧 secret', async () => {
    repo.setState(
      'feishu',
      'credentials',
      JSON.stringify({ appId: 'cli_old', appSecret: 'sec_old', encryptKey: 'enc_old' }),
    );

    const app = createChannelRoutes(manager, undefined, repo);
    const res = await app.request('/connect', {
      method: 'POST',
      body: JSON.stringify({
        type: 'feishu',
        name: '飞书',
        credentials: {
          appId: 'cli_new',
          appSecret: '', // 留空
          groupSessionScope: 'group_sender',
        },
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(manager.connect).toHaveBeenCalledOnce();
    const arg = (manager.connect as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.credentials.appId).toBe('cli_new'); // 保留用户新 appId
    expect(arg.credentials.appSecret).toBe('sec_old'); // 沿用旧 secret
    expect(arg.credentials.encryptKey).toBe('enc_old'); // encryptKey 留空也沿用
    expect(arg.credentials.groupSessionScope).toBe('group_sender'); // 新值
  });

  it('appSecret 有显式新值时不被覆盖', async () => {
    repo.setState(
      'feishu',
      'credentials',
      JSON.stringify({ appSecret: 'sec_old' }),
    );

    const app = createChannelRoutes(manager, undefined, repo);
    await app.request('/connect', {
      method: 'POST',
      body: JSON.stringify({
        type: 'feishu',
        name: '飞书',
        credentials: {
          appId: 'cli_x',
          appSecret: 'sec_NEW',
        },
      }),
      headers: { 'content-type': 'application/json' },
    });
    const arg = (manager.connect as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.credentials.appSecret).toBe('sec_NEW');
  });

  it('DB 无旧凭据时不补任何值', async () => {
    const app = createChannelRoutes(manager, undefined, repo);
    await app.request('/connect', {
      method: 'POST',
      body: JSON.stringify({
        type: 'feishu',
        name: '飞书',
        credentials: { appId: 'cli_x', appSecret: '' },
      }),
      headers: { 'content-type': 'application/json' },
    });
    const arg = (manager.connect as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.credentials.appSecret).toBe('');
  });

  it('旧凭据 JSON 非法时跳过沿用（不抛错）', async () => {
    repo.setState('feishu', 'credentials', 'not json');

    const app = createChannelRoutes(manager, undefined, repo);
    const res = await app.request('/connect', {
      method: 'POST',
      body: JSON.stringify({
        type: 'feishu',
        name: '飞书',
        credentials: { appId: 'cli_x', appSecret: '' },
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const arg = (manager.connect as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.credentials.appSecret).toBe('');
  });

  it('connect 成功后 credentials 会持久化（保持原有行为）', async () => {
    const app = createChannelRoutes(manager, undefined, repo);
    await app.request('/connect', {
      method: 'POST',
      body: JSON.stringify({
        type: 'feishu',
        name: '飞书',
        credentials: { appId: 'cli_x', appSecret: 'sec_x' },
      }),
      headers: { 'content-type': 'application/json' },
    });
    const stored = repo.getState('feishu', 'credentials');
    expect(stored).toContain('cli_x');
    expect(stored).toContain('sec_x');
  });
});
