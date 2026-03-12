import { useState, useRef, useEffect } from 'react'
import { startBuilder, sendBuilderMessage } from '../../lib/api'
import { useAgentStore } from '../../stores/agent-store'

interface BuilderProps {
  onComplete: (agentId: string) => void
  onCancel: () => void
}

interface BuilderMessage {
  role: 'user' | 'assistant'
  content: string
}

export function AgentBuilderPage({ onComplete, onCancel }: BuilderProps) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<BuilderMessage[]>([])
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const { fetchAgents } = useAgentStore()

  useEffect(() => {
    startBuilder().then((res) => {
      setSessionId(res.sessionId!)
      setPhase(res.phase)
      setMessages([{ role: 'assistant', content: res.message }])
    })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || !sessionId || loading) return
    const text = input.trim()
    setInput('')
    setLoading(true)

    setMessages((prev) => [...prev, { role: 'user', content: text }])

    try {
      const res = await sendBuilderMessage(sessionId, text)
      setMessages((prev) => [...prev, { role: 'assistant', content: res.message }])
      setPhase(res.phase)

      if (res.agentId) {
        await fetchAgents()
        onComplete(res.agentId)
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `错误: ${err}` }])
    }
    setLoading(false)
  }

  const phaseLabels: Record<string, string> = {
    role: '角色定位',
    expertise: '专长领域',
    style: '风格偏好',
    constraints: '行为约束',
    preview: '预览确认',
    done: '完成',
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold">创建 Agent</h1>
          <div className="flex gap-1">
            {['role', 'expertise', 'style', 'constraints', 'preview'].map((p) => (
              <span
                key={p}
                className={`text-[10px] px-2 py-0.5 rounded-full ${
                  p === phase
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
                }`}
              >
                {phaseLabels[p]}
              </span>
            ))}
          </div>
        </div>
        <button onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700">取消</button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} mb-3`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white rounded-br-md'
                : 'bg-gray-100 text-gray-900 rounded-bl-md dark:bg-gray-800 dark:text-gray-100'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {phase !== 'done' && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-end gap-2 max-w-3xl mx-auto">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="输入回答..."
              className="flex-1 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm outline-none focus:border-blue-500"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? '...' : '发送'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
