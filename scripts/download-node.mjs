#!/usr/bin/env node
/**
 * download-node.mjs — 下载 Node.js 预编译二进制，用于内嵌到 Tauri app
 *
 * 用法:
 *   node scripts/download-node.mjs                # 自动检测当前平台和架构
 *   node scripts/download-node.mjs arm64          # 指定 arm64
 *   node scripts/download-node.mjs x64            # 指定 x64
 *   PLATFORM=win32 node scripts/download-node.mjs # 跨平台测试（强制 Windows URL）
 *
 * 输出:
 *   - macOS / Linux: apps/desktop/src-tauri/node-bin/node
 *   - Windows:       apps/desktop/src-tauri/node-bin/node.exe
 *
 * M14 PR-A2: 三平台跨平台下载。
 *   - darwin / linux: .tar.gz → tar xz
 *   - windows:        .zip    → PowerShell Expand-Archive
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, chmodSync, unlinkSync, renameSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getPlatform,
  getArch,
  getBinExt,
  nodePlatformName,
  nodeArchiveExt,
} from './lib/platform.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Node.js 版本 — 与项目要求 >=22 保持一致
const NODE_VERSION = '22.15.0';

// 平台 + 架构
const platform = getPlatform();
const arch = getArch(process.argv[2]);
const nodePlatform = nodePlatformName(platform); // darwin / linux / win
const archiveExt = nodeArchiveExt(platform);     // tar.gz / zip
const binExt = getBinExt(platform);              // '' / '.exe'

const baseName = `node-v${NODE_VERSION}-${nodePlatform}-${arch}`;
const archiveName = `${baseName}.${archiveExt}`;
const url = `https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}`;

const outDir = join(ROOT, 'apps', 'desktop', 'src-tauri', 'node-bin');
const nodeBin = join(outDir, `node${binExt}`);

// 如果已存在且版本匹配，跳过
if (existsSync(nodeBin)) {
  try {
    const ver = execSync(`"${nodeBin}" -v`, { encoding: 'utf-8' }).trim();
    if (ver === `v${NODE_VERSION}`) {
      console.log(`✅ Node.js ${ver} (${nodePlatform}-${arch}) 已存在，跳过下载`);
      process.exit(0);
    }
    console.log(`⚠️  现有 node 版本 ${ver}，需要 v${NODE_VERSION}，重新下载`);
  } catch {
    console.log('⚠️  现有 node 无法执行，重新下载');
  }
}

console.log(`📦 下载 Node.js v${NODE_VERSION} (${nodePlatform}-${arch})...`);
console.log(`   ${url}`);

mkdirSync(outDir, { recursive: true });

const tmpDir = join(outDir, '_tmp');
mkdirSync(tmpDir, { recursive: true });

/** 跨平台执行 shell 命令 */
function run(cmd) {
  execSync(cmd, { stdio: 'inherit', shell: true });
}

/** 跨平台递归删除目录 */
function rmrf(dir) {
  if (platform === 'win32') {
    run(`rmdir /s /q "${dir}"`);
  } else {
    run(`rm -rf "${dir}"`);
  }
}

try {
  if (platform === 'win32') {
    // Windows: 下载 .zip → Expand-Archive
    const zipFile = join(tmpDir, archiveName);
    run(`powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${zipFile}'"`);
    run(`powershell -Command "Expand-Archive -Path '${zipFile}' -DestinationPath '${tmpDir}' -Force"`);

    // Windows zip 解压后结构: {baseName}/node.exe（顶层 bin）
    const srcNode = join(tmpDir, baseName, 'node.exe');
    if (!existsSync(srcNode)) {
      console.error(`❌ 解压后未找到 ${baseName}/node.exe`);
      process.exit(1);
    }
    if (existsSync(nodeBin)) unlinkSync(nodeBin);
    renameSync(srcNode, nodeBin);
  } else {
    // macOS / Linux: 下载 .tar.gz → tar xz --strip-components=1
    run(`curl -fsSL "${url}" | tar xz -C "${tmpDir}" --strip-components=1`);

    // tar.gz 结构: bin/node + lib/... 等，--strip-components=1 把 baseName 剥掉
    const srcNode = join(tmpDir, 'bin', 'node');
    if (!existsSync(srcNode)) {
      console.error('❌ 解压后未找到 bin/node');
      process.exit(1);
    }
    if (existsSync(nodeBin)) unlinkSync(nodeBin);
    renameSync(srcNode, nodeBin);
    chmodSync(nodeBin, 0o755);
  }

  // 清理临时文件
  rmrf(tmpDir);

  // 验证
  const ver = execSync(`"${nodeBin}" -v`, { encoding: 'utf-8' }).trim();
  console.log(`✅ Node.js ${ver} (${nodePlatform}-${arch}) 已下载到 ${nodeBin}`);

  // 显示大小
  const size = (statSync(nodeBin).size / 1024 / 1024).toFixed(1);
  console.log(`📏 大小: ${size} MB`);
} catch (err) {
  console.error('❌ 下载失败:', err instanceof Error ? err.message : err);
  try {
    rmrf(tmpDir);
  } catch {
    /* ignore */
  }
  process.exit(1);
}
