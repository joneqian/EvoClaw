# 19d — Signal 渠道集成 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/19d-signal.md`（Hermes `SignalAdapter` 876 行 → drift audit @ `00ff9a26` 后 825 行）
> **hermes 基线**: commit `00ff9a26`（2026-04-16）
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16）
> **综合判定**: 🔴 **整体缺失**（无任何 Signal Messenger 相关代码；但 `ChannelAdapter` 抽象 / `BindingRouter` / `SessionKey` / 媒体管线 / PII 脱敏 等通用渠道架构可部分迁移）

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes `SignalAdapter`**（`gateway/platforms/signal.py:1-876` → audit 后 825 行） — 通过外部 `signal-cli` HTTP daemon（Java 进程）桥接 Signal 官方协议；自身不直接参与 Signet Protocol 加解密。形成典型的「SSE 长连接入站 + JSON-RPC 出站」双通道结构：入站 `GET /api/v1/events`（Server-Sent Events，`text/event-stream` 以 `:` 开头行为 keepalive），出站 `POST /api/v1/rpc` 触发 `send` / `sendTyping` / `getAttachment`。关键特征：**单账号绑定**（一个 adapter = 一个 E.164 电话号，`_phone_lock_identity` 防并发监听）；**Java 依赖解耦**（桥接进程由运维侧独立部署）；**Note to Self 回显抑制**（`_recent_sent_timestamps` set + 窗口 50 条去重）；**Mention 占位符还原**（`\uFFFC` → `@name`）；**群组白名单默认拒绝**（空 = 完全禁用，`"*"` 放开）；**120s 健康心跳阈值** + 30s 巡检 + 指数退避（2s→60s + 20% jitter）；**附件 100MB 上限** + 魔术字节 MIME 嗅探；**日志电话号脱敏**（保留前 3 后 2）；**不支持出站 edit**（入站 editMessage 仅记录）。

**EvoClaw Signal 渠道**（不存在） — `packages/shared/src/types/channel.ts:2` 声明 `ChannelType = 'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq' | 'weixin'`，**不包含 `'signal'`**。`packages/core/src/channel/adapters/` 目录下只有 `desktop.ts / feishu.ts / wecom.ts / weixin-*.ts`（16 个文件），**无 `signal.ts`**。仓库中 `signal` 关键字全部命中来自：`AbortSignal` / `AbortSignal.timeout(...)` / `controller.signal`（HTTP 超时与优雅中止）、`infrastructure/graceful-shutdown.ts` 的 UNIX `SIGTERM` / `SIGINT` 信号处理、`evolution/feedback-detector.ts` 的 `SatisfactionSignal` / `POSITIVE_SIGNALS`、Skill 文档字符串 `"trust signals"`——**均与 Signal Messenger 协议无关**。`signal-cli` / `signald` / `presage` / `dbus` / `GroupsV2` / `Sealed Sender` / `Safety Number` 等关键字零命中。综上，**EvoClaw 当前无任何 Signal Messenger 协议实现、无 signal-cli 桥接、无 SSE 订阅、无 JSON-RPC 出站、无端到端加密链路**。

**量级对比**: hermes 单 `SignalAdapter`（876→825 行）≈ EvoClaw weixin 单渠道全部文件行数的 1/4（weixin 16 个文件合计约 2500+ 行），但 Signal 的核心复杂度不在适配器行数，而在外部 `signal-cli` daemon 的运维依赖（Java 进程 + E.164 注册 + 设备绑定）。EvoClaw 补齐 Signal 的真正门槛是：**是否愿意接受"运维必须部署独立 Java 进程"的架构负担**。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | Signal 后端依赖（signal-cli JVM daemon） | 🔴 | grep 零结果；无 SIGNAL_HTTP_URL / signal-cli 进程管理 |
| §3.2 | 通信方式（SSE 入站 + JSON-RPC 出站） | 🔴 | grep 零结果；无 `/api/v1/events` 订阅 / `/api/v1/rpc` 调用 |
| §3.3 | 身份认证（E.164 电话号 + token 锁） | 🔴 | grep 零结果；无 SIGNAL_ACCOUNT / `_phone_lock_identity` |
| §3.4 | 端到端加密（Signal Protocol / Sealed Sender） | 🔴 | 由 signal-cli 托管；EvoClaw 无桥接即无此能力 |
| §3.5 | 消息类型（text / attachment / voice / sticker / mention） | 🔴 | 无 Envelope 解析 / `\uFFFC` 占位符还原 |
| §3.6 | 联系人与 UUID（sourceUuid / sourceNumber） | 🔴 | 无 UUID 识别；EvoClaw ChannelMessage.peerId 抽象存在但未覆盖 Signal 身份模型 |
| §3.7 | 群组（GroupsV2，base64 groupId） | 🔴 | 无 `group:{base64_id}` chat_id 规则；无 SIGNAL_GROUP_ALLOWED_USERS 默认拒绝策略 |
| §3.8 | Note to Self 回显抑制 | 🔴 | 无 `_recent_sent_timestamps` / 窗口去重机制 |
| §3.9 | 指数退避重连（2s→60s + 20% jitter） | 🔴 | 通用 retry 框架存在，但无 SSE 断线专项退避 |
| §3.10 | 健康心跳（120s 阈值 + 30s 巡检） | 🔴 | 无 `_last_sse_activity` / `/api/v1/check` 探活 |
| §3.11 | 附件管线（getAttachment + 100MB + MIME 嗅探） | 🔴 | 有 weixin 媒体管线模板；Signal base64 附件与魔术字节 MIME 嗅探需新建 |
| §3.12 | Mention 占位符还原（\uFFFC → @name） | 🔴 | 无 Signal 特有的 Object Replacement Character 处理 |
| §3.13 | Typing 指示（8s 循环续约） | 🔴 | ChannelAdapter.sendTyping 接口已定义（channel-adapter.ts:51），但无 Signal 实现 |
| §3.14 | 日志电话号脱敏（_redact_phone） | 🟡 | EvoClaw 有 sanitizePII（含手机号），但非 Signal 专用 helper；可迁移复用 |
| §3.15 | 设备多端同步 / Disappearing Messages / Safety Number | 🔴 | Hermes 亦未实现自定义逻辑，托管给 signal-cli；EvoClaw 同样缺失 |

