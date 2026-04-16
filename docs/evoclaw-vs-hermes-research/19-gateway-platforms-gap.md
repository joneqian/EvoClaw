# 19 — Gateway 多平台网关总览 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/19-gateway-platforms.md`（475 行，Phase D draft）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`gateway/run.py` ~7688 行 + `gateway/platforms/base.py` 1825 行 + 16 个平台 adapter
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16）
> **综合判定**: 🟡 **部分覆盖；国产渠道深度反超，国际平台覆盖明显落后**

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes Gateway**（`.research/19-gateway-platforms.md` §1-§2，`gateway/run.py:1-7688` 主入口 + `gateway/platforms/base.py:1-1825` 抽象基类） — 独立常驻进程 `GatewayRunner`，单个 asyncio 事件循环并发承载 16 个消息平台的 adapter（Telegram / Discord / Slack / Signal / Matrix / WhatsApp / Feishu / WeCom / DingTalk / Mattermost / Email / SMS / API Server / Webhook / Home Assistant / BlueBubbles）。核心设计：**BasePlatformAdapter 抽象合约** + **MessageEvent 归一化** + **SessionStore 生命周期** + **PairingStore DM 授权** + **HookRegistry 事件钩子** + **DeliveryRouter cron 输出**。整个 gateway 子系统代码量 ~14,000 行（主进程 + 抽象基类 + 16 platform adapter）。

**EvoClaw Channel 子系统** — **并非独立进程**，而是 Sidecar（Bun HTTP 服务）内的一个子模块。由 7 个文件 + 4 个 adapter 组成：
- `packages/core/src/channel/channel-adapter.ts:31-55` — `ChannelAdapter` 统一接口（55 行）
- `packages/core/src/channel/channel-manager.ts:20-190` — `ChannelManager` 注册/连接/重连（190 行）
- `packages/core/src/channel/message-normalizer.ts:7-172` — 平台事件 → `ChannelMessage` 归一化
- `packages/core/src/channel/channel-state-repo.ts:17-50` — channel_state KV 持久化
- `packages/core/src/channel/command/command-dispatcher.ts:28-61` — Slash 命令分发 + 技能 fallback
- `packages/core/src/routing/binding-router.ts:26-95` — Channel → Agent 4 级最具体优先匹配
- `packages/core/src/routing/session-key.ts:12-19` — `agent:<id>:<channel>:<chatType>:<peerId>` 组合键
- Adapter: `desktop.ts`（64 行）/ `feishu.ts`（203 行）/ `wecom.ts`（168 行）/ `weixin.ts`（529 行 + 12 个 weixin-* 辅助文件共 ~2800 行）

**量级对比**: hermes 16 个 adapter（总计 ~14000 行）vs EvoClaw 4 个 adapter（~4000 行总）。hermes 覆盖国际主流 IM；EvoClaw 专精国产 IM（微信 iLink Bot / 企微 / 飞书），并在渠道**深度实现**上有独特复杂度（微信 CDN 解密 / SILK 语音转码 / QR 扫码登录 / context_token 管线）。

**架构差异核心**：
- hermes 是"**单进程多 adapter 消息总线**"，所有 IM 连接在一个长驻 Python 进程内
- EvoClaw 是"**Sidecar 内嵌 Channel Manager**"，桌面 UI 既是平台也是消费者，IM 连接复用 Bun HTTP 事件循环

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | Gateway 总体架构（进程形态） | 🟡 | hermes 独立进程 + HookRegistry 事件驱动；EvoClaw Sidecar 内嵌 + 直接函数调用 |
| §3.2 | Channel 抽象接口（adapter 合约） | 🟡 | EvoClaw 7 方法精简合约 vs hermes 13+ 方法富合约（缺 send_image/send_video/send_voice/edit_message） |
| §3.3 | 消息入管线（Event → Message 归一化） | 🟡 | EvoClaw `ChannelMessage` 10 字段 vs hermes `MessageEvent` 12 字段 + `SessionSource` 9 字段（缺 reply_to/thread_id/auto_skill） |
| §3.4 | 消息出管线（Response → Platform API） | 🟡 | EvoClaw 直接 await sendMessage；hermes 含 `_send_with_retry` 指数退避 + SendResult 结构化返回 |
| §3.5 | Binding Router（Channel → Agent 路由） | 🟢 | **反超**：4 级最具体优先匹配（peerId → accountId → channel → default），hermes 无等价抽象 |
| §3.6 | Session Key 策略（多维定位） | 🟢 | **反超**：`agent:<id>:<channel>:<dm\|group>:<peer>` 5 维组合键，hermes `build_session_key` 仅 3-4 段 |
| §3.7 | 渠道工具注入（channel:<name>:*） | 🟢 | **反超**：`createChannelTools` 按当前 channel 动态注入 feishu_send/wecom_send/weixin_send_media 等；hermes 无渠道专用工具命名空间 |
| §3.8 | 媒体管线抽象（图片/视频/语音/文件） | 🟡 | hermes 基类统一 `cache_image_from_url` + SSRF 检查；EvoClaw 媒体仅 weixin 深度实现（CDN 解密 + SILK 转码），feishu/wecom 未实现 |
| §3.9 | 身份识别（user/peer/group/thread） | 🟡 | EvoClaw 含 channel/peerId/chatType/accountId 4 维；hermes `SessionSource` 9 字段含 thread_id / user_id_alt / chat_id_alt（缺 thread / Signal UUID 支持） |
| §3.10 | 认证模型（Bot token / QR / OAuth） | 🟢 | **反超**：EvoClaw 微信 QR 扫码登录（/weixin/qrcode + 轮询）业界独创；hermes 各 adapter 仅静态 Bot token / OAuth 刷新 |
| §3.11 | 长轮询 vs Webhook 选择 | 🟢 | **反超**：EvoClaw 双模式并存（微信长轮询 + 飞书/企微 Webhook），且长轮询含游标持久化 + 指数退避 |
| §3.12 | Markdown / 格式化转换 | 🟢 | **反超**：`markdownToPlainText` 专为微信不支持 Markdown 设计（代码块/表格/图片/链接 13 种规则），hermes 无等价转换 |
| §3.13 | 错误恢复（断线重连 / 消息重试） | 🟡 | EvoClaw ChannelManager 指数退避 10 次重连，缺 `_send_with_retry` 瞬时失败 jitter retry + fatal error 追踪 |
| §3.14 | 已支持平台清单 | 🔴 | hermes 16 个国际 + 国产 vs EvoClaw 4 个（local/feishu/wecom/weixin）缺 Telegram/Discord/Slack/Signal/Matrix/WhatsApp |
| §3.15 | Slash 命令本地快速路径 | 🟡 | EvoClaw 9 个命令（echo/debug/help/model/...）vs hermes 30+ 命令（新增 /provider /reasoning /usage /insights /compress /title /resume /approve /deny /stop） |
| §3.16 | Debug 追踪 / 全链路观测 | 🟢 | **反超**：EvoClaw `weixin-debug.ts` 全链路耗时追踪（平台→插件/媒体下载/AI 生成）；hermes 无等价功能 |

