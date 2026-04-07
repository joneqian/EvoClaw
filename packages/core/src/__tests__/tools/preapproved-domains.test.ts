import { describe, it, expect } from 'vitest';
import { isPreapprovedHost, isPreapprovedURL } from '../../tools/preapproved-domains.js';

describe('isPreapprovedHost', () => {
  it('应该批准主流编程文档站', () => {
    expect(isPreapprovedHost('docs.python.org')).toBe(true);
    expect(isPreapprovedHost('developer.mozilla.org')).toBe(true);
    expect(isPreapprovedHost('react.dev')).toBe(true);
    expect(isPreapprovedHost('go.dev')).toBe(true);
    expect(isPreapprovedHost('doc.rust-lang.org')).toBe(true);
  });

  it('应该批准国内开发文档', () => {
    expect(isPreapprovedHost('juejin.cn')).toBe(true);
    expect(isPreapprovedHost('developer.aliyun.com')).toBe(true);
  });

  it('应该拒绝未列入的域名', () => {
    expect(isPreapprovedHost('example.com')).toBe(false);
    expect(isPreapprovedHost('evil.com')).toBe(false);
    expect(isPreapprovedHost('malware.net')).toBe(false);
  });

  it('应该支持路径前缀匹配', () => {
    expect(isPreapprovedHost('github.com', '/anthropics')).toBe(true);
    expect(isPreapprovedHost('github.com', '/anthropics/claude-code')).toBe(true);
  });

  it('路径前缀匹配应检查段边界', () => {
    // /anthropics-evil 不应匹配 /anthropics
    expect(isPreapprovedHost('github.com', '/anthropics-evil/malware')).toBe(false);
  });

  it('github.com 根路径不应自动批准', () => {
    expect(isPreapprovedHost('github.com', '/')).toBe(false);
    expect(isPreapprovedHost('github.com', '/random-user/repo')).toBe(false);
  });
});

describe('isPreapprovedURL', () => {
  it('应该从完整 URL 判断预批准', () => {
    expect(isPreapprovedURL('https://docs.python.org/3/library/os.html')).toBe(true);
    expect(isPreapprovedURL('https://github.com/anthropics/claude-code')).toBe(true);
  });

  it('应该拒绝非预批准 URL', () => {
    expect(isPreapprovedURL('https://example.com/page')).toBe(false);
  });

  it('无效 URL 应返回 false', () => {
    expect(isPreapprovedURL('not-a-url')).toBe(false);
  });
});
