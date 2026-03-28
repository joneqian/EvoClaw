import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server.mjs',
  external: ['better-sqlite3'],
  sourcemap: true,
  banner: {
    js: [
      'import { createRequire as __createRequire } from "module";',
      'import { fileURLToPath as __fileURLToPath } from "url";',
      'import { dirname as __dirname_, resolve as __resolve } from "path";',
      'import { realpathSync as __realpathSync } from "fs";',
      // 用 realpathSync 解析真实路径（绕过 Tauri 的 _up_ 符号链接）
      'const __realFile = __realpathSync(__fileURLToPath(import.meta.url));',
      'const __realDir = __dirname_(__realFile);',
      'const require = __createRequire(__realFile);',
      // 为 ESM import() 设置 NODE_PATH
      'const __nodePaths = [__resolve(__realDir, "../node_modules"), __resolve(__realDir, "../../node_modules"), __resolve(__realDir, "../../../node_modules")];',
      'process.env.NODE_PATH = [...__nodePaths, process.env.NODE_PATH].filter(Boolean).join(":");',
      'import __Module from "module"; __Module._initPaths();',
    ].join('\n'),
  },
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

// --- 复制 better-sqlite3 native 模块到 dist/node_modules/ ---
// 打包后 server.mjs 的 createRequire(import.meta.url) 会从 dist/ 开始查找
// require('better-sqlite3') → dist/node_modules/better-sqlite3/lib/index.js
bundleBetterSqlite3();

function bundleBetterSqlite3() {
  // 在 pnpm store 中查找 better-sqlite3
  const candidates = [
    // pnpm hoisted / store
    path.resolve('../../node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3'),
    path.resolve('../../node_modules/better-sqlite3'),
    path.resolve('node_modules/better-sqlite3'),
  ];

  let srcRoot: string | undefined;
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'lib', 'index.js'))) {
      srcRoot = c;
      break;
    }
  }

  if (!srcRoot) {
    // 动态查找：用 glob 搜索
    const pnpmStore = path.resolve('../../node_modules/.pnpm');
    if (fs.existsSync(pnpmStore)) {
      for (const dir of fs.readdirSync(pnpmStore)) {
        if (dir.startsWith('better-sqlite3@')) {
          const candidate = path.join(pnpmStore, dir, 'node_modules', 'better-sqlite3');
          if (fs.existsSync(path.join(candidate, 'lib', 'index.js'))) {
            srcRoot = candidate;
            break;
          }
        }
      }
    }
  }

  if (!srcRoot) {
    console.warn('⚠️  better-sqlite3 未找到，跳过 native 模块打包（生产环境将无法运行）');
    return;
  }

  const destRoot = 'dist/node_modules/better-sqlite3';

  // 复制 lib/ (JS 文件)
  copyDirRecursive(path.join(srcRoot, 'lib'), path.join(destRoot, 'lib'));

  // 复制 package.json
  fs.copyFileSync(path.join(srcRoot, 'package.json'), path.join(destRoot, 'package.json'));

  // 复制 build/Release/better_sqlite3.node (native binding)
  const nativeSrc = path.join(srcRoot, 'build', 'Release', 'better_sqlite3.node');
  const nativeDest = path.join(destRoot, 'build', 'Release', 'better_sqlite3.node');
  if (fs.existsSync(nativeSrc)) {
    fs.mkdirSync(path.dirname(nativeDest), { recursive: true });
    fs.copyFileSync(nativeSrc, nativeDest);
    const sizeMB = (fs.statSync(nativeDest).size / 1024 / 1024).toFixed(1);
    console.log(`Bundled better-sqlite3 native module (${sizeMB}MB)`);
  } else {
    // prebuilds 格式（部分版本用这个）
    const prebuildsDir = path.join(srcRoot, 'prebuilds');
    if (fs.existsSync(prebuildsDir)) {
      copyDirRecursive(prebuildsDir, path.join(destRoot, 'prebuilds'));
      console.log('Bundled better-sqlite3 prebuilds');
    } else {
      console.warn('⚠️  better-sqlite3 native binding 未找到');
    }
  }

  // Patch database.js: 替换 require('bindings') 为直接 require native 路径
  // 原始: DEFAULT_ADDON || (DEFAULT_ADDON = require('bindings')('better_sqlite3.node'))
  // 替换: DEFAULT_ADDON || (DEFAULT_ADDON = require('../build/Release/better_sqlite3.node'))
  const dbJs = path.join(destRoot, 'lib', 'database.js');
  if (fs.existsSync(dbJs)) {
    let content = fs.readFileSync(dbJs, 'utf-8');
    content = content.replace(
      "require('bindings')('better_sqlite3.node')",
      "require('../build/Release/better_sqlite3.node')",
    );
    fs.writeFileSync(dbJs, content, 'utf-8');
    console.log('Patched database.js: removed bindings dependency');
  }
}

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
