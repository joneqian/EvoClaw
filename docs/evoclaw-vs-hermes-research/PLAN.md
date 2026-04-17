# Plan: EvoClaw vs hermes-agent 按章差距分析报告（40 份）

> **文档位置**: 此 PLAN.md 是仓库内的**规范版**执行计划，与 `~/.claude/plans/rippling-munching-crab.md`（Claude Code 工作副本）保持同步。如两处不一致，**以本文件为准**。
> **最后更新**: 2026-04-16（基线 commit `c04f884`）

## Context

**任务演进**

本 plan 覆盖前一版（2026-04-16 起草的"单份聚合报告"）—— 那份报告已被用户推翻为"按 hermes 每份研究单独做差距分析"的结构。原因：

- 单份聚合（~15,000 字）虽全面，但**粒度太粗**——无法针对某一维度深挖到"改造蓝图可执行"的程度，后续 Sprint 规划无法直接引用
- **按章分析**可以做到 1:1 对应：hermes `.research/XX-chapter.md` → EvoClaw `docs/evoclaw-vs-hermes-research/XX-chapter-gap.md`，可**增量维护**（hermes 更新时只改对应章），可**独立审阅**

**当前状态（2026-04-16）**

- ✅ README.md（索引 + 统一模板 + 进度表）已建
- ✅ 05-agent-loop-gap.md 样板已建（745 行 / ~12,500 字 / 已获用户认可）
- ✅ 统一模板结构确立：§1 定位 → §2 档位速览 → §3 机制逐条深度对比（并置，无重复）→ §4 改造蓝图 P0/P1/P2 → §5 反超点汇总 → §6 附录
- ✅ 档位图例（🔴/🟡/🟢）要求每份内嵌
- ⏳ 40 份剩余章节待写（见 §进度表）

**用户明确的执行约束**

- **每批固定 3 个 Explore 子代理并行**（用户 2026-04-16 拍板）
- **Sprint 16 不受影响**，本工作产出的是**报告**，不改代码、不改 CLAUDE.md
- **进度持续写回 plan**，完成一批就更新一次

---

## 交付结构

**总路径**: `docs/evoclaw-vs-hermes-research/`

**总份数**: README + PLAN + 40 份差距分析 = 42 份 md（涵盖 hermes 34 章 + 6 份 Gateway 平台 + 本章索引 + 本执行计划）

等式校验: 34 章 + 6 份平台（19a-f）= 40 章节 → 40 份差距文档。其中 05 已完成。**待写 = 40 - 1 = 39 份**。

### 三波分发

**Wave 1 — 基石章节（我亲写，6 份）**

目的：建立风格/术语/判定口径基线，Wave 2 子代理把这 6 份和 05 样板作为参考文档。

| 顺序 | 章节 | 选它作为基石的理由 |
|---|---|---|
| 1 | 00-overview-gap.md | 总览定位，其它所有章节的"身份基准线" |
| 2 | 01-tech-stack-gap.md | TS/Node vs Python/uv 对比是所有章节的物质基础 |
| 3 | 03-architecture-gap.md | 系统级架构图，后续章节讨论的"部件"在此定义 |
| 4 | 04-core-abstractions-gap.md | 关键类型（AIAgent/ToolRegistry/BaseEnvironment）先锁定术语 |
| 5 | 06-llm-providers-gap.md | 05 主循环反复引用；Credential Pool / jittered_backoff 原地深挖 |
| 6 | 08-context-compression-gap.md | 05 主循环调用点已描述；压缩策略内部机制在此深化 |

**Wave 1 节奏**：每份单独 commit，6 份写完后停下让你审定，通过才进 Wave 2。

**Wave 2 — 并行批量（每批 3 子代理，33 份分 11 批）**

按章节自然聚类 + 每批 3 份（严格，无例外）:

| 批次 | 章节 | 聚类说明 |
|---|---|---|
| W2-1 | 02 / 09 / 10 | 仓库布局 + 工具系统 + Toolsets |
| W2-2 | 11 / 12 / 13 | 环境 spawn + Skills + Plugins |
| W2-3 | 07 / 14 / 15 | Prompt 系统 + 状态会话 + 记忆提供商 |
| W2-4 | 16 / 17 / 18 | Trajectory 格式 + 压缩 + Cron/后台 |
| W2-5 | 19 / 19a / 19b | Gateway 总览 + Telegram + Discord |
| W2-6 | 19c / 19d / 19e | Slack + Signal + Matrix |
| W2-7 | 19f / 20 / 21 | WhatsApp + ACP + MCP |
| W2-8 | 22 / 23 / 24 | 浏览器栈 + RL 环境 + Batch 运行器 |
| W2-9 | 25 / 26 / 27 | Mini SWE + RL CLI + CLI 架构 |
| W2-10 | 28 / 29 / 30 | 配置系统 + 安全审批 + 构建发行 |
| W2-11 | 31 / 32 / 33 | 测试 + 文档站 + 发布流程 |

