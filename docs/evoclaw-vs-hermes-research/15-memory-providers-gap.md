# 15 — Memory Providers 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/15-memory-providers.md`（1064 行，含 9 provider 全覆盖）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`agent/memory_provider.py` 231 行 + `agent/memory_manager.py` 367 行 + 8 个外部 plugin provider
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），`packages/core/src/memory/` 17 文件共 2731 行 + 3 张核心表（memory_units / knowledge_graph / memory_feedback）
> **综合判定**: 🟢 **EvoClaw 显著反超** — 两者设计哲学根本不同：hermes = "轻量文件 + 9 个外部 SaaS 连接器"，EvoClaw = "内置 L0/L1/L2 三层 + FTS5 + 向量 + 知识图谱 + LLM 抽取/精选/整合"完整结构化记忆系统。Hermes 在 provider 插件生态上占优（9 个外部服务适配），EvoClaw 在记忆质量/分类/反馈/检索深度上全面领先。

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes** — `MemoryProvider` ABC（`agent/memory_provider.py:42-231`）定义 **15 个方法**（4 抽象 + 6 行为 + 5 hook + 2 config）的统一 provider 接口。`MemoryManager`（`agent/memory_manager.py:72-367`）是聚合器，不变式为 **最多 1 个 builtin + 1 个 external**。内置 `BuiltinMemoryProvider`（`agent/builtin_memory_provider.py:24-114`）是 **file-backed**（`~/.hermes/memories/MEMORY.md` 2200 字符上限 + `USER.md` 1375 字符上限）+ **冻结快照** + agent-level 工具拦截（`run_agent.py:6090-6110`）。外部 8 个 provider（honcho / mem0 / hindsight / supermemory / byterover / openviking / holographic / retaindb）通过 `plugins/memory/<name>/__init__.py` 注册，各自对接不同 SaaS/本地后端。核心模式：**"外包"记忆给外部服务**，hermes 本地只保留文件快照 + 最多 2700 tokens。

**EvoClaw** — `packages/core/src/memory/` 目录下 17 个 TS 模块共 2731 行（不含 DB 层），自研**完整结构化记忆系统**：9 类记忆（profile/preference/entity/event/case/pattern/tool/skill/correction）× L0/L1/L2 三层存储（`memory_units` 表，`migrations/002_memory_units.sql`）× 三阶段渐进检索（FTS5 + 向量 + 知识图谱，`memory/hybrid-searcher.ts:69-203`）× 热度衰减定时器（`memory/decay-scheduler.ts:41-86`）× 5 个 LLM 写入工具（`tools/evoclaw-tools.ts:144-335`）× memory_feedback 反馈表（`migrations/025_memory_feedback.sql`）× AutoDream 整合（`memory/memory-consolidator.ts`）× 反馈循环防护（零宽空格标记，`memory/text-sanitizer.ts:9-14`）。无 provider 抽象，整个记忆系统是单一内置实现。

**规模对比**: hermes 核心 ABC+Manager 约 600 行 + 8 个 plugin 约 5000-8000 行（其中 honcho 1400+ 行）。EvoClaw 核心 2731 行但全部是**自研结构化记忆引擎**而非外部适配器；hermes 等价自研能力**缺失**（例如 hermes 的 builtin 只有文件追加/替换/删除，没有分类、没有分层、没有向量检索、没有反馈、没有衰减）。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | Provider 抽象层 | 🟡 | hermes 有 15 方法 ABC + 插件化；EvoClaw 无抽象（内置单实现），形态差异 |
| §3.2 | 内置存储形态 | 🟢 | **反超**：EvoClaw L0/L1/L2 三层 + 9 类别 + 三元组 vs hermes MEMORY.md + USER.md 纯文件 |
| §3.3 | 记忆类别体系 | 🟢 | **反超**：EvoClaw 9 类 CHECK 约束 + merge/independent 语义 vs hermes 无分类 |
| §3.4 | 检索后端 | 🟢 | **反超**：EvoClaw FTS5 + Float32Array 向量 + 知识图谱三路并行 vs hermes 文件直读无检索 |
| §3.5 | 三阶段渐进检索 | 🟢 | **反超**：EvoClaw Phase 1 候选 → Phase 2 排序+热度 → Phase 3 L2 按需加载 独有设计 |
| §3.6 | 热度衰减 | 🟢 | **反超**：EvoClaw sigmoid(log1p) × exp 衰减 + 定时器归档 vs hermes 无衰减概念 |
| §3.7 | LLM 写入工具 | 🟢 | **反超**：EvoClaw 5 个结构化工具（write/update/delete/forget_topic/pin）vs hermes 1 个 `memory` 工具 + 4 action |
| §3.8 | 反馈循环防护 | 🟢 | **反超**：EvoClaw 零宽空格标记剥离注入上下文 vs hermes regex `_detect_injection` 拒绝（取向不同） |
| §3.9 | 用户反馈机制 | 🟢 | **反超**：EvoClaw memory_feedback 表 + 3 种标记（inaccurate/sensitive/outdated）vs hermes 无 |
| §3.10 | 知识图谱 | 🟢 | **反超**：EvoClaw knowledge_graph 三元组表 + 实体扩展检索 vs hermes 仅 hindsight provider 有本地 KG |
| §3.11 | LLM 驱动抽取/精选/整合 | 🟢 | **反超**：EvoClaw 三段式 LLM（extract/rerank/consolidate）vs hermes builtin 无抽取，外部 provider 各自闭源实现 |
| §3.12 | 多租户/多 Agent 隔离 | 🟡 | hermes `user_id` 传递到 8 个 provider 各做 multi-tenant；EvoClaw agent_id 列级隔离，无 gateway user_id 路径 |
| §3.13 | 生命周期钩子 | 🟡 | hermes 5 hook（on_turn_start / on_session_end / on_pre_compress / on_memory_write / on_delegation）；EvoClaw 无等价 hook，通过 ContextPlugin 间接实现 |
| §3.14 | 外部 Provider 生态 | 🔴 | **落后**：hermes 8 个外部 provider 插件（honcho/mem0/hindsight/...），EvoClaw 0 个外部 SaaS 对接点 |
| §3.15 | Prefetch / queue_prefetch | 🟡 | hermes 每轮 `prefetch_all` + 下轮 `queue_prefetch` 预热；EvoClaw 同步 `hybridSearch` in ContextPlugin.beforeTurn，无预热 |
| §3.16 | Pre-compression 提取 | 🟢 | **反超**：EvoClaw Memory Flush（`agent/memory-flush.ts`）三层防护 + 工具白名单 + 85% token 触发，vs hermes `on_pre_compress` 被动字符串返回 |

**统计**: 🔴 1 / 🟡 4 / 🟢 11（其中 10 项反超）。综合判定 **🟢 EvoClaw 显著反超**。

---

## 3. 机制逐条深度对比

每条同时给出 **hermes 实现**（带源码行号）+ **EvoClaw 实现**（带源码行号）+ **判定与分析**。

