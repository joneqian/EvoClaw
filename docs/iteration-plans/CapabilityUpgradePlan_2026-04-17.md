# EvoClaw 能力提升总体开发计划

> **基于**: 40 份 hermes 差距分析 + SkillClaw 进化研究 + SkillEvolutionDesign.md
> **日期**: 2026-04-17
> **优先级调整**: 先做能力对齐（本计划），再回到 Sprint 16（企微 Channel 生产就绪）
> **计划起始**: 即日起
> **用法**: 本文档为总体路线图，各模块详细计划后续单独制定

---

## 1. 模块划分与依赖关系

```
                    ┌──────────────┐
                    │  M0 基础工程  │  CI/CD + 版本管理 + 测试增强
                    │  (阶段 1)  │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
     ┌────────────┐ ┌──────────┐ ┌──────────────┐
     │ M1 安全增强 │ │M2 配置增强│ │M3 Agent 核心 │
     │ (阶段 1) │ │(阶段 1)│ │  (阶段 2) │
     └──────┬─────┘ └────┬─────┘ └──────┬───────┘
            │             │              │
            ▼             │              │
     ┌──────────────┐    │              │
     │M4 MCP 生产化  │    │              │
     │  (阶段 2)  │◄──┘              │
     └──────┬───────┘                   │
            │                           │
            ▼                           ▼
     ┌──────────────┐          ┌────────────────┐
     │M5 Skills 生态 │          │M6 Provider 增强 │
     │  (阶段 3)  │          │   (阶段 3)   │
     └──────┬───────┘          └────────┬───────┘
            │                           │
            ▼                           ▼
     ┌──────────────┐          ┌────────────────┐
     │M7 Skill 进化  │          │M8 会话隔离     │
     │(阶段 4-5) │          │  (阶段 4)   │
     └──────────────┘          └────────────────┘
                                        │
            ┌───────────────────────────┘
            ▼
     ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
     │M9 发布与分发  │   │M10 文档站    │   │M11 平台扩展  │
     │(阶段 5) │   │(阶段 5)│   │ (阶段 6+) │
     └──────────────┘   └──────────────┘   └──────────────┘
```

---

## 2. 模块总览

| 模块 | 名称 | 优先级 | 预估 | 前置依赖 | 前端影响 |
|------|------|--------|------|----------|----------|
| **M0** | 基础工程 ✅ | P0 | 3-4d | 无 | ❌ 无（CI/版本/测试） |
| **M1** | 安全增强 ✅ | P0 | 5-9d | 无 | ✅ **已 M4.1 补**：Smart Approve 评估理由在 PermissionDialog 展示；OSV 预检结果暂无 UI，后续并入 M5 |
| **M2** | 配置增强 ✅ | P0 | 1d | 无 | ✅ **已 M4.1 补**：非 ASCII 凭证清理一次性 toast（EnvVarsTab） |
| **M3** | Agent 核心增强 | P0 | 2.5-3.5d | M0 | ⚠️ **必评**：IterationBudget 剩余预算展示（状态栏？）、Grace call 摘要渲染；制定详细计划时必列 |
| **M4** | MCP 生产化 ✅ | P0 | 1d | M1, M2 | ✅ **已 M4.1 补**：MCP Server 管理 Tab + Skill `mcp:` 徽章 |
| **M4.1** | 前端补齐 ✅ | P1 | 3d | M1, M2, M4 | ✅ 本身即前端冲刺（Smart Approve UI + MCP Tab + 凭证 toast） |
| **M5** | Skills 生态增强 | P0 | 3-5d | M4 | ⚠️ **必评**：Trust level 徽章、"有新版可用"提示、威胁扫描结果展示 |
| **M6** | Provider 增强 | P1 | 4-6d | M2 | ⚠️ **必评**：CredentialPool 管理 UI、OAuth 登录流、Profile 切换器 |
| **M7** | Skill 自进化 | P1 | 6+ 人周 | M5, M8 | ⚠️ **必评**：进化日志查看、技能推荐卡片、Cron 进化审核界面 |
| **M8** | 会话隔离与环境安全 | P1 | 5-8d | M1, M3 | ⚠️ **必评**：权限按 session 显示；网站黑名单管理界面 |
| **M9** | 发布与分发 | P1 | 7-13d | M0 | ⚠️ **必评**：应用内更新检查 / 下载进度提示 |
| **M10** | 文档站 | P1 | 5-8d | M0 | ❌ 无（独立站，不嵌入 Tauri） |
| **M11** | 平台扩展 | P2 | 按需 | M3, M8 | ⚠️ **必评**：各 channel 的配置 / 登录 / 诊断 UI |

