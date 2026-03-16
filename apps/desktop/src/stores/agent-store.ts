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

interface AgentState {
  /** Agent 列表 */
  agents: Agent[];
  /** 是否正在加载 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;

  setAgents: (agents: Agent[]) => void;
  setLoading: (loading: boolean) => void;
  /** 从服务端获取 Agent 列表 */
  fetchAgents: () => Promise<void>;
  /** 通过服务端创建 Agent */
  createAgent: (name: string, emoji?: string) => Promise<Agent>;
  /** 通过服务端删除 Agent */
  deleteAgent: (id: string) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, _get) => ({
  agents: [],
  loading: false,
  error: null,

  setAgents: (agents) => set({ agents }),
  setLoading: (loading) => set({ loading }),

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const data = await get<{ agents: Agent[] }>('/agents');
      // 服务端返回的字段名可能不同，做映射
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
}));
