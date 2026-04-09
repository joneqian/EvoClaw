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

interface MemoryState {
  /** 记忆单元列表 */
  units: MemoryUnit[];
  /** 搜索结果 */
  searchResults: SearchResult[];
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
  selectUnit: (unit: MemoryUnit | null) => void;
  clearSearch: () => void;
}

export const useMemoryStore = create<MemoryState>((set) => ({
  units: [],
  searchResults: [],
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
  // ─────────────────────────────────────────────────────────────────

  updateMemory: async (agentId, id, partial) => {
    await put(`/memory/${agentId}/units/${id}`, partial);
    // 本地状态即时更新（避免再 refetch 全量列表）
    set((state) => ({
      units: state.units.map((u) =>
        u.id === id
          ? {
              ...u,
              ...(partial.l1Overview !== undefined ? { l1Overview: partial.l1Overview } : {}),
              ...(partial.l2Content !== undefined ? { l2Content: partial.l2Content } : {}),
              updatedAt: new Date().toISOString(),
            }
          : u,
      ),
      selectedUnit:
        state.selectedUnit?.id === id
          ? {
              ...state.selectedUnit,
              ...(partial.l1Overview !== undefined ? { l1Overview: partial.l1Overview } : {}),
              ...(partial.l2Content !== undefined ? { l2Content: partial.l2Content } : {}),
              updatedAt: new Date().toISOString(),
            }
          : state.selectedUnit,
    }));
  },

  flagMemory: async (agentId, id, type, note) => {
    await post(`/memory/${agentId}/units/${id}/feedback`, { type, note });
    // 本地 confidence -= 0.15（与后端 CONFIDENCE_DECAY_STEP 同步），下限 0
    set((state) => {
      const decay = (c: number) => Math.max(0, c - 0.15);
      return {
        units: state.units.map((u) =>
          u.id === id ? { ...u, confidence: decay(u.confidence) } : u,
        ),
        selectedUnit:
          state.selectedUnit?.id === id
            ? { ...state.selectedUnit, confidence: decay(state.selectedUnit.confidence) }
            : state.selectedUnit,
      };
    });
  },

  selectUnit: (unit) => set({ selectedUnit: unit }),
  clearSearch: () => set({ searchResults: [] }),
}));
