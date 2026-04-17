# EvoClaw Skill 自进化系统设计

> **版本**: v1.0 Draft
> **日期**: 2026-04-17
> **前置研究**: [`skill-evolution-comparison.md`](../evoclaw-vs-hermes-research/skill-evolution-comparison.md)
> **关联章节**: 12-skills-system-gap / 34-rebuild-roadmap-gap

---

## 1. 目标与原则

### 1.1 目标

让 EvoClaw 的 Agent 能够**从实际使用中自动学习并改进技能**，实现：
- Agent 自主创建可复用的技能（记忆化）
- 基于使用数据评估技能有效性（评估反馈）
- 定期自动改进低效技能（自动进化）
- 跨用户/Agent 的技能改进共享（集体进化，长期）

### 1.2 设计原则

1. **渐进式**：4 个 Phase 独立交付，每个 Phase 自身有价值
2. **复用优先**：最大化利用 EvoClaw 已有基础设施（记忆/调度/安全/Hub）
3. **企业安全**：Agent 创建的技能必须受 NameSecurityPolicy 管控 + 威胁扫描
4. **数据隐私**：集体进化阶段（Phase 4）的轨迹上传必须 PII 脱敏
5. **保守编辑**：进化修改仅针对有证据的缺陷，不做投机性重构
6. **用户至上**：用户手动修改的技能不被自动进化覆盖

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    EvoClaw Skill Evolution                    │
├──────────┬──────────┬──────────┬────────────────────────────┤
│ Phase 1  │ Phase 2  │ Phase 3  │ Phase 4                    │
│ 记忆化   │ 评估反馈 │ 自动进化 │ 集体进化                   │
│          │          │          │                            │
│ Agent    │ Skill    │ Agentic  │ ClawHub                    │
│ 自主     │ 使用     │ Evolver  │ 反馈                       │
│ create/  │ 追踪 +   │ Cron     │ 回传 +                     │
│ edit/    │ 反馈     │ 定时     │ 匿名                       │
│ patch    │ 收集     │ 进化     │ 聚合                       │
│          │          │          │                            │
│ ~1 人周  │ ~2 人周  │ ~3 人周  │ 长期                       │
└──────────┴──────────┴──────────┴────────────────────────────┘
                         │
                    复用基础设施
                         │
    ┌────────────────────┼────────────────────┐
    │                    │                    │
┌───┴───┐  ┌─────────┐  │  ┌──────────┐  ┌──┴──────┐
│skill- │  │memory-  │  │  │session-  │  │cron-    │
│parser │  │feedback-│  │  │summariz- │  │runner + │
│+ gate │  │store    │  │  │er        │  │heartbeat│
│+ tool │  │         │  │  │          │  │manager  │
└───────┘  └─────────┘  │  └──────────┘  └─────────┘
                        │
                   ┌────┴────┐
                   │ClawHub  │
                   │API +    │
                   │NameSec  │
                   │Policy   │
                   └─────────┘
```

---

## 3. Phase 1: 基础记忆化（~1 人周）

**目标**: Agent 能在运行时自主创建和改进 Skill，对齐 Hermes `skill_manage` 工具。

### 3.1 新增工具: `skill_manage`

在 Kernel 的 5 阶段工具注入中的"EvoClaw-specific"阶段注册：

```typescript
// packages/core/src/skill/skill-manage-tool.ts（新建）

interface SkillManageInput {
  action: 'create' | 'edit' | 'patch' | 'delete';
  name: string;
  category?: string;           // bundled 分类目录
  content?: string;            // SKILL.md 全文（create/edit）
  patch_old?: string;          // patch 模式: 被替换文本
  patch_new?: string;          // patch 模式: 替换文本
}

interface SkillManageOutput {
  success: boolean;
  path: string;                // 写入路径
  action: string;
  scan_result?: 'clean' | 'warning' | 'blocked';
}
```

**操作语义**:

| action | 行为 | 安全检查 |
|--------|------|----------|
| create | 创建 `~/.evoclaw/skills/<category>/<name>/SKILL.md` | 内容安全扫描 + NameSecurityPolicy |
| edit | 全量覆写（先备份为 `.bak`）| 同上 |
| patch | fuzzy match 局部替换 | 同上 |
| delete | 删除目录（需 Agent 先确认）| 仅检查 NameSecurityPolicy |

### 3.2 触发条件嵌入系统 prompt

在 `embedded-runner-prompt.ts` 的 `buildSystemPromptBlocks()` 中新增 skill_manage 工具使用指导段：

```markdown
## Skill 记忆化

