/**
 * M8 Env Sandbox — 子进程环境变量净化
 *
 * 两种模式：
 * - `inherit`（默认，最低心智负担）：透传 process.env 所有变量，但自动剥离
 *   命中 SENSITIVE_PATTERNS 或 customSensitivePatterns 的敏感凭据。
 * - `whitelist`（MCP server 使用）：仅 DEFAULT_PASSTHROUGH + 用户白名单放行。
 *
 * 敏感模式覆盖常见 LLM / 云厂商凭据命名；企业 IT 可通过
 * config.security.env.customSensitivePatterns 扩展。
 */

/** 默认放行的环境变量名（精确匹配，whitelist 模式） */
const DEFAULT_PASSTHROUGH_EXACT = new Set([
  'PATH',
  'HOME',
  'USER',
  'USERNAME',
  'SHELL',
  'PWD',
  'TZ',
  'TMPDIR',
  'TEMP',
  'TMP',
  'NODE_ENV',
]);

/** 默认放行的环境变量名前缀（LANG / LC_*） */
const DEFAULT_PASSTHROUGH_PREFIX = ['LANG', 'LC_'];

/**
 * 显式拒透的敏感变量名模式（即使在用户白名单中也拒）
 *
 * 使用包含匹配（无 `$` 末尾锚定），以覆盖变体：
 *   OPENAI_API_KEYS、MY_TOKEN_V2、DB_PASSWORD_FILE（Docker secrets）、SESSION_SECRETS
 * 这会误剥离极少数无害名（如 API_KEYWORDS），作者判断代价可接受。
 */
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /API_KEY/i,
  /SECRET/i,
  /TOKEN/i,
  /PASSWORD/i,
  /PASSWD/i,
  /CREDENTIAL/i,
  /^ANTHROPIC_/i,
  /^OPENAI_/i,
  /^AWS_/i,
  /^GITHUB_/i,
  /^GH_/i,
  /^GOOGLE_/i,
  /^GCP_/i,
  /^AZURE_/i,
  /^STRIPE_/i,
  /^SLACK_/i,
];

/** 默认敏感模式（只读副本） */
export function getDefaultSensitivePatterns(): readonly RegExp[] {
  return SENSITIVE_PATTERNS;
}

/** 判断是否命中默认放行 */
function isDefaultPassthrough(name: string): boolean {
  if (DEFAULT_PASSTHROUGH_EXACT.has(name)) return true;
  return DEFAULT_PASSTHROUGH_PREFIX.some((p) => name.startsWith(p));
}

/** 判断是否为敏感变量名 */
export function isSensitiveEnvName(
  name: string,
  customPatterns: readonly RegExp[] = [],
): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(name))
    || customPatterns.some((re) => re.test(name));
}

/** 编译 config 中的字符串正则为 RegExp，忽略非法条目 */
export function compileCustomPatterns(patterns?: readonly string[]): RegExp[] {
  if (!patterns || patterns.length === 0) return [];
  const compiled: RegExp[] = [];
  for (const p of patterns) {
    try {
      compiled.push(new RegExp(p, 'i'));
    } catch {
      // 忽略非法正则
    }
  }
  return compiled;
}

export interface SanitizeEnvOptions {
  /** 额外并入子进程 env 的变量（优先级最高，覆盖 parent 同名 + 不受 sensitive 过滤） */
  extraEnv?: Record<string, string>;
  /** 额外敏感模式（与 SENSITIVE_PATTERNS 取并集） */
  customSensitivePatterns?: readonly RegExp[];
  /** 净化模式：inherit（默认）= 透传非敏感；whitelist = 仅放行 DEFAULT_PASSTHROUGH + userPassthrough */
  mode?: 'inherit' | 'whitelist';
  /** whitelist 模式下用户显式放行的变量名（忽略 default 白名单） */
  userPassthrough?: readonly string[];
}

export interface SanitizeEnvResult {
  /** 净化后的 env（可直接传给 spawn） */
  env: Record<string, string>;
  /** 被剥离的敏感变量名列表（供日志/警告） */
  stripped: string[];
}

/**
 * 净化 parent env，产出子进程可用的安全 env。
 *
 * @param parentEnv 通常是 process.env
 * @param options 选项
 */
export function sanitizeEnv(
  parentEnv: Readonly<Record<string, string | undefined>>,
  options: SanitizeEnvOptions = {},
): SanitizeEnvResult {
  const {
    extraEnv,
    customSensitivePatterns = [],
    mode = 'inherit',
    userPassthrough,
  } = options;
  const env: Record<string, string> = {};
  const stripped: string[] = [];
  const userPassSet = new Set(userPassthrough ?? []);

  for (const [name, value] of Object.entries(parentEnv)) {
    if (value === undefined) continue;
    const sensitive = isSensitiveEnvName(name, customSensitivePatterns);

    if (mode === 'inherit') {
      if (sensitive) {
        stripped.push(name);
        continue;
      }
      env[name] = value;
      continue;
    }

    // whitelist 模式
    if (sensitive) {
      if (isDefaultPassthrough(name) || userPassSet.has(name)) {
        stripped.push(name);
      }
      continue;
    }
    if (isDefaultPassthrough(name) || userPassSet.has(name)) {
      env[name] = value;
    }
  }

  // extraEnv 总是最高优先级并绕过敏感过滤（调用方自行控制）
  if (extraEnv) {
    for (const [name, value] of Object.entries(extraEnv)) {
      env[name] = value;
    }
  }

  return { env, stripped };
}
