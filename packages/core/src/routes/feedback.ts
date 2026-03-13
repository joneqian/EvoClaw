import { Hono } from 'hono';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { MemoryExtractor, type LLMCallFn } from '../memory/memory-extractor.js';

/** 创建反馈收集路由 */
export function createFeedbackRoutes(db: SqliteStore, llmCall?: LLMCallFn): Hono {
  const app = new Hono();

  /** POST /:agentId/feedback — 提交反馈 */
  app.post('/:agentId/feedback', async (c) => {
    const agentId = c.req.param('agentId');
    const body = await c.req.json<{
      messageId: string;
      rating: 'positive' | 'negative';
      correction?: string;  // 负面反馈的文字纠正
    }>();

    // 记录到 audit_log
    db.run(
      'INSERT INTO audit_log (agent_id, action, details) VALUES (?, ?, ?)',
      agentId,
      `feedback_${body.rating}`,
      JSON.stringify({ messageId: body.messageId, correction: body.correction }),
    );

    // 负面反馈自动提取为 correction 类记忆
    if (body.rating === 'negative' && body.correction && llmCall) {
      const extractor = new MemoryExtractor(db, llmCall);
      try {
        await extractor.extractAndPersist(
          [{
            id: body.messageId,
            conversationId: '',
            role: 'user',
            content: `[用户纠正] ${body.correction}`,
            createdAt: new Date().toISOString(),
          }],
          agentId,
        );
      } catch (err) {
        console.error('[feedback] 纠正记忆提取失败:', err);
      }
    }

    return c.json({ success: true });
  });

  return app;
}