> **规划约束**（见 §7）：每个模块的详细计划必须在 Context 节显式列出"前端影响"字段（含"无"的显式声明）。无 UI 任务的模块视为"完成度 100%"，有 UI 任务但未在本模块内做的必须在路线图/未排期候选区明确 defer 目标（如 M4 → M4.1 的模式）。

### 各模块参考文档索引

制定详细方案时，按下表定位到具体差距分析文档的具体章节：

| 模块 | 参考文档（点击跳转） | 重点章节 |
|------|---------------------|----------|
| **M0** | [`30-build-packaging-gap.md`](../evoclaw-vs-hermes-research/30-build-packaging-gap.md) | §3.10 CI/CD 工作流、§3.11 版本化与发布 |
| | [`31-testing-gap.md`](../evoclaw-vs-hermes-research/31-testing-gap.md) | §3.5 超时与卡死防护、§3.10 CI/CD 集成、§3.11 并行与分片 |
| | [`33-release-process-gap.md`](../evoclaw-vs-hermes-research/33-release-process-gap.md) | §3.1 版本号策略、§3.2 版本号同步 |
| **M1** | [`29-security-approval-gap.md`](../evoclaw-vs-hermes-research/29-security-approval-gap.md) | §3.4 Smart Approve、§3.15 SSRF、§3.17 OSV、§3.18 Secret 脱敏 |
| | [`21-mcp-gap.md`](../evoclaw-vs-hermes-research/21-mcp-gap.md) | §3.8 OSV MAL-*、§3.19 env 白名单、§3.20 Prompt injection |
| **M2** | [`28-config-system-gap.md`](../evoclaw-vs-hermes-research/28-config-system-gap.md) | §3.4 凭证权限强制、§3.5 非 ASCII 凭证清理 |
| **M3** | [`05-agent-loop-gap.md`](../evoclaw-vs-hermes-research/05-agent-loop-gap.md) | §3 Grace call（搜索"grace"）、IterationBudget（搜索"budget"）|
| | [`02-repo-layout-gap.md`](../evoclaw-vs-hermes-research/02-repo-layout-gap.md) | §3.7 集中式命令注册表 |
| **M4** | [`21-mcp-gap.md`](../evoclaw-vs-hermes-research/21-mcp-gap.md) | §3.12 startWithReconnect、§3.14 MCP Prompt→Skill 桥接 |
| **M5** | [`12-skills-system-gap.md`](../evoclaw-vs-hermes-research/12-skills-system-gap.md) | §3.9 威胁扫描 + Trust level、§3.11 版本比对、§4 P0 改造蓝图 |
| **M6** | [`06-llm-providers-gap.md`](../evoclaw-vs-hermes-research/06-llm-providers-gap.md) | §3 CredentialPool、OAuth、Provider Overlay |
| | [`28-config-system-gap.md`](../evoclaw-vs-hermes-research/28-config-system-gap.md) | §3.6 多 Provider + OAuth 凭据池、§3.8 Profile 隔离 |
| **M7** | [`12-skills-system-gap.md`](../evoclaw-vs-hermes-research/12-skills-system-gap.md) | §7 Skill 自进化三方对比（SkillClaw / Hermes / EvoClaw） |
| | [`SkillEvolutionDesign.md`](../architecture/SkillEvolutionDesign.md) | 全文（Phase 1-4 详细设计） |
| **M8** | [`29-security-approval-gap.md`](../evoclaw-vs-hermes-research/29-security-approval-gap.md) | §3.16 网站黑名单、§3.19 ContextVar 会话隔离、§3.20 env 白名单 |
| **M9** | [`30-build-packaging-gap.md`](../evoclaw-vs-hermes-research/30-build-packaging-gap.md) | §3.4 跨平台、§3.8 代码签名 + 公证、§3.9 多架构 |
| | [`33-release-process-gap.md`](../evoclaw-vs-hermes-research/33-release-process-gap.md) | §3.6 CHANGELOG、§3.7 构件构建、§3.8 GitHub Release |
| **M10** | [`32-docs-website-gap.md`](../evoclaw-vs-hermes-research/32-docs-website-gap.md) | 全文（§3.1-§3.15 文档框架/导航/搜索/CI 部署等 15 个机制） |
| **M11** | [`19a-telegram-gap.md`](../evoclaw-vs-hermes-research/19a-telegram-gap.md) | 全文 |
| | [`19b-discord-gap.md`](../evoclaw-vs-hermes-research/19b-discord-gap.md) | 全文 |
| | [`19c-slack-gap.md`](../evoclaw-vs-hermes-research/19c-slack-gap.md) | 全文 |
| | [`22-browser-stack-gap.md`](../evoclaw-vs-hermes-research/22-browser-stack-gap.md) | 全文 |
| | [`20-acp-adapter-gap.md`](../evoclaw-vs-hermes-research/20-acp-adapter-gap.md) | 全文 |
| **通用** | [`34-rebuild-roadmap-gap.md`](../evoclaw-vs-hermes-research/34-rebuild-roadmap-gap.md) | §3 P0 聚合、§5 反超全景、§6 实施路径 |

