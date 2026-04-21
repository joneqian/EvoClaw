# EvoClaw 能力提升总体开发计划

> **基于**: 40 份 hermes 差距分析 + SkillClaw 进化研究 + SkillEvolutionDesign.md
> **日期**: 2026-04-17
> **优先级调整**: 先做能力对齐（本计划），再回到 Sprint 16（企微 Channel 生产就绪）
> **计划起始**: 即日起
> **用法**: 本文档为总体路线图，各模块详细计划后续单独制定

---

## 1. 模块划分与依赖关系

```
                    ┌─────────────────┐
                    │  M0 基础工程 ✅  │  CI/CD + 版本管理 + 测试增强
                    │     (阶段 1)    │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │ M1 安全增强✅ │ │M2 配置增强 ✅│ │M3 Agent核心✅│
     │   (阶段 1)   │ │  (阶段 1)   │ │   (阶段 2)   │
     └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
            │                │                │
            ▼                │                │
     ┌──────────────┐       │                │
     │M4 MCP生产化✅ │       │                │
     │  (阶段 2)   │◄──────┘                │
     └──────┬───────┘                        │
            │                                │
            ▼                                ▼
     ┌──────────────┐             ┌────────────────┐
     │M5 Skills生态✅│             │M6 Provider✅   │
     │  (阶段 3)   │             │   (阶段 3)     │
     └──────┬───────┘             └────────┬───────┘
            │                              │
            ▼                              ▼
     ┌──────────────┐             ┌────────────────┐
     │M7 Skill 进化  │             │M8 会话隔离     │
     │ (阶段 4-5)  │             │   (阶段 4)    │
     └──────────────┘             └────────────────┘
                                           │
            ┌──────────────────────────────┼──────────────┐
            ▼                              ▼              ▼
     ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
     │M9 发布与分发  │   │M10 文档站    │   │M11 平台扩展  │
     │ (阶段 5)    │   │ (阶段 5)    │   │ (阶段 6+)   │
     └──────────────┘   └──────────────┘   └──────────────┘
                                           │
                         M6 + M8 ──────────┤
                                           ▼
                                    ┌──────────────┐
                                    │M13 团队协作   │
                                    │ (阶段 6.5)  │
                                    └──────────────┘
```

---

## 2. 模块总览

