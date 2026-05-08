/**
 * Skill A-B 内容缓存 — M7-Tier3 PR-T3-1a
 *
 * A-B 测试期内同一 skill 名要能加载新旧两个版本。当前 SKILL.md 磁盘版本是 B
 * （已被 evolver refine 写入），A 版本（previous_content）需要物化到 cache 才能
 * 被 invoke_skill 加载。
 *
 * 文件位置：`<userSkillsDir>/.ab-cache/<skillName>-<hash>.md`
 *
 * 生命周期：
 *   - A-B 启动时：物化 A 版本（previous_content）到 cache
 *   - A-B 期内：variant=A 时从 cache 读，variant=B 时从正常路径读
 *   - A-B 结束（promote/rollback/inconclusive）：清理对应 cache 文件
 *
 * 永不抛异常 —— 失败静默 + warn log。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('skill-ab-cache');

const CACHE_DIRNAME = '.ab-cache';

function cacheDir(userSkillsDir: string): string {
  return path.join(userSkillsDir, CACHE_DIRNAME);
}

function cacheFilePath(userSkillsDir: string, skillName: string, hash: string): string {
  // hash 全长是 hex 不会含 / \ 等，但保险起见限制到 [a-z0-9]+
  const safeHash = hash.replace(/[^a-z0-9]/gi, '').slice(0, 64);
  return path.join(cacheDir(userSkillsDir), `${skillName}-${safeHash}.md`);
}

/**
 * 物化某 variant 的 SKILL.md 内容到 cache。
 * 用于 A-B 启动时把 previous_content 写到磁盘（B 已是当前版本无需缓存）。
 *
 * 失败时返回 false（不抛）— 调用方应当 abort A-B 启动（防止只有 B 没有 A 的不对称状态）。
 */
export function writeVariantToCache(
  userSkillsDir: string,
  skillName: string,
  hash: string,
  content: string,
): boolean {
  try {
    const dir = cacheDir(userSkillsDir);
    fs.mkdirSync(dir, { recursive: true });

    const target = cacheFilePath(userSkillsDir, skillName, hash);

    // 原子写：tmp → rename
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, target);

    log.info(`A-B cache write`, { skillName, hash: hash.slice(0, 8), bytes: content.length });
    return true;
  } catch (err) {
    log.warn(`A-B cache write failed (${skillName}): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * 读取 cache 中的 variant 内容。
 * 找不到（被清理 / 从未写过 / 路径错误）→ 返回 null。
 *
 * invoke_skill 入口在 variant=A 时调用：
 *   const content = readVariantFromCache(...) ?? fallbackToCurrentSKILLmd();
 *
 * 兜底逻辑（cache miss 退化到当前 SKILL.md）保证 A-B 损坏不阻断主流程，
 * 但会让该次调用桶位实际偏 B。下次评估器评估时会看到样本不足或偏置 → inconclusive。
 */
export function readVariantFromCache(
  userSkillsDir: string,
  skillName: string,
  hash: string,
): string | null {
  try {
    const target = cacheFilePath(userSkillsDir, skillName, hash);
    return fs.readFileSync(target, 'utf-8');
  } catch (err) {
    // ENOENT 是正常情况（cache miss），其他错误记 warn
    if (err && typeof err === 'object' && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn(`A-B cache read failed (${skillName}): ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
}

/** 检查 cache 中是否存在某 variant（启动 A-B 前防御性确认） */
export function hasVariantCache(
  userSkillsDir: string,
  skillName: string,
  hash: string,
): boolean {
  try {
    const target = cacheFilePath(userSkillsDir, skillName, hash);
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

/**
 * 清理某次 A-B 测试的所有 cache 文件（按 skillName + 两个 hash）。
 * promote 时清 A 版本（B 已是当前 SKILL.md 无需 cache）。
 * rollback 时清两个 — 实际 rollback 流程会把 A 内容写回 SKILL.md，cache 跟着失效。
 * inconclusive 同 promote。
 *
 * 永不抛 — 文件不存在视为清理成功。
 */
export function clearVariantFromCache(
  userSkillsDir: string,
  skillName: string,
  hash: string,
): void {
  try {
    const target = cacheFilePath(userSkillsDir, skillName, hash);
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      log.info(`A-B cache cleared`, { skillName, hash: hash.slice(0, 8) });
    }
  } catch (err) {
    log.warn(`A-B cache clear failed (${skillName}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 启动时清理孤儿 cache（垃圾回收）。
 * 当 SQLite 中没有任何 active A-B 测试时，cache 目录里的文件都是孤儿。
 * 避免长期残留消耗磁盘。
 *
 * 调用方传入 active 测试的 (skillName, hash) 集合；不在集合内的文件被删除。
 */
export function gcOrphanCache(
  userSkillsDir: string,
  liveKeys: Set<string>,
): { scanned: number; removed: number } {
  const dir = cacheDir(userSkillsDir);
  if (!fs.existsSync(dir)) return { scanned: 0, removed: 0 };

  let scanned = 0;
  let removed = 0;
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      scanned++;
      // 文件名形如 `<skillName>-<hash>.md`；解析回 (skillName, hash) 比对
      const stem = file.slice(0, -3); // strip .md
      const lastDash = stem.lastIndexOf('-');
      if (lastDash <= 0) continue;
      const skillName = stem.slice(0, lastDash);
      const hash = stem.slice(lastDash + 1);
      if (liveKeys.has(`${skillName}:${hash}`)) continue;
      try {
        fs.unlinkSync(path.join(dir, file));
        removed++;
      } catch {
        // 单文件失败不阻断 GC
      }
    }
  } catch (err) {
    log.warn(`gcOrphanCache failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (removed > 0) {
    log.info(`A-B cache GC`, { scanned, removed });
  }
  return { scanned, removed };
}
