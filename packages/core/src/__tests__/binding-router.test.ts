import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { BindingRouter } from '../routing/binding-router.js';

/** 读取初始迁移 SQL */
const MIGRATION_001 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '001_initial.sql'),
  'utf-8',
);

/** 读取 bindings 迁移 SQL */
const MIGRATION_007 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '007_bindings.sql'),
  'utf-8',
);

/** 测试用 Agent ID */
const AGENT_A = 'agent-aaa';
const AGENT_B = 'agent-bbb';
const AGENT_C = 'agent-ccc';
const AGENT_D = 'agent-ddd';

describe('BindingRouter', () => {
  let store: SqliteStore;
  let router: BindingRouter;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-binding-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const dbPath = path.join(tmpDir, 'test.db');

    store = new SqliteStore(dbPath);
    store.exec(MIGRATION_001);
    store.exec(MIGRATION_007);

    // 插入测试 Agent
    for (const id of [AGENT_A, AGENT_B, AGENT_C, AGENT_D]) {
      store.run(
        `INSERT INTO agents (id, name, status) VALUES (?, ?, 'active')`,
        id, `测试Agent-${id}`,
      );
    }

    router = new BindingRouter(store);
  });

  afterEach(() => {
    try { store.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('addBinding / removeBinding', () => {
    it('应该成功添加 Binding 并返回 ID', () => {
      const id = router.addBinding({
        agentId: AGENT_A,
        channel: 'wechat',
        accountId: null,
        peerId: null,
        priority: 0,
        isDefault: false,
      });
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    it('应该成功移除 Binding', () => {
      const id = router.addBinding({
        agentId: AGENT_A,
        channel: 'wechat',
        accountId: null,
        peerId: null,
        priority: 0,
        isDefault: false,
      });

      router.removeBinding(id);
      const bindings = router.listBindings(AGENT_A);
      expect(bindings).toHaveLength(0);
    });
  });

  describe('listBindings', () => {
    it('应该列出所有 Bindings', () => {
      router.addBinding({ agentId: AGENT_A, channel: 'wechat', accountId: null, peerId: null, priority: 0, isDefault: false });
      router.addBinding({ agentId: AGENT_B, channel: 'telegram', accountId: null, peerId: null, priority: 0, isDefault: false });

      const all = router.listBindings();
      expect(all).toHaveLength(2);
    });

    it('应该按 agentId 过滤', () => {
      router.addBinding({ agentId: AGENT_A, channel: 'wechat', accountId: null, peerId: null, priority: 0, isDefault: false });
      router.addBinding({ agentId: AGENT_B, channel: 'telegram', accountId: null, peerId: null, priority: 0, isDefault: false });

      const filtered = router.listBindings(AGENT_A);
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.agentId).toBe(AGENT_A);
    });

    it('应该按 priority 降序排列', () => {
      router.addBinding({ agentId: AGENT_A, channel: 'wechat', accountId: null, peerId: null, priority: 1, isDefault: false });
      router.addBinding({ agentId: AGENT_A, channel: 'wechat', accountId: 'grp-1', peerId: null, priority: 10, isDefault: false });

      const bindings = router.listBindings(AGENT_A);
      expect(bindings[0]!.priority).toBe(10);
      expect(bindings[1]!.priority).toBe(1);
    });

    it('应该正确转换 isDefault 字段', () => {
      router.addBinding({ agentId: AGENT_A, channel: 'default', accountId: null, peerId: null, priority: 0, isDefault: true });

      const bindings = router.listBindings(AGENT_A);
      expect(bindings[0]!.isDefault).toBe(true);
    });
  });

  describe('resolveAgent — 四级优先匹配', () => {
    beforeEach(() => {
      // 设置四个不同优先级的 Binding
      // 1. 默认 Agent
      router.addBinding({ agentId: AGENT_D, channel: 'default', accountId: null, peerId: null, priority: 0, isDefault: true });
      // 2. channel 级匹配
      router.addBinding({ agentId: AGENT_C, channel: 'wechat', accountId: null, peerId: null, priority: 5, isDefault: false });
      // 3. accountId + channel 匹配
      router.addBinding({ agentId: AGENT_B, channel: 'wechat', accountId: 'group-001', peerId: null, priority: 10, isDefault: false });
      // 4. peerId 精确匹配
      router.addBinding({ agentId: AGENT_A, channel: 'wechat', accountId: null, peerId: 'user-42', priority: 20, isDefault: false });
    });

    it('优先级1: peerId 精确匹配应返回 AGENT_A', () => {
      const result = router.resolveAgent({
        channel: 'wechat',
        accountId: 'group-001',
        peerId: 'user-42',
      });
      expect(result).toBe(AGENT_A);
    });

    it('优先级2: accountId + channel 匹配应返回 AGENT_B', () => {
      const result = router.resolveAgent({
        channel: 'wechat',
        accountId: 'group-001',
        peerId: 'unknown-user',
      });
      expect(result).toBe(AGENT_B);
    });

    it('优先级3: channel 匹配应返回 AGENT_C', () => {
      const result = router.resolveAgent({
        channel: 'wechat',
        accountId: 'unknown-group',
      });
      expect(result).toBe(AGENT_C);
    });

    it('优先级4: 无匹配时应返回默认 AGENT_D', () => {
      const result = router.resolveAgent({
        channel: 'telegram',
      });
      expect(result).toBe(AGENT_D);
    });

    it('完全无 Binding 时应返回 null', () => {
      // 清空所有 bindings
      store.run('DELETE FROM bindings');
      const result = router.resolveAgent({ channel: 'wechat' });
      expect(result).toBeNull();
    });

    it('仅有 channel 参数时应跳过 peerId 和 accountId 匹配', () => {
      const result = router.resolveAgent({ channel: 'wechat' });
      expect(result).toBe(AGENT_C);
    });
  });

  describe('外键约束', () => {
    it('删除 Agent 时应级联删除关联的 Bindings', () => {
      router.addBinding({ agentId: AGENT_A, channel: 'wechat', accountId: null, peerId: null, priority: 0, isDefault: false });
      expect(router.listBindings(AGENT_A)).toHaveLength(1);

      // 删除 Agent
      store.run('DELETE FROM agents WHERE id = ?', AGENT_A);

      // Binding 应被级联删除
      expect(router.listBindings(AGENT_A)).toHaveLength(0);
    });
  });
});
