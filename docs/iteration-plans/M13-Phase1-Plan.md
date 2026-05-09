# M13 Phase 1 路由 + 跨渠道身份完整方案（基于 EvoClaw 桌面员工助手定位）

## Context

EvoClaw 业务真实形态：
- **桌面应用单租户**：每员工本地装一份
- **Agent registry**：员工自助创建多角色 Agent
- **1 Agent : 1 bot 应用**：每个 Agent 各自绑定飞书 bot 等
- **群协作**：员工在飞书群拉入多 bot，群消息触发多 Agent 协作
- **协作链路**：lead 调 `mention_peer` 主动 @ worker（PR #74 已完整实现）
- **DM**：跨渠道（飞书 / 企微 / 微信）默认连贯（D3 决策）

本次 Phase 1 不抄 OpenClaw 8 层路由（accountId → agentId 已 1 对 1，8 层是过度工程）。聚焦 4 个真实痛点 + 3 个遗漏的完整方案。

---

## 一、PR #74 已做（避免重复）

PR #74（2026-04-29，15147 行新增）+ M11.1 已完成：

| 能力 | 位置 |
|---|---|
| ✅ 飞书 4 档群隔离（group / group_sender / group_topic / group_topic_sender） | `channel/adapters/feishu/common/session-key.ts` |
| ✅ peerId 重写（`:topic:xxx` / `:sender:xxx` 后缀） | feishu inbound |
| ✅ peer-roster-service（团队发现 6 步流水线 + 5min TTL） | `agent/team-mode/peer-roster-service.ts` |
| ✅ mention-peer-tool（lead 主动 @ worker） | `agent/team-mode/mention-peer-tool.ts` |
| ✅ loop-guard 5 层熔断（链深度/速率/乒乓/自@自/硬熔断） | `agent/team-mode/loop-guard.ts` |
| ✅ task-plan service + tools | `agent/team-mode/task-plan/` |
| ✅ artifacts service | `agent/team-mode/artifacts/` |
| ✅ escalation-service（任务接力） | `agent/team-mode/escalation-service.ts` |
| ✅ team-channel-registry（按 group key 分发） | `agent/team-mode/team-channel-registry.ts` |
| ✅ migration 031（task_plans / tasks / task_artifacts 三表） | `migrations/031_team_mode.sql` |
| ✅ M13 #3 同事印象记忆（peer:* merge_key） | PR #108 |
| ✅ M13 Phase 5 飞书文档协作 | PR #88-92 + #142 |

**关键观察**：M13 多 Agent 协作主体已落地。本次 Phase 1 是**剩余 30% 的 polish + 跨渠道补全**，不是从零做大工程。

---

## 二、剩余痛点 + 遗漏（用户确认全做）

### 痛点 1 — 群内多任务并行 session 串扰
**根因**：员工不用飞书 topic 时，`group_topic` fallback 到 `group`，多任务串扰
**方案**：**per-task sessionKey 完整集成** — 复用 PR #74 已有的 `task_plans` 表，从 task_id 派生 sessionKey
- 当存在 active task_plan 时，sessionKey = `agent:{id}:feishu:group:{chatId}:task:{taskId}`
- 不存在 task 时 fallback 到现有 4 档 scope

### 痛点 2 — identityLinks 跨渠道身份分裂
**根因**：员工飞书 ou_xxx / 企微 userid_yyy / 微信 wxid_zzz 被识别为不同人
**方案**：DB 表 + UI + sessionKey 集成 + **memory_units 同步加 canonical 列锚定**
- `identity_links` 表（canonical_id + channel + peer_id）
- `memory_units` 加 `canonical_user_id` 列，extractor 在 LLM extract 后填 canonical
- 不仅解决 sessionKey 层合并，还锚定记忆层

### 痛点 3 — Agent 跨渠道上下文丢失
**根因**：DM 按 channel:peer 独立 sessionKey，跨渠道分裂
**方案**：mainSessionKey + dm_scope='main' 默认 + **conversation_log fallback 查询**
- DM 默认走 `agent:{id}:main`
- 切换到 main 时，main 查不到的会 fallback 查同 agent 历史 per-peer 记录
- 无损历史，新对话从 main 开始累积

### 痛点 4 — 群内 Agent 协作语义粗糙
**方案**：PR-1C 1d 调研 PR #74 实际 gap，可能 0 修

---

## 三、PR 拆分（4 PR / 8-11 工作日）

### PR-1A — mainSessionKey + DM 跨渠道连贯（2-3d）
**分支**：`feat/m13-phase1-main-session-key`

**范围**：
- migration 044：bindings 加 `dm_scope` 列（'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer'）
- `routing/session-key.ts`：
  - 新增 `generateMainSessionKey(agentId)` → `agent:{id}:main`
  - `generateSessionKey` 加 `dmScope` 形参，DM 按 dmScope 分支
  - DM 默认走 main（dm_scope='main'）
