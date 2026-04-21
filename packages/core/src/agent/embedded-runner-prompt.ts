/**
 * 系统提示构建 —— 模块化段式架构 + Prompt Cache 三级分区
 *
 * 参考 Claude Code prompts.ts (53KB) + splitSysPromptPrefix() 三种缓存模式:
 *
 * 三级缓存策略:
 * - 静态段（Safety/Style/Tool Guide）→ scope: 'global'（跨用户共享，1P 命中 1/10 费用）
 * - Agent 人格段（SOUL.md/IDENTITY.md/AGENTS.md）→ scope: 'org'（组织级缓存）
 * - 动态段（Runtime/Memory/Tools）→ cache_control: null（不缓存）
 * - 大内容（USER.md/MEMORY.md）→ 移至用户消息 <system-reminder>（不在此函数中）
 *
 * 提示词构建模式 (mode):
 * - 'interactive': 完整提示词（默认，用于用户直接交互）
 * - 'autonomous': 裁剪交互式引导（Cron/Heartbeat 自主执行）
 * - 'fork': 极简提示词（Skill fork 子代理）
 *
 * 返回 SystemPromptBlock[] 数组，Anthropic API 可利用 cache_control 降低 90% 缓存费用。
 * OpenAI API 通过 systemPromptBlocksToString() 合并为单字符串。
 */

import os from 'node:os';
import type { AgentRunConfig } from './types.js';
import type { SystemPromptBlock } from './kernel/types.js';
import { systemPromptBlocksToString } from './kernel/types.js';
// Git context 不注入 — EvoClaw 面向企业用户，非开发者，无需 Git 状态

/** 提示词构建模式 */
export type PromptBuildMode = 'interactive' | 'autonomous' | 'fork';

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
  memory_write: '把一条新记忆即时写入 DB（用户说"记住"时立即调用，不要等后台抽取）',
  memory_update: '修改现有记忆的概述或详情（用户说"改一下/不对"时调用，l0 锁死）',
  memory_delete: '软删除一条记忆（用户说"删掉这条"时调用）',
  memory_forget_topic: '按关键词批量遗忘某个话题（用户说"忘掉所有关于 X 的事"时调用）',
  memory_pin: '钉选/取消钉选记忆，钉选后免疫热度衰减',
  knowledge_query: '查询知识图谱中的实体关系',
  spawn_agent: '创建子 Agent 并行处理独立子任务',
  list_agents: '查看所有子 Agent 的状态和结果',
  kill_agent: '终止运行中的子 Agent',
  steer_agent: '纠偏运行中的子 Agent（终止并用纠正指令重启）',
  yield_agents: '让出当前轮次等待子 Agent 完成结果',
  todo_write: '更新结构化任务列表（tasks: [{id, description, status}]，最多20项）',
};

