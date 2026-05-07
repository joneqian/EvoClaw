# M7 Curator — Skill 生命周期治理子系统

> **状态**：设计文档 / 待用户拍板关键决策点 / 不要立即开发
> **冲刺范围**：~3-5d，单 PR 内多 commit 拆分
> **来源**：plan #115 通过后接续。research/`/Users/mac/.claude/plans/...` 第三档（Curator）落地。

---

## 一、Context（为什么做）

P1-B Z + W + maxTurns 收尾后，EvoClaw 的 skill 自进化触发链已完整：

```
信号检测（regex + LLM 兜底） → inline review (单次) → Background Review Sub-Agent (W, 每 N=10 turn)
```

但**生命周期治理缺失**：

- skill 数量随 W 自我创建持续增长 → 慢慢膨胀
- 没有跨 session 视角识别"多个 skill 重复 / 应合并"
- 长期不用的 skill 不会自动淘汰
- 没有 archive / restore 的可恢复机制
- 没有 provenance：W 创建的 skill 跟用户手动创建的 skill 混在一起

**目标**：实现独立的 **Curator** 子系统，独立于 inline / W，跨 session **每 7 天**做一次治理：

1. 状态机：active → stale (30d 未用) → archived (90d 未用)
2. Consolidation：用 LLM 识别多 skill 重叠 → 合并为 umbrella
3. Archive / Prune：归档可恢复，长期不用的批量清理
4. Provenance：只管 agent-created（W 创建的）skill，不动 bundled/clawhub/github/local

---

## 二、关键事实（来自 Hermes origin/main 深挖）

