# EvoClaw 技术架构设计文档

> **文档版本**: v2.0
> **创建日期**: 2026-03-11
> **更新日期**: 2026-03-12
> **文档状态**: 已更新

---

## 目录

1. [架构总览](#1-架构总览)
2. [分层架构设计](#2-分层架构设计)
3. [核心子系统设计](#3-核心子系统设计)
4. [数据架构](#4-数据架构)
5. [Monorepo 工程结构](#5-monorepo-工程结构)
6. [安全架构](#6-安全架构)
7. [性能与可扩展性](#7-性能与可扩展性)
8. [部署架构](#8-部署架构)

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
│  │  │              请求处理中间件链 (借鉴 DeerFlow)         │  │  │
│  │  │  Permission → Context → Memory → Summarize → ...    │  │  │
│  │  └─────────────────────────┬───────────────────────────┘  │  │
│  │                            │                              │  │
│  │  ┌──────────┐ ┌──────────┐│┌──────────┐ ┌────────────┐  │  │
│  │  │ Agent    │ │ Evolution│││ Skill    │ │ RAG        │  │  │
│  │  │ Engine   │ │ Engine   │││ Manager  │ │ Engine     │  │  │
│  │  └──────────┘ └──────────┘│└──────────┘ └────────────┘  │  │
│  │                           │                              │  │
│  │  ┌──────────┐ ┌──────────┐│┌──────────────────────────┐  │  │
│  │  │ Model    │ │ Channel  │││ MCP Bridge               │  │  │
│  │  │ Router   │ │ Manager  │││ (@modelcontextprotocol)   │  │  │
│  │  └─────┬────┘ └─────┬────┘│└──────────────────────────┘  │  │
│  │        │             │     │                              │  │
│  └────────┼─────────────┼─────┼──────────────────────────────┘  │
│           │             │     │                                  │
├───────────┼─────────────┼─────┼──────────────────────────────────┤
│           │             │     │    基础设施                       │
│  ┌────────▼───┐ ┌──────▼──┐ ┌▼─────────┐ ┌─────────────────┐  │
│  │ Cloud LLM  │ │ IM APIs │ │ SQLite   │ │ SQLite-vec      │  │
│  │ Providers  │ │ 飞书    │ │ (加密)   │ │ (向量索引)      │  │
│  │ (7 家)     │ │ 企微    │ │          │ │                 │  │
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

### 1.3 技术选型决策表

| 维度 | 选型 | 理由 | 替代方案 | 不选原因 |
|------|------|------|----------|----------|
| **桌面框架** | Tauri 2.0 | 体积小（~15MB）、Rust 安全层、原生系统集成 | Electron | 体积臃肿（~150MB）、内存占用高 |
| **前端** | React 19 + TypeScript | 生态最大、人才最多、Tauri 完美支持 | Vue 3 / Svelte | React 在桌面应用场景更成熟 |
| **样式** | Tailwind CSS 4 | 原子化 CSS、零运行时 | CSS Modules | 开发效率较低 |
| **后端架构** | Node.js Sidecar | 完整 Node 生态 + Tauri 生命周期管理 | 全 Tauri IPC | Node 生态完整性无可替代 |
| **核心引擎** | TypeScript (Node.js ≥22) | 与前端共享类型、MCP SDK 原生 TS | Rust | 业务逻辑迭代速度优先 |
| **安全关键路径** | Rust (Tauri Plugin) | 加密/沙箱/签名 需要内存安全保证 | TypeScript | 安全敏感操作不应使用 GC 语言 |
| **模型调用** | Vercel AI SDK (`ai`) | 统一多 Provider 接口、流式、Tool Calling 内置 | LangChain.js | LangChain 过重、抽象层过多 |
| **Agent 框架** | 自研 + 中间件链 | 进化引擎无现有框架提供；中间件模式借鉴 DeerFlow | LangGraph | Python 生态，与 TS 不兼容 |
| **MCP 集成** | @modelcontextprotocol/sdk | 官方 TypeScript SDK | 自研适配层 | 降低维护成本 |
| **向量存储** | SQLite-vec | 嵌入式、零依赖、与 SQLite 共享连接 | LanceDB / ChromaDB | 额外依赖不必要 |
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
├── middleware/                 # 请求处理中间件链 (借鉴 DeerFlow)
│   ├── permission-middleware.ts    # 权限检查
│   ├── context-middleware.ts       # 上下文组装
│   ├── memory-middleware.ts        # 记忆注入
│   ├── summarization-middleware.ts # 长对话压缩
│   ├── rag-middleware.ts           # 知识库检索注入
│   ├── skill-middleware.ts         # Skill/Tool 注册
│   └── pipeline.ts                 # 中间件链编排
├── chat-service.ts             # 对话管理
├── agent-lifecycle.ts          # Agent 生命周期
├── agent-builder.ts            # 语义化创建引导
├── evolution-service.ts        # 进化编排
├── skill-manager.ts            # Skill 管理
├── knowledge-service.ts        # 知识库管理
├── collaboration-service.ts    # 多 Agent 协作
└── model-router.ts             # 模型路由
```

**中间件链设计**（借鉴 DeerFlow）：

```
用户消息
    │
    ▼
┌─────────────────────────┐
│  PermissionMiddleware    │ ← 权限检查（调用 Rust 安全层）
├─────────────────────────┤
│  ContextMiddleware       │ ← 组装 SOUL.md + 历史消息
├─────────────────────────┤
│  MemoryMiddleware        │ ← 注入相关记忆条目
├─────────────────────────┤
│  RAGMiddleware           │ ← 知识库语义检索，注入相关文档
├─────────────────────────┤
│  SummarizationMiddleware │ ← Token 接近上限时压缩历史
├─────────────────────────┤
│  SkillMiddleware         │ ← 注册可用 Tool/Skill
├─────────────────────────┤
│  GapDetectionMiddleware  │ ← 能力缺口检测（后置）
├─────────────────────────┤
│  EvolutionMiddleware     │ ← 记忆蒸馏 + 反馈处理（后置，异步）
└─────────────────────────┘
    │
    ▼
  Vercel AI SDK → 云端 LLM
```

```typescript
// 中间件接口
interface Middleware {
  name: string
  // 前置处理：在 LLM 调用前
  before?(ctx: ChatContext): Promise<ChatContext>
  // 后置处理：在 LLM 响应后（可异步）
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
    // 1. 顺序执行所有 before
    for (const mw of this.middlewares) {
      if (mw.before) ctx = await mw.before(ctx)
    }

    // 2. 调用 LLM
    const response = await this.callModel(ctx)

    // 3. 异步执行所有 after（不阻塞响应）
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
      .use(new PermissionMiddleware())
      .use(new ContextMiddleware())
      .use(new MemoryMiddleware())
      .use(new RAGMiddleware())
      .use(new SummarizationMiddleware())
      .use(new SkillMiddleware())
      .use(new GapDetectionMiddleware())
      .use(new EvolutionMiddleware())
  }

  async handleMessage(agentId: string, userMessage: string) {
    const ctx: ChatContext = {
      agentId,
      userMessage,
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
│   ├── memory-engine.ts    # 记忆引擎核心
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
│   └── migrations/         # Schema 迁移脚本
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

### 3.3 进化引擎 (Evolution Engine) — 核心差异化

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
//       + (positiveRate × 20)
//       - (correctionRate × 15)
//       + (skillCount × 5)
//       + (memoryCount × 2)
//       + (interactionFrequency × 3)
// 约束: 0 ≤ score ≤ 100
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

#### 混合检索

```
用户查询
    │
    ▼
┌──────────────────────────────────┐
│         混合检索 (Hybrid)         │
│                                  │
│  ┌────────────┐  ┌────────────┐  │
│  │ 向量检索    │  │ FTS5 检索   │  │
│  │ Top-20     │  │ Top-20     │  │
│  └─────┬──────┘  └─────┬──────┘  │
│        └───────┬───────┘         │
│                ▼                 │
│     ┌────────────────┐          │
│     │  RRF 融合排序   │          │
│     │  Top-5 结果     │          │
│     └────────────────┘          │
└──────────────────────────────────┘
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
│  │          消息标准化层 (MessageNormalizer)      │ │
│  │  · 统一消息格式 (text/file/image/card)       │ │
│  │  · 平台特性适配 (飞书卡片/企微模板)          │ │
│  │  · 会话上下文映射 (平台会话 → Agent 会话)    │ │
│  └─────────────────────┬───────────────────────┘ │
│                        │                         │
│                        ▼                         │
│              ChatService.handleMessage()         │
│              (与桌面端共用同一处理管道)            │
└──────────────────────────────────────────────────┘
```

**关键设计**：Channel 消息经过标准化后，复用与桌面端完全相同的中间件链和 Agent 引擎。Agent 的记忆、进化在所有 Channel 间共享。

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

// 统一调用
const result = await streamText({
  model: providers.deepseek('deepseek-chat'),
  messages: context.messages,
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

## 4. 数据架构

### 4.1 数据库 Schema

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
  channel TEXT DEFAULT 'desktop',       -- desktop|feishu|wecom|qq
  channel_session_id TEXT,              -- 平台侧会话 ID
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
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
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

-- 向量索引 (SQLite-vec)
CREATE VIRTUAL TABLE chunk_embeddings USING vec0(
  chunk_id TEXT PRIMARY KEY,
  embedding FLOAT[1536]                   -- text-embedding-3-small 维度
);

-- 全文搜索索引
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

### 4.2 文件系统布局

```
~/.evoclaw/                             # 应用根目录
├── config.json                         # 全局配置（加密）
├── evoclaw.db                          # SQLite 主数据库（SQLCipher 加密）
├── evoclaw-vec.db                      # SQLite-vec 向量数据库
├── agents/
│   └── {agent-id}/
│       ├── SOUL.md
│       ├── MEMORY.md                   # 人类可读视图
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

### 4.3 数据迁移策略

```typescript
// 版本号递增迁移
// packages/core/src/infrastructure/db/migrations/
// 001_initial.sql
// 002_add_channels.sql
// 003_xxx.sql

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

## 5. Monorepo 工程结构

### 5.1 包划分方案

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

### 5.2 包依赖关系图

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

### 5.3 构建与发布流程

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

## 6. 安全架构

### 6.1 威胁模型（基于 OpenClaw 已知漏洞的防御）

| OpenClaw 漏洞 | 威胁描述 | EvoClaw 防御方案 |
|---------------|----------|------------------|
| **ClawJacked (WebSocket 劫持)** | 恶意网站劫持本地 Agent | 不对外暴露 WebSocket；Sidecar 仅监听 localhost，Tauri 进程管理 |
| **明文凭证存储** | API Key 明文存储 | Rust Plugin 通过系统 Keychain 存储，内存中使用后清零 |
| **ClawHub 恶意 Skill** | 20% 恶意 Skill | 签名验证(Rust) + 静态分析 + 沙箱试运行(Rust) 三重防线 |
| **认证绕过 (93.4%)** | 外部未认证访问 | Sidecar 仅绑定 127.0.0.1 + 随机端口 + 启动 Token 认证 |
| **公开暴露 (3万+)** | 被互联网发现和攻击 | 无公网监听端口；Channel 消息通过平台 SDK 推送 |

### 6.2 数据流安全分析

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

### 6.3 Sidecar 安全策略

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

## 7. 性能与可扩展性

### 7.1 性能目标与瓶颈分析

| 操作 | 目标 | 潜在瓶颈 | 优化策略 |
|------|------|----------|----------|
| 应用启动 | <3s 冷 / <1s 热 | Sidecar 启动 + SQLite 连接 | Sidecar 预编译；延迟初始化非核心模块 |
| 对话首 Token | <2s | 上下文组装 + 中间件链 | 记忆预加载；中间件并行化（无依赖的并行执行） |
| RAG 检索 | <500ms | 向量搜索 + FTS5 | 索引预热；查询结果缓存 |
| 记忆蒸馏 | 后台 <5s | LLM 调用 | 异步后置中间件，不阻塞响应 |
| Channel 消息 | <1s 接收处理 | SDK 长轮询/WebSocket | 独立线程处理 Channel 消息 |
| Skill 安装 | <30s | 下载 + Rust 签名验证 + 沙箱 | 并行执行验证步骤 |

### 7.2 缓存策略

```
L1: 内存缓存 (Node.js 进程内)
  · 活跃 Agent SOUL 解析结果
  · 权限判定缓存
  · 最近 RAG 检索结果
  TTL: 会话级

L2: SQLite 缓存表
  · 嵌入向量缓存
  · 记忆蒸馏结果缓存
  · Skill 搜索结果缓存
  TTL: 24 小时

L3: 文件系统缓存
  · 文档解析缓存
  TTL: 7 天
```

### 7.3 异步处理

```typescript
// 不阻塞用户交互的后台任务
const backgroundTasks = {
  // 对话完成后 (EvolutionMiddleware.after)
  afterChat: [
    'memoryDistillation',     // 记忆蒸馏
    'capabilityUpdate',       // 能力图谱更新
    'evolutionLog',           // 进化日志写入
  ],

  // 定时任务
  scheduled: [
    { task: 'weeklyReport', cron: '0 9 * * 1' },
    { task: 'memoryConsolidation', cron: '0 3 * * *' },
    { task: 'cacheCleanup', cron: '0 4 * * 0' },
  ],

  // 文件系统监听
  fileWatcher: [
    'knowledgeBaseReindex',   // 知识库文件变更时重新索引
  ],
}
```

---

## 8. 部署架构

### 8.1 一体化桌面应用

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
│                                      │
│  3. 打开 WebView                     │
│     · 加载 React 前端                │
│     · 连接 Sidecar 后端              │
│                                      │
│  4. 启动 Channel Manager             │
│     · 重连已配置的 Channel           │
│                                      │
│  用户感知: 一个应用，双击即用          │
└──────────────────────────────────────┘
```

### 8.2 打包方案

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

### 8.3 自动更新

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

### 8.4 未来移动端预留

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
- **自研范围**: 中间件链、进化引擎、记忆蒸馏、能力图谱
- **复用范围**: Vercel AI SDK（模型调用）、MCP SDK（工具集成）

### ADR-003: TypeScript + Rust 混合开发

- **决策**: 业务逻辑用 TypeScript，安全关键路径用 Rust
- **Rust 负责**: 加密解密、Keychain 集成、沙箱引擎、签名验证、文件系统监控
- **TypeScript 负责**: Agent 引擎、进化引擎、模型适配、RAG、Channel、UI
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

---

> **文档版本**: v2.0 -- 新增 Channel 系统、Tauri+Sidecar 架构、Vercel AI SDK、中间件链模式；移除本地模型/离线模式
> **文档状态**: 已更新
> **下次评审**: 待定