### §3.1 Provider 抽象层

**hermes**（`.research/15-memory-providers.md §3.1, agent/memory_provider.py:42-231`）—— 15 方法 ABC:
```python
class MemoryProvider(ABC):
    # 4 抽象: name / is_available / initialize / get_tool_schemas
    # 6 行为: system_prompt_block / prefetch / queue_prefetch / sync_turn / handle_tool_call / shutdown
    # 5 hook: on_turn_start / on_session_end / on_pre_compress / on_memory_write / on_delegation
    # 2 config: get_config_schema / save_config
```
`MemoryManager._providers` 不变式: `[0]` 永远是 builtin，`[1]` 是唯一 external，`add_provider` 替换规则（`memory_manager.py:L239-257`）保证最多 2 active。

**EvoClaw**（无 provider 抽象）— `packages/core/src/memory/` 目录下 `MemoryStore` / `HybridSearcher` / `MemoryExtractor` / `MemoryConsolidator` 等 **具体类直接被注入使用**。入口在 `memory-extractor.ts:37-49`:
```typescript
export class MemoryExtractor {
  constructor(
    private db: SqliteStore,
    private llmCall: LLMCallFn,
    vectorStore?: VectorStore,
    ftsStore?: FtsStore,
    llmCallWithBlocks?: LLMCallWithBlocksFn,
  ) {
    this.memoryStore = new MemoryStore(db, vectorStore);
    this.mergeResolver = new MergeResolver(this.memoryStore);
    this.knowledgeGraph = new KnowledgeGraphStore(db);
    // ...
  }
}
```

**判定 🟡**：形态差异。hermes 的 ABC 设计为 "允许用户换后端" 服务；EvoClaw 内置单实现是 "不允许换，但做到足够好"。对企业 EvoClaw 目标用户（非开发者），单实现更简单。但 hermes 开放生态价值体现在 9 provider 兼容，这是 EvoClaw 当前完全没有的。未来若需接入 mem0 / honcho 等服务，需要先引入抽象层。

---

### §3.2 内置存储形态

**hermes**（`.research/15-memory-providers.md §3.3, agent/builtin_memory_provider.py:24-114`）—— 纯文件:
```python
class BuiltinMemoryProvider(MemoryProvider):
    def system_prompt_block(self) -> str:
        """返回会话开始时冻结的 MEMORY.md + USER.md 快照."""
        return self._store.format_for_system_prompt("memory") + "\n\n" + \
               self._store.format_for_system_prompt("user")

    def get_tool_schemas(self):
        return []  # memory 工具不走 registry，agent-level 拦截
```
- 字符上限硬编码：memory 2200 ≈ 800 tokens、user 1375 ≈ 500 tokens
- 文件锁 fcntl 保护并发（`tools/memory_tool.py:L615-632`）

**EvoClaw**（`packages/core/src/infrastructure/db/migrations/002_memory_units.sql:1-24`）—— 结构化 DB 表:
```sql
CREATE TABLE IF NOT EXISTS memory_units (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  l0_index TEXT NOT NULL,           -- ~50 tokens summary
  l1_overview TEXT NOT NULL,        -- ~500-2K tokens structured overview
  l2_content TEXT NOT NULL,         -- full content
  category TEXT NOT NULL CHECK (category IN ('profile','preference','entity','event','case','pattern','tool','skill','correction')),
  merge_type TEXT NOT NULL CHECK (merge_type IN ('merge','independent')),
  merge_key TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','shared','channel_only')),
  activation REAL NOT NULL DEFAULT 1.0,
  access_count INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0.5,
  -- ... source_session_key / source_message_ids / archived_at
);
CREATE INDEX idx_memory_activation ON memory_units(agent_id, activation DESC);
```

`MemoryStore.insert()`（`memory/memory-store.ts:76-95`）同时触发 `queueEmbeddingIndex()`，embedding 失败不影响主流程。

**判定 🟢 反超**：EvoClaw 将单用户 2700 tokens 文件（hermes 硬上限）替换为 **无上限结构化 DB**，且每条记忆独立分级（L0 检索锚点 / L1 排序展示 / L2 完整内容）。按 CLAUDE.md 声称 L0/L1/L2 实现 "80%+ token 压缩"——原理是前两阶段检索只加载 L0+L1，Phase 3 才按 Token 预算加载 L2（见 §3.5）。hermes 方案在用户记忆超过 500 tokens 时会触发 `Rejected: would exceed 1375 chars`（`tools/memory_tool.py:L625-627`），需要 LLM 自己做 replace/remove 来腾空间，用户体验较差。

---

### §3.3 记忆类别体系

**hermes**（`.research/15-memory-providers.md §3.6, tools/memory_tool.py:562-588`）—— 2 个 target:
```python
MEMORY_SCHEMA = {
    "parameters": {
        "properties": {
            "action": {"enum": ["add", "replace", "remove", "read"]},
            "target": {"enum": ["memory", "user"]},   # 只有两类
            ...
        }
    }
}
```
`target="memory"` 写 MEMORY.md（agent 笔记），`target="user"` 写 USER.md（用户档案）。**无进一步分类**，所有 agent 笔记混在同一文件。

**EvoClaw**（`migrations/002_memory_units.sql:8`）—— 9 类 CHECK 约束:
```sql
category TEXT NOT NULL CHECK (category IN (
  'profile','preference','entity','event','case','pattern','tool','skill','correction'
))
```

两种合并语义（`migrations/002_memory_units.sql:9` + `memory/merge-resolver.ts:16-51`）:
```typescript
resolve(agentId: string, parsed: ParsedMemory): string {
  if (parsed.mergeType === 'merge' && parsed.mergeKey) {
    const existing = this.store.findByMergeKey(agentId, parsed.mergeKey);
    if (existing) {
      // 仅更新 L1 和 L2（L0 保持稳定，用于向量索引）
      this.store.update(existing.id, { l1Overview: ..., l2Content: ..., confidence: ... });
      return existing.id;
    }
  }
  // 插入新记录
}
```

`HybridSearcher`（`memory/hybrid-searcher.ts:221-230`）根据 **查询类型 × 记忆类别** 矩阵 boost:
```typescript
const matrix: Record<QueryType, Record<string, number>> = {
  factual:    { profile: 1.5, entity: 1.5, preference: 1.0, event: 0.8, ..., correction: 1.2 },
  preference: { profile: 1.0, entity: 0.8, preference: 1.5, ..., correction: 1.3 },
  temporal:   { profile: 0.8, entity: 0.8, preference: 0.8, event: 1.5, case: 1.2, ..., correction: 1.0 },
  skill:      { profile: 0.8, entity: 0.8, preference: 0.8, event: 0.8, case: 1.3, ..., tool: 1.5, skill: 1.5, correction: 1.2 },
  general:    { /* 全部 1.0 */ },
};
```

