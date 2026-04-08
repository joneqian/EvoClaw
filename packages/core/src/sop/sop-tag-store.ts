/**
 * SOP 标签仓库
 *
 * 管理两份独立的标签文件：
 *   - `tags.json`  已确认标签（用户最终审批的生效版本）
 *   - `draft.json` Agent 提议的草稿（待用户审核）
 *
 * 所有写入走 zod 校验 + 原子重命名（先写 .tmp 再 rename）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { getSopRoot, getTagsFile, getDraftFile } from './sop-paths.js';
import {
  SopTagsFile,
  validateTagsPayload,
  formatZodError,
  emptyTagsFile,
  type SopTagsFileT,
  type SopParentTagT,
} from './sop-schema.js';
import type { z } from 'zod';

/** SOP 标签仓库 */
export class SopTagStore {
  constructor(private base?: string) {}

  /** 加载已确认标签，文件不存在返回空结构 */
  loadTags(): SopTagsFileT {
    return this.loadFile(getTagsFile(this.base)) ?? emptyTagsFile();
  }

  /** 保存已确认标签（zod 校验 + 原子写） */
  saveTags(tags: SopParentTagT[]): SopTagsFileT {
    const file = this.buildFile(tags);
    this.writeFile(getTagsFile(this.base), file);
    return file;
  }

  /** 加载草稿，不存在返回 null */
  loadDraft(): SopTagsFileT | null {
    return this.loadFile(getDraftFile(this.base));
  }

  /** 保存草稿 */
  saveDraft(tags: SopParentTagT[]): SopTagsFileT {
    const file = this.buildFile(tags);
    this.writeFile(getDraftFile(this.base), file);
    return file;
  }

  /** 清空草稿 */
  clearDraft(): void {
    const draftPath = getDraftFile(this.base);
    if (fs.existsSync(draftPath)) {
      try {
        fs.unlinkSync(draftPath);
      } catch {
        /* 忽略 */
      }
    }
  }

  /** 将草稿提升为正式标签：保存 draft.tags 到 tags.json + 清空 draft */
  promoteDraft(): boolean {
    const draft = this.loadDraft();
    if (!draft) return false;
    this.saveTags(draft.tags);
    this.clearDraft();
    return true;
  }

  // ─── 内部 ───

  private buildFile(tags: SopParentTagT[]): SopTagsFileT {
    const result = validateTagsPayload(tags);
    if (!result.success) {
      throw new Error(`SOP 标签校验失败: ${result.error}`);
    }
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      tags: result.data,
    };
  }

  private loadFile(filePath: string): SopTagsFileT | null {
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const result = SopTagsFile.safeParse(parsed);
      if (!result.success) {
        throw new Error(
          `SOP 标签文件结构非法 (${filePath}): ${formatZodError(result.error as z.ZodError)}`,
        );
      }
      return result.data;
    } catch (err) {
      // JSON 解析或 schema 失败 — 让上层决定如何处理
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  private writeFile(filePath: string, file: SopTagsFileT): void {
    // 校验
    const result = SopTagsFile.safeParse(file);
    if (!result.success) {
      throw new Error(`SOP 标签文件校验失败: ${formatZodError(result.error as z.ZodError)}`);
    }
    this.ensureRoot();
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }

  private ensureRoot(): void {
    const root = getSopRoot(this.base);
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    // 确保父目录也在
    fs.mkdirSync(path.dirname(getTagsFile(this.base)), { recursive: true });
  }
}
