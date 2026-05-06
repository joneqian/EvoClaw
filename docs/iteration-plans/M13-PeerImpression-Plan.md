# M13 #3 — 同事印象记忆（Peer Impression Memory）

> **决策路径**：P1-B 已收官 → P2 Memory Provider 抽象推迟 → M13 主体 + Phase 5 在 main → 用户从 6 项剩余 M13 候选中选定 #3「同事印象记忆」（~3d）。
> **状态**：方案待用户确认 → 建分支 → 落地。本 plan 收到 GO 后另行迁档到 `docs/iteration-plans/M13-PeerImpression-Plan.md`。

---

## 一、Context（为什么做）

M13 Team Mode 已支持多 Agent 在同一群聊协作（peer-roster / task-plan / escalation 全套），但 Agent **不记得"上一次和谁配合得怎样"**：

- Agent A 上周让 Agent B 写文档结果质量差 → 这周仍然第一时间 @B，重蹈覆辙
- Agent C 沟通直接但易急 → 协作方反复试错才摸到风格
- 同一群里多个 Agent 协作，缺"协作画像"作为派活/求助决策依据

**目标**：每次 team channel 协作完成后，让 Agent **自动从对话中提炼对 peer 的印象**（沟通风格 / 擅长领域 / 配合体验 / 上次任务结果），写入 `entity` 类记忆。下次同群再次互动时，注入到 system prompt，让派活、@、escalate 决策更聪明。

**目标用户视角**：企业里多个员工一起用 EvoClaw 各自的 Agent，"打过几次交道之后越来越懂对方"是真实价值，不是预埋抽象。

---

## 二、关键事实（来自三路探索）

### Memory 系统现状
- `entity` 类记忆已存在，自动 `merge` 语义（同 `merge_key` 去重保留高分版本）
- `memory_units` 表 **无** `entityId` / `linkedEntities` 字段 → 用 `merge_key='peer:{peerAgentId}'` 作唯一锚点
- `knowledge_graph` 表（subject/predicate/object 三元组）可挂 Agent-to-Agent 关系，predicate 自由文本
- 三阶段渐进检索（FTS5+向量 → L1 排序 → L2 加载）天然适配 entity 召回
- 系统 prompt 注入走 `memory-recall.ts` 的 `wrapMemoryContext()` + `<related_memories>` 段

### Team Mode 现状
- `peer-roster` 已能反查同群 active agents（`packages/core/src/agent/peer-roster.ts`）
- TeamMessageMetadata 已携带 `peerAgentId / taskId / chainDepth / mentionId`
- `prompt-fragment.ts` 在 `<team_mode>` 块注入 roster + active plans
- `task-plan` 状态机有 `dispatchReadyTasks() / update_task_status` 等关键钩点
- `escalation-service.ts` 已有 cron 5min 扫描

### 提取/触发参考
- 已有 `memory-extract.ts`（context plugin，afterTurn fire-and-forget，闭包 `inProgress` + 游标 `lastProcessedMsgId` 防重）
- P1-B `skill-inline-review-hook.ts`（fire-and-forget，sessionKey marker 守卫，10min 限速）
- 接入点已就绪：`channel-message-handler.ts` afterTurn 调用约在 963-978 行
- `migrations` 下一编号 = **038**

---

## 三、能力提升（Before / After / 机制）

| 维度 | Before（现状） | After（本期） | 机制 |
|---|---|---|---|
| Peer 协作画像 | Agent 每次见到 peer 都"陌生人"，roster 只有名字+role | 同群协作过的 peer 有"画像卡片"（风格/擅长/上次结果）注入 system prompt | afterTurn LLM 提取 entity 记忆，merge_key='peer:{peerAgentId}'；下次群聊注入 |
| 派活决策 | mention/任务分配主要看 role 描述 | 派活时模型可参考"上次让 B 写代码很慢，让 C 试试" | `<team_mode>` 块新增 `<peer_impressions>` 子段，每个 active peer 一行摘要 |
| Escalation 上下文 | 60min 升级时只带 task summary | 升级 prompt 含"该 peer 历史响应特征" | escalation-service 渲染时附带 peer impression 摘要 |
| 跨群学习 | 印象按群隔离 | 同 owner 下跨群聚合（同 peerAgentId 的多群印象 merge） | merge_key 不带 groupKey；可选字段 `lastSeenInGroup` 区分 |
| Observability | 无 | REST `/peer-impressions?agentId=X&peerAgentId=Y` 查最新印象，前端 Team Mode 调试页能看 | 复用 `/skill-evolution` 风格 endpoint |

