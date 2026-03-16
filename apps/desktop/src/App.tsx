import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom';
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
import AgentEditPage from './pages/AgentEditPage';
import AgentDetailPage from './pages/AgentDetailPage';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from './stores/app-store';
import { initSidecar, healthCheck, get } from './lib/api';
import { useChatStore } from './stores/chat-store';

/** 最近会话条目 */
interface RecentConversation {
  sessionKey: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  title: string;
  lastAt: string;
  messageCount: number;
}

/** 侧栏主导航项样式 */
function navClassName({ isActive }: { isActive: boolean }): string {
  return `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
    isActive
      ? 'bg-[#00d4aa]/10 text-[#00a88a] font-medium'
      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
  }`;
}

/** 相对时间格式化 */
function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(dateStr).toLocaleDateString('zh-CN');
}

/** 加载状态组件 */
function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <div className="text-5xl mb-4">🐾</div>
        <p className="text-sm text-gray-400 dark:text-gray-500">正在启动 EvoClaw...</p>
        <div className="mt-4 flex justify-center gap-1">
          <span className="w-2 h-2 bg-[#00d4aa] rounded-full animate-pulse" />
          <span className="w-2 h-2 bg-[#00d4aa] rounded-full animate-pulse [animation-delay:150ms]" />
          <span className="w-2 h-2 bg-[#00d4aa] rounded-full animate-pulse [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

/** 连接失败组件 */
function ErrorScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <div className="text-5xl mb-4">⚠️</div>
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200 mb-2">Sidecar 连接失败</h2>
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">
          无法连接到后端服务，请确保 Node.js 已安装。
        </p>
        <button
          onClick={onRetry}
          className="px-4 py-2 text-sm font-medium text-white bg-[#00d4aa] rounded-lg
            hover:bg-[#00b894] transition-colors"
        >
          重试连接
        </button>
      </div>
    </div>
  );
}

// ─── 底部菜单项 ───

interface MenuItem {
  icon: string;
  label: string;
  path: string;
}

const MENU_ITEMS: MenuItem[][] = [
  [
    { icon: '🧩', label: '模型管理', path: '/models' },
    { icon: '📡', label: 'Channel', path: '/channel' },
    { icon: '⚡', label: 'Skill 管理', path: '/skills' },
    { icon: '📊', label: '进化统计', path: '/evolution' },
    { icon: '🔒', label: '安全设置', path: '/security' },
    { icon: '📚', label: '知识库', path: '/knowledge' },
  ],
  [
    { icon: '⚙️', label: '设置', path: '/settings' },
  ],
];

