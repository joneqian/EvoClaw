import { create } from 'zustand';

/** 应用初始化状态 */
export type InitState = 'loading' | 'needs-setup' | 'connected' | 'error';

/** 主题模式 */
export type ThemeMode = 'light' | 'dark';

interface AppState {
  /** Sidecar 连接状态 */
  sidecarConnected: boolean;
  /** 应用初始化状态 */
  initState: InitState;
  /** 当前选中的 Agent ID */
  selectedAgentId: string | null;
  /** 侧边栏是否展开 */
  sidebarOpen: boolean;
  /** 主题模式 */
  theme: ThemeMode;

  // Actions
  setSidecarConnected: (connected: boolean) => void;
  setInitState: (state: InitState) => void;
  setSelectedAgentId: (id: string | null) => void;
  toggleSidebar: () => void;
  toggleTheme: () => void;
  setTheme: (theme: ThemeMode) => void;
}

/** 从 localStorage 读取主题偏好 */
function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem('evoclaw-theme');
    if (stored === 'dark' || stored === 'light') return stored;
    // 跟随系统偏好
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch { /* SSR 安全 */ }
  return 'light';
}

export const useAppStore = create<AppState>((set) => ({
  sidecarConnected: false,
  initState: 'loading',
  selectedAgentId: null,
  sidebarOpen: true,
  theme: getStoredTheme(),

  setSidecarConnected: (connected) => set({ sidecarConnected: connected }),
  setInitState: (initState) => set({ initState }),
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'light' ? 'dark' : 'light';
      localStorage.setItem('evoclaw-theme', next);
      return { theme: next };
    }),
  setTheme: (theme) => {
    localStorage.setItem('evoclaw-theme', theme);
    set({ theme });
  },
}));
