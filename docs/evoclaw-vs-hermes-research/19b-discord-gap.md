# 19b — Discord 平台适配器 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/19b-discord.md`（531 行，源 `gateway/platforms/discord.py` 2864→3165 行，ADDENDUM @ `00ff9a26`）
> **hermes 基线**: commit `00ff9a26`（2026-04-16，+301 行漂移，引入 MessageDeduplicator / TextBatchAggregator / ThreadParticipationTracker helpers）
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16）
> **综合判定**: 🔴 **整体缺失** — Discord 渠道在 EvoClaw 中完全未实现，`ChannelType` 枚举不含 `'discord'`，`channel/adapters/` 无 Discord 文件，`packages/core/src -r -i discord` 零结果

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes `DiscordAdapter`**（`gateway/platforms/discord.py:1-3165`，基线 2864 行 / 当前 3165 行） — Hermes 所有 platform adapter 中规模最大的一个，基于 `discord.py commands.Bot`，同时承载三种容器（DM / Guild Text / Thread / Forum）、多模态（文本 / 图片 / 视频 / Native Voice Message / 文件）、实时语音（DAVE E2EE 解密 + Opus/PCM 缓冲 + 静音切片）、交互组件（`ExecApprovalView` 4 按钮 / `ModelPickerView` 两步 select / `UpdatePromptView`）、**27 个 Slash Commands**、自动 Thread、Forum topic 继承、Typing 心跳、反应等"原生体验"细节。ADDENDUM 进一步把去重 / thread tracking / text batching 逻辑提取为跨平台 helpers。

**EvoClaw Discord 实现** — **不存在**。`packages/core/src/channel/adapters/` 当前只有 6 个已实现的适配器（`desktop.ts / feishu.ts / wecom.ts / weixin.ts / weixin-silk.ts` + 多个 weixin-* 辅助文件），`ChannelType` 联合类型为 `'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq' | 'weixin'`（`packages/shared/src/types/channel.ts:2`），Discord 完全缺位。与国际社区 IM（Discord / Telegram / Slack / Signal / Matrix / WhatsApp）对齐是 EvoClaw 面向非中文企业场景扩展时的主要空白，但当前 Sprint 16 聚焦企微生产就绪，Discord 未进入路线图。

**量级对比**: hermes 3165 行 Discord 单文件 vs EvoClaw **0 行**。按 hermes 复刻清单 23 项能力计，EvoClaw 需从 0 起步搭建 Bot Token 认证 / Gateway WebSocket 维持 / Intents 配置 / Slash Tree 注册 / Interaction Views / Voice Receiver 全链条。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | Bot Token 认证 + Intent flags | 🔴 | 完全缺失；EvoClaw 无 Discord privileged intent 概念 |
| §3.2 | Gateway WebSocket 长连接 / 心跳重连 | 🔴 | 完全缺失；现有适配器全走轮询（iLink/飞书 webhook） |
| §3.3 | 消息类型（text / image / video / audio / attachment） | 🔴 | 完全缺失 Discord attachments 分类与 MIME 路由 |
| §3.4 | Slash 命令注册与处理（27 个 `/` 命令） | 🔴 | 完全缺失 Discord `tree.command`；但 EvoClaw **有通用 slash dispatcher 可迁移**（见 §5） |
| §3.5 | 频道分类（DM / Guild Text / Thread / Forum） + Mention 检查 | 🔴 | 完全缺失；EvoClaw `chatType` 仅 `private/group` 二分 |
| §3.6 | 自动 Thread + Forum topic 继承 | 🔴 | 完全缺失；EvoClaw 无 thread 概念 |
| §3.7 | 消息去重表（MessageDeduplicator, TTL 5min, cap 2000） | 🔴 | 完全缺失 Discord 路径；EvoClaw 消息去重依赖各适配器自身（如 weixin context_token） |
| §3.8 | send() 切片（2000 字符）+ reply fallback | 🔴 | 完全缺失 Discord 路径；EvoClaw 有通用 Markdown→纯文本管线（weixin）可借鉴 |
| §3.9 | Native Voice Message（flags=8192 + waveform + duration） | 🔴 | 完全缺失；EvoClaw 仅在 weixin 渠道有 SILK 语音转码 |
| §3.10 | Typing 心跳（每 8s POST /typing） | 🔴 | 完全缺失；`ChannelAdapter.sendTyping` 可选方法定义但 Discord 未实现 |
| §3.11 | Voice Channel（FFmpegPCMAudio + DAVE 解密 + 超时 120/300s） | 🔴 | 完全缺失；EvoClaw 无 VOIP 语音通道概念 |
| §3.12 | Interaction Views（Button / SelectMenu / Modal） | 🔴 | 完全缺失；EvoClaw 无审批按钮/ModelPicker 交互 UI 组件 |
| §3.13 | Rate Limit（全局 + per-route bucket） | 🔴 | 完全缺失 Discord 专属 bucket；EvoClaw 仅有通用重连退避 |
| §3.14 | Sharding / Zombied connection resume | 🔴 | 完全缺失；hermes 当前单 shard，EvoClaw 连单 shard 也无 |
| §3.15 | 白名单过滤 + `DISCORD_ALLOW_BOTS` 三档 | 🔴 | 完全缺失；EvoClaw 有通用 NameSecurityPolicy 可类比但未针对 Discord user id |
| §3.16 | Reactions（👀/✅/❌ 处理进度） | 🔴 | 完全缺失；现有适配器无 reaction emoji 反馈机制 |

