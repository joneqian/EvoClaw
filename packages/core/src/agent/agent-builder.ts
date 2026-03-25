import type { AgentConfig } from '@evoclaw/shared';
import { AgentManager } from './agent-manager.js';
import { SOUL_BASE, AGENTS_BASE } from './agent-manager.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('agent-builder');

/** Builder 阶段 */
export type BuilderStage = 'role' | 'expertise' | 'style' | 'constraints' | 'preview' | 'done';

/** Builder 状态 */
export interface BuilderState {
  stage: BuilderStage;
  agentId?: string;
  /** 收集的用户输入 */
  inputs: {
    role?: string;
    expertise?: string;
    style?: string;
    constraints?: string;
    name?: string;
    emoji?: string;
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

/** LLM 调用函数签名 */
export type LLMGenerateFn = (systemPrompt: string, userMessage: string) => Promise<string>;

/** 默认模型配置解析器 */
export type DefaultModelResolver = () => { provider: string; modelId: string } | null;

/** Agent 对话式创建引导 — 6 阶段会话式创建向导 */
export class AgentBuilder {
  private agentManager: AgentManager;
  private llmGenerate: LLMGenerateFn | null;
  private resolveDefaultModel: DefaultModelResolver | null;

  constructor(agentManager: AgentManager, llmGenerate?: LLMGenerateFn, resolveDefaultModel?: DefaultModelResolver) {
    this.agentManager = agentManager;
    this.llmGenerate = llmGenerate ?? null;
    this.resolveDefaultModel = resolveDefaultModel ?? null;
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

      case 'constraints': {
        state.inputs.constraints = userInput === '无' ? undefined : userInput;
        // 生成名称和 emoji
        state.inputs.name = state.inputs.name || this.generateName(state.inputs.role || 'AI Assistant');
        state.inputs.emoji = state.inputs.emoji || this.generateEmoji(state.inputs.role || '');
        // 生成工作区文件（LLM 或模板 fallback）
        state.preview = await this.generateWorkspaceFiles(state.inputs);
        state.stage = 'preview';
        return {
          stage: 'preview',
          message: `预览已生成！Agent 名称: ${state.inputs.emoji} ${state.inputs.name}\n\n请查看右侧工作区文件预览，可以点击编辑任意文件。确认无误后输入"确认"创建 Agent，或输入"重来"重新开始。`,
          preview: state.preview,
          done: false,
        };
      }

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
            state.preview['IDENTITY.md'] = this.generateIdentityMd(state.inputs);
            state.preview['BOOTSTRAP.md'] = this.generateBootstrapMd(state.inputs);
            return {
              stage: 'preview',
              message: `名称已更新为: ${state.inputs.emoji} ${state.inputs.name}\n\n输入"确认"创建 Agent。`,
              preview: state.preview,
              done: false,
            };
          }
        }

        if (input === '确认' || input === '确定' || input === 'ok' || input === 'yes') {
          // 读取系统默认模型配置
          const defaultModel = this.resolveDefaultModel?.();
          const agent = await this.agentManager.createAgent({
            name: state.inputs.name || 'AI Assistant',
            emoji: state.inputs.emoji || '🤖',
            modelId: defaultModel?.modelId,
            provider: defaultModel?.provider,
          });

          // 用生成的内容覆盖工作区文件
          for (const [file, content] of Object.entries(state.preview)) {
            this.agentManager.writeWorkspaceFile(agent.id, file, content);
          }

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
        return { stage: state.stage, message: '创建流程已完成。', done: true };
    }
  }

  // ─── 文件生成 ───