**判定 🟢 反超**：EvoClaw 9 类分类 + merge/independent 语义 + category×query boost 是结构化记忆的核心创新，hermes 完全没有这层。hermes 的 "profile 写 USER.md / 其它写 MEMORY.md" 只是 2 分类，且没有搜索时的 boost（因为 hermes 没有搜索——它整个文件注入 system prompt）。EvoClaw 的 `correction` 类别还有独立的 `correctionBoost=1.5`（`hybrid-searcher.ts:134`），保证用户纠正优先级。

---

### §3.4 检索后端

**hermes**（`.research/15-memory-providers.md §3.3`）—— 无主动检索:
```python
def system_prompt_block(self) -> str:
    return self._store.format_for_system_prompt("memory") + "\n\n" + \
           self._store.format_for_system_prompt("user")
```
Builtin **整个 MEMORY.md + USER.md 文件内容直接注入 system prompt**。因为文件有硬上限（2700 tokens 总），就不需要搜索——全部都能塞进去。外部 provider 如 honcho/mem0 各自做向量搜索（但都是远程服务）。

**EvoClaw**（`packages/core/src/infrastructure/db/fts-store.ts:13-17` + `vector-store.ts:27-96`）—— 三后端:

FTS5 全文（`fts-store.ts:14-17`）:
```typescript
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts
USING fts5(memory_id UNINDEXED, l0_index, l1_overview, tokenize='unicode61')
```

向量（`vector-store.ts:50-55`）—— `Float32Array` BLOB + JS cosine 暴力搜索（无 sqlite-vec 扩展）:
```typescript
const blob = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
this.db!.run(
  `INSERT OR REPLACE INTO embeddings (id, source_type, embedding, dimension, updated_at)
   VALUES (?, ?, ?, ?, datetime('now'))`,
  id, sourceType, blob, embedding.length,
);
// 搜索时全表扫描，计算 cosineSimilarity（vector-store.ts:87-95）
// 桌面单用户 <50K 向量约 15ms
```

知识图谱（`migrations/003_knowledge_graph.sql:1-18`）:
```sql
CREATE TABLE IF NOT EXISTS knowledge_graph (
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  source_memory_id TEXT REFERENCES memory_units(id) ON DELETE SET NULL,
  ...
);
CREATE INDEX idx_kg_subject ON knowledge_graph(subject_id, predicate);
CREATE INDEX idx_kg_object ON knowledge_graph(object_id, predicate);
```

**判定 🟢 反超**：EvoClaw 三后端并行 vs hermes 只注入文件。注意：**原 CLAUDE.md 声称 "bun:sqlite + FTS5 + sqlite-vec 单引擎覆盖" 与实际代码不符**——`vector-store.ts:50-95` 使用 Float32Array BLOB + JS 暴力 cosine，未引入 sqlite-vec（Grep 零结果）。这是 CLAUDE.md 文档与实现间的一处漂移，不影响本报告对齐判定——JS cosine 在 <50K 向量时足够（~15ms），生产可行。

---

### §3.5 三阶段渐进检索

**hermes** — 无此机制。外部 provider（如 mem0）可能做自己的向量搜索 + rerank，但 builtin 不做任何检索。

**EvoClaw**（`memory/hybrid-searcher.ts:69-203`）—— Phase 1/2/3 显式阶段:

Phase 1 候选生成（三路并行，加权合并，`hybrid-searcher.ts:76-117`）:
```typescript
// 1a: FTS5 关键词搜索（权重 0.3）
const ftsResults = this.ftsStore.search(ftsQuery, candidateLimit);
for (const r of ftsResults) {
  const normalized = Math.min(1, Math.abs(r.score) / 20);
  candidateScores.set(r.memoryId, (candidateScores.get(r.memoryId) ?? 0) + normalized * 0.3);
}
// 1b: 向量搜索（权重 0.5）
if (this.vectorStore.hasEmbeddingFn) {
  const vectorResults = await this.vectorStore.searchByText(query, candidateLimit, 'memory');
  for (const r of vectorResults) candidateScores.set(r.memoryId, ... + r.score * 0.5);
}
// 1c: 知识图谱扩展（权重 0.2）
const kgResults = this.knowledgeGraph.expandEntities(analysis.keywords);
// 取 Top candidateLimit（默认 30）
```

Phase 2 评分排序 + 去重（`hybrid-searcher.ts:120-172`）:
```typescript
const scored = filtered.map(unit => {
  const searchScore = candidateScores.get(unit.id) ?? 0;
  const hotness = computeHotness(unit);          // §3.6
  const categoryBoost = getCategoryBoost(unit.category, analysis.queryType);  // §3.3
  const correctionBoost = unit.category === 'correction' ? 1.5 : 1.0;
  const finalScore = searchScore * hotness * categoryBoost * correctionBoost;
  return { memoryId, l0Index, l1Overview, category, finalScore, activation, updatedAt };
});
// merge_key 去重 → 分数阈值 MIN_SCORE_WITH_VECTOR=0.15 过滤噪音 → Top-N
// Phase 2.5（可选）: 高价值查询触发 LLM 精选（hybrid-searcher.ts:174-178）
```

Phase 3 L2 按需加载（`hybrid-searcher.ts:186-200`）:
```typescript
if (options?.loadL2 || analysis.needsDetail) {
  let tokenBudget = MEMORY_L2_BUDGET_TOKENS;
  for (const result of topResults) {
    const unit = this.memoryStore.getById(result.memoryId);
    const estimatedTokens = Math.ceil(unit.l2Content.length / 4);
    if (estimatedTokens <= tokenBudget) {
      result.l2Content = unit.l2Content;
      tokenBudget -= estimatedTokens;
    }
    if (tokenBudget <= 0) break;
  }
}
```

**判定 🟢 反超**：Phase 1 候选（宽搜）→ Phase 2 排序（热度+类别boost+纠正boost+merge_key 去重+阈值过滤）→ Phase 3 L2 按预算加载 的**三阶段 pipeline 是 EvoClaw 原创**。hermes 没有 "记忆太多要按 token 预算选择性加载" 的概念（因为 MEMORY.md 本身 ≤2200 字符，不存在 L2 分级）。这是 EvoClaw **结构性碾压**的核心设计。

---

### §3.6 热度衰减

**hermes** — **无衰减机制**。MEMORY.md 中的内容要么一直存在（直到 LLM 主动调 `memory remove`），要么不存在。没有"长期未访问自动降权"概念。

**EvoClaw** — 双重衰减（搜索时 + 定时器）:

搜索时动态计算（`memory/hybrid-searcher.ts:207-213`）:
```typescript
function computeHotness(unit: { accessCount: number; updatedAt: string }): number {
  const ageDays = (Date.now() - new Date(unit.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  const decayRate = Math.LN2 / HOTNESS_HALF_LIFE_DAYS;   // 7 天半衰期
  const accessFactor = sigmoid(Math.log1p(unit.accessCount));
  const timeFactor = Math.exp(-decayRate * ageDays);
  return accessFactor * timeFactor;
}
```

