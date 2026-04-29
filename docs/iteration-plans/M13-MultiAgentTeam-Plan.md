# M13 · 多 Agent 团队协作计划（跨渠道核心 + 飞书首发 MVP）

> **生效日期**: 2026-04-25
> **范围决策**: 把"群里多个 EvoClaw bot 像真实团队一样协作"做成跨渠道核心 + 飞书首发实现，3.5 周 / 20-25 工作日
> **前置**: M3 ✅ + M8 ✅ + M11.1 ✅（飞书 channel + CardKit + doc-api）
> **后置影响**: M12 运营可观测 / M1.1 Checkpoint / M3.1 全局预算 顺延 ~3.5 周；M9 部署架构 + 中转层就绪后再叠 iLink 微信 / 企微多 Agent

## Context（为什么做）

**用户场景**：用户把 N 个 EvoClaw Agent 对应的 bot 拉到同一个群（先以飞书群为例，后续可扩到 iLink 微信群、企微群、Slack 频道等），在群里 @ 任一 Agent 说"给我做个 H5 落地页"。期望：

1. 被 @ 的 Agent 拆成任务（设计图、接口、前端接入），结构化地 @ 后端 / 产品 / 设计 同事 Agent
2. 下游 Agent 收到任务 → 讨论 / 追问 / 完成 → 在群里回报
3. 任务依赖（前端依赖后端接口）自动解锁
4. 创建 plan 的 Agent 跟踪全部完成后向用户汇报

**今日差距**（探查已确认）：
- ✅ 已具备：peer-roster（名字 + emoji 注入 prompt）、飞书 9 个 channel tools、SubAgentSpawner / Lane Queue、CardKit 流式卡片、System Events、AgentMessageBus（内存）、iLink 微信渠道（PRD 已实现）
- ❌ 缺口三件：
  1. 各渠道都有"sender is another bot → 丢弃"的一刀切过滤（飞书 `inbound.ts:232` 的 `sender_type === 'app'`），**Agent 互发消息在群里直接被吃掉**
  2. Peer roster 按 `channel(accountId)` 构建，且无 mention ID — **Agent 没法精确 @ 同事**
  3. 任务依赖 DAG 完全没有持久化层 — `decompose_task` 只能纯并发
- OpenClaw / Hermes 都是"星形 + 无人格 subagent"，**没有"网状对等 Agent 团队"的参考实现**，但零件可借：OpenClaw `Task Flow` 的 `status: "blocked"` + `blockedTaskId`、Hermes `role=orchestrator` + `MAX_DEPTH=2` + 30s 心跳、文件冲突检测

**团队形态决定**：团队 = "当前群里的 EvoClaw 绑定的 bot 集合"。无独立"团队表"，roster 从渠道群成员动态派生。无论飞书群、企微群、Slack 频道，UX 都一致。拉 bot 进群即组队。

**去 PM 中心化决定**：不预设 PM / orchestrator / admin 等特权角色。所有团队形态（有层级、平级、单人自拆）走同一套责任链：基于 `task.created_by_agent_id` 和 `plan.created_by_agent_id` 这两个动态事实，谁派活谁负责。

**分层决定**：核心跨渠道，首发飞书。先把 Feishu 跑通，但接口 Day 1 就抽干净，后续渠道只写 adapter。

---

## 架构分层

```
┌────────────────────────────────────────────────────────┐
│ Layer 4: 渠道实现（本期只交付飞书，其他打好 TODO）       │
│  FeishuTeamChannel  ┊  IlinkTeamChannel(Phase 2)       │
│                     ┊  WecomTeamChannel(Phase 2)       │
│                     ┊  SlackTeamChannel(Phase 3)       │
├────────────────────────────────────────────────────────┤
│ Layer 3: TeamChannel 适配器接口（本期必做）              │
│   classifyInboundMessage / listPeerBots /              │
│   buildMention / renderTaskBoard / updateTaskBoard     │
├────────────────────────────────────────────────────────┤
│ Layer 2: Team Mode 核心（完全 channel-agnostic，本期必做）│
│   peer-roster-service ┊ task-plan service              │
│   loop-guard          ┊ system-prompt 注入              │
│   user-commands       ┊ escalation-service             │
│   task-artifacts      ┊ task-ready 自动触发             │
├────────────────────────────────────────────────────────┤
│ Layer 1: 既有基础设施（不改，直接复用）                  │
│   SubAgentSpawner ┊ Lane Queue ┊ CardKit ┊ System     │
│   Events ┊ Binding Router ┊ enqueueSystemEvent        │
│   M11.1 doc-api / media / withFeishuRetry             │
└────────────────────────────────────────────────────────┘
```

---

## PR 拆分（4 PR，每 PR 5-7d）

| PR | 覆盖范围 | 工作量 | 核心交付 |
|---|---|---|---|
| **PR1** | Layer 3 接口 + Layer 2 核心（peer-roster / loop-guard / system prompt） | 5-6d | TeamChannelAdapter 接口 + 注册表 + peer-roster-service（chat_id 作用域 + 缓存 + 失效）+ loop-guard 三层熔断 + `<team_mode>` prompt 注入 + Migration 030（task_plans + tasks + task_artifacts + agents.role 字段）|
| **PR2** | Layer 2 task-plan + 工具 + 用户命令 + escalation | 5-6d | task-plan service（DAG 拓扑 + 依赖解锁）+ 4 个 task-plan 工具 + mention_peer 工具 + /pause /cancel /revise 触发词 + escalation-service cron（5 min 扫超时 + 三跳责任链）|
| **PR3** | Layer 2 artifacts + Layer 4 飞书 adapter | 6-7d | artifacts service + 3 个 artifact 工具 + URI dispatch + FeishuTeamChannel（classify / listPeerBots / buildMention / 看板 / 成员事件）+ artifact-bridge（feishu-doc/image/file fetch）+ feishu_create_doc 工具 |
| **PR4** | inbound 改造 + 前端占位 + 集成 + 真机手测 | 5-6d | inbound classify 三分支替换 + 用户命令钩子 + /plans 占位路由 + 默认 settings + Feature Flag + docs/architecture/team-mode-channel-guide.md + docs/architecture/team-mode-frontend-plan.md + 集成测试 + 真机手测 |
| **合计** | — | **20-25d ≈ 3.5w** | — |

