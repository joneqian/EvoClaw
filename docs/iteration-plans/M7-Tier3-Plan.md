# M7-Tier3 战略级自进化能力 — Plan

**版本**：v1.0 — 2026-05-08
**状态**：📝 设计阶段（写完待批准 → 拆 PR 落地）
**前置**：M7-Tier1（PR #125–127, #130）+ M7-Tier2（PR #128, #129）已全部合入
**预计总投入**：~9.5–11.5 人周（4 项分阶段）

---

## 0. Context

EvoClaw M7-Tier1+Tier2 收口后，Skill 自进化已具备：
- ✅ 完整审计 + 一键回滚（Hermes 没有）
- ✅ 三态生命周期 + Pinned 保护（对齐 Hermes）
- ✅ Inline + Cron 双进化通道（Hermes 仅闲置触发）
- ✅ Curator 跨 session umbrella consolidation（对齐 Hermes）
- ✅ 8 类威胁分类 UI + 5×3 信任矩阵（数据层 M5 T2 + UI 本轮）
- ✅ Evolver/Curator 双 scheduler 全配置 UI（热重载）

**仍未做但有战略价值的能力（Tier 3）**：
| # | 名称 | 战略价值 | 投入 | 风险 |
|---|---|---|---|---|
| 3.1 | A-B 对照实验 | ★★★★★ | ~3w | 中 |
| 3.2 | Dry-run / Canary | ★★★★ | ~1w | 低 |
| 3.3 | 跨 skill 依赖图 | ★★★ | ~1.5w | 低 |
| 3.4 | 安全联邦同步 | ★★★★★ | ~4–6w | 高 |

**核心问题**：Hermes 的"自进化"是黑盒（用了就改，没有"是否真的改好了"的客观证据）。Tier 3 把自进化做成**可证伪的科学过程**，这是 EvoClaw 真正能宣称的护城河 — 不是"我们也能改 skill"，而是"我们改完会**统计学验证**它真的更好，否则自动回滚"。

---

## 1. 概览与排序建议

### 1.1 推荐顺序

**Phase A — 可观测性闭环（4w）**：3.1 A-B 对照 → 3.2 Dry-run/Canary（共享桶位逻辑）

**Phase B — 治理工具（1.5w）**：3.3 跨 skill 依赖图（独立可做，与 A-B 并行）

**Phase C — 战略扩张（4–6w，可选）**：3.4 安全联邦同步（依赖 3.1 提供"可信指标"）

### 1.2 排序理由

- **3.1 优先**：A-B 对照是其他三项的"地基"。3.2 Canary 直接复用 3.1 的桶位 + 统计；3.4 联邦同步的"上传内容"也只在 3.1 验证后才有意义；3.3 跨 skill 依赖图是辅助治理工具但和自进化主线无强耦合，可后置。
- **3.4 最后或者跳过**：4–6w 投入 + 隐私设计需求 + 与 P4 永废原则的张力，需要单独立项决策。本 plan 把它写完整给用户判断"到底做不做"。
- **3.3 灵活**：可在任何时点插入；从纯前端实现的角度，可作为"暖手"小项目。

### 1.3 关键决策点（待 user 拍板）

| 决策点 | 选项 | 默认推荐 |
|---|---|---|
| D1 | 3.1+3.2 是否合并为单 PR（4w） | 拆 2 PR：3.1 完成 + 验证后再做 3.2 |
| D2 | 3.1 桶位策略：hash 确定性 vs 计数器轮询 | hash 确定性（可重现 + 测试友好） |
| D3 | 3.1 统计检验：Mann-Whitney vs SPRT 序列检验 | Mann-Whitney（实现简单，N=30 足够检验显著性） |
| D4 | 3.3 依赖图分析方式：静态解析 vs 运行时 trace | 静态解析（轻量 + 离线可跑） |
| D5 | 3.4 是否要做（vs 跳过） | **保留 plan，不立刻动手**；等 3.1/3.2 落地后社区有真实需求再决定 |
| D6 | 3.1 自动回滚阈值 | 退化 ≥ 10% 且 p < 0.05 → 自动回滚（保守） |

---

## 2. 3.1 — Skill A-B 对照实验（~3w）

### 2.1 Before / After / 机制

#### Before
当 Evolver `refine` 一个 skill 后：
- 落 `skill_evolution_log`（hash + content + decision + reasoning）
- SKILL.md 立即被新版本覆盖
- "新版本是否真的比旧版更好"？**没有任何客观证据**，靠 LLM 自评 + 用户感觉

如果 LLM 改坏了：
- 用户要么自己发现（多次失败后通过 inline review 触发反向 refine）
- 要么 cron evolver 下一轮发现成功率掉了，再改一次（可能越改越糟）
- 一键回滚（PR1 已实现）能用，但**用户得主动看到日志才知道要回滚**

#### After
Evolver 每次 `refine` 后进入 **A-B 测试期**（默认 N 天 + M 次调用上限）：
- 旧 hash 标 A，新 hash 标 B
- 单 skill 后续每次 `invoke_skill` 按桶位策略选 A 或 B 版本
- 记录每次调用的 outcome（success / duration / token / 用户 feedback）
- 测试期满 → 跑 Mann-Whitney U 检验：
  - **B 显著优于 A**（p < 0.05 且 success rate 提升 ≥ 5%）→ 自动 promote B（结束测试，正式生效）
  - **B 显著差于 A**（p < 0.05 且 success rate 退化 ≥ 10%）→ 自动 rollback A（落 audit 记录）
  - **无显著差异**（| Δ | < 5% 或 p ≥ 0.05）→ keep B（默认信任 LLM 决策）+ 标注 inconclusive
- 前端 EvolutionLogPanel 增"测试中"徽章 + 实时进度条 + 决策结果

#### 机制（核心数据流）

