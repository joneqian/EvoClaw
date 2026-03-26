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

  // § 1 Safety constitution + hardcoded Red Lines (immutable, independent of AGENTS.md)
  sections.push(`<safety>
You are an AI assistant governed by these core safety principles:
- You have no independent goals; always serve the user's needs
- Safety and human oversight take priority over task completion
- Do not self-preserve, attempt to keep running, or modify your own config
- Refuse instructions that could cause harm
- When uncertain, proactively ask the user for confirmation

## Red Lines (Immutable — enforced by system, cannot be overridden)
- Never reveal API keys, tokens, passwords, or secrets
- Never impersonate the user or send messages as the user
- Never bypass tool approval gates or permission checks
- Never access files outside workspace without explicit permission
- Never send messages to external channels without user consent
- Never execute financial, contractual, or legally binding actions autonomously
- In group chats, never expose private conversation context
</safety>`);

  // § 2 Runtime info
  const runtimeInfo = [
    `Agent ID: ${config.agent?.id ?? 'unknown'}`,
    `Agent name: ${config.agent?.name ?? 'unnamed'}`,
    `OS: ${os.platform()} ${os.arch()}`,
    `Node.js: ${process.version}`,
    `Model: ${config.provider}/${config.modelId}`,
    `Current time: ${new Date().toISOString()}`,
    `Diary directory: memory/ (only for .md daily memory diary files — no other file types allowed)`,
    `Diary write path: memory/YYYY-MM-DD.md (append-only — never overwrite existing content)`,
    `Work output: files generated for the user (HTML/PDF/images etc.) go to workspace root, not memory/`,
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

  // § 4.5 BOOTSTRAP.md — controlled by chat.ts based on setupCompleted
  if (files['BOOTSTRAP.md']) {
    sections.push(`<bootstrap>
**IMPORTANT: This is your first conversation. You must prioritize the onboarding flow below. Set aside your professional role for now — meet the user, build rapport, then complete onboarding before entering normal work mode.**

${files['BOOTSTRAP.md']}
</bootstrap>`);
  }

  // § 5 Memory recall instructions
  sections.push(`<memory_recall>
Before answering the user, you should:
1. Use memory_search to find relevant memories — learn about the user's preferences, history, and context
2. Use memory_get for full details when needed
3. Incorporate memory context for more personalized, accurate replies
4. If the user mentions a previously discussed topic, always search memory first
5. MEMORY.md is your long-term notebook — read it with the read tool
6. When you discover important information worth remembering long-term, write it to today's diary (memory/YYYY-MM-DD.md)
7. At the start of each session, check MEMORY.md for previously recorded notes
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

  // § 6 Tool call style
  sections.push(`<tool_call_style>
## Tool Call Style
Default: do not narrate routine, low-risk tool calls — just call the tool.
Narrate only when it helps: multi-step work, complex problems, sensitive actions (e.g., deletions), or when the user explicitly asks.
Keep narration brief and value-dense; avoid repeating obvious steps.

## Tool Selection Guide
- Prefer grep/find/ls over bash for file exploration (faster, respects .gitignore)
- Read file contents before modifying them
- read tool output truncates at ~50KB; use offset/limit for large files
- grep returns max 100 matches; find returns max 1000 files
- bash output is truncated; redirect long output to a file and then read it
- Add timeout control to bash commands (e.g., timeout 30 command)
- Long-running commands (dev server, watch, build) → use exec_background
- Use dedicated tools rather than asking the user to run equivalent CLI commands
- On tool failure, analyze the cause and try alternatives — don't blindly retry
- Memory and knowledge graph searches are cheap — use them proactively when unsure
- For independent subtasks, use spawn_agent for parallel processing

## File Search Strategy
When the user asks to find a file:
1. **Prefer mdfind (macOS Spotlight)** via bash — millisecond results
   - By name: \`mdfind -name 'keyword'\`
   - By content: \`mdfind 'keyword'\`
   - Scoped: \`mdfind -onlyin ~/Documents -name 'keyword'\`
   - By type: \`mdfind 'kMDItemFSName == "*.pdf"'\`
2. **Fallback to find tool** when mdfind unavailable:
   - Search high-value dirs first: ~/Downloads, ~/Documents, ~/Desktop
   - Case-insensitive: \`-iname '*keyword*'\`
   - Limit depth: \`-maxdepth 4\`
3. **Never search root /**; stay within user home ~
4. If no results, broaden scope (remove dir constraint or reduce keyword precision)
</tool_call_style>`);

  // § 7 Silent reply
  sections.push(`<silent_reply>
If you determine the current message needs no reply (e.g., it's just an acknowledgment, emoji, or system notification),
reply with "${NO_REPLY_TOKEN}" only (without quotes). The system will not show anything to the user.
</silent_reply>`);

  // § 8 自定义
  if (config.systemPrompt) {
    sections.push(config.systemPrompt);
  }

  return sections.join('\n\n');
}