---

## 四、设计方案

### 4.1 数据存储（不新建主表，复用 entity）

复用 `memory_units` 表，约束：
- `category = 'entity'`
- `merge_key = 'peer:{peerAgentId}'`（单 peer 唯一锚点；自动 merge 语义）
- `agent_id = ownerAgentId`（这条印象是"我"对 peer 的印象，不是双向）
- `l0Index`：≤80 字一行摘要（"擅长写代码、沟通直接、上次 PR 拖了 2 天"）
- `l1Overview`：JSON 结构化（200-500 字）
  ```json
  {
    "peerAgentId": "...",
    "peerName": "...",
    "collaborationStyle": "直接/含蓄/资料控/口语化",
    "strengths": ["代码", "排查 bug"],
    "frictions": ["拖延", "需求理解偏差"],
    "interactionCount": 3,
    "lastInteractionAt": "2026-05-06T...",
    "lastTaskOutcome": "完成/部分完成/未完成/搁置",
    "lastTaskSummary": "..."
  }
  ```
- `l2Content`：可选，最近 3 次互动的对话片段拼接（按需深加载）

**Migration 038**（最小化）：
```sql
-- 仅新增 1 个索引，加速 by-peer 查询
CREATE INDEX IF NOT EXISTS idx_memory_units_peer_entity
  ON memory_units(agent_id, merge_key)
  WHERE category = 'entity' AND merge_key LIKE 'peer:%' AND deleted_at IS NULL;
```

**Knowledge Graph 联动（轻量）**：
- 写入印象时同步 upsert 一条 `subject_id=memoryUnitId, predicate='impression_of', object_id='agent:{peerAgentId}'`
- 让"实体关系扩展检索"能从 peer 反查。**不强制**，先单测保留 hook，第二阶段视召回质量决定是否启用

### 4.2 提取器（新文件）

`packages/core/src/memory/peer-impression-extractor.ts`（~200 行）：
- 输入：`{ ownerAgentId, peerAgentId, peerName, recentMessages, existingImpression?, db, llmCall }`
- LLM prompt：参考 `memory-extractor.ts` 的 prompt 风格 + 专属 schema
  - 系统 prompt：你正在为 Agent {owner} 总结对同事 Agent {peer} 的印象，输出 JSON
  - 上下文：`existingImpression` 当前画像 + 最近互动消息
  - 输出 JSON schema（Zod 校验）：上述 l1Overview 结构 + `l0Summary` 字段
  - 失败安全：`safeParse` 不抛，记 warn 跳过本次
- LLM 走 ModelRouter 默认（同 memory-extract，企业用户不另配）
- 写入：调用 `memoryStore.upsert({...})`（已有 merge 逻辑）+ kg upsert hook

### 4.3 Hook（新文件，仿 skill-inline-review-hook）

`packages/core/src/memory/peer-impression-hook.ts`（~150 行）：

```ts
export async function triggerPeerImpressionExtraction(opts: {
  sessionKey: string
  ownerAgentId: string
  channelType: ChannelType
  groupSessionKey?: string
  recentMessages: Message[]
  db: SqliteDb
  log: Logger
  llmCall: LlmCall
}): Promise<void>
```

