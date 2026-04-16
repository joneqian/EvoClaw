# 19e — Matrix 渠道集成 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/19e-matrix.md`（Hermes `gateway/platforms/matrix.py` 2023 行，基于 mautrix-python SDK 全量重写，@ `00ff9a26` 2026-04-16）
> **hermes 基线**: commit `00ff9a26`（2026-04-16）
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16）
> **综合判定**: 🔴 **整体缺失**（无任何 Matrix 协议 / Homeserver / Client-Server API 实现，但 ChannelAdapter 抽象 / BindingRouter / SessionKey / 长轮询范式 等通用渠道架构可迁移）

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes `MatrixAdapter`**（`gateway/platforms/matrix.py:1-2023`） — Hermes Gateway 体量最大的平台模块（2023 行单文件），基于 **mautrix-python** 异步 SDK（而非旧版 matrix-nio）实现**普通 Client Bot**（非 Application Service）。核心架构是**长轮询 `sync(since, timeout=30000)` 循环 + `handle_sync()` 事件分发 + `OlmMachine` 自动密钥管理**。可选开启端到端加密（E2EE，依赖 `python-olm` / `libolm` 和 SQLite `crypto.db` crypto store）；本地持久化包括 `~/.hermes/platforms/matrix/crypto.db`（OlmMachine state）和 `~/.hermes/matrix_threads.json`（bot 参与过的线程集合，`ThreadParticipationTracker`）。认证支持 Token 优先 + Password 降级双路径；消息类型覆盖 `m.text / m.image / m.audio (+ MSC3245 voice) / m.video / m.file`；交互形态含 `m.replace` 编辑、`m.in_reply_to` 回复、`m.thread` 线程、`m.reaction` 表情（👀→✅/❌ 生命周期）、mention 四层优先级（MSC3952 → 完整 ID → localpart → matrix.to 链接）。

**EvoClaw Matrix 渠道**（不存在） — `packages/core/src/channel/adapters/` 仅含 `desktop.ts / feishu.ts / wecom.ts / weixin-*.ts` 共 16 个文件，**无 `matrix.ts`**；`packages/shared/src/types/channel.ts:2` 的 `ChannelType = 'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq' | 'weixin'` **不包含 matrix**。全仓库 `grep -r -i "matrix" packages/core/src` 的 5 个命中全部是**无关误匹配**：`context-assembler.ts:17-68` 的 `FILE_LOAD_MATRIX`（Agent 工作区 9 文件加载矩阵）、`memory/hybrid-searcher.ts:222-229` 的类别权重矩阵（`matrix[queryType]?.[category]`）、三个 SKILL.md markdown 中的字符串（`Use Case Matrix`、`Read vs Write Decision Matrix`、skill 作者昵称 `@MaTriXy`）。`packages/shared/src` 侧 `matrix` 零命中。**EvoClaw 当前无任何 Matrix Client-Server API 调用、无 sync 循环、无 E2EE / OlmMachine、无 Room/Space/Thread 概念、无 Federation 感知**。

**量级对比**: hermes 单 Matrix 适配器 2023 行 ≈ EvoClaw 全部渠道适配器 2845 行中 **weixin 全家桶 2067 行** 的同量级（两者都是"单一最复杂渠道"）。但架构栈完全不同：Matrix 面向联邦化 / E2EE / Homeserver 多租户，EvoClaw weixin 面向 iLink Bot 长轮询 + CDN 媒体 + 微信个人号特有能力，**没有任何可直接复用的协议层**，可迁移资产只在更底层的 ChannelAdapter / SessionKey / 长轮询工程范式层面（详见 §5）。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | Homeserver 选型与连接（matrix.org / Synapse / Dendrite） | 🔴 | grep 零结果；无 `MATRIX_HOMESERVER` / `HTTPAPI(base_url=...)` / mxid 解析 |
| §3.2 | 认证（Token 优先 + Password 降级 + 稳定 device_id） | 🔴 | grep 零结果；无 `whoami()` / `client.login()` / `MATRIX_DEVICE_ID` |
| §3.3 | Client-Server API（`/sync` + `/rooms/{roomId}/send/*`） | 🔴 | grep 零结果；无 `send_message_event` / `RoomID` / `EventType.ROOM_MESSAGE` |
| §3.4 | Long-polling Sync 循环 + `handle_sync()` 事件分发 | 🔴 | grep 零结果；无 `_sync_loop` / `next_batch` cursor / `sync_store` |
| §3.5 | 消息类型（m.text / m.image / m.audio / m.video / m.file） | 🔴 | grep 零结果；无 msgtype 分发 / `decrypt_attachment` / mxc→HTTP 转换 |
| §3.6 | Room 管理（create / join / invite / leave） | 🔴 | grep 零结果；无 `_joined_rooms` / Room 生命周期 API |
| §3.7 | E2EE（OlmMachine / Megolm / Device verification / crypto.db） | 🔴 | grep 零结果；无 Olm / Megolm / PgCryptoStore / 设备密钥验证 |
| §3.8 | Federation（跨 homeserver 互通） | 🔴 | grep 零结果；无 homeserver suffix 解析 / 跨服务器路由 |
| §3.9 | Presence（online / idle / offline） | 🔴 | grep 零结果；无 presence 事件订阅 / 上报 |
| §3.10 | Threads（m.thread 线程回复 + 跨重启参与持久化） | 🔴 | grep 零结果；无 ThreadParticipationTracker 对等物 |
| §3.11 | Reactions（m.reaction / m.annotation + 生命周期） | 🔴 | grep 零结果；无 reaction 发送 / redact 撤销 |
| §3.12 | DM / Mention / Bot 识别 | 🔴 | grep 零结果；无 `m.direct` 缓存 / MSC3952 mentions / matrix.to 链接 |
| §3.13 | Rate Limit（homeserver 侧 M_LIMIT_EXCEEDED） | 🔴 | grep 零结果；无 homeserver rate limit 专项退避 |
| §3.14 | 编辑（m.replace + m.new_content + `*` 前缀） | 🔴 | grep 零结果；无 Matrix 编辑关系类型处理 |
| §3.15 | Markdown → HTML（custom.html format + fallback） | 🔴 | grep 零结果；无 MarkdownV2/HTML；仅 weixin Markdown→纯文本降级 |

**统计**: 🔴 15 / 🟡 0 / 🟢 0 — 本章节机制全部缺失，可迁移资产见 §5。

---

## 3. 机制逐条深度对比

