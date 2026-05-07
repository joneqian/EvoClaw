/**
 * Skill Curator Lifecycle — 跨 session 的 skill 生命周期 sidecar
 *
 * 灵感来自 Hermes `~/.hermes/skills/.usage.json`：
 *   - 一个独立的 JSON 文件存 per-skill 生命周期状态（state / pinned / archivedAt）
 *   - 不动现有 manifest（保持向后兼容）
 *   - lastActivityAt 通过 skill_usage 表 MAX(invoked_at) 查询，不冗余存
 *
 * 文件位置：`~/.evoclaw/skills/.curator_lifecycle.json`
 *
 * 状态机：
 *   active → stale (30d 未用) → archived (90d 未用)
 *   reactivation: stale → active 当 lastActivityAt 重新进入 30d 内
 *
 * 仅 source='agent-created' 的 skill 进 curator 管辖（manifest source 字段判定，
 * 本文件不重复存 source — 调用方应先用 manifest 过滤）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_DATA_DIR } from '@evoclaw/shared';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('skill-curator-lifecycle');

/** Skill 生命周期状态 */
export type SkillLifecycleState = 'active' | 'stale' | 'archived';

/** 单 skill 生命周期记录 */
export interface SkillLifecycleEntry {
  /** Skill 名 */
  name: string;
  /** 当前状态 */
  state: SkillLifecycleState;
  /** 归档时间（ISO 8601）；非 archived 状态为 null */
  archivedAt: string | null;
  /** 是否 pinned（pinned 跳过自动转换 + archive；patch / edit 仍可走） */
  pinned: boolean;
  /** 最后修改 lifecycle 状态的时间（审计用） */
  updatedAt: string;
}

/** 完整 lifecycle 文件结构（向前兼容用 version 字段） */
interface LifecycleFile {
  version: 1;
  entries: Record<string, Omit<SkillLifecycleEntry, 'name'>>;
}

const FILENAME = '.curator_lifecycle.json';

/** 数据目录默认 */
function defaultLifecycleDir(): string {
  return path.join(os.homedir(), DEFAULT_DATA_DIR, 'skills');
}

function lifecyclePath(skillsBaseDir?: string): string {
  return path.join(skillsBaseDir ?? defaultLifecycleDir(), FILENAME);
}

/**
 * 读取 lifecycle 文件。文件不存在或解析失败均返回空 Map（不抛异常）。
 *
 * 不存在文件 = 全部 skill 默认 active 状态（lazy 初始化）
 */
