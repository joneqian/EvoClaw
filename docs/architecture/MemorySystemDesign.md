# EvoClaw 记忆系统设计文档

> **文档版本**: v1.0
> **创建日期**: 2026-03-13
> **文档状态**: 设计确认
> **研究基础**: MemOS Cloud OpenClaw Plugin / OpenViking OpenClaw Plugin / claude-mem OpenClaw Integration

---

## 目录

1. [设计理念](#1-设计理念)
2. [数据层设计](#2-数据层设计)
3. [记忆提取 Pipeline](#3-记忆提取-pipeline)
4. [记忆检索：三阶段渐进加载](#4-记忆检索三阶段渐进加载)
5. [ContextPlugin 生命周期](#5-contextplugin-生命周期)
6. [LCM 无损压缩与 L0/L1/L2 的关系](#6-lcm-无损压缩与-l0l1l2-的关系)
7. [进化引擎](#7-进化引擎)
8. [Agent 文件体系](#8-agent-文件体系)
9. [反馈循环防护与文本清洗](#9-反馈循环防护与文本清洗)
10. [衰减与归档生命周期](#10-衰减与归档生命周期)
11. [完整模块总览](#11-完整模块总览)

---

## 1. 设计理念

### 1.1 核心原则

EvoClaw 的记忆系统不直接安装或照搬 MemOS / OpenViking / claude-mem 的代码（它们是 OpenClaw 生态插件，绑定了 OpenClaw 运行时），而是 **借鉴三个项目验证过的核心机制**，在 better-sqlite3 单引擎上自主实现：

| 机制 | 来源 | 核心思想 |
|------|------|---------|
| **L0/L1/L2 三层分级存储** | OpenViking | 每条记忆同时包含索引摘要(~50 tokens)、结构化概览(~500-2K tokens)、完整内容(全文)，按需加载 |
| **三阶段渐进检索** | claude-mem | 先搜 L0 定位 → 加载 L1 精筛 → 按需加载 L2，实测 80%+ token 压缩 |
| **反馈循环防护 + 相关度阈值** | MemOS | 零宽空格标记防止注入的记忆被重复存储；relevance ≥ 0.45 才注入 |
| **merge/independent 分类策略** | OpenViking | merge 型记忆按 merge_key 去重更新，independent 型每条独立存储 |
| **hotness 衰减公式** | OpenViking | `sigmoid(log1p(access_count)) × exp(-0.099 × age_days)`，7 天半衰期 |
| **记忆安全协议** | MemOS | 四步裁决：来源验证 → 归属检查 → 置信度评估 → 隐私边界 |

### 1.2 与 OpenClaw 生态插件的对比

| 维度 | MemOS Plugin | OpenViking Plugin | claude-mem | **EvoClaw** |
|------|-------------|-------------------|-----------|------------|
| 存储 | MemOS Cloud (远程 SaaS) | OpenViking Server (Python 3.10+) | SQLite + ChromaDB (Bun) | **better-sqlite3 + FTS5 + sqlite-vec** |
| 外部依赖 | API Key + 网络 | Python 运行时 | Bun + Claude Agent SDK | **零外部依赖** |
| 运行模式 | 远程 API 调用 | 本地 Python 进程 | 本地 worker 进程 (port 37777) | **进程内，无额外进程** |
| 加密 | 服务端侧 | 无 | 无 | **本地 AES-256-GCM** |

---

## 2. 数据层设计

### 2.1 三表协同架构

三张表各司其职，查询模式不冲突：

- **`memory_units`** — 提炼后的结构化知识，查询频繁，需要快
- **`knowledge_graph`** — 实体间关系网络，需要图查询
- **`conversation_log`** — 原始对话数据，只增不改，用于审计追溯和二次提取

### 2.2 memory_units 表（记忆主表）

```sql
CREATE TABLE memory_units (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,

  -- L0/L1/L2 三层（写入时由一次 LLM 调用同时生成）
  l0_index        TEXT NOT NULL,    -- ~50-100 tokens，一句话摘要，向量检索键
  l1_overview     TEXT NOT NULL,    -- ~500-2K tokens，结构化 Markdown
  l2_content      TEXT NOT NULL,    -- 完整内容，按需加载

  -- 分类体系（借鉴 OpenViking 8 类 + 扩展 correction）
  category        TEXT NOT NULL CHECK(category IN (
    'profile',       -- 用户基本信息（merge）
    'preference',    -- 偏好设定（merge）
    'entity',        -- 实体知识：人物/组织/项目（merge）
    'event',         -- 事件/情景记忆（independent）
    'case',          -- Agent 处理过的案例（independent）
    'pattern',       -- 可复用的流程模板（merge）
    'tool',          -- 工具使用经验（merge）
    'skill',         -- 技能/能力沉淀（merge）
    'correction'     -- 用户纠正记录（merge，高优先级）
  )),
  merge_type      TEXT NOT NULL CHECK(merge_type IN ('merge', 'independent')),
  merge_key       TEXT,             -- merge 型的去重键（L0 标准化后）

  -- 双域作用域（借鉴 OpenViking user/agent 双域）
  scope           TEXT NOT NULL CHECK(scope IN ('user', 'agent')),

  -- 可见性控制（完整隔离策略）
  visibility      TEXT NOT NULL DEFAULT 'private'
    CHECK(visibility IN ('private', 'shared', 'channel_only')),
  visibility_channels TEXT,         -- JSON 数组，指定可见通道列表

  -- 衰减指标（借鉴 OpenViking hotness 公式）
  activation      REAL NOT NULL DEFAULT 1.0,
  access_count    INTEGER NOT NULL DEFAULT 0,
  last_access_at  INTEGER,
  pinned          INTEGER NOT NULL DEFAULT 0,  -- 用户钉选，免于衰减

  -- 来源追溯
  source_session_key  TEXT,
  source_message_ids  TEXT,         -- JSON 数组，关联的原始消息 ID
  confidence          REAL NOT NULL DEFAULT 1.0,  -- 提取置信度

  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  archived_at     INTEGER           -- 归档时间（冷记忆不删除，仅归档）
);

CREATE INDEX idx_memory_units_agent ON memory_units(agent_id);
CREATE INDEX idx_memory_units_category ON memory_units(agent_id, category);
CREATE INDEX idx_memory_units_merge ON memory_units(agent_id, merge_key) WHERE merge_key IS NOT NULL;
CREATE INDEX idx_memory_units_activation ON memory_units(agent_id, activation) WHERE archived_at IS NULL;
```

### 2.3 knowledge_graph 表（知识图谱）

```sql
CREATE TABLE knowledge_graph (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,

  subject_id      TEXT NOT NULL,    -- 指向 memory_units.id（entity 类型）
  predicate       TEXT NOT NULL,    -- 关系类型：works_at, knows, uses, prefers...
  object_id       TEXT,             -- 指向另一个 memory_units.id（可选）
  object_literal  TEXT,             -- 或者是字面值（如 "Python 3.12"）

  confidence      REAL NOT NULL DEFAULT 1.0,
  source_memory_id TEXT,            -- 从哪条记忆提取出的关系

  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX idx_kg_subject ON knowledge_graph(subject_id);
CREATE INDEX idx_kg_object ON knowledge_graph(object_id) WHERE object_id IS NOT NULL;
CREATE INDEX idx_kg_agent ON knowledge_graph(agent_id);
```

### 2.4 conversation_log 表（对话日志）

```sql
CREATE TABLE conversation_log (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  session_key     TEXT NOT NULL,

  role            TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
  content         TEXT NOT NULL,
  tool_name       TEXT,
  tool_input      TEXT,
  tool_output     TEXT,

  -- 压缩状态
  compaction_status TEXT NOT NULL DEFAULT 'raw'
    CHECK(compaction_status IN ('raw', 'extracted', 'compacted')),
  compaction_ref    TEXT,           -- 指向生成的 memory_units.id（提取后标记）

  token_count     INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_convlog_session ON conversation_log(agent_id, session_key, created_at);
CREATE INDEX idx_convlog_compaction ON conversation_log(compaction_status) WHERE compaction_status = 'raw';
```

### 2.5 双索引

```sql
-- FTS5 全文索引（搜 L0 + L1）
CREATE VIRTUAL TABLE memory_fts USING fts5(
  l0_index, l1_overview,
  content=memory_units, content_rowid=rowid,
  tokenize='unicode61'
);

-- sqlite-vec 向量索引（L0 embedding，1024 维）
-- 具体语法取决于 sqlite-vec 版本
-- CREATE VIRTUAL TABLE memory_vec USING vec0(embedding float[1024]);
```

---

## 3. 记忆提取 Pipeline

### 3.1 三阶段流水线

对话结束后（`afterTurn`），记忆提取分三个阶段执行：

```
对话结束（afterTurn）
    │
    ▼
┌─────────────────────────────────────┐
│ Stage 1: 预处理（纯逻辑，不调 LLM）    │
│ · 剥离注入的记忆上下文（反馈循环防护）  │
│ · 过滤无信息量的消息（命令、问候等）     │
│ · 截断超长工具输出（≤1000 字符）        │
│ · CJK 感知的最小长度检查               │
└─────────┬───────────────────────────┘
          │ 有效内容
          ▼
┌─────────────────────────────────────┐
│ Stage 2: 记忆提取（一次 LLM 调用）     │
│ · 输入：预处理后的对话文本              │
│ · 输出：结构化 XML，每条含              │
│   category + merge_key + L0/L1/L2    │
│ · 同时输出关系三元组                    │
│   (subject, predicate, object)       │
└─────────┬───────────────────────────┘
          │ ParsedMemory[]
          ▼
┌─────────────────────────────────────┐
│ Stage 3: 持久化（纯逻辑，不调 LLM）    │
│ · merge 型：查 merge_key，存在则更新   │
│   L1/L2，L0 不变（保持向量索引稳定）   │
│ · independent 型：直接 INSERT          │
│ · 关系三元组写入 knowledge_graph       │
│ · 标记已处理的 conversation_log 行     │
│ · 异步生成 L0 embedding 写入向量表     │
└─────────────────────────────────────┘
```

### 3.2 提取 Prompt 模板

```
你是记忆提取引擎。分析对话内容，提取值得长期记忆的信息。

## 分类规则

### Merge 型（同 merge_key 会更新已有记忆）
- profile: 用户身份信息（姓名、年龄、职业、所在地）
  merge_key 格式: "profile:{维度}" 如 "profile:职业"
- preference: 用户偏好（编程风格、沟通方式、工具偏好）
  merge_key 格式: "pref:{主题}" 如 "pref:编程语言"
- entity: 实体知识（人物、组织、项目、技术栈）
  merge_key 格式: "entity:{名称}" 如 "entity:EvoClaw"
- correction: 用户对 Agent 的纠正
  merge_key 格式: "fix:{主题}" 如 "fix:不要用var"
- pattern: 可复用的工作流程模板
  merge_key 格式: "pattern:{流程名}"
- tool: 工具使用经验和技巧
  merge_key 格式: "tool:{工具名}"
- skill: Agent 学到的技能
  merge_key 格式: "skill:{技能名}"

### Independent 型（每条独立存储）
- event: 发生过的事件/情景
- case: Agent 处理过的具体案例

## L0/L1/L2 层级要求
- L0（一句话摘要）：中文，15-30 字，纯文本，作为向量索引键
- L1（结构化概览）：Markdown 格式，2-5 行，含要点
- L2（完整内容）：Markdown 格式，含完整背景、上下文和细节

## 输出格式

<extraction>
  <memories>
    <memory>
      <category>preference</category>
      <merge_key>pref:代码风格</merge_key>
      <l0>用户偏好 TypeScript strict 模式和函数式编程风格</l0>
      <l1>
## 代码风格偏好
- 语言: TypeScript strict 模式
- 范式: 函数式优先，避免 class
- 命名: camelCase 变量，PascalCase 类型
      </l1>
      <l2>
在讨论 EvoClaw 架构时，用户明确表示偏好 TypeScript strict 模式。
在 review 代码时，用户将 class-based 的实现改写为函数式，
并说明"class 在这个项目里没必要，纯函数更好测试"。
命名上，用户纠正了一处 snake_case 变量名，要求统一用 camelCase。
      </l2>
      <confidence>0.95</confidence>
      <scope>user</scope>
      <visibility>shared</visibility>
    </memory>
  </memories>

  <relations>
    <relation>
      <subject>entity:用户</subject>
      <predicate>works_on</predicate>
      <object>entity:EvoClaw</object>
    </relation>
  </relations>

  <!-- 对话无有效记忆时 -->
  <!-- <no_extraction reason="闲聊/问候，无信息量"/> -->
</extraction>

## 提取安全协议（借鉴 MemOS 四步裁决）
1. 来源验证：区分用户陈述 vs Agent 推测，仅提取用户明确表达的信息
2. 归属检查：确认主语是当前用户，不要把第三方信息归属到用户
3. 置信度评估：不确定的信息 confidence < 0.7，确定的 >= 0.9
4. 隐私边界：涉及敏感信息（密码、身份证、银行卡）不提取，标注 <sensitive_skip/>
```

---

## 4. 记忆检索：三阶段渐进加载

### 4.1 完整检索流程

```
用户消息
    │
    ▼
┌──────────────────────────────────────────┐
│ Phase 0: 查询理解（纯逻辑，不调 LLM）      │
│ · 关键词提取                               │
│ · 时间表达式识别（"上周讨论的"→日期范围）    │
│ · 查询类型判断：事实型/偏好型/事件型/技能型  │
└──────────┬───────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ Phase 1: L0 宽检索（~50ms）                │
│ · FTS5 关键词搜索 l0_index（权重 0.3）     │
│ · sqlite-vec 向量搜索 L0 embedding（0.5）  │
│ · knowledge_graph 关系扩展（0.2）           │
│   → 如果查询提到"EvoClaw"，                 │
│     图查询找到 EvoClaw→uses→TypeScript，    │
│     把 TypeScript 相关记忆也拉进来          │
│ · 返回 Top-30 候选 { id, l0, category,     │
│   activation, score }                      │
└──────────┬───────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ Phase 2: 排序 + L1 精筛                    │
│ · finalScore = searchScore                 │
│   × hotness(activation, access, age)       │
│   × categoryBoost(queryType, category)     │
│   × correctionBoost (correction 类 +0.15)  │
│ · 去重：同 merge_key 只保留最新             │
│ · 可见性过滤（private/shared/channel_only） │
│ · 取 Top-10，加载 L1 overview               │
│ · 按 category 分组格式化                    │
└──────────┬───────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│ Phase 3: L2 按需深加载                     │
│ · 触发条件（任一满足）：                     │
│   a) 用户消息含追问信号                      │
│      （"详细说说/具体是什么/当时怎么..."）    │
│   b) L1 中包含 "[详情已省略]" 标记           │
│   c) category=case 且 queryType=技能型      │
│      （需要完整案例作为 few-shot）            │
│ · 仅加载触发条件匹配的记忆的 L2              │
│ · Token 预算控制：L2 总量 ≤ 8K tokens        │
└──────────┬───────────────────────────────┘
           │
           ▼
  组装注入上下文
```

### 4.2 Category Boost 矩阵

```typescript
const CATEGORY_BOOST: Record<string, Record<string, number>> = {
  // queryType → category → boost
  factual:    { entity: 0.12, profile: 0.10 },
  preference: { preference: 0.15, correction: 0.12 },
  temporal:   { event: 0.15, case: 0.10 },
  skill:      { skill: 0.12, pattern: 0.10, tool: 0.08, case: 0.08 },
  general:    {},  // 无 boost
}
```

### 4.3 Hotness 衰减公式

```typescript
function hotness(accessCount: number, lastAccessAt: number, now: number): number {
  const ageDays = (now - (lastAccessAt || now)) / 86400000
  const freq = sigmoid(Math.log1p(accessCount))
  const recency = Math.exp(-0.099 * ageDays)  // 半衰期 7 天
  return Math.max(0.01, freq * recency)  // 最低 0.01，不归零
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}
```

---

## 5. ContextPlugin 生命周期

### 5.1 接口定义

```typescript
interface ContextPlugin {
  name: string
  priority: number  // 执行顺序，数字小的先执行

  /** Agent 首次启动/加载时（一次性初始化） */
  bootstrap?(ctx: BootstrapContext): Promise<void>

  /** 每轮对话前（串行，可修改 ctx） */
  beforeTurn?(ctx: TurnContext): Promise<TurnContext>

  /** 上下文 token 即将超限时（串行，必须减少 token） */
  compact?(ctx: CompactContext): Promise<CompactContext>

  /** 每轮对话后（并行，异步不阻塞响应） */
  afterTurn?(ctx: TurnContext, response: LLMResponse): Promise<void>

  /** Agent 停止/卸载时（清理资源） */
  shutdown?(ctx: ShutdownContext): Promise<void>
}
```

### 5.2 完整插件列表

```typescript
const plugins: ContextPlugin[] = [
  // --- beforeTurn 阶段（串行，按 priority 排序） ---
  new SessionRouterPlugin(),       // priority: 10, 解析 Session Key，确定可见性范围
  new PermissionPlugin(),          // priority: 20, 权限检查
  new ContextAssemblerPlugin(),    // priority: 30, 组装 SOUL.md + USER.md + 历史消息
  new MemoryRecallPlugin(),        // priority: 40, 三阶段记忆检索 + 注入
  new RAGPlugin(),                 // priority: 50, 知识库语义检索 + 文档注入
  new ToolRegistryPlugin(),        // priority: 60, 注册可用 Tool/Skill/MCP

  // --- compact 阶段（token 超限时触发，逆序执行） ---
  // MemoryRecallPlugin.compact:  降级为仅注入 L0 索引
  // ContextAssemblerPlugin.compact:  截断历史消息到最近 N 轮
  // RAGPlugin.compact:  移除低相关度文档

  // --- afterTurn 阶段（并行，异步） ---
  new MemoryExtractPlugin(),       // 记忆提取 pipeline（Stage 1-3）
  new EvolutionPlugin(),           // 进化评分 + 能力图谱更新
  new GapDetectionPlugin(),        // 能力缺口检测 + Skill 推荐
  new HeartbeatPlugin(),           // 检查是否触发周期性行为
]
```

### 5.3 执行引擎

```typescript
class ContextEngine {
  private plugins: ContextPlugin[]

  async process(ctx: TurnContext): Promise<LLMResponse> {
    // 1. 串行执行 beforeTurn
    for (const p of this.plugins.sort((a, b) => a.priority - b.priority)) {
      if (p.beforeTurn) ctx = await p.beforeTurn(ctx)
    }

    // 2. 检查 token 预算
    while (ctx.estimatedTokens > ctx.model.contextWindow * 0.85) {
      // 逆序调用 compact（低优先级插件先压缩）
      for (const p of [...this.plugins].reverse()) {
        if (p.compact) ctx = await p.compact(ctx)
      }
      // 防止死循环
      if (ctx.estimatedTokens > ctx.model.contextWindow * 0.85) {
        ctx = forceTruncate(ctx)  // 兜底：硬截断历史消息
        break
      }
    }

    // 3. 调用 LLM
    const response = await this.callModel(ctx)

    // 4. 并行执行 afterTurn
    Promise.allSettled(
      this.plugins.map(p => p.afterTurn?.(ctx, response))
    ).catch(err => logger.error('afterTurn error', err))

    return response
  }
}
```

---

## 6. LCM 无损压缩与 L0/L1/L2 的关系

### 6.1 两者解决不同问题

| 机制 | 解决什么 | 作用对象 |
|------|---------|---------|
| **L0/L1/L2** | 长期记忆的存储和检索效率 | `memory_units` 表 |
| **LCM** | 当前对话的上下文窗口管理 | `conversation_log` + 实时消息 |

### 6.2 LCM 触发流程

```
对话进行中，消息累积
    │
    ├─ token < 85% 上限 → 正常对话，不触发任何压缩
    │
    ├─ token ≥ 85% 上限 → compact 钩子触发
    │   │
    │   ├─ MemoryRecallPlugin.compact:
    │   │   记忆注入从 L1 降级为 L0（节省 ~60%）
    │   │
    │   ├─ ContextAssemblerPlugin.compact:
    │   │   历史消息压缩（LCM 核心）
    │   │   · 保留最近 3 轮原始消息
    │   │   · 更早的消息调用 LLM 生成摘要
    │   │   · 摘要存入 conversation_log（compaction_status='compacted'）
    │   │   · 原始消息标记为 'extracted' 但不删除
    │   │
    │   └─ RAGPlugin.compact:
    │       移除相关度最低的文档片段
    │
    └─ compact 后仍超限 → forceTruncate 硬截断
```

### 6.3 LCM 压缩核心逻辑

```typescript
class ContextAssemblerPlugin implements ContextPlugin {
  async compact(ctx: CompactContext): Promise<CompactContext> {
    const messages = ctx.conversationMessages
    if (messages.length <= 6) return ctx  // 3 轮以内不压缩

    // 保留最近 3 轮（6 条消息）
    const recent = messages.slice(-6)
    const older = messages.slice(0, -6)

    // 对更早的消息生成摘要
    const summary = await ctx.modelRouter.call(ctx.agentId, `
      请将以下对话压缩为简洁的摘要，保留所有关键决策、结论和待办事项：
      ${formatMessages(older)}
    `)

    // 存储摘要到 conversation_log
    await this.db.insert('conversation_log', {
      agent_id: ctx.agentId,
      session_key: ctx.sessionKey,
      role: 'system',
      content: `[对话摘要] ${summary}`,
      compaction_status: 'compacted',
    })

    // 标记原始消息为已提取
    for (const msg of older) {
      await this.db.update('conversation_log', msg.id, {
        compaction_status: 'extracted'
      })
    }

    // 替换上下文中的消息
    ctx.conversationMessages = [
      { role: 'system', content: `[之前的对话摘要]\n${summary}` },
      ...recent
    ]
    return ctx
  }
}
```

---

## 7. 进化引擎

### 7.1 EvolutionPlugin

```typescript
class EvolutionPlugin implements ContextPlugin {
  async afterTurn(ctx: TurnContext, response: LLMResponse): Promise<void> {
    // 1. 能力图谱更新
    const usedCapabilities = detectCapabilities(ctx, response)
    await this.updateCapabilityGraph(ctx.agentId, usedCapabilities)

    // 2. 用户满意度信号检测
    const satisfaction = detectSatisfaction(ctx, response)
    await this.recordFeedback(ctx.agentId, satisfaction)

    // 3. 成长向量计算
    const growth = await this.computeGrowthVector(ctx.agentId)
    await this.updateGrowthVector(ctx.agentId, growth)
  }
}
```

### 7.2 能力图谱表

```sql
CREATE TABLE capability_graph (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL,
  capability  TEXT NOT NULL,     -- 'coding', 'translation', 'analysis'...
  level       REAL NOT NULL DEFAULT 0.0,  -- 0.0-1.0 熟练度
  use_count   INTEGER NOT NULL DEFAULT 0,
  success_rate REAL NOT NULL DEFAULT 0.0,
  last_used_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(agent_id, capability)
);
```

---

## 8. Agent 文件体系

### 8.1 三文件结构

```
~/.evoclaw/agents/{id}/
├── SOUL.md          # 人格定义（静态配置）
│                     # 含：角色、语气、专长、约束、可用工具声明
│                     # 对应 OpenClaw: SOUL.md + IDENTITY.md + AGENTS.md
│
├── USER.md          # 用户画像（从 memory_units 动态渲染）
│                     # bootstrap 时从 profile + preference + correction 生成
│                     # 对应 OpenClaw: USER.md + MEMORY.md 的用户部分
│
└── HEARTBEAT.md     # 周期性行为规则（静态配置）
                      # 含：触发条件、执行动作、频率
                      # 对应 OpenClaw: HEARTBEAT.md
```

### 8.2 USER.md 动态渲染逻辑

USER.md 不手写，而是从数据库渲染。长期记忆全在 SQLite 的 `memory_units` 表中，.md 文件仅作为人类可读的快照，不承载动态数据。

```typescript
async function renderUserMd(agentId: string, db: Database): Promise<string> {
  // profile 类：基本信息
  const profiles = await db.all(`
    SELECT l1_overview FROM memory_units
    WHERE agent_id = ? AND category = 'profile' AND archived_at IS NULL
    ORDER BY updated_at DESC
  `, agentId)

  // preference 类：偏好设定
  const prefs = await db.all(`
    SELECT l1_overview FROM memory_units
    WHERE agent_id = ? AND category = 'preference' AND archived_at IS NULL
      AND activation > 0.3
    ORDER BY activation DESC LIMIT 30
  `, agentId)

  // correction 类：纠正记录（高优先级，全部加载）
  const corrections = await db.all(`
    SELECT l1_overview FROM memory_units
    WHERE agent_id = ? AND category = 'correction' AND archived_at IS NULL
    ORDER BY updated_at DESC
  `, agentId)

  // 关系网络：从 knowledge_graph 提取
  const relations = await db.all(`
    SELECT m1.l0_index as subject, kg.predicate,
           COALESCE(m2.l0_index, kg.object_literal) as object
    FROM knowledge_graph kg
    JOIN memory_units m1 ON kg.subject_id = m1.id
    LEFT JOIN memory_units m2 ON kg.object_id = m2.id
    WHERE kg.agent_id = ?
    ORDER BY kg.updated_at DESC LIMIT 20
  `, agentId)

  return `# 用户画像

## 基本信息
${profiles.map(p => p.l1_overview).join('\n')}

## 偏好与习惯
${prefs.map(p => `- ${p.l1_overview}`).join('\n')}

## 重要纠正（务必遵守）
${corrections.map(c => `- ⚠️ ${c.l1_overview}`).join('\n')}

## 关系网络
${relations.map(r => `- ${r.subject} → ${r.predicate} → ${r.object}`).join('\n')}
`
}
```

---

## 9. 反馈循环防护与文本清洗

### 9.1 注入标记

```typescript
const MARKERS = {
  memoryStart: '\u200b\u200b[EVOCLAW_MEM_START]\u200b\u200b',
  memoryEnd:   '\u200b\u200b[EVOCLAW_MEM_END]\u200b\u200b',
  ragStart:    '\u200b\u200b[EVOCLAW_RAG_START]\u200b\u200b',
  ragEnd:      '\u200b\u200b[EVOCLAW_RAG_END]\u200b\u200b',
} as const
```

### 9.2 文本清洗（存储前）

```typescript
function sanitizeForExtraction(text: string): string | null {
  let cleaned = text

  // 1. 剥离注入的记忆/RAG 上下文
  for (const [start, end] of [
    [MARKERS.memoryStart, MARKERS.memoryEnd],
    [MARKERS.ragStart, MARKERS.ragEnd],
  ]) {
    const regex = new RegExp(
      `${escapeRegex(start)}[\\s\\S]*?${escapeRegex(end)}`, 'g'
    )
    cleaned = cleaned.replace(regex, '')
  }

  // 2. 剥离元数据 JSON 块
  cleaned = cleaned.replace(/```json\s*\{[\s\S]*?"metadata"[\s\S]*?\}\s*```/g, '')

  // 3. 过滤命令消息
  if (/^\/\w+/.test(cleaned.trim())) return null

  // 4. CJK 感知的最小长度检查（借鉴 OpenViking）
  const hasCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(cleaned)
  const minLen = hasCJK ? 4 : 10
  if (cleaned.trim().length < minLen) return null

  // 5. 截断超长内容
  const MAX_CHARS = 24000
  if (cleaned.length > MAX_CHARS) {
    cleaned = cleaned.slice(0, MAX_CHARS)
  }

  return cleaned.trim()
}
```

---

## 10. 衰减与归档生命周期

### 10.1 衰减调度器

每小时执行一次，更新所有非钉选、非归档记忆的 activation 值：

```typescript
class DecayScheduler {
  async tick(): Promise<void> {
    const now = Date.now()

    // 1. 计算所有非钉选、非归档记忆的 hotness
    const memories = await this.db.all(`
      SELECT id, access_count, last_access_at, activation
      FROM memory_units
      WHERE pinned = 0 AND archived_at IS NULL
    `)

    for (const mem of memories) {
      const newActivation = hotness(mem.access_count, mem.last_access_at, now)
      if (Math.abs(newActivation - mem.activation) > 0.01) {
        await this.db.update('memory_units', mem.id, {
          activation: newActivation,
          updated_at: now
        })
      }
    }

    // 2. 归档冷记忆（activation < 0.1 且 30 天未访问）
    const thirtyDaysAgo = now - 30 * 86400000
    await this.db.run(`
      UPDATE memory_units
      SET archived_at = ?
      WHERE pinned = 0 AND archived_at IS NULL
        AND activation < 0.1 AND last_access_at < ?
    `, now, thirtyDaysAgo)
  }
}
```

### 10.2 召回时激活

```typescript
async function bumpActivation(ids: string[]): Promise<void> {
  const now = Date.now()
  await db.run(`
    UPDATE memory_units
    SET access_count = access_count + 1,
        last_access_at = ?,
        activation = MIN(1.0, activation + 0.1),
        updated_at = ?
    WHERE id IN (${ids.map(() => '?').join(',')})
  `, now, now, ...ids)
}
```

---

## 11. 完整模块总览

```
packages/core/src/
├── context/
│   ├── context-engine.ts          # ContextPlugin 引擎（5 钩子调度）
│   ├── plugin.interface.ts        # ContextPlugin 接口定义
│   └── plugins/
│       ├── session-router.ts      # Session Key 路由 + 可见性
│       ├── permission.ts          # 权限检查
│       ├── context-assembler.ts   # SOUL.md + USER.md + 历史消息组装 + LCM 压缩
│       ├── memory-recall.ts       # 三阶段记忆检索
│       ├── rag.ts                 # 知识库检索
│       ├── tool-registry.ts       # Tool/Skill/MCP 注册
│       ├── memory-extract.ts      # 记忆提取 pipeline
│       ├── evolution.ts           # 进化评分 + 能力图谱
│       ├── gap-detection.ts       # 能力缺口检测
│       └── heartbeat.ts           # 周期性行为
├── memory/
│   ├── memory-store.ts            # memory_units CRUD
│   ├── knowledge-graph.ts         # knowledge_graph CRUD + 图查询
│   ├── hybrid-searcher.ts         # FTS5 + sqlite-vec 混合搜索
│   ├── extraction-prompt.ts       # 提取 prompt 模板
│   ├── xml-parser.ts              # 提取结果 XML 解析
│   ├── text-sanitizer.ts          # 文本清洗 + 反馈循环防护
│   ├── decay-scheduler.ts         # 衰减 + 归档调度
│   ├── merge-resolver.ts          # merge 型记忆的 upsert 逻辑
│   └── user-md-renderer.ts        # USER.md 动态渲染
├── agent/
│   ├── agent-engine.ts            # Agent 生命周期管理
│   ├── soul-parser.ts             # SOUL.md 解析
│   └── agent-builder.ts           # 会话式创建引导
├── evolution/
│   ├── capability-graph.ts        # 能力图谱
│   ├── growth-tracker.ts          # 成长向量
│   └── feedback-detector.ts       # 满意度信号检测
├── channel/
│   ├── session-key.ts             # Session Key 生成 + 解析
│   ├── visibility-filter.ts       # 记忆可见性过滤
│   └── adapters/
│       ├── desktop.ts
│       ├── feishu.ts
│       ├── wecom.ts
│       └── qq.ts
├── infrastructure/
│   ├── db/
│   │   ├── sqlite-store.ts
│   │   ├── vector-store.ts
│   │   ├── fts-store.ts
│   │   └── migrations/
│   │       ├── 001_initial.sql
│   │       ├── 002_memory_units.sql
│   │       ├── 003_knowledge_graph.sql
│   │       ├── 004_capability_graph.sql
│   │       └── 005_conversation_log.sql
│   ├── model/
│   │   └── model-router.ts
│   └── security/
│       ├── keychain.ts
│       └── crypto.ts
└── server.ts                      # Hono HTTP 入口
```

---

## 12. AutoDream 记忆整合

> 参考 Claude Code 的 AutoDream 机制。EvoClaw 已有记忆的"生产"（提取 Pipeline）和"消费"（混合检索），AutoDream 补齐"维护"环节。

### 12.1 触发条件（渐进门控）

```
1. 距上次整合 >= 24 小时?           ← 查 consolidation_log
  ↓
2. 上次整合后 >= 5 个新会话?         ← 查 conversation_log distinct session_key
  ↓
3. 无其他进程在整合?                 ← 锁文件检查
  ↓
触发整合
```

### 12.2 锁机制

```
锁文件: {dataDir}/agents/{agentId}/.consolidation.lock
内容: 持有者 PID
有效期: 1 小时（超时自动接管）

获取: 写入 PID → 成功
检查: 已有锁 → PID 存活 + mtime < 1h → 阻塞; 否则 → 接管
失败回滚: 更新 consolidation_log 状态为 'failed'
```

### 12.3 四阶段整合流程

```
┌──────────────────────────────────────────────────┐
│  Phase 1: Orient                                 │
│  加载所有非归档记忆的统计信息                       │
│  分析类别分布、重复 merge_key、矛盾信号             │
├──────────────────────────────────────────────────┤
│  Phase 2: Gather                                 │
│  按类别分组，找候选合并组:                          │
│  - 同 merge_key 多版本                            │
│  - 语义重叠（L0 相似度 > 0.85）                    │
│  - 矛盾事实（同 entity 不同属性值）                 │
├──────────────────────────────────────────────────┤
│  Phase 3: Consolidate (LLM)                      │
│  输入: 候选合并组 + 统计信息                        │
│  LLM 输出 XML:                                   │
│  <consolidation>                                 │
│    <merge id="..." into="...">新L1/L2</merge>    │
│    <create category="...">新记忆</create>         │
│    <archive id="..." reason="..."/>              │
│  </consolidation>                                │
│  约束: L0 保持稳定, 相对日期→绝对日期               │
├──────────────────────────────────────────────────┤
│  Phase 4: Prune                                  │
│  在事务内执行 Consolidate 输出的所有操作             │
│  写入 consolidation_log 记录                      │
│  更新 FTS5 索引                                   │
└──────────────────────────────────────────────────┘
```

### 12.4 数据模型

```sql
CREATE TABLE IF NOT EXISTS consolidation_log (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',  -- running|completed|failed
  memories_merged INTEGER DEFAULT 0,
  memories_pruned INTEGER DEFAULT 0,
  memories_created INTEGER DEFAULT 0,
  error_message TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
```

### 12.5 调度

- 独立 `MemoryConsolidator` 类（非 ContextPlugin），与 `DecayScheduler` 同级
- 每小时检查一次所有 Agent 的 `shouldRun()` 条件
- 在 `server.ts` 启动时实例化

---

## 13. 会话记忆摘要

> 独立于 Kernel 三层压缩（Snip/Microcompact/Autocompact），Session Memory 是持久化的会话级运行笔记。

### 13.1 触发阈值

| 参数 | 值 | 说明 |
|------|-----|------|
| `INIT_THRESHOLD` | 10,000 tokens | 首次摘要触发 |
| `UPDATE_THRESHOLD` | 5,000 tokens | 增量更新间隔 |
| `TOOL_CALL_THRESHOLD` | 3 次 | 或每 3 次工具调用 |

### 13.2 工作方式

```
会话进行中
  ↓
afterTurn → 累加 token/turn/toolCall 计数
  ↓
达到阈值?
  ├─ 有已有摘要 → 增量更新（"以下是之前的摘要...新增的对话..."）
  └─ 无已有摘要 → 全量摘要
  ↓
UPSERT session_summaries 表（per-agent per-session_key 唯一）
```

### 13.3 会话恢复注入

```
beforeTurn（首轮，cumulativeTurns === 0）
  ↓
读取 session_summaries 表
  ↓
有已有摘要? → 注入 ctx.injectedContext: "## 上次会话摘要\n{summary}"
```

### 13.4 数据模型

```sql
CREATE TABLE IF NOT EXISTS session_summaries (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  summary_markdown TEXT NOT NULL,
  token_count_at INTEGER NOT NULL,
  turn_count_at INTEGER NOT NULL,
  tool_call_count_at INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_summary_key
  ON session_summaries(agent_id, session_key);
```

### 13.5 与 Kernel 压缩的区别

| 维度 | Kernel 压缩 | Session Memory |
|------|-------------|----------------|
| 目的 | 控制 LLM 上下文窗口 | 持久化会话记录 |
| 存储 | 替换 messages 数组 | 独立表 |
| 生命周期 | 单会话内有效 | 跨会话可用 |
| 触发 | token 超预算 | 周期性（token/turn/toolCall） |

---

## 14. 记忆运维保障

### 14.1 新鲜度警告

**召回时过期标记**:
- `daysSinceUpdate > 1`: `[⚠ {N}天前]`
- `daysSinceUpdate > 7`: `[⚠ 较旧: {N}天前，建议验证]`

**系统提示词漂移告诫**:
```
记忆可能随时间过期。使用超过1天的记忆前，请验证其是否仍然正确。
如果记忆与当前状态矛盾，信任当前观察并更新记忆。
```

`SearchResult` 接口新增 `updatedAt: string` 字段，由 `hybrid-searcher.ts` 从 `MemoryUnit` 传递。

### 14.2 提取互斥防护

```
afterTurn 提取前检查:
1. inProgress? → 跳过（防并发）
2. lastProcessedMsgId === 当前最后消息ID? → 跳过（防重处理）
3. ctx.messages 包含 memory_search/memory_get/knowledge_query 工具调用?
   → 跳过（Agent 已主动操作记忆，避免重复提取）
```

状态管理: 工厂函数闭包内维护 `lastProcessedMsgId`、`inProgress` 标志。

### 14.3 Prompt Cache 共享

**目标**: 记忆提取 LLM 调用复用静态提示词前缀的 prompt cache。

**实现**:
- `buildExtractionPrompt()` 返回 `SystemPromptBlock[]`，静态部分标记 `cache_control`
- `LLMCallWithBlocksFn` 类型接受 blocks 而非纯字符串
- Anthropic 协议直接传递 blocks，OpenAI 协议拼接为纯文本

### 14.4 LLM 相关性精选

**触发条件**: 仅高价值场景
- `isExplicitRecall`: 用户显式召回（"你记得"、"之前"、"上次"）
- `needsDetail`: query-analyzer 判定

**流程**: HybridSearcher Phase 2 结果 → `LlmReranker.rerank()` → 替换 Top-N

---

## 15. 用户触达层（Sprint 15.12）

> 增加于 2026-04-09。前面 1-14 节描述的是"记忆系统的引擎"——存储、检索、整合、防护。本节描述的是 Sprint 15.12 加入的"用户触达层"——让企业普通员工（非开发者）能**看见、控制、信任** Agent 的记忆。

### 15.1 设计动机

Sprint 15.9 完成时，记忆系统的后端能力已经超过 Claude Code（L0/L1/L2 三层、9 类别 merge、知识图谱、热度衰减、混合检索、零宽防反馈、AutoDream、Session Summary、Prompt Cache、LLM 精选）。但**用户感知不到这些能力**：

- 用户说"记住 X" → 只能等后台 `afterTurn` 异步抽取，得不到即时确认
- 用户想知道 AI 记得什么 → 没有界面入口
- 用户发现 AI 记错了 → 没有纠正机制
- AI 召回了几条记忆 → 用户不知道用了哪几条
- 用户怀疑某条记忆不准 → 无反馈通道

Sprint 15.12 在不动后端引擎的前提下，把这些能力**端到端暴露给用户**。

### 15.2 五个 Phase 闭环

```
Phase A: 5 个 LLM 写工具 + 退役 diary 文件路径
   memory_write / memory_update / memory_delete /
   memory_forget_topic / memory_pin
        ↓
Phase B: routes/memory.ts 5 个新端点 + memory_feedback 表
   PUT /units/:id            (编辑 L1/L2，L0 锁死)
   POST /units/:id/feedback  (反馈 + confidence -= 0.15)
   GET /knowledge-graph
   GET /consolidations
   GET /session-summaries
        ↓
Phase C: 召回元数据 SSE 透传 + 前端编辑/反馈/新鲜度
   memory-recall plugin → ctx.recallMeta
   chat.ts → SSE event 'recall_meta'
   MemoryPage 详情面板：编辑/反馈按钮
   MemoryRow 列表：新鲜度徽章
        ↓
Phase D: MemoryPage 顶部 Tab 切换
   记忆 / 知识图谱 / 整理历史 / 会话摘要
        ↓
Phase E: ChatPage Show Your Work 折叠条
   "💭 本轮用到 N 条记忆 ▸"
   展开 → 列出 [类别] L0 摘要 N% [不准]
   "不准" → POST feedback → confidence 降权
```

### 15.3 LLM 工具层（Phase A）

5 个新 LLM 工具，全部走 `memory-store.ts` 现有 CRUD，工具内部都做 `agentId` 越权检查（拒绝跨 Agent 操作）：

| 工具 | 触发场景 | 内部行为 |
|---|---|---|
| `memory_write` | 用户说"记住 X" | INSERT memory_units，confidence=0.9，merge_key 自动从 category+l0 派生 |
| `memory_update` | 用户说"改一下/不对" | UPDATE l1_overview / l2_content（**L0 锁死**，是检索锚点） |
| `memory_delete` | 用户说"删掉这条" | UPDATE archived_at = now (软删除，可恢复) |
| `memory_forget_topic` | 用户说"忘掉所有 X" | FTS5 搜出匹配 → 批量 archive |
| `memory_pin` | 用户说"这条很重要" | UPDATE pinned = 1 (免疫热度衰减) |

**关键设计**：这 5 个工具加进了 `permission-interceptor.ts:AUTO_ALLOW_TOOLS`，与 `kill_agent`/`spawn_agent` 同级——属于 Agent 自管理范畴，**不触发权限弹窗**。

**退役本地 diary 文件**：原来 Agent 的 BOOTSTRAP.md / AGENTS.md 模板里有"用 write 工具改 USER.md / 写 memory/YYYY-MM-DD.md 日记"的指令，导致 Agent 走 3-8 turn 的 bash/write/edit 老路径。Phase A.4 全部退役：

- `agent-manager.ts` 不再 `mkdir memory/` 子目录
- AGENTS.md 模板的 "Memory System" 段重写成 DB-first 工具表
- BOOTSTRAP.md 模板（agent-builder + agent-manager 两份）改成"用 memory_write 存用户信息"
- `memory-flush.ts` 重构：紧急持久化白名单从 `[read, write]` 改为 `[read, memory_search, memory_write]`
- `context-compactor.ts` 压缩后恢复指令从"读今天的 memory/YYYY-MM-DD.md"改成"调用 memory_search"

### 15.4 反馈表与 confidence 衰减（Phase B）

**`memory_feedback` 表**（migration 025）：

```sql
CREATE TABLE memory_feedback (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL FK→memory_units ON DELETE CASCADE,
  agent_id TEXT NOT NULL FK→agents ON DELETE CASCADE,
  type TEXT CHECK IN ('inaccurate', 'sensitive', 'outdated'),
  note TEXT,
  reported_at TEXT,
  resolved_at TEXT
);
```

**衰减常数**：`CONFIDENCE_DECAY_STEP = 0.15`，每次反馈 `confidence = max(0, current - 0.15)`，下限 0 不变成负数。

**为什么不做硬删除**：用户的反馈是一个信号，不是判决。`AutoDream` 整合时把低 confidence 的记忆优先合并/裁剪——这比"用户点一下就删"更可控，且可恢复。

**为什么是 routes 层做 confidence 更新而不是 store**：保持 `MemoryFeedbackStore` 单一职责（CRUD `memory_feedback`），衰减是路由层的协调动作（写 feedback 表 + 改 memory_units 两表）。

### 15.5 召回元数据透传（Phase C / E）

**`TurnContext.recallMeta`** 字段，由 `memory-recall` 插件在 `beforeTurn` 写入：

```ts
recallMeta?: {
  memoryIds: string[];
  scores: number[];
  l0Indexes: string[];   // Phase E 加，避免前端再 GET 单条
  categories: string[];  // Phase E 加，同上
}
```

四个数组平行索引（同一记忆在四个数组里下标相同）。

**`chat.ts`** 在 SSE 流末尾（`pendingPermissions` 之前）发 `recall_meta` 事件：

```ts
if (turnCtx.recallMeta && turnCtx.recallMeta.memoryIds.length > 0) {
  await stream.writeSSE({
    event: 'recall_meta',
    data: JSON.stringify(turnCtx.recallMeta),
  });
}
```

**前端 ChatPage** 监听这个事件，把 payload 通过 `setLastMessageRecallMeta(meta)` 附加到当前 streaming 的 assistant 消息上。`MessageBubble` 在渲染时检测到 `message.recallMeta` 就在顶部显示 `<RecallMetaBar>`。

### 15.6 前端记忆中心（Phase C / D）

**MemoryPage** 在 Sprint 15.12 之前已经有完整的"列表 + 详情"布局。Phase C/D 加了：

- **顶部 4 Tab 切换**：`记忆` / `知识图谱` / `整理历史` / `会话摘要`
- **新鲜度徽章**：`MemoryRow` 按 `updatedAt` 计算天数，>1 天黄、>7 天红，与后端 `computeStalenessTag()` 阈值一致
- **置信度 vs 热度区分**：列表项原来用无标签的 `ActivationDot` 显示 67%，被用户误解为"置信度"。重构成 `ConfidenceDot`（"信 N%"，列表用，反馈会让它下降）+ `HotnessDot`（"热 N%"，仅搜索结果用）
- **编辑弹层**：`EditDialog`，L0 灰显锁死，L1/L2 textarea，调 `PUT /units/:id`
- **反馈弹层**：`FeedbackDialog`，3 选 1 type radio + note textarea，调 `POST /units/:id/feedback`
- **写后必 refetch**：`updateMemory` / `flagMemory` 不做乐观更新（脆弱），写完后立即 `GET /units/:id` 拉单条最新数据替换本地 → React 一定能看到引用变化触发 rerender

**知识图谱 Tab**：表格视图，不引入 force graph 库（节省 ~100KB bundle）。按 subject 分组，每行 `relation predicate | object | confidence%`。

**整理历史 Tab**：`consolidation_log` 卡片时间线，状态徽章（绿/黄/红）+ 起止时间 + 耗时 + 合并/裁剪/新建计数 + 错误信息。

**会话摘要 Tab**：`session_summaries` 可折叠卡片，header 显 session_key + token 数 + turn 数 + 工具调用数，展开用 `react-markdown` + `remark-gfm` 渲染。

### 15.7 Show Your Work 折叠条（Phase E）

**`RecallMetaBar`** 组件（`ChatPage.tsx`），渲染在每条 assistant 消息的顶部：

```
┌────────────────────────────────────┐
│ 💭 本轮用到 3 条记忆            ▸ │  ← 折叠状态
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ 💭 本轮用到 3 条记忆            ▾ │
├────────────────────────────────────┤
│ [偏好] 用户喜欢简洁回答  73% [不准]│  ← 展开后每行
│ [实体] 用户的女儿叫小满  68% [不准]│
│ [事件] 上周三的医生预约  45% [已反馈]│
└────────────────────────────────────┘
```

**"不准" 按钮**：调 `useMemoryStore().flagMemory(currentAgentId, memoryId, 'inaccurate')` → 走 Phase B 端点 → confidence 降权 → 下次召回排序变化。

按钮按下后立即变 `已反馈` 标签（不可重复点击）。

### 15.8 完整闭环

```
1. Phase A: Agent 调 memory_write 工具                       [写]
       ↓
2. Phase C: 下次 turn beforeTurn 调 hybrid-search 召回         [读]
       ↓
3. Phase E: chat.ts 发 SSE recall_meta，前端附加到 message    [透明]
       ↓
4. Phase E: 用户点 "不准" 按钮                                [反馈]
       ↓
5. Phase B: POST /feedback 写 memory_feedback + confidence-=  [降权]
       ↓
6. 下次召回: hybrid-search 因 confidence 下降而排序变化       [改善]
       ↓
7. Phase D: 用户在记忆中心可以看到、编辑、删除、导出           [可见]
       ↓
8. AutoDream: 整合时优先合并/裁剪 confidence 低的记忆          [清理]
```

每一步对应一个 Phase，每一步都有 e2e 测试覆盖。

### 15.9 不在 Sprint 15.12 范围内的事

差距分析阶段（`~/.claude/plans/expressive-skipping-puzzle.md`）讨论过但**有意不做**的：

- 隐私模式（Incognito Conversation）— 暂不考虑
- 团队共享记忆（TEAMMEM 类似机制）— 暂不考虑
- 记忆审计 / 修改日志 / 合规导出— 暂不考虑
- 多设备记忆同步 — 暂不考虑
- KAIROS 日志式记忆 — 与 Session Summary 重叠 80%
- 收紧到 4 类别（Claude Code 风格）— EvoClaw 9 类别对用户透明，是后端检索权重用
- 分叉 Agent 跑提取 — EvoClaw 同进程已经安全

这些可能进入 Sprint 16+ 的"v1.5 深度集成"或"v2.0 企业完整版"。

---

## 附录：研究来源

### MemOS Cloud OpenClaw Plugin
- 仓库：https://github.com/MemTensor/MemOS-Cloud-OpenClaw-Plugin
- 版本：v0.1.8，纯 JavaScript ESM，零依赖
- 核心贡献：反馈循环防护（零宽空格标记）、相关度阈值过滤、记忆安全四步裁决、会话隔离策略

### OpenViking OpenClaw Plugin
- 仓库：https://github.com/volcengine/OpenViking (examples/openclaw-memory-plugin/)
- 核心贡献：L0/L1/L2 三层分级存储、8 类记忆分类 + merge/independent 策略、hotness 衰减公式、viking:// URI 虚拟文件系统

### claude-mem OpenClaw Integration
- 文档：https://docs.claude-mem.ai/openclaw-integration
- 仓库：https://github.com/thedotmack/claude-mem (v10.5.5)
- 核心贡献：三层渐进检索（index → timeline → details）、AI 语义压缩（25K→1.1K tokens）、Observation 数据结构、MEMORY.md 同步机制
