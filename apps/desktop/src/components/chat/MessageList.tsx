import { useEffect, useRef } from 'react'
import { useChatStore } from '../../stores/chat-store'
import { MessageBubble } from './MessageBubble'

export function MessageList() {
  const messages = useChatStore((s) => s.messages)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <div className="text-center">
          <div className="text-4xl mb-4">🐾</div>
          <p className="text-lg font-medium">EvoClaw</p>
          <p className="text-sm mt-1">开始和你的 AI 伴侣对话吧</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
