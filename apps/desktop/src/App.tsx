import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { BRAND_NAME, BRAND_EVENT_PREFIX } from '@evoclaw/shared';
import ChatPage from './pages/ChatPage';
import AgentsPage from './pages/AgentsPage';
import MemoryPage from './pages/MemoryPage';
import KnowledgePage from './pages/KnowledgePage';
import SkillPage from './pages/SkillPage';
import SecurityPage from './pages/SecurityPage';
import SettingsPage from './pages/SettingsPage';
import ModelsPage from './pages/ModelsPage';
import EvolutionPage from './pages/EvolutionPage';
import ChannelPage from './pages/ChannelPage';
import SetupPage from './pages/SetupPage';
import CronPage from './pages/CronPage';
import AlertPage from './pages/AlertPage';
import SecurityGuardPage from './pages/SecurityGuardPage';
import AgentEditPage from './pages/AgentEditPage';
import AgentDetailPage from './pages/AgentDetailPage';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAppStore } from './stores/app-store';
import { initSidecar, healthCheck, get } from './lib/api';
import { useChatStore } from './stores/chat-store';
import AgentAvatar from './components/AgentAvatar';

// ─── SVG Icon 组件 ───

function Icon({ d, className = 'w-4 h-4', strokeWidth = 1.5 }: { d: string | readonly string[]; className?: string; strokeWidth?: number }) {
  const paths = Array.isArray(d) ? d : [d];
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={strokeWidth}>
      {paths.map((p, i) => (
        <path key={i} strokeLinecap="round" strokeLinejoin="round" d={p} />
      ))}
    </svg>
  );
}

// HeroIcons outline paths (24x24)
const ICON_PATHS = {
  plus: 'M12 4.5v15m7.5-7.5h-15',
  chat: 'M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z',
  agents: 'M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z',
  experts: ['M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z'],
  memory: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z',
  models: 'M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5M4.5 15.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z',
  channel: 'M9.348 14.652a3.75 3.75 0 010-5.304m5.304 0a3.75 3.75 0 010 5.304m-7.425 2.121a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z',
  skills: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
  evolution: ['M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75z', 'M9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625z', 'M16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z'],
  security: ['M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z'],
  knowledge: 'M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25',
  settings: ['M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z', 'M15 12a3 3 0 11-6 0 3 3 0 016 0z'],
  sun: ['M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z'],
  moon: 'M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z',
  chevronUp: 'M4.5 15.75l7.5-7.5 7.5 7.5',
  back: 'M15.75 19.5L8.25 12l7.5-7.5',
  cron: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  alert: ['M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0'],
  connect: ['M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244'],
  shield: ['M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z'],
} as const;

// ─── 类型 ───

interface RecentConversation {
  sessionKey: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  title: string;
  lastAt: string;
  messageCount: number;
}

// ─── 工具函数 ───

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  return new Date(dateStr).toLocaleDateString('zh-CN');
}

/** 侧栏主导航项样式 */
function navClassName({ isActive }: { isActive: boolean }): string {
  return `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 justify-start ${
    isActive
      ? 'bg-brand/10 text-brand-active'
      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
  }`;
}

// ─── 加载 / 错误状态 ───

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen bg-slate-50">
      <div className="text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-brand/20 to-brand/5
          flex items-center justify-center">
          <Icon d={ICON_PATHS.memory} className="w-6 h-6 text-brand" />
        </div>
        <p className="text-sm text-slate-400 font-medium">正在启动 {BRAND_NAME}...</p>
        <div className="mt-4 flex justify-center gap-1">
          <span className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse" />
          <span className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

function ErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center h-screen bg-slate-50">
      <div className="text-center max-w-sm">
        <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-red-50
          flex items-center justify-center">
          <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-slate-800 mb-1.5">连接失败</h2>
        <p className="text-sm text-slate-500 mb-5">
          无法连接到后端服务，请确保 Node.js 已安装。
        </p>
        <button
          onClick={onRetry}
          className="px-5 py-2 text-sm font-medium text-white bg-brand rounded-lg
            hover:bg-brand-hover active:bg-brand-active transition-colors"
        >
          重试连接
        </button>
      </div>
    </div>
  );
}

// ─── 底部弹出菜单 ───

interface MenuSection {
  items: { icon: string | readonly string[]; label: string; path: string }[];
}

const MENU_SECTIONS: MenuSection[] = [
  {
    items: [
      { icon: ICON_PATHS.models, label: '模型管理', path: '/models' },
    ],
  },
  {
    items: [
      { icon: ICON_PATHS.evolution, label: '进化统计', path: '/evolution' },
      { icon: ICON_PATHS.knowledge, label: '知识库', path: '/knowledge' },
      { icon: ICON_PATHS.security, label: '安全设置', path: '/security' },
    ],
  },
  {
    items: [
      { icon: ICON_PATHS.settings, label: '设置', path: '/settings' },
    ],
  },
];