**守卫顺序（任一不满足直接 return）**：
1. **sessionKey marker 守卫**：含 `:cron: / :subagent: / :heartbeat: / :boot` 直接跳过（同 P1-B 模式）
2. **channel 守卫**：仅 team channel 群聊（peer-roster 能查到 ≥1 个同群 peer）
3. **peer 检测**：从 recentMessages 提取本轮真实互动的 peer 集合（@mention / from peer agent / task 改派接收方）
4. **限速**：每 (ownerAgentId, peerAgentId) 对，10min 内不重复提取（DB 字段 `last_extracted_at`，复用 memory_units 的 updated_at 即可）
5. **闭包防重入**：`Map<string, Promise>` 按 `owner:peer` 加锁

**fire-and-forget**：所有错误进 warn log，**不抛**。日志前缀 `[peer-impression]` 便于 grep。

### 4.4 系统 Prompt 注入

修改 `packages/core/src/agent/team-mode/prompt-fragment.ts`：
- 现有 `<team_mode>` 块新增子段 `<peer_impressions>`
- 仅在群聊时渲染，对当前群 active peer 做 N 个一行摘要（取 l0Index）
- 每个 peer 一行（≤100 token），最多 5 个 peer，token 预算 ≤500
- 字段格式：`- [peer:{name}] {l0Summary} (interactions={n}, last={ago})`

### 4.5 Observability

REST endpoint `packages/core/src/routes/peer-impression.ts`（参考 `skill-evolution.ts`）：
- `GET /peer-impressions?agentId=X` → 列出 owner 视角下所有 peer 印象
- `GET /peer-impressions/:peerAgentId?ownerAgentId=Y` → 单条 l2 详情
- 用于前端 Team Mode 调试页 / 排障

**结构化日志**（Dev Logging 必埋）：
- `[peer-impression][skip] reason={non-main-turn|not-team|no-peer|rate-limited|in-progress}`
- `[peer-impression][extract][start] owner={} peer={} msgCount={}`
- `[peer-impression][extract][done] owner={} peer={} llmMs={} writeMs={} merged={true|false}`
- `[peer-impression][extract][error] owner={} peer={} err={}`
- `[peer-impression][inject] group={} peerCount={} tokenEst={}`

### 4.6 前端影响评估（强制章节）

| 模块 | 影响 | 改动 |
|---|---|---|
| 主聊天页 | **无** | 印象注入是 system prompt 内部，用户不可见 |
| Team Mode 看板 | **无**（M13 看板暂未真实化） | — |
| Memory 调试页 / Settings | **可选** | entity 记忆列表已能看到这些条目（merge_key 前缀 `peer:`），无需改前端代码即可查 |
| 新前端页 | **不做** | endpoint 仅供后端排障/未来看板消费，不在本期范围 |

→ **本期前端零改动**。

---

## 五、Phase 拆分（~3d，3 PR）

### PR 1（~1d）— 数据 + 提取器骨架
**新增文件**：
- `packages/core/src/infrastructure/db/migrations/038_peer_impression_index.sql`
- `packages/core/src/memory/peer-impression-extractor.ts`
- `packages/core/src/memory/__tests__/peer-impression-extractor.test.ts`（≥6 case）
  - happy path（多消息 → 结构化 JSON → upsert）
  - 已有印象时 merge（interactionCount 累加、frictions 合并）
  - LLM 输出非法 JSON（safeParse 失败）→ 跳过 + warn
  - knowledge_graph 联动 hook（subject/predicate/object 写入）
  - sessionKey marker（cron/subagent）样本 → 跳过
  - 空 recentMessages → 跳过
**类型**：`packages/shared/src/types/memory.ts` 新增 `PeerImpressionL1` 接口

### PR 2（~1d）— Hook + 主流程接入
**新增**：
- `packages/core/src/memory/peer-impression-hook.ts`
- `packages/core/src/memory/__tests__/peer-impression-hook.test.ts`（≥5 case）
  - non-main-turn 跳过、非 team channel 跳过、无 peer 跳过、限速命中跳过、闭包防重入
**修改**：
- `packages/core/src/routes/channel-message-handler.ts`：在 afterTurn 后追加 `void triggerPeerImpressionExtraction(...)`，与 P1-B inline review hook 同位置
- `packages/core/src/routes/chat.ts`：同样位置补一份（保持双入口对称）
**端到端测试**：
- `peer-impression-hook.e2e.test.ts`：模拟双 Agent 群聊 → 触发 hook → 查 DB 验证 entity 记忆已写入

