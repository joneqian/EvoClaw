import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { SopDocStore } from '../../sop/sop-doc-store.js';

describe('SopDocStore', () => {
  let tmpBase: string;
  let store: SopDocStore;

  beforeEach(() => {
    tmpBase = path.join(os.tmpdir(), `sop-doc-store-test-${crypto.randomUUID()}`);
    store = new SopDocStore(tmpBase);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  });

  describe('saveUploadedDoc', () => {
    it('保存 markdown 文件并返回元数据', async () => {
      const meta = await store.saveUploadedDoc(
        Buffer.from('# 测试 SOP\n\n内容'),
        'test.md',
      );
      expect(meta.id).toBeDefined();
      expect(meta.originalName).toBe('test.md');
      expect(meta.ext).toBe('md');
      expect(meta.uploadedAt).toBeDefined();
    });

    it('保存后原文与解析文本都落地', async () => {
      const meta = await store.saveUploadedDoc(
        Buffer.from('# Hello'),
        'h.md',
      );
      // 原始文件
      expect(fs.existsSync(path.join(tmpBase, 'sop', 'docs', `${meta.id}.md`))).toBe(true);
      // 解析后纯文本
      expect(fs.existsSync(path.join(tmpBase, 'sop', 'docs', `${meta.id}.txt`))).toBe(true);
    });

    it('索引 json 持久化', async () => {
      await store.saveUploadedDoc(Buffer.from('a'), 'a.md');
      const indexPath = path.join(tmpBase, 'sop', 'docs', 'index.json');
      expect(fs.existsSync(indexPath)).toBe(true);
      const idx = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as { docs: unknown[] };
      expect(idx.docs).toHaveLength(1);
    });

    it('拒绝不支持的扩展名', async () => {
      await expect(
        store.saveUploadedDoc(Buffer.from('x'), 'a.pdf'),
      ).rejects.toThrow(/不支持/);
    });

    it('限制文件大小（10MB 上限）', async () => {
      const big = Buffer.alloc(11 * 1024 * 1024); // 11MB
      await expect(
        store.saveUploadedDoc(big, 'big.md'),
      ).rejects.toThrow(/过大/);
    });
  });

  describe('listDocs', () => {
    it('空目录返回空数组', () => {
      expect(store.listDocs()).toEqual([]);
    });

    it('列出已保存文档（按上传时间倒序）', async () => {
      await store.saveUploadedDoc(Buffer.from('a'), 'a.md');
      // 等 1ms 确保时间戳不同
      await new Promise((r) => setTimeout(r, 5));
      await store.saveUploadedDoc(Buffer.from('b'), 'b.md');

      const docs = store.listDocs();
      expect(docs).toHaveLength(2);
      // 倒序：最新的在前
      expect(docs[0]?.originalName).toBe('b.md');
      expect(docs[1]?.originalName).toBe('a.md');
    });
  });

  describe('getParsedText', () => {
    it('返回解析后的纯文本', async () => {
      const meta = await store.saveUploadedDoc(
        Buffer.from('# 标题\n\n正文'),
        't.md',
      );
      const text = store.getParsedText(meta.id);
      expect(text).toContain('标题');
      expect(text).toContain('正文');
    });

    it('不存在的 id 返回 null', () => {
      expect(store.getParsedText('nope')).toBeNull();
    });
  });

  describe('deleteDoc', () => {
    it('删除原文 + 解析文本 + 索引项', async () => {
      const meta = await store.saveUploadedDoc(Buffer.from('a'), 'a.md');
      const ok = store.deleteDoc(meta.id);
      expect(ok).toBe(true);
      expect(store.listDocs()).toEqual([]);
      expect(store.getParsedText(meta.id)).toBeNull();
    });

    it('删除不存在的 id 返回 false', () => {
      expect(store.deleteDoc('nope')).toBe(false);
    });
  });
});