**统计**: 🔴 16 / 🟡 0 / 🟢 0。**全维度缺失**，综合判定 🔴。

---

## 3. 机制逐条深度对比

> **EvoClaw 端统一证据**: 下述所有小节的"缺失证据"均基于同一组零结果——
> - `grep -r -i discord packages/core/src` → 0 命中
> - `ls packages/core/src/channels/discord*` → not found（目录名是 `channel/` 单数，且无 Discord 文件）
> - `packages/core/src/channel/adapters/` 只含 `desktop.ts / feishu.ts / wecom.ts / weixin.ts / weixin-silk.ts` + 11 个 weixin-* 辅助文件
> - `packages/shared/src/types/channel.ts:2` `ChannelType = 'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq' | 'weixin'`（无 `'discord'`）

### §3.1 Bot Token 认证 + Intent flags

**hermes**（`.research/19b-discord.md §3.1`，`discord.py:518-530`）—— `commands.Bot` 显式开启 4+1 个 intents：

```python
518  def _build_client(self) -> commands.Bot:
519      intents = discord.Intents.default()
520      intents.message_content = True   # privileged, Developer Portal 必开
521      intents.dm_messages = True
522      intents.guild_messages = True
523      intents.voice_states = True
524      if self._config.need_members:
525          intents.members = True
526      proxy = resolve_proxy_url(os.getenv("DISCORD_PROXY"))
527      return commands.Bot(
528          command_prefix="!", intents=intents, proxy=proxy,
529          help_command=None,
530      )
```

关键点：`message_content` 是 **privileged intent**，Bot 账户必须在 Developer Portal 勾选，否则 `on_message` 拿不到 `message.content` 正文。HTTPS 代理通过 `DISCORD_PROXY` 环境变量注入。

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "intents\|message_content\|privileged" packages/core/src/channel/
# 0 命中
$ grep -r -i "DISCORD_TOKEN\|DISCORD_PROXY" packages/core/src/
# 0 命中
$ cat packages/core/src/channel/adapters/feishu.ts | head -20
# 飞书走 app_id/app_secret + tenant_access_token + LongConnection，
# 无 Discord 风格 Bot Token + Intent flags 概念
```

**判定 🔴**：EvoClaw 根本没有 Bot Token + Intent flags 的抽象层。现有渠道鉴权模型（飞书 app_id/secret + 长连接、企微 corp_id/secret + webhook、微信 iLink QR + 长轮询）都不适用 Discord Gateway 模型。补齐需引入 `discord.js` / `@discordjs/core`（TS 生态）或自研 WebSocket 客户端，并在 `ChannelConfig.credentials` 中新增 `token / intents` 字段。

---

### §3.2 Gateway WebSocket 长连接 / 心跳重连

**hermes**（`.research/19b-discord.md §3.1, §7`，`discord.py:430-465`）—— 依赖 `discord.py` 内建的 WebSocket 心跳 + 自动重连 + Zombied connection resume。`_ready_event: asyncio.Event` 作为 Gateway 握手完成的信号，所有 `send()` 前必须 `await` 它：

```python
430  def __init__(self, config: DiscordConfig) -> None:
431      super().__init__(config)
432      self._client: commands.Bot = self._build_client()
433      self._ready_event = asyncio.Event()  # Gateway 握手同步
...
```

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "websocket\|ws://\|wss://" packages/core/src/channel/
packages/core/src/channel/adapters/feishu.ts  # 飞书有 WS 长连接，但 SDK 封装
packages/core/src/channel/adapters/weixin.ts  # 长轮询（非 WS）
# 无 Discord Gateway

$ grep -r -i "_ready_event\|ready_event\|gateway" packages/core/src/channel/adapters/
# 0 Discord 相关命中
```

EvoClaw 现有重连机制（`channel-manager.ts:13-14`）：
```typescript
const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 10;
```
是通用指数退避，未覆盖 Discord-specific 的 Gateway resume token / session_id / sequence number 语义。

**判定 🔴**：完全缺失 Discord Gateway 专用的断线重连协议（resume gateway URL / Invalid Session 对 IDENTIFY 的区分 / Zombied connection 判定）。补齐工作量大，建议直接复用 `discord.js` 而非自研。

---

### §3.3 消息类型（text / image / video / audio / attachment）

