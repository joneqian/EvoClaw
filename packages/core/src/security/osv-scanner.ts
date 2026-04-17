/**
 * OSV 恶意软件预检 — 安装 MCP / 扩展前查询 osv.dev API，拒绝 MAL-* 标记的包
 *
 * 数据源: https://osv.dev/docs/#tag/api/operation/OSV_QueryAffected
 * 关注: 仅 ID 以 "MAL-" 开头的（恶意软件，非普通 CVE）
 *
 * 策略:
 * - 5s 超时，Fail Closed（网络失败拒绝安装）
 * - 24h session 内缓存
 * - 用户级 skipPackages 白名单 escape hatch
 *
 * 参考 hermes-agent §3.17
 */

const OSV_API_URL = 'https://api.osv.dev/v1/query';
const OSV_TIMEOUT_MS = 5000;
const OSV_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export type OsvEcosystem = 'npm' | 'PyPI' | 'crates.io' | 'Go' | 'Maven';

export interface OsvVulnerability {
  id: string;
  summary?: string;
  details?: string;
}

export interface OsvScanResult {
  /** 是否发现恶意软件标记（MAL-*） */
  malicious: boolean;
  /** 命中的所有 vuln 列表（MAL-* + 其他） */
  vulnerabilities: OsvVulnerability[];
  /** 仅恶意软件标记的 id 列表（用于显示） */
  maliciousIds: string[];
  /** 扫描是否成功（false = 网络失败/超时） */
  scanned: boolean;
  /** 错误信息（scanned=false 时） */
  error?: string;
}

interface CacheEntry {
  result: OsvScanResult;
  expiresAt: number;
}

/** session 内缓存（重启清空） */
const cache = new Map<string, CacheEntry>();

/** Fetch 函数签名（可注入测试） */
export type FetchFn = typeof fetch;

/** 清空缓存（测试辅助） */
export function clearOsvCache(): void {
  cache.clear();
}

/**
 * 查询单个包是否被 OSV 标记为恶意
 *
 * @param name 包名
 * @param ecosystem 生态（默认 npm）
 * @param version 版本（可选；未指定时查询所有版本）
 * @param fetchFn 测试注入
 */
export async function scanPackage(
  name: string,
  ecosystem: OsvEcosystem = 'npm',
  version?: string,
  fetchFn: FetchFn = fetch,
): Promise<OsvScanResult> {
  const cacheKey = `${ecosystem}:${name}:${version ?? '*'}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const body: Record<string, unknown> = {
    package: { name, ecosystem },
  };
  if (version) body.version = version;

  let result: OsvScanResult;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OSV_TIMEOUT_MS);

    const response = await fetchFn(OSV_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      result = {
        malicious: false,
        vulnerabilities: [],
        maliciousIds: [],
        scanned: false,
        error: `OSV API 返回 HTTP ${response.status}`,
      };
    } else {
      const data = (await response.json()) as { vulns?: OsvVulnerability[] };
      const vulns = data.vulns ?? [];
      const maliciousIds = vulns.filter((v) => v.id.startsWith('MAL-')).map((v) => v.id);
      result = {
        malicious: maliciousIds.length > 0,
        vulnerabilities: vulns,
        maliciousIds,
        scanned: true,
      };
    }
  } catch (err) {
    result = {
      malicious: false,
      vulnerabilities: [],
      maliciousIds: [],
      scanned: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  cache.set(cacheKey, { result, expiresAt: Date.now() + OSV_CACHE_TTL_MS });
  return result;
}

/**
 * 从 npx/bunx 命令 args 中提取 npm 包名
 * 支持: ['-y', 'pkg'] / ['-y', '@scope/pkg'] / ['pkg@version']
 */
export function extractPackageFromNpxArgs(args: readonly string[] | undefined): { name: string; version?: string } | null {
  if (!args || args.length === 0) return null;
  // 跳过 flags 找第一个非 flag 参数
  for (const arg of args) {
    if (arg.startsWith('-')) continue;
    // 解析 [@scope/]name[@version]
    const scoped = arg.startsWith('@');
    const splitIdx = scoped ? arg.indexOf('@', 1) : arg.indexOf('@');
    if (splitIdx > 0) {
      return { name: arg.slice(0, splitIdx), version: arg.slice(splitIdx + 1) };
    }
    return { name: arg };
  }
  return null;
}

/** 判断 command 是否为 npm 包运行器（npx / bunx / pnpm dlx） */
export function isNpmRunner(command: string): boolean {
  const base = command.split('/').pop() ?? command;
  return base === 'npx' || base === 'bunx' || base === 'pnpm';
}
