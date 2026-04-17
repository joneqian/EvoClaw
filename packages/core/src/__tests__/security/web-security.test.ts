import { describe, it, expect } from 'vitest';
import {
  validateWebURL,
  validateWebURLAsync,
  upgradeToHttps,
  isPermittedRedirect,
  isPrivateIP,
  isMetadataHost,
  type LookupFn,
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

// ─── isMetadataHost ──────────────────────────────────────────────

describe('isMetadataHost', () => {
  it('应该识别 GCP 元数据 hostname', () => {
    expect(isMetadataHost('metadata.google.internal')).toBe(true);
    expect(isMetadataHost('metadata')).toBe(true);
  });

  it('应该识别 AWS/Azure 元数据 IP', () => {
    expect(isMetadataHost('169.254.169.254')).toBe(true);
    // IPv6 元数据
    expect(isMetadataHost('fd00:ec2::254')).toBe(true);
    expect(isMetadataHost('[fd00:ec2::254]')).toBe(true);
  });

  it('应该识别 Kubernetes 内部 service', () => {
    expect(isMetadataHost('kubernetes.default.svc')).toBe(true);
    expect(isMetadataHost('kubernetes.default.svc.cluster.local')).toBe(true);
  });

  it('正常 hostname 不应误判', () => {
    expect(isMetadataHost('example.com')).toBe(false);
    expect(isMetadataHost('api.openai.com')).toBe(false);
    expect(isMetadataHost('8.8.8.8')).toBe(false);
  });
});

// ─── validateWebURLAsync (含 DNS 解析) ───────────────────────────

describe('validateWebURLAsync', () => {
  // 测试用 lookup 注入：模拟不同 DNS 解析结果
  const lookupTo = (...addresses: { address: string; family: number }[]): LookupFn =>
    async () => addresses;
  const lookupFails: LookupFn = async () => {
    throw new Error('ENOTFOUND');
  };

  it('应该通过同步检查未被拒的 IP 字面量（无 DNS）', async () => {
    const r = await validateWebURLAsync('https://8.8.8.8/dns', lookupFails);
    // 8.8.8.8 是 IP 字面量，跳过 DNS 解析
    expect(r.ok).toBe(true);
  });

  it('应该拒绝 DNS 解析到私有 IP 的域名（DNS rebinding 防护）', async () => {
    const r = await validateWebURLAsync(
      'https://attacker.com/payload',
      lookupTo({ address: '127.0.0.1', family: 4 }),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('解析');
  });

  it('应该拒绝 DNS 解析到 169.254.x 的域名', async () => {
    const r = await validateWebURLAsync(
      'https://attacker.com/',
      lookupTo({ address: '169.254.169.254', family: 4 }),
    );
    expect(r.ok).toBe(false);
  });

  it('多个 IP 中任一为私有 → 应拒（防回旋绑定）', async () => {
    const r = await validateWebURLAsync(
      'https://multi.com/',
      lookupTo(
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ),
    );
    expect(r.ok).toBe(false);
  });

  it('Fail Closed: DNS 解析失败 → 拒', async () => {
    const r = await validateWebURLAsync('https://nx-domain.invalid/', lookupFails);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('DNS');
  });

  it('应该拒绝元数据 hostname（无需 DNS）', async () => {
    const r = await validateWebURLAsync('http://metadata.google.internal/computeMetadata/v1/');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('元数据');
  });

  it('应该拒绝 IPv6 元数据', async () => {
    const r = await validateWebURLAsync('http://[fd00:ec2::254]/latest/');
    expect(r.ok).toBe(false);
  });

  it('合法公网域名 + 公网 IP → 通过', async () => {
    const r = await validateWebURLAsync(
      'https://example.com/page',
      lookupTo({ address: '93.184.216.34', family: 4 }),
    );
    expect(r.ok).toBe(true);
  });

  it('应该继承同步检查的拒绝（如非法协议）', async () => {
    const r = await validateWebURLAsync('ftp://example.com/');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('协议');
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
