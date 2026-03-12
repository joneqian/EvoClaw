# EvoClaw 技术架构设计文档

> **文档版本**: v1.0
> **创建日期**: 2026-03-11
> **文档状态**: 初版

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
│                      展示层 (Presentation)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ 对话界面  │  │ Agent    │  │ 进化仪表  │  │ 知识库/Skill  │  │
│  │ Chat UI  │  │ Builder  │  │ Dashboard │  │ 管理界面      │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬────────┘  │
│       └──────────────┴─────────────┴───────────────┘           │
│                          │ IPC (Tauri Commands)                 │
├──────────────────────────┼──────────────────────────────────────┤
│                      应用层 (Application)                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ 对话管理  │  │ Agent    │  │ 进化引擎  │  │ Skill 管理    │  │
│  │ Service  │  │ Lifecycle│  │ Evolution │  │ SkillManager  │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬────────┘  │
│       └──────────────┴─────────────┴───────────────┘           │
│                          │                                      │
├──────────────────────────┼──────────────────────────────────────┤
│                      领域层 (Domain)                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Agent    │  │ Memory   │  │ Capability│  │ Security      │  │
│  │ Core     │  │ Engine   │  │ Graph     │  │ Core          │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬────────┘  │
│       └──────────────┴─────────────┴───────────────┘           │
│                          │                                      │
├──────────────────────────┼──────────────────────────────────────┤
│                   基础设施层 (Infrastructure)                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │
│  │ SQLite  │ │ SQLite- │ │ Model   │ │ Sandbox │ │ Keychain│ │
│  │ Store   │ │ vec     │ │ Runtime │ │ Engine  │ │ Vault   │ │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                          │
│  │ MCP     │ │ File    │ │ Network │                          │
│  │ Bridge  │ │ System  │ │ Client  │                          │
│  └─────────┘ └─────────┘ └─────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 核心设计原则

| # | 原则 | 含义 | 来源/教训 |
|---|------|------|-----------|
| 1 | **安全默认 (Secure by Default)** | 所有安全机制出厂启用，不可完全关闭 | OpenClaw 明文凭证、93.4% 认证绕过的教训 |
| 2 | **离线优先 (Offline First)** | 核心功能无网可用，云端是增强而非依赖 | 与 ChatGPT Desktop 的关键差异 |
| 3 | **进化驱动 (Evolution Driven)** | 每次交互都是 Agent 进化的机会 | EvoClaw 核心品牌标识 |
| 4 | **最小权限 (Least Privilege)** | Agent/Skill 只获得完成任务所需的最小权限 | iOS 权限模型借鉴 |
| 5 | **本地为王 (Local First)** | 用户数据永不离开设备，除非用户主动发起 | OpenClaw 3万+ 暴露实例的教训 |
| 6 | **渐进增强 (Progressive Enhancement)** | 从简单可用开始，逐步解锁高级能力 | 降低上手门槛的产品策略 |
| 7 | **模型无关 (Model Agnostic)** | 不绑定任何 LLM Provider | DeerFlow 反射式模型工厂的经验 |

### 1.3 技术选型决策表

| 维度 | 选型 | 理由 | 替代方案 | 不选原因 |
|------|------|------|----------|----------|
| **桌面框架** | Tauri 2.0 | 原生性能、体积小（~10MB vs Electron ~150MB）、Rust 安全性 | Electron | 体积臃肿、内存占用高 |
| **前端** | React 19 + TypeScript | 生态最大、人才最多、Tauri 完美支持 | Vue 3 / Svelte | React 在桌面应用场景更成熟 |
| **样式** | Tailwind CSS 4 | 原子化 CSS、零运行时、与 React 配合良好 | CSS Modules | 开发效率较低 |
| **核心引擎** | TypeScript (Node.js ≥22) | PRD 约束、与前端共享类型、MCP SDK 原生 TypeScript | Rust | 开发效率优先，Tauri 已提供 Rust 安全层 |
| **Tauri 插件** | Rust (Tauri Plugin) | 安全敏感操作（加密、沙箱）用 Rust 实现 | 全 TypeScript | 安全关键路径需要 Rust 的内存安全 |
| **本地推理** | llama.cpp (通过 node-llama-cpp) | 跨平台、社区活跃、GGUF 格式支持 | Ollama | Ollama 需独立进程，增加部署复杂度 |
| **Apple 加速** | MLX (macOS 可选) | Apple Silicon 上性能 2-3x | 仅 llama.cpp | MLX 仅限 macOS，作为可选加速 |
| **向量存储** | SQLite-vec | 嵌入式、零依赖、与 SQLite 共享连接 | LanceDB / ChromaDB | 额外依赖，SQLite-vec 足以满足万级文档 |
| **结构化存储** | better-sqlite3 | 同步 API、Node 原生、高性能 | Drizzle ORM | 对 SQLite 直接操作更灵活 |
| **MCP 集成** | @modelcontextprotocol/sdk | 官方 SDK，TypeScript 原生 | 自研适配层 | 降低维护成本 |
| **IPC 通信** | Tauri Commands + Events | Tauri 原生 IPC，类型安全 | WebSocket / HTTP | 不必要的复杂度 |
| **加密** | libsodium (通过 sodium-native) | 行业标准、审计过的加密库 | Node.js crypto | libsodium API 更安全，不易误用 |
| **进程管理** | Tauri Sidecar | 管理 llama.cpp 等原生进程 | child_process | Tauri Sidecar 提供生命周期管理 |

---

## 2. 分层架构设计

### 2.1 展示层 (Presentation Layer)

**职责**：用户界面渲染、用户交互处理、状态呈现

```
packages/ui/
├── app/                    # 主应用路由
│   ├── chat/               # 对话界面
│   ├── builder/            # Agent 创建向导
│   ├── dashboard/          # 进化仪表盘
│   ├── knowledge/          # 知识库管理
│   ├── skills/             # Skill 市场/管理
│   ├── settings/           # 设置
│   └── security/           # 安全仪表盘
├── components/             # 共享 UI 组件
│   ├── chat/               # 消息气泡、输入框、反馈按钮
│   ├── charts/             # 雷达图、折线图、热力图
│   ├── permission/         # 权限弹窗组件
│   └── common/             # 按钮、卡片、模态框等
├── hooks/                  # React Hooks
├── stores/                 # 状态管理 (Zustand)
└── lib/                    # IPC 调用封装
```

