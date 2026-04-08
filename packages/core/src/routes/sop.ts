/**
 * SOP 标签设计 — HTTP 路由
 *
 * Mount: app.route('/sop', createSopRoutes({ docStore, tagStore, llmCall }))
 *
 * 端点：
 *   POST   /docs/upload          上传单文件 (multipart/form-data, field=file)
 *   GET    /docs                 列出所有文档
 *   GET    /docs/:id/text        获取解析后纯文本
 *   DELETE /docs/:id             删除文档
 *   GET    /tags                 获取已确认标签
 *   PUT    /tags                 提交已确认标签（用户审批）
 *   DELETE /tags                 清空已确认标签
 *   GET    /draft                获取当前草稿
 *   PUT    /draft                保存/覆盖草稿
 *   DELETE /draft                丢弃草稿
 *   POST   /draft/promote        将草稿原子提升为正式标签
 *   POST   /draft/generate       一次性 LLM 调用生成草稿（替代旧的 SOP Designer Agent）
 */

import { Hono } from 'hono';
import type { SopDocStore } from '../sop/sop-doc-store.js';
import type { SopTagStore } from '../sop/sop-tag-store.js';
import { generateSopDraft, type LLMCallFn } from '../sop/sop-generator.js';

export interface SopRoutesDeps {
  docStore: SopDocStore;
  tagStore: SopTagStore;
  /** LLM 调用函数（用于 /draft/generate）。可选，未提供时该端点返回 503 */
  llmCall?: LLMCallFn;
}

export function createSopRoutes(deps: SopRoutesDeps): Hono {
  const { docStore, tagStore, llmCall } = deps;
  const app = new Hono();

  // ─── 文档 ───

  app.get('/docs', (c) => {
    const docs = docStore.listDocs();
    return c.json({ docs });
  });

  app.post('/docs/upload', async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody();
    } catch (err) {
      return c.json({ error: `读取上传失败: ${errMsg(err)}` }, 400);
    }
    const file = body['file'];
    if (!file || !(file instanceof File)) {
      return c.json({ error: '请上传文件 (字段名 file)' }, 400);
    }
    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const doc = await docStore.saveUploadedDoc(buffer, file.name);
      return c.json({ doc });
    } catch (err) {
      return c.json({ error: errMsg(err) }, 400);
    }
  });

  app.get('/docs/:id/text', (c) => {
    const id = c.req.param('id');
    const text = docStore.getParsedText(id);
    if (text === null) {
      return c.json({ error: `文档不存在: ${id}` }, 404);
    }
    return c.json({ id, text });
  });

  app.delete('/docs/:id', (c) => {
    const id = c.req.param('id');
    const ok = docStore.deleteDoc(id);
    if (!ok) {
      return c.json({ error: `文档不存在: ${id}` }, 404);
    }
    return c.json({ deleted: true });
  });

  // ─── 已确认标签 ───

  app.get('/tags', (c) => {
    const file = tagStore.loadTags();
    return c.json(file);
  });

  app.put('/tags', async (c) => {
    let body: { tags?: unknown };
    try {
      body = await c.req.json();
    } catch (err) {
      return c.json({ error: `JSON 解析失败: ${errMsg(err)}` }, 400);
    }
    if (!Array.isArray(body.tags)) {
      return c.json({ error: 'tags 必须是数组' }, 400);
    }
    try {
      const file = tagStore.saveTags(body.tags as Parameters<SopTagStore['saveTags']>[0]);
      return c.json(file);
    } catch (err) {
      return c.json({ error: errMsg(err) }, 400);
    }
  });

  app.delete('/tags', (c) => {
    try {
      const file = tagStore.saveTags([]);
      return c.json({ cleared: true, file });
    } catch (err) {
      return c.json({ error: errMsg(err) }, 500);
    }
  });

  // ─── 草稿 ───

  app.get('/draft', (c) => {
    const draft = tagStore.loadDraft();
    return c.json({ draft });
  });

  app.put('/draft', async (c) => {
    let body: { tags?: unknown };
    try {
      body = await c.req.json();
    } catch (err) {
      return c.json({ error: `JSON 解析失败: ${errMsg(err)}` }, 400);
    }
    if (!Array.isArray(body.tags)) {
      return c.json({ error: 'tags 必须是数组' }, 400);
    }
    try {
      const file = tagStore.saveDraft(body.tags as Parameters<SopTagStore['saveDraft']>[0]);
      return c.json(file);
    } catch (err) {
      return c.json({ error: errMsg(err) }, 400);
    }
  });

  app.delete('/draft', (c) => {
    tagStore.clearDraft();
    return c.json({ cleared: true });
  });

  app.post('/draft/promote', (c) => {
    try {
      const promoted = tagStore.promoteDraft();
      if (!promoted) {
        return c.json({ error: '当前没有草稿' }, 404);
      }
      return c.json({ promoted: true, tags: tagStore.loadTags() });
    } catch (err) {
      return c.json({ error: errMsg(err) }, 500);
    }
  });

  // ─── /draft/generate — 一次性 LLM 调用生成草稿 ───

  app.post('/draft/generate', async (c) => {
    if (!llmCall) {
      return c.json({ error: 'LLM 未配置，无法生成草稿。请先在设置中配置 Provider 和模型。' }, 503);
    }

    let body: { instruction?: string } = {};
    try {
      const text = await c.req.text();
      if (text) body = JSON.parse(text);
    } catch {
      // body 可选，解析失败也允许继续
    }

    // 收集所有上传文档的解析文本
    const docs = docStore.listDocs();
    if (docs.length === 0) {
      return c.json({ error: '请先上传至少一份 SOP 文档' }, 400);
    }

    const docInputs = docs
      .map((d) => {
        const text = docStore.getParsedText(d.id);
        return text ? { name: d.originalName, text } : null;
      })
      .filter((x): x is { name: string; text: string } => x !== null);

    if (docInputs.length === 0) {
      return c.json({ error: '无法读取上传的文档内容' }, 500);
    }

    // 取已有 draft / tags 作为 refinement 上下文
    const existingDraft = tagStore.loadDraft()?.tags;
    const existingTags = tagStore.loadTags().tags;

    try {
      const result = await generateSopDraft({
        llmCall,
        docs: docInputs,
        instruction: body.instruction,
        existingDraft,
        existingTags: existingTags.length > 0 ? existingTags : undefined,
      });

      // 保存到 draft.json（zod 已在 generator 校验，这里再走一次 store 的原子写）
      const saved = tagStore.saveDraft(result.tags);

      return c.json({
        draft: saved,
        retryCount: result.retryCount,
      });
    } catch (err) {
      return c.json({ error: errMsg(err) }, 500);
    }
  });

  return app;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
