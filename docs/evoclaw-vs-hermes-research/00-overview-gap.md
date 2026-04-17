# 00 — 项目概览 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/00-overview.md`（195 行）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），v0.8.0 / CalVer `v2026.4.8`，`pyproject.toml:7`
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），`package.json:3` 版本 `0.1.0`
> **综合判定**: 🟡 **完全不同产品定位，能力维度有交集但市场/形态路线不同**

**档位图例**:
- 🔴 EvoClaw 明显落后
- 🟡 部分覆盖 / 形态差异
- 🟢 EvoClaw 对齐或反超

---

## 1. 定位

**hermes-agent**（`NousResearch/hermes-agent`）—— Nous Research 的**自学习 tool-using AI agent**，官方定位：

> "The self-improving AI agent built by Nous Research. It's the only agent with a built-in learning loop — it creates skills from experience, improves them during use, nudges itself to persist knowledge, searches its own past conversations, and builds a deepening model of who you are across sessions."
> —— `README.md:14`（见 `.research/00-overview.md §1`）

**受众**: 全球开发者 / 技术爱好者 / 研究社区。**形态**: Python CLI + 多入口（`hermes` / `hermes-agent` / `hermes-acp` 三 binary，`pyproject.toml:112-115`）+ Gateway（Telegram/Discord/Slack/WhatsApp/Signal/Matrix）。**发行模式**: PyPI + Docker + Nix 三通道（`.research/00-overview.md §6`）。**License**: MIT。**版本节奏**: CalVer 密集迭代（v0.2→v0.8 在 2026-03-12 到 2026-04-08 27 天内发布 7 个版本，`.research/00-overview.md §3`）。

**EvoClaw**（`jone_qian/EvoClaw`）—— 企业级自进化 AI Agent 平台，官方定位：

> "企业级自进化 AI Agent 平台 —— 安全至上、深度记忆、桌面原生"
> —— `docs/prd/PRD_2026-03-20.md:7`

**受众**: 中国国内企业和团队用户（非开发者）。**形态**: Tauri 2.0 桌面应用 + Bun Sidecar（HTTP + SSE 内部通信），**单一桌面 App** 而非多 binary。**发行模式**: Tauri DMG 打包（`scripts/build-dmg.sh`），**多品牌架构**（`evoclaw` / `healthclaw` 双品牌通过 `BRAND=xxx bun scripts/brand-apply.mjs` 切换，见 `package.json:13, 28-31`）。**License**: 未在顶级目录提供 LICENSE 文件（私有仓库，`"private": true` 见 `package.json:4`）。**版本节奏**: SemVer `0.1.0` + 内部 Sprint 周期（Sprint 15.12 @ 2026-04-09 完成，Sprint 16 待启动）。

**量级对比**:
- hermes：~25.6K LOC Python（`cli.py` 9043 行 + `run_agent.py` 9811 行占大头）+ 少量 Node.js（浏览器自动化）
- EvoClaw：pnpm monorepo，3 个 package（`@evoclaw/desktop` / `@evoclaw/core` / `@evoclaw/shared`），全部 `private + workspace:*`。主体 TS + Rust（Tauri）+ React 19，估计核心代码体量 < hermes 的 1/3（Sprint 15.12 时 2414 tests，hermes 11,800+ 测试函数是 ~5×）

