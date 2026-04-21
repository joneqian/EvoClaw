/**
 * Skill Manifest v2 — M7 Phase 1
 *
 * 追踪用户级 Skill 目录下每个 Skill 的 SHA-256 hash + 来源 + 创建时间。
 *
 * 用途：
 * - 识别用户手改的 bundled Skill（hash 不匹配）→ bundled 升级时跳过，保持用户版本
 * - 识别 Agent 通过 skill_manage 创建的 Skill（source='agent-created'）
 * - Evolution（Phase 3）改写 Skill 时更新 hash，手动回滚时用作前后对照
 *
 * 文件格式：`~/.evoclaw/skills/.bundled_manifest`
 * ```
 * # EvoClaw Skills Manifest v2
 * # <name>:<sha256>:<source>:<createdAt>
 * arxiv:a3f2b1c4...:bundled:2026-03-01T00:00:00Z
 * my-custom:9g9h0i1j...:agent-created:2026-04-21T08:15:00Z
 * ```
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type SkillManifestSource = 'bundled' | 'agent-created' | 'local' | 'clawhub' | 'github';

export interface SkillManifestEntry {
  name: string;
  sha256: string;
  source: SkillManifestSource;
  createdAt: string;   // ISO 8601
}

export const MANIFEST_FILENAME = '.bundled_manifest';
const HEADER_LINES = [
  '# EvoClaw Skills Manifest v2',
  '# <name>:<sha256>:<source>:<createdAt>',
];

/** 计算 SKILL.md 内容的 SHA-256 十六进制 hash */
export function computeSkillHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

function manifestPath(skillsBaseDir: string): string {
  return path.join(skillsBaseDir, MANIFEST_FILENAME);
}

/** 读取 manifest 文件。文件不存在或解析失败均返回空 Map（不抛异常） */
export function readManifest(skillsBaseDir: string): Map<string, SkillManifestEntry> {
  const result = new Map<string, SkillManifestEntry>();
  const file = manifestPath(skillsBaseDir);

  let content: string;
  try {
    content = fs.readFileSync(file, 'utf-8');
  } catch {
    return result;
  }

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(':');
    if (parts.length < 4) continue;
    // source 固定在第 3 段，createdAt 是 ISO（含 ':'），因此合并剩余部分
    const [name, sha256, source, ...rest] = parts;
    const createdAt = rest.join(':');
    if (!name || !sha256 || !source || !createdAt) continue;
    if (!isValidSource(source)) continue;
    result.set(name, {
      name,
      sha256,
      source,
      createdAt,
    });
  }

  return result;
}

function isValidSource(v: string): v is SkillManifestSource {
  return v === 'bundled' || v === 'agent-created' || v === 'local' || v === 'clawhub' || v === 'github';
}

/**
 * 原子写 manifest（tmp + rename）。
 * 失败时抛出原始错误，调用方可回退。
 */
