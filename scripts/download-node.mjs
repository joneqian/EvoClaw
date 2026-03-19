#!/usr/bin/env node
/**
 * download-node.mjs — 下载 Node.js 预编译二进制，用于内嵌到 Tauri app
 *
 * 用法:
 *   node scripts/download-node.mjs                # 自动检测当前架构
 *   node scripts/download-node.mjs arm64          # 指定架构
 *   node scripts/download-node.mjs x64            # Intel
 *
 * 输出: apps/desktop/src-tauri/node-bin/node
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, chmodSync, unlinkSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Node.js 版本 — 与项目要求的 >=22 保持一致
const NODE_VERSION = '22.15.0';

// 架构
const archArg = process.argv[2];
const platform = 'darwin';
const arch = archArg === 'x64' ? 'x64' : archArg === 'arm64' ? 'arm64' : process.arch;

const tarName = `node-v${NODE_VERSION}-${platform}-${arch}`;
const url = `https://nodejs.org/dist/v${NODE_VERSION}/${tarName}.tar.gz`;

const outDir = join(ROOT, 'apps', 'desktop', 'src-tauri', 'node-bin');
const nodeBin = join(outDir, 'node');

// 如果已存在且版本匹配，跳过
if (existsSync(nodeBin)) {
  try {
    const ver = execSync(`"${nodeBin}" -v`, { encoding: 'utf-8' }).trim();
    if (ver === `v${NODE_VERSION}`) {
      console.log(`✅ Node.js ${ver} (${arch}) 已存在，跳过下载`);
      process.exit(0);
    }
    console.log(`⚠️  现有 node 版本 ${ver}，需要 v${NODE_VERSION}，重新下载`);
  } catch {
    console.log('⚠️  现有 node 无法执行，重新下载');
  }
}

console.log(`📦 下载 Node.js v${NODE_VERSION} (${platform}-${arch})...`);
console.log(`   ${url}`);

mkdirSync(outDir, { recursive: true });

const tmpDir = join(outDir, '_tmp');
mkdirSync(tmpDir, { recursive: true });

try {
  // 下载并解压
  execSync(`curl -fsSL "${url}" | tar xz -C "${tmpDir}" --strip-components=1`, {
    stdio: 'inherit',
  });

  // 只需要 node 可执行文件
  const srcNode = join(tmpDir, 'bin', 'node');
  if (!existsSync(srcNode)) {
    console.error('❌ 解压后未找到 bin/node');
    process.exit(1);
  }

  // 移动到目标位置
  if (existsSync(nodeBin)) unlinkSync(nodeBin);
  renameSync(srcNode, nodeBin);
  chmodSync(nodeBin, 0o755);

  // 清理临时文件
  execSync(`rm -rf "${tmpDir}"`);

  // 验证
  const ver = execSync(`"${nodeBin}" -v`, { encoding: 'utf-8' }).trim();
  console.log(`✅ Node.js ${ver} (${arch}) 已下载到 ${nodeBin}`);

  // 显示大小
  const { statSync } = await import('node:fs');
  const size = (statSync(nodeBin).size / 1024 / 1024).toFixed(1);
  console.log(`📏 大小: ${size} MB`);
} catch (err) {
  console.error('❌ 下载失败:', err instanceof Error ? err.message : err);
  execSync(`rm -rf "${tmpDir}"`);
  process.exit(1);
}
