# 19a — Telegram 渠道集成 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/19a-telegram.md`（Hermes `TelegramAdapter` 2879 行 + `telegram_network.py` 246 行，drift audit @ `00ff9a26` 2026-04-16）
> **hermes 基线**: commit `00ff9a26`（2026-04-16）
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16）
> **综合判定**: 🔴 **整体缺失**（无任何 Telegram 适配器代码，但 ChannelAdapter 抽象 / BindingRouter / SessionKey 等通用渠道架构可迁移）

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes `TelegramAdapter`**（`gateway/platforms/telegram.py:120-2879` + `telegram_network.py:1-246`） — Hermes Gateway 最成熟最庞大的平台适配器（~2879 行），基于 `python-telegram-bot v20+` 的高层 `Application` 框架封装 Telegram Bot API（非 MTProto）。承担入站 `Update` 分发（TEXT/COMMAND/LOCATION/PHOTO/VIDEO/AUDIO/VOICE/Document/Sticker/CallbackQuery）、出站 Markdown**V2 12 步转义管道、媒体组 0.8s 聚合、文本连发 0.6s 聚合、流式 `edit_message` 节流、4096 字符分块（含 UTF-16 计量）、DM Topics 论坛话题隔离、反应表情进度提示、Inline 键盘审批/模型选择、Webhook/Long-Polling 双模切换、分布式 token 锁、以及通过自定义 `httpx` Transport 做 DoH DNS 故障转移（被墙网络保活）。

**EvoClaw Telegram 渠道**（不存在） — `packages/core/src/channel/adapters/` 下只有 `desktop.ts / feishu.ts / wecom.ts / weixin*.ts`；`packages/shared/src/types/channel.ts:2` 声明的 `ChannelType = 'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq' | 'weixin'` **不包含 telegram**。仓库中 telegram 关键字仅出现在：`permission-interceptor.ts:46` 的 `MESSAGE_TOOLS` 白名单字符串 `'telegram_send'`（占位、无实现）、`binding-router.ts:7` 的注释示例、以及两份单元测试中作为字符串 fixture。综上，**EvoClaw 当前无任何 Telegram Bot API 调用代码、无消息解析、无 webhook/polling、无媒体管线**。

**量级对比**: hermes 单 Telegram 适配器（2879 行）≈ EvoClaw 全部渠道适配器总和（`/packages/core/src/channel/adapters/*.ts` 共 3207 行，其中 16 个文件覆盖 weixin/wecom/feishu/desktop 四类）。Hermes 在 Telegram 一条渠道上投入的工程量 ≈ EvoClaw 在所有国内渠道的总投入。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 认证模型（Bot Token） | 🔴 | grep 零结果；无 TELEGRAM_BOT_TOKEN 读取/token 锁 |
| §3.2 | 消息接收（Long Polling / Webhook 双模） | 🔴 | grep 零结果；无 getUpdates / run_webhook / _looks_like_polling_conflict |
| §3.3 | Handler 分发（TEXT/COMMAND/MEDIA/CALLBACK） | 🔴 | grep 零结果；无 filter 注册、无 CallbackQueryHandler |
| §3.4 | 消息类型（text/photo/document/voice/video/sticker/location） | 🔴 | grep 零结果；无 _handle_media_message / photo[-1].get_file |
| §3.5 | Inline Keyboard / Callback Query | 🔴 | grep 零结果；无 ReplyMarkup / callback_data 编解码 |
| §3.6 | 命令处理（/start /help） | 🔴 | grep 零结果；无 CommandHandler；EvoClaw 仅 weixin 有 /echo /toggle-debug Slash |
| §3.7 | 群组 vs 私聊（mention/reply 策略） | 🔴 | grep 零结果；无 _should_respond_in_group / _is_reply_to_bot / @username 识别 |
| §3.8 | 媒体下载 / 上传 | 🔴 | grep 零结果；无 Bot File API 调用 |
| §3.9 | 流式 edit_message + 4096 分块（UTF-16 计量） | 🔴 | grep 零结果；无 edit_message / truncate_message / utf16_len |
| §3.10 | Rate Limit / 退避（RetryAfter / flood control） | 🔴 | grep 零结果；无针对 429 RetryAfter 的专项退避逻辑 |
| §3.11 | Parse Mode（MarkdownV2 12 步 + 降级） | 🔴 | grep 零结果；无 MarkdownV2 转义管道；EvoClaw 仅 weixin Markdown→纯文本 |
| §3.12 | 错误处理（401/429/500 / BadRequest 降级） | 🔴 | grep 零结果；无 Telegram 错误码分类 |
| §3.13 | 网络保活 / DNS 故障转移 | 🔴 | grep 零结果；无 DoH fallback / 粘性 IP / 备用 IP 池 |
| §3.14 | DM Topics / 反应表情 / 进度反馈 | 🔴 | grep 零结果；无 forum topic / set_message_reaction |

