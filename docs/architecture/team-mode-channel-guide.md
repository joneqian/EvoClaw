# Team Mode 渠道适配器接入指南

> **生效日期**: 2026-04-25
> **关联**: [M13-MultiAgentTeam-Plan.md](../iteration-plans/M13-MultiAgentTeam-Plan.md)
> **目标读者**: 接入新 channel（iLink 微信 / 企微 / Slack / Discord / Teams 等）的开发者

## 目的

EvoClaw 的 Team Mode（多 Agent 群协作）核心是 channel-agnostic 的，靠 `TeamChannelAdapter` 接口对接具体渠道。本文档是新渠道接入的标准操作清单。

**MVP 已实现**：飞书（FeishuTeamChannel），见 `packages/core/src/channel/adapters/feishu/team-channel.ts`。

**Phase 2-3 待接**：
- iLink 微信（已有渠道适配但缺 team-channel 实现）
- 企微 WeCom（M9 部署架构 + 中转层就绪后）
- Slack（Phase 3）
- Discord / Teams / 飞书国际版 / 钉钉（按需）

每个渠道的接入工作量预估 **3-5 天**（不含真机测试）。

---

## 接入清单（7 步）

### Step 1 · 实现 `TeamChannelAdapter` 接口

继承自 `packages/core/src/channel/team-mode/team-channel.ts`：

```ts
export interface TeamChannelAdapter {
  readonly channelType: string;

  classifyInboundMessage(event: unknown, ownContext: OwnBotContext): Promise<MessageClassification>;
  listPeerBots(groupSessionKey: GroupSessionKey, selfAgentId: string): Promise<PeerBotInfo[]>;
  buildMention(groupSessionKey, peer, text, metadata?): Promise<ChannelOutboundMessage>;
  renderTaskBoard(plan: TaskPlanSnapshot): ChannelOutboundMessage;
  updateTaskBoard(groupSessionKey, existingCardId, plan): Promise<{ cardId: string }>;
  onGroupMembershipChanged?(handler: (key: GroupSessionKey) => void): void;
}
```

新建文件 `packages/core/src/channel/adapters/<channel>/team-channel.ts`，类名 `<Channel>TeamChannel`。

### Step 2 · `classifyInboundMessage` 四分支

每条入站消息必须分到这四类之一：

| kind | 含义 | 处理 |
|---|---|---|
| `self` | 自己 bot 的回声 | 必须 drop（防回环）|
| `peer` | 同群另一个 EvoClaw bot | 收下，打标 `peer_message=true`，走 loop-guard |
| `stranger` | 非 EvoClaw 的 bot 或外部应用 | drop |
| `user` | 真人用户 | 走原有用户路径 + 命令识别 |

**每个渠道关键判别逻辑各异**：

| 渠道 | 自/他识别 | 同事识别 |
|---|---|---|
| **飞书** | `sender.sender_type === 'app'` + `sender_id.app_id === ownAppId` | 反查 bindings 表里 `feishu` 类型 + 该 chat_id 出现过的所有 appId |
| **iLink 微信** | 比对 sender 的 wxid 与 own bot wxid | bindings 表里 `ilink` 类型 + 同群 wxid 集合 |
| **企微** | `from_userid` 与 own bot userid | bindings 表里 `wecom` 类型 + 同群 |
| **Slack** | `event.user` 与 own bot user_id；区分 `bot_id` | Slack `users.list` + `is_bot` + bindings 反查 |
| **Discord** | `message.author.bot && message.author.id === ownBotId` | Discord `guild.members.fetch()` + `bot=true` + bindings |

**错误模式**：
- 漏掉 `self` 判定 → 群里多 bot 会无限互相回声
- 错把陌生 bot 当 peer → 安全风险，外部 bot 注入指令
- 用户名相似导致误判 → 用 ID（不是名字）做最终判定

### Step 3 · `listPeerBots` 群成员查询

**首选：原生 API**

| 渠道 | API | 返回 |
|---|---|---|
| 飞书 | `chat.members.get(chatId, member_id_type='open_id')` | 含 `member_type === 'robot'` |
| Slack | `conversations.members(channel)` | 各成员调 `users.info` 看 `is_bot` |
| Discord.js | `guild.members.fetch().filter(m => m.user.bot)` | 直接 |
| 企微 | `cgi-bin/appchat/get?chatid=...` | groupchat.userlist |
| 飞书国际版 / 钉钉 | 类似飞书 | 字段名不同 |

**降级：被动缓存模式**（无群成员 API 的渠道）

适用场景：iLink 微信、某些纯 webhook 接入的微信生态。

降级策略：
1. 维护 `(groupSessionKey, peerBotId, lastSeenAt)` 表，每收到一条 peer 入站消息就更新
2. `listPeerBots` 返回最近 24 小时活跃的 peer bot
3. 首次进群可能 roster 为空，几轮交互后稳定
4. 在 Agent 系统 prompt 里明确"团队成员可能未完全识别，遇到不在 roster 中的同事请提醒用户"

