import { describe, it, expect } from 'vitest';
import {
  validateWebURL,
  upgradeToHttps,
  isPermittedRedirect,
  isPrivateIP,
} from '../../security/web-security.js';

// ─── validateWebURL ──────────────────────────────────────────────

describe('validateWebURL', () => {
  it('应该允许合法的 https URL', () => {
    const r = validateWebURL('https://example.com/page');
    expect(r.ok).toBe(true);
  });

  it('应该允许合法的 http URL', () => {
    const r = validateWebURL('http://example.com');
    expect(r.ok).toBe(true);
  });

  it('应该拒绝非 http/https 协议', () => {
    for (const url of ['ftp://x.com', 'file:///etc/passwd', 'gopher://x.com']) {
      const r = validateWebURL(url);
      expect(r.ok).toBe(false);
      expect(r.reason).toContain('协议');
    }
  });

  it('应该拒绝无效 URL', () => {
    const r = validateWebURL('not-a-url');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('无效');
  });

  it('应该拒绝超长 URL（>2000 字符）', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(2000);
    const r = validateWebURL(longUrl);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('过长');
  });

  it('应该拒绝包含用户名的 URL', () => {
    const r = validateWebURL('https://user@example.com');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('凭据');
  });

  it('应该拒绝包含密码的 URL', () => {
    const r = validateWebURL('https://user:pass@example.com');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('凭据');
  });

  it('应该拒绝单段主机名（如 localhost）', () => {
    const r = validateWebURL('http://localhost:3000');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('内部');
  });

  it('应该拒绝单段主机名（如 intranet）', () => {
    const r = validateWebURL('http://intranet/admin');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('内部');
  });

  it('应该拒绝私有 IP 地址 127.x', () => {
    const r = validateWebURL('http://127.0.0.1:8080/admin');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('私有');
  });

  it('应该拒绝私有 IP 地址 10.x', () => {
    const r = validateWebURL('http://10.0.0.1/secret');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('私有');
  });

  it('应该拒绝私有 IP 地址 172.16.x', () => {
    const r = validateWebURL('http://172.16.0.1/internal');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('私有');
  });

  it('应该允许 172.15.x（非私有范围）', () => {
    const r = validateWebURL('http://172.15.0.1/ok');
    expect(r.ok).toBe(true);
  });

  it('应该拒绝私有 IP 地址 192.168.x', () => {
    const r = validateWebURL('http://192.168.1.1/router');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('私有');
  });

  it('应该拒绝 IPv6 回环 [::1]', () => {
    const r = validateWebURL('http://[::1]:8080/');
    expect(r.ok).toBe(false);
    // [::1] 被内部域名检查或私有 IP 检查拦截均可
    expect(r.reason).toBeDefined();
  });

  it('应该拒绝 0.0.0.0', () => {
    const r = validateWebURL('http://0.0.0.0/');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('私有');
  });

  it('应该允许正常的公网 IP', () => {
    const r = validateWebURL('http://8.8.8.8/dns');
    expect(r.ok).toBe(true);
  });

  it('应该拒绝 169.254.x（链路本地）', () => {
    const r = validateWebURL('http://169.254.1.1/');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('私有');
  });
});

// ─── upgradeToHttps ──────────────────────────────────────────────

describe('upgradeToHttps', () => {
  it('应该将 http 升级为 https', () => {
    expect(upgradeToHttps('http://example.com/page')).toBe('https://example.com/page');
  });

  it('不应改变已是 https 的 URL', () => {
    expect(upgradeToHttps('https://example.com/page')).toBe('https://example.com/page');
  });

  it('应保留路径、查询参数和哈希', () => {
    expect(upgradeToHttps('http://example.com/path?q=1#hash'))
      .toBe('https://example.com/path?q=1#hash');
  });

  it('应保留端口号', () => {
    expect(upgradeToHttps('http://example.com:8080/'))
      .toBe('https://example.com:8080/');
  });
});

// ─── isPrivateIP ─────────────────────────────────────────────────

describe('isPrivateIP', () => {
  it('应该识别 127.x 为私有', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('127.255.255.255')).toBe(true);
  });

  it('应该识别 10.x 为私有', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true);
    expect(isPrivateIP('10.255.255.255')).toBe(true);
  });

  it('应该识别 172.16-31.x 为私有', () => {
    expect(isPrivateIP('172.16.0.1')).toBe(true);
    expect(isPrivateIP('172.31.255.255')).toBe(true);
    expect(isPrivateIP('172.15.0.1')).toBe(false);
    expect(isPrivateIP('172.32.0.1')).toBe(false);
  });

  it('应该识别 192.168.x 为私有', () => {
    expect(isPrivateIP('192.168.0.1')).toBe(true);
    expect(isPrivateIP('192.168.255.255')).toBe(true);
  });

  it('应该识别 169.254.x（链路本地）为私有', () => {
    expect(isPrivateIP('169.254.1.1')).toBe(true);
  });

  it('应该识别 0.0.0.0 为私有', () => {
    expect(isPrivateIP('0.0.0.0')).toBe(true);
  });

  it('应该识别 ::1 为私有', () => {
    expect(isPrivateIP('::1')).toBe(true);
  });

  it('应该识别公网 IP 为非私有', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false);
    expect(isPrivateIP('1.1.1.1')).toBe(false);
    expect(isPrivateIP('203.0.113.1')).toBe(false);
  });

  it('应该识别域名为非私有（不做 DNS 解析）', () => {
    expect(isPrivateIP('example.com')).toBe(false);
  });
});

// ─── isPermittedRedirect ─────────────────────────────────────────

describe('isPermittedRedirect', () => {
  it('应该允许同主机重定向', () => {
    expect(isPermittedRedirect(
      'https://example.com/old',
      'https://example.com/new',
    )).toBe(true);
  });

  it('应该允许添加 www 前缀的重定向', () => {
    expect(isPermittedRedirect(
      'https://example.com/page',
      'https://www.example.com/page',
    )).toBe(true);
  });

  it('应该允许移除 www 前缀的重定向', () => {
    expect(isPermittedRedirect(
      'https://www.example.com/page',
      'https://example.com/page',
    )).toBe(true);
  });

  it('应该拒绝跨主机重定向', () => {
    expect(isPermittedRedirect(
      'https://example.com/page',
      'https://evil.com/phish',
    )).toBe(false);
  });

  it('应该拒绝协议降级（https → http）', () => {
    expect(isPermittedRedirect(
      'https://example.com/page',
      'http://example.com/page',
    )).toBe(false);
  });

  it('应该允许协议升级（http → https）', () => {
    expect(isPermittedRedirect(
      'http://example.com/page',
      'https://example.com/page',
    )).toBe(true);
  });

  it('应该拒绝端口变更重定向', () => {
    expect(isPermittedRedirect(
      'https://example.com/page',
      'https://example.com:8080/page',
    )).toBe(false);
  });

  it('应该拒绝子域名重定向（非 www）', () => {
    expect(isPermittedRedirect(
      'https://example.com/page',
      'https://api.example.com/page',
    )).toBe(false);
  });
});