两者**本质是两种不同的产品形态**: hermes 是给开发者用的 CLI + Gateway，EvoClaw 是给企业员工用的桌面 App。直接"对齐"并不合理——以下对比聚焦**可借鉴的产品/工程决策**而非形态。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 产品身份与 slogan | 🟡 | 形态不同（hermes 开发者 CLI vs EvoClaw 企业桌面）；两者 slogan 都准确反映各自定位 |
| §3.2 | 版本模式 | 🔴 | hermes CalVer 密集发布（v0.8.0 @ 2026-04-08），EvoClaw SemVer `0.1.0` 内部 Sprint |
| §3.3 | 入口形态 | 🟡 | hermes 3 CLI binary 分工明确，EvoClaw 单一桌面 App + Sidecar（形态不同） |
| §3.4 | 目标用户画像 | 🟡 | hermes 全球开发者/研究社区，EvoClaw 中国企业员工（非开发者），市场不交叉 |
| §3.5 | 差异化能力卡 | 🟡 | hermes 7 特性（TUI/Gateway/学习回路/Cron/委托/多环境/RL），EvoClaw 4 关键词（企业/自进化/Agent/平台）—— 完整对比见表 |
| §3.6 | License 与开源策略 | 🔴 | hermes MIT 开源，EvoClaw 仓库无 LICENSE + private=true（闭源或未决） |
| §3.7 | 版本演进节奏 | 🔴 | hermes 月级 major 发布 + v0.8.0 单版 209 PRs，EvoClaw 内部 Sprint 周期（15.12 → 16 按周推进） |
| §3.8 | 多品牌/多租户 | 🟢 | **反超**: EvoClaw 有 `BRAND=evoclaw / healthclaw` 多品牌架构，hermes 无对应（只有 `HERMES_HOME` profile 隔离不同级别） |
| §3.9 | 技术栈生态 | 🟡 | hermes Python 3.11+uv 生态（PyPI/Docker/Nix 三通道），EvoClaw TS+Bun+Tauri 生态（DMG 单通道） |
| §3.10 | 顶层模块清单（项目边界定义） | 🟡 | hermes `pyproject.toml py-modules` 13 个顶级 + `packages.find` 9 个子包，EvoClaw pnpm workspace 3 个 package 分工清晰 |
| §3.11 | 发行通道 | 🔴 | hermes 三通道（PyPI wheel + Docker + Nix flake），EvoClaw 仅 Tauri DMG（无包管理器发行） |
| §3.12 | 产品历史关联 | 🟡 | hermes 有 `hermes claw migrate` 兼容 OpenClaw 老配置迁移（`.research/00-overview.md §7`）；EvoClaw 源流自 OpenClaw/PI 框架（`docs/prd/PRD_2026-03-20.md:35` "基于 PI 框架"），无反向迁移需求 |

**统计**: 🔴 4 / 🟡 7 / 🟢 1。

---

## 3. 机制逐条深度对比

### §3.1 产品身份与 slogan

**hermes** （`.research/00-overview.md §1` + `README.md:14`）
- Slogan：self-improving AI agent with built-in learning loop
- 差异化点：**技能学习闭环**（create skills / improve / nudge / search / model of you）
- 身份：研究驱动的 agent 框架

**EvoClaw** （`docs/prd/PRD_2026-03-20.md:7, 35-43` + `CLAUDE.md:3-10`）
- Slogan：企业级自进化 AI Agent 平台 —— 安全至上、深度记忆、桌面原生
- 差异化点：**4 个关键词** —— 企业级 / 自进化 / AI Agent / 平台
- 身份：企业生产工具

```
hermes README.md:14
"The self-improving AI agent built by Nous Research.
 It's the only agent with a built-in learning loop..."

EvoClaw docs/prd/PRD_2026-03-20.md:7
"企业级自进化 AI Agent 平台 — 安全至上、深度记忆、桌面原生"
```

**判定 🟡**：两份 slogan 都准确反映各自战略，但关注点不同：hermes 强调"自学习"（技术亮点），EvoClaw 强调"企业级安全 + 桌面"（市场亮点）。**两者都有"自进化/self-improving"关键词**（EvoClaw 的"自进化"对应 hermes 的"learning loop"），但 EvoClaw 把自进化作为**产品特性**，hermes 把它作为**研究兴趣的延伸**。

---

### §3.2 版本模式

**hermes** （`.research/00-overview.md §1, §3`）
- **双版本号**：SemVer `0.8.0` + CalVer `v2026.4.8`（`pyproject.toml:7`）
- CalVer 用于对外发布标识（`scripts/release.py` 生成，见 `.research/33-release-process.md`）
- 最近 7 个版本在 27 天内发布（v0.2 → v0.8，`.research/00-overview.md §3` timeline）
- 单版最大规模：v0.8.0 共 **209 PRs / 82 issues**

**EvoClaw** （`package.json:3` + `docs/iteration-plans/IterationPlan_2026-03-20.md`）
- **纯 SemVer**：`version: "0.1.0"`（见 `package.json:3`、`apps/desktop/package.json:3`、`packages/core/package.json:3`）
- 无对外 CalVer 标识
- 内部按 Sprint 节奏（Sprint 15.12 2026-04-09 完成，Sprint 16 2026-04-16 待启动）
- 版本号从 PI 项目继承的起步值（0.1.0）起，**尚未首个正式发布**

