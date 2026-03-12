import { MessageList } from '../../components/chat/MessageList'
import { ChatInput } from '../../components/chat/ChatInput'
import { useChatStore } from '../../stores/chat-store'
import { useAgentStore } from '../../stores/agent-store'

export function ChatPage() {
  const error = useChatStore((s) => s.error)
  const clearChat = useChatStore((s) => s.clearChat)
  const agentId = useChatStore((s) => s.agentId)
  const agents = useAgentStore((s) => s.agents)
  const currentAgent = agents.find((a) => a.id === agentId)

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold">
            {currentAgent ? `🤖 ${currentAgent.name}` : '🐾 EvoClaw Chat'}
          </h1>
          {currentAgent && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
              {currentAgent.status}
            </span>
          )}
        </div>
        <button
          onClick={clearChat}
          className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          新对话
        </button>
      </header>

      {error && (
        <div className="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <MessageList />
      <ChatInput />
    </div>
  )
}
