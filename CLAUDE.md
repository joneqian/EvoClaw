# EvoClaw — 自进化 AI 伴侣桌面应用

## 项目概述

pnpm monorepo + Tauri 2.0 桌面应用，Bun Sidecar 架构。用户创建具有独立人格（Soul）、记忆（Memory）、权限的 AI Agent，通过自研 Agent Kernel（参考 Claude Code 架构）对接多家 LLM。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri 2.0 (Rust) |
| 前端 | React 19 + TypeScript + Tailwind CSS 4 + Zustand |
| Sidecar | Hono + Bun + bun:sqlite (WAL)，Node.js 回退兼容 |
| Agent 运行时 | 自研 Agent Kernel (query-loop + stream-client + builtin-tools，参考 Claude Code 架构) |
| LLM | Kernel 双协议抽象 (Anthropic Messages + OpenAI Chat Completions)，国产模型走 openai-completions + 自定义 baseUrl |
| 构建 | Turborepo + pnpm 10 + Vitest + Oxlint |
| 安全 | macOS Keychain (security-framework) + AES-256-GCM (ring) |
| 沙箱 | Docker (可选，3 模式: off/selective/all，首次使用时引导安装) |

## Monorepo 结构

```
apps/desktop/          — Tauri 2.0 桌面应用 (Rust + React)
packages/core/         — Bun Sidecar (Hono HTTP 服务 + Agent Kernel)
packages/shared/       — 共享 TypeScript 类型
docs/                  — PRD, Architecture, AgentSystemDesign, MemorySystemDesign, IterationPlan
```

## 关键架构模式

