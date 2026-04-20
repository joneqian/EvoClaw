# OpenClaw 多 Agent 团队协作机制 — 深度研究 & EvoClaw 1:1 复刻方案

> **研究日期**: 2026-04-20
> **OpenClaw 参考版本**: `/Users/mac/src/github/openclaw` 工作副本（commit 未固定；文中以相对路径引用 `src/...`）
> **EvoClaw 基线**: `main` @ commit 6f0c4ff（M8 合并后）
> **目标读者**: 将在 EvoClaw 上执行此复刻的工程师
> **产出标准**: 拿到本文可直接开工，不需要再回看 OpenClaw 源码（若确需回看，每节都给了具体 `文件:行号`）

---

## 前言 · 怎样读本文

本文分三层结构：

1. **OpenClaw 侧事实描述**（§2–§7）：OpenClaw 实际怎么做，数据模型、控制流、协议规范、代码入口
2. **EvoClaw 侧现状对照**（§2–§7 每节末尾）：EvoClaw 已有什么、差什么、语义是否对齐
3. **复刻执行方案**（§8–§9）：Phase 划分、每 Phase 文件清单、关键改动、工作量估算

引用约定：
- OpenClaw 路径一律以 `src/...`（仓库根相对路径）
- EvoClaw 路径一律以 `packages/.../src/...`（monorepo 相对路径）
- 所有行号以调研时刻的工作副本为准；复刻时请自行用 `grep`/`rg` 二次定位，**不要机械 checkout 行号**
- 外部协议规范（MCP、ACP）只描述 OpenClaw 的适配层，不抄协议原文

---

## 0. TL;DR

**一句话描述 OpenClaw**：通过 `Binding 8 层优先级路由` + `TaskFlow 轻量编排引擎` + `ACP/Subagent 双 runtime 派生`，把"一条渠道消息进入 → 多 Agent 协作 → 结果回传"的链路拆解成可组合的原子能力，**没有显式 Team 一级对象**，而是通过 binding + flow + controllerId 拼出团队语义。

**一句话描述 EvoClaw 现状**：已有「3 层 binding 单点路由 + sub-agent-spawner 临时派生 + LaneQueue 三车道并发 + agent-message-bus 基础通信 + system-events 推送」骨架，**缺 TaskFlow 引擎、缺 ACP 协议、缺 stream-to-parent 中继、缺 per-agent 工具/MCP scope、缺 mainSessionKey 语义**。

**一句话描述复刻计划**：四个 Phase 串行推进（10-12 人周），Phase 1 路由扩容 → Phase 2 TaskFlow → Phase 3 ACP + 派生增强 → Phase 4 per-agent 跨层隔离。每 Phase 可独立合并，Phase 完成即上线一块团队协作能力。

---

## 1. 术语表

先把所有会频繁出现的术语列清楚，后文不再解释。

### 1.1 路由与会话

| 术语 | 来源 | 定义 |
|------|------|------|
| **Binding** | OpenClaw `src/config/types.agents.ts` | 配置记录："符合 X 条件的渠道消息路由给 Y Agent"。多条 Binding 通过优先级级联匹配 |
| **AgentBindingMatch** | `src/config/types.agents.ts:45-57` | 匹配条件：`{ channel, accountId?, peer?, guildId?, teamId?, roles? }` |
| **ResolvedAgentRoute** | `src/routing/resolve-route.ts:39-60` | 路由结果：`{ agentId, channel, accountId, sessionKey, mainSessionKey, lastRoutePolicy, matchedBy }` |
| **sessionKey** | `src/routing/session-key.ts:127-174` | 单个 Agent 对一类对话的状态容器，格式多种（见 §4.3） |
| **mainSessionKey** | 同上 | Agent 的"全局会话"，所有 DM/群聊可汇聚到一处，格式 `agent:{id}:main` |
| **lastRoutePolicy** | `src/routing/resolve-route.ts` | 取值 `"main"` 或 `"session"`，决定本次回复记录到哪个 sessionKey |
| **ownerKey** | `src/tasks/task-flow-registry.types.ts:27` | Flow/Task 的所有者标识，语义上 ≈ 发起者的 sessionKey |
| **lookupToken** | `src/tasks/task-flow-registry.ts:675` | 查询 Flow 的令牌，可以是 flowId 或 ownerKey |

### 1.2 编排与任务

| 术语 | 来源 | 定义 |
|------|------|------|
| **TaskFlow** | `src/tasks/task-flow-registry.ts` | 一个多步骤流程的状态容器，可有/无 controller agent |
| **syncMode** | `task-flow-registry.types.ts:12` | `"managed"`（controller 驱动）或 `"task_mirrored"`（从子 task 状态自动同步） |
| **controllerId** | `task-flow-registry.types.ts:29` | managed Flow 的管理者 agent id |
| **revision** | `task-flow-registry.types.ts:31` | 乐观锁版本号，每次更新 +1 |
| **TaskFlowStatus** | `task-flow-registry.types.ts:14-22` | `queued \| running \| waiting \| blocked \| succeeded \| failed \| cancelled \| lost` |
| **TaskRecord** | `src/tasks/task-registry.types.ts` | 单个任务记录，可关联到 Flow（`parentFlowId`） |
| **parentFlowId** | `task-registry.types.ts:61` | Task 所属 Flow 的 id（多 task 可归一 flow） |
| **childSessionKey** | `task-registry.types.ts:60` | Task 派生出的子 Agent 会话 key |

### 1.3 派生与协议

| 术语 | 来源 | 定义 |
|------|------|------|
| **ACP** | `src/acp/` | Agent Control Protocol，基于 stdio + ndJson 的跨进程 Agent 通信协议 |
| **runtime** | `src/agents/acp-spawn.ts` | 派生 Agent 的执行后端，取值 `"subagent"`（同进程/沙箱）或 `"acp"`（独立进程） |
| **spawnMode** | `src/agents/acp-spawn.ts:65-66` | `"run"`（单次）或 `"session"`（持久会话） |
| **SessionMode** | ACP 内部 | `"oneshot"` ↔ spawnMode="run"；`"persistent"` ↔ spawnMode="session" |
| **sandbox** | `src/agents/acp-spawn.ts:67-68` | `"inherit"`（默认）或 `"require"`（强制沙箱，ACP 不支持） |
| **streamTo** | `src/agents/acp-spawn.ts:69-70` | 目前仅支持 `"parent"`，子 ACP 输出回流父会话 |
| **thread-bind** | `src/agents/acp-spawn.ts:340` | 把派生的会话绑定到某个渠道线程（如 Discord thread） |
| **pi-embedded-runner** | `src/agents/pi-embedded-runner/` | 一种本地 runtime 实现，可作为 ACP 的后端 |

### 1.4 权限与工具

| 术语 | 来源 | 定义 |
|------|------|------|
| **AuthProfile** | `src/agents/auth-profiles/` | 凭据记录（API key/OAuth token），支持 global pool + per-agent order |
| **allowAgents** | `src/acp/policy.ts` | ACP 白名单：哪些 agents 可被 sessions_spawn 调起 |
| **subagents.allowAgents** | `src/agents/agent-scope.ts:85` | subagent runtime 下的白名单（与 ACP 白名单独立） |
| **skills filter** | `src/agents/agent-scope.ts:159-164` | per-agent 的 skills 白名单，决定该 Agent 可访问的 tool 子集 |
| **tool-split** | `src/agents/pi-embedded-runner/tool-split.ts` | Runtime 按 allowlist 过滤工具给 LLM 的逻辑 |

---

## 2. 架构鸟瞰

### 2.1 OpenClaw 多 Agent 全景分层

```
┌─────────────────────────────────────────────────────────────────────┐
│                         渠道层（Discord/Slack/Telegram/...）             │
└─────────┬───────────────────────────────────────────────────────────┘
          │ inbound message
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│    路由层：resolveAgentRoute() @ src/routing/resolve-route.ts       │
│    ─ 匹配 8 层 Binding 优先级                                         │
│    ─ 生成 sessionKey + mainSessionKey + lastRoutePolicy             │
└─────────┬───────────────────────────────────────────────────────────┘
          │ ResolvedAgentRoute
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│    Envelope Builder @ src/plugin-sdk/inbound-envelope.ts            │
│    ─ 包装消息 + 注入 metadata                                         │
└─────────┬───────────────────────────────────────────────────────────┘
          │ ReplyEnvelope
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│    Dispatch 层：dispatchInboundMessage @ src/auto-reply/dispatch.ts │
│    ─ ReplyDispatcher 限并发 + typing indicator                      │
└─────────┬───────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│    Agent 推理 + 工具调用                                              │
│    ├─ sessions_spawn (runtime=acp|subagent)                        │
│    │    ├── ACP: 独立进程 + stdio/ndJson                             │
│    │    │    └── stream-to-parent 中继                              │
│    │    └── Subagent: 同进程 + PI Embedded Runner                    │
│    ├─ TaskFlow: createManagedTaskFlow / syncFlowFromTask            │
│    └─ Tools (MCP + built-in + skills filter per-agent)              │
└─────────┬───────────────────────────────────────────────────────────┘
          │ reply (aggregated or streaming)
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│    routeReply @ src/infra/outbound/...                              │
│    ─ 按 sessionKey 记录 reply；按 lastRoutePolicy 决定落在 main 还是 peer│
│    ─ Session Binding Service 维护跨 channel 的消息追踪                 │
└─────────┬───────────────────────────────────────────────────────────┘
          │ outbound
          ▼
                    渠道层（回发给用户）
```

