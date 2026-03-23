/**
 * Weixin 通道日志脱敏工具
 *
 * 对 token、请求体、URL 等敏感信息进行脱敏处理，
 * 防止在日志中泄露凭证和隐私数据。
 */

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const DEFAULT_SHOW_CHARS = 6;
const DEFAULT_MAX_LEN = 200;

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

/**
 * 脱敏 token/密钥：只显示前 N 个字符 + *** + (len=X)
 *
 * @param token - 待脱敏的 token
 * @param showChars - 显示前几个字符，默认 6
 * @returns 脱敏后的字符串，空值返回 "(none)"
 */
export function redactToken(token: string | undefined, showChars = DEFAULT_SHOW_CHARS): string {
  if (!token) return '(none)';
  if (token.length <= showChars) return `****(len=${token.length})`;
  return `${token.slice(0, showChars)}***(len=${token.length})`;
}

/**
 * 截断请求体：超过 maxLen 时截断并附加原始长度
 *
 * @param body - 待截断的字符串
 * @param maxLen - 最大长度，默认 200
 * @returns 截断后的字符串，空值返回 "(empty)"
 */
export function redactBody(body: string | undefined, maxLen = DEFAULT_MAX_LEN): string {
  if (!body) return '(empty)';
  if (body.length <= maxLen) return body;
  return `${body.slice(0, maxLen)}...(len=${body.length})`;
}

/**
 * 脱敏 URL：去除查询参数，只保留 origin + pathname
 *
 * @param url - 待脱敏的 URL
 * @returns 脱敏后的 URL
 */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    // URL 解析失败时截断返回
    if (url.length > 80) return `${url.slice(0, 80)}...(len=${url.length})`;
    return url;
  }
}
