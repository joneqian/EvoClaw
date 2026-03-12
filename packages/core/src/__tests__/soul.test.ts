import { describe, it, expect } from 'vitest'
import { parseSoul, generateSoul, soulToSystemPrompt } from '../domain/agent/soul.js'
import type { Soul } from '@evoclaw/shared'

const sampleSoul: Soul = {
  name: '小助',
  role: '全栈编程助手',
  personality: { tone: 'concise', expertise: ['TypeScript', 'React', 'Node.js'], language: ['中文'] },
  constraints: { always: ['使用中文回复', '给出代码示例'], never: ['使用 class 组件'] },
  interaction: { responseLength: 'short', proactiveAsk: true, citeSources: false },
  capabilities: { skills: [], knowledgeBases: [], tools: [] },
  evolution: { memoryDistillation: true, feedbackLearning: true, autoSkillDiscovery: false },
  model: { preferred: 'openai/gpt-4o-mini' },
}

describe('Soul Parser', () => {
  it('should generate and parse soul markdown roundtrip', () => {
    const md = generateSoul(sampleSoul)
    expect(md).toContain('name: 小助')
    expect(md).toContain('role: 全栈编程助手')
    expect(md).toContain('tone: concise')
    expect(md).toContain('TypeScript')
    expect(md).toContain('使用 class 组件')

    const parsed = parseSoul(md)
    expect(parsed.name).toBe('小助')
    expect(parsed.role).toBe('全栈编程助手')
    expect(parsed.personality.tone).toBe('concise')
    expect(parsed.personality.expertise).toContain('TypeScript')
    expect(parsed.constraints.never).toContain('使用 class 组件')
  })

  it('should generate system prompt', () => {
    const prompt = soulToSystemPrompt(sampleSoul)
    expect(prompt).toContain('小助')
    expect(prompt).toContain('全栈编程助手')
    expect(prompt).toContain('简洁直接')
    expect(prompt).toContain('TypeScript')
    expect(prompt).toContain('使用 class 组件')
  })

  it('should handle empty soul', () => {
    const emptySoul: Soul = {
      name: 'Test',
      role: 'Tester',
      personality: { tone: 'friendly', expertise: [], language: [] },
      constraints: { always: [], never: [] },
      interaction: { responseLength: 'medium', proactiveAsk: false, citeSources: false },
      capabilities: { skills: [], knowledgeBases: [], tools: [] },
      evolution: { memoryDistillation: false, feedbackLearning: false, autoSkillDiscovery: false },
      model: {},
    }
    const md = generateSoul(emptySoul)
    expect(md).toContain('name: Test')
    const prompt = soulToSystemPrompt(emptySoul)
    expect(prompt).toContain('Test')
  })
})