```
[invoke_skill 入口]
   ↓
[查 skill_ab_test 表]：当前 skill 是否在 A-B 期？
   ↓ 是
[桶位决定]：hash(sessionKey + skillName) % 2 → A 或 B
   ↓
[加载对应 hash 的 SKILL.md]：从 git-like content store 取（PR1 已有 previous_content）
   ↓
[执行 skill]
   ↓
[telemetry]：记录 variant=A|B + outcome 到 skill_ab_outcome 表
   ↓
[skill_ab_evaluator cron 每天 04:30 跑]：
   - 已到期 / 已达 N 次调用 → 跑统计检验 → promote / rollback / keep
   - 写 skill_evolution_log（trigger_source='ab-promote' / 'ab-rollback'）
```

### 2.2 数据模型（migration 040 + 041）

#### `skill_ab_test`（A-B 测试主表）
```sql
CREATE TABLE IF NOT EXISTS skill_ab_test (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name      TEXT NOT NULL,
  evolution_log_id INTEGER NOT NULL,                  -- 关联触发 A-B 的 skill_evolution_log 行
  status          TEXT NOT NULL DEFAULT 'active',     -- 'active' | 'promoted' | 'rolled_back' | 'inconclusive'
  variant_a_hash  TEXT NOT NULL,                      -- 旧版本 hash
  variant_b_hash  TEXT NOT NULL,                      -- 新版本 hash
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at        TEXT,                               -- 测试结束时间
  min_calls_per_variant INTEGER NOT NULL DEFAULT 30,  -- 每变体最少调用次数才检验
  max_test_days   INTEGER NOT NULL DEFAULT 7,         -- 测试期上限（天）
  decision_reason TEXT,                               -- 'promoted: B success +12% p=0.02' / 'rolled_back: B duration +85% p=0.001'
  p_value         REAL,                               -- 统计检验的 p 值
  effect_size     REAL,                               -- B 对 A 的相对差（success rate diff，正=B 好）
  FOREIGN KEY (evolution_log_id) REFERENCES skill_evolution_log(id)
);
CREATE INDEX idx_skill_ab_test_active ON skill_ab_test(status, skill_name);
CREATE INDEX idx_skill_ab_test_skill ON skill_ab_test(skill_name);
```

#### `skill_ab_outcome`（每次调用一行）
```sql
CREATE TABLE IF NOT EXISTS skill_ab_outcome (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ab_test_id      INTEGER NOT NULL,
  variant         TEXT NOT NULL,                      -- 'A' | 'B'
  invoked_at      TEXT NOT NULL DEFAULT (datetime('now')),
  session_key     TEXT,
  agent_id        TEXT,
  success         INTEGER,                            -- 0/1，与 skill_usage 一致
  duration_ms     INTEGER,
  tool_calls_count INTEGER,
  user_feedback   INTEGER,                            -- 1/-1/NULL（用户 👍/👎）
  FOREIGN KEY (ab_test_id) REFERENCES skill_ab_test(id)
);
CREATE INDEX idx_skill_ab_outcome_test ON skill_ab_outcome(ab_test_id, variant);
```

### 2.3 桶位策略（D2 决策）

**hash 确定性**（推荐）：
```ts
const bucket = hash(`${sessionKey}:${skillName}:${abTestId}`) % 2 === 0 ? 'A' : 'B';
```
- 同一 session 内重复调用同 skill 总是同一变体（避免 user 觉得 skill 行为不稳定）
- 跨 session 公平分配（不同 sessionKey 落不同桶）
- `abTestId` 加盐：换一个 A-B 测试时桶位重新洗牌（防对同一用户长期偏向同一变体）

**Counter 轮询**（备选）：每次调用计数器 +1，奇数 A 偶数 B。
- 优点：分布更均匀
- 缺点：同 session 内 skill 行为可能跳变（A→B→A），用户体验差

### 2.4 SKILL.md 内容寻址

A-B 期内同一 skill 名要能加载新旧两个版本。复用 PR #125 已有的 `skill_evolution_log.previous_content / new_content`：
- A-B 启动时把 `previous_content` 物化到 `~/.evoclaw/skills/.ab-cache/<name>-<hash>.md`
- `invoke_skill` 桶位决定后：variant=A → 读 cache 文件；variant=B → 读正常路径 SKILL.md
- A-B 结束（promote/rollback）→ 清理对应 cache 文件
- 测试期 LLM 看到的 `<available_skills>` 注入仍然是 B（不展示分裂状态）

### 2.5 统计检验（D3 决策）

**Mann-Whitney U**（推荐）：
- 适合非参数（success 是二值，duration 是右偏分布）
- N=30 per variant 时可检测 effect size = 0.5 的显著差异
- 实现：手写 U 统计量 + 查表 / 正态近似 p 值（无外部依赖）

**SPRT**（备选）：
- 序列检验，可提前终止（节省样本）
- 实现复杂 + 概率论门槛高
- 不推荐第一版

伪代码：
```ts
function evaluateAbTest(abTestId: number, db: SqliteStore): Decision {
  const outcomes = db.all<{ variant: string; success: number; durationMs: number }>(...);
  const a = outcomes.filter(o => o.variant === 'A');
  const b = outcomes.filter(o => o.variant === 'B');

  if (a.length < MIN_CALLS || b.length < MIN_CALLS) return { type: 'continue' };

  // Success rate 对比
  const aRate = a.filter(o => o.success === 1).length / a.length;
  const bRate = b.filter(o => o.success === 1).length / b.length;
  const successDiff = bRate - aRate;

  // Duration 对比（B 慢 ≥ 50% 也算退化，即使 success 相当）
  const aDur = median(a.map(o => o.durationMs));
  const bDur = median(b.map(o => o.durationMs));
  const durationRatio = bDur / aDur;

  // Mann-Whitney U on success
  const successP = mannWhitneyU(
    a.map(o => o.success), b.map(o => o.success),
  );

  // 决策
  if (successDiff >= 0.05 && successP < 0.05) {
    return { type: 'promote', reason: `B success +${(successDiff*100).toFixed(1)}% p=${successP.toFixed(3)}` };
  }
  if (successDiff <= -0.10 && successP < 0.05) {
    return { type: 'rollback', reason: `B success -${(-successDiff*100).toFixed(1)}% p=${successP.toFixed(3)}` };
  }
  if (durationRatio >= 1.5) {
    return { type: 'rollback', reason: `B duration +${((durationRatio-1)*100).toFixed(0)}% (≥50% slower)` };
  }
  return { type: 'inconclusive', reason: `Δsuccess=${(successDiff*100).toFixed(1)}% p=${successP.toFixed(3)}` };
}
```

