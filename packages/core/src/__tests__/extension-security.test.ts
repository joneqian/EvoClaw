import { describe, it, expect } from 'vitest';
import { evaluateAccess, filterByPolicy, mergeSecurityPolicies } from '../security/extension-security.js';
import type { NameSecurityPolicy } from '@evoclaw/shared';

describe('evaluateAccess', () => {
  it('无策略时允许所有', () => {
    expect(evaluateAccess('any-skill', undefined)).toBe('allowed');
  });

  it('空策略对象允许所有', () => {
    expect(evaluateAccess('any-skill', {})).toBe('allowed');
  });

  it('denylist 绝对优先', () => {
    const policy: NameSecurityPolicy = {
      allowlist: ['skill-a', 'bad-skill'],
      denylist: ['bad-skill'],
    };
    expect(evaluateAccess('bad-skill', policy)).toBe('denied_by_denylist');
  });

  it('disabled 优先于 allowlist', () => {
    const policy: NameSecurityPolicy = {
      allowlist: ['skill-a'],
      disabled: ['skill-a'],
    };
    expect(evaluateAccess('skill-a', policy)).toBe('disabled');
  });

  it('不在 allowlist 中被拒绝', () => {
    const policy: NameSecurityPolicy = {
      allowlist: ['skill-a', 'skill-b'],
    };
    expect(evaluateAccess('skill-c', policy)).toBe('denied_by_allowlist');
  });

  it('在 allowlist 中允许', () => {
    const policy: NameSecurityPolicy = {
      allowlist: ['skill-a', 'skill-b'],
    };
    expect(evaluateAccess('skill-a', policy)).toBe('allowed');
  });

  it('空 allowlist 阻止所有', () => {
    const policy: NameSecurityPolicy = {
      allowlist: [],
    };
    expect(evaluateAccess('any', policy)).toBe('denied_by_allowlist');
  });

  it('仅 denylist 时其他项允许', () => {
    const policy: NameSecurityPolicy = {
      denylist: ['bad-skill'],
    };
    expect(evaluateAccess('good-skill', policy)).toBe('allowed');
  });
});

describe('filterByPolicy', () => {
  const items = [
    { name: 'skill-a', desc: 'A' },
    { name: 'skill-b', desc: 'B' },
    { name: 'skill-c', desc: 'C' },
  ];

  it('无策略时全部允许', () => {
    const result = filterByPolicy(items, i => i.name, undefined);
    expect(result.allowed).toHaveLength(3);
    expect(result.denied).toHaveLength(0);
  });

  it('denylist 过滤', () => {
    const result = filterByPolicy(items, i => i.name, { denylist: ['skill-b'] });
    expect(result.allowed).toHaveLength(2);
    expect(result.denied).toHaveLength(1);
    expect(result.denied[0].item.name).toBe('skill-b');
    expect(result.denied[0].reason).toBe('denied_by_denylist');
  });

  it('allowlist 过滤', () => {
    const result = filterByPolicy(items, i => i.name, { allowlist: ['skill-a'] });
    expect(result.allowed).toHaveLength(1);
    expect(result.denied).toHaveLength(2);
  });
});

describe('mergeSecurityPolicies', () => {
  it('两个 undefined 返回 undefined', () => {
    expect(mergeSecurityPolicies(undefined, undefined)).toBeUndefined();
  });

  it('一个 undefined 返回另一个', () => {
    const p: NameSecurityPolicy = { denylist: ['x'] };
    expect(mergeSecurityPolicies(p, undefined)).toEqual(p);
    expect(mergeSecurityPolicies(undefined, p)).toEqual(p);
  });

  it('denylist 取并集', () => {
    const result = mergeSecurityPolicies({ denylist: ['a'] }, { denylist: ['b'] });
    expect(result?.denylist?.sort()).toEqual(['a', 'b']);
  });

  it('allowlist 取交集', () => {
    const result = mergeSecurityPolicies(
      { allowlist: ['a', 'b', 'c'] },
      { allowlist: ['b', 'c', 'd'] },
    );
    expect(result?.allowlist?.sort()).toEqual(['b', 'c']);
  });

  it('disabled 取并集', () => {
    const result = mergeSecurityPolicies({ disabled: ['x'] }, { disabled: ['y'] });
    expect(result?.disabled?.sort()).toEqual(['x', 'y']);
  });

  it('denylist 去重', () => {
    const result = mergeSecurityPolicies({ denylist: ['a', 'b'] }, { denylist: ['b', 'c'] });
    expect(result?.denylist?.sort()).toEqual(['a', 'b', 'c']);
  });
});
