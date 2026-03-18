import { create } from 'zustand';

/** 应用初始化状态 */
export type InitState = 'loading' | 'needs-setup' | 'connected' | 'error';

interface AppState {
  /** Sidecar 连接状态 */
  sidecarConnected: boolean;
  /** 应用初始化状态 */
  initState: InitState;
  /** 当前选中的 Agent ID */
  selectedAgentId: string | null;
  /** 侧边栏是否展开 */
  sidebarOpen: boolean;

  // Actions
  setSidecarConnected: (connected: boolean) => void;
  setInitState: (state: InitState) => void;
  setSelectedAgentId: (id: string | null) => void;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  sidecarConnected: false,
  initState: 'loading',
  selectedAgentId: null,
  sidebarOpen: true,

  setSidecarConnected: (connected) => set({ sidecarConnected: connected }),
  setInitState: (initState) => set({ initState }),
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}));