定时器后台批量更新 + 归档（`memory/decay-scheduler.ts:41-86`）:
```typescript
tick(): { updated: number; archived: number } {
  const decayRate = Math.LN2 / HOTNESS_HALF_LIFE_DAYS;
  // ... 遍历所有 pinned=0 AND archived_at IS NULL 的记忆
  for (const row of rows) {
    const ageDays = (now - new Date(row.updated_at).getTime()) / (1000 * 60 * 60 * 24);
    const newActivation = sigmoid(Math.log1p(row.access_count)) * Math.exp(-decayRate * ageDays);
    this.db.run('UPDATE memory_units SET activation = ? WHERE id = ?', newActivation, row.id);
    // 归档条件：activation < 0.1 且 30 天未访问
    if (newActivation < 0.1 && (now - lastAccess) > thirtyDaysMs) {
      this.store.archive(row.id);
    }
  }
}
```

召回时 bump（`memory/memory-store.ts:255-274`）:
```typescript
bumpActivation(ids: string[]): void {
  this.db.transaction(() => {
    for (const id of ids) {
      this.db.run(
        `UPDATE memory_units
         SET access_count = access_count + 1,
             activation = activation + 0.1,
             last_access_at = ?, updated_at = ?
         WHERE id = ?`,
        now, now, id,
      );
    }
  });
}
```

**判定 🟢 反超**：EvoClaw **内建热度衰减是记忆质量的关键**——老记忆自然下沉、常用记忆自然上浮，无需 LLM 主动清理。`pinned=1` 钉选免疫衰减（`memory-store.ts:237-252`）为重要记忆提供永久保护。hermes 必须靠 LLM 自己识别 "哪些记忆该删"，用户体验被动。

---

### §3.7 LLM 写入工具

**hermes**（`.research/15-memory-providers.md §3.6, tools/memory_tool.py:562-588`）—— 1 个工具 4 action:
```python
MEMORY_SCHEMA = {
    "name": "memory",
    "parameters": {
        "properties": {
            "action": {"enum": ["add", "replace", "remove", "read"]},
            "target": {"enum": ["memory", "user"]},
            "content": {"type": "string"},    # for add/replace
            "old_text": {"type": "string"},   # for replace/remove
        },
        "required": ["action", "target"],
    },
}
```
`memory` 工具在 `run_agent._invoke_tool` 里 **agent-level 拦截**（`.research/15-memory-providers.md §3.6`），拦截后调 `memory_tool()` + 广播 `MemoryManager.on_memory_write()` 到外部 provider 镜像。

**EvoClaw**（`tools/evoclaw-tools.ts:144-335`）—— 5 个独立工具:

1. `memory_write`（L144-199）: 新记忆，参数 `l0 / l1 / l2 / category`，自动计算 `mergeType` + `mergeKey = ${category}:${l0.slice(0, 32)}`，confidence=0.9
2. `memory_update`（L201-238）: 更新 l1/l2（l0 不可改以保稳定检索），agent_id 校验
3. `memory_delete`（L240-264）: 软删除（归档），agent_id 校验
4. `memory_forget_topic`（L266-300）: 按关键词 FTS5 批量归档，返回归档数量
5. `memory_pin`（L302-335）: 钉选/取消钉选，免疫衰减

Memory Flush 工具白名单（`agent/memory-flush.ts:56-61`）:
```typescript
export const MEMORY_FLUSH_ALLOWED_TOOLS = new Set([
  'read',
  'memory_search',
  'memory_write',
]);
```

**判定 🟢 反超**：EvoClaw 5 个语义明确的独立工具 vs hermes 1 个多态工具：
- `memory_forget_topic` 独有——批量按关键词忘记，hermes 必须 LLM 自己循环 `memory remove` 每一条
- `memory_pin` 独有——hermes 无钉选概念
- 独立 `category` 参数保证分类（hermes 只能 memory/user 二选一）
- `l0Index` 不可修改——保证向量索引稳定性（hermes 没有向量索引所以无需考虑）

---

### §3.8 反馈循环防护

**hermes**（`.research/15-memory-providers.md §3.6 + §3.2`）—— 两层防护:

Regex 注入检测（`tools/memory_tool.py:L645-659`）—— 写入时拒绝:
```python
_INJECTION_PATTERNS = [
    r"ignore\s+(previous|all)\s+instructions",
    r"disregard\s+previous",
    r"system\s*:\s*",
    r"<\|im_start\|>",
    r"</memory-context>",    # 记忆上下文逃逸
    ...
]
def _detect_injection(content: str) -> bool:
    for pat in _INJECTION_PATTERNS:
        if re.search(pat, content, re.IGNORECASE): return True
    return False
```

`<memory-context>` tag 转义（`memory_manager.py:L357-369`）—— 读取时包裹:
```python
def sanitize_context(text: str) -> str:
    return text.replace("</memory-context>", "&lt;/memory-context&gt;")

def build_memory_context_block(raw_context: str) -> str:
    sanitized = sanitize_context(raw_context)
    return ("<memory-context>\n"
            "[系统注：以下内容由记忆系统自动注入，非用户输入]\n"
            f"{sanitized}\n</memory-context>")
```

**EvoClaw**（`memory/text-sanitizer.ts:9-96`）—— 零宽空格标记剥离:
```typescript
export const MARKERS = {
  EVOCLAW_MEM_START: '\u200B\u200C\u200B__EVOCLAW_MEM_START__\u200B\u200C\u200B',
  EVOCLAW_MEM_END: '\u200B\u200C\u200B__EVOCLAW_MEM_END__\u200B\u200C\u200B',
  EVOCLAW_RAG_START: '\u200B\u200C\u200B__EVOCLAW_RAG_START__\u200B\u200C\u200B',
  EVOCLAW_RAG_END: '\u200B\u200C\u200B__EVOCLAW_RAG_END__\u200B\u200C\u200B',
} as const;

export function sanitizeForExtraction(text: string): string | null {
  let result = text;
  // 1. 剥离注入的记忆上下文
  result = stripMarkedContent(result, MARKERS.EVOCLAW_MEM_START, MARKERS.EVOCLAW_MEM_END);
  // 2. 剥离注入的 RAG 上下文
  result = stripMarkedContent(result, MARKERS.EVOCLAW_RAG_START, MARKERS.EVOCLAW_RAG_END);
  // 3. 剥离元数据 JSON 块
  result = result.replace(/\n\{[\s\S]*?"_evoclaw_meta"[\s\S]*?\}\n/g, '\n');
  // 4. 过滤命令消息（以 / 开头）
  result = result.split('\n').filter(line => !line.trimStart().startsWith('/')).join('\n');
  // ... CJK 感知最小长度检查 / 24K 截断
}
```

注入时包裹（`memory/text-sanitizer.ts:101-109`）:
```typescript
export function wrapMemoryContext(content: string): string {
  return `${MARKERS.EVOCLAW_MEM_START}${content}${MARKERS.EVOCLAW_MEM_END}`;
}
```