---

## 核心设计（Layer 2 + Layer 3）

### 一、TeamChannel 适配器接口（Layer 3）

**`packages/core/src/channel/team-mode/team-channel.ts`**（新建）

```ts
export type GroupSessionKey = string;       // 形如 "feishu:chatId:xxx" / "ilink:roomId:yyy"
export type PeerMentionId = string;         // 渠道内 @ 标识（飞书 open_id / 微信 wxid / Slack user_id）

export interface PeerBotInfo {
  agentId: string;                // EvoClaw Agent ID
  mentionId: PeerMentionId;       // 渠道原生 @ 标识
  name: string;                   // 来自 IDENTITY.md
  emoji: string;
  role: string;                   // 角色一行摘要
  capabilityHint?: string;
}

export type MessageClassification =
  | { kind: 'self'; reason: string }          // 自己的 bot → 丢
  | { kind: 'peer'; senderAgentId: string }   // 同群 EvoClaw 同事 → 收
  | { kind: 'stranger' }                       // 陌生 bot/应用 → 丢
  | { kind: 'user'; userId: string };          // 真人用户

export interface TeamChannelAdapter {
  readonly channelType: string;   // 'feishu' | 'ilink' | 'wecom' | 'slack'...

  /** 入站消息分类：这条消息来自自己、同事 bot、陌生 bot 还是真人？ */
  classifyInboundMessage(event: unknown, ownContext: OwnBotContext): Promise<MessageClassification>;

  /** 列出群里所有 EvoClaw 绑定的 bot 成员（不含自己） */
  listPeerBots(groupSessionKey: GroupSessionKey, selfAgentId: string): Promise<PeerBotInfo[]>;

  /** 构造带真·@ 的消息体（渠道原生格式） */
  buildMention(
    groupSessionKey: GroupSessionKey,
    peer: PeerBotInfo,
    text: string,
    metadata?: { taskId?: string; planId?: string },
  ): Promise<ChannelOutboundMessage>;

  /** 渲染项目看板（飞书 → CardKit；微信 → 富文本；Slack → Block Kit） */
  renderTaskBoard(plan: TaskPlanSnapshot): ChannelOutboundMessage;

  /** 更新已发出的看板消息（返回新 cardId，若渠道不支持就发新一条） */
  updateTaskBoard(
    groupSessionKey: GroupSessionKey,
    existingCardId: string | null,
    plan: TaskPlanSnapshot,
  ): Promise<{ cardId: string }>;

  /** 群成员变更事件订阅（bot 离群/加群时失效缓存） */
  onGroupMembershipChanged?(handler: (key: GroupSessionKey) => void): void;
}
```

**注册表**：`TeamChannelRegistry.register('feishu', new FeishuTeamChannel(...))`，按 `groupSessionKey` 前缀分发。

### 二、Team Mode 核心（Layer 2，完全 channel-agnostic）

#### 2.1 Peer Roster 服务（团队发现机制）

`packages/core/src/agent/team-mode/peer-roster-service.ts`（替代现有 `peer-roster.ts` 的 channel-aware 部分）

**核心算法**：团队 = "渠道群成员 API" × "本地 bindings 表" **取交集**。Agent 最终以 system prompt 里的 `<team_roster>` XML 块"知道"同事是谁。

**6 步流水线**（`buildRoster(agentId, groupSessionKey): Promise<PeerBotInfo[]>`）：

```
1. Agent 收到群消息 → 准备拼 system prompt
2. peer-roster-service.buildRoster(agentId, groupSessionKey)
3. 查缓存（5 min TTL per (agentId, groupSessionKey)）
     ├─ 命中 → 直接返回
     └─ 未命中 → 继续
4. TeamChannelRegistry.resolve(groupSessionKey) → 得到 adapter
     （前缀 "feishu:chat:xxx" → FeishuTeamChannel）
5. adapter.listPeerBots(groupSessionKey, selfAgentId)
     飞书版：
     ├─ chat.members.get(chatId, member_id_type='open_id') 拿群成员
     ├─ 过滤 member_type === 'robot'
     ├─ 对每个 bot open_id，查本地 bindings 表反查 agentId
     └─ 排除 selfAgentId
6. 本地补齐：对每个 peer.agentId 查 AgentManager，抽 IDENTITY.md / SOUL.md
   的 name/emoji/role/capabilityHint
7. 组装 PeerBotInfo[] → 注入 <team_roster> → 落缓存
```

**三个信息源**：

| 来源 | 回答的问题 | 维护者 |
|---|---|---|
| 渠道 `chat.members.get` API | "这个群里有哪些机器人？" | 渠道（飞书/微信/企微）|
| 本地 `bindings` 表 | "这个 open_id 对应哪个 EvoClaw Agent？" | 用户在 UI 里做 Agent ↔ bot 绑定时写入 |
| `AgentManager` | "这个 Agent 的名字/emoji/角色是什么？" | Agent 创建时从 IDENTITY.md / SOUL.md 抽 |

**刷新时机**：