**关键接口**：通过 Tauri Commands (IPC) 调用应用层

```typescript
// IPC 调用示例
interface TauriCommands {
  // 对话
  'chat:send': (agentId: string, message: string) => AsyncStream<ChatChunk>
  'chat:feedback': (messageId: string, type: 'up' | 'down', comment?: string) => void

  // Agent
  'agent:create-guided': (userInput: string) => AsyncStream<BuilderStep>
  'agent:list': () => AgentSummary[]
  'agent:get': (id: string) => AgentDetail

  // 进化
  'evolution:dashboard': (agentId: string) => DashboardData
  'evolution:log': (agentId: string, range: TimeRange) => EvolutionEntry[]

  // 安全
  'permission:request': (agentId: string, perm: Permission) => PermissionDecision
  'permission:list': (agentId: string) => PermissionGrant[]
}
```

### 2.2 应用层 (Application Layer)

**职责**：用例编排、跨领域协调、事务管理

```
packages/core/src/application/
├── chat-service.ts         # 对话管理：消息路由、流式响应、上下文组装
├── agent-lifecycle.ts      # Agent 生命周期：创建、启动、暂停、归档
├── agent-builder.ts        # 语义化创建引导：多轮对话 → SOUL.md + MEMORY.md
├── evolution-service.ts    # 进化编排：记忆沉淀、反馈处理、能力评估
├── skill-manager.ts        # Skill 管理：发现、安装、卸载、更新
├── knowledge-service.ts    # 知识库管理：摄取、索引、检索
├── collaboration-service.ts # 多 Agent 协作：工作流编排、消息路由
└── model-router.ts         # 模型路由：根据任务/网络/偏好选择模型
```

**关键协调逻辑**：

```typescript
// 对话服务编排示例（伪代码）
class ChatService {
  async handleMessage(agentId: string, userMessage: string) {
    // 1. 权限检查
    await this.security.validateSession(agentId)

    // 2. 上下文组装
    const context = await this.contextAssembler.build({
      soul: await this.agentRepo.getSoul(agentId),
      memory: await this.memoryEngine.getRelevant(agentId, userMessage),
      knowledge: await this.ragEngine.retrieve(agentId, userMessage),
      history: await this.chatRepo.getRecent(agentId, 20),
    })

    // 3. 模型路由
    const model = await this.modelRouter.select(agentId, userMessage)

    // 4. 流式推理
    const stream = model.stream(context, userMessage)

    // 5. 后置处理（异步，不阻塞响应）
    stream.onComplete(async (response) => {
      await this.evolutionEngine.distillMemory(agentId, userMessage, response)
      await this.capabilityGraph.updateFromInteraction(agentId, userMessage, response)
    })

    return stream
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
│   └── types.ts            # Agent 类型定义
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
└── collaboration/
    ├── workflow.ts          # 协作工作流 DAG
    ├── message-bus.ts       # Agent 间消息总线
    └── types.ts
```

### 2.4 基础设施层 (Infrastructure Layer)

**职责**：外部系统适配、数据持久化、系统资源访问

```
packages/core/src/infrastructure/
├── db/
│   ├── sqlite-store.ts     # SQLite 连接管理 + 结构化查询
│   ├── vector-store.ts     # SQLite-vec 向量操作
│   └── migrations/         # Schema 迁移脚本
├── model/
│   ├── provider-registry.ts # 模型 Provider 注册表
│   ├── cloud/
│   │   ├── anthropic.ts    # Claude API
│   │   ├── openai.ts       # GPT API
│   │   └── google.ts       # Gemini API
│   └── local/
│       ├── llama-cpp.ts    # llama.cpp 集成
│       └── mlx.ts          # MLX 集成 (macOS)
├── security/
│   ├── keychain.ts         # 系统 Keychain 适配
│   ├── sandbox.ts          # 沙箱执行引擎
│   ├── crypto.ts           # 加密/解密操作
│   └── signature.ts        # Skill 签名验证
├── mcp/
│   ├── mcp-bridge.ts       # MCP 协议桥接
│   └── adapters/           # 各 MCP Server 适配器
├── rag/
│   ├── ingestion.ts        # 文档摄取管道
│   ├── chunker.ts          # 文本分块器
│   ├── embedder.ts         # 嵌入生成器
│   └── retriever.ts        # 检索器
├── skill-registry/
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

```
┌─────────────────────────────────────────────┐
│              Permission Model                │
├─────────────────────────────────────────────┤
│                                             │
│  权限类别 (Category)                         │
│  ├── filesystem    文件系统读写              │
│  ├── network       网络访问                  │
│  ├── exec          系统命令执行              │
│  ├── clipboard     剪贴板访问                │
│  ├── notification  系统通知                  │
│  ├── keychain      凭证访问                  │
│  └── agent-comm    Agent 间通信              │
│                                             │
│  授权粒度 (Scope)                            │
│  ├── once          仅本次                    │
│  ├── session       本次会话                  │
│  ├── always        始终允许                  │
│  └── deny          始终拒绝                  │
│                                             │
│  资源限定 (Resource)                         │
│  ├── path: "/Users/*/Documents/**"          │
│  ├── domain: "api.anthropic.com"            │
│  └── command: "git *"                       │
│                                             │
└─────────────────────────────────────────────┘
```

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
│ 查询权限缓存     │
└────┬────────────┘
     │
     ├── 命中 "always allow" → 放行
     ├── 命中 "always deny"  → 拒绝
     ├── 命中 "session"      → 检查会话有效性 → 放行/弹窗
     └── 未命中              → 弹窗请求授权
                                    │
                              ┌─────┴─────┐
                              │ 用户决策   │
                              ├── 仅本次   │ → 放行，不缓存
                              ├── 始终允许 │ → 放行，持久化
                              ├── 始终拒绝 │ → 拒绝，持久化
                              └── 取消     │ → 拒绝，不缓存
```

#### 凭证管理架构