- **Sidecar 通信**: Tauri → 随机端口(49152-65535) + 256-bit Bearer Token → Bun HTTP (Bun.serve)，仅绑定 127.0.0.1
- **Agent Kernel**: Hono 接收请求 → queryLoop() while(true) 循环 (流式 API → 工具执行 → 继续/退出) → SSE 流式返回
- **ContextPlugin 生命周期**: 5 hooks (bootstrap → beforeTurn → compact → afterTurn → shutdown)，10 个插件替代旧 12 层中间件链
- **5 阶段工具注入**: Kernel builtin tools (read/write/edit/grep/find/ls) → Enhanced bash → EvoClaw-specific → Channel tools → MCP + Skills
- **ModelRouter**: Agent 配置 → 用户偏好 → 系统默认 → 硬编码 fallback (gpt-4o-mini)
- **Agent 工作区**: 9 文件系统 (SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md, HEARTBEAT.md, USER.md, MEMORY.md, BOOT.md, BOOTSTRAP.md)，按场景选择性加载
- **L0/L1/L2 三层记忆**: L0 一行摘要(向量索引) → L1 结构化概览(排序用) → L2 完整内容(按需加载)，80%+ token 压缩
- **三阶段渐进检索**: Phase 1 FTS5+sqlite-vec 宽搜索 → Phase 2 L1 排序+热度加权 → Phase 3 L2 按需深加载
- **Session Key 路由**: `agent:<agentId>:<channel>:dm:<peerId>` / `agent:<agentId>:<channel>:group:<groupId>`
- **Binding Router**: 最具体优先匹配，Channel → Agent 绑定
- **Heartbeat + Cron**: Heartbeat 共享主会话上下文，Cron 隔离会话运行。HeartbeatManager 管理多 Agent runner 生命周期，executeFn 通过内部 HTTP 复用 /send 管道
- **System Events**: 内存 per-session 事件队列（enqueueSystemEvent → chat.ts drainSystemEvents → message 前缀注入），Cron actionType='event' 注入主 session
- **Standing Orders**: AGENTS.md 中结构化 Program（Scope/Trigger/Approval/Escalation），系统 prompt <standing_orders> 意识注入，Heartbeat 检查 trigger=heartbeat 程序
- **BOOT.md**: 每次 sidecar 启动执行（区别于一次性 BOOTSTRAP.md），空内容跳过，执行失败不阻塞
- **Lane Queue**: main(4) / subagent(8) / cron(可配置) 并发车道，每 session key 串行
- **Skill 生态**: ClawHub API (clawhub.ai, `/api/v1/search` 向量搜索 + `/api/v1/download` ZIP 下载) + GitHub URL 直装 (兼容 skills.sh 生态)，遵循 AgentSkills 规范 (SKILL.md)。注意：skills.sh 无公开 REST API，仅有 CLI
- **Skill 注入**: 渐进式两级注入 — Tier 1: `<available_skills>` XML 目录注入 system prompt (~50-100 tokens/skill，含 whenToUse/mode 标签)；Tier 2: 模型用 invoke_skill 工具按需加载完整 SKILL.md。Skill 不注册新工具，通过指令引导模型使用已有工具
- **Skill 执行模式**: inline（默认，指令注入当前上下文）+ fork（子代理独立执行，防止污染主对话）。SKILL.md `execution-mode: fork` 声明或调用时 `mode: "fork"` 覆盖
- **Skill model 字段**: SKILL.md 可指定 `model: provider/modelId`，fork 执行时优先使用指定模型，未配置时静默降级为当前默认模型
- **Skill 来源**: 5 种 — bundled（30 个内置技能）/ local（用户级 + Agent 级目录）/ clawhub / github / mcp（MCP prompts 自动转换）
- **MCP Prompt 桥接**: MCP 服务器 listPrompts() 自动注册为 `mcp:{serverName}:{promptName}` 技能，出现在 available_skills 目录
- **Skill 门控**: AgentSkills 规范不实现 requires.bins/env/os 门控，EvoClaw 作为自定义扩展实现
- **扩展安全策略**: 统一 NameSecurityPolicy（allowlist/denylist/disabled）覆盖 Skills + MCP Servers，denylist 绝对优先
- **企业扩展包**: evoclaw-pack.json manifest + skills/ 子目录 ZIP 打包，一键安装 skills + MCP servers + 安全策略合并
- **Zod Schema 验证**: 外部输入（配置文件、API 请求、扩展包 manifest、MCP 配置）统一通过 Zod schema 验证，safeParse 不抛异常 + passthrough 向前兼容
- **多层配置合并**: managed.json（IT 管理员）→ config.d/*.json（drop-in 片段，字母序）→ 用户配置（最高优先级）。enforced 机制：managed.json 中标记的路径强制使用管理员值。denylist 始终取并集。saveToDisk 只写用户层
- **优雅关闭**: SIGTERM/SIGINT → registerShutdownHandler 按优先级串行执行（调度器→渠道→MCP→数据库→日志）→ 30s 宽限期超时强制退出
- **PII 脱敏**: 日志 write() 自动 sanitizePII()，替换 API Key (sk-*/sk-ant-*)、Bearer token、JWT、邮箱、手机号、密码字段值。sanitizeObject() 递归脱敏对象中的敏感键值
- **Permission Model**: 7 类别 × 4 作用域 (once/session/always/deny)，带审计日志
- **Kernel 双协议**: Anthropic Messages (x-api-key + anthropic-version) + OpenAI Chat Completions (Bearer token)，国产模型统一走 openai-completions + 自定义 baseUrl
- **Kernel 三层压缩**: Snip (零成本移除旧消息) → Microcompact (零成本截断 tool_result) → Autocompact (LLM 9 段摘要)，熔断器 3 次失败后停止
- **Kernel 流式执行**: StreamingToolExecutor 流中预执行并发安全工具，90s 空闲看门狗 + 非流式回退
- **Agent 增强工具**: web_search（Brave）、web_fetch（URL→Markdown）、image（vision）、pdf（pdf-parse）、apply_patch（多文件 diff）
- **模块化系统提示**: 安全宪法 + 记忆召回指令 + 运行时信息 + 工具使用指导 + 技能扫描（参考 OpenClaw 22 段式架构）
- **多级错误恢复**: Auth 轮转 → overload 退避 → thinking 降级 → context overflow compaction → 模型降级
- **工具安全**: 循环检测（重复/乒乓/熔断器阈值 30）+ 结果截断（超 context budget 50% 自动截断）
- **Bash 安全体系**: 双路径架构 — AST 主路径（纯 TS bash 解析器 → 白名单制 FAIL-CLOSED 分析 → 变量作用域追踪 → pre-check 差异检测 → sed 专项验证）+ Legacy 正则降级路径（parse-unavailable 时回退到 23 条正则）。异步执行引擎（spawn 非阻塞 → AbortController → 超时 SIGTERM/SIGKILL → 大输出持久化 → 图片检测）
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

bun:sqlite / better-sqlite3（运行时自动选择）+ WAL 模式，MigrationRunner 自动执行 `packages/core/src/infrastructure/db/migrations/*.sql`。

核心表: agents, conversations, memory_units (L0/L1/L2 + 9 类别), knowledge_graph (实体关系三元组), conversation_log (原始消息+压缩状态), capability_graph, permissions, audit_log, model_configs

存储引擎策略: bun:sqlite (Bun) / better-sqlite3 (Node) + FTS5 单引擎覆盖全部需求，不引入外部数据库

记忆类别 (9 种): profile, preference, entity, event, case, pattern, tool, skill, correction — 分 merge/independent 语义

## 编码规范

- TypeScript strict 模式，ES2022 + NodeNext
- 导入路径带 `.js` 后缀 (ESM)
- 测试文件放 `src/__tests__/`，使用 Vitest
- Rust 代码在 `apps/desktop/src-tauri/`
- 中文注释和提示语