| 模块 | 名称 | 优先级 | 预估 | 前置依赖 | 前端影响 |
|------|------|--------|------|----------|----------|
| **M0** | 基础工程 ✅ | P0 | 3-4d | 无 | ❌ 无（CI/版本/测试） |
| **M1** | 安全增强 ✅ | P0 | 5-9d | 无 | ✅ **已 M4.1 补**：Smart Approve 评估理由在 PermissionDialog 展示；OSV 预检结果暂无 UI，后续并入 M5 |
| **M2** | 配置增强 ✅ | P0 | 1d | 无 | ✅ **已 M4.1 补**：非 ASCII 凭证清理一次性 toast（EnvVarsTab） |
| **M3** | Agent 核心增强 ✅ | P0 | 2.5-3.5d | M0 | ✅ **已补**：IterationBudget 剩余预算展示 + Grace call 摘要渲染（PR #17） |
| **M4** | MCP 生产化 ✅ | P0 | 1d | M1, M2 | ✅ **已 M4.1 补**：MCP Server 管理 Tab + Skill `mcp:` 徽章 |
| **M4.1** | 前端补齐 ✅ | P1 | 3d | M1, M2, M4 | ✅ 本身即前端冲刺（Smart Approve UI + MCP Tab + 凭证 toast） |
| **M5** | Skills 生态增强 ✅ | P0 | 3-5d | M4 | ✅ **本模块同 PR 落地**：Trust 5 色徽章、"有新版可用"紫条 + 升级按钮、威胁扫描详情折叠、require-confirm checkbox（PR #18） |
| **M6** | Provider 增强 ✅（OAuth→A3） | P1 | 4-6d | M2 | ✅ **本模块同 PR 落地**：CredentialPool 编辑器 + Profile 切换器（PR #20）；OAuth 登录流随 A3 一起做 |
| **M7** | Skill 自进化 🟢 Phase 1-3 ✅（Phase 4 ❌ 永远不做）| P1 | 6+ 人周 | M5, M8 | ✅ **Phase 2 已落地前端"效能" Tab**（SkillEffectivenessPanel，PR #40）；进化日志查看 / Cron 进化审核界面 defer 到 M7.1 |
| **M8** | 会话隔离与环境安全 ✅ | P1 | 5-8d | M1, M3 | ⚠️ **后端已完成（PR #30）**：session_key 列 + env sandbox + 域名黑名单；UI（权限按 session 显示 + 黑名单管理）defer 到 M8.1 |
| **M9** | 发布与分发 🟡 Phase 1 部分完成（T1/T2 ✅，T3-T8 暂停）| P1 | 7-9d | M0 | ✅ **T2 已落地 + 构建治理**：brand-apply 多品牌抽象 + gitignore 根治 + postinstall；⚠️ T5 前端 banner 待后续 |
| **M10** | 文档站 | P1 | 5-8d | M0 | ❌ 无（独立站，不嵌入 Tauri） |
| **M11** | 平台扩展 | P2 | 按需 | M3, M8 | ⚠️ **必评**：各 channel 的配置 / 登录 / 诊断 UI |
| **M12** | 运营可观测 & 成本治理（新） | P1 | 3-4d | M6, M8 | ⚠️ **必评**：session 成本聚合面板（沿用 UsageTab 风格） |
| **M13** | Agent 团队协作（新） | P1 | 10-12w | M6, M8 | ⚠️ **必评**：Team 配置界面 / TaskFlow 状态面板 / 子 Agent 流式产出聚合视图 |
| **M1.1** | Checkpoint Manager（补丁） | P1 | 3-5d | M1 | ❌ 无（静默恢复，未来可加"已恢复 N 文件" toast） |
| **M3.1** | 全局 IterationBudget（补丁） | P1 | 1-2d | M3 | ❌ 无（利用 M3 既有 UI） |

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
| **M13** | [`multi-agent-team-collab-deepdive.md`](../evoclaw-vs-openclaw-research/multi-agent-team-collab-deepdive.md) | 全文 1633 行：§1 术语 / §2 架构鸟瞰 / §3 数据模型 / §4 渠道路由 / §5 TaskFlow / §6 ACP / §7 跨层联动 / §8 Phase 1-4 复刻方案 |
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

### M3 — Agent 核心增强 ✅（P0，依赖 M0，完成于 2026-04-17）

> **为什么 M0 后做**: Grace call 和 IterationBudget 需要在 CI 保护下开发，避免主循环回归。

| 项目 | 工作量 | 来源 | 状态 |
|------|--------|------|------|
| Grace call 机制（预算耗尽时请求 LLM 返回摘要而非空响应） | 1d | 05 §3.X | ✅ |
| IterationBudget 剩余预算追踪（用户可感知剩余轮次） | 0.5d | 05 §3.X | ✅ |
| 集中式命令注册表（权限审计 + 命令文档化） | 1-2d | 02 §3.7 | ✅ |

**已实现验收**: 工具调用达到预算上限后返回有意义的摘要而非空白，用户可见剩余预算（PR #17）。

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

### M5 — Skills 生态增强 ✅（P0，依赖 M4，完成于 2026-04-17）

> **为什么在 M4 后**: Skill 信任分级需要知道 MCP 桥接的 skill 来源类型（M4 输出）。

| 项目 | 工作量 | 来源 | 状态 |
|------|--------|------|------|
| 威胁扫描模式库扩展（keystore/exfiltration/DNS tunneling/persistence 4 类） | 1-2d | 12 §3.9 | ✅ |
| Trust level 分级 + INSTALL_POLICY 决策矩阵 | 1d | 12 §3.9 | ✅ |
| Skill 版本比对 + "有新版可用" 提示（仅 ClawHub，github/local/bundled 未排期） | 1-2d | 12 §3.11 | ✅ |
| `tool-registry.securityPolicy` 生产接线（chat.ts 注入 `securityPolicy` 回调，从 configManager 读 `skillSecurity` 字段 allowlist/denylist）— 参考 M4 T1 `mcpPromptsProvider` 同模式 | 0.5d | M4 实施时识别 | ✅ |