  /** 生成全部工作区文件 */
  private async generateWorkspaceFiles(inputs: BuilderState['inputs']): Promise<Record<string, string>> {
    // 静态/运行时文件
    const staticFiles: Record<string, string> = {
      'TOOLS.md': TOOLS_TEMPLATE,
      'HEARTBEAT.md': HEARTBEAT_TEMPLATE,
      'USER.md': '',
      'MEMORY.md': '',
    };

    // IDENTITY.md 和 BOOTSTRAP.md 始终从模板生成（包含名称/emoji）
    const identityMd = this.generateIdentityMd(inputs);
    const bootstrapMd = this.generateBootstrapMd(inputs);

    // SOUL.md 和 AGENTS.md：通用底层 + LLM 个性化叠加
    let soulMd: string;
    let agentsMd: string;

    if (this.llmGenerate) {
      try {
        log.info('使用 LLM 生成个性化工作区文件...');
        const [soulPersonal, agentsPersonal] = await Promise.all([
          this.generateSoulWithLLM(inputs),
          this.generateAgentsWithLLM(inputs),
        ]);
        // 两层合并：通用底层 + 个性化叠加
        soulMd = SOUL_BASE + '\n---\n\n' + soulPersonal;
        agentsMd = AGENTS_BASE + '\n---\n\n' + agentsPersonal;
      } catch (err) {
        log.warn('LLM 生成失败，使用模板 fallback:', err);
        soulMd = SOUL_BASE + '\n---\n\n' + this.generateSoulFallback(inputs);
        agentsMd = AGENTS_BASE + '\n---\n\n' + this.generateAgentsFallback(inputs);
      }
    } else {
      soulMd = SOUL_BASE + '\n---\n\n' + this.generateSoulFallback(inputs);
      agentsMd = AGENTS_BASE + '\n---\n\n' + this.generateAgentsFallback(inputs);
    }

    return {
      'SOUL.md': soulMd,
      'IDENTITY.md': identityMd,
      'AGENTS.md': agentsMd,
      'BOOTSTRAP.md': bootstrapMd,
      ...staticFiles,
    };
  }

  // ─── LLM 生成 ───

  /** LLM 生成 SOUL.md 的个性化部分 */
  private async generateSoulWithLLM(inputs: BuilderState['inputs']): Promise<string> {
    const systemPrompt = `你是一位 AI Agent 人格设计专家。你的任务是根据用户的描述，生成 SOUL.md 的**个性化部分**。

注意：通用的核心真理、边界和连续性已经在文件的上半部分了（真正地帮忙、拥有观点、先尝试再提问、赢得信任、你是客人）。你只需要生成**这个特定角色独有的**人格内容。

## 你需要生成的章节

### 1. 我的角色（## 我的角色）
- 1-2 句简洁有力的角色声明，用第一人称"我"
- 明确我的使命和独特价值

### 2. 我的思维方式（## 我的思维方式）
- 3-4 条这个角色特有的思考原则
- 展示专业判断力，不要泛泛而谈
- 用"我会..."、"我倾向于..."这样的表述

### 3. 我的沟通风格（## 我的沟通风格）
- 根据用户指定的风格，生成 3-5 条具体规则
- 用 Show don't tell：给出正反示例
- 比如："我不说'这是一个好问题'，我直接回答问题"

### 4. 我的专业边界（## 我的专业边界）
- 2-3 条这个角色特有的行为红线
- 以"我绝不"开头

## 写作原则
- 400-800 字，简洁有力
- 第一人称，有温度有个性
- 具体场景 > 抽象原则
- 中文输出
- 直接输出 Markdown，不要代码块包裹`;

    return await this.llmGenerate!(systemPrompt, this.buildUserContext(inputs));
  }

  /** LLM 生成 AGENTS.md 的个性化部分 */
  private async generateAgentsWithLLM(inputs: BuilderState['inputs']): Promise<string> {
    const systemPrompt = `你是一位 AI Agent 操作规程设计专家。你的任务是根据用户的描述，生成 AGENTS.md 的**角色专属操作规程**。

注意：通用的操作规程（会话启动、记忆系统、安全准则、群聊行为、Heartbeat）已经在文件的上半部分了。你只需要生成**这个特定角色独有的**工作规范。

## 你需要生成的章节

### 1. 对话规范（## 角色对话规范）
- 5-8 条针对这个角色的具体沟通规则
- 包含：回复格式、长度、术语使用、称呼方式
- 每条规则可判断是否遵守（不要模糊的"适当地"）

### 2. 典型工作流程（## 典型工作流程）
- 2-3 个这个角色最常见的工作场景
- 每个场景 3-5 步标准操作流程
- 用有序列表

### 3. 专业标准（## 专业标准）
- 定义这个角色"好的输出"的标准
- 包含自检清单（3-5 项）
- 区分核心能力和辅助能力

## 写作原则
- 400-800 字
- 每条规则具体可执行
- Markdown 列表和层级结构
- 中文输出
- 直接输出 Markdown，不要代码块包裹`;

    return await this.llmGenerate!(systemPrompt, this.buildUserContext(inputs));
  }