---

## 3. 各模块概要

### M0 — 基础工程（P0，无前置依赖）

> **为什么先做**: CI/CD 是所有后续模块的质量守护网，没有 CI 的代码变更无法保证不引入回归。

| 项目 | 工作量 | 来源 |
|------|--------|------|
| GitHub Actions `test.yml`（Vitest + Oxlint，PR 触发） | 1-2d | 30 §3.10, 31 §3.10 |
| 版本号统一管理 + `release.mjs`（4 处 → 单一来源） | 1-1.5d | 33 §3.1-§3.2 |
| Vitest 并行执行 + 30s 全局超时 | 0.5d | 31 §3.5, §3.11 |

**验收标准**: PR 提交自动跑测试，版本号改一处全同步。

---

### M1 — 安全增强（P0，无前置依赖，与 M0 可并行）

> **为什么先做**: 安全缺口（SSRF 无 DNS 解析、MCP 子进程透传 API Key）是线上风险，不能等。

| 项目 | 工作量 | 来源 |
|------|--------|------|
| SSRF 补齐（DNS 解析后 IP 校验 + GCP 元数据 + Fail Closed） | 0.5d | 29 §3.15 |
| MCP stdio 环境变量白名单（子进程不透传 API Key） | 0.5d | 21 §3.19 |
| MCP Prompt injection 扫描 + WARNING | 0.5d | 21 §3.20 |
| OSV MAL-* 恶意软件预检 | 1-2d | 21 §3.8, 29 §3.17 |
| 全局 Secret 脱敏（25+ API Key pattern + Logger 拦截） | 1-2d | 29 §3.18 |
| Smart Approve（LLM 辅助风险评估） | 2-3d | 29 §3.4 |

**验收标准**: `curl http://169.254.169.254` 被拒绝，MCP 子进程 env 不含 API Key，日志中 `sk-*` 被替换为 `****`。

---

### M2 — 配置增强（P0，无前置依赖，与 M0/M1 可并行）

> **为什么先做**: 小改动大收益，修复凭据文件 world-readable + Unicode 凭证导致 API 调用失败。

| 项目 | 工作量 | 来源 |
|------|--------|------|
| 凭证文件权限强制（0600） | 0.5d | 28 §3.4 |
| 非 ASCII 凭证清理（Unicode 替代字检测 + encode 清洗） | 0.5d | 28 §3.5 |

**验收标准**: 新写入的凭证文件 `stat -f "%Lp"` 为 600，含 Unicode 的 API Key 自动清洗后 API 调用正常。

---

### M3 — Agent 核心增强（P0，依赖 M0）

> **为什么 M0 后做**: Grace call 和 IterationBudget 需要在 CI 保护下开发，避免主循环回归。

