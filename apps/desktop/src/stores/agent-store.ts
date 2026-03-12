import { create } from 'zustand'
import { listAgents, type AgentData, archiveAgent, deleteAgent } from '../lib/api'

interface AgentState {
  agents: AgentData[]
  selectedAgentId: string | null
  loading: boolean

  fetchAgents: () => Promise<void>
  selectAgent: (id: string | null) => void
  archiveAgent: (id: string) => Promise<void>
  deleteAgent: (id: string) => Promise<void>
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  selectedAgentId: null,
  loading: false,

  fetchAgents: async () => {
    set({ loading: true })
    try {
      const agents = await listAgents()
      set({ agents, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  selectAgent: (id) => set({ selectedAgentId: id }),

  archiveAgent: async (id) => {
    await archiveAgent(id)
    await get().fetchAgents()
    if (get().selectedAgentId === id) set({ selectedAgentId: null })
  },

  deleteAgent: async (id) => {
    await deleteAgent(id)
    await get().fetchAgents()
    if (get().selectedAgentId === id) set({ selectedAgentId: null })
  },
}))