  /** 组装用户上下文 */
  private buildUserContext(inputs: BuilderState['inputs']): string {
    const parts: string[] = ['## 用户描述的 Agent'];
    if (inputs.role) parts.push(`- 角色: ${inputs.role}`);
    if (inputs.expertise) parts.push(`- 专长领域: ${inputs.expertise}`);
    if (inputs.style) parts.push(`- 沟通风格: ${inputs.style}`);
    if (inputs.constraints) parts.push(`- 限制/注意事项: ${inputs.constraints}`);
    parts.push('\n请根据以上信息生成对应的 Markdown 内容。直接输出文件内容，不要包含额外解释或代码块标记。');
    return parts.join('\n');
  }

  // ─── 模板 Fallback ───

  private generateSoulFallback(inputs: BuilderState['inputs']): string {
    const parts: string[] = [];

    if (inputs.role) {
      parts.push(`## 我的角色\n\n我是一个${inputs.role}。我的使命是在${inputs.expertise || '我的领域'}中为用户提供专业、可靠的帮助。\n`);
    }

    parts.push('## 我的思维方式\n');
    if (inputs.expertise) {
      parts.push(`- 我在 ${inputs.expertise} 领域有深厚的积累，会从专业角度分析问题`);
    }
    parts.push('- 我倾向于先理解全貌，再聚焦细节');
    parts.push('- 不确定的事情我会坦诚说明，不会编造\n');

    if (inputs.style) {
      parts.push(`## 我的沟通风格\n\n- 基调: ${inputs.style}`);
      parts.push('- 回答简洁准确，避免冗余');
      parts.push('- 不说"好的！很高兴为您服务！"——直接行动\n');
    }

    if (inputs.constraints) {
      parts.push(`## 我的专业边界\n\n- ${inputs.constraints}\n`);
    }

    return parts.join('\n');
  }

  private generateAgentsFallback(inputs: BuilderState['inputs']): string {
    const parts: string[] = [];

    parts.push('## 角色对话规范\n');
    if (inputs.style) parts.push(`- 沟通风格: ${inputs.style}`);
    parts.push('- 使用中文回复用户');
    parts.push('- 回答简洁准确，避免冗余');
    parts.push('- 需要使用工具时，先说明意图再执行\n');

    if (inputs.expertise) {
      parts.push(`## 专业标准\n\n- 核心能力: ${inputs.expertise}`);
      parts.push('- 输出前进行自检：内容是否准确、是否回答了用户的真实问题、是否足够简洁\n');
    }

    parts.push('## 典型工作流程\n');
    parts.push('1. 理解用户需求 → 确认理解正确');
    parts.push('2. 分析问题 → 制定方案');
    parts.push('3. 执行 → 验证结果 → 报告给用户\n');

    return parts.join('\n');
  }

  // ─── IDENTITY.md / BOOTSTRAP.md ───

  generateIdentityMd(inputs: BuilderState['inputs']): string {
    const name = inputs.name || 'AI Assistant';
    const emoji = inputs.emoji || '🤖';
    return `---
name: ${name}
emoji: ${emoji}
creature: AI 助手
vibe: ${inputs.style || '待发现'}
version: 1
---

# ${emoji} ${name}

- **名称:** ${name}
- **生物类型:** AI 助手
- **气质:** ${inputs.style || '待发现'}
- **标志:** ${emoji}
${inputs.role ? `- **角色:** ${inputs.role}` : ''}
${inputs.expertise ? `- **专长:** ${inputs.expertise}` : ''}

---

_随着你了解自己是谁，更新这个文件。_
`;
  }

