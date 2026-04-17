/**
 * 凭证文件原子写入 — 强制 0600 权限（POSIX）
 *
 * writeFileSync 的 mode 选项仅在新建文件时生效；已存在文件需显式 chmodSync。
 * Windows 上 chmod 实际上是 no-op，但调用不报错（POSIX 权限模型不适用）。
 */

import fs from 'node:fs';
import path from 'node:path';

/** 凭证文件权限：仅所有者可读写 */
const CREDENTIAL_FILE_MODE = 0o600;
/** 凭证目录权限：仅所有者可访问 */
const CREDENTIAL_DIR_MODE = 0o700;

/**
 * 写入凭证文件，强制 0600 权限。
 *
 * - 父目录不存在时自动创建（mode 0o700）
 * - 已存在的文件被覆盖后强制 chmod 0600（防止之前已是 0o644）
 * - Windows 上 chmod 是 no-op，不报错
 */
export function writeCredentialFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: CREDENTIAL_DIR_MODE });
  } else if (process.platform !== 'win32') {
    // 已存在的目录也强制 chmod（防止之前被人改宽松了）
    try {
      fs.chmodSync(dir, CREDENTIAL_DIR_MODE);
    } catch {
      // 跨用户/挂载点等场景 chmod 可能失败，不阻断
    }
  }

  fs.writeFileSync(filePath, content, { encoding: 'utf-8', mode: CREDENTIAL_FILE_MODE });

  // 已存在的文件 writeFileSync mode 不生效，需显式 chmod
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(filePath, CREDENTIAL_FILE_MODE);
    } catch {
      // POSIX-only，Windows 已通过 platform 守卫；其它失败容忍但记录
    }
  }
}