| 触发 | 动作 |
|---|---|
| Agent 要处理群消息 | 按需 buildRoster，命中缓存直接用 |
| 5 分钟 TTL 到期 | 下次请求自动重建 |
| 飞书事件 `im.chat.member.bot.added_v1` / `removed_v1` | adapter 收事件 → `registry.invalidate(groupSessionKey)` 立即失效 |
| 用户在 EvoClaw UI 新建/删除绑定 | BindingRouter 广播事件 → 失效相关 roster 缓存 |

常规 5 min 兜底 + 事件驱动即时。

**取交集的语义影响**：
- 群里有 bot 但用户在 EvoClaw 里没创建对应 Agent → 不入 roster（走陌生人路径）
- EvoClaw 里有 Agent 但没绑 bot → 不入 roster（渠道层不存在，无法 @）
- 别人 EvoClaw 实例的 bot → 不入 roster（本地 bindings 查不到）

**边界 / 已知限制**：
1. **Bootstrap 不存在**：只要群里有 ≥2 个已绑定 bot，第一条消息就能看到对方，无需预热
2. **无成员 API 的渠道**（某些纯 webhook 微信生态）：adapter 降级为**被动缓存模式** — 从观察到的入站消息累积 bot 列表，首次使用 roster 可能不全，几轮后稳定。具体降级规则见 `docs/architecture/team-mode-channel-guide.md`
3. **跨 EvoClaw 实例组队**：**不支持 MVP**。两台机器各自的 bindings 独立，就算 bot 共处一群也互不识别。Phase 3 中心化 registry 才解锁
4. **5 min TTL 窗口风险**：有事件驱动失效兜底；若事件丢失，最长 5 min 自动修正，不会永久错
5. **Agent 重名**：roster 里出现同名项，靠 emoji + agent_id 区分；prompt 明确"请用 mention_id 而非名字指派"
6. **Agent 不在自己的 roster 里**（排除 selfAgentId）：防自 @ 幻觉

#### 2.2 System Prompt 注入（`<team_mode>` 段）

`packages/core/src/agent/team-mode/prompt-fragment.ts`

```xml
<team_mode channel="feishu" group_key="feishu:chat:oc_xxx">
<team_roster>
<peer agent_id="backend-001" mention_id="ou_xxx" role="后端工程师">
  ✨ 阿辉 · Node/TS、接口设计、数据库
</peer>
<peer agent_id="design-007" mention_id="ou_yyy" role="UI 设计师">
  🎨 小林 · Figma/高保真图 / 品牌系统
</peer>
</team_roster>
<my_open_tasks>
- [in_progress] t2: 实现登录接口（依赖 t1：设计稿已完成 ✅）
</my_open_tasks>
<rules>
- 只处理你被 @ 的任务。同事间对话仅作上下文
- @ 同事请用 mention_peer 工具（通用），渠道细节工具会自动适配
- 完成/阻塞/求助必须调 update_task_status，不是口头说"干完了"
- 不确定时先问派活的人（即任务的 created_by）
</rules>
</team_mode>
```

仅当当前 session 为群聊且 peer-roster 非空时注入。

#### 2.3 Loop Guard（最关键的安全层）

`packages/core/src/agent/team-mode/loop-guard.ts`

五层熔断（任一触发即拦截 peer fanout）：
- **单任务 @ 链深度 ≤ 5**：每条 peer 消息带 `taskId + chainDepth` 元数据（塞在 adapter 抽象的 `metadata` 字段里，渠道各自落地），下一跳 +1
- **群频率**：同一 `groupSessionKey` 内 bot 消息 > 20 条/60 秒 → 暂停 peer fanout 60 秒
- **乒乓熔断**：两 agent 互相 @ 超过 5 次而无对应 task status 变化 → 冻结，通过 enqueueSystemEvent 向 plan.created_by 注入 `<team_stuck>` 事件
- **自我保护**：Agent 自己 @ 自己（幻觉）→ 丢
- **最终硬熔断**：单群 60s 内超过 100 条 bot 消息 → 熔断 300 秒（与渠道无关）

#### 2.4 Task Plan 服务

`packages/core/src/agent/team-mode/task-plan/service.ts`

- `createPlan(goal, tasks[], createdBy, groupSessionKey, initiatorUserId): Promise<TaskPlanSnapshot>`
- `updateTaskStatus(taskId, status, note?, output?, updater)`：校验 `updater === assigneeAgentId`
- `listTasks(planId? | groupSessionKey?)`
- **依赖解锁**：每次 status 变化后扫描下游，新就绪任务 → `enqueueSystemEvent` 推给 assignee
- **看板刷新**：每次状态变化 → `adapter.updateTaskBoard(key, plan.boardCardId, snapshot)`

#### 2.5 Task Plan 工具（builtin，对 Agent 暴露）

**去 PM 中心化**：不设角色 gating。团队里没有特权角色，只有"谁派了这活"这个动态事实（`tasks.created_by_agent_id` + `task_plans.created_by_agent_id`）。所有团队形态（有 PM / 平级 / 单人自拆）用同一套责任链即可。

- `create_task_plan(goal, tasks[])` — **全员可调**。任何 Agent 被用户 @ 后都可以顺势拆计划。plan 记录 `created_by_agent_id` 作为默认兜底责任人
- `update_task_status(task_id, status, note?, output_summary?)` — assignee 专用（assignee 是唯一能更新自己任务状态的人）
- `list_tasks(plan_id?)` — 只读，任意 Agent 可调
- `request_clarification(task_id, question)` — assignee 缺信息时调：自动 @ `tasks.created_by_agent_id`（谁派的谁回答），任务自动转 `blocked_on_clarification`，等 creator 回复后再自动 `in_progress`
- `mention_peer(peer_agent_id, message, task_id?)` — 通用的 @ 同事工具（由注册的 TeamChannelAdapter 根据当前 `groupSessionKey` 分发到具体渠道）

