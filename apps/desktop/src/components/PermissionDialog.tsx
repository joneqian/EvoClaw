import { grantPermission } from '../lib/api'

interface PermissionDialogProps {
  agentId: string
  agentName: string
  category: string
  resource?: string
  onResolve: (allowed: boolean) => void
}

const categoryLabels: Record<string, { icon: string; label: string; desc: string }> = {
  filesystem: { icon: '📁', label: '文件系统访问', desc: '读写本地文件' },
  network: { icon: '🌐', label: '网络访问', desc: '访问外部 API' },
  exec: { icon: '⚡', label: '执行命令', desc: '运行系统命令' },
  clipboard: { icon: '📋', label: '剪贴板', desc: '读写剪贴板内容' },
  notification: { icon: '🔔', label: '发送通知', desc: '显示系统通知' },
  keychain: { icon: '🔑', label: '密钥访问', desc: '访问系统密钥链' },
  'agent-comm': { icon: '🤝', label: 'Agent 通信', desc: '与其他 Agent 交流' },
}

export function PermissionDialog({ agentId, agentName, category, resource, onResolve }: PermissionDialogProps) {
  const info = categoryLabels[category] || { icon: '❓', label: category, desc: '' }

  const handleGrant = async (scope: 'once' | 'always' | 'deny') => {
    await grantPermission(agentId, category, scope)
    onResolve(scope !== 'deny')
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-80 p-6">
        <div className="text-center mb-4">
          <div className="text-4xl mb-2">{info.icon}</div>
          <h2 className="text-base font-semibold">权限请求</h2>
          <p className="text-sm text-gray-500 mt-1">
            <strong>{agentName}</strong> 请求 {info.label}
          </p>
          {resource && <p className="text-xs text-gray-400 mt-1 font-mono">{resource}</p>}
          <p className="text-xs text-gray-400 mt-1">{info.desc}</p>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => handleGrant('once')}
            className="w-full rounded-xl border border-gray-300 dark:border-gray-600 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            仅本次允许
          </button>
          <button
            onClick={() => handleGrant('always')}
            className="w-full rounded-xl bg-blue-600 py-2.5 text-sm text-white hover:bg-blue-700"
          >
            始终允许
          </button>
          <button
            onClick={() => handleGrant('deny')}
            className="w-full rounded-xl text-red-500 py-2.5 text-sm hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            拒绝
          </button>
        </div>
      </div>
    </div>
  )
}
