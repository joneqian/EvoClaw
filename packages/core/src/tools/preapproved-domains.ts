/**
 * 预批准域名列表 — 免权限确认直接访问
 *
 * 参考 Claude Code 130+ 预批准域名设计：
 * - 仅作用于 GET 请求（web_fetch），不传递给沙箱网络策略
 * - 覆盖主流编程语言文档站 + 国内常用开发文档
 * - 支持路径前缀匹配（如 github.com/anthropics）
 */

/** 纯主机名匹配（无路径限制） */
const HOSTNAME_ONLY = new Set([
  // ── 编程语言文档 ──
  'docs.python.org',
  'en.cppreference.com',
  'cplusplus.com',
  'learn.microsoft.com',              // C#, .NET, TypeScript, PowerShell
  'go.dev',
  'doc.rust-lang.org',
  'docs.oracle.com',                  // Java
  'kotlinlang.org',
  'www.php.net',
  'ruby-doc.org',
  'docs.swift.org',
  'developer.apple.com',
  'dart.dev',
  'elixir-lang.org',
  'www.erlang.org',
  'clojure.org',
  'www.scala-lang.org',
  'ziglang.org',

  // ── Web 框架 ──
  'react.dev',
  'angular.io',
  'angular.dev',
  'vuejs.org',
  'nextjs.org',
  'nuxt.com',
  'svelte.dev',
  'astro.build',
  'remix.run',
  'expressjs.com',
  'koajs.com',
  'fastapi.tiangolo.com',
  'flask.palletsprojects.com',
  'docs.djangoproject.com',
  'rubyonrails.org',
  'spring.io',
  'laravel.com',

  // ── 数据库 ──
  'www.postgresql.org',
  'dev.mysql.com',
  'www.mongodb.com',
  'redis.io',
  'www.sqlite.org',
  'www.elastic.co',
  'graphql.org',
  'www.prisma.io',

  // ── 云平台 & DevOps ──
  'docs.aws.amazon.com',
  'cloud.google.com',
  'kubernetes.io',
  'docs.docker.com',
  'www.terraform.io',
  'developer.hashicorp.com',
  'docs.github.com',
  'docs.gitlab.com',

  // ── 测试框架 ──
  'vitest.dev',
  'jestjs.io',
  'playwright.dev',
  'docs.cypress.io',
  'testing-library.com',

  // ── 工具 & 运行时 ──
  'nodejs.org',
  'bun.sh',
  'deno.land',
  'www.typescriptlang.org',
  'eslint.org',
  'prettier.io',
  'vitejs.dev',
  'webpack.js.org',
  'esbuild.github.io',
  'turbo.build',
  'pnpm.io',
  'yarnpkg.com',
  'www.npmjs.com',
  'crates.io',
  'pypi.org',
  'pkg.go.dev',

  // ── 标准 & 规范 ──
  'developer.mozilla.org',            // MDN Web Docs
  'www.w3.org',
  'html.spec.whatwg.org',
  'tc39.es',

  // ── AI / ML ──
  'platform.openai.com',
  'docs.anthropic.com',
  'huggingface.co',
  'pytorch.org',
  'www.tensorflow.org',

  // ── MCP / Agent ──
  'modelcontextprotocol.io',
  'agentskills.io',

  // ── 国内开发者文档 ──
  'developer.aliyun.com',
  'cloud.tencent.com',
  'juejin.cn',
  'www.ruanyifeng.com',
  'cn.vuejs.org',

  // ── 其他常用 ──
  'stackoverflow.com',
  'en.wikipedia.org',
  'www.json.org',
  'yaml.org',
  'semver.org',
]);

/** 需要路径前缀匹配的域名 → 路径前缀列表 */
const PATH_PREFIXES = new Map<string, readonly string[]>([
  ['github.com', ['/anthropics', '/openai', '/vercel', '/facebook', '/microsoft', '/google']],
  ['docs.github.com', ['/en']],
]);

/**
 * 检查给定 URL 是否为预批准域名
 * 预批准域名跳过权限确认，减少用户交互摩擦
 */
export function isPreapprovedHost(hostname: string, pathname = '/'): boolean {
  // 纯主机名匹配
  if (HOSTNAME_ONLY.has(hostname)) return true;

  // 路径前缀匹配
  const prefixes = PATH_PREFIXES.get(hostname);
  if (prefixes) {
    for (const p of prefixes) {
      // 路径段边界检查：/anthropics 不匹配 /anthropics-evil/malware
      if (pathname === p || pathname.startsWith(p + '/')) return true;
    }
  }

  return false;
}

/**
 * 从 URL 字符串中提取域名并检查是否预批准
 */
export function isPreapprovedURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    return isPreapprovedHost(parsed.hostname, parsed.pathname);
  } catch {
    return false;
  }
}