**判定 🔴**：EvoClaw 的 `0.1.0` 版本号已"卡住"很久不前进（按 Sprint 已完成 15+ 个冲刺），没有对外发版节奏。hermes 的 CalVer + 月级发布展示了"成熟产品的迭代节奏"，是 EvoClaw 达到 GA 阶段后可以借鉴的模式。当前 EvoClaw 处于"研发阶段"，发版模式缺位合理；但后续达到 MVP 应建立明确的版本标识约定。

---

### §3.3 入口形态

**hermes** （`.research/00-overview.md §4.2` + `pyproject.toml:112-115`）
- **3 个 CLI binary**:
  - `hermes` → `hermes_cli/main:main`：用户主入口，argparse 派发子命令（setup/model/tools/gateway/cron/doctor/logs/claw migrate 等）
  - `hermes-agent` → `run_agent:main`（`run_agent.py:9596`）：直接实例化 `AIAgent` 跑对话循环，`fire.Fire(main)` 暴露命令行参数
  - `hermes-acp` → `acp_adapter/entry:main`：VS Code / Zed / JetBrains 的 Agent Client Protocol 适配服务
- 三者分工明确：**用户向 vs 开发者直接调 vs IDE 集成**

**EvoClaw** （`package.json:12-31` + `apps/desktop/package.json` + `apps/desktop/src-tauri/`）
- **单一桌面 App**（Tauri 2.0）+ **内嵌 Sidecar**（Bun HTTP）
- 入口形态：
  - 桌面 App：用户交互主入口（React 19 + TypeScript + Tailwind）
  - Sidecar：HTTP + SSE 服务（`@evoclaw/core`，基于 Hono + better-sqlite3）
  - 无独立 CLI binary（`bun scripts/brand-apply.mjs` 等是**构建脚本**，不是面向最终用户）
- 多品牌通过 `BRAND=evoclaw / healthclaw` 环境变量切换同一套代码库（`package.json:28-31`）

**判定 🟡**：形态**根本不同**。hermes 的 3 binary 分工对 CLI-first 用户友好；EvoClaw 的单桌面 App 对企业非技术用户友好。EvoClaw 未来若要支持 IDE agent 模式（对标 `hermes-acp`），需额外开发独立入口—— 但当前非目标市场。

---

### §3.4 目标用户画像

**hermes** （`.research/00-overview.md §1`）
- 隐含受众：能打开 terminal、会读 README、有 OpenRouter/OpenAI key 的开发者
- 产品特性偏好：TUI / slash commands / 研究就绪（batch trajectory + Atropos RL）

**EvoClaw** （`docs/prd/PRD_2026-03-20.md §2 目标用户画像` + `CLAUDE.md:3-10`）
- 明确受众：**中国国内企业和团队用户**，三大画像：
  - **企业 IT 部门**（关心安全合规、权限审计、数据不出厂）
  - **开发团队 Tech Lead**（关心效率、集成本地工具链）
  - **团队负责人**（非技术，在企微/飞书/钉钉中直接调用 Agent）
- 产品特性偏好：**零配置安全默认** / **桌面双击即用** / **国内 IM 集成** / **国产 LLM 接入**

**判定 🟡**：市场**完全不交叉**。hermes 面向全球技术社区，EvoClaw 面向中国企业场景。这不是**缺陷**，而是**战略选择**——EvoClaw 的竞品不是 hermes，而是国内企业 AI 助手（如字节豆包企业版、钉钉 AI）。

---

### §3.5 差异化能力卡对比

**hermes 7 特性**（`.research/00-overview.md §2` 表格）