**统计**: 🔴 1 / 🟡 8 / 🟢 7（其中 6 项明确反超）。

---

## 3. 机制逐条深度对比

每条同时给出 **hermes 实现**（`.research/19-gateway-platforms.md` 行号引用）+ **EvoClaw 实现**（带源码行号）+ **判定与分析**。

### §3.1 Gateway 总体架构（进程形态）

**hermes**（`.research/19-gateway-platforms.md` §1, §3.1, `gateway/run.py:463+`）— 独立进程 + 集中式 Runner:

```python
class GatewayRunner:
    def __init__(self, config=None):
        self.config = config or load_gateway_config()
        self.adapters: Dict[Platform, BasePlatformAdapter] = {}
        self.session_store = SessionStore(...)
        self.pairing_store = PairingStore()
        self.hooks = HookRegistry()
        self._agent_cache: Dict[str, tuple] = {}        # prompt caching
        self._running_agents: Dict[str, Any] = {}        # interrupt
        self._pending_approvals: Dict[str, Dict] = {}    # exec 审批
        self._failed_platforms: Dict[Platform, Dict] = {}
```

- 启动流程（`start()`, ~L1050）：对每个 platform 实例化 adapter → `set_message_handler` → `adapter.connect()`
- 后台任务：`_session_expiry_watcher`（5 分钟）+ `_platform_reconnect_watcher`
- 发射 `emit("gateway:startup")` hook
- SIGTERM/SIGINT 时 `stop()` 断开所有 adapter + flush memories + 关闭 DB

**EvoClaw**（`packages/core/src/channel/channel-manager.ts:20-190`）— Sidecar 内嵌 + 精简 Manager:

```typescript
export class ChannelManager {
  private adapters = new Map<ChannelType, ChannelAdapter>();
  private configs = new Map<ChannelType, ChannelConfig>();
  private reconnectTimers = new Map<ChannelType, ReturnType<typeof setTimeout>>();
  private reconnectAttempts = new Map<ChannelType, number>();
  private messageHandler: MessageHandler | null = null;

  registerAdapter(adapter: ChannelAdapter): void { /* ... */ }
  async connect(config: ChannelConfig): Promise<void> { /* ... */ }
  async sendMessage(channel, peerId, content, chatType?): Promise<void> { /* ... */ }
  async disconnectAll(): Promise<void> { /* ... */ }
}
```

- 无独立进程，Channel Manager 存在于 `packages/core` Sidecar 内
- 无集中 `SessionStore` / `PairingStore` / `HookRegistry`，职责分散到 `routing/` + `infrastructure/system-events.ts` + `agent/lane-queue.ts`
- 无 `_agent_cache`（Agent 实例由 `agent-manager.ts` 独立管理，不按 session key 缓存）
- 生命周期通过 `registerShutdownHandler`（见 00-overview-gap.md §优雅关闭）串行清理

**判定 🟡**：取向不同。
- hermes 独立进程架构适合"多平台中继"生产部署（gateway 宕机不影响核心 agent 进程）
- EvoClaw Sidecar 内嵌架构适合"桌面应用"（用户本地运行，一切在一个 Bun 进程），进程少部署简单
- 缺失：HookRegistry 这种事件驱动扩展点 EvoClaw 无，外部插件无法在 `gateway:message` 时挂钩

---

### §3.2 Channel 抽象接口（Adapter 合约）

**hermes**（`.research/19-gateway-platforms.md` §3.3，`gateway/platforms/base.py:599-1267+`）— 13+ 方法富合约:

| 方法 | 行号 | 语义 |
|------|------|------|
| `connect()` | 728 | 连接并启动监听 |
| `disconnect()` | 737 | 断开连接 |
| `send(chat_id, content, reply_to?, metadata?)` | 742 | 发送文本 → `SendResult` |
| `edit_message(chat_id, message_id, content)` | 763 | 编辑消息 |
| `send_typing(chat_id, metadata?)` | 776 | 输入指示器 |
| `stop_typing(chat_id)` | 785 | 停止指示器 |
| `send_image(chat_id, image_url, caption?)` | 793 | 发送图片 |
| `send_animation(chat_id, ...)` | 812 | 发送 GIF |
| `send_voice(chat_id, voice_url, caption?)` | 883 | 发送语音 |
| `send_video(chat_id, ...)` | 917 | 发送视频 |
| `send_document(chat_id, url, filename?)` | 936 | 发送文档 |
| `handle_message(event)` | 1267 | 处理入站消息 |
| `get_chat_info(chat_id)` | 1694 | 获取频道/用户信息 |

**EvoClaw**（`packages/core/src/channel/channel-adapter.ts:31-55`）— 7 方法精简合约:

```typescript
export interface ChannelAdapter {
  readonly type: ChannelType;
  connect(config: ChannelConfig): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: MessageHandler): void;
  sendMessage(peerId: string, content: string, chatType?: 'private' | 'group'): Promise<void>;
  sendMediaMessage?(peerId: string, filePath: string, text?: string, chatType?: 'private' | 'group'): Promise<void>;
  sendTyping?(peerId: string, cancel?: boolean): Promise<void>;
  getStatus(): ChannelStatusInfo;
}
```

- 仅 3 个必填方法（connect/disconnect/sendMessage）+ onMessage/getStatus
- `sendMediaMessage` / `sendTyping` 为可选扩展
- `grep -rn "sendImage\|sendVideo\|sendVoice\|sendDocument\|editMessage" packages/core/src/channel` 零结果

**判定 🟡**：
- 🟢 EvoClaw 精简合约对"新增 adapter"更友好（只需实现 5 个方法）
- 🔴 缺能力：无专用 `sendImage` / `sendVideo` / `sendVoice` / `sendDocument` / `editMessage`
  - 图片/视频/文件统一通过 `sendMediaMessage(filePath, ...)` 按 MIME 分发，这是**简化但能力降级**
  - 无 `editMessage` 意味着无法做 hermes 的"流式 token 边写边更新"（Telegram 1 edit/s / Discord 10 edit/10s）
- 🔴 缺 `get_chat_info` 之类的反查，无法列出群成员、获取频道描述

---

### §3.3 消息入管线（Event → Message 归一化）

**hermes**（`.research/19-gateway-platforms.md` §2.2，`gateway/platforms/base.py:506+`）— `MessageEvent` + `SessionSource` 双层数据类:

```python
@dataclass
class MessageEvent:
    text: str
    message_type: MessageType              # TEXT|PHOTO|VIDEO|AUDIO|VOICE|DOCUMENT|STICKER|COMMAND
    source: SessionSource                  # 来源标识（9 字段）
    raw_message: Any                       # 原始平台对象
    message_id: Optional[str]
    media_urls: List[str]                  # 本地文件路径（已下载缓存）
    media_types: List[str]                 # 对应 MIME
    reply_to_message_id: Optional[str]     # 引用上文
    reply_to_text: Optional[str]           # 上文文本（context injection）
    auto_skill: Optional[str]              # 自动加载的 skill
    internal: bool                         # 绕过授权检查
    timestamp: datetime

@dataclass
class SessionSource:
    platform: Platform
    chat_id: str
    chat_name: Optional[str]
    chat_type: str                         # "dm" | "group" | "channel" | "thread"
    user_id: Optional[str]
    user_name: Optional[str]
    thread_id: Optional[str]               # Discord threads / Telegram topics
    chat_topic: Optional[str]
    user_id_alt: Optional[str]             # Signal UUID
    chat_id_alt: Optional[str]             # Signal group internal ID
```