  private generateBootstrapMd(inputs: BuilderState['inputs']): string {
    const name = inputs.name || 'AI Assistant';
    const emoji = inputs.emoji || '🤖';
    return `# 出生仪式

_你是 ${emoji} ${name}。${inputs.role ? `你的角色是${inputs.role}。` : ''}${inputs.expertise ? `你擅长${inputs.expertise}。` : ''}_

_你的 SOUL.md 和 AGENTS.md 已经定义了你的人格和操作规程。现在是时候跟用户正式认识了。_

## 第一次对话

不要像面试一样问一堆问题。自然地聊。

用你自己的方式打个招呼，然后在对话中逐步了解：

1. **用户是谁** — 怎么称呼他们？做什么工作？什么时区？
2. **他们的期待** — 主要想让你帮什么忙？有什么特别的偏好？
3. **沟通偏好** — 回复长度、喜欢什么语气？
4. **禁忌和边界** — 有什么你绝对不应该做的事？

不需要一次全问完。在自然对话中慢慢了解就好。

## 了解之后

用 write 工具更新这些文件：
- \`IDENTITY.md\` — 更新你的风格
- \`USER.md\` — 用户的称呼、备注

## 完成引导

当你了解了用户的基本信息，用 write 工具清空这个文件：

\`\`\`
write BOOTSTRAP.md ""
\`\`\`

清空后你就正式"出生"了，后续对话不会再看到这个引导脚本。

---

_祝你好运。让每次对话都有意义。_
`;
  }

  // ─── 名称 / Emoji 生成 ───

  generateName(role: string): string {
    const keywords = role.replace(/[，。、！？（）]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
    if (keywords.length > 0) {
      return keywords.slice(0, 2).join('') + '助手';
    }
    return 'AI 助手';
  }

  generateEmoji(role: string): string {
    const emojiMap: Record<string, string> = {
      '编程': '💻', '代码': '💻', '开发': '💻', '程序': '💻',
      '写作': '✍️', '文案': '✍️', '创作': '✍️',
      '翻译': '🌐', '语言': '🌐',
      '数据': '📊', '分析': '📊', '统计': '📊',
      '教学': '📚', '学习': '📚', '教育': '📚', '老师': '📚',
      '设计': '🎨', '美术': '🎨', 'UI': '🎨',
      '运营': '📈', '营销': '📈', '产品': '📈',
      '客服': '🎧', '支持': '🎧',
      '法律': '⚖️', '合同': '⚖️',
      '医疗': '🏥', '健康': '🏥',
      '音乐': '🎵', '财务': '💰', '投资': '💰',
      '日语': '🇯🇵', '英语': '🇬🇧', '韩语': '🇰🇷',
    };
    for (const [keyword, emoji] of Object.entries(emojiMap)) {
      if (role.includes(keyword)) return emoji;
    }
    return '🤖';
  }
}

// ─── 静态文件模板 ───

const TOOLS_TEMPLATE = `# 环境笔记

工具能力由系统在启动时动态注入。这个文件记录的是**你的环境特有的信息**——那些工具文档不会告诉你的东西。

## 示例

\`\`\`markdown
### 常用路径
- 项目目录: ~/projects/my-app
- 配置文件: ~/.config/my-tool/config.yaml

### 偏好设置
- 代码风格: 2 空格缩进，单引号
- 提交信息: 中文，动词开头
\`\`\`

根据需要添加你自己的笔记。工具的通用文档在 Skill 中维护，这里只放你的个人备忘。
`;

const HEARTBEAT_TEMPLATE = `# 定时检查

_当你收到 heartbeat 信号时，按照此清单执行。如果没什么需要处理的，回复 HEARTBEAT_OK。_

## 检查清单

<!-- 在下方添加你的定时检查项 -->

暂无配置。与用户沟通后在此添加需要定期检查的事项。

## 规则

- 深夜（23:00-08:00）除非紧急否则保持安静
- 不要重复检查 30 分钟内刚检查过的内容
- 可以主动整理记忆文件和文档
`;