### 2.2 与 EvoClaw 分层对齐

| OpenClaw 层 | OpenClaw 主文件 | EvoClaw 对应 | 状态 |
|-------------|-----------------|--------------|------|
| 渠道适配 | `src/channels/*` / `src/telegram` / ... | `packages/core/src/channel/adapters/*` | ✓ 对齐 |
| 路由层 | `src/routing/resolve-route.ts` | `packages/core/src/routing/binding-router.ts` | 🟡 3 层 vs 8 层 |
| Envelope Builder | `src/plugin-sdk/inbound-envelope.ts` | `packages/core/src/routes/channel-message-handler.ts` 内联 | 🟡 未抽象 |
| Dispatch 层 | `src/auto-reply/dispatch.ts` | 同上 `channel-message-handler.ts` + `chat.ts` | 🟡 未抽象 |
| sessions_spawn | `src/agents/acp-spawn.ts` + `subagent-spawn.ts` | `packages/core/src/agent/sub-agent-spawner.ts` | 🟡 仅 subagent，无 ACP |
| TaskFlow | `src/tasks/task-flow-registry.ts` | —— | ❌ 完全缺失 |
| Stream relay | `src/agents/acp-spawn-parent-stream.ts` | —— | ❌ 完全缺失 |
| Reply Dispatcher | `src/infra/outbound/*` | `packages/core/src/routes/channel-message-handler.ts` | 🟡 简单版 |
| Agent 间消息总线 | `src/sessions/session-lifecycle-events.ts` | `packages/core/src/agent/agent-message-bus.ts` | ✓ 已有雏形 |
| System Events | `src/hooks/` + lifecycle events | `packages/core/src/infrastructure/system-events.ts` + `routes/system-events.ts` | ✓ 已有 |

---

## 3. 数据模型

本节列出 OpenClaw 多 Agent 相关的全部核心数据结构。EvoClaw 复刻时可直接参照（类型推断 via Zod，SQL 直接迁移）。

### 3.1 AgentRouteBinding（配置）

OpenClaw `src/config/types.agents.ts:28-57`：

```ts
export type AgentRouteBinding = {
  type?: "route";                  // 默认 "route"；另一值 "acp" 用于特殊 ACP 绑定
  agentId: string;                 // 目标 Agent ID
  comment?: string;                // 文档注释
  match: AgentBindingMatch;
};

export type AgentBindingMatch = {
  channel: string;                 // 必填："slack" | "discord" | "telegram" | ...
  accountId?: string;              // 可选，通配符 "*"；缺省 "default"
  peer?: {                         // 可选，DM / 群组 / 频道
    kind: "direct" | "group" | "channel";
    id: string;                    // 允许 "*" 通配
  };
  guildId?: string;                // Discord Guild / Teams workspace 可复用
  teamId?: string;                 // Teams workspace ID
  roles?: string[];                // Discord 角色 ID 列表（命中任意一个即匹配）
};

export type AgentBinding = AgentRouteBinding | AgentAcpBinding;
```

**EvoClaw 现状**（`packages/core/src/routing/binding-router.ts` + migration 007）：

```sql
CREATE TABLE bindings (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  account_id TEXT,
  peer_id TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
```

缺字段：`peer.kind`（只有 peer_id 不区分 direct/group/channel）、`guild_id`、`team_id`、`roles`。复刻时新增 migration 加列（见 §8.1）。

### 3.2 TaskFlowRecord（Flow 编排）

OpenClaw `src/tasks/task-flow-registry.types.ts:1-44`：

```ts
export type TaskFlowSyncMode = "task_mirrored" | "managed";

export type TaskFlowStatus =
  | "queued"     // 初始态
  | "running"    // 进行中
  | "waiting"    // 主动暂停，等外部信号
  | "blocked"    // 子 task 产出 outcome=blocked
  | "succeeded"  // 成功终止
  | "failed"     // 异常终止
  | "cancelled"  // 用户取消
  | "lost";      // 追踪丢失

export type TaskNotifyPolicy = "done_only" | "state_changes" | "silent";

export type TaskFlowRecord = {
  flowId: string;                  // UUID
  syncMode: TaskFlowSyncMode;
  ownerKey: string;                // 通常 = 发起者 sessionKey
  requesterOrigin?: DeliveryContext;
  controllerId?: string;           // managed 模式下的 controller agent id
  revision: number;                // 乐观锁
  status: TaskFlowStatus;
  notifyPolicy: TaskNotifyPolicy;
  goal: string;                    // 任务目标描述
  currentStep?: string;            // UI 展示用
  blockedTaskId?: string;          // 若 blocked，哪个子 task
  blockedSummary?: string;
  stateJson?: JsonValue;           // 任意 JSON 状态（controller 自由定义语义）
  waitJson?: JsonValue;            // 等待条件
  cancelRequestedAt?: number;
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
};
```

SQLite 存储 `src/tasks/task-flow-registry.store.sqlite.ts:12-40`：

```sql
CREATE TABLE IF NOT EXISTS flows (
  flow_id TEXT PRIMARY KEY,
  sync_mode TEXT NOT NULL,
  owner_key TEXT NOT NULL,
  requester_origin_json TEXT,
  controller_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  notify_policy TEXT NOT NULL,
  goal TEXT NOT NULL,
  current_step TEXT,
  blocked_task_id TEXT,
  blocked_summary TEXT,
  state_json TEXT,
  wait_json TEXT,
  cancel_requested_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX idx_flows_owner ON flows(owner_key);
CREATE INDEX idx_flows_status ON flows(status);
```

**EvoClaw 现状**：**完全缺失**。复刻时新增 migration 027（或更高）。见 §8.2。

### 3.3 TaskRecord（Task 与 Flow 关联）

OpenClaw `src/tasks/task-registry.types.ts:53-79`：

```ts
export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "lost";
export type TaskTerminalOutcome = "blocked" | "timeout" | "none";

export type TaskRecord = {
  taskId: string;
  runtime: "subagent" | "acp" | "cli" | "cron";
  ownerKey: string;
  scopeKind: "session" | "system";
  childSessionKey?: string;        // 若生成子会话，key
  parentFlowId?: string;           // 归属 Flow
  parentTaskId?: string;           // 父 task（若为子任务）
  agentId?: string;
  requesterSessionKey: string;
  label?: string;
  task: string;                    // 任务描述
  status: TaskStatus;
  terminalOutcome?: TaskTerminalOutcome;
  terminalSummary?: string;
  progressSummary?: string;
  notifyPolicy: TaskNotifyPolicy;
  createdAt: number;
  updatedAt: number;
  lastEventAt?: number;
  endedAt?: number;
};
```

**EvoClaw 现状**：无独立 task registry，sub-agent-spawner 只在内存中管理 running tasks，崩溃即丢失。复刻时需要持久化 task registry（见 §8.3）。

### 3.4 sessionKey / mainSessionKey 格式

OpenClaw `src/routing/session-key.ts:127-174`（`buildAgentPeerSessionKey`）：

```ts
// 按 dmScope 的五种格式（优先级从精细到粗糙）：
// 1. per-account-channel-peer: agent:{agentId}:{channel}:{accountId}:direct:{peerId}
// 2. per-channel-peer:         agent:{agentId}:{channel}:direct:{peerId}
// 3. per-peer:                 agent:{agentId}:direct:{peerId}
// 4. main (default):           agent:{agentId}:main
// 5. 非 direct:                agent:{agentId}:{channel}:{peerKind}:{peerId}
```

`mainSessionKey = agent:{agentId}:main` —— 所有通道汇聚会话，当 Agent 不需要 per-peer 隔离时使用。

**EvoClaw 现状** `packages/core/src/routing/session-key.ts`：

```ts
// 固定格式
return `agent:${agentId}:${channel}:${chatType}:${peerId}` as SessionKey;
```

只有一种格式，无 `main` / `per-peer` / dmScope 概念。复刻时扩展 `generateSessionKey` 为多模式（见 §8.1.3）。

### 3.5 AuthProfileStore（凭据）

OpenClaw `src/agents/auth-profiles/types.ts:78-99`：

```ts
export type AuthProfileStore = {
  version: number;
  profiles: Record<string, AuthProfileCredential>;   // 全局凭据池（id → credential）
  order?: Record<string, string[]>;                   // per-agent: agentId → profile id 顺序
  lastGood?: Record<string, string>;                  // 上次成功的 profile
  usageStats?: Record<string, ProfileUsageStats>;    // 轮转统计
};

export type AuthProfileCredential =
  | { kind: "api_key"; ... }
  | { kind: "token"; ... }
  | { kind: "oauth"; ... };
```

**EvoClaw 现状**：M6 已有 CredentialPool（多 key 轮换），但是 per-provider 级别，**无 per-agent 优先级覆盖**。复刻时扩展 schema（见 §8.4）。

---

## 4. 渠道消息控制流（从 wire 到 Agent）

### 4.1 宏观链路（单条消息的完整旅程）

