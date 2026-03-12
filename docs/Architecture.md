# EvoClaw 技术架构设计文档

> **文档版本**: v3.0
> **创建日期**: 2026-03-11
> **更新日期**: 2026-03-12
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
│  │ · 加密/解密 (libsodium) │  │ React 19 + Tailwind CSS 4   │  │
│  │ · Keychain 集成         │  │                              │  │
│  │ · 沙箱引擎              │  │  ┌────────┐ ┌────────────┐  │  │
│  │ · Skill 签名验证        │  │  │Chat UI │ │Agent Builder│ │  │
│  │ · 文件系统监控          │  │  ├────────┤ ├────────────┤  │  │
│  └────────────┬───────────┘  │  │Dashboard│ │Skill/KB Mgr│ │  │
│               │               │  └────────┘ └────────────┘  │  │
│               │ Tauri IPC     │              │               │  │
│               │               └──────────────┼───────────────┘  │
├───────────────┼──────────────────────────────┼──────────────────┤
│               │        HTTP/IPC              │                  │
│  ┌────────────▼──────────────────────────────▼───────────────┐  │
│  │              Node.js Sidecar (TypeScript)                  │  │
│  │                                                           │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │          请求处理中间件链 (借鉴 DeerFlow + OpenClaw)  │  │  │
│  │  │  Permission → SessionRouting → Context → Memory     │  │  │
│  │  │  → RAG → LCM → Skill → [LLM] → MemoryFlush        │  │  │
│  │  │  → GapDetection → Evolution → Metabolism            │  │  │
│  │  └─────────────────────────┬───────────────────────────┘  │  │
│  │                            │                              │  │
│  │  ┌──────────┐ ┌──────────┐│┌──────────┐ ┌────────────┐  │  │
│  │  │ Agent    │ │ Evolution│││ Skill    │ │ RAG        │  │  │
│  │  │ Engine   │ │ Engine   │││ Manager  │ │ Engine     │  │  │
│  │  └──────────┘ └──────────┘│└──────────┘ └────────────┘  │  │
│  │                           │                              │  │
│  │  ┌──────────┐ ┌──────────┐│┌──────────┐ ┌────────────┐  │  │
│  │  │ Model    │ │ Channel  │││ Memory   │ │ MCP Bridge │  │  │
│  │  │ Router   │ │ Manager  │││ Engine   │ │(@mcp/sdk)  │  │  │
│  │  └─────┬────┘ └─────┬────┘│└─────┬────┘ └────────────┘  │  │
│  │        │             │     │      │                       │  │
│  └────────┼─────────────┼─────┼──────┼───────────────────────┘  │
│           │             │     │      │                           │
├───────────┼─────────────┼─────┼──────┼───────────────────────────┤
│           │             │     │      │    基础设施                │
│  ┌────────▼───┐ ┌──────▼──┐ ┌▼──────▼──┐ ┌─────────────────┐  │
│  │ Cloud LLM  │ │ IM APIs │ │ SQLite   │ │ SQLite-vec      │  │
│  │ Providers  │ │ 飞书    │ │ (加密)   │ │ (向量索引)      │  │
│  │ (7 家)     │ │ 企微    │ │ + FTS5   │ │                 │  │
│  │ via Vercel │ │ QQ      │ │          │ │                 │  │
│  │ AI SDK     │ │         │ │          │ │                 │  │
│  └────────────┘ └─────────┘ └──────────┘ └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 核心设计原则

| # | 原则 | 含义 | 来源/教训 |
|---|------|------|-----------|
| 1 | **安全默认 (Secure by Default)** | 所有安全机制出厂启用，不可完全关闭 | OpenClaw 明文凭证、93.4% 认证绕过的教训 |
| 2 | **一体化体验 (All-in-One)** | 主服务 + 桌面应用合一，双击即用 | OpenClaw 需命令行启服务的教训 |
| 3 | **进化驱动 (Evolution Driven)** | 每次交互都是 Agent 进化的机会 | EvoClaw 核心品牌标识 |
| 4 | **最小权限 (Least Privilege)** | Agent/Skill 只获得完成任务所需的最小权限 | iOS 权限模型借鉴 |
| 5 | **数据安全 (Data Security)** | 用户数据本地加密存储，仅 LLM API 和 Channel 消息对外通信 | OpenClaw 3万+ 暴露实例的教训 |
| 6 | **中间件架构 (Middleware Chain)** | 借鉴 DeerFlow，请求处理通过可插拔中间件链 | DeerFlow 11 层中间件的经验 |
| 7 | **模型无关 (Model Agnostic)** | 通过 Vercel AI SDK 统一接口，不绑定任何 Provider | DeerFlow 反射式模型工厂的经验 |
| 8 | **记忆无损 (Lossless Memory)** | 对话信息逻辑压缩而非物理丢弃，随时可恢复原始上下文 | OpenClaw LCM 架构的借鉴 |
| 9 | **记忆隔离 (Memory Isolation)** | 私密记忆按会话类型严格隔离，群聊不暴露个人记忆 | OpenClaw MEMORY.md 安全边界 |

### 1.3 技术选型决策表

| 维度 | 选型 | 理由 | 替代方案 | 不选原因 |
|------|------|------|----------|----------|
| **桌面框架** | Tauri 2.0 | 体积小（~15MB）、Rust 安全层、原生系统集成 | Electron | 体积臃肿（~150MB）、内存占用高 |
| **前端** | React 19 + TypeScript | 生态最大、人才最多、Tauri 完美支持 | Vue 3 / Svelte | React 在桌面应用场景更成熟 |
| **样式** | Tailwind CSS 4 | 原子化 CSS、零运行时 | CSS Modules | 开发效率较低 |
| **后端架构** | Node.js Sidecar | 完整 Node 生态 + Tauri 生命周期管理 | 全 Tauri IPC | Node 生态完整性无可替代 |
| **核心引擎** | TypeScript (Node.js >=22) | 与前端共享类型、MCP SDK 原生 TS | Rust | 业务逻辑迭代速度优先 |
| **安全关键路径** | Rust (Tauri Plugin) | 加密/沙箱/签名 需要内存安全保证 | TypeScript | 安全敏感操作不应使用 GC 语言 |
| **模型调用** | Vercel AI SDK (`ai`) | 统一多 Provider 接口、流式、Tool Calling 内置 | LangChain.js | LangChain 过重、抽象层过多 |
| **Agent 框架** | 自研 + 中间件链 | 进化引擎无现有框架提供；中间件模式借鉴 DeerFlow | LangGraph | Python 生态，与 TS 不兼容 |
| **MCP 集成** | @modelcontextprotocol/sdk | 官方 TypeScript SDK | 自研适配层 | 降低维护成本 |
| **向量存储** | SQLite-vec | 嵌入式、零依赖、与 SQLite 共享连接 | LanceDB / ChromaDB | 额外依赖不必要 |
| **全文检索** | FTS5 | SQLite 内置、零额外依赖、与向量检索共用连接 | Tantivy / MeiliSearch | 保持单引擎架构 |
| **结构化存储** | better-sqlite3 | 同步 API、Node 原生、高性能 | Drizzle ORM | 直接操作更灵活 |
| **加密** | libsodium (sodium-native) | 行业标准审计过的加密库 | Node.js crypto | libsodium API 更安全 |
| **进程管理** | Tauri Sidecar | 管理 Node.js 后端进程生命周期 | child_process | Tauri Sidecar 提供完整生命周期管理 |
| **Channel SDK** | 各平台官方 SDK | 飞书/企微/QQ 官方 Node SDK | 自研 HTTP 封装 | 官方 SDK 维护更及时 |

---

## 2. 分层架构设计

### 2.1 展示层 (Presentation Layer)

**职责**：用户界面渲染、用户交互处理、状态呈现

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

**关键接口**：前端通过 HTTP 调用 Node.js Sidecar 后端

```typescript
// 后端 API 接口示例
interface BackendAPI {
  // 对话
  'POST /chat/:agentId/send': (message: string) => SSE<ChatChunk>
  'POST /chat/:agentId/feedback': (messageId: string, type: 'up' | 'down') => void

  // Agent
  'POST /agent/create-guided': (userInput: string) => SSE<BuilderStep>
  'GET  /agent/list': () => AgentSummary[]
  'GET  /agent/:id': () => AgentDetail

  // 进化
  'GET  /evolution/:agentId/dashboard': () => DashboardData
  'GET  /evolution/:agentId/log': (range: TimeRange) => EvolutionEntry[]

  // 记忆
  'POST /memory/:agentId/search': (query: string, systems: string[]) => MemorySearchResult[]
  'GET  /memory/:agentId/facts': (filter?: FactFilter) => Fact[]
  'GET  /memory/:agentId/growth-vectors': () => GrowthVector[]

  // 安全（通过 Tauri IPC 调用 Rust 层）
  'permission:request': (agentId: string, perm: Permission) => PermissionDecision
  'credential:get': (key: string) => string
  'credential:set': (key: string, value: string) => void
}
```

### 2.2 应用层 (Application Layer)

**职责**：用例编排、跨领域协调、中间件链管理