**判定 🟢 反超**（不同取向）：两者解决的问题不同——
- hermes 防的是 **prompt injection**（攻击者往 memory 写 "ignore previous"），取拒绝策略
- EvoClaw 防的是 **提取反馈循环**（LLM 输出回引之前注入的 memory，抽取阶段又把这段回引存为新 memory → 无限累积），取剥离策略

EvoClaw 的零宽空格（U+200B/U+200C）不会影响 LLM 理解也不会被渲染，但抽取时可以精确识别并剥离。两个机制互补——hermes 未处理反馈循环问题（因为 hermes 无 LLM 抽取），EvoClaw 的 regex 级注入检测较弱（只有 `sanitizeForExtraction` 没有拒绝写入）。

---

### §3.9 用户反馈机制

**hermes** — **无用户反馈表**。用户只能通过 LLM "请把关于 X 的那条记忆删掉" 间接操作。

**EvoClaw**（`migrations/025_memory_feedback.sql:14-29`）:
```sql
CREATE TABLE IF NOT EXISTS memory_feedback (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('inaccurate', 'sensitive', 'outdated')),
  note TEXT,
  reported_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  FOREIGN KEY (memory_id) REFERENCES memory_units(id) ON DELETE CASCADE,
  ...
);
CREATE INDEX idx_memory_feedback_agent_unresolved
  ON memory_feedback(agent_id, reported_at DESC)
  WHERE resolved_at IS NULL;
```

`MemoryFeedbackStore`（`memory/memory-feedback-store.ts:53-138`）—— 完整 CRUD + confidence 衰减:
```typescript
export const CONFIDENCE_DECAY_STEP = 0.15;   // 反馈一次扣 0.15

insert(input: InsertFeedbackInput): MemoryFeedback { /* INSERT */ }
listByMemory(memoryId: string): MemoryFeedback[]
listUnresolvedByAgent(agentId: string, limit: number = 50): MemoryFeedback[]
markResolved(id: string): void
delete(id: string): void
```

前端集成（CLAUDE.md Sprint 15.12 描述）：记忆中心 UI 3 个按钮（不准确/涉及隐私/过时）→ 路由层 insert feedback + confidence -= 0.15 → AutoDream 整合优先合并/裁剪低 confidence 记忆。

**判定 🟢 反超**：EvoClaw 完整 **"用户 → 标记 → confidence 降权 → AutoDream 整合"** 闭环。hermes 用户想修正记忆必须通过 LLM 对话，LLM 可能误解或遗忘。这是 EvoClaw 企业级记忆系统的关键差异化能力。

---

### §3.10 知识图谱

**hermes**（`.research/15-memory-providers.md §3.4`）—— 仅 hindsight provider 有 KG（远程或本地），builtin 无 KG。

**EvoClaw**（`migrations/003_knowledge_graph.sql` + `memory/knowledge-graph.ts:39-158`）—— 内置三元组表:
```sql
CREATE TABLE IF NOT EXISTS knowledge_graph (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_id TEXT NOT NULL,
  object_literal TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  source_memory_id TEXT REFERENCES memory_units(id) ON DELETE SET NULL,
  ...
);
```

`KnowledgeGraphStore.insertRelation()`（`memory/knowledge-graph.ts:45-74`）在 `MemoryExtractor` 抽取阶段被填充（`memory/memory-extractor.ts:114-123`）:
```typescript
for (const rel of result.relations) {
  this.knowledgeGraph.insertRelation({
    agentId,
    subjectId: rel.subject,
    predicate: rel.predicate,
    objectId: rel.object,
    confidence: rel.confidence,
  });
}
```

`HybridSearcher` Phase 1c 使用 KG 扩展候选（`hybrid-searcher.ts:97-104`）:
```typescript
const kgResults = this.knowledgeGraph.expandEntities(analysis.keywords);
for (const entry of kgResults) {
  candidateScores.set(entry.subjectId, (candidateScores.get(entry.subjectId) ?? 0) + 0.2 * entry.confidence);
  candidateScores.set(entry.objectId, (candidateScores.get(entry.objectId) ?? 0) + 0.2 * entry.confidence);
}
```

**判定 🟢 反超**：EvoClaw 内置 KG 贯穿 **LLM 抽取 → 存储 → Phase 1 扩展检索** 闭环。hermes builtin 完全没有关系提取——所有 "X 是 Y 的朋友" 这类关系只能用自然语言存在 MEMORY.md 里，无法通过 KG 路径扩展查询。

---

### §3.11 LLM 驱动抽取/精选/整合

**hermes**（`.research/15-memory-providers.md §3.7`）—— `on_pre_compress` hook 让 provider 自行提取:
```python
def on_pre_compress(self, messages: List[Dict]) -> str:
    """Extract insights before context compression.
    Return string to be included in compressor summary."""
    return ""
```
Builtin 没有抽取（返回空）。外部 provider 如 honcho 可以做服务器侧提取，但实现闭源。

**EvoClaw** — 三段式 LLM 驱动:

**抽取**（`memory/memory-extractor.ts:57-129`）—— 对话 → XML → merge/insert:
```typescript
async extractAndPersist(messages, agentId, _sessionKey): Promise<{memoryIds, relationCount, skipped}> {
  const sanitized = sanitizeForExtraction(conversationText);
  if (!sanitized) return { memoryIds: [], relationCount: 0, skipped: true };
  const { system, systemBlocks, user } = buildExtractionPrompt(sanitized);
  const llmResponse = this.llmCallWithBlocks
    ? await this.llmCallWithBlocks(systemBlocks, user)   // Prompt Cache 版本
    : await this.llmCall(system, user);
  const result = parseExtractionResult(llmResponse);
  // Stage 3: 持久化
  const memoryIds = this.mergeResolver.resolveAll(agentId, result.memories);
  // FTS 索引 + 知识图谱写入
}
```

**精选**（`memory/llm-reranker.ts` + `hybrid-searcher.ts:174-178`）—— Phase 2.5 条件触发:
```typescript
if (this.reranker && topResults.length > 1 && (analysis.isExplicitRecall || analysis.needsDetail)) {
  log.info(`触发 LLM 精选: isExplicitRecall=${analysis.isExplicitRecall}, needsDetail=${analysis.needsDetail}`);
  topResults = await this.reranker.rerank(query, topResults, limit);
}
```

**整合**（`memory/memory-consolidator.ts:40-60` AutoDream）—— 24h + 5 新会话触发:
```typescript
export class MemoryConsolidator {
  constructor(
    private db: SqliteStore,
    private llmCall: LLMCallFn,
    private dataDir: string,
    options?: ConsolidatorOptions,
    ftsStore?: FtsStore,
  ) {
    this.cooldownHours = options?.cooldownHours ?? 24;
    this.minSessions = options?.minSessionsSinceLast ?? 5;
    // 4 阶段 LLM 驱动（Orient → Gather → Consolidate → Prune）+ 锁机制多进程安全
  }
}
```