```
1. Channel Plugin 接收 raw message
   └── inbound handler 构造 { channel, accountId, peer, body, ... }

2. resolveInboundRouteEnvelopeBuilder
   └── 内部调用 resolveAgentRoute
        └── 返回 ResolvedAgentRoute { agentId, sessionKey, mainSessionKey, ... }

3. buildEnvelope
   └── 包装消息文本 + 注入渠道/发送者/时间元数据
        └── 生成 "You received a message from alice on #general: ..."

4. dispatchInboundMessage
   └── dispatcher.reserve() 占用回复槽位
   └── getReplyFromConfig
        └── 加载该 sessionKey 的会话历史
        └── Agent 推理（可能调用 sessions_spawn / tools / TaskFlow）
        └── 生成 reply
   └── dispatcher.markComplete()

5. routeReply
   └── 按 sessionKey 记录 reply
   └── 按 lastRoutePolicy 决定存 main 还是 per-peer
   └── deliverOutboundPayloads → channel adapter → 用户
```

### 4.2 resolveAgentRoute 8 层优先级匹配

**OpenClaw `src/routing/resolve-route.ts:631-831`**，核心逻辑（伪码）：

```ts
function resolveAgentRoute(input): ResolvedAgentRoute {
  const bindings = buildEvaluatedBindingsIndex(cfg.bindings);
  //                   ↑ 把所有 binding 按维度预索引（WeakMap 缓存）

  // tier 1: binding.peer（最精细）
  for (const b of bindings.byPeer) if (matches(b, input)) return build(b);

  // tier 2: binding.peer.parent（thread 场景，当前 peer 不匹配但 parentPeer 匹配）
  if (input.parentPeer) for (const b of bindings.byPeer) if (matchesParent(b)) return build(b);

  // tier 3: binding.peer.wildcard（peer.id="*"）
  for (const b of bindings.byPeerWildcard) if (matches(b, input)) return build(b);

  // tier 4: binding.guild + roles（Discord Guild + 角色组合）
  for (const b of bindings.byGuildWithRoles) if (matchesGuildRoles(b)) return build(b);

  // tier 5: binding.guild（仅 Guild）
  for (const b of bindings.byGuild) if (matchesGuild(b)) return build(b);

  // tier 6: binding.team（Teams workspace）
  for (const b of bindings.byTeam) if (matchesTeam(b)) return build(b);

  // tier 7: binding.account
  for (const b of bindings.byAccount) if (matchesAccount(b)) return build(b);

  // tier 8: binding.channel（account="*"）
  for (const b of bindings.byChannel) if (matchesChannel(b)) return build(b);

  // fallback
  return build({ agentId: cfg.agents.default, matchedBy: "default" });
}

function build(binding): ResolvedAgentRoute {
  const agentId = binding.agentId;
  const sessionKey = buildAgentPeerSessionKey({ agentId, channel, accountId, peer, dmScope: ... });
  const mainSessionKey = `agent:${agentId}:main`;
  const lastRoutePolicy = resolveLastRoutePolicy(agentId, cfg);  // "main" | "session"
  return { agentId, channel, accountId, sessionKey, mainSessionKey, lastRoutePolicy, matchedBy };
}
```

**关键设计**：
- **同步纯函数**，无 I/O，可内联在消息处理 hot path
- `EvaluatedBindingsIndex` 用 WeakMap 缓存 `cfg → index`，config 不变就不重算
- `lastRoutePolicy` 决定 reply 记在 mainSessionKey 还是 per-peer sessionKey（Agent 全局视角 vs 对话视角）

### 4.3 SessionKey 构造详解

`src/routing/session-key.ts:127-174`：

```ts
export function buildAgentPeerSessionKey(params: {
  agentId: string;
  mainKey?: string;                              // 默认 "main"
  channel: string;
  accountId?: string | null;
  peerKind?: "direct" | "group" | "channel";
  peerId?: string | null;
  dmScope?: "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
  identityLinks?: Record<string, string[]>;
}): string {
  // dmScope 决定粒度：
  // "main"                      → agent:{id}:main          （所有人共享一个会话）
  // "per-peer"                  → agent:{id}:direct:{peer} （每个 DM 独立，不区分 channel/account）
  // "per-channel-peer"          → agent:{id}:{ch}:direct:{peer}
  // "per-account-channel-peer"  → agent:{id}:{ch}:{acc}:direct:{peer}（默认最精细）
  // 非 direct peer kind: agent:{id}:{ch}:{kind}:{peer}
  // ...
}
```

**identityLinks** 可把多个 peer id 映射为同一逻辑身份（例如用户切小号时共享会话）。

### 4.4 Envelope Builder

`src/plugin-sdk/inbound-envelope.ts:59-95`：

```ts
export function resolveInboundRouteEnvelopeBuilder<TConfig, TEnvelope, TRoute, TPeer>(params: {
  cfg: TConfig;
  channel: string;
  accountId: string;
  peer: TPeer;
  resolveAgentRoute: (p) => TRoute;
}): { route: TRoute; buildEnvelope: Function } {
  const route = params.resolveAgentRoute({ cfg, channel, accountId, peer });
  const buildEnvelope = createInboundEnvelopeBuilder({ cfg, route });
  return { route, buildEnvelope };
}
```

设计目的：**route 在 envelope 之外独立解析**，这样同一个 route 可以复用给多次 reply（比如 typing indicator 更新、流式输出）。

### 4.5 Dispatch 与 ReplyDispatcher

`src/auto-reply/dispatch.ts:35-54` + `src/auto-reply/reply-dispatcher.ts`：

**ReplyDispatcher 职责**：
- **并发限流**：同一 sessionKey 同一时刻只允许一个 active reply（防止 Agent 输出交错）
- **Typing indicator**：在 reply 期间持续向渠道发 typing 事件
- **Queue**：后到消息等前一个完成才启动（并非排队消息本身，而是排队 reply slot）
- **Timeout / Abort**：超时自动 abort，释放 slot

```ts
export async function dispatchInboundMessage(params): Promise<DispatchInboundResult> {
  const finalized = finalizeInboundContext(params.ctx);
  return await withReplyDispatcher({
    dispatcher: params.dispatcher,
    run: () => dispatchReplyFromConfig({ ctx: finalized, cfg, dispatcher, ... }),
  });
}
```

### 4.6 EvoClaw 对照

| 能力 | OpenClaw | EvoClaw | 差距 |
|------|----------|---------|------|
| Binding 匹配层数 | 8 | 3 | 缺 peer.parent / guild+roles / guild / team |
| peer.kind 区分 | ✓ | ✗ | bindings 表只有 peer_id 无 kind |
| mainSessionKey | ✓ | ✗ | 每条消息都是 per-peer，无"全局会话" |
| lastRoutePolicy | ✓ | ✗ | 没有"Agent 全局视角 vs 对话视角"开关 |
| dmScope 可配置 | ✓ | ✗ | 格式写死 |
| identityLinks | ✓ | ✗ | 无身份聚合 |
| Envelope Builder 独立 | ✓ | 内联 | 可复用度低 |
| ReplyDispatcher（typing + 限流） | ✓ | 简版 | 无 typing relay 机制 |

**复刻优先级**：mainSessionKey + lastRoutePolicy + dmScope（核心团队语义）→ 8 层匹配（配置力量）→ ReplyDispatcher（体验）

---

## 5. TaskFlow 编排引擎

### 5.1 状态机

```
         createManagedTaskFlow()
                  │
                  ▼
               [queued]
                  │
         resumeFlow()
                  ▼
              [running]
                  │
   ┌──────────────┼──────────────┬──────────────┐
   │              │              │              │
setFlowWaiting() │         (子 task blocked)    │
   ▼              │              ▼              │
[waiting]    syncFlowFromTask() [blocked]       │
   │         (task succeeded)                   │
   │              ▼                             │
   │         finishFlow()                       │
   │              │                             │
   │              ▼                             │
   │         [succeeded]                        │
   │                                            │
   │              failFlow()                    │
   │                  ▼                         │
   └──→        [failed]                         │
                                                │
                 requestFlowCancel()            │
                       ▼                        │
                  [cancelled]                   │
                                                │
                        (无法追踪)               │
                             ▼                  │
                         [lost]  ←──────────────┘
```

关键转换函数（均在 `src/tasks/task-flow-registry.ts`）：

```ts
createManagedTaskFlow(params: {               // L374-396
  ownerKey: string;
  controllerId: string;
  goal: string;
  notifyPolicy?: TaskNotifyPolicy;
  status?: TaskFlowStatus;                    // 默认 "queued"
  requesterOrigin?: DeliveryContext;
  stateJson?: JsonValue;
  waitJson?: JsonValue;
}): TaskFlowRecord;

setFlowWaiting(params: {                      // L480-506
  flowId: string;
  expectedRevision: number;
  waitJson?: JsonValue;
  blockedTaskId?: string;
  blockedSummary?: string;
}): TaskFlowUpdateResult;

resumeFlow(params: {                          // L509-530
  flowId: string;
  expectedRevision: number;
  stateJson?: JsonValue;
}): TaskFlowUpdateResult;

finishFlow(params: {                          // L533-555
  flowId: string;
  expectedRevision: number;
  status?: "succeeded";                       // 默认
}): TaskFlowUpdateResult;

failFlow(params: {                            // L558-582
  flowId: string;
  expectedRevision: number;
  blockedSummary?: string;
}): TaskFlowUpdateResult;

requestFlowCancel(params): TaskFlowUpdateResult;
```