**已实现验收**（PR #18）:
- `skill-analyzer.ts` 扩展 15 条高危模式（keystore / exfiltration / dns_tunnel / persistence），按扩展名门控避免 `.md` 误报
- `install-policy.ts` 渐进矩阵：`bundled/local/mcp` 全 auto → `clawhub` 渐进 → `github` 强制确认 → `high` 一律 block；单元格可通过 `configManager.security.skillInstallPolicy` 覆盖
- `.evoclaw-install.json` sidecar + `POST /skill/check-updates` 批量查 ClawHub；SkillPage "我的技能" 显示 `v{latest} 可用` + 一键升级
- IT 管理员 `security.skills.{allowlist,denylist}` 在 `<available_skills>` 生效（复用 `tool-registry.ts` 既有字段和过滤逻辑）
- SkillPage 弹窗新增威胁扫描详情折叠 + require-confirm checkbox + block 按钮置灰 + 原因展示；新增 `SkillSourceBadge` 五色徽章组件
- 47 条 M5 新增测试断言全绿（9 analyzer + 23 policy + 7 manifest + 6 check-updates + 5 wiring），全量 2646/2646 通过

**范围外（已决策放未排期）**: GitHub 来源版本比对（涉及 github API rate limit，当前 clawhub-only）

---

### M6 — Provider 增强 ✅（P1，依赖 M2，核心完成于 2026-04-17，OAuth 延后 A3）

> **为什么在 M2 后**: OAuth 凭据需要正确的文件权限和 Unicode 清洗（M2 输出）。

| 项目 | 工作量 | 来源 | 状态 |
|------|--------|------|------|
| CredentialPool 凭据池（多 key 轮换 + fallback） | 2-3d | 06 §3.X | ✅ |
| OAuth token 刷新（device code flow） | 1-2d | 28 §3.6 | ⏳ 延后 → §3.X A3 |
| Profile 隔离（运行时配置切换 dev/prod） | 2-3d | 28 §3.8 | ✅ |

**前端影响**: ✅ 已落地 — `CredentialPoolEditor` 多 key 轮换/禁用 UI、`ProfileManager` 切换器、`config-profile` REST 端点（PR #20 同 PR 落地）。

**验收标准**: 单个 API key 失败时自动切换下一个（✅ failover 测试覆盖），Profile 切换后 Provider/MCP 热重载（✅ `/config/profile` 接口 + reload-all 测试）。OAuth token 刷新延后到 §3.X A3。

**范围外（已决策放未排期）**: OAuth 2.1 device code flow → 见 §3.X A3

---

### M7 — Skill 自进化 🟢 Phase 1-3 ✅（P1，依赖 M5 + M8）

> **为什么在 M5/M8 后**: Phase 1 需要 trust level 分级（M5），Phase 2-3 需要会话隔离保障进化 Cron 安全（M8）。
>
> **交付**: PR #39 + PR #40 + PR #41（2026-04-21）。详细方案见 `/Users/mac/.claude/plans/humming-forging-bubble.md`。

详见 [`SkillEvolutionDesign.md`](../architecture/SkillEvolutionDesign.md)，分 4 个 Phase：

| Phase | 内容 | 工作量 | 状态 | PR | 实现摘要 |
|-------|------|--------|------|----|----------|
| Phase 1: 基础记忆化 | `skill_manage` 工具 + Manifest v2 + 安全扫描 | ~1w | ✅ | #39 | 4 actions（create/edit/patch/delete）+ atomic write + `.bak` 回滚 + `syncBundledSkills` 四态状态机 + 复用 21 条威胁模式 + 凭据赋值扫描 |
| Phase 2: 评估反馈 | `skill_usage` 表 + 使用追踪 + 轨迹摘要 | ~2w | ✅ | #40 | migration 027（skill_usage + skill_usage_summary）+ 三路径 telemetry 注入（inline/fork/MCP）+ 辅助 LLM 摘要 + 5 REST endpoints + 前端 "效能" Tab（SkillEffectivenessPanel）+ 👍/👎 反馈 |
| Phase 3: 自动进化 | Agentic Evolver + Cron + Refine/Create/Skip | ~3w | ✅ | #41 | migration 028 + SkillEvolverScheduler（系统级 cron，默认关）+ 证据聚合（summaries + usages + feedback）+ 辅助 LLM 决策 + 手改 hash 守护 + 严格子串 patch + FAIL-CLOSED 安全扫描重检 + 熔断器（3 连败终止）|
| Phase 4: 集体进化 | ClawHub 反馈回传 + 匿名聚合 | — | ❌ **永远不做**（2026-04-21 用户决策） | — | 数据不离开本地；ClawHub 上传/聚合/推荐均不纳入路线图；hash 回滚成为最终方案（无需版本链） |

