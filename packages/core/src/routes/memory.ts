import { Hono } from 'hono';
import { MemoryStore } from '../memory/memory-store.js';
import { HybridSearcher } from '../memory/hybrid-searcher.js';
import { FtsStore } from '../infrastructure/db/fts-store.js';
import { VectorStore } from '../infrastructure/db/vector-store.js';
import { KnowledgeGraphStore } from '../memory/knowledge-graph.js';
import { MemoryFeedbackStore, CONFIDENCE_DECAY_STEP, type MemoryFeedbackType } from '../memory/memory-feedback-store.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';

const VALID_FEEDBACK_TYPES: readonly MemoryFeedbackType[] = ['inaccurate', 'sensitive', 'outdated'];

/** 创建记忆管理路由 */
export function createMemoryRoutes(db: SqliteStore, vectorStore?: VectorStore): Hono {
  const app = new Hono();
  const ftsStore = new FtsStore(db);
  const vs = vectorStore ?? new VectorStore();
  const kgStore = new KnowledgeGraphStore(db);
  const memoryStore = new MemoryStore(db, vs);
  const feedbackStore = new MemoryFeedbackStore(db);
  const searcher = new HybridSearcher(ftsStore, vs, kgStore, memoryStore);

  /** POST /:agentId/search — 混合搜索 */
  app.post('/:agentId/search', async (c) => {
    const agentId = c.req.param('agentId');
    const body = await c.req.json<{ query: string; limit?: number }>();
    const results = await searcher.hybridSearch(body.query, agentId, { limit: body.limit });
    return c.json({ results });
  });

  /** POST /:agentId/units/batch-delete — 批量删除记忆（必须在 /:id 路由之前注册） */
  app.post('/:agentId/units/batch-delete', async (c) => {
    const body = await c.req.json<{ ids: string[] }>();
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return c.json({ error: 'ids 不能为空' }, 400);
    }
    const deleted = memoryStore.deleteMany(body.ids);
    for (const id of body.ids) {
      ftsStore.removeIndex(id);
    }
    return c.json({ success: true, deleted });
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

  /** POST /:agentId/units/:id/feedback — Sprint 15.12 Phase B
   *  写入用户对一条记忆的反馈（不准 / 涉及隐私 / 过时），同时把 confidence 降权 */
  app.post('/:agentId/units/:id/feedback', async (c) => {
    const agentId = c.req.param('agentId');
    const memoryId = c.req.param('id');
    const body = await c.req.json<{ type: string; note?: string }>().catch(() => ({} as { type?: string; note?: string }));

    if (!body.type || !VALID_FEEDBACK_TYPES.includes(body.type as MemoryFeedbackType)) {
      return c.json({
        error: `非法的 type，合法值: ${VALID_FEEDBACK_TYPES.join(', ')}`,
      }, 400);
    }

    const unit = memoryStore.getById(memoryId);
    if (!unit) return c.json({ error: '记忆不存在' }, 404);
    if (unit.agentId !== agentId) {
      return c.json({ error: '权限不足，无法操作其他 Agent 的记忆' }, 403);
    }

    const feedback = feedbackStore.insert({
      memoryId,
      agentId,
      type: body.type as MemoryFeedbackType,
      note: body.note ?? null,
    });

    // confidence 降权（不低于 0）
    const newConfidence = Math.max(0, unit.confidence - CONFIDENCE_DECAY_STEP);
    if (newConfidence !== unit.confidence) {
      memoryStore.update(memoryId, { confidence: newConfidence });
    }

    return c.json({ feedback });
  });

  /** PUT /:agentId/units/:id — Sprint 15.12 Phase B
   *  更新记忆的 L1/L2 内容（L0 锁死，是检索锚点不可改） */
  app.put('/:agentId/units/:id', async (c) => {
    const agentId = c.req.param('agentId');
    const id = c.req.param('id');
    const body = await c.req.json<{ l1Overview?: string; l2Content?: string; l0Index?: string }>().catch(() => ({} as Record<string, never>));

    const unit = memoryStore.getById(id);
    if (!unit) return c.json({ error: '记忆不存在' }, 404);
    if (unit.agentId !== agentId) {
      return c.json({ error: '权限不足，无法修改其他 Agent 的记忆' }, 403);
    }

    const partial: { l1Overview?: string; l2Content?: string } = {};
    if (typeof body.l1Overview === 'string') partial.l1Overview = body.l1Overview;
    if (typeof body.l2Content === 'string') partial.l2Content = body.l2Content;

    if (Object.keys(partial).length === 0) {
      return c.json({ error: '至少需要提供 l1Overview 或 l2Content' }, 400);
    }

    memoryStore.update(id, partial);

    // L1 变化时刷新 FTS 索引
    if (partial.l1Overview !== undefined) {
      const updated = memoryStore.getById(id);
      if (updated) {
        ftsStore.indexMemory(id, updated.l0Index, updated.l1Overview);
      }
    }

    return c.json({ success: true });
  });

  /** GET /:agentId/knowledge-graph — Sprint 15.12 Phase B
   *  返回某 Agent 的知识图谱关系三元组（按 created_at 倒序，支持 limit） */
  app.get('/:agentId/knowledge-graph', (c) => {
    const agentId = c.req.param('agentId');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 500);

    const rows = db.all<{
      id: string;
      agent_id: string;
      subject_id: string;
      predicate: string;
      object_id: string;
      confidence: number;
      created_at: string;
    }>(
      `SELECT id, agent_id, subject_id, predicate, object_id, confidence, created_at
       FROM knowledge_graph
       WHERE agent_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`,
      agentId,
      limit,
    );

    const relations = rows.map(r => ({
      id: r.id,
      agentId: r.agent_id,
      subjectId: r.subject_id,
      relation: r.predicate,
      objectId: r.object_id,
      confidence: r.confidence,
      createdAt: r.created_at,
    }));
    return c.json({ relations });
  });

  /** GET /:agentId/consolidations — Sprint 15.12 Phase B
   *  AutoDream 整合历史（按 started_at 倒序，支持 limit） */
  app.get('/:agentId/consolidations', (c) => {
    const agentId = c.req.param('agentId');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 200);

    const rows = db.all<{
      id: string;
      agent_id: string;
      started_at: string;
      completed_at: string | null;
      status: string;
      memories_merged: number | null;
      memories_pruned: number | null;
      memories_created: number | null;
      error_message: string | null;
    }>(
      `SELECT id, agent_id, started_at, completed_at, status,
              memories_merged, memories_pruned, memories_created, error_message
       FROM consolidation_log
       WHERE agent_id = ?
       ORDER BY started_at DESC, rowid DESC
       LIMIT ?`,
      agentId,
      limit,
    );

    const runs = rows.map(r => ({
      id: r.id,
      agentId: r.agent_id,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      status: r.status,
      memoriesMerged: r.memories_merged ?? 0,
      memoriesPruned: r.memories_pruned ?? 0,
      memoriesCreated: r.memories_created ?? 0,
      errorMessage: r.error_message,
    }));
    return c.json({ runs });
  });

  /** GET /:agentId/session-summaries — Sprint 15.12 Phase B
   *  会话摘要列表（按 updated_at 倒序，支持 limit） */
  app.get('/:agentId/session-summaries', (c) => {
    const agentId = c.req.param('agentId');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 200);

    const rows = db.all<{
      id: string;
      agent_id: string;
      session_key: string;
      summary_markdown: string;
      token_count_at: number;
      turn_count_at: number;
      tool_call_count_at: number;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, agent_id, session_key, summary_markdown,
              token_count_at, turn_count_at, tool_call_count_at,
              created_at, updated_at
       FROM session_summaries
       WHERE agent_id = ?
       ORDER BY updated_at DESC, rowid DESC
       LIMIT ?`,
      agentId,
      limit,
    );

    const summaries = rows.map(r => ({
      id: r.id,
      agentId: r.agent_id,
      sessionKey: r.session_key,
      summaryMarkdown: r.summary_markdown,
      tokenCountAt: r.token_count_at,
      turnCountAt: r.turn_count_at,
      toolCallCountAt: r.tool_call_count_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    return c.json({ summaries });
  });

  /** DELETE /:agentId/units/:id — 删除单条记忆 */
  app.delete('/:agentId/units/:id', (c) => {
    const id = c.req.param('id');
    memoryStore.delete(id);
    ftsStore.removeIndex(id);
    return c.json({ success: true });
  });

  return app;
}