```
┌──────────────────────────────────────────────────┐
│                 Credential Vault                  │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌─────────────┐                                 │
│  │ Vault API   │  ← 唯一对外接口                 │
│  │ get / set   │                                 │
│  │ delete      │                                 │
│  └──────┬──────┘                                 │
│         │                                        │
│  ┌──────▼──────────────────────────────────────┐ │
│  │ Platform Keychain Adapter                   │ │
│  │ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │ │
│  │ │ macOS    │ │ Windows  │ │ Linux        │ │ │
│  │ │ Keychain │ │ Cred Mgr │ │ Secret Svc   │ │ │
│  │ └──────────┘ └──────────┘ └──────────────┘ │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  安全保证:                                        │
│  · 内存中凭证使用后立即清零                        │
│  · 日志中凭证自动脱敏 (****)                       │
│  · 进程间传递凭证使用 mTLS                         │
│                                                  │
└──────────────────────────────────────────────────┘
```

#### 沙箱执行引擎

```typescript
interface SandboxPolicy {
  filesystem: {
    readable: string[]     // 允许读取的路径 glob
    writable: string[]     // 允许写入的路径 glob
    denied: string[]       // 禁止访问的路径
  }
  network: {
    allowedDomains: string[]  // 允许的域名
    blockedDomains: string[]  // 禁止的域名
    maxConnections: number
  }
  exec: {
    allowedCommands: string[] // 允许的命令 glob
    maxDuration: number       // 最长执行时间 (ms)
    maxMemory: number         // 最大内存 (bytes)
  }
  resources: {
    maxCpuPercent: number
    maxFileSize: number
  }
}
```

**沙箱实现策略**：
- **macOS**: App Sandbox + `sandbox-exec` profile
- **Windows**: Windows Sandbox API / 受限 Job Object
- **Linux**: seccomp + namespaces
- **统一抽象层**: Tauri Plugin (Rust) 封装平台差异

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
│ 2. 验证数字签名      │  ← Ed25519 签名验证
│    (签名无效 → 拒绝) │     发布者公钥从 Registry 获取
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 3. 静态分析          │  ← 扫描代码中的危险模式
│    (网络请求/文件写入 │     (eval, fetch, fs.write 等)
│     是否与声明匹配)  │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 4. 沙箱试运行        │  ← 在受限沙箱中运行测试用例
│    (监控实际行为)     │     对比声明的 capabilities
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 5. 用户确认          │  ← 展示分析报告 + 安全评分
│    (显示所需权限)     │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 6. 安装 + 注册       │  ← 写入本地 Skill 注册表
│    (运行时行为审计)   │     启用运行时审计日志
└─────────────────────┘
```

### 3.2 Agent 引擎

#### Agent 生命周期

```
┌──────────┐    创建引导     ┌──────────┐    激活     ┌──────────┐
│ 不存在   │ ──────────────→ │ 草稿     │ ────────→  │ 活跃     │
│          │                 │ (Draft)  │            │ (Active) │
└──────────┘                 └──────────┘            └─────┬────┘
                                  ↑                        │
                            保存为草稿               ┌─────┴─────┐
                                  │                │            │
                             ┌────┴───┐      暂停  │     归档    │
                             │ 测试中  │ ←────────  │            │
                             │(Testing)│            ▼            ▼
                             └────────┘      ┌──────────┐ ┌──────────┐
                                             │ 暂停     │ │ 归档     │
                                             │(Paused)  │ │(Archived)│
                                             └──────────┘ └──────────┘
```

#### SOUL.md 数据模型

```typescript
interface Soul {
  // 基本信息
  name: string
  role: string            // 一句话角色描述
  avatar?: string         // 头像路径

  // 人格特质
  personality: {
    tone: 'formal' | 'friendly' | 'humorous' | 'concise'
    expertise: string[]   // 专长领域
    language: string[]    // 支持语言
  }

  // 行为约束
  constraints: {
    always: string[]      // 必须遵守的规则
    never: string[]       // 禁止的行为
  }

  // 交互风格
  interaction: {
    responseLength: 'short' | 'medium' | 'detailed'
    proactiveAsk: boolean     // 是否主动追问
    citeSources: boolean      // 是否引用来源
  }

  // 能力配置
  capabilities: {
    skills: string[]          // 已安装 Skill ID
    knowledgeBases: string[]  // 绑定的知识库 ID
    tools: string[]           // MCP 工具 ID
  }

  // 进化配置
  evolution: {
    memoryDistillation: boolean   // 是否自动沉淀记忆
    feedbackLearning: boolean     // 是否从反馈学习
    autoSkillDiscovery: boolean   // 是否自动发现 Skill
  }
}
```

#### MEMORY.md 数据模型

```typescript
interface Memory {
  // 用户偏好
  preferences: PreferenceEntry[]
  // 领域知识
  knowledge: KnowledgeEntry[]
  // 纠正记录
  corrections: CorrectionEntry[]
  // 进化快照
  snapshots: EvolutionSnapshot[]
}

