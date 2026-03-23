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
| LLM | pi-ai 统一抽象，国产模型走 openai-completions + 自定义 baseUrl（参考 OpenClaw） |
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
- **Skill 生态**: ClawHub API (clawhub.ai, `/api/v1/search` 向量搜索 + `/api/v1/download` ZIP 下载) + GitHub URL 直装 (兼容 skills.sh 生态)，遵循 AgentSkills 规范 (SKILL.md)。注意：skills.sh 无公开 REST API，仅有 CLI
- **Skill 注入**: PI 渐进式两级注入 — Tier 1: `<available_skills>` XML 目录注入 system prompt (~50-100 tokens/skill)；Tier 2: 模型用 Read 工具按需加载完整 SKILL.md。没有独立 prompt.md 文件，SKILL.md body 就是指令。Skill 不注册新工具，通过指令引导模型使用已有工具
- **Skill 门控**: PI/AgentSkills 规范不实现 requires.bins/env/os 门控，EvoClaw 作为自定义扩展实现
- **Permission Model**: 7 类别 × 4 作用域 (once/session/always/deny)，带审计日志
- **PI Provider ID 映射**: `pi-provider-map.ts` 处理 EvoClaw↔PI 的 provider ID 差异（如 glm→zai），国产模型统一走 `api:"openai-completions"`
- **PI baseUrl 处理**: 传给 PI Model 时自动去掉尾部 `/v1`（SDK 内部自己拼接）
- **PI Session 配置**: createAgentSession + InMemory(SessionManager/SettingsManager/AuthStorage) + streamSimple + usage 防御性补零
- **Agent 增强工具**: web_search（Brave）、web_fetch（URL→Markdown）、image（vision）、pdf（pdf-parse）、apply_patch（多文件 diff）
- **模块化系统提示**: 安全宪法 + 记忆召回指令 + 运行时信息 + 工具使用指导 + 技能扫描（参考 OpenClaw 22 段式架构）
- **多级错误恢复**: Auth 轮转 → overload 退避 → thinking 降级 → context overflow compaction → 模型降级
- **工具安全**: 循环检测（重复/乒乓/熔断器阈值 30）+ 结果截断（超 context budget 50% 自动截断）
- **微信个人号渠道**: iLink Bot 长轮询 (vs webhook)，QR 扫码登录 (vs AppID/Secret)，CDN + AES-128-ECB 媒体加解密管线，context_token 回传，Markdown→纯文本，/echo + /toggle-debug Slash 命令，全链路 Debug 追踪，SILK 语音转码 (可选)

## 开发命令

```bash
pnpm install                  # 安装依赖
pnpm build                    # 构建所有包 (默认 EvoClaw 品牌)
pnpm test                     # 运行所有测试 (Vitest)
pnpm lint                     # Oxlint 检查

# EvoClaw 品牌
pnpm dev                      # 启动开发
pnpm dev:core                 # 仅启动 Sidecar
pnpm build:desktop            # 构建桌面应用
pnpm build:dmg                # 打包 DMG

# HealthClaw 品牌
pnpm dev:healthclaw           # 启动开发
pnpm build:healthclaw         # 构建所有包
pnpm build:desktop:healthclaw # 构建桌面应用
pnpm build:dmg:healthclaw     # 打包 DMG
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
- 国产 LLM (Qwen/GLM/Doubao) 通过 `api:"openai-completions"` + 自定义 baseUrl 接入（不用 registerProvider，参考 OpenClaw）
- **PI Provider ID 映射**: glm→zai（通过 pi-provider-map.ts），其余 provider ID 一致
- Node.js >= 22，Rust >= 1.94
- **不使用本地模型**：所有 LLM 调用（含记忆提取、LCM 摘要）统一走 ModelRouter
- **反馈循环防护**: 零宽空格标记防止注入记忆被重复存储
- **热度衰减**: `sigmoid(log1p(access_count)) × exp(-0.099 × age_days)`，7 天半衰期
- 设计文档: `docs/prd/PRD_2026-03-20.md` (v6.1), `docs/architecture/Architecture_2026-03-20.md` (v6.1), `docs/architecture/AgentSystemDesign.md`, `docs/architecture/MemorySystemDesign.md`, `docs/iteration-plans/IterationPlan_2026-03-20.md` (v6.1)
- **当前冲刺**: Sprint 13 ✅ 已完成 — 微信个人号渠道（iLink Bot 长轮询 + QR 扫码 + CDN AES-128-ECB 媒体管线 + Markdown 转换 + Slash 命令 + Debug 追踪 + 918 测试）