### PR 3（~0.5-1d）— Prompt 注入 + Observability
**修改**：
- `packages/core/src/agent/team-mode/prompt-fragment.ts`：新增 `<peer_impressions>` 子段渲染
- `packages/core/src/agent/team-mode/__tests__/prompt-fragment.test.ts`：新增 case 验证渲染、token 预算 ≤500、空印象时不渲染
**新增**：
- `packages/core/src/routes/peer-impression.ts`（GET 两个 endpoint + Zod query 校验）
- `packages/core/src/routes/__tests__/peer-impression.test.ts`（≥4 case）
- 注册到 `server.ts` 路由表

---

## 六、验证（端到端）

### 单测
```bash
cd packages/core
pnpm vitest run src/memory/__tests__/peer-impression-extractor.test.ts
pnpm vitest run src/memory/__tests__/peer-impression-hook.test.ts
pnpm vitest run src/agent/team-mode/__tests__/prompt-fragment.test.ts
pnpm vitest run src/routes/__tests__/peer-impression.test.ts
```
覆盖率目标：≥80%（rules/common/testing.md 强制）

### 集成（手测）
1. 启 sidecar：`pnpm dev:core`
2. 创建 2 个 Agent 加同 group binding，互发 3-5 轮含 @mention 的消息
3. `curl localhost:{port}/peer-impressions?agentId=A` → 应见 peer B 的印象 JSON
4. 第 4 轮新对话 → log 应见 `[peer-impression][inject] group=... peerCount=1`
5. 主 prompt（debug 模式可打印）的 `<team_mode>` 块应含 `<peer_impressions>` 子段

### 回归
- `pnpm test` 全包通过
- 群聊不发生 peer 互动时（纯单 Agent 对话）→ log 应见 `[peer-impression][skip] reason=no-peer`
- cron / heartbeat 触发的 turn → log 应见 `reason=non-main-turn`

---

## 七、风险与缓解

| 风险 | 缓解 |
|---|---|
| LLM 提取每轮都跑 → 成本/延迟 | 限速 10min/peer + 仅群聊 + 闭包防重入；fire-and-forget 不阻塞 |
| 印象偏见固化（一次糟糕互动永远黑名单） | merge 时新数据加权（exp 衰减旧 frictions），interactionCount ≥3 后才视为稳定 |
| 跨群印象污染 | merge_key 不带 group → 跨群聚合是**有意为之**；在 l1 加 `lastSeenInGroup` 字段保留来源 |
| 隐私泄露（peer 印象越界传播） | 印象写到 owner 的 memory_units（agent_id=ownerId），不暴露给 peer 自己；REST endpoint 不含跨 owner 查询 |
| 反馈循环（注入的印象被再次提取为印象） | 复用现有 `wrapMemoryContext` 零宽空格标记，extractor 跳过被标记的消息 |

---

## 八、不做（明确边界）

- ❌ 双向印象（A→B 和 B→A 互验）→ 第二期再说
- ❌ 印象 expire/手动覆盖工具 → 用户用现有 `memory_delete / memory_pin` 即可
- ❌ 前端可视化卡片 → 等 M13 #1 前端看板期统一做
- ❌ 跨 owner 的"组织级 peer 知识" → 隐私边界先不破
- ❌ Knowledge graph 在召回阶段的 peer 关系扩展 → 第二阶段评估召回质量后启用

---

## 九、待用户确认

- [ ] **方案 OK** → 我建分支 `feat/m13-peer-impression`，PR 1 先开
- [ ] **要调整哪些**（merge_key 规则 / token 预算 / 注入位置 / Phase 拆分）
- [ ] **是否同意"不做"列表**

GO 之后流程：建分支 → 把本 plan 迁档到 `docs/iteration-plans/M13-PeerImpression-Plan.md` → PR 1 起步。
