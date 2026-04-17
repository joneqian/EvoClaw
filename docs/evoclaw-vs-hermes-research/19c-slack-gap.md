# 19c — Slack 平台适配器 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/19c-slack.md`（355 行，源 `gateway/platforms/slack.py` 1671→1677 行，ADDENDUM @ `00ff9a26`，净 +6 行，3 项安全加固）
> **hermes 基线**: commit `00ff9a26`（2026-04-16，基线 `b87d0028`；提取 `MessageDeduplicator` / 统一平台锁定 / SSRF redirect guard / channel_prompts 扩展 / HTML 登录页检测）
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16）
> **综合判定**: 🔴 **整体缺失** — Slack 渠道在 EvoClaw 中完全未实现：`ChannelType` 联合类型不含 `'slack'`，`packages/core/src/channel/adapters/` 无 Slack 文件，`grep -r -i slack packages/core/src` 仅 3 处字面引用（`permission-interceptor.ts` 白名单字符串 `slack_send` + 两个 Skill 文档示例），**无任何 Slack 业务代码**

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes `SlackAdapter`**（`gateway/platforms/slack.py:1-1677`，ADDENDUM 后 1677 行） — 基于 `slack-bolt>=1.18` 的 `AsyncApp` 与 `slack-sdk>=3.26` 的 `AsyncWebClient / AsyncSocketModeHandler`，以 **Socket Mode** 长连接方式接入 Slack（而非 HTTP Webhook），因此无需公开 URL、无需签名校验，仅凭 `xapp-` App-Level Token 即可在内网环境运行。单一适配器内聚合：消息收发、Block Kit 审批卡片、Slash 命令、Assistant Thread 生命周期事件、文件上传、mrkdwn 双向转换、**多工作区 multi-team** 路由（逗号分隔 `SLACK_BOT_TOKEN` + `slack_tokens.json` OAuth 合并，按 `team_id` 路由 `AsyncWebClient`）、`(team_id, channel, thread_ts)` 三元组会话键、60s TTL 线程上下文缓存（Tier-3 限流退避）。ADDENDUM 在 `00ff9a26` 把去重逻辑提取为跨平台 `MessageDeduplicator` helper、平台锁定统一至基类、新增 SSRF redirect guard 与 HTML 登录页检测。

**EvoClaw Slack 实现** — **不存在**。`packages/core/src/channel/adapters/` 当前 16 个 ts 文件（`desktop.ts / feishu.ts / wecom.ts / weixin.ts / weixin-silk.ts` + 11 个 weixin-* 辅助），**全部为国产渠道 + desktop**，`ChannelType` 联合类型为 `'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq' | 'weixin'`（`packages/shared/src/types/channel.ts:2`，**6 种，无 `'slack'`**）。Slack 完全缺位，与 Telegram / Discord / Signal / Matrix / WhatsApp 同属国际平台空白区；当前 Sprint 16 聚焦企微生产就绪，Slack 未进入路线图。

**量级对比**: hermes 1677 行 Slack 单文件 vs EvoClaw **0 行**。按 hermes 复刻清单 15 项能力计，EvoClaw 需从 0 起步搭建 Bot Token + App Token 双凭据 / Socket Mode WebSocket 维持 / `AsyncApp` 事件分发 / Block Kit 审批 Views / `/hermes` Slash 命令 / Assistant Thread setStatus / 多工作区 team_id 路由 全链条。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 认证模型（Bot Token `xoxb-` + App Token `xapp-` + OAuth） | 🔴 | 完全缺失；EvoClaw 无 Slack 双 Token + OAuth 安装流概念 |
| §3.2 | 消息接收方式（Socket Mode WebSocket vs Events API Webhook） | 🔴 | 完全缺失；EvoClaw 无 `AsyncSocketModeHandler` 等价物 |
| §3.3 | 事件分发（`AsyncApp` message / app_mention / command / action） | 🔴 | 完全缺失；现有适配器无 Bolt 式事件注册 DSL |
| §3.4 | 事件归一化 & Session Key（`(team_id, channel, thread_ts)` 三元组） | 🔴 | 完全缺失；EvoClaw Session Key 无 `team_id` 维度 |
| §3.5 | 四层响应决策（free-response / require_mention / `<@bot>` / `_mentioned_threads`） | 🔴 | 完全缺失；EvoClaw 渠道无 mention 检查层级 |
| §3.6 | 事件去重（`MessageDeduplicator` TTL 300s / cap 2000） | 🔴 | 完全缺失；现有渠道依赖各自 ack 机制（如 weixin context_token） |
| §3.7 | 消息类型 & 文件注入（image/audio/document MIME 分派 + 文档内联） | 🔴 | 完全缺失 Slack 路径；文档 ≤100KB 内联策略无对应 |
| §3.8 | 发送与分块（`format_message` 12 步 Markdown→mrkdwn + 39000 分块） | 🔴 | 完全缺失；EvoClaw 微信 Markdown 管线与 Slack mrkdwn 规则不同 |
| §3.9 | Block Kit 审批卡（4 按钮 + `dict.pop` 原子防双击 + 白名单鉴权） | 🔴 | 完全缺失；EvoClaw 审批仅 Tauri 桌面端弹窗，无 IM 富交互 |
| §3.10 | Slash 命令（`/hermes` + subcommand 映射） | 🔴 | 完全缺失 Slack `app.command`；但 EvoClaw **有通用 slash dispatcher 可迁移**（见 §5） |
| §3.11 | 线程回复（`thread_ts` + `reply_broadcast=True` 首块 + 60s TTL 缓存） | 🔴 | 完全缺失；EvoClaw 无 IM thread 概念 |
| §3.12 | Typing 指示（`assistant.threads.setStatus`，仅 Assistant Thread 有效） | 🔴 | `ChannelAdapter.sendTyping` 接口槽位存在但 Slack 未实现 |
| §3.13 | 多工作区路由（`team_id` → `AsyncWebClient` 映射 + OAuth `slack_tokens.json`） | 🔴 | 完全缺失；EvoClaw 现有渠道单租户或隐式绑定 |
| §3.14 | Rate Limit（Slack Tier 1-4 分层 + Tier-3 `conversations.replies` 退避） | 🔴 | Slack tier 特化完全缺失；EvoClaw 仅通用重连退避 |
| §3.15 | 白名单鉴权（`SLACK_ALLOWED_USERS` + `SLACK_FREE_RESPONSE_CHANNELS`） | 🔴 | Slack-specific 完全缺失；EvoClaw 有通用 NameSecurityPolicy 可类比 |
| §3.16 | Assistant Thread 生命周期（`assistant_thread_started / _context_changed`） | 🔴 | 完全缺失；Assistant API Beta 能力无对等 |