**Wave 2 节奏**：每批并行派 3 个子代理 → 拿回草稿 → 我逐份精校 → 批次内 3 份一起 commit → 你可选抽查 → 进下一批。

**Wave 3 — 聚合收尾（我亲写，1 份）**

- 34-rebuild-roadmap-gap.md：必须在前 39 份完成后写，因为它跨章节聚合 P0/P1/P2 + 全维度反超/缺口统计 + 面向后续 Sprint 规划的优先级推荐

---

## 模板规范（严格约束）

**不变的结构**（与 README + 05 样板一致）:

```markdown
# XX — <主题> 差距分析

> 头信息块（对标研究 / hermes 基线 / EvoClaw 基线 / 综合判定）

**档位图例**:
- 🔴 EvoClaw 明显落后
- 🟡 部分覆盖 / 形态差异
- 🟢 EvoClaw 对齐或反超

## 1. 定位
## 2. 档位速览
## 3. 机制逐条深度对比（并置，每机制只写一次）
## 4. 改造蓝图 P0/P1/P2（不承诺实施）
## 5. EvoClaw 反超点汇总
## 6. 附录：引用验证 / hermes 章节引用 / 关联 gap 章节
```

**质量底线**:

- 每个 hermes 声称带 `.research/XX-chapter.md` §引用
- 每个 EvoClaw 声称带 `packages/core/src/XX.ts:LN` 引用
- 每份文档代码引用**抽样 5+ 条** Read 验证可达
- §2 档位速览表 + §3 小节一一对应，行数不少于 8 个机制
- §3 每个小节结构：hermes 代码块 + EvoClaw 代码块 + 判定分析

**自检清单**:
- [ ] 档位图例内嵌在头信息之后
- [ ] §2 档位统计（🔴+🟡+🟢）= §3 小节数
- [ ] 所有 path:line 引用可达
- [ ] 反超点在 §5 单独汇总（不只是 §3 里提一句）
- [ ] 关联 gap 章节 crosslink 到已完成文档

---

## 子代理 Prompt 模板（Wave 2 使用）

每派一个子代理，prompt 结构：

```
我要你起草一份差距分析报告。

【任务】写 `docs/evoclaw-vs-hermes-research/<XX>-<topic>-gap.md`

【对标】hermes 研究文档 `/Users/mac/src/github/hermes-agent/.research/<XX>-<topic>.md`
【EvoClaw 源码根】`/Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/`

【参考样板】（必须读，严格遵守结构和深度）
1. `docs/evoclaw-vs-hermes-research/README.md` — 模板规范
2. `docs/evoclaw-vs-hermes-research/05-agent-loop-gap.md` — 完整样板（745 行 / 15 个机制对比）

【起草要求】
- 只读 hermes 研究文档 + EvoClaw 源码，不改任何代码
- 按 §1-§6 固定结构
- §3 机制数量 8-20 个（视章节实际内容，不强求密度）
- 每条声称必须带 path:line（hermes 侧用 `.research/XX.md §N`，EvoClaw 侧用 `packages/core/src/XX.ts:LN`）
- 档位图例必须内嵌在头信息之后
- 不编造代码引用：如果 EvoClaw 没有对应实现，明确写 🔴 缺失 + `grep 零结果` 证据

【显式不做】
- 不修改 CLAUDE.md（发现不一致仅记录在 §5 反超点反面或 §3 判定里）
- 不提交 commit
- 不并发派更多子代理
- 不引用你没真的读过的代码

【产出】
直接写 `docs/evoclaw-vs-hermes-research/<XX>-<topic>-gap.md` 文件
不需要回复总结，完成后文件写出即可
```

---

## 我的精校流程（每份草稿）

子代理返回后，我做 6 步定稿:

1. **Read 全文** — 检查结构完整（§1-§6）+ 档位图例
2. **抽样验引用** — Read 验证 5 条 EvoClaw path:line 可达 + 3 条 hermes 章节 § 对应
3. **档位一致性** — §2 速览表档位数 == §3 小节数 == §5 反超数（对反超项）
4. **补反超点** — 若子代理漏了明显 🟢 项，我补到 §5
5. **补 crosslink** — §6.3 指向已完成的前序 gap 文档
6. **README 进度表同步** — 标 ✅ + 综合判定

---

## Commit 策略

- **Wave 1**: 每份一个 commit（`docs(gap): <XX>-<topic> 差距分析`），6 次
- **Wave 2**: 每批次一个 commit（3 份一起），11 次（`docs(gap): W2-<N> <三章名>`）
- **Wave 3**: 最后 1 commit（`docs(gap): 34-rebuild-roadmap 差距分析 + 聚合`）
- **全程不 push** — 由用户决定何时推远程