关键：`mention_peer` 是**跨渠道工具**，Agent 面前只有这一个 API。adapter 在底层决定是调 `feishu_mention` / `ilink_mention` / `slack_mention`。

**"角色"字段**：Agent 设置 UI 里有"角色"下拉（pm/backend/product/design/general/自定义），仅作两种用途：
- 注入 Agent 自己的系统 prompt（"你的角色是 PM，擅长..."）
- 填充 peer roster 的 `role` 字段（供同事识别）
- **不做 tool gating**。没有 PM 的团队照样跑。

#### 2.6 用户中断 / Plan 生命周期控制

用户在群里发三个触发词命令（PM-agnostic，触发词被任一 Agent 识别即生效）：

| 命令 | 行为 |
|---|---|
| `/pause` | 当前群 active plan 全部转 `paused`，in_progress 任务标记暂停（不中断正在跑的 LLM 调用，但不再发 task_ready 事件）|
| `/cancel` | active plan 转 `cancelled`，所有未完成任务终止，看板卡片标记"已取消" |
| `/revise <新需求>` | 复制当前 plan 为新 plan，plan.created_by 的 Agent 重新拆一版任务，已完成的 artifact 通过 `supersedes_id` 链保留可引用 |

触发词在 inbound 层识别（chat-message-handler 的前置钩子），不走 LLM。

#### 2.7 Escalation（升级 / 超时规则，PM-agnostic）

所有升级基于责任链，不依赖 PM 角色：

```
assignee 遇阻 / 任务超时
    → 第一跳：task.created_by（谁派的谁负责）
    → 第二跳：plan.created_by（plan 发起人兜底）
    → 第三跳：原始发起用户（群内 @）

任一跳若目标 agent = assignee 本身，自动跳过往下一层。
```

**具体规则**：
- **工具调用错**：自动重试 2 次 → 仍失败则 `needs_help`
- **assignee 调 `update_task_status(needs_help)`** → 立即 @ task.created_by
- **15 min 无 status 更新**：看板黄 + 提醒 task.created_by
- **30 min**：看板红 + 提醒 plan.created_by
- **60 min**：群里 @ 原始发起用户
- **Agent 被停用**（active=false）：其名下 in_progress 任务自动转 `stalled` → 通知 task.created_by 改派

由 `packages/core/src/agent/team-mode/escalation-service.ts` 定时 cron（5 min 一跑）检查所有 active plan 的超时。

#### 2.8 Task Artifacts（中间产物）

团队协作的产出不只是文字，还有文档、图片、文件、云文档链接等，必须结构化存储并跨 Agent 共享。

**六类 artifact + 统一 URI**：

| kind | 典型内容 | 存哪里 |
|---|---|---|
| `text` | 短文本总结、一句结论 | 内联 `inline_content`（≤4KB）|
| `markdown` | PRD、技术方案、长报告 | 内联（≤64KB）或本地文件 |
| `image` | 设计稿、mockup、截图 | 渠道 image_key + 本地缓存 |
| `file` | PDF / CSV / zip / 代码 diff | 渠道 file_token 或 `~/.evoclaw/artifacts/{plan_id}/{task_id}/...` |
| `doc` | 可协作在线文档（飞书云文档 / Notion） | 仅 URL + 元数据 |
| `link` | 外部链接（Figma / Jira / GitHub） | 仅 URL |

统一 URI：`evoclaw-artifact://{id}` / `feishu-doc://{token}` / `feishu-image://{key}` / `feishu-file://{token}` / `file://{path}` / `https://...`

**三个跨渠道工具（builtin）**：

- `attach_artifact(task_id, kind, title, summary, content?|uri?, metadata?)` — 产出时调，一个任务可多次调
- `list_task_artifacts(task_id | plan_id)` — 任意同群 Agent 可查
- `fetch_artifact(artifact_id, mode?: 'summary'|'full')` — 按需加载详情，大 artifact 默认只返 summary

**依赖解锁自动注入产出摘要**（最关键）：

依赖解锁时 system event 不止"任务来了"，还把前置 task 的 artifact 摘要塞进 prompt：

```xml
<system_event kind="task_ready">
你的任务 t2（实现登录接口）已就绪，前置任务 t1 已完成。
t1 产出：
  [1] 📄 登录 API 规格 v1  kind=doc  uri=feishu-doc://doccnxxx
      摘要：POST /auth/login，请求 {mobile, code}，响应 {token, user}
  [2] 🖼️ 登录页设计稿  kind=image  uri=feishu-image://img_xxx
      摘要：4 个状态（默认/输入/错误/成功），主色 #1677FF
需要深入看哪个，用 fetch_artifact(id, mode='full')。
</system_event>
```

**Context 注入防爆炸**：
- 默认只注入 `summary`（每件 1-2 行）
- Agent 主动 `fetch_artifact(mode='full')` 才拿全量
- 图片走 vision 工具（现有 image 工具复用）
- 飞书云文档走 doc-api 的 `get_content`（M11.1 Phase 5 规划）
- 大 markdown 只给首段 + 标题树

**渠道集成自动化**（飞书）：
- `feishu_send_image` / `feishu_send_file` 调用时**自动**调 `attach_artifact`（封装层做，Agent 不用记）
- 新增 `feishu_create_doc(title, content_markdown)` 调飞书云文档 API 创建文档，自动 attach `kind=doc` artifact
- `fetch_artifact` 内部按 URI schema dispatch：
  - `feishu-doc://` → doc-api.getContent
  - `feishu-image://` → media 下载
  - `feishu-file://` → media 下载
  - `file://` → 本地读