**统计**: 🔴 16 / 🟡 0 / 🟢 0。**全维度缺失**，综合判定 🔴。

---

## 3. 机制逐条深度对比

> **EvoClaw 端统一证据**: 下述所有小节的"缺失证据"均基于同一组零结果——
> - `grep -r -i slack packages/core/src` → 仅 3 处字面引用（`tools/permission-interceptor.ts:46` 工具白名单字符串 `'slack_send'`、`skill/bundled/marketing-mode/SKILL.md`、`skill/bundled/automation-workflows/SKILL.md`），**无任何业务代码**
> - `ls packages/core/src/channel/adapters/` → 16 文件：`desktop.ts / feishu.ts / wecom.ts / weixin.ts / weixin-silk.ts + 11 个 weixin-*`（无 `slack*` 任何文件）
> - `packages/shared/src/types/channel.ts:2` `ChannelType = 'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq' | 'weixin'`（**6 种，无 `'slack'`**）

### §3.1 认证模型（Bot Token + App Token + OAuth）

**hermes**（`.research/19c-slack.md §6 复刻清单 2 + §4 多工作区路由`，`slack.py:140-151`）—— 双 Token 架构：`SLACK_BOT_TOKEN`（`xoxb-`，可逗号分隔多租户）+ `SLACK_APP_TOKEN`（`xapp-` App-Level Token，Scope `connections:write`），外加 `slack_tokens.json` OAuth 安装流持久化：

```python
140  for raw_token in os.environ.get("SLACK_BOT_TOKEN", "").split(","):
143      client = AsyncWebClient(token=raw_token.strip())
145      auth = await client.auth_test()
147      self._team_clients[auth["team_id"]] = client
148      self._team_bot_user_ids[auth["team_id"]] = auth["user_id"]
151  # 另加载 slack_tokens.json 中的 OAuth 安装
```

Bot Scopes：`chat:write / files:write / reactions:write / users:read / conversations:read / conversations:history / assistant:write / app_mentions:read / commands`。

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "SLACK_BOT_TOKEN\|SLACK_APP_TOKEN\|xoxb\|xapp" packages/core/src/
# 0 命中

$ grep -r -i "slack_tokens\|oauth.*slack\|installation_store" packages/core/src/
# 0 命中

$ cat packages/core/src/channel/adapters/feishu.ts | head -5
# 飞书走 app_id/app_secret + tenant_access_token，无 Slack 风格 Bot+App 双 Token 概念

$ cat packages/core/src/channel/adapters/wecom.ts | head -5
# 企微走 corp_id/corp_secret + webhook，也不涉及 Slack OAuth 安装流
```

**判定 🔴**：EvoClaw 无 Slack 双 Token + OAuth 安装流抽象。现有 `ChannelConfig.credentials: Record<string, string>`（`channel-adapter.ts:10`）虽然足够灵活容纳 `botToken / appToken`，但无 `auth.test` → `team_id` 映射、无 `slack_tokens.json` 持久化层、无 OAuth 安装回调端点。补齐需引入 `@slack/bolt` + `@slack/web-api`（TS 生态）并在 Tauri 端新增 OAuth 回调处理器。

---

### §3.2 消息接收方式（Socket Mode WebSocket vs Events API Webhook）

**hermes**（`.research/19c-slack.md §6 复刻清单 3`，`slack.py:82-118 / 192-245`）—— 使用 `AsyncSocketModeHandler(app, app_token).start_async()`，**无需 HTTP 入口与签名校验**；`discord.py` 式的自动重连内置。对比 Events API Webhook 需公开 URL + `X-Slack-Signature` HMAC 校验 + 3s ack，Socket Mode 在内网/NAT 环境是首选：

```python
82   def __init__(self, config: SlackConfig) -> None:
...
118      self._handler = AsyncSocketModeHandler(self._app, app_token)

# 启动（L192-245 锁定逻辑重写后）
await self._handler.start_async()  # WebSocket 长连建立、断线自动重连
```

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "SocketModeHandler\|AsyncSocketModeHandler\|socket_mode" packages/core/src/
# 0 命中

$ grep -r -i "websocket\|ws://\|wss://" packages/core/src/channel/adapters/
packages/core/src/channel/adapters/feishu.ts  # 飞书长连接，但用飞书 SDK 封装，非 Slack Socket Mode 协议
packages/core/src/channel/adapters/weixin.ts  # 长轮询（非 WS）
# 无 Slack Socket Mode

$ grep -r -i "X-Slack-Signature\|slack.*webhook\|events_api" packages/core/src/
# 0 命中（既无 Socket Mode 也无 Events API Webhook）
```

EvoClaw 现有通用重连机制（`channel-manager.ts:13-14` `RECONNECT_DELAY_MS=5_000 / MAX_RECONNECT_ATTEMPTS=10`）是粗粒度退避，未覆盖 Slack Socket Mode 的 `disconnect` frame / `slow_down` 频控 / `app_token` 到期刷新。

**判定 🔴**：完全缺失 Slack 接入层。补齐建议**直接复用 `@slack/bolt` v3+** 的 `SocketModeReceiver`，避免重造 WebSocket 协议轮子。

---

### §3.3 事件分发（`AsyncApp` message / app_mention / command / action）

**hermes**（`.research/19c-slack.md §4 构造器，slack.py:190-227`）—— 通过 Bolt DSL 注册 9 个事件处理器：`message` / `app_mention`（no-op 防重）/ `assistant_thread_started` / `assistant_thread_context_changed` / `command("/hermes")` / 4 个按钮 `action_id`：

```python
190  self._app.event("message")(self._handle_slack_message)
198  self._app.event("app_mention")(self._noop_app_mention)  # 避免 message 重复
202  self._app.event("assistant_thread_started")(self._handle_assistant_thread_lifecycle_event)
208  self._app.event("assistant_thread_context_changed")(self._handle_assistant_thread_lifecycle_event)
211  self._app.command("/hermes")(self._handle_slash_command)
217  self._app.action("hermes_approve_once")(self._handle_approval_action)
218  self._app.action("hermes_approve_session")(self._handle_approval_action)
219  self._app.action("hermes_approve_always")(self._handle_approval_action)
220  self._app.action("hermes_deny")(self._handle_approval_action)
```

关键点：`app_mention` 与 `message` 事件对 bot 会**双发**，此处 no-op 避免重复处理。

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "app.event\|app.command\|app.action\|bolt" packages/core/src/
# 0 命中（Bolt DSL 完全缺失）

