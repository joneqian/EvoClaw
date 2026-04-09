import { create } from 'zustand';
import { get as apiGet, post, del, put } from '../lib/api';

/** 记忆单元 */
export interface MemoryUnit {
  id: string;
  agentId: string;
  category: string;
  mergeType: string;
  mergeKey: string | null;
  l0Index: string;
  l1Overview: string;
  l2Content: string;
  confidence: number;
  activation: number;
  accessCount: number;
  visibility: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/** 搜索结果 */
export interface SearchResult {
  memoryId: string;
  l0Index: string;
  l1Overview: string;
  l2Content?: string;
  category: string;
  finalScore: number;
  activation: number;
}

/** 反馈类型 — Sprint 15.12 Phase C */
export type MemoryFeedbackType = 'inaccurate' | 'sensitive' | 'outdated';

/** 知识图谱关系三元组 — Sprint 15.12 Phase D */
export interface KnowledgeRelation {
  id: string;
  agentId: string;
  subjectId: string;
  relation: string;
  objectId: string;
  confidence: number;
  createdAt: string;
}

/** AutoDream 整合运行记录 — Sprint 15.12 Phase D */
export interface ConsolidationRun {
  id: string;
  agentId: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  memoriesMerged: number;
  memoriesPruned: number;
  memoriesCreated: number;
  errorMessage: string | null;
}

/** 会话摘要记录 — Sprint 15.12 Phase D */
export interface SessionSummary {
  id: string;
  agentId: string;
  sessionKey: string;
  summaryMarkdown: string;
  tokenCountAt: number;
  turnCountAt: number;
  toolCallCountAt: number;
  createdAt: string;
  updatedAt: string;
}

interface MemoryState {
  /** 记忆单元列表 */
  units: MemoryUnit[];
  /** 搜索结果 */
  searchResults: SearchResult[];
  /** 知识图谱关系列表 — Phase D */
  knowledgeRelations: KnowledgeRelation[];
  /** AutoDream 整合历史 — Phase D */
  consolidations: ConsolidationRun[];
  /** 会话摘要列表 — Phase D */
  sessionSummaries: SessionSummary[];
  /** 是否正在加载 */
  loading: boolean;
  /** 当前选中的记忆单元 */
  selectedUnit: MemoryUnit | null;

