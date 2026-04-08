import { describe, it, expect } from 'vitest';
import {
  SopChildTag,
  SopParentTag,
  SopTagsFile,
  validateTagsPayload,
} from '../../sop/sop-schema.js';

describe('SOP schema', () => {
  describe('SopChildTag', () => {
    it('接受完整字段的子标签', () => {
      const result = SopChildTag.safeParse({
        name: '首次咨询',
        meaning: '客户第一次联系，尚未建立信任',
        mustDo: '主动问候，快速回应，收集基础信息',
        mustNotDo: '直接推销产品，使用专业术语',
      });
      expect(result.success).toBe(true);
    });

    it('拒绝缺 name 的子标签', () => {
      const result = SopChildTag.safeParse({
        meaning: 'x',
        mustDo: 'x',
        mustNotDo: 'x',
      });
      expect(result.success).toBe(false);
    });

    it('拒绝 meaning 为空串', () => {
      const result = SopChildTag.safeParse({
        name: 'a',
        meaning: '',
        mustDo: 'x',
        mustNotDo: 'x',
      });
      expect(result.success).toBe(false);
    });

    it('拒绝缺 mustDo', () => {
      const result = SopChildTag.safeParse({
        name: 'a',
        meaning: 'x',
        mustNotDo: 'x',
      });
      expect(result.success).toBe(false);
    });

    it('拒绝缺 mustNotDo', () => {
      const result = SopChildTag.safeParse({
        name: 'a',
        meaning: 'x',
        mustDo: 'x',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('SopParentTag', () => {
    it('接受有子标签的父标签', () => {
      const result = SopParentTag.safeParse({
        name: '咨询阶段',
        children: [
          { name: '首次咨询', meaning: 'a', mustDo: 'b', mustNotDo: 'c' },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('拒绝无子标签的父标签', () => {
      const result = SopParentTag.safeParse({
        name: '咨询阶段',
        children: [],
      });
      expect(result.success).toBe(false);
    });

    it('拒绝 name 为空串', () => {
      const result = SopParentTag.safeParse({
        name: '',
        children: [{ name: 'a', meaning: 'a', mustDo: 'b', mustNotDo: 'c' }],
      });
      expect(result.success).toBe(false);
    });

    it('拒绝父标签自身带 meaning/mustDo/mustNotDo（二级限制）', () => {
      const result = SopParentTag.safeParse({
        name: '咨询阶段',
        meaning: 'not allowed',
        mustDo: 'not allowed',
        mustNotDo: 'not allowed',
        children: [{ name: 'a', meaning: 'a', mustDo: 'b', mustNotDo: 'c' }],
      });
      // strict: 父级不应有子级字段 — passthrough OK 但我们用 strict 拒绝
      expect(result.success).toBe(false);
    });
  });

  describe('SopTagsFile', () => {
    it('接受完整文件结构', () => {
      const result = SopTagsFile.safeParse({
        version: 1,
        updatedAt: new Date().toISOString(),
        tags: [
          {
            name: '咨询阶段',
            children: [
              { name: '首次咨询', meaning: 'a', mustDo: 'b', mustNotDo: 'c' },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('接受空 tags 数组（初始状态）', () => {
      const result = SopTagsFile.safeParse({
        version: 1,
        updatedAt: new Date().toISOString(),
        tags: [],
      });
      expect(result.success).toBe(true);
    });

    it('拒绝 version 非 1', () => {
      const result = SopTagsFile.safeParse({
        version: 2,
        updatedAt: new Date().toISOString(),
        tags: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('validateTagsPayload', () => {
    it('接受纯 tags 数组载荷', () => {
      const result = validateTagsPayload([
        {
          name: '咨询阶段',
          children: [
            { name: '首次咨询', meaning: 'a', mustDo: 'b', mustNotDo: 'c' },
          ],
        },
      ]);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
      }
    });

    it('拒绝非数组载荷', () => {
      const result = validateTagsPayload('not an array');
      expect(result.success).toBe(false);
    });

    it('拒绝三级嵌套（子标签不允许 children 字段）', () => {
      const result = validateTagsPayload([
        {
          name: 'p',
          children: [
            {
              name: 'c',
              meaning: 'a',
              mustDo: 'b',
              mustNotDo: 'c',
              children: [{ name: 'gc', meaning: 'x', mustDo: 'y', mustNotDo: 'z' }],
            },
          ],
        },
      ]);
      // strict schema: children not allowed on SopChildTag
      expect(result.success).toBe(false);
    });
  });
});
