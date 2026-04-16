# EvoClaw vs hermes-agent 差距分析索引

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/`（34 章，基线 commit `00ff9a26` @ 2026-04-16）
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16）
> **研究方法**: 每份 hermes 研究章节对应一份差距分析（1:1），结构统一、可增量维护
> **交付约束**: 仅研究报告，不触碰代码；各章同等深度；修改发现仅记录不执行
> **执行计划**: [`PLAN.md`](./PLAN.md)（三波分发 / 子代理 prompt 模板 / 进度表）

## 统一三档图例

- 🔴 **EvoClaw 明显落后**（≥1 人周工作量才能补齐）
- 🟡 **部分覆盖或形态差异**（半人周或架构差异导致无法/不必要直接对齐）
- 🟢 **EvoClaw 对齐或反超**（无需补齐，或 EvoClaw 在该维度表现更佳）

## 统一章节模板

每份差距分析文档按下列结构起草。**关键约束：每个机制在 §3 只描述一次**，hermes/EvoClaw 两侧源码并置——避免 §1 / §2 单边描述 + §3 对比表的三次重复表述：

```markdown
# XX — <主题> 差距分析

> 头信息块（对标研究 / hermes 基线 / EvoClaw 基线 / 综合判定）

**档位图例**:（每份文档必须内嵌，保证单份打开可读）
- 🔴 EvoClaw 明显落后
- 🟡 部分覆盖 / 形态差异
- 🟢 EvoClaw 对齐或反超

## 1. 定位
  单边简介（各 150-200 字）— 只描述项目中的角色和规模，不展开机制细节

## 2. 档位速览
  表格形式扫描索引：机制名 → 档位 → 一句话判定，每条点入 §3 对应小节

## 3. 机制逐条深度对比
  按机制/子系统划分 15-20 个小节，每个小节：
  - hermes 实现要点（含 path:line 源码引用 + 代码片段）
  - EvoClaw 实现要点（含 packages/core/src/XX.ts:LN 引用 + 代码片段）
  - 判定与分析（🔴 / 🟡 / 🟢 + 具体差距描述 + 风险/价值说明）

## 4. 建议改造蓝图（不承诺实施）
  P0 / P1 / P2 / 不建议做，每项带工作量估算 + ROI

## 5. EvoClaw 反超点汇总
  独立表格列出 EvoClaw 反超的能力 + 代码证据 + hermes 对应缺失说明

## 6. 附录：引用验证
  - 6.1 EvoClaw 代码引用抽样（10-15 条经 Read 工具验证）
  - 6.2 hermes 研究引用（章节 §）
  - 6.3 关联差距章节（crosslink 到其他 gap 文档）