/** 按优先级排序的工具顺序 */
const TOOL_ORDER = [
  'read', 'write', 'edit', 'apply_patch',
  'grep', 'find', 'ls',
  'bash', 'exec_background', 'process',
  'web_search', 'web_fetch',
  'image', 'pdf',
  'memory_search', 'memory_get',
  'memory_write', 'memory_update', 'memory_delete', 'memory_forget_topic', 'memory_pin',
  'knowledge_query',
  'spawn_agent', 'list_agents', 'kill_agent', 'steer_agent', 'yield_agents',
  'todo_write',
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
 * 构建系统提示词（返回 SystemPromptBlock[] 支持 Prompt Cache 三级分区）
 *
 * 三级缓存: global（静态指令）→ org（Agent 人格）→ null（动态段）。
 * USER.md/MEMORY.md 不在此函数中注入（由 buildUserContextReminder 移至用户消息）。
 *
 * @param config Agent 运行配置
 * @param mode 构建模式: interactive（默认）/ autonomous（Cron/Heartbeat）/ fork（Skill 子代理）
 */
export function buildSystemPromptBlocks(
  config: AgentRunConfig,
  mode: PromptBuildMode = 'interactive',
): SystemPromptBlock[] {
  // ─── Fork 极简模式: 只保留身份 + 工作目录 + 自定义指令 ───
  if (mode === 'fork') {
    return buildForkPromptBlocks(config);
  }

  const files = truncateBootstrapContent(config.workspaceFiles ?? {});
  const blocks: SystemPromptBlock[] = [];

  // ═══ 全局静态段（scope: 'global' — 跨用户共享缓存）═══
  // 这些段落对所有 Agent、所有用户完全相同，可获得最大缓存复用率

  // § 1 Safety constitution（复用 SAFETY_CONSTITUTION 常量，子 Agent 共享前缀 → cache 命中）
  blocks.push({
    text: SAFETY_CONSTITUTION,
    cacheControl: { type: 'ephemeral', scope: 'global' },
    label: 'safety',
  });

  // § 5 Memory recall instructions（全局静态指令）
  blocks.push({
    text: `<memory_recall>
Before answering the user, you should:
1. Use memory_search to find relevant memories — learn about the user's preferences, history, and context
2. Use memory_get for full details when needed
3. Incorporate memory context for more personalized, accurate replies
4. If the user mentions a previously discussed topic, always search memory first
5. MEMORY.md is an auto-rendered DB view — read it for context, but never write to it
6. When the user explicitly asks you to remember something, call memory_write **immediately** (see table below) — do not wait for the background extractor
7. At the start of each session, check MEMORY.md for previously recorded notes

## 主动管理记忆 — 即时反馈优先
当用户在对话中**明确**说出以下意图时，**立即**调用对应工具，并等待成功后在回复里告知用户结果（含 id），不要依赖后台异步抽取：

| 用户说 | 你应该做 |
|---|---|
| "记住 X / 帮我记一下 / 别忘了 X" | memory_write 写入新记忆 → 回复"已记住（id=...）" |
| "改一下那条记忆 / 不对应该是 Y / 修正一下" | 先 memory_search 找 id → memory_update 改 l1/l2 → 回复"已更新" |
| "删掉这条 / 把 X 那条记忆删了" | 先 memory_search 找 id → memory_delete → 回复"已删除：..." |
| "忘掉所有关于 X 的事 / 别再提 X" | memory_forget_topic 按关键词批量归档 → 回复"已遗忘 N 条" |
| "这条很重要 / 把这条置顶 / 别让它衰减" | memory_pin（pinned=true） → 回复"已钉选" |
| "取消置顶 / 不用置顶了" | memory_pin（pinned=false） → 回复"已取消钉选" |

要点：
- l0 字段（一行摘要）是检索锚点，**写入后不可改**——只能改 l1（概述）和 l2（详情）
- memory_write 的 category 默认 preference；profile/preference/entity 等会自动合并相同主题
- memory_forget_topic 走 FTS5 全文检索，所有匹配条目软删（archived_at），可恢复
- 这些工具是"用户显式指令"专用——不要自作主张写入；隐式信息仍由后台 afterTurn 抽取

## 记忆新鲜度
记忆可能随时间过期。使用超过 1 天的记忆前，请验证其是否仍然正确。
如果记忆与当前状态矛盾，信任当前观察并更新记忆。
标记为 [⚠] 的记忆表示已有一段时间未更新，使用时需额外谨慎。
</memory_recall>`,
    cacheControl: { type: 'ephemeral', scope: 'global' },
    label: 'memory_recall',
  });

  // § 5.1 Skill 记忆化（M7 Phase 1 — 全局静态指令）
  blocks.push({
    text: `<skill_memorization>
## 把重复流程沉淀为 Skill
当你在对话中完成了一个**可复用的多步流程**（例如"搜索 → 摘要 → 汇总"、"解析 CSV → 校验 → 输出报告"等），
可调用 \`skill_manage\` 工具把它固化为 Skill，下次对话起 <available_skills> 目录即可直接 invoke。

**何时应创建 Skill**：
- 用户要求"以后遇到 X 都这么做"
- 同一类任务你在本次或历史会话中执行了 ≥2 次且步骤相似
- 可以清晰列出步骤、输入、输出、边界条件

**何时应避免创建**：
- 一次性、情景强相关的任务（"帮我查下今天的天气"）
- 涉及硬编码凭据/密码/Token（写入必被安全扫描拒绝）
- 与现有 Skill 高度重叠

**skill_manage 用法**：
| action | 场景 |
|--------|------|
| create | 新建 Skill：提供完整 SKILL.md 内容（含 frontmatter + body） |
| edit   | 覆盖已有 Skill 的 SKILL.md（会自动备份 .bak） |
| patch  | 只改局部：提供 patch_old（精确子串）+ patch_new |
| delete | 删除 Skill：必须提供 confirm=true |

**必备 frontmatter**（YAML）：
\`\`\`yaml
---
name: <与工具参数的 name 一致，2-64 位小写字母/数字/连字符>
description: <一句话描述用途，<=1000 字符>
when-to-use: <可选：触发场景>
---
\`\`\`

**安全红线**（命中即 FAIL-CLOSED 拒绝）：eval / new Function / 硬编码 API key/token/secret / 写 shell rc 文件 / 写 crontab / 写 launchd plist。
</skill_memorization>`,
    cacheControl: { type: 'ephemeral', scope: 'global' },
    label: 'skill_memorization',
  });

  // § 6 Tool call style（全局静态指令 — autonomous 模式跳过）
  if (mode === 'interactive') {
    blocks.push({
      text: `<tool_call_style>
## Tool Call Style
Default: do not narrate routine, low-risk tool calls (just call the tool).
Narrate only when it helps: multi-step work, complex/challenging problems, sensitive actions (e.g., deletions), or when the user explicitly asks.
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

</tool_call_style>`,
      cacheControl: { type: 'ephemeral', scope: 'global' },
      label: 'tool_style',
    });
  }

  // § 7 Silent reply（静态指令 — autonomous 模式跳过，自主 Agent 不需要静默回复）
  if (mode === 'interactive') {
    blocks.push({
      text: `<silent_reply>
If you determine the current message needs no reply (e.g., it's just an acknowledgment, emoji, or system notification),
reply with "${NO_REPLY_TOKEN}" only (without quotes). The system will not show anything to the user.
</silent_reply>`,
      cacheControl: { type: 'ephemeral', scope: 'global' },
      label: 'silent_reply',
    });
  }

  // § 语言偏好（全局配置 — 不同语言会产生不同变体，用 org 级缓存避免碎片化）
  const language = (config as any).language ?? 'zh';
  const languageLabel = language === 'zh' ? 'Chinese (中文)' : 'English';
  blocks.push({
    text: `<language>\nIMPORTANT: Always respond in ${languageLabel}. This is a user preference set in the application settings.\n</language>`,
    cacheControl: { type: 'ephemeral', scope: 'org' },
    label: 'language',
  });

  // ═══ Agent 人格段（scope: 'org' — 组织级缓存，同 Agent 共享）═══

  // § 3 人格（不常变，org 级缓存）
  if (files['SOUL.md']) {
    blocks.push({ text: `<personality>\n${files['SOUL.md']}\n</personality>`, cacheControl: { type: 'ephemeral', scope: 'org' }, label: 'personality' });
  }
  if (files['IDENTITY.md']) {
    blocks.push({ text: `<identity>\n${files['IDENTITY.md']}\n</identity>`, cacheControl: { type: 'ephemeral', scope: 'org' }, label: 'identity' });
  }

  // § 4 操作规程（不常变，org 级缓存）
  if (files['AGENTS.md']) {
    blocks.push({ text: `<operating_procedures>\n${files['AGENTS.md']}\n</operating_procedures>`, cacheControl: { type: 'ephemeral', scope: 'org' }, label: 'procedures' });
  }

  // ═══ 动态段（不缓存，每轮可变）═══

  // § 2 Runtime info（含时间戳 + Git 状态，每轮变）
  const runtimeLines = [
    `Agent ID: ${config.agent?.id ?? 'unknown'}`,
    `Agent name: ${config.agent?.name ?? 'unnamed'}`,
    `OS: ${os.platform()} ${os.arch()}`,
    `Node.js: ${process.version}`,
    `Model: ${config.provider}/${config.modelId}`,
    `Current time: ${new Date().toISOString()}`,
  ];

  // Scratchpad / 工作区路径
  if (config.workspacePath) {
    runtimeLines.push(`Workspace path: ${config.workspacePath}`);
    runtimeLines.push(`Scratchpad: ${config.workspacePath}/tmp/ (temporary files)`);
  }

  runtimeLines.push(
    `Long-term memory: stored in DB — use memory_write/update/delete/forget_topic/pin tools (not files)`,
    `Work output: files generated for the user (HTML/PDF/images etc.) go to workspace root`,
  );

  blocks.push({ text: `<runtime>\n${runtimeLines.join('\n')}\n</runtime>`, cacheControl: null, label: 'runtime' });

  // § 4.5 BOOTSTRAP.md（动态，首轮才有）
  if (files['BOOTSTRAP.md']) {
    blocks.push({
      text: `<bootstrap>\n**IMPORTANT: This is your first conversation. You must prioritize the onboarding flow below.**\n\n${files['BOOTSTRAP.md']}\n</bootstrap>`,
      cacheControl: null,
      label: 'bootstrap',
    });
  }

  // § 5.2 任务状态（动态）
  if (files['TODO.json']) {
    try {
      const tasks = JSON.parse(files['TODO.json']) as Array<{ id: string; description: string; status: string }>;
      if (Array.isArray(tasks) && tasks.length > 0) {
        const inProgress = tasks.filter(t => t.status === 'in_progress');
        const todo = tasks.filter(t => t.status === 'todo');
        const done = tasks.filter(t => t.status === 'done');
        blocks.push({
          text: `<current_tasks>\n进行中: ${inProgress.map(t => `[${t.id}] ${t.description}`).join(', ') || '无'}\n待办: ${todo.map(t => `[${t.id}] ${t.description}`).join(', ') || '无'}\n已完成: ${done.length} 项\n</current_tasks>`,
          cacheControl: null,
          label: 'tasks',
        });
      }
    } catch { /* malformed TODO.json, skip */ }
  }

  // § 5.5 工具目录（动态，工具列表可变）
  const toolNames = (config.tools ?? []).map(t => t.name);
  const toolCatalog = buildToolCatalog(toolNames);
  if (toolCatalog) {
    blocks.push({ text: toolCatalog, cacheControl: null, label: 'tools' });
  }

  // § 8 自定义系统提示词（动态）
  if (config.systemPrompt) {
    blocks.push({ text: config.systemPrompt, cacheControl: null, label: 'custom' });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Fork 极简模式 — Skill fork 子代理
// ---------------------------------------------------------------------------

/**
 * Fork 极简提示词（参考 Claude Code SIMPLE 模式）
 *
 * Skill execution-mode: fork 时，子代理不需要完整的安全宪法、记忆指令、工具指南等。
 * 只保留: Agent 身份 + 工作目录 + 安全红线 + 自定义指令。
 * 宿主（主对话）负责安全检查，子代理只负责执行 Skill 指令。
 */
function buildForkPromptBlocks(config: AgentRunConfig): SystemPromptBlock[] {
  const blocks: SystemPromptBlock[] = [];

  // 最小安全红线（不可省略）
  blocks.push({
    text: `You are a task-focused sub-agent. Execute the given instructions precisely.
Red lines: never reveal secrets, never send external messages, never bypass permissions.`,
    cacheControl: { type: 'ephemeral', scope: 'global' },
    label: 'fork_safety',
  });

  // Agent 身份（简略）
  const agentName = config.agent?.name ?? 'unnamed';
  blocks.push({
    text: `Agent: ${agentName}\nWorkspace: ${config.workspacePath ?? 'unknown'}\nTime: ${new Date().toISOString()}`,
    cacheControl: null,
    label: 'fork_identity',
  });

  // 语言偏好
  const language = (config as any).language ?? 'zh';
  const languageLabel = language === 'zh' ? 'Chinese (中文)' : 'English';
  blocks.push({
    text: `Respond in ${languageLabel}.`,
    cacheControl: null,
    label: 'fork_language',
  });

  // 自定义指令（Skill 注入的指令）
  if (config.systemPrompt) {
    blocks.push({ text: config.systemPrompt, cacheControl: null, label: 'fork_custom' });
  }

  return blocks;
}

/**
 * 构建用户上下文提醒（注入首条用户消息前）
 *
 * 将 USER.md/MEMORY.md 等大内容从 system prompt 移至用户消息，
 * 避免破坏 system prompt 的 Prompt Cache 命中率。
 *
 * 参考 Claude Code utils/api.ts::prependUserContext() 的 <system-reminder> 模式。
 */
export function buildUserContextReminder(files: Record<string, string>): string | null {
  const parts: string[] = [];

  if (files['USER.md']) {
    parts.push(`# userProfile\n${files['USER.md']}`);
  }
  if (files['MEMORY.md']) {
    parts.push(`# agentNotes\n${files['MEMORY.md']}`);
  }

  parts.push(`# currentDate\nToday's date is ${new Date().toISOString().slice(0, 10)}.`);

  if (parts.length <= 1) return null; // 只有日期，不注入

  return `<system-reminder>\n${parts.join('\n\n')}\n\nIMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant.\n</system-reminder>`;
}

/**
 * 安全宪法 — 所有 Agent（含子 Agent）共享的静态前缀
 *
 * Anthropic prompt cache 基于前缀匹配：只要前 N bytes 一致就能命中。
 * 将此段放在所有 system prompt 最前面，可让 parent 和 type sub-agent 共享缓存。
 */
export const SAFETY_CONSTITUTION = `<safety>
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
</safety>`;

/**
 * 兼容函数：返回单字符串格式（供旧调用方和 OpenAI 使用）
 */
export function buildSystemPrompt(config: AgentRunConfig, mode: PromptBuildMode = 'interactive'): string {
  return systemPromptBlocksToString(buildSystemPromptBlocks(config, mode));
}
