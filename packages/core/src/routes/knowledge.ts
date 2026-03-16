/**
 * 知识库管理路由
 */

import { Hono } from 'hono';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { VectorStore } from '../infrastructure/db/vector-store.js';
import { FileIngester } from '../rag/file-ingester.js';
import { RagIndexer } from '../rag/rag-indexer.js';
import type { BatchEmbeddingFn } from '../infrastructure/db/vector-store.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('knowledge');

/** 创建知识库路由 */
export function createKnowledgeRoutes(
  db: SqliteStore,
  vectorStore: VectorStore,
  batchEmbedFn?: BatchEmbeddingFn,
): Hono {
  const app = new Hono();
  const ingester = new FileIngester(db);
  const indexer = new RagIndexer(db, vectorStore, batchEmbedFn);

  /** POST /:agentId/ingest — 文件摄取 + 异步索引 */
  app.post('/:agentId/ingest', async (c) => {
    const agentId = c.req.param('agentId');
    const body = await c.req.json<{ filePath: string }>();

    try {
      const fileId = await ingester.ingest(agentId, body.filePath);

      // 如果有 embedding 函数，异步索引（不阻塞响应）
      if (batchEmbedFn) {
        indexer.indexFile(fileId).catch(err => {
          log.error(`索引文件 ${fileId} 失败:`, err);
        });
      }

      return c.json({ fileId, status: batchEmbedFn ? 'indexing' : 'pending' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  });

  /** GET /:agentId/files — 文件列表 */
  app.get('/:agentId/files', (c) => {
    const agentId = c.req.param('agentId');
    const files = db.all(
      `SELECT id, file_name, file_path, file_size, chunk_count, status, error_message, created_at, indexed_at
       FROM knowledge_base_files WHERE agent_id = ? ORDER BY created_at DESC`,
      agentId,
    );
    return c.json({ files });
  });

  /** DELETE /:agentId/files/:fileId — 删除文件 */
  app.delete('/:agentId/files/:fileId', (c) => {
    const fileId = c.req.param('fileId');
    ingester.removeFile(fileId);
    return c.json({ success: true });
  });

  /** POST /:agentId/reindex — 重新索引指定文件 */
  app.post('/:agentId/reindex', async (c) => {
    const body = await c.req.json<{ fileId: string }>();

    if (!batchEmbedFn) {
      return c.json({ error: '未配置 Embedding API' }, 400);
    }

    try {
      await indexer.reindexFile(body.fileId);
      return c.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