**统计**: 🔴 14 / 🟡 0 / 🟢 0 — 本章节机制全部缺失。可迁移资产见 §5。

---

## 3. 机制逐条深度对比

### §3.1 认证模型（Bot Token）

**hermes**（`gateway/platforms/telegram.py:138` 构造器，依赖 `TELEGRAM_WEBHOOK_URL` / `TELEGRAM_ALLOWED_USERS` / 自定义 extra 字段）:
> 引用 `.research/19a-telegram.md §2 关键配置项` 与 §2 `_token_lock_identity` 字段——Bot Token 由 `PlatformConfig` 注入 `telegram.ext.Application`，构造期在 `_token_lock_identity` 上获取分布式锁（`acquire_scoped_lock` L497-512）防多实例抢占同一 bot 导致 `getUpdates` 409 Conflict。

```python
# gateway/platforms/telegram.py:138（__init__）
self._app: Application = ApplicationBuilder().token(config.token).request(httpx_request).build()
self._bot: Bot = self._app.bot
self._token_lock_identity = f"telegram:{sha256(config.token).hexdigest()[:16]}"
```

**EvoClaw**（缺失证据）:
```bash
$ grep -r -i "telegram" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/ --include="*.ts" -l
packages/core/src/tools/permission-interceptor.ts        # 仅 MESSAGE_TOOLS 字符串 'telegram_send'（占位）
packages/core/src/routing/binding-router.ts              # 仅注释 "e.g., 'wechat', 'telegram', 'default'"
packages/core/src/__tests__/session-key.test.ts          # 仅 fixture
packages/core/src/__tests__/binding-router.test.ts       # 仅 fixture

$ grep -r "TELEGRAM_BOT_TOKEN\|telegram.*token\|Bot(" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
`ChannelType` 定义于 `packages/shared/src/types/channel.ts:2`：`'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq' | 'weixin'` —— 无 `telegram`。

**判定 🔴**：完全缺失。Bot Token 接入需从零搭建（Keychain 凭据管理 EvoClaw 已具备，可复用，但 Telegram 特有的 token 锁/409 Conflict 识别需新建）。

---

### §3.2 消息接收（Long Polling / Webhook 双模）

**hermes**（`.research/19a-telegram.md §3.5`）:
- `TELEGRAM_WEBHOOK_URL` 存在 → `Application.run_webhook()` 注册 HTTP 路由；否则 → `Application.start_polling()`。
- `_looks_like_polling_conflict`（L167）检测 409 Conflict（另一实例占用同一 token）→ 抛 fatal error 退出，避免双消费。
```python
# gateway/platforms/telegram.py:580-634
if self._webhook_mode:
    await self._app.run_webhook(listen="0.0.0.0", port=self._port,
                                 url_path=self._webhook_path,
                                 webhook_url=self._webhook_url)
else:
    await self._app.start_polling(drop_pending_updates=False, error_callback=self._on_poll_error)
```

**EvoClaw**（缺失证据）:
```bash
$ grep -r "getUpdates\|run_webhook\|start_polling\|long.poll" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
类比：`packages/core/src/channel/adapters/weixin.ts`（529 行）实现 iLink Bot **长轮询**，说明 EvoClaw 具备长轮询工程模板，但无 Telegram Bot API 的 long polling（getUpdates offset）或 webhook 注册实现。

**判定 🔴**：完全缺失。长轮询工程范式可借鉴 weixin 适配器，但 Telegram 的 offset cursor 管理、drop_pending_updates 语义、409 Conflict 侦测均须新建。

---

### §3.3 Handler 分发（TEXT/COMMAND/MEDIA/CALLBACK）

