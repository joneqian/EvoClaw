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

  selectUnit: (unit) => set({ selectedUnit: unit }),
  clearSearch: () => set({ searchResults: [] }),
}));
