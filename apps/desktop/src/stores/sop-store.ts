/**
 * sop-store — SOP 标签设计临时功能状态管理
 *
 * 后端 /sop/* 端点配套：文档管理 + 已确认标签 + 草稿审核工作流。
 *
 * 关键设计：草稿（draft）和正式标签（tags）分离，
 * 用户在 UI 里编辑草稿后点击"确认保存"才落盘到 tags.json。
 */

import { create } from 'zustand';
import { get as apiGet, post as apiPost, put as apiPut, del as apiDel } from '../lib/api';

export interface SopDoc {
  id: string;
  originalName: string;
  ext: 'md' | 'docx' | 'xlsx';
  uploadedAt: string;
  size: number;
}

export interface SopChildTag {
  name: string;
  meaning: string;
  mustDo: string;
  mustNotDo: string;
}

export interface SopParentTag {
  name: string;
  children: SopChildTag[];
}

export interface SopTagsFile {
  version: 1;
  updatedAt: string;
  tags: SopParentTag[];
}

interface SopState {
  // 数据
  docs: SopDoc[];
  tags: SopParentTag[]; // 已确认
  draft: SopParentTag[] | null; // 草稿（null 表示无草稿）
  // UI
  loading: boolean;
  error: string | null;
  /** AI 生成草稿是否进行中（独立 loading 标记） */
  generating: boolean;

  // actions
  fetchDocs: () => Promise<void>;
  uploadDoc: (file: File) => Promise<{ ok: boolean; error?: string }>;
  deleteDoc: (id: string) => Promise<void>;

  fetchTags: () => Promise<void>;
  saveTags: (tags: SopParentTag[]) => Promise<{ ok: boolean; error?: string }>;
  clearTags: () => Promise<void>;

  fetchDraft: () => Promise<void>;
  saveDraft: (tags: SopParentTag[]) => Promise<{ ok: boolean; error?: string }>;
  discardDraft: () => Promise<{ ok: boolean; error?: string }>;
  promoteDraft: () => Promise<{ ok: boolean; error?: string }>;
  /** 让 LLM 一次性生成草稿（替代旧的 SOP Designer Agent） */
  generateDraft: (instruction?: string) => Promise<{ ok: boolean; error?: string }>;
}

export const useSopStore = create<SopState>((set, _get) => ({
  docs: [],
  tags: [],
  draft: null,
  loading: false,
  error: null,
  generating: false,

  // ─── 文档 ───

  fetchDocs: async () => {
    set({ loading: true, error: null });
    try {
      const res = await apiGet<{ docs: SopDoc[] }>('/sop/docs');
      set({ docs: res.docs, loading: false });
    } catch (err) {
      set({ error: errMsg(err), loading: false });
    }
  },

  uploadDoc: async (file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      // 直接 fetch 走 multipart（apiPost 只支持 JSON）
      const res = await rawUpload('/sop/docs/upload', formData);
      if (!res.ok) {
        return { ok: false, error: res.error ?? '上传失败' };
      }
      // 重新拉取文档列表
      const list = await apiGet<{ docs: SopDoc[] }>('/sop/docs');
      set({ docs: list.docs });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  },

  deleteDoc: async (id: string) => {
    try {
      await apiDel<{ deleted: boolean }>(`/sop/docs/${id}`);
      const list = await apiGet<{ docs: SopDoc[] }>('/sop/docs');
      set({ docs: list.docs });
    } catch (err) {
      set({ error: errMsg(err) });
    }
  },

  // ─── 已确认标签 ───

  fetchTags: async () => {
    try {
      const res = await apiGet<SopTagsFile>('/sop/tags');
      set({ tags: res.tags });
    } catch (err) {
      set({ error: errMsg(err) });
    }
  },

  saveTags: async (tags) => {
    try {
      const res = await apiPut<SopTagsFile>('/sop/tags', { tags });
      set({ tags: res.tags });
      // 提交成功后自动清空草稿
      await apiDel<{ cleared: boolean }>('/sop/draft').catch(() => {});
      set({ draft: null });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  },

  clearTags: async () => {
    try {
      await apiDel<{ cleared: boolean }>('/sop/tags');
      set({ tags: [] });
    } catch (err) {
      set({ error: errMsg(err) });
    }
  },

  // ─── 草稿 ───

  fetchDraft: async () => {
    try {
      const res = await apiGet<{ draft: SopTagsFile | null }>('/sop/draft');
      set({ draft: res.draft?.tags ?? null });
    } catch (err) {
      set({ error: errMsg(err) });
    }
  },

  saveDraft: async (tags) => {
    try {
      const res = await apiPut<SopTagsFile>('/sop/draft', { tags });
      set({ draft: res.tags });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  },

  discardDraft: async () => {
    try {
      await apiDel<{ cleared: boolean }>('/sop/draft');
      set({ draft: null });
      return { ok: true };
    } catch (err) {
      const error = errMsg(err);
      set({ error });
      return { ok: false, error };
    }
  },

  promoteDraft: async () => {
    try {
      const res = await apiPost<{ promoted: boolean; tags: SopTagsFile }>('/sop/draft/promote');
      set({ tags: res.tags.tags, draft: null });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  },

  generateDraft: async (instruction) => {
    set({ generating: true, error: null });
    try {
      const res = await apiPost<{ draft: SopTagsFile; retryCount: number }>(
        '/sop/draft/generate',
        instruction ? { instruction } : {},
      );
      set({ draft: res.draft.tags, generating: false });
      return { ok: true };
    } catch (err) {
      set({ generating: false });
      return { ok: false, error: errMsg(err) };
    }
  },
}));

// ─── 辅助函数 ───

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Multipart upload 直接调用 fetch（绕过 apiFetch 的 JSON 序列化）
 * 复用 sidecar config 里的 token 和 baseUrl
 */
async function rawUpload(
  path: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const raw = localStorage.getItem('sidecar-config');
  if (!raw) {
    return { ok: false, error: 'Sidecar 未连接' };
  }
  const config = JSON.parse(raw) as { port: number; token: string };
  const url = `http://127.0.0.1:${config.port}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    return { ok: false, error: body.error || `HTTP ${res.status}` };
  }
  return { ok: true };
}
