import type { AgentConfig } from '@evoclaw/shared';
import { AgentManager } from './agent-manager.js';
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

/** LLM 调用函数签名 */
export type LLMGenerateFn = (systemPrompt: string, userMessage: string) => Promise<string>;

/** Agent 对话式创建引导 — 6 阶段会话式创建向导 */
export class AgentBuilder {
  private agentManager: AgentManager;
  private llmGenerate: LLMGenerateFn | null;

  constructor(agentManager: AgentManager, llmGenerate?: LLMGenerateFn) {
    this.agentManager = agentManager;
    this.llmGenerate = llmGenerate ?? null;
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
        // 生成工作区文件（LLM 或模板 fallback）
        state.preview = await this.generateWorkspaceFiles(state.inputs);
        // 从角色描述自动生成名称和 emoji
        state.inputs.name = state.inputs.name || this.generateName(state.inputs.role || 'AI Assistant');
        state.inputs.emoji = state.inputs.emoji || this.generateEmoji(state.inputs.role || '');
        state.stage = 'preview';
        return {
          stage: 'preview',
          message: `预览已生成！Agent 名称: ${state.inputs.emoji} ${state.inputs.name}\n\n请查看右侧工作区文件预览。输入"确认"创建 Agent，输入"修改名称 XXX"更改名称，或输入"重来"重新开始。`,
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
            // 重新生成 IDENTITY.md
            state.preview['IDENTITY.md'] = this.generateIdentityMdTemplate(state.inputs);
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

  /** 根据收集的输入生成工作区文件 — 优先使用 LLM，fallback 到模板 */
  private async generateWorkspaceFiles(inputs: BuilderState['inputs']): Promise<Record<string, string>> {
    // 静态文件（运行时动态填充或固定内容）
    const staticFiles: Record<string, string> = {
      'TOOLS.md': '# 可用工具\n\n工具列表将在启动时动态注入。\n',
      'HEARTBEAT.md': '# 定时任务\n\n暂无配置的定时任务。\n',
      'USER.md': '',
      'MEMORY.md': '',
      'BOOTSTRAP.md': '# 启动流程\n\nAgent 启动时自动执行以下步骤：\n1. 加载 SOUL.md 和 IDENTITY.md\n2. 加载 AGENTS.md 操作规程\n3. 渲染 USER.md 和 MEMORY.md\n4. 注入工具集\n',
    };

    // 需要 LLM 生成的 3 个核心文件
    if (this.llmGenerate) {
      try {
        log.info('使用 LLM 生成工作区文件...');
        const [soulMd, agentsMd] = await Promise.all([
          this.generateSoulWithLLM(inputs),
          this.generateAgentsWithLLM(inputs),
        ]);
        const identityMd = this.generateIdentityMdTemplate(inputs);

        return { 'SOUL.md': soulMd, 'IDENTITY.md': identityMd, 'AGENTS.md': agentsMd, ...staticFiles };
      } catch (err) {
        log.warn('LLM 生成失败，使用模板 fallback:', err);
      }
    }

    // Fallback: 纯模板
    return {
      'SOUL.md': this.generateSoulMdTemplate(inputs),
      'IDENTITY.md': this.generateIdentityMdTemplate(inputs),
      'AGENTS.md': this.generateAgentsMdTemplate(inputs),
      ...staticFiles,
    };
  }

  // ─── LLM 生成方法 ───

  /** 使用 LLM 生成 SOUL.md — Agent 的行为哲学和人格内核 */
  private async generateSoulWithLLM(inputs: BuilderState['inputs']): Promise<string> {
    const systemPrompt = `你是一位 AI Agent 人格设计专家。你的任务是根据用户描述，生成一份高质量的 SOUL.md 文件。

SOUL.md 是 Agent 的"灵魂"——定义它如何思考、如何与用户互动、什么是它坚守的原则。

## 文件结构要求

生成的 SOUL.md 必须包含以下章节：

### 1. 角色定位（## 角色定位）
- 一段简洁有力的角色声明（1-2 句）
- 明确这个 Agent 的使命是什么

### 2. 核心价值观（## 核心价值观）
- 3-5 条具体的价值观，不要泛泛而谈
- 每条应反映这个特定角色的特点，而非通用 AI 原则
- 格式：**关键词** — 具体说明

### 3. 思维方式（## 思维方式）
- 描述这个角色处理问题时的思维模式
- 包含 2-3 条具体的思考原则
- 展示这个角色特有的专业判断力

### 4. 沟通原则（## 沟通原则）
- 根据用户指定的沟通风格，生成 3-5 条具体的沟通规则
- 用"做什么"和"不做什么"对比展示
- 包含示例性说明

### 5. 行为边界（## 行为边界）
- 3-5 条明确的不可逾越的红线
- 格式：以"绝不"或"不会"开头的否定句
- 体现对用户负责的态度

## 写作原则
- 总长度控制在 800-1500 字
- 语言简洁有力，避免啰嗦
- 用具体场景说明抽象原则（Show, don't tell）
- 以第一人称"我"书写（这是 Agent 的自我认知）
- 必须使用中文`;

    const userMessage = this.buildUserContext(inputs);
    return await this.llmGenerate!(systemPrompt, userMessage);
  }

  /** 使用 LLM 生成 AGENTS.md — Agent 的操作规程 */
  private async generateAgentsWithLLM(inputs: BuilderState['inputs']): Promise<string> {
    const systemPrompt = `你是一位 AI Agent 操作规程设计专家。你的任务是根据用户描述，生成一份高质量的 AGENTS.md 文件。

AGENTS.md 是 Agent 的"操作手册"——定义它在日常工作中遵循的标准流程和规范。

## 文件结构要求

### 1. 对话规范（## 对话规范）
- 根据沟通风格生成 5-8 条具体规则
- 包含：回复格式、长度控制、语言使用、称呼方式等
- 每条规则要有可操作性（能判断是否遵守）

### 2. 工作流程（## 工作流程）
- 根据角色和专长，描述处理典型任务的标准步骤
- 用有序列表描述关键流程（2-3 个典型场景）
- 每个流程 3-5 步

### 3. 专业领域（## 专业领域）
- 列出核心专长领域和具体能力
- 说明在该领域的专业标准
- 标注自信程度（核心能力 vs 辅助能力）

### 4. 工具使用（## 工具使用）
- 使用工具前后的标准流程
- 操作前告知用户意图
- 操作后报告结果和影响
- 对破坏性操作的额外确认机制

### 5. 质量标准（## 质量标准）
- 定义"好的回答"的标准
- 包含自我检查清单
- 说明何时应该主动寻求用户反馈

## 写作原则
- 总长度控制在 600-1200 字
- 每条规则必须具体可执行，避免模糊表述
- 用 Markdown 列表和层级结构组织
- 以第三人称描述 Agent 应遵循的规范
- 必须使用中文`;

    const userMessage = this.buildUserContext(inputs);
    return await this.llmGenerate!(systemPrompt, userMessage);
  }

  /** 组装用户上下文描述 */
  private buildUserContext(inputs: BuilderState['inputs']): string {
    const parts: string[] = [];
    parts.push(`## 用户描述的 Agent`);
    if (inputs.role) parts.push(`- 角色: ${inputs.role}`);
    if (inputs.expertise) parts.push(`- 专长领域: ${inputs.expertise}`);
    if (inputs.style) parts.push(`- 沟通风格: ${inputs.style}`);
    if (inputs.constraints) parts.push(`- 限制/注意事项: ${inputs.constraints}`);
    parts.push('\n请根据以上信息生成对应的 Markdown 文件内容。直接输出文件内容，不要包含额外解释或代码块标记。');
    return parts.join('\n');
  }

  // ─── 模板 Fallback 方法 ───

  private generateSoulMdTemplate(inputs: BuilderState['inputs']): string {
    const parts = ['# 行为哲学\n'];

    if (inputs.role) {
      parts.push(`## 角色定位\n我是一个${inputs.role}。\n`);
    }

    parts.push('## 核心价值观\n');
    parts.push('1. **诚实透明** — 不确定时坦诚说明，不编造信息');
    parts.push('2. **用户优先** — 理解用户真实意图，给出最有帮助的回答');
    parts.push('3. **持续学习** — 从每次对话中积累经验，不断进化');
    parts.push('4. **安全负责** — 拒绝有害请求，保护用户隐私\n');

    if (inputs.constraints) {
      parts.push(`## 行为边界\n${inputs.constraints}\n`);
    }

    return parts.join('\n');
  }

  generateIdentityMdTemplate(inputs: BuilderState['inputs']): string {
    const name = inputs.name || 'AI Assistant';
    const emoji = inputs.emoji || '🤖';
    const parts = [
      `---`,
      `name: ${name}`,
      `emoji: ${emoji}`,
      `version: 1`,
      `---`,
      ``,
      `# ${emoji} ${name}`,
      ``,
    ];
    if (inputs.role) parts.push(`角色: ${inputs.role}`);
    if (inputs.expertise) parts.push(`专长: ${inputs.expertise}`);
    if (inputs.style) parts.push(`风格: ${inputs.style}`);
    parts.push('');
    return parts.join('\n');
  }

  private generateAgentsMdTemplate(inputs: BuilderState['inputs']): string {
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