所有更新函数都要求 `expectedRevision`，失败返回 `{ kind: "revision_conflict", currentRevision }`（乐观锁）。

### 5.2 两种 syncMode 的对比

| syncMode | 特征 | 适用场景 |
|----------|------|---------|
| `"managed"` | Flow 状态由外部 controller agent 显式驱动，与任何 task 解耦 | lead agent 自己手写编排逻辑（如「UI + 文案 + 审校」三步） |
| `"task_mirrored"` | Flow 自动从绑定的单个 task 反向同步状态（`syncFlowFromTask`） | 单任务代理：一个 subagent 任务 = 一个 flow |

**`syncFlowFromTask`**（`src/tasks/task-flow-registry.ts:601-650`）状态映射规则：

```
task.status === "queued"                             → flow.status = "queued"
task.status === "running"                            → flow.status = "running"
task.status === "succeeded" && outcome !== "blocked" → flow.status = "succeeded"
task.status === "succeeded" && outcome === "blocked" → flow.status = "blocked" + blockedTaskId + blockedSummary
task.status === "cancelled"                          → flow.status = "cancelled"
task.status === "failed"                             → flow.status = "failed"
task.status === "lost"                               → flow.status = "lost"
```

只有 `syncMode === "task_mirrored"` 的 flow 才跑这个同步；`managed` flow 会被跳过。

### 5.3 lookupToken 语义

`src/tasks/task-flow-registry.ts:675-681`：

```ts
export function resolveTaskFlowForLookupToken(token: string): TaskFlowRecord | undefined {
  const lookup = token.trim();
  if (!lookup) return undefined;
  // 优先当 flowId 查
  // 查不到再当 ownerKey 查最新 flow
  return getTaskFlowById(lookup) ?? findLatestTaskFlowForOwnerKey(lookup);
}
```

**用户视角的"同一对话延续"**：用户二次消息 → 解析到同一个 sessionKey → 作为 ownerKey → 查最新 flow → 恢复 Agent 对该 flow 的记忆。

### 5.4 没有 Team / Squad —— 怎么拼出"团队"

OpenClaw 不给"团队"一级对象，但通过以下组合表达：

```
场景：用户在 Discord #general 群发 "写一篇公众号文章"

Config:
  bindings:
    - agentId: lead_plan      # 运营策划
      match: { channel: discord, guildId: X, peer: { kind: "channel", id: "general" } }
    # 注意只有 lead 被绑定，worker 不绑定任何 channel

  agents:
    list:
      - { id: lead_plan,    subagents: { allowAgents: ["writer", "designer"] } }
      - { id: writer,       model: ... }
      - { id: designer,     model: ... }
    acp:
      allowedAgents: ["writer", "designer"]    # 允许通过 sessions_spawn 调起

Flow:
  1. 消息进入 → 路由到 lead_plan
  2. lead_plan Agent reasoning：
     - createManagedTaskFlow({ ownerKey: currentSessionKey, controllerId: "lead_plan", goal: "公众号文章" })
     - 得到 flowId=F1
  3. lead_plan 调 sessions_spawn:
     - { task: "设计配图建议", agentId: "designer", runtime: "acp", streamTo: "parent", mode: "run" }
       → 创建 TaskRecord T1 { parentFlowId: F1, agentId: designer, childSessionKey: ... }
     - { task: "撰写正文", agentId: "writer", runtime: "acp", streamTo: "parent", mode: "run" }
       → 创建 TaskRecord T2 { parentFlowId: F1, agentId: writer, childSessionKey: ... }
  4. 子 agent 流式输出通过 stream-to-parent 中继回 lead_plan 主会话
  5. lead_plan 收齐 T1 T2 结果后，调 finishFlow(F1, revision)
  6. lead_plan 产出最终回复 → routeReply → Discord
```

**本质**：**「团队」= 一组 allowAgents 白名单 + 一个被 binding 绑定的 lead + 一个 TaskFlow 串起来的 task 群**。

### 5.5 EvoClaw 对照

| 能力 | OpenClaw | EvoClaw |
|------|----------|---------|
| TaskFlow 表 | ✓ | ❌ 完全缺失 |
| TaskRecord 持久化 | ✓ SQLite | ❌ 仅内存 Map |
| 状态机 8 种 | ✓ | 🟡 sub-agent-spawner 有简单状态 |
| `syncFlowFromTask` 自动推导 | ✓ | ❌ |
| `lookupToken` 支持续场 | ✓ | ❌ |
| `controllerId` 编排 | ✓ | ❌ |
| 乐观锁 `revision` | ✓ | ❌ |

**复刻关键点**：TaskFlow 是 OpenClaw 团队协作的核心骨架，EvoClaw 必须从 0 新建。见 §8.2。

---

## 6. Agent 派生 — ACP / Subagent / sessions_spawn

### 6.1 ACP 协议形态（OpenClaw 独有）

**ACP = Agent Control Protocol**，基于 `@agentclientprotocol/sdk`（外部 npm 包）。

```
┌─────────────────┐        stdio (ndJson)         ┌────────────────────┐
│  Parent Agent   │◄────────────────────────────►│   Child ACP Agent  │
│  (主进程)        │    request / notify          │   (独立进程/runtime)│
└─────────────────┘                              └────────────────────┘
     ▲                                                     │
     │ onAgentEvent("phase=end|error|delta")              │
     └──────── acp-spawn-parent-stream.ts 中继 ────────────┘
```

**关键协议消息**：
- `SessionNotification`：子 → 父，携带 `{ kind: "text_delta" | "status" | "tool_call", ... }`
- `RequestPermissionRequest / Response`：子向父请求工具调用授权
- `ClientSideConnection`：SDK 层的持久连接句柄

### 6.2 三种 runtime 对比

| 特征 | `runtime="acp"` | `runtime="subagent"` | `pi-embedded` |
|------|-----------------|---------------------|---------------|
| 进程 | 独立子进程 | 同进程或沙箱子进程 | ACP 的默认后端实现之一 |
| 通信 | stdio + ndJson | 函数调用 + 事件队列 | 同 ACP |
| sandbox | 仅 `inherit`（ACP 不能 `require`） | 支持 `require`（隔离安全） | 同 ACP |
| thread 绑定 | ✓（thread-bind stage） | ✗ | ✓ |
| stream-to-parent | ✓ | ✗ | ✓ |
| 可调"已存在"Agent | ✓（按 `acp.allowedAgents` 白名单） | ✓（按 `subagents.allowAgents`） | 同 ACP |
| 深度限制 | 无显式（白名单间接） | `DEFAULT_SUBAGENT_MAX_SPAWN_DEPTH = 4` | 同 ACP |

### 6.3 sessions_spawn 工具完整 Schema

`src/agents/tools/sessions-spawn-tool.ts:74-117` + `src/agents/acp-spawn.ts:72-103`：

```ts
// 工具参数（LLM 可见）
{
  task: string,                                // 必填，子任务描述
  label?: string,                              // 日志/线程命名
  runtime?: "subagent" | "acp",                // 默认 "subagent"
  agentId?: string,                            // 目标 Agent
  resumeSessionId?: string,                    // 仅 ACP，恢复 Codex 会话
  model?: string,                              // 仅 subagent，覆盖模型
  thinking?: string,                           // 仅 subagent
  cwd?: string,                                // 工作目录覆盖
  runTimeoutSeconds?: number,
  timeoutSeconds?: number,                     // 后向兼容别名
  thread?: boolean,                            // 绑定到当前渠道线程
  mode?: "run" | "session",                    // 生命周期
  sandbox?: "inherit" | "require",
  cleanup?: "delete" | "keep",                 // session 模式的清理策略
  streamTo?: "parent",                         // 仅 ACP
  attachments?: Array<{
    name: string;
    content: string;
    encoding?: "utf8" | "base64";
    mimeType?: string;
  }>,                                          // 仅 subagent
}

// 内部上下文（工具实现从 ctx 注入）
type SpawnAcpContext = {
  agentSessionKey?: string;      // 父会话 key
  agentChannel?: string;         // 当前渠道
  agentAccountId?: string;
  agentTo?: string;              // 目标 user / group
  agentThreadId?: string | number;
  agentGroupId?: string;
  sandboxed?: boolean;           // 调用者是否在沙箱内
};

// 返回值
type SpawnAcpResult = {
  status: "accepted" | "forbidden" | "error";
  childSessionKey?: string;
  runId?: string;                // 后台任务 id，用于中继
  mode?: "run" | "session";
  streamLogPath?: string;        // streamTo="parent" 时的 jsonl 日志路径
  note?: string;                 // 给 Agent 的人类可读提示
  error?: string;
};
```

### 6.4 派生策略矩阵

`src/agents/acp-spawn.ts:110-129`（`resolveAcpSpawnRuntimePolicyError`）：

| 调用者 | `sandbox="inherit"` | `sandbox="require"` |
|--------|---------------------|---------------------|
| 非沙箱 | ✓ | ✗（无沙箱 env 可进） |
| 沙箱内 | ✗（ACP 需要宿主 runtime） | ✗（叠加限制） |