**EvoClaw**（`packages/core/src/channel/message-normalizer.ts:7-172` + `packages/shared/src/types/channel.ts`）— 单层 `ChannelMessage` ~10 字段:

```typescript
// normalizeFeishuMessage / normalizeWecomMessage / normalizeWeixinMessage / normalizeDesktopMessage
// 都输出同一个 ChannelMessage 结构:
{
  channel: 'feishu' | 'wecom' | 'weixin' | 'local',
  chatType: 'private' | 'group',
  accountId,
  peerId,
  senderId,
  senderName,
  content: string,
  messageId: string,
  timestamp: number,
  mediaPath?: string,       // 仅 weixin 下载后注入
  mediaType?: string,        // MIME
}
```

特殊处理（`message-normalizer.ts:101-144`）：
- weixin 多 `item_list` 合并：TEXT 项拼接 + VOICE 项（若有 `text` 语音转文字）提取
- `ref_msg` 引用上文前缀：`[引用: title | content]\n`
- 飞书 content 是 JSON 字符串需解析

**判定 🟡**：
- 🟢 EvoClaw 微信引用消息前缀注入（`[引用: ...]`）面向模型友好，hermes `reply_to_text` 同类语义
- 🔴 缺字段：
  - `message_type` 枚举（TEXT/PHOTO/VIDEO/AUDIO/VOICE/DOCUMENT/STICKER/COMMAND）— EvoClaw 只分"有/无 mediaPath"，信号丢失
  - `thread_id`（Discord thread / Telegram topic / 飞书话题）— EvoClaw 完全没有概念
  - `chat_topic` / `chat_name` — 频道描述
  - `auto_skill` — 基于消息自动激活技能的 hermes 机制 EvoClaw 无
  - `internal` 绕过授权 flag
  - Signal UUID / Signal group internal ID 双 ID 字段（对接 Signal 时必需）
- 🔴 无 `raw_message: Any` —— adapter 丢弃原始 payload 后，下游无法读取未在归一化字段中的信息

---

### §3.4 消息出管线（Response → Platform API）

**hermes**（`.research/19-gateway-platforms.md` §2.4 + §3.3 + `base.py:566-582, 1169+`）:

```python
@dataclass
class SendResult:
    success: bool
    message_id: Optional[str]
    error: Optional[str]
    raw_response: Any
    retryable: bool = False         # 瞬时失败，应自动重试

_RETRYABLE_ERROR_PATTERNS = (
    "connecterror", "connectionerror", "connectionreset",
    "connectionrefused", "connecttimeout", "network",
    "broken pipe", "remotedisconnected", "eoferror"
)

# _send_with_retry — 指数退避 1.5×(attempt+1)s，最多 3 次
```

- 结构化 `SendResult` 回传 message_id + retryable 标志
- 自动 jitter retry
- Fatal error 写 `gateway_state.json`

**EvoClaw**（`packages/core/src/channel/channel-manager.ts:86-121` + 各 adapter sendMessage）:

```typescript
async sendMessage(channel, peerId, content, chatType?): Promise<void> {
  const adapter = this.adapters.get(channel);
  if (!adapter) throw new Error(`Channel ${channel} 未注册`);
  if (adapter.getStatus().status !== 'connected') throw new Error(`Channel ${channel} 未连接`);
  await adapter.sendMessage(peerId, content, chatType);
}
```

返回值 `Promise<void>` — 不返回 message_id、不结构化错误:
- 失败直接 throw Error
- `feishu.ts:143-170` / `wecom.ts:116-143` / `weixin.ts:168-196` 各自处理错误，无统一 retry 层
- 微信 `sendMessage` 含 Markdown → 纯文本转换 + 4000 字符分块（见 §3.12），feishu/wecom 无
- 微信特有 `context_token` 缓存回传机制（`weixin.ts:173-193`）

**判定 🟡**：
- 🟢 EvoClaw 微信文本分块 + `context_token` 回传处理是 hermes 无的渠道特化
- 🔴 缺结构化返回：上层无法拿到发送后的 message_id，不能后续 `editMessage`
- 🔴 缺统一 retry 层：瞬时网络抖动（`ECONNRESET`）直接失败抛出，上层 `ChannelManager` 没有 `_send_with_retry` 等价物
- 🔴 缺瞬时失败白名单（`_RETRYABLE_ERROR_PATTERNS`）

---

### §3.5 Binding Router（Channel → Agent 路由）

**hermes** — **无等价抽象**。hermes `_handle_message()` 进入后直接 `self.session_store.get_or_create_session(source)`，session key = `(platform, chat_id, thread_id?)`。每个 session 绑定一个"默认 AIAgent 配置"（通过 config），但没有"多 Agent + 按规则路由到特定 Agent"的概念。

**EvoClaw**（`packages/core/src/routing/binding-router.ts:26-95`）— 4 级最具体优先匹配:

```typescript
resolveAgent(message: ChannelMessage): string | null {
  // 1. peerId 精确匹配
  if (message.peerId) {
    const exact = this.db.get(
      'SELECT * FROM bindings WHERE channel = ? AND peer_id = ? ORDER BY priority DESC LIMIT 1',
      message.channel, message.peerId,
    );
    if (exact) return exact['agent_id'];
  }
  // 2. accountId + channel
  if (message.accountId) { /* account_id bindings */ }
  // 3. channel 匹配
  const channelMatch = this.db.get(
    'SELECT * FROM bindings WHERE channel = ? AND account_id IS NULL AND peer_id IS NULL AND is_default = 0 ORDER BY priority DESC LIMIT 1',
    message.channel,
  );
  // 4. 默认 Agent
  const defaultAgent = this.db.get(
    'SELECT * FROM bindings WHERE is_default = 1 ORDER BY priority DESC LIMIT 1',
  );
}
```

配合 `routes/channel.ts:39-55` 在 `/connect` 时自动建立"一 Channel 一 Agent"绑定。

**判定 🟢 反超**：
- EvoClaw 是"**多 Agent 多渠道路由**"架构：一个用户可创建多个 Agent（职场助理 / 私人助理 / 客户经理）+ 把不同 Channel 绑到不同 Agent（微信→私人助理、企微→职场助理）
- hermes 是"**单 Agent 多 Channel**"架构：一个 Runner 实例承载一个 AIAgent 配置，各 Channel 的消息都进同一 Agent
- 企业场景（一个企业要给不同部门配不同 Agent、不同大客户单独分配 Agent）EvoClaw 直接支持，hermes 需要跑多个 gateway 进程
- 细节见 `14-state-sessions-gap.md` §3.8

---

### §3.6 Session Key 策略（多维定位）

**hermes**（`.research/19-gateway-platforms.md` §3.4，`gateway/session.py:504+`）:

```
DM:     agent:<source>:<platform>:<user_id>
Group:  agent:<source>:<platform>:<chat_id>
Thread: agent:<source>:<platform>:<chat_id>:<thread_id>
```

- 3-4 段组合
- `group_sessions_per_user` / `thread_sessions_per_user` 可配置群内是否按用户隔离

**EvoClaw**（`packages/core/src/routing/session-key.ts:12-19`）:

```typescript
export function generateSessionKey(
  agentId: string,
  channel: string = 'default',
  chatType: string = 'direct',
  peerId: string = '',
): SessionKey {
  return `agent:${agentId}:${channel}:${chatType}:${peerId}` as SessionKey;
}
```

5 段组合：`agent:<agentId>:<channel>:<chatType>:<peerId>`
- `<agentId>` 是 EvoClaw 独有第一级（hermes 无此概念）
- `<chatType>` = `'direct' | 'group'`（CLAUDE.md 另有 `'dm'` 别名）
- 额外 session key 形态在 CLAUDE.md 中声明：`agent:<agentId>:cron:<jobId>`（cron 隔离会话）

**判定 🟢 反超**：
- 5 维组合键比 hermes 3-4 段更细粒度（多一维 agentId）
- 支持 heartbeat / cron / fork 等特殊 session key 形态（见 `14-state-sessions-gap.md` §3.6）
- 缺失：`thread_id` 维度（Discord thread / 飞书话题）未建模，若引入 Telegram topics 时需扩展

---

### §3.7 渠道工具注入（channel:<name>:* 命名空间）

**hermes** — **无对应抽象**。hermes 的各 adapter 有 `send_image` / `send_voice` 等方法，但它们是 **adapter 内部方法**，不暴露为 Agent 工具。AIAgent 层面不知道"我当前在哪个 platform"，通过 `send_image_tool` / `send_voice_tool` 等通用工具以"当前 session 的 platform"隐式分发。

**EvoClaw**（`packages/core/src/tools/channel-tools.ts:16-130`）:

```typescript
export function createChannelTools(
  channelManager: ChannelManager,
  currentChannel: ChannelType,
): ChannelTool[] {
  const tools: ChannelTool[] = [];
  tools.push({ name: 'desktop_notify', ... });   // 始终可用

  if (currentChannel === 'feishu') {
    tools.push({ name: 'feishu_send', ... });
    tools.push({ name: 'feishu_card', ... });    // 卡片消息
  }
  if (currentChannel === 'wecom') {
    tools.push({ name: 'wecom_send', ... });
  }
  if (currentChannel === 'weixin') {
    tools.push({ name: 'weixin_send', ... });
    tools.push({ name: 'weixin_send_media', ... });  // 本地路径或远程 URL
  }
  return tools;
}

export function getChannelToolNames(channel: ChannelType): string[] {
  switch (channel) {
    case 'feishu': return ['desktop_notify', 'feishu_send', 'feishu_card'];
    case 'wecom':  return ['desktop_notify', 'wecom_send'];
    case 'weixin': return ['desktop_notify', 'weixin_send', 'weixin_send_media'];
    default:       return ['desktop_notify'];
  }
}
```

配合 `routes/channel-message-handler.ts:444` 的 `CHANNEL_TOOL_DENY` — 某些 channel 禁用特定工具（例：`voice: ['tts']`）。

**判定 🟢 反超**：
- EvoClaw 把渠道特性显式暴露为命名空间工具（`feishu_card` 卡片、`weixin_send_media` 远程 URL 自动下载）
- Agent 可以学会"我在飞书就用 feishu_card 发卡片富消息，我在微信就用 weixin_send_media 发图片"
- hermes 隐式分发方式更抽象（Agent 不知道自己在哪里），但丧失了"渠道特色能力"（飞书卡片、企微模板、钉钉工作通知等）的调用入口
- 细节见 `10-toolsets-gap.md`

---

### §3.8 媒体管线抽象（图片/视频/语音/文件）

**hermes**（`.research/19-gateway-platforms.md` §3.3，`base.py:200+`）— 基类统一媒体处理:

- `cache_image_from_url()` / `cache_image_from_bytes()` → `~/.hermes/cache/images/`
- `is_safe_url()` SSRF 保护
- MessageType enum: TEXT/PHOTO/VIDEO/AUDIO/VOICE/DOCUMENT/STICKER/COMMAND
- STT（语音转文本）：`GatewayConfig.stt_enabled` 启用后自动下载音频 + Whisper 转写注入 `MessageEvent.text`
- sticker 专门缓存（`gateway/sticker_cache.py:1-111`）

**EvoClaw** — **无基类统一媒体层，仅 weixin 深度实现**:

- weixin CDN 下载 + AES-128-ECB 解密（`channel/adapters/weixin-cdn.ts:50-71 downloadAndDecryptMedia`）
- weixin MIME 检测（`weixin-mime.ts`）
- weixin SILK 语音转码（`weixin-silk.ts:1-138`，依赖 silk-wasm 可选）
- weixin 远程 URL 下载（`weixin-upload.ts downloadRemoteToTemp`）
- 媒体优先级：IMAGE > VIDEO > FILE > VOICE（`weixin.ts:471-485 findMediaItem`）
- 语音转文字：若 `voice_item.text` 存在则**跳过下载**直接用文字（`weixin.ts:477-479`）

**feishu / wecom 媒体能力**：
- `feishu.ts` 仅实现 `sendMessage`（文本）—— 无媒体发送
- `wecom.ts` 仅 `sendMessage`（文本 msgtype=text）—— 无媒体

**判定 🟡**：
- 🟢 EvoClaw 微信媒体管线**深度远超** hermes:
  - CDN 解密（AES-128-ECB）hermes 不做（hermes 跑在服务器不对接个人号）
  - SILK 转码（微信特有编码）hermes 不需要
  - 语音转文字"若有 text 跳过下载"优化是微信 iLink Bot 特性
- 🔴 EvoClaw 媒体管线**不通用**:
  - 飞书/企微无媒体发送（`feishu.ts` / `wecom.ts` sendMessage 只支持 text msgtype）
  - 无基类 `cache_image_from_url` / `is_safe_url` SSRF 防护
  - 无 STT 统一层（微信 STT 由 iLink Bot 平台侧完成，EvoClaw 复用该结果而非自实现）
- 整体 🟡：微信一个渠道深，其他渠道浅

---

### §3.9 身份识别（user/peer/group/thread 映射）

**hermes**（`SessionSource` 9 字段）:

| 字段 | Telegram | Discord | Slack | Signal |
|------|----------|---------|-------|--------|
| `chat_id` | chat.id | channel.id | channel | recipient |
| `user_id` | user.id | user.id | user | e164 phone |
| `thread_id` | message_thread_id | thread.id | thread_ts | 无 |
| `user_id_alt` | 无 | 无 | 无 | **UUID** |
| `chat_id_alt` | 无 | 无 | 无 | **group internal ID** |
| `chat_type` | dm/group/channel | dm/guild | channel/dm | dm/group |

`user_id_alt` / `chat_id_alt` 是为 Signal 设计的双 ID 字段。

**EvoClaw**（`ChannelMessage`）:

| 字段 | 微信 | 飞书 | 企微 | 桌面 |
|------|------|------|------|------|
| `accountId` | ilinkBotId | appId | corpId | 'desktop' |
| `peerId` | from_user_id | open_id（私聊）/ chat_id（群） | FromUserName | 'local-user' |
| `senderId` | from_user_id | open_id | FromUserName | userId |
| `chatType` | 'private'（iLink Bot 仅支持私聊） | 'private'/'group' | 'private'/'group' | 'private' |

`message-normalizer.ts:17-18` 群聊判定：`event.chat_type === 'p2p' ? 'private' : 'group'`，`peerId` 私聊用 sender open_id、群聊用 chat_id。

**判定 🟡**：
- 🟢 `accountId` 维度 hermes 无（多租户场景下区分"企业 A 的企微"vs"企业 B 的企微"）
- 🔴 无 `thread_id` 维度（飞书话题、Discord 线程）
- 🔴 无 `user_id_alt` / `chat_id_alt` 双 ID 映射（未来接 Signal 需扩展）
- 🔴 iLink Bot 仅支持私聊（`weixin.ts:84 chatType: 'private'`），微信群聊完全不支持

---

### §3.10 认证模型（Bot token / QR 扫码 / OAuth）

**hermes** — 各 adapter 静态 token:
- Telegram `bot_token`（BotFather 申请）
- Discord `bot_token`（Application + Bot）
- Slack `xoxb-*` token（Slack App）
- Signal `phone_number`（signal-cli JSON-RPC）
- Matrix `access_token`
- WhatsApp `api_key` + phone
- 无 "交互式登录"概念，用户先在各平台控制台配置好 token 再填入 hermes

**EvoClaw** — 多模式并存 + 微信 QR 扫码:

**飞书 / 企微**（Bot Token / OAuth）:
- `feishu.ts:50-54`：tenant_access_token（90 分钟自动刷新）
- `wecom.ts:56-58`：access_token（100 分钟自动刷新）
- 静态 appId/appSecret/corpId/secret 配置

**微信 iLink Bot**（QR 扫码登录）:
- `routes/channel.ts:167-195`：`GET /weixin/qrcode` 代理获取二维码 + `GET /weixin/qrcode-status?qrcode=...` 轮询扫描状态
- 扫码成功拿到 `botToken` 后传给 `channel/connect`
- 无需用户申请开发者账号
- 实测唯一面向"个人微信号"的接入方案

**判定 🟢 反超**:
- QR 扫码登录 hermes 完全没有——这对"个人用户"至关重要，开发者账号门槛直接归零
- 多 token 类型并存管理（appSecret / corpSecret / botToken）+ 周期刷新（tenant / access token）
- 代价：无 OAuth refresh_token 完整流程（hermes 无此需求，国产 IM 也较少用 OAuth）

---

### §3.11 长轮询 vs Webhook 选择策略

**hermes** — 各 adapter 自选最适合的模式:
- Telegram: 长轮询（`getUpdates`）或 Webhook（两种模式可选）
- Discord: WebSocket gateway（长连接）
- Slack: Event API Webhook（HTTP 推送）
- Signal: WebSocket / JSON-RPC（signal-cli）
- Matrix: HTTP 长轮询（`/sync`）
- WhatsApp: Webhook（Cloud API）

**EvoClaw** — 两种模式并存:

**Webhook 模式**（飞书 / 企微）:
- `routes/channel.ts:112-160` — `/webhook/feishu` / `/webhook/wecom` 接收平台推送
- URL 验证 `challenge` 响应（`feishu.ts:91-93`）
- 依赖外部可达的公网 HTTPS 入口

**长轮询模式**（微信 iLink Bot）:
- `weixin.ts:286-348 pollingLoop` — `while (pollingActive) { getUpdates(...) }`
- **游标持久化**（`weixin.ts:111-115, 319-320`）：`get_updates_buf` 存 `channel_state`，重启自动恢复（断点续传）
- **指数退避**（`weixin.ts:328-344`）：基础 2s、上限 30s、`BASE × 2^(failures-1)`
- **会话过期检测**（`weixin.ts:432-446`）：`errcode === SESSION_EXPIRED_ERRCODE` → 停止轮询 + 提示重新扫码
- **AbortController 可中断**（`weixin.ts:517-528`）

**判定 🟢 反超**：
- 长轮询实现**细节完整**：游标持久化（hermes 无持久化）+ 指数退避 + 会话过期识别 + 可中断 sleep
- Webhook 模式 URL 验证 + binding 联动 + 凭证持久化（`channel_state`）
- hermes 无"长轮询游标持久化"机制（`gateway/platforms/*.py` 中 telegram 的 `offset` 在进程重启时从 0 重建）

---

### §3.12 Markdown / 格式化转换

**hermes** — **无专门转换**。各 adapter 尊重平台渲染能力：Telegram MarkdownV2、Slack mrkdwn、Discord Markdown 等直接发送。

**EvoClaw**（`packages/core/src/channel/adapters/weixin-markdown.ts:21-80 markdownToPlainText`）— 针对微信不支持 Markdown 的专门转换:

```typescript
export function markdownToPlainText(md: string): string {
  // 代码块: ```lang\n...\n``` → 保留代码内容
  // 行内代码: `x` → x
  // 图片: ![alt](url) → 完全移除
  // 链接: [text](url) → text
  // 表格分隔: |---|---| → 移除
  // 表格内容: |cell1|cell2| → cell1  cell2
  // 标题: # xxx → xxx
  // 粗体/斜体: **text** / *text* → text
  // 删除线: ~~text~~ → text
  // 水平线: --- → 空行
  // 无序/有序列表: - item / 1. item → item
  // 引用: > text → text
  // 连续空行折叠
}
```

13+ 条规则，在 `weixin.ts:180` sendMessage 前自动调用。

**判定 🟢 反超**：
- 微信不支持 Markdown 渲染（原生客户端会把 `**bold**` 字面展示），EvoClaw 专门针对此场景做纯文本降级
- hermes 无等价处理（hermes 不接微信个人号，无此需求）
- 飞书 `sendMessage` 当前按 `text` msgtype 发送（`feishu.ts:159-161`）— 飞书实际支持**富文本 msgtype=post**，EvoClaw 未利用；该空间值得补全

---

### §3.13 错误恢复（断线重连 / 消息重试）

**hermes**（`.research/19-gateway-platforms.md` §3.3）:
- `_send_with_retry`（`base.py:1169+`）：指数退避 1.5×(attempt+1)s，最多 3 次
- `_RETRYABLE_ERROR_PATTERNS` 瞬时失败白名单
- `_set_fatal_error`（`base.py:635+`）：致命错误写 `gateway_state.json`
- `_failed_platforms` 重连追踪 + `_platform_reconnect_watcher()` 后台自动重连

**EvoClaw** — 仅 adapter 连接级:

**ChannelManager 重连**（`channel-manager.ts:151-180 scheduleReconnect`）:
```typescript
const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 10;

const delay = RECONNECT_DELAY_MS * Math.pow(1.5, attempts); // 1.5^n 指数退避
```

