import { useState, useEffect } from 'react'
import { ChatPage } from './app/chat/page'
import { SettingsPage } from './app/settings/page'
import { AgentList } from './app/agents/list'
import { AgentDetail } from './app/agents/detail'
import { AgentBuilderPage } from './app/agents/builder'
import { useAgentStore } from './stores/agent-store'
import { useChatStore } from './stores/chat-store'

type Page = 'chat' | 'settings' | 'agents' | 'agent-detail' | 'agent-builder'

function App() {
  const [page, setPage] = useState<Page>('chat')
  const [detailAgentId, setDetailAgentId] = useState<string | null>(null)
  const agents = useAgentStore((s) => s.agents)
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId)
  const setAgentId = useChatStore((s) => s.setAgentId)
  const clearChat = useChatStore((s) => s.clearChat)
  const fetchAgents = useAgentStore((s) => s.fetchAgents)

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  const handleSelectAgentForChat = (agentId: string) => {
    setAgentId(agentId)
    clearChat()
    setPage('chat')
  }

  return (
    <div className="flex h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Sidebar */}
      <nav className="w-52 border-r border-gray-200 dark:border-gray-700 flex flex-col">
        <div className="p-4 font-bold text-lg">🐾 EvoClaw</div>

        <div className="flex-1 px-2 space-y-1 overflow-y-auto">
          <NavItem label="💬 对话" active={page === 'chat'} onClick={() => setPage('chat')} />
          <NavItem label="🤖 Agents" active={page === 'agents' || page === 'agent-detail' || page === 'agent-builder'} onClick={() => setPage('agents')} />
          <NavItem label="⚙️ 设置" active={page === 'settings'} onClick={() => setPage('settings')} />

          {/* Quick agent switcher */}
          {agents.filter(a => a.status === 'active').length > 0 && (
            <div className="pt-3 mt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="text-[10px] text-gray-400 px-3 mb-1 uppercase tracking-wider">快速切换</div>
              {agents.filter(a => a.status === 'active').map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => handleSelectAgentForChat(agent.id)}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors truncate ${
                    selectedAgentId === agent.id
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600'
                      : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  🤖 {agent.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-3 text-xs text-gray-400">v0.1.0</div>
      </nav>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {page === 'chat' && <ChatPage />}
        {page === 'settings' && <SettingsPage />}
        {page === 'agents' && (
          <AgentList
            onCreateNew={() => setPage('agent-builder')}
            onSelectAgent={(id) => { setDetailAgentId(id); setPage('agent-detail') }}
          />
        )}
        {page === 'agent-detail' && detailAgentId && (
          <AgentDetail
            agentId={detailAgentId}
            onChat={handleSelectAgentForChat}
          />
        )}
        {page === 'agent-builder' && (
          <AgentBuilderPage
            onComplete={(agentId) => { setDetailAgentId(agentId); setPage('agent-detail') }}
            onCancel={() => setPage('agents')}
          />
        )}
      </main>
    </div>
  )
}

function NavItem({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
        active
          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium'
          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      {label}
    </button>
  )
}

export default App