```
packages/core/src/application/
├── middleware/                 # 请求处理中间件链 (借鉴 DeerFlow + OpenClaw)
│   ├── permission-middleware.ts    # 权限检查
│   ├── session-routing-middleware.ts # Session Key 路由（多通道会话映射）
│   ├── context-middleware.ts       # 上下文组装
│   ├── memory-middleware.ts        # 记忆注入（MEMORY.md + facts + 向量检索）
│   ├── rag-middleware.ts           # 知识库检索注入
│   ├── lcm-middleware.ts           # LCM 无损压缩管理
│   ├── skill-middleware.ts         # Skill/Tool 注册
│   ├── memory-flush-middleware.ts  # Pre-compaction memory flush（后置）
│   ├── gap-detection-middleware.ts # 能力缺口检测（后置，异步）
│   ├── evolution-middleware.ts     # 进化评分 + 反馈处理（后置，异步）
│   ├── metabolism-middleware.ts    # 对话后事实提取（后置，异步）
│   └── pipeline.ts                 # 中间件链编排
├── chat-service.ts             # 对话管理
├── agent-lifecycle.ts          # Agent 生命周期
├── agent-builder.ts            # 语义化创建引导
├── evolution-service.ts        # 进化编排
├── memory-service.ts           # 记忆服务（统一记忆层管理）
├── skill-manager.ts            # Skill 管理
├── knowledge-service.ts        # 知识库管理
├── collaboration-service.ts    # 多 Agent 协作
└── model-router.ts             # 模型路由
```

**中间件链设计**（借鉴 DeerFlow + OpenClaw 记忆层思想）：

```
用户消息
    │
    ▼
┌─────────────────────────────┐
│  PermissionMiddleware        │ ← 权限检查（调用 Rust 安全层）
├─────────────────────────────┤
│  SessionRoutingMiddleware    │ ← Session Key 路由（桌面/Channel/群聊）
├─────────────────────────────┤
│  ContextMiddleware           │ ← 组装 SOUL.md + IDENTITY.md + 历史消息
├─────────────────────────────┤
│  MemoryMiddleware            │ ← 注入 MEMORY.md + facts + 向量检索结果
├─────────────────────────────┤
│  RAGMiddleware               │ ← 知识库语义检索，注入相关文档
├─────────────────────────────┤
│  LCMMiddleware               │ ← LCM 无损压缩（Token 接近上限时触发）
├─────────────────────────────┤
│  SkillMiddleware             │ ← 注册可用 Tool/Skill
├─────────────────────────────┤
│        [LLM 调用]            │ ← Vercel AI SDK → 云端 LLM
├─────────────────────────────┤
│  MemoryFlushMiddleware       │ ← Pre-compaction memory flush（后置）
├─────────────────────────────┤
│  GapDetectionMiddleware      │ ← 能力缺口检测（后置，异步）
├─────────────────────────────┤
│  EvolutionMiddleware         │ ← 进化评分 + 反馈处理（后置，异步）
├─────────────────────────────┤
│  MetabolismMiddleware        │ ← 对话后事实提取（后置，异步）
└─────────────────────────────┘
```

```typescript
// 中间件接口
interface Middleware {
  name: string
  // 前置处理：在 LLM 调用前（串行执行）
  before?(ctx: ChatContext): Promise<ChatContext>
  // 后置处理：在 LLM 响应后（并行执行，不阻塞响应）
  after?(ctx: ChatContext, response: ChatResponse): Promise<void>
}

// 中间件链
class MiddlewarePipeline {
  private middlewares: Middleware[] = []

  use(middleware: Middleware): this {
    this.middlewares.push(middleware)
    return this
  }

  async process(ctx: ChatContext): Promise<ChatResponse> {
    // 1. 串行执行所有 before
    for (const mw of this.middlewares) {
      if (mw.before) ctx = await mw.before(ctx)
    }

    // 2. 调用 LLM
    const response = await this.callModel(ctx)

    // 3. 并行执行所有 after（不阻塞响应）
    Promise.all(
      this.middlewares.map(mw => mw.after?.(ctx, response))
    ).catch(err => logger.error('Middleware after error', err))

    return response
  }
}
```

**对话服务编排**：

```typescript
class ChatService {
  private pipeline: MiddlewarePipeline

  constructor() {
    this.pipeline = new MiddlewarePipeline()
      // === 前置中间件（串行） ===
      .use(new PermissionMiddleware())
      .use(new SessionRoutingMiddleware())
      .use(new ContextMiddleware())
      .use(new MemoryMiddleware())
      .use(new RAGMiddleware())
      .use(new LCMMiddleware())
      .use(new SkillMiddleware())
      // === 后置中间件（并行，异步） ===
      .use(new MemoryFlushMiddleware())
      .use(new GapDetectionMiddleware())
      .use(new EvolutionMiddleware())
      .use(new MetabolismMiddleware())
  }

  async handleMessage(agentId: string, userMessage: string, sessionKey?: string) {
    const ctx: ChatContext = {
      agentId,
      userMessage,
      sessionKey: sessionKey ?? `agent:${agentId}:desktop:main`,
      soul: await this.agentRepo.getSoul(agentId),
      model: await this.modelRouter.select(agentId),
    }
    return this.pipeline.process(ctx)
  }
}
```

### 2.3 领域层 (Domain Layer)

**职责**：核心业务逻辑、领域模型、业务规则

```
packages/core/src/domain/
├── agent/
│   ├── agent.ts            # Agent 聚合根
│   ├── soul.ts             # SOUL.md 解析/生成
│   └── types.ts
├── memory/
│   ├── memory-engine.ts    # 记忆引擎核心（8 层记忆管理）
│   ├── lcm-compressor.ts   # LCM 无损压缩器
│   ├── fact-extractor.ts   # 事实提取器（Metabolism）
│   ├── hybrid-searcher.ts  # 混合搜索（FTS5 + 向量 + facts）
│   ├── decay-manager.ts    # Hebbian 衰减管理
│   ├── daily-log.ts        # 每日日志管理
│   ├── growth-tracker.ts   # 成长向量追踪
│   ├── distiller.ts        # 记忆蒸馏器
│   └── types.ts
├── evolution/
│   ├── capability-graph.ts # 能力图谱
│   ├── feedback-loop.ts    # 反馈学习环
│   ├── scorer.ts           # 进化评分
│   └── types.ts
├── security/
│   ├── permission-model.ts # 权限模型
│   ├── sandbox-policy.ts   # 沙箱策略
│   └── types.ts
├── skill/
│   ├── skill-registry.ts   # Skill 注册表
│   ├── gap-detector.ts     # 能力缺口检测
│   └── types.ts
├── channel/
│   ├── channel-adapter.ts  # Channel 抽象接口
│   ├── session-router.ts   # Session Key 路由
│   ├── message-normalizer.ts # 消息标准化
│   └── types.ts
└── collaboration/
    ├── workflow.ts          # 协作工作流 DAG
    ├── message-bus.ts       # Agent 间消息总线
    └── types.ts
```

### 2.4 基础设施层 (Infrastructure Layer)

```
packages/core/src/infrastructure/
├── db/
│   ├── sqlite-store.ts     # SQLite 连接管理
│   ├── vector-store.ts     # SQLite-vec 向量操作
│   ├── fts-store.ts        # FTS5 全文检索操作
│   └── migrations/         # Schema 迁移脚本
│       ├── 001_initial.sql
│       ├── 002_add_channels.sql
│       ├── 003_add_summaries.sql
│       ├── 004_add_facts.sql
│       ├── 005_add_growth_vectors.sql
│       └── 006_extend_memories.sql
├── model/
│   ├── provider-registry.ts # 模型 Provider 注册表
│   ├── openai.ts           # OpenAI (via Vercel AI SDK)
│   ├── anthropic.ts        # Anthropic
│   ├── deepseek.ts         # DeepSeek
│   ├── minimax.ts          # MiniMax
│   ├── glm.ts              # 智谱 GLM
│   ├── doubao.ts           # 字节豆包
│   └── qwen.ts             # 通义千问
├── security/               # Rust Tauri Plugin 的 TS 调用封装
│   ├── keychain.ts         # 系统 Keychain 适配
│   ├── sandbox.ts          # 沙箱执行引擎
│   ├── crypto.ts           # 加密/解密操作
│   └── signature.ts        # Skill 签名验证
├── channel/
│   ├── feishu-adapter.ts   # 飞书适配器
│   ├── wecom-adapter.ts    # 企业微信适配器
│   └── qq-adapter.ts       # QQ 适配器
├── mcp/
│   ├── mcp-bridge.ts       # MCP 协议桥接
│   └── adapters/
├── rag/
│   ├── ingestion.ts        # 文档摄取管道
│   ├── chunker.ts          # 文本分块器
│   ├── embedder.ts         # 嵌入生成器（云端 API）
│   └── retriever.ts        # 检索器
├── skill-source/
│   ├── npm-source.ts       # npm registry 搜索
│   ├── clawhub-source.ts   # ClawHub 搜索
│   └── skills-sh-source.ts # skills.sh 搜索
└── fs/
    ├── app-data.ts         # 应用数据目录管理
    └── workspace.ts        # Agent 工作区管理
```

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
│ 查询权限缓存     │  ← Node.js 层内存缓存
└────┬────────────┘
     │
     ├── 命中 "always allow" → 放行
     ├── 命中 "always deny"  → 拒绝
     ├── 命中 "session"      → 检查会话有效性 → 放行/弹窗
     └── 未命中              → 通过 Tauri IPC 弹窗请求授权
                                    │
                              ┌─────┴─────┐
                              │ 用户决策   │
                              ├── 仅本次   │ → 放行，不持久化
                              ├── 始终允许 │ → 放行，持久化
                              ├── 始终拒绝 │ → 拒绝，持久化
                              └── 取消     │ → 拒绝