interface PreferenceEntry {
  id: string
  category: string        // "coding_style" | "format" | "tone" | ...
  key: string             // "variable_naming"
  value: string           // "camelCase"
  confidence: number      // 0-1, 基于观察次数
  observedCount: number   // 被观察到的次数
  lastObserved: number    // 最后观察时间
  source: 'inferred' | 'explicit'  // 推断 vs 用户明确告知
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
  original: string        // Agent 原始回答
  corrected: string       // 用户纠正内容
  rule: string            // 提取的规则
  appliedCount: number    // 该规则被应用的次数
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
│  → "你想要什么类型的编程助手？前端/后端/全栈？" │
│  ← "主要写 TypeScript，前后端都做"            │
│                                              │
│  Phase 2: 专长深挖                            │
│  → "你主要用什么框架？React? Vue? Node?"      │
│  ← "React + Node.js + PostgreSQL"            │
│                                              │
│  Phase 3: 风格偏好                            │
│  → "你喜欢什么样的回答风格？详细解释还是直接？" │
│  ← "简洁直接，给代码就行"                     │
│                                              │
│  Phase 4: 行为约束                            │
│  → "有什么特别的要求或禁忌吗？"               │
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

**Builder 实现**: 使用一个专门的 "Builder Agent"（内置 LLM 提示词）驱动多轮对话，每轮提取结构化信息填充 Soul 模板。

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
│                    │ 进化评分引擎       │                     │
│                    └─────────┬─────────┘                     │
│                              │                               │
│                    ┌─────────▼─────────┐                     │
│                    │ Evolution Log     │                     │
│                    │ 进化日志           │                     │
│                    └──────────────────┘                      │
└──────────────────────────────────────────────────────────────┘
```

#### 记忆沉淀管道 (Memory Distillation Pipeline)

```
对话完成
    │
    ▼
┌─────────────────────┐
│ 1. 对话分析          │  ← LLM 分析本次对话
│    提取候选记忆       │     提示词："从以下对话中提取用户偏好、
│                     │     新知识、纠正信息"
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 2. 去重 & 合并       │  ← 与已有记忆对比
│    避免重复记忆       │     相似度 > 0.85 则合并而非新增
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ 3. 置信度计算        │  ← 首次观察: 0.3
│    多次观察提升置信度  │     再次确认: +0.2 (上限 0.95)
└─────────┬───────────┘     用户明确告知: 直接 0.9
          ▼
┌─────────────────────┐
│ 4. 写入 MEMORY.md   │  ← 结构化写入对应分类
│    更新能力图谱       │     同时更新 Capability Graph
└─────────────────────┘
```

**关键设计决策**：记忆蒸馏使用 LLM 而非规则引擎。理由：用户表达多样化，基于规则的提取覆盖率低（预估 <40%），LLM 提取准确率可达 80%+。成本通过以下方式控制：
- 仅在对话结束时批量处理（不是每条消息都触发）
- 优先使用本地小模型处理蒸馏任务
- 缓存重复模式，减少 LLM 调用次数

#### 反馈学习系统

```typescript
interface FeedbackEvent {
  messageId: string
  agentId: string
  type: 'thumbs_up' | 'thumbs_down' | 'correction'
  comment?: string           // 用户文字说明
  context: {
    userMessage: string      // 用户原始提问
    agentResponse: string    // Agent 回答
    topic: string            // 话题分类
  }
}

// 反馈处理流程
class FeedbackLoop {
  async processFeedback(event: FeedbackEvent) {
    if (event.type === 'thumbs_up') {
      // 正面反馈：强化当前行为模式
      await this.reinforcePattern(event)
    } else if (event.type === 'thumbs_down') {
      // 负面反馈：分析原因，生成纠正规则
      const analysis = await this.analyzeNegativeFeedback(event)
      await this.memory.addCorrection({
        original: event.context.agentResponse,
        corrected: analysis.suggestedImprovement,
        rule: analysis.extractedRule,
      })
    } else if (event.type === 'correction') {
      // 用户明确纠正：高置信度写入
      await this.memory.addCorrection({
        original: event.context.agentResponse,
        corrected: event.comment!,
        rule: await this.extractRule(event),
        confidence: 0.9,
      })
    }

    // 更新能力图谱
    await this.capabilityGraph.updateFromFeedback(event)
  }
}
```

#### 能力图谱 (Capability Graph)

```typescript
interface CapabilityGraph {
  agentId: string
  dimensions: CapabilityDimension[]
  lastUpdated: number
}

interface CapabilityDimension {
  name: string            // "typescript_coding" | "research" | "writing" | ...
  score: number           // 0-100
  trend: 'rising' | 'stable' | 'declining'
  evidence: {
    totalInteractions: number
    positiveRate: number  // 正面反馈率
    correctionRate: number // 被纠正的比率
    skillsUsed: string[]  // 使用的相关 Skill
  }
  history: { date: number; score: number }[]
}
```

**评分算法**：

```
score = baseScore
      + (positiveRate × 20)
      - (correctionRate × 15)
      + (skillCount × 5)
      + (memoryCount × 2)
      + (interactionFrequency × 3)

// 约束: 0 ≤ score ≤ 100
// baseScore: 新维度起始 50 分
// 每日衰减: 7 天无交互则 score -= 1/day (最低 30)
```

#### 进化日志数据模型

```typescript
interface EvolutionEntry {
  id: string
  agentId: string
  timestamp: number
  type: 'memory_added' | 'memory_merged' | 'skill_learned' | 'capability_change' | 'feedback_applied' | 'milestone'
  summary: string           // 人类可读摘要
  details: Record<string, unknown>
  impact: {
    dimensions: string[]    // 影响的能力维度
    scoreDelta: number      // 分数变化
  }
}

// 周报生成（每周一自动触发）
interface WeeklyReport {
  agentId: string
  weekStart: number
  weekEnd: number
  highlights: string[]       // "学会了 3 个新技能"
  memoriesAdded: number
  capabilityChanges: { dimension: string; from: number; to: number }[]
  topSkills: { name: string; usageCount: number }[]
  feedbackSummary: { positive: number; negative: number; corrections: number }
}
```

### 3.4 Skill/MCP 管理系统

#### 能力缺口检测

```
Agent 执行任务
    │
    ├── 成功 → 正常流程
    │
    └── 失败/质量差
           │
           ▼
    ┌────────────────────┐
    │ Gap Detector        │
    │                    │
    │ 分析失败原因:       │
    │ 1. 工具调用失败     │ → 缺少对应 Skill
    │ 2. 格式处理失败     │ → 缺少文件格式支持
    │ 3. 知识不足         │ → 可能需要知识库补充
    │ 4. 模型能力不足     │ → 需要更强模型
    │ 5. 纯质量问题       │ → 优化提示词/记忆
    │                    │
    │ 输出: GapAnalysis   │
    └─────────┬──────────┘
              ▼
    ┌────────────────────┐
    │ 是能力缺口?         │
    │                    │
    │ 是 → 触发 Skill    │
    │      Discovery     │
    │                    │
    │ 否 → 记录到进化日志 │
    └────────────────────┘
```

```typescript
interface GapAnalysis {
  taskDescription: string
  failureType: 'tool_missing' | 'format_unsupported' | 'knowledge_gap' | 'model_limit' | 'quality'
  confidence: number
  suggestedCapability: string   // "excel_parsing" | "pdf_reading" | ...
  searchQuery: string           // 用于搜索 Skill 的查询词
}
```

#### 多源 Registry 抽象层

```typescript
interface SkillSource {
  name: string
  search(query: string): Promise<SkillCandidate[]>
  download(id: string): Promise<SkillPackage>
  getMetadata(id: string): Promise<SkillMetadata>
}

interface SkillCandidate {
  id: string
  name: string
  description: string
  version: string
  source: string             // "npm" | "clawhub" | "skills.sh"
  rating: number             // 0-5
  downloads: number
  securityScore: number      // 0-100, 基于签名/审计/历史
  capabilities: string[]     // 提供的能力列表
  permissions: string[]      // 需要的权限列表
}
```

#### 安全安装管道

```
┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐
│Discovery│ →  │Verify  │ →  │Analyze │ →  │Sandbox │ →  │Confirm │ →  │Install │
│搜索候选 │    │签名验证 │    │静态分析 │    │试运行   │    │用户确认 │    │注册    │
└────────┘    └────────┘    └────────┘    └────────┘    └────────┘    └────────┘
                  │              │              │
                  ▼              ▼              ▼
              签名无效 →     发现危险      行为异常 →
              拒绝并告知     代码 → 警告   拒绝并告知
```

### 3.5 本地知识库 (RAG 引擎)

#### 文档摄取管道

```
文件导入
    │
    ▼
┌─────────────────┐
│ 1. 格式检测      │  ← mime-types 检测
│    & 解析器选择   │     .md → MarkdownParser
│                 │     .pdf → PDFParser (pdf-parse)
│                 │     .docx → DocxParser (mammoth)
│                 │     .txt → PlainTextParser
│                 │     .py/.ts → CodeParser (tree-sitter)
└────────┬────────┘
         ▼
┌─────────────────┐
│ 2. 文本提取      │  ← 提取纯文本 + 元数据
│    & 清洗        │     去除格式噪音、特殊字符
└────────┬────────┘
         ▼
┌─────────────────┐
│ 3. 智能分块      │  ← 策略见下方
│    Chunking      │
└────────┬────────┘
         ▼
┌─────────────────┐
│ 4. 嵌入生成      │  ← 本地: all-MiniLM-L6-v2 (via onnxruntime)
│    Embedding     │     云端: text-embedding-3-small (可选)
└────────┬────────┘
         ▼
┌─────────────────┐
│ 5. 向量写入      │  ← SQLite-vec INSERT
│    + 元数据索引   │     同时写入全文索引 (FTS5)
└─────────────────┘
```

#### 分块策略

```typescript
interface ChunkingConfig {
  strategy: 'fixed' | 'semantic' | 'recursive'
  maxChunkSize: 512        // tokens
  overlapSize: 50          // tokens
  respectBoundaries: true  // 尊重段落/标题边界
}

// 默认策略: recursive（递归分块）
// 1. 按标题分割 (# / ## / ###)
// 2. 超长段落按段落分割 (\n\n)
// 3. 超长段落按句子分割 (。/. /! /?)
// 4. 超长句子按固定大小分割
// 每个 chunk 包含:
//   - 文本内容
//   - 来源文件路径
//   - 标题层级上下文
//   - 在文档中的位置
```

#### SQLite-vec 存储方案

```sql
-- 文档表
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  knowledge_base_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_hash TEXT NOT NULL,       -- 用于增量更新检测
  chunk_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- 文本块表
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,                  -- JSON: {heading, position, ...}
  token_count INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id)
);