**hermes**（`.research/19a-telegram.md §2 Handler 注册表` + §4 片段 2，`gateway/platforms/telegram.py:2200/2216/2385/1457`）:
```python
self._app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, self._handle_text_message))   # L2200
self._app.add_handler(MessageHandler(filters.COMMAND, self._handle_command))                        # L2216
self._app.add_handler(MessageHandler(filters.LOCATION, self._handle_location_message))
self._app.add_handler(MessageHandler(
    filters.PHOTO | filters.VIDEO | filters.AUDIO | filters.VOICE |
    filters.Document.ALL | filters.Sticker.ALL,
    self._handle_media_message))                                                                     # L2385
self._app.add_handler(CallbackQueryHandler(self._handle_callback_query))                            # L1457
```

**EvoClaw**（缺失证据）:
```bash
$ grep -r "CallbackQueryHandler\|MessageHandler\|InlineQueryHandler" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
类比：EvoClaw 渠道的消息入站统一由 `packages/core/src/channel/message-normalizer.ts` 的 `normalizeWecomMessage` / `normalizeFeishuMessage` 等纯函数归一化为 `ChannelMessage`，但没有针对 Telegram `Update` 结构的分发。

**判定 🔴**：完全缺失。需新建 Telegram 特有的 5 类 Handler（文本/命令/位置/媒体/Callback）。

---

### §3.4 消息类型（text / photo / document / voice / video / sticker / location）

**hermes**（`.research/19a-telegram.md §3.1` + §4 片段 5，`gateway/platforms/telegram.py:2425-2462`）:
```python
# 媒体下载
photo = message.photo[-1]                        # 取最高分辨率
tg_file = await photo.get_file()
data = await tg_file.download_as_bytearray()
cached_path = cache_image_from_bytes(bytes(data), suffix=".jpg")

# 媒体组聚合（0.8s 窗口）
self._pending_photo_batches[media_group_id].append(...)
await asyncio.wait_for(self._media_group_events[media_group_id].wait(), timeout=0.8)
```
入站 `chat_type`：PRIVATE→"dm"、GROUP/SUPERGROUP→"group"、CHANNEL→"channel"（L2749，`_build_message_event`）。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "photo\[-1\]\|get_file\|download_as_bytearray\|media_group" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
类比：`packages/core/src/channel/adapters/weixin-cdn.ts`（159 行）+ `weixin-crypto.ts`（91 行）处理微信 CDN 媒体 AES-128-ECB 解密，展示了 EvoClaw 具备媒体管线的工程能力；但 Telegram Bot File API（`getFile` → `https://api.telegram.org/file/bot<token>/<file_path>`）的拉取链路完全未实现。

**判定 🔴**：完全缺失。7 种消息类型的解析与下发零覆盖。

---

### §3.5 Inline Keyboard / Callback Query

**hermes**（`.research/19a-telegram.md §5 tools/approval / tools/model_picker` + `gateway/platforms/telegram.py:1093, 1161, 1457`）:
- `send_exec_approval()`（L1093）下发 Inline 键盘，callback_data 形如 `ea:choice:id`，特殊字符须 `_escape_mdv2()` 转义（修复 commit `06d6903d`）。
- `send_model_picker()`（L1161）下发 `mp:slug` / `mm:index` 键盘切换模型。
- `_handle_callback_query`（L1457）解析 callback_data → 路由到对应业务。
- `_is_callback_user_authorized()`（L173）强制校验回调调用者在 `TELEGRAM_ALLOWED_USERS` 白名单内（commit `aea3499e` 系列引入）。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "inline_keyboard\|callback_data\|ReplyMarkup\|InlineKeyboard" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
类比：EvoClaw 的权限审批机制由 `packages/core/src/tools/permission-interceptor.ts`（见 `MESSAGE_TOOLS`/`SAFE_BINS` 等常量）+ 前端 Desktop UI 完成；但**没有**"通过 IM 聊天内按钮完成审批"的路径——面向企业 IM 渠道的带外审批 UX 空白。

**判定 🔴**：完全缺失。Inline 键盘 + Callback 授权白名单是 Hermes Telegram 独特的交互形态，EvoClaw 当前 Desktop-centric 设计未覆盖。

---

### §3.6 命令处理（/start /help 等 Slash 命令）

