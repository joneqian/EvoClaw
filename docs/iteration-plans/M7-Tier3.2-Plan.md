# M7-Tier3 PR-T3-2 — Dry-run / Canary 实施 Plan（5 工作日）

> 本文档是 Tier 3.2 的代码级 plan。原 `M7-Tier3-Plan.md §3.2` 是 sketch，本文展开到迁移、模块、REST、UI、测试。
>
> **状态**：2026-05-09 通过用户确认，按默认 D 决策启动 PR-T3-2a。

## 0. 总览

### 估时与 PR 拆分

| PR | 分支 | 范围 | 工作日 | 依赖 |
|---|---|---|---|---|
| **PR-T3-2a** | `feat/m7-tier3-evolver-dryrun` | dryRun 模式 + apply/reject REST + UI 待审核流 | 3 d | 无 |
| **PR-T3-2b** | `feat/m7-tier3-evolver-canary` | canary 模式 + 桶位比例覆盖 + UI 配置 | 2 d | PR-T3-2a 合入（共享 `mode` 字段 + UI 框架） |

### 依赖关系

- **依赖 3.1（已完成）**：canary 复用 `skill_ab_test` 表 + `assignBucket()` + .ab-cache 物化。
- **数据模型新增**：migration `042_skill_evolver_pending.sql`（PR-T3-2a）+ migration `043_skill_ab_test_canary.sql`（PR-T3-2b）。
- **schema 改动**：`skillEvolverSchema` 增 `mode` 字段（PR-T3-2a）+ `canaryRatioB` 字段（PR-T3-2b）。

### 关键文件清单

| 路径 | PR-T3-2a | PR-T3-2b |
|---|---|---|
| `migrations/042_skill_evolver_pending.sql` | 新增 | — |
| `migrations/043_skill_ab_test_canary.sql` | — | 新增 |
| `packages/shared/src/schemas/security.schema.ts` | 加 `mode` | 加 `canaryRatioB` |
| `packages/core/src/skill/skill-evolver.ts` | mode 分支：apply / dryRun | mode 分支扩 canary |
| `packages/core/src/skill/skill-ab-store.ts` | — | `assignBucket` 接受 ratioB |
| `packages/core/src/routes/skill-evolution.ts` | 加 `/log/:id/apply` `/log/:id/reject` | — |
| `apps/desktop/src/components/EvolutionLogPanel.tsx` | 待审核徽章 + 应用/拒绝按钮 + 待审核过滤 | canary 进度子标识 |
| `apps/desktop/src/pages/SettingsPage.tsx` | mode 单选 (apply/dryRun) | mode 加 canary + canaryRatioB 输入 |

---

## 1. PR-T3-2a — dryRun 模式（3 工作日）

### 1.1 Before / After / 机制

**Before**：Evolver LLM 决策后立即调 `executeRefine` / `executeCreate` 直接写 SKILL.md。错了只能事后 `/log/:id/rollback`，但**主对话已被污染**。

**After**：
- `mode='dryRun'` 时：LLM 决策正常发生，evolution_log 正常写入（含 previous/new content），**不调** `editSkillInternal`，log 行新增 `pending_approval=1` 标记。
- 用户在 EvolutionLogPanel 看到「待审核」徽章 + 「应用」/「拒绝」按钮。

**机制**：所有变更都在 evolver 入口分支。`runEvolverDecision` 改为按 mode 分流。

### 1.2 数据模型 — Migration 042

```sql
ALTER TABLE skill_evolution_log ADD COLUMN pending_approval INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skill_evolution_log ADD COLUMN approval_decided_at TEXT;
ALTER TABLE skill_evolution_log ADD COLUMN approval_decided_by TEXT;  -- 'manual-apply' | 'manual-reject'

CREATE INDEX IF NOT EXISTS idx_skill_evolution_log_pending
  ON skill_evolution_log(pending_approval) WHERE pending_approval = 1;
```

