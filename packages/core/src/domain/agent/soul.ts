import type { Soul } from '@evoclaw/shared'

/**
 * Parse a SOUL.md markdown string into a Soul object.
 * Format:
 * ---
 * name: ...
 * role: ...
 * ---
 * ## 性格
 * - 语调: friendly
 * - 专长: TypeScript, React
 * ...
 */
export function parseSoul(markdown: string): Soul {
  const soul: Soul = {
    name: '',
    role: '',
    personality: { tone: 'friendly', expertise: [], language: ['中文'] },
    constraints: { always: [], never: [] },
    interaction: { responseLength: 'medium', proactiveAsk: true, citeSources: false },
    capabilities: { skills: [], knowledgeBases: [], tools: [] },
    evolution: { memoryDistillation: true, feedbackLearning: true, autoSkillDiscovery: false },
    model: {},
  }

  // Parse YAML frontmatter
  const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---/)
  if (fmMatch) {
    const fm = fmMatch[1]
    for (const line of fm.split('\n')) {
      const [key, ...rest] = line.split(':')
      const value = rest.join(':').trim()
      if (key.trim() === 'name') soul.name = value
      if (key.trim() === 'role') soul.role = value
      if (key.trim() === 'avatar') soul.avatar = value
      if (key.trim() === 'tone') soul.personality.tone = value as Soul['personality']['tone']
      if (key.trim() === 'responseLength') soul.interaction.responseLength = value as Soul['interaction']['responseLength']
      if (key.trim() === 'preferred_model') soul.model.preferred = value
      if (key.trim() === 'fallback_model') soul.model.fallback = value
    }
  }

  // Parse sections
  const sections = markdown.split(/^## /m).slice(1)
  for (const section of sections) {
    const [title, ...lines] = section.split('\n')
    const items = lines
      .filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2).trim())

    const titleLower = title.trim().toLowerCase()
    if (titleLower.includes('专长') || titleLower.includes('expertise')) {
      soul.personality.expertise = items
    } else if (titleLower.includes('语言') || titleLower.includes('language')) {
      soul.personality.language = items
    } else if (titleLower.includes('始终') || titleLower.includes('always')) {
      soul.constraints.always = items
    } else if (titleLower.includes('禁止') || titleLower.includes('never')) {
      soul.constraints.never = items
    }
  }

  return soul
}

/**
 * Generate a SOUL.md markdown string from a Soul object.
 */
export function generateSoul(soul: Soul): string {
  const lines: string[] = []

  lines.push('---')
  lines.push(`name: ${soul.name}`)
  lines.push(`role: ${soul.role}`)
  if (soul.avatar) lines.push(`avatar: ${soul.avatar}`)
  lines.push(`tone: ${soul.personality.tone}`)
  lines.push(`responseLength: ${soul.interaction.responseLength}`)
  if (soul.model.preferred) lines.push(`preferred_model: ${soul.model.preferred}`)
  if (soul.model.fallback) lines.push(`fallback_model: ${soul.model.fallback}`)
  lines.push('---')
  lines.push('')

  lines.push(`# ${soul.name}`)
  lines.push('')
  lines.push(`> ${soul.role}`)
  lines.push('')

  if (soul.personality.expertise.length > 0) {
    lines.push('## 专长领域')
    for (const e of soul.personality.expertise) lines.push(`- ${e}`)
    lines.push('')
  }

  if (soul.personality.language.length > 0) {
    lines.push('## 使用语言')
    for (const l of soul.personality.language) lines.push(`- ${l}`)
    lines.push('')
  }

  if (soul.constraints.always.length > 0) {
    lines.push('## 始终遵守')
    for (const a of soul.constraints.always) lines.push(`- ${a}`)
    lines.push('')
  }

  if (soul.constraints.never.length > 0) {
    lines.push('## 禁止事项')
    for (const n of soul.constraints.never) lines.push(`- ${n}`)
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Generate a system prompt from a Soul for LLM consumption.
 */
export function soulToSystemPrompt(soul: Soul): string {
  const parts: string[] = []

  parts.push(`你是 ${soul.name}，角色是 ${soul.role}。`)

  if (soul.personality.tone) {
    const toneMap: Record<string, string> = {
      formal: '正式专业的',
      friendly: '友好亲切的',
      humorous: '幽默风趣的',
      concise: '简洁直接的',
    }
    parts.push(`你的语调风格是${toneMap[soul.personality.tone] || soul.personality.tone}。`)
  }

  if (soul.personality.expertise.length > 0) {
    parts.push(`你的专长领域包括：${soul.personality.expertise.join('、')}。`)
  }

  if (soul.personality.language.length > 0) {
    parts.push(`你使用的语言：${soul.personality.language.join('、')}。`)
  }

  const lengthMap: Record<string, string> = {
    short: '简短',
    medium: '适中',
    detailed: '详细',
  }
  parts.push(`回复长度偏好：${lengthMap[soul.interaction.responseLength] || soul.interaction.responseLength}。`)

  if (soul.interaction.proactiveAsk) {
    parts.push('当信息不足时，主动提问以澄清需求。')
  }

  if (soul.interaction.citeSources) {
    parts.push('回复时引用信息来源。')
  }

  if (soul.constraints.always.length > 0) {
    parts.push('\n始终遵守：')
    for (const a of soul.constraints.always) parts.push(`- ${a}`)
  }

  if (soul.constraints.never.length > 0) {
    parts.push('\n禁止事项：')
    for (const n of soul.constraints.never) parts.push(`- ${n}`)
  }

  return parts.join('\n')
}
