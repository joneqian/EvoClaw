import { describe, it, expect, beforeEach } from 'vitest';
import {
  scanPackage,
  clearOsvCache,
  extractPackageFromNpxArgs,
  isNpmRunner,
  type FetchFn,
} from '../../security/osv-scanner.js';

beforeEach(() => clearOsvCache());

// ─── extractPackageFromNpxArgs ─────────────────────────────────

describe('extractPackageFromNpxArgs', () => {
  it('提取无 scope 包名', () => {
    expect(extractPackageFromNpxArgs(['-y', 'mcp-server-foo'])).toEqual({ name: 'mcp-server-foo' });
  });
  it('提取带 scope 包名', () => {
    expect(extractPackageFromNpxArgs(['-y', '@modelcontextprotocol/server-fs']))
      .toEqual({ name: '@modelcontextprotocol/server-fs' });
  });
  it('提取带版本的包名', () => {
    expect(extractPackageFromNpxArgs(['mcp-server@1.2.3']))
      .toEqual({ name: 'mcp-server', version: '1.2.3' });
  });
  it('提取带 scope+版本的包名', () => {
    expect(extractPackageFromNpxArgs(['@scope/pkg@2.0.0']))
      .toEqual({ name: '@scope/pkg', version: '2.0.0' });
  });
  it('空数组返回 null', () => {
    expect(extractPackageFromNpxArgs([])).toBeNull();
    expect(extractPackageFromNpxArgs(undefined)).toBeNull();
  });
  it('只有 flag 时返回 null', () => {
    expect(extractPackageFromNpxArgs(['-y', '--silent'])).toBeNull();
  });
});

describe('isNpmRunner', () => {
  it('识别 npx / bunx / pnpm', () => {
    expect(isNpmRunner('npx')).toBe(true);
    expect(isNpmRunner('bunx')).toBe(true);
    expect(isNpmRunner('pnpm')).toBe(true);
    expect(isNpmRunner('/usr/local/bin/npx')).toBe(true);
  });
  it('其他命令不识别', () => {
    expect(isNpmRunner('python')).toBe(false);
    expect(isNpmRunner('node')).toBe(false);
    expect(isNpmRunner('mcp-custom-binary')).toBe(false);
  });
});

// ─── scanPackage ──────────────────────────────────────────────

describe('scanPackage', () => {
  const mockOk = (vulns: Array<{ id: string }>): FetchFn =>
    async () => new Response(JSON.stringify({ vulns }), { status: 200 });
  const mockHttp = (status: number): FetchFn =>
    async () => new Response('err', { status });
  const mockNetworkFail: FetchFn = async () => {
    throw new Error('ECONNRESET');
  };

  it('无 vuln 返回 malicious=false, scanned=true', async () => {
    const r = await scanPackage('safe-pkg', 'npm', undefined, mockOk([]));
    expect(r.malicious).toBe(false);
    expect(r.scanned).toBe(true);
    expect(r.maliciousIds).toEqual([]);
  });

  it('命中 MAL-* 返回 malicious=true', async () => {
    const r = await scanPackage('evil-pkg', 'npm', undefined, mockOk([
      { id: 'MAL-2024-12345' },
      { id: 'MAL-2024-67890' },
    ]));
    expect(r.malicious).toBe(true);
    expect(r.maliciousIds).toEqual(['MAL-2024-12345', 'MAL-2024-67890']);
  });

  it('仅 CVE-* 不算恶意', async () => {
    const r = await scanPackage('cve-pkg', 'npm', undefined, mockOk([
      { id: 'CVE-2024-1111' },
      { id: 'GHSA-xxxx' },
    ]));
    expect(r.malicious).toBe(false);
    expect(r.maliciousIds).toEqual([]);
    expect(r.vulnerabilities.length).toBe(2);
  });

  it('混合 MAL + CVE 时仍标记 malicious', async () => {
    const r = await scanPackage('mixed', 'npm', undefined, mockOk([
      { id: 'MAL-2024-1' },
      { id: 'CVE-2024-2' },
    ]));
    expect(r.malicious).toBe(true);
    expect(r.maliciousIds).toEqual(['MAL-2024-1']);
  });

  it('网络失败返回 scanned=false', async () => {
    const r = await scanPackage('any', 'npm', undefined, mockNetworkFail);
    expect(r.scanned).toBe(false);
    expect(r.malicious).toBe(false);
    expect(r.error).toContain('ECONNRESET');
  });

  it('HTTP 5xx 返回 scanned=false', async () => {
    const r = await scanPackage('any', 'npm', undefined, mockHttp(503));
    expect(r.scanned).toBe(false);
    expect(r.error).toContain('503');
  });

  it('结果走 24h 缓存', async () => {
    let calls = 0;
    const counting: FetchFn = async () => {
      calls++;
      return new Response(JSON.stringify({ vulns: [] }), { status: 200 });
    };
    await scanPackage('cached-pkg', 'npm', '1.0.0', counting);
    await scanPackage('cached-pkg', 'npm', '1.0.0', counting);
    await scanPackage('cached-pkg', 'npm', '1.0.0', counting);
    expect(calls).toBe(1);
  });

  it('不同版本独立缓存', async () => {
    let calls = 0;
    const counting: FetchFn = async () => {
      calls++;
      return new Response(JSON.stringify({ vulns: [] }), { status: 200 });
    };
    await scanPackage('vp', 'npm', '1.0.0', counting);
    await scanPackage('vp', 'npm', '2.0.0', counting);
    expect(calls).toBe(2);
  });
});
