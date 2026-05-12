/**
 * M15 PR-U1: 主题切换上下文
 *
 * 提供 light / dark / system 三态切换：
 *   - light: 强制亮色
 *   - dark: 强制暗色
 *   - system: 跟随系统 prefers-color-scheme（默认）
 *
 * 状态持久化：localStorage key = `evoclaw:theme` / `healthclaw:theme`
 * 主题落地：写入 `<html data-theme="dark|light">`，触发 CSS variables 切换
 *
 * 详见 docs/architecture/design-system.md
 */
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { BRAND_NAME } from '@evoclaw/shared';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  /** 用户选择的模式（含 system）*/
  mode: ThemeMode;
  /** 实际生效的主题（system 已解析为 light/dark） */
  resolved: ResolvedTheme;
  /** 切换主题 */
  setMode: (mode: ThemeMode) => void;
}

const STORAGE_KEY = `${BRAND_NAME.toLowerCase()}:theme`;
const VALID_MODES: ThemeMode[] = ['light', 'dark', 'system'];

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && VALID_MODES.includes(stored as ThemeMode)) {
      return stored as ThemeMode;
    }
  } catch {
    // localStorage 不可用（隐私模式等）— 忽略
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolved);
}

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readStoredMode()));

  // 初次挂载 + mode 变化时应用主题
  useEffect(() => {
    const next = resolveTheme(mode);
    setResolved(next);
    applyTheme(next);
  }, [mode]);

  // 监听系统主题变化（仅当 mode = 'system' 时生效）
  useEffect(() => {
    if (mode !== 'system') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      const next: ResolvedTheme = e.matches ? 'dark' : 'light';
      setResolved(next);
      applyTheme(next);
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 忽略
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme 必须在 ThemeProvider 内使用');
  }
  return ctx;
}
