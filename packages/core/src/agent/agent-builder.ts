import type { AgentConfig } from '@evoclaw/shared';
import { AgentManager } from './agent-manager.js';

/** Builder 阶段 */
export type BuilderStage = 'role' | 'expertise' | 'style' | 'constraints' | 'preview' | 'done';

/** Builder 状态 */
export interface BuilderState {
  stage: BuilderStage;
  agentId?: string;
  /** 收集的用户输入 */
  inputs: {
    role?: string;        // "你想让 Agent 扮演什么角色？"
    expertise?: string;   // "它擅长什么领域？"
    style?: string;       // "你希望它的沟通风格是？"
    constraints?: string; // "有什么限制或注意事项？"
    name?: string;        // "给它起个名字"
    emoji?: string;       // "选个代表 emoji"
  };
  /** 生成的文件内容预览 */
  preview: Record<string, string>;
}

/** Builder 响应 */
export interface BuilderResponse {
  stage: BuilderStage;
  message: string;
  preview?: Record<string, string>;
  agentId?: string;
  done: boolean;
}

/** Agent 对话式创建引导 — 6 阶段会话式创建向导 */
export class AgentBuilder {
  private agentManager: AgentManager;

  constructor(agentManager: AgentManager) {
    this.agentManager = agentManager;
  }

  /** 创建新的 Builder 会话 */
  createSession(): BuilderState {
    return {
      stage: 'role',
      inputs: {},
      preview: {},
    };
  }

  /** 处理用户输入，推进到下一阶段 */
  async advance(state: BuilderState, userInput: string): Promise<BuilderResponse> {
    switch (state.stage) {
      case 'role':
        state.inputs.role = userInput;
        state.stage = 'expertise';
        return {
          stage: 'expertise',
          message: '很好！你希望它擅长什么领域？比如：编程、写作、数据分析、日语学习...',
          done: false,
        };

      case 'expertise':
        state.inputs.expertise = userInput;
        state.stage = 'style';
        return {
          stage: 'style',
          message: '它的沟通风格应该是怎样的？比如：专业严谨、轻松幽默、简洁高效、耐心教学...',
          done: false,
        };

      case 'style':
        state.inputs.style = userInput;
        state.stage = 'constraints';
        return {
          stage: 'constraints',
          message: '有什么特殊限制或注意事项吗？比如：不要使用英文术语、回答控制在 200 字以内、必须附带参考来源... (输入"无"跳过)',
          done: false,
        };

      case 'constraints':
        state.inputs.constraints = userInput === '无' ? undefined : userInput;
        // 生成预览
        state.preview = this.generateWorkspaceFiles(state.inputs);
        // 从角色描述自动生成名称和 emoji
        state.inputs.name = state.inputs.name || this.generateName(state.inputs.role || 'AI Assistant');
        state.inputs.emoji = state.inputs.emoji || this.generateEmoji(state.inputs.role || '');
        state.stage = 'preview';
        return {
          stage: 'preview',
          message: `预览已生成！Agent 名称: ${state.inputs.emoji} ${state.inputs.name}\n\n输入"确认"创建 Agent，输入"修改名称 XXX"更改名称，或输入"重来"重新开始。`,
          preview: state.preview,
          done: false,
        };

      case 'preview': {
        const input = userInput.trim();

        if (input === '重来') {
          const newState = this.createSession();
          Object.assign(state, newState);
          return {
            stage: 'role',
            message: '好的，让我们重新开始。你想让 Agent 扮演什么角色？',
            done: false,
          };
        }

        if (input.startsWith('修改名称')) {
          const newName = input.replace('修改名称', '').trim();
          if (newName) {
            state.inputs.name = newName;
            state.preview = this.generateWorkspaceFiles(state.inputs);
            return {
              stage: 'preview',
              message: `名称已更新为: ${state.inputs.emoji} ${state.inputs.name}\n\n输入"确认"创建 Agent。`,
              preview: state.preview,
              done: false,
            };
          }
        }

        if (input === '确认' || input === '确定' || input === 'ok' || input === 'yes') {
          // 创建 Agent
          const agent = await this.agentManager.createAgent({
            name: state.inputs.name || 'AI Assistant',
            emoji: state.inputs.emoji || '🤖',
          });

          // 用生成的内容覆盖工作区文件
          for (const [file, content] of Object.entries(state.preview)) {
            this.agentManager.writeWorkspaceFile(agent.id, file, content);
          }

          // 激活 Agent
          this.agentManager.updateAgentStatus(agent.id, 'active');

          state.stage = 'done';
          state.agentId = agent.id;

          return {
            stage: 'done',
            message: `${state.inputs.emoji} ${state.inputs.name} 已创建成功！现在可以开始对话了。`,
            agentId: agent.id,
            done: true,
          };
        }

        return {
          stage: 'preview',
          message: '请输入"确认"创建 Agent，"修改名称 XXX"更改名称，或"重来"重新开始。',
          preview: state.preview,
          done: false,
        };
      }

      default:
        return {
          stage: state.stage,
          message: '创建流程已完成。',
          done: true,
        };
    }
  }