function BottomMenu({
  open,
  onClose,
  onNavigate,
  sidecarConnected,
  onRestartSidecar,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
  sidecarConnected: boolean;
  onRestartSidecar: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      className="absolute top-full right-0 mt-1.5 w-52 bg-white
        border border-slate-200 rounded-xl shadow-lg shadow-slate-200/50
        overflow-hidden z-50"
    >
      {MENU_SECTIONS.map((section, si) => (
        <div key={si}>
          {si > 0 && <div className="border-t border-slate-100" />}
          <div className="py-1">
            {section.items.map((item) => (
              <button
                key={item.path}
                onClick={() => { onNavigate(item.path); onClose(); }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600
                  hover:bg-slate-50 transition-colors text-left"
              >
                <Icon d={item.icon} className="w-4 h-4 text-slate-400" />
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {/* Sidecar 状态 */}
      <div className="border-t border-slate-100 px-3.5 py-2.5 flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          sidecarConnected ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'
        }`} />
        <span className="text-xs text-slate-400 flex-1">
          Sidecar {sidecarConnected ? '已连接' : '未连接'}
        </span>
        {!sidecarConnected && (
          <button
            onClick={() => { onRestartSidecar(); onClose(); }}
            className="text-xs text-brand hover:text-brand-hover font-medium"
          >
            重启
          </button>
        )}
      </div>
    </div>
  );
}

// ─── 主应用 ───

export default function App() {
  const {
    sidecarConnected, setSidecarConnected,
    initState, setInitState,
  } = useAppStore();
  const { enterConversation, setCurrentAgent, clearMessages } = useChatStore();
  const navigate = useNavigate();
  const location = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [recentsPage, setRecentsPage] = useState(1);
  const [recentsHasMore, setRecentsHasMore] = useState(true);
  const [recentsLoading, setRecentsLoading] = useState(false);
  const [recents, setRecents] = useState<RecentConversation[]>([]);

  /** 手动重启 Sidecar */
  const handleRestartSidecar = useCallback(async () => {
    try {
      await invoke('restart_sidecar');
      setTimeout(async () => {
        const health = await initSidecar();
        if (health) setSidecarConnected(true);
      }, 3000);
    } catch (err) {
      console.error('重启 Sidecar 失败:', err);
    }
  }, [setSidecarConnected]);

  /** 初始化 Sidecar 连接 */
  const initialize = useCallback(async () => {
    setInitState('loading');
    const health = await initSidecar();
    if (!health) {
      setInitState('error');
      setSidecarConnected(false);
      return;
    }
    setSidecarConnected(true);
    if (health.status === 'needs-setup') {
      setInitState('needs-setup');
      navigate('/setup');
    } else {
      setInitState('connected');
    }
  }, [setInitState, setSidecarConnected, navigate]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const PAGE_SIZE = 20;

  /** 加载会话列表（首次或刷新） */
  const fetchRecents = useCallback(async () => {
    try {
      const res = await get<{ conversations: RecentConversation[] }>(`/chat/recents?limit=${PAGE_SIZE}`);
      setRecents(res.conversations);
      setRecentsPage(1);
      setRecentsHasMore(res.conversations.length >= PAGE_SIZE);
    } catch { /* Sidecar 可能未就绪 */ }
  }, []);

  /** 加载更多（滚动触发） */
  const fetchMoreRecents = useCallback(async () => {
    if (recentsLoading || !recentsHasMore) return;
    setRecentsLoading(true);
    try {
      const offset = recentsPage * PAGE_SIZE;
      const res = await get<{ conversations: RecentConversation[] }>(`/chat/recents?limit=${PAGE_SIZE}&offset=${offset}`);
      if (res.conversations.length > 0) {
        setRecents(prev => [...prev, ...res.conversations]);
        setRecentsPage(p => p + 1);
      }
      setRecentsHasMore(res.conversations.length >= PAGE_SIZE);
    } catch { /* ignore */ }
    setRecentsLoading(false);
  }, [recentsPage, recentsLoading, recentsHasMore]);

  useEffect(() => {
    if (initState === 'connected') fetchRecents();
  }, [initState, fetchRecents]);

  useEffect(() => {
    if (initState === 'connected' && location.pathname !== '/chat') {
      fetchRecents();
    }
  }, [location.pathname, initState, fetchRecents]);

  // 监听对话删除事件，刷新侧边栏
  useEffect(() => {
    const handler = () => fetchRecents();
    window.addEventListener(`${BRAND_EVENT_PREFIX}:conversations-changed`, handler);
    return () => window.removeEventListener(`${BRAND_EVENT_PREFIX}:conversations-changed`, handler);
  }, [fetchRecents]);

  /** 定期健康检查 */
  const reconnectAttempts = useRef(0);
  useEffect(() => {
    if (initState !== 'connected') return;
    const timer = setInterval(async () => {
      const health = await healthCheck();
      if (health) {
        setSidecarConnected(true);
        reconnectAttempts.current = 0;
      } else {
        setSidecarConnected(false);
        if (reconnectAttempts.current < 5) {
          reconnectAttempts.current++;
          const newHealth = await initSidecar();
          if (newHealth) {
            setSidecarConnected(true);
            reconnectAttempts.current = 0;
          }
        }
      }
    }, 5_000);
    return () => clearInterval(timer);
  }, [initState, setSidecarConnected]);

  /** 点击最近会话 */
  const handleRecentClick = useCallback((conv: RecentConversation) => {
    enterConversation(conv.agentId, conv.sessionKey);
    navigate('/chat');
  }, [enterConversation, navigate]);

  // 加载中 / 错误
  if (initState === 'loading') return <LoadingScreen />;
  if (initState === 'error') return <ErrorScreen onRetry={initialize} />;
  if (location.pathname === '/setup') {
    return <Routes><Route path="/setup" element={<SetupPage />} /></Routes>;
  }

  const appWindow = getCurrentWindow();

  return (
    <div className="flex flex-col h-screen bg-white text-slate-900">
      <div className="flex flex-1 min-h-0">
      {/* ─── Sidebar ─── */}
      <nav
        className="bg-[#fafafa] border-r border-slate-200/60
          flex flex-col shrink-0 select-none transition-all duration-200"
        style={{ width: sidebarCollapsed ? 54 : sidebarWidth }}
      >

        {/* 菜单缩放按钮 + 品牌 Logo + 拖拽区域 */}
        <div className="h-[60px] shrink-0 flex items-center px-2 gap-1" data-tauri-drag-region>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-8 h-8 flex items-center justify-center text-slate-400
              hover:bg-slate-200/60 hover:text-slate-600 rounded-lg transition-colors shrink-0"
            title={sidebarCollapsed ? '展开菜单' : '收起菜单'}
          >
            <svg className={`w-[18px] h-[18px] transition-transform duration-200 ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
            </svg>
          </button>
          {!sidebarCollapsed && (
            <img
              src="/brand-header.png"
              alt={BRAND_NAME}
              className="h-11 object-contain pointer-events-none"
              onLoad={(e) => {
                const img = e.currentTarget;
                // 根据图片实际渲染宽度计算侧栏宽度：汉堡按钮(32) + gap(4) + 图片宽度 + 右边距(16)
                const imgWidth = img.offsetWidth;
                const computed = 32 + 4 + imgWidth + 16;
                // 限制在合理范围内
                const clamped = Math.max(200, Math.min(320, computed));
                setSidebarWidth(clamped);
              }}
            />
          )}
        </div>

        {/* 新建对话按钮 */}
        <div className={`${sidebarCollapsed ? 'px-1.5' : 'px-3'} mb-2`}>
          <button
            onClick={() => {
              setCurrentAgent(null);
              clearMessages();
              navigate('/chat');
            }}
            className={`w-full flex items-center justify-center gap-2.5 py-2.5
              text-sm font-semibold text-slate-700
              bg-white border border-slate-200 rounded-xl shadow-sm
              hover:shadow hover:border-slate-300 transition-all duration-150`}
            title="新建对话"
          >
            <svg className="w-5 h-5 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" d="M12 8.5v7M8.5 12h7" />
            </svg>
            {!sidebarCollapsed && '新建对话'}
          </button>
        </div>

        {/* 主导航 */}
        <div className={`${sidebarCollapsed ? 'px-1.5' : 'px-3'} space-y-0.5`}>
          <NavLink to="/skills" className={navClassName} title="技能商店">
            <Icon d={ICON_PATHS.skills} className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && '技能商店'}
          </NavLink>
          <NavLink to="/agents" className={navClassName} title="专家中心">
            <Icon d={ICON_PATHS.experts} className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && '专家中心'}
          </NavLink>
          <NavLink to="/memory" className={navClassName} title="记忆">
            <Icon d={ICON_PATHS.memory} className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && '记忆'}
          </NavLink>
          <NavLink to="/cron" className={navClassName} title="定时任务">
            <Icon d={ICON_PATHS.cron} className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && '定时任务'}
          </NavLink>
          <NavLink to="/alert" className={navClassName} title="预警中心">
            <Icon d={ICON_PATHS.alert} className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && '预警中心'}
          </NavLink>
          <NavLink to="/channel" className={navClassName} title="连接">
            <Icon d={ICON_PATHS.connect} className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && '连接'}
          </NavLink>
          <NavLink to="/security-guard" className={navClassName} title="安全防护">
            <Icon d={ICON_PATHS.shield} className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && '安全防护'}
          </NavLink>
        </div>

        {/* 分割线 */}
        <div className={`${sidebarCollapsed ? 'mx-1.5' : 'mx-3'} my-2 border-t border-slate-200/60`} />

        {/* 所有对话（收起时隐藏） */}
        <div className={`flex-1 overflow-hidden flex flex-col min-h-0 ${sidebarCollapsed ? 'hidden' : ''}`}>
          <div className="px-3 mb-1">
            <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase">
              所有对话
            </span>
          </div>
          <div
            className="flex-1 overflow-y-auto px-2"
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
                fetchMoreRecents();
              }
            }}
          >
            {recents.length === 0 ? (
              <p className="px-2.5 py-3 text-xs text-slate-400">暂无对话</p>
            ) : (
              <div className="space-y-0.5">
                {recents.map((conv) => (
                  <button
                    key={conv.sessionKey}
                    onClick={() => handleRecentClick(conv)}
                    className="w-full text-left px-2.5 py-2 rounded-lg text-slate-500
                      hover:bg-slate-100 transition-all duration-150 group"
                    title={`${conv.agentName} — ${conv.title}`}
                  >
                    <div className="truncate leading-snug flex items-center gap-1.5">
                      <AgentAvatar name={conv.agentName} size="xs" className="shrink-0" />
                      <span className="text-slate-600 group-hover:text-slate-800 transition-colors truncate text-sm font-medium">
                        {conv.title}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 pl-[26px] truncate">
                      {formatRelativeTime(conv.lastAt)}
                    </div>
                  </button>
                ))}
                {recentsLoading && (
                  <div className="py-2 flex justify-center">
                    <span className="w-4 h-4 border-2 border-slate-300 border-t-brand rounded-full animate-spin" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

      </nav>

      {/* ─── Main content ─── */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* 顶部标题栏：拖拽区域 + 个人中心 + 窗口控制 */}
        <div className="h-[42px] shrink-0 flex items-center justify-end" data-tauri-drag-region>
          <div className="flex items-center">
            {/* 头像 */}
            <div className="w-10 h-[42px] flex items-center justify-center">
              <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center">
                <svg className="w-4 h-4 text-slate-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                </svg>
              </div>
            </div>

            {/* 个人中心（点击展开菜单） */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="w-10 h-[42px] flex items-center justify-center text-slate-400
                  hover:bg-slate-100 hover:text-slate-600 transition-colors"
                title="个人中心"
              >
                <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="5" cy="6" r="1.5" fill="currentColor" stroke="none" />
                  <path strokeLinecap="round" d="M10 6h10" />
                  <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
                  <path strokeLinecap="round" d="M10 12h10" />
                  <circle cx="5" cy="18" r="1.5" fill="currentColor" stroke="none" />
                  <path strokeLinecap="round" d="M10 18h10" />
                </svg>
              </button>
              <BottomMenu
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                onNavigate={(path) => { setMenuOpen(false); navigate(path); }}
                sidecarConnected={sidecarConnected}
                onRestartSidecar={handleRestartSidecar}
              />
            </div>

            {/* 最小化 */}
            <button
              onClick={() => appWindow.minimize()}
              className="w-10 h-[42px] flex items-center justify-center text-slate-400
                hover:bg-slate-100 hover:text-slate-600 transition-colors"
              title="最小化"
            >
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M5 12h14" />
              </svg>
            </button>

            {/* 最大化 */}
            <button
              onClick={() => appWindow.toggleMaximize()}
              className="w-10 h-[42px] flex items-center justify-center text-slate-400
                hover:bg-slate-100 hover:text-slate-600 transition-colors"
              title="最大化"
            >
              <svg className="w-[14px] h-[14px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="4" y="4" width="16" height="16" rx="1" />
              </svg>
            </button>

            {/* 关闭 */}
            <button
              onClick={() => appWindow.close()}
              className="w-10 h-[42px] flex items-center justify-center text-slate-400
                hover:bg-red-500 hover:text-white transition-colors"
              title="关闭"
            >
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:id" element={<AgentDetailPage />} />
          <Route path="/agents/:id/edit" element={<AgentEditPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/skills" element={<SkillPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/evolution" element={<EvolutionPage />} />
          <Route path="/cron" element={<CronPage />} />
          <Route path="/alert" element={<AlertPage />} />
          <Route path="/channel" element={<ChannelPage />} />
          <Route path="/security-guard" element={<SecurityGuardPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/setup" element={<SetupPage />} />
        </Routes>
        </div>
      </main>
      </div>
    </div>
  );
}