**hermes**（`gateway/platforms/telegram.py:2216` `_handle_command`）:
```python
self._app.add_handler(MessageHandler(filters.COMMAND, self._handle_command))
# 按 command text 分派到 /start /help /model /reset 等
```

**EvoClaw**（缺失证据）:
```bash
$ grep -r "/start\|/help\|CommandHandler" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/channel/
# 零结果（仅 weixin 有 /echo 和 /toggle-debug — 见 CLAUDE.md weixin 段）
```
类比：`CLAUDE.md` 微信段声明 `"/echo + /toggle-debug Slash 命令"` 已实现，模式可迁移。

**判定 🔴**：Telegram 专项缺失。有微信 Slash 命令派发模式可借鉴。

---

### §3.7 群组 vs 私聊（mention / reply 策略）

**hermes**（`.research/19a-telegram.md §4 片段 4`，`gateway/platforms/telegram.py:2052-2076`）:
```python
if self._reply_to_mode == "mention":
    if self._is_reply_to_bot(message):       # L2115
        return True
    if f"@{self._bot_username}" in text:     # L2005 基线
        return True
    for pat in self._mention_patterns:       # L2070 _compile_mention_patterns
        if pat.search(text):
            return True
    return chat_id in self._free_response_chats
```
环境变量：`TELEGRAM_REQUIRE_MENTION` / `TELEGRAM_FREE_RESPONSE_CHATS` / `TELEGRAM_MENTION_PATTERNS`。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "REQUIRE_MENTION\|mention_pattern\|is_reply_to_bot" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
类比：`packages/core/src/channel/message-normalizer.ts:8-41` `normalizeFeishuMessage` 已区分 `chat_type === 'p2p' ? 'private' : 'group'`，具备 chatType 分流模板，但没有 mention 识别 / 回复引用判定。

**判定 🔴**：Telegram 专项缺失。chatType 抽象可复用，mention 语义需从零实现。

---

### §3.8 媒体下载 / 上传

**hermes**（`.research/19a-telegram.md §3.2`，`gateway/platforms/telegram.py:1561-1777`）:
- 6 个出站媒体方法：`send_voice (L1477 基线)`、`send_image_file (L1526)`、`send_document (L1563)`、`send_video (L1598)`、`send_image (L1629)`、`send_animation (L1693)`。
- 入站走 `file.download_as_bytearray()` → `cache_image_from_bytes` → 交给 Agent / VLM。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "sendPhoto\|sendDocument\|sendVoice\|sendVideo\|sendAnimation" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
类比：`packages/core/src/channel/adapters/weixin-upload.ts`（237 行）+ `weixin-send-media.ts`（217 行）完整实现微信媒体上传管线，工程模板成熟；但 Telegram `multipart/form-data` 上传 + `file_id` 复用策略需新建。

**判定 🔴**：完全缺失。

---

### §3.9 流式 edit_message + 4096 分块（UTF-16 计量）

**hermes**（`.research/19a-telegram.md §3.4 流式输出策略` + Addendum §C）:
```python
# gateway/platforms/telegram.py:838-849（send 分块）
chunks = truncate_message(formatted, limit=4096, len_fn=utf16_len)   # UTF-16 计量避免 CJK 超长
for i, chunk in enumerate(chunks):
    await self._bot.send_message(chat_id, f"{chunk}\n({i+1}/{len(chunks)})",
                                 parse_mode=ParseMode.MARKDOWN_V2)

# edit_message (L976)：流式覆盖最近消息
# 处理 "Bad Request: message is not modified" 视为成功
# 处理 message_too_long 触发截断
# 处理 RetryAfter（flood control）指数退避重试
```

**EvoClaw**（缺失证据）:
```bash
$ grep -r "edit_message\|editMessageText\|utf16_len\|truncate.*4096" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
类比：EvoClaw Sidecar 通过 SSE 向前端流式输出（`packages/core/src/routes/chat.ts`），但**没有向 IM 渠道的流式 edit**——所有渠道（weixin/wecom/feishu）都是"一次性发送"的非流式。即使补齐 Telegram，流式编辑也需跨渠道统一设计。

**判定 🔴**：完全缺失，且**跨渠道统一的流式编辑**是 EvoClaw 架构未覆盖的维度。

---

### §3.10 Rate Limit / 退避（RetryAfter / flood control）

**hermes**（`.research/19a-telegram.md §3.2 edit_message`）:
- Telegram API 全局 30 msg/s、单聊 1 msg/s、群聊 20 msg/min。
- `RetryAfter`（PTB 异常）→ 指数退避重试；flood control 错误不 fatal。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "RetryAfter\|flood.*control\|telegram.*rate" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```