**统计**: 🔴 14 / 🟡 1 / 🟢 0 — 本章节机制几乎全部缺失；仅"日志脱敏"维度 EvoClaw 已有等效能力（但非 Signal 专用）。可迁移资产见 §5。

---

## 3. 机制逐条深度对比

### §3.1 Signal 后端依赖（signal-cli JVM daemon）

**hermes**（`.research/19d-signal.md §1 架构概览` + §6 复刻清单 #1）:
Signal 官方协议复杂（注册 / Double Ratchet / Sealed Sender / GroupsV2 秘钥轮换），Hermes 选择**不自研协议栈**，而是桥接外部 Java 进程 `signal-cli`（暴露 HTTP：`/api/v1/events` SSE + `/api/v1/rpc` JSON-RPC）。Adapter 仅通过 HTTPX 与 daemon 交互，解耦语言栈：
```python
# gateway/platforms/signal.py:159（__init__，audit 后 L147）
self._http_url = config.http_url or "http://127.0.0.1:8080"
self._account = config.account  # E.164 phone
self._client = httpx.AsyncClient(timeout=30.0)
```
替代方案：**signald**（另一 Java 实现，JSON 协议）、**presage**（Rust 原生 Signal Protocol 实现）——Hermes 当前选用 signal-cli 的 HTTP 封装版本。

**EvoClaw**（缺失证据）:
```bash
$ grep -r -i "signal-cli\|signald\|presage\|SIGNAL_HTTP_URL\|SIGNAL_ACCOUNT" /Users/mac/src/github/jone_qian/EvoClaw/packages/
# 零结果

$ ls /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/channel/adapters/
desktop.ts feishu.ts wecom.ts weixin-*.ts   # 无 signal.ts
```
`ChannelType`（`packages/shared/src/types/channel.ts:2`）完全不包含 `'signal'`。EvoClaw 所有 LLM 与业务流程均在 Bun/Node 进程内，**无任何"依赖外部 Java 守护进程"的架构先例**——补齐 Signal 要求引入一条全新的"运维侧部署外部桥接进程"范式。

**判定 🔴**：完全缺失。且架构模式（外部 JVM daemon）与 EvoClaw 现有"纯 TS/Rust"栈差异最大，启动成本高于 Telegram/Discord（后者直接走 HTTP Bot API）。

---

### §3.2 通信方式（SSE 入站 + JSON-RPC 出站）

**hermes**（`.research/19d-signal.md §3.2 / §4.3` L287-350，audit 后 L251-315）:
```python
async def _sse_listener(self) -> None:
    backoff = 2.0
    while self._running:
        try:
            async with self._client.stream(
                "GET", f"{self._http_url}/api/v1/events",
                params={"account": self._account},
                headers={"Accept": "text/event-stream"},
            ) as resp:
                async for line in resp.aiter_lines():
                    if not line or line.startswith(":"):  # keepalive
                        continue
                    self._last_sse_activity = time.monotonic()
                    await self._handle_sse_line(line)
        except Exception:
            jitter = random.uniform(0, 0.2) * backoff
            await asyncio.sleep(min(backoff + jitter, 60.0))
            backoff = min(backoff * 2, 60.0)
```
出站：`_rpc("send", {...})` → `POST /api/v1/rpc`。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "text/event-stream.*signal\|_sse_listener\|api/v1/events\|api/v1/rpc" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
类比：EvoClaw **有 SSE 服务端实现**（`packages/core/src/infrastructure/bun-sse.ts:45` 作为 Sidecar → Desktop 的流式输出通道），但方向相反（EvoClaw 是 SSE server，Signal 场景需 EvoClaw 作为 SSE client 订阅外部 daemon），没有可直接复用的 SSE 客户端长连代码。

**判定 🔴**：完全缺失。SSE client + 指数退避 + keepalive 忽略需新建，但 `infrastructure/async-exec.ts` 的 AbortSignal 超时管理与 `embedded-runner-timeout.ts:85` 的 `abortable()` 可间接支持。

---

### §3.3 身份认证（E.164 电话号 + Phone Lock）

