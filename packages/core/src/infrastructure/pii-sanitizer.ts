/**
 * PII 脱敏工具 — 从日志/API 响应中移除敏感数据
 *
 * 检测并替换：
 * - API Key（sk-*、Bearer token、x-api-key 值）
 * - JWT Token
 * - 邮箱地址
 * - 中国手机号
 * - 密码字段值
 * - 自定义敏感模式
 *
 * 参考 Claude Code: stripProtoFields + PII 标记验证
 */

/** 脱敏后的占位符 */
const REDACTED = '[REDACTED]';

/** 简单模式列表（正则 → 固定替换字符串） */
const SIMPLE_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // API Keys（各 Provider 格式）
  { regex: /sk-ant-[A-Za-z0-9_-]{20,}/g, replacement: 'sk-ant-***' },
  { regex: /sk-[A-Za-z0-9_-]{20,}/g, replacement: 'sk-***' },
  { regex: /Bearer\s+[A-Za-z0-9._-]{20,}/gi, replacement: `Bearer ${REDACTED}` },
  // JWT Token
  { regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: `jwt:${REDACTED}` },
  // 邮箱
  { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: `email:${REDACTED}` },
  // 中国手机号
  { regex: /(?<!\d)1[3-9]\d{9}(?!\d)/g, replacement: `phone:${REDACTED}` },
  // x-api-key header 值
  { regex: /x-api-key[:\s]+[A-Za-z0-9._-]{10,}/gi, replacement: `x-api-key: ${REDACTED}` },
];

/** 密码字段值模式（需要函数替换） */
const PASSWORD_JSON_REGEX = /"(?:password|passwd|secret|token|apiKey|api_key)":\s*"[^"]*"/gi;

/**
 * 对文本进行 PII 脱敏
 *
 * @param text 原始文本（日志消息、JSON 字符串等）
 * @returns 脱敏后的文本
 */
export function sanitizePII(text: string): string {
  let result = text;

  for (const { regex, replacement } of SIMPLE_PATTERNS) {
    result = result.replace(regex, replacement);
  }

  // 密码字段值：保留键名，替换值
  result = result.replace(PASSWORD_JSON_REGEX, (match) => {
    const colonIdx = match.indexOf(':');
    return match.slice(0, colonIdx + 1) + ` "${REDACTED}"`;
  });

  return result;
}

/**
 * 对对象进行 PII 脱敏（递归遍历）
 *
 * 脱敏规则：
 * - 键名匹配敏感词（apiKey, password, secret, token）的值替换为 REDACTED
 * - 字符串值走 sanitizePII() 模式匹配
 */
export function sanitizeObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') return sanitizePII(obj);

  if (Array.isArray(obj)) return obj.map(sanitizeObject);

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (isSensitiveKey(key) && typeof value === 'string') {
        result[key] = REDACTED;
      } else {
        result[key] = sanitizeObject(value);
      }
    }
    return result;
  }

  return obj;
}

/** 敏感字段名（不区分大小写） */
const SENSITIVE_KEYS = new Set([
  'apikey', 'api_key', 'apiKey',
  'password', 'passwd',
  'secret', 'secretkey', 'secret_key',
  'token', 'accesstoken', 'access_token', 'refreshtoken', 'refresh_token',
  'authorization',
]);

/** 判断键名是否为敏感字段 */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase());
}
