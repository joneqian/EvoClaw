# EvoClaw — 自进化 AI 伴侣桌面应用

## 项目概述

pnpm monorepo + Tauri 2.0 桌面应用，Bun Sidecar 架构。用户创建具有独立人格（Soul）、记忆（Memory）、权限的 AI Agent，通过自研 Agent Kernel（参考 Claude Code 架构）对接多家 LLM。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri 2.0 (Rust) |
| 前端 | React 19 + TypeScript + Tailwind CSS 4（shadcn 语义 token + 双主题）+ Zustand |
| Sidecar | Hono + Bun + bun:sqlite (WAL)，Node.js 回退兼容 |
| Agent 运行时 | 自研 Agent Kernel (query-loop + stream-client + builtin-tools，参考 Claude Code 架构) |
| LLM | Kernel 双协议抽象 (Anthropic Messages + OpenAI Chat Completions)，国产模型走 openai-completions + 自定义 baseUrl |
| 构建 | Turborepo + pnpm 10 + Vitest + Oxlint |
| 安全 | 凭证 JSON 文件 (Unix 0o600 / Windows NTFS ACL) + macOS Keychain 一次性 migration + AES-256-GCM (ring)，三 OS 统一 |
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
- **飞书渠道**: `@larksuiteoapi/node-sdk` WebSocket 长连接（桌面 sidecar 无公网 IP，永不做 Webhook）。`packages/core/src/channel/adapters/feishu/` 18 个文件分模块：client/config/inbound/outbound/session-key/card-envelope/send-card/send-approval/cardkit-streaming/event-handlers/parse-content/post-to-text/markdown-to-post/media/doc-api/retry/index。消息类型全覆盖（text/post/image/file/audio/media/sticker/interactive/merge_forward/share_chat），Markdown 智能渲染 Post（内容错 230001 族自动降级纯文本）。媒体上传 10MB/30MB 门控 + 下载 tmp 缓存 + MIME 推断。4 档群会话隔离 (group/group_sender/group_topic/group_topic_sender) peerId 重写，出站 `resolveFeishuReceiveId` 还原 chatId。审批卡 ocf1 envelope（version/kind/actionId/session/operator/expiry 五维校验）+ `ApprovalRegistry` Promise 生命周期（TTL 24h 默认 + cancelAll + reopen）。CardKit 流式卡片 `beginStreaming` 句柄（append/finish/abort + 60s 空闲看门狗 + 顺序号 sequence 递增）。`withFeishuRetry` 出站指数退避 equal jitter（限流 99991400 族 + 网络 transient 错 ECONNRESET/5xx 重试 3 次，不可重试 code 上抛，jitter 避雪崩）

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
- **当前冲刺**: M15 UI 现代化 5 件套（2026-05-12 启动）— 对齐 2025-2026 Anthropic/Claude AI 极简流派 + 反超 Hermes 工业级 UI 标准
  - **U1 暗色主题 + dual-theme 设计系统** ✅（PR #155，2026-05-12）：shadcn 命名 token + CSS variables + ThemeProvider 三态 + 2000+ 处颜色硬编码 sweep + ThemeSwitcher + brand-apply 模板升级 v3
  - **U2 lucide-react 图标库** ✅（PR #156 + PR #157，2026-05-12）：86 处内联 SVG 全部换 Lucide 标准组件，25 文件全覆盖；删 PathIcon 过渡 wrapper；SecurityPage 5 个 config 数组（TOOL_DISPLAY / GUARD_FEATURES / GUARD_PROTECTIONS / PERMISSION_MODES / STATUS_CONFIG）全迁移；同步修 PR-U1 留下的 brand-apply 模板未升级 bug
  - **U3 Toast (sonner) + Skeleton 系统** ✅（PR #158，2026-05-12）：sonner 全局 Toaster 跟随主题；9 个文件 12 处零散 `setToast` 状态迁移；新增 `components/Skeleton.tsx` (Skeleton/SkeletonText/SkeletonCard)；CommandPalette loading state 接入示范
  - **U4 i18n 中英双语**：PR #159（130 key）+ #160（U4b 7 Dialog）+ #161（U4c 8 页面头部）+ #162（U4d AgentCreation/ExpertSettings/Channel）+ feat/ui-i18n-zh-en-deep2（U4e SettingsPage 8 Tab 标签 + EnvVarsTab 完整 + SettingsPage 通用 save/saveFailed toast 共享 + CronPage 创建表单 + CommandPalette）；总计 ~250 key 翻译表覆盖 90%+ 用户可见 UI
  - **U4 i18n 中英双语**：2203 处中文字面量抽离（待启动）
  - **U5 ARIA + 键盘导航**：8 个 modal + 60+ 图标按钮 a11y 全覆盖（待启动）
  - 详见 `docs/iteration-plans/M15-UIModernization-Plan.md` + `docs/architecture/design-system.md`
