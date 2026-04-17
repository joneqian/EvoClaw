/**
 * Web 工具安全模块 — URL 校验、SSRF 防护、重定向安全
 *
 * 6 层防护：
 * 1. URL 校验（协议、格式、长度、凭据）
 * 2. 内部域名 / 私有 IP 字面量检测（同步）
 * 3. 元数据 hostname 黑名单（GCP/AWS/Azure/K8s）
 * 4. DNS 解析后逐 IP 复检（DNS rebinding 防护，Fail Closed）
 * 5. HTTP → HTTPS 自动升级
 * 6. 重定向安全（同主机跟随，跨主机返回 LLM）
 */

import { lookup as dnsLookup } from 'node:dns/promises';

/** URL 最大长度 */
const MAX_URL_LENGTH = 2000;

/** DNS 解析超时（ms） */
const DNS_LOOKUP_TIMEOUT_MS = 5000;

/** 最大安全重定向跳数 */
export const MAX_REDIRECTS = 10;

// ─── Types ───────────────────────────────────────────────────────

export interface URLValidationResult {
  readonly ok: boolean;
  /** 仅当 ok=false 时有值 */
  readonly reason?: string;
  /** 仅当 ok=true 时有值 */
  readonly parsed?: URL;
}

export interface RedirectInfo {
  readonly type: 'cross_host_redirect';
  readonly originalUrl: string;
  readonly redirectUrl: string;
  readonly message: string;
}

export interface SafeFetchResult {
  readonly response?: Response;
  readonly redirect?: RedirectInfo;
  readonly error?: string;
}

/** DNS lookup 函数签名（可注入测试） */
export type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

/** 默认 DNS lookup（带超时 + all=true 拿全部 IP） */
const defaultLookup: LookupFn = async (hostname) => {
  const result = await Promise.race([
    dnsLookup(hostname, { all: true }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('DNS lookup 超时')), DNS_LOOKUP_TIMEOUT_MS),
    ),
  ]);
  return result as Array<{ address: string; family: number }>;
};

// ─── URL 校验 ────────────────────────────────────────────────────

/**
 * 验证 URL 是否安全可抓取
 * 检查项：格式、协议、长度、凭据、内部域名、私有 IP
 */
export function validateWebURL(url: string): URLValidationResult {
  // 长度检查
  if (url.length > MAX_URL_LENGTH) {
    return { ok: false, reason: `URL 过长（${url.length} 字符），上限 ${MAX_URL_LENGTH}` };
  }

  // 格式检查
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: `无效的 URL: "${url}"` };
  }

  // 协议检查
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `不支持的协议 "${parsed.protocol}"，仅允许 http/https` };
  }

  // 凭据检查（防止凭据泄露）
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'URL 不允许包含凭据（用户名/密码）' };
  }

  // 内部域名检查（单段主机名 = localhost / intranet 等）
  const hostnameParts = parsed.hostname.split('.');
  if (hostnameParts.length < 2) {
    return { ok: false, reason: `拒绝访问内部域名 "${parsed.hostname}"` };
  }

  // 元数据 hostname 黑名单（云平台 metadata 服务）
  if (isMetadataHost(parsed.hostname)) {
    return { ok: false, reason: `拒绝访问云平台元数据端点 "${parsed.hostname}"` };
  }

  // 私有 IP 检查（IP 字面量）
  if (isPrivateIP(parsed.hostname)) {
    return { ok: false, reason: `拒绝访问私有 IP 地址 "${parsed.hostname}"` };
  }

  return { ok: true, parsed };
}

/**
 * 异步校验 URL 是否安全 — 在同步检查之外加 DNS 解析后的 IP 复检
 *
 * 防护场景：
 * - 攻击者注册解析到 127.0.0.1 的域名（DNS rebinding）
 * - 解析到云平台元数据 IP（169.254.169.254）的域名
 *
 * Fail Closed 策略：DNS 解析失败、超时一律拒
 *
 * @param url 待校验 URL
 * @param lookup 可选的 DNS lookup 注入（测试用）
 */