**验收标准**: ✅ Agent 自主创建 skill 后下次会话可用；✅ 低效 skill 被 Cron 自动改进。

**测试规模**: 新增 102 用例（47 Phase 1 + 34 Phase 2 + 21 Phase 3）。回归 core 2836/2836 + shared 61/61 + desktop build 全绿。

**Defer 到 M7.1（前端补齐）**: 进化日志查看器（skill_evolution_log UI + 一键回滚）、SKILL.md diff 对照预览、Cron 触发频率 / 候选门槛配置 UI。

---

### M8 — 会话隔离与环境安全 ✅ 已完成（P1，依赖 M1 + M3）

> **为什么在 M1/M3 后**: 需要安全基础（M1 env 白名单）+ Agent 核心稳定（M3 无回归）。
>
> **交付**: PR #30（2026-04-20）。详细方案见 `/Users/mac/.claude/plans/humming-forging-bubble.md`。

| 项目 | 工作量 | 状态 | 实现摘要 |
|------|--------|------|----------|
| 会话级权限隔离（显式 sessionKey 透传） | 2-3d | ✅ | migration 026 加 `session_key` 列 + SecurityExtension 三层缓存（agent 级 always/deny 共享 × session 级按 sessionKey 分片）+ SmartDecisionCache session 维度 |
| 环境变量白名单 + 凭据 sandbox | 2-3d | ✅ | 抽取 `@evoclaw/shared/security/env-sanitizer`；bash/background 默认 inherit 模式自动剥离 SENSITIVE_PATTERNS；`customSensitivePatterns` 配置扩展 |
| 网站黑名单 + 通配符匹配 | 1-2d | ✅ | `config.security.domainDenylist` 支持 `*.example.com` 通配 + punycode 规范化；web_fetch 与 MCP HTTP 前置检查 |

**验收**: 9 + 3 + 6 + 8 + 4 = 30 项新单测全部通过，回归 2729/2729 core + 61/61 shared 全绿。

**Defer 到 M8.1（前端补齐）**: 权限历史 Tab 加 "会话" 列（sessionKey 前 8 位）；Settings 加 "域名策略" 小节（列表 + 增删 UI）；env 剥离一次性 toast 提示。

---

### M9 — 发布与分发 🟡 Phase 1 部分完成（P1，依赖 M0）

> **为什么在 M0 后**: 代码签名和 auto-update 建立在 CI/CD + 版本管理基础之上。
>
> **详细方案**: [`M9-ReleaseDistribution-Plan.md`](./M9-ReleaseDistribution-Plan.md)（Phase 1 证书无关 4-5d + Phase 2 证书就绪后 3-4d，共 7-9d；阿里云 OSS + 函数计算支持灰度/回滚；多品牌可扩展）

| 项目 | 工作量 | 状态 | 说明 |
|------|--------|------|------|
| T1 CHANGELOG 自动化 | 0.5d | ✅ | PR #26 |
| T2 多品牌构建抽象 | 1d | ✅ | PR #26 + #28（含构建治理：brand-apply 入库根治、postinstall、_base/ 模板）|
| T3 Windows 打包基础 | 1.5-2d | 🔒 暂停 | 等 Windows 环境 |
| T4 GitHub Actions release.yml | 1-1.5d | 🔒 暂停 | 等 T3 |
| T5 Auto-update 客户端骨架 | 0.5-1d | 🔒 暂停 | 建议与 T4 同 PR |
| T6 macOS 签名 + 公证 | 1d | 🔒 阻塞 | 等 Apple Developer 证书 |
| T7 阿里云 OSS + 函数计算 | 1.5-2d | 🔒 阻塞 | 等阿里云账号 |
| T8 Windows 非 EV 签名 | 0.5-1d | 📋 延后 | 按首客户 SmartScreen 投诉触发 |

**验收标准**: DMG 双击安装无 Gatekeeper 警告，应用内检测到新版本并提示更新。