**hermes**（`.research/19d-signal.md §1 单账号绑定` + §6 #2）:
- 一个 adapter 实例 = 一个 E.164 电话号（如 `+1234567890`）。
- `_phone_lock_identity`（L186 基线；audit 后迁移到基类 `_acquire_platform_lock()`）：基于电话号字符串的 scoped lock，**防同一号码被多个 gateway 同时监听 SSE**（否则 signal-cli 会双发/丢消息）。
- 账号与 daemon 注册解耦：运维侧先用 `signal-cli register` CLI 完成短信/语音 OTP 注册 + Safety Number 建立；adapter 不负责 registration 流程。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "_phone_lock_identity\|acquire_scoped_lock\|E.164" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
类比：`packages/core/src/channel/channel-manager.ts:20-60`（未直接读但已在 19a-telegram-gap §5 中验证）具备 adapter 生命周期管理，但无"同 accountId 只能一个实例"的分布式锁；EvoClaw 渠道凭据通过 Keychain 管理，可复用作 Signal 电话号凭据存储。

**判定 🔴**：完全缺失。E.164 锁语义无对应实现；Keychain 凭据存储可迁移复用。

---

### §3.4 端到端加密（Signal Protocol / Sealed Sender）

**hermes**（`.research/19d-signal.md §1 Java 依赖`）:
**不自研**。Signal Protocol（Double Ratchet + X3DH 密钥协商）与 Sealed Sender（隐藏发件人元数据）由 signal-cli daemon 完全托管；Hermes adapter 仅看到明文 payload。这是该适配器代码量（876 行）远小于 Telegram（2879 行）的关键原因——协议栈在 daemon 侧。

**EvoClaw**（缺失证据）:
```bash
$ grep -r -i "double ratchet\|x3dh\|sealed sender\|signal protocol" /Users/mac/src/github/jone_qian/EvoClaw/packages/
# 零结果
```
EvoClaw 有 AES-256-GCM（ring crate，`apps/desktop/src-tauri/`，凭据加密）与 AES-128-ECB（weixin CDN 媒体解密），但**没有**任何 Signal 族密码学原语（Curve25519 ECDH、HKDF 链式派生、Sesame 会话管理）。

**判定 🔴**：完全缺失。按 Hermes 范式，EvoClaw 也应托管给 signal-cli，不自研协议栈。即便如此，**桥接链路仍需新建**（HTTP client + Envelope 解析）。

---

### §3.5 消息类型（text / attachment / voice / sticker / edit）

**hermes**（`.research/19d-signal.md §3.2` + §6 #5）:
SSE 事件载荷是 `envelope` JSON，区分三类：
- `syncMessage.sentMessage`：本机其他端发出的消息（Note to Self）。
- `dataMessage`：真正入站消息（含 `body` / `attachments[]` / `mentions[]` / `groupInfo`）。
- `editMessage`：仅记录，**不实现出站 edit**（见 §6 #14）。

Signal 消息子类型：text、attachment（含 voice note，MIME `audio/aac` + `isVoiceNote: true`）、sticker（`stickerPack`）、reaction（emoji 作为元数据而非消息）、delete-for-everyone。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "syncMessage\|dataMessage\|editMessage\|isVoiceNote\|stickerPack" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
类比：`packages/shared/src/types/channel.ts:4-19` `ChannelMessage` 定义了 `content / mediaPath / mediaType`，足够承载 Signal text + attachment + voice（voice 归为 mediaType `audio/*`），但未预留 sticker / reaction / edit 语义——**类型模型需扩展**才能无损承载 Signal 消息。

**判定 🔴**：完全缺失。ChannelMessage 类型模型可承载 text + attachment，但 sticker / edit / reaction 需扩展。

---

### §3.6 联系人与 UUID（sourceUuid / sourceNumber）

**hermes**（`.research/19d-signal.md §3.2 chat_id 生成`）:
DM chat_id 优先使用 `sourceNumber`（E.164），回退到 `sourceUuid`（Signal ACI UUID，v2 标识符，未来将完全取代电话号）。Signal 身份模型双轨：**phone-based**（人类可读）+ **UUID-based**（隐私/多设备）。
```python
# L407-410 基线
chat_id = sourceNumber or sourceUuid
# Group: f"group:{base64_group_id}"
```

**EvoClaw**（缺失证据）:
```bash
$ grep -r "sourceUuid\|Signal ACI\|sourceNumber" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
类比：`ChannelMessage.peerId`（channel.ts:9） + `ChannelMessage.senderId`（L10）抽象了"对端 ID"与"发件人 ID"，天然可承载 UUID 或 E.164，但未区分 dual-identity（同一用户的 phone+UUID 映射表）。

**判定 🔴**：完全缺失。peerId 抽象可容纳单一 Signal 身份，但**用户身份跨 phone↔UUID 迁移**需新建映射层。

---

### §3.7 群组（GroupsV2，base64 groupId）

**hermes**（`.research/19d-signal.md §3.2` + §5 白名单 + §6 #8）:
- Signal GroupsV2 以二进制 `groupId` 标识，Envelope 中编码为 base64；chat_id 统一为 `group:{base64_group_id}`。
- **群组白名单默认拒绝**（安全设计）：`SIGNAL_GROUP_ALLOWED_USERS` 为空 → 完全禁用；`"*"` → 放开所有。
- 与 WhatsApp 不同，Signal 无 lid 映射；白名单直接以 UUID/号码比对。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "GroupsV2\|SIGNAL_GROUP_ALLOWED\|group:.*base64" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
类比：`ChannelMessage.chatType: 'private' | 'group'`（channel.ts:7）二分类存在；`packages/core/src/routing/binding-router.ts` 的 peerId 匹配可承载 `group:xxx` 前缀。但**群组白名单默认拒绝**是 Signal 的安全惯例，EvoClaw 当前所有渠道（weixin/wecom/feishu）**默认不限群**，策略方向相反。

**判定 🔴**：完全缺失。chatType 二分类可用；但 Signal 默认拒绝的安全姿态需 EvoClaw 增加"群组白名单闸门"配置项。

---

### §3.8 Note to Self 回显抑制

**hermes**（`.research/19d-signal.md §4.1 / §4.4 / §4.6` L414-415 + L661-663）:
```python
# 出站 send 后：
self._recent_sent_timestamps.add(ts)
if len(self._recent_sent_timestamps) > self._max_recent_timestamps:  # 50
    self._recent_sent_timestamps.pop()