```

#### 凭证管理架构（Rust 实现）

```
┌──────────────────────────────────────────────────┐
│            Credential Vault (Rust Plugin)          │
├──────────────────────────────────────────────────┤
│                                                  │
│  Tauri IPC 接口:                                  │
│  · credential:get(service, account) → value      │
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

```
Skill 安装请求
    │
    ▼
┌─────────────────────┐
│ 1. 下载 Skill 包     │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 2. 签名验证 (Rust)   │  ← Ed25519 签名验证（Rust Plugin）
│    签名无效 → 拒绝   │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 3. 静态分析 (TS)     │  ← 扫描危险模式 (eval, fetch, fs.write)
│    发现危险 → 警告   │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 4. 沙箱试运行 (Rust) │  ← Rust 沙箱中运行测试用例
│    行为异常 → 拒绝   │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 5. 用户确认 (UI)     │  ← 展示分析报告 + 安全评分
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 6. 安装 + 注册       │  ← 写入 Skill 注册表 + 启用审计
└─────────────────────┘
```

### 3.2 Agent 引擎

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
                             │ 测试中   │ ←────────  │            │
                             │(Testing) │            ▼            ▼
                             └──────────┘      ┌──────────┐ ┌──────────┐
                                               │ 暂停     │ │ 归档     │
                                               │(Paused)  │ │(Archived)│
                                               └──────────┘ └──────────┘
```

#### SOUL.md 数据模型

```typescript
interface Soul {
  name: string
  role: string
  avatar?: string

  personality: {
    tone: 'formal' | 'friendly' | 'humorous' | 'concise'
    expertise: string[]
    language: string[]
  }

  constraints: {
    always: string[]
    never: string[]
  }

  interaction: {
    responseLength: 'short' | 'medium' | 'detailed'
    proactiveAsk: boolean
    citeSources: boolean
  }

  capabilities: {
    skills: string[]
    knowledgeBases: string[]
    tools: string[]
  }

  evolution: {
    memoryDistillation: boolean
    feedbackLearning: boolean
    autoSkillDiscovery: boolean
  }

  model: {
    preferred?: string       // 首选模型 ID
    fallback?: string        // 备选模型 ID
  }
}
```

#### MEMORY.md 数据模型

```typescript
interface PreferenceEntry {
  id: string
  category: string        // "coding_style" | "format" | "tone" | ...
  key: string
  value: string
  confidence: number      // 0-1
  observedCount: number
  lastObserved: number
  source: 'inferred' | 'explicit'
}

interface KnowledgeEntry {
  id: string
  topic: string
  content: string
  source: 'conversation' | 'knowledge_base' | 'skill'
  confidence: number
  createdAt: number
  updatedAt: number
}

interface CorrectionEntry {
  id: string
  original: string
  corrected: string
  rule: string
  appliedCount: number
  createdAt: number
}
```

#### 语义化创建流程

```
用户: "创建一个编程助手"
    │
    ▼
┌──────────────────────────────────────────────┐
│          Agent Builder (应用层)                │
│                                              │
│  Phase 1: 角色定位                            │
│  → "你想要什么类型的编程助手？"               │
│  ← "主要写 TypeScript，前后端都做"            │
│                                              │
│  Phase 2: 专长深挖                            │
│  → "你主要用什么框架？"                       │
│  ← "React + Node.js + PostgreSQL"            │
│                                              │
│  Phase 3: 风格偏好                            │
│  → "你喜欢什么样的回答风格？"                 │
│  ← "简洁直接，给代码就行"                     │
│                                              │
│  Phase 4: 行为约束                            │
│  → "有什么特别的要求吗？"                     │
│  ← "不要用 class 组件，只用函数式"            │
│                                              │
│  Phase 5: 预览 & 测试                         │
│  → [生成 SOUL.md 预览] "试试问他一个问题？"    │
│  ← 用户测试对话 → 满意/调整 → 循环            │
│                                              │
│  Phase 6: 确认创建                            │
│  → [保存 SOUL.md + 初始 MEMORY.md]            │
└──────────────────────────────────────────────┘
```

### 3.3 进化引擎 (Evolution Engine)

```
┌──────────────────────────────────────────────────────────────┐
│                     Evolution Engine                          │
│                                                              │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────┐  │
│  │ Memory         │  │ Feedback       │  │ Capability    │  │
│  │ Distillation   │  │ Learning       │  │ Graph         │  │
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
│                    │ Evolution Log     │                     │
│                    └──────────────────┘                      │
└──────────────────────────────────────────────────────────────┘
```

#### 记忆沉淀管道

```
对话完成 (EvolutionMiddleware.after 触发)
    │
    ▼
┌─────────────────────┐
│ 1. LLM 对话分析      │  ← 使用同一模型或低成本模型
│    提取候选记忆       │     提示词："提取用户偏好、知识、纠正"
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 2. 去重 & 合并       │  ← 向量相似度 > 0.85 则合并
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 3. 置信度计算        │  ← 首次: 0.3, 再次确认: +0.2
│                     │     用户明确告知: 直接 0.9
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 4. 写入 MEMORY.md   │  ← 同时更新 Capability Graph
│    + 进化日志        │
└─────────────────────┘
```

#### 能力图谱与评分算法

```typescript
interface CapabilityDimension {
  name: string            // "typescript_coding" | "research" | ...
  score: number           // 0-100
  trend: 'rising' | 'stable' | 'declining'
  evidence: {
    totalInteractions: number
    positiveRate: number
    correctionRate: number
    skillsUsed: string[]
  }
  history: { date: number; score: number }[]
}

// 评分算法
// score = 50 (base)
//       + (positiveRate * 20)
//       - (correctionRate * 15)
//       + (skillCount * 5)
//       + (memoryCount * 2)
//       + (interactionFrequency * 3)
// 约束: 0 <= score <= 100
// 衰减: 7 天无交互则 score -= 1/day (最低 30)
```

### 3.4 Skill/MCP 管理系统

#### 能力缺口检测

```typescript
interface GapAnalysis {
  taskDescription: string
  failureType: 'tool_missing' | 'format_unsupported' | 'knowledge_gap' | 'quality'
  confidence: number
  suggestedCapability: string
  searchQuery: string
}
```

#### 多源 Registry 抽象层

```typescript
interface SkillSource {
  name: string
  search(query: string): Promise<SkillCandidate[]>
  download(id: string): Promise<SkillPackage>
}

interface SkillCandidate {
  id: string
  name: string
  description: string
  source: string             // "npm" | "clawhub" | "skills.sh"
  rating: number
  downloads: number
  securityScore: number
  capabilities: string[]
  permissions: string[]
}
```

#### 安全安装管道

```
Discovery → Verify(Rust) → Analyze(TS) → Sandbox(Rust) → Confirm(UI) → Install
    │            │              │              │
    ▼            ▼              ▼              ▼
  多源搜索    签名无效→拒绝   危险代码→警告   行为异常→拒绝
```

### 3.5 本地知识库 (RAG 引擎)

#### 文档摄取管道

```
文件导入
    │
    ▼
┌─────────────────┐
│ 1. 格式检测/解析 │  ← .md → MarkdownParser
│                 │     .pdf → pdf-parse
│                 │     .docx → mammoth
│                 │     .py/.ts → tree-sitter
└────────┬────────┘
         ▼
┌─────────────────┐
│ 2. 智能分块      │  ← 递归分块: 标题 → 段落 → 句子
│   (512 tokens)  │     50 tokens 重叠
└────────┬────────┘
         ▼
┌─────────────────┐
│ 3. 嵌入生成      │  ← 云端 Embedding API
│                 │     (text-embedding-3-small 或国产替代)
└────────┬────────┘
         ▼
