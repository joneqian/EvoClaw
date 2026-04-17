# 34 — 复刻路线图 差距分析（聚合卷）

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/34-rebuild-roadmap.md`（397 行，Phase G）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），11 里程碑 + MVP 路径 + 避坑指南
> **EvoClaw 基线**: 分支 `feat/hermes-parity`，39 份逐章差距分析已完成
> **综合判定**: 🟡 **EvoClaw 无需复刻 hermes，应选择性补齐** — 核心能力（主循环/压缩/记忆/安全/Skills）已反超，外围生态（文档站/CI-CD/国际 IM 平台/浏览器栈/发布流程）系统性缺失

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或定位不同
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes 34 章**（`.research/34-rebuild-roadmap.md`）— 面向"从零构建 hermes 等价系统"的工程团队，将 hermes v0.9.0 拆分为 **11 个里程碑**（M1 骨架→M11 测试发布），含 Mermaid 依赖图、验收标准、行数预估、团队规模建议。核心假设：目标团队选择 Python + uv + pytest + Docusaurus 技术栈，完整复刻需 ~200k 行 / 6-8 人 3-4 个月。

**本文档**（EvoClaw 聚合卷）— 与 hermes 34 章的"复刻路线图"定位完全不同。EvoClaw 不是 hermes 的克隆，而是：
- **不同技术栈**：TypeScript + Bun + Tauri（桌面应用）vs Python + CLI
- **不同目标用户**：企业级非开发者 vs 开源开发者社区
- **不同架构**：Sidecar HTTP 服务 + React UI vs 纯 CLI + asyncio
- **不同优势区域**：记忆系统/安全体系/压缩策略 vs 多平台网关/训练栈/CLI 生态

因此本文档的任务是：**从 39 份逐章差距分析中提取可执行的改进路线图**，按 EvoClaw 的产品定位排定优先级（P0/P1/P2/不做），为后续 Sprint 规划提供输入。

### 关键原则

1. **选择性补齐，不盲目复刻**：hermes 的 RL 训练栈、多平台 CLI 生态等不在 EvoClaw 产品范围内
2. **反超项保持并深化**：EvoClaw 已有 60+ 项反超优势，这些是核心竞争力
3. **缺口按 ROI 排序**：P0 聚焦企业用户最关切的安全/稳定性/可运维性
4. **定位差异≠缺口**：桌面应用不需要 PyPI 发布、Nix flake、Termux 支持——这些归入"不做"

---

## 2. 全维度统计（39 份差距文档汇总）

### 2.1 综合判定分布

| 综合判定 | 份数 | 章节列表 |
|----------|------|----------|
| 🟢 反超或对齐 | 9 | 05 主循环, 07 Prompt, 08 压缩, 11 环境/Spawn, 12 Skills, 14 状态/会话, 15 记忆, 18 Cron/后台, 29 安全审批 |
| 🟡 部分覆盖 | 16 | 00 总览, 01 技术栈, 02 仓库, 03 架构, 04 核心抽象, 06 LLM Provider, 09 工具, 10 Toolsets, 13 插件, 16 Trajectory 格式, 17 Trajectory 压缩, 19 Gateway 总览, 21 MCP, 27 CLI, 28 配置, 30 构建 |
| 🔴 明显落后 | 14 | 20 ACP, 22 浏览器栈, 23 RL 环境, 24 Batch Runner, 25 Mini SWE, 26 RL CLI, 31 测试, 32 文档站, 33 发布, 19a Telegram, 19b Discord, 19c Slack, 19d Signal, 19e Matrix, 19f WhatsApp |

### 2.2 机制级档位统计（全 39 份 §3 小节汇总）

| 档位 | 估算数量 | 占比 | 说明 |
|------|----------|------|------|
| 🔴 | ~220 | ~42% | 集中在 IM 平台适配（6 个 × 15+ 机制）、训练栈（4 个 × 12+ 机制）、文档/CI/发布（3 个 × 15 机制） |
| 🟡 | ~150 | ~29% | 分布在核心模块的边缘机制（OAuth/Profile/ENV 展开等） |
| 🟢 | ~150 | ~29% | 集中在核心能力（主循环/压缩/记忆/安全/Skills/状态/Prompt/工具） |

### 2.3 产品定位过滤

将 🔴 按"是否在 EvoClaw 产品范围内"分类：

| 分类 | 🔴 数量 | 说明 |
|------|---------|------|
| **应补齐** | ~80 | CI/CD / 文档站 / 安全增强（Smart Approve / SSRF / Secret 脱敏）/ MCP 生产化 / 配置增强 |
| **按需补齐** | ~60 | IM 平台（企微已有，国际 IM 视市场需求）/ 浏览器栈 / ACP 适配 |
| **不做** | ~80 | RL 训练栈（23-26 四章全部）/ CLI 生态（纯 CLI 命令体系）/ PyPI/Nix 发布通道 |

---

## 3. P0 聚合（跨章节高 ROI 改进，建议近期 Sprint 排入）

### 3.1 安全增强（来自 29 安全审批 + 21 MCP + 06 LLM Provider）

| # | 项目 | 来源章节 | 工作量 | ROI | 说明 |
|---|------|----------|--------|-----|------|
| 1 | SSRF 补齐（DNS 解析 + GCP 元数据 + Fail Closed） | 29 §3.15 | 0.5d | 🔥🔥🔥 | `web-security.ts` 增加 `dns.lookup` 后 IP 校验 |
| 2 | stdio 环境变量白名单（MCP 子进程不透传 API Key） | 21 §3.19 | 0.5d | 🔥🔥🔥 | 中危安全漏洞修复 |
| 3 | Prompt injection 扫描（MCP description WARNING） | 21 §3.20 | 0.5d | 🔥🔥 | 低成本降低 MCP 注入面 |
| 4 | OSV MAL-* 恶意软件预检 | 21 §3.8 / 29 §3.17 | 1-2d | 🔥🔥 | npm supply chain 攻击面防御 |
| 5 | 全局 Secret 脱敏（25+ API Key pattern + Logger 拦截） | 29 §3.18 | 1-2d | 🔥🔥 | 日志 API Key 原样落盘风险 |
| 6 | Smart Approve（LLM 辅助风险评估） | 29 §3.4 | 2-3d | 🔥🔥 | 与现有 AST 白名单互补 |

**小计**：~5-9 人天

### 3.2 MCP 生产化（来自 21 MCP）

| # | 项目 | 来源章节 | 工作量 | ROI | 说明 |
|---|------|----------|--------|-----|------|
| 7 | MCP Prompt → Skill 桥接生产接线 | 21 §3.14 | 0.5d | 🔥🔥🔥 | 已完成 50%，落地成本极低 |
| 8 | `startWithReconnect` 生产激活 | 21 §3.12 | 0.5d | 🔥🔥 | 已有死代码，网络抖动自愈 |

**小计**：~1 人天

### 3.3 CI/CD 与发布基础设施（来自 30 构建 + 31 测试 + 33 发布）

| # | 项目 | 来源章节 | 工作量 | ROI | 说明 |
|---|------|----------|--------|-----|------|
| 9 | GitHub Actions test.yml（Vitest + Oxlint） | 30 §3.10 / 31 §3.10 | 1-2d | 🔥🔥🔥 | 每次 PR 自动跑测试 |
| 10 | 代码签名 + macOS 公证 | 30 §3.8 | 2-3d | 🔥🔥🔥 | DMG 无签名 = Gatekeeper 阻拦 |
| 11 | 版本号统一管理 + release.mjs | 33 §3.1-§3.2 | 1-1.5d | 🔥🔥 | 4 处硬编码 → 单一来源 |
| 12 | CHANGELOG 自动生成 | 33 §3.6 | 1d | 🔥🔥 | Conventional Commits → Markdown |
| 13 | Vitest 并行 + 30s 超时 | 31 §3.5 / §3.11 | 0.5d | 🔥 | 防测试卡死 + 加速 CI |

**小计**：~6-8 人天

### 3.4 配置增强（来自 28 配置）

| # | 项目 | 来源章节 | 工作量 | ROI | 说明 |
|---|------|----------|--------|-----|------|
| 14 | 凭证文件权限强制（0600） | 28 §3.4 | 0.5d | 🔥🔥 | 凭据文件 world-readable 风险 |
| 15 | 非 ASCII 凭证清理 | 28 §3.5 | 0.5d | 🔥🔥 | Unicode 替代字导致 API 调用失败 |

**小计**：~1 人天

### 3.5 Skills 生态增强（来自 12 Skills）

| # | 项目 | 来源章节 | 工作量 | ROI | 说明 |
|---|------|----------|--------|-----|------|
| 16 | 威胁扫描模式库扩展（4 类） | 12 §3.9 | 1-2d | 🔥🔥 | 企业安全基线对齐 |
| 17 | Trust level 分级 + INSTALL_POLICY | 12 §3.9 | 1d | 🔥🔥 | bundled/clawhub/github/mcp 不同信任级 |
| 18 | Skill 版本比对 + 更新提示 | 12 §3.11 | 1-2d | 🔥 | Hub 生态繁荣前置基础 |

**小计**：~3-5 人天

### 3.6 工具 & 状态增强（来自 05 主循环 + 09 工具 + 14 状态）

| # | 项目 | 来源章节 | 工作量 | ROI | 说明 |
|---|------|----------|--------|-----|------|
| 19 | Grace call 机制（预算耗尽返回摘要） | 05 §3.X | 1d | 🔥🔥 | 防空响应 |
| 20 | IterationBudget 剩余预算追踪 | 05 §3.X | 0.5d | 🔥🔥 | 用户可感知剩余轮次 |
| 21 | 集中式命令注册表 | 02 §3.7 | 1-2d | 🔥 | 权限审计 + 命令文档化 |

**小计**：~2.5-3.5 人天

---

### P0 汇总

| 领域 | 项数 | 人天 |
|------|------|------|
| 安全增强 | 6 | 5-9d |
| MCP 生产化 | 2 | 1d |
| CI/CD + 发布 | 5 | 6-8d |
| 配置增强 | 2 | 1d |
| Skills 生态 | 3 | 3-5d |
| 工具 & 状态 | 3 | 2.5-3.5d |
| **合计** | **21** | **~18.5-27.5 人天（4-6 人周）** |

---

## 4. P1 / P2 / 不做

### 4.1 P1（中等 ROI，建议 2-3 个 Sprint 内排入）

| # | 项目 | 来源章节 | 工作量 | 说明 |
|---|------|----------|--------|------|
| 1 | 凭据池 + OAuth token 刷新 | 06 §3.X / 28 §3.6 | 3-5d | 多 Provider 并行 + key 轮换 |
| 2 | Profile 隔离（运行时配置切换） | 28 §3.8 | 2-3d | dev / prod / 品牌切换 |
| 3 | 环境变量 inline 展开 `${VAR}` | 28 §3.11 | 1-2d | 配置文件动态化 |
| 4 | ConfigIssue 诊断增强 | 28 §3.9 | 1d | level/section/suggestion 结构化 |
| 5 | ContextVar 会话级隔离 | 29 §3.19 | 2-3d | AsyncLocalStorage + sessionId 分离 |
| 6 | 环境变量白名单 + 凭据 sandbox | 29 §3.20 | 2-3d | 子 Agent 不继承 parent 全部 env |
| 7 | 网站黑名单 + 通配符匹配 | 29 §3.16 | 1-2d | 企业内控需求 |
| 8 | 文档站（VitePress 或 Docusaurus） | 32 全章 | 5-8d | 新用户 onboarding |
| 9 | GitHub Release + auto-update | 33 §3.7-§3.8 | 2-3d | DMG 分发升级 |
| 10 | Windows / Linux 构建支持 | 30 §3.4 | 5-10d | 跨平台桌面应用 |
| 11 | Trajectory 训练导出（JSON Lines） | 16 §3.X | 2-3d | 企业可选数据导出 |
| 12 | Vitest 参数化 + Mock 基础设施 | 31 §3.6-§3.7 | 2-3d | 测试工程化 |

**P1 合计**：~28-46 人天（6-9 人周）

### 4.2 P2（低 ROI，长期规划或按需）

| # | 项目 | 来源章节 | 工作量 | 说明 |
|---|------|----------|--------|------|
| 1 | Telegram 渠道适配 | 19a 全章 | 1.5-2w | 按国际市场需求 |
| 2 | Discord 渠道适配 | 19b 全章 | 2-3w | 按开发者社区需求 |
| 3 | Slack 渠道适配 | 19c 全章 | 2-3w | 按企业 SaaS 需求 |
| 4 | 浏览器栈（Playwright + 云 Provider） | 22 全章 | 3-4w | Agent 网页交互能力 |
| 5 | ACP 适配器（IDE 集成） | 20 全章 | 2-3w | VS Code / JetBrains 集成 |
| 6 | Docker 镜像发行通道 | 30 §3.14 | 1-2w | 服务器部署 |
| 7 | E2E 自动化测试 | 31 §3.X | 2-3w | Playwright E2E |
| 8 | Tirith 引擎集成或等价 | 29 §3.14 | 3-5d | shell 语义扫描 |
| 9 | 登陆页 + 营销站 | 32 §3.8 | 1-2w | 品牌宣传 |

### 4.3 不做（产品定位排除）

| # | 章节 | 理由 |
|---|------|------|
| 1 | 23 RL 环境 | RL 训练与企业 AI 伴侣定位正交 |
| 2 | 24 Batch Runner | 离线训练数据生产不在 EvoClaw 范围 |
| 3 | 25 Mini SWE Runner | SWE 评测框架定位不同 |
| 4 | 26 RL CLI | RL 专用 CLI 子系统不需要 |
| 5 | PyPI / Nix 发布通道 | EvoClaw 是桌面应用，不是 Python 库 |
| 6 | Termux / Android CLI | 无 CLI 发行需求 |
| 7 | models.dev 109 provider 注册表 | EvoClaw 用自研 provider-extensions（8 内置 + 用户注册），更精简 |
| 8 | pytest + xdist + asyncio fixtures | EvoClaw 用 Vitest，无需迁移测试框架 |
| 9 | Signal / Matrix 渠道 | 用户量极小，ROI 低于阈值 |
| 10 | hermes 11 里程碑复刻路径 | EvoClaw 不从零构建，已有 102k 行代码基础 |

---

## 5. EvoClaw 反超全景（跨 39 章 🟢 项汇总）

### 5.1 核心能力反超（EvoClaw 在这些维度明确领先 hermes）

#### 记忆与状态（15 章 + 14 章 + 18 章）

| 反超项 | 实现位置 | hermes 对应 | 优势说明 |
|--------|----------|-------------|----------|
| L0/L1/L2 三层记忆 | `memory-store.ts` | 平面文件 6 个 provider | 80%+ token 压缩 + 按需深加载 |
| 9 类别分类 + CHECK 约束 | `memory_units` 表 | 无分类 | merge/independent 语义 + 结构化检索 |
| 三阶段渐进检索 | Phase 1 FTS5 → Phase 2 L1 排序 → Phase 3 L2 深加载 | 单步全加载 | 大规模记忆下 token 节约 |
| Session Key 5 维路由 | `agent:agentId:channel:type:peerId` | platform + user_id | 多 Agent × 多渠道精确路由 |
| Binding Router 4 级匹配 | `binding-router.ts` | 无 | 最具体优先匹配 |
| 双轨调度（Cron + Heartbeat） | `cron-scheduler.ts` + `heartbeat-manager.ts` | 仅 cron_jobs | Heartbeat 共享主会话上下文 |
| Standing Orders 意识注入 | AGENTS.md `<standing_orders>` | 无 | 结构化 Program（Scope/Trigger/Approval/Escalation） |

#### 安全体系（29 章 + 09 章）

| 反超项 | 实现位置 | hermes 对应 | 优势说明 |
|--------|----------|-------------|----------|
| Bash AST 双路径 | `security-analyzer.ts` + `security-pipeline.ts` | 仅 39 条正则 | FAIL-CLOSED 白名单制 + 变量作用域追踪 |
| 9 种 Pre-checks 差异检测 | `pre-checks.ts` | 仅 NFKC + ANSI | 显式验证解析器与 bash 差异 |
| Sed 304 行专项 | `sed-validator.ts` | DANGEROUS_PATTERNS 一行 | 区分行打印/替换模式 |
| 26 种 Unicode 同形字 | `unicode-detector.ts` | NFKC 隐式 | 显式映射 + 不可见字符黑名单 |
| 7×4 权限矩阵 | `permission.ts` + `permission-interceptor.ts` | 无形式化模型 | 可持久化/按 category 批量授权/审计 |
| NameSecurityPolicy | `extension-security.ts` | 无 | Skill + MCP 统一黑白名单 + 合并规则 |
| Flag 级命令白名单 | `command-allowlist.ts` | 仅 argv[0] | 拦截 `git push --force` 等 flag 攻击 |
| 破坏性命令 16 种 + 6 类别 | `destructive-detector.ts` | 阻止式 | 信息性警告，用户体验更好 |

#### 压缩与主循环（08 章 + 05 章 + 17 章）

| 反超项 | 实现位置 | hermes 对应 | 优势说明 |
|--------|----------|-------------|----------|
| 三层分级压缩 Snip/Microcompact/Autocompact | `context-compactor.ts` | 单层 summary | 零成本分级 + LLM 9 段摘要 |
| 三级阈值（90/93/99%）+ 6 阶段折叠 | `context-compactor.ts` | 单阈值触发 | 渐进式降级 |
| 熔断器（3 次失败停止） | `compaction-circuit-breaker` | 无 | 防压缩风暴 |
| 不可变 LoopState + transition 枚举 | `query-loop.ts` | 可变 state dict | 状态追踪可审计 |
| 三阶段 413 恢复（Retry→Compact→Fallback） | `error-recovery.ts` | 单步 retry | 自动降级链 |
| 流式预执行 StreamingToolExecutor | `streaming-tool-executor.ts` | 顺序等待 | 并发安全工具在流中提前执行 |

#### Prompt 与 Skills（07 章 + 12 章）

| 反超项 | 实现位置 | hermes 对应 | 优势说明 |
|--------|----------|-------------|----------|
| SystemPromptBlock[] 声明式 | `embedded-runner-prompt.ts` | 字符串拼接 | 结构化 + 可调试 |
| cache_control 三级 scope | `stream-client.ts` | 无 cache hint | Anthropic prompt cache 利用率 |
| ContextPlugin 5-hook 生命周期 | 10 个插件 | 12 层中间件链 | 替代旧中间件，职责更清晰 |
| 5 种 Skill 来源 | bundled/local/clawhub/github/mcp | 仅内置 | 生态多样性 |
| Tier 1/Tier 2 渐进注入 | `<available_skills>` XML → invoke_skill | 全量注入 | ~50 token/skill 节约 context |
| Skill fork 执行模式 | `execution-mode: fork` | 无 | 子代理隔离防污染 |
| MCP Prompt 自动桥接 | `mcp-prompt-bridge.ts` | 无 | MCP prompts → Skills 统一 |

### 5.2 反超统计

| 能力域 | 反超项数 | 核心章节 |
|--------|----------|----------|
| 记忆与状态 | 7 | 14, 15, 18 |
| 安全体系 | 8 | 29, 09 |
| 压缩与主循环 | 6 | 05, 08, 17 |
| Prompt 与 Skills | 7 | 07, 12 |
| 工具系统 | 4 | 09, 10, 11 |
| 配置管理 | 3 | 28 |
| 构建 / 品牌 | 2 | 30 |
| **合计** | **~37** | — |

### 5.3 反超带来的战略意义

1. **记忆系统**是 EvoClaw 最大差异化壁垒 — hermes 至今没有等价的 L0/L1/L2 + 9 类别体系，即使从零构建也需 8-12 周
2. **Bash AST 安全体系**比 hermes 的正则黑名单在理论安全性上更优（FAIL-CLOSED vs FAIL-OPEN），企业合规场景可作为卖点
3. **三层压缩**在极长对话场景下 token 消耗明显低于 hermes 的单层 summary
4. **Skills 生态**架构更开放（5 来源 + 渐进注入 + fork 隔离），对 ClawHub 平台生态有长期优势

---

## 6. 建议实施路径

### 6.1 推荐 Sprint 排期

| Sprint | 主题 | P0 项 | 预估 |
|--------|------|-------|------|
| Sprint 17 | 安全补齐 + MCP 生产化 | #1-8 | 6-10 人天 |
| Sprint 18 | CI/CD + 发布基础设施 | #9-13 | 6-8 人天 |
| Sprint 19 | 配置增强 + Skills 生态 | #14-18 | 4-6 人天 |
| Sprint 20 | 工具/状态增强 + P1 安全 | #19-21 + P1 #5-7 | 5-8 人天 |
| Sprint 21-22 | P1 文档站 + 跨平台 | P1 #8-10 | 10-18 人天 |
| Sprint 23+ | P2 按需（IM 平台 / 浏览器栈） | 视市场需求 | — |

### 6.2 hermes 11 里程碑对应关系

| hermes 里程碑 | EvoClaw 现状 | 行动 |
|---------------|-------------|------|
| M1 骨架与构建栈 | ✅ pnpm + Turbo + Tauri 已建 | 补 CI/CD（P0 #9） |
| M2 LLM Provider 层 | ✅ 双协议抽象 + 8 国产模型已建 | 补凭据池（P1 #1） |
| M3 工具系统 | ✅ 5 阶段注入 + StreamingToolExecutor 已建（🟢 反超） | 仅补 Grace call（P0 #19） |
| M4 Agent 主循环 | ✅ queryLoop + 三阶段恢复已建（🟢 反超） | 补 IterationBudget（P0 #20） |
| M5 状态与会话 | ✅ Session Key + Binding Router 已建（🟢 反超） | 无需补齐 |
| M6 上下文压缩 | ✅ 三层 Snip/Microcompact/Autocompact 已建（🟢 显著反超） | 无需补齐 |
| M7 CLI 层 | ⬜ EvoClaw 是 GUI 应用，不需要 CLI | 不做 |
| M8 MCP 集成 | 🟡 client 已建，缺 server 暴露 + 生产化 | P0 #7-8 |
| M9 Gateway 首发平台 | 🟡 企微已有，缺 Telegram/Discord | P2 按需 |
| M10 浏览器栈 | 🔴 完全缺失 | P2 按需 |
| M11 测试 + 发布 | 🔴 缺 CI/CD + 代码签名 + CHANGELOG | P0 #9-13 |

---

## 7. 附录

### 7.1 文档索引（39 份差距分析 + 本文）

| 批次 | 章节 | commit |
|------|------|--------|
| Wave 1（基石 6 份） | 00/01/03/04/06/08 | `ccf67c9` ~ `9f74694` |
| W2-1 | 02/09/10 | `c3b2d59` |
| W2-2 | 11/12/13 | `0a7f799` |
| W2-3 | 07/14/15 | `d5a070d` |
| W2-4 | 16/17/18 | `fce53ca` |
| W2-5 | 19/19a/19b | `a085225` |
| W2-6 | 19c/19d/19e | `7769605` |
| W2-7 | 19f/20/21 | `f15db25` |
| W2-8 | 22/23/24 | `4372f19` |
| W2-9 | 25/26/27 | `b2761ad` |
| W2-10 | 28/29/30 | `efa352c` |
| W2-11 | 31/32/33 | `f01d4c9` |
| Wave 3（本文） | 34 | 待提交 |

### 7.2 hermes 34 章引用

- `.research/34-rebuild-roadmap.md` §0 前置决策（技术栈锁定 + 精简范围）
- §1 里程碑总览（Mermaid 依赖图）
- §2 M1-M11 详细定义（交付 + 验收 + 行数预估）
- §3 总规模估算（~200k 行 = 80k 业务 + 95k 测试文档 + 25k 其他）
- §4 MVP 范围（3 人 17 周 ~51 人周）
- §5 避坑指南（LLM Provider / 工具系统 / Agent 主循环）

### 7.3 关键术语对照

| hermes 术语 | EvoClaw 等价物 | 说明 |
|------------|----------------|------|
| `AIAgent.run_conversation()` | `queryLoop()` | Agent 主循环 |
| `CredentialPool` | `provider-registry.ts` | 凭证管理（EvoClaw 更简化） |
| `BaseEnvironment` / `spawn-per-call` | `embedded-runner.ts` + Lane Queue | 执行环境 |
| `HermesOverlay` | `provider-extensions/` | Provider 特殊处理 |
| `ToolRegistry` 单例 | `tool-registry.ts` | 工具注册表 |
| `hermes_state.py` SQLite | `sqlite-store.ts` bun:sqlite | 状态存储 |
| `config.yaml` + `.env` | `evo_claw.json` + managed.json | 配置层 |
| `COMMAND_REGISTRY` | 无（待建 P0 #21） | 命令注册表 |
| `Skills` frontmatter YAML | `SKILL.md` frontmatter YAML | Skill 元数据 |
| `MCP client` | `mcp-manager.ts` | MCP 客户端 |
