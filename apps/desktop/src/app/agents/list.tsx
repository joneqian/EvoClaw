import { useEffect } from 'react'
import { useAgentStore } from '../../stores/agent-store'

interface AgentListProps {
  onCreateNew: () => void
  onSelectAgent: (id: string) => void
}

export function AgentList({ onCreateNew, onSelectAgent }: AgentListProps) {
  const { agents, loading, fetchAgents, selectedAgentId, selectAgent } = useAgentStore()

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  const activeAgents = agents.filter((a) => a.status !== 'archived')

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Agents</h1>
        <button
          onClick={onCreateNew}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 transition-colors"
        >
          + 创建
        </button>
      </div>

      {loading && <p className="text-sm text-gray-500">加载中...</p>}

      {activeAgents.length === 0 && !loading && (
        <div className="text-center py-8 text-gray-400">
          <p className="text-3xl mb-2">🤖</p>
          <p className="text-sm">还没有 Agent</p>
          <p className="text-xs mt-1">点击"创建"开始</p>
        </div>
      )}

      <div className="space-y-2">
        {activeAgents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => {
              selectAgent(agent.id)
              onSelectAgent(agent.id)
            }}
            className={`w-full text-left p-3 rounded-xl border transition-colors ${
              selectedAgentId === agent.id
                ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-xl">🤖</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{agent.name}</div>
                <div className="text-xs text-gray-500 truncate">
                  {agent.status === 'active' ? '🟢 活跃' : agent.status === 'draft' ? '📝 草稿' : agent.status}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