| 项目 | 工作量 | 来源 |
|------|--------|------|
| Grace call 机制（预算耗尽时请求 LLM 返回摘要而非空响应） | 1d | 05 §3.X |
| IterationBudget 剩余预算追踪（用户可感知剩余轮次） | 0.5d | 05 §3.X |
| 集中式命令注册表（权限审计 + 命令文档化） | 1-2d | 02 §3.7 |

**验收标准**: 工具调用达到预算上限后返回有意义的摘要而非空白，用户可见剩余预算。

---

### M4 — MCP 生产化 ✅（P0，依赖 M1 + M2，完成于 2026-04-17）

> **为什么在 M1/M2 后**: MCP 生产化涉及安全（env 白名单已在 M1 实现）+ 配置（凭证清洗已在 M2 实现）。

| 项目 | 工作量 | 来源 | 状态 |
|------|--------|------|------|
| MCP Prompt → Skill 桥接生产接线（chat.ts 注入 `mcpPromptsProvider`） | 0.5d | 21 §3.14 | ✅ |
| `startWithReconnect` 首启激活（`McpManager.addServer` 内部包装） | 0.5d | 21 §3.12 | ✅ |

**已实现验收**:
- `<available_skills>` 目录中出现 `mcp:{serverName}:{promptName}` 条目
- MCP server 首次启动失败时自动指数退避重试 1s→2s→4s→8s→16s（最多 5 次）

**范围外（已决策放未排期）**: 运行时（已连接后）断线自动恢复 → 见 §3.X A2

---

### M5 — Skills 生态增强（P0，依赖 M4）

> **为什么在 M4 后**: Skill 信任分级需要知道 MCP 桥接的 skill 来源类型（M4 输出）。

| 项目 | 工作量 | 来源 |
|------|--------|------|
| 威胁扫描模式库扩展（keystore/exfiltration/DNS tunneling/persistence 4 类） | 1-2d | 12 §3.9 |
| Trust level 分级 + INSTALL_POLICY 决策矩阵 | 1d | 12 §3.9 |
| Skill 版本比对 + "有新版可用" 提示 | 1-2d | 12 §3.11 |
| `tool-registry.securityPolicy` 生产接线（chat.ts 注入 `securityPolicy` 回调，从 configManager 读 `skillSecurity` 字段 allowlist/denylist）— 参考 M4 T1 `mcpPromptsProvider` 同模式 | 0.5d | M4 实施时识别 |

**验收标准**: 安装社区 Skill 时显示 trust level 并过威胁扫描，outdated skill 有提示；IT 管理员可通过配置白名单/黑名单控制 Agent 可见的 Skills。

---

### M6 — Provider 增强（P1，依赖 M2）

> **为什么在 M2 后**: OAuth 凭据需要正确的文件权限和 Unicode 清洗（M2 输出）。

| 项目 | 工作量 | 来源 |
|------|--------|------|
| CredentialPool 凭据池（多 key 轮换 + fallback） | 2-3d | 06 §3.X |
| OAuth token 刷新（device code flow） | 1-2d | 28 §3.6 |
| Profile 隔离（运行时配置切换 dev/prod） | 2-3d | 28 §3.8 |

**验收标准**: 单个 API key 失败时自动切换下一个，OAuth token 过期前自动刷新。

---

### M7 — Skill 自进化（P1，依赖 M5 + M8）

> **为什么在 M5/M8 后**: Phase 1 需要 trust level 分级（M5），Phase 2-3 需要会话隔离保障进化 Cron 安全（M8）。

详见 [`SkillEvolutionDesign.md`](../architecture/SkillEvolutionDesign.md)，分 4 个 Phase：

| Phase | 内容 | 工作量 | 依赖 |
|-------|------|--------|------|
| Phase 1: 基础记忆化 | `skill_manage` 工具 + Manifest v2 + 安全扫描 | ~1w | M5 |
| Phase 2: 评估反馈 | `skill_usage` 表 + 使用追踪 + 轨迹摘要 | ~2w | Phase 1 |
| Phase 3: 自动进化 | Agentic Evolver + Cron + Refine/Create/Skip | ~3w | Phase 2 + M8 |
| Phase 4: 集体进化 | ClawHub 反馈回传 + 匿名聚合 | 长期 | Phase 2 |

