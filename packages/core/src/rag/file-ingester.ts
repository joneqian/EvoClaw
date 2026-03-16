/**
 * 文件摄取器 — 读取文件 → SHA-256 哈希 → 分块 → 写入 DB
 *
 * PDF 使用动态 import unpdf，未安装则跳过 + 警告。
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { splitDocument, detectDocumentType, type DocumentType } from './chunk-splitter.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('file-ingester');

export class FileIngester {
  constructor(private db: SqliteStore) {}

  /** 摄取文件：读取 → 哈希 → 分块 → 存储 */
  async ingest(agentId: string, filePath: string): Promise<string> {
    // 读取文件
    const stat = fs.statSync(filePath);
    const fileName = filePath.split('/').pop() ?? filePath;
    const docType = detectDocumentType(fileName);

    // 读取内容
    let content: string;
    if (docType === 'pdf') {
      content = await this.extractPdf(filePath);
    } else {
      content = fs.readFileSync(filePath, 'utf-8');
    }

    // 计算哈希
    const fileHash = crypto.createHash('sha256').update(content).digest('hex');

    // 检查是否已存在相同哈希的文件
    const existing = this.db.get<{ id: string }>(
      'SELECT id FROM knowledge_base_files WHERE agent_id = ? AND file_hash = ?',
      agentId, fileHash,
    );
    if (existing) {
      return existing.id;
    }

    // 分块
    const chunks = splitDocument(content, docType);
    const fileId = crypto.randomUUID();

    this.db.transaction(() => {
      // 写入文件记录
      this.db.run(
        `INSERT INTO knowledge_base_files (id, agent_id, file_name, file_path, file_hash, file_size, chunk_count, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        fileId, agentId, fileName, filePath, fileHash, stat.size, chunks.length,
      );

      // 写入分块
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkId = crypto.randomUUID();
        this.db.run(
          `INSERT INTO knowledge_base_chunks (id, file_id, agent_id, chunk_index, content, metadata_json, token_count)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          chunkId, fileId, agentId, i, chunk.content,
          JSON.stringify(chunk.metadata), chunk.tokenCount,
        );
      }
    });

    return fileId;
  }

  /** 删除文件及其分块（级联删除由 FK 处理） */
  removeFile(fileId: string): void {
    this.db.run('DELETE FROM knowledge_base_files WHERE id = ?', fileId);
    // 同时清理 embeddings 表中的 chunk 向量
    const chunks = this.db.all<{ id: string }>(
      'SELECT id FROM knowledge_base_chunks WHERE file_id = ?',
      fileId,
    );
    if (chunks.length > 0) {
      const placeholders = chunks.map(() => '?').join(', ');
      this.db.run(`DELETE FROM embeddings WHERE id IN (${placeholders})`, ...chunks.map(c => c.id));
    }
  }

  /** 检查文件是否已变更 */
  checkFileChanged(filePath: string): boolean {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileHash = crypto.createHash('sha256').update(content).digest('hex');
    const existing = this.db.get<{ file_hash: string }>(
      'SELECT file_hash FROM knowledge_base_files WHERE file_path = ?',
      filePath,
    );
    return !existing || existing.file_hash !== fileHash;
  }

  /** 提取 PDF 文本（动态 import unpdf） */
  private async extractPdf(filePath: string): Promise<string> {
    try {
      const { extractText } = await import('unpdf');
      const buffer = fs.readFileSync(filePath);
      const result = await extractText(new Uint8Array(buffer));
      return result.text;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Cannot find module") || message.includes("Cannot find package")) {
        log.warn('unpdf 未安装，跳过 PDF 解析。请运行: pnpm add unpdf');
        throw new Error('PDF 解析需要安装 unpdf: pnpm add unpdf');
      }
      throw err;
    }
  }
}