- `memory/conversation-logger.ts`：查询 main session 历史时，main 找不到 fallback 查同 agent 的 per-peer 历史
- `routes/channel-message-handler.ts`：从 binding 读 dm_scope 传给 generateSessionKey
- `apps/desktop/src/pages/BindingsPage.tsx`：暴露 dm_scope 字段（默认 main + per-peer 二选一，高级选项展开剩余 2 种）
- 飞书群 scope UI 默认改为 `group_topic`（解决痛点 1 的简单兜底，per-task 在 PR-1D 完美方案）
- 单测：4 种 dmScope 格式 + main fallback 查询 + 派生 lastRoutePolicy

### PR-1B — identityLinks 跨渠道身份 + memory 锚定（4-5d）
**分支**：`feat/m13-phase1-identity-links`

**范围**：
- migration 045：identity_links 表（canonical_id + channel + peer_id + UNIQUE(channel, peer_id)）
- migration 046：memory_units 加 `canonical_user_id` 列 + 索引
- 新模块 `routing/identity-links-store.ts`：CRUD + lookup（channel + peer_id → canonical）
- `routing/session-key.ts` 集成 lookupCanonical（peerId 查 identityLinks 命中替换为 canonical）
- `memory/memory-extractor.ts`：LLM extract 后填 canonical_user_id（基于当前 sessionKey 的 peerId 反查 identityLinks）
- `memory/memory-store.ts`：findByMergeKey 增加按 canonical_user_id 过滤选项
- REST endpoints `/identity-links`（GET / POST / DELETE）
- SettingsPage 新增"我的多渠道身份"区：列出绑定 + 添加 + 删除 + 测试链接按钮
- 单测：lookup 命中/miss / sessionKey 替换 / memory canonical 填充 / 反向查询

### PR-1C — PR #74 协作语义调研 + 补丁（0-1d，条件性）
**分支**：`feat/m13-phase1-collab-polish`（可能空 PR / 或并入其他）

**范围**：
- 1d 调研：peer-roster 注入范围 / @ 兜底准确性 / worker 收到 @ 后历史窗口 / 头像/昵称区分文档
- 实施时间在调研后定（推测 0-1d）
- 调研结论可能：所有 gap 已被 PR #74 覆盖 → PR-1C 跳过

### PR-1D — per-task sessionKey 完整集成（1-2d）
**分支**：`feat/m13-phase1-per-task-session`

**范围**：
- `routing/session-key.ts` 加 `taskId` 形参，dmScope='per-task' 时返回 `agent:{id}:{ch}:group:{chatId}:task:{taskId}`
- `routes/channel-message-handler.ts`：从 task-plan-service 查当前群 active task → 传 taskId
- 新 API `task-plan-service.findActiveTaskForGroup(groupSessionKey)` 返回当前活跃 task（如已存在）
- BindingsPage dm_scope 加 'per-task' 选项
- 集成测试：群内并行两个 task → 两个 sessionKey 完全隔离

---

## 四、关键文件改动总览

### 新增
- `packages/core/src/infrastructure/db/migrations/044_binding_dm_scope.sql`
- `packages/core/src/infrastructure/db/migrations/045_identity_links.sql`
- `packages/core/src/infrastructure/db/migrations/046_memory_canonical_user_id.sql`
- `packages/core/src/routing/identity-links-store.ts`
- `packages/core/src/routes/identity-links.ts`
- `apps/desktop/src/pages/SettingsPage.tsx`（新增"我的多渠道身份"区）
- `packages/core/src/__tests__/routing/session-key-dmscope.test.ts`
- `packages/core/src/__tests__/routing/identity-links-store.test.ts`
- `packages/core/src/__tests__/memory/canonical-user-id.test.ts`

### 修改
- `packages/core/src/routing/binding-router.ts`（Binding interface 加 dmScope）
- `packages/core/src/routing/session-key.ts`（dmScope + identityLinks + main + per-task 集成）
- `packages/core/src/memory/conversation-logger.ts`（fallback 查询）
- `packages/core/src/memory/memory-extractor.ts`（填 canonical_user_id）
- `packages/core/src/memory/memory-store.ts`（按 canonical 过滤）
- `packages/core/src/routes/channel-message-handler.ts`（dm_scope + taskId 注入）
- `packages/core/src/agent/team-mode/task-plan/service.ts`（加 findActiveTaskForGroup）
- `apps/desktop/src/pages/BindingsPage.tsx`（dm_scope 字段表单）

### 复用（不改）
- `packages/core/src/agent/team-mode/peer-roster-service.ts`（PR #74）
- `packages/core/src/agent/team-mode/mention-peer-tool.ts`（PR #74）
- `packages/core/src/agent/team-mode/loop-guard.ts`（PR #74）
- `packages/core/src/channel/adapters/feishu/common/session-key.ts`（M11.1）
- `packages/core/src/agent/peer-impression-store.ts`（PR #108）

---

## 五、决策点汇总

