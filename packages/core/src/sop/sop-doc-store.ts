/**
 * SOP 文档仓库
 *
 * 管理上传的 SOP 文档（原文 + 解析后的纯文本 + 索引）。
 * 所有数据存于 `<base>/sop/docs/`：
 *   - `{uuid}.{ext}`   原始上传文件
 *   - `{uuid}.txt`     mammoth/xlsx/fs 解析出的纯文本
 *   - `index.json`     文档元数据索引（id/originalName/ext/uploadedAt）
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDocsDir, getDocsIndexFile, getSopRoot } from './sop-paths.js';
import {
  parseDocToText,
  inferExtension,
  type SupportedExt,
} from './sop-doc-parser.js';

/** 单文件最大上传大小（10MB） */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** 文档元数据 */
export interface SopDocMeta {
  id: string;
  originalName: string;
  ext: SupportedExt;
  uploadedAt: string;
  size: number;
}

interface IndexFile {
  version: 1;
  docs: SopDocMeta[];
}

/** SOP 文档仓库 */
export class SopDocStore {
  constructor(private base?: string) {}

  /** 上传保存文档：写原文 + 解析为纯文本 + 更新索引 */
  async saveUploadedDoc(
    buffer: Buffer,
    originalName: string,
  ): Promise<SopDocMeta> {
    const ext = inferExtension(originalName);
    if (!ext) {
      throw new Error(`不支持的文档类型: ${originalName}（仅支持 docx/md/xlsx）`);
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new Error(
        `文件过大（${(buffer.length / 1024 / 1024).toFixed(1)}MB），最大 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`,
      );
    }

    this.ensureDirs();

    const id = crypto.randomUUID();
    const docsDir = getDocsDir(this.base);
    const filePath = path.join(docsDir, `${id}.${ext}`);
    fs.writeFileSync(filePath, buffer);

    // 解析为纯文本并落盘
    const parsedText = await parseDocToText(filePath, ext);
    const txtPath = path.join(docsDir, `${id}.txt`);
    fs.writeFileSync(txtPath, parsedText, 'utf-8');

    const meta: SopDocMeta = {
      id,
      originalName,
      ext,
      uploadedAt: new Date().toISOString(),
      size: buffer.length,
    };

    const idx = this.readIndex();
    idx.docs.push(meta);
    this.writeIndex(idx);

    return meta;
  }

  /** 列出所有文档（按上传时间倒序，最新在前） */
  listDocs(): SopDocMeta[] {
    return this.readIndex().docs.slice().sort((a, b) => {
      return b.uploadedAt.localeCompare(a.uploadedAt);
    });
  }

  /** 读取解析后的纯文本，不存在返回 null */
  getParsedText(id: string): string | null {
    const txtPath = path.join(getDocsDir(this.base), `${id}.txt`);
    if (!fs.existsSync(txtPath)) return null;
    return fs.readFileSync(txtPath, 'utf-8');
  }

  /** 获取文档元数据 */
  getDoc(id: string): SopDocMeta | null {
    return this.readIndex().docs.find((d) => d.id === id) ?? null;
  }

  /** 删除文档（原文 + 解析文本 + 索引项） */
  deleteDoc(id: string): boolean {
    const idx = this.readIndex();
    const i = idx.docs.findIndex((d) => d.id === id);
    if (i < 0) return false;

    const doc = idx.docs[i]!;
    const docsDir = getDocsDir(this.base);
    const filePath = path.join(docsDir, `${doc.id}.${doc.ext}`);
    const txtPath = path.join(docsDir, `${doc.id}.txt`);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      /* 忽略 */
    }
    try {
      if (fs.existsSync(txtPath)) fs.unlinkSync(txtPath);
    } catch {
      /* 忽略 */
    }

    idx.docs.splice(i, 1);
    this.writeIndex(idx);
    return true;
  }

  // ─── 内部方法 ───

  private ensureDirs(): void {
    const root = getSopRoot(this.base);
    const docs = getDocsDir(this.base);
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
    if (!fs.existsSync(docs)) fs.mkdirSync(docs, { recursive: true });
  }

  private readIndex(): IndexFile {
    const indexPath = getDocsIndexFile(this.base);
    if (!fs.existsSync(indexPath)) {
      return { version: 1, docs: [] };
    }
    try {
      const raw = fs.readFileSync(indexPath, 'utf-8');
      const parsed = JSON.parse(raw) as IndexFile;
      if (!Array.isArray(parsed.docs)) {
        return { version: 1, docs: [] };
      }
      return parsed;
    } catch {
      return { version: 1, docs: [] };
    }
  }

  private writeIndex(idx: IndexFile): void {
    this.ensureDirs();
    const indexPath = getDocsIndexFile(this.base);
    const tmpPath = `${indexPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(idx, null, 2), 'utf-8');
    fs.renameSync(tmpPath, indexPath);
  }
}