**判定 🔴**：完全缺失。EvoClaw 已具备通用重试框架（`packages/core/src/agent/kernel/` retry 路径），但未为 IM 渠道的 rate limit 做专项退避。

---

### §3.11 Parse Mode（MarkdownV2 12 步管道 + 降级）

**hermes**（`.research/19a-telegram.md §3.3` + §4 片段 6，`gateway/platforms/telegram.py:1862-2024` `format_message`）:
12 步转义流水线：提取代码块占位 → 内联代码占位 → 链接转换 → 标题转粗体 → `**bold**→*bold*` → italic → strike → spoiler → blockquote → MarkdownV2 保留字转义 `_*[]()~``>#+-=|{}.!` → 还原占位。降级策略：
```python
# gateway/platforms/telegram.py:838-849
try:
    await self._bot.send_message(chat_id, formatted, parse_mode=ParseMode.MARKDOWN_V2)
except BadRequest as e:
    logger.warning("MarkdownV2 parse failed, falling back to plain text: %s", e)
    await self._bot.send_message(chat_id, plain_text)
```

**EvoClaw**（缺失证据）:
```bash
$ grep -r "MarkdownV2\|MARKDOWN_V2\|escape_mdv2" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
类比：`packages/core/src/channel/adapters/weixin-markdown.ts`（80 行）实现"Markdown→纯文本"降级，思路方向一致但目标管道（MarkdownV2 保留字转义）完全不同。

**判定 🔴**：完全缺失。weixin-markdown.ts 仅做纯文本降级，MarkdownV2 12 步管道需全新编写。

---

### §3.12 错误处理（401 / 429 / 500 / BadRequest 降级）

**hermes**（隐含于 §3.2 `edit_message` 与 §3.1 `_handle_media_message`）:
- `Unauthorized` (401 Invalid Token) → fatal；
- `BadRequest: message is not modified` → 视为成功；
- `BadRequest: message_too_long` → 触发截断重发；
- `RetryAfter` / flood control → 退避重试；
- 5xx → httpx 层由 `TelegramFallbackTransport` 做 IP 轮转。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "Unauthorized.*telegram\|BadRequest.*not.modified" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```

**判定 🔴**：完全缺失。EvoClaw 通用 HTTP 错误处理（`packages/core/src/infrastructure/` 下）不针对 Telegram 错误码语义。

---

### §3.13 网络保活 / DNS 故障转移（telegram_network.py）

**hermes**（`.research/19a-telegram.md §3.7` + §4 片段 8，`gateway/platforms/telegram_network.py:185`）:
```python
async def discover_fallback_ips() -> list[str]:
    ips = []
    for doh in ("https://dns.google/resolve", "https://cloudflare-dns.com/dns-query"):
        ips += await _query_doh(doh, "api.telegram.org")
    return ips or ["149.154.167.220"]   # 种子 IP 冷启动兜底
```
`TelegramFallbackTransport(httpx.AsyncBaseTransport)` 包装 PTB 的 httpx：维护"粘性 IP"`last_working`，命中失败再轮转。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "DoH\|fallback_ips\|dns.google/resolve\|cloudflare-dns" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```

**判定 🔴**：完全缺失。该特性是 hermes 针对"被墙网络"的独特能力，EvoClaw 目前无此需求（国内渠道为主），但一旦对接 Telegram，在国内网络下必不可少。

---

### §3.14 DM Topics / 反应表情 / 进度反馈

**hermes**（`.research/19a-telegram.md §3.6` + §4 片段 7，`gateway/platforms/telegram.py:2855-2879`）:
- `_create_dm_topic`：启用 `config.extra.dm_topics` 后，每个外部用户在 admin 群内创建 forum topic（Bot API 9.4+），管理员集中视图 + Agent 按 user 隔离。
- `_telegram_ignored_threads()`（L2049，NEW in Addendum）：过滤不需监听的 forum thread_id。
- 反应表情进度反馈：
```python
async def on_processing_start(self, event):
    await self._bot.set_message_reaction(chat_id, msg_id, reaction=[ReactionTypeEmoji("👀")])
