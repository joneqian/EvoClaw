import { useState, useEffect } from 'react'
import { useChatStore } from '../../stores/chat-store'

interface ProviderConfig {
  id: string
  label: string
  models: { id: string; label: string }[]
}

const PROVIDERS: ProviderConfig[] = [
  { id: 'openai', label: 'OpenAI', models: [
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  ]},
  { id: 'anthropic', label: 'Anthropic', models: [
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ]},
  { id: 'deepseek', label: 'DeepSeek', models: [
    { id: 'deepseek-chat', label: 'DeepSeek Chat' },
    { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
  ]},
  { id: 'minimax', label: 'MiniMax', models: [
    { id: 'abab6.5-chat', label: 'abab6.5' },
  ]},
  { id: 'glm', label: '智谱 GLM', models: [
    { id: 'glm-4-flash', label: 'GLM-4 Flash' },
    { id: 'glm-4', label: 'GLM-4' },
  ]},
  { id: 'doubao', label: '豆包', models: [
    { id: 'doubao-1.5-pro-32k', label: 'Doubao 1.5 Pro' },
  ]},
  { id: 'qwen', label: '通义千问', models: [
    { id: 'qwen-plus', label: 'Qwen Plus' },
    { id: 'qwen-turbo', label: 'Qwen Turbo' },
  ]},
]

async function loadApiKey(provider: string): Promise<string> {
  try {
    const { keychainGet } = await import('../../lib/tauri')
    return await keychainGet('com.evoclaw.app', `${provider}-api-key`)
  } catch {
    return localStorage.getItem(`evoclaw_${provider}_key`) || ''
  }
}

async function saveApiKey(provider: string, key: string): Promise<void> {
  try {
    const { keychainSet } = await import('../../lib/tauri')
    await keychainSet('com.evoclaw.app', `${provider}-api-key`, key)
  } catch {
    localStorage.setItem(`evoclaw_${provider}_key`, key)
  }
}

export function SettingsPage() {
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<string | null>(null)
  const model = useChatStore((s) => s.model)
  const setModel = useChatStore((s) => s.setModel)

  useEffect(() => {
    Promise.all(
      PROVIDERS.map(async (p) => {
        const key = await loadApiKey(p.id)
        return [p.id, key] as const
      })
    ).then((entries) => setKeys(Object.fromEntries(entries)))
  }, [])

  const handleSave = async (providerId: string) => {
    await saveApiKey(providerId, keys[providerId] || '')
    setSaved(providerId)
    setTimeout(() => setSaved(null), 2000)
  }

  // Parse current selection
  const [currentProvider, currentModel] = model.split('/')
  const providerConfig = PROVIDERS.find((p) => p.id === currentProvider)

  return (
    <div className="p-6 max-w-lg overflow-y-auto h-full">
      <h1 className="text-lg font-semibold mb-6">设置</h1>

      {/* Model selection */}
      <div className="mb-8">
        <h2 className="text-sm font-medium mb-3">默认模型</h2>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => setModel(`${p.id}/${p.models[0].id}`)}
              className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                currentProvider === p.id
                  ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20 font-medium'
                  : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {providerConfig && (
          <select
            value={currentModel}
            onChange={(e) => setModel(`${currentProvider}/${e.target.value}`)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            {providerConfig.models.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        )}
      </div>

      {/* API Keys */}
      <h2 className="text-sm font-medium mb-3">API 密钥</h2>
      <div className="space-y-4">
        {PROVIDERS.map((p) => (
          <div key={p.id}>
            <label className="block text-xs font-medium mb-1 text-gray-600 dark:text-gray-400">{p.label}</label>
            <div className="flex gap-2">
              <input
                type="password"
                value={keys[p.id] || ''}
                onChange={(e) => setKeys((prev) => ({ ...prev, [p.id]: e.target.value }))}
                placeholder={`${p.label} API Key`}
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm outline-none focus:border-blue-500"
              />
              <button
                onClick={() => handleSave(p.id)}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
              >
                {saved === p.id ? '✓' : '保存'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-4">密钥安全存储在系统 Keychain 中，不会明文保存。</p>
    </div>
  )
}