$ grep -r -i "app_mention\|assistant_thread_started" packages/core/src/
# 0 命中
```

现有 EvoClaw `ChannelAdapter` 接口（`channel-adapter.ts:31-55`）只定义 `connect/disconnect/onMessage/sendMessage/sendMediaMessage?/sendTyping?/getStatus` 7 方法，**无事件路由 DSL**，所有事件在 adapter 内部自行 `switch/case` 处理。

**判定 🔴**：完全缺失 Bolt 式事件注册 DSL。若自研 Slack adapter，建议直接委托给 `@slack/bolt` 的 `App` 实例，自身只做 `bolt event → ChannelMessage` 归一化桥接。

---

### §3.4 事件归一化 & Session Key（`(team_id, channel, thread_ts)` 三元组）

**hermes**（`.research/19c-slack.md §3 事件归一化, slack.py:936-1011`）—— DM 且无 `thread_ts` → 顶级共享会话 `thread_key = (team_id, channel, None)`；频道无 `thread_ts` → 使用 `event["ts"]` 作为线程入口，把首条消息自动变成独立线程；识别 DM 用 `channel_type in ("im","mpim") or channel.startswith("D")`：

```python
1003 channel_type = event.get("channel_type") or ""
1004 is_dm = channel_type in ("im", "mpim") or channel.startswith("D")
1014 if is_dm and not thread_ts:
1015     thread_key = (team_id, channel, None)   # DM 顶级共享
1017 elif not thread_ts:
1018     thread_ts = event["ts"]                 # 频道首条消息 → 线程入口
```

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "team_id\|thread_ts\|channel_type.*im\|mpim" packages/core/src/
# 0 命中

$ cat packages/core/src/channel/message-normalizer.ts | head -20
# message-normalizer.ts 只有 normalizeFeishuMessage / normalizeWecomMessage /
# normalizeWeixinMessage / normalizeDesktopMessage 4 个函数，无 Slack
```

EvoClaw Session Key 格式（CLAUDE.md）：`agent:<agentId>:<channel>:dm:<peerId>` / `agent:<agentId>:<channel>:group:<groupId>` —— **无 `team_id` 维度、无 `thread_ts` 维度**。`ChannelMessage.chatType` 仅 `'private' | 'group'` 二分（`channel.ts:6`），无法表达 Slack Thread 容器。

**判定 🔴**：完全缺失 Slack 三元组会话键。补齐需扩展 Session Key 为 `agent:<agentId>:slack:<teamId>:<channel>:[thread:<threadTs>]`，并新增 `ChannelMessage.threadId?: string` 字段。

---

### §3.5 四层响应决策（free-response / require_mention / `<@bot>` / `_mentioned_threads`）

**hermes**（`.research/19c-slack.md §3 响应决策, slack.py:1025-1047`）—— 四层短路：

```python
1031 if channel in self._free_response_channels:
1032     should_respond = True                          # (1) 白名单频道无条件响应
1035 elif not self._require_mention:
1036     should_respond = True                          # (2) 全局关闭 mention 要求
1038 elif f"<@{bot_uid}>" in text:
1039     should_respond = True
1040     self._mentioned_threads.add(thread_key)        # (3) 显式 @ → 加入 mentioned 集
1045 elif thread_key in self._mentioned_threads:
1046     should_respond = True                          # (4) 已被 @ 的线程续聊
1050 elif any(ts in self._bot_message_ts for ts in thread_message_ts):
1052     should_respond = True                          # (4) follow-up：回复 bot 消息
```

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "free_response_channels\|require_mention\|mentioned_threads\|bot_message_ts" packages/core/src/
# 0 命中
```

EvoClaw 现有渠道无 mention 过滤：
- 微信个人号是点对点/群聊全量接收（天然隔离）
- 企微通过应用可见范围控制
- 飞书同企微
**完全无 Slack 这种"频道中默认不响应，必须 @ bot"的语义层**。

**判定 🔴**：完全缺失四层响应决策。补齐需新增 `SlackConfig.freeResponseChannels / requireMention` 字段 + `_mentionedThreads: Set<string>` 内存状态 + `_botMessageTs: Set<string>` 自回环防护。

---

### §3.6 事件去重（`MessageDeduplicator` TTL 300s / cap 2000）

**hermes**（`.research/19c-slack.md §3 去重 + ADDENDUM A 重构, slack.py:93-98`）—— ADDENDUM 后把去重逻辑提取为跨平台 helper `MessageDeduplicator`（导入自 `gateway.platforms.helpers`），基于 `event_ts` 键 + OrderedDict LRU + TTL 300s + cap 2000：

```python
# 旧（L95-100）：Dict[str, float] + 手工 LRU（~20 行）
# 新（L91-98）：
from gateway.platforms.helpers import MessageDeduplicator
self._dedup = MessageDeduplicator()  # TTL=300, cap=2000

# 使用（L942-954）：
if self._dedup.is_duplicate(event_ts):
    return
```

关键点：Socket Mode 在 reconnect 时 Slack 会**重投递未 ack 的事件**，去重是 at-most-once 保证的前提。

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "MessageDeduplicator\|seen_messages\|event_ts.*ttl" packages/core/src/
# 0 命中

$ grep -r -i "dedup\|deduplicate" packages/core/src/channel/
# 0 命中
```

EvoClaw 微信渠道有 `context_token` 回传机制（`weixin-types.ts`），**但那是 iLink 协议的 ack，不是客户端消息去重表**；飞书/企微依赖服务端 ack，也未实现客户端去重。

**判定 🔴**：Slack 路径完全缺失。若补齐 Slack，应参照 hermes ADDENDUM 做法，在 `packages/core/src/channel/helpers/` 下新建跨平台 `MessageDeduplicator` helper，Telegram/Discord/Signal 后续均可复用。

---

### §3.7 消息类型 & 文件注入（image/audio/document MIME 分派 + 文档内联）

**hermes**（`.research/19c-slack.md §3 文件注入, slack.py:1084-1162`）—— 遍历 `files[]` 按 `mimetype` 前缀分派为 **image / audio / document**；前两者保留 `url_private_download` 由下游模态解析；文档部分若命中 `SUPPORTED_DOCUMENT_TYPES`（`.txt / .md`）且体积 ≤100KB，则直接内联为文本附加到用户消息：

```python
1090  for file in event.get("files", []):
1095      mimetype = file.get("mimetype", "")
1100      if mimetype.startswith("image/"):
1105          attachments.append(ImageAttachment(url=file["url_private_download"]))
1115      elif mimetype.startswith("audio/"):
1120          attachments.append(AudioAttachment(url=file["url_private_download"]))
1130      elif mimetype in SUPPORTED_DOCUMENT_TYPES and size <= 100_000:
1140          text += f"\n\n[{file['name']}]\n{inline_content}"  # 内联
```