┌─────────────────┐
│ 4. 向量写入      │  ← SQLite-vec INSERT
│   + FTS5 全文    │     同时写入 FTS5 索引
└─────────────────┘
```

### 3.6 Channel 系统

```
┌──────────────────────────────────────────────────┐
│                Channel Manager                    │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │           Channel Adapter 接口              │  │
│  │                                            │  │
│  │  interface ChannelAdapter {                │  │
│  │    id: string                              │  │
│  │    name: string                            │  │
│  │    connect(config: ChannelConfig): void    │  │
│  │    disconnect(): void                      │  │
│  │    onMessage(handler: MessageHandler): void│  │
│  │    sendMessage(to: string, msg: Msg): void │  │
│  │    getStatus(): ConnectionStatus           │  │
│  │  }                                        │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐   │
│  │ 飞书        │ │ 企业微信    │ │ QQ         │   │
│  │ Adapter    │ │ Adapter    │ │ Adapter    │   │
│  │            │ │            │ │            │   │
│  │ @larksuiteoapi│ │ wecom-sdk │ │ qq-bot-sdk│   │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘   │
│        │              │              │           │
│  ┌─────▼──────────────▼──────────────▼─────────┐ │
│  │      消息标准化层 (MessageNormalizer)          │ │
│  │  · 统一消息格式 (text/file/image/card)       │ │
│  │  · 平台特性适配 (飞书卡片/企微模板)          │ │
│  │  · Session Key 路由（平台会话 → Agent 会话） │ │
│  └─────────────────────┬───────────────────────┘ │
│                        │                         │
│                        ▼                         │
│              ChatService.handleMessage()         │
│              (与桌面端共用同一处理管道)            │
└──────────────────────────────────────────────────┘
```

**关键设计**：Channel 消息经过标准化后，由 SessionRoutingMiddleware 生成 Session Key，复用与桌面端完全相同的中间件链和 Agent 引擎。记忆隔离矩阵（见第 4 章）控制不同 Channel 场景下的记忆可见性。

### 3.7 模型适配层

```
┌──────────────────────────────────────────────────┐
│              Model Router                         │
│                                                  │
│  输入: Agent 配置 + 用户偏好                      │
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

```typescript
// 基于 Vercel AI SDK 的统一模型接口
import { generateText, streamText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'

// 7 家 Provider 注册
const providers = {
  openai: createOpenAI({ apiKey: vault.get('openai') }),
  anthropic: createAnthropic({ apiKey: vault.get('anthropic') }),
  deepseek: createOpenAI({                // DeepSeek 兼容 OpenAI 接口
    apiKey: vault.get('deepseek'),
    baseURL: 'https://api.deepseek.com/v1',
  }),
  minimax: createOpenAI({
    apiKey: vault.get('minimax'),
    baseURL: 'https://api.minimax.chat/v1',
  }),
  glm: createOpenAI({
    apiKey: vault.get('glm'),
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  }),
  doubao: createOpenAI({
    apiKey: vault.get('doubao'),
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  }),
  qwen: createOpenAI({
    apiKey: vault.get('qwen'),
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  }),
}

// 统一调用（LCM 压缩后的上下文）
const result = await streamText({
  model: providers.deepseek('deepseek-chat'),
  messages: context.messages,  // 经过 LCM 压缩的消息序列
  tools: context.tools,
})
```

### 3.8 多 Agent 协作

#### 协作拓扑

```
管道模式:  Agent A → Agent B → Agent C → 结果

星形模式:  Agent B ←─┐
           Agent C ←─┤── Lead Agent ──→ 合成结果
           Agent D ←─┘

DAG 模式:  Agent A ──→ Agent C ──┐
           Agent B ──→ Agent D ──┼──→ Agent F → 结果
                       Agent E ──┘
```

```typescript
interface Workflow {
  id: string
  name: string
  steps: WorkflowStep[]
  edges: WorkflowEdge[]       // DAG 边
}

interface WorkflowStep {
  id: string
  agentId: string
  type: 'agent' | 'human-review' | 'condition'
  input: string
  timeout: number
}
```

---

## 4. 记忆架构 (Memory Architecture)

> 本章节是 EvoClaw 的核心差异化设计，深度借鉴 OpenClaw 的记忆层思想，使用 EvoClaw 技术栈（better-sqlite3 + sqlite-vec + FTS5）实现。

### 4.1 记忆层级设计

EvoClaw 采用 8 层记忆架构，从运行时上下文到长期成长向量，形成完整的记忆生命周期。

| 层 | 名称 | 职责 | 存储 | 延迟 |
|---|---|---|---|---|
| L0 | LCM 无损上下文 | 摘要 DAG，永不丢消息 | SQLite (messages + summaries 表) | 运行时 |
| L1 | Always-Loaded Files | 身份文件注入 | SOUL.md, IDENTITY.md | 0ms |
| L2 | MEMORY.md | 策划性长期记忆（仅私聊加载） | Markdown | 0ms |
| L3 | Daily Logs | 情景记忆 | memory/YYYY-MM-DD.md | 按需 |
| L4 | facts 表 | 结构化知识图谱 | SQLite (facts + FTS5) | <1ms |
| L5 | 向量检索 | 跨会话语义召回 | sqlite-vec | ~7ms |
| L6 | Metabolism | 对话后事实提取（异步） | facts 表 + pending_gaps | 后台 |
| L7 | Growth Vectors | 成长向量 + 结晶化（远期） | growth_vectors 表 | 后台 |

```
┌─────────────────────────────────────────────────────────────┐
│                    记忆层级总览                                │
│                                                             │
│  ┌─── 运行时层 ────────────────────────────────────────────┐ │
│  │ L0: LCM 无损上下文                                      │ │
│  │     messages 表 ──→ summaries DAG ──→ 压缩后的上下文     │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─── 身份层（Always-Loaded）──────────────────────────────┐ │
│  │ L1: SOUL.md + IDENTITY.md    (每次对话自动注入)          │ │
│  │ L2: MEMORY.md                (仅私聊场景加载)            │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─── 情景记忆层 ──────────────────────────────────────────┐ │
│  │ L3: Daily Logs               (memory/YYYY-MM-DD.md)     │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─── 结构化检索层 ────────────────────────────────────────┐ │
│  │ L4: facts 表 + FTS5          (结构化知识图谱)            │ │
│  │ L5: sqlite-vec               (跨会话向量召回)            │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─── 后台处理层 ──────────────────────────────────────────┐ │
│  │ L6: Metabolism               (对话后异步事实提取)        │ │
│  │ L7: Growth Vectors           (长期成长向量 + 结晶化)     │ │
│  └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 L0: LCM 无损压缩

LCM（Lossless Context Management）是 EvoClaw 记忆架构的基石。核心思想：**对话信息逻辑压缩而非物理丢弃**，通过摘要 DAG 保持上下文连贯性。

#### LCM 压缩流程

```
对话进行中
    │
    ▼
上下文接近 Token 限制？
    │
    ├── 否 → 继续对话
    │
    └── 是
         │
         ▼
    Pre-compaction Memory Flush
    （MemoryFlushMiddleware 触发静默 Agent 轮次）
    （将重要信息写入 daily log + facts 表）
         │
         ▼
    LCM 压缩（通过 ModelRouter 调用 LLM）
    ├── 从最老消息创建叶子摘要 (depth 0)
    ├── 累积摘要合并为更高层 (depth 1, 2, ...)
    └── 写入 summaries 表
         │
         ▼
    上下文重组
    ├── 遍历 summaries DAG
    ├── 保留最近消息原文
    └── 注入相关摘要
```

#### LCM 压缩器实现

```typescript
interface Summary {
  id: string
  conversationId: string
  parentId: string | null      // 父摘要 ID（构成 DAG）
  depth: number                // 摘要深度（0=叶子，越大越概括）
  content: string              // 摘要文本
  sourceMessageIds: string[]   // 原始消息 ID 列表
  tokenCount: number
  createdAt: number
}

class LCMCompressor {
  private readonly COMPACTION_THRESHOLD = 0.8  // Token 使用率达 80% 触发
  private readonly LEAF_BATCH_SIZE = 10        // 每次压缩 10 条最老消息

  async shouldCompact(ctx: ChatContext): Promise<boolean> {
    const usage = ctx.totalTokens / ctx.modelMaxTokens
    return usage >= this.COMPACTION_THRESHOLD
  }

  async compact(ctx: ChatContext): Promise<ChatContext> {
    // 1. Pre-compaction: 将重要信息 flush 到持久层
    await this.preCompactionFlush(ctx)

    // 2. 取最老的 N 条消息创建叶子摘要
    const oldestMessages = ctx.messages.slice(0, this.LEAF_BATCH_SIZE)
    const leafSummary = await this.createSummary(oldestMessages, 0)

    // 3. 检查是否可以合并现有摘要
    const mergedSummary = await this.tryMergeSummaries(ctx.conversationId)

    // 4. 重组上下文
    return this.rebuildContext(ctx, mergedSummary)
  }

  private async createSummary(
    messages: Message[],
    depth: number
  ): Promise<Summary> {
    // 通过 ModelRouter 调用 LLM 生成摘要
    const result = await this.modelRouter.generateText({
      model: this.modelRouter.selectForTask('summarization'),
      prompt: this.buildSummaryPrompt(messages),
    })

    return {
      id: generateId(),
      conversationId: messages[0].conversationId,
      parentId: null,
      depth,
      content: result.text,
      sourceMessageIds: messages.map(m => m.id),
      tokenCount: result.usage.totalTokens,
      createdAt: Date.now(),
    }
  }

