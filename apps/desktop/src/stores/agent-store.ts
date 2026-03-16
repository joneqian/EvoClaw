import { create } from 'zustand';
import { get, post, del } from '../lib/api';

/** Agent 信息 */
export interface Agent {
  id: string;
  name: string;
  emoji: string;
  status: string;
  createdAt: string;
}

/** Builder 阶段 */
export type BuilderStage = 'role' | 'expertise' | 'style' | 'constraints' | 'preview' | 'done';

/** Builder 响应 */
export interface BuilderResponse {
  stage: BuilderStage;
  message: string;
  preview?: Record<string, string>;
  agentId?: string;
  done: boolean;
}

/** 对话式创建的消息 */
export interface BuilderMessage {
  role: 'system' | 'user';
  content: string;
  stage?: BuilderStage;
  preview?: Record<string, string>;
}

interface AgentState {
  /** Agent 列表 */
  agents: Agent[];
  /** 是否正在加载 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;

  /** 引导式创建会话 */
  builderSessionId: string | null;
  builderMessages: BuilderMessage[];
  builderStage: BuilderStage | null;
  builderPreview: Record<string, string> | null;
  builderLoading: boolean;
  builderCreatedAgentId: string | null;

  setAgents: (agents: Agent[]) => void;
  setLoading: (loading: boolean) => void;
  /** 从服务端获取 Agent 列表 */
  fetchAgents: () => Promise<void>;
  /** 通过服务端创建 Agent（简单模式） */
  createAgent: (name: string, emoji?: string) => Promise<Agent>;
  /** 通过服务端删除 Agent */
  deleteAgent: (id: string) => Promise<void>;

  /** 启动引导式创建会话 */
  startGuidedCreation: () => Promise<void>;
  /** 发送引导式创建消息 */
  sendBuilderMessage: (message: string) => Promise<void>;
  /** 重置引导式创建状态 */
  resetBuilder: () => void;
}

export const useAgentStore = create<AgentState>((set, getState) => ({
  agents: [],
  loading: false,
  error: null,

  builderSessionId: null,
  builderMessages: [],
  builderStage: null,
  builderPreview: null,
  builderLoading: false,
  builderCreatedAgentId: null,

  setAgents: (agents) => set({ agents }),
  setLoading: (loading) => set({ loading }),

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const data = await get<{ agents: Agent[] }>('/agents');
      const agents = data.agents.map((a) => ({
        id: a.id,
        name: a.name,
        emoji: a.emoji || '🤖',
        status: a.status || 'active',
        createdAt: a.createdAt || new Date().toISOString(),
      }));
      set({ agents, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : '加载失败', loading: false });
    }
  },

  createAgent: async (name: string, emoji?: string) => {
    const data = await post<{ agent: Agent }>('/agents', { name, emoji: emoji ?? '🤖' });
    const agent: Agent = {
      id: data.agent.id,
      name: data.agent.name,
      emoji: data.agent.emoji ?? '🤖',
      status: data.agent.status ?? 'active',
      createdAt: data.agent.createdAt ?? new Date().toISOString(),
    };
    set((state) => ({ agents: [...state.agents, agent] }));
    return agent;
  },

  deleteAgent: async (id: string) => {
    await del(`/agents/${id}`);
    set((state) => ({ agents: state.agents.filter((a) => a.id !== id) }));
  },

  startGuidedCreation: async () => {
    set({
      builderSessionId: null,
      builderMessages: [],
      builderStage: null,
      builderPreview: null,
      builderLoading: true,
      builderCreatedAgentId: null,
    });
    try {
      const data = await post<{ sessionId: string; response: BuilderResponse }>('/agents/create-guided', {});
      set({
        builderSessionId: data.sessionId,
        builderMessages: [{
          role: 'system',
          content: data.response.message,
          stage: data.response.stage,
        }],
        builderStage: data.response.stage,
        builderLoading: false,
      });
    } catch (err) {
      set({
        builderLoading: false,
        builderMessages: [{
          role: 'system',
          content: `启动创建向导失败: ${err instanceof Error ? err.message : '未知错误'}`,
        }],
      });
    }
  },

  sendBuilderMessage: async (message: string) => {
    const state = getState();
    if (!state.builderSessionId || state.builderLoading) return;

    // 添加用户消息
    set((s) => ({
      builderMessages: [...s.builderMessages, { role: 'user', content: message }],
      builderLoading: true,
    }));

    try {
      const data = await post<{ sessionId: string; response: BuilderResponse }>('/agents/create-guided', {
        sessionId: state.builderSessionId,
        message,
      });

      const systemMsg: BuilderMessage = {
        role: 'system',
        content: data.response.message,
        stage: data.response.stage,
        preview: data.response.preview,
      };

      set((s) => ({
        builderMessages: [...s.builderMessages, systemMsg],
        builderStage: data.response.stage,
        builderPreview: data.response.preview ?? s.builderPreview,
        builderLoading: false,
        builderCreatedAgentId: data.response.agentId ?? null,
      }));

      // 创建完成后刷新列表
      if (data.response.done) {
        getState().fetchAgents();
      }
    } catch (err) {
      set((s) => ({
        builderMessages: [...s.builderMessages, {
          role: 'system',
          content: `操作失败: ${err instanceof Error ? err.message : '未知错误'}`,
        }],
        builderLoading: false,
      }));
    }
  },

  resetBuilder: () => set({
    builderSessionId: null,
    builderMessages: [],
    builderStage: null,
    builderPreview: null,
    builderLoading: false,
    builderCreatedAgentId: null,
  }),
}));