**验收标准**: Agent 自主创建 skill 后下次会话可用；低效 skill 被 Cron 自动改进。

---

### M8 — 会话隔离与环境安全（P1，依赖 M1 + M3）

> **为什么在 M1/M3 后**: 需要安全基础（M1 env 白名单）+ Agent 核心稳定（M3 无回归）。

| 项目 | 工作量 | 来源 |
|------|--------|------|
| AsyncLocalStorage 会话级隔离（权限按 sessionId 分离） | 2-3d | 29 §3.19 |
| 环境变量白名单 + 凭据 sandbox（子 Agent 不继承全部 env） | 2-3d | 29 §3.20 |
| 网站黑名单 + 通配符匹配 | 1-2d | 29 §3.16 |

**验收标准**: Agent A 的 session-scope 授权不被 Agent B 的会话复用，子 Agent env 只含白名单变量。

---

### M9 — 发布与分发（P1，依赖 M0）

> **为什么在 M0 后**: 代码签名和 auto-update 建立在 CI/CD + 版本管理基础之上。

| 项目 | 工作量 | 来源 |
|------|--------|------|
| 代码签名 + macOS 公证 | 2-3d | 30 §3.8 |
| CHANGELOG 自动生成（Conventional Commits → Markdown） | 1d | 33 §3.6 |
| GitHub Release + auto-update 集成 | 2-3d | 33 §3.7-§3.8 |
| Windows / Linux 构建支持 | 5-10d | 30 §3.4 |

**验收标准**: DMG 双击安装无 Gatekeeper 警告，应用内检测到新版本并提示更新。

---

### M10 — 文档站（P1，依赖 M0）

> **为什么在 M0 后**: 文档站 CI 部署依赖 GitHub Actions（M0 输出）。

| 项目 | 工作量 | 来源 |
|------|--------|------|
| VitePress 或 Docusaurus 搭建 + 现有 docs/ 迁移 | 3-5d | 32 全章 |
| 自动部署工作流（push main → GitHub Pages） | 1d | 32 §3.10 |
| 搜索功能 + 侧边栏导航 | 1-2d | 32 §3.3, §3.4 |

**验收标准**: 文档站可访问，PR 合并后自动部署。

---

### M11 — 平台扩展（P2，按需，依赖 M3 + M8）

> **为什么最后**: 非核心能力，按市场需求决定，且需要会话隔离（M8）支撑多平台并发。

| 项目 | 工作量 | 来源 |
|------|--------|------|
| Telegram 渠道 | 1.5-2w | 19a |
| Discord 渠道 | 2-3w | 19b |
| Slack 渠道 | 2-3w | 19c |
| 浏览器栈（Playwright + 云 Provider） | 3-4w | 22 |
| ACP 适配器（IDE 集成） | 2-3w | 20 |

按市场需求逐个评估启动。

---

## 3.X — 未排期候选（按需启动，不在主路线图）

下列模块在 M0-M11 实施过程中识别但未纳入排期。各项独立，按业务/合规需求触发后再单独评估。

### A1 — 配置加密存储（P1）

> **触因**: M2 实施时发现 `apiKey/secret` 仍以明文存于 `~/.evoclaw/evo_claw.json`。M2 的文件权限 0o600 + ASCII 清理只解决了 80% 场景，磁盘加密是真正的纵深防御。
>
> **何时启动**: 企业客户提出磁盘审计 / 合规要求时；或全平台正式发布前的安全加固阶段。

| 项目 | 工作量 | 备注 |
|------|--------|------|
| Sidecar ↔ Tauri credential IPC 协议设计 | 0.5d | 复用现有 Bearer token 通道 |
| 敏感字段标记 schema（哪些字段需加密） | 0.5d | apiKey/secret/token/password |
| Sidecar 调用 Tauri credential.rs (macOS Keychain + AES-256-GCM) | 1d | `apps/desktop/src-tauri/src/{credential,crypto}.rs` 已就绪，缺 IPC 桥接 |
| Windows DPAPI 兼容（fallback 给非 macOS 平台） | 0.5-1d | Tauri keyring crate 已支持 |

