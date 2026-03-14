import { useEffect, useCallback } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import ChatPage from './pages/ChatPage';
import AgentsPage from './pages/AgentsPage';
import MemoryPage from './pages/MemoryPage';
import KnowledgePage from './pages/KnowledgePage';
import SkillPage from './pages/SkillPage';
import SecurityPage from './pages/SecurityPage';
import SettingsPage from './pages/SettingsPage';
import EvolutionPage from './pages/EvolutionPage';
import { useAppStore } from './stores/app-store';
import { healthCheck } from './lib/api';

/** 导航链接样式 */
function navClassName({ isActive }: { isActive: boolean }): string {
  return `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
    isActive ? 'bg-[#00d4aa]/10 text-[#00a88a]' : 'text-gray-600 hover:bg-gray-100'
  }`;
}

export default function App() {
  const { sidecarConnected, setSidecarConnected } = useAppStore();

  /** 定期检查 Sidecar 连接状态 */
  const checkConnection = useCallback(async () => {
    const ok = await healthCheck();
    setSidecarConnected(ok);
  }, [setSidecarConnected]);

  useEffect(() => {
    // 立即检查一次
    checkConnection();
    // 每 10 秒检查一次
    const timer = setInterval(checkConnection, 10_000);
    return () => clearInterval(timer);
  }, [checkConnection]);

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900">
      {/* Sidebar */}
      <nav className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 pb-2">
          <h1 className="text-xl font-bold px-3 mb-6">🐾 EvoClaw</h1>
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
          <NavLink to="/security" className={navClassName}>
            🔒 安全设置
          </NavLink>
          <NavLink to="/settings" className={navClassName}>
            ⚙️ 设置
          </NavLink>
        </div>

        {/* 连接状态 */}
        <div className="p-4 border-t border-gray-100">
          <div className="flex items-center gap-2 px-3">
            <span
              className={`w-2 h-2 rounded-full ${
                sidecarConnected ? 'bg-green-400' : 'bg-red-400'
              }`}
            />
            <span className="text-xs text-gray-400">
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
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