你有能力通过 `skill_manage` 工具创建和改进可复用技能。

**创建时机**（满足任一即可）:
- 当前任务成功且使用了 5+ 次工具调用
- 通过试错克服了错误，发现了有效方案
- 用户纠正了你的做法，且新方案值得记住
- 发现了一个非平凡的可复用工作流
- 用户明确说"记住这个方法"/"remember this"

**改进时机**:
- 你使用了某个技能但遇到了技能未覆盖的问题 → patch 补充
- 技能的步骤有误或已过时 → edit 更新
- 发现技能缺少平台特定处理 → patch 追加

**不要**:
- 为平凡操作创建技能（如"搜索文件"）
- 重复创建已有技能覆盖的内容
- 修改 bundled 技能（除非用户明确要求）
```

### 3.3 Manifest v2 用户修改保护

**文件**: `packages/core/src/skill/skill-manifest.ts`（新建）

```typescript
// .evoclaw/skills/.bundled_manifest 格式:
// <category>/<name>:<sha256_hash>
// 如: "research/arxiv:a3f2b1c4d5e6f7g8"

interface ManifestEntry {
  path: string;        // 相对路径
  hash: string;        // SHA-256 of SKILL.md content
}

function syncBundledSkills(bundledDir: string, userDir: string): SyncResult {
  // 1. 读取 manifest
  // 2. 对每个 bundled skill:
  //    - NEW: 复制 + 记录 hash
  //    - EXISTING 未改: 更新到最新 bundled 版本
  //    - EXISTING 已改: 跳过（保留用户/Agent 的改进）
  //    - DELETED: 保留 manifest 记录（尊重删除决定）
  // 3. 写回 manifest
}
```

### 3.4 安全扫描

复用并扩展 `skill-gate.ts` 的评估逻辑：

- Agent 创建的 skill 必须通过 `evaluateAccess()` 检查（NameSecurityPolicy）
- 新增内容扫描：检查 SKILL.md 中是否包含可疑的 shell 命令、外部 URL、凭据引用
- 扫描失败 → 回滚（删除新建文件 / 恢复 `.bak` 备份）

### 3.5 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/core/src/skill/skill-manage-tool.ts` | 新建 | 工具实现 |
| `packages/core/src/skill/skill-manifest.ts` | 新建 | Manifest v2 |
| `packages/core/src/skill/skill-content-scanner.ts` | 新建 | 内容安全扫描 |
| `packages/core/src/kernel/tools/evoclaw-tools.ts` | 修改 | 注册 skill_manage |
| `packages/core/src/agent/embedded-runner-prompt.ts` | 修改 | 添加记忆化指导段 |
| `packages/core/src/skill/skill-gate.ts` | 修改 | 扩展评估逻辑 |

---

## 4. Phase 2: 评估与反馈（~2 人周）

**目标**: 追踪 Skill 使用效果，为后续自动进化提供数据基础。

### 4.1 Skill 使用追踪

新增 `skill_usage` 表：

```sql
-- packages/core/src/infrastructure/db/migrations/0XX_skill_usage.sql
CREATE TABLE IF NOT EXISTS skill_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  invoked_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 执行结果
  tool_calls_count INTEGER DEFAULT 0,    -- 技能指导下的工具调用次数
  success INTEGER DEFAULT 1,             -- 1=成功 0=失败（Agent 自判或用户反馈）
  duration_ms INTEGER,                   -- 执行耗时
  -- 上下文
  trigger_type TEXT,                     -- 'user_invoke' | 'auto_match' | 'heartbeat'
  error_summary TEXT,                    -- 失败时的错误摘要
  -- 反馈
  user_feedback INTEGER,                 -- NULL=无 1=正面 -1=负面
  feedback_note TEXT
);

CREATE INDEX idx_skill_usage_name ON skill_usage(skill_name);
CREATE INDEX idx_skill_usage_agent ON skill_usage(agent_id);
```

### 4.2 使用数据收集

在 `skill-tool.ts` 的 `invoke_skill` 执行流程中埋点：