  private async rebuildContext(
    ctx: ChatContext,
    latestSummary: Summary | null
  ): Promise<ChatContext> {
    const rebuiltMessages: Message[] = []

    // 注入摘要链（从根到最新）
    if (latestSummary) {
      const chain = await this.getSummaryChain(latestSummary.id)
      for (const summary of chain) {
        rebuiltMessages.push({
          role: 'system',
          content: `[对话摘要 - 深度${summary.depth}]\n${summary.content}`,
        })
      }
    }

    // 保留最近的原文消息
    const recentMessages = ctx.messages.slice(-this.getRecentWindowSize(ctx))
    rebuiltMessages.push(...recentMessages)

    return { ...ctx, messages: rebuiltMessages }
  }
}
```

### 4.3 L1-L2: 身份文件与策划性记忆

```typescript
// L1: Always-Loaded Files — 每次对话都注入
// ContextMiddleware.before() 中加载
const alwaysLoadedFiles = [
  `~/.evoclaw/agents/${agentId}/SOUL.md`,      // 人格定义
  `~/.evoclaw/agents/${agentId}/IDENTITY.md`,   // 身份扩展（可选）
]

// L2: MEMORY.md — 仅在私聊场景加载
// MemoryMiddleware.before() 中根据会话类型决定
if (ctx.sessionType === 'dm') {
  const memoryMd = await fs.readFile(
    `~/.evoclaw/agents/${agentId}/MEMORY.md`, 'utf-8'
  )
  ctx.systemPrompt += `\n\n## 你的长期记忆\n${memoryMd}`
}
```

### 4.4 L3: Daily Logs（每日情景日志）

```typescript
class DailyLogManager {
  private getLogPath(agentId: string, date?: Date): string {
    const d = date ?? new Date()
    const dateStr = d.toISOString().slice(0, 10) // YYYY-MM-DD
    return `~/.evoclaw/agents/${agentId}/memory/${dateStr}.md`
  }

  async appendEntry(agentId: string, entry: DailyLogEntry): Promise<void> {
    const logPath = this.getLogPath(agentId)
    const markdown = this.formatEntry(entry)
    await fs.appendFile(logPath, markdown + '\n\n')
  }

  async getRecentLogs(agentId: string, days: number = 7): Promise<string[]> {
    const logs: string[] = []
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.now() - i * 86400000)
      const logPath = this.getLogPath(agentId, date)
      if (await fs.pathExists(logPath)) {
        logs.push(await fs.readFile(logPath, 'utf-8'))
      }
    }
    return logs
  }
}
```

### 4.5 L4: Facts 表（结构化知识图谱）

```typescript
interface Fact {
  id: string
  agentId: string
  entityName: string          // 实体名称
  entityType: string          // person | project | concept | tool | ...
  relationType: string        // knows | uses | prefers | ...
  targetEntity: string | null
  content: string | null
  activation: 'hot' | 'warm' | 'cool'
  decayScore: number          // 0.0 - 1.0
  importance: number          // 0.0 - 1.0
  supersededAt: number | null // 被新事实替代的时间
  createdAt: number
  updatedAt: number
}

class FactStore {
  // 查询：同时利用 FTS5 全文检索
  async searchFacts(
    agentId: string,
    query: string,
    options?: { activation?: string; limit?: number }
  ): Promise<Fact[]> {
    const ftsResults = this.db.prepare(`
      SELECT f.*, fts.rank
      FROM facts f
      JOIN facts_fts fts ON f.rowid = fts.rowid
      WHERE facts_fts MATCH ?
        AND f.agent_id = ?
        AND f.superseded_at IS NULL
        AND (? IS NULL OR f.activation = ?)
      ORDER BY fts.rank
      LIMIT ?
    `).all(query, agentId, options?.activation, options?.activation, options?.limit ?? 20)

    return ftsResults
  }

  // 插入新事实时检查是否替代旧事实
  async upsertFact(fact: Omit<Fact, 'id' | 'createdAt' | 'updatedAt'>): Promise<Fact> {
    const existing = await this.findSimilarFact(fact)
    if (existing) {
      // 标记旧事实为已替代
      this.db.prepare(`
        UPDATE facts SET superseded_at = ? WHERE id = ?
      `).run(Date.now(), existing.id)
    }
    // 插入新事实
    return this.insertFact(fact)
  }
}
```

### 4.6 L5: 向量检索（跨会话语义召回）

向量检索层复用 RAG 引擎的 sqlite-vec 基础设施，但专门为记忆内容建立独立的向量索引。

```typescript
class MemoryVectorStore {
  // 记忆向量写入
  async indexMemory(agentId: string, content: string, metadata: object): Promise<void> {
    const embedding = await this.embedder.embed(content)
    this.db.prepare(`
      INSERT INTO memory_embeddings (memory_id, embedding)
      VALUES (?, ?)
    `).run(metadata.id, embedding)
  }

  // 语义检索
  async semanticSearch(
    agentId: string,
    query: string,
    topK: number = 10
  ): Promise<MemorySearchResult[]> {
    const queryEmbedding = await this.embedder.embed(query)
    return this.db.prepare(`
      SELECT me.memory_id, me.distance, m.*
      FROM memory_embeddings me
      JOIN memories m ON me.memory_id = m.id
      WHERE m.agent_id = ?
      ORDER BY me.distance
      LIMIT ?
    `).all(agentId, topK)
  }
}
```

### 4.7 L6: Metabolism（对话后事实提取）

MetabolismMiddleware 在每次对话结束后异步运行，从对话内容中提取结构化事实。

```typescript
class MetabolismMiddleware implements Middleware {
  name = 'MetabolismMiddleware'

  // 仅后置处理，异步执行
  async after(ctx: ChatContext, response: ChatResponse): Promise<void> {
    const extractionPrompt = `
      分析以下对话，提取结构化事实。
      输出 JSON 数组，每个元素包含:
      - entity_name: 实体名称
      - entity_type: person|project|concept|tool|preference
      - relation_type: knows|uses|prefers|dislikes|works_on
      - target_entity: 关联实体（可选）
      - content: 事实描述
      - importance: 0.0-1.0 重要性评分

      对话内容:
      ${this.formatConversation(ctx, response)}
    `

    const result = await this.modelRouter.generateText({
      model: this.modelRouter.selectForTask('extraction'),
      prompt: extractionPrompt,
    })

    const facts = JSON.parse(result.text) as ExtractedFact[]

    for (const fact of facts) {
      await this.factStore.upsertFact({
        agentId: ctx.agentId,
        entityName: fact.entity_name,
        entityType: fact.entity_type,
        relationType: fact.relation_type,
        targetEntity: fact.target_entity,
        content: fact.content,
        activation: 'hot',
        decayScore: 1.0,
        importance: fact.importance,
        supersededAt: null,
      })
    }
  }
}
```

### 4.8 L7: Growth Vectors（成长向量与结晶化）

```typescript
interface GrowthVector {
  id: string
  agentId: string
  area: string               // 成长领域（如 "TypeScript 编程"）
  direction: string          // 成长方向描述
  priority: 'high' | 'medium' | 'low'
  status: 'active' | 'crystallized' | 'archived'
  evidenceCount: number
  firstObserved: number
  lastObserved: number
  crystallizedAt: number | null  // 结晶化时间（>30天门控）
}

class GrowthTracker {
  private readonly CRYSTALLIZATION_THRESHOLD_DAYS = 30
  private readonly MIN_EVIDENCE_FOR_CRYSTALLIZATION = 10

  async trackGrowth(agentId: string, area: string, evidence: string): Promise<void> {
    const existing = await this.findActiveVector(agentId, area)

    if (existing) {
      // 更新现有成长向量
      await this.db.prepare(`
        UPDATE growth_vectors
        SET evidence_count = evidence_count + 1,
            last_observed = ?
        WHERE id = ?
      `).run(Date.now(), existing.id)

      // 检查是否满足结晶化条件
      await this.tryChristallize(existing)
    } else {
      // 创建新成长向量
      await this.createVector(agentId, area, evidence)
    }
  }

  private async tryChristallize(vector: GrowthVector): Promise<void> {
    const ageInDays = (Date.now() - vector.firstObserved) / 86400000
    if (
      ageInDays >= this.CRYSTALLIZATION_THRESHOLD_DAYS &&
      vector.evidenceCount >= this.MIN_EVIDENCE_FOR_CRYSTALLIZATION &&
      vector.status === 'active'
    ) {
      await this.db.prepare(`
        UPDATE growth_vectors
        SET status = 'crystallized', crystallized_at = ?
        WHERE id = ?
      `).run(Date.now(), vector.id)
    }
  }
}
```

### 4.9 混合搜索架构

EvoClaw 的记忆搜索统一入口，融合 FTS5 全文检索、sqlite-vec 向量检索、facts 结构化查询和 memories 关键词匹配。

```
memory_search(query, systems: "facts,memories,vectors,fts")
    │
    ├── FTS5 全文检索 (30% 权重)
    │   └── facts_fts + chunks_fts 联合查询
    │
    ├── sqlite-vec 向量检索 (70% 权重)
    │   └── memory_embeddings + chunk_embeddings KNN 查询
    │
    ├── facts 表结构化查询
    │   └── entity_name / relation_type 精确匹配
    │
    └── memories 表关键词匹配
        └── type + category 过滤
    │
    ▼
    RRF 融合排序 → Top-K 结果
```

```typescript
interface MemorySearchOptions {
  query: string
  agentId: string
  systems: ('facts' | 'memories' | 'vectors' | 'fts')[]
  topK: number
  sessionType?: 'dm' | 'group'  // 控制记忆可见性
}