### 2.6 实施分包（PR 拆分）

**PR-T3-1a（~1.5w）**：数据模型 + 桶位 + telemetry
- migration 040 + 041
- `skill-ab-store.ts`（CRUD）
- `skill-tool.ts:invoke_skill` 入口加 bucket 决定逻辑
- `skill-ab-cache.ts`（管理 .ab-cache/ 目录）
- 测试：桶位确定性、cache 物化、telemetry 记录

**PR-T3-1b（~1w）**：评估 cron + Mann-Whitney U
- `skill-ab-evaluator.ts`（核心决策）
- `mann-whitney.ts`（手写实现 + 测试）
- 注册新 cron `skill_ab_evaluator`（默认每日 04:30）
- 自动 promote / rollback / inconclusive 三态执行
- 测试：固定数据集回归（小样本 + 大样本场景）

**PR-T3-1c（~0.5w）**：前端可视化
- EvolutionLogPanel 加"A-B 测试中"徽章 + 进度条（X/30 calls）
- 测试结束后展示 decision_reason + p_value + effect_size
- 新 REST：`GET /skill-evolution/ab-status?skillName=X`

### 2.7 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| A-B 期间用户体验不稳定（同 user 看到不同 skill 行为） | 中 | hash 桶位（同 session 一致） |
| LLM 看到的目录注入是 B，但运行 A → "幻觉指令" | 低 | A-B 仅影响内容加载，目录 metadata（whenToUse/mode）两版相同 |
| 小样本下统计检验不可靠 | 中 | min_calls_per_variant=30 阈值；< 30 持续 inconclusive |
| skill 调用极少（一周 < 30）→ 永远 inconclusive | 中 | max_test_days 上限到期强制 inconclusive 收尾 |
| .ab-cache/ 目录 fs 损坏 | 低 | A-B 启动失败 → 跳过本次（落 evolution_log error） |
| 多个 A-B 同时进行（同 skill 有套娃 refine） | 中 | 同一 skill 同时只允许 1 个 active A-B；新 refine 等当前 A-B 结束（或显式 cancel） |

### 2.8 前端影响
- ✅ EvolutionLogPanel：新徽章 + 进度条 + 决策结果
- ✅ SkillPage 我的技能卡片：A-B 期间显示「A/B 测试中」小徽章（可选）
- ❌ SettingsPage：A-B 默认开启，无单独 toggle（避免配置爆炸）；可在 Curator 配置里加个 "abTestEnabled: bool" 隐藏开关给 IT admin

### 2.9 日志埋点
- `info`：A-B 启动（含 ab_test_id / skill_name / variant_a_hash / variant_b_hash）
- `info`：每个 evaluator cycle 摘要（active 计数 / 决策计数）
- `info`：每次决策（promote / rollback / inconclusive 含 reason）
- `warn`：cache 物化失败 / 多 A-B 冲突
- `debug`：每次 invoke_skill 桶位决定（含 hash + variant）

### 2.10 验证清单
- [ ] 单测：mannWhitneyU(等长 / 不等长 / 全 0 / 全 1 / 大样本)
- [ ] 单测：bucketAssignment 确定性（同 input 同 output）+ 分布近似 50/50
- [ ] 集成测试：mock 50 次调用 → evaluator 输出 promote/rollback/inconclusive 各场景
- [ ] 集成测试：A-B 与 inline review 共存（pinned skip A-B）
- [ ] 端到端：埋数据 → cron run-now → EvolutionLogPanel 显示决策
- [ ] 性能：A-B 期内每次 invoke_skill 增 ≤ 5ms 开销
- [ ] 多并发：同 skill 同时 100 次调用 → outcome 表无冲突

---

## 3. 3.2 — Dry-run / Canary 模式（~1w）

### 3.1 Before / After / 机制

#### Before
Evolver 每次 LLM 决策 → **直接生效**（写 SKILL.md）。错了只能事后回滚（PR #125 已支持），但**已经污染了用户主对话**。

#### After
新增 `evolverMode` 配置三档：
- **`apply`**（默认）：直接生效，行为与今天一致
- **`dryRun`**：LLM 决策落 evolution_log + previous/new content，**但不写 SKILL.md**。前端列表显示「待审核」徽章 + 「应用 / 拒绝」按钮。
- **`canary`**：只对 N% 流量（默认 10%）生效新版本，N 天后自动 promote 或 rollback。**与 3.1 A-B 共享桶位逻辑**，只是 A 桶比例 90% / B 桶 10%。

#### 机制
- `dryRun`：runEvolverDecision 不调 `executeRefine` / `executeCreate`，只 logEvolutionDecision。新加 REST `POST /skill-evolution/log/:id/apply` 应用、`/reject` 拒绝。
- `canary`：复用 3.1 的 `skill_ab_test` 表，多加一列 `is_canary BOOLEAN` 标记。桶位计算时 hash 落[0..0.1) 为 B，其他为 A。