export function writeManifest(
  skillsBaseDir: string,
  entries: Map<string, SkillManifestEntry> | Iterable<SkillManifestEntry>,
): void {
  fs.mkdirSync(skillsBaseDir, { recursive: true });

  const items = entries instanceof Map ? Array.from(entries.values()) : Array.from(entries);
  // 按 name 排序，保证输出稳定（便于 diff 审计）
  items.sort((a, b) => a.name.localeCompare(b.name));

  const lines = [...HEADER_LINES];
  for (const e of items) {
    lines.push(`${e.name}:${e.sha256}:${e.source}:${e.createdAt}`);
  }
  const body = lines.join('\n') + '\n';

  const target = manifestPath(skillsBaseDir);
  const tmp = `${target}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(tmp, body, 'utf-8');
    fs.renameSync(tmp, target);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* 忽略清理失败 */ }
    throw err;
  }
}

/** 向 manifest 写入/更新单条记录 */
export function upsertManifestEntry(
  skillsBaseDir: string,
  entry: SkillManifestEntry,
): void {
  const current = readManifest(skillsBaseDir);
  current.set(entry.name, entry);
  writeManifest(skillsBaseDir, current);
}

/** 从 manifest 删除单条记录（不存在时静默） */
export function removeManifestEntry(skillsBaseDir: string, name: string): void {
  const current = readManifest(skillsBaseDir);
  if (!current.has(name)) return;
  current.delete(name);
  writeManifest(skillsBaseDir, current);
}

// ═══════════════════════════════════════════════════════════════════════════
// Bundled Sync State Machine
// ═══════════════════════════════════════════════════════════════════════════

export interface SyncAction {
  name: string;
  action: 'copied' | 'updated' | 'skipped-user-modified' | 'deleted' | 'kept';
  reason?: string;
}

export interface SyncResult {
  actions: SyncAction[];
}

/**
 * 读取目录下所有 Skill 的 SKILL.md 内容，返回 Map<name, content>。
 * Skill 目录结构：<baseDir>/<skill-name>/SKILL.md
 */
function listSkillsInDir(baseDir: string): Map<string, { content: string; filePath: string }> {
  const result = new Map<string, { content: string; filePath: string }>();
  if (!fs.existsSync(baseDir)) return result;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    const skillMd = path.join(baseDir, entry.name, 'SKILL.md');
    try {
      const content = fs.readFileSync(skillMd, 'utf-8');
      result.set(entry.name, { content, filePath: skillMd });
    } catch {
      // Skill 目录存在但缺 SKILL.md，跳过
    }
  }
  return result;
}

/**
 * 同步 bundled Skills 到用户目录。
 *
 * 状态机（对每个 bundled skill）：
 * - NEW（manifest 无记录）→ 复制到用户目录 + 记 hash（action='copied'）
 * - EXISTING + hash 匹配（用户未改）→ 安全升级到新 bundled 内容 + 更新 hash（action='updated'）
 * - EXISTING + hash 不匹配（用户改过）→ 保留用户版本（action='skipped-user-modified'）
 *
 * 对每个 manifest 中的 bundled 条目但 bundled 目录已不存在：
 * - 如果用户版本 hash 匹配 manifest（未改）→ 删除用户副本 + 从 manifest 移除（action='deleted'）
 * - 如果用户已改过 → 保留（action='kept'），降级为 source='local' 防误删
 *
 * 非 bundled 来源（agent-created/local/clawhub/github）一律不动。
 */
export function syncBundledSkills(opts: {
  bundledDir: string;
  userSkillsDir: string;
  now?: () => Date;
}): SyncResult {
  const { bundledDir, userSkillsDir } = opts;
  const now = opts.now ?? (() => new Date());

  fs.mkdirSync(userSkillsDir, { recursive: true });

  const manifest = readManifest(userSkillsDir);
  const bundledSkills = listSkillsInDir(bundledDir);
  const userSkills = listSkillsInDir(userSkillsDir);
  const actions: SyncAction[] = [];

  // 1. 遍历 bundled：NEW / EXISTING 分支
  for (const [name, bundled] of bundledSkills) {
    const manifestEntry = manifest.get(name);
    const userEntry = userSkills.get(name);
    const bundledHash = computeSkillHash(bundled.content);

    if (!userEntry) {
      // 用户目录没这个 skill → 复制
      copySkillDir(path.dirname(bundled.filePath), path.join(userSkillsDir, name));
      manifest.set(name, {
        name,
        sha256: bundledHash,
        source: 'bundled',
        createdAt: now().toISOString(),
      });
      actions.push({ name, action: 'copied' });
      continue;
    }

    const userHash = computeSkillHash(userEntry.content);

    if (manifestEntry && manifestEntry.sha256 === userHash) {
      // 用户未改 → 安全升级
      if (userHash !== bundledHash) {
        copySkillDir(path.dirname(bundled.filePath), path.join(userSkillsDir, name));
        manifest.set(name, {
          name,
          sha256: bundledHash,
          source: 'bundled',
          createdAt: manifestEntry.createdAt,
        });
        actions.push({ name, action: 'updated' });
      } else {
        actions.push({ name, action: 'kept', reason: 'already up-to-date' });
      }
    } else {
      // 用户改过 / 无 manifest 记录（历史遗留）→ 保留用户版本
      actions.push({ name, action: 'skipped-user-modified' });
    }
  }

  // 2. 遍历 manifest 中标记为 bundled 但 bundledDir 已不存在的条目
  for (const [name, entry] of manifest) {
    if (entry.source !== 'bundled') continue;
    if (bundledSkills.has(name)) continue;

    const userEntry = userSkills.get(name);
    if (!userEntry) {
      // 用户目录也没有 → 仅清理 manifest
      manifest.delete(name);
      actions.push({ name, action: 'deleted', reason: 'no user copy, no bundled source' });
      continue;
    }

    const userHash = computeSkillHash(userEntry.content);
    if (userHash === entry.sha256) {
      // 未改 → 删除用户副本 + 清 manifest
      removeSkillDir(path.join(userSkillsDir, name));
      manifest.delete(name);
      actions.push({ name, action: 'deleted', reason: 'bundled source removed' });
    } else {
      // 用户改过 → 保留，source 降级为 local
      manifest.set(name, {
        name,
        sha256: userHash,
        source: 'local',
        createdAt: entry.createdAt,
      });
      actions.push({ name, action: 'kept', reason: 'bundled removed, user modified version kept as local' });
    }
  }

  writeManifest(userSkillsDir, manifest);
  return { actions };
}

/** 递归复制 Skill 目录（覆盖） */
function copySkillDir(srcDir: string, destDir: string): void {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  copyDirRecursive(srcDir, destDir);
}

function copyDirRecursive(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyDirRecursive(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function removeSkillDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
