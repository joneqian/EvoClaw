/**
 * SOP 模块文件路径工具
 *
 * 所有 SOP 数据存于品牌数据目录下的 sop/ 子目录：
 *   ~/.evoclaw/sop/          (EvoClaw)
 *   ~/.healthclaw/sop/       (HealthClaw)
 *
 * base 参数用于测试时注入临时目录。
 */

import path from 'node:path';
import { getDataDir } from '../infrastructure/data-dir.js';

/** 获取品牌数据目录（~/.evoclaw or ~/.healthclaw，或 {BRAND}_HOME 覆盖） */
function defaultBase(): string {
  return getDataDir();
}

/** SOP 根目录 */
export function getSopRoot(base?: string): string {
  return path.join(base ?? defaultBase(), 'sop');
}

/** 文档上传目录 */
export function getDocsDir(base?: string): string {
  return path.join(getSopRoot(base), 'docs');
}

/** 文档索引文件 */
export function getDocsIndexFile(base?: string): string {
  return path.join(getDocsDir(base), 'index.json');
}

/** 已确认标签文件 */
export function getTagsFile(base?: string): string {
  return path.join(getSopRoot(base), 'tags.json');
}

/** 草稿标签文件 */
export function getDraftFile(base?: string): string {
  return path.join(getSopRoot(base), 'draft.json');
}
