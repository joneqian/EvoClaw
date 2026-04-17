import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
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
import AgentEditPage from './pages/AgentEditPage';
import TasksPage from './pages/TasksPage';
import SopTagsPage from './pages/SopTagsPage';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from './stores/app-store';
import { initSidecar, healthCheck, get, del, syncPermissionsToRust } from './lib/api';
import { useChatStore } from './stores/chat-store';
import { useAgentStore } from './stores/agent-store';
import IconNav from './components/IconNav';
import ExpertPanel from './components/ExpertPanel';
import AgentCreationModal from './components/AgentCreationModal';
import TaskBadge from './components/TaskBadge';
import { useTasksStore } from './stores/tasks-store';
import CommandPalette from './components/CommandPalette';
import { useGlobalHotkey } from './hooks/useGlobalHotkey';

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
  memory: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z',
  models: 'M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5M4.5 15.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z',
  evolution: ['M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75z', 'M9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625z', 'M16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z'],
  knowledge: 'M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25',
  settings: ['M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z', 'M15 12a3 3 0 11-6 0 3 3 0 016 0z'],
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
      className="w-52 bg-white border border-slate-200 rounded-xl shadow-lg shadow-slate-200/50 overflow-hidden"
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

// ─── 工具函数 ───

/** 是否在对话路由上 */
function isChatRoute(pathname: string): boolean {
  return pathname === '/' || pathname === '/chat';
}

// ─── 主应用 ───