```typescript
// invoke_skill 调用前: 记录 start_time, skill_name, session_key
// invoke_skill 调用后: 记录 tool_calls_count, success, duration
// 会话结束时: 检查是否有用户 feedback（来自 memory_feedback 表）
```

### 4.3 轨迹摘要生成

复用 `session-summarizer.ts`，在会话结束时为每个使用过的 skill 生成 8-15 句摘要：

```typescript
interface SkillUsageSummary {
  skillName: string;
  sessionKey: string;
  summary: string;            // LLM 生成的 8-15 句摘要
  toolCallsUsed: string[];    // 使用了哪些工具
  errorsEncountered: string[];
  userFeedback: 'positive' | 'negative' | 'none';
  prmScore?: number;          // 预留 PRM 评分（Phase 3 使用）
}
```

### 4.4 反馈 UI 扩展

前端 Sprint 15.12 已实现 memory 反馈 UI（编辑/反馈/新鲜度/4 Tab），扩展一个"Skill 效果"Tab：

- 显示最近使用的 skill 列表 + 成功率 + 使用次数
- 每个 skill 右侧有 👍/👎 快捷反馈按钮
- 点击 skill 名称展开详细使用记录

### 4.5 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `migrations/0XX_skill_usage.sql` | 新建 | 使用追踪表 |
| `packages/core/src/skill/skill-usage-store.ts` | 新建 | 存取逻辑 |
| `packages/core/src/skill/skill-tool.ts` | 修改 | 埋点 |
| `packages/core/src/memory/session-summarizer.ts` | 修改 | 扩展 skill 摘要 |
| `packages/core/src/routes/skill.ts` | 修改 | 新增 usage API |
| 前端 skill 效果 Tab | 新建 | 反馈 UI |

---

## 5. Phase 3: 自动进化（~3 人周）

**目标**: 实现 SkillClaw 式的定期自动进化，利用 Cron 调度器触发 Agentic Evolver。

### 5.1 Agentic Evolver 架构

```
┌─────────────────────────────────────┐
│       Cron Job: skill_evolve        │
│       (每 24h 或可配置周期)          │
├─────────────────────────────────────┤
│                                     │
│  1. 查询 skill_usage 表             │
│     → 按 skill_name 分组            │
│     → 筛选有足够证据的 skill         │
│       (≥ 5 次使用 或 ≥ 1 次负反馈)  │
│                                     │
│  2. 为每个 skill 聚合证据           │
│     → 拉取 skill_usage 记录         │
│     → 拉取 SkillUsageSummary 摘要   │
│     → 拉取 memory_feedback 反馈      │
│     → 截断为 ~2000 token 上下文      │
│                                     │
│  3. 调用 LLM (辅助模型) 分析        │
│     → 系统 prompt: Evolver 指令     │
│     → 用户 message: 证据 + 当前技能  │
│     → 输出: Refine/Create/Skip      │
│                                     │
│  4. 执行决策                        │
│     → Refine: patch SKILL.md        │
│     → Create: 新建 SKILL.md         │
│     → Skip: 仅记录日志              │
│                                     │
│  5. 安全检查 + 版本记录             │
│     → skill-content-scanner 扫描    │
│     → 更新 manifest hash            │
│     → 记录进化日志                   │
│                                     │
└─────────────────────────────────────┘
```

### 5.2 Evolver System Prompt

```markdown
你是 EvoClaw Skill Evolver。你的任务是分析技能的实际使用数据，决定是否以及如何改进该技能。

## 输入

你会收到：
1. 当前技能定义（SKILL.md 全文）
2. 最近 N 次使用的摘要（含成功/失败/工具调用/用户反馈）
3. 统计数据（使用次数/成功率/平均耗时）

## 决策框架

输出 JSON:
```json
{
  "decision": "refine" | "create" | "skip",
  "reasoning": "分析依据（2-3 句）",
  "changes": {
    // refine 时: patch 列表
    "patches": [{"old": "...", "new": "..."}],
    // create 时: 新 skill 的 SKILL.md 内容
    "new_skill": "..."
  }
}
```

## 决策标准

- **Refine**: 成功率 < 80% 且有明确的失败模式，或用户反馈负面且指出具体问题
- **Create**: 发现多次使用中的重复子流程，且现有技能未覆盖
- **Skip**: 成功率 ≥ 80% 且无负面反馈，或证据不足以判断

## 保守编辑原则

- 仅修改有证据支持的缺陷部分
- 保留技能的整体结构和可读性
- 不做投机性优化
- 如果不确定，选择 Skip
```