```

## 进度表

| # | 章节 | hermes 研究 | 差距文档 | 状态 | 综合判定 |
|---|---|---|---|---|---|
| 00 | 项目概览 | [00-overview.md](../../../hermes-agent/.research/00-overview.md) | [`00-overview-gap.md`](./00-overview-gap.md) | ✅ Wave 1 #1 | 🟡 部分覆盖（含 🟢 反超） |
| 01 | 技术栈 | 01-tech-stack.md | [`01-tech-stack-gap.md`](./01-tech-stack-gap.md) | ✅ Wave 1 #2 | 🟡 部分覆盖（含 🟢 反超） |
| 02 | 仓库布局 | 02-repo-layout.md | [`02-repo-layout-gap.md`](./02-repo-layout-gap.md) | ✅ Wave 2-1 | 🟡 形态差异（含 🟢 反超） |
| 03 | 总体架构 | 03-architecture.md | [`03-architecture-gap.md`](./03-architecture-gap.md) | ✅ Wave 1 #3 | 🟡 部分覆盖（多项 🟢 反超） |
| 04 | 核心抽象类型 | 04-core-abstractions.md | [`04-core-abstractions-gap.md`](./04-core-abstractions-gap.md) | ✅ Wave 1 #4 | 🟡 部分覆盖（多项 🟢 反超） |
| 05 | **Agent 主循环** | 05-agent-loop.md | [`05-agent-loop-gap.md`](./05-agent-loop-gap.md) | ✅ **样板** | 🟡 部分覆盖（含 🟢 反超项） |
| 06 | LLM Provider 路由 | 06-llm-providers.md | [`06-llm-providers-gap.md`](./06-llm-providers-gap.md) | ✅ Wave 1 #5 | 🟡 部分覆盖（多 🔴 缺失 + 多 🟢 反超） |
| 07 | Prompt 系统 | 07-prompt-system.md | [`07-prompt-system-gap.md`](./07-prompt-system-gap.md) | ✅ Wave 2-3 | 🟡 部分覆盖（多项 🟢 反超） |
| 08 | 上下文压缩 | 08-context-compression.md | [`08-context-compression-gap.md`](./08-context-compression-gap.md) | ✅ Wave 1 #6 | 🟢 EvoClaw 显著反超 |
| 09 | 工具系统 | 09-tools-system.md | [`09-tools-system-gap.md`](./09-tools-system-gap.md) | ✅ Wave 2-1 | 🟡 部分覆盖（多项 🟢 反超） |
| 10 | Toolsets 组合 | 10-toolsets.md | [`10-toolsets-gap.md`](./10-toolsets-gap.md) | ✅ Wave 2-1 | 🟡 部分覆盖（多项 🟢 反超） |
| 11 | 执行环境 & spawn | 11-environments-spawn.md | [`11-environments-spawn-gap.md`](./11-environments-spawn-gap.md) | ✅ Wave 2-2 | 🟡 部分覆盖（含多项 🟢 反超） |
| 12 | Skills 系统 | 12-skills-system.md | [`12-skills-system-gap.md`](./12-skills-system-gap.md) | ✅ Wave 2-2 | 🟢 EvoClaw 显著反超 |
| 13 | Plugins 子系统 | 13-plugins.md | [`13-plugins-gap.md`](./13-plugins-gap.md) | ✅ Wave 2-2 | 🟡 形态差异显著 |
| 14 | 状态与会话 | 14-state-sessions.md | [`14-state-sessions-gap.md`](./14-state-sessions-gap.md) | ✅ Wave 2-3 | 🟡 部分覆盖（多项 🟢 反超） |
| 15 | Memory 提供商 | 15-memory-providers.md | [`15-memory-providers-gap.md`](./15-memory-providers-gap.md) | ✅ Wave 2-3 | 🟢 EvoClaw 显著反超 |
| 16 | Trajectory 格式 | 16-trajectory-format.md | [`16-trajectory-format-gap.md`](./16-trajectory-format-gap.md) | ✅ Wave 2-4 | 🟡 形态差异（多项 🟢 反超） |
| 17 | Trajectory 压缩 | 17-trajectory-compression.md | [`17-trajectory-compression-gap.md`](./17-trajectory-compression-gap.md) | ✅ Wave 2-4 | 🟡 压缩算法反超 / 训练预处理缺失 |
| 18 | Cron / 后台 | 18-cron-background.md | [`18-cron-background-gap.md`](./18-cron-background-gap.md) | ✅ Wave 2-4 | 🟡 多项 🟢 反超（Heartbeat/Cron 隔离 + Standing Orders） |
| 19 | Gateway 总览 | 19-gateway-platforms.md | [`19-gateway-platforms-gap.md`](./19-gateway-platforms-gap.md) | ✅ Wave 2-5 | 🟡 国产渠道反超 / 国际平台缺失 |
| 19a | Telegram | 19a-telegram.md | [`19a-telegram-gap.md`](./19a-telegram-gap.md) | ✅ Wave 2-5 | 🔴 整体缺失（可迁移资产 10 项） |
| 19b | Discord | 19b-discord.md | [`19b-discord-gap.md`](./19b-discord-gap.md) | ✅ Wave 2-5 | 🔴 整体缺失（可迁移资产 12 项） |
| 19c | Slack | 19c-slack.md | `19c-slack-gap.md` | 📋 待写 | — |
| 19d | Signal | 19d-signal.md | `19d-signal-gap.md` | 📋 待写 | — |
| 19e | Matrix | 19e-matrix.md | `19e-matrix-gap.md` | 📋 待写 | — |
| 19f | WhatsApp | 19f-whatsapp.md | `19f-whatsapp-gap.md` | 📋 待写 | — |
| 20 | ACP 适配器 | 20-acp-adapter.md | `20-acp-adapter-gap.md` | 📋 待写 | — |
| 21 | MCP 集成 | 21-mcp.md | `21-mcp-gap.md` | 📋 待写 | — |
| 22 | 浏览器栈 | 22-browser-stack.md | `22-browser-stack-gap.md` | 📋 待写 | — |
| 23 | RL 环境 | 23-rl-environments.md | `23-rl-environments-gap.md` | 📋 待写 | — |
| 24 | Batch 运行器 | 24-batch-runner.md | `24-batch-runner-gap.md` | 📋 待写 | — |
| 25 | Mini SWE runner | 25-mini-swe-runner.md | `25-mini-swe-runner-gap.md` | 📋 待写 | — |
| 26 | RL CLI | 26-rl-cli.md | `26-rl-cli-gap.md` | 📋 待写 | — |
| 27 | CLI 架构 | 27-cli-architecture.md | `27-cli-architecture-gap.md` | 📋 待写 | — |
| 28 | 配置系统 | 28-config-system.md | `28-config-system-gap.md` | 📋 待写 | — |
| 29 | 安全与审批 | 29-security-approval.md | `29-security-approval-gap.md` | 📋 待写 | — |
| 30 | 构建与发行 | 30-build-packaging.md | `30-build-packaging-gap.md` | 📋 待写 | — |
| 31 | 测试 | 31-testing.md | `31-testing-gap.md` | 📋 待写 | — |
| 32 | 文档与站点 | 32-docs-website.md | `32-docs-website-gap.md` | 📋 待写 | — |
| 33 | 发布流程 | 33-release-process.md | `33-release-process-gap.md` | 📋 待写 | — |
| 34 | 复刻路线图 | 34-rebuild-roadmap.md | `34-rebuild-roadmap-gap.md` | 📋 待写 | — |

**总计**: 37 份文档（34 章节 + 包含 19a-f 的 6 份平台 + 全局索引），当前完成 1 份样板。

## 综合结论索引（待全部完成后汇总）

完成所有差距文档后，此处将生成：
- 全维度统计表（🔴 / 🟡 / 🟢 计数）
- P0/P1/P2 改进优先级聚合
- EvoClaw 反超能力全览

## 元数据

- **本研究基线 commit** (hermes): `00ff9a26`（2026-04-16，含 +682 commits 漂移审计）
- **本研究基线 commit** (EvoClaw): `5df3c79`（feat/hermes-parity 分支起点）
- **总览计划文件** (hermes 研究方): `~/.claude/plans/snappy-painting-pizza.md`
