/**
 * 扩展包注册表 — 记录已安装的扩展包元信息
 *
 * 存储在 ~/.evoclaw/extension-packs.json
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DEFAULT_DATA_DIR } from '@evoclaw/shared';
import type { InstalledExtensionPack } from '@evoclaw/shared';

/** 注册表文件路径 */
const REGISTRY_PATH = path.join(os.homedir(), DEFAULT_DATA_DIR, 'extension-packs.json');

/** 注册已安装的扩展包 */
export function registerInstalledPack(pack: InstalledExtensionPack): void {
  const packs = listInstalledPacks();
  // 去重（同名替换）
  const filtered = packs.filter(p => p.name !== pack.name || p.agentId !== pack.agentId);
  filtered.push(pack);
  saveRegistry(filtered);
}

/** 注销扩展包 */
export function unregisterPack(name: string, agentId?: string): boolean {
  const packs = listInstalledPacks();
  const filtered = packs.filter(p => !(p.name === name && p.agentId === agentId));
  if (filtered.length === packs.length) return false;
  saveRegistry(filtered);
  return true;
}

/** 列出已安装的扩展包 */
export function listInstalledPacks(): InstalledExtensionPack[] {
  try {
    if (fs.existsSync(REGISTRY_PATH)) {
      return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8')) as InstalledExtensionPack[];
    }
  } catch { /* ignore */ }
  return [];
}

/** 保存注册表到磁盘 */
function saveRegistry(packs: InstalledExtensionPack[]): void {
  const dir = path.dirname(REGISTRY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(packs, null, 2), 'utf-8');
}
