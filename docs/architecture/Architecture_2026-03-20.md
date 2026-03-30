# EvoClaw 技术架构设计文档

> **文档版本**: v6.3
> **创建日期**: 2026-03-11
> **更新日期**: 2026-03-30
> **文档状态**: 已完成（10 个 Sprint 全部完成）
> **定位**: 企业级 AI Agent 桌面平台，安全优先、稳定优先

---

## 目录

1. [架构总览](#1-架构总览)
2. [分层架构设计](#2-分层架构设计)
3. [核心子系统设计](#3-核心子系统设计)
   - 3.1 [安全子系统](#31-安全子系统)
   - 3.2 [Agent 引擎](#32-agent-引擎)
   - 3.3 [上下文引擎](#33-上下文引擎)
   - 3.4 [记忆系统](#34-记忆系统)
   - 3.5 [工具系统](#35-工具系统)
   - 3.6 [Skill 系统](#36-skill-系统)
   - 3.7 [Provider 系统](#37-provider-系统)
   - 3.8 [Channel 系统](#38-channel-系统)
   - 3.9 [进化引擎](#39-进化引擎)
   - 3.10 [调度系统](#310-调度系统)
   - 3.11 [RAG 系统](#311-rag-系统)
   - 3.12 [Binding Router](#312-binding-router)
4. [数据架构](#4-数据架构)
5. [安全架构](#5-安全架构)
6. [API 设计](#6-api-设计)
7. [性能与可扩展性](#7-性能与可扩展性)
8. [部署架构](#8-部署架构)
9. [测试架构](#9-测试架构)
10. [技术路线图](#10-技术路线图)

---

## 1. 架构总览

### 1.1 系统全局架构图

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Tauri 主进程 (Rust, 703 行)                        │
│  ┌──────────┐  ┌───────────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │sidecar.rs│  │ crypto.rs │  │credential.rs  │  │    lib.rs        │  │
│  │  (420行)  │  │  (164行)  │  │   (77行)      │  │    (37行)        │  │
│  │ 进程管理  │  │AES-256-GCM│  │macOS Keychain │  │ Tauri 入口       │  │
│  │ 自动重启  │  │ ring 加密  │  │security-frmwk│  │ 命令注册         │  │
│  └─────┬────┘  └───────────┘  └───────────────┘  └──────────────────┘  │
│        │ spawn + 解析首行 JSON {port, token}                             │
├────────┼─────────────────────────────────────────────────────────────────┤
│        │                                                                 │
│        ▼                                                                 │
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │              Node.js Sidecar (packages/core, 94 文件, ~15K 行)     │   │
│  │  ┌─────────┐  ┌────────────┐  ┌──────────┐  ┌───────────────┐   │   │
│  │  │Hono HTTP│  │EmbeddedRun-│  │ Context  │  │   Memory      │   │   │
│  │  │ Server  │  │ner (PI框架) │  │ Engine   │  │   System      │   │   │
│  │  │ 14 路由 │  │+ Fetch回退  │  │ 9 插件   │  │ L0/L1/L2     │   │   │
│  │  └────┬────┘  └─────┬──────┘  └────┬─────┘  └───────┬───────┘   │   │
│  │       │             │              │                │            │   │
│  │  ┌────┴────┐  ┌─────┴──────┐  ┌────┴─────┐  ┌──────┴───────┐   │   │
│  │  │LaneQueue│  │ToolSafety  │  │  RAG     │  │ Provider     │   │   │
│  │  │3 车道   │  │循环检测     │  │知识库    │  │ Registry     │   │   │
│  │  └─────────┘  └────────────┘  └──────────┘  └──────────────┘   │   │
│  │                                                                 │   │
│  │  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌──────────────┐  │   │
│  │  │ Channel  │  │ Scheduler  │  │ Skill    │  │ Evolution    │  │   │
│  │  │ Manager  │  │Cron+Heart  │  │ System   │  │ Engine       │  │   │
│  │  └──────────┘  └────────────┘  └──────────┘  └──────────────┘  │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│        ▲ 127.0.0.1:{49152-65535} + Bearer Token (256-bit)               │
├────────┼─────────────────────────────────────────────────────────────────┤
│        │                                                                 │
│  ┌─────┴─────────────────────────────────────────────────────────────┐   │
│  │           React 前端 (16 页面, ~7K 行, 4 Zustand Store)            │   │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │   │
│  │  │ChatPage │  │AgentsPage│  │MemoryPage│  │SettingsPage      │  │   │
│  │  │SkillPage│  │ModelPage │  │SecurityPg│  │SetupPage ...     │  │   │
│  │  └─────────┘  └──────────┘  └──────────┘  └───────────────────┘  │   │
│  └───────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘

外部依赖:
  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────────────┐
  │ LLM APIs │  │IM 渠道   │  │ Brave API │  │ 技能商店          │
  │OpenAI    │  │企微/飞书  │  │ Web搜索   │  │lightmake.site   │
  │Anthropic │  │钉钉/QQ   │  │           │  │clawhub.ai       │
  │国产模型   │  │          │  │           │  │                  │
  └──────────┘  └──────────┘  └───────────┘  └──────────────────┘
```

### 1.2 核心设计原则

| 原则 | 说明 |
|------|------|
| **企业安全优先** | 权限模型 7 类别 x 4 作用域，macOS Keychain + AES-256-GCM，审计日志全量记录 |
| **Sidecar 架构** | Rust 主进程 + Node.js HTTP 服务，进程隔离，独立重启不影响前端 |
| **PI 框架集成** | 通过 `createAgentSession` 对接 PI 的 ReAct 循环，失败回退 fetch 直连 |
| **渐进式降级** | 向量搜索降级 FTS5，PI 降级 fetch，thinking 降级 reasoning=false |
| **单引擎存储** | better-sqlite3 + sqlite-vec + FTS5，不引入外部数据库 |
| **全内置架构** | 不提供第三方插件/扩展机制，所有能力内置，ContextPlugin 仅内部模块化 |

### 1.3 技术栈

| 层 | 技术 | 版本/说明 |
|---|---|---|
| 桌面框架 | Tauri 2.0 | Rust 主进程，WebView 渲染 |
| 前端 | React 19 + TypeScript + Tailwind CSS 4 | Zustand 状态管理 |
| Sidecar | Hono + Node.js 22 + better-sqlite3 | WAL 模式，127.0.0.1 绑定 |
| Agent 运行时 | PI 框架 (pi-ai + pi-coding-agent) | 不含 pi-tui |
| LLM 接入 | pi-ai 统一抽象 | 国产模型走 openai-completions + 自定义 baseUrl |
| 构建 | Turborepo + pnpm 10 | Vitest 测试，Oxlint 检查 |
| 安全 | macOS Keychain (security-framework) | ring 提供 AES-256-GCM |
| 向量搜索 | sqlite-vec | 与 FTS5 共用 SQLite 引擎 |

### 1.4 代码库规模统计

```
Monorepo 总体:
├── packages/core/src/    94 个 TypeScript 文件, ~15,000 行
├── apps/desktop/src/     16 个页面 + 4 个 Store, ~7,000 行
├── apps/desktop/src-tauri/src/  5 个 Rust 文件, 703 行
├── packages/shared/src/  11 个类型文件 + 常量
└── 数据库: 9 个迁移文件, 12+ 张表
```

---

## 2. 分层架构设计

### 2.1 四层架构

```
┌─────────────────────────────────────────────────────────────┐
│  表现层 (Presentation)                                       │
│  apps/desktop/src/pages/   — 16 个 React 页面               │
│  apps/desktop/src/stores/  — 4 个 Zustand Store             │
│  apps/desktop/src/lib/     — API Client + 工具函数           │
├─────────────────────────────────────────────────────────────┤
│  应用层 (Application)                                        │
│  packages/core/src/routes/    — 14 个 HTTP 路由组 (2.3K 行)  │
│  packages/core/src/server.ts  — Hono 入口 (453 行)          │
├─────────────────────────────────────────────────────────────┤
│  领域层 (Domain)                                             │
│  packages/core/src/agent/     — Agent 生命周期 (7 文件, 2.1K)│
│  packages/core/src/context/   — 上下文引擎 (11 文件, 700)    │
│  packages/core/src/memory/    — 记忆系统 (11 文件, 1.5K)     │
│  packages/core/src/skill/     — Skill 系统 (5 文件, 820)     │
│  packages/core/src/channel/   — 渠道系统 (6 文件, 430)       │
│  packages/core/src/evolution/ — 进化引擎 (3 文件, 295)       │
│  packages/core/src/routing/   — 会话路由 (2 文件, 180)       │
│  packages/core/src/scheduler/ — 调度系统 (3 文件, 410)       │
│  packages/core/src/bridge/    — 工具注入 (4 文件, 520)       │
│  packages/core/src/tools/     — 工具实现 (11 文件, 1.4K)     │
│  packages/core/src/provider/  — 模型管理 (4 文件, 730)       │
│  packages/core/src/rag/       — RAG 知识库 (4 文件, 495)     │
├─────────────────────────────────────────────────────────────┤
│  基础设施层 (Infrastructure)                                 │
│  packages/core/src/infrastructure/ — DB/Config/Logger (7, 520)│
│  apps/desktop/src-tauri/src/  — Rust 层 (5 文件, 703)       │
│  packages/shared/             — 共享类型 (11 类型文件)        │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 表现层详细结构

**16 个页面**:

| 页面 | 文件 | 功能 |
|------|------|------|
| ChatPage | `ChatPage.tsx` | 主聊天界面，SSE 流式，多 Agent 切换 |
| AgentsPage | `AgentsPage.tsx` | Agent 列表，模板创建 |
| AgentDetailPage | `AgentDetailPage.tsx` | Agent 详情，工作区文件编辑 |
| AgentEditPage | `AgentEditPage.tsx` | Agent 配置编辑 |
| MemoryPage | `MemoryPage.tsx` | 记忆管理，分类浏览 |
| ModelsPage | `ModelsPage.tsx` | 模型管理，Provider 配置 |
| SettingsPage | `SettingsPage.tsx` | 全局设置 |
| SetupPage | `SetupPage.tsx` | 首次启动引导 |
| SkillPage | `SkillPage.tsx` | Skill 商店浏览安装 |
| SecurityPage | `SecurityPage.tsx` | 权限管理 |
| SecurityGuardPage | `SecurityGuardPage.tsx` | 安全守卫面板 |
| ChannelPage | `ChannelPage.tsx` | 渠道管理 |
| CronPage | `CronPage.tsx` | 定时任务管理 |
| KnowledgePage | `KnowledgePage.tsx` | 知识库管理 |
| EvolutionPage | `EvolutionPage.tsx` | Agent 成长图谱 |
| AlertPage | `AlertPage.tsx` | 告警通知 |

**4 个 Zustand Store**:

| Store | 文件 | 职责 |
|-------|------|------|
| AppStore | `app-store.ts` | Sidecar 状态、全局配置、品牌信息 |
| ChatStore | `chat-store.ts` | 对话消息、SSE 连接、打字状态 |
| AgentStore | `agent-store.ts` | Agent 列表、当前 Agent、工作区 |
| MemoryStore | `memory-store.ts` | 记忆列表、搜索结果 |

### 2.3 应用层 — Hono HTTP Server

✅ `server.ts` (453 行) 是整个 Sidecar 的入口：

```typescript
// 启动流程:
// 1. 生成 256-bit Bearer Token + 随机端口 (49152-65535)
// 2. 初始化 ConfigManager → 同步 Provider 到内存注册表
// 3. 初始化 SQLite (WAL) + MigrationRunner (9 个迁移)
// 4. 初始化 VectorStore (向量搜索，降级 FTS5)
// 5. 初始化记忆系统 (MemoryStore + FtsStore + HybridSearcher + MemoryExtractor)
// 6. 初始化 AgentManager + LaneQueue + CronRunner + ChannelManager
// 7. 输出 JSON 首行 {port, token} → Rust 层解析
// 8. 绑定 127.0.0.1，启动 HTTP 服务
```

**路由挂载顺序**:

```
/health              — 健康检查 (无需认证)
/config              — 配置管理
/agents              — Agent CRUD
/chat                — 聊天 + 反馈
/memory              — 记忆管理
/security            — 权限管理
/knowledge           — 知识库
/skill               — Skill 管理
/evolution           — 进化图谱
/provider            — Provider 管理
/cron                — 定时任务
/binding             — 绑定管理
/channel             — 渠道管理
/doctor              — 自诊断 (始终可用)
```

### 2.4 Sidecar 通信协议

```
┌──────────┐                              ┌──────────┐
│  Tauri   │  spawn node server.mjs       │  Node.js │
│  (Rust)  │ ───────────────────────────→ │ Sidecar  │
│          │                              │          │
│          │  stdout 首行 JSON:           │          │
│          │ ← {"port":52341,"token":"x"} │          │
│          │                              │          │
│  React   │  HTTP + Bearer Token         │  Hono    │
│  前端    │ ────────────────────────────→ │  Server  │
│          │  127.0.0.1:52341             │          │
│          │                              │          │
│          │  SSE (Server-Sent Events)    │          │
│          │ ←─────────────────────────── │          │
└──────────┘                              └──────────┘
```

安全约束:
- ✅ 仅绑定 `127.0.0.1`，不对外暴露
- ✅ 256-bit Bearer Token 每次启动随机生成
- ✅ CORS 仅允许 localhost/127.0.0.1
- ✅ 敏感字段 (apiKey/token/secret/password) 在日志中自动脱敏

---

## 3. 核心子系统设计

### 3.1 安全子系统

#### 3.1.1 当前已实现安全能力

✅ **权限模型** (`packages/core/src/tools/permission-interceptor.ts`, 131 行)

```typescript
// 7 个权限类别
type PermissionCategory =
  | 'file_read'   // 文件读取
  | 'file_write'  // 文件写入
  | 'network'     // 网络请求
  | 'shell'       // 命令执行
  | 'browser'     // 浏览器操作
  | 'mcp'         // MCP 协议
  | 'skill';      // Skill 调用

// 4 个作用域
type PermissionScope = 'once' | 'session' | 'always' | 'deny';
```

✅ **凭证安全** (`apps/desktop/src-tauri/src/credential.rs`, 77 行)
- macOS Keychain 存储 API Key（`security-framework` crate）
- 服务名前缀: `TAURI_ENV_IDENTIFIER` 或 `com.evoclaw.app`
- 支持 set/get/delete 操作

✅ **加密引擎** (`apps/desktop/src-tauri/src/crypto.rs`, 164 行)
- AES-256-GCM 加密/解密（`ring` crate）
- `SystemRandom` 生成随机 nonce
- Base64 编码传输: `base64(nonce + ciphertext)`

✅ **审计日志** (`packages/core/src/infrastructure/db/migrations/001_initial.sql`)
- `audit_log` 表记录所有 Agent 操作
- `tool_audit_log` 表记录每次工具执行（含时长、状态、权限 ID）

✅ **工具安全守卫** (`packages/core/src/agent/tool-safety.ts`, 246 行)
- 4 种循环检测模式（重复/无进展/乒乓/全局熔断）
- 结果截断（头尾保留策略，70% 头 + 30% 尾）
- 熔断器阈值: 30 次/会话

✅ **日志安全** (`server.ts`)
- 自动脱敏: `apiKey`、`token`、`secret`、`password` 字段替换为 `***`
- 请求体仅 debug 级别记录
- 响应体截断到 2000 字符

#### 3.1.2 计划增强安全能力

🔲 **Prompt 注入检测** (17 种模式)
```
计划实现模式:
- 角色覆盖攻击 ("忽略以上指令")
- 系统提示泄露引导 ("打印你的系统提示")
- 间接注入（通过工具结果注入指令）
- Base64/ROT13 编码绕过
- 多语言混合注入
```

🔲 **Unicode 混淆/同形字检测**
- 检测零宽字符 (U+200B, U+FEFF)
- 检测同形字替换 (Cyrillic/Latin 混用)
- 检测不可见控制字符

🔲 **exec 审批精确绑定**
- Shell 命令审批绑定到精确 argv
- 禁止通配符审批
- 二次确认高危命令 (rm -rf, chmod 777 等)

🔲 **沙箱环境变量阻断**
- Docker 沙箱内禁止注入敏感环境变量
- 白名单机制控制可见环境变量

🔲 **审计日志导出 (SIEM 集成)**
- 支持 JSON Lines 格式导出
- 支持 Syslog 协议推送
- 告警规则引擎（异常频率检测）

🔲 **数据分级标记**
- L1 公开 / L2 内部 / L3 机密 / L4 绝密
- 记忆和工具结果自动分级
- 分级控制外发和展示

### 3.2 Agent 引擎

#### 3.2.1 Agent 生命周期管理

✅ `packages/core/src/agent/agent-manager.ts` (377 行)

```
Agent 状态机:
  draft → active → paused → archived
    ↑                  │
    └──────────────────┘

工作区文件系统 (8 文件):
  ~/.<brand>/agents/<agentId>/workspace/
  ├── SOUL.md       — 灵魂: 核心人格和行为哲学
  ├── IDENTITY.md   — 身份: 名称、标志、气质
  ├── AGENTS.md     — 操作规程: 每次会话检查清单
  ├── TOOLS.md      — 环境笔记: 用户特定的备忘
  ├── HEARTBEAT.md  — 定时检查清单
  ├── USER.md       — 用户画像 (动态渲染)
  ├── MEMORY.md     — Agent 笔记本 (动态渲染)
  └── BOOTSTRAP.md  — 首次对话引导 (仅首轮注入)
```

✅ `packages/core/src/agent/agent-builder.ts` (493 行) — 6 阶段引导式创建
```
阶段 1: 基本信息 (名称、标志)
阶段 2: 人格定义 (SOUL.md 生成)
阶段 3: 能力配置 (模型选择)
阶段 4: 渠道绑定
阶段 5: 工作区文件生成 (LLM 辅助)
阶段 6: 激活确认
```

#### 3.2.2 嵌入式运行器

✅ `packages/core/src/agent/embedded-runner.ts` (943 行) — 核心执行引擎

```
执行流程:
┌──────────────┐
│ runEmbedded- │
│ Agent()      │
└──────┬───────┘
       │
       ▼
┌──────────────┐    成功    ┌──────────────┐
│ runWithPI()  │ ─────────→│   返回       │
│ (PI 框架)    │           └──────────────┘
└──────┬───────┘
       │ 失败
       ▼
┌──────────────┐    成功    ┌──────────────┐
│ runWithFetch │ ─────────→│   返回       │
│ (直连 API)   │           └──────────────┘
└──────┬───────┘
       │ 失败
       ▼
┌──────────────┐
│ emit error   │
└──────────────┘
```

**PI 框架集成路径**:

```typescript
// PI Session 配置 (对标 OpenClaw):
const { session } = await piCoding.createAgentSession({
  cwd: process.cwd(),
  authStorage: piCoding.AuthStorage.inMemory({...}),    // 内存 Auth
  modelRegistry: new piCoding.ModelRegistry(authStorage), // 模型注册
  sessionManager: piCoding.SessionManager.inMemory(),     // 内存 Session
  settingsManager: piCoding.SettingsManager.inMemory({    // 启用 compaction
    compaction: { enabled: true },
    retry: { enabled: true },
  }),
  model: model,
  tools: allTools,
});
session.agent.streamFn = piAi.streamSimple;  // 必须设置
```

**多级错误恢复**:

```
错误类型           │ 恢复策略                         │ 最大重试
─────────────────┼─────────────────────────────────┼────────
overload (429)    │ 指数退避 (250ms→1.5s, x2)       │ 3 次后切 provider
thinking 不支持   │ ThinkLevel 渐进降级 high→med→low→off │ 3 次（逐级）
context overflow  │ 保留后 12 条 → 截断工具结果 10K    │ 3 次
auth/billing      │ 切换下一个 provider（冷却 60s）    │ 按 provider 数
其他错误          │ 不重试，返回错误                   │ 0 次
PI 超时           │ Compaction 感知 grace period      │ 0 次
重试上限          │ 动态: 5 + providerChain.length × 5 │ max 30
```

> 详细设计见 [`docs/architecture/SubAgent-ReAct-Optimization.md`](./SubAgent-ReAct-Optimization.md)

**模块化系统提示** (参考 OpenClaw 22 段式):

```
§1  <safety>        — 安全宪法 (核心约束)
§2  <runtime>       — 运行时信息 (Agent/系统/模型)
§3  <personality>   — SOUL.md 人格
    <identity>      — IDENTITY.md 身份
§3.5 <user_profile> — USER.md 用户画像
§4  <operating_procedures> — AGENTS.md 操作规程
§4.5 <bootstrap>    — BOOTSTRAP.md (仅首轮)
§5  <memory_recall> — 记忆召回指令
§5.1 <agent_notes>  — MEMORY.md 笔记内容
§5.2 <current_tasks> — 任务状态注入: 从 TODO.json 解析并渲染（进行中/待办/已完成）
§5.5 <available_tools> — 工具目录 (优先级排序)
§6  <tool_call_style> — 工具调用风格 + 选择指南
§7  <silent_reply>  — 沉默回复 (NO_REPLY token)
§8  自定义          — contextEngine 输出
```

**Tool XML 过滤器** (状态机实现):
- PI 框架混入的 `<tool_call>` / `<tool_result>` XML 标签
- 状态机追踪嵌套深度，在 `xmlFilterDepth > 0` 时丢弃内容
- 仅在 depth=0 时将文本 flush 到前端

**process.exit 拦截**:
- PI 框架（CLI 出身）可能调用 `process.exit()`
- Sidecar 模式下拦截此调用，仅记录日志不退出
- session 结束后恢复原始 `process.exit`

#### 3.2.3 Lane Queue

✅ `packages/core/src/agent/lane-queue.ts` (127 行)

```typescript
// 三车道并发控制:
type LaneName = 'main' | 'subagent' | 'cron';

// 默认并发:
const LANE_CONCURRENCY = {
  main: 4,        // 主对话
  subagent: 8,    // 子 Agent
  cron: 2,        // 定时任务
};

// 核心保障:
// - 同 sessionKey 严格串行 (runningKeys Map)
// - 不同 sessionKey 在车道并发上限内并行
// - 任务超时: 默认 600 秒
// - 支持取消 (AbortController)
```

### 3.3 上下文引擎

✅ `packages/core/src/context/context-engine.ts` (99 行)

#### 3.3.1 ContextPlugin 接口

```typescript
interface ContextPlugin {
  name: string;
  priority: number;  // 数值越小越先执行
  bootstrap?(ctx: BootstrapContext): Promise<void>;   // Agent 会话启动
  beforeTurn?(ctx: TurnContext): Promise<void>;       // 每轮对话前 (串行)
  compact?(ctx: CompactContext): Promise<ChatMessage[]>; // Token 超限压缩
  afterTurn?(ctx: TurnContext): Promise<void>;        // 每轮对话后 (并行)
  shutdown?(ctx: ShutdownContext): Promise<void>;     // 会话关闭
}
```

#### 3.3.2 5-Hook 生命周期

```
Agent 会话启动
    │
    ▼ bootstrap (串行, 按 priority)
    │
    ├──→ 每轮对话开始
    │       │
    │       ▼ beforeTurn (串行, 按 priority)
    │       │
    │       ├── Token > 85% 上限? ──→ compact (逆序执行)
    │       │
    │       ▼ [Agent 执行: PI ReAct 循环]
    │       │
    │       ▼ afterTurn (并行, Promise.allSettled)
    │       │
    │       └──→ 下一轮
    │
    ▼ shutdown (串行)
```

#### 3.3.3 9 个内置插件

| 优先级 | 插件 | 文件 | 职责 |
|--------|------|------|------|
| 10 | session-router | `session-router.ts` | 会话路由，Session Key 解析 |
| 20 | context-assembler | `context-assembler.ts` | 组装系统提示，工作区文件加载 |
| 40 | gap-detection | `gap-detection.ts` | 能力缺口检测，Skill 推荐 |
| 50 | rag | `rag.ts` | RAG 知识库检索注入 |
| 60 | tool-registry | `tool-registry.ts` | 工具目录注入 system prompt |
| 70 | memory-recall | `memory-recall.ts` | 记忆召回，热度加权 |
| 80 | memory-extract | `memory-extract.ts` | 对话后记忆提取 (afterTurn) |
| 85 | permission | `permission.ts` | 权限检查与拦截 |
| 90 | evolution | `evolution.ts` | 能力图谱更新 (afterTurn) |

**Token 预算管理**:
- 阈值: 85% context window
- 超限触发 compact 阶段（逆序执行）
- 兜底: `forceTruncate()` 保留最近 6 条消息

🔲 **压缩质量审计** (计划)
- 压缩前后语义保持率评估
- 关键信息丢失检测
- 压缩率 vs 质量权衡报告

### 3.4 记忆系统

#### 3.4.1 L0/L1/L2 三层架构

✅ `packages/core/src/memory/memory-store.ts` (289 行)

```
┌─────────────────────────────────────────────────────┐
│                    MemoryUnit                        │
│                                                      │
│  L0 Index     ~50 tokens    "用户偏好深色主题"       │
│  ────────                   用于向量索引和快速匹配    │
│                                                      │
│  L1 Overview  ~500-2K       结构化概览，包含关键细节  │
│  ──────────   tokens        排序和初筛用              │
│                                                      │
│  L2 Content   完整内容      原始对话片段、详细说明    │
│  ──────────                 按需加载 (Token 预算 8K)  │
│                                                      │
│  元数据: category, mergeType, mergeKey, confidence,  │
│         activation, accessCount, visibility          │
└─────────────────────────────────────────────────────┘

压缩率: 80%+ token 压缩（L2→L0 压缩 ~95%，L2→L1 压缩 ~80%）
```

**9 种记忆类别**:

```typescript
type MemoryCategory =
  | 'profile'     // 个人信息 (merge)
  | 'preference'  // 偏好习惯 (merge)
  | 'entity'      // 实体知识 (merge)
  | 'event'       // 事件经历 (independent)
  | 'case'        // 问题解决案例 (independent)
  | 'pattern'     // 行为模式 (merge)
  | 'tool'        // 工具使用 (merge)
  | 'skill'       // 技能知识 (merge)
  | 'correction'; // 纠错反馈 (independent, 1.5x 权重加成)
```

**合并语义**:
- `merge`: 同 `mergeKey` 的记忆合并更新（如用户偏好变更）
- `independent`: 每条独立存储（如事件、案例）

#### 3.4.2 三阶段渐进检索

✅ `packages/core/src/memory/hybrid-searcher.ts` (216 行)

```
Phase 1: 候选生成 (宽搜索, Top 30)
  ├── FTS5 关键词 (权重 0.3) — OR 连接, BM25 归一化
  ├── 向量搜索 (权重 0.5) — cosine similarity
  └── 知识图谱扩展 (权重 0.2) — 实体关系展开

Phase 2: 评分排序
  finalScore = searchScore × hotness × categoryBoost × correctionBoost
  ├── hotness = sigmoid(log1p(accessCount)) × exp(-decay × ageDays)
  │             decay = ln2 / 7 (7 天半衰期)
  ├── categoryBoost = 查询类型×类别矩阵 (5×9)
  └── correctionBoost = 1.5 (correction 类别加成)
  过滤: finalScore ≥ 0.15 (向量模式) / 0 (FTS-only 模式)
  去重: 同 mergeKey 保留最高分

Phase 3: L2 按需加载
  Token 预算: 8000 tokens
  按 finalScore 降序逐条加载 L2
  超出预算则停止
```

**查询分析器** (`query-analyzer.ts`):

```typescript
type QueryType = 'factual' | 'preference' | 'temporal' | 'skill' | 'general';
// 根据查询关键词自动分类，影响 categoryBoost 矩阵
```

**热度衰减公式**:
```
hotness = sigmoid(log1p(access_count)) × exp(-0.099 × age_days)
         ───────────────────────────     ──────────────────────
         访问频率因子 (0.5~1.0)           时间衰减因子 (7 天半衰期)
```

#### 3.4.3 记忆提取

✅ `packages/core/src/memory/memory-extractor.ts` (118 行)

```
对话结束 (afterTurn)
    │
    ▼
MemoryExtractor.extract(messages)
    │
    ├── LLM 提取 (extraction-prompt.ts, 128 行)
    │   └── 结构化 JSON: [{category, mergeKey, l0, l1, l2, confidence}]
    │
    ├── 合并检查 (findByMergeKey)
    │   ├── 已有 merge 记忆 → 更新 l1/l2
    │   └── 新记忆 → 插入 memory_units
    │
    ├── 索引更新
    │   ├── VectorStore 异步索引 embedding
    │   └── FtsStore 更新全文索引
    │
    └── 反馈循环防护
        └── 零宽空格标记，防止注入记忆被重复存储
```

🔲 **规则化记忆捕获过滤器** (计划)
- 正则预过滤器：在 LLM 提取前过滤明显噪音
- 配置化规则：用户可自定义忽略模式
- 减少 LLM 调用成本

#### 3.4.4 知识图谱

✅ `packages/core/src/memory/knowledge-graph.ts` (158 行)

```
实体关系三元组:
  (subject_id, predicate, object_id)
  例: ("user:张三", "喜欢", "entity:Python")
      ("entity:项目A", "使用", "entity:React")

用途:
  - Phase 1 候选扩展 (expandEntities)
  - 实体关系查询工具 (knowledge_query)
```

### 3.5 工具系统

#### 3.5.1 5 阶段注入管道

✅ `packages/core/src/bridge/tool-injector.ts` (146 行)

```
阶段 1: PI 内置工具 (PI 框架自行管理)
  ├── read      — 读取文件
  ├── write     — 创建/覆盖文件
  ├── edit      — 精确替换
  ├── grep      — 内容搜索
  ├── find      — 文件搜索
  ├── ls        — 目录列表
  └── bash      — 增强版 exec (替代 PI 内置 bash)

阶段 2: 权限拦截层
  └── PermissionInterceptor — 审计包装

阶段 3: EvoClaw 特定工具 (12 个)
  ├── web_search       — Brave Search API
  ├── web_fetch        — URL → Markdown
  ├── image            — 图片分析 (vision)
  ├── pdf              — PDF 阅读
  ├── apply_patch      — 多文件 diff 补丁
  ├── exec_background  — 后台长时间命令
  ├── process          — 后台进程管理
  ├── memory_search    — 记忆搜索
  ├── memory_get       — 记忆详情
  ├── knowledge_query  — 知识图谱查询
  ├── provider_direct  — 直连 Provider
  └── todo_write       — 结构化任务追踪（max 20, 1 in_progress）

阶段 4: Channel 工具
  ├── feishu_send      — 飞书消息发送
  ├── wecom_send       — 企微消息发送
  ├── weixin_send      — 微信文本消息发送
  ├── weixin_send_media — 微信媒体消息发送
  └── desktop_notify   — 桌面通知

阶段 5: Skill 工具目录
  └── 通过 system prompt 注入 <available_skills> XML
      (PI 两级注入: Tier 1 目录 ~50-100 tokens/skill,
       Tier 2 模型用 Read 按需加载 SKILL.md)
```

#### 3.5.2 工具安全守卫

✅ `packages/core/src/agent/tool-safety.ts` (246 行)

```
4 种循环检测:

1. 重复模式 (repeatThreshold=5)
   同一工具 + 相同参数连续调用 5 次 → 阻止

2. 无进展模式 (noProgressThreshold=3)
   同一工具连续 3 次返回相同结果 (哈希比对) → 阻止

3. 乒乓模式 (pingPongThreshold=4)
   两个工具交替调用 4 轮 (8 次) → 阻止

4. 全局熔断 (circuitBreakerThreshold=30)
   单会话工具调用总数 > 30 → 阻止

结果截断 (maxResultLength=50000):
  ├── 尾部有错误特征词 → 头 70% + 尾 30%
  └── 无错误 → 仅保留头部
```

#### 3.5.3 增强版 exec

✅ 在 `embedded-runner.ts` 中 `createEnhancedExecTool()`:

```
增强点:
- 超时控制: 默认 120 秒
- 输出限制: 200K 字符 (10MB buffer)
- 头尾保留截断: 70% 头 + 30% 尾
- 工作目录: 支持 workdir 参数
- 退出码: 格式化显示
- 环境变量: 注入 EVOCLAW_SHELL=exec
- 超时提示: 引导使用 exec_background
```

✅ **LSP 工具集成**
- 语言服务器协议集成
- 代码补全、诊断、重构工具
- 企业编码 Agent 增强

✅ **image_generate 工具**
- DALL-E / Stable Diffusion API 集成
- 图片生成能力

#### 3.5.4 工具系统优化路线图

> 基于 EvoClaw vs OpenClaw 工具系统对比分析，按优先级分阶段实施。

| 优先级 | 项目 | 描述 | 状态 |
|--------|------|------|------|
| **P0** | Memory Flush 工具集成 | 记忆 flush 基础设施已建，需接入 PI session 的 compaction 循环 | ✅ 已完成 |
| **P1** | MCP 集成 | 支持外部 MCP server 工具扩展（StdioClientTransport + tool discovery） | ✅ 已完成 |
| **P1** | Read 自适应分页 | 按 context window 动态调整读取量 + 多页自动拉取 | ✅ 已完成 |
| **P1** | Schema Provider 适配 | Gemini/xAI 等模型的 JSON Schema 兼容层 | ✅ 已完成 |
| **P1** | 工具目录规范化 | 统一工具 ID/Section/Profile 定义（tool-catalog.ts） | ✅ 已完成 |
| **P1** | 子代理工具禁止列表 | 显式化各层级子代理禁止的工具清单 | ✅ 已完成 |
| **P1** | Exec safeBins 安全 profile | 受信二进制白名单机制 | ✅ 已完成 |
| **P1** | TodoWrite 约束工具 | 结构化任务追踪（max 20, 1 in_progress, prompt 注入, 3 轮提醒） | ✅ 已完成 |
| **P2** | Tool Profile 系统 | 按场景预配置工具集（minimal/coding/messaging/full） | ✅ 已完成 |
| **P2** | Provider 工具过滤 | 按 LLM provider 过滤不兼容工具 | ✅ 已完成 |
| **P2** | browser/image_generate | 浏览器自动化 + AI 图片生成工具 | ✅ 已完成 |
| **P2** | LSP 集成 | 代码智能（hover/definition/references） | ✅ 已完成 |
| **P2** | apply_patch 条件创建 | 仅在 OpenAI + 白名单模型时创建 | ✅ 已完成 |
| **P2** | 消息通道工具过滤 | 按通道类型禁止特定工具 | ✅ 已完成 |
| **P2** | 工具 Hook 包装 | beforeToolCall/afterToolCall 插件扩展点 | ✅ 已完成 |
| **P3** | tts/canvas/gateway/nodes | 语音合成/画布/网关/节点工具 | 🔲 远期 |
| **P3** | 工具 description 动态修改 | 运行时按场景调整工具描述 | 🔲 远期 |
| **P3** | 插件工具名称冲突检测 | 注册时检测重名工具并告警 | 🔲 远期 |
| **P3** | Union Schema 扁平化 | 复杂 union 类型 schema 展开为扁平结构 | 🔲 远期 |

**EvoClaw 已有优势**（无需追赶）:
- Unicode 混淆检测（17 种模式）
- 循环检测（4 模式 + 断路器）
- 审计日志（tool_audit_log）
- 权限持久化（SQLite 7 类别 × 4 作用域）
- 知识图谱工具
- Workspace 安全区自动放行
- 通道工具多样性（飞书/企微/微信）

##### MCP 集成架构

```
用户配置 (evo_claw.json)
  └── mcp_servers: [{ name, command, args, env }]

启动流程:
  1. McpManager 读取配置
  2. 为每个 server 创建 StdioClientTransport
  3. 调用 listTools() 获取工具清单
  4. 转换为 PI Tool 格式注入阶段 3

运行时:
  Agent 调用 MCP 工具 → McpManager.callTool(server, name, args)
    → StdioClientTransport 转发 → MCP Server 执行 → 返回结果

生命周期:
  - 启动时按需连接（lazy init）
  - 会话结束时断开
  - 异常自动重连（3 次重试 + 指数退避）
```

##### Read 自适应分页机制

```
Read 工具增强:
  1. 获取当前 context window 剩余容量
  2. 计算安全读取量: min(文件大小, 剩余容量 × 30%)
  3. 超过安全量 → 自动分页:
     - 首次返回前 N 行 + "[共 M 行，已显示 1-N]"
     - 模型可请求后续页（自动拉取）
  4. 小文件（< 安全量）→ 一次性返回全部内容
```

##### Schema Provider 适配层

```
SchemaAdapter 接口:
  adaptToolSchema(tool: Tool, provider: string): Tool

适配规则:
  - Gemini: 不支持 additionalProperties → 移除
  - xAI: anyOf/oneOf → 展开为独立参数
  - 通用: 移除 $ref → 内联展开

注入位置: 阶段 2 权限拦截层之后、阶段 3 之前
```

### 3.6 Skill 系统

✅ `packages/core/src/skill/` (5 文件, 820 行)

#### 3.6.1 架构概览

```
┌────────────────┐     ┌──────────────┐     ┌────────────────┐
│ lightmake.site │     │ clawhub.ai   │     │    本地扫描     │
│ 技能商店 API    │     │ ZIP 下载      │     │   ~/.evoclaw/  │
│ 22000+ 技能    │     │              │     │   skills/      │
└───────┬────────┘     └──────┬───────┘     └───────┬────────┘
        │ 搜索/浏览            │ 下载                 │ 扫描
        ▼                     ▼                      ▼
┌───────────────────────────────────────────────────────────┐
│                   SkillDiscoverer (273 行)                  │
│  - 技能商店 API 搜索 (分类/排序/分页/缓存 5min)              │
│  - 本地已安装 Skill 扫描                                    │
│  - 能力缺口检测 + Skill 推荐                                │
└───────────────────────────────────┬───────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────┐
│                   SkillInstaller (231 行)                   │
│  - prepare: 下载 → 临时目录 → 安全扫描 → 门控检查           │
│  - confirm: 安装到 ~/.evoclaw/skills/<name>                │
│  - uninstall: 删除目录                                     │
└───────────────────────────────────┬───────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────┐
│  SkillParser (129 行)        │  SkillGate (86 行)          │
│  解析 SKILL.md YAML          │  门控检查:                   │
│  frontmatter                 │  - bins: 二进制是否存在      │
│                              │  - env: 环境变量是否设置     │
│                              │  - os: 操作系统是否匹配      │
└──────────────────────────────┴────────────────────────────┘
```

#### 3.6.2 安全审计流程

```
1. prepare 阶段:
   ├── 下载 ZIP 到临时目录
   ├── 安全扫描 (SkillSecurityReport):
   │   ├── eval() 调用检测
   │   ├── Function 构造器检测
   │   ├── fetch/网络请求检测
   │   ├── fs.write 文件写入检测
   │   ├── child_process/exec 命令执行检测
   │   └── process.env 环境变量访问检测
   ├── 风险等级: low / medium / high
   └── 门控检查 (SkillGateResult[])

2. 用户确认:
   └── 展示安全报告 + 门控结果，用户决定是否安装

3. confirm 阶段:
   └── 从临时目录移动到正式目录
```

#### 3.6.3 注入机制

```
PI 渐进式两级注入:

Tier 1: 目录注入 (~50-100 tokens/skill)
  <available_skills>
  - skill_name: 一行描述
  - skill_name2: 一行描述
  </available_skills>

Tier 2: 按需加载
  模型决定使用某 Skill 时，用 Read 工具加载完整 SKILL.md
  SKILL.md body 就是执行指令
  Skill 不注册新工具，通过指令引导模型使用已有工具
```

🔲 **EvoClaw SkillHub API** (计划)
- 自托管技能仓库服务器
- REST API: 搜索、下载、版本管理
- 企业内部 Skill 分发

### 3.7 Provider 系统

#### 3.7.1 Provider Registry

✅ `packages/core/src/provider/provider-registry.ts` (344 行)

```
已注册 Provider:
┌──────────────┬──────────────────────────────────────────────┬──────────┐
│ Provider     │ API 协议                                    │ 备注     │
├──────────────┼──────────────────────────────────────────────┼──────────┤
│ openai       │ PI 原生 (openai-completions)                 │ 内置     │
│ anthropic    │ PI 原生 (anthropic-messages)                  │ 内置     │
│ google       │ PI 原生 (google-generative-ai)                │ 内置     │
│ deepseek     │ openai-completions + custom baseUrl           │ 国产     │
│ qwen (通义)  │ openai-completions + dashscope.aliyuncs.com   │ 国产     │
│ glm (智谱)   │ openai-completions + open.bigmodel.cn         │ 国产     │
│ doubao (豆包) │ openai-completions + ark.cn-beijing.volces    │ 国产     │
│ minimax      │ openai-completions + api.minimaxi.com         │ 国产     │
│ kimi (月之暗面)│ openai-completions + api.moonshot.cn          │ 国产     │
└──────────────┴──────────────────────────────────────────────┴──────────┘
```

#### 3.7.2 PI Provider ID 映射

✅ `packages/core/src/provider/pi-provider-map.ts` (29 行)

```typescript
// EvoClaw → PI 的 Provider ID 映射:
// glm → zai (智谱在 PI 中的 ID)
// 其余 Provider ID 保持一致
export function toPIProvider(evoClawProvider: string): string;
```

#### 3.7.3 Model Resolver

✅ `packages/core/src/provider/model-resolver.ts` (89 行)

```
模型解析优先级:
1. Agent 配置 (agent.provider + agent.modelId)
2. 用户偏好 (evo_claw.json → models.default)
3. 系统默认 (Provider 中 isDefault=true 的模型)
4. 硬编码 Fallback: openai/gpt-4o-mini
```

#### 3.7.4 baseUrl 处理

```
EvoClaw 配置的 baseUrl 含 /v1 后缀 (给 fetch fallback 用)
传给 PI Model 时自动去掉尾部 /v1 (PI SDK 内部自己拼接)

示例:
  evo_claw.json: "baseUrl": "https://api.deepseek.com/v1"
  传给 PI:       "baseUrl": "https://api.deepseek.com"
  fetch fallback: 直接使用 "https://api.deepseek.com/v1/chat/completions"
```

#### 3.7.5 模型列表动态拉取

✅ `packages/core/src/provider/model-fetcher.ts` (273 行)
- 通过 `/v1/models` API 拉取 Provider 支持的模型列表
- 更新到内存注册表 (`updateProviderModels`)

🔲 **Auth Doctor** (计划)
- API Key 有效性诊断
- 余额检查
- 配额/限速检测
- 模型可用性测试

🔲 **用量追踪** (计划)
- API 调用量/成本统计
- 按 Agent / Provider / 时段 聚合
- 预算告警

### 3.8 Channel 系统

✅ `packages/core/src/channel/` (20+ 文件, 2000+ 行)

#### 3.8.1 架构

```
┌──────────────────────────────────────────────────┐
│               ChannelManager (164 行)             │
│  - 适配器注册/注销                                │
│  - 连接/断开管理                                  │
│  - 自动重连 (指数退避, 最多 10 次)                 │
│  - 全局消息回调                                   │
└────────────────────────┬─────────────────────────┘
                         │
        ┌──────────┬────────────┬────────────┬──────────┐
        ▼          ▼            ▼            ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│DesktopAdapter│ │ WecomAdapter │ │FeishuAdapter │ │WeixinAdapter │
│   (64 行)    │ │  (168 行)    │ │  (204 行)    │ │  (15 文件)   │
│   本地桌面    │ │   企业微信    │ │    飞书       │ │ 微信个人号   │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

**支持的渠道类型**:

```typescript
type ChannelType = 'local' | 'feishu' | 'wecom' | 'weixin' | 'dingtalk' | 'qq';
```

| 渠道 | 状态 | 适配器文件 |
|------|------|-----------|
| Desktop (local) | ✅ 已实现 | `adapters/desktop.ts` (64 行) |
| 企业微信 (wecom) | ✅ 已实现 | `adapters/wecom.ts` (168 行) |
| 飞书 (feishu) | ✅ 已实现 | `adapters/feishu.ts` (204 行) |
| 微信个人号 (weixin) | ✅ 已实现 | `adapters/weixin.ts` + 14 个子模块 (weixin-api/types/crypto/cdn/upload/send-media/markdown/mime/slash-commands/debug/error-notice/redact/silk) |
| 钉钉 (dingtalk) | 🔲 计划 | — |
| QQ | 🔲 计划 | — |

✅ `packages/core/src/channel/message-normalizer.ts` (84 行) — 统一消息格式

```typescript
interface ChannelMessage {
  channel: ChannelType;
  chatType: 'private' | 'group';
  accountId: string;
  peerId: string;
  senderId: string;
  senderName: string;
  content: string;
  messageId: string;
  timestamp: number;
  mediaPath?: string;    // 媒体文件本地路径（微信 CDN 解密后）
  mediaType?: string;    // 媒体 MIME 类型
}
```

🔲 **计划增强** (借鉴 OpenClaw):
- 消息去重 (messageId 幂等)
- 线程路由 (thread_id 映射)
- 交互式消息 (卡片/按钮)
- 速率限制 (per-channel 限速)
- 凭证轮转 (token 过期自动刷新)

#### 3.8.2 微信个人号适配器架构

✅ 基于腾讯 iLink Bot 平台（ilinkai.weixin.qq.com），**非企业微信**，面向个人微信用户场景。

**与其他 Channel 的架构差异**:

| 维度 | 飞书/企微 | 微信个人号 |
|------|----------|-----------|
| 消息接收 | Webhook（平台推送） | Long-polling（getUpdates 主动拉取），EvoClaw 新模式 |
| 认证方式 | AppID + Secret → access_token | QR 扫码登录 → Bearer bot_token |
| 媒体处理 | 平台 API 上传/下载 | AES-128-ECB 加密 CDN 管线（上传/下载均需加解密） |
| 消息格式 | Markdown / 富文本 / 卡片 | 纯文本（微信不支持 Markdown，自动转换） |
| 状态持久化 | 无需（webhook 无状态） | cursor 持久化到 `channel_state` 表（SQLite） |

**核心模块**:

```
adapters/weixin.ts            — 主适配器：long-polling 循环 + 消息分发
adapters/weixin-api.ts        — iLink Bot API 封装（getUpdates/sendMessage/getUploadUrl）
adapters/weixin-types.ts      — iLink 协议类型定义
adapters/weixin-crypto.ts     — AES-128-ECB 加解密（媒体文件）
adapters/weixin-cdn.ts        — CDN 下载 + 解密（入站媒体）
adapters/weixin-upload.ts     — CDN 上传 + 加密（出站媒体）
adapters/weixin-send-media.ts — 媒体消息发送（IMAGE/VIDEO/FILE/VOICE）
adapters/weixin-markdown.ts   — Markdown → 纯文本转换
adapters/weixin-mime.ts       — MIME 类型检测（30+ 格式）
adapters/weixin-slash-commands.ts — Slash 命令处理（/echo, /toggle-debug）
adapters/weixin-debug.ts      — 调试模式（全管线耗时追踪）
adapters/weixin-error-notice.ts — 中文用户友好错误通知（fire-and-forget）
adapters/weixin-redact.ts     — 日志脱敏（token/body/URL）
adapters/weixin-silk.ts       — SILK 语音转码 WAV（可选，silk-wasm）
```

**iLink 协议特殊机制**:
- **context_token 回显**: 每次 getUpdates 返回 context_token，下次请求必须回传（协议要求）
- **cursor 持久化**: `get_updates_buf` 游标存储在 `channel_state` 表，重启后从上次位置继续拉取
- **媒体 CDN 加密**: 入站 CDN 下载 → AES-128-ECB 解密 → 临时文件 → mediaPath；出站 读取文件 → MD5 生成 AES key → 加密 → CDN PUT → 发送消息
- **4000 字符分块**: 超长文本自动分块发送（微信消息长度限制）
- **语音转文字**: 平台侧 ASR，asr_text 字段直接使用
- **typing 指示器**: 发送 start/cancel typing 状态

**ChannelAdapter 接口扩展**:
- `sendMediaMessage(accountId, peerId, mediaPath, mediaType)` — 可选方法，微信适配器实现
- `sendTyping(accountId, peerId, action)` — 可选方法，typing 指示器

**工具注入**: `weixin_send` + `weixin_send_media` 在阶段 4 Channel 工具中注入

### 3.9 进化引擎

✅ `packages/core/src/evolution/` (3 文件, 295 行)

#### 3.9.1 能力图谱

✅ `capability-graph.ts` (160 行)

```typescript
// 8 个能力维度:
type CapabilityDimension =
  | 'coding'         // 编程
  | 'analysis'       // 分析
  | 'writing'        // 写作
  | 'research'       // 研究
  | 'planning'       // 规划
  | 'debugging'      // 调试
  | 'data'           // 数据处理
  | 'communication'; // 沟通

interface CapabilityNode {
  name: string;
  level: number;        // 0.0 ~ 1.0
  useCount: number;
  successRate: number;  // 0.0 ~ 1.0
  lastUsedAt: string | null;
}
```

#### 3.9.2 成长追踪

✅ `growth-tracker.ts` (60+ 行)

```typescript
interface GrowthEvent {
  type: 'capability_up' | 'capability_down' | 'new_capability' | 'milestone';
  capability: string;
  delta: number;
  timestamp: string;
}

interface GrowthVector {
  dimension: string;
  delta: number;
  trend: 'up' | 'down' | 'stable';
}
```

#### 3.9.3 满意度检测

✅ `feedback-detector.ts` (75 行)

```typescript
interface SatisfactionSignal {
  score: number;    // 0-1
  signals: string[];
  messageId?: string;
}
// 通过对话内容分析隐式满意度信号
```

### 3.10 调度系统

#### 3.10.1 Cron Runner

✅ `packages/core/src/scheduler/cron-runner.ts`

```
┌──────────┐    每 60 秒     ┌──────────────┐
│ setInter-│ ─────────────→ │   tick()      │
│  val     │                │              │
└──────────┘                └──────┬───────┘
                                   │
                                   ▼
                            ┌──────────────┐
                            │ 查询到期任务  │
                            │ next_run_at  │
                            │  <= now      │
                            └──────┬───────┘
                                   │
                                   ▼
                            ┌──────────────┐
                            │ LaneQueue    │
                            │ cron 车道    │
                            │ 并发=2      │
                            └──────────────┘

action_type:
  - prompt:   向 Agent 发送消息触发回复
  - tool:     直接执行工具
  - pipeline: 多步骤管道
```

#### 3.10.2 Heartbeat

```
Heartbeat 特点 (vs Cron):
  - 共享主会话上下文 (不创建新会话)
  - 时间可有偏差
  - 批量检查场景
  - 遵守安静时段 (23:00-08:00)
  - 无事可做时回复 HEARTBEAT_OK

零污染回滚:
  Agent 返回 HEARTBEAT_OK / NO_REPLY / 空响应时：
  - 不保存 user/assistant 消息到 conversation_log
  - 不触发 conversations-changed 事件
  - 等同于这轮心跳从未发生过

间隔门控 (4 道检查):
  1. HEARTBEAT.md 存在？
  2. 文件非空？
  3. 距上次执行 >= minIntervalMinutes（默认 5 分钟）？
  4. 在活跃时段内（默认 08:00-22:00）？
```

#### 3.10.3 HeartbeatManager 架构

```
HeartbeatManager 单例管理 Map<agentId, HeartbeatRunner>

初始化流程:
  server.ts serve() 回调
    → createHeartbeatExecuteFn(port, token)
    → new HeartbeatManager(db, executeFn, onResult)
    → startAll()

executeFn 通过内部 HTTP 复用 chat /send 管道（SSE 流消费）

onResult 回调实现渠道投递:
  - target=none:    不投递，仅记录
  - target=last:    投递到最近活跃渠道
  - target=渠道ID:  投递到指定渠道

Agent 生命周期联动:
  - 创建 Agent → ensureRunner (自动启动心跳)
  - 删除 Agent → removeRunner (停止心跳)

cleanup:
  - stopAll() 在 SIGINT/SIGTERM 时调用
  - 确保所有 Runner 优雅关闭
```

#### 3.10.4 System Events 事件队列

```
纯内存 Map<sessionKey, SystemEvent[]>，最多 20 条/session

事件流:
  enqueueSystemEvent
    → chat.ts drainSystemEvents
    → message 前缀注入（随下一轮对话消费）

Cron 联动:
  - Cron actionType='event' → enqueueSystemEvent 到主 session
  - 事件在主会话上下文中被消费，而非 Cron 隔离会话

REST API 手动注入:
  POST /system-events/:agentId/events
  - 外部系统可通过 API 推送事件
  - 事件排队等待 Agent 下一轮对话时处理
```

#### 3.10.5 Standing Orders

```
定义位置: AGENTS.md 的 "Standing Orders" section

结构化 Program:
  - Scope:      适用范围（全局 / 特定渠道 / 特定场景）
  - Trigger:    触发条件（heartbeat / event / manual）
  - Approval:   审批策略（auto / confirm / escalate）
  - Escalation: 升级路径（超时 / 失败时的处理）

注入方式:
  - 系统 prompt § 7 <standing_orders> 注入意识
  - Agent 在每轮对话中感知并评估 Standing Orders
  - Heartbeat prompt 检查 trigger=heartbeat 的程序
```

#### 3.10.6 BOOT.md 启动执行

```
区别于 BOOTSTRAP.md（一次性出生仪式）:
  - BOOTSTRAP.md: Agent 首次创建时执行，仅一次
  - BOOT.md:      每次 sidecar 启动时执行

执行条件:
  - sidecar 启动时检测 BOOT.md
  - 文件存在且非空时执行

Session Key: agent:{id}:boot
  - 独立的启动会话
  - 不与主对话会话混淆
```

### 3.11 RAG 系统

✅ `packages/core/src/rag/` (4 文件, 495 行)

```
文件导入流程:
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ FileIngester │ →  │ ChunkSplitter│ →  │ VectorStore  │
│   (114 行)   │    │   (248 行)   │    │  索引 embed- │
│ 读取文件     │    │ 按 token 切分│    │  ding        │
│ 计算 hash   │    │ 重叠窗口     │    │              │
└──────────────┘    └──────────────┘    └──────────────┘

EmbeddingProvider (129 行):
  - 支持任意 OpenAI-compatible embedding API
  - 从 evo_claw.json 读取 embedding 模型配置
  - 降级: 无 embedding 配置时使用 FTS5 纯文本搜索
```

**数据库表**:
- `knowledge_base_files`: 文件元数据 (hash 去重)
- `knowledge_base_chunks`: 分块内容 + token 计数
- `embeddings`: 向量存储 (BLOB)，memory 和 chunk 共用

### 3.12 Binding Router

✅ `packages/core/src/routing/binding-router.ts` (109 行)

```
匹配优先级 (最具体优先):
1. channel + accountId + peerId  (精确匹配)
2. channel + accountId           (账号级匹配)
3. channel                       (渠道级匹配)
4. is_default = 1                (默认 Agent)

Session Key 格式:
  agent:{agentId}:{channel}:{chatType}:{peerId}
  例: agent:abc123:feishu:group:g456
```

✅ `packages/core/src/routing/session-key.ts` (40 行)

```typescript
// 生成 Session Key
function generateSessionKey(
  agentId: string,
  channel: string = 'default',
  chatType: string = 'direct',
  peerId: string = '',
): SessionKey;

// 解析 Session Key
function parseSessionKey(key: SessionKey): ParsedSession;

// 辅助: isGroupChat / isDirectChat
```

---

## 4. 数据架构

### 4.1 数据库概览

```
引擎: better-sqlite3 + WAL 模式
扩展: sqlite-vec (向量搜索) + FTS5 (全文搜索)
迁移: MigrationRunner (packages/core/src/infrastructure/db/migration-runner.ts)
位置: ~/.<brand>/<brand>.db
```

### 4.2 完整 Schema

#### Migration 001: 核心表

```sql
-- agents: Agent 配置
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🤖',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  config_json TEXT NOT NULL DEFAULT '{}',
  workspace_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- permissions: 权限授予
CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  category TEXT NOT NULL
    CHECK (category IN ('file_read','file_write','network','shell','browser','mcp','skill')),
  scope TEXT NOT NULL
    CHECK (scope IN ('once', 'session', 'always', 'deny')),
  resource TEXT NOT NULL DEFAULT '*',
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  granted_by TEXT NOT NULL DEFAULT 'user'
    CHECK (granted_by IN ('user', 'system'))
);
CREATE INDEX idx_permissions_agent ON permissions(agent_id);
CREATE INDEX idx_permissions_category ON permissions(agent_id, category);

-- model_configs: 模型配置
CREATE TABLE model_configs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  api_key_ref TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_model_default ON model_configs(provider, is_default) WHERE is_default = 1;

-- audit_log: 审计日志
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_agent ON audit_log(agent_id);
CREATE INDEX idx_audit_time ON audit_log(created_at);
```

#### Migration 002: 记忆单元

```sql
CREATE TABLE memory_units (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id TEXT,
  l0_index TEXT NOT NULL,           -- ~50 tokens 摘要
  l1_overview TEXT NOT NULL,        -- ~500-2K tokens 结构化概览
  l2_content TEXT NOT NULL,         -- 完整内容
  category TEXT NOT NULL
    CHECK (category IN ('profile','preference','entity','event',
           'case','pattern','tool','skill','correction')),
  merge_type TEXT NOT NULL CHECK (merge_type IN ('merge','independent')),
  merge_key TEXT,                   -- merge 类型的唯一键
  scope TEXT NOT NULL DEFAULT 'private',
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private','shared','channel_only')),
  visibility_channels TEXT,         -- JSON array
  activation REAL NOT NULL DEFAULT 1.0,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_access_at TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  source_session_key TEXT,
  source_message_ids TEXT,          -- JSON array
  confidence REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);
CREATE INDEX idx_memory_agent ON memory_units(agent_id);
CREATE INDEX idx_memory_category ON memory_units(agent_id, category);
CREATE INDEX idx_memory_merge_key ON memory_units(agent_id, merge_key)
  WHERE merge_key IS NOT NULL;
CREATE INDEX idx_memory_activation ON memory_units(agent_id, activation DESC);
```

#### Migration 003: 知识图谱

```sql
CREATE TABLE knowledge_graph (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id TEXT,
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_id TEXT NOT NULL,
  object_literal TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  source_memory_id TEXT REFERENCES memory_units(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_kg_agent ON knowledge_graph(agent_id);
CREATE INDEX idx_kg_subject ON knowledge_graph(subject_id, predicate);
CREATE INDEX idx_kg_object ON knowledge_graph(object_id, predicate);
```

#### Migration 004: 对话日志

```sql
CREATE TABLE conversation_log (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_input TEXT,
  tool_output TEXT,
  compaction_status TEXT NOT NULL DEFAULT 'raw'
    CHECK (compaction_status IN ('raw','extracted','compacted','archived')),
  compaction_ref TEXT,
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_convlog_agent_session ON conversation_log(agent_id, session_key);
CREATE INDEX idx_convlog_status ON conversation_log(agent_id, compaction_status);
```

#### Migration 005: 能力图谱

```sql
CREATE TABLE capability_graph (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  level REAL NOT NULL DEFAULT 0.0,
  use_count INTEGER NOT NULL DEFAULT 0,
  success_rate REAL NOT NULL DEFAULT 0.0,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, capability)
);
```

#### Migration 006: 工具审计日志

```sql
CREATE TABLE tool_audit_log (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  status TEXT NOT NULL DEFAULT 'success'
    CHECK (status IN ('success','error','denied','timeout')),
  duration_ms INTEGER,
  permission_id TEXT REFERENCES permissions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tool_audit_agent ON tool_audit_log(agent_id);
CREATE INDEX idx_tool_audit_session ON tool_audit_log(session_key);
```

#### Migration 007: 绑定关系

```sql
CREATE TABLE bindings (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  account_id TEXT,
  peer_id TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_bindings_agent ON bindings(agent_id);
CREATE INDEX idx_bindings_channel ON bindings(channel, account_id, peer_id);
CREATE UNIQUE INDEX idx_bindings_default ON bindings(is_default)
  WHERE is_default = 1;
```

#### Migration 008: 定时任务

```sql
CREATE TABLE cron_jobs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  action_type TEXT NOT NULL
    CHECK (action_type IN ('prompt', 'tool', 'pipeline')),
  action_config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_cron_agent ON cron_jobs(agent_id);
CREATE INDEX idx_cron_next_run ON cron_jobs(next_run_at) WHERE enabled = 1;
```

#### Migration 009: 知识库 + 向量持久化

```sql
-- embeddings: 向量存储 (记忆 + 知识块共用)
CREATE TABLE embeddings (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK(source_type IN ('memory', 'chunk')),
  embedding BLOB NOT NULL,
  dimension INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_embeddings_source_type ON embeddings(source_type);

-- knowledge_base_files: 知识库文件
CREATE TABLE knowledge_base_files (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'indexing', 'indexed', 'error')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  indexed_at TEXT
);
CREATE INDEX idx_kb_files_agent ON knowledge_base_files(agent_id);
CREATE INDEX idx_kb_files_hash ON knowledge_base_files(file_hash);

-- knowledge_base_chunks: 知识库分块
CREATE TABLE knowledge_base_chunks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES knowledge_base_files(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT,
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_kb_chunks_file ON knowledge_base_chunks(file_id);
CREATE INDEX idx_kb_chunks_agent ON knowledge_base_chunks(agent_id);
```

#### Migration 010: Channel 状态持久化

```sql
-- channel_state: Channel 运行时状态（游标、token 等）
CREATE TABLE channel_state (
  channel TEXT NOT NULL,
  account_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (channel, account_id, key)
);
```

用于微信个人号 long-polling 的 cursor（`get_updates_buf`）持久化，确保重启后从上次位置继续拉取消息。其他需要状态持久化的 Channel 也可复用此表。

### 4.3 表关系图

```
agents (核心)
  │
  ├──→ permissions (1:N)
  ├──→ memory_units (1:N)
  │     └──→ knowledge_graph.source_memory_id (N:1)
  ├──→ knowledge_graph (1:N)
  ├──→ conversation_log (1:N)
  ├──→ capability_graph (1:N, UNIQUE agent+capability)
  ├──→ tool_audit_log (1:N)
  │     └──→ permissions.id (N:1)
  ├──→ bindings (1:N)
  ├──→ cron_jobs (1:N)
  ├──→ knowledge_base_files (1:N)
  │     └──→ knowledge_base_chunks (1:N)
  └──→ audit_log (1:N)

embeddings (独立, 通过 id 关联 memory_units 或 knowledge_base_chunks)
channel_state (独立, 按 channel+account_id+key 存储渠道运行时状态)
```

### 4.4 索引策略

| 表 | 索引 | 用途 |
|---|---|---|
| permissions | agent_id, (agent_id, category) | 按 Agent 查权限 |
| memory_units | agent_id, (agent_id, category), (agent_id, merge_key), (agent_id, activation DESC) | 记忆检索 |
| knowledge_graph | agent_id, (subject_id, predicate), (object_id, predicate) | 图谱查询 |
| conversation_log | (agent_id, session_key), (agent_id, compaction_status) | 历史加载 |
| tool_audit_log | agent_id, session_key | 审计查询 |
| bindings | agent_id, (channel, account_id, peer_id) | 绑定匹配 |
| cron_jobs | agent_id, next_run_at (WHERE enabled=1) | 到期任务查询 |
| embeddings | source_type | 按类型查向量 |
| knowledge_base_files | agent_id, file_hash | 去重查询 |
| knowledge_base_chunks | file_id, agent_id | 分块查询 |

---

## 5. 安全架构

### 5.1 安全分层

```
┌───────────────────────────────────────────────────────────┐
│ 第 1 层: 传输安全                                         │
│  ✅ 仅绑定 127.0.0.1                                     │
│  ✅ 256-bit Bearer Token (每次启动随机)                     │
│  ✅ CORS 白名单 (localhost/127.0.0.1)                      │
├───────────────────────────────────────────────────────────┤
│ 第 2 层: 凭证安全                                         │
│  ✅ macOS Keychain (security-framework)                    │
│  ✅ AES-256-GCM 加密 (ring)                               │
│  ✅ 日志自动脱敏 (apiKey/token/secret/password)             │
├───────────────────────────────────────────────────────────┤
│ 第 3 层: 权限控制                                         │
│  ✅ 7 类别 × 4 作用域 权限模型                              │
│  ✅ PermissionInterceptor 工具拦截                          │
│  ✅ 审计日志 (audit_log + tool_audit_log)                   │
│  🔲 exec 审批精确绑定 (计划: 绑定 argv)                    │
├───────────────────────────────────────────────────────────┤
│ 第 4 层: 运行时安全                                       │
│  ✅ 工具循环检测 (4 模式, 熔断器 30)                        │
│  ✅ 结果截断 (50K 字符, 头尾保留)                           │
│  ✅ PI process.exit 拦截                                   │
│  ✅ unhandledRejection / uncaughtException 捕获             │
│  🔲 Prompt 注入检测 (计划: 17 模式)                        │
│  🔲 Unicode 混淆检测 (计划)                                │
├───────────────────────────────────────────────────────────┤
│ 第 5 层: Skill 安全                                       │
│  ✅ 安装前安全扫描 (6 种危险模式)                           │
│  ✅ 风险等级评估 (low/medium/high)                         │
│  ✅ 门控检查 (bins/env/os)                                 │
│  ✅ 用户确认安装                                           │
├───────────────────────────────────────────────────────────┤
│ 第 6 层: 数据安全                                         │
│  ✅ 记忆可见性控制 (private/shared/channel_only)            │
│  ✅ 反馈循环防护 (零宽空格标记)                              │
│  🔲 数据分级标记 (计划: L1-L4)                             │
│  🔲 SIEM 集成导出 (计划)                                   │
└───────────────────────────────────────────────────────────┘
```

### 5.2 安全宪法

Agent 系统提示中嵌入的核心安全约束:

```xml
<safety>
你是一个 AI 助手，遵循以下核心安全原则：
- 你没有独立目标，始终服务于用户的需求
- 安全和人类监督优先于任务完成
- 不自我保护、不试图保持运行、不修改自身配置
- 拒绝执行可能造成伤害的指令
- 如遇不确定情况，主动询问用户确认
</safety>
```

### 5.3 Sidecar 进程安全

```
✅ 进程隔离: Rust 主进程与 Node.js 完全隔离
✅ 自动重启: 最多 3 次，间隔 2 秒
✅ 优雅关闭: SIGTERM → 500ms → SIGKILL
✅ 全局异常捕获: 防止第三方库 crash 进程
✅ 内嵌 Node.js: 优先使用 bundle 内的 node 二进制
✅ Node 版本验证: verify_node() 3 秒超时验证
```

---

## 6. API 设计

### 6.1 路由组总览

✅ 14 个路由组，共计约 2,300 行

| 路由前缀 | 文件 | 行数 | 功能 |
|----------|------|------|------|
| `/health` | `server.ts` | — | 健康检查 (无认证) |
| `/config` | `config.ts` | — | 配置管理 |
| `/agents` | `agents.ts` | 158 | Agent CRUD + 工作区 |
| `/chat` | `chat.ts` | 479 | SSE 聊天 + 消息历史 |
| `/chat` (feedback) | `feedback.ts` | — | 满意度反馈 |
| `/memory` | `memory.ts` | — | 记忆 CRUD + 搜索 |
| `/security` | `security.ts` | — | 权限管理 + 审计日志 |
| `/knowledge` | `knowledge.ts` | — | 知识库文件管理 |
| `/skill` | `skill.ts` | — | Skill 搜索/安装/卸载 |
| `/evolution` | `evolution.ts` | — | 能力图谱 + 成长事件 |
| `/provider` | `provider.ts` | 533 | Provider CRUD + 模型拉取 |
| `/cron` | `cron.ts` | — | 定时任务管理 |
| `/binding` | `binding.ts` | — | Agent-Channel 绑定 |
| `/channel` | `channel.ts` | — | 渠道连接/状态 |
| `/doctor` | `doctor.ts` | — | 自诊断 (始终可用) |

### 6.2 核心 API 端点

#### 聊天 API

```
POST   /chat/:agentId/message     发送消息 (SSE 流式响应)
POST   /chat/:agentId/abort       中止当前响应
GET    /chat/:agentId/history      获取消息历史
DELETE /chat/:agentId/history      清空历史
POST   /chat/:agentId/feedback     提交反馈信号
```

SSE 事件类型:
```
agent_start     — Agent 开始处理
text_delta      — 文本增量
thinking_delta  — 思考过程增量
tool_start      — 工具调用开始 {toolName, toolArgs}
tool_end        — 工具调用结束 {toolName, toolResult, isError}
text_done       — 文本完成 {text}
agent_done      — Agent 处理完成
error           — 错误 {error}
```

#### Agent API

```
GET    /agents                    列出所有 Agent
POST   /agents                    创建 Agent
GET    /agents/:id                获取 Agent 详情
PUT    /agents/:id                更新 Agent
DELETE /agents/:id                删除 Agent
PUT    /agents/:id/status         更新状态
GET    /agents/:id/workspace/:file   读取工作区文件
PUT    /agents/:id/workspace/:file   写入工作区文件
POST   /agents/builder/step       引导式创建 (6 阶段)
```

#### Provider API

```
GET    /provider                  列出所有 Provider
POST   /provider/register         注册 Provider
DELETE /provider/:id              注销 Provider
POST   /provider/:id/models/fetch 拉取模型列表
GET    /provider/:id/models       获取模型列表
POST   /provider/resolve          解析模型 (优先级链)
```

#### 记忆 API

```
GET    /memory/:agentId           列出记忆 (分类过滤+分页)
GET    /memory/:agentId/:id       获取单条记忆
POST   /memory/:agentId/search    搜索记忆 (HybridSearcher)
PUT    /memory/:agentId/:id       更新记忆
DELETE /memory/:agentId/:id       删除记忆
POST   /memory/:agentId/:id/archive  归档记忆
POST   /memory/:agentId/:id/pin      置顶记忆
DELETE /memory/:agentId/:id/pin      取消置顶
```

#### Skill API

```
GET    /skill/search              搜索技能商店
GET    /skill/installed           列出已安装 Skill
POST   /skill/prepare             准备安装 (下载+安全扫描)
POST   /skill/confirm             确认安装
DELETE /skill/:name               卸载 Skill
```

#### Doctor API

```
GET    /doctor/status             系统状态概览
GET    /doctor/queue              LaneQueue 状态
GET    /doctor/db                 数据库健康检查
POST   /doctor/provider/:id/test  Provider 连通性测试
```

---

## 7. 性能与可扩展性

### 7.1 性能指标

| 指标 | 目标 | 当前状态 |
|------|------|---------|
| Sidecar 启动 | < 3 秒 | ✅ ~2 秒 |
| 首条消息延迟 | < 500ms (不含 LLM) | ✅ |
| 记忆检索 (Phase 1+2) | < 200ms | ✅ |
| L2 加载 (Phase 3) | < 100ms | ✅ |
| SQLite WAL 写入 | < 5ms | ✅ |
| 并发对话 | 4 (main lane) | ✅ |
| 子 Agent 并发 | 8 (subagent lane) | ✅ |

### 7.2 内存管理

```
SQLite WAL 模式:
  - 读写分离，不阻塞
  - 自动 checkpoint

向量搜索:
  - sqlite-vec 内存占用与维度和数量线性相关
  - 降级: 无 embedding 配置时纯 FTS5

PI Session:
  - InMemory SessionManager (不落盘)
  - 会话结束 dispose() 释放

Node.js 进程:
  - unhandledRejection 防泄漏
  - process.exit 拦截防意外退出
```

### 7.3 扩展策略

```
水平扩展 (不适用):
  EvoClaw 是桌面应用，单机部署，不需要水平扩展

垂直扩展:
  - LaneQueue 并发数可配置
  - SQLite WAL 支持高并发读
  - embedding 可选配置 (降级 FTS5)

功能扩展:
  - ContextPlugin 架构支持新插件 (内部)
  - ChannelAdapter 接口支持新渠道 (内部)
  - Provider 注册机制支持新 LLM (配置)
  - Skill 系统支持第三方技能 (审计后安装)
```

---

## 8. 部署架构

### 8.1 Tauri 打包

```
品牌系统:
  EvoClaw   — 主品牌 (通用 AI Agent)
  HealthClaw — 垂直品牌 (健康管理)

构建命令:
  pnpm build:desktop            # EvoClaw
  pnpm build:desktop:healthclaw # HealthClaw
  pnpm build:dmg                # EvoClaw DMG
  pnpm build:dmg:healthclaw     # HealthClaw DMG

品牌差异:
  - 应用名称、图标、配色
  - 数据目录名 (~/.<brand>/)
  - 数据库文件名 (<brand>.db)
  - 由 packages/shared/src/brand.ts 控制
```

### 8.2 Sidecar 管理

```
启动:
  Tauri setup() → spawn_sidecar()
  └── 查找 node: 内嵌 > nvm > fnm > volta > homebrew > 系统
  └── spawn: node server.mjs
  └── 解析首行 JSON: {port, token}
  └── 通知前端: emit("sidecar-ready")

重启:
  前端 → restart_sidecar() → kill → spawn
  自动: 进程退出 → 2s 延迟 → 重启 (最多 3 次)

关闭:
  应用退出 → shutdown_sidecar()
  └── SHUTTING_DOWN = true (防止自动重启)
  └── SIGTERM → 500ms → SIGKILL
```

### 8.3 数据目录结构

```
~/.<brand>/
├── <brand>.db              — SQLite 数据库
├── <brand>.db-wal          — WAL 日志
├── <brand>.db-shm          — 共享内存
├── evo_claw.json           — 配置文件
├── logs/                   — 日志目录
│   └── *.log
├── agents/                 — Agent 工作区
│   └── <agentId>/
│       └── workspace/
│           ├── SOUL.md
│           ├── IDENTITY.md
│           └── ... (8 文件)
└── skills/                 — 已安装 Skill
    └── <skill-name>/
        └── SKILL.md
```

### 8.4 平台支持

| 平台 | 状态 | 说明 |
|------|------|------|
| macOS (arm64) | ✅ 已支持 | 主要开发平台，Keychain 集成 |
| macOS (x86_64) | ✅ 已支持 | Universal Binary |
| Windows | 🔲 计划 | Tauri 2.0 原生支持，需适配凭证存储 |
| Linux | 🔲 低优先级 | — |
| Mobile | 🔲 远期 | — |

---

## 9. 测试架构

### 9.1 当前测试基础设施

```
框架: Vitest
位置: packages/core/src/__tests__/
运行: pnpm test
```

✅ **已有测试覆盖**:
- 单元测试: 核心模块功能测试
- Rust 测试: `crypto.rs` 加密解密回环测试

### 9.2 计划测试增强

🔲 **架构守卫测试**
- 导入关系验证（禁止循环依赖）
- 层级边界检查（下层不依赖上层）
- 公共 API 兼容性测试

🔲 **内存泄漏检测**
- Node.js heap snapshot 对比
- PI Session dispose 验证
- AbortController 清理验证
- EventListener 泄漏检测

🔲 **压力测试**
- 并发对话压测 (LaneQueue 饱和)
- 大量记忆检索性能 (1000+ 条)
- 长对话 compaction 测试 (100+ 轮)
- SQLite WAL checkpoint 频率

🔲 **安全测试**
- Prompt 注入检测覆盖率
- 权限拦截完整性
- Token 暴力破解阻止
- 审计日志完整性

---

## 10. 技术路线图

### 10.1 高优先级 (P0)

| 项目 | 描述 | 预估工作量 |
|------|------|-----------|
| 🔲 Prompt 注入检测 | 17 种模式检测 + Unicode 混淆 | 3 天 |
| 🔲 钉钉适配器 | DingtalkAdapter 实现 | 2 天 |
| 🔲 Auth Doctor | API Key 诊断 + 余额检查 | 2 天 |
| 🔲 用量追踪 | 调用量/成本统计面板 | 3 天 |
| 🔲 Windows 适配 | 凭证存储适配 + 测试 | 5 天 |

### 10.2 中优先级 (P1)

| 项目 | 描述 | 预估工作量 |
|------|------|-----------|
| 🔲 exec argv 精确绑定 | 审批绑定到具体命令 | 2 天 |
| 🔲 消息去重/线程路由 | Channel 增强 (借鉴 OpenClaw) | 3 天 |
| 🔲 规则化记忆过滤器 | 正则预过滤 + 配置化 | 2 天 |
| 🔲 压缩质量审计 | 语义保持率评估 | 3 天 |
| 🔲 架构守卫测试 | 依赖/层级自动校验 | 2 天 |
| 🔲 EvoClaw SkillHub API | 自托管技能仓库 | 5 天 |

### 10.3 低优先级 (P2)

| 项目 | 描述 | 预估工作量 |
|------|------|-----------|
| 🔲 LSP 工具集成 | 代码智能工具 | 5 天 |
| 🔲 image_generate | 图片生成工具 | 2 天 |
| 🔲 SIEM 集成导出 | 审计日志外发 | 3 天 |
| 🔲 数据分级标记 | L1-L4 分级系统 | 3 天 |
| 🔲 内存泄漏检测 | Node.js 堆分析基础设施 | 3 天 |
| 🔲 QQ 适配器 | QQ Channel Bot | 3 天 |
| 🔲 沙箱环境变量阻断 | Docker env 白名单 | 1 天 |

### 10.4 不采用的技术方向

| 技术 | 决定 | 原因 |
|------|------|------|
| ACP 协议 | 不采用 (P3) | 保持 Hono HTTP + LaneQueue + SSE |
| 第三方插件系统 | 不采用 | 全内置，ContextPlugin 仅内部模块化 |
| GitHub URL 直装 Skill | 不采用 | 仅通过 SkillHub API 安装 |
| 本地模型 | 不采用 | 所有 LLM 调用统一走 ModelRouter |
| Web UI | 不采用 | 仅桌面应用 (Tauri 2.0) |

---

## 附录

### A. 关键类型定义

详见 `packages/shared/src/types/` 目录:

| 文件 | 导出类型 |
|------|---------|
| `agent.ts` | AgentConfig, AgentStatus, AgentFile, Binding |
| `memory.ts` | MemoryUnit, MemoryCategory, MergeType, MemoryVisibility, KnowledgeGraphEntry |
| `message.ts` | ChatMessage, MessageRole, ToolCall, AgentEvent, AgentEventType, SessionKey |
| `permission.ts` | PermissionGrant, PermissionCategory, PermissionScope |
| `provider.ts` | ProviderConfig, ModelConfig, ResolvedModel |
| `channel.ts` | ChannelType, ChannelMessage (含 mediaPath/mediaType 可选字段) |
| `skill.ts` | SkillMetadata, SkillRequires, SkillSearchResult, SkillSecurityReport, InstalledSkill |
| `evolution.ts` | CapabilityNode, CapabilityDimension, GrowthEvent, GrowthVector, SatisfactionSignal, HeartbeatConfig, CronJobConfig |
| `config.ts` | EvoClawConfig, ModelsConfig, ProviderEntry, ModelEntry, ApiProtocol, ConfigValidation |
| `knowledge.ts` | 知识库相关类型 |

### B. 配置文件格式

`evo_claw.json`:

```json
{
  "models": {
    "default": "anthropic/claude-sonnet-4-20250514",
    "embedding": "openai/text-embedding-3-small",
    "providers": {
      "anthropic": {
        "baseUrl": "https://api.anthropic.com/v1",
        "apiKey": "sk-ant-xxx",
        "api": "anthropic-messages",
        "models": [
          {
            "id": "claude-sonnet-4-20250514",
            "name": "Claude Sonnet 4",
            "contextWindow": 200000,
            "maxTokens": 8192,
            "input": ["text", "image"]
          }
        ]
      },
      "deepseek": {
        "baseUrl": "https://api.deepseek.com/v1",
        "apiKey": "sk-xxx",
        "api": "openai-completions",
        "models": [
          {
            "id": "deepseek-chat",
            "name": "DeepSeek V3",
            "contextWindow": 65536,
            "maxTokens": 8192
          }
        ]
      }
    }
  },
  "services": {
    "brave": {
      "apiKey": "BSA-xxx"
    }
  }
}
```

### C. 常量定义

来自 `packages/shared/src/constants.ts`:

```typescript
PORT_RANGE = { min: 49152, max: 65535 }  // Sidecar 端口范围
TOKEN_BYTES = 32                          // 256-bit Bearer Token
FALLBACK_MODEL = { provider: 'openai', modelId: 'gpt-4o-mini' }
MEMORY_L0_MAX_TOKENS = 100               // L0 摘要上限
MEMORY_L1_MAX_TOKENS = 2000              // L1 概览上限
MEMORY_L2_BUDGET_TOKENS = 8000           // L2 检索预算
HOTNESS_HALF_LIFE_DAYS = 7               // 热度半衰期
LANE_CONCURRENCY = { main: 4, subagent: 8, cron: 2 }
AGENT_WORKSPACE_FILES = [                 // 8 个工作区文件
  'SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'TOOLS.md',
  'HEARTBEAT.md', 'USER.md', 'MEMORY.md', 'BOOTSTRAP.md'
]
```

---

> **文档版本**: v6.2 -- 新增 3.5.4 工具系统优化路线图（P0/P1/P2/P3 共 18 项），MCP 集成架构设计、Read 自适应分页机制、Schema Provider 适配层。基于 EvoClaw vs OpenClaw 工具系统对比分析
>
> **文档维护**: 本文档随代码同步更新。如有架构变更，请在对应章节标注 ✅ (已实现) 或 🔲 (计划中) 状态。
