import { create } from 'zustand';

/** 工具调用信息 */
export interface ToolCall {
  name: string;
  status: 'running' | 'done' | 'error';
  result?: string;
}

/** 聊天消息 */
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCall[];
  createdAt: string;
}

interface ChatState {
  /** 消息列表 */
  messages: Message[];
  /** 是否正在流式输出 */
  isStreaming: boolean;
  /** 当前对话的 Agent ID */
  currentAgentId: string | null;

  setCurrentAgent: (agentId: string | null) => void;
  addMessage: (msg: Message) => void;
  appendToLastMessage: (delta: string) => void;
  updateLastMessageToolCalls: (toolCalls: ToolCall[]) => void;
  setStreaming: (streaming: boolean) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isStreaming: false,
  currentAgentId: null,

  setCurrentAgent: (agentId) => set({ currentAgentId: agentId, messages: [] }),

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  appendToLastMessage: (delta) =>
    set((state) => {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: last.content + delta };
      }
      return { messages: msgs };
    }),

  updateLastMessageToolCalls: (toolCalls) =>
    set((state) => {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, toolCalls };
      }
      return { messages: msgs };
    }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  clearMessages: () => set({ messages: [] }),
}));
