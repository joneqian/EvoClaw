# DeerFlow vs OpenClaw 深度研究报告

## 一、项目概览

| 维度 | DeerFlow | OpenClaw |
|------|----------|----------|
| **全称** | Deep Exploration and Efficient Research Flow | OpenClaw (原 Clawdbot → Moltbot) |
| **作者** | 字节跳动 (ByteDance) | Peter Steinberger (个人开发者，后加入 OpenAI) |
| **定位** | SuperAgent 运行时框架 | 自托管个人 AI 助手平台 |
| **Stars** | ~28,900 | ~247,000 (GitHub 历史上增长最快的项目) |
| **许可证** | MIT | MIT |
| **当前版本** | v2.0 (2026.02.27 发布) | 2026.3.9 (日历版本号) |
| **核心语言** | Python + TypeScript | TypeScript + Swift + Kotlin |
| **官网** | deerflow.tech | openclaw.ai |

---

## 二、核心思想与设计哲学

### DeerFlow — "Harness, not Framework"

1. **运行时基础设施优先**：不是又一个 LLM 抽象层，而是提供 Agent 真正需要的运行时基础设施（沙箱、文件系统、持久化内存）
2. **Skills 即 Markdown**：通过 `SKILL.md` 文件（含 YAML front-matter）声明式扩展能力，无需编写代码
3. **Context Engineering > Prompt Engineering**：上下文管理是核心架构关注点，包括自动摘要、文件系统卸载、结构化记忆注入
4. **模型无关性**：通过 Python 反射机制（如 `langchain_openai:ChatOpenAI`）零代码切换任何 LangChain 兼容模型
5. **沙箱优先执行**：所有文件操作和代码执行通过沙箱抽象层，统一虚拟路径
6. **中间件驱动架构**：借鉴 Web 框架（Express/Django）的中间件链模式应用于 LLM Agent

### OpenClaw — "Your own personal AI, any OS, any platform"

1. **本地优先 / 隐私优先**：运行在用户自己的设备上，用户完全掌控
2. **安全默认**：DM 配对策略、白名单、速率限制、执行审批工作流、沙箱执行
3. **可 Hack 设计**：选择 TypeScript 保持系统可访问性，是编排平台而非底层运行时
4. **最小内核 + 可扩展表面**：核心保持精简，能力通过 npm 包扩展，Skills 上架 ClawHub
5. **MCP 桥接模式**：通过 `mcporter` 桥接而非直接嵌入 MCP，实现解耦演进
6. **严格贡献纪律**：单 PR 单 Issue，5000 行上限，不接受重复 ClawHub 的核心 Skill

---

## 三、架构设计对比

### DeerFlow — 三服务 + 中间件链架构

```
                        Nginx (port 2026)
                       /        |        \
              LangGraph Server  Gateway API  Frontend
              (port 2024)       (port 8001)  (port 3000)
              Agent 运行时       REST API      Next.js UI
```

**Agent 中间件链**（11 层顺序执行）：

1. **ThreadDataMiddleware** — 工作区/上传/输出目录初始化
2. **UploadsMiddleware** — 文件列表注入
3. **SandboxMiddleware** — 沙箱获取
4. **SummarizationMiddleware** — Token 限制接近时压缩上下文
5. **TitleMiddleware** — 自动生成标题
6. **TodoMiddleware** — Plan 模式任务追踪
7. **ViewImageMiddleware** — 视觉模型支持
8. **ClarificationMiddleware** — 追问处理
9. **MemoryMiddleware** — 长期记忆注入/更新
10. **DanglingToolCallMiddleware** — 未完成工具调用清理
11. **SubagentLimitMiddleware** — 并发限制

**Sub-Agent 系统**：

- Lead Agent 分解任务 → 批量委派给 general-purpose / bash 子 Agent → ThreadPoolExecutor 并行执行 → 结果合成
- 模式：**DECOMPOSE → DELEGATE (batched) → SYNTHESIZE**

**沙箱架构**（三种模式）：