**预估**: 2-3d
**前置依赖**: M2 ✅ 已完成（凭证文件权限 + ASCII 清理）；M9 ⏳（跨平台构建保障 Windows 路径）
**验收标准**: 写入磁盘的配置 JSON 中 apiKey 字段为 `enc:base64(...)` 格式；启动时 Sidecar 通过 Tauri IPC 解密；macOS Keychain 中可见 `com.evoclaw.app.config-key`。

---

### A2 — MCP 运行时断线自动恢复（P1）

> **触因**: M4 实施时发现 `startWithReconnect` 仅覆盖 `McpManager.addServer()` 首启路径；已连接的 server 若运行时崩溃或网络断，EvoClaw 当前不会自动恢复。
>
> **何时启动**: 线上出现 MCP server 运行中掉线影响可用性的报障 ≥ 2 次；或企业客户明确要求 24x7 稳定性。

| 项目 | 工作量 | 备注 |
|------|--------|------|
| `McpClient` 声明 notifications 能力 + 注册 disconnect handler | 0.5d | MCP SDK 已支持 |
| stdio 子进程 exit 事件监听；SSE/HTTP keepalive 超时检测 | 0.5-1d | 需按 transport 类型分支处理 |
| 断线后调用 `startWithReconnect` 恢复连接 | 0.5d | 复用 M4 已接线的重连函数 |
| 重连成功后广播 `mcp:reconnected` 事件 → Agent 工具/技能缓存失效 | 0.5-1d | 需接 `tool-registry` / `skill-cache` 失效通道 |

**预估**: 2-3d
**前置依赖**: M4 ✅ 已完成（首启重连机制）
**验收标准**: 手工 `kill -9` 已连接的 stdio MCP 子进程 → 5s 内日志出现重连尝试 → 30s 内完全恢复 + `<available_tools>` / `<available_skills>` 重新包含该 server 的工具/prompts。

---

## 4. Sprint 排期建议

| 阶段 | 模块 | 主题 | 预估 |
|------|------|------|------|
| **阶段 1** | M0 + M1 + M2 | 基础工程 + 安全 + 配置（三者可并行） | 9-14d |
| **阶段 2** | M3 + M4 | Agent 核心 + MCP 生产化 | 3.5-4.5d |
| **阶段 3** | M5 + M6 | Skills 生态 + Provider | 7-11d |
| **阶段 4** | M7 Phase 1 + M8 | Skill 记忆化 + 会话隔离 | 10-13d |
| **阶段 5** | M7 Phase 2 + M9 + M10 | Skill 评估 + 发布 + 文档站 | 14-23d |
| **阶段 6** | M7 Phase 3 | Skill 自动进化 | ~3w |
| **阶段 7+** | M11 + M7 Phase 4 | 平台扩展 + 集体进化 | 按需 |
| **回归** | Sprint 16 | 企微 Channel 生产就绪 | — |

> **说明**: 能力对齐完成后回到 Sprint 16 继续企微 Channel 生产就绪工作。

---

## 5. 不做清单（产品定位排除）

| 章节 | 内容 | 理由 |
|------|------|------|
| 23-26 | RL 训练栈（环境/Batch/SWE/CLI） | 与企业 AI 伴侣定位正交 |
| 27 | CLI 命令体系 | EvoClaw 是 GUI 应用 |
| 19d/19e | Signal / Matrix 渠道 | 用户量极小 |
| 30 | PyPI / Nix 发布通道 | 非 Python 库 |
| 31 | pytest 迁移 | 用 Vitest |

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| M0 CI/CD 搭建耗时超预期 | 阻塞 M3/M9/M10 | 最小可用 CI（仅 test.yml），签名/部署推迟到 M9 |
| M1 Smart Approve LLM 调用成本 | 每次命令审批消耗 token | 使用辅助低成本模型（ModelRouter 已支持） |
| M7 Skill 进化引入回归 | 自动修改的 skill 质量下降 | 保守编辑原则 + 改前备份 + 进化日志可回滚 |
| M9 代码签名需 Apple 开发者账号 | 费用 + 审核周期 | 提前注册，M0 阶段申请 |
| M11 国际 IM 需各平台审核 | Telegram Bot / Discord App 审核 | 提前了解各平台审核政策 |