# 入站 Note to Self 检测：
if dest == self._account and ts in self._recent_sent_timestamps:
    self._recent_sent_timestamps.discard(ts)
    return   # 自发消息，丢弃防回环
```
数据结构选择 `set()` 而非 `deque(maxlen=256)`：去重查询 O(1) 但窗口仅 50 条，**高吞吐场景可能丢点**（`set.pop()` 是随机而非 FIFO）——研究文档 §7 已列为风险。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "_recent_sent_timestamps\|Note to Self\|echo suppress" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
类比：`packages/core/src/evolution/feedback-detector.ts:1` 依赖 `reflectionMarker` 零宽空格标记防止"自发文本被记忆系统误识为用户反馈"（见 CLAUDE.md `反馈循环防护`），思路上与 Signal Note to Self 抑制**同构**（都是防自身输出被当作入站处理），可迁移其"发送时打标 + 入站校验"范式。

**判定 🔴**：Signal 专项缺失。但 EvoClaw 零宽空格反馈循环防护范式可启发 Signal 版本（例如：timestamp 窗口 + TTL map 代替 `set.pop()`）。

---

### §3.9 指数退避重连（2s→60s + 20% jitter）

**hermes**（`.research/19d-signal.md §4.3` L302-304）:
```python
jitter = random.uniform(0, 0.2) * backoff
await asyncio.sleep(min(backoff + jitter, 60.0))
backoff = min(backoff * 2, 60.0)
# 成功握手后重置 backoff = 2.0
```

**EvoClaw**（缺失证据 + 通用能力存在）:
```bash
$ grep -r "exponential backoff\|jitter\|reconnect.*signal" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果（Signal 专项）
```
类比：CLAUDE.md 提及 `多级错误恢复: Auth 轮转 → overload 退避 → thinking 降级 → context overflow compaction → 模型降级`——EvoClaw 在 LLM provider 层有完善的退避/降级框架（`packages/core/src/agent/kernel/`，见 05-agent-loop-gap.md §3.6），但**渠道 SSE 断线重连**未覆盖。Discord/Telegram 同样缺此能力（见 19a/19b），属于跨渠道共性缺口。

**判定 🔴**：Signal 专项缺失；但通用 retry 框架可承载 SSE 断线退避，工程实现仅需包装。

---

### §3.10 健康心跳（120s 阈值 + 30s 巡检）

**hermes**（`.research/19d-signal.md §3.4 / §4.7` L356-380）:
```python
async def _health_monitor(self) -> None:
    while self._running:
        await asyncio.sleep(30)
        idle = time.monotonic() - self._last_sse_activity
        if idle < 120:
            continue
        try:
            await self._client.get(f"{self._http_url}/api/v1/check")
        except Exception:
            pass
        # 强制取消 SSE task 触发重连
        if self._sse_task and not self._sse_task.done():
            self._sse_task.cancel()
```

**EvoClaw**（缺失证据）:
```bash
$ grep -r "_health_monitor\|api/v1/check\|120.*idle\|_last_sse_activity" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
类比：EvoClaw 有 `packages/core/src/infrastructure/graceful-shutdown.ts:68` 的优雅关闭（SIGTERM/SIGINT 30s 宽限），但无**渠道级心跳探活**；weixin 长轮询依赖 HTTP response 自然断线检测，不符合 SSE 长连范式。

**判定 🔴**：完全缺失。健康心跳是长连接渠道的必备能力，补齐时可考虑跨渠道统一抽象（Telegram/Discord/Signal/Matrix 均需要）。

---

### §3.11 附件管线（getAttachment + 100MB + MIME 嗅探）

**hermes**（`.research/19d-signal.md §2 §4` L553-620 + §6 #9-10）:
- `_rpc("getAttachment")` 返回 base64；经魔术字节嗅探决定扩展名（`.jpg/.png/.pdf/.mp4/.aac`，未知落回 `.bin`）。
- 落盘缓存（避免重复下载）后交给 agent / VLM。
- 出站 `send_attachment`：`attachments=[local_path]` 字段提交，**100MB 上限**需前置校验。