### 5.3 Cron 注册

```typescript
// packages/core/src/scheduler/skill-evolver-cron.ts（新建）

export function registerSkillEvolverCron(scheduler: CronRunner): void {
  scheduler.register({
    name: 'skill_evolve',
    schedule: '0 3 * * *',       // 每天凌晨 3 点
    actionType: 'internal',       // 不注入主会话，独立运行
    handler: async (ctx) => {
      const candidates = await getEvolutionCandidates(ctx.db);
      for (const skill of candidates) {
        const evidence = await gatherEvidence(skill, ctx.db);
        const decision = await callEvolver(evidence, ctx.modelRouter);
        await executeDecision(decision, skill, ctx);
      }
    },
  });
}
```

### 5.4 进化日志

新增 `skill_evolution_log` 表：

```sql
CREATE TABLE IF NOT EXISTS skill_evolution_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name TEXT NOT NULL,
  evolved_at TEXT NOT NULL DEFAULT (datetime('now')),
  decision TEXT NOT NULL,           -- 'refine' | 'create' | 'skip'
  reasoning TEXT,
  evidence_count INTEGER,           -- 输入的使用记录数
  patches_applied TEXT,             -- JSON: [{old, new}]
  previous_hash TEXT,               -- 改前 SHA-256
  new_hash TEXT,                    -- 改后 SHA-256
  model_used TEXT                   -- 执行进化的模型
);
```

### 5.5 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/core/src/scheduler/skill-evolver-cron.ts` | 新建 | 进化 Cron |
| `packages/core/src/skill/skill-evolver.ts` | 新建 | Evolver 核心逻辑 |
| `packages/core/src/skill/skill-evidence-gatherer.ts` | 新建 | 证据聚合 |
| `migrations/0XX_skill_evolution_log.sql` | 新建 | 进化日志表 |
| `packages/core/src/scheduler/cron-runner.ts` | 修改 | 注册 skill_evolve |

---

## 6. Phase 4: 集体进化（长期）

**目标**: 通过 ClawHub 实现跨用户的技能改进共享。

### 6.1 匿名轨迹上报

```typescript
// 用户 opt-in 后，定期上报匿名化的 skill 使用数据
interface AnonymousSkillReport {
  skillName: string;
  skillVersion: string;
  usageCount: number;
  successRate: number;
  anonymizedSummaries: string[];   // PII 脱敏后的摘要
  patches?: SkillPatch[];          // 本地进化产生的改进
}
```

**隐私保障**:
- 默认 opt-out，需用户在设置中显式开启
- 上报前经 `sanitizePII()` 脱敏（复用现有管线）
- 不上报 session_key / agent_id / 用户标识
- ClawHub 服务端聚合后丢弃原始数据

### 6.2 ClawHub API 扩展

现有 API: `/api/v1/search`（向量搜索）+ `/api/v1/download`（ZIP 下载）

新增:
- `POST /api/v1/skills/{name}/feedback` — 上报匿名使用数据
- `GET /api/v1/skills/{name}/evolution` — 获取社区聚合的改进建议
- `GET /api/v1/skills/trending` — 热门/高效技能排行

### 6.3 社区进化同步

```
用户 A 改进 skill → 上报 ClawHub → ClawHub 聚合多用户改进
                                        ↓
用户 B 同步时 ← ClawHub 推荐社区改进 ← 达到阈值（≥3 个独立源确认）
```

---

## 7. 与现有系统的集成点

