import { create } from 'zustand'
import { sendMessage } from '../lib/api'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

interface ChatState {
  messages: ChatMessage[]
  conversationId: string | null
  agentId: string | null
  isStreaming: boolean
  error: string | null
  model: string

  send: (text: string) => Promise<void>
  setModel: (model: string) => void
  setAgentId: (id: string | null) => void
  clearChat: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  conversationId: null,
  agentId: null,
  isStreaming: false,
  error: null,
  model: 'openai/gpt-4o-mini',

  send: async (text: string) => {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      createdAt: Date.now(),
    }

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    }

    set((s) => ({
      messages: [...s.messages, userMsg, assistantMsg],
      isStreaming: true,
      error: null,
    }))

    try {
      const result = await sendMessage(
        text,
        {
          agentId: get().agentId ?? undefined,
          conversationId: get().conversationId ?? undefined,
          model: get().model,
        },
        (chunk) => {
          set((s) => {
            const msgs = [...s.messages]
            const last = msgs[msgs.length - 1]
            if (last.role === 'assistant') {
              msgs[msgs.length - 1] = { ...last, content: last.content + chunk }
            }
            return { messages: msgs }
          })
        },
      )

      set((s) => {
        const msgs = [...s.messages]
        const last = msgs[msgs.length - 1]
        if (last.role === 'assistant') {
          msgs[msgs.length - 1] = { ...last, id: result.messageId }
        }
        return {
          messages: msgs,
          conversationId: result.conversationId,
          isStreaming: false,
        }
      })
    } catch (err) {
      set({ isStreaming: false, error: String(err) })
    }
  },

  setModel: (model) => set({ model }),
  setAgentId: (id) => set({ agentId: id }),

  clearChat: () =>
    set({ messages: [], conversationId: null, error: null }),
}))