**看板卡片展示**：任务行下方折叠"产出 (N)"区域，展开看 artifact 列表 + 打开/查看按钮（复用 CardKit accordion）。

**版本**：MVP 支持 `supersedes_id` 简易版本链。同 task + 同 title 再次 attach → 自动 link 旧版，看板默认展示最新版，可展开"历史版本 (N)"。不做 diff/merge。

**边界**：
- inline_content 上限：text 4KB、markdown 64KB，超出必须落盘
- 本地文件上限：100MB（超过走渠道云盘）
- 跨群 artifact 不支持，`plan_id` 锁死 group 边界
- 敏感内容 MVP 只 group-level 可见，不做 per-artifact ACL
- GC：plan completed 30 天后本地缓存清理（仅清文件原始数据，DB 记录保留摘要）

### 三、数据模型（channel-agnostic，新 migration `030_task_plans.sql`）

```sql
CREATE TABLE task_plans (
  id TEXT PRIMARY KEY,
  group_session_key TEXT NOT NULL,     -- "feishu:chat:oc_xxx" / "ilink:room:yyy"（渠道无关）
  channel_type TEXT NOT NULL,          -- 'feishu' | 'ilink' | 'wecom' | 'slack' ...
  goal TEXT NOT NULL,
  created_by_agent_id TEXT NOT NULL,   -- 责任链第二跳 / plan 兜底
  status TEXT NOT NULL DEFAULT 'active', -- active/paused/completed/cancelled
  board_card_id TEXT,                  -- 渠道原生卡片 ID（飞书 message_id / Slack ts / 其他）
  initiator_user_id TEXT,              -- 原始发起用户（责任链最后一跳）
  revised_from TEXT,                   -- /revise 命令链接的上一版 plan
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX idx_task_plans_group ON task_plans(group_session_key, status);
-- 同群可并发多个 active plan（用户可同时跟进多条线），看板按 created_at DESC 排

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES task_plans(id) ON DELETE CASCADE,
  local_id TEXT NOT NULL,
  assignee_agent_id TEXT NOT NULL,
  created_by_agent_id TEXT NOT NULL,   -- 谁派的活；责任链第一跳
  title TEXT NOT NULL,
  description TEXT,
  -- 状态：
  --   pending / in_progress / done / cancelled
  --   blocked（依赖未完成）
  --   needs_help（assignee 主动求助）
  --   blocked_on_clarification（等 creator 回复澄清）
  --   paused（被 /pause 暂停）
  --   stalled（assignee 被停用自动标记）
  status TEXT NOT NULL DEFAULT 'pending',
  depends_on TEXT NOT NULL DEFAULT '[]', -- JSON
  output_summary TEXT,
  last_note TEXT,
  stale_marker TEXT,                   -- null / 'yellow_15min' / 'red_30min'，由 escalation cron 写
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(plan_id, local_id)
);
CREATE INDEX idx_tasks_plan ON tasks(plan_id, status);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_agent_id, status);

CREATE TABLE task_artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,                -- 冗余，便于按 plan 汇总
  kind TEXT NOT NULL,                   -- text/markdown/image/file/doc/link
  title TEXT NOT NULL,
  uri TEXT NOT NULL,                    -- 统一 schema
  mime_type TEXT,
  size_bytes INTEGER,
  inline_content TEXT,                  -- text/短 markdown 直接塞此
  summary TEXT NOT NULL,                -- 一行摘要（所有 kind 必填，用于 prompt 注入）
  created_by_agent_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  supersedes_id TEXT,                   -- 新版指向旧版，简易版本链
  metadata TEXT                         -- JSON: image 宽高、doc 权限、file sha256 等
);
CREATE INDEX idx_artifacts_task ON task_artifacts(task_id);
CREATE INDEX idx_artifacts_plan ON task_artifacts(plan_id, created_at DESC);

-- 既有 agents 表追加 role 字段（前端预埋用）
ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'general';
```

注意：**没有 `chat_id` / `feishu_` 等渠道字段**，全部用 `group_session_key` + `channel_type` 抽象。`task_artifacts.uri` 用统一 schema（`feishu-doc://` / `file://` / `https://` 等）透过 channel 差异。

---

## 飞书渠道实现（Layer 4 · 本期交付）

### 四、`packages/core/src/channel/adapters/feishu/team-channel.ts`（新建）

`FeishuTeamChannel implements TeamChannelAdapter`：

#### 4.1 `classifyInboundMessage`
```ts
async classifyInboundMessage(event: FeishuMessageEvent, own: OwnBotContext) {
  const sender = event.sender;
  if (sender.sender_type === 'user') return { kind: 'user', userId: sender.sender_id.open_id };
  if (sender.sender_type !== 'app') return { kind: 'stranger' };
  const senderAppId = sender.sender_id.app_id;
  if (senderAppId === own.appId) return { kind: 'self', reason: 'echo' };
  const peer = await this.peerBotRegistry.lookup(senderAppId, event.chat_id);
  if (!peer) return { kind: 'stranger' };
  return { kind: 'peer', senderAgentId: peer.agentId };
}
```
**对应 inbound.ts 改造**：把 `inbound.ts:232` 从硬过滤替换为 `adapter.classifyInboundMessage`，仅 `self / stranger` 时 drop。

#### 4.2 `listPeerBots`
- 调 `chat.members.get(chatId, member_id_type='open_id', page_size=100)`
- 过滤 `member_type === 'robot'`
- 反查 `bindings` 表：每个 bot open_id → EvoClaw Agent
- 过滤掉自己
- 组装 `PeerBotInfo[]`

