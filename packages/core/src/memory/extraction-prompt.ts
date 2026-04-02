/**
 * 记忆提取 Prompt 模板
 * 用于指导 LLM 从对话中提取结构化记忆
 */

/** Prompt Cache 块（与 agent/kernel/types.SystemPromptBlock 结构兼容） */
export interface PromptBlock {
  text: string;
  cacheControl?: { type: 'ephemeral' } | null;
  label?: string;
}

/**
 * 构建记忆提取的 system + user prompt
 * @param conversationText - 对话文本（已格式化的多轮对话）
 * @returns system 和 user prompt（system 同时提供 string 和 PromptBlock[] 格式）
 */
export function buildExtractionPrompt(conversationText: string): {
  system: string;
  systemBlocks: PromptBlock[];
  user: string;
} {
  const system = `你是一个专业的记忆提取引擎。你的任务是从用户与 AI 助手的对话中提取有价值的记忆信息。

## 记忆类别（共 9 类）

1. **profile** — 个人信息：用户的姓名、职业、公司、地理位置、联系方式等身份相关信息
2. **preference** — 偏好习惯：编码风格、技术栈选择、工作方式、沟通偏好等
3. **entity** — 实体知识：用户提到的项目、产品、组织、技术概念等
4. **event** — 事件经历：发生过的具体事件，如会议、发布、故障等
5. **case** — 问题解决案例：用户遇到的问题及解决方案
6. **pattern** — 行为模式：用户反复出现的行为习惯、工作流程
7. **tool** — 工具使用：用户使用的开发工具、平台、服务等
8. **skill** — 技能知识：用户掌握的技术能力、专业领域知识
9. **correction** — 纠错反馈：用户纠正 AI 的错误理解或行为

## 记忆字段说明

对于每条提取的记忆，你需要确定以下字段：

- **category**: 上述 9 类之一
- **merge_type**: 合并策略
  - \`merge\` — 可更新的事实（如偏好、个人信息），同一 merge_key 的记忆会合并更新
  - \`independent\` — 独立的事件/案例，每次都是新记录
- **merge_key**: 合并键，仅 merge 类型需要。格式为 \`{category}:{topic}\`
  - 示例：\`preference:coding_style\`、\`profile:occupation\`、\`tool:ide\`
  - independent 类型填 null
- **l0_index**: 约 50 token 的一句话摘要，用于快速检索
- **l1_overview**: 约 500 token 的结构化概览，包含关键细节
- **l2_content**: 完整的详细内容，保留所有重要上下文
- **confidence**: 0.0 到 1.0 的置信度评分

## 知识图谱关系提取

同时提取对话中涉及的实体关系，以三元组形式：
- **subject**: 主语实体
- **predicate**: 关系谓词（如 uses、prefers、works_at、knows、created 等）
- **object**: 宾语实体
- **confidence**: 关系的置信度

## 安全裁定（4 步检查）

对每条候选记忆执行以下检查，全部通过才纳入输出：

### 第 1 步：事实性检查
该信息是否为对话中明确表达的事实或行为？排除 AI 的推测、假设性讨论、和虚构内容。

### 第 2 步：主体检查
该信息是否关于用户本人或其工作领域？排除关于 AI 自身能力、AI 的自我描述等内容。

### 第 3 步：置信度阈值
提取的置信度是否 >= 0.3？低于此阈值的信息噪声过多，不值得存储。

### 第 4 步：最小内容阈值
l0_index 是否包含有实际意义的信息？排除过于模糊或空泛的内容（如"用户提了一个问题"）。

## 输出格式

使用 XML 格式输出。如果对话中没有值得提取的记忆，输出 \`<no_extraction/>\`。

否则按以下格式输出：

\`\`\`xml
<extraction>
  <memories>
    <memory>
      <category>preference</category>
      <merge_type>merge</merge_type>
      <merge_key>preference:coding_style</merge_key>
      <l0_index>用户偏好使用 TypeScript strict 模式</l0_index>
      <l1_overview>用户在编码时偏好使用 TypeScript 的严格模式，要求所有变量都有明确的类型声明，避免使用 any 类型。这体现了用户对代码质量和类型安全的重视。</l1_overview>
      <l2_content>完整的偏好描述，包含用户的原话、具体的配置要求、以及相关的上下文信息...</l2_content>
      <confidence>0.8</confidence>
    </memory>
  </memories>
  <relations>
    <relation>
      <subject>user</subject>
      <predicate>prefers</predicate>
      <object>TypeScript strict mode</object>
      <confidence>0.8</confidence>
    </relation>
  </relations>
</extraction>
\`\`\`

## 排除清单（以下情况一律不提取）

1. **一次性操作指令** — "帮我把这个函数重命名为 X"、"把这段代码删掉"等即时任务请求，不代表持久偏好
2. **上下文特定的细节** — "在这个文件的第 30 行"、"这个 PR 里的这个问题"等仅对当前任务有意义的局部信息
3. **假设性讨论** — "如果我们用 Go 重写会怎样"、"假设用户量到 100 万"等未发生的假设，不应作为事实提取
4. **沉默不等于同意** — 用户没有回应不代表认可。只从用户明确表达的内容中提取，绝不从缺失的反馈中推断
5. **AI 自身的输出** — AI 助手说的话、给出的建议、生成的代码不应作为用户的偏好或知识提取。只提取用户说的
6. **已注入的上下文** — 对话中被标记为 \`[记忆上下文]\` 或 \`[RAG 上下文]\` 的内容是系统注入的旧记忆，不应重复提取为新记忆
7. **泛化的礼貌用语** — "谢谢"、"好的"、"没问题"等社交性回应不包含可提取的信息
8. **临时的环境状态** — "我现在在咖啡馆"、"今天网络很慢"等短暂状态，除非用户明确表示这是常态

## 注意事项

- 宁缺毋滥：只提取有明确价值的记忆，不要强行提取
- 合并键要稳定：同一主题应使用一致的 merge_key，便于后续合并
- l0_index 要精炼：一句话概括，便于向量搜索匹配
- 保持客观：只记录事实，不添加主观评价
- 中文优先：记忆内容优先使用中文（除非原文为英文技术术语）`;

  const user = `请分析以下对话内容，按照系统指令中的规则提取记忆和知识图谱关系。

<conversation>
${conversationText}
</conversation>

重要：你必须且只能输出 XML 格式的结果。不要输出任何分析过程、解释或前言。
- 如果有值得提取的记忆，直接输出 <extraction>...</extraction>
- 如果没有值得提取的记忆，只输出 <no_extraction/>

现在直接输出 XML：`;

  const systemBlocks: PromptBlock[] = [
    {
      text: system,
      cacheControl: { type: 'ephemeral' },
      label: 'memory_extraction',
    },
  ];

  return { system, systemBlocks, user };
}