| 差异化维度 | hermes 实现 |
|---|---|
| 真实的终端 UI | 多行编辑 / slash 命令 / 打断并转向 / 流式工具输出 |
| 活在你生活的地方 | 单进程 Gateway 同时服务 TG/DC/SL/WA/Signal，跨平台会话连续 |
| 闭环学习回路 | agent-curated memory + 自我提醒 / 自主创建 skill / FTS5 + LLM 摘要召回 / Honcho 用户建模 / agentskills.io 开放标准 |
| 调度自动化 | 内置 cron 调度器 / 自然语言编写 / 跨平台投递 |
| 委托与并行化 | 隔离 subagent / Python 脚本 RPC 调工具压缩多步流水线 |
| 跑在任何地方 | 6 种终端后端（local/Docker/SSH/Daytona/Singularity/Modal）+ serverless 休眠 |
| 研究就绪 | 批量轨迹生成 / Atropos RL 环境 / 训练用的轨迹压缩流水线 |

**EvoClaw 4 关键词**（`docs/prd/PRD_2026-03-20.md §1.2`）

| 关键词 | 含义 |
|---|---|
| 企业级 | 安全至上 / 权限精细管控 / 审计日志完整 / 数据合规（本地加密存储） / 7x24 稳定 / SIEM 集成 |
| 自进化 | L0/L1/L2 三层分级记忆 / 渐进检索 / hotness 衰减 / 知识图谱 / 行为反馈 / 能力自发现 |
| AI Agent | 记忆 + 人格 + 工具使用 + 任务分解 + 协作能力 |
| 平台 | 内置全部能力（Channel/Provider/工具）无需第三方插件 |

**交集分析**（能力维度交叉，不是完整对齐）:

| hermes 维度 | EvoClaw 对应 | 交叉度 |
|---|---|---|
| 真实 TUI | React GUI | 🟡 形态不同，功能同属"交互前端" |
| 多平台 Gateway | 飞书/企微/iLink 微信 Channel | 🟡 平台覆盖不交叉 |
| 闭环学习回路 | 自进化关键词（L0/L1/L2 三层记忆） | 🟢 EvoClaw 记忆深度反超，但无"自主创建 skill" |
| Cron 调度 | Heartbeat + Cron Scheduler | 🟢 均已实现，CLAUDE.md 描述详细 |
| Subagent 委托 | `spawn_agent` 工具（`tool-catalog.ts:41`） | 🟢 均已实现 |
| 6 种终端后端 | 无（CLAUDE.md 声称 Docker 3 模式但代码未实现） | 🔴 EvoClaw 缺失 |
| 研究就绪（RL） | 无 | 🔴 EvoClaw 不做 RL 训练 |

**判定 🟡**：两者都有"交互前端 + 多 Channel + 记忆 + Cron + Subagent"五大能力交集；**hermes 独有**"多终端后端 + RL 训练"，**EvoClaw 独有**"企业级安全 + 桌面原生 + 国内 IM + 国产 LLM"。

---

### §3.6 License 与开源策略

**hermes** （`.research/00-overview.md §1 + pyproject.toml:12`）
- **MIT License**（`LICENSE` 文件 + `pyproject.toml:12`）
- 公开仓库：`github.com/NousResearch/hermes-agent`
- v0.2.0 首次公开时 216 PRs / 63 contributors（`.research/00-overview.md §3`）
- 活跃社区贡献

**EvoClaw** （`package.json` + 仓库根目录）
- **无 LICENSE 文件** （`ls LICENSE*` 返回 "no matches found"）
- `package.json:4` 声明 `"private": true`
- 所有子 package（`@evoclaw/desktop` / `@evoclaw/core` / `@evoclaw/shared`）均 private
- 仓库 `jone_qian/EvoClaw` 当前状态需查（本报告不做外部网络查询，仅基于代码证据）

**判定 🔴**：开源策略缺失是企业级产品的硬伤。即便是闭源商业产品，也应明确 LICENSE（如专有软件许可 / EULA）。当前状态可能造成:
- 外部贡献者不确定能否使用代码
- 企业采购方不确定条款
- 合作方不确定二次分发规则

**建议**：在 Sprint 17+ 之前明确是商业闭源 + Proprietary License，还是 Apache 2.0 / MIT 开源 + 商业支持。不属于本报告推荐的实施项（非能力对齐，属治理层）。

---

### §3.7 版本演进节奏

**hermes** （`.research/00-overview.md §3` timeline）