**判定 🟢 反超**：三段式 LLM pipeline（抽取→精选→整合）是 EvoClaw **结构化记忆引擎的核心 LLM 调用闭环**。hermes `on_pre_compress` 只是一个字符串返回 hook，实际抽取能力依赖 external provider——且 builtin 没有此能力。这部分是 hermes 等价复刻需要 1-2 人周级工作量的差距。

---

### §3.12 多租户 / 多 Agent 隔离

**hermes**（`.research/15-memory-providers.md §3.8, run_agent.py:1059-1077`）—— Gateway 级 user_id 路径:
```python
_init_kwargs = {
    "user_id": self._user_id,       # gateway 多租户
    ...
}
self._memory_manager.initialize_all(session_id=self.session_id, **_init_kwargs)
```

各 provider 用 user_id 做隔离（`.research/15-memory-providers.md §3.8`）:
| Provider | user_id 用途 |
|---|---|
| Honcho | `peer_name = user_id` |
| Mem0 | `mem0.search(user_id=...)` |
| RetainDB | `query_context(user_id, ...)` |
| Hindsight | `bank_id = f"hermes-{user_id}"` |
| Supermemory | 多容器标签 `f"user-{user_id}"` |

**EvoClaw** — Agent 级硬隔离:
- 所有查询都强制按 `agent_id` 过滤：`memory-store.ts:197-209`, `hybrid-searcher.ts:123-128` (`filtered = units.filter(u => u.agentId !== agentId)...`), `knowledge-graph.ts` agent_id 外键
- `memory_units.agent_id` 是必填外键（`migrations/002_memory_units.sql:3`）
- `memory_feedback.agent_id` 必填外键（`migrations/025_memory_feedback.sql:17`）
- `memory_units.user_id` 字段存在但**无显式使用路径**（Grep `packages/core/src/memory` 对 `user_id|userId` 仅 `knowledge-graph.ts:9` 一条，属行类型定义，无 WHERE 过滤）

**判定 🟡 形态差异**：EvoClaw agent_id 列级隔离足够单用户多 Agent 场景，但缺 hermes 的 gateway user_id 路径。多租户场景（SaaS 多客户共享一个 Sidecar 实例）未覆盖。考虑 EvoClaw 目标场景是桌面单用户 + 企业内部多 Agent，当前设计合理；若未来做多租户 SaaS，需要在 memory 查询层加一层 user_id 过滤。

---

### §3.13 生命周期钩子

**hermes**（`.research/15-memory-providers.md §3.1, memory_provider.py:184-206`）—— 5 个 hook:
```python
def on_turn_start(self, turn_number: int, message: str, **kwargs) -> None: ...
def on_session_end(self, messages: List[Dict]) -> None: ...
def on_pre_compress(self, messages: List[Dict]) -> str: ...
def on_memory_write(self, action: str, target: str, content: str) -> None: ...
def on_delegation(self, task: str, result: str, child_session_id: str = "", **kwargs) -> None: ...
```

`MemoryManager.on_memory_write`（`memory_manager.py:L343-350`）—— builtin 写入后广播到外部 provider:
```python
def on_memory_write(self, action, target, content):
    for p in self._providers:
        if p.name == "builtin": continue   # skip source
        try: p.on_memory_write(action, target, content)
        except Exception as e: logger.warning(...)
```

**EvoClaw** — 无等价 hook 层，通过 **ContextPlugin 生命周期** 间接覆盖部分功能（CLAUDE.md "ContextPlugin 5 hooks" bootstrap → beforeTurn → compact → afterTurn → shutdown）:
- `createMemoryRecallPlugin`（`context/plugins/memory-recall.ts:23-80`）使用 `beforeTurn` 注入记忆，等价于 hermes `prefetch`
- `on_session_end` 无直接对应，但 `conversation-logger.ts` + `memory-extractor.ts` 在会话消息积累到一定量时抽取
- `on_delegation` 无对应（EvoClaw subagent 记忆不共享给父）

**判定 🟡**：EvoClaw ContextPlugin 覆盖 prefetch/sync 主路径，但缺少 "broadcast builtin write to externals" 的广播层——因为 EvoClaw 只有一个 "builtin"。未来若引入外部 provider（见 §3.14），需要补齐 `on_memory_write` 类似的广播 hook。

---

### §3.14 外部 Provider 生态

**hermes**（`.research/15-memory-providers.md §3.4 表格 + §3.5 honcho 深度`）—— 8 个外部 provider plugin:
| Provider | 后端 | 关键特性 |
|---|---|---|
| honcho | Honcho AI API | dialectic 对话建模、recall_mode、cost-aware 节流 |
| mem0 | Mem0 Platform | 语义搜索、rerank、circuit breaker |
| hindsight | Vectorize 云或本地 | 双模式、知识图谱 |
| supermemory | Supermemory SaaS | 多容器、自动分类 |
| byterover | 本地 brv CLI | 分层上下文 L0/L1/L2、模糊搜索 |
| openviking | 字节跳动 Volcengine | Filesystem URI、tiered context |
| holographic | 本地向量 DB | 反馈循环、检索融合 |
| retaindb | RetainDB 云 | SQLite write-behind queue、dialectic |

每个 plugin 在 `plugins/memory/<name>/__init__.py` 实现（honcho 1400+ 行），通过 `ctx.register_memory_provider(singleton)` 注册。

**EvoClaw** — 完全没有外部 provider 对接点。Grep `mem0|honcho|retaindb|supermemory|hindsight` 在整个 `packages/core/src` 零结果。

**判定 🔴**：这是 hermes 对 EvoClaw 的**唯一明确反超**。hermes 用户可以选 9 种后端之一；EvoClaw 用户只有一种选择（即内置实现）。但考虑到：
- EvoClaw 内置能力（9 类 + L0/L1/L2 + FTS5 + 向量 + KG + feedback + 衰减）已经覆盖或超越大部分外部 provider 的功能
- 企业用户不希望数据流到 3rd party SaaS（合规诉求）
- 真正需要接入外部 SaaS 的用户是少数开发者

若未来需要接入 mem0/honcho 等（大概率场景：客户要求对接自家 RAG 平台），需要补齐 §3.1 的 provider 抽象层 + 8-10 人日接入工作。

---

### §3.15 Prefetch / queue_prefetch

**hermes**（`.research/15-memory-providers.md §3.7`）—— 每轮双阶段:
```python
# 每轮开头
context = self._memory_manager.prefetch_all(user_message, session_id=self.session_id)
# 每轮结尾
self._memory_manager.queue_prefetch_all(user_message, session_id=self.session_id)  # 预热下轮
```

`queue_prefetch` 把 query 加入 provider 内部队列，在下一轮 `prefetch` 调用时消费（可能在后台线程已完成），减少延迟。