-- 向量索引 (SQLite-vec)
CREATE VIRTUAL TABLE chunk_embeddings USING vec0(
  chunk_id TEXT PRIMARY KEY,
  embedding FLOAT[384]           -- all-MiniLM-L6-v2 维度
);

-- 全文搜索索引 (FTS5) 用于混合检索
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content,
  content='chunks',
  content_rowid='rowid'
);
```

#### 检索与排序

```
用户查询
    │
    ▼
┌──────────────────────────────────┐
│         混合检索 (Hybrid)         │
│                                  │
│  ┌────────────┐  ┌────────────┐  │
│  │ 向量检索    │  │ 全文检索    │  │
│  │ (语义相似)  │  │ (关键词)   │  │
│  │ Top-20     │  │ Top-20     │  │
│  └─────┬──────┘  └─────┬──────┘  │
│        │               │         │
│        └───────┬───────┘         │
│                ▼                 │
│     ┌────────────────┐          │
│     │  RRF 融合排序   │          │
│     │  (Reciprocal    │          │
│     │   Rank Fusion)  │          │
│     └───────┬────────┘          │
│             ▼                   │
│     ┌────────────────┐          │
│     │  Top-5 结果     │          │
│     └────────────────┘          │
└──────────────────────────────────┘
    │
    ▼
  注入 LLM 上下文
```

### 3.6 多 Agent 协作

#### Agent 通信协议

```typescript
interface AgentMessage {
  id: string
  from: string              // 源 Agent ID
  to: string                // 目标 Agent ID
  type: 'task' | 'result' | 'query' | 'notification'
  payload: {
    content: string
    attachments?: Attachment[]
    metadata?: Record<string, unknown>
  }
  workflow_id?: string      // 所属工作流 ID
  step_id?: string          // 所属步骤 ID
  timestamp: number
}
```

#### 协作拓扑

```
管道模式 (Pipeline):
  Agent A → Agent B → Agent C → 最终结果

星形模式 (Star):
  Agent B ←─┐
  Agent C ←─┤── Lead Agent ──→ 合成结果
  Agent D ←─┘

DAG 模式 (有向无环图):
  Agent A ──→ Agent C ──┐
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
  input: string               // 输入描述/模板
  timeout: number
}

interface WorkflowEdge {
  from: string                // step ID
  to: string                  // step ID
  condition?: string          // 条件表达式
}
```

### 3.7 模型适配层

```
┌──────────────────────────────────────────────────┐
│                 Model Router                      │
│                                                  │
│  输入: 任务描述 + 网络状态 + 用户偏好 + 隐私级别   │
│                                                  │
│  路由策略:                                        │
│  ┌────────────────┐                              │
│  │ 离线?           │── 是 ──→ 本地模型            │
│  └───────┬────────┘                              │
│          │ 否                                    │
│  ┌───────▼────────┐                              │
│  │ 隐私敏感?       │── 是 ──→ 本地模型            │
│  └───────┬────────┘                              │
│          │ 否                                    │
│  ┌───────▼────────┐                              │
│  │ 简单任务?       │── 是 ──→ 本地模型 (省成本)   │
│  │ (分类/摘要/翻译)│                              │
│  └───────┬────────┘                              │
│          │ 否 (复杂任务)                          │
│  ┌───────▼────────┐                              │
│  │ 用户偏好模型?    │── 有 ──→ 指定云端模型        │
│  └───────┬────────┘                              │
│          │ 无                                    │
│          ▼                                       │
│    默认云端模型 (按 Agent SOUL 配置)               │
└──────────────────────────────────────────────────┘
```

```typescript
interface ModelProvider {
  id: string
  name: string
  type: 'cloud' | 'local'

