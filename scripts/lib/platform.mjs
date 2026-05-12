/**
 * platform.mjs — 跨平台检测与命名映射
 *
 * 给 download-bun.mjs / download-node.mjs 等下载脚本共用。
 * 集中处理 Bun / Node release 的平台 + 架构命名差异：
 *   - Bun:  bun-{darwin|linux|windows}-{aarch64|x64-baseline}.zip
 *   - Node: node-vX.Y.Z-{darwin|linux|win}-{arm64|x64}.{tar.gz|zip}
 *
 * 入参约定：
 *   - getPlatform()/getArch() 默认读 process.platform / process.arch
 *   - 上层脚本可通过 PLATFORM / ARCH 环境变量覆盖（CI / 跨平台测试时用）
 */

/** 当前平台：'darwin' | 'linux' | 'win32' */
export function getPlatform() {
  const override = process.env.PLATFORM;
  if (override) {
    if (!['darwin', 'linux', 'win32'].includes(override)) {
      throw new Error(`PLATFORM 环境变量值非法: ${override}`);
    }
    return override;
  }
  switch (process.platform) {
    case 'darwin':
    case 'linux':
    case 'win32':
      return process.platform;
    default:
      throw new Error(`不支持的平台: ${process.platform}`);
  }
}

/** Node 风格架构：'arm64' | 'x64'（接受 'aarch64' 别名） */
export function getArch(override) {
  const raw = override || process.env.ARCH || process.arch;
  switch (raw) {
    case 'arm64':
    case 'aarch64':
      return 'arm64';
    case 'x64':
    case 'x86_64':
      return 'x64';
    default:
      throw new Error(`不支持的架构: ${raw}`);
  }
}

/** 可执行文件后缀（Windows 为 .exe，其他为空字符串） */
export function getBinExt(platform = getPlatform()) {
  return platform === 'win32' ? '.exe' : '';
}

// ─── Bun 命名映射 ──────────────────────────────────

/**
 * Bun release 包平台名 — github.com/oven-sh/bun release 资产命名
 *   process.platform === 'win32' → Bun 包名用 'windows'
 */
export function bunPlatformName(platform = getPlatform()) {
  return platform === 'win32' ? 'windows' : platform;
}

/**
 * Bun release 包架构名
 *   arm64 → 'aarch64'
 *   x64   → 'x64-baseline'（兼容性最广，旧 CPU 也能跑）
 *
 * 注意：Bun 1.3.x Windows 仅发行 x64，无 arm64 binary
 */
export function bunArchName(platform, arch) {
  if (arch === 'arm64') {
    if (platform === 'win32') {
      throw new Error('Bun Windows arm64 当前未发行（仅 x64-baseline 可用）');
    }
    return 'aarch64';
  }
  if (arch === 'x64') {
    return 'x64-baseline';
  }
  throw new Error(`不支持的 Bun 架构: ${arch}`);
}

// ─── Node 命名映射 ─────────────────────────────────

/**
 * Node release 平台名 — nodejs.org/dist 资产命名
 *   process.platform === 'win32' → Node 包名用 'win'
 */
export function nodePlatformName(platform = getPlatform()) {
  return platform === 'win32' ? 'win' : platform;
}

/**
 * Node release 压缩包扩展名
 *   win 用 .zip，其他用 .tar.gz
 */
export function nodeArchiveExt(platform = getPlatform()) {
  return platform === 'win32' ? 'zip' : 'tar.gz';
}
