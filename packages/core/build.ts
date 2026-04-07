import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

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
// 环境变量 ENABLE_* 控制功能开关，esbuild 替换为 true/false 常量后 tree shake 移除未启用分支
// 名称列表必须与 FEATURE_REGISTRY (src/infrastructure/feature.ts) 保持同步
// CI 脚本 scripts/check-feature-flags.ts 校验一致性
const FEATURE_NAMES = ['SANDBOX', 'WEIXIN', 'MCP', 'SILK_VOICE', 'WECOM', 'FEISHU'] as const;

const featureFlags: Record<string, string> = {};
for (const name of FEATURE_NAMES) {
  featureFlags[`FEATURE_${name}`] = JSON.stringify(process.env[`ENABLE_${name}`] === 'true');
}

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'esnext',
  format: 'esm',
  outfile: 'dist/server.mjs',
  external: ['better-sqlite3', 'bun:sqlite'],
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
  JSON.stringify({ name: '@evoclaw/core', type: 'module', version: '0.1.0' }),
);
console.log('Generated dist/package.json for PI framework compatibility');

console.log('Build complete: dist/server.mjs');