按日期：
- 2026-03-12: v0.2.0 首次公开（216 PRs / 63 contributors）
- 2026-03-17: v0.3.0 Streaming + plugins + provider rebuild
- 2026-03-23: v0.4.0 Platform expansion（API server + 6 messaging adapters）
- 2026-03-28: v0.5.0 Hardening（HF provider / Nix flake / supply chain audit）
- 2026-03-30: v0.6.0 Multi-instance（Profiles / MCP server mode / Docker）
- 2026-04-03: v0.7.0 Pluggable memory + Credential pools + Camofox browser（168 PRs / 46 issues）
- 2026-04-08: v0.8.0 "intelligence release"（209 PRs / 82 issues）

**v0.8.0 12 个 highlights**（`.research/00-overview.md §3` v0.8.0 subsection）涵盖 Background Process Auto-Notifications / MCP OAuth + OSV / Matrix Tier 1 / Security Hardening Pass 等重量级功能。

**EvoClaw** （`docs/iteration-plans/IterationPlan_2026-03-20.md` + git log）

- Sprint 15（Sub-Agent & ReAct 追平 OpenClaw）✅ 已完成
- Sprint 15.5（差距补齐与优化）✅ 已完成
- Sprint 15.6（自主执行系统）✅ 已完成
- Sprint 15.7（Heartbeat 对齐 OpenClaw）✅ 已完成
- Sprint 15.8（MCP 协议集成）✅ 基础完成
- Sprint 15.9（记忆系统增强）⏳ 进行中
- Sprint 15.10（API 集成增强）⏳ 进行中
- Sprint 15.11（MCP 客户端企业化）📋 待开始
- Sprint 15.12（记忆系统企业可见度）✅ 已完成（2026-04-09）
- Sprint 16（企微 Channel 生产就绪）📋 当前

**判定 🔴**：**节奏差异大**。hermes 是"版本驱动的迭代"（每月 1-2 版 major，每版专题鲜明），EvoClaw 是"Sprint 驱动的持续开发"（单 0.1.0 版本持续推进）。前者适合面向外部发布的成熟产品，后者适合内部开发阶段。**EvoClaw 达到企业可用 GA 后应切换为版本驱动节奏**，否则企业用户难以判断"我们用的是哪一版 / 能否升级 / 升级有哪些改动"。

---

### §3.8 多品牌 / 多租户架构

**hermes** （`.research/00-overview.md` + `CLAUDE.md` 的"Profiles"机制描述）

- 单品牌 "hermes"
- 通过 `HERMES_HOME` 环境变量 + Profile 系统（`hermes --profile work`）实现**多实例隔离**
- 每个 Profile 有独立配置 / API 密钥 / 记忆 / 会话 / 技能 / gateway
- 无"多品牌打包"需求

**EvoClaw** （`package.json:12-31` + `scripts/brand-apply.mjs`）

```json
// package.json 片段（证据 line 12-31）
"dev": "./scripts/dev.sh",
"build": "bun scripts/brand-apply.mjs && turbo run build",
"build:desktop": "bun scripts/brand-apply.mjs && turbo run build --filter=@evoclaw/desktop",

"dev:healthclaw": "BRAND=healthclaw ./scripts/dev.sh",
"build:healthclaw": "BRAND=healthclaw bun scripts/brand-apply.mjs && turbo run build",
"build:desktop:healthclaw": "BRAND=healthclaw bun scripts/brand-apply.mjs && turbo run build --filter=@evoclaw/desktop",
"build:dmg:healthclaw": "BRAND=healthclaw ./scripts/build-dmg.sh"
```

- **双品牌架构**：`evoclaw`（通用） + `healthclaw`（医疗健康场景特化）
- 通过 `BRAND=xxx bun scripts/brand-apply.mjs` **构建前替换**品牌字符串、logo、主题色等
- 单代码库 → 多产品发布
- `packages/shared/src/brand.ts` 含品牌元数据注入点

**判定 🟢 反超**：EvoClaw 的多品牌架构让单代码库可以服务多个垂直行业的企业客户，这对 B2B 场景非常实用（例如同一内核打造医疗版、金融版、教育版）。hermes 作为开发者工具无此需求，不存在对应机制。

---

### §3.9 技术栈生态

**hermes** （`.research/00-overview.md §1` + `.research/01-tech-stack.md`）