**hermes**（`.research/19b-discord.md §3.2 步骤 7`，`discord.py:545-653`）—— 遍历 `message.attachments`，按 MIME 路由到 `PHOTO/VIDEO/AUDIO/DOCUMENT`，调用 `cache_image_from_url()` 落盘：

```
7. 附件分类：遍历 attachments，按 MIME → PHOTO/VIDEO/AUDIO/DOCUMENT，调用 cache_image_from_url() 落盘
```

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "attachment\|message.attachments" packages/core/src/channel/adapters/
packages/core/src/channel/adapters/weixin.ts       # 微信 item_list → 媒体类型
packages/core/src/channel/adapters/weixin-cdn.ts   # weixin CDN 媒体下载
# 无 Discord attachment 处理
```

EvoClaw `ChannelMessage` 类型（`packages/shared/src/types/channel.ts`）当前只有基本的 `content: string` + optional `mediaPath`，无 Discord 富附件分类字段。微信渠道的 CDN + AES-128-ECB 媒体解密管线（`weixin-cdn.ts / weixin-crypto.ts`）与 Discord 的 CDN URL + HTTPS 直下载架构不同，无法直接复用。

**判定 🔴**：完全缺失。需新增 Discord-specific attachment 解析器，遍历 `msg.attachments`，按 `content_type` 头分派到 EvoClaw 统一的媒体管线。

---

### §3.4 Slash 命令注册与处理（27 个 `/` 命令）

**hermes**（`.research/19b-discord.md §3.7`，`discord.py:1584-1714`→ 迁移后 L1659-1879）—— 通过 `tree.command()` 注册 **27 个** Slash 命令，全部 `defer(ephemeral=True)` 再走 Gateway 命令通道：

| 命令 | 用途 |
|---|---|
| `/new /reset /model /reasoning /personality` | 会话控制 |
| `/retry /undo /status /sethome /stop` | 交互控制 |
| `/compress /title /resume /usage /provider` | 会话维护 |
| `/help /insights /reload-mcp /voice /update` | 系统操作 |
| `/approve /deny /thread /queue /background /btw` | 审批与后台任务 |
| `/animation` | ADDENDUM 新增 |

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "tree.command\|app_commands\|interaction.response.defer" packages/core/src/
# 0 命中（Discord 专属 API）

$ ls packages/core/src/channel/command/builtin/
# cost.ts debug.ts echo.ts forget.ts help.ts memory.ts
# model.ts remember.ts status.ts
# ↑ 9 个内置命令，与 hermes 的 27 个 Slash 命令对比
```

EvoClaw 确实有一套**通用** Slash 命令系统（`channel/command/command-dispatcher.ts` + `command-registry.ts`），但注册路径完全不对齐 Discord Application Command API（无 `tree.sync()` / options 参数 / `interaction.response.defer(ephemeral)`）。

**判定 🔴**：Discord 侧完全缺失。但 **EvoClaw 的通用 slash dispatcher 是可迁移资产**（见 §5），若 Discord 适配器落地，只需把 `interaction.response` 回调映射到 `CommandContext`，现有 9 个命令（/help /model /status /cost /debug /echo /memory /remember /forget）可立即复用，另需为 Discord 新增 /new /reset /approve 等 18 条补齐 hermes 能力对等。

---

### §3.5 频道分类 + Mention 检查

**hermes**（`.research/19b-discord.md §3.2 步骤 3-6`，`discord.py:2221-2280`）—— 识别 `DMChannel / Thread / TextChannel / ForumChannel`，默认要求 @Bot，三种 bypass（DM / free_response_channels / _bot_participated_threads）：

```python
2221 def _should_respond(self, message: discord.Message) -> bool:
2222     ch = message.channel
2223     if isinstance(ch, discord.DMChannel): return True
2224     if ch.id in self._config.ignored_channels: return False
2225     if ch.id in self._config.free_response_channels: return True
2226     if isinstance(ch, discord.Thread) and ch.id in self._bot_participated_threads:
2227         return True
2228     if not self._config.require_mention: return True
2229     return self._client.user in message.mentions
```