### 3.2 实施
- `SkillEvolverConfig` 新增 `mode: 'apply' | 'dryRun' | 'canary'` + `canaryRatio: 0.1`
- `runEvolverDecision` 按 mode 分支执行
- 复用 3.1 的 ab_test 基础设施（依赖 PR-T3-1a 先完成）
- 前端 EvolutionLogPanel 增「待审核」过滤 tab + 应用/拒绝按钮
- SettingsPage Evolver 配置加 mode 单选 + canaryRatio 数字输入

### 3.3 前端影响
- EvolutionLogPanel：新「待审核」过滤 tab；待审核行右侧加 应用 / 拒绝 按钮
- SettingsPage：Evolver 配置 mode 单选 (apply/dryRun/canary)

### 3.4 投入估算
1w（5d）：依赖 3.1 完成。如果 3.1 未做单独估到 2w（含 ab_test 表）。

---

## 4. 3.3 — 跨 skill 依赖图（~1.5w）

### 4.1 Before / After / 机制

#### Before
当 skill A 在 SKILL.md 内推荐 / 调用 skill B（"... 然后调用 invoke_skill('summarize') ..."），重构 B 时**不知道** A 受影响。Evolver / Curator 改某个 skill 可能破坏被引用链。

#### After
- 启动时（或 Curator 触发时）扫描所有 SKILL.md，解析正文里的 `invoke_skill('xxx')` 引用 + `<skill name="xxx">` XML 引用 + Markdown link `](skill://xxx)`
- 构建依赖图存 SQLite + 暴露 REST + 前端可视化
- Evolver / Curator 改动一个被引用 ≥ N 次的 skill 时，UI 标记 high-impact

#### 机制（D4 决策：静态解析）
- **静态解析**：纯字符串匹配 + 正则，无需运行时 trace
  - 模式：`invoke_skill\(['"](\w[\w-]*)['"]` 抓 inline 调用
  - 模式：`<skill\s+name=['"](\w[\w-]*)['"]` 抓 XML 引用
  - 模式：`\]\(skill://(\w[\w-]*)\)` 抓 markdown link
- **运行时 trace（备选）**：埋点 invoke_skill 调用栈，记录 caller skill → callee skill。更准确（含 LLM 实际调用）但需要长时间数据积累

### 4.2 数据模型（migration 042）

```sql
CREATE TABLE IF NOT EXISTS skill_dependency (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_skill  TEXT NOT NULL,
  to_skill    TEXT NOT NULL,
  reference_type TEXT NOT NULL,  -- 'invoke_skill' | 'xml_ref' | 'markdown_link'
  source_line INTEGER,
  scanned_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (from_skill, to_skill, reference_type)
);
CREATE INDEX idx_skill_dep_to ON skill_dependency(to_skill);
CREATE INDEX idx_skill_dep_from ON skill_dependency(from_skill);
```

### 4.3 扫描器
- `skill-dependency-scanner.ts`：单文件解析器（输入 SKILL.md 内容 → 返回 references[]）
- 触发时机：
  - 启动时全量扫描（一次性）
  - skill_manage create/edit/patch 后增量扫描该文件
  - Curator 触发时全量扫描（防 drift）

### 4.4 前端可视化
- SkillPage 详情视图加"依赖关系"子 Tab（如 PR1 时讨论过但当时没必要做）
- 渲染：上游（多少 skill 引用了我）+ 下游（我引用了哪些 skill）
- 改动 high-impact skill 时（被引用 ≥ 3 次）→ EvolutionLogPanel 加红色徽章

### 4.5 投入估算
1.5w（7-8d）：扫描器 1.5d + 数据模型 0.5d + 触发集成 1.5d + REST 0.5d + 前端 2d + 测试 1.5d + 文档 0.5d

### 4.6 前端影响
- SkillPage：新「依赖关系」子 Tab（per-skill 详情视图，需要先扩 SkillPage 加 detail panel — 之前 PR1/2 时跳过了）
- EvolutionLogPanel：high-impact 标记（红色徽章）
- 注意：PR1/2 没做 SkillPage detail panel，本 PR 要补 — 可能扩到 2w

---

## 5. 3.4 — 安全联邦同步（~4-6w，可选）

### 5.1 Before / After / 机制

#### Before
M7 Phase 4 永废了"原文 + 调用 telemetry 上传"。所有 EvoClaw 用户互相隔离 — 用户 A 改进的 skill 永远不会让用户 B 受益。

#### After
**绕开 P4 永废原则**：不上传内容，只上传**统计指标 + 用户主动标记的"通用增强"**：
- 上传项（用户授权后）：
  - skill 名 + hash + 大小（不含内容）
  - 聚合统计：success rate / duration 分位数（差分隐私加噪）
  - 用户主动 ✅「这个 skill 我觉得有用」（非匿名提交，记录用户 ID）
- 不上传：
  - SKILL.md 内容
  - 调用 telemetry（避免泄露用户在做什么）
  - conversational_feedback（用户对话原文）

ClawHub 端聚合后输出"信号"给所有用户：
- 「这个 skill 在所有用户里成功率 Top 10%」
- 「全社区 N 个用户标记此 skill 为有用」
- 不输出"具体改了什么内容"（保持各用户本地差异化）

#### 机制
1. 用户在 SettingsPage 显式启用 federation（默认关）+ 选择上传级别（statistics-only / with-attribution）
2. 本地 cron job 每周聚合 → 差分隐私加噪 → POST 到 ClawHub aggregator
3. ClawHub 不存 raw 数据，仅滚动 30 天聚合
4. SkillPage 商店增"社区评价"维度（success rate ranking）

### 5.2 投入估算细节
- 隐私设计 + 法律审查：1w
- 后端 ClawHub 聚合 API：2w
- 桌面端上传 cron + 差分隐私加噪：1w
- 桌面端 UI（授权流 + 同意书 + 取消授权）：0.5w
- 文档（隐私政策 + 用户协议）：0.5w
- 全链路测试 + 灰度：1w