ADDENDUM 新增：文件下载时检查 `content-type: text/html`，若为登录页抛 ValueError（"check bot token scopes"）（L1603-1616）。

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "url_private_download\|SUPPORTED_DOCUMENT_TYPES\|mimetype.startswith" packages/core/src/
# 0 命中

$ cat packages/shared/src/types/channel.ts
# ChannelMessage 只有 content/mediaPath/mediaType 三字段，无 files[] 数组结构
```

EvoClaw `ChannelMessage` 仅支持**单个媒体附件**（`mediaPath?: string`），Slack 一条消息可携带多个 `files[]`，现有类型不表达。微信 CDN 管线（`weixin-cdn.ts / weixin-crypto.ts` AES-128-ECB 解密）与 Slack `url_private_download` HTTPS 直下完全不同。

**判定 🔴**：Slack 文件模型完全缺失。补齐需扩展 `ChannelMessage.attachments?: Attachment[]` 数组 + 新增 Slack-specific MIME 路由器 + 文档内联策略。

---

### §3.8 发送与分块（`format_message` 12 步 Markdown→mrkdwn + 39000 分块）

**hermes**（`.research/19c-slack.md §3 发送管道, slack.py:267-327`）—— `send_message` 调用 `format_message` 把 Markdown 转 Slack mrkdwn（12 步管道：代码块保护 → 内联代码 → 链接 → `<url|text>` → Slack 实体保护 → HTML 转义 → 标题 → 粗斜 / 粗 / 斜 / 删除线 → 还原），按 `MAX_MESSAGE_LENGTH=39000` 分块（低于 Slack 40000 硬限制），**仅首块**携带 `reply_broadcast=True`：

```python
267  async def send_message(self, chat_id, text, thread_id=None, ...):
275      client = self._get_client(chat_id)            # 多工作区路由
282      formatted = self.format_message(text)         # Markdown→mrkdwn
290      chunks = self._split_long_message(formatted, self.MAX_MESSAGE_LENGTH)
300      for idx, chunk in enumerate(chunks):
305          await client.chat_postMessage(
306              channel=chat_id,
307              text=chunk,
308              thread_ts=thread_id,
309              mrkdwn=True,
310              reply_broadcast=(idx == 0 and reply_broadcast),
311          )
```

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "format_message\|mrkdwn\|chat_postMessage\|reply_broadcast" packages/core/src/
# 0 命中

$ cat packages/core/src/channel/adapters/weixin-markdown.ts | head -5
# 微信 Markdown→纯文本管线，对齐微信 500 字符限制，与 Slack 39000 完全不同
```

EvoClaw 微信渠道（`weixin-markdown.ts`）有 Markdown→纯文本 + 长消息切分逻辑，但 **对齐的是微信 500 字符限制和微信 API**，与 Slack mrkdwn 特殊语法（`*bold*` 单星号 / `_italic_` 下划线 / `<url|text>` 链接 / `<@U123>` mention）完全不同，无法直接复用。

**判定 🔴**：完全缺失。补齐需独立实现 Slack mrkdwn 12 步管道 + 39000 分块常量 + `reply_broadcast` 首块逻辑。

---

### §3.9 Block Kit 审批卡（4 按钮 + `dict.pop` 原子防双击 + 白名单鉴权）

**hermes**（`.research/19c-slack.md §3 Block Kit 审批, slack.py:1221-1326`）—— `_build_approval_blocks` 构建 4 按钮卡片；按钮回调先做 `SLACK_ALLOWED_USERS` 白名单鉴权，再用 `dict.pop` 原子取出待决请求**防双击**，最终调用 `resolve_gateway_approval`：

```python
1227 def _build_approval_blocks(self, prompt, session_key):
1235     return [
1240         {"type": "section", "text": {"type": "mrkdwn", "text": prompt}},
1245         {"type": "actions", "elements": [
1250             _btn("Allow Once",    "hermes_approve_once",    session_key),
1255             _btn("Allow Session", "hermes_approve_session", session_key),
1260             _btn("Always Allow",  "hermes_approve_always",  session_key),
1265             _btn("Deny",          "hermes_deny",            session_key, "danger"),
1268         ]},
1270     ]

# 按钮回调（L1290-1326）：
1290 async def _handle_approval_action(self, ack, body, action):
1291     await ack()
1297     if self._allowed_users and user_id not in self._allowed_users:
1302         return                                         # 静默拒绝未授权用户
1310     pending = self._pending_approvals.pop(session_key, None)  # 原子防双击
1312     if pending is None: return
1320     decision = _ACTION_DECISION[action["action_id"]]
1324     await resolve_gateway_approval(pending, decision, actor=user_id)
```

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "Block Kit\|blocks.*actions\|approval_blocks\|ButtonStyle" packages/core/src/
# 0 命中

$ grep -r -i "pending_approvals\|resolve_gateway_approval" packages/core/src/
# 0 命中
```

EvoClaw 审批机制（CLAUDE.md "Permission Model"）：7 类别 × 4 作用域 + 审计日志，**后端模型**，仅 Tauri 桌面端审批弹窗 UI，**无 IM 端富交互组件**（对比 Discord 的 `ExecApprovalView` 同样缺失）。

**判定 🔴**：完全缺失。Block Kit 是 Slack 强原生体验，企业审批场景价值高（P1）。

---

### §3.10 Slash 命令（`/hermes` + subcommand 映射）

**hermes**（`.research/19c-slack.md §3 Slash 命令, slack.py:1496-1531`）—— `/hermes` 解析首个子命令并映射到 Hermes 内部命令（如 `compact` → `/compress`），通过 `slack_subcommand_map` 字典维护：

```python
1494 @self._app.command("/hermes")
1495 async def _handle_slash_command(ack, command):
1496     await ack()
1500     subcommand, *args = command["text"].split(maxsplit=1)
1510     mapped = self._slack_subcommand_map.get(subcommand, f"/{subcommand}")
1520     await self._dispatch_internal_command(mapped, args, command["user_id"])
```

对比 Discord 27 个独立 Slash 命令，Slack 架构是"单命令 + subcommand"（因为 Slack Workspace Slash 命令配额有限）。

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "slash_command\|app.command.*slack\|slack_subcommand_map" packages/core/src/
# 0 命中

$ ls packages/core/src/channel/command/builtin/
# cost.ts debug.ts echo.ts forget.ts help.ts memory.ts
# model.ts remember.ts status.ts
# ↑ 9 个内置命令，可复用的通用 slash 分发器
```

EvoClaw 确实有一套**通用** Slash 命令系统（`channel/command/command-dispatcher.ts` + `command-registry.ts`），但注册路径完全不对齐 Slack `/hermes` 单入口 + subcommand map（hermes 设计是考虑 Slack App 只注册 1 个 Slash 命令即可覆盖所有内部命令，避免 Workspace 配额）。

