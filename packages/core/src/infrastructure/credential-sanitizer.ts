/**
 * 凭证 ASCII 清理 — 解决用户从 PDF / 富文本工具复制 API Key 时混入
 * 全角字母 / 同形字 / 不可见字符等，导致 HTTP 认证失败的问题。
 *
 * 策略：
 * - 仅扫描敏感键名（apiKey/secret/token/password/authorization）
 * - 复用 security/unicode-detector.ts 的 normalizeUnicode（全角 ASCII + 同形字 + NFKC）
 * - 残余非 ASCII 字符（中文、emoji 等）用 [\x20-\x7E] strip 剥离
 * - 只在内存中应用，不写回磁盘（用户原值保留可排查）
 * - 改动通过 warnings[] 数组上报给调用方记录日志
 *
 * 参考 hermes-agent §3.5 _sanitize_loaded_credentials
 */

import { normalizeUnicode } from '../security/unicode-detector.js';

/** 敏感键名（小写匹配） */
const SENSITIVE_KEYS = new Set([
  'apikey', 'api_key',
  'secret', 'secretkey', 'secret_key',
  'token', 'accesstoken', 'access_token', 'refreshtoken', 'refresh_token',
  'password', 'passwd',
  'authorization',
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

/**
 * 清理单个字符串：normalizeUnicode → strip 残余非 ASCII
 * 返回 { cleaned, changed }
 */
function cleanCredentialString(value: string): { cleaned: string; changed: boolean } {
  if (!value) return { cleaned: value, changed: false };
  // 1. Unicode 规范化（全角→半角 + 同形字→ASCII + NFKC）
  const normalized = normalizeUnicode(value);
  // 2. Strip 残余非 ASCII 字符（保留可见 ASCII 0x20-0x7E）
  // eslint-disable-next-line no-control-regex
  const stripped = normalized.replace(/[^\x20-\x7E]/g, '');
  return { cleaned: stripped, changed: stripped !== value };
}

export interface SanitizeResult<T> {
  /** 清理后的配置（深拷贝，原对象不动） */
  sanitized: T;
  /** 改动路径列表（如 "models.providers.anthropic.apiKey"） */
  warnings: string[];
}

/**
 * 递归清理配置对象中的凭证字段。
 *
 * @param config 配置对象（任意嵌套）
 * @returns { sanitized, warnings }
 */
export function sanitizeCredentials<T>(config: T): SanitizeResult<T> {
  const warnings: string[] = [];
  const visited = new WeakSet<object>();
  const sanitized = walk(config, '', warnings, visited) as T;
  return { sanitized, warnings };
}

function walk(
  node: unknown,
  pathPrefix: string,
  warnings: string[],
  visited: WeakSet<object>,
): unknown {
  if (node === null || node === undefined) return node;

  if (typeof node !== 'object') return node;

  // 循环引用防护
  if (visited.has(node as object)) return node;
  visited.add(node as object);

  if (Array.isArray(node)) {
    return node.map((item, idx) => walk(item, `${pathPrefix}[${idx}]`, warnings, visited));
  }

  const obj = node as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const fieldPath = pathPrefix ? `${pathPrefix}.${key}` : key;

    if (isSensitiveKey(key) && typeof value === 'string') {
      const { cleaned, changed } = cleanCredentialString(value);
      result[key] = cleaned;
      if (changed) warnings.push(fieldPath);
    } else {
      result[key] = walk(value, fieldPath, warnings, visited);
    }
  }

  return result;
}
