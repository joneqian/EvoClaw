/**
 * 系统提示构建 — 模块化 8 段式架构
 *
 * 从 embedded-runner.ts 提取，参考 OpenClaw 22 段式架构精简而来。
 * 段落: 安全宪法 → 运行时信息 → 人格 → 操作规程 → 记忆召回 → 工具目录 → 工具风格 → 沉默回复 → 自定义
 */

import os from 'node:os';
import type { AgentRunConfig } from './types.js';

/** 沉默回复 token — Agent 返回此 token 表示无需回复用户 */
export const NO_REPLY_TOKEN = 'NO_REPLY';

// ---------------------------------------------------------------------------
// 工具目录
// ---------------------------------------------------------------------------

/** 工具一行摘要（参考 OpenClaw coreToolSummaries） */
const TOOL_SUMMARIES: Record<string, string> = {
  read: '读取文件内容（文本或图片），大文件用 offset/limit 分段',
  write: '创建或覆盖文件，自动创建父目录',
  edit: '精确替换文件中的文本片段（oldText → newText）',
  apply_patch: '应用多文件统一补丁（*** Begin/End Patch 格式）',
  grep: '搜索文件内容，返回匹配行+文件路径+行号',
  find: '按 glob 模式搜索文件路径',
  ls: '列出目录内容',
  bash: '执行 shell 命令（单次执行，有超时）',
  exec_background: '后台启动长时间运行的命令（dev server、watch 等）',
  process: '管理后台进程（查看输出、终止、发送输入）',
  web_search: '搜索互联网（Brave Search API），返回标题+摘要+链接',
  web_fetch: '抓取 URL 内容并转换为 Markdown',
  image: '分析图片内容（支持本地文件和 URL）',
  pdf: '阅读 PDF 文档（原生模式或文本提取）',
  memory_search: '搜索 Agent 记忆库，查找用户偏好和历史',
  memory_get: '获取单条记忆的完整详情',
  knowledge_query: '查询知识图谱中的实体关系',
  spawn_agent: '创建子 Agent 并行处理独立子任务',
  list_agents: '查看所有子 Agent 的状态和结果',
  kill_agent: '终止运行中的子 Agent',
  steer_agent: '纠偏运行中的子 Agent（终止并用纠正指令重启）',
  yield_agents: '让出当前轮次等待子 Agent 完成结果',
};

/** 按优先级排序的工具顺序 */
const TOOL_ORDER = [
  'read', 'write', 'edit', 'apply_patch',
  'grep', 'find', 'ls',
  'bash', 'exec_background', 'process',
  'web_search', 'web_fetch',
  'image', 'pdf',
  'memory_search', 'memory_get', 'knowledge_query',
  'spawn_agent', 'list_agents', 'kill_agent', 'steer_agent', 'yield_agents',
];