**判定 🔴**：Slack 侧完全缺失。但 **EvoClaw 的通用 slash dispatcher 是可迁移资产**（见 §5），若 Slack 适配器落地，只需在 Slack 侧注册单一 `/evoclaw` 命令 → 把 subcommand 交给 `CommandRegistry.findCommand()` 派发，现有 9 个命令（/help /model /status /cost /debug /echo /memory /remember /forget）可立即复用。

---

### §3.11 线程回复（`thread_ts` + `reply_broadcast=True` 首块 + 60s TTL 缓存）

**hermes**（`.research/19c-slack.md §2 数据结构 + §3 发送管道, slack.py:50-58 / 305-311`）—— `_ThreadContextCache` 60s TTL 映射减少 `conversations.replies` 的 Tier-3 限流压力（~50 req/min）；`send_message` 所有块都带 `thread_ts=thread_id`，仅首块 `reply_broadcast=True` 推送到频道：

```python
50  class _ThreadContextCache:
51      """60s TTL 线程历史缓存，减少 Tier-3 限流压力"""
52      def __init__(self, ttl: float = 60.0): ...
...
305      await client.chat_postMessage(
306          channel=chat_id,
307          text=chunk,
308          thread_ts=thread_id,                       # 所有块都挂在同一线程
309          mrkdwn=True,
310          reply_broadcast=(idx == 0 and reply_broadcast),  # 仅首块广播
311      )
```

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "thread_ts\|reply_broadcast\|ThreadContextCache\|conversations.replies" packages/core/src/
# 0 命中

$ grep -r -i "thread\|线程" packages/core/src/channel/
# 仅 Node worker thread 相关注释，无 IM thread 概念
```

EvoClaw **完全没有 IM thread 概念**（同 Discord §3.6）。Session Key 无 `thread_ts` 维度，`ChannelMessage` 无 `threadId` 字段。

**判定 🔴**：完全缺失。Slack Thread 是企业 IM 场景核心能力（工程 channel 里并行多话题），无对等实现意味着 Slack 适配器只能做到"一条消息一个会话"的降级体验。

---

### §3.12 Typing 指示（`assistant.threads.setStatus`，仅 Assistant Thread 有效）

**hermes**（`.research/19c-slack.md §3 send_typing_indicator, slack.py:356-382 + §7 未解之谜 1`）—— `send_typing_indicator` 调用 `assistant.threads.setStatus` 显示 "is thinking..."，**仅在 Assistant Thread 上下文下有效**；普通频道降级为 no-op 或 `reactions.add`（未解之谜）：

```python
356  async def send_typing_indicator(self, chat_id, thread_id, text="is thinking..."):
370      if (chat_id, thread_id) not in self._assistant_threads:
375          return  # 非 Assistant Thread，静默跳过
380      await client.assistant_threads_setStatus(
381          channel_id=chat_id, thread_ts=thread_id, status=text
382      )
```

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "assistant_threads_setStatus\|setStatus.*typing" packages/core/src/
# 0 命中

$ grep -n "sendTyping" packages/core/src/channel/channel-adapter.ts
51:  sendTyping?(peerId: string, cancel?: boolean): Promise<void>;
# 接口槽位存在（可选方法），但无任何适配器实现，包括飞书/企微也未实现
```

**判定 🔴**：`ChannelAdapter.sendTyping` 接口预留但 Slack 实现缺失。且 Slack Assistant API 仍处 **Beta**，普通频道无替代方案是 hermes 也标注的"未解之谜"，EvoClaw 若补齐可同步考虑降级策略（如 `reactions.add` 加 `:eyes:`）。

---

### §3.13 多工作区路由（`team_id` → `AsyncWebClient` 映射 + OAuth `slack_tokens.json`）

**hermes**（`.research/19c-slack.md §1 定位 + §4 多工作区路由, slack.py:140-151 / 260-265`）—— 同一 Gateway 进程服务多个工作区：

```python
140  for raw_token in os.environ.get("SLACK_BOT_TOKEN", "").split(","):
143      client = AsyncWebClient(token=raw_token.strip())
145      auth = await client.auth_test()
147      self._team_clients[auth["team_id"]] = client
148      self._team_bot_user_ids[auth["team_id"]] = auth["user_id"]
151  # 另加载 slack_tokens.json 中的 OAuth 安装

# 路由（L260-265）：
260  def _get_client(self, chat_id):
262      team_id = self._channel_team.get(chat_id)
264      return self._team_clients.get(team_id, self._client)
```

`_channel_team: Dict[str, str]` 会话 → team_id 反查表，`_bot_user_id` 按租户分别缓存（L50-58）。

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "team_id\|team_clients\|channel_team\|multi.*workspace\|multi.*tenant" packages/core/src/channel/
# 0 命中

$ cat packages/core/src/channel/channel-manager.ts
# ChannelManager 通过 adapterName 单一键管理适配器实例，
# 无 Slack-style 同一适配器内多租户路由
```

EvoClaw 现有多租户隔离靠 Agent 粒度（`agentId`）+ Binding Router（Channel→Agent 绑定），**但同一渠道适配器内部不做 team_id 切分**。若一个 EvoClaw 实例同时接入 3 个 Slack Workspace，当前架构需启动 3 个 adapter 实例（不共享连接池与 user 缓存）。

**判定 🔴**：完全缺失。Slack 多工作区是 SaaS 托管核心能力，内部 IT 单租户场景影响较小。P2（按需）。

---

### §3.14 Rate Limit（Slack Tier 1-4 分层 + Tier-3 `conversations.replies` 退避）

**hermes**（`.research/19c-slack.md §7 未解之谜 4 + 依赖 slack-sdk`）—— 依赖 `slack-sdk` 内建 Tier 1-4 分层 retry（Tier 1 ~1/min / Tier 2 ~20/min / Tier 3 ~50/min / Tier 4 ~100+/min）；`_thread_context_cache` 60s TTL 是针对 Tier-3 `conversations.replies` 的显式退避优化；`users.info` 结果缓存 `_user_name_cache` 也是防 Tier 降频：

```python
# slack.py:50
_thread_context_cache = _ThreadContextCache(ttl=60.0)  # 减少 Tier-3 `conversations.replies` 调用

# slack.py:53
_user_name_cache: Dict[str, str]  # users.info 结果缓存
```

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "rate_limit\|tier.*1.*2.*3\|Retry-After" packages/core/src/channel/
# 0 命中

$ cat packages/core/src/channel/channel-manager.ts | grep -E "RECONNECT|RATE"
const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 10;
```

