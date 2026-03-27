import { create } from 'zustand';
import { get } from '../lib/api';

/** 工具调用信息（向后兼容） */
export interface ToolCall {
  name: string;
  status: 'running' | 'done' | 'error';
  /** 操作摘要（如执行的命令） */
  summary?: string;
}

/** 消息段：文本 */
export interface TextSegment {
  type: 'text';
  content: string;
}

/** 消息段：工具调用 */
export interface ToolSegment {
  type: 'tool';
  name: string;
  displayName: string;
  summary?: string;
  result?: string;
  isError?: boolean;
  status: 'running' | 'done' | 'error';
}

/** 消息段联合类型 */
export type MessageSegment = TextSegment | ToolSegment;

/** 聊天消息 */
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 分段数据（桌面端交错渲染用） */
  segments?: MessageSegment[];
  /** 工具调用列表（向后兼容） */
  toolCalls?: ToolCall[];
  createdAt: string;
}

/** 会话信息 */
export interface Conversation {
  sessionKey: string;
  agentId: string;
  title: string;
  lastAt: string;
  messageCount: number;
}

interface ChatState {
  /** 消息列表（当前会话） */
  messages: Message[];
  /** 是否正在流式输出 */
  isStreaming: boolean;
  /** 当前对话的 Agent ID */
  currentAgentId: string | null;
  /** 当前会话的 Session Key */
  currentSessionKey: string | null;
  /** 当前 Agent 的会话列表 */
  conversations: Conversation[];
  /** 是否正在加载消息 */
  loadingMessages: boolean;

  /** 选择 Agent（清空当前会话，进入该 Agent 的会话列表） */
  setCurrentAgent: (agentId: string | null) => void;
  /** 进入已有会话（加载历史消息） */
  enterConversation: (agentId: string, sessionKey: string) => Promise<void>;
  /** 新建会话（生成新 sessionKey，清空消息） */
  newConversation: (agentId: string) => void;
  /** 加载 Agent 的会话列表 */
  fetchConversations: (agentId: string) => Promise<void>;

  /** 刷新当前会话消息（不清空，无闪烁） */
  reloadCurrentMessages: () => Promise<void>;
  /** SSE 事件驱动：会话变更时增量更新（渠道消息 + 本地会话完成） */
  handleConversationChanged: (data: { sessionKey?: string; agentId?: string }) => void;

  addMessage: (msg: Message) => void;
  appendToLastMessage: (delta: string) => void;
  updateLastMessageToolCalls: (toolCalls: ToolCall[]) => void;
  /** 追加文本到最后一个 text segment（没有则新建） */
  appendTextSegment: (delta: string) => void;
  /** 新增一个 tool segment */
  addToolSegment: (seg: ToolSegment) => void;
  /** 更新最后一个匹配的 tool segment */
  updateToolSegment: (name: string, update: { status: ToolSegment['status']; result?: string; isError?: boolean }) => void;
  setStreaming: (streaming: boolean) => void;
  clearMessages: () => void;
}

/** 生成前端会话 ID（发送时传给后端） */
function generateLocalSessionKey(agentId: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `agent:${agentId}:local:dm:local-user:${ts}${rand}`;
}

/** 防止 reloadCurrentMessages 并发重入 */
let _reloading = false;