  /** 根据收集的输入生成工作区文件 */
  private generateWorkspaceFiles(inputs: BuilderState['inputs']): Record<string, string> {
    // Sprint 2: 从模板生成文件
    // 后续 Sprint 将调用 LLM 生成更细致的内容
    const soulMd = this.generateSoulMd(inputs);
    const identityMd = this.generateIdentityMd(inputs);
    const agentsMd = this.generateAgentsMd(inputs);

    return {
      'SOUL.md': soulMd,
      'IDENTITY.md': identityMd,
      'AGENTS.md': agentsMd,
      'TOOLS.md': '# 可用工具\n\n工具列表将在启动时动态注入。\n',
      'HEARTBEAT.md': '# 定时任务\n\n暂无配置的定时任务。\n',
      'USER.md': '',
      'MEMORY.md': '',
      'BOOTSTRAP.md': '# 启动流程\n\nAgent 启动时自动加载工作区文件并注入工具集。\n',
    };
  }

  private generateSoulMd(inputs: BuilderState['inputs']): string {
    const parts = ['# 行为哲学\n'];

    if (inputs.role) {
      parts.push(`## 角色定位\n你是一个${inputs.role}。\n`);
    }

    parts.push('## 核心价值观\n');
    parts.push('1. **诚实透明** — 不确定时坦诚说明，不编造信息');
    parts.push('2. **用户优先** — 理解用户真实意图，给出最有帮助的回答');
    parts.push('3. **持续学习** — 从每次对话中积累经验，不断进化');
    parts.push('4. **安全负责** — 拒绝有害请求，保护用户隐私\n');

    if (inputs.constraints) {
      parts.push(`## 限制与注意事项\n${inputs.constraints}\n`);
    }

    return parts.join('\n');
  }

  private generateIdentityMd(inputs: BuilderState['inputs']): string {
    const name = inputs.name || 'AI Assistant';
    const emoji = inputs.emoji || '🤖';
    return `---\nname: ${name}\nemoji: ${emoji}\nversion: 1\n---\n\n# ${emoji} ${name}\n\n${inputs.role ? `角色: ${inputs.role}` : ''}\n${inputs.expertise ? `专长: ${inputs.expertise}` : ''}\n`;
  }

  private generateAgentsMd(inputs: BuilderState['inputs']): string {
    const parts = ['# 操作规程\n'];

    parts.push('## 对话规范');
    if (inputs.style) {
      parts.push(`- 沟通风格: ${inputs.style}`);
    }
    parts.push('- 使用中文回复用户');
    parts.push('- 回答简洁准确，避免冗余\n');

    if (inputs.expertise) {
      parts.push(`## 专业领域\n- ${inputs.expertise}\n`);
    }

    parts.push('## 工具使用');
    parts.push('- 需要使用工具时，先说明意图再执行');
    parts.push('- 操作前确认影响范围');
    parts.push('- 完成后报告结果\n');

    return parts.join('\n');
  }

  /** 从角色描述提取关键词生成名称 */
  generateName(role: string): string {
    const keywords = role.replace(/[，。、！？（）]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
    if (keywords.length > 0) {
      return keywords.slice(0, 2).join('') + '助手';
    }
    return 'AI 助手';
  }

  /** 根据角色关键词匹配 emoji */
  generateEmoji(role: string): string {
    const emojiMap: Record<string, string> = {
      '编程': '💻', '代码': '💻', '开发': '💻',
      '写作': '✍️', '文案': '✍️', '创作': '✍️',
      '翻译': '🌐', '语言': '🌐',
      '数据': '📊', '分析': '📊', '统计': '📊',
      '教学': '📚', '学习': '📚', '教育': '📚',
      '设计': '🎨', '美术': '🎨', 'UI': '🎨',
      '运营': '📈', '营销': '📈',
      '客服': '🎧', '支持': '🎧',
      '法律': '⚖️', '合同': '⚖️',
      '医疗': '🏥', '健康': '🏥',
      '音乐': '🎵', '财务': '💰', '投资': '💰',
    };
    for (const [keyword, emoji] of Object.entries(emojiMap)) {
      if (role.includes(keyword)) return emoji;
    }
    return '🤖';
  }
}