async def on_processing_complete(self, event, outcome: ProcessingOutcome):   # 签名变更 (0e315a6f)
    emoji = {"SUCCESS": "✅", "FAILURE": "❌"}.get(outcome.name)
    if outcome.name != "CANCELLED":
        await self._set_reaction(chat_id, msg_id, emoji)
```

**EvoClaw**（缺失证据）:
```bash
$ grep -r "setMessageReaction\|forum.*topic\|ReactionTypeEmoji\|dm_topics" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```

**判定 🔴**：完全缺失。这三项是 Telegram Bot API 独有能力，无可迁移模板。

---

## 4. 建议改造蓝图（不承诺实施）

> 前提：仅当产品决策明确"面向出海 / 国际企业用户"时才启动；当前 EvoClaw 定位"企业级国内用户"，Telegram 优先级本身需先确认。

### P0（必须，启动 Telegram 渠道即须覆盖） — 预计 1.5-2 人周

| 项 | 范围 | 工作量 | ROI |
|---|---|---|---|
| P0-1 | 扩展 `ChannelType` 加 `'telegram'`（`packages/shared/src/types/channel.ts`），新建 `packages/core/src/channel/adapters/telegram.ts` 骨架，实现 `ChannelAdapter` 接口 | 0.5d | ★★★ 架构入口 |
| P0-2 | Long Polling（getUpdates with offset）+ Bot Token + 基础文本收发；参考 weixin.ts 长轮询范式 | 2d | ★★★ 跑通基础链路 |
| P0-3 | 消息 normalizer（Telegram Update → ChannelMessage），覆盖 text / photo / document / voice / video / sticker / location | 2d | ★★★ 入站归一化 |
| P0-4 | MarkdownV2 12 步转义管道 + 降级为纯文本（移植 hermes `format_message`） | 1.5d | ★★★ 无此用户体验不可接受 |
| P0-5 | 4096 字符分块（UTF-16 计量）+ 分段 `(i/N)` 后缀 | 0.5d | ★★ CJK 场景必需 |
| P0-6 | 群组 mention / reply 判定 `_should_respond_in_group` + `TELEGRAM_REQUIRE_MENTION` 配置 | 1d | ★★★ 群聊必需 |
| P0-7 | 命令 `/start` `/help` `/reset` 处理骨架 | 0.5d | ★★ |
| P0-8 | Rate Limit / RetryAfter 指数退避（复用 EvoClaw retry 框架，新增 Telegram 错误映射） | 1d | ★★★ |

### P1（强推荐，进入生产前补齐） — 预计 1-1.5 人周

| 项 | 范围 | 工作量 | ROI |
|---|---|---|---|
| P1-1 | Webhook 模式（可选）+ 409 Conflict 检测 | 2d | ★★ 高并发部署必需 |
| P1-2 | Inline Keyboard + Callback Query + 回调用户白名单（权限审批 IM UX） | 2d | ★★★ 打通 Telegram 内审批闭环 |
| P1-3 | 流式 `editMessageText`（跨渠道统一的流式编辑抽象，一并提升 weixin/wecom/feishu） | 3d | ★★★ 用户可感知体验飞跃 |
| P1-4 | 媒体出站（sendPhoto / sendDocument / sendVoice / sendVideo / sendAnimation） | 2d | ★★ |
| P1-5 | 反应表情进度提示 `set_message_reaction` | 0.5d | ★ 精致化体验 |
| P1-6 | 媒体组 / 文本连发 聚合窗口（0.8s / 0.6s） | 1d | ★★ 长消息场景稳定性 |

### P2（选做）

| 项 | 范围 | 工作量 | ROI |
|---|---|---|---|
| P2-1 | DoH DNS 故障转移 + 粘性 IP + 种子 IP（被墙环境保活） | 2d | ★ 仅在"大陆直连 Telegram"场景有价值；多数用户走代理，投产价值低 |
| P2-2 | DM Topics 论坛话题隔离 | 2d | ★ 企业客服场景有价值，先看产品是否启用 |
| P2-3 | `channel_prompts` 按频道映射系统提示 | 0.5d | ★ 多租户 Telegram bot 场景 |

### 不建议做

- **MTProto（Pyrogram / Telethon 等）**：hermes 也只用 Bot API。MTProto 要求上传个人账号凭证，合规风险高。

---

## 5. EvoClaw 反超点汇总

> **本章节 EvoClaw 无明显反超（整体缺失）**；以下为**可迁移资产**——EvoClaw 已有的通用能力在补齐 Telegram 时可直接复用，从而缩短工期。

| 可迁移资产 | 代码证据 | 迁移到 Telegram 的价值 |
|---|---|---|
| **`ChannelAdapter` 统一抽象** | `packages/core/src/channel/channel-adapter.ts:31-55`（9 个方法的接口），`channel-manager.ts:20-60` 注册/重连机制 | 新 `TelegramAdapter` 实现该接口即无缝接入 ChannelManager / 自动重连 / 全局消息回调。Hermes `BasePlatformAdapter` 21 项复刻清单中约 10 项可由 EvoClaw 抽象天然覆盖 |
| **Session Key 多层路由** | `packages/core/src/__tests__/session-key.test.ts:22-63` 已有 `'agent:agent-1:telegram:direct:'` 会话键格式测试（虽无实现，但类型已就位） | Telegram DM / group / channel / topic 的会话隔离可直接套用 `agent:<id>:telegram:<direct\|group>:<peerId>` 格式 |
| **BindingRouter 精确优先匹配** | `packages/core/src/routing/binding-router.ts:63-80`（peerId > accountId+channel > channel > 默认） | Telegram 用户/群/频道 → Agent 绑定逻辑无需新建 |
| **长轮询工程模板** | `packages/core/src/channel/adapters/weixin.ts`（529 行，iLink Bot long polling） | Telegram `getUpdates` offset 循环 + 错误恢复的代码结构可 1:1 参考 |
| **媒体管线模板** | `weixin-upload.ts:237` + `weixin-send-media.ts:217` + `weixin-cdn.ts:159` + `weixin-crypto.ts:91` + `weixin-mime.ts:98` | Telegram Bot File API（上传 multipart、下载 file_path）可复用 MIME 识别 / 大文件分片 / 持久化缓存逻辑 |
| **Markdown 降级器模板** | `weixin-markdown.ts:80`（Markdown → 纯文本） | MarkdownV2 解析失败的 fallback 路径已有现成思路 |
| **Debug 追踪模板** | `weixin-debug.ts:84` 全链路 debug 记录 | Telegram `/echo` `/toggle-debug` 模式可直接复制 |
| **PII 脱敏** | `weixin-redact.ts:60` + `packages/core/src/infrastructure/logger.ts` 中的 `sanitizePII()` | Telegram 日志中的 Bot Token、用户 ID、chat_id 可自动脱敏 |
| **Slash 命令派发** | weixin 的 `/echo` / `/toggle-debug` | Telegram `/start` `/help` `/reset` 派发结构同形 |
| **通用重试框架** | `packages/core/src/agent/kernel/` 下的 retry / fallback 能力（05-agent-loop-gap.md §3.6 记录） | `RetryAfter` 退避可包装进现有重试框架 |

**结论**：EvoClaw 在"国内渠道"上积累的工程资产（长轮询、媒体管线、debug、markdown 降级、session key、binding）**显著降低** Telegram 适配器的构建成本。乐观估计 P0+P1 总工期可从"从零 3.5 人周"压缩到"2.5 人周"。

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（已 Read 验证）

1. `packages/core/src/channel/adapters/` 目录列表（Bash `ls` 验证）：仅含 `desktop.ts / feishu.ts / wecom.ts / weixin-*.ts`，**无 `telegram.ts`**。
2. `packages/shared/src/types/channel.ts:2` — `ChannelType = 'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq' | 'weixin'` — **无 `'telegram'`**。
3. `packages/core/src/tools/permission-interceptor.ts:46` — `'slack_send', 'telegram_send', 'wechat_send'`（MESSAGE_TOOLS 字符串常量，**无对应工具实现**）。
4. `packages/core/src/routing/binding-router.ts:7` — 注释 `// e.g., 'wechat', 'telegram', 'default'`（纯注释）。
5. `packages/core/src/__tests__/session-key.test.ts:22-63` — 使用 `'telegram'` 作为字符串 fixture，无运行时实现。
6. `packages/core/src/__tests__/binding-router.test.ts:90,98,163` — 同上，仅 fixture。
7. `packages/core/src/channel/channel-adapter.ts:31-55` — `ChannelAdapter` 接口定义（可迁移基础）。
8. `packages/core/src/channel/channel-manager.ts:20-60` — `ChannelManager` 生命周期与重连机制。
9. `packages/core/src/channel/message-normalizer.ts:8-41` — `normalizeFeishuMessage` chatType 分流模板。
10. `packages/core/src/channel/adapters/wecom.ts:26` — `class WecomAdapter implements ChannelAdapter` 参考实现。
11. `packages/core/src/channel/adapters/weixin.ts`（529 行）— 最复杂的现有渠道，长轮询 + CDN 媒体 + Slash 命令全栈参考。
12. grep `-r -i "telegram"` 总命中 4 个 TS 文件（permission-interceptor / binding-router / 两个测试），**零生产代码命中**。
13. grep `"getUpdates\|run_webhook\|start_polling\|CallbackQueryHandler\|MarkdownV2\|MARKDOWN_V2"` — 全部零结果。
14. grep `"DoH\|fallback_ips\|cloudflare-dns"` — 零结果（DoH 网络保活能力缺失）。
15. grep `"setMessageReaction\|forum.*topic\|dm_topics"` — 零结果（DM Topics / 反应表情缺失）。