错误信息示例：
```
'Sandboxed sessions cannot spawn ACP sessions because runtime="acp" runs on the host. Use runtime="subagent" from sandboxed sessions.'
```

### 6.5 stream-to-parent 中继

`src/agents/acp-spawn-parent-stream.ts:77-385`：

```ts
export function startAcpSpawnParentStreamRelay(params: {
  runId: string;                     // 后台任务 id
  parentSessionKey: string;
  childSessionKey: string;
  agentId: string;
  logPath?: string;                  // .acp-stream.jsonl
  emitStartNotice?: boolean;
}): AcpSpawnParentRelayHandle {
  // 职责：
  // 1. 订阅 onAgentEvent(runId) 的所有事件
  // 2. Assistant delta 缓冲（2.5s 间隔或换行符触发 flush）
  // 3. Lifecycle 事件：phase=end → 合并收尾；phase=error → 记录并停止
  // 4. 60s 无输出 → 发送"可能等待输入"警告
  // 5. 6 小时中继超时 → 强制终止并通知父
  // 6. 通过 recordTaskRunProgressByRunId 记录进度到 task registry
}
```

**关键点**：父 Agent 不需要轮询子 Agent 状态，子会话的流式输出会被中继写入父会话的 SSE 事件流，模型下一次 turn 自然看到。

### 6.6 生命周期与清理

`src/acp/control-plane/spawn.ts:17-77` + `src/agents/subagent-registry.ts`：

```ts
// 失败清理（best-effort）
async function cleanupFailedAcpSpawn(params): Promise<void> {
  if (params.runtimeCloseHandle) {
    await params.runtimeCloseHandle.runtime.close({
      handle: params.runtimeCloseHandle.handle,
      reason: "spawn-failed",
    });
  }
  // 关闭 ACP session + 解绑 thread + 删除 session 记录
}

// 成功派生后的全局追踪
registerSubagentRun({
  runId,
  childSessionKey,
  requesterSessionKey,
  requesterOrigin,
  task,
  cleanup,                          // "delete" | "keep"
  runTimeoutSeconds,
  expectsCompletionMessage: true,
  spawnMode,
});
```

### 6.7 EvoClaw 对照

| 能力 | OpenClaw | EvoClaw | 差距 |
|------|----------|---------|------|
| ACP 协议 / 跨进程派生 | ✓ | ✗ | 需完整新建 |
| sessions_spawn 工具 | 全特性 | 现有 spawn_agent（临时子代理） | 需改造：加 agentId/runtime/streamTo 参数 |
| 持久化 subagent registry | ✓ | ✗ | 仅内存 Map |
| stream-to-parent 中继 | ✓ | ✗ | 子代理完成才推一次消息 |
| 加载目标 Agent 完整身份 | ✓ | ✗ | spawn_agent 是"捏造替身"，不加载目标 SOUL.md/MEMORY.md |
| thread-bind | ✓ | ✗ | 无跨渠道 thread 概念 |
| 沙箱策略矩阵 | ✓ | ✗ | 无 sandbox=require |

**复刻重点**：§8.3 会把 ACP 最小子集 + persistent subagent registry + stream-to-parent 作为 Phase 3 主要产出。

---

## 7. 跨层联动 — 记忆 / 权限 / 工具 / MCP / Hook

### 7.1 Agent 身份与工作区

OpenClaw Agent 由以下组成：

- **配置**：`openclaw.toml` / `openclaw.yml` 里 `agents.list[].id` 项（`src/agents/agent-scope.ts:127-157`）
- **工作区**：`~/.openclaw/workspace-<agent-id>/` 或 `agent.workspace` 配置（`agent-scope.ts:268-284`）
- **Agent 目录**：`~/.openclaw/agents/<agent-id>/`（含 auth-profiles / memory / boot files）
- **Agent config 字段**：

```ts
type ResolvedAgentConfig = {
  name?: string;
  workspace?: string;
  agentDir?: string;
  model?: AgentEntry["model"];
  thinkingDefault?: AgentEntry["thinkingDefault"];
  skills?: AgentEntry["skills"];
  subagents?: { allowAgents?: string[]; requireAgentId?: boolean };
  tools?: { allowlist?: string[]; denylist?: string[] };
  runtime?: "acp" | "subagent";
  sandbox?: "inherit" | "require";
  heartbeat?: boolean;
  identity?: { instructions?: string; ... };
};
```

**EvoClaw 对应**：`packages/core/src/agent/agent-manager.ts` + Agent 工作区 9 文件（SOUL.md / IDENTITY.md / AGENTS.md / TOOLS.md / HEARTBEAT.md / USER.md / MEMORY.md / BOOT.md / BOOTSTRAP.md）。EvoClaw 的工作区更丰富，但没有 `subagents.allowAgents` 白名单 schema（当前 allowAgents 在 sub-agent-spawner 内部，不是 Agent config 级别）。

### 7.2 记忆隔离

OpenClaw：

- **Session memory hook**：`src/hooks/bundled/session-memory/handler.ts` 在 `/reset` 触发时把当前上下文保存到 `<workspace>/memory/<slug>.md`
- **Memory Host SDK**：`packages/memory-host-sdk/` 独立 npm 包，SQLite-based（files/chunks/embedding_cache/fts_index），per-agent 数据库在 `~/.openclaw/agents/<id>/memory.db`
- **Context Engine**：每个 agent 独立 `SessionManager`，上下文窗口按 agent 管理
- **父子记忆关系**：子 agent 可读父 workspace 的记忆（若权限允许），但写入隔离到自己 `memory/` 目录

**EvoClaw**：记忆层（L0/L1/L2 三层 + 9 类别）按 Agent 维度隔离（migration 002 `memory_units` 含 `agent_id`）。对应 OpenClaw 的 per-agent memory 完全具备，不需要复刻。

### 7.3 Auth Profiles 三维绑定

OpenClaw `src/agents/auth-profiles/`：

```
Session Auth Override  ←  runtime 临时覆盖
        ↑
Agent Auth Order       ←  AuthProfileStore.order[agentId] = [profileA, profileB]
        ↑
Global Profile Pool    ←  AuthProfileStore.profiles (id → credential)
```

**存储路径**：`~/.openclaw/agents/<agent-id>/.auth-profiles.json`（每 agent 一份，写锁保护）。

**轮转策略**：失败 profile 进入 cooldown（`auth-profiles.cooldown-auto-expiry.ts`），按 `lastGood` 优先，其余按 `order` 顺序。

**EvoClaw**：M6 已有 CredentialPool（`packages/core/src/agent/auth-profile-store.ts`），strategy=failover|round-robin，但是**per-provider 而非 per-agent**。复刻时加 per-agent `order` 覆盖。

### 7.4 工具 Allowlist 与 MCP per-agent

OpenClaw 的工具可见性：

```
全局工具池（Plugin 注册 + built-in + MCP servers）
           ↓
Agent skills filter（agent-scope.ts:159-164 normalizeSkillFilter）
           ↓  若 agent.skills = ["git", "npm"] 则只保留这两个
tool-split（pi-embedded-runner/tool-split.ts）
           ↓
LLM 可见工具清单
```

**MCP 连接粒度**：
- MCP servers 在 Gateway 层全局连接（`src/mcp/channel-server.ts`）
- 但每个 agent 通过 `tool-name-allowlist.ts` 过滤自己能看到的 MCP 工具子集
- **相同 MCP server 在不同 agent 上可暴露不同工具**

**EvoClaw**：`packages/core/src/mcp/mcp-client.ts` 是全局 McpManager，工具对所有 Agent 同等可见。复刻时加 per-agent allowlist filter（不需要重新连接 MCP server，仅在工具注入阶段过滤）。

### 7.5 Hook 系统的 Agent 上下文

OpenClaw `src/hooks/internal-hooks.ts:16-130`：

```ts
type InternalHookEventType = "command" | "session" | "agent" | "gateway" | "message";

type AgentBootstrapHookEvent = {
  type: "agent";
  action: "bootstrap";
  context: {
    agentId?: string;
    sessionKey?: string;
    workspaceDir: string;
    bootstrapFiles: WorkspaceBootstrapFile[];
  };
};

type MessageReceivedHookEvent = {
  type: "message";
  action: "received";
  context: {
    channelId: string;
    accountId?: string;
    metadata: {...};
    // agentId 由 routing 推导
  };
};
```

**Fire-and-forget Hook**（`src/hooks/fire-and-forget.ts`）会把事件广播给所有注册 handler，handler 自己 filter agentId。

**EvoClaw**：已有 hook 系统但 context 的 agentId/sessionKey 传递不统一；复刻时标准化 HookEventContext 的形状。

### 7.6 Session Lifecycle Events

OpenClaw `src/sessions/session-lifecycle-events.ts` + `subagent-lifecycle-events.ts`：

```
Session Created     → "session:created"
Session Completed   → "session:completed"
Session Failed      → "session:failed"
Subagent Ended      → "subagent:ended"   （子 → 父）
Task Progress       → "task:progress"    （通过 recordTaskRunProgressByRunId）
```