### 5.3 风险
- **隐私事故**：即使统计指标也可能泄露用户身份（罕见 skill 名 + 罕见 use case → 可识别用户）
- **法规合规**：GDPR / 《个人信息保护法》要求的同意书 + 数据保留 + 删除权
- **战略一致性**：与 P4 永废文档的边界要写清（防社区误解为"P4 死灰复燃"）

### 5.4 决策建议
**保留 plan，不立刻做**。理由：
- 4-6w 投入对当前用户规模 ROI 不确定
- 隐私设计需要法务参与（远超工程范畴）
- P4 永废文档需要修订或加注（管理上的 churn）
- 等 3.1/3.2 落地、用户开始真实使用 A-B 数据后，再判断"社区共享是否有真实需求"

---

## 6. 总投入与日程预估

### 6.1 单人工作日推算

| 阶段 | 内容 | 工作日 |
|---|---|---|
| Phase A1 | 3.1 PR-T3-1a（数据 + 桶位 + telemetry） | 7-8d |
| Phase A2 | 3.1 PR-T3-1b（评估 cron + Mann-Whitney） | 5d |
| Phase A3 | 3.1 PR-T3-1c（前端可视化） | 2-3d |
| Phase A4 | 3.2 Dry-run / Canary（共享 3.1 桶位） | 5d |
| Phase B | 3.3 跨 skill 依赖图（含 SkillPage detail panel） | 7-10d |
| Phase C（可选）| 3.4 联邦同步 | 20-30d |

**最小有竞争力子集（A 阶段 + B 阶段）≈ 26-31 工作日 ≈ 5-6 人周**

### 6.2 推荐分阶段决策

**Step 1**（本 plan 通过后）：开始 Phase A1（PR-T3-1a 数据模型 + 桶位）
- 拆 PR 起 `feat/m7-tier3-ab-foundation` 分支
- 1.5w 后第一个 PR 落地

**Step 2**（PR-T3-1a 合入后）：评估实战使用 → 决定 A2/A3 节奏
- 看 telemetry 数据是否健康、桶位分布是否均匀
- 然后 PR-T3-1b 跟上

**Step 3**（A 阶段全部合入后）：评估 3.2 是否合并到 3.1 后续 PR
- 共享桶位逻辑成熟后 3.2 实现简单
- 大概率 1 个增量 PR 收口

**Step 4**：3.3 独立立项（可与 A 阶段并行）

**Step 5**：3.4 单独决策门（不在 Tier 3 自动推进）

---

## 7. 与现有设计的接口

### 7.1 与 SkillEvolutionDesign.md 的关系

本 plan 是 SkillEvolutionDesign.md 的 Phase 5+ 扩展（Phase 4 已永废）：
- Phase 5 = A-B 对照（3.1 + 3.2）
- Phase 6 = 跨 skill 治理（3.3）
- Phase 7 = 社区联邦（3.4，待决策）

合入后 SkillEvolutionDesign.md 加新章节 Phase 5/6/7。

### 7.2 与 M7-Curator-Plan.md 的关系

3.1 A-B 与 Curator 互相独立但共用 evolution_log：
- Curator umbrella consolidation 不进入 A-B 测试（merge 操作不可统计验证）
- Curator pruning（archive）也不进 A-B（已是终态决策）
- 仅 Evolver `refine` / `create` 决策走 A-B

### 7.3 配置层影响

新增 `security.skillEvolver` 字段：
```ts
abTestEnabled: boolean (default true after PR-T3-1a)
abMinCallsPerVariant: number (default 30)
abMaxTestDays: number (default 7)
mode: 'apply' | 'dryRun' | 'canary' (default 'apply')
canaryRatio: number (default 0.1)
```
新增 `security.skillCurator`：无变化。

---

## 8. 决策点深度分析（D1-D7）

每个决策按 **现状 / 选项对比 / 推荐 + 理由 / 选错的代价** 四栏展开。每节末尾给出对应的下游影响。

---

### D1 — Tier 3 起点：PR-T3-1a 直接动 vs 更多调研

**现状**
- 本 plan 已把数据模型（migration 040/041）、桶位算法、统计检验、PR 拆分、风险全写完
- 存量 evolution_log 数据可以直接复用（previous/new content + hash 都已存）
- Mann-Whitney U 算法是经典实现，没有"研究价值"

**选项对比**

| | A. 直接 PR-T3-1a | B. 更多调研（1-3d） |
|---|---|---|
| 推进速度 | 立刻起分支 | 调研期间停滞 |
| Schema 风险 | 中（plan 写得很细但实施可能踩坑） | 低（先 jupyter prototype） |
| 调研产出 | 无 | jupyter notebook + N=10/30/100 模拟数据集 |
| 节省返工 | 0 | 0-1d（最坏情况 schema 改 1 列） |
| 决策能力提升 | 0 | 高（看到模拟数据后对阈值更有把握） |

**推荐：A 直接动**

**理由**：
1. **plan 已经够细**：schema 三表都写到列级，桶位算法 5 行 hash mod 2，统计检验有伪代码。调研无新东西可挖。
2. **真正的不确定性在数据**：schema 设计的好坏要等真有 A-B 数据才能验证；调研做的"模拟数据集"和真实 telemetry 分布大概率有 gap。
3. **migration 改 1 列的代价 ~1d**：远小于"先调研 3d"。
4. **失败可逆**：PR-T3-1a 落地后还有 PR-T3-1b、1c 两次评审窗口可以回头改 schema。

**选 B 的代价**：1-3d 直接成本 + 调研结论很可能是"按 plan 走"的状态；但**好处是阈值（D6）选择会基于模拟数据更可靠**。如果对 D6 没信心，调研值得做。

**下游影响**：选 A → 下面 D2/D3/D6 就照 plan 默认走，PR-T3-1a 本周内可起分支；选 B → 还需要单独 0.5w 的"探索性 jupyter notebook" PR，再回到 plan。