### 6.2 hermes 研究引用（章节 §）

- `.research/19a-telegram.md §1` 角色与定位（2727 行基线 / 2879 行 audit 后）
- `.research/19a-telegram.md §2` 数据结构（TelegramAdapter 构造器 L138 / Handler 注册表 L2200-2385 / 环境变量）
- `.research/19a-telegram.md §3.1` 入站消息处理流程
- `.research/19a-telegram.md §3.2` 出站 `send` / `edit_message` / 媒体方法（L821+, L976+, L1561-1777）
- `.research/19a-telegram.md §3.3` MarkdownV2 12 步转义管道（L1862-2024）
- `.research/19a-telegram.md §3.4` 流式输出策略（0.6s 节流 + 4096 分块）
- `.research/19a-telegram.md §3.5` Webhook vs Long-Polling（L580-634 基线）
- `.research/19a-telegram.md §3.6` DM Topics（L312-404）
- `.research/19a-telegram.md §3.7` `telegram_network.py` DNS 故障转移（L185）
- `.research/19a-telegram.md §4` 代码片段 1-8
- `.research/19a-telegram.md §5` 与 tools/approval、tools/model_picker、image_cache 交互
- `.research/19a-telegram.md §6` 21 项 `BasePlatformAdapter` 复刻清单
- `.research/19a-telegram.md §Addendum` drift audit @ `00ff9a26` 新增 6 函数 / 3 字段 / 6 主题语义变化（链接预览、UTF-16、反应表情、MarkdownV2 修复、新配置、基础设施）

### 6.3 关联差距章节（crosslink）

- **[`./19-gateway-platforms-gap.md`](./19-gateway-platforms-gap.md)**（同批，总览）— Gateway 平台适配器架构对比 / `BasePlatformAdapter` vs `ChannelAdapter`
- **[`./19b-discord-gap.md`](./19b-discord-gap.md)**（同批）— Discord 适配器，与 Telegram 同为"出海国际平台"，架构相似度高
- **[`./19c-slack-gap.md`](./19c-slack-gap.md)**（未来）— Slack 企业 IM，Inline Keyboard 模式可互借
- **[`./19d-signal-gap.md`](./19d-signal-gap.md)**（未来）— Signal 端到端加密 IM
- **[`./19e-matrix-gap.md`](./19e-matrix-gap.md)**（未来）— Matrix 联邦化 IM
- **[`./19f-whatsapp-gap.md`](./19f-whatsapp-gap.md)**（未来）— WhatsApp Business API
- **[`./05-agent-loop-gap.md`](./05-agent-loop-gap.md) §3.6** — Retry / Fallback 框架（Telegram RetryAfter 可接入）
- **[`./29-security-approval-gap.md`](./29-security-approval-gap.md)**（未来）— 审批系统与 Inline Keyboard 交互点
