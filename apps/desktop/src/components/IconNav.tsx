/**
 * IconNav — 第一栏：纯图标垂直导航 (88px)
 *
 * M15 PR-U2: 改用 lucide-react 替代手写 SVG path（统一图标系统、a11y 友好）
 */

import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  MessageSquare,
  Sparkles,
  Users,
  Brain,
  Clock,
  ListChecks,
  Tag,
  RotateCcw,
  Plug,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useSopStore } from '../stores/sop-store';

interface NavItem {
  path: string;
  Icon: LucideIcon;
  labelKey: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { path: '/chat', Icon: MessageSquare, labelKey: 'nav.chat' },
  { path: '/skills', Icon: Sparkles, labelKey: 'nav.skills' },
  { path: '/agents', Icon: Users, labelKey: 'nav.agents' },
  { path: '/memory', Icon: Brain, labelKey: 'nav.memory' },
  { path: '/cron', Icon: Clock, labelKey: 'nav.cron' },
  { path: '/tasks', Icon: ListChecks, labelKey: 'nav.tasks' },
  { path: '/sop-tags', Icon: Tag, labelKey: 'nav.sopTags' },
  { path: '/checkpoints', Icon: RotateCcw, labelKey: 'nav.undo' },
  { path: '/channel', Icon: Plug, labelKey: 'nav.channel' },
  { path: '/security', Icon: ShieldCheck, labelKey: 'nav.security' },
] as const;

/** 判断是否是"对话"相关路由 */
function isChatRoute(pathname: string): boolean {
  return pathname === '/' || pathname === '/chat';
}

export default function IconNav() {
  const { t } = useTranslation();
  // 全局监听 SOP 草稿生成状态 — 用户离开 SOP 页后仍能感知到后台进度
  const sopGenerating = useSopStore((s) => s.generating);

  return (
    <nav
      className="w-[88px] bg-muted border-r border-border/60 flex flex-col items-center shrink-0 select-none"
      aria-label={t('nav.chat')}
    >
      {/* 顶部品牌 logo + 拖拽区域 */}
      <div className="h-[80px] shrink-0 flex items-center justify-center px-1" data-tauri-drag-region>
        <img
          src="/brand-header.png"
          alt="Logo"
          className="w-[72px] object-contain"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      </div>

      {/* 导航项 */}
      <div className="flex-1 flex flex-col items-center gap-2 px-1.5 pt-1">
        {NAV_ITEMS.map((item) => {
          const showSpinner = item.path === '/sop-tags' && sopGenerating;
          const label = t(item.labelKey);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              aria-label={label}
              className={({ isActive }) => {
                const active = isActive || (item.path === '/chat' && isChatRoute(window.location.pathname));
                return `relative w-[76px] flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl transition-all duration-150 ${
                  active
                    ? 'bg-brand/10 text-brand-active'
                    : 'text-foreground hover:bg-accent'
                }`;
              }}
            >
              <div className="relative">
                <item.Icon className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" />
                {showSpinner && (
                  <span
                    className="absolute -top-1 -right-1 w-3 h-3 border-2 border-brand/30 border-t-brand rounded-full animate-spin"
                  />
                )}
              </div>
              <span className="text-xs leading-tight font-medium">{label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