ADDENDUM 备注：`_should_respond` 已融入 `_handle_message` L2417-2702，逻辑不变。

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "DMChannel\|TextChannel\|ForumChannel\|require_mention\|bot_participated_threads" packages/core/src/
# 0 命中
```

EvoClaw `ChannelMessage.chatType` 只有 `'private' | 'group'` 二分（`packages/shared/src/types/channel.ts:6`），完全没有 Discord thread / forum / guild text 的细粒度容器模型。Mention 检查在微信/企微渠道也不适用（业务场景不同）。

**判定 🔴**：完全缺失 Discord 容器语义。需引入枚举 `'dm' | 'guild_text' | 'thread' | 'forum_thread'`，以及 `ignored_channels / free_response_channels / require_mention` 配置字段。

---

### §3.6 自动 Thread + Forum topic 继承

**hermes**（`.research/19b-discord.md §3.2 步骤 8-9, §4.5`，`discord.py:1900-1960 / 2153-2160`）—— Guild text channel 触发时自动 `create_thread(name=msg[:80], auto_archive_duration=1440)`，thread id 加入 `_bot_participated_threads`（cap 500、磁盘持久化）。Forum thread 通过 `_get_effective_topic()` 继承 parent forum 的 `topic` 字段作为 `SessionSource.chat_topic`：

```python
1900 async def _auto_create_thread(self, message: discord.Message) -> Optional[discord.Thread]:
1901     if not self._config.auto_thread: return None
1902     ch = message.channel
1903     if not isinstance(ch, discord.TextChannel): return None
1904     if ch.id in self._config.no_thread_channels: return None
1905     name = (message.content or "chat")[:80]
1906     thread = await message.create_thread(name=name, auto_archive_duration=1440)
1907     self._bot_participated_threads.add(thread.id)
1908     self._persist_threads()
1909     return thread
```

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "create_thread\|auto_thread\|thread_id\|forum_topic" packages/core/src/channel/
# 0 命中（thread 在 EvoClaw 指 Node worker thread，不是 IM thread）
```

**判定 🔴**：完全缺失。EvoClaw 现有 Session Key 格式（`agent:<agentId>:<channel>:dm:<peerId>` / `...:group:<groupId>`）对 Discord Thread 不适用，需扩展为 `...:thread:<threadId>` 并配套持久化表。

---

### §3.7 消息去重表（MessageDeduplicator）

**hermes**（`.research/19b-discord.md §4.3 + ADDENDUM`，基线 `discord.py:574-591` 内联 → 当前 `helpers.py:25-65` 类）—— TTL 5min + cap 2000 + 自动 prune：

```python
# ADDENDUM 提取后：
class MessageDeduplicator:
    def __init__(self, max_size: int = 2000, ttl_seconds: float = 300):
        self._seen: Dict[str, float] = {}
    def is_duplicate(self, msg_id: str) -> bool: ...
    def clear(self): ...

# discord.py 集成（L461）：
self._dedup = MessageDeduplicator()
```

关键点：Discord Gateway 在 reconnect 后可能重复投递相同 `message.id`，去重表用 `f"{msg_id}:{channel_id}"` 组合键对抗。

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "MessageDeduplicator\|seen_messages\|msg_id.*TTL" packages/core/src/
# 0 命中
```

EvoClaw 微信渠道有 `context_token` 回传防重复（`weixin-types.ts`），但那是 iLink 协议的 ack 机制，不是通用消息去重表；飞书/企微依赖服务端 ack 保证 at-most-once，也没有客户端去重。

**判定 🔴**：Discord 路径完全缺失。若补齐 Discord，应参考 hermes ADDENDUM 的跨平台 `MessageDeduplicator` helper 设计，避免各适配器重复实现。

---

### §3.8 send() 切片（2000 字符）+ reply fallback

**hermes**（`.research/19b-discord.md §3.3, §4.6`，`discord.py:760-809`）—— 文本超 2000 按段切，`reply_to_mode` ∈ {first, all, off} 控制 `reference=` 参数，HTTP 50035 fallback 去 reference 重试：

```python
760  async def send(self, channel_id: int, text: str, reply_to: Optional[int] = None) -> int:
761      await self._ready_event.wait()
762      chunks = self._split(text, self.MAX_MESSAGE_LENGTH)  # 2000
763      for idx, chunk in enumerate(chunks):
764          ref = self._build_reference(reply_to, idx)
765          try:
766              msg = await channel.send(chunk, reference=ref)
767          except discord.HTTPException as e:
768              if e.code == 50035 and ref is not None:
769                  msg = await channel.send(chunk)  # drop reference
```

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "MAX_MESSAGE_LENGTH\|reply_to_mode\|HTTPException.*50035" packages/core/src/
# 0 命中
```

EvoClaw 微信渠道（`weixin-markdown.ts`）有 Markdown→纯文本 + 长消息切分逻辑，但**对齐的是微信 500 字符限制和微信 API**，与 Discord 的 2000 字符 + reply reference + 50035 错误码完全不同，无法直接复用常量。

**判定 🔴**：完全缺失。

---

### §3.9 Native Voice Message

**hermes**（`.research/19b-discord.md §3.4, §4.7`，`discord.py:898-960`）—— `flags=8192`（IS_VOICE_MESSAGE）+ base64 256 字节 waveform + `mutagen.oggopus` 读取 duration_secs + multipart POST + 失败降级为普通附件：

