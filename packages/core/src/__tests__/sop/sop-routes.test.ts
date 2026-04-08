import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Hono } from 'hono';
import { createSopRoutes } from '../../routes/sop.js';
import { SopDocStore } from '../../sop/sop-doc-store.js';
import { SopTagStore } from '../../sop/sop-tag-store.js';

describe('SOP routes', () => {
  let tmpBase: string;
  let docStore: SopDocStore;
  let tagStore: SopTagStore;
  let app: Hono;
  let mockLlm: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpBase = path.join(os.tmpdir(), `sop-routes-test-${crypto.randomUUID()}`);
    docStore = new SopDocStore(tmpBase);
    tagStore = new SopTagStore(tmpBase);
    mockLlm = vi.fn();
    app = new Hono();
    app.route('/sop', createSopRoutes({ docStore, tagStore, llmCall: mockLlm }));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  });

  describe('文档路由', () => {
    it('GET /sop/docs 空仓库返回空数组', async () => {
      const res = await app.request('/sop/docs');
      expect(res.status).toBe(200);
      const body = await res.json() as { docs: unknown[] };
      expect(body.docs).toEqual([]);
    });

    it('POST /sop/docs/upload 上传 markdown', async () => {
      const formData = new FormData();
      const file = new File([Buffer.from('# 测试 SOP\n\n内容')], 'test.md', {
        type: 'text/markdown',
      });
      formData.append('file', file);

      const res = await app.request('/sop/docs/upload', {
        method: 'POST',
        body: formData,
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { doc: { id: string; originalName: string } };
      expect(body.doc.originalName).toBe('test.md');
      expect(body.doc.id).toBeDefined();
    });

    it('POST /sop/docs/upload 不支持的扩展返回 400', async () => {
      const formData = new FormData();
      formData.append('file', new File([Buffer.from('x')], 'test.pdf'));

      const res = await app.request('/sop/docs/upload', {
        method: 'POST',
        body: formData,
      });
      expect(res.status).toBe(400);
    });

    it('POST /sop/docs/upload 缺 file 返回 400', async () => {
      const res = await app.request('/sop/docs/upload', {
        method: 'POST',
        body: new FormData(),
      });
      expect(res.status).toBe(400);
    });

    it('GET /sop/docs/:id/text 返回解析后文本', async () => {
      const meta = await docStore.saveUploadedDoc(Buffer.from('# 标题'), 't.md');
      const res = await app.request(`/sop/docs/${meta.id}/text`);
      expect(res.status).toBe(200);
      const body = await res.json() as { text: string };
      expect(body.text).toContain('标题');
    });

    it('GET /sop/docs/:id/text 不存在返回 404', async () => {
      const res = await app.request('/sop/docs/no-such-id/text');
      expect(res.status).toBe(404);
    });

    it('DELETE /sop/docs/:id', async () => {
      const meta = await docStore.saveUploadedDoc(Buffer.from('# x'), 'x.md');
      const res = await app.request(`/sop/docs/${meta.id}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(docStore.listDocs()).toEqual([]);
    });

    it('DELETE /sop/docs/:id 不存在返回 404', async () => {
      const res = await app.request('/sop/docs/no-such-id', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  describe('标签路由', () => {
    const sample = [
      {
        name: '咨询阶段',
        children: [
          { name: '首次咨询', meaning: 'a', mustDo: 'b', mustNotDo: 'c' },
        ],
      },
    ];

    it('GET /sop/tags 空返回空 tags', async () => {
      const res = await app.request('/sop/tags');
      expect(res.status).toBe(200);
      const body = await res.json() as { tags: unknown[] };
      expect(body.tags).toEqual([]);
    });

    it('PUT /sop/tags 保存合法标签', async () => {
      const res = await app.request('/sop/tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: sample }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { tags: unknown[] };
      expect(body.tags).toHaveLength(1);
    });

    it('PUT /sop/tags 校验失败返回 400', async () => {
      const res = await app.request('/sop/tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: [{ name: '空父', children: [] }] }),
      });
      expect(res.status).toBe(400);
    });

    it('DELETE /sop/tags 清空标签', async () => {
      tagStore.saveTags(sample);
      const res = await app.request('/sop/tags', { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(tagStore.loadTags().tags).toEqual([]);
    });
  });

  describe('草稿路由', () => {
    const sample = [
      {
        name: '草稿阶段',
        children: [{ name: '草稿子', meaning: 'a', mustDo: 'b', mustNotDo: 'c' }],
      },
    ];

    it('GET /sop/draft 无草稿返回 null', async () => {
      const res = await app.request('/sop/draft');
      expect(res.status).toBe(200);
      const body = await res.json() as { draft: unknown };
      expect(body.draft).toBeNull();
    });

    it('PUT /sop/draft 保存草稿', async () => {
      const res = await app.request('/sop/draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: sample }),
      });
      expect(res.status).toBe(200);
      expect(tagStore.loadDraft()?.tags).toEqual(sample);
    });

    it('PUT /sop/draft 校验失败 400', async () => {
      const res = await app.request('/sop/draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: [{ name: 'p', children: [] }] }),
      });
      expect(res.status).toBe(400);
    });

    it('DELETE /sop/draft 清空草稿', async () => {
      tagStore.saveDraft(sample);
      const res = await app.request('/sop/draft', { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(tagStore.loadDraft()).toBeNull();
    });

    it('POST /sop/draft/promote 将草稿提升为正式标签', async () => {
      tagStore.saveDraft(sample);
      const res = await app.request('/sop/draft/promote', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(tagStore.loadTags().tags).toEqual(sample);
      expect(tagStore.loadDraft()).toBeNull();
    });

    it('POST /sop/draft/promote 无草稿返回 404', async () => {
      const res = await app.request('/sop/draft/promote', { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });

  describe('AI 生成草稿', () => {
    const validJson = JSON.stringify([
      {
        name: '咨询阶段',
        children: [
          {
            name: '首次咨询',
            meaning: '客户首次接触',
            mustDo: '问候并收集需求',
            mustNotDo: '直接推销',
          },
        ],
      },
    ]);

    it('POST /sop/draft/generate 成功生成并落盘', async () => {
      await docStore.saveUploadedDoc(Buffer.from('# SOP\n\n咨询阶段说明'), 's.md');
      mockLlm.mockResolvedValue(validJson);

      const res = await app.request('/sop/draft/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { draft: { tags: unknown[] }; retryCount: number };
      expect(body.draft.tags).toHaveLength(1);
      expect(body.retryCount).toBe(0);
      // 草稿应该已经落盘
      expect(tagStore.loadDraft()?.tags).toHaveLength(1);
    });

    it('POST /sop/draft/generate 接受 instruction 参数', async () => {
      await docStore.saveUploadedDoc(Buffer.from('# SOP'), 's.md');
      mockLlm.mockResolvedValue(validJson);

      const res = await app.request('/sop/draft/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: '加上售前阶段' }),
      });

      expect(res.status).toBe(200);
      const userPrompt = mockLlm.mock.calls[0]![1] as string;
      expect(userPrompt).toContain('加上售前阶段');
    });

    it('POST /sop/draft/generate 无文档返回 400', async () => {
      const res = await app.request('/sop/draft/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('POST /sop/draft/generate LLM 持续失败返回 500', async () => {
      await docStore.saveUploadedDoc(Buffer.from('# SOP'), 's.md');
      mockLlm.mockResolvedValue('garbage not json');

      const res = await app.request('/sop/draft/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(500);
      // 应该重试 1 次（共 2 次调用）
      expect(mockLlm).toHaveBeenCalledTimes(2);
    });

    it('POST /sop/draft/generate 未配置 LLM 返回 503', async () => {
      // 重新构造一个不带 llmCall 的 app
      const noLlmApp = new Hono();
      noLlmApp.route('/sop', createSopRoutes({ docStore, tagStore }));
      await docStore.saveUploadedDoc(Buffer.from('# SOP'), 's.md');

      const res = await noLlmApp.request('/sop/draft/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(503);
    });
  });
});