---

## 进度表

**Wave 1（6 份 / 我亲写）**

| # | 章节 | 状态 | commit | 综合判定 |
|---|---|---|---|---|
| 00 | overview | ✅ | `ccf67c9` | 🟡 部分覆盖（含 🟢 反超）|
| 01 | tech-stack | ✅ | `a53dc5c` | 🟡 部分覆盖（含 🟢 反超）|
| 03 | architecture | ✅ | `a2d0eea` | 🟡 部分覆盖（多项 🟢 反超）|
| 04 | core-abstractions | ✅ | `4f46e43` | 🟡 部分覆盖（多项 🟢 反超）|
| 06 | llm-providers | ✅ | `00c7fb7` | 🟡 部分覆盖（多 🔴 缺失 + 多 🟢 反超）|
| 08 | context-compression | ✅ | `9f74694` | 🟢 EvoClaw 显著反超 |

**Wave 2（33 份 / 11 批 × 3 子代理）**

| 批次 | 章节 | 状态 | commit |
|---|---|---|---|
| W2-1 | 02 / 09 / 10 | ✅ | `c3b2d59` |
| W2-2 | 11 / 12 / 13 | ✅ | `0a7f799` |
| W2-3 | 07 / 14 / 15 | ✅ | `d5a070d` |
| W2-4 | 16 / 17 / 18 | ✅ | `fce53ca` |
| W2-5 | 19 / 19a / 19b | ✅ | `a085225` |
| W2-6 | 19c / 19d / 19e | ✅ | `7769605` |
| W2-7 | 19f / 20 / 21 | ✅ | `f15db25` |
| W2-8 | 22 / 23 / 24 | ✅ | `4372f19` |
| W2-9 | 25 / 26 / 27 | ✅ | `b2761ad` |
| W2-10 | 28 / 29 / 30 | ✅ | `efa352c` |
| W2-11 | 31 / 32 / 33 | ✅ | `f01d4c9` |

**Wave 3（1 份 / 我亲写）**

| # | 章节 | 状态 | commit |
|---|---|---|---|
| 34 | rebuild-roadmap | ✅ | 待填 |

**已完成参考**

| # | 章节 | 状态 | commit |
|---|---|---|---|
| README | 索引 + 模板 | ✅ | `c04f884` / `b767b02` |
| 05 | agent-loop | ✅ 样板（745 行，用户已认可）| `c04f884` |
| PLAN | 本执行计划 | ✅ | `b767b02` |

---

## 检查点（Checkpoint）机制

- **CP-1**: Wave 1 全部完成后 → 用户审定 → 通过才进 Wave 2
- **CP-2**: Wave 2 每批 commit 后 → 用户可抽查（非强制）
- **CP-3**: Wave 2 全部完成后 → 用户审定 → 通过才进 Wave 3
- **CP-4**: Wave 3 完成后 → 用户审定全量 + 决定是否 push 远程

---

## 验证（交付后自检）

- [ ] `docs/evoclaw-vs-hermes-research/` 下共 42 份 md（README + PLAN + 05 样板 + 39 新增 = 精确 42）
- [ ] README 进度表全部标 ✅ + 综合判定填写
- [ ] 全部差距文档 `grep -L "档位图例"` 零结果（每份都带图例）
- [ ] 每份文档 `§2 速览表行数 == §3 小节数`
- [ ] 每份文档 ≥ 5 条 path:line 抽样 Read 可达
- [ ] 34-rebuild-roadmap-gap 含跨章节 P0/P1/P2 聚合表 + 反超全景

---

## 显式不做

- ❌ 不改代码（不触碰 packages/、apps/）
- ❌ 不改 CLAUDE.md（发现不一致项在对应 gap 文档里记录即可）
- ❌ 不创建 Sprint 实施计划（优先级由用户后续排期）
- ❌ 不 push 远程（commit 后等用户指示）
- ❌ 不超过 3 个子代理并行（用户拍板的硬约束）
- ❌ 不调整本 plan 的三波结构（除非用户明确要求）

---

## Plan 维护约定

- **每完成一批**（Wave 1 的每份 / Wave 2 的每批 / Wave 3 完成）→ 更新本文件 + `~/.claude/plans/rippling-munching-crab.md` 双写一致
  - 进度表对应行：📋 → ✅，填 commit hash
- **发现模板需微调**（比如质量底线要补充）→ 补到本 plan 的"模板规范"段
- **发现无法按原计划执行**（比如某个章节 hermes 研究本身就残缺）→ 在对应批次行添加 "⚠️ <问题描述>" 并通知用户
- **规范版是本文件**，`~/.claude/plans/` 里的是 Claude Code 工作副本；两处如不一致以本文件为准