---

### D2 — 桶位策略：hash 确定性 vs counter 轮询

**现状**
- A-B 期内每次 `invoke_skill` 都要决定 user 看到 A 还是 B 版本
- 桌面单用户场景（EvoClaw）vs 大规模 SaaS（如 web 服务）两种部署语义差异巨大
- 无中央协调器，本地决策

**选项对比**

| | A. hash 确定性 | B. Counter 轮询 |
|---|---|---|
| 算法 | `hash(sessionKey:skillName:abTestId) % 2` | `globalCallCount % 2 === 0 ? 'A' : 'B'` |
| 用户感知 | 同 session 行为稳定 | 同 session 可能 A→B→A 跳变 |
| 分布偏差 | 取决于 hash 质量；N>20 时 ≤ ±10% | 严格 50/50 |
| 多机一致性 | ✅ 确定性，跨机相同 | ❌ 需中央 counter（EvoClaw 桌面无中心） |
| 测试可重现性 | ✅ 同 input 同 output | ❌ counter 状态不稳定 |
| 实现复杂度 | 5 行 SHA1 + mod | 需 SQLite atomic increment |
| 冷启动 | 立刻可用 | 需先建 counter 行 |
| EvoClaw 适配性 | ★★★★★ | ★★★ |

**推荐：A hash 确定性**

**理由**：
1. **桌面单用户场景下 B 几乎没意义**：counter 轮询的"严格 50/50"优势只在数千用户聚合时显著；单用户每天可能就调 N=10 次某 skill，counter 偶数次就全 A 偶数次就全 B，**反而方差更大**。
2. **用户体验**：同一 session 内某 skill 突然换版本（counter 模式下），用户感知是"行为不稳定"。hash 模式同 session 稳定，是更好的产品体验。
3. **可测试性**：单测时给定 sessionKey 能预测桶位 = 测试可写。counter 测试需要全局状态注入。
4. **多机一致**：未来如果 sidecar 多副本部署，hash 仍然一致；counter 必须中心化。

**选 B 的代价**：单用户 30 调用样本下分布可能 12A/18B 而非 15/15，统计检验 power 略降。但 30 样本本来就不是大样本，这点损失可忽略。

**下游影响**：选 A → 不需要新表存 counter 状态；hash function 选 SHA1 还是 djb2 是次要选择（用 Node 内置 `crypto.createHash('sha1')` 即可）。选 B → migration 040 加 counter 列 + atomic increment SQL。

---

### D3 — 统计检验：Mann-Whitney U / SPRT / 简单 z-test

**现状**
- 数据特性：success 是 0/1（二值），duration_ms 是右偏分布（少数慢调用拖尾）
- 样本量：每变体最少 30，最多 ~200（视 skill 调用频率）
- 实施约束：纯 TS 实现，无 SciPy/R 依赖

**选项对比**

| | A. Mann-Whitney U | B. SPRT 序列检验 | C. 简单 z-test |
|---|---|---|---|
| 数学背景 | 非参数秩检验 | 序列概率比 | 大样本正态近似 |
| 适配 success（二值） | ✅ | ✅（Bernoulli SPRT） | △（N>30 才稳） |
| 适配 duration（右偏） | ✅（不假设正态） | △（需先验分布） | ❌（z-test 假设正态） |
| 最小样本 | N=30/变体 | 视先验，可 N<30 | N>>30 |
| 提前终止 | ❌ 必须等到 N=30 | ✅ 强信号时可早决策 | ❌ |
| 实现复杂度 | 中（200 行手写） | 高（似然比 + 边界） | 低（50 行） |
| 团队熟悉度 | ★★★★ | ★★ | ★★★★★ |
| FP / FN 控制 | 显式 α、β | 显式 α、β | 仅 α |
| 单测难度 | 易（小数据集查 U 统计量表） | 难（仿真数据） | 易 |

**推荐：A Mann-Whitney U**

**理由**：
1. **数据特性匹配**：success + duration 混合分布，非参数检验是唯一兼容选择。z-test 在 success（Bernoulli）小样本下严重偏差；duration 右偏更不适用 z。
2. **N=30 不算大样本**：z-test 要求 N>>30 才能正态近似生效；Mann-Whitney 对 N=30 性能良好（power ≈ 0.7 detect d=0.5 with α=0.05）。
3. **实现复杂度可控**：手写 U 统计量 ~50 行（计算秩 + 求和），p 值用正态近似 ~30 行（mean/var 公式 + erfc）。一共 80 行核心 + 测试 ~100 行。
4. **SPRT 不值**：提前终止 1-2 天的好处不抵实现 + 测试 + 维护成本（~1w 额外投入）。

**选错的代价**：
- 选 C z-test：在 success rate 检验上会出现 false positive（Bernoulli 小样本不正态），导致**激进 promote 实际差不多的 B**。早期会有几次"AB test 说 B 赢了，但用户体感无差别"的尴尬。
- 选 B SPRT：实现 + 测试多花 ~1w，提前终止节省的 1-2 天根本不是关键瓶颈（小样本场景 N=30 本来就一周内能填满）。

**下游影响**：选 A → 需新文件 `mann-whitney.ts`（~80 行 + ~100 行测试），是 PR-T3-1b 的主要内容。

---

### D4 — 依赖图分析方式：静态解析 vs 运行时 trace

**现状**
- skill A 在 SKILL.md 里建议"然后调用 invoke_skill('summarize')" → A 依赖 B
- 也可能 A 在 prompt 里提到 B 的名字但不显式调用 → 软依赖
- 也可能 LLM 看完 A 的 SKILL.md 后**实际**调用了 B → 真实运行时依赖
- 三种依赖关系语义不同

**选项对比**