| 模式 | 适用场景 | 技术实现 |
|------|----------|----------|
| LocalSandboxProvider | 开发环境 | 本地直接执行 |
| AioSandboxProvider | 生产环境 | Docker 容器 |
| Provisioner-managed | 企业级 | Kubernetes Pod |

- 统一虚拟路径：`/mnt/user-data/{workspace,uploads,outputs}`

### OpenClaw — Gateway + Agent + Channel 架构

```
[22+ 消息平台] ←→ [Channel Adapters/Extensions] ←→ [Gateway 控制平面]
                                                          |
                                                  [Agent Runtime (Pi)]
                                                       |        |
                                                  [Tools]   [Skills]
                                                       |
                                                [AI Model Providers]
```

**核心组件**：

| 组件 | 规模 | 职责 |
|------|------|------|
| **Gateway Server** | 242+ 文件 | 中央控制平面，WebSocket 协议，150+ 消息类型，AJV 验证，订阅式事件广播 |
| **Agent Runtime** | 548+ 条目 | Pi Agent RPC 模式，工具/块流式传输，多 Agent 路由，工作区隔离 |
| **Channel System** | 22+ 平台 | 抽象适配器模式，每个平台一个 extensions/ 包 |
| **Context Engine** | — | 可插拔上下文组装、压缩和摄取 |
| **Canvas Host** | — | A2UI (Agent-to-UI) 协议，Agent 可动态渲染交互式视觉界面 |
| **Routing** | — | 账户查找、路由解析、会话键管理 |

---

## 四、技术路线对比

| 维度 | DeerFlow | OpenClaw |
|------|----------|----------|
| **后端语言** | Python 3.12+ | TypeScript (Node.js ≥ 22.12.0) |
| **Agent 框架** | LangGraph + LangChain | 自研 Agent Runtime |
| **API 框架** | FastAPI + Uvicorn | Express + Hono |
| **前端** | Next.js 16, React 19, Tailwind CSS 4 | 原生应用 (Swift/Kotlin) + Canvas |
| **包管理** | uv (Python) + pnpm (前端) | pnpm 10.23.0 |
| **构建工具** | Turbopack (前端) | TSDown + ESM |
| **测试** | 未明确 | Vitest (70% 覆盖率阈值) |
| **代码检查** | 未明确 | Oxlint / Oxfmt |
| **模型支持** | OpenAI, Claude, Gemini, DeepSeek, Doubao, Kimi 等 | Anthropic, OpenAI, Google Gemini, GitHub Copilot, Qwen |
| **搜索集成** | Tavily, Jina AI, DuckDuckGo, Firecrawl | Playwright 浏览器自动化 |
| **MCP 集成** | langchain-mcp-adapters 直接集成 | mcporter 桥接模式 |
| **部署** | Docker Compose + Nginx + Makefile | 本地运行 (laptop/homelab/VPS) |
| **IM 集成** | Telegram, Slack, 飞书 (3个) | 22+ 平台 (WhatsApp, Telegram, Slack, Discord, Signal, iMessage 等) |
| **原生应用** | 无 | macOS (菜单栏), iOS, Android |

---

## 五、核心能力对比

### DeerFlow 特色能力

| 能力 | 说明 |
|------|------|
| **Skills-as-Markdown** | 无代码扩展 Agent 能力，通过 SKILL.md 文件声明式定义 |
| **11 层中间件链** | Web 框架模式应用于 Agent，可插拔、可排序 |
| **三级沙箱** | Local / Docker / K8s 统一虚拟文件系统 |
| **嵌入式客户端模式** | `DeerFlowClient` 可不启 HTTP 服务直接用于 Python 项目 |
| **反射式模型工厂** | 配置字符串即可切换 Provider，零代码修改 |
| **层次化长期记忆** | 用户上下文 (工作/个人/关注点) + 时间历史 + 置信度评分事实 |
| **Plan 模式** | TODO 列表追踪 + 实时进度更新 |
| **制品生成** | 报告、PPT、网页、图片、视频 |

### OpenClaw 特色能力