- **上一冲刺**: M14 跨平台支持 Phase 1（Windows）✅（2026-05-12）— 7 PR 完整闭环
  - **A1 凭证文件实现 + macOS migration**：PR #148（移除 security-framework Keychain 调用 + 三 OS 统一 JSON 文件 + macOS Keychain → JSON 一次性迁移 + 19 单测）
  - **A2 sidecar binary 下载跨平台**：PR #149（download-bun/node.mjs 三 OS × arm64/x64 通吃 + scripts/lib/platform.mjs 共享 + PowerShell 解压）
  - **A3 Tauri Rust 端 Windows 路径**：PR #150（sidecar.rs 5 处 mac-only 痛点 cfg(windows) 分支：bun.exe 后缀 + Windows binary 查找 + USERPROFILE + taskkill）
  - **A4 Tauri Windows NSIS bundle + 真 ICO**：PR #151（targets nsis + windows.nsis installMode=currentUser + png-to-ico 6 尺寸合并 ICO 370KB + scripts/build-exe.mjs 跨平台入口）
  - **A5 CI matrix + release workflow**：PR #152（test.yml matrix 三 OS + release.yml workflow_dispatch mac DMG + win NSIS EXE + 修 3 个 pre-existing 跨平台测试）
  - **A6 数据目录抽 helper**：PR #153（getDataDir() helper + EVOCLAW_HOME/HEALTHCLAW_HOME 环境变量企业 IT 统一部署 + 24 个调用点收编）
  - **A7 文档**：PR #154（INSTALL_WINDOWS.md + cross-platform-credential.md 架构文档）
  - 关键决策（详见 `docs/iteration-plans/M14-CrossPlatform-Plan.md`）：D1 三 OS 全明文 JSON 完全抄 Hermes / D2 Windows 优先 Linux 后插 / D3 本期未签名 / D4 macOS 退化 Keychain + migration / D5 保持 sidecar 内置 binary
  - **未签名 UX 取舍**：Mac SmartScreen 等价 Gatekeeper 需 xattr / Win SmartScreen 需"仍要运行" / Linux 几乎无阻力。企业 IT 渠道（MDM / GPO / 内部 apt 仓库）顺畅
  - **Phase 2 Linux 后插**：1-1.5w，复用 90% 代码（待启动）
  - **Phase 3 签名 / 公证**：等 Apple Developer + Authenticode 证书（M9 + 商用证书购买）
- **上一冲刺（M7-Tier3）**: M7-Tier3 自进化能力收官 ✅（2026-05-09）+ M13 Phase 5 飞书文档协作收尾 ✅ — 5 PR 完整闭环
  - **3.1 A-B 对照实验**：PR #131（plan）+ #132（数据基础+SHA-1 桶位+outcome 表）+ #133（Mann-Whitney U + 自动 promote/rollback）+ #139（A-B 进度 UI + 8 字段配置 + active/history 视图）
  - **3.2 dryRun + canary**：PR #140（dryRun + apply/reject + 409 防覆盖检查 + 11 测试）+ PR #141（canary + 桶位偏置 90/10 + AbStatusCard 🐤 标识 + 10 测试）
  - **M13 Phase 5 收尾**：PR #142 — 补 M11.1 PR6 留下的最后 1 个 gap（feishuDoc 字段 0 消费点 → 注入 `<feishu_doc_context>` + `<comment_timeline>` + 10 unit test）
  - **3.3 跨 skill 依赖图 + 3.4 安全联邦同步**：plan 已写明不做（前者 skill 量未到 50+，后者与 local-only 卖点矛盾）
  - 实际能力对比 Hermes：完整审计 + 一键回滚 + Mann-Whitney 统计学决策 + dryRun 待审 + canary 灰度 — Hermes 全无
  - 详见 `docs/iteration-plans/M7-Tier3-Plan.md` + `M7-Tier3.2-Plan.md` + `M13-Phase5-Plan.md`
