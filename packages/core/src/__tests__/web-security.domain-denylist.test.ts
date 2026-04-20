/**
 * M8 域名黑名单 + 通配符匹配单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  matchDomainPattern,
  isDomainBlocked,
  findMatchedDenylistPattern,
} from '../security/web-security.js';

describe('matchDomainPattern', () => {
  it('精确匹配（大小写不敏感）', () => {
    expect(matchDomainPattern('example.com', 'example.com')).toBe(true);
    expect(matchDomainPattern('EXAMPLE.COM', 'example.com')).toBe(true);
    expect(matchDomainPattern('example.com', 'EXAMPLE.com')).toBe(true);
    expect(matchDomainPattern('foo.com', 'example.com')).toBe(false);
  });

  it('*. 通配匹配子域名', () => {
    expect(matchDomainPattern('a.example.com', '*.example.com')).toBe(true);
    expect(matchDomainPattern('x.y.example.com', '*.example.com')).toBe(true);
    // 根域名不应匹配 *.example.com
    expect(matchDomainPattern('example.com', '*.example.com')).toBe(false);
    // 不同根域名不匹配
    expect(matchDomainPattern('a.other.com', '*.example.com')).toBe(false);
  });

  it('边界：空模式、空前缀', () => {
    expect(matchDomainPattern('a.b', '')).toBe(false);
    expect(matchDomainPattern('anything.com', '*.')).toBe(false);
  });

  it('尾随点等边界用例', () => {
    // "example.com." 不会被当作 "example.com"（严格匹配）
    expect(matchDomainPattern('example.com.', 'example.com')).toBe(false);
  });

  it('punycode 域名：pattern 用原文也能命中（H1 修正）', () => {
    // new URL('https://中国.example.com').hostname → 'xn--fiqs8s.example.com'
    const punycodedHost = 'xn--fiqs8s.example.com';
    // 以 UTF-8 原文写的 pattern 也应命中
    expect(matchDomainPattern(punycodedHost, '中国.example.com')).toBe(true);
    // 双方都是 punycode 当然命中
    expect(matchDomainPattern(punycodedHost, 'xn--fiqs8s.example.com')).toBe(true);
  });
});

describe('isDomainBlocked', () => {
  it('denylist 空时一律放行', () => {
    expect(isDomainBlocked('https://any.com/x', [])).toBe(false);
    expect(isDomainBlocked('https://any.com/x', undefined)).toBe(false);
  });

  it('命中任一模式即拒', () => {
    const list = ['evil.com', '*.internal.company.com'];
    expect(isDomainBlocked('https://evil.com/', list)).toBe(true);
    expect(isDomainBlocked('https://a.internal.company.com/', list)).toBe(true);
    expect(isDomainBlocked('https://b.internal.company.com:8080/x?y=1', list)).toBe(true);
    expect(isDomainBlocked('https://clean.example.com/', list)).toBe(false);
  });

  it('非法 URL 返回 false（由上游 URL 校验处理）', () => {
    expect(isDomainBlocked('not-a-url', ['evil.com'])).toBe(false);
  });
});

describe('findMatchedDenylistPattern', () => {
  it('返回首个命中的模式', () => {
    const list = ['*.internal.company.com', 'specific.bad.com'];
    expect(findMatchedDenylistPattern('https://specific.bad.com/', list)).toBe(
      'specific.bad.com',
    );
    expect(findMatchedDenylistPattern('https://x.internal.company.com/', list)).toBe(
      '*.internal.company.com',
    );
    expect(findMatchedDenylistPattern('https://allowed.com/', list)).toBeNull();
  });
});
