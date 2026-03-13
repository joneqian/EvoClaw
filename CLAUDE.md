# EvoClaw — 自进化 AI 伴侣桌面应用

## 项目概述

pnpm monorepo + Tauri 2.0 桌面应用，Node.js Sidecar 架构。用户创建具有独立人格（Soul）、记忆（Memory）、权限的 AI Agent，通过 PI 框架（pi-ai + pi-agent-core + pi-coding-agent）对接多家 LLM。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri 2.0 (Rust) |
| 前端 | React 19 + TypeScript + Tailwind CSS 4 + Zustand |
| Sidecar | Hono + Node.js + better-sqlite3 (WAL) |
| Agent 运行时 | PI 框架 (pi-ai + pi-agent-core + pi-coding-agent，不含 pi-tui) |
| LLM | pi-ai 统一抽象 + registerProvider() 注册国产模型 (Qwen/GLM/Doubao) |
| 构建 | Turborepo + pnpm 10 + Vitest + Oxlint |
| 安全 | macOS Keychain (security-framework) + AES-256-GCM (ring) |
| 沙箱 | Docker (可选，3 模式: off/selective/all，首次使用时引导安装) |

## Monorepo 结构

```
apps/desktop/          — Tauri 2.0 桌面应用 (Rust + React)
packages/core/         — Node.js Sidecar (Hono HTTP 服务 + PI Embedded Runner)
packages/shared/       — 共享 TypeScript 类型
docs/                  — PRD, Architecture, AgentSystemDesign, MemorySystemDesign, IterationPlan
```

## 关键架构模式

- **Sidecar 通信**: Tauri → 随机端口(49152-65535) + 256-bit Bearer Token → Node.js HTTP，仅绑定 127.0.0.1
- **PI Embedded Runner**: Hono 接收请求 → 构建 PI Agent Session → ReAct 循环 (Think→Act→Observe→Reflect) → 流式返回
- **ContextPlugin 生命周期**: 5 hooks (bootstrap → beforeTurn → compact → afterTurn → shutdown)，10 个插件替代旧 12 层中间件链
- **5 阶段工具注入**: PI base tools → EvoClaw replacements → EvoClaw-specific → Channel tools → MCP + Skills
- **ModelRouter**: Agent 配置 → 用户偏好 → 系统默认 → 硬编码 fallback (gpt-4o-mini)
- **Agent 工作区**: 8 文件系统 (SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md, HEARTBEAT.md, USER.md, MEMORY.md, BOOTSTRAP.md)，按场景选择性加载
- **L0/L1/L2 三层记忆**: L0 一行摘要(向量索引) → L1 结构化概览(排序用) → L2 完整内容(按需加载)，80%+ token 压缩
- **三阶段渐进检索**: Phase 1 FTS5+sqlite-vec 宽搜索 → Phase 2 L1 排序+热度加权 → Phase 3 L2 按需深加载
- **Session Key 路由**: `agent:<agentId>:<channel>:dm:<peerId>` / `agent:<agentId>:<channel>:group:<groupId>`
- **Binding Router**: 最具体优先匹配，Channel → Agent 绑定
- **Heartbeat + Cron**: Heartbeat 共享主会话上下文，Cron 隔离会话运行
- **Lane Queue**: main(4) / subagent(8) / cron(可配置) 并发车道，每 session key 串行
- **Skill 生态**: ClawHub (13,700+ Skills) + skills.sh，遵循 AgentSkills 规范 (SKILL.md)
- **Permission Model**: 7 类别 × 4 作用域 (once/session/always/deny)，带审计日志

## 开发命令

```bash
pnpm install              # 安装依赖
pnpm build                # 构建所有包
pnpm test                 # 运行所有测试 (Vitest)
pnpm lint                 # Oxlint 检查
pnpm dev                  # 启动开发 (Turbo)
pnpm dev:core             # 仅启动 Sidecar
pnpm build:desktop        # 构建桌面应用
```

## 数据库

better-sqlite3 + WAL 模式，MigrationRunner 自动执行 `packages/core/src/infrastructure/db/migrations/*.sql`。

核心表: agents, conversations, memory_units (L0/L1/L2 + 9 类别), knowledge_graph (实体关系三元组), conversation_log (原始消息+压缩状态), capability_graph, permissions, audit_log, model_configs

存储引擎策略: better-sqlite3 + sqlite-vec + FTS5 单引擎覆盖全部需求，不引入外部数据库

记忆类别 (9 种): profile, preference, entity, event, case, pattern, tool, skill, correction — 分 merge/independent 语义

## 编码规范

- TypeScript strict 模式，ES2022 + NodeNext
- 导入路径带 `.js` 后缀 (ESM)
- 测试文件放 `src/__tests__/`，使用 Vitest
- Rust 代码在 `apps/desktop/src-tauri/`
- 中文注释和提示语

## 注意事项

- `pnpm.onlyBuiltDependencies` 已配置 better-sqlite3 和 esbuild
- 国产 LLM (Qwen/GLM/Doubao) 通过 pi-ai 的 `registerProvider()` 注册，均为 OpenAI 兼容端点
- Node.js >= 22，Rust >= 1.94
- **不使用本地模型**：所有 LLM 调用（含记忆提取、LCM 摘要）统一走 ModelRouter
- **反馈循环防护**: 零宽空格标记防止注入记忆被重复存储
- **热度衰减**: `sigmoid(log1p(access_count)) × exp(-0.099 × age_days)`，7 天半衰期
- 设计文档: `docs/PRD.md` (v4.0), `docs/Architecture.md` (v4.0), `docs/AgentSystemDesign.md`, `docs/MemorySystemDesign.md`