export default function App() {
  const {
    sidecarConnected, setSidecarConnected,
    initState, setInitState,
  } = useAppStore();
  const { enterConversation, newConversation } = useChatStore();
  const navigate = useNavigate();
  const location = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLDivElement>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [recentsPage, setRecentsPage] = useState(1);
  const [recentsHasMore, setRecentsHasMore] = useState(true);
  const [recentsLoading, setRecentsLoading] = useState(false);
  const [recents, setRecents] = useState<RecentConversation[]>([]);

  // M3-T3c: Cmd+K / Ctrl+K 打开命令面板
  useGlobalHotkey('mod+k', (e) => {
    e.preventDefault();
    setCommandPaletteOpen((v) => !v);
  });

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
      syncPermissionsToRust().catch(() => {});
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

  // 全局任务轮询 — 支撑顶部 TaskBadge + 后续 TasksPage 共享数据
  useEffect(() => {
    if (initState !== 'connected') return;
    const { startPolling, stopPolling } = useTasksStore.getState();
    startPolling(5000);
    return () => stopPolling();
  }, [initState]);

  useEffect(() => {
    if (initState === 'connected' && !isChatRoute(location.pathname)) {
      fetchRecents();
    }
  }, [location.pathname, initState, fetchRecents]);

  // 监听对话删除事件，刷新列表
  useEffect(() => {
    const handler = () => fetchRecents();
    window.addEventListener(`${BRAND_EVENT_PREFIX}:conversations-changed`, handler);
    return () => window.removeEventListener(`${BRAND_EVENT_PREFIX}:conversations-changed`, handler);
  }, [fetchRecents]);

  // Tauri IPC 事件监听 — 通过原生通道接收 Sidecar 事件（绕过 WKWebView HTTP 限制）
  useEffect(() => {
    if (initState !== 'connected') return;

    const unlisten = listen<Record<string, unknown>>('conversations-changed', (e) => {
      fetchRecents();
      useChatStore.getState().handleConversationChanged(e.payload as any);
    });

    return () => { unlisten.then(fn => fn()); };
  }, [initState, fetchRecents]);

  /** 健康检查（30s 周期，仅检测 Sidecar 存活 + 自动重连） */
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
    }, 30_000); // 从 5s 放宽到 30s（SSE 是主通道，轮询仅兜底）
    return () => clearInterval(timer);
  }, [initState, setSidecarConnected, fetchRecents]);

  /** 点击最近会话 */
  const handleRecentClick = useCallback((conv: RecentConversation) => {
    enterConversation(conv.agentId, conv.sessionKey);
    navigate('/chat');
  }, [enterConversation, navigate]);

  /** 删除最近会话 */
  const handleDeleteRecent = useCallback(async (conv: RecentConversation, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await del(`/chat/${conv.agentId}/conversations?sessionKey=${encodeURIComponent(conv.sessionKey)}`);
      setRecents(prev => prev.filter(c => c.sessionKey !== conv.sessionKey));
    } catch (err) {
      console.error('删除会话失败:', err);
    }
  }, []);

  const { deleteAgent } = useAgentStore();

  const [deleteConfirm, setDeleteConfirm] = useState<{ agentId: string; agentName: string } | null>(null);

  /** 点击删除 → 弹出确认 */
  const handleDeleteAgent = useCallback((agentId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const agent = useAgentStore.getState().agents.find(a => a.id === agentId);
    setDeleteConfirm({ agentId, agentName: agent?.name ?? agentId });
  }, []);

  /** 确认删除专家 + 关联的所有会话 */
  const confirmDeleteAgent = useCallback(async () => {
    if (!deleteConfirm) return;
    const { agentId } = deleteConfirm;
    try {
      const agentRecents = recents.filter(c => c.agentId === agentId);
      for (const conv of agentRecents) {
        await del(`/chat/${conv.agentId}/conversations?sessionKey=${encodeURIComponent(conv.sessionKey)}`);
      }
      setRecents(prev => prev.filter(c => c.agentId !== agentId));
      await deleteAgent(agentId);
    } catch (err) {
      console.error('删除专家失败:', err);
    } finally {
      setDeleteConfirm(null);
    }
  }, [deleteConfirm, recents, deleteAgent]);

  // 加载中 / 错误
  if (initState === 'loading') return <LoadingScreen />;
  if (initState === 'error') return <ErrorScreen onRetry={initialize} />;
  if (location.pathname === '/setup') {
    return <Routes><Route path="/setup" element={<SetupPage />} /></Routes>;
  }

  const appWindow = getCurrentWindow();
  const showExpertPanel = isChatRoute(location.pathname);

  return (
    <div className="flex flex-col h-screen bg-white text-slate-900">
      {/* 删除专家确认弹窗 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={() => setDeleteConfirm(null)}
        >
          <div className="bg-white rounded-xl shadow-xl p-6 w-[360px]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-800 mb-2">确认删除</h3>
            <p className="text-sm text-slate-500 mb-5">
              确定要删除专家「{deleteConfirm.agentName}」吗？该专家的所有会话记录也将一并删除，此操作不可撤销。
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg
                  hover:bg-slate-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmDeleteAgent}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg
                  hover:bg-red-600 transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 设置菜单（fixed 定位，避免被裁切） */}
      {menuOpen && menuBtnRef.current && (
        <div
          className="fixed z-[100]"
          style={{
            top: `${menuBtnRef.current.getBoundingClientRect().bottom + 4}px`,
            right: `${window.innerWidth - menuBtnRef.current.getBoundingClientRect().right}px`,
          }}
        >
          <BottomMenu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            onNavigate={(path) => { setMenuOpen(false); navigate(path); }}
            sidecarConnected={sidecarConnected}
            onRestartSidecar={handleRestartSidecar}
          />
        </div>
      )}

      {/* 创建专家弹窗（全局） */}
      <AgentCreationModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={(agentId) => {
          setShowCreateModal(false);
          newConversation(agentId);
          navigate('/chat');
        }}
      />

      {/* 命令面板（M3-T3c，Cmd+K / Ctrl+K 打开） */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />
      <div className="flex flex-1 min-h-0">
        {/* ─── Column 1: Icon Navigation (54px) ─── */}
        <IconNav />

        {/* ─── Column 2: Expert Panel (240px, only on chat route) ─── */}
        {showExpertPanel && (
          <ExpertPanel
            recents={recents}
            recentsLoading={recentsLoading}
            onRecentClick={handleRecentClick}
            onDeleteRecent={handleDeleteRecent}
            onLoadMoreRecents={fetchMoreRecents}
            onCreateAgent={() => setShowCreateModal(true)}
            onDeleteAgent={handleDeleteAgent}
          />
        )}

        {/* ─── Column 3: Main content ─── */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {/* 顶部标题栏 */}
          <div className="h-[42px] shrink-0 flex items-center justify-end" data-tauri-drag-region>
            {/* 后台任务 pill（仅当有活跃任务时显示） */}
            <TaskBadge />

            <div className="flex items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              {/* 品牌头像 */}
              <div className="w-10 h-[42px] flex items-center justify-center">
                <img src="/brand-icon.png" alt={BRAND_NAME} className="w-5 h-5 rounded-full object-cover" />
              </div>

              {/* 菜单按钮 (设置与更多) */}
              <div className="relative" ref={menuBtnRef}>
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className={`w-10 h-[42px] flex items-center justify-center transition-colors ${
                    menuOpen ? 'text-brand-active' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                  }`}
                  title="设置与更多"
                >
                  <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                  </svg>
                </button>
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
              <Route path="/agents/:id/edit" element={<AgentEditPage />} />
              <Route path="/memory" element={<MemoryPage />} />
              <Route path="/knowledge" element={<KnowledgePage />} />
              <Route path="/skills" element={<SkillPage />} />
              <Route path="/models" element={<ModelsPage />} />
              <Route path="/evolution" element={<EvolutionPage />} />
              <Route path="/cron" element={<CronPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/sop-tags" element={<SopTagsPage />} />
              <Route path="/alert" element={<AlertPage />} />
              <Route path="/channel" element={<ChannelPage />} />
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