class HybridSearcher {
  async search(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const results: Map<string, ScoredResult> = new Map()

    // 并行执行各搜索系统
    const [ftsResults, vecResults, factResults, memResults] = await Promise.all([
      options.systems.includes('fts')
        ? this.ftsSearch(options.query, options.agentId)
        : [],
      options.systems.includes('vectors')
        ? this.vectorSearch(options.query, options.agentId)
        : [],
      options.systems.includes('facts')
        ? this.factSearch(options.query, options.agentId, options.sessionType)
        : [],
      options.systems.includes('memories')
        ? this.memorySearch(options.query, options.agentId)
        : [],
    ])

    // RRF (Reciprocal Rank Fusion) 融合排序
    this.applyRRF(results, ftsResults, 0.3)   // FTS5 权重 30%
    this.applyRRF(results, vecResults, 0.7)   // 向量权重 70%
    this.mergeStructuredResults(results, factResults)
    this.mergeStructuredResults(results, memResults)

    // 按综合分数排序，取 Top-K
    return Array.from(results.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, options.topK)
  }

  private applyRRF(
    results: Map<string, ScoredResult>,
    ranked: RankedItem[],
    weight: number,
    k: number = 60
  ): void {
    ranked.forEach((item, rank) => {
      const rrf = weight / (k + rank + 1)
      const existing = results.get(item.id)
      if (existing) {
        existing.score += rrf
      } else {
        results.set(item.id, { ...item, score: rrf })
      }
    })
  }
}
```

### 4.10 Session Key 路由

SessionRoutingMiddleware 根据消息来源生成 Session Key，决定记忆可见性和隔离策略。

```typescript
interface SessionContext {
  type: 'dm' | 'group'
  channel: string          // 'desktop' | 'feishu' | 'wecom' | 'qq'
  peerId?: string          // 私聊对方 ID
  groupId?: string         // 群聊 ID
}

// Session Key 生成策略
function generateSessionKey(
  agentId: string,
  channel: string,
  context: SessionContext
): string {
  if (context.type === 'dm') {
    return `agent:${agentId}:${channel}:dm:${context.peerId}`
  }
  if (context.type === 'group') {
    return `agent:${agentId}:${channel}:group:${context.groupId}`
  }
  return `agent:${agentId}:desktop:main`  // 桌面端默认
}

class SessionRoutingMiddleware implements Middleware {
  name = 'SessionRoutingMiddleware'

  async before(ctx: ChatContext): Promise<ChatContext> {
    const sessionContext = this.resolveSessionContext(ctx)
    const sessionKey = generateSessionKey(
      ctx.agentId,
      sessionContext.channel,
      sessionContext
    )

    return {
      ...ctx,
      sessionKey,
      sessionType: sessionContext.type,
      // 设置记忆可见性标志
      memoryVisibility: this.getMemoryVisibility(sessionContext),
    }
  }

  private getMemoryVisibility(ctx: SessionContext): MemoryVisibility {
    if (ctx.type === 'group') {
      return {
        soulMd: true,
        memoryMd: false,       // 群聊不加载 MEMORY.md
        dailyLogs: false,      // 群聊不加载每日日志
        facts: 'public-only',  // 仅公开 facts
        vectors: 'restricted', // 受限范围
      }
    }
    return {
      soulMd: true,
      memoryMd: true,
      dailyLogs: true,
      facts: 'full',
      vectors: 'full',
    }
  }
}
```

### 4.11 记忆安全隔离矩阵

| 记忆类型 | 桌面私聊 | Channel 私聊 | Channel 群聊 |
|---|---|---|---|
| SOUL.md (L1) | 加载 | 加载 | 加载 |
| MEMORY.md (L2) | 加载 | 加载 | **不加载** |
| Daily Logs (L3) | 加载 | 加载 | **不加载** |
| facts 表 (L4) | 查询 | 查询 | 仅公开 facts |
| 向量检索 (L5) | 可用 | 可用 | 受限范围 |

**设计原则**：群聊场景下，Agent 不应暴露用户的私密偏好和个人记忆，仅展示公共身份和知识。

### 4.12 Hebbian 衰减机制

```typescript
class DecayManager {
  private readonly DECAY_RATE = 0.95        // 每日衰减系数
  private readonly HOT_THRESHOLD = 0.7
  private readonly WARM_THRESHOLD = 0.3
  private readonly ACTIVATION_BOOST = 0.3   // 被引用时的激活增量

  // 定时任务：每日凌晨 3:00 执行
  async runDailyDecay(): Promise<void> {
    // 1. 批量衰减所有 facts
    this.db.prepare(`
      UPDATE facts
      SET decay_score = decay_score * ?,
          activation = CASE
            WHEN decay_score * ? > ? THEN 'hot'
            WHEN decay_score * ? > ? THEN 'warm'
            ELSE 'cool'
          END,
          updated_at = ?
      WHERE superseded_at IS NULL
    `).run(
      this.DECAY_RATE, this.DECAY_RATE, this.HOT_THRESHOLD,
      this.DECAY_RATE, this.WARM_THRESHOLD, Date.now()
    )

    // 2. 批量衰减 memories 表
    this.db.prepare(`
      UPDATE memories
      SET decay_score = decay_score * ?,
          activation = CASE
            WHEN decay_score * ? > ? THEN 'hot'
            WHEN decay_score * ? > ? THEN 'warm'
            ELSE 'cool'
          END,
          updated_at = ?
    `).run(
      this.DECAY_RATE, this.DECAY_RATE, this.HOT_THRESHOLD,
      this.DECAY_RATE, this.WARM_THRESHOLD, Date.now()
    )
  }

  // 被引用时激活
  async activateFact(factId: string): Promise<void> {
    this.db.prepare(`
      UPDATE facts
      SET decay_score = MIN(1.0, decay_score + ?),
          activation = 'hot',
          updated_at = ?
      WHERE id = ?
    `).run(this.ACTIVATION_BOOST, Date.now(), factId)
  }
}
```

衰减策略总结：

```
定时任务（每日凌晨 3:00）:
  1. Hot facts (decay_score > 0.7) → 保持高检索权重
  2. Warm facts (0.3 < decay_score <= 0.7) → 降低检索优先级
  3. Cool facts (decay_score <= 0.3) → 降低检索权重（不删除）

  衰减公式: new_score = old_score * 0.95  (每日)
  激活: 被引用时 score = min(1.0, score + 0.3)

  注意: Cool facts 不会被物理删除，遵循"记忆无损"原则
```

---

## 5. 数据架构

### 5.1 数据库 Schema

```sql
-- ==========================================
-- 核心表
-- ==========================================

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  soul_content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  session_key TEXT NOT NULL,              -- Session Key（路由标识）
  channel TEXT DEFAULT 'desktop',         -- desktop|feishu|wecom|qq
  channel_session_id TEXT,                -- 平台侧会话 ID
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model_id TEXT,
  token_count INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- ==========================================
-- 记忆与进化
-- ==========================================

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,                     -- preference|knowledge|correction
  category TEXT,
  key TEXT,
  value TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  observed_count INTEGER DEFAULT 1,
  source TEXT NOT NULL,
  activation TEXT DEFAULT 'hot',          -- hot|warm|cool
  decay_score REAL DEFAULT 1.0,           -- 0.0 - 1.0
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- LCM 摘要表（构成 DAG）
CREATE TABLE summaries (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  parent_id TEXT,                         -- 父摘要 ID（构成 DAG）
  depth INTEGER DEFAULT 0,               -- 摘要深度（0=叶子）
  content TEXT NOT NULL,
  source_message_ids TEXT,               -- JSON array of original message IDs
  token_count INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (parent_id) REFERENCES summaries(id)
);

-- 知识图谱
CREATE TABLE facts (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  entity_type TEXT,                       -- person|project|concept|tool|preference
  relation_type TEXT,                     -- knows|uses|prefers|dislikes|works_on
  target_entity TEXT,
  content TEXT,
  activation TEXT DEFAULT 'hot',          -- hot|warm|cool
  decay_score REAL DEFAULT 1.0,
  importance REAL DEFAULT 0.5,
  superseded_at INTEGER,                  -- 被新事实替代的时间
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- 知识图谱全文检索索引
CREATE VIRTUAL TABLE facts_fts USING fts5(
  entity_name, target_entity, content,
  content='facts', content_rowid='rowid'
);

-- 成长向量
CREATE TABLE growth_vectors (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  area TEXT NOT NULL,                     -- 成长领域
  direction TEXT NOT NULL,                -- 成长方向描述
  priority TEXT DEFAULT 'medium',         -- high|medium|low
  status TEXT DEFAULT 'active',           -- active|crystallized|archived
  evidence_count INTEGER DEFAULT 0,
  first_observed INTEGER NOT NULL,
  last_observed INTEGER NOT NULL,
  crystallized_at INTEGER,                -- 结晶化时间（>30天门控）
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE capability_scores (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  score REAL NOT NULL,
  trend TEXT DEFAULT 'stable',
  evidence TEXT,                          -- JSON
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  UNIQUE(agent_id, dimension)
);

CREATE TABLE capability_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  score REAL NOT NULL,
  recorded_at INTEGER NOT NULL
);

CREATE TABLE evolution_log (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT,
  impact_dimensions TEXT,
  impact_score_delta REAL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  comment TEXT,
  processed INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

-- ==========================================
-- Skill 管理
-- ==========================================

CREATE TABLE installed_skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  source TEXT NOT NULL,
  capabilities TEXT NOT NULL,             -- JSON array
  permissions TEXT NOT NULL,              -- JSON array
  security_score REAL,
  signature_verified INTEGER DEFAULT 0,
  installed_at INTEGER NOT NULL
);

CREATE TABLE agent_skills (
  agent_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  usage_count INTEGER DEFAULT 0,
  last_used_at INTEGER,
  PRIMARY KEY (agent_id, skill_id)
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

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT,
  action TEXT NOT NULL,
  category TEXT NOT NULL,
  resource TEXT,
  result TEXT NOT NULL,
  details TEXT,
  created_at INTEGER NOT NULL
);

-- ==========================================
-- 知识库
-- ==========================================

CREATE TABLE knowledge_bases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  knowledge_base_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  chunk_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  token_count INTEGER,
  created_at INTEGER NOT NULL
);