**剩余工作量**: Phase 1 余 3-4.5d（T3/T4/T5），Phase 2 余 3-4d。**恢复条件**：Windows 环境就绪（解锁 T3→T4→T5）/ Apple 证书就绪（解锁 T6）/ 阿里云账号就绪（解锁 T7）。

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

### M12 — 运营可观测 & 成本治理（P1，依赖 M6 + M8）

> **为什么**: M8 多 Agent 协作调研（2026-04-20）发现 EvoClaw 相对 Hermes 仍缺「按 session 查询成本」能力；企业计费、用量分摊、按 Agent 统计 API 开销都需要 `session_usage` 聚合表。M6 已提供 Credential Pool 基础，M8 已提供 sessionKey 语义，此时做聚合成本最低。

| 项目 | 工作量 | 来源 |
|------|--------|------|
| `session_usage` 聚合表（session_key, agent_id, model, input/output/cache tokens, cost）+ 写入点 hook | 1.5-2d | Hermes 对比（多 Agent 协作 §4） |
| `/usage/session` 聚合查询 API（按 agentId/时间范围/模型过滤） | 1d | — |
| 前端 UsageTab 增加「按 session 分组」视图 | 1-1.5d | 沿用 M6 Usage 组件风格 |

**验收标准**: 给定 agentId + 时间窗口，能返回每个 sessionKey 的总 token 消耗和 USD 成本，与 `tool_audit_log` / `audit_log` 数据对齐。

**不包含（defer 到 M12.1）**: 预算告警规则、Provider 成本报表导出 CSV、按团队/部门分摊维度。

---

### M13 — Agent 团队协作（P1，依赖 M6 + M8）

> **为什么**: EvoClaw 面向非程序员企业用户（CLAUDE.md 定位），典型场景是「在企微/飞书发需求 → 运营策划 + UI 设计 + 文案专家团队协作产出」。当前架构只支持"消息路由到单个 bound Agent + 该 Agent 派生临时子代理"，预置 Agent 无法以独立身份被调起，团队场景能跑但不好用。
>
> **详细方案**: [`multi-agent-team-collab-deepdive.md`](../evoclaw-vs-openclaw-research/multi-agent-team-collab-deepdive.md) — 基于 OpenClaw 仓库（`/Users/mac/src/github/openclaw`）的实现级调研，1633 行文档，覆盖 OpenClaw 多 Agent 完整体系 + EvoClaw 1:1 复刻四 Phase 方案。
>
> **参考**: OpenClaw 的 `Binding 8 层路由 + TaskFlow 编排引擎 + ACP 协议派生 + stream-to-parent 中继`，无显式 Team 对象，通过 binding/flow/controllerId 组合出团队语义。

| Phase | 主题 | 工作量 | 主要交付 |
|-------|------|--------|---------|
| **Phase 1** | 渠道路由扩容 | 2w | migration 027：bindings 加 peer_kind/guild_id/team_id/roles/dm_scope/last_route_policy；8 层匹配重写；mainSessionKey + 多模式 SessionKey；抽象 Envelope Builder |
| **Phase 2** | TaskFlow 编排引擎 | 3w | migration 028：flows + tasks 双表；状态机 8 态（queued/running/waiting/blocked/succeeded/failed/cancelled/lost）；syncMode=managed/task_mirrored；乐观锁 revision；lookupToken 续场；flow_create / flow_update / flow_wait / flow_finish 四个 Agent 工具 |
| **Phase 3** | ACP 简化协议 + 派生增强 | 3-4w | migration 029：subagent_runs 表；自建 stdio+ndJson 简化 ACP（text_delta/phase/tool_call 三种消息）；sessions_spawn 全参数（runtime/agentId/mode/thread/sandbox/streamTo/cleanup）；stream-to-parent 中继（2.5s buffer + 60s stall warn + 6h 上限）；加载目标 Agent 完整 SOUL/MEMORY/AGENTS 身份 |
| **Phase 4** | per-agent 工具/MCP/AuthProfile | 2-3w | Agent config 扩展字段（subagents/tools/skills/mcp/authProfiles/lastRoutePolicy/dmScope）；tool-filter per-agent；MCP `getToolsForAgent()` 按 allowlist 过滤；AuthProfile per-agent order 覆盖；Hook Context 标准化（agentId/sessionKey/flowId） |

