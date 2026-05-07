/**
 * Checkpoint Store 单元测试
 *
 * 覆盖：内容寻址 / dedup / GC / 大小统计
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CheckpointStore, hashContent } from '../../agent/checkpoint/checkpoint-store.js';

describe('CheckpointStore', () => {
  let tempRoot: string;
  let store: CheckpointStore;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evoclaw-cp-'));
    store = new CheckpointStore(tempRoot);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('hashContent', () => {
    it('相同内容产生相同 sha256', () => {
      const a = hashContent('hello world');
      const b = hashContent('hello world');
      expect(a).toBe(b);
      expect(a).toMatch(/^[a-f0-9]{64}$/);
    });

    it('不同内容产生不同 sha256', () => {
      expect(hashContent('a')).not.toBe(hashContent('b'));
    });

    it('Buffer 与等价 string 产生相同 hash', () => {
      expect(hashContent('foo')).toBe(hashContent(Buffer.from('foo', 'utf-8')));
    });
  });

  describe('writeObject / readObject', () => {
    it('写入后能按 sha 读回原文', () => {
      const content = Buffer.from('hello checkpoint');
      const sha = store.writeObject(content);
      const restored = store.readObject(sha);
      expect(restored.toString('utf-8')).toBe('hello checkpoint');
    });

    it('相同内容写两次 → object 只存一份（dedup）', () => {
      const c = Buffer.from('dup-content');
      const sha1 = store.writeObject(c);
      const sha2 = store.writeObject(c);
      expect(sha1).toBe(sha2);
      expect(store.listObjects()).toHaveLength(1);
    });

    it('不同内容产生不同 object', () => {
      const sha1 = store.writeObject(Buffer.from('a'));
      const sha2 = store.writeObject(Buffer.from('b'));
      expect(sha1).not.toBe(sha2);
      expect(store.listObjects()).toHaveLength(2);
    });

    it('hasObject 正确反映存在状态', () => {
      const sha = store.writeObject(Buffer.from('x'));
      expect(store.hasObject(sha)).toBe(true);
      expect(store.hasObject('a'.repeat(64))).toBe(false);
    });

    it('压缩后磁盘占用比原文小（gzip 工作正常）', () => {
      // 1KB 高度可压缩内容
      const content = Buffer.from('x'.repeat(10000));
      store.writeObject(content);
      const totalBytes = store.totalBytes();
      // gzip 应能压到原文 5% 以内
      expect(totalBytes).toBeLessThan(content.length / 5);
    });
  });

  describe('GC', () => {
    it('删除引用集之外的孤儿 object', () => {
      const shaA = store.writeObject(Buffer.from('a'));
      const shaB = store.writeObject(Buffer.from('b'));
      const shaC = store.writeObject(Buffer.from('c'));

      const referenced = new Set([shaA, shaC]); // B 是孤儿
      const deleted = store.gcOrphans(referenced);

      expect(deleted).toBe(1);
      expect(store.hasObject(shaA)).toBe(true);
      expect(store.hasObject(shaB)).toBe(false);
      expect(store.hasObject(shaC)).toBe(true);
    });

    it('引用集为空时全删', () => {
      store.writeObject(Buffer.from('a'));
      store.writeObject(Buffer.from('b'));
      const deleted = store.gcOrphans(new Set());
      expect(deleted).toBe(2);
      expect(store.listObjects()).toHaveLength(0);
    });

    it('全部 referenced 时一个都不删', () => {
      const sha1 = store.writeObject(Buffer.from('a'));
      const sha2 = store.writeObject(Buffer.from('b'));
      const deleted = store.gcOrphans(new Set([sha1, sha2]));
      expect(deleted).toBe(0);
      expect(store.listObjects()).toHaveLength(2);
    });
  });

  describe('listObjects / totalBytes', () => {
    it('空 store 返回 [] 和 0', () => {
      expect(store.listObjects()).toEqual([]);
      expect(store.totalBytes()).toBe(0);
    });

    it('写入后正确累计', () => {
      store.writeObject(Buffer.from('a'.repeat(100)));
      store.writeObject(Buffer.from('b'.repeat(100)));
      expect(store.listObjects()).toHaveLength(2);
      expect(store.totalBytes()).toBeGreaterThan(0);
    });
  });

  describe('rootDir 暴露', () => {
    it('返回构造时传入的 root', () => {
      expect(store.rootDir).toBe(tempRoot);
    });
  });
});