**EvoClaw**：已有 `packages/core/src/agent/agent-message-bus.ts`（agent 间消息）+ `system-events.ts`（事件注入），但没有 session 生命周期事件的标准 schema。复刻时扩展 agent-message-bus 的 type 枚举。

---

## 8. EvoClaw 1:1 复刻方案

### 8.1 Phase 1 — 渠道路由扩容（2 人周）

**目标**：把 EvoClaw 的 binding 从 3 层提升到 8 层 + 增加 mainSessionKey + 抽象 Envelope Builder。

#### 8.1.1 数据模型变更

新增 migration `027_binding_enhancement.sql`：

```sql
ALTER TABLE bindings ADD COLUMN peer_kind TEXT;         -- "direct" | "group" | "channel"
ALTER TABLE bindings ADD COLUMN guild_id TEXT;
ALTER TABLE bindings ADD COLUMN team_id TEXT;
ALTER TABLE bindings ADD COLUMN roles_json TEXT;         -- JSON array of role IDs
ALTER TABLE bindings ADD COLUMN dm_scope TEXT;           -- "main" | "per-peer" | ...
ALTER TABLE bindings ADD COLUMN last_route_policy TEXT DEFAULT 'session';

CREATE INDEX idx_bindings_guild ON bindings(channel, guild_id);
CREATE INDEX idx_bindings_team ON bindings(channel, team_id);
```

扩展 `Binding` TS interface（`packages/core/src/routing/binding-router.ts`）：

```ts
export interface Binding {
  id: string;
  agentId: string;
  channel: string;
  accountId: string | null;
  peerId: string | null;
  peerKind: "direct" | "group" | "channel" | null;  // 新
  guildId: string | null;                            // 新
  teamId: string | null;                             // 新
  roles: string[] | null;                            // 新，JSON 反序列化
  priority: number;
  isDefault: boolean;
  dmScope: DmScope | null;                           // 新
  lastRoutePolicy: "main" | "session";               // 新
  createdAt: string;
}
```

#### 8.1.2 resolveAgentRoute 8 层匹配重写

文件：`packages/core/src/routing/binding-router.ts`（完全重写 `matchBinding` 和新增 `resolveAgentRoute`）。

伪码见 §4.2。关键要加 WeakMap 缓存，否则每次消息重算 O(n)。

#### 8.1.3 SessionKey 多模式

文件：`packages/core/src/routing/session-key.ts`。改造 `generateSessionKey` 为：

```ts
export function generateSessionKey(params: {
  agentId: string;
  channel?: string;
  accountId?: string;
  peerKind?: "direct" | "group" | "channel";
  peerId?: string;
  dmScope?: DmScope;
}): SessionKey {
  const { agentId, dmScope = "per-account-channel-peer" } = params;
  // 按 dmScope 拼接，见 §4.3 五种格式
}

export function generateMainSessionKey(agentId: string): SessionKey {
  return `agent:${agentId}:main` as SessionKey;
}
```

**向后兼容**：保留原签名为 deprecated alias，调用新版本。

#### 8.1.4 抽离 Envelope Builder

新文件：`packages/core/src/channel/inbound-envelope.ts`：

```ts
export function resolveInboundRoute(cfg, msg): ResolvedAgentRoute { ... }
export function buildEnvelope(route, msg, metadata): MessageEnvelope { ... }
```

改造 `channel-message-handler.ts` 使用上面两个函数，不再内联 route 解析。

#### 8.1.5 验收

- 现有 3 层 binding 测试 100% 通过（向后兼容）
- 新增测试：8 层优先级命中、mainSessionKey / per-peer 切换、guildId+roles 匹配
- 手工：在 Discord guild 配 lead agent + worker agent 分角色 binding，消息按角色正确路由

---

### 8.2 Phase 2 — TaskFlow 引擎（3 人周）

**目标**：建立 flows + tasks 双表持久化 + 状态机 + 乐观锁 + lookupToken。

#### 8.2.1 数据模型

新增 migration `028_task_flow.sql`：

```sql
CREATE TABLE IF NOT EXISTS flows (
  flow_id TEXT PRIMARY KEY,
  sync_mode TEXT NOT NULL CHECK(sync_mode IN ('managed', 'task_mirrored')),
  owner_key TEXT NOT NULL,
  requester_origin_json TEXT,
  controller_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('queued','running','waiting','blocked','succeeded','failed','cancelled','lost')),
  notify_policy TEXT NOT NULL DEFAULT 'state_changes',
  goal TEXT NOT NULL,
  current_step TEXT,
  blocked_task_id TEXT,
  blocked_summary TEXT,
  state_json TEXT,
  wait_json TEXT,
  cancel_requested_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX idx_flows_owner ON flows(owner_key);
CREATE INDEX idx_flows_status ON flows(status);
CREATE INDEX idx_flows_controller ON flows(controller_id);

CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  runtime TEXT NOT NULL CHECK(runtime IN ('subagent', 'acp', 'cron')),
  owner_key TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('session', 'system')),
  child_session_key TEXT,
  parent_flow_id TEXT REFERENCES flows(flow_id) ON DELETE CASCADE,
  parent_task_id TEXT REFERENCES tasks(task_id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  requester_session_key TEXT NOT NULL,
  label TEXT,
  task TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','lost')),
  terminal_outcome TEXT CHECK(terminal_outcome IN ('blocked', 'timeout', 'none', NULL)),
  terminal_summary TEXT,
  progress_summary TEXT,
  notify_policy TEXT NOT NULL DEFAULT 'state_changes',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_event_at INTEGER,
  ended_at INTEGER
);
CREATE INDEX idx_tasks_owner ON tasks(owner_key);
CREATE INDEX idx_tasks_flow ON tasks(parent_flow_id);
CREATE INDEX idx_tasks_child_session ON tasks(child_session_key);
```

#### 8.2.2 新模块

新增目录 `packages/core/src/tasks/`：

```
tasks/
├── task-flow-registry.ts        # Flow CRUD + 状态机
├── task-registry.ts              # Task CRUD + lifecycle
├── flow-sync.ts                  # syncFlowFromTask
├── task-flow-types.ts            # TS 类型（从 Zod schema 推断）
└── __tests__/
    ├── task-flow-registry.test.ts
    ├── task-registry.test.ts
    └── flow-sync.test.ts
```

核心 API 签名参见 §5.1。

#### 8.2.3 乐观锁实现

所有更新走 `expectedRevision` 检查：

```ts
export function updateFlowRecordByIdExpectedRevision(params: {
  flowId: string;
  expectedRevision: number;
  patch: Partial<TaskFlowRecord>;
}): TaskFlowUpdateResult {
  const row = db.get(`SELECT revision FROM flows WHERE flow_id = ?`, params.flowId);
  if (!row) return { kind: "not_found" };
  if (row.revision !== params.expectedRevision) {
    return { kind: "revision_conflict", currentRevision: row.revision };
  }
  db.run(`UPDATE flows SET ..., revision = revision + 1, updated_at = ? WHERE flow_id = ? AND revision = ?`, ...);
  return { kind: "upserted", record: getTaskFlowById(params.flowId)! };
}
```

#### 8.2.4 Agent 工具层暴露

新增 4 个工具（注册到 TOOL_CATEGORY_MAP）：

```ts
flow_create({ goal, notifyPolicy? })                              // → flowId
flow_update({ flowId, expectedRevision, patch })                  // → revision
flow_wait({ flowId, expectedRevision, waitJson, blockedSummary }) // setFlowWaiting
flow_finish({ flowId, expectedRevision, status })                 // finishFlow | failFlow
```

与现有 `spawn_agent` 结合使用：sub-agent-spawner 在派生 task 时自动关联 `parentFlowId`（参数新增）。

#### 8.2.5 验收

- Flow CRUD + 状态机 12 个用例（每个转换一例）
- 乐观锁冲突场景
- syncFlowFromTask 正确推导
- lookupToken 按 flowId 和 ownerKey 两种模式
- 进程重启 / crash 后 flow 仍可查询
- 与 sub-agent-spawner 集成测试

---

### 8.3 Phase 3 — ACP 协议与 stream-to-parent（3-4 人周）

**目标**：引入 ACP 轻量版 + sessions_spawn 全特性 + stream-to-parent 中继 + 持久化 subagent registry。

#### 8.3.1 协议选型

OpenClaw 使用 `@agentclientprotocol/sdk`（外部包）。EvoClaw 复刻时有两条路径：

1. **完整 ACP**：引入同样 SDK，实现子进程 agent。工作量大，但与 OpenClaw 生态互通
2. **简化 ACP**：自建 stdio + ndJson 协议，仅支持 text_delta / phase / tool_call 三种消息。工作量小，足够覆盖团队协作场景

**建议**：先做简化版（Phase 3），若后续需要与 OpenClaw 互通再升级（A3 candidate）。

简化协议消息形态：

```ts
// 父 → 子
type ParentMessage =
  | { kind: "init"; agentId: string; cwd: string; env: Record<string, string> }
  | { kind: "prompt"; text: string; attachments?: Attachment[] }
  | { kind: "abort"; reason?: string }
  | { kind: "set_mode"; mode: "run" | "session" };

// 子 → 父
type ChildMessage =
  | { kind: "status"; phase: "starting" | "running" | "end" | "error"; message?: string }
  | { kind: "text_delta"; delta: string }
  | { kind: "tool_call"; toolName: string; args: unknown; requestPermission?: boolean }
  | { kind: "tool_result"; callId: string; result: unknown };
```