详见 \`research/Hermes-Curator-deep-dive\`（agent 报告，~6000 字）。摘要：

| 维度 | Hermes 实现 |
|---|---|
| 状态机 | active / stale / archived，基于 \`last_activity_at\` 时间戳 |
| 默认阈值 | stale=30d, archive=90d, interval=7d, min_idle=2h |
| 触发模型 | **非 cron daemon**，事件驱动（session idle/startup） |
| 状态存储 | JSON 文件（\`.curator_state\` 调度 + \`.usage.json\` 每 skill） |
| Consolidation | 纯 LLM，用 \`CURATOR_REVIEW_PROMPT\` 引导前缀聚类 + 三档合并方式 |
| 分类优先级 | (1) skill_manage delete 时 \`absorbed_into\` 参数 (2) YAML 结构化 block (3) 工具调用审计 |
| 物理归档 | \`~/.hermes/skills/.archive/<skill>/\` |
| 报告产物 | \`~/.hermes/logs/curator/<ts>/{run.json, REPORT.md}\` |
| CLI 动词 | 11 个（status/run/pause/resume/pin/unpin/archive/restore/prune/backup/rollback） |
| Provenance | \`tools/skill_provenance.py\` ContextVar 区分 background_review vs foreground |

---

## 三、能力提升（Before / After / 机制）

| 维度 | Before | After | 机制 |
|---|---|---|---|
| Skill 数量治理 | 持续增长无上限 | 每 7 天审一次 + 自动归档 | Curator review |
| 重叠 skill | 看不见 | LLM 识别 → 合并为 umbrella | CURATOR_REVIEW_PROMPT |
| 长期不用的 skill | 一直摆着 | 30d→stale, 90d→archived | 状态机 |
| 误删风险 | 无回滚 | archive 可 restore | \`.archive/\` 目录 |
| W vs 用户手动创建 | 混淆，都可能被改 | 仅 agent-created 进 curator 管辖 | provenance marker |
| 治理审计 | 无 | run.json + REPORT.md | logs/curator/ |
| 用户可控 | 无操作入口 | REST + 前端调试页 | curator API |

---

## 四、设计 — EvoClaw 适配方案

### 4.1 数据存储（决定 1：扩 SQLite vs 加 JSON sidecar）

**推荐：扩 SQLite**（跟 EvoClaw 现有架构对齐）

- migration 039：扩 \`skill_manifest\` 表 / 新增 \`skill_lifecycle\` 表
- 字段：state (active/stale/archived) + archived_at + last_activity_at + use_count + view_count + patch_count + pinned
- 优点：跟 \`skill_usage\` / \`skill_evolution_log\` 在同一 DB，查询方便
- 缺点：需 migration

替代：加 JSON sidecar (\`.curator_state\`)，工作量小但跟主架构脱节，**不采用**。

### 4.2 状态机阈值（决定 2：跟 Hermes 还是更激进/保守）

**推荐：跟 Hermes 默认**：
- stale=30d 未用
- archived=90d 未用
- interval=7d
- min_idle=2h

**全部可配置**：\`security.skillCurator.staleDays\` / \`archivedDays\` / \`intervalDays\` 等。

### 4.3 触发模型（决定 3：cron 还是事件驱动）

**推荐：复用现有 SkillEvolverScheduler**（cron-like，每分钟 tick）

- 不引入新调度器
- 每 tick 检查：\`now - last_run_at >= intervalDays\` → 运行 review
- 跟现有 inline / cron evolver 共享 scheduler 配置

替代：事件驱动（session afterTurn 时 lazy check）— Hermes 用这个，但 EvoClaw 已有定时器，重复造轮子无收益。

### 4.4 Consolidation 算法（决定 4：纯 LLM vs 规则混合）

**推荐：纯 LLM**（跟 Hermes 同）

- 候选列表 + CURATOR_REVIEW_PROMPT → LLM 自主决策
- 输出 YAML 结构化 block（consolidations / prunings）
- 工具：\`skill_view\` + \`skill_manage\`（patch / create / delete + \`absorbed_into\` 参数）
- 翻译 Hermes prompt 到中文 + EvoClaw 适配（5 来源限制 + 不写 cron jobs 那块）

替代：规则混合（substring + 字段匹配）— Hermes 已经因 false-positive 改成 field-aware，纯规则不靠谱。

### 4.5 Provenance（决定 5：ContextVar / AsyncLocalStorage / 已有 marker）

**推荐：复用已有 sessionKey marker**

- W 用 \`:background-review:\` marker（已实现 PR #114）
- skill_manage 工具内部检查 marker → 写 manifest 时打 source='agent-created'
- 不引入 AsyncLocalStorage（新依赖）

实施细节：
- 当前 \`skill-manage-tool.ts\` 默认创建标 'agent-created'，但没区分写入来源
- 改造：traceContext 透传 sessionKey 到 skill_manage execute()，根据 marker 决定 source 字段
- 已有的 \`local\`（用户手写）vs \`agent-created\`（W 创建）正好对应 Hermes 的 user vs background_review

### 4.6 CLI vs REST（决定 6：是否做 CLI）

**推荐：纯 REST（不做 CLI）**

- EvoClaw 是桌面 + sidecar 架构，无 CLI 入口（Hermes 是 CLI 应用所以做 CLI）
- REST endpoints：
  - \`GET /curator/status\` — 当前状态 + 各 state 计数
  - \`POST /curator/run\` — 手动触发一次 review（支持 \`?dryRun=true\`）
  - \`POST /curator/pause\` / \`/resume\`
  - \`POST /curator/archive/:name\` — 手动归档
  - \`POST /curator/restore/:name\` — 从 archive 恢复
  - \`POST /curator/prune\` — 批量归档 N 天未用（body: \`{ days: 90, dryRun: true }\`）
- pin / unpin：复用 \`skill_manage\` 现有的 pin 字段（M7 已有），不新增
- backup / rollback：**不做**（archive 已经够用，rollback 复杂）

### 4.7 前端影响（强制评估）

| 模块 | 影响 | 改动 |
|---|---|---|
| 主聊天页 | 无 | — |
| Skill 页 | **可选** | 已有的 skill 列表加 state 列 + archive 按钮，~半天 |
| 进化历史 Tab | 无 | curator 决策走 \`skill_evolution_log\` 已有的 trigger_source='curator'，前端自动显示 |
| 新前端 Tab | **不做** | 留给 M13 #1 前端看板期统一加 |

→ **本期前端零改动**，留 REST 给后续。

### 4.8 报告产物（决定 7：DB vs 文件）

**推荐：DB + 文件双轨**

- DB：每次 run 的关键事件落 \`skill_evolution_log\`，trigger_source='curator-run'
- 文件：可选 \`~/.evoclaw/logs/curator/<ts>/{run.json, REPORT.md}\`（人类可读，方便排障）

替代：只 DB — 可，但人工 grep DB 不方便；只文件 — 跟 evolution_log 一致性差。双轨权衡 OK。

---

## 五、实现拆分（4-5 commit / 1 个 PR）

### commit 1（~0.5d）— migration + 基础类型
- migration 039：\`skill_manifest\` 加 \`state\` / \`archived_at\` / \`last_activity_at\` / \`pinned\` 列
- shared types: \`SkillLifecycleState = 'active' | 'stale' | 'archived'\`
- skill-manifest.ts: \`set_state()\` / \`get_state()\` / \`archive()\` / \`restore()\`
- 单测：state 转换 / 阈值 / pinned 绕过

### commit 2（~1d）— 状态机 + 自动转换
- 新文件 \`skill/skill-curator-state.ts\`：\`applyAutomaticTransitions(now)\`
  - 查 active 但 last_activity_at < now-30d → 标 stale
  - 查 last_activity_at < now-90d → 物理 archive 到 \`~/.evoclaw/skills/.archive/\`
  - reactivation：stale 但 last_activity_at > now-30d → 重 active
  - pinned 全跳过
- 集成到 skill-evolver-scheduler.ts：每 tick 检查 last_run_at；7d 一次跑 curator
- 单测：状态机 happy path / pinned 绕过 / reactivation

### commit 3（~1-1.5d）— Curator LLM Review Sub-Agent
- 新文件 \`skill/skill-curator.ts\`：\`runCuratorReview(opts)\`
- 类似 W 的 sub-agent 模式：复用 runEmbeddedAgent 动态导入
- system prompt：翻译 \`CURATOR_REVIEW_PROMPT\` 中文 + EvoClaw 适配
- sessionKey marker：\`:curator:\`（独立 marker，非 :background-review:）
- 工具集：source-gated skill_manage（仅 agent-created 可改）
- 用户消息：候选列表（agent-created skills 含 state/use_count/last_activity）
- 解析：YAML 结构化 block + 工具调用审计 + absorbed_into 优先级
- 落 skill_evolution_log（trigger_source='curator-consolidation' / 'curator-prune'）
- 单测：YAML 解析 / 三级分类 / hallucinated umbrella 处理

### commit 4（~0.5d）— REST endpoints
- 新文件 \`routes/curator.ts\`：\`createCuratorRoutes()\`
- 6 个 endpoint（GET status / POST run / pause / resume / archive / restore / prune）
- 注册到 \`server.ts\`
- 单测：每 endpoint 4 case 起步

### commit 5（~0.5d）— provenance gate + 集成测试
- skill-manage-tool.ts: 接收 \`originSessionKey\` 选项，根据 marker 决定 source 字段
- e2e 测试：W 创建 skill → 标 agent-created → curator 跑 → 可改；用户 \`local\` 创建 → curator 不动
- runbook 更新（docs/runbooks/）

**总 ~3.5-4d**。

---

## 六、风险与缓解

| 风险 | 缓解 |
|---|---|
| LLM 错误归档活跃 skill | 30d 默认阈值给充足缓冲 + pinned 保护 + dryRun 模式可预演 |
| Consolidation 合并错（umbrella 选错） | YAML hallucination 检测（destinations 集合验证） + 工具调用审计兜底 + dryRun |
| 误归档用户手动 skill | provenance gate：仅 agent-created 进 curator 管辖（双层验证） |
| Archive 占空间 | 物理移动到 \`.archive/\`；用户可手动清理；后续可加 archive_after_days_n 自动真删（本期不做） |
| 7d 间隔太长漏问题 | 提供 \`POST /curator/run\` 手动触发 + dryRun 预演 |
| Cron / Tick 与 inline review / W 冲突 | 三者互不干扰：Curator 跨 session，inline / W 单 session 内 |
| Token 量爆（~50 候选 × ~3K SKILL.md ≈ 150K input） | 按 max_iterations=16 + 候选 cap 30（先按 use_count 排序取 top） |

---

## 七、不做（明确边界）

- ❌ CLI 接口（EvoClaw 桌面 + sidecar，无 CLI 入口）
- ❌ pin/unpin 新增（复用 \`skill_manage\` 现有 pin 字段）
- ❌ backup/rollback（archive 已够，rollback 复杂）
- ❌ 前端新 Tab（留给 M13 #1）
- ❌ Cron job 重写（EvoClaw 没有"靠 skill 名编排的 cron"，无需重写）
- ❌ AsyncLocalStorage 新依赖（复用现有 sessionKey marker）

---

## 八、待用户拍板（关键决策）

3 个关键设计点要你 OK：

### 决策 A：阈值策略
- **A1（推荐）**：跟 Hermes 默认 stale=30d / archive=90d / interval=7d
- A2：更激进 stale=14d / archive=60d / interval=3d
- A3：更保守 stale=60d / archive=180d / interval=14d

### 决策 B：consolidation 实现路径
- **B1（推荐）**：纯 LLM（fork 类似 W 的 sub-agent 用 CURATOR_REVIEW_PROMPT）
- B2：规则混合（先 substring/field-aware 聚类候选 → LLM 决策最终合并）— 工作量 +0.5d

### 决策 C：本期是否做前端 Skill 页"state 列 + archive 按钮"
- **C1（推荐）**：不做，前端零改动，留给 M13 #1
- C2：做，~半天工作量（前端动 \`SkillPage.tsx\` 加状态展示 + 调用新 REST）

---

## 九、Phase 拆分总览（GO 之后）

| Commit | 内容 | 工作量 |
|---|---|---|
| 1 | migration 039 + 类型 + manifest 扩展 | ~0.5d |
| 2 | 状态机 + 自动转换 + scheduler 集成 | ~1d |
| 3 | Curator Review Sub-Agent + 中文 prompt | ~1-1.5d |
| 4 | REST endpoints + 单测 | ~0.5d |
| 5 | Provenance gate + e2e + runbook | ~0.5d |
| **总计** | | **~3.5-4d** |

---

## 十、待用户确认 + 启动 GO

GO 之后流程：commit 1 → 2 → 3 → 4 → 5 → CI → review → 合并。
拍板 A/B/C 三个决策后我开 commit 1。