#### 4.3 `buildMention` / `renderTaskBoard` / `updateTaskBoard`
- `buildMention` 输出 post 格式 `<at user_id="ou_xxx">` + 附带 metadata（塞在 `message_extra` JSON）
- `renderTaskBoard` 输出 CardKit interactive 卡片
- `updateTaskBoard` 调用 M11.1 PR5 已有的 `cardkit.append` / `update`，若 cardId 为空则 `beginStreaming` 起新卡

#### 4.4 群成员变更事件
订阅飞书 `im.chat.member.bot.added_v1` / `removed_v1` / `p2p_chat_create` → 失效对应 `chatId` 的缓存。

### 五、飞书 inbound 改造（`inbound.ts`）

```ts
// Before
if (data.sender.sender_type === 'app') return;

// After
const classification = await teamChannel.classifyInboundMessage(event, { appId: currentAccountContext.appId });
if (classification.kind === 'self' || classification.kind === 'stranger') return;
// kind === 'user' → 走用户命令识别（§2.6 /pause /cancel /revise）→ 命中则短路；否则进原流程
// kind === 'peer' → 打标 peer_message=true，走 loop-guard 后再进 event-handlers
```

---

## 为后续阶段留的标记（本期不实现，但预埋）

明确哪些功能**不在本期 MVP**，但必须提前预留好钩子点或常量位，避免未来二次重构。详见 `docs/architecture/team-mode-frontend-plan.md`。

### 前端预留
本期桌面前端 **不动**，但代码层埋以下标记（以 `// TODO(team-mode/ui):` 注释形式）：
- `apps/desktop/src/pages/PlansPage.tsx` — **占位空壳文件**，路由注册 `/plans`，内部只 return `<div>Team Plans coming in Phase 2</div>`。后续 PR 只需填实而不需改路由
- `apps/desktop/src/components/ExpertSettingsPanel.tsx` — 在 Agent 设置里预留"角色"字段的占位（但暂不渲染下拉）；schema 侧 `agents.role` 字段已落库，即使前端不填，后端 peer-roster / prompt 都能读

### Feature Flag 预留
- 新增 settings key `team_mode.enabled`（默认 `true`），以及 `team_mode.loop_guard_enabled`（默认 `true`）
- 所有 Layer 2 核心入口处读取该 flag，false 时走"旧单 Agent 路径"
- 用途：后续若 team mode 跑飞，用户可在 settings.json 里改为 false 一键回退；或本地开发时关闭降噪
- 不做前端 UI 开关（Phase 2 加）

### 审计 / 成本 / 记忆 / Mock 渠道
本期都不做，不埋标记。未来需要时再按 escalation-service 的 cron 模式自行接。

### "同事印象记忆"（推迟）
peer-roster 里的 `capabilityHint` 现在从 IDENTITY.md / SOUL.md 抽；未来可以从历史 plan 的 artifact / status 流记录"和 X 合作的感受"，但**不在本期**。现有 `memory_units` 表已有 `entity` 类别可复用，未来只需加 entity=peer_agent_id 的记录即可 — 无需改 schema。

---

## 文件改动清单

### 新增（Layer 2 + Layer 3 核心）
- `packages/core/src/channel/team-mode/team-channel.ts`（接口）
- `packages/core/src/channel/team-mode/team-channel-registry.ts`
- `packages/core/src/agent/team-mode/peer-roster-service.ts`
- `packages/core/src/agent/team-mode/prompt-fragment.ts`
- `packages/core/src/agent/team-mode/loop-guard.ts`
- `packages/core/src/agent/team-mode/task-plan/types.ts`
- `packages/core/src/agent/team-mode/task-plan/service.ts`
- `packages/core/src/agent/team-mode/task-plan/tools.ts`（4 个 task plan 工具：create / update / list / request_clarification）
- `packages/core/src/agent/team-mode/user-commands.ts`（/pause /cancel /revise 三个触发词识别，接入 inbound 钩子）
- `packages/core/src/agent/team-mode/escalation-service.ts`（5 min cron 扫超时 + 责任链升级：task.created_by → plan.created_by → initiator_user）
- `packages/core/src/agent/team-mode/mention-peer-tool.ts`（通用 mention_peer 工具）
- `packages/core/src/agent/team-mode/artifacts/types.ts`
- `packages/core/src/agent/team-mode/artifacts/service.ts`（CRUD + URI dispatch + 本地缓存 GC）
- `packages/core/src/agent/team-mode/artifacts/tools.ts`（attach_artifact / list_task_artifacts / fetch_artifact）
- `packages/core/src/agent/team-mode/artifacts/uri-resolver.ts`（按 schema 分派到各 channel adapter）
- `packages/core/src/infrastructure/db/migrations/030_task_plans.sql`（含 task_plans / tasks / task_artifacts 三张表 + agents.role 字段）

### 新增（Layer 4 · 飞书实现）
- `packages/core/src/channel/adapters/feishu/team-channel.ts`（FeishuTeamChannel）
- `packages/core/src/channel/adapters/feishu/peer-bot-registry.ts`
- `packages/core/src/channel/adapters/feishu/task-board-card.ts`（含 artifact accordion 渲染）
- `packages/core/src/channel/adapters/feishu/artifact-bridge.ts`（feishu-doc/image/file 三种 URI 的 fetch 实现，复用 M11.1 doc-api / media）
- `packages/core/src/channel/tools/feishu-channel-tools.ts` 增量：`feishu_create_doc`（新）+ `feishu_send_image/file` 自动 attach_artifact 的封装包装