/** 底部弹出菜单 */
function BottomMenu({
  open,
  onClose,
  onNavigate,
  theme,
  onToggleTheme,
  sidecarConnected,
  onRestartSidecar,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
  theme: string;
  onToggleTheme: () => void;
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
      className="absolute bottom-full left-0 right-0 mb-1 mx-2 bg-white dark:bg-gray-800
        border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden z-50"
    >
      {MENU_ITEMS.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && <div className="border-t border-gray-100 dark:border-gray-700" />}
          <div className="py-1">
            {group.map((item) => (
              <button
                key={item.path}
                onClick={() => { onNavigate(item.path); onClose(); }}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-600 dark:text-gray-300
                  hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
              >
                <span className="text-base w-5 text-center">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {/* 主题切换 */}
      <div className="border-t border-gray-100 dark:border-gray-700 py-1">
        <button
          onClick={() => { onToggleTheme(); onClose(); }}
          className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-600 dark:text-gray-300
            hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
        >
          <span className="text-base w-5 text-center">{theme === 'dark' ? '☀️' : '🌙'}</span>
          {theme === 'dark' ? '浅色模式' : '深色模式'}
        </button>
      </div>
      {/* Sidecar 状态 */}
      <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-2.5 flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${
          sidecarConnected ? 'bg-green-400' : 'bg-red-400 animate-pulse'
        }`} />
        <span className="text-xs text-gray-400 dark:text-gray-500 flex-1">
          {sidecarConnected ? 'Sidecar 已连接' : 'Sidecar 未连接'}
        </span>
        {!sidecarConnected && (
          <button
            onClick={() => { onRestartSidecar(); onClose(); }}
            className="text-xs text-[#00d4aa] hover:text-[#00b894]"
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
    theme, toggleTheme,
  } = useAppStore();
  const { enterConversation } = useChatStore();
  const navigate = useNavigate();
  const location = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);
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

  /** 加载最近会话 */
  const fetchRecents = useCallback(async () => {
    try {
      const res = await get<{ conversations: RecentConversation[] }>('/chat/recents?limit=15');
      setRecents(res.conversations);
    } catch { /* 可能 Sidecar 未就绪 */ }
  }, []);

  useEffect(() => {
    if (initState === 'connected') fetchRecents();
  }, [initState, fetchRecents]);

  // 从对话页返回时刷新 Recents
  useEffect(() => {
    if (initState === 'connected' && location.pathname !== '/chat') {
      fetchRecents();
    }
  }, [location.pathname, initState, fetchRecents]);

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

  /** 同步 dark class */
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  /** 点击最近会话 → 进入该会话并加载历史消息 */
  const handleRecentClick = useCallback((conv: RecentConversation) => {
    enterConversation(conv.agentId, conv.sessionKey);
    navigate('/chat');
  }, [enterConversation, navigate]);

  // 加载中
  if (initState === 'loading') return <LoadingScreen />;
  // 连接失败
  if (initState === 'error') return <ErrorScreen onRetry={initialize} />;
  // Setup 页面
  if (location.pathname === '/setup') {
    return <Routes><Route path="/setup" element={<SetupPage />} /></Routes>;
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* ─── Sidebar ─── */}
      <nav className="w-56 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col shrink-0">
        {/* 顶部：新建对话 + 搜索 */}
        <div className="p-3 space-y-1">
          <button
            onClick={() => navigate('/chat')}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200
              hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            新建对话
          </button>
        </div>

        {/* 主导航 */}
        <div className="px-3 space-y-0.5">
          <NavLink to="/chat" className={navClassName}>
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 20.105V4.5A2.25 2.25 0 016 2.25h12A2.25 2.25 0 0120.25 4.5v11.25a2.25 2.25 0 01-2.25 2.25H6.401l-2.651 1.855z" />
            </svg>
            对话
          </NavLink>
          <NavLink to="/agents" className={navClassName}>
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
            Agents
          </NavLink>
          <NavLink to="/memory" className={navClassName}>
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
            记忆
          </NavLink>
        </div>

        {/* Recents 区域 */}
        <div className="mt-4 flex-1 overflow-hidden flex flex-col min-h-0">
          <div className="px-4 mb-1">
            <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
              Recents
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-2">
            {recents.length === 0 ? (
              <p className="px-2 py-3 text-xs text-gray-400 dark:text-gray-500">暂无最近对话</p>
            ) : (
              <div className="space-y-0.5">
                {recents.map((conv) => (
                  <button
                    key={conv.sessionKey}
                    onClick={() => handleRecentClick(conv)}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-sm text-gray-600 dark:text-gray-400
                      hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group truncate"
                    title={`${conv.agentEmoji} ${conv.agentName} — ${conv.title}`}
                  >
                    <div className="truncate">
                      <span className="mr-1.5">{conv.agentEmoji}</span>
                      <span className="text-gray-700 dark:text-gray-300">{conv.title}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 pl-6 truncate">
                      {conv.agentName} · {formatRelativeTime(conv.lastAt)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 底部：品牌 + 菜单 */}
        <div className="relative border-t border-gray-100 dark:border-gray-700">
          <BottomMenu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            onNavigate={navigate}
            theme={theme}
            onToggleTheme={toggleTheme}
            sidecarConnected={sidecarConnected}
            onRestartSidecar={handleRestartSidecar}
          />
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-[#00d4aa]/10 flex items-center justify-center text-base shrink-0">
              🐾
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">EvoClaw</p>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  sidecarConnected ? 'bg-green-400' : 'bg-red-400'
                }`} />
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  {sidecarConnected ? '已连接' : '未连接'}
                </span>
              </div>
            </div>
            <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
            </svg>
          </button>
        </div>
      </nav>

      {/* ─── Main content ─── */}
      <main className="flex-1 overflow-hidden">
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
          <Route path="/channel" element={<ChannelPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/setup" element={<SetupPage />} />
        </Routes>
      </main>
    </div>
  );
}