**实现位置**：`packages/core/src/channel/adapters/<channel>/peer-bot-registry.ts`，类似飞书的实现。

**反查 bindings**：拿到群里所有 bot 标识后，必须 join 本地 `bindings` 表才知道哪些是 EvoClaw 绑定的。

### Step 4 · `buildMention` 原生 @ 格式

每个渠道的 @ 语法不同，必须用渠道原生格式才能触发推送通知：

| 渠道 | 格式 | 注意 |
|---|---|---|
| **飞书 post** | `<at user_id="ou_xxx">` | message_extra JSON 里塞 metadata |
| **iLink 微信** | text + `at_list: [wxid]` 字段 | 必须是好友 / 群友 |
| **企微** | `<@userid>` 或 `at_list` 数组 | 看消息类型 |
| **Slack** | `<@Uxxxxxx>` | 仅 user_id，不能用名字 |
| **Discord** | `<@123456789>` 或 mention object | role / channel mention 不同语法 |
| **Teams** | `<at id="0">name</at>` + 单独 mentions[] entity | 必须配合 |
| **钉钉** | text + `at: {atUserIds: [...]}` | 不能用名字 |

**metadata 携带 task_id / plan_id**：每个渠道有不同的 "extra fields" 用来塞自定义数据：
- 飞书：`message.extra` JSON 字段
- Slack：`metadata.event_payload`
- Discord：嵌入 embed 的 footer.text 或自建索引
- 企微：`agentid` 不能塞业务数据，需要本地落 `(messageId → metadata)` 映射表

**fallback**：如果渠道完全无 metadata 字段，本地建一个 `outbound_messages` 表记录 `messageId → { taskId, planId, chainDepth }`，入站时反查。

### Step 5 · `renderTaskBoard` / `updateTaskBoard` 看板渲染

任务看板是 plan 的可视化镜像。各渠道的富消息能力差异巨大：

| 渠道 | 推荐形式 |
|---|---|
| **飞书** | CardKit interactive 卡片（M11.1 PR4 已支持流式 update） |
| **Slack** | Block Kit + `chat.update` 替换原消息 |
| **Discord** | Embed + edit message |
| **企微** | 模板卡片（template_card） |
| **iLink 微信** | 富文本（Markdown 语法）；不支持原地更新 → 每次发新一条，旧的标"已过期" |
| **钉钉** | ActionCard / FeedCard |

**统一渲染数据 `TaskPlanSnapshot`**（channel-agnostic）：
```ts
interface TaskPlanSnapshot {
  id: string;
  goal: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  tasks: Array<{
    localId: string;
    title: string;
    assignee: { agentId: string; name: string; emoji: string };
    status: TaskStatus;
    dependsOn: string[];
    artifacts: Array<{ kind: string; title: string; uri: string; summary: string }>;
    staleMarker?: 'yellow_15min' | 'red_30min';
  }>;
  createdBy: { agentId: string; name: string };
  createdAt: number;
  updatedAt: number;
}
```

Adapter 把 snapshot 翻译成渠道原生格式。

**更新策略**：
- 支持原地更新的渠道（飞书 / Slack / Discord）→ `updateTaskBoard` 调原 update API
- 不支持的渠道 → 每次状态变化发新看板，前一条带"已过期 ⚠️"标记
- 节流：同一 plan 1 秒内合并多次更新

### Step 6 · 注册到 `TeamChannelRegistry` + 监听成员变更

```ts
// 在 channel adapter 启动入口
import { teamChannelRegistry } from '../../team-mode/team-channel-registry';
import { FeishuTeamChannel } from './team-channel';

teamChannelRegistry.register('feishu', new FeishuTeamChannel(deps));

// 订阅成员变更
adapter.onGroupMembershipChanged((groupSessionKey) => {
  peerRosterService.invalidate(groupSessionKey);
});
```

**成员变更事件**（按渠道）：
- 飞书：`im.chat.member.bot.added_v1` / `removed_v1` / `p2p_chat_create`
- Slack：`member_joined_channel` / `member_left_channel`
- Discord：`guildMemberAdd` / `guildMemberRemove`
- 企微：`change_external_chat`（不完整，需轮询补）
- iLink 微信：被动观察入群通知消息

**没有成员变更事件的渠道** → 依赖 5 min TTL 兜底。

### Step 7 · 集成测试

每个新 adapter 至少要跑通这五个测试场景：

```ts
describe('<Channel>TeamChannel', () => {
  it('classify: 自己消息丢', async () => { /* sender = own → kind:self */ });
  it('classify: 同事 bot 收', async () => { /* sender 在 bindings 表 → kind:peer */ });
  it('classify: 陌生 app 丢', async () => { /* sender 不在 bindings → kind:stranger */ });
  it('classify: 真人用户走原流程', async () => { /* sender = user → kind:user */ });
  it('listPeerBots: 取交集', async () => { /* 群成员 ∩ bindings → 排除 self */ });
  it('buildMention: 原生 @ 格式 + metadata', async () => { /* 检验输出包含原生 mention 标记 */ });
  it('renderTaskBoard: snapshot → 卡片', async () => { /* 多任务 + 多 artifact */ });
  it('updateTaskBoard: 原地更新或发新条', async () => { /* 状态变化触发更新 */ });
});
```

