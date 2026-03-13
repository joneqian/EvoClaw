import { Hono } from 'hono';
import { MemoryStore } from '../memory/memory-store.js';
import { HybridSearcher } from '../memory/hybrid-searcher.js';
import { FtsStore } from '../infrastructure/db/fts-store.js';
import { VectorStore } from '../infrastructure/db/vector-store.js';
import { KnowledgeGraphStore } from '../memory/knowledge-graph.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';

/** 创建记忆管理路由 */
export function createMemoryRoutes(db: SqliteStore, vectorStore?: VectorStore): Hono {
  const app = new Hono();
  const ftsStore = new FtsStore(db);
  const vs = vectorStore ?? new VectorStore();
  const kgStore = new KnowledgeGraphStore(db);
  const memoryStore = new MemoryStore(db, vs);
  const searcher = new HybridSearcher(ftsStore, vs, kgStore, memoryStore);

  /** POST /:agentId/search — 混合搜索 */
  app.post('/:agentId/search', async (c) => {
    const agentId = c.req.param('agentId');
    const body = await c.req.json<{ query: string; limit?: number }>();
    const results = await searcher.hybridSearch(body.query, agentId, { limit: body.limit });
    return c.json({ results });
  });

  /** GET /:agentId/units — 分页列表 */
  app.get('/:agentId/units', (c) => {
    const agentId = c.req.param('agentId');
    const category = c.req.query('category') as any;
    const limit = parseInt(c.req.query('limit') ?? '20', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);
    const units = memoryStore.listByAgent(agentId, { category: category || undefined, limit, offset });
    return c.json({ units });
  });

  /** GET /:agentId/units/:id — 获取单条记忆详情 */
  app.get('/:agentId/units/:id', (c) => {
    const id = c.req.param('id');
    const unit = memoryStore.getById(id);
    if (!unit) return c.json({ error: '记忆不存在' }, 404);
    return c.json({ unit });
  });

  /** PUT /:agentId/units/:id/pin — 钉选 */
  app.put('/:agentId/units/:id/pin', (c) => {
    const id = c.req.param('id');
    memoryStore.pin(id);
    return c.json({ success: true });
  });

  /** DELETE /:agentId/units/:id/pin — 取消钉选 */
  app.delete('/:agentId/units/:id/pin', (c) => {
    const id = c.req.param('id');
    memoryStore.unpin(id);
    return c.json({ success: true });
  });

  /** DELETE /:agentId/units/:id — 删除记忆 */
  app.delete('/:agentId/units/:id', (c) => {
    const id = c.req.param('id');
    memoryStore.delete(id);
    // 同步删除全文索引
    ftsStore.removeIndex(id);
    return c.json({ success: true });
  });

  return app;
}