**EvoClaw**（缺失证据 + 强可迁移资产）:
```bash
$ grep -r "getAttachment\|magic.*bytes.*signal\|signal.*attachment" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
类比：EvoClaw weixin 媒体管线（19a-telegram-gap §3.8 已盘点） — `weixin-cdn.ts`（CDN 下载）+ `weixin-crypto.ts`（AES-128-ECB 解密）+ `weixin-mime.ts`（MIME 识别，98 行）+ `weixin-upload.ts`（237 行）+ `weixin-send-media.ts`（217 行）共约 800+ 行完整媒体栈。**其中 `weixin-mime.ts` 的魔术字节 MIME 识别逻辑可 1:1 迁移到 Signal**（两者均需从 base64/binary 推断扩展名）。

**判定 🔴**：Signal 专项缺失；但 MIME 嗅探与媒体缓存模板可迁移，预计节省 30-40% 工期。

---

### §3.12 Mention 占位符还原（\uFFFC → @name）

**hermes**（`.research/19d-signal.md §4.5` L121-139，audit 后反向排序算法 L109-128）:
Signal 以 Unicode **Object Replacement Character** `\uFFFC` 标记 mention 位置（类似 Telegram 的 entities），`mentions[]` 元数据给出每个占位的 `name` / `number` / `uuid`。需按序替换：
```python
def _render_mentions(body: str, mentions: list[dict]) -> str:
    if not mentions or "\uFFFC" not in body:
        return body
    out, idx = [], 0
    for ch in body:
        if ch == "\uFFFC" and idx < len(mentions):
            m = mentions[idx]
            out.append(f"@{m.get('name') or m.get('number') or ''}")
            idx += 1
        else:
            out.append(ch)
    return "".join(out)
```
Audit 后改为**反向排序 + 逆向替换**（避免索引漂移）：`sorted(mentions, key=lambda m: m.get("start", 0), reverse=True)`。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "\\\\uFFFC\|Object Replacement\|_render_mentions\|signal.*mention" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
类比：weixin/wecom/feishu 的 mention 以 `<at user_id="..."/>` XML 片段或 `@nickname` 自然文本表达，**无 Unicode 占位符机制**；EvoClaw 无 Telegram entity 或 Signal `\uFFFC` 处理经验。

**判定 🔴**：完全缺失，无可借鉴模板（Telegram entities 形态也不同）。

---

### §3.13 Typing 指示（8s 循环续约）

**hermes**（`.research/19d-signal.md §2 #11`，audit 后 `_start_typing_indicator` 已作为 dead code 删除 L816-835）:
**⚠ Audit 变化**：Signal 未真正实现出站 typing，`_start_typing_indicator` 函数在 `00ff9a26` 删除（commit `8d023e43`）。研究文档 §6 #11 的"8s 循环续约"已过时。

**EvoClaw**（已有接口但未实现）:
`packages/core/src/channel/channel-adapter.ts:51` 定义了可选方法：
```typescript
/** 发送/取消输入状态指示 (可选，仅部分渠道支持) */
sendTyping?(peerId: string, cancel?: boolean): Promise<void>;
```
——接口已预留（14-state-sessions-gap 已提及），但**无任何渠道实现**（weixin/wecom/feishu/desktop 均未实现）。

**判定 🔴**：Signal 专项缺失；Hermes 实际也未实现。EvoClaw `ChannelAdapter.sendTyping` 接口优雅度反而略高（hermes 现已删除）。

---

### §3.14 日志电话号脱敏（_redact_phone）

**hermes**（`.research/19d-signal.md §4.2`，audit 后迁移至 `helpers.redact_phone` L39 import）:
```python
def _redact_phone(phone: str | None) -> str:
    if not phone:
        return "<none>"
    if len(phone) <= 4:
        return "***"
    return f"{phone[:3]}***{phone[-2:]}"   # +12***90
```
Audit 变化：helper 提取到 `gateway.platforms.helpers`（commit `04c1c5d5`），跨平台复用。

**EvoClaw**（等效能力存在）:
CLAUDE.md 明确：`PII 脱敏: 日志 write() 自动 sanitizePII()，替换 API Key (sk-*/sk-ant-*)、Bearer token、JWT、邮箱、手机号、密码字段值。sanitizeObject() 递归脱敏对象中的敏感键值`。
- `packages/core/src/infrastructure/logger.ts` 全局 `sanitizePII()` 覆盖手机号（grep `signal` 已命中 `weixin-redact.ts:60` 等证据）
- weixin 的 `weixin-redact.ts`（60 行）已有渠道专用脱敏 helper 模板

**判定 🟡**：**部分覆盖**。EvoClaw 通用 `sanitizePII` 已覆盖手机号脱敏（全局兜底），但**无 Signal 专用的 "保留前 3 位 + 后 2 位" 模式**（hermes 是自定义格式而非完全脱敏）。迁移时：要么直接用 sanitizePII 全遮蔽（更安全但牺牲可读性），要么补 Signal 风格 helper（weixin-redact.ts 可作模板）。

---

### §3.15 设备多端同步 / Disappearing Messages / Safety Number verification

**hermes**（`.research/19d-signal.md §1 Java 依赖` + §7 风险）:
- **设备多端同步**（Desktop/Mobile link）：signal-cli `link` 命令 + QR 扫码由运维手动完成；adapter 不参与。
- **Disappearing Messages**（定时消息自毁）：由 daemon 识别 `expireTimer` 字段；adapter 仅作为事件透传者。
- **Safety Number verification**（指纹比对防 MITM）：完全由 signal-cli CLI 操作；adapter 无 API。
- **离线消息重放**：signal-cli 恢复连接后会集中推送，adapter 的指数退避保证重连后顺序消费。

**EvoClaw**（全部缺失）:
```bash
$ grep -r "disappearing\|expireTimer\|safety number\|signal.*link" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```

**判定 🔴**：完全缺失。**但 Hermes 也未自实现**（托管给 daemon），EvoClaw 按 Hermes 范式跟进即可——这三项不是差距核心。

---

## 4. 建议改造蓝图（不承诺实施）