export function readLifecycle(skillsBaseDir?: string): Map<string, SkillLifecycleEntry> {
  const result = new Map<string, SkillLifecycleEntry>();
  const filePath = lifecyclePath(skillsBaseDir);

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return result;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn(`lifecycle 文件解析失败（已忽略，从空开始）: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  // version 检查（未来 schema 升级用）
  const file = parsed as { version?: number; entries?: Record<string, unknown> };
  if (file.version !== 1 || !file.entries || typeof file.entries !== 'object') {
    log.warn(`lifecycle 文件 version=${file.version}，期望 1；返回空 Map`);
    return result;
  }

  for (const [name, raw] of Object.entries(file.entries)) {
    const e = raw as Partial<SkillLifecycleEntry>;
    if (!e.state || !isValidState(e.state)) continue;
    result.set(name, {
      name,
      state: e.state,
      archivedAt: e.archivedAt ?? null,
      pinned: Boolean(e.pinned),
      updatedAt: e.updatedAt ?? new Date().toISOString(),
    });
  }
  return result;
}

/** 原子写入 lifecycle 文件 */
export function writeLifecycle(entries: Map<string, SkillLifecycleEntry>, skillsBaseDir?: string): void {
  const filePath = lifecyclePath(skillsBaseDir);
  const dir = path.dirname(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // 目录创建失败让 writeFile 抛
  }

  const file: LifecycleFile = {
    version: 1,
    entries: {},
  };
  for (const [name, e] of entries.entries()) {
    file.entries[name] = {
      state: e.state,
      archivedAt: e.archivedAt,
      pinned: e.pinned,
      updatedAt: e.updatedAt,
    };
  }

  // 原子写：tmp → rename
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    log.warn(`lifecycle 文件写入失败: ${err instanceof Error ? err.message : String(err)}`);
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

/** 取单 skill 的 lifecycle entry；不存在返回默认 active */
export function getEntry(name: string, skillsBaseDir?: string): SkillLifecycleEntry {
  const entries = readLifecycle(skillsBaseDir);
  return entries.get(name) ?? defaultEntry(name);
}

/** 设置 skill 状态（不存在则创建） */
export function setState(
  name: string,
  state: SkillLifecycleState,
  skillsBaseDir?: string,
): SkillLifecycleEntry {
  const entries = readLifecycle(skillsBaseDir);
  const prev = entries.get(name) ?? defaultEntry(name);
  const now = new Date().toISOString();
  const next: SkillLifecycleEntry = {
    ...prev,
    state,
    // 进入 archived 时记录时间；离开 archived 时清空
    archivedAt: state === 'archived' ? (prev.archivedAt ?? now) : null,
    updatedAt: now,
  };
  entries.set(name, next);
  writeLifecycle(entries, skillsBaseDir);
  return next;
}

/** 设置 pinned 标记（不影响 state） */
export function setPinned(
  name: string,
  pinned: boolean,
  skillsBaseDir?: string,
): SkillLifecycleEntry {
  const entries = readLifecycle(skillsBaseDir);
  const prev = entries.get(name) ?? defaultEntry(name);
  const next: SkillLifecycleEntry = {
    ...prev,
    pinned,
    updatedAt: new Date().toISOString(),
  };
  entries.set(name, next);
  writeLifecycle(entries, skillsBaseDir);
  return next;
}

/** 删除 lifecycle 记录（restore 完整后调用） */
export function deleteEntry(name: string, skillsBaseDir?: string): boolean {
  const entries = readLifecycle(skillsBaseDir);
  const had = entries.delete(name);
  if (had) writeLifecycle(entries, skillsBaseDir);
  return had;
}

/** 默认 entry（active / 未 archived / 未 pinned） */
function defaultEntry(name: string): SkillLifecycleEntry {
  const now = new Date().toISOString();
  return {
    name,
    state: 'active',
    archivedAt: null,
    pinned: false,
    updatedAt: now,
  };
}

function isValidState(s: unknown): s is SkillLifecycleState {
  return s === 'active' || s === 'stale' || s === 'archived';
}

/**
 * 物理归档：把 skill 目录移到 .archive/ 子目录。
 *
 * 流程：
 *   1. 检查 source 是否 agent-created（调用方负责，本函数不验证）
 *   2. 检查 pinned（跳过）
 *   3. mv `<dir>/<name>` → `<dir>/.archive/<name>` （冲突时加时间戳）
 *   4. 更新 lifecycle 记录为 archived
 *
 * 返回：{ ok: boolean, archivedPath?: string, message: string }
 */
export function archiveSkill(
  name: string,
  skillsBaseDir?: string,
): { ok: boolean; archivedPath?: string; message: string } {
  const baseDir = skillsBaseDir ?? defaultLifecycleDir();
  const entry = getEntry(name, baseDir);
  if (entry.pinned) {
    return { ok: false, message: `skill '${name}' is pinned; refuse to archive` };
  }

  const skillDir = path.join(baseDir, name);
  if (!fs.existsSync(skillDir)) {
    return { ok: false, message: `skill '${name}' directory not found at ${skillDir}` };
  }

  const archiveRoot = path.join(baseDir, '.archive');
  try {
    fs.mkdirSync(archiveRoot, { recursive: true });
  } catch (err) {
    return { ok: false, message: `failed to create archive dir: ${err instanceof Error ? err.message : String(err)}` };
  }

  let dest = path.join(archiveRoot, name);
  if (fs.existsSync(dest)) {
    // 冲突：加纯数字时间戳后缀（YYYYMMDDhhmmss，14 位）
    const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    dest = path.join(archiveRoot, `${name}-${ts}`);
  }

  try {
    fs.renameSync(skillDir, dest);
  } catch (err) {
    return { ok: false, message: `failed to move ${skillDir} → ${dest}: ${err instanceof Error ? err.message : String(err)}` };
  }

  setState(name, 'archived', baseDir);
  log.info(`[archive] ${name} → ${dest}`);
  return { ok: true, archivedPath: dest, message: `archived to ${dest}` };
}

/**
 * 从 .archive/ 恢复 skill。
 *
 * 流程：
 *   1. 找 .archive/<name>（精确匹配优先；找不到再前缀匹配 timestamped 副本最新一份）
 *   2. mv 回 `<dir>/<name>`（如果当前已有同名目录则失败避免 shadow）
 *   3. 更新 lifecycle 记录为 active + 清 archivedAt
 */
export function restoreSkill(
  name: string,
  skillsBaseDir?: string,
): { ok: boolean; restoredPath?: string; message: string } {
  const baseDir = skillsBaseDir ?? defaultLifecycleDir();
  const archiveRoot = path.join(baseDir, '.archive');
  const skillDir = path.join(baseDir, name);

  if (fs.existsSync(skillDir)) {
    return { ok: false, message: `skill '${name}' already exists at ${skillDir}; refuse to overwrite` };
  }

  // 1. 精确匹配
  let src = path.join(archiveRoot, name);
  if (!fs.existsSync(src)) {
    // 2. 前缀匹配最新的 timestamped 副本
    if (!fs.existsSync(archiveRoot)) {
      return { ok: false, message: `archive dir not found: ${archiveRoot}` };
    }
    const candidates = fs.readdirSync(archiveRoot)
      .filter(f => f === name || f.startsWith(`${name}-`))
      .sort()
      .reverse();
    if (candidates.length === 0) {
      return { ok: false, message: `no archived skill found for '${name}'` };
    }
    src = path.join(archiveRoot, candidates[0]!);
  }

  try {
    fs.renameSync(src, skillDir);
  } catch (err) {
    return { ok: false, message: `failed to restore ${src} → ${skillDir}: ${err instanceof Error ? err.message : String(err)}` };
  }

  // 重置 lifecycle：清 archivedAt，状态 → active
  setState(name, 'active', baseDir);
  log.info(`[restore] ${src} → ${skillDir}`);
  return { ok: true, restoredPath: skillDir, message: `restored from ${src}` };
}

/** 列出所有 lifecycle entries（管理工具用） */
export function listLifecycleEntries(skillsBaseDir?: string): SkillLifecycleEntry[] {
  const entries = readLifecycle(skillsBaseDir);
  return Array.from(entries.values());
}