EvoClaw 只有粗粒度通用重连退避，**无 Slack tier 分层感知、无显式 API 调用缓存**（如 `users.info` 结果缓存），也无 `conversations.replies` 调用的 60s TTL。

**判定 🔴**：Slack-specific 完全缺失。若自研（不复用 `@slack/bolt`），Tier 分层 rate limit 处理是高频隐患。

---

### §3.15 白名单鉴权（`SLACK_ALLOWED_USERS` + `SLACK_FREE_RESPONSE_CHANNELS`）

**hermes**（`.research/19c-slack.md §3 按钮回调, slack.py:1297-1302`）—— `SLACK_ALLOWED_USERS` 环境变量解析为 `set[str]`，未授权用户点审批按钮时**静默拒绝**（不 ack 以外回应）；`SLACK_FREE_RESPONSE_CHANNELS` 白名单频道可无条件响应（无需 @ bot）：

```python
1297 if self._allowed_users and user_id not in self._allowed_users:
1302     return                     # 静默拒绝未授权用户

# Free-response 频道（L1031-1032）：
1031 if channel in self._free_response_channels:
1032     should_respond = True
```

未解之谜 2（hermes §7）：`SLACK_FREE_RESPONSE_CHANNELS` 若覆盖私有频道，是否会与 `SLACK_ALLOWED_USERS` 的审批鉴权语义产生冲突？

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "SLACK_ALLOWED_USERS\|SLACK_FREE_RESPONSE_CHANNELS\|allowed_user_ids" packages/core/src/
# 0 命中

$ grep -r -i "NameSecurityPolicy" packages/core/src/ | head -3
# NameSecurityPolicy 存在但作用于 Skills + MCP Servers，非 IM user id
```

EvoClaw 有通用 `NameSecurityPolicy`（CLAUDE.md "扩展安全策略"：allowlist/denylist/disabled，denylist 绝对优先）覆盖 Skills + MCP Servers，**但不作用于 IM 平台的 user/channel ID**。

**判定 🔴**：Slack-specific 完全缺失。Slack 是开放平台，user/channel ID 白名单是企业审批场景的安全底线。补齐可直接扩展 `NameSecurityPolicy` 到 Slack 维度。

---

### §3.16 Assistant Thread 生命周期（`assistant_thread_started / _context_changed`）

**hermes**（`.research/19c-slack.md §3 构造与启动 + §6 复刻清单 14, slack.py:202-210 / 1084-1168`）—— 监听两个 Assistant Thread 生命周期事件 `assistant_thread_started / assistant_thread_context_changed`，缓存 metadata 到 `_assistant_threads: Dict[tuple, Dict]` 以便后续 `assistant.threads.setStatus` 使用（§3.12 前提）：

```python
202  self._app.event("assistant_thread_started")(self._handle_assistant_thread_lifecycle_event)
208  self._app.event("assistant_thread_context_changed")(self._handle_assistant_thread_lifecycle_event)

# 缓存结构（L57）：
_assistant_threads: Dict[tuple, Dict]  # (team_id, channel, thread_ts) → metadata
```

Slack Assistant API 是 **Beta** 能力，仅启用 `assistant:write` scope 的 App 才能收到；普通频道不会触发生命周期事件。

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "assistant_thread\|assistant_threads\|assistant.*lifecycle" packages/core/src/
# 0 命中
```

**判定 🔴**：完全缺失。Assistant API 是 Slack 近期 AI 产品布局重心，若 EvoClaw 未来定位企业 AI 助理，此能力价值较高；但当前 Beta 状态、ROI 不明，建议 P2。

---

## 4. 建议改造蓝图（不承诺实施）

### P0（若承接 Slack 渠道，必做）

1. **直接复用 `@slack/bolt` v3+**（TS 生态）而非自研 Socket Mode —— 避免重造 WebSocket / Rate Limit / Retry 轮子（节省 2-3 人周）
   - 新增 `packages/core/src/channel/adapters/slack.ts`，实现 `ChannelAdapter` 接口
   - `ChannelType` 枚举新增 `'slack'`（`packages/shared/src/types/channel.ts:2`）
   - `ChannelConfig.credentials` 扩展 `{ botToken, appToken, signingSecret?, allowedUserIds, freeResponseChannels, requireMention }` 字段
2. **Bot Token + App Token 双凭据认证**（§3.1）—— `@slack/bolt App({ token, appToken, socketMode: true })` 一键开箱；工作量 0.3 人周
3. **Socket Mode 长连接 + 自动重连**（§3.2）—— Bolt 内建，EvoClaw 外层仅做 `RECONNECT_DELAY_MS` 兜底；工作量 0.2 人周
4. **事件归一化 + Session Key 三元组**（§3.4）—— Session Key 扩展 `agent:<agentId>:slack:<teamId>:<channel>:[thread:<threadTs>]`；`ChannelMessage` 新增 `threadId?: string / teamId?: string` 字段；工作量 0.7 人周
5. **消息去重 `MessageDeduplicator`**（§3.6）—— 新建 `channel/helpers/message-deduplicator.ts` 作为**跨渠道复用 helper**（Telegram / Discord / Signal / WhatsApp 未来均受益，对齐 hermes ADDENDUM 设计）；工作量 0.2 人周
6. **四层响应决策**（§3.5）—— free-response / require_mention / `<@bot>` / `_mentioned_threads`；工作量 0.3 人周
7. **发送 & mrkdwn 12 步 + 39000 分块**（§3.8）—— 独立 Slack 常量 `SLACK_MAX_MESSAGE_LENGTH=39000`，Markdown→mrkdwn 专用管道；工作量 0.8 人周

### P1（强体验项）

8. **Block Kit 审批卡**（§3.9）—— 把 EvoClaw 后端 Permission 审批模型接入 Slack Button UI；4 按钮 + `dict.pop` 原子防双击 + 白名单鉴权；工作量 0.8 人周
9. **Slash 命令 `/evoclaw` + subcommand map**（§3.10）—— 基于现有 `CommandRegistry` 通用分发器注册单一 Slack Slash 命令 → subcommand 派发；工作量 0.4 人周
10. **文件注入（image/audio/document MIME 分派 + 文档内联 ≤100KB）**（§3.7）—— `ChannelMessage.attachments?: Attachment[]` 扩展 + Slack HTTPS 直下管线；工作量 0.6 人周
11. **线程回复（`thread_ts` + `reply_broadcast` 首块 + 60s TTL 缓存）**（§3.11）—— 核心企业 IM 能力，配套 `_ThreadContextCache`；工作量 0.5 人周
12. **白名单鉴权**（§3.15）—— 扩展通用 `NameSecurityPolicy` 支持 Slack user/channel id；工作量 0.2 人周
13. **SSRF redirect guard + HTML 登录页检测**（ADDENDUM C/E）—— 安全加固，文件下载 301/302 目标校验 + `content-type: text/html` 检测；工作量 0.3 人周