| 已有模块 | 路径 | 复用方式 |
|----------|------|----------|
| `skill-parser.ts` | `packages/core/src/skill/skill-parser.ts` | 解析 SKILL.md frontmatter |
| `skill-gate.ts` | `packages/core/src/skill/skill-gate.ts` | 门控评估 + NameSecurityPolicy |
| `skill-tool.ts` | `packages/core/src/skill/skill-tool.ts` | invoke_skill 埋点 |
| `mcp-prompt-bridge.ts` | `packages/core/src/mcp/mcp-prompt-bridge.ts` | MCP prompt 转 skill |
| `session-summarizer.ts` | `packages/core/src/memory/session-summarizer.ts` | 轨迹摘要生成 |
| `memory-feedback-store.ts` | `packages/core/src/memory/memory-feedback-store.ts` | 反馈数据存取 |
| `cron-runner.ts` | `packages/core/src/scheduler/cron-runner.ts` | 定时触发进化 |
| `heartbeat-manager.ts` | `packages/core/src/scheduler/heartbeat-manager.ts` | 共享会话上下文 |
| `extension-security.ts` | `packages/core/src/security/extension-security.ts` | NameSecurityPolicy 评估 |
| `pii-sanitizer.ts` | `packages/core/src/infrastructure/pii-sanitizer.ts` | 上报前 PII 脱敏 |
| ClawHub API | `clawhub.ai/api/v1/*` | 技能搜索/下载/反馈 |
| ModelRouter | `packages/core/src/provider/model-router.ts` | Evolver 使用辅助模型 |

---

## 8. 风险与约束

| 风险 | 缓解措施 |
|------|----------|
| Agent 创建低质量/危险技能 | 内容安全扫描 + NameSecurityPolicy + 用户确认 |
| 自动进化导致技能退化 | 保守编辑原则 + 改前备份 + 进化日志可回滚 |
| LLM Evolver 幻觉 | 结构化 JSON 输出 + 严格 schema 校验 + 变更 diff 审计 |
| 隐私数据泄露（Phase 4） | 默认 opt-out + PII 脱敏 + 服务端聚合后丢弃原始数据 |
| 进化 Cron 成本（LLM 调用） | 使用辅助低成本模型 + 每次仅处理有证据的候选 |
| 多 Agent 并发修改同一 skill | 文件级锁（`lockfile` 或 SQLite 事务）+ 先读后写 |
| Manifest v2 hash 冲突 | SHA-256 冲突概率可忽略 |

---

## 9. 实施时间线

| Sprint | Phase | 交付 | 预估 |
|--------|-------|------|------|
| Sprint 20 | Phase 1 | skill_manage 工具 + Manifest v2 + 安全扫描 | 1 人周 |
| Sprint 21-22 | Phase 2 | skill_usage 表 + 使用追踪 + 轨迹摘要 + 反馈 UI | 2 人周 |
| Sprint 23-25 | Phase 3 | Agentic Evolver + Cron + 进化日志 + 保守编辑 | 3 人周 |
| Sprint 30+ | Phase 4 | ClawHub 反馈 API + 匿名上报 + 社区同步 | 长期 |

**依赖关系**: Phase 1 → Phase 2 → Phase 3（严格串行），Phase 4 可在 Phase 2 之后并行启动 API 设计。

---

## 附录: 与 SkillClaw / Hermes 的对齐表

| SkillClaw 机制 | EvoClaw 对应 Phase | 实现差异 |
|----------------|-------------------|----------|
| 白天收集轨迹 | Phase 2 skill_usage 表 | EvoClaw 实时写入 vs SkillClaw 批量写入 |
| 晚上批量进化 | Phase 3 Cron job | EvoClaw 用 cron-runner.ts vs SkillClaw 独立脚本 |
| PRM/ORM 评分 | Phase 2 success 字段 + user_feedback | EvoClaw 简化为二值 vs SkillClaw 连续分数 |
| Refine/Create/Skip | Phase 3 Evolver | 相同三元决策框架 |
| 保守编辑 | Phase 3 patch 操作 | 相同原则 |
| 跨用户同步 | Phase 4 ClawHub | EvoClaw 走 ClawHub API vs SkillClaw 中央仓库 |

| Hermes 机制 | EvoClaw 对应 Phase | 实现差异 |
|-------------|-------------------|----------|
| skill_manage 工具 | Phase 1 | 相同 6 操作（create/edit/patch/delete/write_file/remove_file）|
| 系统 prompt 触发条件 | Phase 1 | 相同嵌入方式 |
| Manifest v2 | Phase 1 | 相同 hash 比对 + 用户修改保护 |
| skills_guard 安全扫描 | Phase 1 | EvoClaw 扩展 skill-gate.ts + NameSecurityPolicy |
| 信任分级 | Phase 1 | EvoClaw 用 NameSecurityPolicy 替代 4 级信任 |
| fuzzy patch | Phase 1 | 相同模糊匹配局部修改 |