export async function validateWebURLAsync(
  url: string,
  lookup: LookupFn = defaultLookup,
): Promise<URLValidationResult> {
  // 先跑同步检查
  const syncResult = validateWebURL(url);
  if (!syncResult.ok || !syncResult.parsed) return syncResult;

  const hostname = syncResult.parsed.hostname;

  // 已是 IP 字面量 → 同步检查已覆盖，跳过 DNS
  if (isIpLiteral(hostname)) return syncResult;

  // DNS 解析（带超时 + Fail Closed）
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname);
  } catch (err) {
    return {
      ok: false,
      reason: `DNS 解析失败（Fail Closed）: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (addresses.length === 0) {
    return { ok: false, reason: `DNS 解析未返回任何 IP（Fail Closed）` };
  }

  // 任一 IP 为私有/元数据 → 拒（防 DNS rebinding 多 IP 绕过）
  for (const { address } of addresses) {
    if (isPrivateIP(address) || isMetadataHost(address)) {
      return {
        ok: false,
        reason: `域名 "${hostname}" 解析到禁止的 IP "${address}"（DNS rebinding 防护）`,
      };
    }
  }

  return syncResult;
}

// ─── 元数据 hostname 黑名单 ──────────────────────────────────────

/** 云平台元数据服务的固定 hostname / IP */
const METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata',
  'metadata.amazonaws.com',
  '169.254.169.254',
  // AWS IPv6 元数据
  'fd00:ec2::254',
  '[fd00:ec2::254]',
]);

/** Kubernetes 内部 service hostname pattern */
const K8S_INTERNAL_PATTERNS = [
  /^kubernetes\.default\.svc(\.cluster\.local)?$/,
  /^kubernetes\.default$/,
];

/** 判断 hostname 是否为云平台元数据端点或集群内部 service */
export function isMetadataHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (METADATA_HOSTS.has(normalized)) return true;
  return K8S_INTERNAL_PATTERNS.some((re) => re.test(normalized));
}

/** 判断字符串是否为 IP 字面量（v4 或 v6） */
function isIpLiteral(hostname: string): boolean {
  // IPv4
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(hostname)) return true;
  // IPv6 (含方括号或冒号)
  if (hostname.includes(':')) return true;
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true;
  return false;
}

// ─── 私有 IP 检测 ────────────────────────────────────────────────

/**
 * 检测是否为私有/内部 IP 地址
 * 覆盖：127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 *       169.254.0.0/16（链路本地），0.0.0.0, ::1
 */
export function isPrivateIP(hostname: string): boolean {
  // IPv6 回环
  if (hostname === '::1' || hostname === '[::1]') return true;

  // 0.0.0.0
  if (hostname === '0.0.0.0') return true;

  // IPv4 检测
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!ipv4Match) return false;

  const [, a, b] = ipv4Match;
  const first = Number(a);
  const second = Number(b);

  // 127.0.0.0/8 — 回环
  if (first === 127) return true;
  // 10.0.0.0/8 — A 类私有
  if (first === 10) return true;
  // 172.16.0.0/12 — B 类私有
  if (first === 172 && second >= 16 && second <= 31) return true;
  // 192.168.0.0/16 — C 类私有
  if (first === 192 && second === 168) return true;
  // 169.254.0.0/16 — 链路本地
  if (first === 169 && second === 254) return true;
  // 0.0.0.0/8
  if (first === 0) return true;

  return false;
}

// ─── HTTPS 升级 ──────────────────────────────────────────────────

/**
 * 将 http URL 自动升级为 https
 * 保留路径、查询参数、哈希、端口
 */
export function upgradeToHttps(url: string): string {
  if (url.startsWith('http://')) {
    return 'https://' + url.slice(7);
  }
  return url;
}

// ─── 重定向安全 ──────────────────────────────────────────────────

/**
 * 判断重定向是否允许自动跟随
 * 仅允许：同主机（或仅添加/移除 www.）+ 不降级协议 + 同端口
 */
export function isPermittedRedirect(originalUrl: string, redirectUrl: string): boolean {
  let original: URL;
  let redirect: URL;
  try {
    original = new URL(originalUrl);
    redirect = new URL(redirectUrl);
  } catch {
    return false;
  }

  // 禁止协议降级（https → http）
  if (original.protocol === 'https:' && redirect.protocol === 'http:') {
    return false;
  }

  // 端口必须相同
  if (original.port !== redirect.port) {
    return false;
  }

  // 主机名匹配（允许 www. 前缀差异）
  const stripWww = (h: string): string => h.replace(/^www\./, '');
  return stripWww(original.hostname) === stripWww(redirect.hostname);
}

/**
 * 带安全重定向检查的 HTTP 请求
 * - 同主机重定向：自动跟随（最多 MAX_REDIRECTS 跳）
 * - 跨主机重定向：返回 RedirectInfo 让 LLM 决定
 * - 私有 IP 重定向目标：拒绝
 */
export async function fetchWithSafeRedirects(
  url: string,
  init: RequestInit = {},
): Promise<SafeFetchResult> {
  let currentUrl = url;
  let hops = 0;

  while (hops < MAX_REDIRECTS) {
    const response = await fetch(currentUrl, {
      ...init,
      redirect: 'manual',
    });

    // 非重定向 → 直接返回
    if (response.status < 300 || response.status >= 400) {
      return { response };
    }

    // 3xx 重定向
    const location = response.headers.get('location');
    if (!location) {
      return { response }; // 无 Location 头，当作普通响应
    }

    // 解析重定向目标（可能是相对路径）
    let redirectUrl: string;
    try {
      redirectUrl = new URL(location, currentUrl).href;
    } catch {
      return { error: `无效的重定向目标: "${location}"` };
    }

    // 检查重定向目标是否为私有 IP / 元数据端点
    const redirectParsed = new URL(redirectUrl);
    if (isPrivateIP(redirectParsed.hostname)) {
      return { error: `重定向目标为私有 IP "${redirectParsed.hostname}"，已拦截` };
    }
    if (isMetadataHost(redirectParsed.hostname)) {
      return { error: `重定向目标为云平台元数据端点 "${redirectParsed.hostname}"，已拦截` };
    }

    // 判断是否允许自动跟随
    if (isPermittedRedirect(currentUrl, redirectUrl)) {
      currentUrl = redirectUrl;
      hops++;
      continue;
    }

    // 跨主机重定向 → 返回给 LLM
    return {
      redirect: {
        type: 'cross_host_redirect',
        originalUrl: currentUrl,
        redirectUrl,
        message: `页面重定向到不同域名 ${redirectUrl}，需要你决定是否继续访问。`,
      },
    };
  }

  return { error: `重定向次数超过上限（${MAX_REDIRECTS} 次）` };
}
