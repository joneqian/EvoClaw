import { create } from 'zustand';

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

  setAgents: (agents: Agent[]) => void;
  addAgent: (agent: Agent) => void;
  removeAgent: (id: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  loading: false,

  setAgents: (agents) => set({ agents }),

  addAgent: (agent) =>
    set((state) => ({ agents: [...state.agents, agent] })),

  removeAgent: (id) =>
    set((state) => ({ agents: state.agents.filter((a) => a.id !== id) })),

  setLoading: (loading) => set({ loading }),
}));