**EvoClaw**（`context/plugins/memory-recall.ts:23-80`）—— 同步 beforeTurn:
```typescript
async beforeTurn(ctx: TurnContext) {
  const lastUserMsg = [...ctx.messages].reverse().find(m => m.role === 'user');
  if (!lastUserMsg) return;
  const results = await searcher.hybridSearch(lastUserMsg.content, ctx.agentId, searchOpts);
  // ... 注入 recallMeta + 组装 memoryBlock + wrapMemoryContext 包裹
}
```

同步 await，无预热队列。`hybridSearch` 内部 Phase 1 涉及 embedding API 调用（如果 vectorStore.hasEmbeddingFn），会引入延迟。

**判定 🟡**：EvoClaw 检索质量高（三阶段）但延迟敏感——每轮都要等 embedding 完成才能注入。hermes `queue_prefetch` 在上轮就把 query 加队列，下轮 `prefetch` 只读结果。对于短 query EvoClaw 影响小（~15ms 向量搜索 + ~50-200ms embedding API），对长 query 或高 QPS 场景值得补齐预热。

---

### §3.16 Pre-compression 提取

**hermes**（`.research/15-memory-providers.md §3.7 L5964`）—— `on_pre_compress` hook:
```python
# 在 _compress_context() 里
insights = self._memory_manager.on_pre_compress(messages)
# 返回的字符串被 context_compressor 包含在 summary prompt 里
```
Builtin 不实现，外部 provider 可选实现——被动字符串返回。

**EvoClaw**（`agent/memory-flush.ts:30-76`）—— Memory Flush 三层防护:
```typescript
export function buildMemoryFlushPrompt(): string {
  return `[Pre-compaction memory flush]
会话即将被压缩。请将当前对话中重要的上下文持久化到长期记忆 DB。
可以用的工具：
- read（只读，确认细节）
- memory_search（查询是否已有相关记忆，避免重复）
- memory_write（写入新的长期记忆）
规则（不可违反）：
${safetyBlock}
- 如果没有需要存储的内容，回复 NO_REPLY
...`;
}

// Layer 1: 工具白名单
export const MEMORY_FLUSH_ALLOWED_TOOLS = new Set(['read', 'memory_search', 'memory_write']);

// Layer 3: 85% token 触发（memory-flush.ts:78+）
```

**判定 🟢 反超**：EvoClaw 的 Memory Flush 是 **"压缩前最后一次主 LLM 写 memory 的机会"**，保留 LLM 的主动性（让 LLM 决定哪些重要）+ 工具链白名单（防止越权）+ 触发条件（85%）。hermes `on_pre_compress` 完全被动——provider 自己扫描 messages 返回字符串，没有 LLM 参与。EvoClaw 方案更可控、更安全、更贴近主 LLM 的记忆判断。

---

## 4. 建议改造蓝图（不承诺实施）

### P0（立即）
**无** — §3 判定 11 项反超 + 4 项形态差异 + 1 项明确落后（外部 provider 生态），落后项是生态问题不是能力问题，企业桌面单用户场景无 P0 需求。

### P1（半年内可观望）
1. **Provider 抽象层** — 如果客户明确要求接入 mem0/honcho/自家 RAG，补齐 §3.1 的 ABC（参照 hermes 15 方法接口），工作量 3-5 人日
   - ROI: 中（看客户需求，非强制）
2. **queue_prefetch 预热** — §3.15 对长 query / 高 QPS 场景减少延迟，工作量 1-2 人日
   - ROI: 低-中（企业桌面场景延迟敏感度不高）
3. **Gateway user_id 多租户路径** — §3.12，若未来做 SaaS 部署，工作量 2-3 人日（memory 所有查询加 user_id 过滤）
   - ROI: 仅 SaaS 场景有价值

### P2（按需）
4. **on_memory_write 广播 hook** — §3.13，仅在引入外部 provider 后需要，随 §3.1 一起做
5. **Regex 注入拒绝层** — §3.8 补齐 hermes 的 `_detect_injection`，作为 `sanitizeForExtraction` 的补充防线，工作量 1 人日

### 不建议做
- **移植 8 个 hermes provider plugin** — 每个 plugin 500-1400 行代码，总计 5000-8000 行移植成本；EvoClaw 内置能力已覆盖 80% 场景；真实需求出现前不建议投入
- **拆掉 L0/L1/L2 改用 hermes 扁平文件** — 反向倒退
- **移除衰减机制** — 会严重降低长期用户记忆质量

---

## 5. EvoClaw 反超点汇总

| # | 反超点 | EvoClaw 代码证据 | hermes 对应缺失 |
|---|---|---|---|
| 1 | L0/L1/L2 三层存储 | `migrations/002_memory_units.sql:5-7` + `hybrid-searcher.ts:186-200` Phase 3 | hermes MEMORY.md 仅有一层纯文本 |
| 2 | 9 类记忆分类 + CHECK 约束 | `migrations/002_memory_units.sql:8` | hermes 仅 memory/user 2 分类 |
| 3 | merge/independent 合并语义 | `memory/merge-resolver.ts:16-51` | hermes 无合并概念，只能 replace 整段 |
| 4 | 三阶段渐进检索（FTS5 + 向量 + KG） | `memory/hybrid-searcher.ts:69-203` | hermes builtin 无检索 |
| 5 | 热度衰减（sigmoid × exp，7 天半衰期） | `memory/hybrid-searcher.ts:207-213` + `memory/decay-scheduler.ts:41-86` | hermes 无衰减 |
| 6 | 自动归档（activation<0.1 且 30 天未访问） | `memory/decay-scheduler.ts:77-81` | hermes 需 LLM 主动 remove |
| 7 | 5 个专用 LLM 写入工具 | `tools/evoclaw-tools.ts:144-335` | hermes 1 个多态 `memory` 工具 |
| 8 | `memory_forget_topic` 批量遗忘 | `tools/evoclaw-tools.ts:266-300` | hermes 需 LLM 循环 remove |
| 9 | `memory_pin` 钉选免疫衰减 | `tools/evoclaw-tools.ts:302-335` + `memory-store.ts:237-252` | hermes 无钉选 |
| 10 | 零宽空格反馈循环防护 | `memory/text-sanitizer.ts:9-14, 63-96` | hermes 只防 prompt injection，不防 extraction 反馈循环 |
| 11 | memory_feedback 表 + 3 种标记 | `migrations/025_memory_feedback.sql:14-29` + `memory/memory-feedback-store.ts:53-138` | hermes 无用户反馈表 |
| 12 | confidence -= 0.15 衰减 + AutoDream 优先整合 | `memory/memory-feedback-store.ts:35` + `memory/memory-consolidator.ts:40-60` | hermes 无 confidence 字段 |
| 13 | 知识图谱三元组表 + 实体扩展检索 | `migrations/003_knowledge_graph.sql` + `memory/knowledge-graph.ts:45-74` + `hybrid-searcher.ts:97-104` | hermes 仅 hindsight 外挂实现 |
| 14 | 三段式 LLM pipeline（抽取/精选/整合） | `memory/memory-extractor.ts:57-129` + `memory/llm-reranker.ts` + `memory/memory-consolidator.ts` | hermes builtin 无抽取，外部 provider 各自闭源 |
| 15 | category × query_type boost 矩阵 | `memory/hybrid-searcher.ts:221-230` | hermes 无分类所以无 boost |
| 16 | correction 类别 1.5× 加成 | `memory/hybrid-searcher.ts:134` | hermes 无 correction 概念 |
| 17 | Memory Flush 三层防护（85% 触发 + 工具白名单 + safety hints） | `agent/memory-flush.ts:22-76` | hermes `on_pre_compress` 被动字符串返回 |
| 18 | L2 token 预算加载（默认 8K） | `memory/hybrid-searcher.ts:186-200` | hermes 整文件注入，无按需加载 |
| 19 | 动态渲染 USER.md / MEMORY.md | `memory/user-md-renderer.ts:23-92` | hermes MEMORY.md 是源文件，无分类渲染 |
| 20 | CJK 感知最小长度检查 | `memory/text-sanitizer.ts:19-30, 85-88` | hermes 全 ASCII 正则，无 CJK 优化 |
| 21 | visibility 三态（private/shared/channel_only）× 群聊过滤 | `migrations/002_memory_units.sql:12` + `context/plugins/memory-recall.ts:41-43` | hermes 无 channel-scoped 记忆 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（已经 Read 工具验证）

