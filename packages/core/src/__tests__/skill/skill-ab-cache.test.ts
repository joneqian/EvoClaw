/**
 * M7-Tier3 PR-T3-1a: skill-ab-cache 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import {
  writeVariantToCache,
  readVariantFromCache,
  hasVariantCache,
  clearVariantFromCache,
  gcOrphanCache,
} from '../../skill/skill-ab-cache.js';

describe('skill-ab-cache', () => {
  let userSkillsDir: string;

  beforeEach(() => {
    userSkillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-cache-'));
  });

  afterEach(() => {
    fs.rmSync(userSkillsDir, { recursive: true, force: true });
  });

  it('write + read 往返一致', () => {
    const ok = writeVariantToCache(userSkillsDir, 'arxiv', 'aaa111', '# old marker\nbody A');
    expect(ok).toBe(true);
    const content = readVariantFromCache(userSkillsDir, 'arxiv', 'aaa111');
    expect(content).toBe('# old marker\nbody A');
  });

  it('cache miss 返回 null（不抛）', () => {
    expect(readVariantFromCache(userSkillsDir, 'nope', 'xxx')).toBeNull();
  });

  it('hasVariantCache 反映文件存在性', () => {
    expect(hasVariantCache(userSkillsDir, 'arxiv', 'h1')).toBe(false);
    writeVariantToCache(userSkillsDir, 'arxiv', 'h1', 'x');
    expect(hasVariantCache(userSkillsDir, 'arxiv', 'h1')).toBe(true);
  });

  it('clearVariantFromCache 删除单文件', () => {
    writeVariantToCache(userSkillsDir, 'arxiv', 'h1', 'x');
    writeVariantToCache(userSkillsDir, 'arxiv', 'h2', 'y');
    clearVariantFromCache(userSkillsDir, 'arxiv', 'h1');
    expect(hasVariantCache(userSkillsDir, 'arxiv', 'h1')).toBe(false);
    expect(hasVariantCache(userSkillsDir, 'arxiv', 'h2')).toBe(true);
  });

  it('clear 不存在的 cache 文件 → 静默成功', () => {
    expect(() => clearVariantFromCache(userSkillsDir, 'nope', 'x')).not.toThrow();
  });

  it('hash 不安全字符被剥离', () => {
    // 路径注入尝试：hash 含 / 应被剥离
    writeVariantToCache(userSkillsDir, 'arxiv', '../etc/passwd', 'pwn');
    // 验证文件被写到了 cache 目录内（而不是 ../etc/）
    const cacheDir = path.join(userSkillsDir, '.ab-cache');
    const files = fs.readdirSync(cacheDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^arxiv-[a-z0-9]+\.md$/i);
  });

  describe('gcOrphanCache', () => {
    it('删除 liveKeys 集合外的文件', () => {
      writeVariantToCache(userSkillsDir, 'a', 'h1', 'x');
      writeVariantToCache(userSkillsDir, 'a', 'h2', 'y');
      writeVariantToCache(userSkillsDir, 'b', 'h3', 'z');

      const live = new Set(['a:h1']);  // 仅 a:h1 是 live
      const result = gcOrphanCache(userSkillsDir, live);
      expect(result.scanned).toBe(3);
      expect(result.removed).toBe(2);

      expect(hasVariantCache(userSkillsDir, 'a', 'h1')).toBe(true);
      expect(hasVariantCache(userSkillsDir, 'a', 'h2')).toBe(false);
      expect(hasVariantCache(userSkillsDir, 'b', 'h3')).toBe(false);
    });

    it('cache 目录不存在 → 返回 0', () => {
      const result = gcOrphanCache(userSkillsDir, new Set());
      expect(result.scanned).toBe(0);
      expect(result.removed).toBe(0);
    });

    it('liveKeys 全空 → 全部删除', () => {
      writeVariantToCache(userSkillsDir, 'a', 'h1', 'x');
      writeVariantToCache(userSkillsDir, 'b', 'h2', 'y');
      const result = gcOrphanCache(userSkillsDir, new Set());
      expect(result.removed).toBe(2);
    });

    it('liveKeys 全 live → 不删', () => {
      writeVariantToCache(userSkillsDir, 'a', 'h1', 'x');
      writeVariantToCache(userSkillsDir, 'b', 'h2', 'y');
      const result = gcOrphanCache(userSkillsDir, new Set(['a:h1', 'b:h2']));
      expect(result.removed).toBe(0);
    });
  });
});
