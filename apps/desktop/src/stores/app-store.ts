import { create } from 'zustand';

interface AppState {
  /** Sidecar 连接状态 */
  sidecarConnected: boolean;
  /** 当前选中的 Agent ID */
  selectedAgentId: string | null;
  /** 侧边栏是否展开 */
  sidebarOpen: boolean;

  // Actions
  setSidecarConnected: (connected: boolean) => void;
  setSelectedAgentId: (id: string | null) => void;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  sidecarConnected: false,
  selectedAgentId: null,
  sidebarOpen: true,

  setSidecarConnected: (connected) => set({ sidecarConnected: connected }),
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}));