- **Python 3.11+**（`pyproject.toml:10` `requires-python = ">=3.11"`）
- **uv** 包管理器
- 主要依赖：fire / httpx / openai / anthropic / mcp / pydantic / ...
- 少量 Node.js（`agent-browser` + `@askjo/camoufox-browser` 供浏览器自动化）
- 运行时：单 Python 进程 + `spawn-per-call` 多终端后端

**EvoClaw** （`package.json` + `apps/desktop/package.json` + `packages/core/package.json` + `CLAUDE.md §技术栈`）

- **TypeScript** 主力 + **Rust**（Tauri）+ **React 19**
- **pnpm 10** 包管理（`packageManager: "pnpm@10.14.0"`）
- **Bun 1.3+ 运行时** 主选，Node 22+ 回退兼容
- **Turborepo 2.5** monorepo 协调
- 关键依赖：
  - Sidecar：`hono` + `better-sqlite3` + `@modelcontextprotocol/sdk` + `zod`
  - Desktop：`@tauri-apps/api 2.5` + `react 19.1` + `zustand 5.0` + `react-router-dom 7.6`
- 运行时：Tauri App（Rust） + Bun Sidecar（127.0.0.1 随机端口 + Bearer Token）

**判定 🟡**：两套栈**各自成熟**，对齐不可能（也不应该）。值得关注的**EvoClaw 独有**:
- `@modelcontextprotocol/sdk`（`packages/core/package.json:16`）——**MCP SDK 已是 core 依赖**，意味着未来 MCP Server 端实施（Wave 2 W2-7 对应）的库基础已经到位
- `better-sqlite3 + zod + hono` 三大库是 EvoClaw Sidecar 的核心栈，hermes 对应是 `sqlite3 + pydantic + 无 HTTP 服务器`

---

### §3.10 顶层模块清单（项目边界定义）

**hermes** （`pyproject.toml:117-148` + `.research/00-overview.md §4.3`）

```toml
[tool.setuptools]
py-modules = [
  "run_agent", "model_tools", "toolsets", "batch_runner",
  "trajectory_compressor", "toolset_distributions", "cli",
  "hermes_constants", "hermes_state", "hermes_time", "hermes_logging",
  "rl_cli", "utils"
]

[tool.setuptools.packages.find]
include = ["agent", "tools", "tools.*", "hermes_cli", "gateway", "gateway.*", "cron", "acp_adapter", "plugins", "plugins.*"]
```

- 13 个顶级 py-modules + 9 个子包
- 这是**"项目边界"最权威的定义**——不在这两个列表里的 py 文件（如 `mcp_serve.py` / `mini_swe_runner.py`）都是开发脚本而非安装产物

