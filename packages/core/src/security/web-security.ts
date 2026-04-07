/**
 * Web 工具安全模块 — URL 校验、SSRF 防护、重定向安全
 *
 * 参考 Claude Code 5 层防护：
 * 1. URL 校验（协议、格式、长度、凭据）
 * 2. 私有 IP / 内部域名检测
 * 3. HTTP → HTTPS 自动升级
 * 4. 重定向安全（同主机跟随，跨主机返回 LLM）
 * 5. 域名黑名单（可扩展）
 */

/** URL 最大长度 */
const MAX_URL_LENGTH = 2000;

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

  // 私有 IP 检查
  if (isPrivateIP(parsed.hostname)) {
    return { ok: false, reason: `拒绝访问私有 IP 地址 "${parsed.hostname}"` };
  }

  return { ok: true, parsed };
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

    // 检查重定向目标是否为私有 IP
    const redirectParsed = new URL(redirectUrl);
    if (isPrivateIP(redirectParsed.hostname)) {
      return { error: `重定向目标为私有 IP "${redirectParsed.hostname}"，已拦截` };
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