  // 能力声明
  capabilities: {
    maxContextTokens: number
    supportedModalities: ('text' | 'image' | 'audio')[]
    streamingSupport: boolean
  }

  // 统一接口
  chat(messages: Message[], options: ChatOptions): AsyncIterable<ChatChunk>
  embed(texts: string[]): Promise<number[][]>

  // 健康检查
  isAvailable(): Promise<boolean>
}

// 模型 Provider 注册表
class ProviderRegistry {
  private providers: Map<string, ModelProvider> = new Map()

  register(provider: ModelProvider): void
  get(id: string): ModelProvider
  listAvailable(): ModelProvider[]

  // 任务复杂度评估（用于路由决策）
  estimateComplexity(task: string): 'simple' | 'moderate' | 'complex'
}
```

---

## 4. 数据架构

### 4.1 数据库 Schema

```sql
-- ==========================================
-- 核心表
-- ==========================================

-- Agent 表
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft|active|paused|archived
  soul_content TEXT NOT NULL,             -- SOUL.md 原始内容
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 对话表
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- 消息表
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,                     -- user|assistant|system
  content TEXT NOT NULL,
  model_id TEXT,                          -- 使用的模型
  token_count INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- ==========================================
-- 记忆与进化
-- ==========================================

-- 记忆条目表
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,                     -- preference|knowledge|correction
  category TEXT,
  key TEXT,
  value TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  observed_count INTEGER DEFAULT 1,
  source TEXT NOT NULL,                   -- inferred|explicit|knowledge_base
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- 能力图谱表
CREATE TABLE capability_scores (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  score REAL NOT NULL,
  trend TEXT DEFAULT 'stable',            -- rising|stable|declining
  evidence TEXT,                          -- JSON
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  UNIQUE(agent_id, dimension)
);

-- 能力历史表
CREATE TABLE capability_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  score REAL NOT NULL,
  recorded_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- 进化日志表
CREATE TABLE evolution_log (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT,                           -- JSON
  impact_dimensions TEXT,                 -- JSON array
  impact_score_delta REAL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- 反馈表
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,                     -- thumbs_up|thumbs_down|correction
  comment TEXT,
  processed INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- ==========================================
-- Skill 管理
-- ==========================================

-- 已安装 Skill 表
CREATE TABLE installed_skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  source TEXT NOT NULL,                   -- npm|clawhub|skills.sh
  capabilities TEXT NOT NULL,             -- JSON array
  permissions TEXT NOT NULL,              -- JSON array
  security_score REAL,
  signature_verified INTEGER DEFAULT 0,
  installed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Agent-Skill 关联表
CREATE TABLE agent_skills (
  agent_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  usage_count INTEGER DEFAULT 0,
  last_used_at INTEGER,
  PRIMARY KEY (agent_id, skill_id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (skill_id) REFERENCES installed_skills(id)
);

-- ==========================================
-- 安全
-- ==========================================

-- 权限授予表
CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  category TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT,
  granted_by TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  expires_at INTEGER,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- 审计日志表
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT,
  action TEXT NOT NULL,
  category TEXT NOT NULL,
  resource TEXT,
  result TEXT NOT NULL,                   -- allowed|denied|error
  details TEXT,
  created_at INTEGER NOT NULL
);

-- ==========================================
-- 知识库
-- ==========================================

-- 知识库表
CREATE TABLE knowledge_bases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- documents 和 chunks 表见 3.5 节

-- Agent-知识库关联表
CREATE TABLE agent_knowledge_bases (
  agent_id TEXT NOT NULL,
  knowledge_base_id TEXT NOT NULL,
  PRIMARY KEY (agent_id, knowledge_base_id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id)
);

-- ==========================================
-- 模型管理
-- ==========================================

-- 模型配置表
CREATE TABLE model_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                     -- cloud|local
  provider TEXT NOT NULL,                 -- anthropic|openai|google|llama.cpp|mlx
  model_id TEXT NOT NULL,                 -- claude-sonnet-4-20250514|gpt-4|...
  config TEXT,                            -- JSON (temperature, max_tokens, etc.)
  is_default INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- ==========================================
-- 协作
-- ==========================================

-- 工作流表
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  steps TEXT NOT NULL,                    -- JSON array of WorkflowStep
  edges TEXT NOT NULL,                    -- JSON array of WorkflowEdge
  created_at INTEGER NOT NULL
);

-- 工作流执行表
CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL,                   -- running|completed|failed|paused
  current_step TEXT,
  results TEXT,                           -- JSON
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id)
);
```

### 4.2 文件系统布局

```
~/.evoclaw/                             # 应用根目录
├── config.json                         # 全局配置（加密）
├── evoclaw.db                          # SQLite 主数据库（加密）
├── evoclaw-vec.db                      # SQLite-vec 向量数据库
├── agents/                             # Agent 数据目录
│   ├── {agent-id}/
│   │   ├── SOUL.md                     # 人格定义
│   │   ├── MEMORY.md                   # 记忆（人类可读视图）
│   │   └── workspace/                  # Agent 工作区
├── knowledge/                          # 知识库文件
│   ├── {kb-id}/
│   │   ├── originals/                  # 原始文件
│   │   └── index/                      # 索引缓存
├── skills/                             # 已安装 Skill
│   ├── {skill-id}/
│   │   ├── package.json
│   │   └── ...
├── models/                             # 本地模型
│   ├── llama-3-8b-q4.gguf
│   └── all-MiniLM-L6-v2.onnx          # 嵌入模型
├── logs/                               # 日志（加密）
│   ├── audit.log
│   └── app.log
└── cache/                              # 缓存（可清除）
    ├── embeddings/                     # 嵌入缓存
    └── model-cache/                    # 模型推理缓存
```

### 4.3 数据迁移策略

```typescript
// 迁移采用版本号递增方式
// packages/core/src/infrastructure/db/migrations/