**EvoClaw**（pnpm workspace，`pnpm-workspace.yaml` + 3 个 `package.json`）

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
```

实际 3 个 package：
- `@evoclaw/desktop`（`apps/desktop`）—— Tauri 桌面应用 + React 前端
- `@evoclaw/core`（`packages/core`）—— Bun Sidecar + Agent Kernel
- `@evoclaw/shared`（`packages/shared`）—— 共享类型 + 品牌元数据

每个 package 有独立 `package.json` 定义依赖、build/dev 脚本、入口 main。

**判定 🟡**：两者都有清晰的边界定义机制，但**组织粒度不同**:
- hermes：每个模块独立 py 文件，边界在"单文件级"
- EvoClaw：每个 package 独立子目录，边界在"workspace package 级"（更 coarse-grained）

EvoClaw 的 monorepo 约定对大型 TS 项目是业界标准；hermes 的 setuptools py-modules 约定对 Python 包发行是必需。**没有"哪个更好"的判断**，都是各自生态的最佳实践。

---

### §3.11 发行通道

**hermes** （`.research/00-overview.md §6` + `.research/30-build-packaging.md`）

**三通道发行**:
1. **PyPI wheel**（`hermes-agent` package）
2. **Docker 镜像**（`hermes-agent/Dockerfile` + Docker Hub）
3. **Nix flake**（`flake.nix`）
+ `setup-hermes.sh` 一键安装脚本（uv 管 Python + 自动符号链接 + 环境检测）

**EvoClaw** （`package.json:21, 31` + `scripts/build-dmg.sh`）

**单通道发行**:
- **Tauri DMG**（macOS 桌面应用包）
- 通过 `pnpm build:dmg` / `pnpm build:dmg:healthclaw` 产出
- 无 Windows installer（MSI）/ Linux deb-rpm 对应脚本（当前阶段未覆盖）
- 无包管理器发行（不在 Homebrew / winget / apt 中分发）

**判定 🔴**：EvoClaw 当前仅支持 macOS DMG 手动下载安装，无自动更新机制、无跨平台覆盖。hermes 的 PyPI + Docker + Nix 三通道针对不同用户偏好（开发者装 pip、企业装 Docker、研究员装 Nix）。**EvoClaw 达到企业可用 GA 前需要补齐**:
- Windows MSI（企业桌面大头）
- Linux AppImage / deb（开发者桌面）
- macOS notarization + auto-update（macOS 已有但待验证）
- 企业 MDM 分发包（MSI with administrative install）

这属于**发布/运维层差距**，不属于能力差距，但对企业级产品至关重要。详见 `30-build-packaging-gap.md`（Wave 2 W2-10）。

---

### §3.12 产品历史关联

**hermes** （`.research/00-overview.md §7`）

- hermes 的**前身**是 **OpenClaw**（Nous Research 早期产品）
- `hermes_cli/claw.py` 提供 `hermes claw migrate` 命令把老配置/记忆/skills 从 OpenClaw 迁移过来
- 明确说明："OpenClaw 不是复刻目标的一部分"

**EvoClaw** （`docs/prd/PRD_2026-03-20.md:35` + `CLAUDE.md` 多处引用）

- EvoClaw **基于 PI 框架**（"OpenClaw 底层引擎"）构建（PRD §1.3）
- **EvoClaw 和 hermes 共同源流**：都源自 OpenClaw / PI 框架
- EvoClaw 的 Agent Kernel 参考 Claude Code 架构（`CLAUDE.md:14` "参考 Claude Code 架构"）
- 无反向迁移需求（EvoClaw 是重新构建，不是迁移）

**判定 🟡**：**血缘关系微妙**。hermes 是 OpenClaw 的直接后继（基于相同代码基础重构），EvoClaw 是 OpenClaw 的精神后继（基于"PI 框架底层引擎"重新实现）。两者都继承了 OpenClaw 的某些设计思想（如 SOUL.md 人格文件），但：
- hermes 保持 Python 生态延续
- EvoClaw 迁移到 TS + 桌面形态

理论上 **EvoClaw 可参考 hermes 的 claw migrate 机制**实现 "OpenClaw 用户 → EvoClaw" 的数据迁移工具（若企业客户中有 OpenClaw 用户需要搬迁），但当前 PRD 未提此需求。

---

## 4. 改造蓝图（不承诺实施）

本章为项目**概览级**对比，大多数差距属**战略选择**而非**技术实施**，因此改造建议较少。

### P2（长期规划）

| # | 项目 | 对应差距 | 工作量 | 价值 |
|---|---|---|---|---|
| 1 | 发行通道扩展（Windows MSI / Linux AppImage / macOS notarize + auto-update） | §3.11 | 5-10d | 企业桌面覆盖度 |
| 2 | CalVer 对外版本号（GA 后启用） | §3.2 / §3.7 | 0.5d | 外部用户识别版本 |
| 3 | LICENSE 文件明确（专有 or Apache 2.0 + 商业支持） | §3.6 | 0.5d + 法律审查 | 合规/合作/采购 |
| 4 | 版本 Release Notes 自动化（参考 `RELEASE_v0.8.0.md` 12 highlights 风格）| §3.7 | 1-2d | 发版质量 |

### 不建议做

| # | 项目 | 理由 |
|---|---|---|
| — | hermes-agent 独立 CLI binary（对标 `hermes-agent`） | EvoClaw 桌面形态不需要直接调 AIAgent 循环的 CLI |
| — | hermes-acp 独立 binary（IDE 集成） | EvoClaw 面向企业非开发者，IDE agent 生态非目标市场 |
| — | 对标 hermes RL 训练栈 | Nous 的商业核心，EvoClaw 是应用侧不做 |
| — | 对标 hermes 6 种终端后端（local/Docker/SSH/Daytona/Singularity/Modal） | 企业桌面应用用 Docker 一种足矣，见 `11-environments-spawn-gap.md` |

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应缺失 |
|---|---|---|---|
| 1 | 多品牌架构（`BRAND=evoclaw / healthclaw`）单代码库多产品发布 | `package.json:28-31`, `scripts/brand-apply.mjs` | 无多品牌机制，仅 Profile 多实例隔离（数据级不是品牌级） |
| 2 | MCP SDK 已是 core 依赖（未来 MCP Server 实施库基础就位） | `packages/core/package.json:16` `@modelcontextprotocol/sdk` | hermes `mcp_serve.py` 用 FastMCP Python SDK，两者各自生态 |
| 3 | 企业级明确定位与 4 关键词差异化 | `docs/prd/PRD_2026-03-20.md §1.2` | hermes 7 特性面向开发者社区，市场定位不同 |
| 4 | 面向国内市场（国产 LLM + 国内 IM）专业化 | `CLAUDE.md §关键架构模式` 国产 LLM 章节、飞书/企微 Channel | hermes 海外 Gateway（TG/DC/SL/SG/MX/WA）不覆盖国内 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（本章所有 `path:line` 均经 Read / Bash 验证 2026-04-16）

- `package.json:3` ✅ `version: "0.1.0"`
- `package.json:4` ✅ `"private": true`
- `package.json:7-10` ✅ `engines: { bun: ">=1.3", node: ">=22", pnpm: ">=10" }`
- `package.json:12-31` ✅ scripts 含 dev / build / build:dmg 三组（evoclaw / healthclaw）
- `packages/core/package.json:16` ✅ `"@modelcontextprotocol/sdk": "^1.29.0"` 依赖
- `apps/desktop/package.json:13-15` ✅ Tauri 2.5 + React 19.1 + Zustand 5.0
- `docs/prd/PRD_2026-03-20.md:7` ✅ "企业级自进化 AI Agent 平台 — 安全至上、深度记忆、桌面原生"
- `docs/prd/PRD_2026-03-20.md:35-43` ✅ 4 关键词表（企业级/自进化/AI Agent/平台）
- 仓库根目录 `ls LICENSE*` ✅ 返回 "no matches found"

### 6.2 hermes 研究章节引用

- `.research/00-overview.md §1` — Slogan + 关键事实表（v0.8.0 / CalVer / MIT / Python >=3.11 / 25.6K LOC）
- `.research/00-overview.md §2` — 7 个差异化维度表
- `.research/00-overview.md §3` — 版本时间线（v0.2 → v0.8 七个版本）+ v0.8.0 12 个 highlights
- `.research/00-overview.md §4.2` — 三个 CLI 入口（hermes / hermes-agent / hermes-acp）
- `.research/00-overview.md §4.3` — 顶层模块清单（13 py-modules + 9 packages）
- `.research/00-overview.md §6` — 12 项产品复刻清单 + 5 项工程复刻清单
- `.research/00-overview.md §7` — OpenClaw 血缘关系 + hermes-agent vs hermes 定位

### 6.3 关联 gap 章节（crosslink 到其他 gap 文档）

本章是**项目概览**级，内容被以下 gap 章节展开:

- `01-tech-stack-gap.md` (Wave 1 #2) — 技术栈详细对比
- `03-architecture-gap.md` (Wave 1 #3) — 系统架构组件级对比
- `11-environments-spawn-gap.md` (Wave 2 W2-2) — 执行环境 6 后端 vs 无沙箱的细节
- `29-security-approval-gap.md` (Wave 2 W2-10) — 安全审批差距（§3.5 交集分析中的安全维度）
- `30-build-packaging-gap.md` (Wave 2 W2-10) — 三通道发行 vs DMG 单通道（§3.11）
- `33-release-process-gap.md` (Wave 2 W2-11) — CalVer + scripts/release.py（§3.2 / §3.7）
- `34-rebuild-roadmap-gap.md` (Wave 3) — 聚合所有概览级差距 + 企业产品 GA 路线

---

**本章完成**。项目概览级的 EvoClaw vs hermes 差距已全景盘点：**产品形态根本不同**（企业桌面 vs 开发者 CLI），**能力维度有交集但市场路线不交叉**，**EvoClaw 多品牌架构反超 + MCP SDK 基础就位**，**发行通道与版本治理是 GA 前需补齐的工程层差距**。后续章节深入具体维度。