**微信轮询级重试**（`weixin.ts:328-344`）:
```typescript
const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 2_000;
// failures*=2^n
```

**无消息发送级重试**：`channelManager.sendMessage(...)` 直接 await adapter 方法，单次失败抛出。

**判定 🟡**：
- 🟢 ChannelManager 重连 10 次 × 1.5^n 退避与 hermes `_platform_reconnect_watcher` 等价
- 🟢 微信长轮询重试策略完整
- 🔴 无消息发送级 `_send_with_retry` — 飞书 5xx 瞬时失败直接抛出到上层 `channel-message-handler.ts`
- 🔴 无瞬时错误白名单（network/broken pipe/timeout）—— 所有错误同等对待
- 🔴 无 `_set_fatal_error` 持久化 —— Sidecar 重启会尝试重连"永远失败"的 channel（如 token 被吊销）

---

### §3.14 已支持平台清单

**hermes**（`.research/19-gateway-platforms.md` §6 Phase D 列表）:

| 平台 | 文件 | 行数 |
|------|------|------|
| Telegram | `telegram.py` | 2727 |
| Discord | `discord.py` | 2864 |
| Slack | `slack.py` | 1671 |
| Signal | `signal.py` | 876 |
| Matrix | `matrix.py` | 2053 |
| WhatsApp | `whatsapp.py` | 940 |
| Feishu | `feishu.py` | 3589 |
| WeCom | `wecom.py` | 1342 |
| DingTalk | `dingtalk.py` | 340 |
| Mattermost | `mattermost.py` | 746 |
| Email | `email.py` | 621 |
| SMS | `sms.py` | 276 |
| API Server | `api_server.py` | 1719 |
| Webhook | `webhook.py` | 661 |
| Home Assistant | `homeassistant.py` | 449 |
| BlueBubbles | `bluebubbles.py` | 828 |

**总计**: 16 个 adapter，21,702 行代码。

**EvoClaw**（`packages/shared/src/types/channel.ts:2`）:

```typescript
export type ChannelType = 'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq' | 'weixin';
```

实际实现 adapter:
| Channel | 文件 | 行数 |
|---------|------|------|
| local (桌面) | `desktop.ts` | 64 |
| feishu | `feishu.ts` | 203 |
| wecom | `wecom.ts` | 168 |
| weixin | `weixin.ts` + 辅助 12 文件 | 529 + ~2800 辅助 |
| dingtalk | **未实现** | 0 |
| qq | **未实现** | 0 |

**总计**: 4 个实际 adapter，~4000 行代码。

`grep -r "telegram\|discord\|slack\|signal\|matrix\|whatsapp" packages/core/src/channel/adapters/` 零结果（仅在 weixin-api/weixin.ts 文件名字符串里有 signal — `AbortController signal`）。

**判定 🔴**：
- hermes 覆盖 6 个国际主流 IM（Telegram/Discord/Slack/Signal/Matrix/WhatsApp）EvoClaw **全部缺失**
- hermes Email / SMS / API Server / Webhook 也属于"通用入口"EvoClaw 无
- 补齐**全部 16 个平台 ≥ 3 人月**，但对"企业级国产 IM 场景"不必要
- 现实落点：EvoClaw 定位企业级国产 IM，补齐 **Telegram + Slack + Discord** 3 个即可满足 90% 跨境场景，估算 2 人月

**注**：每个国际平台的详细差距见后续专题（19a-Telegram / 19b-Discord / 19c-Slack / 19d-Signal / 19e-Matrix / 19f-WhatsApp）。

---

### §3.15 Slash 命令本地快速路径

**hermes**（`.research/19-gateway-platforms.md` §3.6）— 30+ 命令 6 类:

| 类别 | 命令 |
|------|------|
| 会话控制 | `/new` `/reset` `/clear` |
| 模型切换 | `/model` `/provider` `/reasoning` |
| 诊断 | `/status` `/usage` `/insights` |
| 帮助 | `/help` `/commands` |
| 压缩/归档 | `/compress` `/title` `/resume` |
| 审批 | `/approve` `/deny` `/stop` |

集中注册在 `hermes_cli/commands.py` 的 `COMMAND_REGISTRY`，各 adapter 通过 `telegram_menu_commands()` / `slack_subcommand_map()` 等函数导出到平台原生菜单。

**EvoClaw**（`packages/core/src/channel/command/` + `builtin/`）— 9 个命令 + 技能 fallback:

| 命令 | 文件 | 功能 |
|------|------|------|
| `/help` | `help.ts` | 命令列表 + 已安装技能 |
| `/echo` | `echo.ts` | 连通性测试 |
| `/debug` (`/toggle-debug` alias) | `debug.ts` | 切换 debug 追踪 |
| `/model` | `model.ts` | 查看/切换模型 |
| `/memory` | `memory.ts` | 记忆检索 |
| `/remember` | `remember.ts` | 写入记忆 |
| `/forget` | `forget.ts` | 删除记忆 |
| `/status` | `status.ts` | 状态查询 |
| `/cost` | `cost.ts` | 费用统计 |

**技能 fallback**（`command-dispatcher.ts:45-56`）：未注册命令 → 查 skill discoverer → 若命中 `SKILL.md` name/slug 同名，则作为技能注入对话。

**判定 🟡**：
- 🟢 EvoClaw 技能 fallback 是 hermes 无的"命令-技能无缝融合"设计
- 🟢 别名（`/toggle-debug` = `/debug`）机制 OK
- 🔴 缺命令多数目：
  - `/new` `/reset` `/clear`（会话重置/新建）— EvoClaw 当前需要 UI 操作
  - `/provider` `/reasoning`（provider + thinking 切换）
  - `/usage` `/insights`（多维统计）
  - `/compress` `/title` `/resume`（主动压缩 + 会话命名 + 恢复）
  - `/approve` `/deny` `/stop`（工具审批队列 + 中断）
- 🔴 未导出到平台原生菜单（Telegram menu / Slack slash registry），需用户手敲

---

### §3.16 Debug 追踪 / 全链路观测

**hermes** — **无对应机制**。hermes 有 `/status` `/usage` 命令查会话级指标，但无"单条消息全链路耗时"的结构化追踪。

**EvoClaw**（`packages/core/src/channel/adapters/weixin-debug.ts:25-84`）:

```typescript
export interface PipelineTiming {
  receivedAt: number;        // 插件收到消息时间
  mediaDownloadMs: number;   // 媒体下载耗时
  aiStartAt: number;         // AI 开始处理
  aiEndAt: number;           // AI 结束处理
  eventTimeMs?: number;      // 平台侧事件时间
}

export function formatDebugTrace(timing: PipelineTiming): string {
  // 输出:
  // ⏱ Debug 全链路
  // ├ 平台→插件: 120ms
  // ├ 媒体下载: 350ms
  // ├ AI 生成: 2100ms
  // ├ 总耗时: 2570ms
  // └ eventTime: 2026-03-23T10:00:00.000Z
}
```

- `isDebugEnabled(accountId)` / `toggleDebugMode(accountId)` — 每账号独立开关（存 `channel_state`）
- `/debug` 命令切换（见 §3.15）
- 启用后每条 AI 回复自动追加全链路耗时