// 001_initial.sql     — 基础表创建
// 002_add_feedback.sql — 新增反馈表
// 003_xxx.sql         — ...

interface Migration {
  version: number
  name: string
  up: string    // SQL
  down: string  // SQL (回滚)
}

// 启动时自动检查并执行迁移
class MigrationRunner {
  async run() {
    const currentVersion = await this.getCurrentVersion()
    const pendingMigrations = this.migrations.filter(m => m.version > currentVersion)
    for (const migration of pendingMigrations) {
      await this.db.exec(migration.up)
      await this.setVersion(migration.version)
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
│   ├── desktop/                    # Tauri 桌面应用
│   │   ├── src-tauri/              # Rust 后端 (Tauri + 安全插件)
│   │   │   ├── Cargo.toml
│   │   │   ├── src/
│   │   │   │   ├── main.rs
│   │   │   │   ├── commands/       # Tauri IPC Commands
│   │   │   │   ├── plugins/        # 自定义 Tauri 插件
│   │   │   │   │   ├── sandbox.rs  # 沙箱插件
│   │   │   │   │   ├── keychain.rs # Keychain 插件
│   │   │   │   │   └── crypto.rs   # 加密插件
│   │   │   │   └── lib.rs
│   │   │   └── tauri.conf.json
│   │   ├── src/                    # React 前端
│   │   │   ├── app/
│   │   │   ├── components/
│   │   │   └── ...
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── cli/                        # CLI 工具（开发/调试用）
│       ├── src/
│       └── package.json
├── packages/
│   ├── core/                       # 核心引擎 (TypeScript)
│   │   ├── src/
│   │   │   ├── application/        # 应用层服务
│   │   │   ├── domain/             # 领域层模型
│   │   │   └── infrastructure/     # 基础设施层
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── ui/                         # 共享 UI 组件库
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   └── stores/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── model-providers/            # 模型 Provider 集成
│   │   ├── src/
│   │   │   ├── anthropic.ts
│   │   │   ├── openai.ts
│   │   │   ├── google.ts
│   │   │   ├── llama-cpp.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── mcp-bridge/                 # MCP 协议桥接
│   │   ├── src/
│   │   └── package.json
│   ├── skill-runtime/              # Skill 运行时
│   │   ├── src/
│   │   │   ├── loader.ts
│   │   │   ├── sandbox.ts
│   │   │   └── registry.ts
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
└── tools/                          # 开发工具
    ├── scripts/                    # 构建脚本
    └── templates/                  # Agent/Skill 模板
```

### 5.2 包依赖关系图

```
apps/desktop
  ├── packages/core          (核心引擎)
  ├── packages/ui            (UI 组件)
  └── packages/shared        (共享类型)

packages/core
  ├── packages/model-providers
  ├── packages/mcp-bridge
  ├── packages/skill-runtime
  ├── packages/rag
  └── packages/shared

packages/ui
  └── packages/shared

packages/model-providers
  └── packages/shared

packages/mcp-bridge
  └── packages/shared

packages/skill-runtime
  └── packages/shared

packages/rag
  └── packages/shared
```

### 5.3 构建与发布流程

```
开发:
  pnpm dev              → Tauri dev mode (热重载)
  pnpm dev:core         → 仅核心引擎开发
  pnpm test             → Vitest 全量测试
  pnpm test:core        → 核心引擎测试
  pnpm lint             → Oxlint 检查

构建:
  pnpm build            → 全量构建
  pnpm build:desktop    → Tauri 桌面应用构建

发布:
  pnpm release:mac      → macOS DMG/App
  pnpm release:win      → Windows MSI/NSIS
  pnpm release:linux    → AppImage/deb/rpm
```

---

## 6. 安全架构

### 6.1 威胁模型（基于 OpenClaw 已知漏洞的防御）

| OpenClaw 漏洞 | 威胁描述 | EvoClaw 防御方案 |
|---------------|----------|------------------|
| **ClawJacked (WebSocket 劫持)** | 恶意网站通过 WebSocket 连接劫持本地 Agent | 不使用 WebSocket 暴露本地服务；使用 Tauri IPC（仅应用内部通信） |
| **明文凭证存储** | API Key 明文存在配置文件中 | 所有凭证通过系统 Keychain 存储，内存中使用后立即清零 |
| **ClawHub 恶意 Skill** | 20% 的 Skill 包含恶意代码 | 签名验证 + 静态分析 + 沙箱试运行 三重防线 |
| **认证绕过 (93.4%)** | 外部可未认证访问 Agent | 无外部网络接口；Tauri IPC 天然隔离 |
| **公开暴露实例 (3万+)** | Agent 被互联网发现和攻击 | 无监听端口；纯本地应用无网络攻击面 |

### 6.2 数据流安全分析

```
┌─────────────────────────────────────────────────────────────┐
│                       数据流安全                              │
│                                                             │
│  用户输入 ──→ [明文] ──→ Tauri IPC ──→ [应用进程内]          │
│                              │                              │
│                   ┌──────────┼──────────┐                   │
│                   │          │          │                    │
│                   ▼          ▼          ▼                    │
│             ┌──────────┐ ┌───────┐ ┌──────────┐             │
│             │ SQLite   │ │ Model │ │ 文件系统  │             │
│             │ (加密)   │ │ API   │ │ (加密)   │             │
│             └──────────┘ └───┬───┘ └──────────┘             │
│                              │                              │
│                    ┌─────────▼─────────┐                    │
│                    │ 唯一出站: LLM API  │                    │
│                    │ · TLS 1.3 加密     │                    │
│                    │ · 仅发送对话内容   │                    │
│                    │ · 不发送凭证/记忆  │                    │
│                    │ · 可审查的网络日志 │                    │
│                    └───────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 零信任原则

1. **不信任 Skill**：所有 Skill 在沙箱中运行，即使签名验证通过
2. **不信任网络**：LLM API 调用使用 TLS 1.3，证书 pinning
3. **不信任存储**：SQLite 数据库使用 SQLCipher 加密（AES-256）
4. **不信任进程**：Agent 执行环境与主进程隔离
5. **不信任自己**：开源代码可审计，内置网络活动监控面板

---

## 7. 性能与可扩展性

### 7.1 性能目标与瓶颈分析

| 操作 | 目标 | 潜在瓶颈 | 优化策略 |
|------|------|----------|----------|
| 应用启动 | <3s 冷启 / <1s 热启 | SQLite 连接 + 模型加载 | 延迟加载模型；预编译 SQLite statements |
| 对话首 Token | <500ms (本地) / <2s (云端) | 上下文组装 + 记忆检索 | 记忆预加载；向量检索缓存 |
| RAG 检索 | <500ms | 向量搜索 + FTS5 查询 | 索引预热；查询结果缓存 |
| 记忆蒸馏 | 后台 <5s | LLM 调用 | 异步处理，不阻塞响应 |
| Skill 安装 | <30s | 下载 + 签名验证 + 沙箱试运行 | 并行执行验证步骤 |

### 7.2 缓存策略

```
┌──────────────────────────────────────────────┐
│                缓存层级                        │
│                                              │
│  L1: 内存缓存 (进程内)                        │
│  · 当前会话上下文                              │
│  · 活跃 Agent 的 SOUL.md 解析结果              │
│  · 权限判定缓存                               │
│  · 最近 RAG 检索结果                           │
│  TTL: 会话级别                                │
│                                              │
│  L2: SQLite 缓存表                            │
│  · 嵌入向量缓存（避免重复计算）                 │
│  · 记忆蒸馏结果缓存                            │
│  · Skill 搜索结果缓存                          │
│  TTL: 24 小时                                 │
│                                              │
│  L3: 文件系统缓存                              │
│  · 模型推理 KV 缓存                            │
│  · 文档解析缓存                               │
│  TTL: 7 天                                    │
│                                              │
└──────────────────────────────────────────────┘
```

### 7.3 异步处理架构

```typescript
// 不阻塞用户交互的后台任务
const backgroundTasks = {
  // 对话完成后
  afterChat: [
    'memoryDistillation',     // 记忆蒸馏
    'capabilityUpdate',       // 能力图谱更新
    'evolutionLog',           // 进化日志写入
  ],

  // 定时任务
  scheduled: [
    { task: 'weeklyReport', cron: '0 9 * * 1' },       // 每周一 9:00
    { task: 'memoryConsolidation', cron: '0 3 * * *' }, // 每天凌晨 3:00
    { task: 'cacheCleanup', cron: '0 4 * * 0' },       // 每周日 4:00
  ],

  // 文件系统监听
  fileWatcher: [
    'knowledgeBaseReindex',   // 知识库文件变更时重新索引
  ],
}
```

---

## 8. 部署架构

### 8.1 桌面应用打包

```
┌──────────────────────────────────────────────┐
│              Tauri 构建流水线                   │
│                                              │
│  源代码 ──→ TypeScript 编译 ──→ Vite 打包     │
│              Rust 编译 ──→ 原生二进制          │
│                                              │
│  macOS:                                      │
│  · .app Bundle (Universal: x86_64 + arm64)   │
│  · .dmg 安装镜像                              │
│  · 签名: Developer ID + Notarization         │
│  · 最小体积: ~15MB (不含模型)                  │
│                                              │
│  Windows:                                    │
│  · .msi 安装包 (NSIS)                         │
│  · 签名: Authenticode                        │
│                                              │
│  Linux:                                      │
│  · .AppImage (通用)                           │
│  · .deb (Debian/Ubuntu)                      │
│  · .rpm (Fedora/RHEL)                        │
│                                              │
└──────────────────────────────────────────────┘
```

### 8.2 自动更新机制

```
Tauri Updater 内置方案:

应用启动
    │
    ▼
检查更新服务器 (GitHub Releases / 自建)
    │
    ├── 无更新 → 正常运行
    │
    └── 有更新
           │
           ▼
      ┌──────────────────┐
      │ 下载差量更新包     │  ← 仅下载变更部分
      │ 验证签名          │  ← Ed25519 签名验证
      │ 通知用户          │  ← "发现新版本 v0.2.0，是否更新？"
      └──────────┬───────┘
                 │
           ┌─────┴─────┐
           │ 立即更新    │ → 下载安装重启
           │ 稍后提醒    │ → 下次启动再提醒
           └───────────┘
```

### 8.3 未来移动端架构预留

```
当前架构已为移动端预留:

packages/core/           ← 纯 TypeScript，可移植到任何 JS 运行时
packages/shared/         ← 共享类型，跨平台复用
packages/model-providers/ ← 模型接口统一，移动端只需替换 local 实现

未来移动端路径:
· iOS: Swift UI + packages/core (通过 JavaScriptCore 或 WebView)
· Android: Kotlin + packages/core (通过 WebView 或 Hermes)
· 或者: React Native + packages/core (最大复用)
```

---

## 附录 A：关键技术决策记录 (ADR)

### ADR-001: 选择 Tauri 而非 Electron

- **决策**: 使用 Tauri 2.0
- **理由**: 体积优势（~15MB vs ~150MB）；Rust 安全层；原生系统集成更好（Keychain、沙箱）
- **风险**: Tauri 生态不如 Electron 成熟
- **缓解**: Tauri 2.0 已趋于稳定；核心逻辑在 TypeScript 层，降低对 Tauri 的耦合

### ADR-002: 选择 SQLite-vec 而非独立向量数据库

- **决策**: 使用 SQLite-vec 作为向量存储
- **理由**: 嵌入式、零部署依赖、与 SQLite 共享连接；万级文档规模足够
- **风险**: 十万级以上文档性能可能不足
- **缓解**: 预留 `VectorStore` 接口，可切换到 LanceDB

### ADR-003: 记忆蒸馏使用 LLM 而非规则引擎

- **决策**: 使用 LLM 分析对话并提取记忆
- **理由**: 用户表达多样化，规则覆盖率低；LLM 理解语义更准确
- **成本控制**: 仅对话结束时批量处理；优先使用本地小模型；缓存重复模式

### ADR-004: 不暴露任何网络端口

- **决策**: 不使用 HTTP/WebSocket 对外服务，完全依赖 Tauri IPC
- **理由**: 从根本上消除 OpenClaw 的 ClawJacked 类攻击面
- **代价**: 不支持浏览器访问，必须使用桌面应用
- **接受原因**: 本地应用的定位不需要浏览器访问

---

> **文档状态**: 初版完成
> **下次评审**: 待定
