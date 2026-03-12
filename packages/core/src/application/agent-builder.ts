import type { Soul } from '@evoclaw/shared'
import { agentRepository } from '../domain/agent/agent.js'
import { generateSoul, soulToSystemPrompt } from '../domain/agent/soul.js'
import { writeSoulFile, writeMemoryFile, generateInitialMemoryMd } from '../domain/agent/agent-fs.js'

export type BuilderPhase = 'role' | 'expertise' | 'style' | 'constraints' | 'preview' | 'done'

export interface BuilderState {
  phase: BuilderPhase
  soul: Partial<Soul>
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
}

const PHASE_PROMPTS: Record<Exclude<BuilderPhase, 'done'>, string> = {
  role: '你想创建什么类型的 Agent？请描述它的角色和名称。\n\n例如："一个叫小助的编程助手"、"翻译专家 TransBot"',
  expertise: '它擅长哪些领域？可以列举多个。\n\n例如："TypeScript, React, Node.js"、"英语、日语翻译"',
  style: '你喜欢什么样的回答风格？\n\n可选：\n- 正式专业 (formal)\n- 友好亲切 (friendly)\n- 幽默风趣 (humorous)\n- 简洁直接 (concise)\n\n另外回复长度偏好？短 / 适中 / 详细',
  constraints: '有什么特别的要求或限制吗？\n\n例如："始终使用中文回复"、"不要使用 class 组件"、"回答时引用来源"\n\n如果没有特殊要求，输入"无"即可。',
  preview: '预览已生成！你可以：\n1. 输入"确认"保存 Agent\n2. 输入"修改"回到上一步\n3. 直接和 Agent 试聊一句看看效果',
}

export class AgentBuilder {
  createInitialState(): BuilderState {
    return {
      phase: 'role',
      soul: {
        personality: { tone: 'friendly', expertise: [], language: ['中文'] },
        constraints: { always: [], never: [] },
        interaction: { responseLength: 'medium', proactiveAsk: true, citeSources: false },
        capabilities: { skills: [], knowledgeBases: [], tools: [] },
        evolution: { memoryDistillation: true, feedbackLearning: true, autoSkillDiscovery: false },
        model: {},
      },
      conversationHistory: [],
    }
  }

  getPrompt(state: BuilderState): string {
    if (state.phase === 'done') return '创建完成！'
    return PHASE_PROMPTS[state.phase]
  }

  processInput(state: BuilderState, userInput: string): { state: BuilderState; response: string; agentId?: string } {
    const input = userInput.trim()
    state.conversationHistory.push({ role: 'user', content: input })

    let response = ''

    switch (state.phase) {
      case 'role': {
        // Extract name and role from input
        const parts = input.split(/[,，：:]/).map(s => s.trim())
        const name = parts[0].replace(/^(创建|一个|叫做?|名为)\s*/g, '').trim() || input.slice(0, 20)
        const role = parts[1] || input
        state.soul.name = name
        state.soul.role = role
        state.phase = 'expertise'
        response = `好的，${name} - "${role}"。\n\n${PHASE_PROMPTS.expertise}`
        break
      }

      case 'expertise': {
        const expertise = input.split(/[,，、;；\n]/).map(s => s.trim()).filter(Boolean)
        state.soul.personality!.expertise = expertise
        state.phase = 'style'
        response = `专长已记录：${expertise.join('、')}\n\n${PHASE_PROMPTS.style}`
        break
      }

      case 'style': {
        const lower = input.toLowerCase()
        if (lower.includes('formal') || lower.includes('正式')) {
          state.soul.personality!.tone = 'formal'
        } else if (lower.includes('humor') || lower.includes('幽默')) {
          state.soul.personality!.tone = 'humorous'
        } else if (lower.includes('concise') || lower.includes('简洁') || lower.includes('直接')) {
          state.soul.personality!.tone = 'concise'
        } else {
          state.soul.personality!.tone = 'friendly'
        }

        if (lower.includes('短') || lower.includes('short')) {
          state.soul.interaction!.responseLength = 'short'
        } else if (lower.includes('详细') || lower.includes('detailed') || lower.includes('长')) {
          state.soul.interaction!.responseLength = 'detailed'
        }

        state.phase = 'constraints'
        response = `风格设定为"${state.soul.personality!.tone}"，长度"${state.soul.interaction!.responseLength}"。\n\n${PHASE_PROMPTS.constraints}`
        break
      }

      case 'constraints': {
        if (input !== '无' && input !== '没有') {
          const items = input.split(/[,，、;；\n]/).map(s => s.trim()).filter(Boolean)
          for (const item of items) {
            if (item.startsWith('不') || item.startsWith('禁') || item.includes('never')) {
              state.soul.constraints!.never.push(item)
            } else {
              state.soul.constraints!.always.push(item)
            }
          }
        }
        state.phase = 'preview'

        const soul = state.soul as Soul
        const preview = generateSoul(soul)
        response = `Agent 预览：\n\n\`\`\`markdown\n${preview}\`\`\`\n\n${PHASE_PROMPTS.preview}`
        break
      }

      case 'preview': {
        if (input === '确认' || input.includes('保存') || input.includes('confirm') || input === 'yes') {
          const soul = state.soul as Soul
          const soulContent = soulToSystemPrompt(soul)
          const agent = agentRepository.create(soul.name, soulContent)
          agentRepository.update(agent.id, { status: 'active' })

          // Write files
          writeSoulFile(agent.id, soul)
          writeMemoryFile(agent.id, generateInitialMemoryMd(soul.name))

          state.phase = 'done'
          response = `Agent "${soul.name}" 创建成功！ID: ${agent.id}\n\n你可以开始和它对话了。`
          return { state, response, agentId: agent.id }
        } else if (input === '修改' || input.includes('back')) {
          state.phase = 'constraints'
          response = `好，让我们重新设置。\n\n${PHASE_PROMPTS.constraints}`
        } else {
          response = `[试聊模式] 这是基于当前设定的预览回复。输入"确认"保存，或继续试聊。`
        }
        break
      }
    }

    state.conversationHistory.push({ role: 'assistant', content: response })
    return { state, response }
  }
}

export const agentBuilder = new AgentBuilder()