每条同时给出 **hermes 实现**（带 `.research/19e-matrix.md §N` + `matrix.py:LN` 引用）+ **EvoClaw 实现**（基本均为 grep 缺失证据）+ **判定与分析**。

### §3.1 Homeserver 选型与连接

**hermes**（`.research/19e-matrix.md §3.1` + `matrix.py:L198-204, L373-389`）—— 配置项优先级 `config.extra.homeserver` → `MATRIX_HOMESERVER` 环境变量；剥尾 `/`；构造 `HTTPAPI(base_url=homeserver, token=access_token)` → `Client(mxid, device_id, api, state_store, sync_store)` 完成。支持 `matrix.org`（公共 homeserver）/ 自建 Synapse / Dendrite（Go 实现，轻量）的任意 URL。

```python
# matrix.py:L198-204 构造器
self._homeserver = (config.extra.get("homeserver", "") or os.getenv("MATRIX_HOMESERVER", "")).rstrip("/")
self._user_id = config.extra.get("user_id", "") or os.getenv("MATRIX_USER_ID", "")
# matrix.py:L373-389
api = HTTPAPI(base_url=self._homeserver, token=self._access_token or "")
client = Client(mxid=UserID(self._user_id), device_id=self._device_id or None, api=api,
                state_store=MemoryStateStore(), sync_store=MemorySyncStore())
```

**EvoClaw**（缺失证据）:
```bash
$ grep -r -i "homeserver\|HTTPAPI\|mautrix" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果

$ grep -r -i "matrix" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 5 个命中全部为误匹配：
#   context-assembler.ts FILE_LOAD_MATRIX（工作区文件加载矩阵）
#   hybrid-searcher.ts matrix[queryType]?.[category]（权重矩阵）
#   skill/bundled/*/SKILL.md（"Use Case Matrix" 等文本）
```
`ChannelType`（`packages/shared/src/types/channel.ts:2`）无 `'matrix'`。

**判定 🔴**：完全缺失。Homeserver 是 Matrix 架构的入口抽象（类比 Discord 集中式 API 的分布式替代），EvoClaw 无对应配置 / 发现 / 连接路径。

---

### §3.2 认证（Token 优先 + Password 降级 + 稳定 device_id）

**hermes**（`.research/19e-matrix.md §3.1` + `matrix.py:L406-454`）—— 双分支:

- **Token 路径**（L406-434）：将 `access_token` 写入 `HTTPAPI`，调用 `client.whoami()` 验证；成功则解析 `user_id` 和 `device_id`。支持 Application Service Token（高权限）和 User Access Token。
- **Password 路径**（L435-449）：调用 `client.login(identifier=user_id, password, device_name="Hermes Agent", device_id=self._device_id or None)`，登录成功后用返回的 `device_id`。
- **稳定 `device_id`**：`MATRIX_DEVICE_ID` 环境变量是 E2EE 密钥管理的**关键锚点**——若每次启动 device_id 变化，OlmMachine 会认为是"新设备"导致密钥共享失败。

```python
# matrix.py:L406-449（精简）
if self._access_token:                    # Token 分支
    api.token = self._access_token
    resp = await client.whoami()
    self._user_id = str(getattr(resp, "user_id", "") or self._user_id)
    client.device_id = self._device_id or getattr(resp, "device_id", "")
elif self._password and self._user_id:    # Password 分支
    resp = await client.login(identifier=self._user_id, password=self._password,
                              device_name="Hermes Agent", device_id=self._device_id or None)
    client.device_id = resp.device_id
```