#### 8.3.2 新模块

```
packages/core/src/acp/
├── acp-protocol.ts              # ndJson 消息 schema（Zod）
├── acp-parent.ts                 # 父侧：spawn child process + message pump
├── acp-child-runner.ts           # 子侧：初始化 Agent + prompt loop + 消息回写
├── acp-stream-relay.ts           # stream-to-parent 中继（对应 acp-spawn-parent-stream.ts）
├── subagent-registry.ts          # 持久化 registry（SQLite 表 tasks + 内存索引）
└── __tests__/
    ├── acp-parent.test.ts
    ├── acp-child-runner.test.ts
    └── acp-stream-relay.test.ts
```

新 migration `029_acp_sessions.sql`：

```sql
-- 若 Phase 2 的 tasks 表已覆盖，只加索引即可
CREATE INDEX idx_tasks_runtime ON tasks(runtime);
CREATE INDEX idx_tasks_status ON tasks(status);

-- 新增 subagent_runs 表（跟踪 running subagent 的 runtime 元数据，task 结束后保留短期日志）
CREATE TABLE IF NOT EXISTS subagent_runs (
  run_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
  child_session_key TEXT NOT NULL,
  requester_session_key TEXT NOT NULL,
  pid INTEGER,
  stream_log_path TEXT,
  spawn_mode TEXT NOT NULL,
  expects_completion_message INTEGER NOT NULL DEFAULT 1,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  exit_code INTEGER,
  exit_reason TEXT
);
```

#### 8.3.3 sessions_spawn 工具改造

改造现有 `packages/core/src/agent/sub-agent-spawner.ts` 和对应的 `spawn_agent` 工具：

```ts
// 新工具 schema（保留 spawn_agent 作为别名，逐步迁移）
sessions_spawn({
  task: string,
  label?: string,
  runtime?: "subagent" | "acp",                // 新增
  agentId?: string,                            // 新增：必须在 allowAgents 白名单
  mode?: "run" | "session",                    // 新增
  thread?: boolean,                            // 新增
  sandbox?: "inherit" | "require",             // 新增
  streamTo?: "parent",                         // 新增
  runTimeoutSeconds?: number,
  cleanup?: "delete" | "keep",                 // 新增
  cwd?: string,
  attachments?: Array<...>,
})
→ { status, childSessionKey, runId, mode, streamLogPath?, note, error? }
```

**关键实现**：
- `agentId` 参数必须在该 agent 的 `subagents.allowAgents`（subagent）或 global `acp.allowedAgents`（ACP）白名单里
- 当 `agentId` 指定时，**加载目标 Agent 完整 SOUL/MEMORY/AGENTS 工作区**（通过 agent-manager），而不是创建匿名子代理
- `streamTo="parent"` 启动 acp-stream-relay.ts 的中继线程

#### 8.3.4 stream-to-parent 中继

`packages/core/src/acp/acp-stream-relay.ts` 关键逻辑（参考 `src/agents/acp-spawn-parent-stream.ts`）：

```ts
export function startAcpSpawnParentStreamRelay(params: {
  runId: string;
  parentSessionKey: string;
  childSessionKey: string;
  agentId: string;
  logPath?: string;
}): AcpSpawnParentRelayHandle {
  const flushMs = 2500;
  const stallWarnMs = 60_000;
  const maxRelayMs = 6 * 3600 * 1000;
  
  let buffer = "";
  let lastEventAt = Date.now();

  const unsubscribe = onAgentEvent(runId, (ev) => {
    lastEventAt = Date.now();
    if (ev.kind === "text_delta") {
      buffer += ev.delta;
      if (/\n/.test(buffer)) flush();
    }
    if (ev.kind === "status" && ev.phase === "end") {
      flush();
      emitSystemEvent(parentSessionKey, `[${agentId} 完成]`);
    }
    if (ev.kind === "status" && ev.phase === "error") {
      emitSystemEvent(parentSessionKey, `[${agentId} 失败: ${ev.message}]`);
      dispose();
    }
  });

  const flushTimer = setInterval(flush, flushMs);
  const stallTimer = setInterval(() => {
    if (Date.now() - lastEventAt > stallWarnMs) {
      emitSystemEvent(parentSessionKey, `[${agentId} 似乎在等待输入]`);
    }
  }, 5000);
  const maxTimer = setTimeout(() => {
    emitSystemEvent(parentSessionKey, `[${agentId} 达到 6h 中继上限，终止]`);
    dispose();
  }, maxRelayMs);

  function flush() {
    if (!buffer) return;
    emitSystemEvent(parentSessionKey, `[${agentId}] ${buffer}`);
    buffer = "";
  }

  function dispose() { /* clear timers + unsubscribe */ }
  return { dispose, notifyStarted, /* ... */ };
}
```

`emitSystemEvent` 复用 EvoClaw 现有 `packages/core/src/infrastructure/system-events.ts` 的 `enqueueSystemEvent`。

#### 8.3.5 验收

- sessions_spawn 单元测试：subagent + ACP 两种 runtime
- stream-to-parent 中继：子连续 delta → 父会话按行聚合收到
- 60s stall 警告触发
- 子 crash → 父收到 error 通知
- 跨进程重启：subagent_runs 表可查询 orphan runs 并清理

---

### 8.4 Phase 4 — per-Agent 工具/MCP/AuthProfile 隔离（2-3 人周）

**目标**：把工具、MCP、auth profile 从"全局共享"改造为"per-agent 可定制"。

#### 8.4.1 Agent config 新增字段

扩展 `packages/core/src/agent/agent-types.ts`：

```ts
export interface AgentConfig {
  // ... 现有字段
  subagents?: {
    allowAgents?: string[];      // 白名单
    requireAgentId?: boolean;    // 必须指定 agentId
    maxSpawnDepth?: number;      // 默认 4
  };
  tools?: {
    allowlist?: string[];
    denylist?: string[];
  };
  skills?: string[];             // 仅这些 skills 可用
  mcp?: {
    serverAllowlist?: string[];  // 仅这些 MCP server 可见
    toolAllowlist?: string[];    // 仅这些 MCP tool 可见（server.tool 格式）
  };
  authProfiles?: {
    order?: string[];            // profile id 顺序
    lastGood?: string;           // 上次成功的 profile id
  };
  lastRoutePolicy?: "main" | "session";
  dmScope?: DmScope;
}
```

#### 8.4.2 工具过滤层

新建 `packages/core/src/agent/tool-filter.ts`（对应 `pi-embedded-runner/tool-split.ts`）：

```ts
export function filterToolsForAgent(
  agent: AgentConfig,
  allTools: ToolDefinition[],
): ToolDefinition[] {
  // 按 tools.allowlist / denylist 过滤
  // 按 skills filter 过滤
  // 按 mcp.toolAllowlist 过滤 MCP 工具
  return filtered;
}
```

调用点：`packages/core/src/routes/chat.ts` 在调用 `enhancedTools.push(...)` 之后、传入 `runConfig.tools` 之前，增加一层 `filterToolsForAgent(agent, enhancedTools)`。

#### 8.4.3 MCP 工具可见性（不改连接，只改暴露）

修改 `packages/core/src/mcp/mcp-client.ts` 的 `McpManager.getToolsForAgent(agentId)`：

```ts
getToolsForAgent(agentId: string): McpToolInfo[] {
  const agent = agentManager.getAgentConfig(agentId);
  const serverAllowlist = agent?.mcp?.serverAllowlist;
  const toolAllowlist = agent?.mcp?.toolAllowlist;
  return this.getAllTools().filter(t => {
    if (serverAllowlist && !serverAllowlist.includes(t.serverName)) return false;
    const qualifiedName = `${t.serverName}.${t.name}`;
    if (toolAllowlist && !toolAllowlist.includes(qualifiedName)) return false;
    return true;
  });
}
```

#### 8.4.4 AuthProfile per-agent order

扩展 M6 的 `CredentialPool` → `AuthProfileStore`：

```ts
// packages/core/src/agent/auth-profile-store.ts
export class AuthProfileStore {
  // 现有：按 strategy 轮转
  
  // 新增：get order for agent
  getOrderForAgent(agentId: string): string[] {
    return agent.authProfiles?.order ?? [];
  }
  
  // 解析 active profile：per-agent order > lastGood > global order
  resolveActiveProfile(agentId: string): CredentialKey {
    const perAgentOrder = this.getOrderForAgent(agentId);
    for (const profileId of perAgentOrder) {
      const p = this.profiles.get(profileId);
      if (p && !this.isCooldown(p)) return p;
    }
    // fallback to global strategy
    return this.resolveGlobalActive();
  }
}
```

#### 8.4.5 Hook Context 标准化

修改 `packages/core/src/infrastructure/system-events.ts` 的事件 schema，固定字段：

```ts
interface SystemEvent {
  eventType: string;
  agentId?: string;         // 新增
  sessionKey?: string;      // 新增
  flowId?: string;          // 新增
  payload: unknown;
  timestamp: number;
}
```

#### 8.4.6 验收