export const useChatStore = create<ChatState>((set, getState) => ({
  messages: [],
  isStreaming: false,
  currentAgentId: null,
  currentSessionKey: null,
  conversations: [],
  loadingMessages: false,

  setCurrentAgent: (agentId) => {
    set({
      currentAgentId: agentId,
      currentSessionKey: null,
      messages: [],
      conversations: [],
    });
    // 自动加载该 Agent 的会话列表
    if (agentId) {
      getState().fetchConversations(agentId);
    }
  },

  fetchConversations: async (agentId) => {
    try {
      const res = await get<{ conversations: Conversation[] }>(`/chat/${agentId}/conversations`);
      set({ conversations: res.conversations });
    } catch { /* Sidecar 可能未就绪 */ }
  },

  enterConversation: async (agentId, sessionKey) => {
    set({ currentAgentId: agentId, currentSessionKey: sessionKey, messages: [], loadingMessages: true });
    try {
      const res = await get<{ messages: { id: string; role: string; content: string; toolCalls?: ToolCall[]; createdAt: string }[] }>(
        `/chat/${agentId}/messages?sessionKey=${encodeURIComponent(sessionKey)}&limit=50`,
      );
      const messages: Message[] = res.messages.map((m) => ({
        id: m.id,
        role: m.role as Message['role'],
        content: m.content,
        toolCalls: m.toolCalls,
        createdAt: m.createdAt,
      }));
      set({ messages, loadingMessages: false });
    } catch {
      set({ loadingMessages: false });
    }
  },

  reloadCurrentMessages: async () => {
    if (_reloading) return;
    const { currentAgentId, currentSessionKey, isStreaming } = getState();
    if (!currentAgentId || !currentSessionKey || isStreaming) return;
    _reloading = true;
    try {
      const res = await get<{ messages: { id: string; role: string; content: string; toolCalls?: ToolCall[]; createdAt: string }[] }>(
        `/chat/${currentAgentId}/messages?sessionKey=${encodeURIComponent(currentSessionKey)}&limit=50`,
      );
      const messages: Message[] = res.messages.map((m) => ({
        id: m.id,
        role: m.role as Message['role'],
        content: m.content,
        toolCalls: m.toolCalls,
        createdAt: m.createdAt,
      }));
      // 只在消息数量变化时更新（避免无意义渲染）
      if (messages.length !== getState().messages.length) {
        set({ messages });
      }
    } catch { /* ignore */ } finally {
      _reloading = false;
    }
  },

  handleConversationChanged: (data) => {
    const state = getState();
    // 如果是当前打开的会话，重新加载消息
    if (data.sessionKey && data.sessionKey === state.currentSessionKey && !state.isStreaming) {
      state.reloadCurrentMessages();
    }
    // 如果是当前 Agent 的会话，刷新会话列表
    if (data.agentId && data.agentId === state.currentAgentId) {
      state.fetchConversations(data.agentId);
    }
  },

  newConversation: (agentId) => {
    const sessionKey = generateLocalSessionKey(agentId);
    set({
      currentAgentId: agentId,
      currentSessionKey: sessionKey,
      messages: [],
    });
  },

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

  appendTextSegment: (delta) =>
    set((state) => {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== 'assistant') return { messages: msgs };
      const segments = [...(last.segments ?? [])];
      const lastSeg = segments[segments.length - 1];
      if (lastSeg && lastSeg.type === 'text') {
        // 追加到现有 text segment
        segments[segments.length - 1] = { ...lastSeg, content: lastSeg.content + delta };
      } else {
        // 新建 text segment（工具调用之后的新文本段）
        segments.push({ type: 'text', content: delta });
      }
      msgs[msgs.length - 1] = { ...last, content: last.content + delta, segments };
      return { messages: msgs };
    }),

  addToolSegment: (seg) =>
    set((state) => {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== 'assistant') return { messages: msgs };
      const segments = [...(last.segments ?? [])];
      segments.push(seg);
      // 同步 toolCalls（向后兼容）
      const toolCalls = [...(last.toolCalls ?? []), { name: seg.name, status: seg.status, summary: seg.summary }];
      msgs[msgs.length - 1] = { ...last, segments, toolCalls };
      return { messages: msgs };
    }),

  updateToolSegment: (name, update) =>
    set((state) => {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== 'assistant') return { messages: msgs };
      const segments = [...(last.segments ?? [])];
      // 找到最后一个匹配的 running tool segment
      for (let i = segments.length - 1; i >= 0; i--) {
        const seg = segments[i]!;
        if (seg.type === 'tool' && seg.name === name && seg.status === 'running') {
          segments[i] = { ...seg, ...update };
          break;
        }
      }
      // 同步 toolCalls（向后兼容）
      const toolCalls = [...(last.toolCalls ?? [])];
      const tc = toolCalls.find(t => t.name === name && t.status === 'running');
      if (tc) tc.status = update.status;
      msgs[msgs.length - 1] = { ...last, segments, toolCalls };
      return { messages: msgs };
    }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  clearMessages: () => set({ messages: [] }),
}));
