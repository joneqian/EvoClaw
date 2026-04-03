/**
 * 扩展包解析器 — 解压 ZIP 并校验 manifest
 *
 * 安全防护:
 * - 拒绝路径穿越（.. 和绝对路径）
 * - 限制总大小（50MB）和文件数（500）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createLogger } from '../infrastructure/logger.js';
import type { ExtensionPackManifest, ParsedExtensionPack } from '@evoclaw/shared';

const log = createLogger('pack-parser');

/** 解压后最大总大小（50MB） */
const MAX_UNZIP_SIZE = 50 * 1024 * 1024;
/** 最大文件数 */
const MAX_FILE_COUNT = 500;
/** Manifest 文件名 */
const MANIFEST_FILENAME = 'evoclaw-pack.json';

/**
 * 解析扩展包 ZIP
 *
 * @param zipPath ZIP 文件路径
 * @returns 解析结果（含临时目录，调用方需清理）
 */
export async function parseExtensionPack(zipPath: string): Promise<ParsedExtensionPack> {
  const errors: string[] = [];

  // 创建临时目录
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evoclaw-pack-'));

  try {
    // 使用 node:child_process 调用 unzip（避免引入 ZIP 库）
    const { execSync } = await import('node:child_process');
    execSync(`unzip -o -q "${zipPath}" -d "${tempDir}"`, { timeout: 30_000 });
  } catch (err) {
    errors.push(`ZIP 解压失败: ${err instanceof Error ? err.message : String(err)}`);
    return { manifest: emptyManifest(), tempDir, skillDirs: [], errors };
  }

  // 安全检查：总大小和文件数
  const { totalSize, fileCount } = measureDir(tempDir);
  if (totalSize > MAX_UNZIP_SIZE) {
    errors.push(`解压后总大小 ${(totalSize / 1024 / 1024).toFixed(1)}MB 超出 ${MAX_UNZIP_SIZE / 1024 / 1024}MB 限制`);
    return { manifest: emptyManifest(), tempDir, skillDirs: [], errors };
  }
  if (fileCount > MAX_FILE_COUNT) {
    errors.push(`文件数 ${fileCount} 超出 ${MAX_FILE_COUNT} 限制`);
    return { manifest: emptyManifest(), tempDir, skillDirs: [], errors };
  }

  // 读取 manifest
  const manifestPath = path.join(tempDir, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    errors.push(`缺少 ${MANIFEST_FILENAME} 文件`);
    return { manifest: emptyManifest(), tempDir, skillDirs: [], errors };
  }

  let manifest: ExtensionPackManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ExtensionPackManifest;
  } catch {
    errors.push(`${MANIFEST_FILENAME} 格式无效`);
    return { manifest: emptyManifest(), tempDir, skillDirs: [], errors };
  }

  // 校验必要字段
  if (manifest.manifestVersion !== 1) {
    errors.push(`不支持的 manifestVersion: ${manifest.manifestVersion}`);
  }
  if (!manifest.name?.trim()) errors.push('缺少 name 字段');
  if (!manifest.description?.trim()) errors.push('缺少 description 字段');
  if (!manifest.version?.trim()) errors.push('缺少 version 字段');

  // 校验 skills 目录存在
  const skillDirs: string[] = [];
  if (manifest.skills) {
    const skillsBase = path.join(tempDir, 'skills');
    for (const skillName of manifest.skills) {
      // 路径穿越检查
      if (skillName.includes('..') || path.isAbsolute(skillName)) {
        errors.push(`技能路径不安全: ${skillName}`);
        continue;
      }
      const skillDir = path.join(skillsBase, skillName);
      if (!fs.existsSync(skillDir)) {
        errors.push(`技能目录不存在: skills/${skillName}`);
      } else {
        skillDirs.push(skillDir);
      }
    }
  }

  if (errors.length > 0) {
    log.warn(`扩展包 "${manifest.name}" 解析有 ${errors.length} 个问题`);
  } else {
    log.info(`扩展包 "${manifest.name}" v${manifest.version} 解析成功: ${skillDirs.length} skills`);
  }

  return { manifest, tempDir, skillDirs, errors };
}

/** 空 manifest（解析失败时使用） */
function emptyManifest(): ExtensionPackManifest {
  return { manifestVersion: 1, name: '', description: '', version: '' };
}

/** 递归统计目录大小和文件数 */
function measureDir(dirPath: string): { totalSize: number; fileCount: number } {
  let totalSize = 0;
  let fileCount = 0;

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        totalSize += fs.statSync(full).size;
        fileCount++;
      }
    }
  }

  try { walk(dirPath); } catch { /* ignore */ }
  return { totalSize, fileCount };
}
