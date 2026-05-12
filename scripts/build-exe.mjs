#!/usr/bin/env node
/**
 * build-exe.mjs — Windows NSIS .exe 打包
 *
 * 用法:
 *   node scripts/build-exe.mjs                  # 默认品牌 evoclaw
 *   BRAND=healthclaw node scripts/build-exe.mjs # 指定品牌
 *
 * 注意:
 *   - 仅 Windows native build 才能产 NSIS .exe（mac/Linux 跑会报 makensis 缺失）
 *   - 未签名：装机时 Windows SmartScreen 会拦截，点"更多信息→仍要运行"
 *
 * M14 PR-A4: Windows .exe 打包入口。跨平台 Node.js 脚本替代 build-dmg.sh，
 * Windows runner 直接 node 执行无 bash 依赖。
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const brand = process.env.BRAND || 'evoclaw';
const brandJson = join(ROOT, 'brands', brand, 'brand.json');
if (!existsSync(brandJson)) {
  console.error(`❌ 找不到品牌配置: ${brandJson}`);
  process.exit(1);
}
const brandName = JSON.parse(readFileSync(brandJson, 'utf-8')).name;

function header(title) {
  console.log('=========================================');
  console.log(`  ${title}`);
  console.log('=========================================');
}

function run(cmd, env = {}) {
  execSync(cmd, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...env },
  });
}

header(`${brandName} Windows .exe 打包`);

// 1. 应用品牌配置
console.log('\n[0/4] 应用品牌配置: ' + brand);
run(`node scripts/brand-apply.mjs`, { BRAND: brand });

// 2. 下载内嵌 Bun（Windows binary）
console.log('\n[1/4] 确保内嵌 Bun 二进制 (windows)...');
run(`node scripts/download-bun.mjs`);

// 3. 构建所有包
console.log('\n[2/4] 构建所有包 (shared + core + desktop 前端)...');
run(`pnpm build`);

// 4. 验证产出
console.log('\n[3/4] 验证 Core 构建产出...');
const required = [
  'packages/core/dist/server.mjs',
  'packages/core/dist/package.json',
];
for (const p of required) {
  if (!existsSync(join(ROOT, p))) {
    console.error(`❌ ${p} 不存在`);
    process.exit(1);
  }
}
// bun-bin 检查（Windows 上是 bun.exe，其他是 bun）
const bunBin = process.platform === 'win32'
  ? 'apps/desktop/src-tauri/bun-bin/bun.exe'
  : 'apps/desktop/src-tauri/bun-bin/bun';
if (!existsSync(join(ROOT, bunBin))) {
  console.error(`❌ 内嵌 Bun 二进制不存在: ${bunBin}`);
  process.exit(1);
}
console.log(`✅ server.mjs + package.json + ${bunBin} 已就绪`);

// 5. Tauri 打包（NSIS）
console.log('\n[4/4] 执行 Tauri 打包 (cargo build --release + NSIS installer)...');
console.log('   首次打包需要编译 Rust，可能需要 5-10 分钟...\n');
run(`pnpm --filter @evoclaw/desktop tauri build --bundles nsis`);

console.log('\n=========================================');
console.log('  打包完成！');
console.log('=========================================\n');

// 产物位置提示
const nsisDir = 'apps/desktop/src-tauri/target/release/bundle/nsis';
console.log(`📦 NSIS 安装包: ${nsisDir}/*.exe`);
console.log('');
console.log('安装方式（Windows）:');
console.log('  1. 双击 .exe 启动安装');
console.log('  2. SmartScreen 警告 → 点 "更多信息" → "仍要运行"');
console.log(`  3. 默认安装到 %LOCALAPPDATA%\\${brandName}（perUser 模式不要管理员权限）`);
