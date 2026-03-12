import { useEffect, useState } from 'react'
import { getAgent, updateAgent, type AgentData, listPermissions, revokePermissions, type PermissionGrant } from '../../lib/api'
import { useAgentStore } from '../../stores/agent-store'

interface AgentDetailProps {
  agentId: string
  onChat: (agentId: string) => void
}

export function AgentDetail({ agentId, onChat }: AgentDetailProps) {
  const [agent, setAgent] = useState<AgentData | null>(null)
  const [permissions, setPermissions] = useState<PermissionGrant[]>([])
  const [editing, setEditing] = useState(false)
  const [editSoul, setEditSoul] = useState('')
  const { archiveAgent } = useAgentStore()

  useEffect(() => {
    getAgent(agentId).then(setAgent)
    listPermissions(agentId).then(setPermissions)
  }, [agentId])

  if (!agent) return <div className="p-6 text-gray-400">加载中...</div>

  const handleSave = async () => {
    const updated = await updateAgent(agentId, { soulContent: editSoul })
    setAgent(updated)
    setEditing(false)
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <span className="text-4xl">🤖</span>
        <div>
          <h1 className="text-xl font-bold">{agent.name}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            agent.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600'
          }`}>
            {agent.status}
          </span>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => onChat(agentId)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          对话
        </button>
        <button
          onClick={() => { setEditing(true); setEditSoul(agent.soulContent) }}
          className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          编辑 Soul
        </button>
        <button
          onClick={() => archiveAgent(agentId)}
          className="rounded-lg border border-red-300 text-red-600 px-4 py-2 text-sm hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          归档
        </button>
      </div>

      {editing ? (
        <div className="mb-6">
          <label className="block text-sm font-medium mb-1">Soul 内容</label>
          <textarea
            value={editSoul}
            onChange={(e) => setEditSoul(e.target.value)}
            rows={12}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-mono outline-none focus:border-blue-500"
          />
          <div className="flex gap-2 mt-2">
            <button onClick={handleSave} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white">保存</button>
            <button onClick={() => setEditing(false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs">取消</button>
          </div>
        </div>
      ) : (
        <div className="mb-6">
          <h2 className="text-sm font-medium mb-2">Soul 设定</h2>
          <pre className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-xs whitespace-pre-wrap max-h-60 overflow-y-auto">
            {agent.soulContent}
          </pre>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium">权限授权</h2>
          {permissions.length > 0 && (
            <button
              onClick={async () => { await revokePermissions(agentId); setPermissions([]) }}
              className="text-xs text-red-500 hover:text-red-700"
            >
              撤销全部
            </button>
          )}
        </div>
        {permissions.length === 0 ? (
          <p className="text-xs text-gray-400">暂无权限授权记录</p>
        ) : (
          <div className="space-y-1">
            {permissions.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-800 rounded px-3 py-2">
                <span>{p.category} — {p.scope}</span>
                <span className="text-gray-400">{new Date(p.grantedAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 text-xs text-gray-400">
        创建于 {new Date(agent.createdAt).toLocaleString()} · 更新于 {new Date(agent.updatedAt).toLocaleString()}
      </div>
    </div>
  )
}
