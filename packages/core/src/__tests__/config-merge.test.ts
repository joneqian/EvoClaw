import { describe, it, expect } from 'vitest';
import { deepMerge, applyEnforced, getValueByPath, setValueByPath, mergeLayers } from '../infrastructure/config-merge.js';

describe('deepMerge', () => {
  it('基本对象合并', () => {
    const base = { a: 1, b: 2 };
    const overlay = { b: 3, c: 4 };
    expect(deepMerge(base, overlay)).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('嵌套对象递归合并', () => {
    const base: Record<string, unknown> = { models: { default: 'a', providers: { openai: { apiKey: 'k1' } } } };
    const overlay: Record<string, unknown> = { models: { providers: { anthropic: { apiKey: 'k2' } } } };
    const result = deepMerge(base, overlay);
    expect((result as any).models.default).toBe('a');
    expect((result as any).models.providers.openai.apiKey).toBe('k1');
    expect((result as any).models.providers.anthropic.apiKey).toBe('k2');
  });

  it('overlay 值覆盖 base', () => {
    const base = { language: 'zh' };
    const overlay = { language: 'en' };
    expect(deepMerge(base, overlay)).toEqual({ language: 'en' });
  });

  it('数组直接替换（非拼接）', () => {
    const base = { tags: ['a', 'b'] };
    const overlay = { tags: ['c'] };
    expect(deepMerge(base, overlay)).toEqual({ tags: ['c'] });
  });

  it('denylist 特殊处理：取并集', () => {
    const base = { denylist: ['a', 'b'] };
    const overlay = { denylist: ['b', 'c'] };
    const result = deepMerge(base, overlay);
    expect(result.denylist?.sort()).toEqual(['a', 'b', 'c']);
  });

  it('嵌套 denylist 也取并集', () => {
    const base = { security: { skills: { denylist: ['bad-1'] } } };
    const overlay = { security: { skills: { denylist: ['bad-2'] } } };
    const result = deepMerge(base, overlay);
    expect((result as any).security.skills.denylist.sort()).toEqual(['bad-1', 'bad-2']);
  });

  it('undefined 值不覆盖', () => {
    const base = { a: 1, b: 2 };
    const overlay = { a: undefined, c: 3 };
    expect(deepMerge(base, overlay)).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('null 覆盖（用于清除字段）', () => {
    const base: Record<string, unknown> = { a: 1 };
    const overlay: Record<string, unknown> = { a: null };
    expect(deepMerge(base, overlay)).toEqual({ a: null });
  });
});

describe('getValueByPath / setValueByPath', () => {
  it('读取嵌套路径', () => {
    const obj = { a: { b: { c: 42 } } };
    expect(getValueByPath(obj, 'a.b.c')).toBe(42);
  });

  it('路径不存在返回 undefined', () => {
    expect(getValueByPath({}, 'a.b.c')).toBeUndefined();
  });

  it('设置嵌套路径（自动创建中间对象）', () => {
    const obj: Record<string, unknown> = {};
    setValueByPath(obj, 'a.b.c', 'hello');
    expect((obj as any).a.b.c).toBe('hello');
  });
});

describe('applyEnforced', () => {
  it('enforced 路径强制使用 managed 的值', () => {
    const merged = { language: 'en', security: { skills: { denylist: ['a'] } } };
    const managed = { language: 'zh', security: { skills: { denylist: ['a', 'b'] } } };
    applyEnforced(merged, managed, ['language']);
    expect(merged.language).toBe('zh');
  });

  it('enforced 嵌套路径', () => {
    const merged: Record<string, unknown> = { security: { skills: { denylist: ['user-only'] } } };
    const managed: Record<string, unknown> = { security: { skills: { denylist: ['managed-only'] } } };
    applyEnforced(merged, managed, ['security.skills.denylist']);
    expect((merged as any).security.skills.denylist).toEqual(['managed-only']);
  });

  it('enforced 路径在 managed 中不存在则跳过', () => {
    const merged = { language: 'en' };
    applyEnforced(merged, {}, ['language']);
    expect(merged.language).toBe('en');
  });
});

describe('mergeLayers', () => {
  it('多层按顺序合并', () => {
    const result = mergeLayers({ a: 1 }, { b: 2 }, { c: 3 });
    expect(result).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('后者覆盖前者', () => {
    const result = mergeLayers({ x: 'low' }, { x: 'mid' }, { x: 'high' });
    expect(result.x).toBe('high');
  });

  it('跳过 undefined 层', () => {
    const result = mergeLayers({ a: 1 }, undefined, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('全部 undefined 返回空对象', () => {
    expect(mergeLayers(undefined, undefined)).toEqual({});
  });
});