> 前提：**极低优先级**。EvoClaw 定位"企业级国内用户"，Signal 在国内装机量极低（不如 Telegram/WhatsApp 的出海场景）；补齐 Signal 仅在"高敏感行业 + 海外用户 + E2EE 合规需求"三个条件同时满足时才值得启动。启动前需评估：**是否愿意引入 Java 运维依赖 + 电话号注册 OTP 流程**。

### P0（若启动 Signal 渠道即须覆盖） — 预计 1-1.5 人周

| 项 | 范围 | 工作量 | ROI |
|---|---|---|---|
| P0-1 | 扩展 `ChannelType` 加 `'signal'`（`packages/shared/src/types/channel.ts`），新建 `packages/core/src/channel/adapters/signal.ts` 骨架，实现 `ChannelAdapter` 接口 | 0.5d | ★★★ 架构入口 |
| P0-2 | 部署文档：签 `signal-cli` JVM daemon 运维 runbook（Docker compose 示例 + 电话号注册 OTP 流程） | 1d | ★★★ 无此无法上线 |
| P0-3 | SSE 客户端长连 + 指数退避（2s→60s + 20% jitter） + keepalive 忽略 `:` 行 | 2d | ★★★ 核心入站链路 |
| P0-4 | JSON-RPC 出站（`send` / `sendTyping` / `getAttachment`） | 1d | ★★★ 核心出站链路 |
| P0-5 | Envelope 解析：`syncMessage.sentMessage` / `dataMessage` / `editMessage` 三分类 + DM/Group chat_id 生成（`group:{base64}`） | 1.5d | ★★★ 消息语义正确性 |
| P0-6 | `ChannelMessage` 类型扩展：支持 sticker / voice note / reaction / edit 语义字段 | 1d | ★★ 类型完整性 |
| P0-7 | Note to Self 回显抑制（timestamp 窗口 + TTL map 替代 set.pop()，修正 hermes 已知风险） | 0.5d | ★★★ 防回环必需 |
| P0-8 | Mention 占位符还原（`\uFFFC` → `@name`，采用 audit 后反向排序算法） | 0.5d | ★★ 群聊必需 |
| P0-9 | E.164 电话号 scoped lock（防双实例监听，复用 EvoClaw 文件锁或 SQLite 独占事务） | 0.5d | ★★★ 分布式部署必需 |

### P1（强推荐，进入生产前补齐） — 预计 0.5-1 人周

| 项 | 范围 | 工作量 | ROI |
|---|---|---|---|
| P1-1 | 健康心跳（30s 巡检 + 120s 阈值 + `/api/v1/check`） | 0.5d | ★★★ 长连接生命线 |
| P1-2 | 附件管线：getAttachment base64 → 魔术字节 MIME 嗅探 → 落盘缓存（迁移 weixin-mime.ts） | 1.5d | ★★★ 不支持附件等于废掉一半能力 |
| P1-3 | 附件 100MB 上限前置校验 + 超限友好错误 | 0.25d | ★ 防 daemon OOM |
| P1-4 | 群组白名单默认拒绝（`SIGNAL_GROUP_ALLOWED_USERS` 配置，空=禁用，`*`=放开） | 0.5d | ★★★ 安全默认 |
| P1-5 | 电话号脱敏 helper（`weixin-redact.ts` 模式，保留前 3 后 2） | 0.25d | ★ 日志合规 |
| P1-6 | Binding Router 适配 Signal 双身份（phone↔UUID 映射表） | 1d | ★★ 身份迁移鲁棒性 |

### P2（选做）

| 项 | 范围 | 工作量 | ROI |
|---|---|---|---|
| P2-1 | 支持出站 edit（hermes 主动放弃，可作为 EvoClaw 反超点） | 1d | ★ 需评估 signal-cli 是否稳定支持 |
| P2-2 | Reaction 出站 + 入站元数据穿透（表情进度提示，模仿 Telegram 风格） | 1d | ★ 精致化体验 |
| P2-3 | `SignalCliProcess` 进程管理器（EvoClaw 自拉起 daemon，无需运维介入） | 3d | ★ 降低部署门槛，但增加代码复杂度 |

### 不建议做

- **自研 Signal Protocol**（presage 路线）：RustCrypto 生态未稳定，E2EE 合规风险极高；继续托管给 signal-cli 即可。
- **集成 signald**（Java 另一实现）：与 signal-cli 功能重叠，运维 API 不如后者成熟。
- **MTProto 风格的 MProto 直连**：Signal 无开放的低层协议 API，只能经 signal-cli/signald/presage。

---

## 5. EvoClaw 反超点汇总

> **本章节 EvoClaw 无任何 Signal 渠道反超**（整体缺失）。以下为**可迁移资产**——EvoClaw 已有的通用能力在补齐 Signal 时可直接复用，缩短工期。

