/**
 * M13 Phase 1 PR-1B — IdentityLinksStore 单测
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { IdentityLinksStore } from '../../routing/identity-links-store.js';

const MIGRATION_001 = fs.readFileSync(
  path.join(import.meta.dirname, '..', '..', 'infrastructure', 'db', 'migrations', '001_initial.sql'),
  'utf-8',
);
const MIGRATION_045 = fs.readFileSync(
  path.join(import.meta.dirname, '..', '..', 'infrastructure', 'db', 'migrations', '045_identity_links.sql'),
  'utf-8',
);

describe('IdentityLinksStore', () => {
  let store: SqliteStore;
  let identity: IdentityLinksStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-id-links-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    store = new SqliteStore(path.join(tmpDir, 'test.db'));
    store.exec(MIGRATION_001);
    store.exec(MIGRATION_045);
    identity = new IdentityLinksStore(store);
  });

  afterEach(() => {
    try { store.close(); } catch { /* ignore */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('link / unlink / lookupCanonical', () => {
    it('添加身份链 + lookup 命中', () => {
      identity.link('self', 'feishu', 'ou_xxx');
      expect(identity.lookupCanonical('feishu', 'ou_xxx')).toBe('self');
    });

    it('lookup 不命中返回 null', () => {
      expect(identity.lookupCanonical('feishu', 'ou_unknown')).toBeNull();
      expect(identity.lookupCanonical('', '')).toBeNull();
    });

    it('同 (channel, peerId) 重复 link → UPSERT 更新 canonical_id', () => {
      identity.link('alice', 'feishu', 'ou_xxx');
      expect(identity.lookupCanonical('feishu', 'ou_xxx')).toBe('alice');
      identity.link('bob', 'feishu', 'ou_xxx');  // 改 canonical
      expect(identity.lookupCanonical('feishu', 'ou_xxx')).toBe('bob');
    });

    it('unlink 删除指定渠道身份', () => {
      identity.link('self', 'feishu', 'ou_xxx');
      identity.link('self', 'wecom', 'userid_yyy');
      const removed = identity.unlink('feishu', 'ou_xxx');
      expect(removed).toBe(1);
      expect(identity.lookupCanonical('feishu', 'ou_xxx')).toBeNull();
      // 另一个仍在
      expect(identity.lookupCanonical('wecom', 'userid_yyy')).toBe('self');
    });

    it('unlinkCanonical 删除整个 canonical 下所有链接', () => {
      identity.link('self', 'feishu', 'ou_xxx');
      identity.link('self', 'wecom', 'userid_yyy');
      identity.link('other', 'feishu', 'ou_zzz');
      const removed = identity.unlinkCanonical('self');
      expect(removed).toBe(2);
      expect(identity.lookupCanonical('feishu', 'ou_xxx')).toBeNull();
      expect(identity.lookupCanonical('wecom', 'userid_yyy')).toBeNull();
      expect(identity.lookupCanonical('feishu', 'ou_zzz')).toBe('other');
    });

    it('link 缺参数抛错', () => {
      expect(() => identity.link('', 'feishu', 'ou_x')).toThrow();
      expect(() => identity.link('self', '', 'ou_x')).toThrow();
      expect(() => identity.link('self', 'feishu', '')).toThrow();
    });
  });

  describe('listAll / listByCanonical', () => {
    it('listAll 返回全部', () => {
      identity.link('self', 'feishu', 'ou_xxx');
      identity.link('self', 'wecom', 'userid_yyy');
      identity.link('other', 'feishu', 'ou_zzz');
      const all = identity.listAll();
      expect(all).toHaveLength(3);
    });

    it('listByCanonical 仅返回该 canonical 下的链接', () => {
      identity.link('self', 'feishu', 'ou_xxx');
      identity.link('self', 'wecom', 'userid_yyy');
      identity.link('other', 'feishu', 'ou_zzz');
      const selfLinks = identity.listByCanonical('self');
      expect(selfLinks).toHaveLength(2);
      const channels = selfLinks.map(l => l.channel).sort();
      expect(channels).toEqual(['feishu', 'wecom']);
    });
  });

  describe('缓存机制', () => {
    it('缓存命中（CRUD 后失效）', () => {
      identity.link('self', 'feishu', 'ou_xxx');
      // 先调一次填缓存
      expect(identity.lookupCanonical('feishu', 'ou_xxx')).toBe('self');
      // 直接 SQL update 绕过 store（模拟外部修改）
      store.run(`UPDATE identity_links SET canonical_id = 'mutated' WHERE peer_id = 'ou_xxx'`);
      // 缓存仍命中旧值
      expect(identity.lookupCanonical('feishu', 'ou_xxx')).toBe('self');
      // 显式失效后命中新值
      identity.invalidateCache();
      expect(identity.lookupCanonical('feishu', 'ou_xxx')).toBe('mutated');
    });

    it('link 后自动失效缓存', () => {
      identity.link('alice', 'feishu', 'ou_xxx');
      expect(identity.lookupCanonical('feishu', 'ou_xxx')).toBe('alice');
      identity.link('bob', 'feishu', 'ou_xxx');
      // link 内部调用 invalidateCache，下次 lookup 重建
      expect(identity.lookupCanonical('feishu', 'ou_xxx')).toBe('bob');
    });
  });
});