| 能力 | 说明 |
|------|------|
| **22+ 消息平台统一接入** | 一个 AI 人格跨所有平台 |
| **A2UI 协议 (Canvas)** | Agent 动态渲染交互式 UI，超越纯文本 |
| **执行审批工作流** | 用户显式控制 Agent 可在系统上执行什么 |
| **原生伴侣应用** | macOS 菜单栏、iOS、Android (含语音唤醒) |
| **52 个内置 Skills** | Apple Notes, Notion, Obsidian, Spotify, GitHub Issues, 1Password, 智能家居等 |
| **Cron 任务 + Webhooks** | 定时任务和事件驱动自动化 |
| **设备配对** | Bonjour 发现 + 多设备协调 |
| **Plugin SDK** | 60+ 导出模块 |
| **Lobster 工作流 Shell** | 类型化、本地优先的宏引擎 |

---

## 六、生态定位与社区评价

### DeerFlow

- **定位**：提供 Agent 真正需要的运行时基础设施，区别于 LangChain（抽象层）、CrewAI（角色协调）、AutoGPT（实验性）
- **对标**：OpenAI Deep Research 的开源替代
- **社区评价**：被认为比大多数开源 Agent 项目更完整，但也有人提醒需关注治理和安全
- **发布即登顶**：v2.0 发布次日 GitHub Trending #1，单日 692 星

### OpenClaw

- **定位**：最强开源个人 AI 助手，不只是框架而是即用产品
- **对标**：AutoGPT、CrewAI 的更成熟替代
- **社区评价**：两极分化严重
  - **正面**：用户报告 2-5x 生产力提升
  - **负面**：15+ 小时初始配置，成本不可预测
- **安全争议 (重大)**：
  - **ClawJacked 漏洞**：恶意网站可通过 WebSocket 劫持本地 Agent，窃取 Token 并获得 RCE
  - **ClawHub 恶意 Skills**：2,857 个 Skill 中有 341 个纯恶意（Bitdefender 统计约 20%），包含 AMOS macOS 窃密器
  - **3 万+ 公开暴露实例**：93.4% 存在认证绕过
  - **明文存储凭证**：API Key 和消息 Token
  - Google 安全工程副总裁公开警告不要安装；东北大学网安教授称其为"隐私噩梦"

---

## 七、关键差异总结

| 维度 | DeerFlow | OpenClaw |
|------|----------|----------|
| **核心理念** | Agent 运行时基础设施 | 个人 AI 助手产品 |
| **目标用户** | 开发者 / 研究者 / 企业 | 最终用户 / 技术爱好者 |
| **扩展方式** | Markdown Skill 文件 | npm 包 + ClawHub 市场 |
| **执行隔离** | 三级沙箱 (Local/Docker/K8s) | 本地执行 + 审批工作流 |
| **消息平台** | 3 个 IM | 22+ 平台 |
| **原生应用** | 无 | macOS / iOS / Android |
| **安全状况** | 相对稳健 | 重大安全争议 |
| **背景** | 字节跳动企业级支持 | 个人项目 → OpenAI 支持 |
| **架构风格** | 中间件链 + Sub-Agent 编排 | Gateway + Channel Adapter |
| **上下文管理** | 深度集成 (摘要 + 记忆 + 文件卸载) | 可插拔 Context Engine |

---

## 八、架构详解

### DeerFlow 中间件链详解

```
用户请求
    │
    ▼
┌─────────────────────────┐
│  ThreadDataMiddleware    │ ← 初始化工作区目录
├─────────────────────────┤
│  UploadsMiddleware       │ ← 注入用户上传文件列表
├─────────────────────────┤
│  SandboxMiddleware       │ ← 获取/创建沙箱实例
├─────────────────────────┤
│  SummarizationMiddleware │ ← Token 接近上限时压缩历史
├─────────────────────────┤
│  TitleMiddleware         │ ← 自动生成对话标题
├─────────────────────────┤
│  TodoMiddleware          │ ← Plan 模式任务追踪
├─────────────────────────┤
│  ViewImageMiddleware     │ ← 图片处理（视觉模型）
├─────────────────────────┤
│  ClarificationMiddleware │ ← 判断是否需要追问
├─────────────────────────┤
│  MemoryMiddleware        │ ← 注入/更新长期记忆
├─────────────────────────┤
│  DanglingToolCallMiddleware │ ← 清理未完成的工具调用
├─────────────────────────┤
│  SubagentLimitMiddleware │ ← 控制子 Agent 并发
└─────────────────────────┘
    │
    ▼
  LLM 调用
```

