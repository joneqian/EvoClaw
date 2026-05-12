/**
 * M15 PR-U1: 主题切换按钮（PR-U2: 改用 lucide-react）
 *
 * 三态轮换：light → dark → system → light
 * 显示当前模式图标 + tooltip
 *
 * 用法：放到 SettingsPage 顶部 或 任何全局位置
 */
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, type ThemeMode } from '../contexts/ThemeProvider';

const MODE_LABELS: Record<ThemeMode, string> = {
  light: '亮色',
  dark: '暗色',
  system: '跟随系统',
};

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

  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor;

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
      <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