```python
898  async def send_voice_message(self, channel_id: int, ogg_path: Path) -> int:
899      duration = OggOpus(ogg_path).info.length
900      waveform = base64.b64encode(self._gen_waveform(ogg_path, 256)).decode()
901      payload = {
902          "flags": 8192,
903          "attachments": [{"id": 0, "filename": "voice.ogg",
904                          "duration_secs": duration, "waveform": waveform}],
905      }
```

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "voice_message\|IS_VOICE_MESSAGE\|flags.*8192\|oggopus\|waveform" packages/core/src/
# 0 命中
```

EvoClaw 语音能力只在微信渠道（`weixin-silk.ts` — SILK 编解码），**不是 OGG Opus**，waveform 可视化也完全不涉及。

**判定 🔴**：完全缺失。Discord 的 OGG Opus + waveform + duration 管线需从头搭建。

---

### §3.10 Typing 心跳

**hermes**（`.research/19b-discord.md §3.5`，`discord.py:1397-1431`）—— Discord typing 仅 ~10s 有效，每 8s POST `/channels/{id}/typing` 重发，per-channel `asyncio.Task` 存 `_typing_tasks`，处理结束 cancel。

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "typing_tasks\|POST.*typing\|sendTyping" packages/core/src/channel/
packages/core/src/channel/channel-adapter.ts:51:  sendTyping?(peerId: string, cancel?: boolean)  # 接口定义
# 接口存在但无 Discord 实现；现有适配器甚至未见 feishu/weixin 实现 sendTyping
```

**判定 🔴**：`ChannelAdapter.sendTyping` 接口槽位是**可选方法**，说明 EvoClaw 预留了这个抽象，但 Discord 实现 + per-channel 8s 心跳调度器完全未实现。

---

### §3.11 Voice Channel（VOIP）

**hermes**（`.research/19b-discord.md §3.6`，`discord.py:977-1074 + 83-407`）—— `channel.connect()` → `VoiceClient`；`FFmpegPCMAudio + PCMVolumeTransformer` 播放；`VoiceReceiver` 解密 DAVE E2EE（PyNaCl）、Opus→PCM、per-user 缓冲、>1.5s 静音切片；`PLAYBACK_TIMEOUT=120s`（单次播放）与 `VOICE_TIMEOUT=300s`（频道空闲）两套独立机制。

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "VoiceClient\|FFmpegPCMAudio\|VoiceReceiver\|DAVE\|PyNaCl" packages/core/src/
# 0 命中
```

EvoClaw **完全没有 VOIP 概念**。现有语音能力仅限微信单向发送/接收 SILK 编码消息（`weixin-silk.ts`），不是实时语音频道，无 Opus 解码 / 静音切片 / E2EE 解密。

**判定 🔴**：完全缺失。Discord Voice 涉及独立 UDP 通道 + DAVE E2EE 协议跟踪，工作量非常大（hermes 也承认 DAVE 依赖锁定是风险点）。建议 P2（非必需）。

---

### §3.12 Interaction Views（Button / SelectMenu / Modal）

**hermes**（`.research/19b-discord.md §3.7, §4.8`，`discord.py:2478-2864` → 当前 L2779-3165）—— 三种交互 UI 类：
- **`ExecApprovalView`**：4 按钮 Approve/Deny/Always/Never，`_check_auth(user_id)`、`resolve_gateway_approval`、5min 超时
- **`UpdatePromptView`**：Yes/No 二选一更新提示
- **`ModelPickerView`**：两步 `discord.ui.Select`，先选 provider 再选 model

```python
2478 class ExecApprovalView(discord.ui.View):
2479     def __init__(self, request_id: str, allowed_user_id: int):
2480         super().__init__(timeout=300)
2487     @discord.ui.button(label="Approve", style=discord.ButtonStyle.success)
2488     async def approve(self, interaction, button):
2489         if not await self._check_auth(interaction): return
2490         resolve_gateway_approval(self.request_id, "approve")
```

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "ui.View\|ButtonStyle\|ui.Select\|discord.ui" packages/core/src/
# 0 命中
$ grep -r -i "approval.*button\|model.*picker.*ui" packages/core/src/
# 0 命中
```

EvoClaw 的审批机制（`permissions` 表 + `audit_log` + 7 类别 × 4 作用域）是**后端模型**，没有 IM 端富 UI 组件（只有 Tauri 桌面端审批弹窗）。Model 切换靠 Slash 命令（`/model`）而非两步 Select UI。

**判定 🔴**：完全缺失。Discord Interaction（Button/SelectMenu/Modal）是强原生体验，在 Discord 渠道场景下价值较高（P1）。

---

### §3.13 Rate Limit（全局 + per-route bucket）

**hermes**（`.research/19b-discord.md §5 外部依赖`） —— 依赖 `discord.py` HTTP 客户端内建的全局 + per-route bucket rate limit 处理；429 响应的 `X-RateLimit-Bucket` 自动识别，`Retry-After` 退避。

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "X-RateLimit\|rate_limit_bucket\|Retry-After" packages/core/src/channel/
# 0 命中

