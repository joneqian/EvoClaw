import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { SopTagStore } from '../../sop/sop-tag-store.js';
import type { SopParentTagT } from '../../sop/sop-schema.js';

const sampleTags: SopParentTagT[] = [
  {
    name: '咨询阶段',
    children: [
      {
        name: '首次咨询',
        meaning: '客户首次接触',
        mustDo: '友好问候并收集需求',
        mustNotDo: '直接推销',
      },
    ],
  },
];

describe('SopTagStore', () => {
  let tmpBase: string;
  let store: SopTagStore;

  beforeEach(() => {
    tmpBase = path.join(os.tmpdir(), `sop-tag-store-test-${crypto.randomUUID()}`);
    store = new SopTagStore(tmpBase);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  });

  describe('loadTags', () => {
    it('文件不存在时返回空 tags', () => {
      const result = store.loadTags();
      expect(result.tags).toEqual([]);
      expect(result.version).toBe(1);
    });

    it('保存后重新加载得到相同内容', () => {
      store.saveTags(sampleTags);
      const reloaded = store.loadTags();
      expect(reloaded.tags).toEqual(sampleTags);
    });
  });

  describe('saveTags', () => {
    it('保存非法 schema 抛错', () => {
      expect(() => store.saveTags([
        { name: '父', children: [] }, // 空 children
      ] as SopParentTagT[])).toThrow();
    });

    it('保存空数组允许（清空标签）', () => {
      expect(() => store.saveTags([])).not.toThrow();
      expect(store.loadTags().tags).toEqual([]);
    });

    it('原子写不损坏旧文件（中途模拟无法测试，但确认 .tmp 已清理）', () => {
      store.saveTags(sampleTags);
      const tagFile = path.join(tmpBase, 'sop', 'tags.json');
      const tmpFile = `${tagFile}.tmp`;
      expect(fs.existsSync(tagFile)).toBe(true);
      expect(fs.existsSync(tmpFile)).toBe(false);
    });

    it('updatedAt 时间戳更新', async () => {
      store.saveTags(sampleTags);
      const t1 = store.loadTags().updatedAt;
      await new Promise((r) => setTimeout(r, 5));
      store.saveTags(sampleTags);
      const t2 = store.loadTags().updatedAt;
      expect(t2 > t1).toBe(true);
    });
  });

  describe('draft', () => {
    it('草稿不存在时 loadDraft 返回 null', () => {
      expect(store.loadDraft()).toBeNull();
    });

    it('saveDraft + loadDraft', () => {
      store.saveDraft(sampleTags);
      const draft = store.loadDraft();
      expect(draft?.tags).toEqual(sampleTags);
    });

    it('clearDraft 删除草稿', () => {
      store.saveDraft(sampleTags);
      store.clearDraft();
      expect(store.loadDraft()).toBeNull();
    });

    it('clearDraft 不存在时不抛错', () => {
      expect(() => store.clearDraft()).not.toThrow();
    });

    it('draft 与 tags 独立', () => {
      store.saveTags(sampleTags);
      store.saveDraft([
        {
          name: '草稿父',
          children: [
            { name: '草稿子', meaning: 'a', mustDo: 'b', mustNotDo: 'c' },
          ],
        },
      ]);

      const tags = store.loadTags();
      const draft = store.loadDraft();
      expect(tags.tags[0]?.name).toBe('咨询阶段');
      expect(draft?.tags[0]?.name).toBe('草稿父');
    });

    it('saveDraft 校验失败抛错', () => {
      expect(() =>
        store.saveDraft([{ name: '空父', children: [] }] as SopParentTagT[]),
      ).toThrow();
    });
  });

  describe('promoteDraft', () => {
    it('将 draft 提升为 tags 并清空 draft', () => {
      store.saveDraft(sampleTags);
      const promoted = store.promoteDraft();
      expect(promoted).toBe(true);
      expect(store.loadTags().tags).toEqual(sampleTags);
      expect(store.loadDraft()).toBeNull();
    });

    it('无 draft 时返回 false', () => {
      expect(store.promoteDraft()).toBe(false);
    });
  });
});
