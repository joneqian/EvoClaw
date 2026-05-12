#!/usr/bin/env node
/**
 * download-bun.mjs — 下载 Bun 预编译二进制，用于内嵌到 Tauri app
 *
 * 用法:
 *   node scripts/download-bun.mjs                # 自动检测当前平台和架构
 *   node scripts/download-bun.mjs aarch64        # 指定 arm64
 *   node scripts/download-bun.mjs x64            # 指定 x64
 *   PLATFORM=win32 node scripts/download-bun.mjs # 跨平台测试（强制 Windows URL）
 *
 * 输出:
 *   - macOS / Linux: apps/desktop/src-tauri/bun-bin/bun
 *   - Windows:       apps/desktop/src-tauri/bun-bin/bun.exe
 *
 * M14 PR-A2: 三平台跨平台下载（darwin / linux / windows × arm64 / x64）。
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, chmodSync, unlinkSync, renameSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getPlatform,
  getArch,
  getBinExt,
  bunPlatformName,
  bunArchName,
} from './lib/platform.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Bun 版本
const BUN_VERSION = '1.3.6';

// 平台 + 架构
const platform = getPlatform();
const arch = getArch(process.argv[2]);
const bunPlatform = bunPlatformName(platform);
const bunArch = bunArchName(platform, arch);
const binExt = getBinExt(platform);

const zipName = `bun-${bunPlatform}-${bunArch}`;
const url = `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${zipName}.zip`;

const outDir = join(ROOT, 'apps', 'desktop', 'src-tauri', 'bun-bin');
const bunBin = join(outDir, `bun${binExt}`);

// 如果已存在且版本匹配，跳过
if (existsSync(bunBin)) {
  try {
    const ver = execSync(`"${bunBin}" --version`, { encoding: 'utf-8' }).trim();
    if (ver === BUN_VERSION) {
      console.log(`✅ Bun ${ver} (${bunPlatform}-${bunArch}) 已存在，跳过下载`);
      process.exit(0);
    }
    console.log(`⚠️  现有 bun 版本 ${ver}，需要 ${BUN_VERSION}，重新下载`);
  } catch {
    console.log('⚠️  现有 bun 无法执行，重新下载');
  }
}

console.log(`📦 下载 Bun v${BUN_VERSION} (${bunPlatform}-${bunArch})...`);
console.log(`   ${url}`);

mkdirSync(outDir, { recursive: true });

const tmpDir = join(outDir, '_tmp');
mkdirSync(tmpDir, { recursive: true });

/** 跨平台执行 shell 命令（Windows 用 cmd.exe，Unix 用 sh） */
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
  // 下载 zip
  const zipFile = join(tmpDir, 'bun.zip');
  if (platform === 'win32') {
    // Windows: 用 PowerShell Invoke-WebRequest 下载（curl 不一定有）
    run(`powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${zipFile}'"`);
  } else {
    run(`curl -fsSL -o "${zipFile}" "${url}"`);
  }

  // 解压 zip
  if (platform === 'win32') {
    run(`powershell -Command "Expand-Archive -Path '${zipFile}' -DestinationPath '${tmpDir}' -Force"`);
  } else {
    run(`unzip -o -q "${zipFile}" -d "${tmpDir}"`);
  }

  // Bun zip 解压后结构: bun-{platform}-{arch}/bun(.exe)
  const srcBun = join(tmpDir, zipName, `bun${binExt}`);
  if (!existsSync(srcBun)) {
    console.error(`❌ 解压后未找到 ${zipName}/bun${binExt}`);
    process.exit(1);
  }

  // 移动到目标位置
  if (existsSync(bunBin)) unlinkSync(bunBin);
  renameSync(srcBun, bunBin);
  if (platform !== 'win32') {
    chmodSync(bunBin, 0o755);
  }

  // 清理临时文件
  rmrf(tmpDir);

  // 验证
  const ver = execSync(`"${bunBin}" --version`, { encoding: 'utf-8' }).trim();
  console.log(`✅ Bun ${ver} (${bunPlatform}-${bunArch}) 已下载到 ${bunBin}`);

  // 显示大小
  const size = (statSync(bunBin).size / 1024 / 1024).toFixed(1);
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
