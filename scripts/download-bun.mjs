#!/usr/bin/env node
/**
 * download-bun.mjs — 下载 Bun 预编译二进制，用于内嵌到 Tauri app
 *
 * 用法:
 *   node scripts/download-bun.mjs                # 自动检测当前架构
 *   node scripts/download-bun.mjs aarch64        # Apple Silicon
 *   node scripts/download-bun.mjs x64            # Intel
 *
 * 输出: apps/desktop/src-tauri/bun-bin/bun
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, chmodSync, unlinkSync, renameSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Bun 版本
const BUN_VERSION = '1.3.6';

// 架构映射：Node 的 process.arch → Bun 下载包命名
const archArg = process.argv[2];
const archMap = { arm64: 'aarch64', x64: 'x64-baseline' };
const bunArch = archArg === 'x64' ? 'x64-baseline'
  : archArg === 'aarch64' ? 'aarch64'
  : archMap[process.arch] ?? 'aarch64';

const zipName = `bun-darwin-${bunArch}`;
const url = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${zipName}.zip`;

const outDir = join(ROOT, 'apps', 'desktop', 'src-tauri', 'bun-bin');
const bunBin = join(outDir, 'bun');

// 如果已存在且版本匹配，跳过
if (existsSync(bunBin)) {
  try {
    const ver = execSync(`"${bunBin}" --version`, { encoding: 'utf-8' }).trim();
    if (ver === BUN_VERSION) {
      console.log(`✅ Bun ${ver} (${bunArch}) 已存在，跳过下载`);
      process.exit(0);
    }
    console.log(`⚠️  现有 bun 版本 ${ver}，需要 ${BUN_VERSION}，重新下载`);
  } catch {
    console.log('⚠️  现有 bun 无法执行，重新下载');
  }
}

console.log(`📦 下载 Bun v${BUN_VERSION} (darwin-${bunArch})...`);
console.log(`   ${url}`);

mkdirSync(outDir, { recursive: true });

const tmpDir = join(outDir, '_tmp');
mkdirSync(tmpDir, { recursive: true });

try {
  // 下载并解压 zip
  const zipFile = join(tmpDir, 'bun.zip');
  execSync(`curl -fsSL -o "${zipFile}" "${url}"`, { stdio: 'inherit' });
  execSync(`unzip -o -q "${zipFile}" -d "${tmpDir}"`, { stdio: 'inherit' });

  // Bun zip 解压后结构: bun-darwin-{arch}/bun
  const srcBun = join(tmpDir, zipName, 'bun');
  if (!existsSync(srcBun)) {
    console.error(`❌ 解压后未找到 ${zipName}/bun`);
    process.exit(1);
  }

  // 移动到目标位置
  if (existsSync(bunBin)) unlinkSync(bunBin);
  renameSync(srcBun, bunBin);
  chmodSync(bunBin, 0o755);

  // 清理临时文件
  execSync(`rm -rf "${tmpDir}"`);

  // 验证
  const ver = execSync(`"${bunBin}" --version`, { encoding: 'utf-8' }).trim();
  console.log(`✅ Bun ${ver} (${bunArch}) 已下载到 ${bunBin}`);

  // 显示大小
  const size = (statSync(bunBin).size / 1024 / 1024).toFixed(1);
  console.log(`📏 大小: ${size} MB`);
} catch (err) {
  console.error('❌ 下载失败:', err instanceof Error ? err.message : err);
  execSync(`rm -rf "${tmpDir}"`);
  process.exit(1);
}