# EvoClaw 通用重连退避：
$ cat packages/core/src/channel/channel-manager.ts | grep -A2 "RECONNECT"
const RECONNECT_DELAY_MS = 5_000;
const MAX_RECONNECT_ATTEMPTS = 10;
```

EvoClaw 只有粗粒度的 `RECONNECT_DELAY_MS = 5_000 / MAX_RECONNECT_ATTEMPTS = 10`（`channel-manager.ts:13-14`），不覆盖 Discord 的 per-route bucket。

**判定 🔴**：Discord-specific 完全缺失。若自研 Discord 适配器不复用 `discord.js`，这块是高频隐患。

---

### §3.14 Sharding / Zombied connection resume

**hermes**（`.research/19b-discord.md §3.1, §7 延伸阅读`）—— **未实现 sharding**，单 shard 部署（适合 <2500 guild）。Zombied connection resume 依赖 `discord.py` 内建协议。

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "shard\|AutoShardedBot\|resume_gateway_url" packages/core/src/
# 0 命中
```

**判定 🔴**：连单 shard 都无，遑论多 shard。若未来扩展到大型 Discord bot（>2500 guild），需要从一开始就设计 shard-aware 的 `_voice_clients / _typing_tasks` key 维度。

---

### §3.15 白名单过滤 + `DISCORD_ALLOW_BOTS` 三档

**hermes**（`.research/19b-discord.md §3.2 + §2`，`discord.py:574-591`）—— `DISCORD_ALLOWED_USERS` → `set[int]`，未授权直接 drop；`DISCORD_ALLOW_BOTS` 三档（`none` / `mentions` / `all`）控制是否响应其他 bot，默认 `none` 防 bot loop：

```python
574  async def on_message(self, message: discord.Message) -> None:
575      if message.author.bot:  # + ALLOW_BOTS 三档逻辑
576          return
...
587      if message.author.id not in self._allowed_user_ids:
588          return
```

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "DISCORD_ALLOWED_USERS\|DISCORD_ALLOW_BOTS\|allowed_user_ids" packages/core/src/
# 0 命中
```

EvoClaw 有通用 `NameSecurityPolicy`（allowlist/denylist/disabled，覆盖 Skills + MCP Servers），**但不作用于 IM 平台的 user/channel ID**。现有适配器未做用户白名单过滤（微信靠账号绑定天然隔离）。

**判定 🔴**：完全缺失。Discord 是开放平台，user ID 白名单是安全底线，必须实现。

---

### §3.16 Reactions（👀/✅/❌ 处理进度）

**hermes**（`.research/19b-discord.md §3.8 + ADDENDUM`，`discord.py:743-758`）—— `processing_start → 👀`，`processing_complete → ✅`，错误 → ❌；受 `_reactions_enabled()` / `DISCORD_REACTIONS` 配置开关控制：

```python
744  async def on_processing_start(self, channel_id, msg_id):
745      if not self._reactions_enabled(): return
746      await message.add_reaction("👀")
752  async def on_processing_complete(self, channel_id, msg_id, success):
755      emoji = "✅" if success else "❌"
756      await message.add_reaction(emoji)
```

**EvoClaw 缺失证据**:

```bash
$ grep -r -i "add_reaction\|reactions_enabled" packages/core/src/channel/
# 0 命中
```

现有适配器无 emoji reaction 反馈机制（微信个人号不支持、飞书 API 支持但未接）。

**判定 🔴**：Discord 专属完全缺失。补齐成本低（P2，体验加分项）。

---

## 4. 建议改造蓝图（不承诺实施）

### P0（若承接 Discord 渠道，必做）

1. **直接复用 `discord.js` v14+** 而非自研 WebSocket —— 避免重造 Gateway / Rate Limit / Sharding 轮子（节省 2-3 人周）
   - 新增 `packages/core/src/channel/adapters/discord.ts`，实现 `ChannelAdapter` 接口
   - `ChannelType` 枚举新增 `'discord'`（`packages/shared/src/types/channel.ts:2`）
   - `ChannelConfig.credentials` 扩展 `{ token, intents, allowedUserIds, allowBots }` 字段
2. **Bot Token + Intents 配置链**（§3.1）—— Developer Portal 引导 + privileged intent 校验；工作量 0.5 人周
3. **Gateway 握手 + `_ready_event` 等价物**（§3.2）—— 用 `discord.js Client#once('ready')` 简化；工作量 0.3 人周
4. **消息去重 MessageDeduplicator**（§3.7）—— 新建 `channel/helpers/message-deduplicator.ts` 作为跨渠道复用 helper（未来 Telegram/Slack 也受益）；工作量 0.2 人周
5. **频道分类 + Mention bypass**（§3.5, §3.6）—— `ChannelMessage.chatType` 扩展 `'dm' | 'guild_text' | 'thread' | 'forum_thread'`；Session Key 扩展 `thread:<threadId>` 维度；工作量 0.5 人周

### P1（强体验项）