**总工作量**: 串行 10-12 人周 / 并行 7-9 人周（Phase 1/2、Phase 2/3、Phase 3/4 各有尾声重叠窗口）

**验收标准**（端到端场景）: 在企微群发 "帮我写一篇公众号文章介绍 X 产品"：
1. 路由到 lead "运营策划"（binding 按 channel+guild+role 命中）
2. lead 创建 TaskFlow F1（managed, controllerId=self）
3. lead 调 `sessions_spawn` 派生 "UI 设计" 和 "文案专家" 两个预置 Agent（加载各自完整身份）
4. 两个子 Agent 流式输出通过 stream relay 汇入 lead 主会话
5. lead 汇总回复至企微
6. 用户后续在同一群发 "再润色一下" → lookupToken 恢复 F1 上下文 → lead 再派发

**不包含（defer 到 M13.1/M13.2）**:
- 完整 ACP 协议（与 OpenClaw 生态互通）— 当前仅做简化自建协议
- Gateway 层分布式多节点协同（OpenClaw 有，超出单机场景）
- Team 一级对象（沿 OpenClaw 的"binding + flow 组合"路线）
- 团队配置 UI（先 config 文件 + API，Tab 在 M13.1）
- 跨 Flow 依赖（Flow A 等待 Flow B）— 当前由 controller agent 自己轮询

**风险**:
- ACP 协议自建 vs 复用外部 SDK（`@agentclientprotocol/sdk`）的权衡，Phase 3 启动前需二次评估
- 子 Agent 加载目标身份的代价（SOUL/MEMORY/AGENTS 文件 I/O + prompt 构建），可能影响派生延迟，需性能基准测试
- Phase 1 的 binding 扩容改 DB schema + 路由核心，有回归风险，需充分回归测试（现有 channel 不能坏）

**不确定项**（研究文档 §9 列出 7 条，Phase 2 前需二次调研覆盖）:
1. OpenClaw `cron/isolated-agent/` 目录是否第三种 runtime
2. ACP SDK 版本锁定与 wire 兼容
3. `acp.backend=acpx|pi-embedded` 差异与选择逻辑
4. `identityLinks` 身份聚合的配置入口
5. `waitJson`/`stateJson` 的惯例用法
6. Flow 间依赖机制
7. Gateway 跨节点能力（超出本次范围）

---

### M1.1 — Checkpoint Manager（补丁，P1，依赖 M1）

> **为什么**: M8 多 Agent 协作调研发现 Hermes 有「工具回滚」能力，EvoClaw 目前 bash/edit/write 写错文件只能人工修。面向非程序员企业用户（CLAUDE.md 核心定位），必须提供自动兜底。
>
> **参考**: Hermes `checkpoint_manager.py` 实现 — 在破坏性工具执行前快照受影响文件到 `.evoclaw/checkpoints/<toolInvocationId>/`，失败/显式 revert 时原样还原。

| 项目 | 工作量 | 来源 |
|------|--------|------|
| Checkpoint 写入层（edit/write/apply_patch 前自动备份） | 1-1.5d | Hermes hermes_state.py |
| Checkpoint Revert API + `/revert/<toolInvocationId>` 路由 | 1d | — |
| 失败工具自动 revert（`tool_audit_log.status='error'` 时触发） | 0.5-1d | — |
| 保留策略（按 agent_id 保留最近 100 个 + 7 天过期清理） | 0.5d | — |
| 单元测试 + 集成测试（edit 失败后文件恢复原状） | 1d | — |

**验收标准**: Agent 用 edit 工具改坏 `/path/to/file.ts`，下一次对话 Agent 自己意识到错误时能调 `revert` 还原；或用户手动点 UI「撤回最后操作」按钮还原。

---

### M3.1 — 全局 IterationBudget（补丁，P1，依赖 M3）

> **为什么**: M3 已做单 session 内的 IterationBudget + Grace call，但 subagent 爆量时无顶层保护。Hermes 有「全局 + 单 session 双层预算」。
>
> **参考**: `packages/core/src/agent/kernel/iteration-budget.ts` 扩展一列 `globalUsed` 跨 session 共享。