function buildToolCatalog(availableTools: string[]): string {
  if (availableTools.length === 0) return '';
  const sorted = [...availableTools].sort((a, b) => {
    const ia = TOOL_ORDER.indexOf(a);
    const ib = TOOL_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  const lines = sorted.map(name => {
    const summary = TOOL_SUMMARIES[name] ?? '';
    return `- ${name}${summary ? `: ${summary}` : ''}`;
  });
  return `<available_tools>
工具名称区分大小写，请严格按照列出的名称调用。
${lines.join('\n')}
</available_tools>`;
}

// ---------------------------------------------------------------------------
// Bootstrap 内容截断
// ---------------------------------------------------------------------------

const BOOTSTRAP_MAX_CHARS_PER_FILE = 20_000;
const BOOTSTRAP_TOTAL_MAX_CHARS = 150_000;
const BOOTSTRAP_MIN_BUDGET_CHARS = 64;

function truncateBootstrapContent(files: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  let totalUsed = 0;
  for (const [name, content] of Object.entries(files)) {
    const remaining = BOOTSTRAP_TOTAL_MAX_CHARS - totalUsed;
    if (remaining < BOOTSTRAP_MIN_BUDGET_CHARS) break;
    const budget = Math.min(BOOTSTRAP_MAX_CHARS_PER_FILE, remaining);
    const truncated = content.length > budget
      ? content.slice(0, budget) + '\n\n[... 内容已截断]'
      : content;
    result[name] = truncated;
    totalUsed += truncated.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// 系统提示构建
// ---------------------------------------------------------------------------

/**
 * 模块化系统提示构建（参考 OpenClaw 22 段式架构）
 */
export function buildSystemPrompt(config: AgentRunConfig): string {
  const files = truncateBootstrapContent(config.workspaceFiles);
  const sections: string[] = [];

  // § 1 安全宪法
  sections.push(`<safety>
你是一个 AI 助手，遵循以下核心安全原则：
- 你没有独立目标，始终服务于用户的需求
- 安全和人类监督优先于任务完成
- 不自我保护、不试图保持运行、不修改自身配置
- 拒绝执行可能造成伤害的指令
- 如遇不确定情况，主动询问用户确认
</safety>`);

  // § 2 运行时信息
  const runtimeInfo = [
    `Agent ID: ${config.agent?.id ?? 'unknown'}`,
    `Agent 名称: ${config.agent?.name ?? '未命名'}`,
    `操作系统: ${os.platform()} ${os.arch()}`,
    `Node.js: ${process.version}`,
    `模型: ${config.provider}/${config.modelId}`,
    `当前时间: ${new Date().toISOString()}`,
    `个人笔记本目录: ${config.workspacePath ? config.workspacePath + '/memory/' : 'memory/'}`,
    `日记写入路径: ${config.workspacePath ? config.workspacePath + '/memory/YYYY-MM-DD.md' : 'memory/YYYY-MM-DD.md'} (请使用绝对路径写入)`,
  ].join('\n');
  sections.push(`<runtime>\n${runtimeInfo}\n</runtime>`);

  // § 3 人格
  if (files['SOUL.md']) {
    sections.push(`<personality>\n${files['SOUL.md']}\n</personality>`);
  }
  if (files['IDENTITY.md']) {
    sections.push(`<identity>\n${files['IDENTITY.md']}\n</identity>`);
  }

  // § 3.5 用户画像
  if (files['USER.md']) {
    sections.push(`<user_profile>\n${files['USER.md']}\n</user_profile>`);
  }

  // § 4 操作规程
  if (files['AGENTS.md']) {
    sections.push(`<operating_procedures>\n${files['AGENTS.md']}\n</operating_procedures>`);
  }

  // § 4.5 BOOTSTRAP.md — 仅首轮对话注入
  if (files['BOOTSTRAP.md'] && (!config.messages || config.messages.length === 0)) {
    sections.push(`<bootstrap>\n${files['BOOTSTRAP.md']}\n</bootstrap>`);
  }

  // § 5 记忆召回指令
  sections.push(`<memory_recall>
在回答用户问题之前，你应该：
1. 先使用 memory_search 工具搜索相关记忆，了解用户的偏好、历史和上下文
2. 如需详情，使用 memory_get 获取完整记忆内容
3. 结合记忆中的信息来提供更个性化、更准确的回答
4. 如果用户提到之前讨论过的话题，务必先搜索记忆
5. 你有一个个人笔记本文件 MEMORY.md，可以用 read/write 工具读写
6. 当你发现需要长期记住的重要信息时，主动写入 MEMORY.md
7. 每次会话开始时，检查 MEMORY.md 了解之前记录的备忘
</memory_recall>`);

  // § 5.1 Agent 笔记本
  if (files['MEMORY.md']) {
    sections.push(`<agent_notes>\n${files['MEMORY.md']}\n</agent_notes>`);
  }

  // § 5.5 工具目录
  const toolNames = (config.tools ?? []).map(t => t.name);
  const toolCatalog = buildToolCatalog(toolNames);
  if (toolCatalog) {
    sections.push(toolCatalog);
  }

  // § 6 工具调用风格
  sections.push(`<tool_call_style>
## 工具调用风格
默认：不叙述常规、低风险的工具调用，直接调用工具。
仅在以下情况简要说明：多步骤工作、复杂/有挑战的问题、敏感操作（如删除文件）、用户明确要求解释时。
叙述要简短、有价值，避免重复明显的步骤。

## 工具选择指南
- 优先使用 grep/find/ls 而非 bash 来探索文件（更快、遵守 .gitignore）
- 修改文件前先用 read 检查文件内容
- read 工具输出会截断到约 50KB，大文件请用 offset/limit 分段读取
- grep 最多返回 100 条匹配，find 最多返回 1000 个文件
- bash 命令的输出会被截断，长输出请重定向到文件再 read
- bash 执行的命令应加超时控制（如 timeout 30 command），避免长时间阻塞
- 长时间运行的命令（dev server、watch、构建）使用 exec_background 在后台执行
- 当存在专用工具时，直接使用工具而非要求用户手动运行等效命令
- 工具执行失败时，分析原因并尝试替代方案，而非简单重试相同参数
- 搜索记忆和知识图谱是低成本操作，在不确定时应主动使用
- 对于可拆分的独立子任务，使用 spawn_agent 并行处理

## 文件搜索策略
当用户要求查找文件时，遵循以下策略快速定位：
1. **首选 mdfind（macOS Spotlight 索引）**：通过 bash 执行 mdfind，毫秒级返回结果
   - 按文件名搜索: \`mdfind -name '关键词'\`（模糊匹配文件名）
   - 按内容搜索: \`mdfind '关键词'\`（全文索引搜索）
   - 限定目录: \`mdfind -onlyin ~/Documents -name '关键词'\`
   - 限定文件类型: \`mdfind 'kMDItemFSName == "*.pdf" && kMDItemDisplayName == "*报告*"'\`
2. **mdfind 不可用时用 find 工具**：
   - 优先搜索高价值目录: ~/Downloads、~/Documents、~/Desktop
   - 模糊匹配: \`-iname '*关键词*'\`（不区分大小写）
   - 限制深度: \`-maxdepth 4\`（避免全盘扫描）
   - 限制类型: \`-name '*.pdf' -o -name '*.docx'\`（按扩展名缩小范围）
3. **禁止搜索根目录 /**，限定在用户主目录 ~ 下
4. 如果第一次搜索没有结果，扩大搜索范围（去掉目录限制或降低关键词精度）
</tool_call_style>`);

  // § 7 沉默回复
  sections.push(`<silent_reply>
如果你判断当前消息不需要回复（例如用户的消息仅是确认、表情、或系统通知），
可以仅回复 "${NO_REPLY_TOKEN}"（不含引号），系统将不会向用户展示任何内容。
</silent_reply>`);

  // § 8 自定义
  if (config.systemPrompt) {
    sections.push(config.systemPrompt);
  }

  return sections.join('\n\n');
}