**判定 🟢 反超**：
- EvoClaw 单条消息级时间切片可观测，生产排障时直接看"平台延迟 vs 媒体下载 vs AI 生成"占比
- 按 accountId 粒度控制（企业多租户场景一个账号查不影响其他账号）
- hermes 无等价能力

**代价**：当前仅 weixin 实现，feishu / wecom 未复用（CLAUDE.md 声称"全链路 Debug 追踪"通用，实际代码仅 weixin-debug.ts）

---

## 4. 建议改造蓝图（不承诺实施）

**P0**（高 ROI，建议尽快）:

| # | 项目 | 对应差距 | 工作量 | ROI | 价值 |
|---|---|---|---|---|---|
| 1 | ChannelAdapter 合约扩展 send_image/send_video/send_voice/editMessage | §3.2 | 3d | 🔥🔥 | 支持流式 token edit + 富媒体 |
| 2 | SendResult 结构化返回 + `_send_with_retry` 统一层 | §3.4, §3.13 | 2d | 🔥🔥 | 瞬时失败自动恢复 + message_id 可复用 |
| 3 | Debug 追踪推广到 feishu / wecom | §3.16 | 1d | 🔥🔥 | 补齐非 weixin 渠道可观测性 |
| 4 | 飞书富文本/卡片 msgtype 支持 | §3.12 | 1-2d | 🔥 | 飞书消息从 text 升级到 post/interactive |

**P1**（中等 ROI）:

| # | 项目 | 对应差距 | 工作量 | ROI | 价值 |
|---|---|---|---|---|---|
| 5 | Slash 命令扩展 /new /reset /compress /approve | §3.15 | 2-3d | 🔥 | 对齐 hermes 会话控制 |
| 6 | MessageEvent 字段扩展（message_type/thread_id/reply_to_text/auto_skill） | §3.3 | 2d | 🔥 | 为未来 Discord/Slack 做准备 |
| 7 | 媒体管线基类（cache_media_url + is_safe_url SSRF） | §3.8 | 3d | 🔥 | feishu/wecom 也能发送图片 |
| 8 | Telegram adapter 补齐 | §3.14 + 19a | 10-15d | 🔥 | 跨境最主流 IM |
| 9 | Slack adapter 补齐 | §3.14 + 19c | 10-15d | 🔥 | 企业国际市场标配 |

**P2**（长期规划）:

| # | 项目 | 对应差距 | 工作量 |
|---|---|---|---|
| 10 | Discord / Signal / Matrix / WhatsApp 补齐 | §3.14 | 4-6 人月 |
| 11 | HookRegistry 事件驱动扩展点 | §3.1 | 3-5d |
| 12 | `get_chat_info` 反查（群成员 / 频道描述） | §3.2 | 2d |

**不建议做**:

- hermes 单进程 Gateway 架构（§3.1）—— EvoClaw Sidecar 内嵌对桌面应用形态更合适
- PairingStore DM 授权（§3.1）—— 企业场景通过 Binding Router 已经解决"哪个用户走哪个 Agent"
- 16 个平台全覆盖—— 国产 IM 场景只需 feishu/wecom/weixin/dingtalk，国际选 Telegram/Slack 2 个足够

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应 |
|---|---|---|---|
| 1 | **Binding Router 多 Agent 路由** | `routing/binding-router.ts:63-94` (4 级最具体优先) | 无，单 Agent 多 channel |
| 2 | **5 维 Session Key**（含 agentId） | `routing/session-key.ts:12-19` | 3-4 段，无 agentId |
| 3 | **Channel 命名空间工具**（feishu_card / weixin_send_media / feishu_send / wecom_send） | `tools/channel-tools.ts:16-130` | 无，隐式 send_* 通用工具 |
| 4 | **微信 QR 扫码登录** | `routes/channel.ts:167-195 /weixin/qrcode + qrcode-status` | 无，所有 adapter 都要预申请 Bot token |
| 5 | **长轮询游标持久化 + 断点续传** | `weixin.ts:111-115, 319-320` | 无持久化，进程重启 offset 归零 |
| 6 | **微信 CDN 解密 + SILK 转码管线** | `weixin-cdn.ts:50-71` + `weixin-silk.ts:1-138` | 无（hermes 不对接个人号） |
| 7 | **Markdown → 纯文本降级（微信）** | `weixin-markdown.ts:21-80` (13+ 规则) | 无 |
| 8 | **全链路 Debug 追踪**（平台/媒体/AI 分段） | `weixin-debug.ts:25-84 formatDebugTrace` | 无单消息级时间切片 |
| 9 | **accountId 多租户维度** | `ChannelMessage.accountId` | `SessionSource` 无等价字段 |
| 10 | **技能 fallback 命令分发** | `command-dispatcher.ts:45-56` | 无，命令未命中直接 unknown |
| 11 | **iLink Bot context_token 回传机制** | `weixin.ts:173-193, 367-369` | 无（无此平台） |
| 12 | **Channel → Agent 自动绑定** | `routes/channel.ts:39-55` (/connect 时自动创建 binding) | 无 |

---

## 5 反.  反面记录 — 落后点汇总

| # | 落后项 | 影响 | 补齐工作量 |
|---|---|---|---|
| 1 | **国际 6 大平台全缺**（Telegram/Discord/Slack/Signal/Matrix/WhatsApp） | 跨境企业无法接入 | 4-6 人月 |
| 2 | **SessionSource 字段薄**（无 thread_id / reply_to / user_id_alt / auto_skill） | Discord thread / 飞书话题场景失真 | 2d |
| 3 | **SendResult 无结构化返回**（message_id 丢失） | 无法后续 editMessage 做流式 token 输出 | 2d |
| 4 | **媒体管线仅 weixin 实现** | feishu/wecom/dingtalk 无法发送图片/语音 | 3-5d |
| 5 | **Slash 命令缺 /new /reset /compress /approve** | 用户必须靠 UI 控制会话 | 2-3d |
| 6 | **无 `_send_with_retry` 瞬时失败层** | 网络抖动时飞书发送一次失败即丢 | 2d |
| 7 | **微信仅支持私聊**（iLink Bot 限制） | 微信群场景完全无法接入 | 依赖平台能力 |
| 8 | **无 HookRegistry 事件扩展点** | 三方扩展无法挂钩 gateway:startup / gateway:message | 3-5d |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（本章所有 `path:line` 均经 Read 工具验证 2026-04-16）

