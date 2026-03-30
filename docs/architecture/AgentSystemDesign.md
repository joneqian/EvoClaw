# EvoClaw Agent 系统设计文档

> **文档版本**: v1.0
> **创建日期**: 2026-03-13
> **文档状态**: 设计确认
> **研究基础**: OpenClaw Agent 架构 / PI 框架（pi-ai, pi-agent-core, pi-coding-agent）

---

## 目录

1. [设计理念与战略决策](#1-设计理念与战略决策)
2. [PI 框架集成方案](#2-pi-框架集成方案)
3. [Agent 文件体系](#3-agent-文件体系)
4. [Agent 运行时架构](#4-agent-运行时架构)
5. [工具系统：5 阶段注入流水线](#5-工具系统5-阶段注入流水线)
6. [Skill 生态：ClawHub + skills.sh](#6-skill-生态clawhub--skillssh)
7. [多 Agent 系统](#7-多-agent-系统)
8. [Channel 路由与 Binding](#8-channel-路由与-binding)
9. [主动行为：Heartbeat + Cron](#9-主动行为heartbeat--cron)
10. [沙箱安全：Docker 可选方案](#10-沙箱安全docker-可选方案)
11. [与记忆系统的集成](#11-与记忆系统的集成)
12. [完整模块总览](#12-完整模块总览)

---

## 1. 设计理念与战略决策

### 1.1 核心决策：基于 PI 框架而非从零自研

EvoClaw 的 Agent 运行时基于 **PI 框架**（MIT 许可证，npm 已发布），而非从零自研。PI 是 OpenClaw 的底层引擎，已被 302k+ Star 项目验证，支持在非终端环境中以库的方式运行。

**决策理由**：

| 维度 | 从零自研 | 基于 PI |
|------|---------|---------|
| Agent ReAct 循环 | 2-3 周开发 | `pi-agent-core` 直接可用 |
| 文件工具（read/write/edit/bash） | 1-2 周开发 | `pi-coding-agent` 内置 |
| JSONL 会话持久化 | 1 周开发 | `pi-coding-agent` 内置 |
| 上下文自动压缩 | 1-2 周开发 | `pi-coding-agent` 内置 |
| Skills 加载 + 门控 | 1-2 周开发 | `pi-coding-agent` 内置 |
| 流式输出 + 事件系统 | 1 周开发 | `pi-agent-core` 内置 |
| Skill 生态 | 需自建（数年） | ClawHub 13,700+ Skills 直接兼容 |
| 社区模板 | 需自建 | 103+ 生产级 SOUL.md 模板直接可用 |

**使用的 PI 包**：

| 包 | npm 名称 | 版本 | 用途 |
|---|---------|------|------|
| pi-ai | `@mariozechner/pi-ai` | 0.57.1+ | 多 Provider LLM 抽象 |
| pi-agent-core | `@mariozechner/pi-agent-core` | 0.57.1+ | Agent ReAct 循环 + 流式事件 |
| pi-coding-agent | `@mariozechner/pi-coding-agent` | 0.57.1+ | 文件工具 + 会话持久化 + Skills |

**不使用的 PI 包**：

| 包 | 不用原因 |
|---|---------|
| `pi-tui` | EvoClaw 是 Tauri 桌面应用，用 React UI 通过 PI 事件流对接 |
| `pi` (CLI) | EvoClaw 不是命令行工具 |

### 1.2 技术栈变更

| 维度 | 之前的方案 | 调整后 |
|------|----------|-------|
| LLM 抽象 | Vercel AI SDK (`ai` + `@ai-sdk/openai`) | **pi-ai**（+ `registerProvider()` 补国内 Provider） |
| Agent 循环 | 自研 ContextEngine | **pi-agent-core**（ReAct 循环 + 流式事件） |
| 工具系统 | 自研中间件注入 | **pi-coding-agent**（5 阶段工具注入） |
| 会话持久化 | 自研 SQLite | **pi-coding-agent**（JSONL）+ EvoClaw SQLite 记忆层 |
| 上下文压缩 | 自研 LCM 中间件 | **pi-coding-agent** auto-compaction + EvoClaw L0/L1/L2 记忆检索 |
| Skill 生态 | 自建 | **ClawHub + skills.sh**（PI AgentSkills 规范兼容） |
| Agent 文件 | 3 文件（SOUL/USER/HEARTBEAT） | **兼容 OpenClaw 8 文件格式** |

### 1.3 EvoClaw 自研的部分（PI 不覆盖的）

| 模块 | 说明 |
|------|------|
| **记忆系统** | L0/L1/L2 三层分级存储 + 渐进检索 + knowledge_graph（详见 MemorySystemDesign.md） |
| **安全层** | Tauri Rust 层：Keychain 凭证管理、AES-256-GCM 加密、权限模型 |
| **Channel 适配** | 飞书 / 企微 / QQ 适配器（国内 IM 平台） |
| **桌面壳** | Tauri 2.0 + React 19 前端 |
| **记忆 ↔ PI 桥接** | ContextPlugin 适配到 PI 的扩展钩子 |
| **国内 Provider 注册** | Qwen / GLM / 豆包的 `registerProvider()` 配置 |

---

## 2. PI 框架集成方案

### 2.1 PI 4 层架构在 EvoClaw 中的映射

```
┌─────────────────────────────────────────────────────────────┐
│                   Tauri 主进程 (Rust)                         │
│  ┌────────────────────────┐  ┌───────────────────────────┐  │
│  │ Rust 安全层              │  │ UI WebView               │  │
│  │ · 加密/解密              │  │ React 19 + Tailwind 4    │  │
│  │ · Keychain 集成         │  │                           │  │
│  │ · 沙箱策略              │  │  接收 PI 事件流渲染 UI    │  │
│  └────────────┬───────────┘  └──────────┬────────────────┘  │
│               │ Tauri IPC                │                   │
├───────────────┼──────────────────────────┼───────────────────┤
│               │        HTTP/IPC          │                   │
│  ┌────────────▼──────────────────────────▼────────────────┐  │
│  │              Node.js Sidecar                            │  │
│  │                                                         │  │
│  │  ┌──── PI 框架（L1-L3，不含 L4 TUI）───────────────┐   │  │
│  │  │                                                   │   │  │
│  │  │  pi-ai (L1)          多 Provider LLM 抽象        │   │  │
│  │  │  · OpenAI / Anthropic / Google / DeepSeek / ...   │   │  │
│  │  │  · registerProvider() 注册国内 Provider           │   │  │
│  │  │                                                   │   │  │
│  │  │  pi-agent-core (L2)  Agent ReAct 循环             │   │  │
│  │  │  · streamSimple / streamFn                        │   │  │
│  │  │  · 工具执行 + 结果回喂                             │   │  │
│  │  │  · 事件系统（agent_start/tool_execution/etc）      │   │  │
│  │  │                                                   │   │  │
│  │  │  pi-coding-agent (L3)  生产运行时                  │   │  │
│  │  │  · createAgentSession / SessionManager             │   │  │
│  │  │  · 内置文件工具（read/write/edit/bash）            │   │  │
│  │  │  · JSONL 会话持久化                                │   │  │
│  │  │  · auto-compaction 上下文压缩                      │   │  │
│  │  │  · AgentSkills 加载 + 门控                         │   │  │
│  │  └───────────────────────────────────────────────────┘   │  │
│  │                                                         │  │
│  │  ┌──── EvoClaw 自研层 ──────────────────────────────┐   │  │
│  │  │ · MemoryBridge     PI 扩展钩子 ↔ 记忆系统         │   │  │
│  │  │ · ChannelManager   飞书/企微/QQ 适配              │   │  │
│  │  │ · SecurityBridge   Node ↔ Rust 安全层桥接         │   │  │
│  │  │ · BindingRouter    消息路由 + Agent 绑定          │   │  │
│  │  └───────────────────────────────────────────────────┘   │  │
│  │                                                         │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌──── 基础设施 ─────────────────────────────────────────┐   │
│  │ SQLite (记忆)  │ JSONL (会话)  │ Docker (沙箱，可选)   │   │
│  └────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

### 2.2 国内 LLM Provider 注册

pi-ai 原生支持的国内 Provider：

| Provider | 支持方式 |
|----------|---------|
| DeepSeek | 自动检测 `deepseek.com` URL，OpenAI 兼容模式 |
| MiniMax | 原生 Provider |
| Kimi/Moonshot | Anthropic 兼容模式 |

需要通过 `registerProvider()` 注册的：

```typescript
import { registerProvider } from '@mariozechner/pi-ai'

// 通义千问（阿里云）
registerProvider({
  id: 'qwen',
  name: '通义千问',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: () => getApiKeyFromKeychain('qwen'),
  models: [
    { id: 'qwen-max', name: 'Qwen Max', contextWindow: 32768 },
    { id: 'qwen-plus', name: 'Qwen Plus', contextWindow: 131072 },
    { id: 'qwen-turbo', name: 'Qwen Turbo', contextWindow: 131072 },
  ],
  compat: {
    supportsDeveloperRole: false,
    supportsStrictMode: false,
  }
})

// 智谱 GLM
registerProvider({
  id: 'glm',
  name: '智谱 GLM',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: () => getApiKeyFromKeychain('glm'),
  models: [
    { id: 'glm-4-plus', name: 'GLM-4 Plus', contextWindow: 128000 },
    { id: 'glm-4-flash', name: 'GLM-4 Flash', contextWindow: 128000 },
  ],
  compat: {
    supportsDeveloperRole: false,
  }
})

// 字节豆包
registerProvider({
  id: 'doubao',
  name: '豆包',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  apiKey: () => getApiKeyFromKeychain('doubao'),
  models: [
    { id: 'doubao-pro-32k', name: '豆包 Pro 32K', contextWindow: 32768 },
    { id: 'doubao-lite-32k', name: '豆包 Lite 32K', contextWindow: 32768 },
  ],
  compat: {
    supportsDeveloperRole: false,
    supportsUsageInStreaming: false,
  }
})
```

### 2.3 PI 嵌入式运行模式

EvoClaw 使用 PI 的 **SDK 嵌入模式**（非 CLI、非 RPC），与 OpenClaw 的集成方式一致：

```typescript
import { createAgentSession, SessionManager, ModelRegistry } from '@mariozechner/pi-coding-agent'

// 在 Hono HTTP 服务中创建 Agent 会话
async function handleChatMessage(agentId: string, userMessage: string) {
  const session = await createAgentSession({
    workspace: `~/.evoclaw/agents/${agentId}/workspace`,
    sessionStore: `~/.evoclaw/agents/${agentId}/sessions`,
    model: await resolveModel(agentId),
    // 自定义工具注入（第 2-4 阶段）
    customTools: [
      ...evoClawTools,        // EvoClaw 增强工具
      ...channelTools,        // Channel 操作工具
      ...mcpTools,            // MCP 服务工具
    ],
    // 扩展钩子（桥接记忆系统）
    extensions: [evoClawMemoryExtension],
  })

  // 订阅事件流 → 转发到 React UI
  session.subscribe((event) => {
    switch (event.type) {
      case 'message_update':
        sendToUI(agentId, { type: 'text_delta', delta: event.delta })
        break
      case 'tool_execution_start':
        sendToUI(agentId, { type: 'tool_start', tool: event.toolName })
        break
      case 'tool_execution_end':
        sendToUI(agentId, { type: 'tool_end', tool: event.toolName, result: event.result })
        break
    }
  })

  // 执行 prompt
  await session.prompt(userMessage)
}
```

### 2.4 PI 事件流类型

PI 的事件系统提供完整的 Agent 生命周期可观测性：

| 事件 | 触发时机 | EvoClaw UI 用途 |
|------|---------|----------------|
| `agent_start` | Agent 开始运行 | 显示思考中状态 |
| `agent_end` | Agent 运行结束 | 清除状态，触发记忆提取 |
| `message_start` | LLM 开始生成 | — |
| `message_update` | LLM 流式输出文本 | 实时渲染对话气泡 |
| `message_end` | LLM 一次生成结束 | — |
| `tool_execution_start` | 工具调用开始 | 显示 "正在执行 xxx..." |
| `tool_execution_update` | 工具执行中间输出 | 实时显示工具输出 |
| `tool_execution_end` | 工具调用结束 | 显示工具结果 |
| `turn_start` | 一轮 ReAct 循环开始 | — |
| `turn_end` | 一轮 ReAct 循环结束 | — |
| `auto_compaction_start` | 上下文自动压缩开始 | 显示 "整理上下文中..." |
| `auto_compaction_end` | 上下文自动压缩结束 | — |

---

## 3. Agent 文件体系

### 3.1 设计原则：兼容 OpenClaw 格式

EvoClaw 的 Agent 文件体系兼容 OpenClaw 的 8 文件格式，确保：
- 社区 103+ 生产级 SOUL.md 模板直接可用
- 用户从 OpenClaw 迁移成本为零
- ClawHub Skills 期望的文件结构天然兼容
- PI 的 bootstrap 注入机制可直接读取

### 3.2 文件结构

```
~/.evoclaw/agents/{id}/
├── workspace/                      # Agent 工作区
│   ├── SOUL.md                     # 行为哲学（内在）
│   ├── IDENTITY.md                 # 外在展示（name/emoji/avatar）
│   ├── AGENTS.md                   # 标准操作规程 SOP
│   ├── TOOLS.md                    # 工具文档
│   ├── HEARTBEAT.md                # 周期性行为清单
│   ├── USER.md                     # 用户画像（从 memory_units 动态渲染）
│   ├── MEMORY.md                   # 长期记忆快照（从 memory_units 动态渲染）
│   ├── memory/                     # 每日日志
│   │   ├── 2026-03-12.md
│   │   └── 2026-03-13.md
│   └── skills/                     # 工作区级 Skills
├── sessions/                       # JSONL 会话记录（PI 管理）
└── agent/                          # Agent 状态数据（PI 管理）
```

### 3.3 各文件职责与加载策略

#### SOUL.md — 行为哲学（内在）

定义 Agent **如何思考和行为**，自然语言编写。

典型结构：
```markdown
# Soul

## Core Truths
- 真诚地帮助用户，而不是表演式地帮助
- 有自己的观点和判断，不要什么都说"好的"
- 遇到不确定的事情，坦诚说"我不确定"

## Boundaries
- 私密信息不主动提及
- 涉及外部操作（发消息、删文件）前先征得用户同意
- 群聊中不暴露用户的个人偏好

## Continuity
- 这些文件是你的记忆，阅读它们，在适当时候更新它们
- 每次对话都是成长的机会
```

**加载场景**: 所有会话（私聊、群聊、Heartbeat、子 Agent）

#### IDENTITY.md — 外在展示

结构化配置，定义 Agent 的外观和展示身份：

```yaml
---
name: "小助手"
emoji: "🤖"
creature: "智能伴侣"
vibe: "温暖、细心、有条理"
avatar: "avatar.png"
theme: "warm"
---
```

**解析优先级**（最具体的胜出）：
1. 工作区文件 `IDENTITY.md`
2. 每 Agent 配置（agent config）
3. 全局配置（global config）
4. 默认值（"助手"）

**关键区分**：Soul = 内在行为哲学（如何思考）；Identity = 外在展示（如何呈现）。一个严肃的 Soul 可以配一个活泼的 emoji。

**加载场景**: 所有会话

#### AGENTS.md — 标准操作规程（SOP）

建立工作区规则和行为指南：

```markdown
# Operating Procedures

## Safety Principles
- 不要在回复中暴露 API Key、密码等敏感信息
- 不要执行 rm -rf、DROP TABLE 等破坏性命令（除非用户明确确认）
- 向 IM 平台发送消息前，先展示给用户确认

## Session Initialization
1. 读取 SOUL.md 了解自己的行为准则
2. 读取 USER.md 了解用户背景
3. 读取 MEMORY.md 和近两天的 memory/*.md 回顾记忆
4. 根据以上信息调整回复风格和内容

## Memory Protocol
- 对话中学到的重要信息，在合适时机写入 memory/YYYY-MM-DD.md
- 用户的长期偏好和纠正，更新到 MEMORY.md
- 不要重复存储已有的记忆

## File Operations
- 修改用户文件前先说明要做什么
- 大范围修改前创建备份
```

**加载场景**: 私聊、群聊

#### TOOLS.md — 工具文档

用户维护的工具说明文档，描述工作区特定的工具和环境：

```markdown
# Available Tools

## Environment
- macOS Sonoma, Homebrew installed
- Python 3.12 via pyenv
- Node.js 22 via nvm

## Custom Scripts
- `~/scripts/daily-report.py` - 生成日报，需要传入日期参数
- `~/scripts/backup.sh` - 增量备份到 NAS

## Notes
- ffmpeg 已安装，可以处理视频
- 不要用 sudo，当前用户有足够权限
```

**加载场景**: 私聊（需要工具操作时）

#### HEARTBEAT.md — 周期性行为清单

Agent 定时自检的清单：

```markdown
# Heartbeat Checklist

## Every Check
- [ ] 检查 ~/Downloads 是否有新文件需要整理
- [ ] 检查今天的日历是否有即将到来的会议
- [ ] 如果是工作日 18:00 后，提醒用户做日报

## Weekly (Monday)
- [ ] 总结上周的工作笔记
- [ ] 检查待办清单中过期的项目

## Rules
- 如果没有需要关注的事项，回复 HEARTBEAT_OK
- 告警消息控制在 300 字以内
- 非紧急事项不在 22:00-09:00 打扰用户
```

**加载场景**: 仅 Heartbeat 运行时（`lightContext: true` 时仅加载此文件）

#### USER.md — 用户画像（动态渲染）

**数据来源**: 从 SQLite `memory_units` 表动态渲染（`category IN ('profile', 'preference', 'correction')`），格式兼容 OpenClaw。

```markdown
# User Profile

## Basic Info
- 职业：互联网公司产品经理
- 所在地：上海
- 主力设备：MacBook Pro M3

## Preferences
- 沟通风格：直接、简洁，不需要过多客套
- 编程：TypeScript，偏好函数式风格
- 文档：Markdown 格式，中文编写

## Important Corrections (Always Follow)
- ⚠️ 不要建议使用本地模型，这是门槛
- ⚠️ 不要在代码中用 var，统一用 const/let
- ⚠️ 日报格式必须包含"今日完成"和"明日计划"两个部分

## Knowledge Network
- 用户 → works_on → EvoClaw
- EvoClaw → uses → TypeScript + Tauri 2.0
- 用户 → knows → 张三（同事，后端开发）
```

**渲染时机**: Agent bootstrap 阶段（`before_agent_start`），从 `memory_units` 表查询后写入文件
**加载场景**: 仅私聊（群聊不加载，保护隐私）

#### MEMORY.md — 长期记忆快照（动态渲染）

**数据来源**: 从 SQLite `memory_units` 表动态渲染（高 activation 的记忆），格式兼容 OpenClaw。

```markdown
# Long-term Memory

## Key Decisions
- EvoClaw 记忆系统采用 L0/L1/L2 三层分级存储（2026-03-13 确认）
- Agent 系统基于 PI 框架，不使用 Vercel AI SDK（2026-03-13 确认）

## Learned Facts
- 用户的项目 EvoClaw 是用 Tauri 2.0 + React + Node.js Sidecar 架构
- 用户对"零门槛"有强烈执着，任何增加用户配置负担的方案都会被否决

## Active Topics
- 当前正在设计 Agent 系统架构
- 记忆系统设计已确认，文档在 docs/MemorySystemDesign.md
```

**渲染时机**: Agent bootstrap 阶段，从 `memory_units` 表查询 `activation > 0.3` 且 `archived_at IS NULL` 的记忆
**加载场景**: 仅私聊（群聊不加载）

#### memory/YYYY-MM-DD.md — 每日日志

**数据来源**: 从 `conversation_log` 表渲染当日关键交互事件，同时 Agent 在对话中也可以主动追加写入。

**加载策略**: 启动时加载今天 + 昨天的日志

### 3.4 按场景的文件加载矩阵

| 文件 | 私聊首轮 | 私聊后续 | 群聊 | Heartbeat | 子 Agent | Cron |
|------|---------|---------|------|-----------|---------|------|
| SOUL.md | ✅ | ✅(缓存) | ✅ | ❌(light) | ✅ | ✅ |
| IDENTITY.md | ✅ | ✅(缓存) | ✅ | ❌ | ✅ | ❌ |
| AGENTS.md | ✅ | ✅(缓存) | ✅ | ❌(light) | ❌ | ❌ |
| TOOLS.md | ✅ | ✅(缓存) | ❌ | ❌ | ✅ | ✅ |
| HEARTBEAT.md | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| USER.md | ✅ | ✅(缓存) | ❌(隐私) | ❌ | ❌ | ❌ |
| MEMORY.md | ✅ | ✅(缓存) | ❌(隐私) | ❌ | ❌ | ❌ |
| memory/*.md | ✅(今天+昨天) | ❌ | ❌ | ❌ | ❌ | ❌ |
| BOOT.md | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (启动时) |

**总字符上限**: 20,000 字符（与 OpenClaw 一致），超出时按优先级截断：
1. SOUL.md（不截断）
2. AGENTS.md
3. USER.md
4. MEMORY.md
5. TOOLS.md
6. IDENTITY.md
7. memory/*.md（最先被截断）

---

## 4. Agent 运行时架构

### 4.1 嵌入式运行器

EvoClaw 采用与 OpenClaw 相同的 PI 嵌入模式。核心入口 `runEmbeddedAgent()`：

```typescript
import { createAgentSession } from '@mariozechner/pi-coding-agent'

interface AgentRunConfig {
  agentId: string
  workspace: string
  sessionStore: string
  model: string
  customTools: AgentTool[]
  extensions: Extension[]
  timeout: number          // 默认 600s
  maxTurns?: number        // ReAct 循环最大轮数
}

async function runEmbeddedAgent(
  config: AgentRunConfig,
  userMessage: string,
  onEvent: (event: AgentEvent) => void
): Promise<void> {
  const session = await createAgentSession({
    workspace: config.workspace,
    sessionStore: config.sessionStore,
    model: config.model,
    customTools: config.customTools,
    extensions: config.extensions,
    timeout: config.timeout,
  })

  // 订阅所有事件 → 转发到调用方
  session.subscribe(onEvent)

  // 执行 prompt（PI 内部执行 ReAct 循环）
  await session.prompt(userMessage)
}
```

### 4.2 ReAct 循环流程

```
用户消息
    │
    ▼
┌──────────────────────────────┐
│ Bootstrap 文件注入             │
│ · 首轮：注入 8 个工作区文件    │
│ · 后续轮：仅注入用户消息      │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ before_agent_start 钩子       │ ← EvoClaw 记忆桥接点
│ · 渲染 USER.md / MEMORY.md   │
│ · 记忆检索 + 注入             │
│ · 权限预检查                  │
└──────────┬───────────────────┘
           │
           ▼
    ┌──────────────┐
    │   LLM 调用    │ ← pi-ai 流式调用
    └──────┬───────┘
           │
           ├── 纯文本响应 → 结束本轮
           │
           └── 工具调用请求 ──┐
                              ▼
                ┌──────────────────────┐
                │ 工具执行               │
                │ · 权限检查（EvoClaw）  │
                │ · 沙箱执行（Docker）   │
                │ · 结果回喂 LLM        │
                └──────────┬───────────┘
                           │
                           ▼
                    回到 LLM 调用（循环）
                           │
                     （达到终止条件）
                           │
                           ▼
              ┌──────────────────────┐
              │ agent_end 钩子        │ ← EvoClaw 记忆桥接点
              │ · 记忆提取 pipeline    │
              │ · 进化评分             │
              │ · 能力图谱更新         │
              └──────────────────────┘
```

### 4.3 Lane 队列并发模型

借鉴 OpenClaw 的 Lane 设计，**默认串行，显式并行**：

```typescript
interface LaneConfig {
  name: string
  concurrency: number
}

const lanes: LaneConfig[] = [
  { name: 'main',     concurrency: 4 },   // 用户消息 + 主 Heartbeat
  { name: 'subagent', concurrency: 8 },   // 子 Agent 运行
  { name: 'cron',     concurrency: 2 },   // 定时任务
]
```

**关键约束**：同一 Session Key 下的请求 **串行执行**，防止工具/会话竞态条件。

**Steer 模式**：当队列模式为 `steer` 时，用户新消息可以在工具调用间隙注入当前运行，实现中途打断和方向调整。

### 4.4 超时与中止

- 默认超时：600 秒（`agents.defaults.timeoutSeconds`）
- 中止信号：AbortController + AbortSignal
- 中止触发条件：用户取消、网关断连、RPC 超时、Tauri 窗口关闭

---

## 5. 工具系统：5 阶段注入流水线

### 5.1 流水线设计

基于 PI 的 builtInTools → customTools 分层机制，EvoClaw 定义 5 阶段注入：

```
阶段 1: PI 基础工具
    │  read, write, edit, bash
    │  来源：pi-coding-agent 内置
    │
阶段 2: EvoClaw 替换/增强
    │  沙箱感知的 bash（Docker 模式下在容器内执行）
    │  权限拦截层（敏感操作弹窗确认）
    │  文件操作审计日志
    │
阶段 3: EvoClaw 专有工具
    │  memory_search   — 记忆混合搜索（FTS5 + sqlite-vec）
    │  memory_get      — 指定记忆详情加载（L2 按需）
    │  knowledge_query — 知识图谱关系查询
    │  evolution_score — 查看 Agent 成长数据
    │  user_confirm    — 请求用户确认（弹窗）
    │
阶段 4: Channel 工具（按当前通道动态注入）
    │  feishu_send     — 飞书发消息
    │  feishu_card     — 飞书卡片消息
    │  wecom_send      — 企微发消息
    │  qq_send         — QQ 发消息
    │  desktop_notify  — 桌面通知
    │
阶段 5: MCP + 用户 Skill
    │  MCP Server 暴露的工具
    │  ClawHub / skills.sh 安装的 Skills
    │  工作区级 Skills（workspace/skills/）
    │
    ▼
策略过滤
    · 权限检查（Agent 是否被允许使用此工具）
    · Provider 兼容性适配（部分 Provider 不支持某些 tool schema 特性）
    · Schema 标准化
```

### 5.2 工具权限控制

每 Agent 独立的工具访问控制：

```typescript
interface AgentToolPolicy {
  allow?: string[]   // 白名单模式：仅允许列出的工具
  deny?: string[]    // 黑名单模式：禁止列出的工具
}

// 示例：限制一个只读 Agent
const readOnlyPolicy: AgentToolPolicy = {
  allow: ['read', 'memory_search', 'memory_get', 'knowledge_query'],
  // deny 不设置，未在 allow 中的工具一律禁止
}

// 示例：允许大部分操作但禁止执行命令
const noExecPolicy: AgentToolPolicy = {
  deny: ['bash', 'exec'],
  // 其他工具默认允许
}
```

### 5.3 敏感操作拦截

通过 EvoClaw 的权限模型，在工具执行前拦截敏感操作：

```typescript
// 阶段 2 的权限拦截器
async function permissionInterceptor(
  toolName: string,
  params: unknown,
  agentId: string
): Promise<'allow' | 'deny' | 'ask'> {
  // 破坏性文件操作
  if (toolName === 'bash' && isDangerousCommand(params.command)) {
    return 'ask'  // 弹窗让用户确认
  }
  // 向 IM 发送消息
  if (toolName.endsWith('_send')) {
    return 'ask'  // 消息发送前必须确认
  }
  // 查询权限缓存
  return await checkPermissionCache(agentId, toolName)
}
```

### 5.4 工具执行审计

所有工具执行记录写入审计日志：

```sql
CREATE TABLE tool_audit_log (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  session_key TEXT NOT NULL,
  tool_name   TEXT NOT NULL,
  params      TEXT,              -- JSON
  result_summary TEXT,           -- 截断的结果摘要
  permission  TEXT NOT NULL,     -- 'auto_allow' | 'user_allow' | 'user_deny'
  duration_ms INTEGER,
  created_at  INTEGER NOT NULL
);
```

---

## 6. Skill 生态：ClawHub + skills.sh

### 6.1 设计原则：不自建生态，对接公共平台

EvoClaw 的 Skill 发现和安装直接对接现有生态平台，不重复造轮子：

| 平台 | Skills 数量 | 接入方式 |
|------|------------|---------|
| **ClawHub** (clawhub.com) | 13,700+ | API 搜索 + 下载 |
| **skills.sh** | 持续增长 | API 搜索 + 下载 |
| **本地工作区** | 用户自定义 | 直接加载 |

### 6.2 Skill 格式：AgentSkills 规范

遵循 PI / OpenClaw 的 AgentSkills 规范，每个 Skill 是一个目录：

```
skill-daily-report/
├── SKILL.md            # Skill 声明（元数据 + 使用说明）
├── prompt.md           # Skill 的 prompt 模板
├── setup.sh            # 可选：安装依赖脚本
└── examples/           # 可选：使用示例
```

`SKILL.md` 格式：

```markdown
---
name: daily-report
description: 生成格式化的工作日报
version: 1.0.0
author: community
metadata:
  openclaw:
    requires:
      bins: []
      env: []
      os: ["darwin", "linux"]
    always: false
---

# Daily Report Generator

## Usage
调用此 Skill 时，Agent 会收集今天的对话记录、待办事项变更、文件修改，
自动生成一份结构化日报。

## Output Format
日报包含以下部分：
- 今日完成
- 遇到的问题
- 明日计划
```

### 6.3 Skill 加载优先级

```
1. 工作区 Skills    ~/.evoclaw/agents/{id}/workspace/skills/
2. 本地安装 Skills  ~/.evoclaw/skills/
3. 内置 Skills      EvoClaw 自带的基础 Skills
```

### 6.4 Skill 门控机制

PI 内置的门控系统，安装/加载前自动检查：

| 门控条件 | 说明 | 示例 |
|---------|------|------|
| `requires.bins` | PATH 中需要的二进制文件 | `["ffmpeg", "python3"]` |
| `requires.env` | 需要的环境变量 | `["OPENAI_API_KEY"]` |
| `requires.os` | 平台限制 | `["darwin"]` (仅 macOS) |
| `requires.config` | 需要的配置项 | `["model.provider"]` |
| `always: true` | 跳过所有门控，始终加载 | — |

不满足门控条件的 Skill 静默跳过，不报错。

### 6.5 Skill 安装流程

```
用户请求安装 Skill
    │
    ▼
┌─────────────────────┐
│ 1. 搜索               │ ← ClawHub API / skills.sh API
│    展示匹配结果        │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 2. 下载               │ ← 下载 Skill 包到临时目录
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 3. 静态分析（可选）    │ ← 扫描危险模式（eval, fetch, fs.write）
│    发现风险 → 警告     │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 4. 门控检查           │ ← 检查 requires.bins/env/os
│    不满足 → 提示安装   │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 5. 用户确认           │ ← UI 展示 Skill 信息 + 安全评估
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 6. 安装到本地         │ ← 复制到 ~/.evoclaw/skills/
└─────────────────────┘
```

---

## 7. 多 Agent 系统

### 7.1 Agent 隔离

每个 Agent 是 **完全隔离的个体**：

```
~/.evoclaw/agents/
├── assistant/                  # 默认通用助手
│   ├── workspace/              # 独立工作区
│   │   ├── SOUL.md
│   │   ├── IDENTITY.md
│   │   └── ...
│   ├── sessions/               # 独立会话存储
│   └── agent/                  # 独立状态数据
├── coder/                      # 编程助手
│   ├── workspace/
│   ├── sessions/
│   └── agent/
└── writer/                     # 写作助手
    ├── workspace/
    ├── sessions/
    └── agent/
```

隔离维度：
- 独立的工作区文件（SOUL.md、MEMORY.md 等）
- 独立的会话存储（JSONL）
- 独立的记忆空间（`memory_units` 表中按 `agent_id` 隔离）
- 独立的知识图谱（`knowledge_graph` 表中按 `agent_id` 隔离）
- 独立的能力图谱（`capability_graph` 表中按 `agent_id` 隔离）
- 独立的认证配置（不同 Agent 可以用不同的 LLM Provider）

### 7.2 子 Agent 派生

通过工具族在对话中派生子 Agent：

| 工具 | 功能 |
|------|------|
| `spawn_agent` | 创建子 Agent，指定任务、约束、模式（run/session） |
| `list_agents` | 列出当前活跃的子 Agent 会话及结果 |
| `kill_agent` | 终止运行中的子 Agent（支持级联终止所有后代） |
| `steer_agent` | 纠偏：停止当前执行 + 注入修正指令重新运行 |
| `yield_agents` | 等待/手动收集子 Agent 结果（结果也会自动推送） |
| `resume_agent` | 向 session 模式的子 Agent 发送后续指令（计划中） |

**安全约束**：
- 派生深度限制：`maxSpawnDepth` 可配置，默认 2（main→orchestrator→leaf）
- 并发限制：每 Agent 最多 5 个活跃子代 + subagent lane 8 并发
- 子 Agent 在独立会话中运行，完成后结果自动推送给父 Agent（Push-based）
- 子 Agent 不继承父 Agent 的私密记忆和 channel 工具
- 子代结果用 `<<<UNTRUSTED>>>` 标记包裹，防止 prompt 注入
- 级联 Kill：终止某个子代时递归终止其所有后代

**Spawn 模式**（计划中）：
- `run`（默认）：一次性执行，完成即销毁
- `session`：持久化子代 session，可多次交互（resume），idle 30 分钟自动清理

> 详细设计见 [`SubAgent-ReAct-Optimization.md`](./SubAgent-ReAct-Optimization.md)

### 7.3 Agent 间通信

独立 Agent 之间的直接通信（非父子关系），**默认关闭**：

```typescript
interface AgentToAgentConfig {
  enabled: boolean
  allow: string[]    // 允许通信的 Agent ID 列表
}

// 示例：允许 assistant 和 coder 互相通信
const config = {
  agentToAgent: {
    enabled: true,
    allow: ['assistant', 'coder']
  }
}
```

---

## 8. Channel 路由与 Binding

### 8.1 Binding 路由：最具体匹配优先

定义消息从哪个 Channel 路由到哪个 Agent：

```typescript
interface Binding {
  agentId: string
  match: {
    channel?: 'desktop' | 'feishu' | 'wecom' | 'qq'
    accountId?: string      // IM 账号 ID
    peerId?: string         // 对话对象 ID（DM/群组）
    chatType?: 'private' | 'group'
  }
}
```

**匹配优先级**（从高到低）：

```
1. peerId 精确匹配         → "这个群/这个人 → 用这个 Agent"
2. accountId + channel     → "这个账号的飞书消息 → 用这个 Agent"
3. channel 匹配            → "所有企微消息 → 用这个 Agent"
4. 默认 Agent 兜底         → "其他消息 → 用默认 Agent"
```

配置示例：

```typescript
const bindings: Binding[] = [
  // 飞书工作群 → 工作助手
  { agentId: 'work', match: { channel: 'feishu', peerId: 'group_123' } },
  // 飞书私聊 → 通用助手
  { agentId: 'assistant', match: { channel: 'feishu', chatType: 'private' } },
  // 企微所有消息 → 工作助手
  { agentId: 'work', match: { channel: 'wecom' } },
  // QQ → 生活助手
  { agentId: 'life', match: { channel: 'qq' } },
  // 桌面端 → 通用助手（默认）
  { agentId: 'assistant', match: { channel: 'desktop' } },
]
```

### 8.2 Session Key 生成

路由确定 Agent 后，生成 Session Key 用于记忆隔离：

```typescript
function generateSessionKey(
  agentId: string,
  channel: string,
  chatType: 'private' | 'group',
  peerId?: string,
  accountId?: string
): string {
  // 格式: agent:{agentId}:{channel}:{chatType}:{peerId}
  const parts = ['agent', agentId, channel, chatType]
  if (peerId) parts.push(peerId)
  return parts.join(':')
}

// 示例输出:
// "agent:work:feishu:group:group_123"
// "agent:assistant:desktop:private:main"
// "agent:life:qq:private:user_456"
```

---

## 9. 主动行为：Heartbeat + Cron

### 9.1 Heartbeat（心跳检查）

在 **主会话上下文** 中运行，共享对话记忆：

```typescript
interface HeartbeatConfig {
  every: string            // 间隔，如 "30m"（0m 禁用）
  target: 'none' | 'last' | string  // 结果发送目标
  lightContext: boolean    // true: 仅加载 HEARTBEAT.md；false: 加载全部文件
  activeHours: {
    start: string          // "09:00"
    end: string            // "22:00"
    timezone: string       // "Asia/Shanghai"
  }
}
```

**响应约定**：
- Agent 回复 `HEARTBEAT_OK` → 表示无事发生，静默丢弃不通知用户
- Agent 回复其他内容 → 有需要关注的事项，发送给用户
- 告警消息去除 `HEARTBEAT_OK` 后超过 300 字符才发送（防止误触发）

### 9.2 Cron（定时任务）

在 **隔离会话** 中运行，不共享主会话上下文：

```typescript
interface CronJob {
  id: string
  schedule: string         // cron 表达式，如 "0 9 * * 1-5"（工作日 9:00）
  agentId: string
  prompt: string           // 执行的 prompt
  target?: string          // 结果发送到哪个 Channel
  timeout?: number         // 超时秒数
}

// 示例
const cronJobs: CronJob[] = [
  {
    id: 'morning-briefing',
    schedule: '0 9 * * 1-5',      // 工作日 9:00
    agentId: 'assistant',
    prompt: '生成今日简报：天气、日历、待办事项、昨日未完成任务',
    target: 'desktop',
  },
  {
    id: 'weekly-review',
    schedule: '0 18 * * 5',       // 每周五 18:00
    agentId: 'work',
    prompt: '总结本周工作：完成的任务、遇到的问题、下周计划',
    target: 'feishu',
  },
]
```

### 9.3 Heartbeat vs Cron 对比

| 维度 | Heartbeat | Cron |
|------|-----------|------|
| 执行上下文 | 主会话（共享记忆） | 隔离会话（独立） |
| 触发方式 | 固定间隔 | Cron 表达式（精确时间） |
| 适用场景 | 持续监控、环境检查 | 定时报告、周期任务 |
| 运行 Lane | main | cron |
| 可感知对话历史 | ✅ | ❌ |

### 9.4 System Events 事件驱动

内存事件队列实现事件驱动的 prompt 注入：

```
┌──────────────┐    enqueue    ┌─────────────────┐    drain    ┌──────────┐
│ Cron (event) │──────────────→│  System Events   │──────────→│ chat.ts  │
│ Manual API   │               │ Map<session,[]>  │           │ message  │
│ Channel Hook │               │ 最多 20 条/session │           │ 前缀注入  │
└──────────────┘               └─────────────────┘           └──────────┘
```

- 连续重复去重
- 无持久化（重启清空）
- Cron actionType='event' → 注入主 session
- REST API: `POST /system-events/:agentId/events`

### 9.5 Standing Orders 授权框架

Standing Orders 写在 AGENTS.md 中，定义结构化的"持续授权程序"：

```markdown
### Program: [Name]
- **Scope**: 授权范围
- **Trigger**: heartbeat / cron / event
- **Approval**: 审批门槛
- **Escalation**: 上报条件
```

- 系统 prompt 注入 `<standing_orders>` 段落使 Agent 具备 Standing Orders 意识
- Heartbeat prompt 检查 trigger=heartbeat 的程序
- Cron 强制执行 trigger=cron 的程序

### 9.6 BOOT.md 启动脚本

BOOT.md 与 BOOTSTRAP.md 的区别：

| 维度 | BOOTSTRAP.md | BOOT.md |
|------|-------------|---------|
| 执行时机 | 首次 setup | 每次 sidecar 启动 |
| 持久性 | 一次性（setup 完成后清空） | 持久（始终保留） |
| 用途 | 出生仪式 | 启动初始化脚本 |

- **执行条件**：内容非空（排除纯注释/标题）
- **Session key**: `agent:{id}:boot`
- 执行失败不阻塞启动

### 9.7 渠道投递机制

HeartbeatConfig.target 控制投递目标：

| target 值 | 行为 |
|-----------|------|
| `'none'`（默认） | 不投递 |
| `'last'` | 查询 conversation_log 最近外部渠道 |
| 渠道 ID | 直接指定渠道 |

**可见性控制**：

| 字段 | 默认值 | 说明 |
|------|--------|------|
| showOk | false | 是否投递 HEARTBEAT_OK |
| showAlerts | true | 是否投递告警内容 |

通过 HeartbeatResultCallback 异步投递，不阻塞心跳。

---

## 10. 沙箱安全：Docker 可选方案

### 10.1 三级安全模式

| 模式 | 配置 | 适用场景 |
|------|------|---------|
| **无沙箱（默认）** | `sandbox.mode: "off"` | 用户信任 Agent，追求零配置 |
| **选择性沙箱** | `sandbox.mode: "selective"` | 仅对 bash/exec 工具启用沙箱 |
| **全沙箱** | `sandbox.mode: "all"` | 所有文件操作和命令执行都在容器内 |

### 10.2 Docker 安装引导

首次启用沙箱时的用户体验：

```
用户在设置中开启"沙箱模式"
    │
    ▼
┌─────────────────────────┐
│ 检测 Docker 是否已安装     │
│ · which docker            │
│ · docker info             │
└─────────┬───────────────┘
          │
    ┌─────┴──────┐
    │             │
  已安装        未安装
    │             │
    ▼             ▼
  启用沙箱    ┌─────────────────────────┐
              │ 弹窗引导安装 Docker        │
              │ · macOS: 引导安装 Colima   │
              │   (轻量级, 无需 Docker     │
              │    Desktop 许可证)         │
              │ · Windows: 引导启用 WSL2   │
              │   + 安装 Docker Engine     │
              │ · Linux: apt/yum 安装      │
              └─────────────────────────┘
```

### 10.3 沙箱配置

```typescript
interface SandboxConfig {
  mode: 'off' | 'selective' | 'all'
  scope: 'agent' | 'shared'     // 每 Agent 独立容器 vs 共享容器
  docker: {
    image?: string               // 默认: "node:22-slim"
    setupCommand?: string        // 容器初始化命令
    mountPaths?: string[]        // 额外挂载路径
    networkMode?: 'none' | 'host' | 'bridge'  // 默认: "none"（无网络）
  }
}
```

### 10.4 沙箱中的工具执行

```typescript
// 阶段 2 的沙箱感知 bash 工具
async function sandboxedBash(command: string, config: SandboxConfig): Promise<string> {
  if (config.mode === 'off') {
    // 直接执行
    return execCommand(command)
  }

  // 在 Docker 容器中执行
  return execInDocker({
    image: config.docker.image ?? 'node:22-slim',
    command,
    workdir: '/workspace',
    mounts: [
      { host: agentWorkspace, container: '/workspace', readonly: false },
      ...(config.docker.mountPaths ?? []).map(p => ({
        host: p, container: p, readonly: true
      })),
    ],
    network: config.docker.networkMode ?? 'none',
    timeout: 60000,  // 60 秒超时
  })
}
```

---

## 11. 与记忆系统的集成

### 11.1 桥接架构

EvoClaw 的记忆系统（详见 `MemorySystemDesign.md`）通过 PI 的扩展钩子与 Agent 运行时集成：

```typescript
import type { Extension, ExtensionAPI } from '@mariozechner/pi-coding-agent'

function evoClawMemoryExtension(api: ExtensionAPI): void {
  // === before_agent_start: 记忆注入 ===
  api.on('before_agent_start', async (event, ctx) => {
    const agentId = ctx.agentId
    const sessionKey = ctx.sessionKey

    // 1. 渲染 USER.md（从 memory_units 动态生成）
    const userMd = await renderUserMd(agentId)
    await writeFile(join(ctx.workspace, 'USER.md'), userMd)

    // 2. 渲染 MEMORY.md（从 memory_units 高 activation 记忆生成）
    const memoryMd = await renderMemoryMd(agentId)
    await writeFile(join(ctx.workspace, 'MEMORY.md'), memoryMd)

    // 3. 渲染今日 memory/YYYY-MM-DD.md
    const todayLog = await renderDailyLog(agentId, new Date())
    await writeFile(join(ctx.workspace, 'memory', todayFileName()), todayLog)

    // 4. 三阶段记忆检索 → 注入到上下文
    if (event.prompt) {
      const memories = await recallMemories(event.prompt, agentId, sessionKey, {
        maxL1: 10,
        loadL2: shouldLoadL2(event.prompt),
      })
      if (memories) {
        return {
          prependContext: wrapMemoryContext(memories),
        }
      }
    }
  })

  // === agent_end: 记忆提取 ===
  api.on('agent_end', async (event, ctx) => {
    if (!event.success) return
    if (!event.messages || event.messages.length === 0) return

    // 1. 预处理：剥离注入的记忆上下文 + 过滤
    const sanitized = sanitizeForExtraction(event.messages)
    if (!sanitized) return

    // 2. 记忆提取：一次 LLM 调用生成结构化记忆
    const extracted = await extractMemories(sanitized, ctx.agentId)

    // 3. 持久化：写入 memory_units + knowledge_graph
    await persistMemories(extracted, ctx.agentId)

    // 4. 进化评分 + 能力图谱更新
    await updateEvolution(ctx.agentId, event.messages)
  })

  // === tool_result_persist: 工具执行记录 ===
  api.on('tool_result_persist', async (event, ctx) => {
    const toolName = event.toolName
    if (!toolName || toolName.startsWith('memory_')) return

    // 记录到 conversation_log（用于后续记忆提取）
    await logToolExecution({
      agentId: ctx.agentId,
      sessionKey: ctx.sessionKey,
      toolName,
      params: event.params,
      result: truncate(event.result, 1000),
    })
  })

  // === session_before_compact: 压缩前记忆保存 ===
  api.on('session_before_compact', async (event, ctx) => {
    // Pre-compaction Memory Flush
    // 在上下文压缩前，确保关键信息已持久化到 memory_units
    const pendingMessages = await getPendingMessages(ctx.agentId, ctx.sessionKey)
    if (pendingMessages.length > 0) {
      const extracted = await extractMemories(pendingMessages, ctx.agentId)
      await persistMemories(extracted, ctx.agentId)
    }
  })
}
```

### 11.2 EvoClaw 专有工具（阶段 3）

注册到 PI 工具系统的 EvoClaw 记忆工具：

```typescript
const memorySearchTool: AgentTool = {
  name: 'memory_search',
  description: '搜索 Agent 的长期记忆。返回与查询相关的记忆条目（L1 概览级别）',
  parameters: Type.Object({
    query: Type.String({ description: '搜索关键词或自然语言查询' }),
    limit: Type.Optional(Type.Number({ description: '返回条数上限', default: 10 })),
    category: Type.Optional(Type.String({
      description: '限定分类：profile/preference/entity/event/case/pattern/tool/skill/correction'
    })),
  }),
  execute: async (toolCallId, params) => {
    const results = await hybridSearch(params.query, agentId, {
      limit: params.limit ?? 10,
      category: params.category,
    })
    return {
      content: [{ type: 'text', text: formatSearchResults(results) }],
    }
  },
}

const memoryGetTool: AgentTool = {
  name: 'memory_get',
  description: '获取指定记忆的完整详情（L2 级别）',
  parameters: Type.Object({
    ids: Type.Array(Type.String(), { description: '记忆 ID 列表' }),
  }),
  execute: async (toolCallId, params) => {
    const details = await loadL2Content(params.ids)
    return {
      content: [{ type: 'text', text: formatMemoryDetails(details) }],
    }
  },
}

const knowledgeQueryTool: AgentTool = {
  name: 'knowledge_query',
  description: '查询知识图谱中的实体关系',
  parameters: Type.Object({
    entity: Type.String({ description: '实体名称' }),
    predicate: Type.Optional(Type.String({ description: '关系类型' })),
    direction: Type.Optional(Type.String({
      description: '查询方向：outgoing（此实体→其他）/ incoming（其他→此实体）/ both',
      default: 'both'
    })),
  }),
  execute: async (toolCallId, params) => {
    const relations = await queryKnowledgeGraph(
      agentId, params.entity, params.predicate, params.direction
    )
    return {
      content: [{ type: 'text', text: formatRelations(relations) }],
    }
  },
}
```

### 11.3 集成时序图

```
用户发送消息
    │
    ▼
Hono HTTP Server 接收
    │
    ▼
BindingRouter 路由到 Agent
    │
    ▼
Lane 队列排队
    │
    ▼
┌─────────────────────────────────────────┐
│ PI 运行时开始                              │
│                                           │
│  ① before_agent_start 钩子                │
│     → EvoClaw: 渲染 USER.md, MEMORY.md    │
│     → EvoClaw: 三阶段记忆检索 + 注入       │
│                                           │
│  ② PI bootstrap 注入工作区文件             │
│     → SOUL.md + IDENTITY.md + AGENTS.md   │
│     → USER.md + MEMORY.md + TOOLS.md      │
│                                           │
│  ③ ReAct 循环                             │
│     → LLM 调用                            │
│     → 工具执行（含 memory_search 等）       │
│     → tool_result_persist 钩子             │
│       → EvoClaw: 记录到 conversation_log   │
│     → 结果回喂 LLM → 循环                  │
│                                           │
│  ④ 上下文接近上限？                         │
│     → session_before_compact 钩子          │
│       → EvoClaw: Pre-compaction Flush      │
│     → PI auto-compaction 执行              │
│                                           │
│  ⑤ agent_end 钩子                         │
│     → EvoClaw: 记忆提取 pipeline           │
│     → EvoClaw: 进化评分 + 能力图谱         │
│                                           │
└─────────────────────────────────────────┘
    │
    ▼
事件流 → React UI 渲染
```

---

## 12. 完整模块总览

### 12.1 EvoClaw Agent 系统模块结构

```
packages/core/src/
├── agent/
│   ├── embedded-runner.ts         # PI 嵌入式运行器
│   ├── agent-manager.ts           # Agent CRUD + 生命周期管理
│   ├── agent-builder.ts           # 会话式创建引导（生成 SOUL.md 等文件）
│   ├── lane-queue.ts              # Lane 并发队列
│   └── types.ts
│
├── bridge/
│   ├── memory-extension.ts        # PI ↔ 记忆系统桥接（扩展钩子）
│   ├── security-extension.ts      # PI ↔ Rust 安全层桥接（权限拦截）
│   ├── tool-injector.ts           # 5 阶段工具注入编排
│   └── event-forwarder.ts         # PI 事件流 → HTTP SSE → React UI
│
├── provider/
│   ├── provider-registry.ts       # 国内 Provider 注册（Qwen/GLM/Doubao）
│   ├── model-resolver.ts          # Agent 配置 → 模型选择逻辑
│   └── provider-configs/
│       ├── qwen.ts                # 通义千问配置
│       ├── glm.ts                 # 智谱 GLM 配置
│       ├── doubao.ts              # 豆包配置
│       ├── deepseek.ts            # DeepSeek 配置（PI 原生，补充配置）
│       └── minimax.ts             # MiniMax 配置（PI 原生，补充配置）
│
├── tools/
│   ├── evoclaw-tools.ts           # 阶段 3: EvoClaw 专有工具
│   │   ├── memory-search.ts       #   记忆混合搜索
│   │   ├── memory-get.ts          #   记忆详情加载
│   │   ├── knowledge-query.ts     #   知识图谱查询
│   │   ├── evolution-score.ts     #   成长数据查看
│   │   └── user-confirm.ts        #   用户确认弹窗
│   ├── sandbox-tools.ts           # 阶段 2: 沙箱感知的 bash/文件工具
│   ├── channel-tools.ts           # 阶段 4: Channel 操作工具
│   │   ├── feishu-tools.ts        #   飞书消息/卡片
│   │   ├── wecom-tools.ts         #   企微消息
│   │   └── qq-tools.ts            #   QQ 消息
│   └── permission-interceptor.ts  # 工具权限拦截器
│
├── skill/
│   ├── skill-discoverer.ts        # Skill 发现（ClawHub + skills.sh API）
│   ├── skill-installer.ts         # Skill 下载 + 安装
│   ├── skill-analyzer.ts          # Skill 静态分析（安全扫描）
│   └── skill-gate.ts              # 门控检查（bins/env/os）
│
├── routing/
│   ├── binding-router.ts          # Binding 路由（最具体匹配优先）
│   ├── session-key.ts             # Session Key 生成 + 解析
│   └── binding-config.ts          # Binding 配置管理
│
├── scheduler/
│   ├── heartbeat-runner.ts        # Heartbeat 调度器
│   ├── cron-runner.ts             # Cron 调度器
│   └── active-hours.ts            # 活跃时段检查
│
├── sandbox/
│   ├── docker-manager.ts          # Docker 容器管理
│   ├── docker-installer.ts        # Docker 安装引导
│   └── sandbox-config.ts          # 沙箱配置管理
│
├── memory/                        # （详见 MemorySystemDesign.md）
│   ├── memory-store.ts
│   ├── knowledge-graph.ts
│   ├── hybrid-searcher.ts
│   ├── extraction-prompt.ts
│   ├── xml-parser.ts
│   ├── text-sanitizer.ts
│   ├── decay-scheduler.ts
│   ├── merge-resolver.ts
│   └── user-md-renderer.ts
│
├── evolution/
│   ├── capability-graph.ts
│   ├── growth-tracker.ts
│   └── feedback-detector.ts
│
├── channel/
│   ├── adapters/
│   │   ├── desktop.ts
│   │   ├── feishu.ts
│   │   ├── wecom.ts
│   │   └── qq.ts
│   └── message-normalizer.ts
│
├── infrastructure/
│   ├── db/
│   │   ├── sqlite-store.ts
│   │   ├── vector-store.ts
│   │   ├── fts-store.ts
│   │   └── migrations/
│   └── security/
│       ├── keychain.ts
│       └── crypto.ts
│
└── server.ts                      # Hono HTTP 入口
```

### 12.2 数据库表完整列表

| 表 | 管理方 | 用途 |
|---|--------|------|
| `memory_units` | EvoClaw 记忆系统 | L0/L1/L2 三层记忆存储 |
| `knowledge_graph` | EvoClaw 记忆系统 | 实体关系网络 |
| `conversation_log` | EvoClaw 记忆系统 | 原始对话日志（含工具执行） |
| `memory_fts` | EvoClaw 记忆系统 | FTS5 全文索引 |
| `capability_graph` | EvoClaw 进化引擎 | Agent 能力图谱 |
| `tool_audit_log` | EvoClaw 安全层 | 工具执行审计日志 |
| `agents` | EvoClaw Agent 管理 | Agent 元数据 |
| `bindings` | EvoClaw 路由 | Channel → Agent 绑定配置 |
| `cron_jobs` | EvoClaw 调度器 | Cron 定时任务配置 |
| `permissions` | EvoClaw 安全层 | 权限授予记录 |
| `model_configs` | EvoClaw Provider | 用户的模型配置 |

注：PI 的会话数据使用 JSONL 文件存储（`~/.evoclaw/agents/{id}/sessions/`），不在 SQLite 中。

---

## 附录：研究来源

### OpenClaw Agent 架构
- OpenClaw GitHub: https://github.com/openclaw/openclaw
- Agent Runtime Docs: https://docs.openclaw.ai/concepts/agent
- Agent Loop Docs: https://docs.openclaw.ai/concepts/agent-loop
- Multi-Agent Docs: https://docs.openclaw.ai/concepts/multi-agent
- Memory Docs: https://docs.openclaw.ai/concepts/memory
- Skills Docs: https://docs.openclaw.ai/tools/skills
- Heartbeat Docs: https://docs.openclaw.ai/gateway/heartbeat
- PI Integration: https://docs.openclaw.ai/pi

### PI 框架
- PI Monorepo: https://github.com/badlogic/pi-mono
- npm: `@mariozechner/pi-ai` (v0.57.1+), `@mariozechner/pi-agent-core`, `@mariozechner/pi-coding-agent`
- License: MIT
- Custom Provider Docs: packages/coding-agent/docs/custom-provider.md
- SDK Docs: packages/coding-agent/docs/sdk.md
- Blog: https://mariozechner.at/posts/2025-11-30-pi-coding-agent/

### 社区资源
- awesome-openclaw-agents: https://github.com/mergisi/awesome-openclaw-agents (103+ SOUL.md 模板)
- ClawHub: https://clawhub.com (13,700+ Skills)
- skills.sh: https://skills.sh