| | A. 静态解析 | B. 运行时 trace | C. 两者结合 |
|---|---|---|---|
| 数据来源 | SKILL.md 文本 | invoke_skill 调用栈 | 两个 |
| 准确性 | 高（精确字面引用）| 高（实际行为） | 最高 |
| 完整性 | 漏掉动态构造的 skill 名 | 漏掉 prompt 推荐但 LLM 没用的 | 全 |
| 实现成本 | ~3d（regex + scanner + 触发点）| ~5d（埋点 + 调用栈追踪 + 数据模型）| ~6d |
| 冷启动 | ✅ 启动即可用 | ❌ 需 1-2 周数据积累 | △ 静态先用 |
| 持续维护 | 低（SKILL.md 改完触发增量扫描）| 中（埋点 + DB 写入开销）| 中 |
| 误报 | 低（regex 严格） | 低（实际数据） | 低 |
| 漏报 | 中（动态名字漏） | 中（prompt 软推荐漏） | 几乎 0 |

**推荐：A 静态解析**

**理由**：
1. **依赖图的核心用途是"安全治理"**：Curator 改 skill B 前要知道哪些 A 依赖它。静态解析能捕获所有"显式声明的依赖"，对治理足够。
2. **动态名字 invoke_skill(varName) 的 case 极少**：Skill 工具调用一般是字面 string，rare case。
3. **运行时 trace 冷启动太久**：前 2 周图为空，无法支持 PR1 即时治理。
4. **YAGNI**：B 的精确性提升对当前规模没必要；如果未来需要可作为 3.3 followup 增强。

**选错的代价**：
- 选 B 单独：冷启动 2 周内依赖图为空 → Curator 改 skill B 时不知道 A 依赖它 → 可能破坏依赖链。
- 选 C：多花 2-3d 投入，但**对 EvoClaw 当前规模收益微乎其微**（依赖图主要靠少量大 cluster，规模大了再升级）。

**下游影响**：选 A → 新文件 `skill-dependency-scanner.ts`（regex 解析 + AST 不需要）+ migration 042 +REST 端点 + SkillPage 详情视图。**注意**：3.3 plan 提到 SkillPage 当前没有 per-skill detail panel（PR1/PR2 跳过），3.3 要补 detail panel，工作量可能从 1.5w 扩到 2w。

---

### D5 — 3.4 安全联邦同步：本期跳过 / 加待办 / 立刻立项

**现状**
- M7 Phase 4 永废文档明确写了"数据严格 local-only"
- 当前用户规模未知（预计单数字到双位数）
- 隐私设计需要法务参与
- ClawHub 后端目前是只读（下载 skill），没有上传 API

**选项对比**

| | A. 本期跳过 | B. 加待办（Tier 4） | C. 立刻立项 |
|---|---|---|---|
| 投入 | 0 | 0（仅记录） | 4-6w + 法务咨询 |
| 与 P4 永废原则 | 一致 | 一致（待办不动手） | **冲突**（需修订 P4 文档）|
| 隐私风险 | 0 | 0 | 高（差分隐私设计 + 数据保留） |
| 法律合规 | N/A | N/A | GDPR + 个人信息保护法 必读 |
| 战略价值（now） | 中（保持 EvoClaw "数据主权"叙事）| 中 | 高（潜在）但前置条件未满足 |
| 战略价值（1 年后）| 视用户规模 | 视用户规模 | 视用户规模 |

**推荐：A 本期跳过**

**理由**：
1. **ROI 不确定**：4-6w 投入对当前用户规模可能完全没回报。
2. **P4 永废文档的"承诺成本"**：修订 P4 永废需要给老用户解释"为什么之前说不做现在又做了"，PR 的字面内容简单但管理成本不可见。
3. **隐私设计成本远超工程**：差分隐私加噪参数 ε 选择、k-匿名度量、数据保留 30d 还是 90d、用户撤回数据的实现 — 这些是法务 + 隐私工程师的工作，不是 plan 一个 PR 解决的事。
4. **顺序问题**：3.1 落地后才有"可信指标"可上传；现在做 3.4 等于"上传未验证质量的 telemetry"，风险更大。
5. **Wait and see 不损失**：用户真有"为什么不能社区共享 skill"诉求时再立项也来得及。如果一直没人问 → 这个能力本来就不该做。

**选错的代价**：
- 选 C：4-6w 直接投入 + ~1-2w 法务/合规（不可压缩）。最坏情况上线后**真的发生隐私事故**，后果不可逆。
- 选 B：0 直接成本但占用决策注意力（plan 上有这一项就会反复被追问）。

**下游影响**：选 A → 在 plan 第 5 节加显式"P4 永废原则维持，本能力非战略目标"声明。如果未来真要做，先单独立项不在 Tier 3 自动推进。

---

### D6 — 自动回滚阈值：保守 / 激进 / 自定义

**现状**
- A-B 检验完成后要决策 promote / rollback / inconclusive
- 阈值组合：success rate 退化幅度 + p 值
- 小样本（N=30）下统计 power 有限

**选项对比（以 success rate 检验为例）**

| | A. 保守 | B. 激进 |
|---|---|---|
| 触发条件 | 退化 ≥ 10% **且** p < 0.05 | 退化 ≥ 5% **且** p < 0.10 |
| 数学解释 | 只在"高置信 + 大幅退化"时回滚 | "中置信 + 中等退化"即回滚 |
| 误回滚率（FP） | 低（~5%）| 中（~10-15%）|
| 漏检率（FN） | 中（5-10% 退化看作 inconclusive） | 低 |
| 用户体感 | 「Evolver 改完 skill 一般不被回滚」 | 「Evolver 改完 skill 经常被回滚」 |
| 信任度建立 | 慢但稳 | 快但容易失稳 |

**N=30 样本下的真实 power 估算**
- 假设 A 的 success rate 0.80
- 检测 5% 差异（B = 0.75）：power ≈ 0.30（70% 概率漏报）
- 检测 10% 差异（B = 0.70）：power ≈ 0.65（35% 概率漏报）
- 检测 15% 差异（B = 0.65）：power ≈ 0.85

