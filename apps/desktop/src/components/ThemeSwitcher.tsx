/**
 * M15 PR-U1: 主题切换按钮
 *
 * 三态轮换：light → dark → system → light
 * 显示当前模式图标 + tooltip
 *
 * 用法：放到 SettingsPage 顶部 或 任何全局位置
 */
import { useTheme, type ThemeMode } from '../contexts/ThemeProvider';

const MODE_LABELS: Record<ThemeMode, string> = {
  light: '亮色',
  dark: '暗色',
  system: '跟随系统',
};

function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <circle cx="12" cy="12" r="4" />
      <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

function SystemIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path strokeLinecap="round" d="M8 21h8M12 17v4" />
    </svg>
  );
}

const NEXT_MODE: Record<ThemeMode, ThemeMode> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};

interface ThemeSwitcherProps {
  className?: string;
}

export default function ThemeSwitcher({ className = '' }: ThemeSwitcherProps) {
  const { mode, setMode } = useTheme();

  const Icon = mode === 'light' ? SunIcon : mode === 'dark' ? MoonIcon : SystemIcon;

  return (
    <button
      type="button"
      onClick={() => setMode(NEXT_MODE[mode])}
      title={`主题：${MODE_LABELS[mode]}（点击切换）`}
      aria-label={`切换主题，当前为${MODE_LABELS[mode]}`}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-lg
        text-muted-foreground hover:text-foreground hover:bg-accent
        transition-colors ${className}`}
    >
      <Icon className="w-[18px] h-[18px]" />
    </button>
  );
}