6. **Slash 命令注册 + Tree.sync**（§3.4）—— 基于现有 `CommandRegistry` 通用分发器，新增 Discord-specific `interaction.response.defer(ephemeral=true)` 适配层；工作量 0.7 人周
7. **Interaction Views（ExecApprovalView + ModelPickerView）**（§3.12）—— 把 EvoClaw 后端 Permission 审批模型接入 Discord Button UI；工作量 1.0 人周
8. **send() 2000 切片 + reply fallback**（§3.8）—— 独立 Discord-specific 常量 `DISCORD_MAX_MESSAGE_LENGTH=2000`；工作量 0.3 人周
9. **Typing 心跳 8s 调度器**（§3.10）—— 复用接口定义 `ChannelAdapter.sendTyping`；工作量 0.3 人周
10. **附件分类 + 媒体下载**（§3.3）—— 与现有微信 CDN 管线解耦，走 Discord HTTPS 直下；工作量 0.5 人周

### P2（加分项，按需）

11. **自动 Thread + Forum topic 继承**（§3.6）—— 涉及 Session Key 重构，建议与 §5 迁移方案联动；工作量 0.7 人周
12. **Native Voice Message (OGG Opus + waveform)**（§3.9）—— 依赖 `mutagen` 或 TS 等价库；工作量 0.5 人周
13. **Reactions 👀/✅/❌**（§3.16）—— 体验加分，工作量 0.2 人周

### 不建议做

14. **Voice Channel VOIP + DAVE E2EE**（§3.11） —— 依赖 Discord 未公开的 DAVE 协议（hermes 延伸阅读已标注风险），EvoClaw 无 VOIP 基础设施，ROI 极低
15. **Sharding**（§3.14）—— 企业内部使用场景 <2500 guild，无需提前优化

### 工作量估算汇总

- P0：~1.5-2 人周（核心能力补齐至 MVP）
- P0+P1：~4-5 人周（与 hermes 基础能力对齐）
- 全量复刻 hermes：~8-10 人周（含 §3.11 Voice 和 Sharding）

---

## 5. EvoClaw 反超点汇总

**直接反超**：无。EvoClaw 的 Discord 渠道完全缺失，谈不上反超。

**可迁移资产**（若承接 Discord 渠道，EvoClaw 现有基础设施可显著加速开发）：

| # | EvoClaw 资产 | 代码证据 | 对 Discord 适配器的增值 |
|---|---|---|---|
| 1 | **通用 Slash 命令系统** | `channel/command/command-dispatcher.ts:12-25` `isSlashCommand / parseSlashCommand / createCommandDispatcher` + `command-registry.ts:10-37` `register/findCommand`（含别名） | Discord `tree.command` 回调把 `interaction.options` 串回 `CommandContext`，立即复用 9 个内置命令（/help /model /status /cost /debug /echo /memory /remember /forget） |
| 2 | **9 个已实现内置命令** | `channel/command/builtin/{cost,debug,echo,forget,help,memory,model,remember,status}.ts` | Discord 首日可直接开放这些命令，减少 Discord 端从 0 构建 |
| 3 | **Session Key 路由** | CLAUDE.md "Session Key 路由" 章 — `agent:<agentId>:<channel>:dm:<peerId>` / `...:group:<groupId>` | 只需扩展 `...:thread:<threadId>` / `...:forum:<forumId>:<threadId>` 维度即可支持 Discord Thread |
| 4 | **ChannelAdapter 统一接口** | `channel/channel-adapter.ts:31-55` | Discord 实现只需满足 `connect/disconnect/onMessage/sendMessage/sendMediaMessage?/sendTyping?/getStatus` 7 方法 |
| 5 | **ChannelManager 重连机制** | `channel/channel-manager.ts:13-14` `RECONNECT_DELAY_MS=5000 / MAX_RECONNECT_ATTEMPTS=10` | 与 `discord.js` 内建重连叠加（外层兜底 + 内层精细） |
| 6 | **Binding Router** | CLAUDE.md "Binding Router" 章 — Channel → Agent 最具体优先匹配 | 支持将不同 Discord Guild/Channel 绑定到不同 Agent，企业多租户场景直接受益 |
| 7 | **NameSecurityPolicy 安全白名单** | CLAUDE.md "扩展安全策略" 章 — allowlist/denylist/disabled，denylist 绝对优先 | 可扩展到 Discord user id / channel id / guild id 白名单（覆盖 §3.15 `DISCORD_ALLOWED_USERS` 能力） |
| 8 | **Skills 生态（30 个 bundled skills）** | `skill/bundled/` 30 个目录 | Discord 用户通过 Slash 命令（如 `/deep-research-pro`）立即调用所有内置技能，这是 hermes 没有对等的能力 |
| 9 | **Markdown→纯文本管线** | `channel/adapters/weixin-markdown.ts`（微信对齐） | 面向 Discord 的 2000 字符切片 + Markdown 渲染重写（Discord **支持** 部分 markdown，策略不同但代码结构可借鉴） |
| 10 | **微信 CDN 媒体管线（可类比）** | `channel/adapters/weixin-cdn.ts / weixin-crypto.ts / weixin-send-media.ts` | 架构模式（下载→本地缓存→转发）可复用，但 Discord 不需要 AES 解密，直接 HTTPS 下载更简单 |
| 11 | **Permission 审批后端 + audit_log** | CLAUDE.md "Permission Model" 章 — 7 类别 × 4 作用域 + 审计日志 | 直接对接 `ExecApprovalView`（§3.12）：按钮点击 → `resolve_gateway_approval` → EvoClaw `permissions` 表写入 |
| 12 | **System Events 队列** | `infrastructure/system-events.ts`（CLAUDE.md "System Events" 章） | Discord Gateway 事件（on_message / on_voice_state_update）可直接入 System Events 队列，复用 chat.ts drainSystemEvents |