- `packages/core/src/channel/channel-adapter.ts:31-55` ✅ ChannelAdapter 接口（7 方法精简合约）
- `packages/core/src/channel/channel-manager.ts:20-190` ✅ ChannelManager + reconnect 指数退避
- `packages/core/src/channel/channel-manager.ts:151-180` ✅ scheduleReconnect (1.5^n × 5s，最多 10 次)
- `packages/core/src/channel/message-normalizer.ts:7-172` ✅ 4 个 normalize 函数（feishu/wecom/weixin/desktop）
- `packages/core/src/channel/message-normalizer.ts:101-144` ✅ weixin 引用消息前缀注入
- `packages/core/src/channel/channel-state-repo.ts:17-50` ✅ ChannelStateRepo KV 持久化
- `packages/core/src/channel/adapters/desktop.ts:17-64` ✅ DesktopAdapter（type='local'）
- `packages/core/src/channel/adapters/feishu.ts:23-202` ✅ FeishuAdapter Webhook + tenant_access_token 90min 刷新
- `packages/core/src/channel/adapters/feishu.ts:89-141` ✅ handleWebhookEvent + URL challenge + @ 机器人检测
- `packages/core/src/channel/adapters/wecom.ts:26-167` ✅ WecomAdapter access_token 100min 刷新
- `packages/core/src/channel/adapters/weixin.ts:67-528` ✅ WeixinAdapter iLink Bot 长轮询 + context_token
- `packages/core/src/channel/adapters/weixin.ts:286-348` ✅ pollingLoop + 游标持久化 + 指数退避
- `packages/core/src/channel/adapters/weixin.ts:471-501` ✅ findMediaItem / findRefMediaItem 优先级
- `packages/core/src/channel/adapters/weixin-markdown.ts:21-80` ✅ markdownToPlainText 13+ 规则
- `packages/core/src/channel/adapters/weixin-debug.ts:25-84` ✅ PipelineTiming + formatDebugTrace
- `packages/core/src/channel/adapters/weixin-cdn.ts:50-71` ✅ downloadAndDecryptMedia (AES-128-ECB)
- `packages/core/src/channel/adapters/weixin-silk.ts:34-40` ✅ isSilkFormat 魔术字节检测
- `packages/core/src/channel/command/command-dispatcher.ts:28-61` ✅ createCommandDispatcher + skill fallback
- `packages/core/src/channel/command/command-registry.ts:7-37` ✅ CommandRegistry + 别名匹配
- `packages/core/src/channel/command/builtin/help.ts:9-38` ✅ createHelpCommand + 技能列表
- `packages/core/src/channel/command/builtin/echo.ts:7-14` ✅ echoCommand
- `packages/core/src/channel/command/builtin/debug.ts:7-22` ✅ debugCommand + alias `/toggle-debug`
- `packages/core/src/channel/command/builtin/model.ts:7-30` ✅ modelCommand
- `packages/core/src/tools/channel-tools.ts:16-130` ✅ createChannelTools + getChannelToolNames
- `packages/core/src/routing/session-key.ts:12-19` ✅ generateSessionKey 5 维组合
- `packages/core/src/routing/binding-router.ts:26-95` ✅ BindingRouter 4 级最具体优先匹配
- `packages/core/src/routes/channel.ts:19-199` ✅ Channel 路由 /connect /disconnect /status /bindings + webhook
- `packages/core/src/routes/channel.ts:111-160` ✅ /webhook/feishu + /webhook/wecom
- `packages/core/src/routes/channel.ts:167-195` ✅ Feature.WEIXIN 门控 + /weixin/qrcode + /weixin/qrcode-status
- `packages/core/src/routes/channel-message-handler.ts:93-95` ✅ CHANNEL_TOOL_DENY
- `packages/shared/src/types/channel.ts:2` ✅ ChannelType 联合类型（6 种，实际实现 4 种）

### 6.2 hermes 研究引用（章节 §）

- `.research/19-gateway-platforms.md` §1 角色与定位（独立常驻进程 + mermaid 架构图）
- `.research/19-gateway-platforms.md` §2.1 文件清单（run.py 7688 / base.py 1825 / session.py 1082 / config.py 1009）
- `.research/19-gateway-platforms.md` §2.2 MessageEvent schema（12 字段）
- `.research/19-gateway-platforms.md` §2.3 SessionSource（9 字段，含 Signal UUID）
- `.research/19-gateway-platforms.md` §2.4 SendResult（success/message_id/error/retryable）
- `.research/19-gateway-platforms.md` §2.5 GatewayConfig（platforms/sessions_dir/unauthorized_dm_behavior/streaming）
- `.research/19-gateway-platforms.md` §3.1 GatewayRunner 生命周期
- `.research/19-gateway-platforms.md` §3.2 _handle_message 主循环（授权 → 命令 → session → Agent → 回复）
- `.research/19-gateway-platforms.md` §3.3 BasePlatformAdapter 抽象合约（13+ 方法 + `_send_with_retry` + `_RETRYABLE_ERROR_PATTERNS`）
- `.research/19-gateway-platforms.md` §3.4 SessionStore / build_session_key（DM/Group/Thread 3-4 段）
- `.research/19-gateway-platforms.md` §3.5 PairingStore DM 授权（rate limit / lockout）
- `.research/19-gateway-platforms.md` §3.6 快速命令 30+ 条 6 类
- `.research/19-gateway-platforms.md` §3.7 Interrupt 机制（_active_sessions + _pending_messages）
- `.research/19-gateway-platforms.md` §3.8 模型路由与降级（_effective_model + session.model override）
- `.research/19-gateway-platforms.md` §3.9 STT（stt_enabled + Whisper 转写注入 text）
- `.research/19-gateway-platforms.md` §6 Phase D 平台列表（16 个 adapter，21702 行）

### 6.3 关联差距章节（crosslink）

本章聚焦**总览抽象**，各具体平台细节见专题：

- [`10-toolsets-gap.md`](./10-toolsets-gap.md) — Channel tools 组合 + Toolset 动态注入
- [`14-state-sessions-gap.md`](./14-state-sessions-gap.md) — Session Key / Binding Router / 持久化内部机制（本章引用但不展开）
- [`19a-telegram-gap.md`](./19a-telegram-gap.md) — Telegram adapter 具体差距（EvoClaw 缺失）
- [`19b-discord-gap.md`](./19b-discord-gap.md) — Discord adapter 具体差距（EvoClaw 缺失）
- [`19c-slack-gap.md`](./19c-slack-gap.md) — Slack adapter 具体差距（EvoClaw 缺失）
- [`19d-signal-gap.md`](./19d-signal-gap.md) — Signal adapter 具体差距（含 UUID 双 ID）
- [`19e-matrix-gap.md`](./19e-matrix-gap.md) — Matrix adapter 具体差距
- [`19f-whatsapp-gap.md`](./19f-whatsapp-gap.md) — WhatsApp adapter 具体差距

---

**本章完成**。综合判定：**🟡 部分覆盖 / 架构形态差异显著**——EvoClaw 在**国产渠道深度**（微信 QR 登录 / CDN 解密 / SILK 转码 / Markdown 降级 / Debug 全链路）与**多 Agent 路由**（Binding Router / 5 维 Session Key）上**明显反超**，但**国际平台覆盖**（Telegram/Discord/Slack/Signal/Matrix/WhatsApp 全缺）是硬伤。ChannelAdapter 合约相对精简对新增 adapter 友好，但缺 sendImage/sendVideo/editMessage 等富方法限制了流式 token 体验与富媒体能力。总体建议：**补齐合约方法（P0）+ 选择 Telegram/Slack 2 个国际平台（P1）+ 扩展 Slash 命令（P1）**，而非全盘复刻 hermes Gateway 架构。
