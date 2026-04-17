/**
 * M5 T3: Skill 安装 sidecar manifest
 *
 * 在已安装 skill 目录内写入 `.evoclaw-install.json`，记录：
 * - 来源（目前仅 clawhub 会写）
 * - slug（ClawHub 上的唯一标识）
 * - 安装时的版本号（供"有新版可用"比对）
 * - 安装时间戳
 *
 * bundled / local / github 不写 manifest：
 * - bundled 来自代码仓库，版本与 EvoClaw 主版本同步
 * - local 由用户自管
 * - github 目前不做版本比对（rate limit / 未登录 API 风险，见未排期 A2）
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SkillSource } from '@evoclaw/shared';

const MANIFEST_FILENAME = '.evoclaw-install.json';

/** Manifest 结构 */
export interface InstallManifest {
  source: SkillSource;
  slug: string;
  installedVersion?: string;
  installedAt: string;
  /** 保留扩展字段（例如未来加 checksum） */
  [key: string]: unknown;
}

/** 写入 manifest 到已安装 skill 目录 */
export function writeManifest(skillDir: string, data: InstallManifest): void {
  const filePath = path.join(skillDir, MANIFEST_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/** 读取 manifest；不存在 / 不合法时返回 null */
export function readManifest(skillDir: string): InstallManifest | null {
  const filePath = path.join(skillDir, MANIFEST_FILENAME);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.source !== 'string' || typeof obj.slug !== 'string') return null;
    return {
      source: obj.source as SkillSource,
      slug: obj.slug,
      installedVersion: typeof obj.installedVersion === 'string' ? obj.installedVersion : undefined,
      installedAt: typeof obj.installedAt === 'string' ? obj.installedAt : '',
      ...obj,
    };
  } catch {
    return null;
  }
}

/**
 * 扫描目录下所有子目录的 manifest，仅返回指定 source 的记录。
 *
 * @param roots 要扫描的根目录（含用户级 / 多个 agent 级）
 * @param source 过滤的来源
 */
export function listManifestsBySource(roots: string[], source: SkillSource): Array<{
  skillName: string;
  skillDir: string;
  manifest: InstallManifest;
}> {
  const results: Array<{ skillName: string; skillDir: string; manifest: InstallManifest }> = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(root, entry.name);
      const manifest = readManifest(skillDir);
      if (manifest && manifest.source === source) {
        results.push({ skillName: entry.name, skillDir, manifest });
      }
    }
  }
  return results;
}