**综合结论**: 无明显反超，整体缺失。但 EvoClaw 的通用 slash dispatcher + session key 路由 + binding router + permission 审批后端 + skills 生态，是实现 Discord 适配器的坚实底座，预计能把 hermes 对等工作量从 10 人周压缩到 4-5 人周（P0+P1）。

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（已 Read 验证）

- `packages/core/src/channel/channel-adapter.ts:1-55` —— `ChannelAdapter` 接口定义（7 方法，含可选 `sendTyping` / `sendMediaMessage`）
- `packages/core/src/channel/channel-manager.ts:13-14` —— `RECONNECT_DELAY_MS=5_000 / MAX_RECONNECT_ATTEMPTS=10` 通用重连常量
- `packages/core/src/channel/channel-manager.ts:20-73` —— `ChannelManager` 类 `registerAdapter/connect/disconnect`，**无 Discord 分支**
- `packages/core/src/channel/command/command-dispatcher.ts:12-25` —— `isSlashCommand / parseSlashCommand` 通用 slash 解析
- `packages/core/src/channel/command/command-dispatcher.ts:28-62` —— `createCommandDispatcher` 注册表 + 技能 fallback 两级分发
- `packages/core/src/channel/command/command-registry.ts:10-37` —— `CommandRegistry.register / findCommand / listCommands`
- `packages/core/src/channel/message-normalizer.ts:8-173` —— 4 个渠道的 `normalize*Message` 函数（feishu / wecom / weixin / desktop），**无 Discord**
- `packages/shared/src/types/channel.ts:2` —— `ChannelType = 'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq' | 'weixin'`（**6 种，无 Discord**）
- `packages/shared/src/__tests__/types.test.ts:275-276` —— 测试断言 "ChannelType 应包含 5 种通道"（注：测试写的是 5 种，实际类型已加 weixin 为 6 种）
- `packages/core/src/channel/adapters/` 目录下 16 个 ts 文件：`desktop.ts / feishu.ts / wecom.ts / weixin.ts / weixin-silk.ts / weixin-api.ts / weixin-cdn.ts / weixin-crypto.ts / weixin-debug.ts / weixin-error-notice.ts / weixin-markdown.ts / weixin-mime.ts / weixin-redact.ts / weixin-send-media.ts / weixin-types.ts / weixin-upload.ts`（**无 discord.ts**）

### 6.2 hermes 研究引用

本文所有 hermes 声称均来自 `/Users/mac/src/github/hermes-agent/.research/19b-discord.md` 以下小节：
- §1 角色与定位 / §2 数据结构 / §3.1-3.8 关键函数流程 / §4.1-4.8 代码片段 / §5 交互依赖 / §6 复刻清单 / §7 延伸阅读 / ADDENDUM @ 00ff9a26（MessageDeduplicator / ThreadParticipationTracker / TextBatchAggregator helpers + `/animation` 新 slash 命令 + channel_prompts 配置）

### 6.3 关联差距章节（crosslink）

- [`19-gateway-platforms-gap.md`](./19-gateway-platforms-gap.md)（同批 Wave） —— Gateway 层总览差距，阐述 hermes 统一 `BasePlatformAdapter` 抽象与 EvoClaw `ChannelAdapter` 接口的对比
- [`19a-telegram-gap.md`](./19a-telegram-gap.md)（同批 Wave） —— Telegram 渠道差距（同样大概率整体缺失，对照 Discord 梳理国际 IM 空白）
- `19c-slack-gap.md`（后续 Wave） —— Slack 渠道差距（企业 IM 场景，与 Discord 同属"富交互组件"类平台）
- `19d-signal-gap.md` / `19e-matrix-gap.md` / `19f-whatsapp-gap.md`（后续 Wave） —— 其余国际平台差距
- [`29-security-approval-gap.md`](./29-security-approval-gap.md)（后续 Wave） —— hermes 审批模型 + ExecApprovalView，对应 EvoClaw Permission Model 后端；Discord 适配器补齐将强依赖此章
- [`14-state-sessions-gap.md`](./14-state-sessions-gap.md)（已完成） —— Session Key 路由 + Binding Router 通用能力，是 Discord Thread 维度扩展的基础

---

**文档状态**: Wave 3 并行草稿，EvoClaw 整体缺失，已记录 16 项机制零覆盖证据 + 12 项可迁移资产。建议此章在后续规划中降格为 P2（非当前 Sprint 16 范围）。