-- 向量索引 (SQLite-vec) — RAG 知识库
CREATE VIRTUAL TABLE chunk_embeddings USING vec0(
  chunk_id TEXT PRIMARY KEY,
  embedding FLOAT[1536]                   -- text-embedding-3-small 维度
);

-- 向量索引 (SQLite-vec) — 记忆向量
CREATE VIRTUAL TABLE memory_embeddings USING vec0(
  memory_id TEXT PRIMARY KEY,
  embedding FLOAT[1536]
);

-- 全文搜索索引 — 知识库
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content, content='chunks', content_rowid='rowid'
);

CREATE TABLE agent_knowledge_bases (
  agent_id TEXT NOT NULL,
  knowledge_base_id TEXT NOT NULL,
  PRIMARY KEY (agent_id, knowledge_base_id)
);

-- ==========================================
-- Channel
-- ==========================================

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                     -- feishu|wecom|qq
  name TEXT NOT NULL,
  config TEXT NOT NULL,                   -- JSON (加密存储连接配置)
  status TEXT DEFAULT 'disconnected',     -- connected|disconnected|error
  connected_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE channel_mappings (
  channel_id TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,          -- 平台用户 ID
  agent_id TEXT NOT NULL,                 -- 绑定的 Agent
  created_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, channel_user_id)
);

-- ==========================================
-- 模型 & 协作
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

CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  steps TEXT NOT NULL,
  edges TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_step TEXT,
  results TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);
```

### 5.2 文件系统布局

```
~/.evoclaw/                             # 应用根目录
├── config.json                         # 全局配置（加密）
├── evoclaw.db                          # SQLite 主数据库（SQLCipher 加密）
├── evoclaw-vec.db                      # SQLite-vec 向量数据库
├── agents/
│   └── {agent-id}/
│       ├── SOUL.md                     # 人格定义（L1 Always-Loaded）
│       ├── IDENTITY.md                 # 身份扩展（L1 可选）
│       ├── MEMORY.md                   # 策划性长期记忆（L2）
│       ├── memory/                     # 情景记忆目录
│       │   ├── 2026-03-10.md           # 每日日志（L3）
│       │   ├── 2026-03-11.md
│       │   └── ...
│       └── workspace/
├── knowledge/
│   └── {kb-id}/
│       ├── originals/
│       └── index/
├── skills/
│   └── {skill-id}/
│       └── ...
├── logs/                               # 加密日志
│   ├── audit.log
│   └── app.log
└── cache/
    └── embeddings/
```

### 5.3 数据迁移策略

```typescript
// 版本号递增迁移
// packages/core/src/infrastructure/db/migrations/
// 001_initial.sql
// 002_add_channels.sql
// 003_add_summaries.sql          -- LCM 摘要 DAG
// 004_add_facts.sql              -- 知识图谱
// 005_add_growth_vectors.sql     -- 成长向量
// 006_extend_memories.sql        -- memories 表添加 activation + decay_score

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
│       │   │       ├── sandbox.rs
│       │   │       ├── keychain.rs
│       │   │       ├── crypto.rs
│       │   │       └── signature.rs
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
│   │   │   ├── application/        # 应用层 (中间件链、服务)
│   │   │   ├── domain/             # 领域层 (Agent、Memory、Evolution)
│   │   │   ├── infrastructure/     # 基础设施层 (DB、Model、Channel)
│   │   │   └── server.ts           # HTTP 服务入口 (Hono)
│   │   └── package.json
│   ├── model-providers/            # 模型 Provider (基于 Vercel AI SDK)
│   │   ├── src/
│   │   │   ├── openai.ts
│   │   │   ├── anthropic.ts
│   │   │   ├── deepseek.ts
│   │   │   ├── minimax.ts
│   │   │   ├── glm.ts
│   │   │   ├── doubao.ts
│   │   │   ├── qwen.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── channels/                   # Channel 适配器
│   │   ├── src/
│   │   │   ├── adapter.ts          # 抽象接口
│   │   │   ├── feishu.ts           # 飞书
│   │   │   ├── wecom.ts            # 企业微信
│   │   │   ├── qq.ts               # QQ
│   │   │   └── normalizer.ts       # 消息标准化
│   │   └── package.json
│   ├── mcp-bridge/                 # MCP 协议桥接
│   │   └── package.json
│   ├── skill-runtime/              # Skill 运行时
│   │   └── package.json
│   ├── rag/                        # RAG 引擎
│   │   ├── src/
│   │   │   ├── ingestion.ts
│   │   │   ├── chunker.ts
│   │   │   ├── embedder.ts
│   │   │   └── retriever.ts
│   │   └── package.json
│   └── shared/                     # 共享类型和工具
│       ├── src/
│       │   ├── types/
│       │   ├── utils/
│       │   └── constants/
│       └── package.json
└── tools/
    ├── scripts/
    └── templates/                  # Agent/Skill 模板
```

### 6.2 包依赖关系图

```
apps/desktop
  ├── packages/core          (Node.js Sidecar)
  └── packages/shared        (共享类型)

packages/core
  ├── packages/model-providers
  ├── packages/channels
  ├── packages/mcp-bridge
  ├── packages/skill-runtime
  ├── packages/rag
  └── packages/shared

packages/model-providers
  └── packages/shared

packages/channels
  └── packages/shared

packages/rag
  └── packages/shared
```

### 6.3 构建与发布流程

```
开发:
  pnpm dev              → Tauri dev (热重载前端 + Sidecar)
  pnpm dev:core         → 仅核心引擎开发
  pnpm test             → Vitest 全量测试
  pnpm lint             → Oxlint 检查

构建:
  pnpm build            → 全量构建
  pnpm build:desktop    → Tauri 桌面应用构建

发布:
  pnpm release:mac      → macOS DMG/App (Universal)
  pnpm release:win      → Windows MSI/NSIS
  pnpm release:linux    → AppImage/deb/rpm
```

---

## 7. 安全架构

### 7.1 威胁模型（基于 OpenClaw 已知漏洞的防御）

| OpenClaw 漏洞 | 威胁描述 | EvoClaw 防御方案 |
|---------------|----------|------------------|
| **ClawJacked (WebSocket 劫持)** | 恶意网站劫持本地 Agent | 不对外暴露 WebSocket；Sidecar 仅监听 localhost，Tauri 进程管理 |
| **明文凭证存储** | API Key 明文存储 | Rust Plugin 通过系统 Keychain 存储，内存中使用后清零 |
| **ClawHub 恶意 Skill** | 20% 恶意 Skill | 签名验证(Rust) + 静态分析 + 沙箱试运行(Rust) 三重防线 |
| **认证绕过 (93.4%)** | 外部未认证访问 | Sidecar 仅绑定 127.0.0.1 + 随机端口 + 启动 Token 认证 |
| **公开暴露 (3万+)** | 被互联网发现和攻击 | 无公网监听端口；Channel 消息通过平台 SDK 推送 |
| **记忆泄露** | 群聊场景暴露个人记忆 | 记忆安全隔离矩阵（见第 4.11 节） |

### 7.2 数据流安全分析

```
┌─────────────────────────────────────────────────────────────┐
│                       数据流安全                              │
│                                                             │
│  用户输入 ──→ UI (WebView) ──→ HTTP ──→ Node.js Sidecar     │
│                                  │  (localhost + token)     │
│                       ┌──────────┼──────────┐               │
│                       │          │          │                │
│                       ▼          ▼          ▼                │
│                 ┌──────────┐ ┌───────┐ ┌──────────┐         │
│                 │ SQLite   │ │ Model │ │ Channel  │         │
│                 │ (加密)   │ │ API   │ │ 平台 API │         │
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

