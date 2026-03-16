# EvoClaw 技术架构设计文档

> **文档版本**: v4.0
> **创建日期**: 2026-03-11
> **更新日期**: 2026-03-13
> **文档状态**: 已更新

---

## 目录

1. [架构总览](#1-架构总览)
2. [分层架构设计](#2-分层架构设计)
3. [核心子系统设计](#3-核心子系统设计)
4. [记忆架构](#4-记忆架构)
5. [数据架构](#5-数据架构)
6. [Monorepo 工程结构](#6-monorepo-工程结构)
7. [安全架构](#7-安全架构)
8. [性能与可扩展性](#8-性能与可扩展性)
9. [部署架构](#9-部署架构)

---

## 1. 架构总览

### 1.1 系统全局架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                   Tauri 主进程 (Rust)                             │
│  ┌────────────────────────┐  ┌──────────────────────────────┐  │
│  │ Rust 安全层              │  │ UI WebView                   │  │
│  │ · 加密/解密 (ring)      │  │ React 19 + Tailwind CSS 4   │  │
│  │ · Keychain 集成         │  │                              │  │
│  │ · 沙箱策略              │  │  ┌────────┐ ┌────────────┐  │  │
│  │ · Skill 签名验证        │  │  │Chat UI │ │Agent Builder│ │  │
│  │                         │  │  ├────────┤ ├────────────┤  │  │
│  └────────────┬───────────┘  │  │Dashboard│ │Skill/KB Mgr│ │  │
│               │               │  └────────┘ └────────────┘  │  │
│               │ Tauri IPC     │              │               │  │
│               │               └──────────────┼───────────────┘  │
├───────────────┼──────────────────────────────┼──────────────────┤
│               │        HTTP/IPC              │                  │
│  ┌────────────▼──────────────────────────────▼───────────────┐  │
│  │              Node.js Sidecar (TypeScript)                  │  │
│  │                                                           │  │
│  │  ┌──── PI 框架（L1-L3，不含 L4 TUI）───────────────────┐  │  │
│  │  │                                                     │  │  │
│  │  │  pi-ai (L1)          多 Provider LLM 抽象           │  │  │
│  │  │  · OpenAI / Anthropic / Google / DeepSeek / ...     │  │  │
│  │  │  · registerProvider() 注册国内 Provider             │  │  │
│  │  │                                                     │  │  │
│  │  │  pi-agent-core (L2)  Agent ReAct 循环               │  │  │
│  │  │  · streamSimple / streamFn                          │  │  │
│  │  │  · 工具执行 + 结果回喂                               │  │  │
│  │  │  · 事件系统（agent_start/tool_execution/etc）        │  │  │
│  │  │                                                     │  │  │
│  │  │  pi-coding-agent (L3)  生产运行时                    │  │  │
│  │  │  · createAgentSession / SessionManager               │  │  │
│  │  │  · 内置文件工具（read/write/edit/bash）              │  │  │
│  │  │  · JSONL 会话持久化                                  │  │  │
│  │  │  · auto-compaction 上下文压缩                        │  │  │
│  │  │  · AgentSkills 加载 + 门控                           │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                                                           │  │
│  │  ┌──── EvoClaw 桥接层 ─────────────────────────────────┐  │  │
│  │  │ · MemoryBridge       PI 扩展钩子 <-> 记忆系统        │  │  │
│  │  │ · SecurityBridge     Node <-> Rust 安全层桥接        │  │  │
│  │  │ · ToolInjector       5 阶段工具注入编排              │  │  │
│  │  │ · EventForwarder     PI 事件流 -> HTTP SSE -> UI     │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                                                           │  │
│  │  ┌──── EvoClaw 自研模块 ───────────────────────────────┐  │  │
│  │  │ · Memory System      L0/L1/L2 三层分级存储 + 检索    │  │  │
│  │  │ · Channel Adapters   飞书 / 企微 / QQ 适配           │  │  │
│  │  │ · Evolution Engine   能力图谱 + 成长追踪             │  │  │
│  │  │ · Binding Router     消息路由 + Agent 绑定           │  │  │
│  │  │ · Scheduler          Heartbeat + Cron                │  │  │
│  │  │ · Context Engine     ContextPlugin 5 钩子调度         │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──── 基础设施 ──────────────────────────────────────────────┐ │
│  │ SQLite (记忆/元数据)  │ JSONL (PI 会话)  │ Docker (沙箱)    │ │
│  │ + FTS5 + sqlite-vec   │                  │ (可选)           │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

PI 事件流 -> React UI 渲染路径:
  PI agent_start/message_update/tool_execution/agent_end
    -> EventForwarder (SSE)
      -> React UI (实时渲染对话气泡、工具执行状态)
```

### 1.2 核心设计原则

| # | 原则 | 含义 | 来源/教训 |
|---|------|------|-----------|
| 1 | **安全默认 (Secure by Default)** | 所有安全机制出厂启用，不可完全关闭 | OpenClaw 明文凭证、93.4% 认证绕过的教训 |
| 2 | **一体化体验 (All-in-One)** | 主服务 + 桌面应用合一，双击即用 | OpenClaw 需命令行启服务的教训 |
| 3 | **进化驱动 (Evolution Driven)** | 每次交互都是 Agent 进化的机会 | EvoClaw 核心品牌标识 |
| 4 | **最小权限 (Least Privilege)** | Agent/Skill 只获得完成任务所需的最小权限 | iOS 权限模型借鉴 |
| 5 | **数据安全 (Data Security)** | 用户数据本地加密存储，仅 LLM API 和 Channel 消息对外通信 | OpenClaw 3万+ 暴露实例的教训 |
| 6 | **ContextPlugin 架构** | 5 个生命周期钩子（bootstrap/beforeTurn/compact/afterTurn/shutdown），插件通过 priority 排序串行或并行执行，替代传统中间件链 | MemOS/OpenViking 插件体系经验 |
| 7 | **模型无关 (Model Agnostic)** | 通过 PI 框架（pi-ai）统一多 Provider 接口，支持 `registerProvider()` 注册国内 Provider（Qwen/GLM/Doubao），不绑定任何单一 Provider | PI 多 Provider 架构 |
| 8 | **记忆无损 (Lossless Memory)** | 每条记忆同时包含 L0 索引摘要、L1 结构化概览、L2 完整内容三层，按需加载；对话信息提取后持久化而非物理丢弃 | OpenViking L0/L1/L2 三层存储 |
| 9 | **记忆隔离 (Memory Isolation)** | 私密记忆按会话类型严格隔离，群聊不暴露个人记忆 | OpenClaw MEMORY.md 安全边界 |

### 1.3 技术选型决策表

| 维度 | 选型 | 理由 | 替代方案 | 不选原因 |
|------|------|------|----------|----------|
| **桌面框架** | Tauri 2.0 | 体积小（~15MB）、Rust 安全层、原生系统集成 | Electron | 体积臃肿（~150MB）、内存占用高 |
| **前端** | React 19 + TypeScript | 生态最大、人才最多、Tauri 完美支持 | Vue 3 / Svelte | React 在桌面应用场景更成熟 |
| **样式** | Tailwind CSS 4 | 原子化 CSS、零运行时 | CSS Modules | 开发效率较低 |
| **后端架构** | Node.js Sidecar | 完整 Node 生态 + Tauri 生命周期管理 | 全 Tauri IPC | Node 生态完整性无可替代 |
| **核心引擎** | TypeScript (Node.js >=22) | 与前端共享类型、MCP SDK 原生 TS | Rust | 业务逻辑迭代速度优先 |
| **安全关键路径** | Rust (Tauri Plugin) | 加密/沙箱/签名需要内存安全保证 | TypeScript | 安全敏感操作不应使用 GC 语言 |
| **模型调用** | PI 框架 (pi-ai) | 多 Provider LLM 抽象，`registerProvider()` 支持国内 Provider，PI 生态验证 | Vercel AI SDK | PI 已内置 Agent 运行时集成 |
| **Agent 框架** | PI 框架 (pi-agent-core + pi-coding-agent) | ReAct 循环、文件工具、JSONL 持久化、Skills 加载内置；302k+ Star 项目验证 | 自研 + 中间件链 | 2-3 周开发量可直接复用 |
| **沙箱** | Docker (可选，引导安装) | 工具执行隔离，3 模式（off/selective/all） | 无沙箱 | 安全敏感用户需要隔离执行环境 |
| **Skill 生态** | ClawHub API + GitHub URL 直装 (AgentSkills 规范) | ClawHub 提供公开 HTTP API（向量搜索 + ZIP 下载）；skills.sh 无公开 API，其 Skill 托管在 GitHub 可直接 URL 安装 | 自建生态 | 自建需要数年积累 |
| **MCP 集成** | @modelcontextprotocol/sdk | 官方 TypeScript SDK | 自研适配层 | 降低维护成本 |
| **向量存储** | SQLite-vec | 嵌入式、零依赖、与 SQLite 共享连接 | LanceDB / ChromaDB | 额外依赖不必要 |
| **全文检索** | FTS5 | SQLite 内置、零额外依赖、与向量检索共用连接 | Tantivy / MeiliSearch | 保持单引擎架构 |
| **结构化存储** | better-sqlite3 | 同步 API、Node 原生、高性能 | Drizzle ORM | 直接操作更灵活 |
| **加密** | ring (Rust) | AES-256-GCM，Rust 内存安全 | Node.js crypto | Rust 层提供更强安全保证 |
| **进程管理** | Tauri Sidecar | 管理 Node.js 后端进程生命周期 | child_process | Tauri Sidecar 提供完整生命周期管理 |
| **Channel SDK** | 各平台官方 SDK | 飞书/企微/QQ 官方 Node SDK | 自研 HTTP 封装 | 官方 SDK 维护更及时 |

---

## 2. 分层架构设计

### 2.1 展示层 (Presentation Layer)

**职责**：用户界面渲染、用户交互处理、PI 事件流消费

```
apps/desktop/src/              # React 前端
├── app/                       # 主应用路由
│   ├── chat/                  # 对话界面
│   ├── builder/               # Agent 创建向导
│   ├── dashboard/             # 进化仪表盘
│   ├── knowledge/             # 知识库管理
│   ├── skills/                # Skill 市场/管理
│   ├── channels/              # Channel 管理
│   ├── settings/              # 设置
│   └── security/              # 安全仪表盘
├── components/                # 共享 UI 组件
│   ├── chat/                  # 消息气泡、输入框、反馈按钮
│   ├── charts/                # 雷达图、折线图、热力图
│   ├── permission/            # 权限弹窗组件
│   └── common/                # 按钮、卡片、模态框等
├── hooks/                     # React Hooks
├── stores/                    # 状态管理 (Zustand)
└── lib/                       # 后端 API 调用封装
```

**关键接口**：前端通过 HTTP 调用 Node.js Sidecar 后端，PI 事件流通过 SSE 实时推送

```typescript
// 后端 API 接口示例
interface BackendAPI {
  // 对话
  'POST /chat/:agentId/send': (message: string) => SSE<AgentEvent>
  'POST /chat/:agentId/feedback': (messageId: string, type: 'up' | 'down') => void

  // Agent
  'POST /agent/create-guided': (userInput: string) => SSE<BuilderStep>
  'GET  /agent/list': () => AgentSummary[]
  'GET  /agent/:id': () => AgentDetail

  // 进化
  'GET  /evolution/:agentId/dashboard': () => DashboardData
  'GET  /evolution/:agentId/log': (range: TimeRange) => EvolutionEntry[]

  // 记忆
  'POST /memory/:agentId/search': (query: string) => MemorySearchResult[]
  'GET  /memory/:agentId/units': (filter?: MemoryFilter) => MemoryUnit[]

  // 安全（通过 Tauri IPC 调用 Rust 层）
  'permission:request': (agentId: string, perm: Permission) => PermissionDecision
  'credential:get': (key: string) => string
  'credential:set': (key: string, value: string) => void
}
```

### 2.2 应用层 (Application Layer)

**职责**：ContextPlugin 生命周期调度、PI 嵌入式运行器集成、跨领域协调

#### ContextPlugin 架构

替代传统中间件链，ContextPlugin 提供 5 个生命周期钩子：

```typescript
interface ContextPlugin {
  name: string
  priority: number  // 执行顺序，数字小的先执行

  /** Agent 首次启动/加载时（一次性初始化） */
  bootstrap?(ctx: BootstrapContext): Promise<void>

  /** 每轮对话前（串行，可修改 ctx） */
  beforeTurn?(ctx: TurnContext): Promise<TurnContext>

  /** 上下文 token 即将超限时（串行，必须减少 token） */
  compact?(ctx: CompactContext): Promise<CompactContext>

  /** 每轮对话后（并行，异步不阻塞响应） */
  afterTurn?(ctx: TurnContext, response: LLMResponse): Promise<void>

  /** Agent 停止/卸载时（清理资源） */
  shutdown?(ctx: ShutdownContext): Promise<void>
}
```

#### 完整插件列表

```typescript
const plugins: ContextPlugin[] = [
  // --- beforeTurn 阶段（串行，按 priority 排序） ---
  new SessionRouterPlugin(),       // priority: 10, 解析 Session Key，确定可见性范围
  new PermissionPlugin(),          // priority: 20, 权限检查
  new ContextAssemblerPlugin(),    // priority: 30, 组装 SOUL.md + USER.md + 历史消息
  new MemoryRecallPlugin(),        // priority: 40, 三阶段记忆检索 + 注入
  new RAGPlugin(),                 // priority: 50, 知识库语义检索 + 文档注入
  new ToolRegistryPlugin(),        // priority: 60, 注入 Skill 目录(XML) + MCP 工具注册

  // --- compact 阶段（token 超限时触发，逆序执行） ---
  // MemoryRecallPlugin.compact:  降级为仅注入 L0 索引
  // ContextAssemblerPlugin.compact:  截断历史消息到最近 N 轮
  // RAGPlugin.compact:  移除低相关度文档

  // --- afterTurn 阶段（并行，异步） ---
  new MemoryExtractPlugin(),       // 记忆提取 pipeline（Stage 1-3）
  new EvolutionPlugin(),           // 进化评分 + 能力图谱更新
  new GapDetectionPlugin(),        // 能力缺口检测 + Skill 推荐
  new HeartbeatPlugin(),           // 检查是否触发周期性行为
]
```

#### ContextEngine 执行流程

```
用户消息
    │
    ▼
┌──────────────────────────────────────────┐
│ 串行执行 beforeTurn（按 priority 排序）     │
│  SessionRouter → Permission → Context    │
│  → MemoryRecall → RAG → ToolRegistry    │
└──────────┬───────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ Token 预算检查                             │
│  estimatedTokens > contextWindow * 0.85?  │
│  └── 是 → 逆序调用 compact                │
│       RAG.compact → Context.compact       │
│       → MemoryRecall.compact              │
│       仍超限 → forceTruncate 硬截断        │
└──────────┬───────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ LLM 调用（通过 PI 嵌入式运行器）           │
└──────────┬───────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ 并行执行 afterTurn（异步，不阻塞响应）      │
│  MemoryExtract ∥ Evolution               │
│  ∥ GapDetection ∥ Heartbeat              │
└──────────────────────────────────────────┘
```

```typescript
class ContextEngine {
  private plugins: ContextPlugin[]

  async process(ctx: TurnContext): Promise<LLMResponse> {
    // 1. 串行执行 beforeTurn
    for (const p of this.plugins.sort((a, b) => a.priority - b.priority)) {
      if (p.beforeTurn) ctx = await p.beforeTurn(ctx)
    }

    // 2. 检查 token 预算
    while (ctx.estimatedTokens > ctx.model.contextWindow * 0.85) {
      // 逆序调用 compact（低优先级插件先压缩）
      for (const p of [...this.plugins].reverse()) {
        if (p.compact) ctx = await p.compact(ctx)
      }
      // 防止死循环
      if (ctx.estimatedTokens > ctx.model.contextWindow * 0.85) {
        ctx = forceTruncate(ctx)  // 兜底：硬截断历史消息
        break
      }
    }

    // 3. 调用 LLM（通过 PI 嵌入式运行器）
    const response = await this.callModel(ctx)

    // 4. 并行执行 afterTurn
    Promise.allSettled(
      this.plugins.map(p => p.afterTurn?.(ctx, response))
    ).catch(err => logger.error('afterTurn error', err))

    return response
  }
}
```

#### PI 嵌入式运行器集成

EvoClaw 使用 PI 的 SDK 嵌入模式（非 CLI、非 RPC），核心入口 `createAgentSession`：

```typescript
import { createAgentSession } from '@mariozechner/pi-coding-agent'

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

  // 订阅事件流 -> 转发到 React UI
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

  // 执行 prompt（PI 内部执行 ReAct 循环）
  await session.prompt(userMessage)
}
```

#### 5 阶段工具注入流水线

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
    │  memory_search   -- 记忆混合搜索（FTS5 + sqlite-vec）
    │  memory_get      -- 指定记忆详情加载（L2 按需）
    │  knowledge_query -- 知识图谱关系查询
    │  evolution_score -- 查看 Agent 成长数据
    │  user_confirm    -- 请求用户确认（弹窗）
    │
阶段 4: Channel 工具（按当前通道动态注入）
    │  feishu_send     -- 飞书发消息
    │  feishu_card     -- 飞书卡片消息
    │  wecom_send      -- 企微发消息
    │  qq_send         -- QQ 发消息
    │  desktop_notify  -- 桌面通知
    │
阶段 5: MCP + 用户 Skill
    │  MCP Server 暴露的工具
    │  ClawHub / GitHub 安装的 Skills
    │  工作区级 Skills（workspace/skills/）
    │
    ▼
Skill 注入方式（遵循 PI 渐进式注入模式）
    · Tier 1: 目录注入 — Skill name + description 以 XML 目录形式追加到 system prompt（~50-100 tokens/skill）
    · Tier 2: 按需加载 — 模型判断相关时，用 Read 工具读取完整 SKILL.md 指令
    · Skill 不注册新工具 — 通过指令引导模型使用已有工具（Read/Bash/Write）
    · allowed-tools 仅做权限预批准，不定义新工具
    │
    ▼
策略过滤
    · 权限检查（Agent 是否被允许使用此工具）
    · Provider 兼容性适配（部分 Provider 不支持某些 tool schema 特性）
    · Schema 标准化
```

### 2.3 领域层 (Domain Layer)

**职责**：核心业务逻辑、领域模型、业务规则

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
│   ├── memory-extension.ts        # PI <-> 记忆系统桥接（扩展钩子）
│   ├── security-extension.ts      # PI <-> Rust 安全层桥接（权限拦截）
│   ├── tool-injector.ts           # 5 阶段工具注入编排
│   └── event-forwarder.ts         # PI 事件流 -> HTTP SSE -> React UI
│
├── provider/
│   ├── provider-registry.ts       # 国内 Provider 注册（Qwen/GLM/Doubao）
│   ├── model-resolver.ts          # Agent 配置 -> 模型选择逻辑
│   └── provider-configs/
│       ├── qwen.ts                # 通义千问配置
│       ├── glm.ts                 # 智谱 GLM 配置
│       ├── doubao.ts              # 豆包配置
│       ├── deepseek.ts            # DeepSeek 配置（PI 原生，补充配置）
│       └── minimax.ts             # MiniMax 配置（PI 原生，补充配置）
│
├── tools/
│   ├── evoclaw-tools.ts           # 阶段 3: EvoClaw 专有工具
│   ├── sandbox-tools.ts           # 阶段 2: 沙箱感知的 bash/文件工具
│   ├── channel-tools.ts           # 阶段 4: Channel 操作工具
│   └── permission-interceptor.ts  # 工具权限拦截器
│
├── skill/
│   ├── skill-discoverer.ts        # Skill 发现（ClawHub API 搜索 + 本地扫描）
│   ├── skill-installer.ts         # Skill 下载 + 安装（ClawHub ZIP + GitHub URL）
│   ├── skill-analyzer.ts          # Skill 静态分析（安全扫描）
│   └── skill-gate.ts              # 门控检查（bins/env/os）
│
├── routing/
│   ├── binding-router.ts          # Binding 路由（最具体匹配优先）
│   └── session-key.ts             # Session Key 生成 + 解析
│
├── scheduler/
│   ├── heartbeat-runner.ts        # Heartbeat 调度器
│   └── cron-runner.ts             # Cron 调度器
│
├── sandbox/
│   ├── docker-manager.ts          # Docker 容器管理
│   └── docker-installer.ts        # Docker 安装引导
│
├── memory/
│   ├── memory-store.ts            # memory_units CRUD
│   ├── knowledge-graph.ts         # knowledge_graph CRUD + 图查询
│   ├── hybrid-searcher.ts         # FTS5 + sqlite-vec 混合搜索
│   ├── extraction-prompt.ts       # 提取 prompt 模板
│   ├── xml-parser.ts              # 提取结果 XML 解析
│   ├── text-sanitizer.ts          # 文本清洗 + 反馈循环防护
│   ├── decay-scheduler.ts         # 衰减 + 归档调度
│   ├── merge-resolver.ts          # merge 型记忆的 upsert 逻辑
│   └── user-md-renderer.ts        # USER.md 动态渲染
│
├── evolution/
│   ├── capability-graph.ts        # 能力图谱
│   ├── growth-tracker.ts          # 成长向量
│   └── feedback-detector.ts       # 满意度信号检测
│
├── channel/
│   ├── adapters/
│   │   ├── desktop.ts
│   │   ├── feishu.ts
│   │   ├── wecom.ts
│   │   └── qq.ts
│   └── message-normalizer.ts
│
├── context/
│   ├── context-engine.ts          # ContextPlugin 引擎（5 钩子调度）
│   ├── plugin.interface.ts        # ContextPlugin 接口定义
│   └── plugins/
│       ├── session-router.ts      # Session Key 路由 + 可见性
│       ├── permission.ts          # 权限检查
│       ├── context-assembler.ts   # SOUL.md + USER.md + 历史消息组装 + LCM 压缩
│       ├── memory-recall.ts       # 三阶段记忆检索
│       ├── rag.ts                 # 知识库检索
│       ├── tool-registry.ts       # Skill 目录注入(XML) + MCP 工具注册
│       ├── memory-extract.ts      # 记忆提取 pipeline
│       ├── evolution.ts           # 进化评分 + 能力图谱
│       ├── gap-detection.ts       # 能力缺口检测
│       └── heartbeat.ts           # 周期性行为
│
├── infrastructure/
│   ├── db/
│   │   ├── sqlite-store.ts
│   │   ├── vector-store.ts
│   │   ├── fts-store.ts
│   │   └── migrations/
│   │       ├── 001_initial.sql
│   │       ├── 002_memory_units.sql
│   │       ├── 003_knowledge_graph.sql
│   │       ├── 004_capability_graph.sql
│   │       ├── 005_conversation_log.sql
│   │       ├── 006_tool_audit_log.sql
│   │       ├── 007_bindings.sql
│   │       └── 008_cron_jobs.sql
│   └── security/
│       ├── keychain.ts
│       └── crypto.ts
│
└── server.ts                      # Hono HTTP 入口
```

### 2.4 基础设施层 (Infrastructure Layer)

EvoClaw 使用双存储策略：

| 存储 | 格式 | 管理方 | 用途 |
|------|------|--------|------|
| SQLite | better-sqlite3 (WAL) | EvoClaw | 记忆、元数据、权限、审计、能力图谱 |
| JSONL | 文件 | PI (pi-coding-agent) | Agent 会话持久化、上下文快照 |
| 文件系统 | Markdown | EvoClaw + PI | Agent 工作区文件（SOUL.md、USER.md 等） |

PI 会话数据存储在 `~/.evoclaw/agents/{id}/sessions/` 目录下的 JSONL 文件中，由 PI 的 SessionManager 管理，EvoClaw 不直接操作。

---

## 3. 核心子系统设计

### 3.1 安全子系统

#### 权限模型设计

```typescript
interface PermissionGrant {
  id: string
  agentId: string
  category: 'filesystem' | 'network' | 'exec' | 'clipboard' | 'notification' | 'keychain' | 'agent-comm'
  scope: 'once' | 'session' | 'always' | 'deny'
  resource?: string        // glob pattern 或正则限定
  grantedAt: number
  expiresAt?: number
  grantedBy: 'user-prompt' | 'user-settings' | 'system-default'
}
```

**权限检查流程**：

```
Agent 请求操作
    │
    ▼
┌─────────────────┐
│ 查询权限缓存     │  <- Node.js 层内存缓存
└────┬────────────┘
     │
     ├── 命中 "always allow" -> 放行
     ├── 命中 "always deny"  -> 拒绝
     ├── 命中 "session"      -> 检查会话有效性 -> 放行/弹窗
     └── 未命中              -> 通过 Tauri IPC 弹窗请求授权
                                    │
                              ┌─────┴─────┐
                              │ 用户决策   │
                              ├── 仅本次   │ -> 放行，不持久化
                              ├── 始终允许 │ -> 放行，持久化
                              ├── 始终拒绝 │ -> 拒绝，持久化
                              └── 取消     │ -> 拒绝
```

#### 凭证管理架构（Rust 实现）

```
┌──────────────────────────────────────────────────┐
│            Credential Vault (Rust Plugin)          │
├──────────────────────────────────────────────────┤
│                                                  │
│  Tauri IPC 接口:                                  │
│  · credential:get(service, account) -> value      │
│  · credential:set(service, account, value)       │
│  · credential:delete(service, account)           │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │ Platform Keychain Adapter (Rust)         │    │
│  │ ┌──────────┐ ┌──────────┐ ┌───────────┐ │    │
│  │ │ macOS    │ │ Windows  │ │ Linux     │ │    │
│  │ │ Keychain │ │ Cred Mgr │ │ Secret    │ │    │
│  │ │ (Security│ │ (WinCred)│ │ Service   │ │    │
│  │ │ Framework)│ │         │ │ (libsecret)│ │    │
│  │ └──────────┘ └──────────┘ └───────────┘ │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  安全保证:                                        │
│  · Rust 内存安全：凭证使用后自动释放              │
│  · 日志自动脱敏 (****)                            │
│  · 仅 Tauri 主进程可调用，Sidecar 通过 IPC 间接访问│
└──────────────────────────────────────────────────┘
```

#### Skill 签名与验证链

Skill 安装遵循 AgentSkills 规范兼容的验证流程：

```
Skill 安装请求
    │
    ▼
┌─────────────────────┐
│ 1. 搜索               │ <- ClawHub API (GET /api/v1/search) / GitHub URL
│    展示匹配结果        │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 2. 下载               │ <- ClawHub ZIP (GET /api/v1/download) / GitHub clone
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 3. 静态分析（可选）    │ <- 扫描危险模式（eval, fetch, fs.write）
│    发现风险 -> 警告    │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 4. 门控检查           │ <- 检查 requires.bins/env/os（AgentSkills 规范）
│    不满足 -> 提示安装  │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 5. 用户确认           │ <- UI 展示 Skill 信息 + 安全评估
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 6. 安装到本地         │ <- 复制到 ~/.evoclaw/skills/
└─────────────────────┘
```

### 3.2 Agent 引擎

#### PI 嵌入式运行器

EvoClaw 采用与 OpenClaw 相同的 PI 嵌入模式：

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

  // 订阅所有事件 -> 转发到调用方
  session.subscribe(onEvent)

  // 执行 prompt（PI 内部执行 ReAct 循环）
  await session.prompt(userMessage)
}
```

#### ReAct 循环流程

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
│ before_agent_start 钩子       │ <- EvoClaw 记忆桥接点
│ · 渲染 USER.md / MEMORY.md   │
│ · 记忆检索 + 注入             │
│ · 权限预检查                  │
└──────────┬───────────────────┘
           │
           ▼
    ┌──────────────┐
    │   LLM 调用    │ <- pi-ai 流式调用
    └──────┬───────┘
           │
           ├── 纯文本响应 -> 结束本轮
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
              │ agent_end 钩子        │ <- EvoClaw 记忆桥接点
              │ · 记忆提取 pipeline    │
              │ · 进化评分             │
              │ · 能力图谱更新         │
              └──────────────────────┘
```

#### Lane 队列并发模型

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

#### Agent 生命周期

```
┌──────────┐    创建引导     ┌──────────┐    激活     ┌──────────┐
│ 不存在   │ ──────────────→ │ 草稿     │ ────────→  │ 活跃     │
└──────────┘                 │ (Draft)  │            │ (Active) │
                             └─────┬────┘            └─────┬────┘
                                   │                       │
                             实时预览/测试           ┌─────┴─────┐
                                   │                │            │
                             ┌─────▼────┐      暂停 │     归档   │
                             │ 测试中   │ <────────  │            │
                             │(Testing) │            ▼            ▼
                             └──────────┘      ┌──────────┐ ┌──────────┐
                                               │ 暂停     │ │ 归档     │
                                               │(Paused)  │ │(Archived)│
                                               └──────────┘ └──────────┘
```

#### SOUL.md 数据模型

SOUL.md 定义 Agent **如何思考和行为**，自然语言编写，兼容 OpenClaw 格式：

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

#### Agent 文件体系

EvoClaw 兼容 OpenClaw 的 8 文件格式：

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

**按场景的文件加载矩阵**：

| 文件 | 私聊首轮 | 私聊后续 | 群聊 | Heartbeat | 子 Agent | Cron |
|------|---------|---------|------|-----------|---------|------|
| SOUL.md | 加载 | 缓存 | 加载 | 不加载(light) | 加载 | 加载 |
| IDENTITY.md | 加载 | 缓存 | 加载 | 不加载 | 加载 | 不加载 |
| AGENTS.md | 加载 | 缓存 | 加载 | 不加载(light) | 不加载 | 不加载 |
| TOOLS.md | 加载 | 缓存 | 不加载 | 不加载 | 加载 | 加载 |
| HEARTBEAT.md | 不加载 | 不加载 | 不加载 | 加载 | 不加载 | 不加载 |
| USER.md | 加载 | 缓存 | 不加载(隐私) | 不加载 | 不加载 | 不加载 |
| MEMORY.md | 加载 | 缓存 | 不加载(隐私) | 不加载 | 不加载 | 不加载 |
| memory/*.md | 加载(今天+昨天) | 不加载 | 不加载 | 不加载 | 不加载 | 不加载 |

**总字符上限**: 20,000 字符（与 OpenClaw 一致），超出时按优先级截断（SOUL.md 不截断，memory/*.md 最先被截断）。

### 3.3 Binding Router

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
1. peerId 精确匹配         -> "这个群/这个人 -> 用这个 Agent"
2. accountId + channel     -> "这个账号的飞书消息 -> 用这个 Agent"
3. channel 匹配            -> "所有企微消息 -> 用这个 Agent"
4. 默认 Agent 兜底         -> "其他消息 -> 用默认 Agent"
```

**Session Key 生成**：

```typescript
function generateSessionKey(
  agentId: string,
  channel: string,
  chatType: 'private' | 'group',
  peerId?: string
): string {
  // 格式: agent:{agentId}:{channel}:{chatType}:{peerId}
  const parts = ['agent', agentId, channel, chatType]
  if (peerId) parts.push(peerId)
  return parts.join(':')
}

// 示例输出:
// "agent:work:feishu:group:group_123"
// "agent:assistant:desktop:private:main"
```

### 3.4 Heartbeat + Cron

#### Heartbeat（心跳检查）

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
- Agent 回复 `HEARTBEAT_OK` -> 无事发生，静默丢弃
- Agent 回复其他内容 -> 有需要关注的事项，发送给用户

#### Cron（定时任务）

在 **隔离会话** 中运行，不共享主会话上下文：

```typescript
interface CronJob {
  id: string
  schedule: string         // cron 表达式，如 "0 9 * * 1-5"
  agentId: string
  prompt: string           // 执行的 prompt
  target?: string          // 结果发送到哪个 Channel
  timeout?: number         // 超时秒数
}
```

| 维度 | Heartbeat | Cron |
|------|-----------|------|
| 执行上下文 | 主会话（共享记忆） | 隔离会话（独立） |
| 触发方式 | 固定间隔 | Cron 表达式（精确时间） |
| 适用场景 | 持续监控、环境检查 | 定时报告、周期任务 |
| 运行 Lane | main | cron |
| 可感知对话历史 | 是 | 否 |

### 3.5 进化引擎 (Evolution Engine)

```
┌──────────────────────────────────────────────────────────────┐
│                     Evolution Engine                          │
│                                                              │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────┐  │
│  │ Memory         │  │ Feedback       │  │ Capability    │  │
│  │ Extraction     │  │ Learning       │  │ Graph         │  │
│  │ Pipeline       │  │ System         │  │               │  │
│  └───────┬────────┘  └───────┬────────┘  └──────┬────────┘  │
│          │                   │                   │           │
│          └───────────────────┼───────────────────┘           │
│                              │                               │
│                    ┌─────────▼─────────┐                     │
│                    │ Evolution Scorer  │                     │
│                    └─────────┬─────────┘                     │
│                              │                               │
│                    ┌─────────▼─────────┐                     │
│                    │ Growth Tracker    │                     │
│                    └──────────────────┘                      │
└──────────────────────────────────────────────────────────────┘
```

```typescript
class EvolutionPlugin implements ContextPlugin {
  async afterTurn(ctx: TurnContext, response: LLMResponse): Promise<void> {
    // 1. 能力图谱更新
    const usedCapabilities = detectCapabilities(ctx, response)
    await this.updateCapabilityGraph(ctx.agentId, usedCapabilities)

    // 2. 响应质量评估（借鉴 MetaClaw 评估机制）
    const quality = evaluateResponseQuality(ctx, response)
    //   - 自动指标：工具调用成功率、重试次数、对话轮次
    //   - 用户反馈：点赞/点踩（异步收集）
    //   - 评估结果写入 capability_graph，驱动进化方向
    await this.recordQualitySignal(ctx.agentId, quality)

    // 3. 成长向量计算
    const growth = await this.computeGrowthVector(ctx.agentId)
    await this.updateGrowthVector(ctx.agentId, growth)
  }
}
```

### 3.6 Skill/MCP 管理系统

EvoClaw 的 Skill 发现和安装对接现有生态平台：

| 平台 | Skills 数量 | 接入方式 | 备注 |
|------|------------|---------|------|
| **ClawHub** (clawhub.ai) | 13,700+ | HTTP API（`/api/v1/search` 向量搜索 + `/api/v1/download` ZIP 下载） | 主搜索源，Convex 后端，无需认证即可搜索和下载 |
| **GitHub URL 直装** | 不限 | `git clone` 或 ZIP 下载 | 兼容 skills.sh 生态（其 Skill 均托管在 GitHub），支持 `owner/repo` 简写格式 |
| **本地工作区** | 用户自定义 | 直接加载 | `~/.evoclaw/skills/` 全局 + 工作区级 |

> **注意**: skills.sh 是 Vercel 维护的 Agent Skills Directory（88,000+ 安装量），但**不提供公开 REST API**，仅有 CLI（`npx skills add/find`）。其 Skill 均托管在 GitHub 仓库，因此通过 GitHub URL 直装方式兼容。

Skill 格式遵循 AgentSkills 规范（由 Anthropic 发起，30+ Agent 产品支持），每个 Skill 是一个目录：

```
skill-daily-report/
├── SKILL.md            # 唯一必需文件 — YAML frontmatter (元数据) + Markdown body (指令)
├── scripts/            # 可选：辅助脚本（通过 Bash 工具执行）
├── references/         # 可选：参考文档
└── assets/             # 可选：资源文件
```

> **注意**: PI 没有独立的 `prompt.md` 文件。SKILL.md 的 Markdown body 本身就是指令内容。

**SKILL.md frontmatter schema**:
```yaml
---
name: pdf-processing          # 必需，1-64 字符，小写 + 连字符
description: >                # 必需，1-1024 字符（无 description 则 Skill 不加载）
  Extract PDF text, fill forms
compatibility: >              # 可选，纯信息性（不做程序化检查）
  Requires git and docker
allowed-tools: Bash(git:*) Read  # 可选，权限预批准（实验性）
disable-model-invocation: true   # 可选，隐藏自动激活目录（仅 /skill:name 可触发）
metadata:
  author: example-org
  version: "1.0"
---
```

**Skill 注入机制**（PI 渐进式两级注入）:
1. **Tier 1 — 目录注入（始终）**: `formatSkillsForPrompt()` 将所有 Skill 的 name + description + location 以 `<available_skills>` XML 块追加到 system prompt（每 Skill ~50-100 tokens）
2. **Tier 2 — 按需加载**: 模型判断某 Skill 与当前任务相关时，用标准 Read 工具读取完整 SKILL.md — 没有专门的 activate_skill 工具

**Skill 扫描路径**（PI 默认，EvoClaw 沿用）:
- 用户级: `~/.evoclaw/skills/`（低优先级）
- Agent 工作区级: `~/.evoclaw/agents/{id}/workspace/skills/`（高优先级，覆盖同名）
- 根目录 `.md` 文件直接作为 Skill，子目录中只识别 `SKILL.md`

**门控**: PI 框架本身 **不实现** `requires.bins/env/os` 的程序化检查（AgentSkills 规范也未定义）。EvoClaw 作为自定义扩展实现门控检查（Sprint 7.1 skill-gate.ts），这是超出 PI 规范的增强功能。

#### Skill 自进化循环（借鉴 MetaClaw MAML 思想）

当 GapDetectionPlugin 检测到 Agent 在同一领域多次失败（3+ 次同类缺口），且现有 Skill 市场无匹配项时，触发 Skill 自生成：

```
多次同类失败 → SkillGapAnalyzer 聚类失败模式
  → LLM 生成 SKILL.md（结构化指令 + 参考案例）
  → 沙箱验证（模拟场景测试通过率 > 60%）
  → 标记 auto-generated，安装到 Agent 工作区
  → 首次实际使用后用户确认（保留 / 删除 / 编辑）
```

自生成的 Skill 在 SKILL.md frontmatter 中标注 `origin: auto-generated`，进化仪表盘单独展示。

### 3.7 Channel 系统

```
┌──────────────────────────────────────────────────┐
│                Channel Manager                    │
│                                                  │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐   │
│  │ 飞书        │ │ 企业微信    │ │ QQ         │   │
│  │ Adapter    │ │ Adapter    │ │ Adapter    │   │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘   │
│        │              │              │           │
│  ┌─────▼──────────────▼──────────────▼─────────┐ │
│  │      消息标准化层 (MessageNormalizer)          │ │
│  │  · 统一消息格式 (text/file/image/card)       │ │
│  │  · 平台特性适配 (飞书卡片/企微模板)          │ │
│  └─────────────────────┬───────────────────────┘ │
│                        │                         │
│                        ▼                         │
│              BindingRouter.route()               │
│              (路由到对应 Agent)                    │
└──────────────────────────────────────────────────┘
```

### 3.8 模型适配层

基于 PI 框架（pi-ai）的多 Provider 支持：

```
┌──────────────────────────────────────────────────┐
│              Model Resolver                       │
│                                                  │
│  路由策略:                                        │
│  ┌────────────────┐                              │
│  │ Agent 指定模型?  │── 是 ──→ 使用指定模型       │
│  └───────┬────────┘                              │
│          │ 否                                    │
│  ┌───────▼────────┐                              │
│  │ 用户全局偏好?   │── 有 ──→ 使用偏好模型       │
│  └───────┬────────┘                              │
│          │ 无                                    │
│          ▼                                       │
│    使用系统默认模型                                │
│    (硬编码 fallback: gpt-4o-mini)                 │
└──────────────────────────────────────────────────┘
```

PI 原生支持 OpenAI / Anthropic / Google / DeepSeek / MiniMax，通过 `registerProvider()` 注册国内 Provider：

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
  compat: { supportsDeveloperRole: false, supportsStrictMode: false }
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
  compat: { supportsDeveloperRole: false }
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
  compat: { supportsDeveloperRole: false, supportsUsageInStreaming: false }
})
```

### 3.9 插件系统 (Plugin System)

EvoClaw 采用 **清单 + 注册** 模式的插件系统，参考 OpenClaw 的架构但不追求完全兼容。

#### 设计原则

| 原则 | 说明 |
|------|------|
| **清单优先** | `evoclaw.plugin.json` 声明元数据，不执行代码即可验证配置、展示 UI |
| **注入式注册** | 插件通过 `register(api)` 将能力注册到中央 PluginRegistry |
| **进程内加载** | 通过 jiti 动态加载 TypeScript，与核心代码同进程 |
| **选择性兼容** | Skills（SKILL.md）与 OpenClaw 完全兼容；Channel/Hook 自建 |

#### 架构分层

```
┌─────────────────────────────────────────────────────────┐
│                    Surface Consumption                   │
│  ContextEngine / ChannelManager / ToolInjector / Routes  │
├─────────────────────────────────────────────────────────┤
│                    PluginRegistry                        │
│  tools[] / channels[] / providers[] / hooks[] /          │
│  services[] / commands[] / skills[]                      │
├─────────────────────────────────────────────────────────┤
│                    Runtime Loading                        │
│  jiti 加载 → register(api) → 注册到 Registry             │
├─────────────────────────────────────────────────────────┤
│                Enablement + Validation                    │
│  JSON Schema 验证配置（不执行插件代码）                     │
├─────────────────────────────────────────────────────────┤
│                Manifest + Discovery                       │
│  扫描 evoclaw.plugin.json + package.json                  │
└─────────────────────────────────────────────────────────┘
```

#### 插件清单 `evoclaw.plugin.json`

```json
{
  "id": "feishu",
  "name": "飞书",
  "version": "1.0.0",
  "channels": ["feishu"],
  "skills": ["./skills"],
  "configSchema": {
    "type": "object",
    "properties": {
      "appId": { "type": "string" },
      "appSecret": { "type": "string" }
    },
    "required": ["appId", "appSecret"]
  },
  "uiHints": {
    "appId": { "label": "App ID" },
    "appSecret": { "label": "App Secret", "sensitive": true }
  }
}
```

#### `package.json` 扩展字段

```json
{
  "name": "@evoclaw/plugin-feishu",
  "evoclaw": {
    "extensions": ["./index.ts"],
    "channel": {
      "id": "feishu",
      "label": "飞书/Lark",
      "blurb": "飞书企业消息 + 文档/表格/日历工具"
    }
  }
}
```

#### 插件注册 API

```typescript
interface EvoClawPluginApi {
  // 注册 Channel 适配器
  registerChannel(adapter: ChannelAdapter): void;
  // 注册 Agent 工具
  registerTool(tool: ToolDefinition): void;
  // 注册 ContextPlugin 钩子
  registerHook(name: string, handler: HookHandler): void;
  // 注册 LLM Provider
  registerProvider(provider: ProviderEntry): void;
  // 注册 HTTP 路由（webhook 等）
  registerHttpRoute(route: HttpRouteParams): void;
  // 注册后台服务
  registerService(service: PluginService): void;
  // 注册 Skill 目录
  registerSkills(dir: string): void;
  // 插件配置
  config: Record<string, unknown>;
}
```

#### 插件入口模式

```typescript
// plugins/feishu/index.ts
import type { EvoClawPluginApi } from '@evoclaw/plugin-sdk';

export default {
  id: 'feishu',
  name: '飞书',
  register(api: EvoClawPluginApi) {
    api.registerChannel(feishuAdapter);
    api.registerTool(feishuDocTool);
    api.registerTool(feishuCalendarTool);
    api.registerSkills('./skills');
  },
};
```

#### PluginRegistry 数据结构

```typescript
interface PluginRegistry {
  plugins: PluginRecord[];                // 插件元信息
  tools: PluginToolRegistration[];        // 工具
  hooks: PluginHookRegistration[];        // 钩子
  channels: PluginChannelRegistration[];  // 渠道
  providers: PluginProviderRegistration[];// LLM Provider
  httpRoutes: PluginHttpRouteRegistration[]; // HTTP 路由
  services: PluginServiceRegistration[];     // 后台服务
  diagnostics: PluginDiagnostic[];           // 诊断信息
}
```

#### 插件发现路径

| 路径 | 来源 | 优先级 |
|------|------|--------|
| `~/.evoclaw/plugins/` | 全局安装 | 低 |
| 工作区 `plugins/` | 工作区本地 | 中 |
| `packages/plugins/` | 内置 bundled | 高（可被同名覆盖） |

#### 与 OpenClaw 生态的兼容策略

| 维度 | 策略 |
|------|------|
| **Skills (SKILL.md)** | 完全兼容，直接复用 OpenClaw 生态的 13,700+ Skills |
| **工具业务逻辑** | 可移植，飞书文档/表格等 API 调用代码可复用 |
| **npm 依赖** | 共享，@larksuiteoapi/node-sdk 等底层 SDK 通用 |
| **Channel 插件** | 不兼容，EvoClaw 基于自有 ChannelAdapter 接口自建 |
| **plugin-sdk 导入** | 不兼容，EvoClaw 提供自己的 `@evoclaw/plugin-sdk` |
| **Hook 体系** | 不兼容，事件名和上下文结构不同 |
| **Gateway 架构** | 不兼容，EvoClaw 是 Sidecar 模式 |

> **设计决策**: 完全兼容 OpenClaw 插件需重实现其 Gateway 层，成本远高于自建。选择性复用 Skills + 工具逻辑可获取 ~60% 生态价值，仅付出 ~20% 兼容成本。

---

## 4. 记忆架构 (Memory Architecture)

> 本章节完整基于 MemorySystemDesign.md 设计，借鉴 MemOS / OpenViking / claude-mem 三个 OpenClaw 生态插件的核心机制，在 better-sqlite3 单引擎上自主实现。

### 4.1 三表协同架构

三张表各司其职，查询模式不冲突：

| 表 | 职责 | 查询特点 |
|---|------|---------|
| `memory_units` | 提炼后的结构化知识 | 查询频繁，需要快 |
| `knowledge_graph` | 实体间关系网络 | 需要图查询 |
| `conversation_log` | 原始对话数据 | 只增不改，用于审计追溯和二次提取 |

### 4.2 L0/L1/L2 三层存储模型

每条记忆同时包含三个层级，写入时由一次 LLM 调用同时生成：

| 层 | 内容 | Token 量 | 用途 |
|---|------|---------|------|
| L0 | 一句话索引摘要 | ~50-100 tokens | 向量检索键，宽检索阶段使用 |
| L1 | 结构化 Markdown 概览 | ~500-2K tokens | 精筛阶段使用，注入上下文 |
| L2 | 完整内容 | 全文 | 按需深加载，追问时使用 |

### 4.3 9 类记忆分类体系

```typescript
// 分类与 merge/independent 策略
type Category =
  | 'profile'       // 用户基本信息（merge）
  | 'preference'    // 偏好设定（merge）
  | 'entity'        // 实体知识：人物/组织/项目（merge）
  | 'event'         // 事件/情景记忆（independent）
  | 'case'          // Agent 处理过的案例（independent）
  | 'pattern'       // 可复用的流程模板（merge）
  | 'tool'          // 工具使用经验（merge）
  | 'skill'         // 技能/能力沉淀（merge）
  | 'correction'    // 用户纠正记录（merge，高优先级）
```

**merge 型**：同 `merge_key` 会更新已有记忆（L1/L2 更新，L0 不变以保持向量索引稳定）。

**independent 型**：每条独立存储，不做去重合并。

### 4.4 记忆提取 Pipeline（3 阶段）

```
对话结束（afterTurn / agent_end 钩子）
    │
    ▼
┌─────────────────────────────────────┐
│ Stage 1: 预处理（纯逻辑，不调 LLM）    │
│ · 剥离注入的记忆上下文（反馈循环防护）  │
│ · 过滤无信息量的消息（命令、问候等）     │
│ · 截断超长工具输出（<=1000 字符）       │
│ · CJK 感知的最小长度检查               │
└─────────┬───────────────────────────┘
          │ 有效内容
          ▼
┌─────────────────────────────────────┐
│ Stage 2: 记忆提取（一次 LLM 调用）     │
│ · 输入：预处理后的对话文本              │
│ · 输出：结构化 XML，每条含              │
│   category + merge_key + L0/L1/L2    │
│ · 同时输出关系三元组                    │
│   (subject, predicate, object)       │
└─────────┬───────────────────────────┘
          │ ParsedMemory[]
          ▼
┌─────────────────────────────────────┐
│ Stage 3: 持久化（纯逻辑，不调 LLM）    │
│ · merge 型：查 merge_key，存在则更新   │
│   L1/L2，L0 不变（保持向量索引稳定）   │
│ · independent 型：直接 INSERT          │
│ · 关系三元组写入 knowledge_graph       │
│ · 标注 generation 元数据（MAML 风格）   │
│   conversation_id + model_id + 时间戳  │
│ · 标记已处理的 conversation_log 行     │
│ · 异步生成 L0 embedding 写入向量表     │
└─────────────────────────────────────┘
```

### 4.5 三阶段渐进检索

```
用户消息
    │
    ▼
┌──────────────────────────────────────────┐
│ Phase 0: 查询理解（纯逻辑，不调 LLM）      │
│ · 关键词提取                               │
│ · 时间表达式识别（"上周讨论的"->日期范围）   │
│ · 查询类型判断：事实型/偏好型/事件型/技能型  │
└──────────┬───────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ Phase 1: L0 宽检索（~50ms）                │
│ · FTS5 关键词搜索 l0_index（权重 0.3）     │
│ · sqlite-vec 向量搜索 L0 embedding（0.5）  │
│ · knowledge_graph 关系扩展（0.2）           │
│ · 返回 Top-30 候选 { id, l0, category,     │
│   activation, score }                      │
└──────────┬───────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ Phase 2: 排序 + L1 精筛                    │
│ · finalScore = searchScore                 │
│   * hotness(activation, access, age)       │
│   * categoryBoost(queryType, category)     │
│   * correctionBoost (correction 类 +0.15)  │
│ · 去重：同 merge_key 只保留最新             │
│ · 可见性过滤（private/shared/channel_only） │
│ · 取 Top-10，加载 L1 overview               │
│ · 按 category 分组格式化                    │
└──────────┬───────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ Phase 3: L2 按需深加载                     │
│ · 触发条件（任一满足）：                     │
│   a) 用户消息含追问信号                      │
│      （"详细说说/具体是什么/当时怎么..."）    │
│   b) L1 中包含 "[详情已省略]" 标记           │
│   c) category=case 且 queryType=技能型      │
│      （需要完整案例作为 few-shot）            │
│ · 仅加载触发条件匹配的记忆的 L2              │
│ · Token 预算控制：L2 总量 <= 8K tokens       │
└──────────┬───────────────────────────────┘
           │
           ▼
  组装注入上下文
```

### 4.6 Hotness 衰减公式

```typescript
function hotness(accessCount: number, lastAccessAt: number, now: number): number {
  const ageDays = (now - (lastAccessAt || now)) / 86400000
  const freq = sigmoid(Math.log1p(accessCount))
  const recency = Math.exp(-0.099 * ageDays)  // 半衰期 7 天
  return Math.max(0.01, freq * recency)  // 最低 0.01，不归零
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}
```

### 4.7 反馈循环防护

使用零宽空格标记注入的记忆/RAG 上下文，提取时剥离：

```typescript
const MARKERS = {
  memoryStart: '\u200b\u200b[EVOCLAW_MEM_START]\u200b\u200b',
  memoryEnd:   '\u200b\u200b[EVOCLAW_MEM_END]\u200b\u200b',
  ragStart:    '\u200b\u200b[EVOCLAW_RAG_START]\u200b\u200b',
  ragEnd:      '\u200b\u200b[EVOCLAW_RAG_END]\u200b\u200b',
} as const
```

文本清洗（存储前）：剥离注入的记忆/RAG 上下文、剥离元数据 JSON 块、过滤命令消息、CJK 感知的最小长度检查（中文 4 字符、英文 10 字符）、截断超长内容（24000 字符上限）。

### 4.8 PI 扩展钩子桥接

EvoClaw 的记忆系统通过 PI 的扩展钩子与 Agent 运行时集成：

```typescript
function evoClawMemoryExtension(api: ExtensionAPI): void {
  // === before_agent_start: 记忆注入 ===
  api.on('before_agent_start', async (event, ctx) => {
    // 1. 渲染 USER.md（从 memory_units 动态生成）
    const userMd = await renderUserMd(ctx.agentId)
    await writeFile(join(ctx.workspace, 'USER.md'), userMd)

    // 2. 渲染 MEMORY.md（从 memory_units 高 activation 记忆生成）
    const memoryMd = await renderMemoryMd(ctx.agentId)
    await writeFile(join(ctx.workspace, 'MEMORY.md'), memoryMd)

    // 3. 三阶段记忆检索 -> 注入到上下文
    if (event.prompt) {
      const memories = await recallMemories(event.prompt, ctx.agentId, ctx.sessionKey)
      if (memories) return { prependContext: wrapMemoryContext(memories) }
    }
  })

  // === agent_end: 记忆提取 ===
  api.on('agent_end', async (event, ctx) => {
    if (!event.success || !event.messages?.length) return
    const sanitized = sanitizeForExtraction(event.messages)
    if (!sanitized) return
    const extracted = await extractMemories(sanitized, ctx.agentId)
    await persistMemories(extracted, ctx.agentId)
    await updateEvolution(ctx.agentId, event.messages)
  })

  // === tool_result_persist: 工具执行记录 ===
  api.on('tool_result_persist', async (event, ctx) => {
    if (!event.toolName || event.toolName.startsWith('memory_')) return
    await logToolExecution({
      agentId: ctx.agentId,
      sessionKey: ctx.sessionKey,
      toolName: event.toolName,
      params: event.params,
      result: truncate(event.result, 1000),
    })
  })

  // === session_before_compact: 压缩前记忆保存 ===
  api.on('session_before_compact', async (event, ctx) => {
    const pendingMessages = await getPendingMessages(ctx.agentId, ctx.sessionKey)
    if (pendingMessages.length > 0) {
      const extracted = await extractMemories(pendingMessages, ctx.agentId)
      await persistMemories(extracted, ctx.agentId)
    }
  })
}
```

### 4.9 USER.md / MEMORY.md 动态渲染

USER.md 不手写，而是从数据库渲染。长期记忆全在 SQLite 的 `memory_units` 表中，.md 文件仅作为人类可读的快照：

```typescript
async function renderUserMd(agentId: string): Promise<string> {
  // profile 类：基本信息
  const profiles = await db.all(`
    SELECT l1_overview FROM memory_units
    WHERE agent_id = ? AND category = 'profile' AND archived_at IS NULL
    ORDER BY updated_at DESC
  `, agentId)

  // preference 类：偏好设定（activation > 0.3）
  const prefs = await db.all(`
    SELECT l1_overview FROM memory_units
    WHERE agent_id = ? AND category = 'preference' AND archived_at IS NULL
      AND activation > 0.3
    ORDER BY activation DESC LIMIT 30
  `, agentId)

  // correction 类：纠正记录（高优先级，全部加载）
  const corrections = await db.all(`
    SELECT l1_overview FROM memory_units
    WHERE agent_id = ? AND category = 'correction' AND archived_at IS NULL
    ORDER BY updated_at DESC
  `, agentId)

  // 关系网络：从 knowledge_graph 提取
  const relations = await db.all(`
    SELECT m1.l0_index as subject, kg.predicate,
           COALESCE(m2.l0_index, kg.object_literal) as object
    FROM knowledge_graph kg
    JOIN memory_units m1 ON kg.subject_id = m1.id
    LEFT JOIN memory_units m2 ON kg.object_id = m2.id
    WHERE kg.agent_id = ?
    ORDER BY kg.updated_at DESC LIMIT 20
  `, agentId)

  return formatUserMd(profiles, prefs, corrections, relations)
}
```

**渲染时机**: Agent bootstrap 阶段（`before_agent_start` 钩子）。

### 4.10 DecayScheduler

每小时执行一次，更新所有非钉选、非归档记忆的 activation 值：

```typescript
class DecayScheduler {
  async tick(): Promise<void> {
    const now = Date.now()

    // 1. 批量计算 hotness 并更新 activation
    const memories = await this.db.all(`
      SELECT id, access_count, last_access_at, activation
      FROM memory_units
      WHERE pinned = 0 AND archived_at IS NULL
    `)
    for (const mem of memories) {
      const newActivation = hotness(mem.access_count, mem.last_access_at, now)
      if (Math.abs(newActivation - mem.activation) > 0.01) {
        await this.db.update('memory_units', mem.id, {
          activation: newActivation, updated_at: now
        })
      }
    }

    // 2. 归档冷记忆（activation < 0.1 且 30 天未访问）
    const thirtyDaysAgo = now - 30 * 86400000
    await this.db.run(`
      UPDATE memory_units SET archived_at = ?
      WHERE pinned = 0 AND archived_at IS NULL
        AND activation < 0.1 AND last_access_at < ?
    `, now, thirtyDaysAgo)
  }
}
```

### 4.11 EvoClaw 专有工具

注册到 PI 工具系统的记忆工具（阶段 3）：

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
    return { content: [{ type: 'text', text: formatSearchResults(results) }] }
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
    return { content: [{ type: 'text', text: formatMemoryDetails(details) }] }
  },
}

const knowledgeQueryTool: AgentTool = {
  name: 'knowledge_query',
  description: '查询知识图谱中的实体关系',
  parameters: Type.Object({
    entity: Type.String({ description: '实体名称' }),
    predicate: Type.Optional(Type.String({ description: '关系类型' })),
    direction: Type.Optional(Type.String({
      description: '查询方向：outgoing / incoming / both',
      default: 'both'
    })),
  }),
  execute: async (toolCallId, params) => {
    const relations = await queryKnowledgeGraph(
      agentId, params.entity, params.predicate, params.direction
    )
    return { content: [{ type: 'text', text: formatRelations(relations) }] }
  },
}
```

### 4.12 记忆安全隔离矩阵

| 记忆类型 | 桌面私聊 | Channel 私聊 | Channel 群聊 |
|---|---|---|---|
| SOUL.md | 加载 | 加载 | 加载 |
| USER.md (memory_units 渲染) | 加载 | 加载 | **不加载** |
| MEMORY.md (memory_units 渲染) | 加载 | 加载 | **不加载** |
| memory_units 检索 | 完整检索 | 完整检索 | 仅 shared 可见性 |
| knowledge_graph | 可用 | 可用 | 受限范围 |

**设计原则**：群聊场景下，Agent 不应暴露用户的私密偏好和个人记忆，仅展示公共身份和知识。

---

## 5. 数据架构

### 5.1 数据库 Schema

```sql
-- ==========================================
-- 记忆系统（三表协同）
-- ==========================================

CREATE TABLE memory_units (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,

  -- L0/L1/L2 三层（写入时由一次 LLM 调用同时生成）
  l0_index        TEXT NOT NULL,    -- ~50-100 tokens，一句话摘要，向量检索键
  l1_overview     TEXT NOT NULL,    -- ~500-2K tokens，结构化 Markdown
  l2_content      TEXT NOT NULL,    -- 完整内容，按需加载

  -- 分类体系（9 类）
  category        TEXT NOT NULL CHECK(category IN (
    'profile', 'preference', 'entity', 'event', 'case',
    'pattern', 'tool', 'skill', 'correction'
  )),
  merge_type      TEXT NOT NULL CHECK(merge_type IN ('merge', 'independent')),
  merge_key       TEXT,             -- merge 型的去重键（L0 标准化后）

  -- 双域作用域
  scope           TEXT NOT NULL CHECK(scope IN ('user', 'agent')),

  -- 可见性控制
  visibility      TEXT NOT NULL DEFAULT 'private'
    CHECK(visibility IN ('private', 'shared', 'channel_only')),
  visibility_channels TEXT,         -- JSON 数组，指定可见通道列表

  -- 衰减指标（hotness 公式）
  activation      REAL NOT NULL DEFAULT 1.0,
  access_count    INTEGER NOT NULL DEFAULT 0,
  last_access_at  INTEGER,
  pinned          INTEGER NOT NULL DEFAULT 0,  -- 用户钉选，免于衰减

  -- 来源追溯
  source_session_key  TEXT,
  source_message_ids  TEXT,         -- JSON 数组
  confidence          REAL NOT NULL DEFAULT 1.0,

  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  archived_at     INTEGER           -- 归档时间（冷记忆不删除，仅归档）
);

CREATE INDEX idx_memory_units_agent ON memory_units(agent_id);
CREATE INDEX idx_memory_units_category ON memory_units(agent_id, category);
CREATE INDEX idx_memory_units_merge ON memory_units(agent_id, merge_key) WHERE merge_key IS NOT NULL;
CREATE INDEX idx_memory_units_activation ON memory_units(agent_id, activation) WHERE archived_at IS NULL;

CREATE TABLE knowledge_graph (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  subject_id      TEXT NOT NULL,    -- 指向 memory_units.id（entity 类型）
  predicate       TEXT NOT NULL,    -- 关系类型：works_at, knows, uses, prefers...
  object_id       TEXT,             -- 指向另一个 memory_units.id（可选）
  object_literal  TEXT,             -- 或者是字面值（如 "Python 3.12"）
  confidence      REAL NOT NULL DEFAULT 1.0,
  source_memory_id TEXT,            -- 从哪条记忆提取出的关系
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_kg_subject ON knowledge_graph(subject_id);
CREATE INDEX idx_kg_object ON knowledge_graph(object_id) WHERE object_id IS NOT NULL;
CREATE INDEX idx_kg_agent ON knowledge_graph(agent_id);

CREATE TABLE conversation_log (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  session_key     TEXT NOT NULL,
  role            TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
  content         TEXT NOT NULL,
  tool_name       TEXT,
  tool_input      TEXT,
  tool_output     TEXT,
  compaction_status TEXT NOT NULL DEFAULT 'raw'
    CHECK(compaction_status IN ('raw', 'extracted', 'compacted')),
  compaction_ref    TEXT,           -- 指向生成的 memory_units.id
  token_count     INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_convlog_session ON conversation_log(agent_id, session_key, created_at);
CREATE INDEX idx_convlog_compaction ON conversation_log(compaction_status) WHERE compaction_status = 'raw';

-- ==========================================
-- 双索引
-- ==========================================

-- FTS5 全文索引（搜 L0 + L1）
CREATE VIRTUAL TABLE memory_fts USING fts5(
  l0_index, l1_overview,
  content=memory_units, content_rowid=rowid,
  tokenize='unicode61'
);

-- sqlite-vec 向量索引（L0 embedding，1024 维）
-- CREATE VIRTUAL TABLE memory_vec USING vec0(embedding float[1024]);

-- ==========================================
-- 进化引擎
-- ==========================================

CREATE TABLE capability_graph (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  capability  TEXT NOT NULL,     -- 'coding', 'translation', 'analysis'...
  level       REAL NOT NULL DEFAULT 0.0,  -- 0.0-1.0 熟练度
  use_count   INTEGER NOT NULL DEFAULT 0,
  success_rate REAL NOT NULL DEFAULT 0.0,
  last_used_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(agent_id, capability)
);

-- ==========================================
-- 工具审计
-- ==========================================

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

-- ==========================================
-- Agent 管理
-- ==========================================

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  soul_content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ==========================================
-- 路由与调度
-- ==========================================

CREATE TABLE bindings (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  channel TEXT,              -- 'desktop' | 'feishu' | 'wecom' | 'qq'
  account_id TEXT,
  peer_id TEXT,
  chat_type TEXT,            -- 'private' | 'group'
  priority INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE cron_jobs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  schedule TEXT NOT NULL,     -- cron 表达式
  prompt TEXT NOT NULL,
  target TEXT,               -- 结果发送目标 Channel
  timeout INTEGER DEFAULT 600,
  enabled INTEGER DEFAULT 1,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- ==========================================
-- 安全
-- ==========================================

CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  category TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT,
  granted_by TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  expires_at INTEGER
);

-- ==========================================
-- 模型配置
-- ==========================================

CREATE TABLE model_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  config TEXT,
  is_default INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

### 5.2 存储分布说明

| 数据 | 存储位置 | 说明 |
|------|---------|------|
| 记忆/元数据/权限/审计 | SQLite (`evoclaw.db`) | EvoClaw 管理 |
| PI 会话数据 | JSONL 文件 (`~/.evoclaw/agents/{id}/sessions/`) | PI SessionManager 管理，EvoClaw 不直接操作 |
| Agent 工作区文件 | Markdown 文件 (`~/.evoclaw/agents/{id}/workspace/`) | EvoClaw 渲染 + PI bootstrap 读取 |

### 5.3 文件系统布局

```
~/.evoclaw/                             # 应用根目录
├── config.json                         # 全局配置（加密）
├── evoclaw.db                          # SQLite 主数据库（AES-256-GCM 加密）
├── agents/
│   └── {agent-id}/
│       ├── workspace/                  # Agent 工作区
│       │   ├── SOUL.md                 # 行为哲学
│       │   ├── IDENTITY.md             # 外在展示
│       │   ├── AGENTS.md               # 操作规程
│       │   ├── TOOLS.md                # 工具文档
│       │   ├── HEARTBEAT.md            # 周期性行为
│       │   ├── USER.md                 # 用户画像（动态渲染）
│       │   ├── MEMORY.md               # 记忆快照（动态渲染）
│       │   ├── memory/                 # 每日日志
│       │   └── skills/                 # 工作区级 Skills
│       ├── sessions/                   # JSONL 会话（PI 管理）
│       └── agent/                      # Agent 状态（PI 管理）
├── skills/                             # 全局安装的 Skills
├── logs/                               # 加密日志
└── cache/
    └── embeddings/
```

### 5.4 数据迁移策略

```typescript
// 版本号递增迁移
// packages/core/src/infrastructure/db/migrations/
// 001_initial.sql            -- agents + permissions + model_configs
// 002_memory_units.sql       -- 记忆主表
// 003_knowledge_graph.sql    -- 知识图谱
// 004_capability_graph.sql   -- 能力图谱
// 005_conversation_log.sql   -- 对话日志
// 006_tool_audit_log.sql     -- 工具审计
// 007_bindings.sql           -- 路由绑定
// 008_cron_jobs.sql          -- 定时任务

class MigrationRunner {
  async run() {
    const current = await this.getCurrentVersion()
    const pending = this.migrations.filter(m => m.version > current)
    for (const m of pending) {
      await this.db.exec(m.up)
      await this.setVersion(m.version)
    }
  }
}
```

---

## 6. Monorepo 工程结构

### 6.1 包划分方案

```
evoclaw/
├── package.json                    # pnpm workspace 根配置
├── pnpm-workspace.yaml
├── turbo.json                      # Turborepo 构建配置
├── apps/
│   └── desktop/                    # Tauri 桌面应用
│       ├── src-tauri/              # Rust 后端
│       │   ├── Cargo.toml
│       │   ├── src/
│       │   │   ├── main.rs
│       │   │   ├── commands/       # Tauri IPC Commands
│       │   │   └── plugins/        # Tauri Plugins (Rust)
│       │   │       ├── keychain.rs
│       │   │       ├── crypto.rs
│       │   │       └── sandbox.rs
│       │   └── tauri.conf.json
│       ├── src/                    # React 前端
│       │   ├── app/
│       │   ├── components/
│       │   ├── hooks/
│       │   ├── stores/
│       │   └── lib/
│       └── package.json
├── packages/
│   ├── core/                       # 核心引擎 (TypeScript, Node.js Sidecar)
│   │   ├── src/
│   │   │   ├── agent/              # PI 嵌入式运行器 + Agent 管理
│   │   │   ├── bridge/             # PI <-> EvoClaw 桥接层
│   │   │   ├── provider/           # 国内 Provider 注册
│   │   │   ├── tools/              # 工具系统（5 阶段注入）
│   │   │   ├── skill/              # Skill 发现/安装/分析/门控
│   │   │   ├── routing/            # Binding 路由 + Session Key
│   │   │   ├── scheduler/          # Heartbeat + Cron
│   │   │   ├── sandbox/            # Docker 沙箱管理
│   │   │   ├── memory/             # 记忆系统
│   │   │   ├── evolution/          # 进化引擎
│   │   │   ├── channel/            # Channel 适配器
│   │   │   ├── context/            # ContextPlugin 引擎
│   │   │   ├── infrastructure/     # DB / Security
│   │   │   └── server.ts           # HTTP 服务入口 (Hono)
│   │   └── package.json
│   └── shared/                     # 共享 TypeScript 类型
│       ├── src/
│       │   ├── types/
│       │   ├── utils/
│       │   └── constants/
│       └── package.json
└── docs/
    ├── Architecture.md             # 本文档
    ├── PRD.md
    ├── IterationPlan.md
    ├── MemorySystemDesign.md
    └── AgentSystemDesign.md
```

### 6.2 包依赖关系图

```
apps/desktop
  ├── packages/core          (Node.js Sidecar)
  └── packages/shared        (共享类型)

packages/core
  ├── packages/shared
  ├── @mariozechner/pi-ai
  ├── @mariozechner/pi-agent-core
  ├── @mariozechner/pi-coding-agent
  ├── better-sqlite3
  └── hono
```

### 6.3 构建与发布流程

```
开发:
  pnpm dev              -> Tauri dev (热重载前端 + Sidecar)
  pnpm dev:core         -> 仅核心引擎开发
  pnpm test             -> Vitest 全量测试
  pnpm lint             -> Oxlint 检查

构建:
  pnpm build            -> 全量构建
  pnpm build:desktop    -> Tauri 桌面应用构建

发布:
  pnpm release:mac      -> macOS DMG/App (Universal)
  pnpm release:win      -> Windows MSI/NSIS
  pnpm release:linux    -> AppImage/deb/rpm
```

---

## 7. 安全架构

### 7.1 威胁模型（基于 OpenClaw 已知漏洞的防御）

| OpenClaw 漏洞 | 威胁描述 | EvoClaw 防御方案 |
|---------------|----------|------------------|
| **ClawJacked (WebSocket 劫持)** | 恶意网站劫持本地 Agent | 不对外暴露 WebSocket；Sidecar 仅监听 localhost，Tauri 进程管理 |
| **明文凭证存储** | API Key 明文存储 | Rust Plugin 通过系统 Keychain 存储，内存中使用后清零 |
| **ClawHub 恶意 Skill** | 20% 恶意 Skill | 静态分析 + AgentSkills 规范门控 + 用户确认 |
| **认证绕过 (93.4%)** | 外部未认证访问 | Sidecar 仅绑定 127.0.0.1 + 随机端口 + 启动 Token 认证 |
| **公开暴露 (3万+)** | 被互联网发现和攻击 | 无公网监听端口；Channel 消息通过平台 SDK 推送 |
| **记忆泄露** | 群聊场景暴露个人记忆 | 记忆安全隔离矩阵（见第 4.12 节） |

### 7.2 Docker 沙箱（可选）

三级安全模式：

| 模式 | 配置 | 适用场景 |
|------|------|---------|
| **无沙箱（默认）** | `sandbox.mode: "off"` | 用户信任 Agent，追求零配置 |
| **选择性沙箱** | `sandbox.mode: "selective"` | 仅对 bash/exec 工具启用沙箱 |
| **全沙箱** | `sandbox.mode: "all"` | 所有文件操作和命令执行都在容器内 |

首次启用沙箱时的安装引导：

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

沙箱配置：

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

### 7.3 数据流安全分析

```
┌─────────────────────────────────────────────────────────────┐
│                       数据流安全                              │
│                                                             │
│  用户输入 --> UI (WebView) --> HTTP --> Node.js Sidecar      │
│                                  │  (localhost + token)     │
│                       ┌──────────┼──────────┐               │
│                       │          │          │                │
│                       ▼          ▼          ▼                │
│                 ┌──────────┐ ┌───────┐ ┌──────────┐         │
│                 │ SQLite   │ │ PI    │ │ Channel  │         │
│                 │ (加密)   │ │ (LLM) │ │ 平台 API │         │
│                 └──────────┘ └───┬───┘ └────┬─────┘         │
│                                  │          │               │
│                         ┌────────▼──────────▼────────┐      │
│                         │ 出站流量（仅两类）:          │      │
│                         │ 1. LLM API (TLS 1.3)       │      │
│                         │    · 仅发送对话内容         │      │
│                         │    · 不发送凭证/记忆原文    │      │
│                         │ 2. Channel 平台 API         │      │
│                         │    · 发送 Agent 回复        │      │
│                         │    · 使用平台官方 SDK       │      │
│                         └────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 7.4 Sidecar 安全策略

```
Tauri 启动时:
  1. 生成随机端口 (49152-65535)
  2. 生成一次性启动 Token (256-bit)
  3. 启动 Node.js Sidecar，传入端口和 Token
  4. Sidecar 绑定 127.0.0.1:${port}
  5. 所有 HTTP 请求须携带 Authorization: Bearer ${token}
  6. Tauri 退出时自动 kill Sidecar 进程

保证:
  · 外部进程无法猜测端口和 Token
  · 仅 Tauri 主进程知道连接信息
  · 进程生命周期完全由 Tauri 管理
```

---

## 8. 性能与可扩展性

### 8.1 性能目标与瓶颈分析

| 操作 | 目标 | 潜在瓶颈 | 优化策略 |
|------|------|----------|----------|
| 应用启动 | <3s 冷 / <1s 热 | Sidecar 启动 + SQLite 连接 | Sidecar 预编译；延迟初始化非核心模块 |
| 对话首 Token | <2s | 上下文组装 + ContextPlugin 链 | 记忆预加载；无依赖插件并行化 |
| L0 宽检索 | ~50ms | FTS5 + sqlite-vec 并行查询 | 索引预热；查询结果缓存 |
| L1 精筛 | ~20ms | 排序 + L1 加载 | 内存缓存热记忆 L1 |
| L2 按需加载 | ~10ms | 单次 SQLite 查询 | Token 预算 <= 8K 控制 |
| PI auto-compaction | <3s | LLM 摘要调用 | 使用低成本模型 |
| 记忆提取 | 后台 <5s | LLM 调用 | afterTurn 异步，不阻塞响应 |
| Channel 消息 | <1s 接收处理 | SDK 长轮询/WebSocket | 独立线程处理 Channel 消息 |
| Skill 安装 | <30s | 下载 + 分析 + 门控 | 并行执行验证步骤 |
| Hotness 衰减 | 后台 <2s | 批量 UPDATE | 每小时执行；SQLite WAL 模式 |

### 8.2 缓存策略

```
L1: 内存缓存 (Node.js 进程内)
  · 活跃 Agent SOUL 解析结果
  · 权限判定缓存
  · 热记忆 L1 概览缓存
  · Session Key -> 会话映射
  TTL: 会话级

L2: SQLite 缓存
  · 嵌入向量缓存
  · Skill 搜索结果缓存
  TTL: 24 小时

L3: 文件系统缓存
  · 文档解析缓存
  · Daily Log 预加载
  TTL: 7 天
```

### 8.3 异步处理

```typescript
// 不阻塞用户交互的后台任务
const backgroundTasks = {
  // 对话完成后（afterTurn 插件并行触发）
  afterTurn: [
    'memoryExtraction',         // 记忆提取 pipeline（MemoryExtractPlugin）
    'capabilityUpdate',         // 能力图谱更新（EvolutionPlugin）
    'gapDetection',             // 能力缺口检测（GapDetectionPlugin）
    'heartbeatCheck',           // 周期性行为检查（HeartbeatPlugin）
  ],

  // 定时任务
  scheduled: [
    { task: 'decayScheduler', interval: '1h' },          // 每小时衰减
    { task: 'archiveColdMemories', interval: '1h' },     // 归档冷记忆
  ],
}
```

---

## 9. 部署架构

### 9.1 一体化桌面应用

```
用户双击 EvoClaw.app
    │
    ▼
┌──────────────────────────────────────┐
│           Tauri 主进程                 │
│                                      │
│  1. 初始化 Rust 安全层               │
│     · 加载 Keychain Plugin           │
│     · 初始化 Crypto Plugin           │
│                                      │
│  2. 启动 Node.js Sidecar             │
│     · 生成随机端口 + Token           │
│     · 启动 Core 服务                 │
│     · 等待健康检查通过               │
│     · 初始化 PI 框架 + Provider 注册 │
│     · 初始化记忆系统 + 衰减调度器    │
│                                      │
│  3. 打开 WebView                     │
│     · 加载 React 前端                │
│     · 连接 Sidecar 后端              │
│                                      │
│  4. 启动 Channel Manager             │
│     · 重连已配置的 Channel           │
│     · 初始化 Binding 路由表          │
│                                      │
│  5. 启动 Scheduler                   │
│     · 初始化 Heartbeat 调度器        │
│     · 初始化 Cron 调度器             │
│                                      │
│  用户感知: 一个应用，双击即用          │
└──────────────────────────────────────┘
```

### 9.2 可选依赖

| 依赖 | 必需 | 说明 |
|------|------|------|
| Docker | 否 | 仅沙箱模式需要，首次启用时引导安装 |
| LLM API Key | 是 | 至少一家 Provider 的 API Key |

### 9.3 打包方案

```
macOS:
  · .app Bundle (Universal: x86_64 + arm64)
  · .dmg 安装镜像
  · 签名: Developer ID + Notarization
  · 体积: ~30MB (含 Sidecar Node.js 运行时)

Windows:
  · .msi 安装包 (NSIS)
  · 签名: Authenticode
  · 体积: ~40MB

Linux:
  · .AppImage (通用)
  · .deb (Debian/Ubuntu)
  · .rpm (Fedora/RHEL)
```

### 9.4 自动更新

```
应用启动
    │
    ▼
检查更新 (GitHub Releases / 自建 CDN)
    │
    ├── 无更新 -> 正常运行
    └── 有更新
           │
           ▼
      下载差量更新包 -> 验证签名 (Ed25519)
           │
           ▼
      通知用户 -> "发现新版本，是否更新？"
           │
      ┌────┴────┐
      │立即更新 │ -> 安装重启
      │稍后提醒 │ -> 下次启动再提醒
      └────────┘
```

---

## 附录 A：关键技术决策记录 (ADR)

### ADR-001: Tauri + Node.js Sidecar

- **决策**: Tauri 管 UI + Rust 安全层，Node.js 作为 Sidecar 跑核心业务
- **理由**: Tauri 原生性能 + Rust 安全层；Node.js 完整生态 + PI 框架原生 TS 支持
- **替代方案**: Electron（体积臃肿）、全 Tauri（Node 生态不可替代）
- **风险**: 两进程间通信有开销
- **缓解**: localhost HTTP + 启动 Token，延迟 <1ms

### ADR-002: 基于 PI 框架而非从零自研

- **决策**: Agent 运行时基于 PI 框架（pi-ai + pi-agent-core + pi-coding-agent），EvoClaw 自研记忆系统、安全层、Channel 适配
- **理由**: PI 是 OpenClaw 底层引擎，302k+ Star 验证；ReAct 循环、文件工具、JSONL 持久化、Skills 加载内置可用；ClawHub 13,700+ Skills 生态直接兼容
- **不使用**: pi-tui（EvoClaw 是桌面应用）、pi CLI（非命令行工具）
- **自研范围**: 记忆系统（L0/L1/L2）、安全层（Rust）、Channel 适配、桌面壳、ContextPlugin 引擎

### ADR-003: TypeScript + Rust 混合开发

- **决策**: 业务逻辑用 TypeScript，安全关键路径用 Rust
- **Rust 负责**: 加密解密（ring AES-256-GCM）、Keychain 集成、签名验证
- **TypeScript 负责**: Agent 引擎、记忆系统、进化引擎、Channel、UI
- **理由**: 日常迭代最多的业务逻辑用 TS 高效开发；安全层用 Rust 杜绝内存安全问题

### ADR-004: 不暴露公网端口

- **决策**: Sidecar 仅绑定 127.0.0.1 + 随机端口 + Token 认证
- **理由**: 从根本上消除 OpenClaw 的 ClawJacked 类攻击面
- **Channel 消息**: 通过平台 SDK 主动拉取/WebSocket 推送，不需要 Webhook 公网回调

### ADR-005: L0/L1/L2 三层记忆存储

- **决策**: 借鉴 OpenViking 三层分级存储，每条记忆包含 L0 索引、L1 概览、L2 全文，在 better-sqlite3 + FTS5 + sqlite-vec 上实现
- **理由**: 实测 80%+ token 压缩；三阶段渐进检索（L0 宽检索 -> L1 精筛 -> L2 按需）兼顾速度和精度
- **借鉴**: OpenViking（三层分级）、claude-mem（渐进检索）、MemOS（反馈循环防护）
- **风险**: 额外 LLM 调用生成 L0/L1/L2
- **缓解**: 仅在 afterTurn 异步调用，不阻塞响应

### ADR-006: ContextPlugin 替代中间件链

- **决策**: 使用 5 钩子 ContextPlugin 架构替代传统中间件链
- **理由**: 中间件链仅有 before/after 两个钩子，ContextPlugin 增加 bootstrap/compact/shutdown，支持 Agent 完整生命周期；compact 钩子支持逆序执行，按需压缩 token
- **插件列表**: SessionRouter / Permission / ContextAssembler / MemoryRecall / RAG / ToolRegistry / MemoryExtract / Evolution / GapDetection / Heartbeat

### ADR-007: 单引擎记忆存储

- **决策**: better-sqlite3 + sqlite-vec + FTS5 覆盖全部存储需求
- **理由**: 保持零配置原则；单一存储引擎降低运维复杂度；SQLite WAL 模式提供足够的并发性能
- **风险**: 百万级数据时 sqlite-vec 性能瓶颈
- **缓解**: 预计单用户数据规模在万级以内

### ADR-008: Docker 可选沙箱

- **决策**: Docker 沙箱作为可选功能，默认关闭，支持 off/selective/all 三级模式
- **理由**: 零门槛用户不需要安装 Docker；安全敏感用户可以开启隔离执行
- **macOS**: 引导安装 Colima（轻量级，无需 Docker Desktop 许可证）
- **Windows**: 引导启用 WSL2 + Docker Engine

### ADR-009: 插件系统 — 清单 + 注册模式

- **决策**: 采用 `evoclaw.plugin.json` 清单 + `register(api)` 注入模式，不完全兼容 OpenClaw 插件
- **理由**: OpenClaw 的 Channel 插件深度依赖其 Gateway 架构（ChannelPlugin/ChannelDock/消息路由/webhook 体系），完全兼容等于重建 Gateway，工作量大于自建；但 Skills（SKILL.md）格式一致可直接复用，工具业务逻辑可移植
- **复用范围**: Skills 直接兼容 + 工具 API 调用逻辑移植 + 底层 npm SDK 共享
- **自建范围**: ChannelAdapter / Hook 体系 / PluginRegistry / plugin-sdk 包

### ADR-010: MetaClaw 借鉴 — 渐进式自进化增强

- **决策**: 从 MetaClaw（MAML 式 Agent 生成框架）借鉴 5 个核心机制，分阶段集成到 EvoClaw 进化引擎
- **借鉴项**:
  1. **记忆 generation 溯源**: 每条提取的记忆标注 conversation_id + model_id，支持质量溯源和批量校正
  2. **Skill 自进化循环**: 多次同类失败 → 自动生成 SKILL.md → 沙箱验证 → 安装（需用户确认）
  3. **响应质量评估**: 自动指标（工具成功率/重试次数/对话轮次）+ 用户反馈 → 能力图谱权重调整
  4. **用户空闲感知调度**: 检测用户空闲期（无交互 > 5min），在空闲时执行后台任务（记忆整理、衰减计算、Skill 验证）
  5. **System Prompt 压缩/缓存**: 高频相似 prompt 结构缓存 hash，减少重复 token 消耗
- **实现策略**: generation 溯源（Sprint 11）→ 质量评估（Sprint 12）→ Skill 自进化（Sprint 13）→ 空闲调度 + prompt 压缩（Sprint 15）
- **风险**: Skill 自生成质量不可控
- **缓解**: 沙箱验证 + 用户确认双重门控；auto-generated Skill 在仪表盘单独展示

---

> **文档版本**: v4.2 -- 新增 MetaClaw 借鉴机制：ADR-010（generation 溯源 + Skill 自进化循环 + 响应质量评估 + 空闲调度 + prompt 压缩）；记忆提取 Stage 3 增加 generation 元数据标注；EvolutionPlugin 增加 evaluateResponseQuality；Skill 自进化循环架构（SkillGapAnalyzer → SKILL.md 生成 → 沙箱验证）。v4.1: 插件系统架构（3.9 节）。v4.0: PI 框架重构 Agent 运行时层
> **文档状态**: 已更新
> **下次评审**: 待定