测试位置：`packages/core/src/__tests__/<channel>/team-channel.test.ts`

集成测试样板见 `packages/core/src/__tests__/feishu/team-channel.test.ts`。

---

## 已知陷阱与最佳实践

### 1. Bot 自我消息识别要严

很多渠道的 bot 入站事件长得跟普通用户一样，必须用**ID 比对**而非用户名。错把自己的消息当成 peer 收下，会立刻形成无限回环。

### 2. Peer 列表必须排除 self

`listPeerBots` 返回前必须 `filter(p => p.agentId !== selfAgentId)`，否则 Agent 会在 prompt 里看到自己，可能产生自 @ 幻觉。

### 3. Roster 缓存失效要双保险

- **事件驱动**：成员变更事件 → 立即失效
- **TTL 兜底**：5 min 自动重建

只依赖事件 → 事件丢失会永久错位；只依赖 TTL → 用户体验差（5 min 看不到新成员）。两者都要。

### 4. metadata 透传可能要自建索引

不是所有渠道都有"消息扩展字段"。如果渠道没有，本地建 `outbound_messages_metadata` 表用 messageId 索引。入站时按 `replyToMessageId` 反查。

### 5. 看板节流

状态变化频繁时（多 Agent 并发完成）会狂调 `updateTaskBoard`。建议：
- 同一 plan 1 秒内合并
- 看板渲染本身要 idempotent（同 snapshot 多次渲染结果一致）

### 6. 频率熔断要在 inbound 入口

`loop-guard` 的最终硬熔断（单群 60s 内 100 条 bot 消息）必须在 inbound 钩子最早期判定。如果延迟到 LLM 调用层熔断，已经浪费了大量 token。

### 7. 渠道 SDK 重试 + 限流

不同渠道有各自的限流码，必须封装 retry：
- 飞书：M11.1 已有 `withFeishuRetry`，限流 99991400 族 + 5xx 重试 3 次（equal jitter）
- Slack：429 + Retry-After header
- Discord：rate-limit response header `X-RateLimit-Remaining`

每个渠道写自己的 `with<Channel>Retry`，复用 jitter 策略。

### 8. 配对码（pairing code）模式

某些渠道（OpenClaw 飞书的 pairing 模式）允许用户先在群里发触发码，再绑定 bot。本期 EvoClaw 不做，但 adapter 设计要预留 — 通过 `OwnBotContext` 传入 pairing 状态。

---

## 渠道接入路线图

| 渠道 | 工时 | 优先级 | 备注 |
|---|---|---|---|
| **飞书** | M13 本期 | ✅ 已交付 | FeishuTeamChannel |
| **iLink 微信** | 3-4d | Phase 2 高 | 已有 channel adapter，仅缺 team-channel；被动缓存模式 |
| **企微 WeCom** | 4-5d | Phase 2 中 | 需 M9 部署架构 + 中转层就绪（桌面 sidecar 无公网 IP）|
| **Slack** | 3d | Phase 3 中 | API 完善，是除飞书外最容易接的 |
| **Discord** | 3d | Phase 3 低 | 适合开发者社群场景 |
| **钉钉** | 4d | Phase 3 低 | 国内企业市场 |
| **Teams** | 5d | Phase 3+ | API 复杂，国际企业场景 |
| **飞书国际版（Lark）** | 1d | 按需 | 复用飞书代码，仅改 endpoint |

---

## FAQ

**Q1: 我的渠道没群成员 API，被动缓存模式真的够用吗？**
A: 够用但有体验代价。前几次交互 roster 不全，Agent 可能不知道某些同事。建议在系统 prompt 里加一句"团队成员发现可能延迟，遇到 roster 外的消息别忽略"。长期还是建议推动渠道方提供成员 API。

**Q2: 不同渠道的 bot 能在同一个 plan 里协作吗？（比如 PM 在飞书，前端在 Slack）**
A: **MVP 不支持**。`group_session_key` 锁死到单个渠道的单个群。Phase 2 的"跨群 / 跨渠道协作"才解锁。

**Q3: 我必须实现 `onGroupMembershipChanged` 吗？**
A: 不必须，方法标记为 optional。没有的话靠 5 min TTL 兜底；有的话能做到立即响应成员变更。

**Q4: `groupSessionKey` 的格式有强制约定吗？**
A: 形如 `<channelType>:<groupKind>:<id>`，例如：
- `feishu:chat:oc_xxx`
- `slack:channel:Cxxxxx`
- `discord:guild:1234:channel:5678`
- `ilink:room:wr_xxx`

前缀 `<channelType>:` 用于注册表分发，剩余部分由 adapter 自行约定。

**Q5: 测试用的 mock channel 怎么写？**
A: 本期 EvoClaw 不内置 mock channel（用户偏好真机测）。Phase 2 如果开发量上来，可参考 OpenClaw 的 `MemoryChannel` 写一个 `MemoryTeamChannel` 用于 CI。