| 可迁移资产 | 代码证据 | 迁移到 Signal 的价值 |
|---|---|---|
| **`ChannelAdapter` 统一抽象** | `packages/core/src/channel/channel-adapter.ts:31-55`（9 个方法的接口，含可选 `sendTyping`） | 新 `SignalAdapter` 实现该接口即无缝接入 ChannelManager / 自动重连；Hermes 复刻清单 15 项约 6-7 项可由 EvoClaw 抽象天然覆盖 |
| **`ChannelMessage` 归一化类型** | `packages/shared/src/types/channel.ts:4-19`（含 `chatType: 'private'\|'group'` / `mediaPath` / `mediaType`） | 承载 Signal text + DM/group + attachment 无压力；sticker/reaction/edit 需扩展字段 |
| **SSE 基础设施** | `packages/core/src/infrastructure/bun-sse.ts:45`（SSE server），`AbortSignal` 生态（`embedded-runner-timeout.ts:85` `abortable()`） | 方向虽相反（EvoClaw SSE server / Signal SSE client），但 AbortSignal 超时与优雅中止范式可承载 signal-cli SSE 订阅的取消语义 |
| **媒体管线模板（MIME 嗅探 + 缓存）** | `packages/core/src/channel/adapters/weixin-mime.ts`（98 行）+ `weixin-upload.ts`（237 行）+ `weixin-send-media.ts`（217 行）+ `weixin-cdn.ts`（159 行） | 魔术字节 MIME 识别 1:1 可迁移；落盘缓存与 100MB 上限校验可包装复用 |
| **PII 脱敏（含手机号）** | `packages/core/src/infrastructure/logger.ts` 的 `sanitizePII()` 全局兜底 + `weixin-redact.ts:60` 渠道专用 helper 模板 | Signal 电话号脱敏可直接复用 sanitizePII（全遮蔽）或按 weixin-redact 模式新建 signal-redact.ts |
| **反馈循环防护范式** | `packages/core/src/evolution/feedback-detector.ts:1` + 零宽空格 `reflectionMarker`（CLAUDE.md `反馈循环防护`） | 与 Note to Self 回显抑制同构（发送时打标 + 入站校验），可启发 Signal timestamp 窗口 + TTL map 设计 |
| **Keychain 凭据存储（macOS）** | `security-framework`（apps/desktop/src-tauri/） + `packages/core/src/infrastructure/` 凭据管理 | Signal E.164 电话号 + signal-cli 认证凭据可直接存入 Keychain |
| **优雅关闭 + SIGTERM/SIGINT 处理** | `packages/core/src/infrastructure/graceful-shutdown.ts:68-74`（30s 宽限期 + 按优先级串行关闭） | SSE task 取消 + signal-cli HTTP client 关闭可接入 registerShutdownHandler |
| **BindingRouter 精确优先匹配** | `packages/core/src/routing/binding-router.ts`（peerId > accountId+channel > channel > 默认，19a §5 已验证） | Signal DM UUID / E.164 / 群组 base64_id → Agent 绑定无需新建 |
| **Session Key 路由格式** | CLAUDE.md `agent:<agentId>:<channel>:dm:<peerId> / agent:<agentId>:<channel>:group:<groupId>` | Signal DM / group 隔离可直接套用 `agent:<id>:signal:dm:<phone-or-uuid>` 与 `agent:<id>:signal:group:<base64>` |
| **通用重试/退避框架（LLM 层）** | `packages/core/src/agent/kernel/` retry 路径（05-agent-loop-gap §3.6） | `RetryAfter` / SSE 断线指数退避可包装进现有 retry 框架 |
| **前端折叠/透传渠道元数据能力** | CLAUDE.md `聊天页 Show Your Work 折叠条`（Sprint 15.12） | Signal reaction / edit / disappearing timer 可透传到 Desktop UI 展示 |

**结论**：EvoClaw 在"国内渠道"上积累的工程资产显著降低 Signal 适配器构建成本（主要是媒体管线、PII 脱敏、ChannelAdapter 抽象、Binding Router）。**但 Signal 特有的外部 JVM daemon 运维依赖是 EvoClaw 的全新架构维度**，无可迁移先例。乐观估计 P0+P1 总工期可从"从零 2.5 人周"压缩到"1.5-2 人周"，前提是采用托管 signal-cli 方案而非自研 Signal Protocol。

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（已 Read / Grep 验证）

1. `packages/shared/src/types/channel.ts:2` — `ChannelType = 'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq' | 'weixin'` — **无 `'signal'`**。
2. `packages/core/src/channel/adapters/` 目录（Bash ls）：`desktop.ts / feishu.ts / wecom.ts / weixin-*.ts`（16 个文件），**无 `signal.ts`**。
3. `packages/core/src/channel/channel-adapter.ts:31-55` — `ChannelAdapter` 接口定义（含 9 方法与可选 `sendTyping`），可迁移基础。
4. `packages/shared/src/types/channel.ts:4-19` — `ChannelMessage` 归一化类型（含 `chatType / mediaPath / mediaType`）。
5. `packages/core/src/infrastructure/bun-sse.ts:45` — `createBunSSEResponse(signal?: AbortSignal)` — EvoClaw 的 SSE **服务端**实现（不是客户端），方向与 Signal 场景相反。
6. `packages/core/src/infrastructure/graceful-shutdown.ts:68-74` — `SIGTERM/SIGINT` shutdown handler（此处 signal 是 UNIX 信号量，非 Signal Messenger）。
7. `packages/core/src/agent/embedded-runner-timeout.ts:85` — `abortable(promise, signal)` helper（AbortSignal 超时包装，非 Signal Messenger）。
8. `packages/core/src/evolution/feedback-detector.ts:1-74` — `SatisfactionSignal / POSITIVE_SIGNALS / NEGATIVE_SIGNALS` — 情感反馈信号，非 Signal Messenger。
9. `packages/core/src/channel/adapters/weixin-redact.ts`（60 行）— PII 脱敏 helper 模板（可迁移为 signal-redact.ts）。
10. `packages/core/src/channel/adapters/weixin-mime.ts`（98 行）— 魔术字节 MIME 识别（可 1:1 迁移到 Signal 附件）。
11. `packages/core/src/channel/adapters/weixin-cdn.ts`（159 行）+ `weixin-crypto.ts`（91 行）— 媒体下载 + 加解密模板。
12. grep `"signal-cli\|signald\|presage\|SIGNAL_HTTP_URL\|SIGNAL_ACCOUNT\|_phone_lock_identity\|Signal Protocol\|Sealed Sender\|GroupsV2\|safety number"` in `packages/`：**零命中**（Signal Messenger 相关关键字全部缺失）。
13. grep `"signal"` in `packages/`（大小写不敏感）：53 个文件命中，**全部**来自 `AbortSignal / AbortSignal.timeout / controller.signal / SatisfactionSignal / POSITIVE_SIGNALS / graceful-shutdown UNIX signal / Skill docs "trust signals"`——**无一条指向 Signal Messenger 协议**。
14. grep `"text/event-stream.*signal\|_sse_listener\|api/v1/events\|api/v1/rpc"`：零命中。
15. grep `"\\\\uFFFC\|Object Replacement\|_render_mentions\|syncMessage\|dataMessage\|editMessage\|isVoiceNote"`：零命中。