## 注意事项

- `pnpm.onlyBuiltDependencies` 已配置 esbuild（Bun 运行时无需 better-sqlite3 编译）
- 国产 LLM (Qwen/GLM/Doubao) 通过 `api:"openai-completions"` + 自定义 baseUrl 接入（不用 registerProvider，参考 OpenClaw）
- **Provider 认证**: Anthropic (x-api-key)、GLM (JWT from id.secret)、其他 (Bearer token)，由 model-fetcher.ts buildAuthHeaders() 统一处理
- Bun >= 1.3（主运行时），Node.js >= 22（回退兼容），Rust >= 1.94
- **不使用本地模型**：所有 LLM 调用（含记忆提取、LCM 摘要）统一走 ModelRouter
- **反馈循环防护**: 零宽空格标记防止注入记忆被重复存储
- **热度衰减**: `sigmoid(log1p(access_count)) × exp(-0.099 × age_days)`，7 天半衰期
- 设计文档: `docs/prd/PRD_2026-03-20.md` (v6.3), `docs/architecture/Architecture_2026-03-20.md` (v6.3), `docs/architecture/AgentSystemDesign.md`, `docs/architecture/MemorySystemDesign.md`, `docs/iteration-plans/IterationPlan_2026-03-20.md` (v6.3)
- **当前冲刺**: 依赖升级 + 计划同步（2026-04-20）— 接管 dependabot PR：vitest 3.2.4→4.1.4（PR #36，适配 2 处 breaking change）+ esbuild 0.27.4→0.28.0（PR #37，零改动）；修复 M8 遗留的 shared 包 NodeJS 类型耦合（PR #35）；OpenClaw 多 Agent 协作深度研究（PR #32，1633 行）+ M13 模块写入路线图（PR #34）；M12/M1.1/M3.1/Sprint16 补丁模块规划（PR #31）。TypeScript 5.9→6.0 主动延后至 §3.X A4
- **上一冲刺**: M8 会话隔离与环境安全 ✅（PR #30）— session 级权限隔离 + env 沙箱 + 域名黑名单
- **上上冲刺**: M9 Phase 1 T1/T2 ✅（PR #26 + #28）— CHANGELOG 自动化 + 多品牌构建抽象 + 构建治理
- **更早**: M6 Provider 增强 ✅（PR #20，OAuth→A3）；M5 Skills 生态增强 ✅（PR #18）；Vite 6→8 升级 ✅（PR #23）；tsbuildinfo gitignore + 类型结构化收尾 ✅（PR #27）

## 协作准则

> 来自 [andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills)，减少常见 LLM 编码错误。
>
> **取舍**：这些准则偏向谨慎而非速度，琐碎任务可自行判断。

### 1. 编码前思考

**不臆测、不藏惑、亮明取舍。**

动手前：
- 明确声明前提假设，不确定就问。
- 有多种理解时列出来，不私下选一种。
- 若有更简单方案，直说；必要时反驳。
- 有不清楚的地方就停下，指出疑点再问。

### 2. 简洁优先

**解决问题的最少代码，不做预埋。**

- 不加用户没要求的功能。
- 单次使用的代码不抽抽象。
- 不主动加"灵活性"或"可配置性"。
- 不为不可能发生的场景写错误处理。
- 200 行能写成 50 行，就重写。

自问一句："资深工程师会觉得这写得过度了吗？"答案为是就简化。

### 3. 精准修改

**只动必须动的，只清自己留下的。**

修改已有代码时：
- 不顺手"改良"周边代码、注释、格式。
- 不重构没坏的东西。
- 沿用现有风格，即使你更偏好别的写法。
- 看到无关的死代码，提一下，不要直接删。

修改产生的孤儿代码：
- 清掉**你这次改动**造成的未用 import / 变量 / 函数。
- 不要清掉**已存在**的死代码（除非用户要求）。

检验标准：每一行改动都能追溯回用户的原请求。

### 4. 目标驱动执行

**先定成功标准，再循环直到验证通过。**

把任务翻译成可验证的目标：
- "加校验" → "为非法输入写测试，再让它们通过"
- "修 bug" → "写能复现 bug 的测试，再让它通过"
- "重构 X" → "确保前后测试都能通过"

多步任务先说清楚简要计划：
```
1. [步骤] → 验证：[检查项]
2. [步骤] → 验证：[检查项]
3. [步骤] → 验证：[检查项]
```

强成功标准能让你自主闭环，弱标准（"让它能跑"）只会催生反复追问。

---

**准则生效标志**：diff 里非必要改动减少、因过度设计导致的返工减少、澄清问题出现在动手之前而非犯错之后。
