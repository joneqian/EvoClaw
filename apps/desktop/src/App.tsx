import { Routes, Route, NavLink } from 'react-router-dom';
import ChatPage from './pages/ChatPage';
import AgentsPage from './pages/AgentsPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <div className="flex h-screen bg-gray-50 text-gray-900">
      {/* Sidebar */}
      <nav className="w-56 bg-white border-r border-gray-200 flex flex-col p-4 gap-1">
        <h1 className="text-xl font-bold mb-6 px-3">🐾 EvoClaw</h1>
        <NavLink
          to="/chat"
          className={({ isActive }) =>
            `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
            }`
          }
        >
          对话
        </NavLink>
        <NavLink
          to="/agents"
          className={({ isActive }) =>
            `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
            }`
          }
        >
          Agent 管理
        </NavLink>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
            }`
          }
        >
          设置
        </NavLink>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
