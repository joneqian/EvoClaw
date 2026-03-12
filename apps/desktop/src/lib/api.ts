import { getSidecarInfo } from './tauri'

async function getBaseUrl(): Promise<string> {
  try {
    const { port } = await getSidecarInfo()
    return `http://127.0.0.1:${port}`
  } catch {
    return 'http://127.0.0.1:3721'
  }
}

async function getHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const { token } = await getSidecarInfo()
    headers['Authorization'] = `Bearer ${token}`
  } catch {
    // Dev mode without Tauri
  }
  return headers
}

async function apiFetch(path: string, options?: RequestInit) {
  const baseUrl = await getBaseUrl()
  const headers = await getHeaders()
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  })
}

// ---- Chat ----

export async function sendMessage(
  message: string,
  options?: { agentId?: string; conversationId?: string; model?: string },
  onChunk?: (text: string) => void,
): Promise<{ messageId: string; conversationId: string }> {
  const response = await apiFetch('/api/chat/message', {
    method: 'POST',
    body: JSON.stringify({
      message,
      agentId: options?.agentId,
      conversationId: options?.conversationId,
      model: options?.model,
    }),
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let messageId = ''
  let conversationId = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const text = decoder.decode(value, { stream: true })
    const lines = text.split('\n')

    for (const line of lines) {
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim()
        if (!data) continue
        try {
          const parsed = JSON.parse(data)
          if (parsed.content && onChunk) {
            onChunk(parsed.content)
          }
          if (parsed.messageId) {
            messageId = parsed.messageId
            conversationId = parsed.conversationId
          }
        } catch {
          // skip malformed data
        }
      }
    }
  }

  return { messageId, conversationId }
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await apiFetch('/api/health')
    return res.ok
  } catch {
    return false
  }
}

// ---- Agents ----

export interface AgentData {
  id: string
  name: string
  status: string
  soulContent: string
  createdAt: number
  updatedAt: number
}

export async function listAgents(): Promise<AgentData[]> {
  const res = await apiFetch('/api/agents')
  const data = await res.json()
  return data.agents
}

export async function getAgent(id: string): Promise<AgentData> {
  const res = await apiFetch(`/api/agents/${id}`)
  const data = await res.json()
  return data.agent
}

export async function updateAgent(id: string, updates: Partial<AgentData>): Promise<AgentData> {
  const res = await apiFetch(`/api/agents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
  const data = await res.json()
  return data.agent
}

export async function archiveAgent(id: string): Promise<void> {
  await apiFetch(`/api/agents/${id}/archive`, { method: 'POST' })
}

export async function deleteAgent(id: string): Promise<void> {
  await apiFetch(`/api/agents/${id}`, { method: 'DELETE' })
}

// ---- Agent Builder ----

export interface BuilderResponse {
  sessionId?: string
  phase: string
  message: string
  agentId?: string
}

export async function startBuilder(): Promise<BuilderResponse> {
  const res = await apiFetch('/api/agents/builder/start', { method: 'POST' })
  return res.json()
}

export async function sendBuilderMessage(sessionId: string, message: string): Promise<BuilderResponse> {
  const res = await apiFetch(`/api/agents/builder/${sessionId}/message`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  })
  return res.json()
}

// ---- Permissions ----

export interface PermissionGrant {
  id: string
  agentId: string
  category: string
  scope: string
  resource?: string
  grantedBy: string
  grantedAt: number
}

export async function listPermissions(agentId: string): Promise<PermissionGrant[]> {
  const res = await apiFetch(`/api/permissions/${agentId}`)
  const data = await res.json()
  return data.grants
}

export async function grantPermission(agentId: string, category: string, scope: string): Promise<void> {
  await apiFetch('/api/permissions/grant', {
    method: 'POST',
    body: JSON.stringify({ agentId, category, scope }),
  })
}

export async function revokePermissions(agentId: string, category?: string): Promise<void> {
  await apiFetch('/api/permissions/revoke', {
    method: 'POST',
    body: JSON.stringify({ agentId, category }),
  })
}