- **上一冲刺**: M11.1 followup + M13 主线扩张（2026-04~05）
  - **M11.1 followup 4 项 ✅**：PR #82（withFeishuRetry 优先服从 Retry-After）+ #83（28 文件按职责拆 5 子目录）+ #84（mock-based E2E harness + 7 journey 测试）+ #85（withFeishuRetry 抽到通用 channel/common/retry.ts）
  - **Phase J-2 文本 debounce ✅**：PR #86（入站合并器默认开启）
  - **M7 Curator 子代理 + 三态生命周期 ✅**：PR #116（active/stale/archived 自动转换 + bundled 保护）
  - **M7 P1-B Inline Review 信号驱动 ✅**：PR #97-100（信号检测 + turn-end hook + inline-stats endpoint）+ PR #112-114（conversational_feedback 进 evidence + LLM 二级分类兜底 + Background Skill Review）
  - **M13 Phase 5 飞书文档 agent 协作 ✅**：PR #87（doc-api 单测）+ #88（drive 评论事件 → agent dispatch）+ #89（read_doc）+ #90（append_block）+ #91（replace/delete + audit log）+ #92（系统提示 + journey 测试）
  - **M13 #3 同事印象记忆 ✅**：PR #108（peer:* merge_key + afterTurn 提取 + system prompt 注入闭环）
  - **M1.1 Checkpoint Manager ✅**：PR #122（内容寻址快照 + 自动回滚）+ #124（撤销改动 UI）
  - **provider 重构 + thinking 升级 ✅**：PR #79（thinkingLevels 数组 + defaultThinkLevel）+ #80（Kimi K2.6 + GLM 5.1 + Qwen 3.6）+ #81（27 处 high → low 默认值）+ #121（buildAuthHeaders → AuthStrategy 分发）
- **上上冲刺**: M11.1 飞书 Channel 完整复刻 ✅（2026-04-21，PR #46 + #47 + #48 + #49 + #50 + #52）— 4 周 6 PR 交付 ~3500 行飞书实现 + 3033 测试。WebSocket 长连接（桌面 sidecar 无公网 IP）。覆盖：基础 text/post/image/file/audio/video 全消息类型 + Markdown→Post 智能渲染 + ocf1 envelope 审批卡（Promise+TTL+cancel 生命周期）+ CardKit 流式卡片 + 4 档群会话隔离（group/sender/topic/topic_sender）+ reactions/入群离群/p2p_entered 事件 + drive.notice.comment_add_v1 文档评论事件 + doc-api 薄封装 + withFeishuRetry 指数退避 equal jitter + **PR6 Phase K** 9 个 Agent-facing channel tools。Review 8.2/10
- **更早**: M7.1 进化日志 UI ✅（PR #43 + #44，2026-04-21）；M7 Skill 自进化 Phase 1-3 ✅（PR #39 + #40 + #41 + #42，2026-04-21）；M8 会话隔离 ✅（PR #30）；M9 Phase 1 T1/T2 ✅（PR #26 + #28）；M6 Provider 增强 ✅（PR #20，OAuth 推迟到 A3）；M5 Skills 生态增强 ✅（PR #18）
- **下一冲刺候选**（推荐序，2026-05-12 重排，M13 Phase 1 + M14 Phase 1 均已 ✅）:
  1. **M14 Phase 2 Linux 后插**（1-1.5w）— 复用 Phase 1 90% 代码，加 appimage/deb target + linux runner + INSTALL_LINUX.md
  2. **M3.1 全局预算 token 上限**（~1w）— 跨渠道通用，企业刚需
  3. **M13 Phase 2 task-plan service + PlansPage 实装**（4-5d）— 前端空壳已待落地（`apps/desktop/src/pages/PlansPage.tsx:13` 占位）
  4. **M12 运营可观测**（3-4d）— SkillPage 已覆盖 60-70%，剩 cost/调用/限流看板
  5. **A3 OAuth Provider 接入**（1-2w）
  - **外部阻塞**：M14 Phase 3 签名（等 Apple Developer + Authenticode 证书 / 阿里云账号）/ Sprint 16 企微（待 M9 中转层）
  - **不做**：M7-Tier3.3 跨 skill 依赖图（skill 量未到 50+）/ M7-Tier3.4 安全联邦同步（与 local-only 矛盾）/ M7 Phase 4 跨用户上传（永废）

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
