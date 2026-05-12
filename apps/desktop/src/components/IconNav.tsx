/**
 * IconNav — 第一栏：纯图标垂直导航 (88px)
 *
 * M15 PR-U2: 改用 lucide-react 替代手写 SVG path（统一图标系统、a11y 友好）
 */

import { NavLink } from 'react-router-dom';
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
  label: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { path: '/chat', Icon: MessageSquare, label: '对话' },
  { path: '/skills', Icon: Sparkles, label: '技能商店' },
  { path: '/agents', Icon: Users, label: '专家中心' },
  { path: '/memory', Icon: Brain, label: '记忆' },
  { path: '/cron', Icon: Clock, label: '定时任务' },
  { path: '/tasks', Icon: ListChecks, label: '后台任务' },
  { path: '/sop-tags', Icon: Tag, label: 'SOP 标签' },
  { path: '/checkpoints', Icon: RotateCcw, label: '撤销改动' },
  { path: '/channel', Icon: Plug, label: '连接' },
  { path: '/security', Icon: ShieldCheck, label: '安全中心' },
] as const;

/** 判断是否是"对话"相关路由 */
function isChatRoute(pathname: string): boolean {
  return pathname === '/' || pathname === '/chat';
}

export default function IconNav() {
  // 全局监听 SOP 草稿生成状态 — 用户离开 SOP 页后仍能感知到后台进度
  const sopGenerating = useSopStore((s) => s.generating);

  return (
    <nav
      className="w-[88px] bg-muted border-r border-border/60 flex flex-col items-center shrink-0 select-none"
      aria-label="主导航"
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
          return (
            <NavLink
              key={item.path}
              to={item.path}
              aria-label={item.label}
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
                    title="AI 正在生成 SOP 标签草稿"
                  />
                )}
              </div>
              <span className="text-xs leading-tight font-medium">{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
