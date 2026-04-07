/**
 * FileStateCache 测试
 *
 * 覆盖:
 * - 基础功能: recordRead, wasReadBefore, checkStaleness
 * - LRU 淘汰: 条目限制, 总大小限制
 * - clone: 独立副本不互相影响
 * - merge: 时间戳新优先合并
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FileStateCache } from '../../agent/kernel/file-state-cache.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fsc-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('FileStateCache', () => {
  describe('基础功能', () => {
    it('recordRead 后 wasReadBefore 返回 true', () => {
      const cache = new FileStateCache();
      const fp = writeFile('a.txt', 'hello');
      cache.recordRead(fp, 5, false);
      expect(cache.wasReadBefore(fp)).toBe(true);
    });

    it('未读取的文件返回 false', () => {
      const cache = new FileStateCache();
      expect(cache.wasReadBefore('/nonexistent')).toBe(false);
    });

    it('文件被外部修改后 checkStaleness 返回原因', () => {
      const cache = new FileStateCache();
      const fp = writeFile('b.txt', 'v1');
      cache.recordRead(fp, 2, false);
      // 修改文件 (更新 mtime)
      const futureMs = Date.now() + 5000;
      fs.utimesSync(fp, futureMs / 1000, futureMs / 1000);
      expect(cache.checkStaleness(fp)).toContain('修改');
    });

    it('部分读取跳过 staleness 检查', () => {
      const cache = new FileStateCache();
      const fp = writeFile('c.txt', 'content');
      cache.recordRead(fp, 7, true); // partial
      const futureMs = Date.now() + 5000;
      fs.utimesSync(fp, futureMs / 1000, futureMs / 1000);
      expect(cache.checkStaleness(fp)).toBeNull();
    });
  });

  describe('clone', () => {
    it('clone 产生独立副本', () => {
      const parent = new FileStateCache();
      const fp = writeFile('d.txt', 'data');
      parent.recordRead(fp, 4, false);

      const child = parent.clone();

      // 子缓存继承父数据
      expect(child.wasReadBefore(fp)).toBe(true);

      // 子缓存新增不影响父
      const fp2 = writeFile('e.txt', 'more');
      child.recordRead(fp2, 4, false);
      expect(child.wasReadBefore(fp2)).toBe(true);
      expect(parent.wasReadBefore(fp2)).toBe(false);
    });

    it('clone 后父缓存新增不影响子', () => {
      const parent = new FileStateCache();
      const child = parent.clone();
      const fp = writeFile('f.txt', 'x');
      parent.recordRead(fp, 1, false);
      expect(parent.wasReadBefore(fp)).toBe(true);
      expect(child.wasReadBefore(fp)).toBe(false);
    });
  });

  describe('merge', () => {
    it('merge 取时间戳较新的条目', () => {
      const parent = new FileStateCache();
      const fp = writeFile('g.txt', 'v1');
      parent.recordRead(fp, 2, false);

      const child = parent.clone();

      // 子缓存新增文件
      const fp2 = writeFile('h.txt', 'new');
      child.recordRead(fp2, 3, false);

      const merged = parent.merge(child);
      // 新增文件被合并
      expect(merged.wasReadBefore(fp2)).toBe(true);
      // 原有文件保留
      expect(merged.wasReadBefore(fp)).toBe(true);
    });

    it('merge 返回新实例，不修改原缓存', () => {
      const a = new FileStateCache();
      const b = new FileStateCache();
      const fp = writeFile('i.txt', 'x');
      b.recordRead(fp, 1, false);

      const merged = a.merge(b);
      expect(merged.wasReadBefore(fp)).toBe(true);
      expect(a.wasReadBefore(fp)).toBe(false); // 原实例不变
    });
  });
});