- 单元测试：tool filter 按 allowlist/denylist/skills/mcp 正确过滤
- MCP per-agent 可见性：同一 server 在 agent A 暴露 {toolX}、agent B 暴露 {toolY}
- AuthProfile per-agent order：agent A 优先 profileA，agent B 优先 profileB
- Hook Context 带 agentId/sessionKey/flowId（抽样验证 3 种 hook 类型）

---

### 8.5 里程碑与可并行项

```
Phase 1 ──┬─► Phase 2 ─┬─► Phase 3 ──┬─► Phase 4 ─► 完成
          │            │            │
          │            │            └──►（可与 Phase 2 后半段并行）
          │            │
          │            └──►（可与 Phase 1 后半段并行）
          │
          └──►（无外部依赖）

总工作量: 10-12 人周（串行）或 7-9 人周（部分并行）
```

**并行机会**：
- Phase 2 的 flows/tasks schema 设计（1w）可与 Phase 1 尾声并行
- Phase 3 的 sessions_spawn schema 扩展（0.5w）可与 Phase 2 尾声并行
- Phase 4 的 Agent config schema 扩展（0.5w）可贯穿全程

### 8.6 测试策略

| 层 | 方法 | 覆盖度目标 |
|---|------|-----------|
| 单元 | Vitest | 85%+ |
| 集成 | 启动真 sidecar + mock channel | 所有 Phase 主路径 |
| E2E | Playwright + 桌面端 | 场景 §8.7 一条端到端 |

### 8.7 验收场景（端到端）

在企微群中用户发 "帮我写一篇公众号文章介绍 X 产品"，预期：

1. 消息路由到 lead agent "运营策划"（binding 按 channel+guild+role 命中）
2. lead agent 创建 TaskFlow F1（managed, controllerId=self）
3. lead agent 调 `sessions_spawn({agentId:"designer", runtime:"acp", streamTo:"parent", mode:"run"})` → T1
4. lead agent 调 `sessions_spawn({agentId:"writer", ...})` → T2
5. T1 T2 分别用各自 SOUL/MEMORY/AGENTS 身份执行，输出通过 stream relay 回到 lead session
6. lead agent 收齐产出，调 `flow_finish(F1)`
7. lead agent 最终 reply 回企微（含设计师建议 + 文案正文）
8. 用户在同一群再发 "把文案再润色一下" → routing 到 lead → lookupToken 恢复 F1 上下文 → lead 再 spawn writer → ...

---

## 9. 不确定项 & 后续验证

以下内容调研时未完全坐实，建议复刻前再核对一次：

1. **OpenClaw 的 `cron/isolated-agent/` 目录**：隔离 agent 执行模式，可能是一个独立于 ACP/Subagent 的第三种 runtime，调研未深入
2. **ACP SDK 版本绑定**：`@agentclientprotocol/sdk` 的具体 version / wire compat，若要完整 ACP 互通需锁定版本
3. **`acp.backend` 配置**：OpenClaw 支持 `acpx` 和 `pi-embedded` 两种后端选择，实际差异和选择逻辑未完全梳理
4. **`identityLinks` 的用户侧配置路径**：session-key.ts 接受此参数但调研未找到配置入口
5. **`waitJson` / `stateJson` 的惯例用法**：controller agent 如何消费这两个 JSON 字段，OpenClaw 未提供标准文档
6. **Flow 间依赖**：OpenClaw 是否支持 Flow A waits Flow B，或只能靠 controller agent 自己轮询
7. **Gateway protocol 的跨节点分布式能力**：OpenClaw 有 gateway 层做多节点协同，这超出本次调研（单机多 Agent 场景）

建议：Phase 2 开始前花 3 人日补一次针对上述 7 项的二次调研。

---

## 附录 A · OpenClaw 关键文件索引

| 主题 | 文件 | 用途 |
|------|------|------|
| Binding 类型 | `src/config/types.agents.ts` | AgentRouteBinding / Match / AcpBinding |
| Route 匹配 | `src/routing/resolve-route.ts` | resolveAgentRoute 8 层 |
| SessionKey | `src/routing/session-key.ts` | buildAgentPeerSessionKey |
| Envelope | `src/plugin-sdk/inbound-envelope.ts` | resolveInboundRouteEnvelopeBuilder |
| Dispatch | `src/auto-reply/dispatch.ts` | dispatchInboundMessage |
| ReplyDispatcher | `src/auto-reply/reply-dispatcher.ts` | 并发限流 + typing |
| TaskFlow | `src/tasks/task-flow-registry.ts` | 状态机 + CRUD |
| TaskFlow Store | `src/tasks/task-flow-registry.store.sqlite.ts` | SQLite 持久化 |
| Task Registry | `src/tasks/task-registry.ts` | Task CRUD |
| ACP Spawn | `src/agents/acp-spawn.ts` | sessions_spawn 主实现 |
| Stream Relay | `src/agents/acp-spawn-parent-stream.ts` | 子 → 父流式中继 |
| Subagent Spawn | `src/agents/subagent-spawn.ts` | 同进程派生 |
| Subagent Registry | `src/agents/subagent-registry.ts` | 运行中追踪 |
| ACP Control Plane | `src/acp/control-plane/manager.core.ts` | AcpSessionManager |
| Auth Profiles | `src/agents/auth-profiles/` | 凭据 per-agent |
| Tool Split | `src/agents/pi-embedded-runner/tool-split.ts` | 按 allowlist 过滤 |
| Agent Scope | `src/agents/agent-scope.ts` | Agent config 解析 |
| Hooks | `src/hooks/internal-hooks.ts` | InternalHookEventType |
| Session Lifecycle | `src/sessions/session-lifecycle-events.ts` | lifecycle 事件 |

## 附录 B · EvoClaw 需要修改/新建的文件清单

### 新建

| 路径 | Phase | 说明 |
|------|-------|------|
| `packages/core/src/infrastructure/db/migrations/027_binding_enhancement.sql` | 1 | bindings 加列 |
| `packages/core/src/infrastructure/db/migrations/028_task_flow.sql` | 2 | flows + tasks 表 |
| `packages/core/src/infrastructure/db/migrations/029_acp_sessions.sql` | 3 | subagent_runs 表 |
| `packages/core/src/channel/inbound-envelope.ts` | 1 | Envelope Builder |
| `packages/core/src/tasks/task-flow-registry.ts` | 2 | Flow CRUD + 状态机 |
| `packages/core/src/tasks/task-registry.ts` | 2 | Task CRUD |
| `packages/core/src/tasks/flow-sync.ts` | 2 | syncFlowFromTask |
| `packages/core/src/tasks/task-flow-types.ts` | 2 | Zod schema |
| `packages/core/src/acp/acp-protocol.ts` | 3 | ndJson schema |
| `packages/core/src/acp/acp-parent.ts` | 3 | 父侧 spawn + pump |
| `packages/core/src/acp/acp-child-runner.ts` | 3 | 子侧 runtime |
| `packages/core/src/acp/acp-stream-relay.ts` | 3 | stream relay |
| `packages/core/src/acp/subagent-registry.ts` | 3 | 持久化 registry |
| `packages/core/src/agent/tool-filter.ts` | 4 | per-agent 工具过滤 |

### 修改

| 路径 | Phase | 改动 |
|------|-------|------|
| `packages/core/src/routing/binding-router.ts` | 1 | 8 层匹配重写 |
| `packages/core/src/routing/session-key.ts` | 1 | 多模式 sessionKey |
| `packages/core/src/routes/channel-message-handler.ts` | 1 | 用新 Envelope Builder |
| `packages/core/src/routes/chat.ts` | 1,4 | 使用 mainSessionKey + tool filter |
| `packages/core/src/agent/sub-agent-spawner.ts` | 3 | sessions_spawn 新参数 + 加载目标 Agent 身份 |
| `packages/core/src/agent/agent-types.ts` | 4 | 扩展 AgentConfig 字段 |
| `packages/core/src/agent/auth-profile-store.ts` | 4 | per-agent order |
| `packages/core/src/mcp/mcp-client.ts` | 4 | getToolsForAgent |
| `packages/core/src/infrastructure/system-events.ts` | 4 | eventSchema 标准化 |
| `packages/shared/src/schemas/agent.schema.ts` | 4 | Zod 同步新增字段 |
| `packages/shared/src/schemas/config.schema.ts` | 1,4 | binding schema 扩展 |

---

## 附录 C · 相关 EvoClaw PR / Issue

- **PR #30 (M8 会话隔离)**：本报告中「session 权限隔离」能力的基础，Phase 3 的 sessions_spawn 跨 session 授权继承机制会用到这一基础
- **PR #20 (M6 CredentialPool)**：Phase 4 AuthProfile per-agent order 是其扩展
- **CapabilityUpgradePlan_2026-04-17.md § 新 M13**：本报告的落地计划应写入该规划文档作为 M13 模块
- **memory: feedback_branch_before_dev.md**：本系列复刻工作严格按"先建分支后开发"执行

---

**报告结束**

如对某一节有疑问或希望展开某个具体实现细节（例如 ACP ndJson 协议的完整 schema、ReplyDispatcher 的 typing 算法、TaskFlow 乐观锁的压力测试），请在 review 时标注，我会追加补充章节或拆分到下一篇报告。