### 修改
- `packages/core/src/channel/adapters/feishu/inbound.ts`（§五 classifyInboundMessage 替换 + 用户命令钩子）
- `packages/core/src/channel/adapters/feishu/index.ts`（注册 FeishuTeamChannel 到 registry、订阅成员变更事件）
- `packages/core/src/agent/peer-roster.ts`（改为 thin wrapper 调 peer-roster-service）
- `packages/core/src/routes/channel-message-handler.ts`（peer 消息的 promptOverrides 拼装；task-ready system event 调度）
- `packages/core/src/agent/agent-manager.ts` 或 `embedded-runner-prompt.ts`（注入 `<team_mode>` 段）
- `packages/core/src/agent/builtin-tools/index.ts`（注册 8 个 tools：`mention_peer`, `create_task_plan`, `update_task_status`, `list_tasks`, `request_clarification`, `attach_artifact`, `list_task_artifacts`, `fetch_artifact`）
- `apps/desktop/src/App.tsx` 或 route 注册处 — 注册 `/plans` 占位路由
- `packages/core/src/infrastructure/settings/defaults.ts` — 加 `team_mode.enabled=true` / `team_mode.loop_guard_enabled=true` 默认 settings

### 同步文档更新
- `CLAUDE.md` 的"当前冲刺"一节替换为 M13 进度
- `docs/architecture/team-mode-channel-guide.md`（新建，本期交付）— 新渠道适配器接入清单
- `docs/architecture/team-mode-frontend-plan.md`（新建，本期交付）— 前端预埋 / 待开发清单

### 测试新增
- `__tests__/team-mode/peer-roster-service.test.ts`（跨渠道 adapter 注入、缓存）
- `__tests__/team-mode/loop-guard.test.ts`
- `__tests__/team-mode/task-plan-service.test.ts`（DAG 拓扑、依赖解锁、assignee 权限、并发 plan 隔离）
- `__tests__/team-mode/mention-peer-tool.test.ts`（通过 mock adapter 确认分发正确）
- `__tests__/team-mode/user-commands.test.ts`（/pause /cancel /revise 三条命令的识别和落地）
- `__tests__/team-mode/escalation-service.test.ts`（责任链三跳：task.created_by → plan.created_by → initiator_user；15/30/60 min 超时）
- `__tests__/team-mode/clarification-flow.test.ts`（request_clarification → blocked_on_clarification → creator 回复 → 恢复 in_progress）
- `__tests__/team-mode/artifacts-service.test.ts`（六种 kind、inline 阈值、版本链、GC）
- `__tests__/team-mode/artifact-uri-resolver.test.ts`（schema dispatch、fallback）
- `__tests__/team-mode/task-ready-with-artifacts.test.ts`（依赖解锁注入 artifact 摘要）
- `__tests__/feishu/team-channel.test.ts`（classify 三分支、listPeerBots、buildMention）
- `__tests__/feishu/inbound-peer-fanout.test.ts`（self 丢、peer 收、陌生 app 丢）
- `__tests__/feishu/artifact-bridge.test.ts`（feishu-doc/image/file 三种 URI fetch）

### 复用（不改）
- `SubAgentSpawner` / Lane Queue / AgentMessageBus（MVP 不用，不引入子 worker 层）
- `CardKit streaming`（M11.1 PR5）
- `enqueueSystemEvent` / `drainSystemEvents`
- `BindingRouter` / `bindings` 表
- `withFeishuRetry`（指数退避）

---

## 验证路径

### 单元测试（80%+ 覆盖）
- Layer 2 核心：peer-roster-service / loop-guard / task-plan-service 三件用 mock adapter 完全覆盖
- Layer 4 飞书：FeishuTeamChannel 四个方法 + inbound 改造
- DAG：拓扑排序、自环检测、多级依赖解锁、dangling-dependency 报错

### 集成测试
- Mock 飞书 WS event → 多 bot fanout → 每 Agent 正确收到 peer 消息（不收自己）→ 被 @ 的 Agent 创建 plan（无需 PM 角色）→ 下游 assignee 收到 system event → 状态更新 → 看板卡片刷新 → 依赖解锁 → 下一级 assignee 收到 → 全部完成 → 汇报给原始用户
- 用户命令：`/pause` → 所有 in_progress 任务停留；`/revise` → 新 plan 继承已完成 artifact；`/cancel` → 全终止
- 责任链升级：assignee 调 `update_task_status('needs_help')` → task.created_by 被 @ → 若 creator 也卡住 → plan.created_by → 仍卡 → initiator_user

### 真机手测（M11.1 real-machine-test-plan 模式）

**基本流**：
1. 创建 3 个 EvoClaw Agent（角色可任选，本期不做 gating），各绑 1 个独立飞书 bot
2. 飞书建测试群，拉 3 个 bot 进去
3. 用户 @ 任一 Agent："给我做个 H5 落地页，要登录和列表页"
4. 观察：被 @ 的 Agent 顺势拆 plan（成为本 plan 创建者）→ 看板卡片发出 → 其他两人收到 task_ready → 并行完成 → 依赖解锁 → 最终汇报

**场景 A · 平级团队**（3 个平级 Agent，默认 role='general'）：
- 验证：被 @ 的 Agent 自动承担 plan 创建者责任，无需 PM 角色
- 验证：下游 assignee 遇阻 → `request_clarification` → 直接 @ task.created_by（即发起拆分的那个 Agent）

**场景 B · 用户中断**：
- 中途 `/pause` → 所有任务停在当前状态，看板标注"已暂停"
- 接着 `/revise 改成只做登录页` → 新 plan 生成，登录任务复用旧 artifact
- 或者 `/cancel` → 全部停止

**场景 C · 责任链升级**：
- 任一任务无 status 更新 15 min → 看板变黄 + task.created_by 收到 reminder
- 30 min → 看板变红 + plan.created_by 收到 reminder
- 60 min → 群内 @ 原始发起用户