**EvoClaw**（缺失证据）:
```bash
$ grep -r "MATRIX_ACCESS_TOKEN\|MATRIX_DEVICE_ID\|whoami" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
类比：EvoClaw 有通用 Keychain 凭据管理（CLAUDE.md 声明 `macOS Keychain (security-framework) + AES-256-GCM (ring)`），可承载 token，但无 Matrix 特有的"token → whoami → device_id"流程，也无"稳定 device_id"语义。

**判定 🔴**：完全缺失。Keychain 可复用做凭据持久化，但协议层的双路径认证与 device_id 锚定需全新实现。

---

### §3.3 Client-Server API（`/sync` + `/rooms/{roomId}/send/*`）

**hermes**（`.research/19e-matrix.md §3.6` + `matrix.py:L621-699`）—— `send_message_event(RoomID, EventType.ROOM_MESSAGE, msg_content)` 是出站核心 API；响应 `event_id` 作为 `SendResult.message_id`。

```python
# matrix.py:L693-699（出站核心调用）
event_id = await self._client.send_message_event(
    RoomID(chat_id), EventType.ROOM_MESSAGE, msg_content)
last_event_id = str(event_id)
```

入站由 `handle_sync()` 触发的事件处理器（`add_event_handler(EventType.ROOM_MESSAGE, self._on_room_message)`）间接调用 `/sync` 返回的 room events。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "send_message_event\|ROOM_MESSAGE\|EventType\..*MESSAGE" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```

**判定 🔴**：完全缺失。EvoClaw 所有渠道出站 API 形态（weixin iLink HTTP、飞书/企微 OpenAPI）与 Matrix 的 `PUT /_matrix/client/v3/rooms/{roomId}/send/{eventType}/{txnId}` REST 语义均不同，需全新 adapter。

---

### §3.4 Long-polling Sync 循环 + `handle_sync()` 事件分发

**hermes**（`.research/19e-matrix.md §3.2` + `matrix.py:L959-1016`）—— 持续增量同步，维护 `next_batch` cursor；每轮 `sync(since=next_batch, timeout=30000)` → 异常分类（`M_UNKNOWN_TOKEN` 永久停止 / 401-403 永久停止 / 其它 5s 退避） → `handle_sync(sync_data)` 触发已注册 handler（OlmMachine 在此阶段处理 to-device 密钥） → 末尾 `_retry_pending_decryptions()` 消化缓冲的 Megolm 事件。

```python
# matrix.py:L959-1016（精简）
async def _sync_loop(self) -> None:
    next_batch = await self._client.sync_store.get_next_batch()
    while not self._closing:
        try:
            sync_data = await self._client.sync(since=next_batch, timeout=30000)
            if isinstance(sync_data, dict):
                nb = sync_data.get("next_batch")
                if nb:
                    next_batch = nb
                    await self._client.sync_store.put_next_batch(nb)
                tasks = self._client.handle_sync(sync_data)
                if tasks: await asyncio.gather(*tasks)
            if self._pending_megolm:
                await self._retry_pending_decryptions()
        except Exception as exc:
            err_str = str(exc).lower()
            if "401" in err_str or "403" in err_str: return  # 永久停止
            await asyncio.sleep(5)
```

初始化阶段（`matrix.py:L544-570`）先做一次 `sync(timeout=10000, full_state=True)` 拿全量 state 和 joined rooms 列表，再启动循环。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "next_batch\|sync_store\|handle_sync\|long.poll.*matrix" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
**类比（可迁移）**：`packages/core/src/channel/adapters/weixin.ts`（529 行）实现 iLink Bot 长轮询（`CLAUDE.md` 声明 `iLink Bot 长轮询 (vs webhook)`），工程模板（循环 + 增量游标 + 错误退避 + 断线重连）结构可 1:1 参考，但 Matrix 的 cursor 叫 `next_batch` 语义（全局递增 token，**非单调整数**），不是 weixin 的 offset 数字。

**判定 🔴**：完全缺失。长轮询范式可借鉴 weixin，但 Matrix 特有的 `next_batch` / `handle_sync` 事件分发 / OlmMachine to-device 联动均须全新实现。

---

### §3.5 消息类型（m.text / m.image / m.audio + MSC3245 voice / m.video / m.file）

**hermes**（`.research/19e-matrix.md §3.3, §3.4` + `matrix.py:L1074-1131, L1259-1390`）—— `_on_room_message()` 按 `msgtype` 分发：

```python
# matrix.py:L1127-1131
if msgtype in ("m.image", "m.audio", "m.video", "m.file"):
    await self._handle_media_message(...)
elif msgtype == "m.text":
    await self._handle_text_message(...)
```

`_handle_media_message`（L1259-1390）处理 URL（`mxc://` → HTTP via `_mxc_to_http()`；加密媒体从 `file.url` 读取）+ 媒体类型细分（`m.image` → PHOTO；`m.audio` → VOICE(MSC3245) / AUDIO；`m.video` → VIDEO）+ 条件缓存（图片/语音/加密媒体下载 → `decrypt_attachment(key, hash, iv)` 解密 → `cache_*_from_bytes()` 本地化）+ URL 降级（优先本地，非加密降级 HTTP）。

出站侧（L774-860）有 5 个方法：`send_image` / `send_voice`（MSC3245 `is_voice=True`）/ `send_document` / `send_video` / `_upload_and_send`。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "m\.image\|m\.audio\|m\.video\|MSC3245\|mxc://" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
**类比**：EvoClaw 在 weixin 全家桶（`weixin-upload.ts` 237 行 / `weixin-send-media.ts` 217 行 / `weixin-cdn.ts` 159 行 / `weixin-crypto.ts` 91 行 AES-128-ECB / `weixin-mime.ts` 98 行 / `weixin-silk.ts` 138 行 SILK 音频转码）有完整的媒体管线，但针对 Matrix 特有的 **`mxc://` URI scheme + AES-256-CTR `decrypt_attachment`**（见 hermes `.research/19e-matrix.md §3.4`）与微信的 AES-128-ECB 是完全不同的加密栈。

**判定 🔴**：完全缺失。媒体管线工程模板可复用，但 `mxc://` 解析、加密附件（AES-256-CTR 含 key/hash/iv 三元组）解密、MSC3245 voice 标记均需新建。

---

### §3.6 Room 管理（create / join / invite / leave）

**hermes**（`.research/19e-matrix.md §3.1-3.2`，通过 mautrix 原生 API 或 `handle_sync()` 的 `rooms.join` 更新）:

- `_joined_rooms: Set[str]`（`matrix.py:L211`）追踪已加入的 room，在 sync 的 `rooms_join` 字段每轮更新（L954-957）。
- `_dm_rooms: Dict[str, bool]`（L210）基于 `m.direct` 账户数据事件的 DM 判定缓存。
- DM 检测双路径（`_is_dm_room()` L1739-1752）：缓存优先 → 成员数==2 fallback。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "joined_rooms\|room_id\|roomId.*matrix" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
**类比**：EvoClaw 的 BindingRouter（`packages/core/src/routing/binding-router.ts`）支持 peerId / chatType / channel 多层绑定，Matrix room_id 可直接映射为 peerId，但 Room **生命周期操作**（invite/leave/create）与 IM 群聊 adapter 模型不同（Matrix room 可跨 homeserver 联邦）。

**判定 🔴**：完全缺失。room 管理动词（加入/离开/建房）在 hermes 当前代码里主要通过 mautrix handle_sync 被动更新 `_joined_rooms`，若 EvoClaw 要支持**主动**管理（创建 bot 专用 room 做企业客服）则需额外实现。

---

### §3.7 E2EE（OlmMachine / Megolm / Device verification / crypto.db）

**hermes**（`.research/19e-matrix.md §3.1 复刻清单 4-7 + §4.2 + §4.5`，`matrix.py:L456-536, L1018-1068, L1394-1409`）—— 整个 Matrix 适配器最重的子系统:

初始化（L456-536）: SQLite `crypto.db` via `Database.create("sqlite:///...")` + `PgCryptoStore(account_id, pickle_key=f"{user_id}:{device_id}", db)` → `OlmMachine(client, store, state)` → `olm.share_keys_min_trust = TrustState.UNVERIFIED`（自动分享 Megolm 密钥）→ `olm.load()` → `_verify_device_keys_on_server()`（query_keys → 比对 ed25519 → 缺失则 re-upload）→ 可选 recovery key 交叉签名。

运行时（L1394-1409 缓冲 + L1018-1068 重试）:

```python
# matrix.py:L1394-1409 缓冲加密事件
async def _on_encrypted_event(self, event):
    event_id = str(getattr(event, "event_id", ""))
    if self._is_duplicate_event(event_id): return
    self._pending_megolm.append((str(getattr(event, "room_id", "")), event, time.time()))
    if len(self._pending_megolm) > _MAX_PENDING_EVENTS:  # 硬上限 100
        self._pending_megolm = self._pending_megolm[-_MAX_PENDING_EVENTS:]

# matrix.py:L1018-1068 重试
async def _retry_pending_decryptions(self):
    crypto = getattr(self._client, "crypto", None)
    if not crypto: return
    still_pending = []
    for room_id, event, ts in self._pending_megolm:
        if time.time() - ts > _PENDING_EVENT_TTL: continue  # TTL 300s
        decrypted = await crypto.decrypt_megolm_event(event)
        if decrypted is not None and decrypted is not event:
            self._processed_events_set.discard(str(getattr(decrypted, "event_id", "")))
            await self._on_room_message(decrypted)
        else:
            still_pending.append((room_id, event, ts))
    self._pending_megolm = still_pending
```

另有 `_CryptoStateStore`（L168-192）适配器为 OlmMachine 提供 `is_encrypted / get_encryption_info / find_shared_rooms`。`_verify_device_keys_on_server()`（L270-370）确保服务器端设备密钥与本地一致，防止因 crypto.db 丢失导致 Olm session 失效。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "Olm\|Megolm\|decrypt_megolm\|crypto\.db\|OlmMachine\|PgCryptoStore" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
$ grep -r "libolm\|matrix-nio\|@matrix-org/olm" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果（package.json 也无 matrix SDK 依赖）
```
类比：EvoClaw 的加密栈是应用级 AES-256-GCM（凭据保护，`ring` crate）+ 微信媒体级 AES-128-ECB（`weixin-crypto.ts`），**无任何 Matrix 协议级 E2EE 实现**。TS 生态等价物是 `matrix-js-sdk` + `@matrix-org/matrix-sdk-crypto-wasm` 或 `@matrix-org/olm`。

**判定 🔴**：完全缺失。**这是 Matrix 适配器最重且最有风险的子系统**——E2EE 一旦接入，必须同时处理：密钥上传/查询/声明、to-device 消息、Megolm session 轮换、设备交叉签名、恢复密钥、crypto.db 并发锁（mautrix `aiosqlite` 已有此问题见 hermes `.research/19e-matrix.md §7 未解之谜`）。若 EvoClaw 选择**先只支持非加密房间**，可作为 P1 延后，但企业场景很多强制全 E2EE。

---

### §3.8 Federation（跨 homeserver 互通）

**hermes**（`.research/19e-matrix.md §1 定位 + §3.6 出站分支 `is_falling_back=True``）—— Federation **隐含**在 Matrix 协议层面：mxid（`@user:server.com`）本身即包含 homeserver 后缀，Client-Server API 把跨服务器路由委托给本地 homeserver；hermes 代码层**无显式 federation 处理**，仅在 mention 解析（`_is_bot_mentioned()` L1787-1816）中需要处理 `matrix.to/#/@user:server` 链接格式。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "matrix\.to\|federation\|@.*:.*\.matrix\.org" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
**注**：EvoClaw 国内 IM 渠道（weixin / wecom / feishu）全是**集中式 API**，**无 federation 概念**；Matrix 是 EvoClaw 需要接入的**第一个联邦协议**（除非先上 ActivityPub/Fediverse）。

**判定 🔴**：完全缺失。Federation 不需要 EvoClaw 侧显式实现（委托给 homeserver），但 mxid 解析（`@localpart:server.tld`）、matrix.to 链接格式、跨服 room 别名（`#room-alias:server.tld`）等**字符串格式 / URI 解析**需要新建常量与解析函数。

---

### §3.9 Presence（online / idle / offline）

**hermes**（`.research/19e-matrix.md` 未单独章节描述，但 mautrix SDK 天然支持 `EventType.PRESENCE`） — hermes 当前代码在 `connect()` / `_sync_loop` 未显式订阅 presence 事件，说明该特性**未启用**，仅依赖 `handle_sync()` 的默认行为。即 hermes 的"使用深度"也比较浅。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "presence\|set_presence" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/channel/
# 零结果
```

**判定 🔴**：完全缺失。hermes 也未深度使用 presence，EvoClaw 补齐优先级可视为 **P2**（选做）—— Bot 场景通常不需要发 presence（发了反而暴露 bot 在线时间模式，有隐私考虑）。

---

### §3.10 Threads（m.thread 线程回复 + 跨重启参与持久化）

**hermes**（`.research/19e-matrix.md §3.3, §3.6` + `matrix.py:L218, L1133-1196, L687-691`）:

- **入站**：`_resolve_message_context()`（L1133-1196）解析 `m.relates_to.rel_type == "m.thread"` → 记录 thread_id；DM 可配置 `mention-thread`（DM 自动进线程）/ 群组可配置 `auto-thread`（自动为每条新消息开 thread）。
- **出站**：`send()`（L687-691）若 metadata 含 `thread_id` 则添加 `m.relates_to: { rel_type: "m.thread", event_id: thread_id, is_falling_back: True }`（`is_falling_back` 语义：老客户端看不到 thread 时降级为普通 reply）。
- **持久化**：`ThreadParticipationTracker("matrix")` 跨重启记录 bot 参与过的所有 thread → `~/.hermes/matrix_threads.json`。重启后 bot 仍会响应历史 thread 里的新消息（无需再 mention）。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "m\.thread\|ThreadParticipationTracker\|thread.*tracker" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
**注**：EvoClaw 的 Session Key 路由（`agent:<agentId>:<channel>:<dm|group>:<peerId>`）当前**无 thread 维度**，若支持 Matrix thread，需扩展为 `agent:<agentId>:matrix:<dm|group>:<roomId>:<threadId>`，否则同 room 不同 thread 会话串话。

**判定 🔴**：完全缺失。SessionKey 扩展 + ThreadTracker 持久化都需新建。

---

### §3.11 Reactions（m.reaction / m.annotation + 生命周期）

**hermes**（`.research/19e-matrix.md §3.5, §4.8` + `matrix.py:L1432-1522, L1464-1496`）—— 👀→✅/❌ 生命周期:

```python
# matrix.py:L1464-1496
async def on_processing_start(self, event: MessageEvent):
    if not self._reactions_enabled: return
    reaction_event_id = await self._send_reaction(event.source.chat_id, event.message_id, "\U0001f440")  # 👀
    if reaction_event_id:
        self._pending_reactions[(event.source.chat_id, event.message_id)] = reaction_event_id

async def on_processing_complete(self, event, outcome):
    if outcome == ProcessingOutcome.CANCELLED: return
    reaction_key = (event.source.chat_id, event.message_id)
    if reaction_key in self._pending_reactions:
        await self._redact_reaction(event.source.chat_id, self._pending_reactions.pop(reaction_key))
    await self._send_reaction(event.source.chat_id, event.message_id,
                              "\u2705" if outcome == ProcessingOutcome.SUCCESS else "\u274c")  # ✅ / ❌
```

底层是 `m.reaction` 事件（`m.annotation` 关系类型）+ redact 撤销机制。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "m\.reaction\|m\.annotation\|set_message_reaction\|_send_reaction" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
**跨渠道 Gap**：EvoClaw **所有渠道都无 reaction 机制**——weixin/wecom/feishu 没有"消息已读的 bot 视觉反馈"等价物，这是 Matrix/Telegram/Discord 独有的 UX 形态。

**判定 🔴**：完全缺失。此为跨渠道维度的统一空白，属于"IM 上下行端到端实时反馈"未覆盖。

---

### §3.12 DM / Mention / Bot 识别（MSC3952 四层优先级）

**hermes**（`.research/19e-matrix.md §3.5` + `matrix.py:L1739-1816`）:

- **DM 双路径**（`_is_dm_room()` L1739-1752）：`m.direct` 账户数据缓存 + 成员数==2 fallback。
- **Mention 四层优先级**（`_is_bot_mentioned()` L1787-1816）:
  1. `m.mentions.user_ids`（MSC3952 权威信号，最高优先级）
  2. body 包含完整 `@user:server`
  3. localpart 正则（`\b user \b` 词边界）
  4. `formatted_body` 中 `matrix.to` 链接
- **Application Service 区分**：hermes 是普通 Client Bot（非 AS）——AS 会在 mxid / device 标识上不同（如 `@_bot_xxx:server`），AS 由 homeserver 管理员创建专用 HS API token，hermes 当前**不支持** AS 模式。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "MSC3952\|m\.mentions\|_is_bot_mentioned" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
**类比**：`packages/core/src/channel/message-normalizer.ts:8-41` 的 `normalizeFeishuMessage` 已区分 `chat_type === 'p2p' ? 'private' : 'group'`，chatType 模板可复用，但 Matrix mention 的**四层语义层级** + MSC3952 扩展字段解析完全无对应。

**判定 🔴**：完全缺失。chatType 抽象可迁移，mention 语义需从零实现。

---

### §3.13 Rate Limit（homeserver 侧 M_LIMIT_EXCEEDED）

**hermes**（`.research/19e-matrix.md` 未详述，但 homeserver 返回 `M_LIMIT_EXCEEDED` 带 `retry_after_ms` 字段，mautrix 内部会抛对应异常） —— hermes 当前代码**依赖 mautrix SDK 的默认重试**，`_sync_loop` 层仅对 401/403 做永久停止，其它异常 5s 退避一次（L1006-1011）。rate limit 语义与 Synapse/Dendrite 各自的限流配置强相关。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "M_LIMIT_EXCEEDED\|retry_after_ms\|matrix.*rate" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```

**判定 🔴**：完全缺失。EvoClaw 通用重试框架（`packages/core/src/agent/kernel/` retry 路径，见 `05-agent-loop-gap.md §3.6`）可接入，但 Matrix 特有的 `M_LIMIT_EXCEEDED` 错误码映射到通用退避需新建。

---

### §3.14 编辑（m.replace + m.new_content + `*` 前缀）

**hermes**（`.research/19e-matrix.md §3.7, §4.7` + `matrix.py:L740-772`）:

```python
# matrix.py:L740-772
async def edit_message(self, chat_id, message_id, content) -> SendResult:
    formatted = self.format_message(content)
    msg_content = {
        "msgtype": "m.text", "body": f"* {formatted}",  # `*` 前缀（旧客户端看到的"编辑历史"标记）
        "m.new_content": {"msgtype": "m.text", "body": formatted},
        "m.relates_to": {"rel_type": "m.replace", "event_id": message_id},
    }
    html = self._markdown_to_html(formatted)
    if html and html != formatted:
        msg_content["m.new_content"]["format"] = "org.matrix.custom.html"
        msg_content["m.new_content"]["formatted_body"] = html
    event_id = await self._client.send_message_event(RoomID(chat_id), EventType.ROOM_MESSAGE, msg_content)
    return SendResult(success=True, message_id=str(event_id))
```

**EvoClaw**（缺失证据）:
```bash
$ grep -r "m\.replace\|m\.new_content\|editMessage\|edit_message" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/channel/
# 零结果
```
**跨渠道 Gap**：EvoClaw **所有渠道都无消息编辑能力**——是"一次性发送"模型，无法支持 Telegram/Matrix/Discord 的"流式 edit 覆盖最新消息"UX（见 `19a-telegram-gap.md §3.9` 同一痛点）。

**判定 🔴**：完全缺失，且是**跨渠道未覆盖的维度**。补齐 Matrix 编辑的同时应顺便抽象跨渠道的 `editMessage` 接口。

---

### §3.15 Markdown → HTML（custom.html format + fallback）

**hermes**（`.research/19e-matrix.md §3.6` + `matrix.py:L621-699, L1828+`）—— `_markdown_to_html()` 主流程使用 `markdown` 包（CommonMark）；`_markdown_to_html_fallback()` 降级为正则（覆盖基础语法）；最终在 Matrix 消息事件 content 添加:

```python
msg_content["format"] = "org.matrix.custom.html"
msg_content["formatted_body"] = html
```

E2EE 场景下发失败时会执行 `share_keys()` 后重发（`matrix.py:L621-699`）。

**EvoClaw**（缺失证据）:
```bash
$ grep -r "org\.matrix\.custom\.html\|formatted_body\|markdown_to_html" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
**类比**：`weixin-markdown.ts`（80 行）实现 `Markdown → 纯文本` 降级，方向上与 Matrix 的 `Markdown → 客户端 HTML` 相反但思路（格式转换 + 失败降级）一致。

**判定 🔴**：完全缺失。Matrix `org.matrix.custom.html` 需要完整 Markdown→HTML 管道（EvoClaw 可考虑引入 `marked` / `markdown-it` + `DOMPurify` 做 sanitize），远比 weixin 的"降级到纯文本"复杂。

---

## 4. 建议改造蓝图（不承诺实施）

> **前提**：仅当产品决策明确"面向联邦化 / 开源社区 / 去中心化 IM 生态"或"企业私有部署 Synapse"时才启动。当前 EvoClaw 定位"企业级国内用户"，Matrix 优先级天然靠后；且 Matrix E2EE 实现风险极高（OlmMachine + Megolm + Device 交叉签名是单独的大子系统）。

### P0（必须，启动 Matrix 渠道即须覆盖） — 预计 2-2.5 人周（**不含 E2EE**）

| 项 | 范围 | 工作量 | ROI |
|---|---|---|---|
| P0-1 | 扩展 `ChannelType` 加 `'matrix'`（`packages/shared/src/types/channel.ts`），新建 `packages/core/src/channel/adapters/matrix.ts` 骨架，实现 `ChannelAdapter` 接口 | 0.5d | ★★★ 架构入口 |
| P0-2 | Homeserver 连接 + 认证双路径（Token + Password + 稳定 device_id） | 1.5d | ★★★ 协议层 |
| P0-3 | Long-polling sync 循环（`next_batch` cursor + 401/403 永久停止 + 5s 退避） | 2d | ★★★ 入站心脏 |
| P0-4 | 消息 normalizer：`m.text` / `m.image` / `m.audio` / `m.video` / `m.file` → `ChannelMessage` | 1.5d | ★★★ 入站归一化 |
| P0-5 | 出站 `send_message_event`（文本 + `m.relates_to.m.in_reply_to` 回复） | 1d | ★★★ |
| P0-6 | Markdown → HTML 管道（`org.matrix.custom.html` + DOMPurify sanitize） | 1.5d | ★★★ 富文本必需 |
| P0-7 | DM / Mention 识别（`m.direct` 缓存 + MSC3952 四层优先级） | 1d | ★★★ 群聊必需 |
| P0-8 | 编辑 `m.replace` + `m.new_content` + `*` 前缀（同时抽象跨渠道 `editMessage` 接口） | 1.5d | ★★★ UX 飞跃 |
| P0-9 | 错误映射（`M_LIMIT_EXCEEDED` / `M_UNKNOWN_TOKEN` / mautrix 异常 → EvoClaw 通用 retry） | 1d | ★★ |
| P0-10 | 启动期 grace（忽略 5s 前旧消息）+ 事件去重（deque 1000） | 0.5d | ★★ 防重复响应 |

### P1（强推荐，进入生产前补齐） — 预计 3-4 人周（**含 E2EE**）

| 项 | 范围 | 工作量 | ROI |
|---|---|---|---|
| P1-1 | **E2EE 子系统**：`matrix-js-sdk` + `@matrix-org/matrix-sdk-crypto-wasm` 集成；crypto.db SQLite（可复用 EvoClaw bun:sqlite）；OlmMachine 等价的 session 管理；`_verify_device_keys_on_server` | 2w | ★★★ 企业私域基石 |
| P1-2 | Megolm 解密缓冲 + 重试（100 上限 / 300s TTL / `decrypt_megolm_event` pattern） | 3d | ★★★ E2EE 边界 |
| P1-3 | Threads 支持（m.thread + is_falling_back + ThreadParticipationTracker 持久化到 `~/.evoclaw/matrix_threads.json`）+ SessionKey 扩展 threadId 维度 | 3d | ★★ 现代 Matrix 必需 |
| P1-4 | Reactions 生命周期（👀 → ✅/❌ + redact 撤销） | 1.5d | ★★ 精致化体验 |
| P1-5 | 媒体出站（sendImage / sendVoice MSC3245 / sendDocument / sendVideo）+ `mxc://` URI 解析 + `decrypt_attachment`（AES-256-CTR） | 3d | ★★ |
| P1-6 | 跨渠道 `editMessage` 抽象（同时提升 telegram / discord） | 2d | ★★★ 架构红利 |

### P2（选做）

| 项 | 范围 | 工作量 | ROI |
|---|---|---|---|
| P2-1 | Presence 订阅与上报（online/idle/offline） | 1d | ★ hermes 也未深度启用 |
| P2-2 | Room 主动管理 API（create/invite/leave） | 2d | ★ 仅企业客服 room 自动化场景有价值 |
| P2-3 | Recovery Key 交叉签名自验证 | 2d | ★ 仅严格合规场景 |
| P2-4 | `matrix_threads.json` 文件锁（多进程并发保护，hermes 未解之谜之一） | 0.5d | ★ |

### 不建议做

- **Application Service 模式**：hermes 也未支持；AS 要求 homeserver 管理员权限注册 app service，EvoClaw 作为用户侧产品不应走这条路。
- **自建 Synapse/Dendrite**：这是运维范畴，不属于 EvoClaw 适配器职责；可在文档推荐用户自部署。
- **MTProto / 其它自定义协议**：Matrix 就是为了对标联邦开放协议，不应偏离 Client-Server API。

---

## 5. EvoClaw 反超点汇总（无反超，列出可迁移资产）

> **本章节 EvoClaw 无明显反超（整体缺失）**；以下为**可迁移资产**——EvoClaw 已有的通用能力在补齐 Matrix 时可直接复用，缩短工期。

| 可迁移资产 | 代码证据 | 迁移到 Matrix 的价值 |
|---|---|---|
| **`ChannelAdapter` 统一抽象** | `packages/core/src/channel/channel-adapter.ts:31` `export interface ChannelAdapter`（9 个方法），`channel-manager.ts` 注册/重连机制，4 个现有 adapter（`FeishuAdapter:23` / `WeixinAdapter:67` / `WecomAdapter:26` / `DesktopAdapter:16`）都 `implements ChannelAdapter` 作为参考实现 | 新 `MatrixAdapter` 实现该接口即无缝接入 ChannelManager / 自动重连 / 全局消息回调。Hermes `BasePlatformAdapter` 的 N 项复刻清单中约半数由 EvoClaw 抽象天然覆盖 |
| **Session Key 多层路由** | `packages/core/src/__tests__/session-key.test.ts` session key 格式 `agent:<agentId>:<channel>:<direct\|group>:<peerId>` 完整测试 | Matrix DM / group room / thread 的会话隔离可套用，thread 维度可扩展为 `agent:<id>:matrix:<dm\|group>:<roomId>:<threadId>` |
| **BindingRouter 精确优先匹配** | `packages/core/src/routing/binding-router.ts`（最具体优先匹配，Channel → Agent 绑定，CLAUDE.md 声明） | Matrix user_id / room_id → Agent 绑定逻辑无需新建 |
| **长轮询工程模板** | `packages/core/src/channel/adapters/weixin.ts`（529 行，iLink Bot long polling + 错误恢复 + 断线重连） | Matrix `sync(since=next_batch, timeout=30000)` 循环的代码结构可 1:1 参考；cursor 从数字 offset 换成 string token 即可 |
| **媒体管线模板** | `weixin-upload.ts` 237 + `weixin-send-media.ts` 217 + `weixin-cdn.ts` 159 + `weixin-crypto.ts` 91（AES-128-ECB） + `weixin-mime.ts` 98 + `weixin-silk.ts` 138 | Matrix `mxc://` 上传下载、加密附件 AES-256-CTR（注意：Matrix 是 CTR，weixin 是 ECB，算法实现不同但工程管线同形）、MIME 识别、本地缓存逻辑可复用 |
| **Markdown 降级器模板** | `weixin-markdown.ts` 80 行（Markdown → 纯文本降级） | Matrix `Markdown → HTML` + HTML 失败降级到纯文本的 fallback 路径思路可参考；Matrix 正向比 weixin 复杂（需引入 DOMPurify），反向降级同形 |
| **凭据 Keychain 存储** | CLAUDE.md 声明 `macOS Keychain (security-framework) + AES-256-GCM (ring)` | `MATRIX_ACCESS_TOKEN` / `MATRIX_PASSWORD` / `MATRIX_DEVICE_ID` 可直接落 Keychain，无需为 Matrix 单独设计凭据保护 |
| **bun:sqlite + WAL** | CLAUDE.md `bun:sqlite / better-sqlite3（运行时自动选择）+ WAL 模式，MigrationRunner 自动执行 migrations` | Matrix `crypto.db`（OlmMachine state）可直接用 EvoClaw 现有 sqlite 基础设施，无需另起 `aiosqlite`；加上 WAL 模式天然缓解 hermes `.research/19e-matrix.md §7` 提到的"crypto.db 并发锁争用"未解之谜 |
| **Debug 追踪模板** | `weixin-debug.ts` 84 行全链路 debug 记录 | Matrix 事件链（sync → handle_sync → decrypt → dispatch）的观测可直接套用 |
| **PII 脱敏** | `weixin-redact.ts` 60 + `packages/core/src/infrastructure/logger.ts` `sanitizePII()`（CLAUDE.md 声明自动脱敏 API Key / Bearer / JWT / 邮箱 / 手机号） | Matrix 日志中的 access_token / user_id / room_id / event_id 可自动脱敏 |
| **通用重试框架** | `packages/core/src/agent/kernel/` retry / fallback 能力（`05-agent-loop-gap.md §3.6`） | `M_LIMIT_EXCEEDED` / 401-403 / 5xx 可包装进现有重试框架 |
| **优雅关闭 registerShutdownHandler** | CLAUDE.md 声明 `SIGTERM/SIGINT → registerShutdownHandler 按优先级串行执行` | Matrix sync 循环的 `self._closing = True` + crypto.db `close()` 可注册为关闭钩子，与调度器 / DB / 日志统一生命周期 |
| **企业扩展包 / 安全策略** | CLAUDE.md 声明 `evoclaw-pack.json manifest + 统一 NameSecurityPolicy` | MATRIX_ALLOWED_USERS / MATRIX_FREE_RESPONSE_ROOMS 白名单可复用 NameSecurityPolicy allowlist/denylist 机制 |

**结论**：EvoClaw 在"国内渠道 + 通用基础设施"上的工程资产**能显著降低** Matrix 适配器的构建成本——尤其 `bun:sqlite + WAL` 作为 crypto store 可比 hermes `aiosqlite` 更稳；`ChannelAdapter` 抽象使 ChannelManager 生命周期、BindingRouter、SessionKey 路由无需为 Matrix 单独设计。但**E2EE（P1-1/P1-2）是独立的大子系统**，其复杂度远超任何其它渠道，是 Matrix 工期的绝对瓶颈。乐观估计 P0（不含 E2EE）+ 部分 P1 = 4-5 人周，完整 P0+P1 含 E2EE = 6-8 人周。

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（已 Grep/Read/Bash 验证 2026-04-16）

1. `ls packages/core/src/channel/adapters/` — 16 个文件，仅 `desktop.ts / feishu.ts / wecom.ts / weixin-*.ts`，**无 `matrix.ts`**。
2. `packages/shared/src/types/channel.ts:2` — `export type ChannelType = 'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq' | 'weixin'` — **无 `'matrix'`**。
3. `grep -r -i "matrix" packages/core/src/` 命中 5 个文件，**全部无关**:
   - `packages/core/src/context/plugins/context-assembler.ts:17` `const FILE_LOAD_MATRIX: Record<string, { bootstrap: boolean; beforeTurn: boolean }>`（Agent 工作区 9 文件加载矩阵）
   - `packages/core/src/context/plugins/context-assembler.ts:54-68` `for (const [file, matrix] of Object.entries(FILE_LOAD_MATRIX))`
   - `packages/core/src/memory/hybrid-searcher.ts:222-229` `const matrix: Record<QueryType, Record<string, number>>`（记忆检索权重矩阵）
   - `packages/core/src/skill/bundled/agent-browser-clawdbot/SKILL.md:205` `Skill created by Yossi Elkrief ([@MaTriXy]...)`（作者昵称）
   - `packages/core/src/skill/bundled/planning-with-files/SKILL.md:163` `## Read vs Write Decision Matrix`（文档标题）
   - `packages/core/src/skill/bundled/playwright-scraper-skill/SKILL.md:15` `## 🎯 Use Case Matrix`（文档标题）
4. `grep -r -i "matrix" packages/shared/src/` — **零结果**。
5. `grep -r "homeserver\|HTTPAPI\|mautrix\|OlmMachine\|Megolm\|decrypt_megolm" packages/core/src/` — **零结果**（每一个关键字均独立验证）。
6. `grep -r "next_batch\|sync_store\|handle_sync" packages/core/src/` — **零结果**。
7. `grep -r "mxc://\|m\.image\|m\.audio\|MSC3245\|m\.reaction\|m\.thread\|m\.replace\|m\.new_content" packages/core/src/` — **零结果**（6 个 Matrix 事件类型关键字全零）。
8. `grep -r "MATRIX_ACCESS_TOKEN\|MATRIX_DEVICE_ID\|MATRIX_HOMESERVER\|MATRIX_USER_ID\|MATRIX_ALLOWED_USERS" packages/core/src/` — **零结果**。
9. `grep -r "org\.matrix\.custom\.html\|formatted_body\|markdown_to_html" packages/core/src/` — **零结果**。
10. `grep -r "MSC3952\|m\.mentions\|_is_bot_mentioned" packages/core/src/` — **零结果**。
11. `grep -r "libolm\|matrix-nio\|matrix-js-sdk\|@matrix-org" packages/core/src/` — **零结果**（依赖层也确认无 Matrix SDK）。
12. `packages/core/src/channel/channel-adapter.ts:31` — `export interface ChannelAdapter`（可迁移基础）。
13. `packages/core/src/channel/adapters/feishu.ts:23` + `wecom.ts:26` + `weixin.ts:67` + `desktop.ts:16` — 4 个现有 adapter `implements ChannelAdapter` 的参考实现。
14. `wc -l packages/core/src/channel/adapters/*.ts` — 16 文件共 2845 行，weixin 全家桶 2067 行，无 matrix 贡献。

### 6.2 hermes 研究引用（章节 §）

- `.research/19e-matrix.md §1` 角色与定位（2023 行，基于 mautrix-python 全量重写，替代 matrix-nio）
- `.research/19e-matrix.md §2` 目录/文件分布（`matrix.py` + `crypto.db` + `matrix_threads.json` + 依赖 `mautrix[encryption]`）
- `.research/19e-matrix.md §3.1` `connect()` 登录（L373-592） — Token / Password 双路径 + E2EE 初始化
- `.research/19e-matrix.md §3.2` `_sync_loop()`（L959-1016） — 长轮询 + next_batch cursor + handle_sync 分发 + 401/403 永久停止 + 5s 退避
- `.research/19e-matrix.md §3.3` 入站文本（L1074-1257） — `_on_room_message` 单一入口 + `_resolve_message_context` + `_handle_text_message` + Text Batching
- `.research/19e-matrix.md §3.4` 入站媒体（L1259-1390） — msgtype 分发 + mxc→HTTP + `decrypt_attachment` + MSC3245 voice + 条件缓存
- `.research/19e-matrix.md §3.5` DM / Mention / Thread — DM 双路径（`m.direct` + 成员数==2） + Mention 四层（MSC3952 / 完整 ID / localpart / matrix.to） + ThreadParticipationTracker 持久化
- `.research/19e-matrix.md §3.6` 出站文本 `send()`（L621-699） — 格式化 + 分块 4000 + Markdown→HTML + reply + thread + E2EE 重试
- `.research/19e-matrix.md §3.7` 编辑 `edit_message()`（L740-772） — `m.replace` + `m.new_content` + `*` 前缀
- `.research/19e-matrix.md §3.8` 媒体出站（L774-860） — 5 个方法（send_voice / send_image_file / send_document / send_video / send_image / send_animation）
- `.research/19e-matrix.md §4.1` 构造器关键字段（L203-268） — `_dm_rooms` / `_joined_rooms` / `_processed_events` / `_pending_megolm` / `_threads` / `_text_batch_*`
- `.research/19e-matrix.md §4.2` connect() 认证与 E2EE（L373-536） — HTTPAPI + Client + OlmMachine + PgCryptoStore + `_verify_device_keys_on_server`
- `.research/19e-matrix.md §4.5` Megolm 重试缓冲（L1018-1068 + L1394-1409） — `_pending_megolm` 硬上限 100 + TTL 300s
- `.research/19e-matrix.md §4.8` Reaction 生命周期（L1464-1496） — on_processing_start(👀) / on_processing_complete(✅/❌) + redact
- `.research/19e-matrix.md §5` 与其它模块交互（BasePlatformAdapter / mautrix.client.Client + HTTPAPI / OlmMachine / `_CryptoStateStore` / ThreadParticipationTracker / build_session_key / 媒体缓存）
- `.research/19e-matrix.md §6` 复刻清单 22 项（Token 优先认证 / Password 降级 / 稳定 device_id / E2EE crypto.db / OlmMachine 初始化 / `_verify_device_keys_on_server` / `_CryptoStateStore` 适配器 / handle_sync 事件分发 / sync 长轮询 / startup grace / 事件去重 / Megolm 缓冲 / Megolm 重试 / DM 双路径 / Mention 四层 / Thread 检测 / Text Batching / 出站文本 / 编辑 / MSC3245 voice / Reaction 生命周期 / 白名单）
- `.research/19e-matrix.md §7` 未解之谜（crypto.db 并发锁争用 / device_id rotation / matrix_threads.json 无文件锁 / Markdown fallback 复杂嵌套 / processed_events 窗口不足 / MSC3245 voice 兼容性 / decrypt_attachment 静默失败 / Recovery Key 过期）
- `.research/19e-matrix.md 历史变更记录` — 从 matrix-nio 到 mautrix-python 的迁移（客户端 / 认证 / 事件注册 / E2EE / crypto store / 设备信任 / Text Batching）

### 6.3 关联差距章节（crosslink）

- **[`./19-gateway-platforms-gap.md`](./19-gateway-platforms-gap.md)**（同批，总览）— Gateway 平台适配器架构对比 / `BasePlatformAdapter` vs `ChannelAdapter`
- **[`./19a-telegram-gap.md`](./19a-telegram-gap.md)**（同批）— Telegram 适配器，与 Matrix 同为"出海国际平台"，长轮询 + 媒体管线模板可互借
- **[`./19b-discord-gap.md`](./19b-discord-gap.md)**（同批）— Discord 适配器，Inline Keyboard / 反应表情 UX 可互借
- **[`./19c-slack-gap.md`](./19c-slack-gap.md)**（同批）— Slack 企业 IM，编辑消息 / 线程模式可互借
- **[`./19d-signal-gap.md`](./19d-signal-gap.md)**（同批）— Signal E2EE IM，E2EE 子系统经验直接互借（Signal Protocol 与 Olm/Megolm 思路相近）
- **[`./19f-whatsapp-gap.md`](./19f-whatsapp-gap.md)**（未来）— WhatsApp Business API，E2EE 子系统经验可互借
- **[`./05-agent-loop-gap.md`](./05-agent-loop-gap.md) §3.6** — Retry / Fallback 框架（Matrix `M_LIMIT_EXCEEDED` / 401-403 可接入）
- **[`./14-state-sessions-gap.md`](./14-state-sessions-gap.md)**（已完成）— Session Key 扩展 threadId 维度
- **[`./29-security-approval-gap.md`](./29-security-approval-gap.md)**（未来）— 审批系统与白名单 / recovery key 交互点

---

**本章完成**。所有 15 个机制均基于 grep 零结果或跨文件误匹配证据判定为 🔴，无反超点；可迁移资产集中在 ChannelAdapter 抽象 / SessionKey / BindingRouter / 长轮询 / 媒体管线 / bun:sqlite WAL / Keychain / registerShutdownHandler / 安全策略 / PII 脱敏等 13 项 EvoClaw 已有能力。E2EE（OlmMachine + Megolm + Device 交叉签名）是最大风险子系统，工期占比约 40-50%。