### 7.3 Sidecar 安全策略

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
| 对话首 Token | <2s | 上下文组装 + 中间件链 | 记忆预加载；中间件并行化（无依赖的并行执行） |
| RAG 检索 | <500ms | 向量搜索 + FTS5 | 索引预热；查询结果缓存 |
| 混合记忆搜索 | <100ms | FTS5 + sqlite-vec + facts | 并行查询各系统；RRF 融合 |
| LCM 压缩 | <3s | LLM 摘要调用 | 使用低成本模型；批量压缩 |
| 记忆蒸馏 | 后台 <5s | LLM 调用 | 异步后置中间件，不阻塞响应 |
| Metabolism 事实提取 | 后台 <5s | LLM 调用 | 异步后置，与蒸馏并行 |
| Channel 消息 | <1s 接收处理 | SDK 长轮询/WebSocket | 独立线程处理 Channel 消息 |
| Skill 安装 | <30s | 下载 + Rust 签名验证 + 沙箱 | 并行执行验证步骤 |
| Hebbian 衰减 | 后台 <2s | 批量 UPDATE | 定时任务凌晨执行；SQLite WAL 模式 |

### 8.2 缓存策略

```
L1: 内存缓存 (Node.js 进程内)
  · 活跃 Agent SOUL 解析结果
  · 权限判定缓存
  · 最近 RAG 检索结果
  · Hot facts 缓存
  · Session Key → 会话映射
  TTL: 会话级

L2: SQLite 缓存表
  · 嵌入向量缓存
  · 记忆蒸馏结果缓存
  · Skill 搜索结果缓存
  · LCM 摘要链缓存
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
  // 对话完成后（各后置中间件并行触发）
  afterChat: [
    'memoryFlush',            // Pre-compaction memory flush
    'memoryDistillation',     // 记忆蒸馏（EvolutionMiddleware）
    'metabolismExtraction',   // 事实提取（MetabolismMiddleware）
    'capabilityUpdate',       // 能力图谱更新
    'evolutionLog',           // 进化日志写入
    'growthTracking',         // 成长向量追踪
  ],

  // 定时任务
  scheduled: [
    { task: 'hebbianDecay', cron: '0 3 * * *' },         // 每日凌晨 3:00
    { task: 'weeklyReport', cron: '0 9 * * 1' },         // 每周一 9:00
    { task: 'memoryConsolidation', cron: '0 3 * * *' },  // 每日凌晨 3:00
    { task: 'cacheCleanup', cron: '0 4 * * 0' },         // 每周日 4:00
    { task: 'growthCrystallization', cron: '0 5 1 * *' }, // 每月 1 号 5:00
  ],

  // 文件系统监听
  fileWatcher: [
    'knowledgeBaseReindex',   // 知识库文件变更时重新索引
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
│     · 启动沙箱 Plugin                │
│                                      │
│  2. 启动 Node.js Sidecar             │
│     · 生成随机端口 + Token           │
│     · 启动 Core 服务                 │
│     · 等待健康检查通过               │
│     · 初始化记忆引擎（8 层）          │
│     · 启动 Hebbian 衰减定时器        │
│                                      │
│  3. 打开 WebView                     │
│     · 加载 React 前端                │
│     · 连接 Sidecar 后端              │
│                                      │
│  4. 启动 Channel Manager             │
│     · 重连已配置的 Channel           │
│     · 初始化 Session 路由表          │
│                                      │
│  用户感知: 一个应用，双击即用          │
└──────────────────────────────────────┘
```

### 9.2 打包方案

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

### 9.3 自动更新

```
应用启动
    │
    ▼
检查更新 (GitHub Releases / 自建 CDN)
    │
    ├── 无更新 → 正常运行
    └── 有更新
           │
           ▼
      下载差量更新包 → 验证签名 (Ed25519)
           │
           ▼
      通知用户 → "发现新版本 v0.2.0，是否更新？"
           │
      ┌────┴────┐
      │立即更新 │ → 安装重启
      │稍后提醒 │ → 下次启动再提醒
      └────────┘
```

### 9.4 未来移动端预留

```
当前架构已为移动端预留:

packages/core/            ← 纯 TypeScript，可移植
packages/shared/          ← 共享类型，跨平台复用
packages/model-providers/ ← 模型接口统一
packages/channels/        ← Channel 适配器可复用

未来路径:
· React Native + packages/core (最大复用)
· 或 iOS Swift / Android Kotlin + core 通过 HTTP API 调用
```

---

## 附录 A：关键技术决策记录 (ADR)

### ADR-001: Tauri + Node.js Sidecar（方案 B）

- **决策**: Tauri 管 UI + Rust 安全层，Node.js 作为 Sidecar 跑核心业务
- **理由**: Tauri 原生性能 + Rust 安全层；Node.js 完整生态 + MCP/AI SDK 原生支持
- **替代方案 A (全 Tauri)**: Tauri 内嵌 Node 不成熟
- **替代方案 C (Electron)**: 体积臃肿，内存占用高
- **风险**: 两进程间通信有开销
- **缓解**: localhost HTTP + 启动 Token，延迟 <1ms

### ADR-002: 自研 Agent Runtime + Vercel AI SDK

- **决策**: 自研 Agent 编排（中间件链 + 进化引擎），模型调用使用 Vercel AI SDK
- **理由**: LangChain 是 Python 生态；LangChain.js 过重；进化引擎无现成框架；Vercel AI SDK 轻量现代
- **借鉴**: DeerFlow 中间件链模式
- **自研范围**: 中间件链、进化引擎、记忆蒸馏、能力图谱、LCM 压缩器、Metabolism 引擎
- **复用范围**: Vercel AI SDK（模型调用）、MCP SDK（工具集成）

### ADR-003: TypeScript + Rust 混合开发

- **决策**: 业务逻辑用 TypeScript，安全关键路径用 Rust
- **Rust 负责**: 加密解密、Keychain 集成、沙箱引擎、签名验证、文件系统监控
- **TypeScript 负责**: Agent 引擎、进化引擎、记忆引擎、模型适配、RAG、Channel、UI
- **理由**: 日常迭代最多的业务逻辑用 TS 高效开发；安全层用 Rust 杜绝内存安全问题

### ADR-004: 不暴露公网端口

- **决策**: Sidecar 仅绑定 127.0.0.1 + 随机端口 + Token 认证
- **理由**: 从根本上消除 OpenClaw 的 ClawJacked 类攻击面
- **Channel 消息**: 通过平台 SDK 主动拉取/WebSocket 推送，不需要 Webhook 公网回调
  - 飞书/企微: 长轮询 或 WebSocket 推送
  - QQ: QQ 开放平台 WebSocket

### ADR-005: 不支持本地模型

- **决策**: 移除本地模型（llama.cpp/ollama）和离线模式
- **理由**: 部署本地模型门槛太高（4-8GB 下载、GPU 配置）与"零门槛"定位矛盾
- **替代**: 提供 7 家云端 Provider，含多家价格极低的国产模型（DeepSeek 等）
- **未来**: 如本地模型部署体验成熟（如系统级 AI 运行时），可考虑重新引入

### ADR-006: 多层记忆架构

- **决策**: 采用 8 层记忆架构（L0-L7），借鉴 OpenClaw 记忆层思想，使用 EvoClaw 技术栈实现
- **理由**: 单一记忆存储无法满足多维度记忆需求（即时上下文、身份、情景、结构化知识、语义召回、成长追踪）
- **OpenClaw 借鉴**: LCM 无损压缩、MEMORY.md 安全边界、Hebbian 衰减机制
- **EvoClaw 适配**: 全部基于 better-sqlite3 + sqlite-vec + FTS5，不引入额外存储引擎
- **风险**: 8 层记忆增加系统复杂度
- **缓解**: 渐进式实现（MVP 先实现 L0-L2 + L4，后续迭代补充 L3/L5-L7）

### ADR-007: LCM 无损压缩

- **决策**: 使用摘要 DAG 替代简单截断/丢弃历史消息
- **理由**: 简单截断导致上下文断裂，用户体验差（Agent 突然"失忆"）；逐条丢弃浪费已有对话信息
- **实现**: summaries 表存储摘要 DAG，parent_id 构成层级关系，depth 标记摘要概括程度
- **LLM 调用**: 摘要生成通过 ModelRouter 调用用户已配置的 LLM Provider，优先使用低成本模型
- **Pre-compaction Flush**: 压缩前将重要信息写入 daily log + facts 表，确保关键信息不依赖上下文窗口
- **风险**: 摘要质量依赖 LLM 能力
- **缓解**: 保留原始消息 ID 引用，随时可追溯原文

### ADR-008: 单引擎记忆存储

- **决策**: better-sqlite3 + sqlite-vec + FTS5 覆盖全部存储需求（结构化数据、向量检索、全文搜索）
- **理由**: 保持零配置原则；单一存储引擎降低运维复杂度；SQLite WAL 模式提供足够的并发性能
- **不选 LanceDB**: 额外依赖，SQLite-vec 在万级规模下性能足够
- **不选 PostgreSQL**: 违反"双击即用"原则，需要额外安装数据库服务
- **不选 ElasticSearch/MeiliSearch**: 过重，FTS5 在当前规模下足够
- **风险**: 百万级数据时 sqlite-vec 性能瓶颈
- **缓解**: 预计单用户数据规模在万级以内；如需扩展可引入 HNSW 索引优化

---

> **文档版本**: v3.0 -- 新增多层记忆架构（L0-L7）、LCM 无损压缩、Session Key 路由、Metabolism 事实提取、Hebbian 衰减、混合搜索、记忆安全隔离矩阵；更新中间件链设计；新增 ADR-006/007/008
> **文档状态**: 已更新
> **下次评审**: 待定