**场景 D · 故障注入**：
- 同事 A @ B，B @ A 反复 → loop-guard 乒乓熔断，群里出现 `team_stuck` 事件
- 用户中途 kick 一个 bot → 成员变更事件触发缓存失效；受影响的 in_progress 任务转 `stalled` → 通知 task.created_by
- 并发两个 plan 同时跑 → 看板按时间倒序展示，artifact 严格按 plan_id 隔离
- 飞书限流 → withFeishuRetry 生效；loop-guard 硬熔断兜底

### 降级
- `chat.members.get` 限流 → 用最近缓存 + warn 日志
- 飞书成员变更事件丢失 → 5 分钟 TTL 兜底
- Migration 030 失败 → 启动报错
- adapter 未注册（如用户在其他渠道群聊）→ team-mode 自动降级为"无 peer 模式"，不阻塞

---

## 非 MVP 范围（明确推迟）

- **其他渠道实现**（iLink 微信 / 企微 / Slack）：接口预留好，本期**不**实现，Phase 2-3 按需补 adapter。详见 `docs/architecture/team-mode-channel-guide.md`
- **前端**（看板页、角色下拉渲染、artifact 预览 UI、feature flag 开关 UI）：本期只预埋路由占位 + role 字段落库 + 默认 settings，实际页面推到 Phase 2。详见 `docs/architecture/team-mode-frontend-plan.md`
- **成本预算 / Token 熔断**：本期不做。未来可按 escalation-service 的 cron 模式接 per-plan 预算
- **审计 / 溯源**：本期不做。未来用既有 `audit_log` 表扩展
- **同事印象记忆**：peer 的 capability 只从 IDENTITY.md / SOUL.md 抽。未来可按 `memory_units` 的 entity 类别扩展
- **跨群协作**：一个任务涉及多个群 — Phase 2
- **动态拉人**：从人才池拉 Agent 进群 — Phase 2（涉及飞书 bot 批量管理 API，其他渠道做法各异）
- **权限分级**：谁能派谁、谁能否决谁、审批流 — Phase 3（借 M11.1 ocf1 审批 envelope）
- **Agent 投票 / 辩论 / 分歧解决**：Hermes 放弃此路径（复杂 vs 收益差），MVP 不做
- **跨任务共享黑板**：每个 plan 独立，暂不引入全局 KV
- **SubAgentSpawner 整合**：真实 Agent 玩法稳定后再考虑"Agent 自己派生临时 worker 处理琐事"
- **幻觉检测 / 产出 verification**：任务 done 不校验实际产出，信任 Agent 自我报告

---

## 工作量估算

| 模块 | 工时 |
|---|---|
| Layer 2 核心（peer-roster-service / loop-guard / task-plan / prompt / tools） | 4-5 天 |
| Layer 2 artifacts（service / uri-resolver / 3 工具 / GC） | 2-3 天 |
| Layer 2 用户命令 + escalation-service + clarification 流转 | 1.5-2 天 |
| Layer 3 接口 + Registry + docs/team-mode-channel-guide.md | 1 天 |
| Layer 4 飞书 adapter（classify / listPeerBots / buildMention / 看板 / 成员事件） | 3-4 天 |
| Layer 4 飞书 artifact-bridge（doc/image/file fetch）+ feishu_create_doc + 自动 attach 封装 | 2 天 |
| inbound 改造 + 集成粘合 + 命令钩子 | 1-2 天 |
| 前端占位标记（路由 / 空页 / role 字段落库 / 默认 settings） | 0.5 天 |
| 测试（单元 + 集成） | 3-4 天 |
| 真机手测 + 迭代（用户已备 3 个飞书 bot） | 2 天 |
| **合计** | **约 3.5 周（20-25 工作日）** |

比纯飞书方案多出 ~3 天（跨渠道抽象）+ ~4 天（artifact 层）+ ~2 天（用户命令 + 责任链升级 + 澄清流转）。前端本期不实现仅占位，真实前端开发推到 Phase 2。

---

## 关键风险

1. **接口抽象漏项**：看板、@、成员查询三种形态各渠道差异大（Slack Block Kit ≠ CardKit ≠ 微信富文本）。对策：接口返回 `ChannelOutboundMessage` 通用结构，by-channel 的渲染逻辑封在 adapter 内，先用飞书驱动打磨一轮
2. **消息回环雪崩**：loop-guard 任一层失效多 bot 会打爆限流。对策：单元测试全覆盖 + inbound 硬熔断（单群 60s 100 条 bot 消息）
3. **Roster 失效延迟**：5 分钟缓存可能让"刚 kick 的 bot 仍收到分派"。对策：订阅成员变更事件即时失效
4. **渠道无群成员 API**（如某些 webhook-only 微信生态）：对策：adapter 可返回"被动缓存模式"— 从入站消息中观察到的 bot 逐步累积 roster，带 fallback 说明
5. **用户困惑**：多个 bot 在群里不知该 @ 谁。对策：plan 创建者 bot 建群后自动发"团队介绍"首条消息列 roster + 能力

---

## 参考实现调研

| 来源 | 借鉴 | 不可复用 |
|---|---|---|
| **OpenClaw** | `Task Flow` 的 `status:"blocked"` + `blockedTaskId`（依赖模式可借）；`SpawnAcpContext` 的 agentGroupId 概念 | 单主 + 星形子任务，无 peer 网状；无 mention 路由；无共享黑板 |
| **Hermes** | `delegate_tool.py` 的 `role=orchestrator`、`MAX_DEPTH=2`、30s 心跳、sibling-subagent write guard | 单 Agent / chat，Gateway 不支持多 Agent 同群；无角色协作规则 |
| **EvoClaw 既有** | peer-roster.ts（基础形态）、9 个飞书 channel tools、CardKit streaming、System Events、SubAgentSpawner、Lane Queue、enqueueSystemEvent | — |
