/**
 * ChannelStateRepo 多账号支持测试
 *
 * 验证：
 * - 新签名 getState/setState/deleteState 按 (channel, accountId, key) 三元索引
 * - listAccounts 去重返回某 channel 下所有已知 accountId
 * - reassignAccountId 把老数据从 `''` 迁到真实 appId（幂等 + 不覆盖已存在的 target 行）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ChannelStateRepo } from '../../channel/channel-state-repo.js';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../../infrastructure/db/migration-runner.js';

describe('ChannelStateRepo 多账号', () => {
  let store: SqliteStore;
  let repo: ChannelStateRepo;

  beforeEach(async () => {
    store = new SqliteStore(':memory:');
    const runner = new MigrationRunner(store);
    await runner.run();
    repo = new ChannelStateRepo(store);
  });

  it('set/get/delete 按 (channel, accountId, key) 三元索引', () => {
    repo.setState('feishu', 'cli_x', 'credentials', 'secret_x');
    repo.setState('feishu', 'cli_y', 'credentials', 'secret_y');

    expect(repo.getState('feishu', 'cli_x', 'credentials')).toBe('secret_x');
    expect(repo.getState('feishu', 'cli_y', 'credentials')).toBe('secret_y');
    expect(repo.getState('feishu', 'cli_z', 'credentials')).toBeNull();

    repo.deleteState('feishu', 'cli_x', 'credentials');
    expect(repo.getState('feishu', 'cli_x', 'credentials')).toBeNull();
    expect(repo.getState('feishu', 'cli_y', 'credentials')).toBe('secret_y');
  });

  it('同 (channel, accountId) 不同 key 互不干扰', () => {
    repo.setState('feishu', 'cli_x', 'credentials', 'secret');
    repo.setState('feishu', 'cli_x', 'name', '龙虾');

    expect(repo.getState('feishu', 'cli_x', 'credentials')).toBe('secret');
    expect(repo.getState('feishu', 'cli_x', 'name')).toBe('龙虾');
  });

  it('listAccounts 返回某 channel 下的所有 accountId（去重）', () => {
    repo.setState('feishu', 'cli_x', 'credentials', '1');
    repo.setState('feishu', 'cli_x', 'name', '1');
    repo.setState('feishu', 'cli_y', 'credentials', '2');
    repo.setState('weixin', '', 'credentials', '3');

    const feishu = repo.listAccounts('feishu').sort();
    expect(feishu).toEqual(['cli_x', 'cli_y']);

    const weixin = repo.listAccounts('weixin');
    expect(weixin).toEqual(['']);
  });

  it('reassignAccountId: 空串 → 真实 appId 的老数据迁移', () => {
    // 模拟 migration 030 后留下的老行
    repo.setState('feishu', '', 'credentials', 'old_creds');
    repo.setState('feishu', '', 'name', '老飞书');

    repo.reassignAccountId('feishu', '', 'cli_real');

    expect(repo.getState('feishu', 'cli_real', 'credentials')).toBe('old_creds');
    expect(repo.getState('feishu', 'cli_real', 'name')).toBe('老飞书');
    // 老行被清掉
    expect(repo.getState('feishu', '', 'credentials')).toBeNull();
    expect(repo.listAccounts('feishu')).toEqual(['cli_real']);
  });

  it('reassignAccountId 幂等：target 已有同 key 时保留 target 值', () => {
    repo.setState('feishu', '', 'credentials', 'old');
    repo.setState('feishu', 'cli_new', 'credentials', 'new');

    repo.reassignAccountId('feishu', '', 'cli_new');

    // target 保留自己的值（INSERT OR IGNORE），老的 '' 被清
    expect(repo.getState('feishu', 'cli_new', 'credentials')).toBe('new');
    expect(repo.getState('feishu', '', 'credentials')).toBeNull();
  });

  it('reassignAccountId: from === to 时 no-op', () => {
    repo.setState('feishu', 'cli_x', 'credentials', 'v');
    repo.reassignAccountId('feishu', 'cli_x', 'cli_x');
    expect(repo.getState('feishu', 'cli_x', 'credentials')).toBe('v');
  });
});
