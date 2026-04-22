import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(
  fs.readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { name: string; version: string };

// Bun 运行时: 内置 import.meta.dirname、require、bun:sqlite，无需额外 polyfill
// Node.js 回退: 需要 createRequire + NODE_PATH + Module._initPaths()
const bunBanner = [
  'import { fileURLToPath as __fileURLToPath } from "url";',
  'import { dirname as __dirname_, resolve as __resolve } from "path";',
  'import { realpathSync as __realpathSync } from "fs";',
  'const __realFile = __realpathSync(__fileURLToPath(import.meta.url));',
  'const __realDir = __dirname_(__realFile);',
  'try { Object.defineProperty(import.meta, "dirname", { value: __realDir, writable: true }); } catch {}',
  // Node.js 回退（Bun 中这些是空操作）
  'if (typeof Bun === "undefined") {',
  '  const { createRequire: __cr } = await import("module");',
  '  const require = __cr(__realFile);',
  '  const __nodePaths = [__resolve(__realDir, "../node_modules"), __resolve(__realDir, "../../node_modules"), __resolve(__realDir, "../../../node_modules")];',
  '  process.env.NODE_PATH = [...__nodePaths, process.env.NODE_PATH].filter(Boolean).join(":");',
  '  const __Module = await import("module"); __Module.default._initPaths();',
  '}',
].join('\n');

// Feature Flag — 编译时常量注入
// 优先级: 环境变量 ENABLE_* > .env.brand (品牌默认值) > false
// 名称列表必须与 FEATURE_REGISTRY (src/infrastructure/feature.ts) 保持同步
// CI 脚本 scripts/check-feature-flags.ts 校验一致性
const FEATURE_NAMES = ['WEIXIN', 'MCP', 'SILK_VOICE', 'WECOM', 'FEISHU', 'CACHED_MICROCOMPACT', 'REACTIVE_COMPACT'] as const;

// 读取品牌默认 Feature Flag（由 brand-apply.mjs 生成）
const brandDefaults: Record<string, boolean> = {};
const envBrandPath = path.join(import.meta.dirname ?? '.', '.env.brand');
if (fs.existsSync(envBrandPath)) {
  const content = fs.readFileSync(envBrandPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, value] = trimmed.split('=');
    if (key && value !== undefined) {
      brandDefaults[key] = value === 'true';
    }
  }
}

const featureFlags: Record<string, string> = {};
for (const name of FEATURE_NAMES) {
  const envKey = `ENABLE_${name}`;
  // 环境变量优先，其次品牌默认值，最后 false
  const enabled = process.env[envKey] !== undefined
    ? process.env[envKey] === 'true'
    : brandDefaults[envKey] ?? false;
  featureFlags[`FEATURE_${name}`] = JSON.stringify(enabled);
}

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'esnext',
  format: 'esm',
  outfile: 'dist/server.mjs',
  // `ws` 必须 external：esbuild bundle 后的 ws 在 Bun 下 WSS 握手会失败
  // （Bun 对 ws 包有 native WebSocket 优化，bundle 后走普通 JS 路径 + http/tls
  // 组合与 Node 行为有差异，表现为 `ws connect failed`）。external 后运行时
  // 直接 resolve node_modules/ws，Bun 识别模块名命中 native 优化，握手成功。
  // 实测：Bun 1.3 + @larksuiteoapi/node-sdk 长连接场景必须。
  external: ['better-sqlite3', 'bun:sqlite', 'ws'],
  sourcemap: true,
  banner: { js: bunBanner },
  define: featureFlags,
});

// 复制迁移 SQL 文件到 dist
const srcMigrations = 'src/infrastructure/db/migrations';
const destMigrations = 'dist/migrations';
if (fs.existsSync(srcMigrations)) {
  fs.mkdirSync(destMigrations, { recursive: true });
  for (const file of fs.readdirSync(srcMigrations).filter(f => f.endsWith('.sql'))) {
    fs.copyFileSync(path.join(srcMigrations, file), path.join(destMigrations, file));
  }
  console.log(`Copied ${fs.readdirSync(destMigrations).length} migration files`);
}

// Bun 运行时使用内置 bun:sqlite，无需打包 native 模块
// better-sqlite3 仅作为 Node.js 回退保留在 external 中

/** 递归复制目录 */
function copyDirRecursive(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 复制 bundled skills 到 dist
const srcBundled = 'src/skill/bundled';
const destBundled = 'dist/skill/bundled';
if (fs.existsSync(srcBundled)) {
  copyDirRecursive(srcBundled, destBundled);
  const count = fs.readdirSync(destBundled).filter(d =>
    fs.statSync(path.join(destBundled, d)).isDirectory()
  ).length;
  console.log(`Copied ${count} bundled skills`);
}

// 生成最小 package.json — PI 框架的 getPackageDir() 从 __dirname 向上查找 package.json，
// 如果找不到会导致 PI 加载失败，回退到无工具的 fetch 模式
fs.writeFileSync(
  'dist/package.json',
  JSON.stringify({ name: pkg.name, type: 'module', version: pkg.version }),
);
console.log('Generated dist/package.json for PI framework compatibility');

// 复制 external 运行时依赖 (ws) 到 dist/node_modules/
//
// 背景：build.ts 把 `ws` 标为 external（esbuild bundle 后的 ws 在 Bun 下
// 会使 @larksuiteoapi/node-sdk 长连接握手失败）。dev 模式下运行时可以从
// packages/core/node_modules/ws 解析；release 模式 Tauri 只打包 dist 目录，
// 需要把 ws 拷贝到 dist/node_modules/ws。
//
// ws 是轻量零依赖包（package.json 里 dependencies 为空，optionalDependencies
// bufferutil/utf-8-validate 只影响性能不影响功能），无需递归处理依赖树。
const copyExternalDep = (pkgName: string) => {
  const src = path.join('node_modules', pkgName);
  const dest = path.join('dist', 'node_modules', pkgName);
  if (!fs.existsSync(src)) {
    console.warn(`⚠ external 依赖 ${pkgName} 缺失 (dev 可能用 .pnpm 符号链接，release 必须存在)`);
    return;
  }
  // 清掉旧目录，避免残留
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  copyDirRecursive(src, dest);
  console.log(`Copied external dep: ${pkgName}`);
};
copyExternalDep('ws');

console.log('Build complete: dist/server.mjs');