---

## 7. 使用方式

本文档为总体路线图。后续每个模块（M0-M11）将制定独立的详细计划，包含：
- 具体文件变更清单
- 接口设计
- 测试方案
- 验收 checklist
- **前端影响评估**（强制项，见下）

制定详细计划时请注明 `基于: CapabilityUpgradePlan_2026-04-17.md 模块 MX`。

### 7.1 前端影响评估（强制）

> **背景**: M1/M2/M4 合入 main 后才发现前端 UI 没跟上，只能追加 M4.1 短冲刺补三项 UI。此后规划**强制**在计划里显式处理这一环节。

每个模块的详细计划（不论 `/mine:plan` / planner agent / 手写）**必须**在 Context 节包含如下结构化字段：

```markdown
**前端影响**: [✅ 需要 / ❌ 无]
- 如"需要": 枚举用户可感知的 UI 变更点（权限对话框、状态面板、新 Tab、徽章、toast、管理页...）
- 如"无": 一句话说明原因（如"纯 CI/版本管理"、"仅日志层脱敏"）
- 如"需要但本模块不做": 必须指向 defer 到的冲刺/候选项（如"延后到 Mx.y / A2"）
```

**PR review 必问**:
1. 这个改动用户在 UI 上能感知到吗？
2. 如果能，UI 跟上了吗？如果没跟，defer 路径是否已登记？

**常见被遗漏的 UI 点（参照 M4.1 补齐的 3 项）**:
- 安全/权限决策的理由展示（Smart Approve / Permission category）
- 连接/状态管理类后端能力（MCP server、Channel、Cron、Provider）
- 自动修复/清理行为（凭证 sanitize、模型降级、context compaction）
- 新资源类型（MCP prompts、bundled skills、clawhub 来源）的徽章与筛选

### 7.2 能力提升评估（强制）

> **背景**: 仅写"做什么（改哪些文件、加哪些接口）"不够；开发时容易跑偏 —— 把"接线已有能力"做成"重写"、把"注入配置"做成"新建抽象层"。必须显式声明"改完后每个能力从什么状态变成什么状态"，才能锁住目标。

每个模块的详细计划**必须**在 Context 节（紧随"前端影响"之后）为**每个子任务**列出三栏：

| 字段 | 说明 |
|---|---|
| **Before** | 当前状态 / 痛点（可量化或场景化，如"5 次抖动后永久 error"、"用户永远看不到 `mcp:*:*`"） |
| **After** | 模块落地后的**可验证**状态（对应测试断言、日志输出、UI 可见性、API 返回） |
| **机制** | 具体文件:行号 + 关键函数 + 数据流链路；明确标注"已有 → 复用"vs"新增"，避免误解为重写 |

**模板示例（M4 T1 实际应用）**:

```markdown
**T1 能力提升评估**:
- Before: `<available_skills>` 永远无 `mcp:*:*` 条目；MCP prompts 已拉取但用户不可调用
- After: MCP server 的 prompts 100% 自动作为 `mcp:{server}:{name}` 出现在技能目录；
         `invoke_skill({ skill: "mcp:foo:bar" })` 执行路由命中 handleMcpPrompt
- 机制: chat.ts:585 `createToolRegistryPlugin({ mcpPromptsProvider })` 注入（**新增 1 个回调 + 1 行 import**）
        → tool-registry.ts:127-134 `beforeTurn` 已有合并逻辑（**复用**）
        → skill-tool.ts:156 `handleMcpPrompt` 已有执行路由（**复用**）
```

**判定是否合格**:
1. Before / After 都是可验证的，不写模糊的"提升可靠性"、"改善体验"
2. 机制栏列出具体文件:行号 + 函数名，标注"已有 → 复用"或"新增"，让开发者不偏离已有基建去重写
3. 每个子任务独立评估，不混在一起写"整体提升 XX%"

**PR review 必问**:
1. "After" 的状态是否真被这次 PR 达成？（测试/日志/UI 有证据）
2. "机制" 列出的文件是否确实被改了？有没有偏离 plan 引入新文件/新抽象？
3. "Before / After" 差异能不能直接抄进 release note？（能抄说明写得够具体）