| 项目 | 工作量 | 来源 |
|------|--------|------|
| `IterationBudget` 增加全局计数器（单例 + `globalMax` 配置） | 0.5d | Hermes run_agent.py:170-211 |
| 超限时返回明确错误（区分单 session 耗尽 vs 全局耗尽） | 0.5d | — |
| 配置项 `agent.globalIterationBudget`（默认 10000，0=禁用） | 0.5d | — |
| 单元测试（两 session 共享、单 session 独占） | 0.5-1d | — |

**验收标准**: 配置 `globalIterationBudget=100`，开 3 个 session 各跑 40 轮应被拒（总 120 > 100）。

---

### Sprint 16 附带任务 — 30s 活动心跳

> **为什么**: M8 多 Agent 协作调研发现 Hermes 有「长任务期间向平台发 typing 事件」机制，防止 Telegram/企微 webhook 5s timeout 假超时。EvoClaw 现有 `HeartbeatManager` 是 Agent 主动唤醒机制，与此不同。应当在每个 channel adapter 实现层加入平台特定的保活事件（Telegram `sendChatAction('typing')` / 企微占位消息 / Slack typing indicator）。

**归属**: Sprint 16（企微 Channel 生产就绪）附带完成，不独立成模块。工作量估 0.5-1d 每 channel。

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

### A3 — Provider OAuth 2.1 Device Code Flow（P1）

> **触因**: M6 实施时交付了 CredentialPool 多 key 轮换 + Profile 热切换（PR #20），但 OAuth 登录流涉及浏览器打开/回调端口/token 存 Keychain/401 自动刷新一整套链路，独立于 API key 管道。为不阻塞 M6 核心能力落地，OAuth 单独延后。
>
> **何时启动**: 需要对接强制 OAuth 的 Provider（如企业版 Claude/ChatGPT）时；或客户要求 "不落磁盘明文 key"（配合 A1 磁盘加密一起做更顺）。

| 项目 | 工作量 | 备注 |
|------|--------|------|
| Provider 配置扩展 `auth?: { type: 'oauth', ... }` schema + Zod 验证 | 0.5d | 复用 Sprint 15.11 MCP OAuth 设计模板 |
| OAuth 2.1 + PKCE device code flow（Tauri `shell.open` + Node `http.createServer` 本地回调） | 1-1.5d | 参考 `packages/core/src/mcp/mcp-oauth.ts` 计划产物 |
| Token 存 Keychain（access_token + refresh_token + expires_at）+ 401 自动刷新 | 0.5d | 复用 `apps/desktop/src-tauri/src/credential.rs` IPC |
| 前端登录流 UI（"用浏览器登录" 按钮 + loading 态 + 失败重试） | 0.5d | 并入 `CredentialPoolEditor` 或独立 `ProviderOAuthButton` |

**预估**: 2-3d（可与 A1 磁盘加密合并一周内落地）
**前置依赖**: M6 ✅ 已完成（Provider 编辑 UI + 凭证池基础）；Sprint 15.11 MCP OAuth 落地后可共享 OAuth 公用模块
**验收标准**: Claude.ai OAuth 登录成功后 token 存于 Keychain（命令行 `security find-generic-password -s com.evoclaw.app` 可见但 key 值不可读），Provider 调用 401 时自动刷新重试一次，过期 refresh_token 触发重新登录引导。

---

### A4 — TypeScript 5.9 → 6.0 升级（P2）

> **触因**: 2026-04-20 dependabot PR #6 提出升级 TypeScript 5.9.3 → 6.0.3（跨大版本）。同批次的 vitest 4（PR #36）和 esbuild 0.28（PR #37）已落地；TS 6 挂起是**主动延后**，不是技术阻塞。
>
> **为什么延后**:
> - TS 6 是大版本升级，历史上 TS 主版本典型会引入 20-100 个类型严格化报错（`any` / `as` 断言密集处首当其冲），EvoClaw core 包 500+ 源文件 + 200+ 测试文件规模下需要一个独立冲刺处理
> - 工具链未卡在 TS 5.9（vitest 4 / Vite 8 / oxlint / esbuild 0.28 都兼容 TS 5.9）；升级 TS 6 没有即时的功能或性能收益
> - 非阻塞其他模块：M7/M12/M13 / 各种补丁均不需要 TS 6 新特性
>
> **何时启动**:
> - dependabot 继续推 TS 6.x 补丁版本，积累到 6.1/6.2 时（新大版本稳定期）一并升级
> - 或遇到 TS 5.9 的 Bug 被 TS 6 修复
> - 或其它工具链升级（如 vitest 5、Vite 9）要求 TS 6 基线