| 路径:行号 | 内容要点 |
|---|---|
| `packages/core/src/memory/memory-store.ts:76-95` | `insert()` 同时触发异步 embedding 索引 |
| `packages/core/src/memory/memory-store.ts:237-252` | `pin/unpin` 钉选字段更新 |
| `packages/core/src/memory/memory-store.ts:255-274` | `bumpActivation` 批量提升 +0.1 |
| `packages/core/src/memory/hybrid-searcher.ts:69-203` | 三阶段渐进检索主体 |
| `packages/core/src/memory/hybrid-searcher.ts:207-213` | `computeHotness` sigmoid × exp |
| `packages/core/src/memory/hybrid-searcher.ts:221-230` | category × query_type boost 矩阵 |
| `packages/core/src/memory/decay-scheduler.ts:41-86` | `tick()` 衰减 + 自动归档 |
| `packages/core/src/memory/text-sanitizer.ts:9-14` | 零宽空格 MARKERS 定义 |
| `packages/core/src/memory/text-sanitizer.ts:63-96` | `sanitizeForExtraction` 7 步清洗 |
| `packages/core/src/memory/memory-extractor.ts:57-129` | `extractAndPersist` 三 Stage pipeline |
| `packages/core/src/memory/merge-resolver.ts:16-51` | merge/independent 语义分流 |
| `packages/core/src/memory/knowledge-graph.ts:45-74` | `insertRelation` 三元组写入 |
| `packages/core/src/memory/memory-feedback-store.ts:35` | `CONFIDENCE_DECAY_STEP = 0.15` |
| `packages/core/src/memory/memory-feedback-store.ts:53-138` | MemoryFeedbackStore 完整 CRUD |
| `packages/core/src/memory/memory-consolidator.ts:40-60` | AutoDream 构造参数（24h/5 sessions/锁） |
| `packages/core/src/memory/user-md-renderer.ts:23-92` | 动态渲染 USER.md / MEMORY.md |
| `packages/core/src/tools/evoclaw-tools.ts:144-335` | 5 个 memory_ 工具 schema + execute |
| `packages/core/src/context/plugins/memory-recall.ts:23-80` | `createMemoryRecallPlugin` beforeTurn 注入 |
| `packages/core/src/agent/memory-flush.ts:22-76` | Memory Flush 三层防护 |
| `packages/core/src/infrastructure/db/fts-store.ts:14-17` | FTS5 虚拟表 DDL |
| `packages/core/src/infrastructure/db/vector-store.ts:50-95` | Float32Array BLOB + JS cosine |
| `packages/core/src/infrastructure/db/migrations/002_memory_units.sql:1-30` | `memory_units` 表 + 4 索引 |
| `packages/core/src/infrastructure/db/migrations/003_knowledge_graph.sql:1-18` | `knowledge_graph` 表 + 3 索引 |
| `packages/core/src/infrastructure/db/migrations/025_memory_feedback.sql:14-29` | `memory_feedback` 表 + 2 索引 |

### 6.2 hermes 研究引用

| 引用 | 内容 |
|---|---|
| `.research/15-memory-providers.md §1` | 9 provider 总览（1 内置 + 8 外部） |
| `.research/15-memory-providers.md §2` | `MemoryProvider` 类族图 |
| `.research/15-memory-providers.md §3.1` | ABC 15 方法定义（4+6+5+2） |
| `.research/15-memory-providers.md §3.2` | `MemoryManager` 聚合器 + 内存上下文隔离 |
| `.research/15-memory-providers.md §3.3` | `BuiltinMemoryProvider` 冻结快照 + 字符上限 |
| `.research/15-memory-providers.md §3.4` | 9 provider 对比表 |
| `.research/15-memory-providers.md §3.5` | Honcho provider 深入（recall mode / lazy / cost-aware / cron guard） |
| `.research/15-memory-providers.md §3.6` | memory 工具 schema + 注入检测 + agent-level 拦截 |
| `.research/15-memory-providers.md §3.7` | 生命周期集成点（initialize / prefetch / sync / on_pre_compress / on_session_end） |
| `.research/15-memory-providers.md §3.8` | Per-user scoping 多租户路径 |
| `.research/15-memory-providers.md §3.9` | cli-config.yaml.example memory 配置 |
| `.research/15-memory-providers.md §4.1` | 完整生命周期时序图 |

### 6.3 关联差距章节（crosslink）

- **`04-core-abstractions-gap.md`** — `MemoryProvider` / `MemoryUnit` 类型在核心抽象章的位置
- **`05-agent-loop-gap.md`** §3.8 — 主循环压缩策略章节提及 Memory Flush 触发点（85% token 使用率）
- **`06-llm-providers-gap.md`** — `MemoryExtractor` / `LlmReranker` / `MemoryConsolidator` 三处 LLM 调用走 ModelRouter 辅助模型路径
- **`07-prompt-system-gap.md`**（同批 Wave 2-3 待写）— `wrapMemoryContext` 包裹记忆块作为 system prompt 第 N 段
- **`08-context-compression-gap.md`** — Memory Flush 与 Snip / Microcompact / Autocompact 三层压缩的协同（Flush 是压缩前的"最后挽救"阶段）
- **`12-skills-system-gap.md`** — 记忆类别中 `skill`/`tool` 类与 Skills 生态的潜在联动
- **`14-state-sessions-gap.md`**（同批 Wave 2-3 待写）— 会话结束触发 `MemoryExtractor.extractAndPersist()` 的时机点
- **`17-trajectory-compression-gap.md`**（Phase C3 待写）— trajectory 压缩与记忆提取的关系（轨迹摘要 vs 记忆抽取是否可合并）
