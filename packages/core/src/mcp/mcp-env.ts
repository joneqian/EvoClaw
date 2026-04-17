/**
 * MCP 子进程环境变量白名单 — 防止 API Key 被恶意 MCP server 读取并外发
 *
 * 默认透传：仅基础 shell / locale / 路径变量
 * 拒透：所有 *_API_KEY / *_SECRET / *_TOKEN / Anthropic / OpenAI 凭据
 * 用户级 escape hatch：mcp-config.envPassthrough 显式声明额外放行
 *
 * 参考 hermes-agent 的 env_passthrough 双层白名单（§3.20）
 */

/** 默认放行的环境变量名（精确匹配） */
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

/** 默认放行的环境变量名前缀（用于 LANG / LC_*) */
const DEFAULT_PASSTHROUGH_PREFIX = ['LANG', 'LC_'];

/** 显式拒透的敏感变量名后缀/前缀（即使在用户白名单也拒） */
const SENSITIVE_PATTERNS = [
  /API_KEY$/i,
  /SECRET$/i,
  /^SECRET_/i,
  /TOKEN$/i,
  /PASSWORD$/i,
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

/** 判断 env 名是否为默认白名单 */
function isDefaultPassthrough(name: string): boolean {
  if (DEFAULT_PASSTHROUGH_EXACT.has(name)) return true;
  return DEFAULT_PASSTHROUGH_PREFIX.some((p) => name.startsWith(p));
}

/** 判断 env 名是否敏感（即使在用户白名单也拒） */
export function isSensitiveEnvName(name: string): boolean {
  return SENSITIVE_PATTERNS.some((re) => re.test(name));
}

/** 构建 MCP 子进程的安全 env */
export function buildMcpEnv(
  processEnv: NodeJS.ProcessEnv | Record<string, string | undefined>,
  serverEnv?: Record<string, string>,
  userPassthrough?: readonly string[],
): { env: Record<string, string>; stripped: string[] } {
  const env: Record<string, string> = {};
  const userPassSet = new Set(userPassthrough ?? []);
  const stripped: string[] = [];

  // 1. 默认白名单 + 用户额外白名单
  for (const [name, value] of Object.entries(processEnv)) {
    if (value === undefined) continue;
    if (isSensitiveEnvName(name)) {
      // 敏感变量绝对禁止透传，即使用户白名单也拒
      if (isDefaultPassthrough(name) || userPassSet.has(name)) {
        stripped.push(name);
      }
      continue;
    }
    if (isDefaultPassthrough(name) || userPassSet.has(name)) {
      env[name] = value;
    }
  }

  // 2. server 显式声明的 env（用户为该 server 配的，覆盖任何放行）
  if (serverEnv) {
    for (const [name, value] of Object.entries(serverEnv)) {
      env[name] = value;
    }
  }

  return { env, stripped };
}