| 编号 | 议题 | 选择 |
|---|---|---|
| D1 | 是否照抄 OpenClaw 8 层路由 | ❌ 不抄（1 Agent : 1 bot 用不上） |
| D2 | 群消息默认 scope | **group_topic**（飞书 topic 自然映射） |
| D3 | DM 默认 dmScope | **main**（跨渠道连贯，2026-05-09 用户决策） |
| D4 | identityLinks 是否一开始做 UI | ✅ 做（不然没人用就死了） |
| D5 | PR 拆分节奏 | 4 PR 串行：1A 路由 → 1B 身份+memory → 1C 调研补丁 → 1D per-task |
| D6 | per-task sessionKey 是否做 | ✅ **完整集成 PR-1D**（用户决策） |
| D7 | identityLinks 是否锚定 memory_units | ✅ **同步加 canonical 列 PR-1B**（用户决策） |
| D8 | mainSessionKey 历史数据处理 | ✅ **fallback 查询 PR-1A**（用户决策，无损历史） |
| D9 | PR-1C 是否必做 | 条件性（1d 调研后定，可能跳过） |

---

## 六、风险

| 风险 | 缓解 |
|---|---|
| dmScope 改默认 main 导致行为变化 | 现有 binding 写入 dm_scope='per-peer' migration 时回填，不影响存量；新建 binding 默认 main |
| identityLinks 误绑定导致 sessionKey 错乱 | UI 加"测试链接"按钮 + 解绑入口显眼 + 错绑后回滚机制 |
| memory_units 加 canonical 列后旧数据 NULL | extractor 渐进填充：旧记忆查询时 NULL fallback；新提取时强制填 |
| conversation_log fallback 查询误命中 | fallback 限定"同 agent 同 peer 但不同 channel"，避免跨 agent 串数据 |
| per-task 集成依赖 PR #74 task-plan 流程 | 已有 task-plan service 稳定，PR-1D 仅消费不修改其逻辑 |
| PR-1B 涉及 schema 改动多 | 拆 migration 045（身份链）+ 046（memory 列），可独立回滚 |

---

## 七、对 M13 后续 Phase 影响

| Phase | 影响 |
|---|---|
| Phase 2 task-plan 增强 | 本次 PR-1D 已用 task-plan，后续 Phase 2 可在此基础加 plan UI |
| Phase 3 ACP 派生 | 解耦，不受影响 |
| Phase 4 per-agent 工具/MCP | binding schema 仍有空间扩 binding.tools/mcp |
| Phase 5（已 ✅） | feishuDoc 注入路径不受影响 |

---

## 八、与之前几版方案的关键差异回顾

| 版本 | 工作量 | 主要内容 |
|---|---|---|
| v1（OpenClaw 8 层抄） | 12-14d | 8 层 binding + guild/team/roles |
| v2（4 痛点 8-10d） | 8-10d | 删 8 层，dmScope 4 格式 |
| v3（核对 PR #74 后 5-7d） | 5-7d | 砍掉飞书 4 档已存在部分 |
| **v4（本版本，含 3 遗漏完整方案）** | **8-11d** | 加回 per-task / memory canonical / fallback 查询 |

v4 比 v1 仍短 2-4d，因为路由层不需要重写（PR #74 已稳定）。

---

## Verification

### 自动化
- `pnpm test` core 全套 ≥4212 测试零回归
- 新增测试覆盖：
  - 4 种 dmScope 格式生成
  - main fallback 查询
  - identityLinks 命中/miss + sessionKey 替换
  - memory canonical_user_id 填充 + 反向查询
  - per-task sessionKey 派生

### 手测（PR-1A 后）
- 员工 Day 1 飞书 DM Agent A → Day 2 给 A 加企微 binding → 企微 DM 看到 Day 1 飞书历史（fallback 查询命中）
- 员工显式切 dm_scope='per-peer' → 飞书企微 DM 重新独立

### 手测（PR-1B 后）
- 员工 SettingsPage 绑定飞书 ou_xxx + 企微 userid_yyy 同 canonical='self'
- 飞书发"我喜欢简洁的回复" → 企微 DM Agent → 看到这条偏好记忆（memory canonical 锚定）
- 解绑测试：解除 identityLink 后两渠道身份重新分裂

### 手测（PR-1C 后，条件性）
- PR #74 协作语义验证（peer-roster 范围 / @ 兜底 / 历史窗口）

### 手测（PR-1D 后）
- 飞书群启动 task1（@文案 写公关稿）+ task2（@文案 改月报）
- 两个 task 在不同 sessionKey（`...:task:task1` / `...:task:task2`）
- task 完成后会话归档到 task-plan，新 task 重新派生 sessionKey

---

## 九、工作量小结

| PR | 工作日 | 主要交付 |
|---|---|---|
| PR-1A | 2-3d | mainSessionKey + DM 跨渠道连贯 + fallback + UI |
| PR-1B | 4-5d | identityLinks DB + UI + memory canonical 锚定 |
| PR-1C | 0-1d | PR #74 协作语义调研补丁（条件性） |
| PR-1D | 1-2d | per-task sessionKey 完整集成 |
| **合计** | **8-11d** | ≈ 1.5-2w |

**等用户审批后开始 PR-1A 实施**。