| 项目 | 工作量 | 备注 |
|------|--------|------|
| 升级 `typescript` devDep + `pnpm install` | 0.5h | 自动化 |
| 跑 `tsc --noEmit` 并分类汇总所有 TS 6 新增报错 | 0.5d | 经验预估 20-100 个报错 |
| 修复类型报错（显式类型断言 / `satisfies` 收窄 / `never` 排除） | 1-2d | 核心在 `packages/core/src/agent/kernel/` 和 `packages/core/src/memory/` 两大复杂子系统 |
| 回归测试（shared 61/61 + core 2729/2729 + lint + build） | 0.5d | 对齐 vitest 4 升级流程 |

**预估**: 2-3d
**前置依赖**: 无
**验收标准**: `pnpm build` + `pnpm lint` + `pnpm test` 全绿，`pnpm-lock.yaml` 内 typescript 字段升至 6.x，零运行时回归。

---

## 4. Sprint 排期建议

| 阶段 | 模块 | 主题 | 预估 | 状态 |
|------|------|------|------|------|
| **阶段 1** | M0 + M1 + M2 | 基础工程 + 安全 + 配置（三者可并行） | 9-14d | ✅ 完成 |
| **阶段 2** | M3 + M4 + M4.1 | Agent 核心 + MCP 生产化 + 前端补齐 | 3.5-4.5d | ✅ 完成 |
| **阶段 3** | **M5 ✅** + **M6 ✅**（OAuth→A3） | Skills 生态 + Provider 增强 | 7-11d | ✅ 完成 |
| **阶段 4** | **M7 Phase 1 ✅** + **M8 ✅** | Skill 记忆化 + 会话隔离 | 10-13d | ✅ M8（PR #30）+ M7 Phase 1（PR #39）|
| **阶段 5** | **M7 Phase 2 ✅** + **M9 🟡** + M10 | Skill 评估 + 发布 + 文档站 | 14-23d | 🟢 M7 Phase 2 ✅（PR #40），M9 剩余工作等 Windows / Apple 证书 / 阿里云账号资源就绪 |
| **阶段 6** | **M7 Phase 3 ✅** + M12 | Skill 自动进化 + 运营可观测 | ~3w + 3-4d | 🟢 M7 Phase 3 ✅（PR #41），M12 ⏳ 待启 |
| **阶段 6.5** | M13（Phase 1→4 串行） | Agent 团队协作 | 10-12w | ⏳ 待启（依赖 M6 ✅ + M8 ✅，可随时启动） |
| **阶段 7+** | M11 | 平台扩展 | 按需 | ⏳ 待启 |
| **回归** | Sprint 16（含 30s 活动心跳附带任务） | 企微 Channel 生产就绪 | — | ⏳ 待启 |
| **补丁** | M1.1 + M3.1 | Checkpoint Manager + 全局 IterationBudget | 4-7d | ⏳ 待启（可穿插进其它阶段） |

> **说明**: 当前已完成阶段 1-3 全部模块 + M7 Phase 1-3 + M8（M0-M8，OAuth 延后到 A3，**M7 Phase 4 永远不做**）。下一步候选：M13 Phase 1（Agent 团队协作路由扩容）/ Sprint 16 企微 Channel 生产就绪 / M1.1 Checkpoint / M3.1 全局预算 / M12 运营可观测 / M7.1 进化日志前端 / A3 OAuth。
>
> **M13 排序建议**：对企业用户价值高（团队协作是真实刚需），但工作量大（10-12w）。可考虑先做 M13 Phase 1（路由扩容 2w）作为独立增量，其余 Phase 按需推进；也可 Phase 1-4 集中冲一个 quarter。
>
> **M8 多 Agent 研究派生的 4 个补丁模块**（M1.1 / M3.1 / M12 / Sprint 16 附带 30s 心跳）按「领域归属」拆分而不是聚合，确保每个补齐点落在最熟悉它的上下文里。详见各模块章节。

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