  fetchUnits: (agentId: string, category?: string) => Promise<void>;
  searchMemories: (agentId: string, query: string) => Promise<void>;
  pinMemory: (agentId: string, id: string) => Promise<void>;
  unpinMemory: (agentId: string, id: string) => Promise<void>;
  deleteMemory: (agentId: string, id: string) => Promise<void>;
  deleteMemories: (agentId: string, ids: string[]) => Promise<void>;
  /** Phase C: 更新 L1/L2（L0 锁死）*/
  updateMemory: (agentId: string, id: string, partial: { l1Overview?: string; l2Content?: string }) => Promise<void>;
  /** Phase C: 提交反馈（不准确/涉及隐私/过时）*/
  flagMemory: (agentId: string, id: string, type: MemoryFeedbackType, note?: string) => Promise<void>;
  /** Phase D: 拉取知识图谱关系 */
  fetchKnowledgeGraph: (agentId: string, limit?: number) => Promise<void>;
  /** Phase D: 拉取 AutoDream 整合历史 */
  fetchConsolidations: (agentId: string, limit?: number) => Promise<void>;
  /** Phase D: 拉取会话摘要列表 */
  fetchSessionSummaries: (agentId: string, limit?: number) => Promise<void>;
  selectUnit: (unit: MemoryUnit | null) => void;
  clearSearch: () => void;
}

export const useMemoryStore = create<MemoryState>((set) => ({
  units: [],
  searchResults: [],
  knowledgeRelations: [],
  consolidations: [],
  sessionSummaries: [],
  loading: false,
  selectedUnit: null,

  fetchUnits: async (agentId, category) => {
    set({ loading: true });
    try {
      const params = category ? `?category=${category}` : '';
      const data = await apiGet<{ units: MemoryUnit[] }>(`/memory/${agentId}/units${params}`);
      set({ units: data.units ?? [] });
    } catch (err) {
      console.error('获取记忆失败:', err);
    } finally {
      set({ loading: false });
    }
  },

  searchMemories: async (agentId, query) => {
    set({ loading: true });
    try {
      const data = await post<{ results: SearchResult[] }>(`/memory/${agentId}/search`, { query });
      set({ searchResults: data.results ?? [] });
    } catch (err) {
      console.error('搜索记忆失败:', err);
    } finally {
      set({ loading: false });
    }
  },

  pinMemory: async (agentId, id) => {
    await put(`/memory/${agentId}/units/${id}/pin`);
    // 刷新列表
    const data = await apiGet<{ units: MemoryUnit[] }>(`/memory/${agentId}/units`);
    set({ units: data.units ?? [] });
  },

  unpinMemory: async (agentId, id) => {
    await del(`/memory/${agentId}/units/${id}/pin`);
    // 刷新列表
    const data = await apiGet<{ units: MemoryUnit[] }>(`/memory/${agentId}/units`);
    set({ units: data.units ?? [] });
  },

  deleteMemory: async (agentId, id) => {
    await del(`/memory/${agentId}/units/${id}`);
    set((state) => ({ units: state.units.filter((u) => u.id !== id) }));
  },

  deleteMemories: async (agentId, ids) => {
    if (ids.length === 0) return;
    await post(`/memory/${agentId}/units/batch-delete`, { ids });
    const idSet = new Set(ids);
    set((state) => ({ units: state.units.filter((u) => !idSet.has(u.id)) }));
  },

  // ─────────────────────────────────────────────────────────────────
  // Sprint 15.12 Phase C — 编辑 + 反馈
  //
  // 写后端 → 立即从后端拉单条最新 unit 替换本地状态。
  // 不做乐观更新（之前用 set 手动改 confidence 在某些 React/Zustand 路径
  // 下不触发 rerender，直接从后端拉是最稳的）。
  // ─────────────────────────────────────────────────────────────────

  updateMemory: async (agentId, id, partial) => {
    await put(`/memory/${agentId}/units/${id}`, partial);
    const fresh = await apiGet<{ unit: MemoryUnit }>(`/memory/${agentId}/units/${id}`);
    set((state) => ({
      units: state.units.map((u) => (u.id === id ? fresh.unit : u)),
      selectedUnit: state.selectedUnit?.id === id ? fresh.unit : state.selectedUnit,
    }));
  },

  flagMemory: async (agentId, id, type, note) => {
    await post(`/memory/${agentId}/units/${id}/feedback`, { type, note });
    const fresh = await apiGet<{ unit: MemoryUnit }>(`/memory/${agentId}/units/${id}`);
    set((state) => ({
      units: state.units.map((u) => (u.id === id ? fresh.unit : u)),
      selectedUnit: state.selectedUnit?.id === id ? fresh.unit : state.selectedUnit,
    }));
  },

  // ─────────────────────────────────────────────────────────────────
  // Sprint 15.12 Phase D — 知识图谱 / 整理历史 / 会话摘要
  // ─────────────────────────────────────────────────────────────────

  fetchKnowledgeGraph: async (agentId, limit = 100) => {
    set({ loading: true });
    try {
      const data = await apiGet<{ relations: KnowledgeRelation[] }>(
        `/memory/${agentId}/knowledge-graph?limit=${limit}`,
      );
      set({ knowledgeRelations: data.relations ?? [] });
    } catch (err) {
      console.error('获取知识图谱失败:', err);
      set({ knowledgeRelations: [] });
    } finally {
      set({ loading: false });
    }
  },

  fetchConsolidations: async (agentId, limit = 50) => {
    set({ loading: true });
    try {
      const data = await apiGet<{ runs: ConsolidationRun[] }>(
        `/memory/${agentId}/consolidations?limit=${limit}`,
      );
      set({ consolidations: data.runs ?? [] });
    } catch (err) {
      console.error('获取整合历史失败:', err);
      set({ consolidations: [] });
    } finally {
      set({ loading: false });
    }
  },

  fetchSessionSummaries: async (agentId, limit = 50) => {
    set({ loading: true });
    try {
      const data = await apiGet<{ summaries: SessionSummary[] }>(
        `/memory/${agentId}/session-summaries?limit=${limit}`,
      );
      set({ sessionSummaries: data.summaries ?? [] });
    } catch (err) {
      console.error('获取会话摘要失败:', err);
      set({ sessionSummaries: [] });
    } finally {
      set({ loading: false });
    }
  },

  selectUnit: (unit) => set({ selectedUnit: unit }),
  clearSearch: () => set({ searchResults: [] }),
}));