### P2（加分项，按需）

14. **多工作区路由（`team_id` → `AsyncWebClient` 映射 + OAuth 安装流）**（§3.13）—— 企业内部单租户场景影响小，SaaS 托管才需要；工作量 1.0 人周
15. **Assistant Thread 生命周期 + `setStatus` typing**（§3.12, §3.16）—— Assistant API Beta，待稳定后补齐；工作量 0.5 人周
16. **频道级 system prompt**（ADDENDUM D）—— `resolve_channel_prompt` 允许不同 channel 配不同系统提示，`ChannelMessage` 新增 `channelPrompt?: string`；工作量 0.3 人周

### 不建议做

17. **Events API Webhook 接入**（§3.2 对立路径）—— Socket Mode 在内网/NAT 友好，Webhook 需公开 URL + 签名校验 + 3s ack，企业部署场景反而更重；除非 Slack 把 Socket Mode 关闭（目前稳定）否则 ROI 极低。

### 工作量估算汇总

- P0：~2.5-3 人周（核心能力补齐至 MVP，含 Socket Mode + 三元组 Session + 去重 + 4 层响应 + mrkdwn + 分块）
- P0+P1：~5.5-6 人周（与 hermes 基础能力对齐，含 Block Kit 审批 + Slash 命令 + 文件注入 + 线程 + 白名单 + SSRF 加固）
- 全量复刻 hermes：~7-8 人周（含 §3.13 多工作区 + Assistant API + 频道级 prompt）

---

## 5. EvoClaw 反超点汇总

**直接反超**：无。EvoClaw 的 Slack 渠道完全缺失，谈不上反超。

**无本地 Slack 实现，但以下 EvoClaw 通用能力可迁移支持 Slack**（若承接 Slack 渠道，现有基础设施可显著加速开发）：

| # | EvoClaw 资产 | 代码证据 | 对 Slack 适配器的增值 |
|---|---|---|---|
| 1 | **ChannelAdapter 统一接口** | `channel/channel-adapter.ts:31-55`（`connect/disconnect/onMessage/sendMessage/sendMediaMessage?/sendTyping?/getStatus` 7 方法） | Slack 实现只需满足这 7 方法；`sendTyping?` 已预留（§3.12），Slack 实现时直接接入 `assistant.threads.setStatus` |
| 2 | **通用 Slash 命令系统** | `channel/command/command-dispatcher.ts:12-25`（`isSlashCommand / parseSlashCommand / createCommandDispatcher`）+ `command-registry.ts:10-37`（`register / findCommand`，含别名） | Slack `/evoclaw <sub>` 单一 Slash 入口，subcommand 直接回调 `CommandRegistry.findCommand()`，9 个内置命令立即复用（§3.10） |
| 3 | **9 个已实现内置命令** | `channel/command/builtin/{cost,debug,echo,forget,help,memory,model,remember,status}.ts` | Slack 首日可直接开放 `/evoclaw help / /evoclaw model / /evoclaw status ...`，减少从 0 构建 |
| 4 | **Session Key 路由** | CLAUDE.md "Session Key 路由" — `agent:<agentId>:<channel>:dm:<peerId>` / `...:group:<groupId>` | 只需扩展 `agent:<agentId>:slack:<teamId>:<channel>[:thread:<threadTs>]` 维度，对接 Slack 三元组会话键（§3.4, §3.11） |
| 5 | **Binding Router** | CLAUDE.md "Binding Router" — Channel→Agent 最具体优先匹配 | 支持将不同 Slack Workspace / Channel 绑定到不同 Agent，企业多租户 + 多部门场景直接受益 |
| 6 | **ChannelManager 重连机制** | `channel/channel-manager.ts:13-14`（`RECONNECT_DELAY_MS=5_000 / MAX_RECONNECT_ATTEMPTS=10`） | 与 `@slack/bolt` 内建 Socket Mode 重连叠加（外层兜底 + 内层精细） |
| 7 | **NameSecurityPolicy 安全白名单** | CLAUDE.md "扩展安全策略" — allowlist/denylist/disabled，denylist 绝对优先 | 扩展到 Slack user id / channel id / team id 白名单，覆盖 §3.15 `SLACK_ALLOWED_USERS` + `SLACK_FREE_RESPONSE_CHANNELS` 能力 |
| 8 | **Permission 审批后端 + audit_log** | CLAUDE.md "Permission Model" — 7 类别 × 4 作用域 + 审计日志 | 直接对接 Block Kit 审批卡（§3.9）：按钮点击 → `resolve_gateway_approval` → EvoClaw `permissions` 表写入 + `audit_log` |
| 9 | **Skills 生态（30 个 bundled skills）** | `skill/bundled/` 30 个目录，含 `slack-gif-creator`（名字巧合，非 Slack adapter） | Slack 用户通过 Slash 命令（如 `/evoclaw deep-research-pro <query>`）立即调用所有内置技能，**这是 hermes 没有的对等能力** |
| 10 | **通用消息标准化器骨架** | `channel/message-normalizer.ts:8-173`（4 个 `normalize*Message` 函数：feishu/wecom/weixin/desktop） | Slack 侧新增 `normalizeSlackMessage(event, teamId)` 对齐风格，`ChannelMessage` 归一化路径统一 |
| 11 | **微信 Markdown 管线（架构可借鉴）** | `channel/adapters/weixin-markdown.ts`（微信对齐） | 架构模式（Markdown → 渠道专用格式 + 分块）可借鉴到 Slack mrkdwn 12 步管道，但常量与规则完全重写（§3.8） |
| 12 | **System Events 队列** | CLAUDE.md "System Events" 章 — 内存 per-session 事件队列（`enqueueSystemEvent → chat.ts drainSystemEvents → message 前缀注入`） | Slack Socket Mode 事件（on_message / assistant_thread_*）可直接入 System Events 队列，复用 chat.ts drainSystemEvents 注入上下文 |
| 13 | **Slash 命令 builtin/help 架构** | `channel/command/builtin/help.ts`（列出所有已注册命令） | Slack `/evoclaw help` 首日可用；hermes `slack_subcommand_map` 字典可对齐为 EvoClaw `CommandRegistry` 别名机制 |
| 14 | **Zod Schema 验证基线** | CLAUDE.md "Zod Schema 验证" 章（外部输入 safeParse + passthrough） | Slack Config / Slack Event payload 可用 Zod 校验，比 Python 运行时类型检查更强 |