**结论**：N=30 下 5% 差异基本检测不到（power<0.5），**激进阈值（5%）实际触发的多是 false positive**。

**推荐：A 保守**

**理由**：
1. **小样本下激进阈值 = 高 FP**：5% 差异在 N=30 上几乎不可能 p<0.10 真实成立；如果硬触发，绝大多数是噪声。
2. **用户信任成本**：自进化频繁回滚自己改的 skill，用户会失去对 evolver 的信任（"它到底是不是乱改"）。
3. **EvoClaw 已有 inline review 兜底**：用户真不满某 skill 会触发 inline review，那是更准确的"人类判断退化"信号。激进自动回滚是冗余防线。
4. **保守不代表躺平**：duration ratio ≥ 1.5（B 慢 50%+）也算退化条件 plan 已写，是另一道防线。

**选 B 的代价**：用户在 1-2 个月内会看到大约 10-15% 的 evolution 被自动回滚 → 对 evolver 失去信心 → 关闭功能 → 整个 Tier 3 投入打水漂。

**下游影响**：阈值是 `SkillEvolverConfig` 字段，IT admin 仍可改成激进；但默认值要保守。

---

### D7 — PR 节奏：按部就班 / 合并大 PR / 留观察期

**现状**
- 3.1 拆 PR-T3-1a (1.5w) + 1b (1w) + 1c (0.5w) = 3 PR
- 3.2 单 PR 0.5w（共享 1a 桶位逻辑）
- 3.3 独立 PR 1.5-2w

**选项对比**

| | A. 按部就班 3 PR | B. 单大 PR | C. 留观察期（1a 后停） |
|---|---|---|---|
| Review 复杂度 | 每 PR ~600 行可消化 | ~1500-2000 行难 review | A 同 |
| 部署风险 | 每 PR 独立 revert | 大 PR rollback 影响范围大 | A 同 |
| 思维连贯 | 中（中间断档）| 高 | 中 |
| 实地数据反馈 | 中（1a 落地后可调）| 0（提交时不能改） | **高** |
| 用户体验 | 渐进式（1a 后桶位先到位再决策）| 一次性全功能 | 渐进式 |
| 总工时 | 标准 | ~10% 节省（无 PR ceremony 开销）| 比 A 多 1-2d 观察期 |

**推荐：C 变体 — 按部就班 + 1a 后留 1-2d 观察期再写 1b**

**理由**：
1. **A 是默认稳健路径**：每 PR 独立 review/revert，符合项目当前节奏（Tier 1+2 都是这样跑的）。
2. **C 增加的 1-2d 观察期价值高**：1a 落地后看真实 telemetry 数据 — 桶位分布是否健康（hash 偏差实际多大）、A-B 期内调用是否够用（30 样本要多久才能填满）、cache 物化是否有问题。这些数据用来调优 1b 的统计检验阈值。
3. **B 不可取**：~1500-2000 行单 PR 难 review，本身就违背项目节奏。
4. **不冒险一次性 ship**：1c 前端可视化依赖 1b 的决策结果数据；如果 1b 阈值要改，1c 也要改，不如分开。

**实操**：
- PR-T3-1a 合入后 → 让 dev 环境跑 1-2 天，每天用 mock 数据 + curl 触发几次 evolver 查 telemetry
- 用真实 telemetry 调 1b 中的两个数字：
  - `min_calls_per_variant`（30 是默认；真实数据可能 20 就够 / 50 才稳）
  - duration_ratio 阈值（1.5 是默认；可能 2.0 更合理避免误报）
- 1b 起 PR

**选错的代价**：
- 选 B：高风险大 PR，最坏情况某子模块 bug 导致整个 PR 被 revert，回到起点。
- 选 A 标准版（无观察期）：1b 阈值是猜的，可能 1c 落地后才发现要回头改 1b（多花 1-2 PR）。

**下游影响**：选 C → PR-T3-1a 完成 → dev 环境 mock 数据 1-2d → PR-T3-1b 起；不影响时间线大局，但**质量更高**。

---

### 决策点 default 一览（如果你没异议直接走默认）

| | 默认 | 一句话理由 |
|---|---|---|
| D1 | 直接 PR-T3-1a | plan 已细到代码级，调研边际收益低 |
| D2 | hash 确定性 | 桌面单用户 + 同 session 稳定 |
| D3 | Mann-Whitney U | 数据特性匹配 + N=30 可用 |
| D4 | 静态解析 | 治理用途足够 + 冷启动可用 |
| D5 | 本期跳过 3.4 | ROI + 隐私 + P4 一致性 |
| D6 | 保守阈值（10%/p<0.05）| N=30 下激进 = 高 FP |
| D7 | A + 1a 后 1-2d 观察期 | 稳健 + 用真数据调 1b |

回复方式：要么"全部按默认"一句话，要么逐项指出你想改哪几个 D + 理由，我再起 PR-T3-1a 实施。

---

## 9. Verification（plan 自身验证）

完成本 plan 写作后必须确认：
- [x] 所有 4 项 Tier 3 子任务都有 Before/After/机制 + 估时 + 风险
- [x] 数据模型给出完整 SQL（migration 040/041/042）
- [x] 关键决策点（D1-D7）显式列出供用户拍板
- [x] 排序理由 + 阶段拆分
- [x] 与现有设计文档的关系
- [x] 投入估算到工作日级别
- [x] 前端影响每子任务都显式评估（即使"无"也说出来）
- [x] 日志埋点要求（3.1 详细，3.2-3.4 简化）
- [x] 风险 + 缓解
- [x] 不在本 plan 范围（明确边界）

合入 main 后，每个 Tier 3 PR 落地时回到本文档更新对应子节状态（设计/实施中/已完成/推迟）。