### 6.2 hermes 研究引用（章节 §）

- `.research/19d-signal.md §1` 架构概览（signal-cli HTTP daemon + SSE 入站 + JSON-RPC 出站 + mermaid flowchart）
- `.research/19d-signal.md §2` 目录/文件分布（876 行 5 层逻辑分层 + BasePlatformAdapter 继承）
- `.research/19d-signal.md §3.1` 启动序列（构造器 + `_phone_lock_identity` + SSE + health monitor）
- `.research/19d-signal.md §3.2` 入站消息（syncMessage / dataMessage / editMessage 三分类 + chat_id 生成）
- `.research/19d-signal.md §3.3` 出站消息（`_rpc("send")` + timestamp → message_id + `_recent_sent_timestamps` 回显缓存）
- `.research/19d-signal.md §3.4` 健康监控（30s 巡检 + 120s 阈值 + `/api/v1/check` + 指数退避）
- `.research/19d-signal.md §4.1` 构造器核心字段（L156-191，audit 后 L144-178）
- `.research/19d-signal.md §4.2` 电话号脱敏 `_redact_phone`（L62-68，audit 后迁移至 helpers）
- `.research/19d-signal.md §4.3` SSE 监听与退避（L287-350）
- `.research/19d-signal.md §4.4` Note to Self 过滤（L402-421）
- `.research/19d-signal.md §4.5` Mention 占位符替换（L121-139，audit 后反向排序 L109-128）
- `.research/19d-signal.md §4.6` 发送与回显缓存（L626-655 + L661-663）
- `.research/19d-signal.md §4.7` 健康监控实现（L356-380）
- `.research/19d-signal.md §5` 与其它模块交互（BasePlatformAdapter / httpx / scoped lock / 白名单）
- `.research/19d-signal.md §6` 复刻清单 15 条（部署 daemon / E.164 绑定 / SSE keepalive / 退避 / chat_id / Note to Self / Mention / 群白名单 / MIME 嗅探 / 100MB / typing 已删 / 心跳 / 日志脱敏 / 无出站 edit / 环境变量清单）
- `.research/19d-signal.md §7` 风险（版本漂移 / nginx 代理 / set.pop FIFO 问题 / MIME 误判 / 无 edit）
- `.research/19d-signal.md Addendum` drift audit @ `00ff9a26`：-51 行 + 2 函数删除（`_redact_phone` 迁移 / `_start_typing_indicator` dead code 清理）+ Mention 反向排序算法改进 + `_track_sent_timestamp` 提取 + `_force_reconnect` 提取

### 6.3 关联差距章节（crosslink）

- **[`./19-gateway-platforms-gap.md`](./19-gateway-platforms-gap.md)**（同批，总览）— Gateway 平台适配器架构对比 / `BasePlatformAdapter` vs `ChannelAdapter` / 国际平台缺失概述
- **[`./19a-telegram-gap.md`](./19a-telegram-gap.md)**（同批）— Telegram 适配器，Bot API 与 Signal 的 daemon 桥接模式迥异，可作"国际渠道缺失"对照组
- **[`./19b-discord-gap.md`](./19b-discord-gap.md)**（同批）— Discord 适配器，Gateway WebSocket 与 Signal SSE 同为长连接范式，可互借心跳/退避策略
- **[`./19c-slack-gap.md`](./19c-slack-gap.md)**（同批）— Slack 企业 IM，白名单 + 命令派发可与 Signal 群组白名单策略互借
- **[`./19e-matrix-gap.md`](./19e-matrix-gap.md)**（同批）— Matrix 联邦化 + E2EE（Olm/Megolm），与 Signal 同为 E2EE IM 阵营，加密协议栈对比价值最高
- **[`./19f-whatsapp-gap.md`](./19f-whatsapp-gap.md)**（未来）— WhatsApp Business API，白名单策略差异可对比（WhatsApp 有 lid 映射，Signal 无）
- **[`./05-agent-loop-gap.md`](./05-agent-loop-gap.md) §3.6** — Retry / Fallback 框架（Signal SSE 断线退避可接入）
- **[`./29-security-approval-gap.md`](./29-security-approval-gap.md)**（未来）— 审批系统（Signal 无 Inline Keyboard，审批 UX 需回落到文本/表情 reaction）