**综合结论**: 无明显反超，整体缺失。但 EvoClaw 的 **通用 ChannelAdapter + slash dispatcher + session key 路由 + binding router + permission 审批后端 + skills 生态 + System Events 队列** 是实现 Slack 适配器的坚实底座，预计能把 hermes 对等工作量从 8 人周压缩到 5-6 人周（P0+P1）。尤其 Skills 生态直接通过 `/evoclaw <skill-name>` 透出给 Slack 用户，是 hermes Slack 适配器**不具备的增量价值**——但这属于"EvoClaw 通用能力通过 Slack 渠道变现"，不是"Slack 适配器本身的反超"。

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（已 Read 验证）

- `packages/core/src/channel/channel-adapter.ts:1-55` —— `ChannelAdapter` 接口定义（7 方法，含可选 `sendTyping` / `sendMediaMessage`），**无 Slack 分支**
- `packages/core/src/channel/channel-manager.ts:13-14` —— `RECONNECT_DELAY_MS=5_000 / MAX_RECONNECT_ATTEMPTS=10` 通用重连常量
- `packages/core/src/channel/command/command-dispatcher.ts:12-25` —— `isSlashCommand / parseSlashCommand` 通用 slash 解析
- `packages/core/src/channel/command/command-dispatcher.ts:28-62` —— `createCommandDispatcher` 注册表 + 技能 fallback 两级分发
- `packages/core/src/channel/command/command-registry.ts:10-37` —— `CommandRegistry.register / findCommand / listCommands`
- `packages/core/src/channel/message-normalizer.ts:8-173` —— 4 个渠道的 `normalize*Message` 函数（feishu / wecom / weixin / desktop），**无 Slack**
- `packages/shared/src/types/channel.ts:2` —— `ChannelType = 'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq' | 'weixin'`（**6 种，无 `'slack'`**）
- `packages/shared/src/types/channel.ts:5-19` —— `ChannelMessage { channel, chatType: 'private'|'group', accountId, peerId, senderId, senderName, content, messageId, timestamp, mediaPath?, mediaType? }`（**无 threadId / teamId / attachments[] 字段**）
- `packages/core/src/channel/adapters/` 目录下 **16 个 ts 文件**：`desktop.ts / feishu.ts / wecom.ts / weixin.ts / weixin-silk.ts / weixin-api.ts / weixin-cdn.ts / weixin-crypto.ts / weixin-debug.ts / weixin-error-notice.ts / weixin-markdown.ts / weixin-mime.ts / weixin-redact.ts / weixin-send-media.ts / weixin-types.ts / weixin-upload.ts`（**无 slack.ts**）
- `packages/core/src/tools/permission-interceptor.ts:44-47` —— `MESSAGE_TOOLS` 白名单字符串 `'slack_send'`（仅工具名字面引用，无 Slack 业务代码）
- `grep -r -i slack packages/core/src` → **全仓 3 处命中**：`tools/permission-interceptor.ts`（白名单字符串） + `skill/bundled/marketing-mode/SKILL.md`（文档示例） + `skill/bundled/automation-workflows/SKILL.md`（文档示例），**0 处业务实现**

### 6.2 hermes 研究引用

本文所有 hermes 声称均来自 `/Users/mac/src/github/hermes-agent/.research/19c-slack.md` 以下小节：
- §1 角色与定位 / §2 数据结构（`_ThreadContextCache` L50 / `_assistant_threads` L57 / `MAX_MESSAGE_LENGTH=39000`）/ §3 关键函数流程（构造与启动 L80-116,190-227 / 事件归一化 L942-1089 / 文件注入 L1090-1168 / 发送与编辑 L267-354 / Block Kit 审批 L1227-1326 / Slash 命令 L1494-1533）/ §4 代码片段（事件注册 L190-227 / 去重+DM/Thread L942-1017 / 四层响应 L1031-1053 / 发送分块 L267-327 / Block Kit 卡片 L1227-1270 / 按钮回调 L1290-1326 / 多工作区路由 L140-151,260-265）/ §5 交互依赖（`BasePlatformAdapter` / `HermesGateway` / `format_message` / `slack_oauth.py` / Slack Web API）/ §6 复刻清单 15 项 / §7 未解之谜（Assistant typing 降级 / free-response 鉴权冲突 / OAuth 刷新 / Tier-3 退避）/ ADDENDUM @ `00ff9a26`（`MessageDeduplicator` 提取 / 平台锁定统一 / SSRF redirect guard / 频道级 system prompt / HTML 登录页检测）

### 6.3 关联差距章节（crosslink）

- [`19-gateway-platforms-gap.md`](./19-gateway-platforms-gap.md)（Wave 2-5 已完成） —— Gateway 层总览差距，阐述 hermes 统一 `BasePlatformAdapter` 抽象与 EvoClaw `ChannelAdapter` 接口的对比，Slack 整体缺失已在总览中标注
- [`19a-telegram-gap.md`](./19a-telegram-gap.md)（Wave 2-5 已完成） —— Telegram 渠道差距（同属整体缺失，Bot Token + Long Polling vs Slack Socket Mode 路径对比）
- [`19b-discord-gap.md`](./19b-discord-gap.md)（Wave 2-5 已完成） —— Discord 渠道差距（同属整体缺失，Intent flags + Interaction Views vs Slack Block Kit 富交互对比，同为"富交互组件"类平台）
- `19d-signal-gap.md`（同批 Wave 3 待写） —— Signal 渠道差距（E2EE IM，Socket Mode 概念不同）
- `19e-matrix-gap.md`（同批 Wave 3 待写） —— Matrix 渠道差距（去中心化协议，多工作区路由模式可对比）
- `19f-whatsapp-gap.md`（同批 Wave 3 待写） —— WhatsApp 渠道差距（Business API，Webhook 路径）
- [`29-security-approval-gap.md`](./29-security-approval-gap.md)（后续 Wave） —— hermes 审批模型 + Block Kit 审批卡，对应 EvoClaw Permission Model 后端；Slack 适配器补齐将强依赖此章
- [`14-state-sessions-gap.md`](./14-state-sessions-gap.md)（Wave 2-3 已完成） —— Session Key 路由 + Binding Router 通用能力，是 Slack 三元组会话键（§3.4）扩展的基础

---

**文档状态**: Wave 3 并行草稿，EvoClaw 整体缺失，已记录 16 项机制零覆盖证据 + 14 项可迁移资产。建议此章在后续规划中定位 P2（非当前 Sprint 16 范围），若未来需要对接国际企业 IM 用户，Slack 是优先级最高的国际平台之一（对比 Discord 偏游戏/社区、Telegram 偏消费）。
