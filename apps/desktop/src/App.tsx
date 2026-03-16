import { useEffect, useCallback } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom';
import ChatPage from './pages/ChatPage';
import AgentsPage from './pages/AgentsPage';
import MemoryPage from './pages/MemoryPage';
import KnowledgePage from './pages/KnowledgePage';
import SkillPage from './pages/SkillPage';
import SecurityPage from './pages/SecurityPage';
import SettingsPage from './pages/SettingsPage';
import EvolutionPage from './pages/EvolutionPage';
import ChannelPage from './pages/ChannelPage';
import SetupPage from './pages/SetupPage';
import { useAppStore } from './stores/app-store';
import { initSidecar, healthCheck } from './lib/api';

/** 导航链接样式 */
function navClassName({ isActive }: { isActive: boolean }): string {
  return `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
    isActive
      ? 'bg-[#00d4aa]/10 text-[#00a88a]'
      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
  }`;
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

export default function App() {
  const {
    sidecarConnected, setSidecarConnected,
    initState, setInitState,
    theme, toggleTheme,
  } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();

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

  /** 定期健康检查 */
  useEffect(() => {
    if (initState !== 'connected') return;
    const timer = setInterval(async () => {
      const health = await healthCheck();
      setSidecarConnected(!!health);
    }, 15_000);
    return () => clearInterval(timer);
  }, [initState, setSidecarConnected]);

  /** 同步 dark class 到 document */
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // 加载中
  if (initState === 'loading') {
    return <LoadingScreen />;
  }

  // 连接失败
  if (initState === 'error') {
    return <ErrorScreen onRetry={initialize} />;
  }

  // Setup 页面（全屏，不显示侧边栏）
  if (location.pathname === '/setup') {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
      </Routes>
    );
  }

  return (
    <div className={`flex h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100`}>
      {/* Sidebar */}
      <nav className="w-56 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
        <div className="p-4 pb-2">
          <h1 className="text-xl font-bold px-3 mb-6 dark:text-white">🐾 EvoClaw</h1>
        </div>
        <div className="flex-1 flex flex-col gap-1 px-4">
          <NavLink to="/chat" className={navClassName}>
            💬 对话
          </NavLink>
          <NavLink to="/agents" className={navClassName}>
            🤖 Agent 管理
          </NavLink>
          <NavLink to="/memory" className={navClassName}>
            🧠 记忆管理
          </NavLink>
          <NavLink to="/knowledge" className={navClassName}>
            📚 知识库
          </NavLink>
          <NavLink to="/skills" className={navClassName}>
            ⚡ Skill
          </NavLink>
          <NavLink to="/evolution" className={navClassName}>
            📊 进化
          </NavLink>
          <NavLink to="/channel" className={navClassName}>
            📡 Channel
          </NavLink>
          <NavLink to="/security" className={navClassName}>
            🔒 安全设置
          </NavLink>
          <NavLink to="/settings" className={navClassName}>
            ⚙️ 设置
          </NavLink>
        </div>

        {/* 底部：主题切换 + 连接状态 */}
        <div className="p-4 border-t border-gray-100 dark:border-gray-700 space-y-2">
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500
              hover:text-gray-600 dark:hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            {theme === 'dark' ? '☀️ 浅色模式' : '🌙 深色模式'}
          </button>
          <div className="flex items-center gap-2 px-3">
            <span
              className={`w-2 h-2 rounded-full ${
                sidecarConnected ? 'bg-green-400' : 'bg-red-400'
              }`}
            />
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {sidecarConnected ? 'Sidecar 已连接' : 'Sidecar 未连接'}
            </span>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/skills" element={<SkillPage />} />
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
