/**
 * IconNav — 第一栏：纯图标垂直导航 (54px)
 */

import { NavLink } from 'react-router-dom';

// ─── SVG Icon 组件 ───

function Icon({ d, className = 'w-5 h-5', strokeWidth = 1.5 }: { d: string | readonly string[]; className?: string; strokeWidth?: number }) {
  const paths = Array.isArray(d) ? d : [d];
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={strokeWidth}>
      {paths.map((p, i) => (
        <path key={i} strokeLinecap="round" strokeLinejoin="round" d={p} />
      ))}
    </svg>
  );
}

const ICON_PATHS = {
  chat: 'M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z',
  skills: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
  experts: ['M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z'],
  cron: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  connect: ['M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244'],
  memory: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z',
  shield: ['M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z'],
  settings: ['M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z', 'M15 12a3 3 0 11-6 0 3 3 0 016 0z'],
} as const;

/** 导航配置 */
const NAV_ITEMS = [
  { path: '/chat', icon: ICON_PATHS.chat, label: '对话' },
  { path: '/skills', icon: ICON_PATHS.skills, label: '技能商店' },
  { path: '/agents', icon: ICON_PATHS.experts, label: '专家中心' },
  { path: '/memory', icon: ICON_PATHS.memory, label: '记忆' },
  { path: '/cron', icon: ICON_PATHS.cron, label: '定时任务' },
  { path: '/channel', icon: ICON_PATHS.connect, label: '连接' },
  { path: '/security', icon: ICON_PATHS.shield, label: '安全中心' },
] as const;

interface IconNavProps {}

/** 判断是否是"对话"相关路由 */
function isChatRoute(pathname: string): boolean {
  return pathname === '/' || pathname === '/chat';
}

export default function IconNav(_props: IconNavProps) {
  return (
    <nav className="w-[88px] bg-[#fafafa] border-r border-slate-200/60 flex flex-col items-center shrink-0 select-none">
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
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => {
              const active = isActive || (item.path === '/chat' && isChatRoute(window.location.pathname));
              return `w-[76px] flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl transition-all duration-150 ${
                active
                  ? 'bg-brand/10 text-brand-active'
                  : 'text-slate-700 hover:bg-slate-100'
              }`;
            }}
          >
            <Icon d={item.icon} className="w-6 h-6" />
            <span className="text-xs leading-tight font-medium">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