### DeerFlow Sub-Agent 编排流程

```
用户复杂查询
    │
    ▼
┌──────────────┐
│  Lead Agent  │  ← 任务分解器，不直接执行
└──────┬───────┘
       │ COUNT: "我有 N 个子任务"
       │ PLAN:  "Batch 1: 前 M 个; Batch 2: 剩余"
       ▼
┌──────────────────────────────────────┐
│         Batch 1 (当前轮次)            │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐│
│  │SubAgent1│ │SubAgent2│ │SubAgent3││
│  │ general │ │ general │ │  bash   ││
│  └────┬────┘ └────┬────┘ └────┬────┘│
│       │           │           │     │
│  ThreadPoolExecutor 并行执行         │
└──────────────────────────────────────┘
       │ 收集结果
       ▼
┌──────────────────────────────────────┐
│         Batch 2 (下一轮次)            │
│  ┌─────────┐ ┌─────────┐           │
│  │SubAgent4│ │SubAgent5│           │
│  └────┬────┘ └────┬────┘           │
└──────────────────────────────────────┘
       │ 收集结果
       ▼
┌──────────────┐
│  SYNTHESIZE  │  ← 合成所有批次结果
└──────────────┘
```

### OpenClaw Gateway 架构

```
┌──────────────────────────────────────────────┐
│                   Gateway                     │
│  ┌─────────────┐  ┌──────────────────────┐   │
│  │ WebSocket    │  │ 150+ 消息类型         │   │
│  │ 协议层       │  │ AJV Schema 验证      │   │
│  └──────┬──────┘  └──────────┬───────────┘   │
│         │                    │                │
│  ┌──────▼────────────────────▼───────────┐   │
│  │         消息路由 & 订阅引擎             │   │
│  │  · 账户查找                            │   │
│  │  · 路由解析                            │   │
│  │  · 会话键管理                          │   │
│  │  · 事件广播                            │   │
│  └──────────────────┬────────────────────┘   │
└─────────────────────┼────────────────────────┘
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │ Agent    │ │ Channel  │ │ Canvas   │
    │ Runtime  │ │ Adapters │ │ Host     │
    │ (Pi)     │ │ (22+)    │ │ (A2UI)   │
    └──────────┘ └──────────┘ └──────────┘
```

---

## 九、结论与建议

### DeerFlow 适用场景

- 需要**深度研究和复杂任务自动化**的场景
- 需要**企业级沙箱隔离**（Docker/K8s）的生产环境
- 希望基于 **LangGraph/LangChain 生态**构建的团队
- 需要**制品生成**（报告、PPT、网页）的工作流

### OpenClaw 适用场景

- 需要**跨 22+ 消息平台**统一 AI 助手的个人用户
- 需要**原生移动端体验**（iOS/Android 语音唤醒）
- 需要**丰富的内置 Skill 生态**（智能家居、笔记、音乐等日常自动化）
- 需要 **A2UI 可视化交互界面**

### 风险提示

> **⚠️ OpenClaw 安全风险极高**
>
> ClawHub 恶意包泛滥、认证绕过、明文凭证存储、WebSocket 劫持漏洞，在生产环境使用需极度谨慎。
> Google 安全工程副总裁公开警告不要安装。

> **✅ DeerFlow 相对安全**
>
> 作为字节跳动项目，技术成熟度和安全治理更有保障，但社区规模相对较小。

---

## 十、验证方式

1. 分别克隆两个仓库，按 README 指引本地部署
2. 测试 DeerFlow 的 Sub-Agent 编排 + 沙箱执行 + 记忆持久化
3. 测试 OpenClaw 的多平台消息接入 + Canvas A2UI + Skill 市场
4. 对比两者在相同复杂任务（如"深度研究某个技术主题并生成报告"）上的表现

---

*报告生成日期：2026-03-11*