### 1.3 Schema

```typescript
mode: z.enum(['apply', 'dryRun']).default('apply'),  // PR-T3-2b 扩 'canary'
```

### 1.4 后端实施（要点）

- `skill-evolver.ts`：mode='dryRun' + decision='refine'/'create' → 跳过 executeRefine/executeCreate，仅 logEvolutionDecision({ pendingApproval: true }) + 不启动 A-B。
- `routes/skill-evolution.ts`：
  - `POST /log/:id/apply` → 校验 pending → editSkillInternal(new_content) → mark pending=0 + decided_by='manual-apply'
  - `POST /log/:id/reject` → 校验 pending → mark pending=0 + rolled_back=1 + decided_by='manual-reject'
  - 应用前 hash 防覆盖检查（D2.2）：磁盘当前 hash != previous_hash 时 409 + 提示用户先决策旧版本。

### 1.5 前端

- EvolutionLogPanel：pendingApproval 徽章 + 应用/拒绝按钮 + 列表过滤 chip
- SettingsPage：Evolver 子区加「执行模式」单选（apply/dryRun）+ dryRun 时 disable abTestEnabled

### 1.6 测试

- mode='dryRun' SKILL.md mtime 不变 + log pending=1
- mode='dryRun' + abTestEnabled=true → A-B 跳过
- /apply happy + /apply 磁盘 hash 已变 409 + /reject + 已决议再 apply 400

---

## 2. PR-T3-2b — canary 模式（2 工作日）

### 2.1 Before / After / 机制

**After**：mode='canary' 时正常写 SKILL.md + 启动 A-B，但桶位比例改 90/10（默认）。

### 2.2 数据模型 — Migration 043

```sql
ALTER TABLE skill_ab_test ADD COLUMN is_canary INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skill_ab_test ADD COLUMN canary_ratio_b REAL;
```

### 2.3 Schema

```typescript
mode: z.enum(['apply', 'dryRun', 'canary']).default('apply'),
canaryRatioB: z.number().min(0.05).max(0.5).default(0.1),
```

### 2.4 桶位算法

`assignBucket(_, _, _, ratioB?)` 当 ratioB 给值时取 SHA-1 前 4 字节 mod 1000，落 `[0, ratioB*1000)` 为 B。

### 2.5 测试

- 10000 次模拟桶位分布在 [ratioB-2%, ratioB+2%]
- 不传 ratioB 退化到 50/50

---

## 3. 决策点（D 系列）

| 编号 | 议题 | 默认 |
|---|---|---|
| D2.1 | dryRun 与 A-B 是否完全互斥 | 是 |
| D2.2 | apply 是否需要 hash 防覆盖 | 是 |
| D2.3 | canary 默认比例 | 10% |
| D2.4 | canary min_calls_per_variant 是否调小 | 不动（30） |
| D2.5 | dryRun pending 超期清理 | 不做 |
| D2.6 | 拆分节奏 | PR-T3-2a 合入后留 1d 观察期再起 PR-T3-2b |

---

## 4. 风险

| 风险 | 缓解 |
|---|---|
| dryRun 累积 pending 用户忘审 | UI 显眼徽章 + 数量计数 |
| dryRun 期间手改 SKILL.md → apply 覆盖 | 应用前 hash 防覆盖检查（409） |
| canary B 桶 10% 太低样本不足 | UI 估算样本时间 + max_test_days 兜底 |
| canary hash 偏置 | 单测 10000 次模拟分布 |
| evolverMode 升级配置兼容 | schema `mode` default='apply` |

---

## 5. 不在本 PR 范围

- ❌ canary progressive delivery（10%→30%→100%）
- ❌ dryRun 期 SKILL.md 三方 merge
- ❌ A-B promote 决策在 dryRun 模式产生 pending log（dryRun 不启动 A-B）
- ❌ canary 时间衰减比例
