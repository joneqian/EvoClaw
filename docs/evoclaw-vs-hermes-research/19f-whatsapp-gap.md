# 19f — WhatsApp 渠道集成 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/19f-whatsapp.md`（hermes `gateway/platforms/whatsapp.py` 941→989 行 Python 适配器 + `scripts/whatsapp-bridge/bridge.js` 571 行 Node Baileys 桥 + `allowlist.js` 84 行；@ `00ff9a26` 2026-04-16）
> **hermes 基线**: commit `00ff9a26`（2026-04-16，含 drift audit：`MAX_MESSAGE_LENGTH` 65536→4096、新增 `format_message` 56 行、`send()` 分块 +25 行、平台锁基类化 -27 行）
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16）
> **综合判定**: 🔴 **整体缺失**（无任何 WhatsApp / Baileys / Node bridge 实现；但 `ChannelAdapter` 抽象、iLink Bot QR 扫码 + 长轮询 + 媒体 CDN 管线、命令分发、PII 脱敏等 **13 项通用 / 类微信** 资产可迁移——详见 §5）

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes `WhatsAppAdapter`**（`.research/19f-whatsapp.md §1-§3`） — Hermes Gateway 中**唯一的双进程架构**平台适配器：Python 侧 `gateway/platforms/whatsapp.py`（941→989 行）**不直接和 WhatsApp 协议对话**，而是通过 HTTP（默认端口 `3000`）与子进程 `scripts/whatsapp-bridge/bridge.js`（571 行，基于 `@whiskeysockets/baileys@7.0.0-rc.9`）通信；Bridge 负责 QR 扫码登录、`useMultiFileAuthState` 会话持久化（`session/creds.json`）、媒体下载（`~/.hermes/{image,audio,document}_cache/`）、消息队列（maxlen=100）、自消息去重缓存（maxlen=50）。访问控制**集中**在 `allowlist.js` 84 行，以 `lid`↔phone BFS 展开 `lid-mapping-*.json` 作为身份归一；Python 侧不做二次过滤。消息类型覆盖 Text / Image / Video / Audio / PTT（语音）/ Document，文本类文档 ≤100KB 内联注入消息正文。drift audit（2026-04-16）新增 `format_message(content)` 56 行把 Markdown 转成 WhatsApp 格式（`**`→`*`、保护 code block、header→bold、link 转换），`send()` 用 `MAX_MESSAGE_LENGTH=4096` 分块（旧为 65536 UX 不可读）。

**EvoClaw WhatsApp 渠道**（不存在） — `packages/core/src/channel/adapters/` 16 个文件共 2845 行（见 §6.1 #1），**无 `whatsapp.ts` / 无 Node bridge 目录 / 无 Baileys 依赖**；`packages/shared/src/types/channel.ts:2` 的 `ChannelType = 'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq' | 'weixin'` **不包含 'whatsapp'**。`grep -rni "whatsapp\|baileys\|qrcode-terminal" packages/` 仅命中 0 条源码（docs/research 目录不计）。全项目无任何 WhatsApp Business API / Baileys 协议 / QR 扫码（WhatsApp 侧）/ `@s.whatsapp.net` JID / `lid` 身份 / Megolm 等价密钥管理的实现。最相近的**参照物**是 `weixin` 全家桶（CLAUDE.md 声明："iLink Bot 长轮询、QR 扫码登录、CDN+AES-128-ECB 媒体管线、context_token 回传、Markdown→纯文本降级、`/echo` + `/toggle-debug` Slash 命令、全链路 Debug 追踪、SILK 语音转码"）——与 hermes WhatsApp 形态同构（都是 QR 扫码 + 长轮询 + 媒体管线），但协议 / 加密 / 身份体系完全不同。

**量级对比**: hermes 单 WhatsApp 平台 `whatsapp.py 989 + bridge.js 571 + allowlist.js 84 = 1644` 行 ≈ EvoClaw weixin 全家栈 `2067 行`（16 文件里 weixin-* 占 14 个）的 **80%**。形态上两者都是"单一最复杂渠道"——QR 登录 + 长轮询 + 媒体管线 + 自进程媒体缓存——但 hermes 选择**多语言双进程**（Python 不懂 WhatsApp 协议，Node 桥接），EvoClaw weixin 选择**单语言 TypeScript 原生**。若未来 EvoClaw 补齐 WhatsApp，理论上也应走 Node bridge 模式（Baileys 是 Node 生态事实标准，没有成熟的 Bun/TS 原生替代），这引入 EvoClaw 以往**未使用过的跨进程 HTTP + subprocess 生命周期管理**能力。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 双进程架构（Python client + Node Baileys bridge） | 🔴 | grep 零结果；EvoClaw 所有渠道都在 TS 单进程，无 subprocess + HTTP 桥范式 |
| §3.2 | Bridge 生命周期（spawn + `os.setsid` 独立进程组 + `/health` 复用 + 杀端口残留） | 🔴 | grep 零结果；`spawn`/`setsid`/`fuser`/`taskkill` 在 channel 层零命中 |
| §3.3 | Node 依赖前置检查 + `npm install`（60s 超时） | 🔴 | grep 零结果；无跨语言 runtime 准入 |
| §3.4 | 会话路径锁 + 多实例互斥（`acquire_scoped_lock`） | 🔴 | grep 零结果；无 per-session 锁机制 |
| §3.5 | QR 扫码登录 + `useMultiFileAuthState` 会话持久化 | 🟡 | weixin QR 登录模板同构可参考；WhatsApp Baileys creds/keys 结构完全不同 |
| §3.6 | 两阶段就绪（HTTP 15s + WA socket 15s） | 🔴 | grep 零结果；无跨语言就绪协调 |
| §3.7 | 长轮询 30s + 异常 5s 退避 + 正常 1s 间隔 | 🟡 | weixin 长轮询工程模板可复用；但无 `GET /messages?timeout=30000` HTTP 拉取范式 |
| §3.8 | 子进程退出监控（`bridge_process.poll()` + 可重试/致命分类） | 🔴 | grep 零结果；无 subprocess exit code 分类 |
| §3.9 | 消息类型分发（Text / Image / Video / Audio / PTT / Document） | 🟡 | weixin 有同级消息类型分发，但 Document 文本注入（≤100KB）EvoClaw 无对应 |
| §3.10 | 媒体落地到共享缓存 + Python 侧路径读取 | 🟡 | weixin CDN + AES-128-ECB 本地缓存同构；但 WhatsApp `~/.hermes/{type}_cache/` 命名与 AES-256 GCM 不同 |
| §3.11 | Allowlist 集中在 Bridge（lid↔phone BFS 展开） | 🔴 | grep 零结果；EvoClaw 无 channel 级 allowlist 过滤 |
| §3.12 | 群聊响应门控（`REQUIRE_MENTION` + `free_response_chats` + 命令前缀 + 回复 bot + mention） | 🔴 | grep 零结果；命令前缀虽有（/echo），但无 mention/reply/chat_id 白名单多源门控 |
| §3.13 | `format_message` Markdown → WhatsApp 格式（drift 新增） | 🟡 | weixin-markdown Markdown→纯文本方向相反但思路（格式转换 + 失败降级）同构 |
| §3.14 | `MAX_MESSAGE_LENGTH=4096` 分块发送（drift 调低） | 🟡 | weixin `TEXT_CHUNK_LIMIT=4000`（`weixin.ts:53`）同量级；但 WhatsApp 首块才设 replyTo 的语义 EvoClaw 无 |
| §3.15 | Typing 状态（`POST /typing isTyping`） | 🟡 | weixin 有 sendTyping（`weixin.ts:238`），但 ticket 缓存模型不同 |
| §3.16 | 消息编辑（`POST /edit` `messageId`） | 🔴 | grep 零结果；EvoClaw 所有渠道都无消息编辑能力（跨渠道缺口） |
| §3.17 | Bridge 调试日志开关（`WHATSAPP_DEBUG`） | 🟡 | weixin-debug.ts 84 行全链路 Debug 模板可复用；但 Node 侧 verbose 开关需新建 |
| §3.18 | 媒体缓存 / session creds 文件权限与敏感文件保护 | 🔴 | grep 零结果；无 `umask(0o077)` / `chmod 0600` session / 媒体文件的落地保护 |

**统计**: 🔴 11 / 🟡 7 / 🟢 0 — 本章节所有机制都**未被 EvoClaw 覆盖**，但 7 项有 weixin 形态同构的**可迁移模板**（不是直接对齐）。

---

## 3. 机制逐条深度对比

每条同时给出 **hermes 实现**（带 `.research/19f-whatsapp.md §N` / `whatsapp.py:LN` 引用）+ **EvoClaw 实现**（基本均为 grep 缺失证据 + weixin 类比）+ **判定与分析**。

### §3.1 双进程架构（Python client + Node Baileys bridge）

**hermes**（`.research/19f-whatsapp.md §1-§2` + `whatsapp.py:1-148` / `bridge.js:1-571`）—— Python `WhatsAppAdapter` 通过 `aiohttp.ClientSession` 打 Node 子进程 HTTP（端口 3000，`127.0.0.1`）。7 个 HTTP endpoint：`GET /messages` 长轮询、`POST /send`、`POST /edit`、`POST /send-media`、`POST /typing`、`GET /chat/:id`、`GET /health`。Bridge 依赖 `@whiskeysockets/baileys@7.0.0-rc.9` + `express` + `qrcode-terminal` + `pino`。消息字段格式固定 schema（`messageId / chatId / senderId / senderName / chatName / isGroup / body / hasMedia / mediaType / mediaUrls / mentionedIds / quotedParticipant / botIds / timestamp`）。设计动机：WhatsApp 没有官方 Python SDK，Baileys 是 Node 生态事实标准；HTTP schema 锁定后 Python/Node 两端可独立迭代。

```python
# whatsapp.py:103-112
self._bridge_process: subprocess.Popen | None = None
self._bridge_port = int(os.environ.get("WHATSAPP_BRIDGE_PORT", "3000"))
self._bridge_script = Path(__file__).resolve().parents[2] / "scripts/whatsapp-bridge/bridge.js"
self._session_path = Path.home() / ".hermes/whatsapp-session"
self._http_session: aiohttp.ClientSession | None = None
```

**EvoClaw**（缺失证据）:
```bash
$ grep -rn "whatsapp\|Baileys\|bridge\.js\|subprocess.Popen\|child_process.*spawn.*node" \
    /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/ \
    -i
# 源码侧零结果（仅 docs 目录有匹配）
```
EvoClaw 所有现有渠道（`desktop.ts`、`feishu.ts`、`wecom.ts`、`weixin.ts` 及 weixin-* 全家桶）全部在 **Bun/TS 单进程**内运行，无 Node subprocess 子进程 + HTTP 桥接的先例。

**判定 🔴**：完全缺失。双进程架构是**整个子系统的骨架**——EvoClaw 需要先设计 `BridgeProcessManager`（subprocess 生命周期 / 健康探测 / 自动重启 / 优雅关闭），才能承载后续所有子机制。这是 EvoClaw 架构上**第一次**引入跨 runtime 语言边界（目前 Rust Tauri + TS Bun 都是 EvoClaw 自有 runtime，WhatsApp bridge 会引入第三个 Node.js runtime）。

---

### §3.2 Bridge 生命周期（spawn + `os.setsid` 独立进程组 + `/health` 复用 + 杀端口残留）

**hermes**（`.research/19f-whatsapp.md §3.1, §3.7` + `whatsapp.py:35-67, 274-289`）:

- **复用探测**（`connect()` L274-478）：先 `GET http://127.0.0.1:3000/health`，若已运行则跳过 spawn。便于手动调试或 `--pair-only` 配对流程。
- **Spawn 进程组隔离**（L279-283）：`subprocess.Popen(["node", str(self._bridge_script)], preexec_fn=os.setsid)` — `os.setsid` 建立独立进程组，退出时能整组 `SIGTERM` 而不影响父进程。**Windows 不可用**，需按平台分支。
- **杀端口残留**（`_kill_port_process` L35-67）：连接器重启时清掉占端口的孤立 bridge。
  - Linux：`fuser -k 3000/tcp` 或 `netstat` 解析 + `kill`。
  - Windows：`netstat -ano | findstr :3000` → `taskkill /F /PID`。

```python
# whatsapp.py:35-45（Linux 侧精简）
def _kill_port_process(port: int) -> None:
    if sys.platform.startswith("linux"):
        subprocess.run(["fuser", "-k", f"{port}/tcp"], check=False)
```

**EvoClaw**（缺失证据）:
```bash
$ grep -rn "setsid\|preexec_fn\|fuser\|taskkill\|killport" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# channel 层零结果；全项目仅 tools/background-process.ts / async-exec.ts 在 subprocess 维度有（非 bridge 场景）
```
EvoClaw 有 CLAUDE.md 声明的"Bash 安全体系…异步执行引擎（spawn 非阻塞 → AbortController → 超时 SIGTERM/SIGKILL → 大输出持久化）"——但这是 Bash 工具的 subprocess 执行，**非**渠道级别的长生命周期 bridge daemon 管理。

**判定 🔴**：完全缺失。`AbortController` 能做子进程 kill，但**整组进程 kill**（`setsid` 语义）和**端口残留清理**（Linux `fuser` / Win `netstat+taskkill`）EvoClaw 需新建跨平台实现。这类工程细节在 Bun/Node 生态里需用 `node:child_process` 的 `detached: true`（等价 setsid）+ `process.kill(-pid)` 负 PID 整组杀法。

---

### §3.3 Node 依赖前置检查 + `npm install`（60s 超时）

**hermes**（`.research/19f-whatsapp.md §3.1` + `whatsapp.py:275-276`）:

1. `node --version` 探测 → 失败直接抛错。
2. `scripts/whatsapp-bridge/node_modules` 缺失时 `npm install`（60s 超时），避免首次运行卡死。

**EvoClaw**（缺失证据）:
```bash
$ grep -rn "node.*--version\|npm install\|node_modules" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/channel/
# 零结果
```
EvoClaw 目前是纯 Bun runtime，从未在启动路径上要求用户安装 Node.js；全部依赖通过 `pnpm install` 在构建期解决。

**判定 🔴**：完全缺失，且需引入**新的用户约束**。若补齐 WhatsApp，EvoClaw 首次运行时需引导用户安装 Node.js（类比 CLAUDE.md 的"Docker 3 模式 off/selective/all，首次使用时引导安装"——Docker 引导经验可迁移到 Node 引导，但用户感知会增加一个 runtime 依赖）。一个潜在替代是打包 Node runtime 到桌面应用 bundle（类似 Tauri sidecar 打包 bun），但会显著增加发布体积（Node 约 70-100MB）。

---

### §3.4 会话路径锁 + 多实例互斥

**hermes**（`.research/19f-whatsapp.md §3.1` + `whatsapp.py:277`）:

- 以 `~/.hermes/whatsapp-session` 作为 **scoped lock identity**（`acquire_scoped_lock` 跨进程锁），禁止同一账号在多 EvoClaw 实例并发操作 `session/` 目录。
- drift audit 后从 `_session_lock_identity` 手动 lock/unlock 迁移为基类 `self._acquire_platform_lock('whatsapp-session', ...)` 统一管理。

**EvoClaw**（缺失证据）:
```bash
$ grep -rn "acquire_scoped_lock\|acquire_platform_lock\|session.*lock\|flock" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/
# 零结果
```
EvoClaw 无 per-session 跨进程锁机制；`ChannelStateRepo`（`weixin.ts:91` 注入）是**数据存储**（游标持久化），不是**互斥锁**。

**判定 🔴**：完全缺失。多 EvoClaw 实例同时连同一个 WhatsApp 账号会让 Baileys `useMultiFileAuthState` 并发写 `creds.json`，直接损坏 session。需新建平台级 lock 抽象（可基于 `proper-lockfile` npm 包或 bun 原生 `flock`）。

---

### §3.5 QR 扫码登录 + `useMultiFileAuthState` 会话持久化

**hermes**（`.research/19f-whatsapp.md §3.1, §6 复刻清单 16` + `bridge.js` Baileys 调用）:

- 首次运行用 `qrcode-terminal` 交互扫码（终端打印 ASCII QR）。
- Baileys `useMultiFileAuthState` 把 creds / keys 写到 `scripts/whatsapp-bridge/session/`（含 `creds.json` Noise 协议密钥 + pairing secret，以及 Signal 协议的 pre-keys / signed-pre-keys / session 文件）。
- 支持 `--pair-only` 模式仅做配对不启动主流程，便于部署前预配对。

**EvoClaw**（weixin 模板可参考）:
```typescript
// packages/core/src/channel/adapters/weixin.ts:8
 * 1. QR 扫码登录获取 botToken
// packages/core/src/channel/adapters/weixin-api.ts:287
`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(DEFAULT_BOT_TYPE)}`
// packages/core/src/channel/adapters/weixin-types.ts:12-14, 226-228
/** 微信凭证 — QR 扫码登录后获得 */
  /** Bearer token (从 QR 扫码确认后获取) */
  qrcode: string,
  qrcode_img_content: string,
```
EvoClaw weixin QR 扫码返回 **Bearer botToken**（单 token 无复杂密钥），与 WhatsApp Baileys 的 **Noise + Signal 多密钥体系**是同类 UX **不同密码学**：weixin 扫完即得 token 持久化到 `ChannelConfig.credentials`；WhatsApp 扫完需要 `useMultiFileAuthState` 持久化 10+ 文件（creds / pre-keys / sessions / sender-keys）。

**判定 🟡**：UX 模板（QR 图 + 桌面端扫码引导 + 失败重试）可从 weixin 迁移；**密钥持久化结构**需新建。EvoClaw 若用 Node bridge 方案，`useMultiFileAuthState` 直接用 Baileys 原生 API 即可，但需解决"bridge session 目录放哪里"：可选 `~/.evoclaw/whatsapp-session/`（同 hermes 风格）或 `~/Library/Application Support/EvoClaw/whatsapp-session/`（macOS 规范）。另需 `.gitignore` 保护（session 含账号敏感密钥，误提交即账号泄露）。

---

### §3.6 两阶段就绪（HTTP 15s + WA socket 15s）

**hermes**（`.research/19f-whatsapp.md §3.1` + `whatsapp.py:284-285`）:

```python
await self._await_http_ready(timeout=15)       # HTTP server 启动
await self._await_wa_ready(timeout=15)         # Baileys WASocket 连接就绪
self._http_session = aiohttp.ClientSession()
self._poll_task = asyncio.create_task(self._poll_messages())
```

设计动机：HTTP server 起来的时间点**远早于** Baileys 完成 WhatsApp 握手的时间点；若两者合并等，一边超时会误杀另一边；分开等能精确归因 "bridge 启动慢" vs "WhatsApp 网络问题"。

**EvoClaw**（缺失证据）: channel 层无跨语言就绪协调范式；weixin `getConfig()`（`weixin.ts:118-120`）是**单一就绪检查**（验证 token），无"先等 HTTP server 再等 WA socket"的双阶段。

**判定 🔴**：完全缺失。EvoClaw 若引入 bridge，必须同时实现这两个探针，否则 Bridge 的**启动顺序**（HTTP ready ≠ Baileys ready）边界会让用户看到"连接成功但 5 秒内发送消息无响应"的困惑。

---

### §3.7 长轮询 30s + 异常 5s 退避 + 正常 1s 间隔

**hermes**（`.research/19f-whatsapp.md §3.3` + `whatsapp.py:779-811`）:

```python
async def _poll_messages(self) -> None:
    while self._running:
        try:
            self._check_managed_bridge_exit()
            async with self._http_session.get(
                f"http://127.0.0.1:{self._bridge_port}/messages",
                timeout=aiohttp.ClientTimeout(total=35),      # 客户端 35s > 服务端 30s
            ) as resp:
                msgs = await resp.json()
            for m in msgs:
                await self._dispatch(m)
        except Exception as exc:
            log.warning("whatsapp poll error: %s", exc)
            await asyncio.sleep(5)                             # 异常退避
            continue
        await asyncio.sleep(1)                                 # 正常循环间隔
```

关键数值：服务端 timeout `30s`（`GET /messages?timeout=30000`）→ 客户端 `35s`（多 5s 容忍网络延迟）→ 异常 `5s` 退避 → 正常 `1s` 间隔防空队列打满 CPU。

**EvoClaw**（weixin 同构模板）:
```typescript
// packages/core/src/channel/adapters/weixin.ts:56-62, 295, 301-320
const MAX_CONSECUTIVE_FAILURES = 3;       // 连续失败阈值
const MAX_BACKOFF_MS = 30_000;             // 退避延迟上限
const BASE_BACKOFF_MS = 2_000;             // 基础退避
// ...
log.info('长轮询循环已启动');
// ...
const resp = await getUpdates({ ... getUpdatesBuf: this.getUpdatesBuf, ... });
// 游标持久化 (断点续传)
this.getUpdatesBuf = resp.get_updates_buf;
this.stateRepo.setState('weixin', STATE_KEY_BUF, this.getUpdatesBuf);
```
weixin 长轮询走的是 `POST getUpdates` 传 `getUpdatesBuf` 游标，不是 `GET /messages?timeout=30000` HTTP 长连接。退避策略更精细（`MAX_CONSECUTIVE_FAILURES=3` 触发退避 + 指数退避 `BASE_BACKOFF_MS=2000` → `MAX_BACKOFF_MS=30_000`），但无 hermes 的 "正常循环间 1s" 节流（weixin 立即进入下一轮）。

**判定 🟡**：长轮询骨架可复用 weixin，但三处差异：
1. **游标 vs 无游标**：WhatsApp bridge 侧自维护队列 maxlen=100，Python 拉空即可，**无 offset 游标**；weixin 需传 `getUpdatesBuf`。
2. **超时策略**：hermes 服务端 30s + 客户端 35s 组合 EvoClaw 无对应（TS 用 `AbortSignal.timeout(35000)` 即可实现）。
3. **正常 1s 间隔**：weixin 无此节流，补 WhatsApp 时需加上（否则空队列时 CPU 空转）。

---

### §3.8 子进程退出监控（可重试 vs 致命分类）

**hermes**（`.research/19f-whatsapp.md §3.2` + `whatsapp.py:490-505`）:

```python
def _check_managed_bridge_exit(self) -> None:
    if not self._bridge_process: return
    rc = self._bridge_process.poll()
    if rc is None: return                                       # 仍在运行
    msg = f"whatsapp bridge exited rc={rc}"
    if rc in RETRYABLE_EXIT_CODES:
        log.warning(msg + " (retryable)")
        return                                                  # 可重试（上层会自动重启）
    raise BridgeFatalError(msg)                                 # 致命（上抛让 gateway 全量重启）
```

每次 `_poll_messages` 循环**起始**都做一次 poll 检查，防止流量异常后才发现 bridge 已经挂了。可重试 exit code 通常包含 0 / SIGTERM 等"干净退出"语义，致命包含未初始化失败 / 断言错误等。

**EvoClaw**（缺失证据）: channel 层无 subprocess exit code 分类 — 因为当前渠道都无子进程。最接近的是 `packages/core/src/tools/background-process.ts`（Bash 工具侧），但那是工具调用的短生命周期进程，无"循环中断前检查进程是否还活着"的范式。

**判定 🔴**：完全缺失。补齐 WhatsApp 必须新建 subprocess exit code 分类（`RETRYABLE_EXIT_CODES`）和自动重启策略。EvoClaw 通用重试框架（`05-agent-loop-gap.md §3.6` 的 `isRecoverableInLoop` / `isFallbackTrigger` 分类）可**形态同构参考**但不能直接套用（那是 LLM API 错误分类，不是 subprocess exit code）。

---

### §3.9 消息类型分发（Text / Image / Video / Audio / PTT / Document + 文本文档内联）

**hermes**（`.research/19f-whatsapp.md §3.4` + `whatsapp.py` 入站处理）:

- **类型**：Text / Image / Video / Audio / PTT（push-to-talk 语音）/ Document。
- **Document 文本注入**：若文档 mime 是文本类（text/plain 等）且 ≤100KB，**直接把内容当消息附录塞入 body**，LLM 一次性消费。超过 100KB 则只返回 `mediaUrls[0]` 文件路径 + `mediaType: "document"`。

**EvoClaw**（weixin 模板部分同构）:
```bash
$ grep -rn "WeixinMessageType\|WeixinItemType" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/channel/adapters/weixin.ts:26-30
# WeixinMessageType（text/image/voice/video/file/...）, WeixinItemType
```
weixin 的消息 normalizer（`packages/core/src/channel/message-normalizer.ts`）有类型分发，但**无"文本文档 ≤100KB 内联到 body"**的语义——文件始终作为 `mediaPath` 附件。

**判定 🟡**：类型分发骨架可复用；**Document 内联**是 hermes 的**LLM 友好增强**（避免 agent 再起一个 file_read 工具去读一次），EvoClaw 若补齐可直接借鉴（简单 `if (mimeType.startsWith("text/") && size <= 100_000) { content += fs.readFileSync(path) }` 即可）。值得跨渠道推广（weixin/feishu/wecom 的 Document 也可做此优化）。

---

### §3.10 媒体落地到共享缓存 + Python 侧路径读取

**hermes**（`.research/19f-whatsapp.md §4.7` + `bridge.js:250-311`）:

```js
// bridge.js:250-260（精简）
if (msg.message?.imageMessage) {
  const buffer = await downloadMediaMessage(msg, "buffer", {}, {
    logger, reuploadRequest: sock.updateMediaMessage
  });
  const dir = path.join(os.homedir(), ".hermes", "image_cache");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${msg.key.id}.jpg`);
  fs.writeFileSync(file, buffer);
  item.mediaUrls = [file];
  item.mediaType = "image";
}
```

设计：Bridge 调 Baileys `downloadMediaMessage(buffer)` 拿字节流，写到 `~/.hermes/{image,audio,document}_cache/{messageId}.{ext}`；Python adapter 后续通过**本地路径读取**（agent 的 OCR / 音频转写工具层直接读，不经 Python 侧重复下载）。

**EvoClaw**（weixin 类比同构）:
```bash
# packages/core/src/channel/adapters/weixin-cdn.ts (159 行)
# packages/core/src/channel/adapters/weixin-crypto.ts (91 行，AES-128-ECB)
```
weixin-cdn 下载 CDN 加密媒体 → weixin-crypto 做 AES-128-ECB 解密 → 落地到本地路径。与 hermes 同形态（边界下载+解密+缓存），但**算法不同**：
- WhatsApp：AES-256-CBC + HMAC-SHA256（Baileys `decryptMediaMessage` 内部）
- weixin：AES-128-ECB（弱加密，微信个人号历史包袱）

**判定 🟡**：工程管线可 1:1 复用 weixin-cdn / weixin-crypto 模板结构；**解密算法**需新建（或让 Baileys 在 Node bridge 侧全权处理，Python/TS 侧只拿明文）。命名上建议用 `~/.evoclaw/whatsapp/{image,audio,document}_cache/`。

**安全子项**（hermes 未解之谜 @ `.research/19f-whatsapp.md §7`）：hermes 目前 `writeFileSync` 不带 `chmod 0600`，默认 umask `0644` 同主机其他用户可读，多用户共享主机会泄露私密媒体。EvoClaw 若补齐应**默认 `0o600`**（`fs.chmodSync(path, 0o600)` 或 bridge 启动时 `process.umask(0o077)`）。

---

### §3.11 Allowlist 集中在 Bridge（lid↔phone BFS 展开）

**hermes**（`.research/19f-whatsapp.md §3.6, §4.6` + `scripts/whatsapp-bridge/allowlist.js:1-84`）:

```js
// allowlist.js:40-52
function expandWhatsAppIdentifiers(seed, mappings) {
  const queue = [normalizeWhatsAppIdentifier(seed)];
  const seen = new Set();
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    for (const map of mappings) {
      if (map[cur]) queue.push(normalizeWhatsAppIdentifier(map[cur]));
    }
  }
  return seen;
}
```

3 个函数：
1. `normalizeWhatsAppIdentifier` — 剥离 JID 后缀（`@s.whatsapp.net` / `@lid`）和前导 `+`。
2. `expandWhatsAppIdentifiers` — BFS 展开 `lid-mapping-*.json`（同一人可能历史上换过号/切过 lid），保证匹配覆盖所有身份变体。
3. `matchesAllowedUser` — 空列表或 `"*"` 放行；否则对展开集做命中。

**关键设计**：Python 侧**不做二次过滤**，所有过滤集中在 Bridge，避免两处维护发散。

**EvoClaw**（缺失证据）:
```bash
$ grep -rn "allowlist\|allow_list\|allowedUsers\|whitelist" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/channel/
# 零结果
```
EvoClaw 有 CLAUDE.md 声明的 "**统一 NameSecurityPolicy**（allowlist/denylist/disabled）覆盖 Skills + MCP Servers，denylist 绝对优先"，但**未覆盖渠道入站消息过滤**。目前所有渠道是"连接即接收所有消息"模型，依赖 BindingRouter 下游路由过滤，而非入口过滤。

**判定 🔴**：完全缺失。NameSecurityPolicy 理念可复用（allowlist/denylist 模型），但**身份归一化**（JID 格式 / lid BFS 展开）是 WhatsApp 独有的复杂度。好的做法：Bridge 侧写 `allowlist.js` 严格端口 hermes 同构实现 + Policy 复用现有 `NameSecurityPolicy` 管理白黑名单持久化。

---

### §3.12 群聊响应门控

**hermes**（`.research/19f-whatsapp.md §3.4` + `whatsapp.py:257-272`）:

```python
def _should_process_message(self, m: dict) -> bool:
    if not m.get("isGroup"): return True                            # 个人聊天总是处理
    if not self._require_mention: return True                       # 未启用强 mention
    chat_id = m["chatId"]
    if chat_id in self._free_response_chats: return True            # chat 级白名单
    body = m.get("body", "")
    if body.startswith(self._command_prefixes): return True         # 命令前缀（/ 开头等）
    if self._bot_mentioned(m): return True                          # @ bot
    if self._is_reply_to_bot(m): return True                        # 回复 bot 历史消息
    return False
```

5 条命中任一才在群聊响应：个人聊天直接放行 / 配置级 `WHATSAPP_REQUIRE_MENTION` 总开关 / `free_response_chats` chat_id 级白名单 / 命令前缀 / mention bot / 回复 bot。目的：避免 bot 在群里"多嘴"被踢。

**EvoClaw**（部分覆盖但不完整）:
```bash
# packages/core/src/channel/command/command-dispatcher.ts:2, 11-16
# 渠道命令分发器 — 解析 slash command 文本
# isSlashCommand / parseCommand
```
EvoClaw 有命令前缀分发（`/echo`、`/toggle-debug`、`/help` 等 4 个 builtin 命令 + `command-registry.ts:8` Map 存储），但**无群聊 vs 私聊门控**、**无 mention 检测**、**无 reply 检测**、**无 chat_id 级白名单**。

**判定 🔴**：5 条门控覆盖 1 条（命令前缀），其余 4 条零实现。群聊场景补齐迫切——否则群里任何消息都会触发 agent，迅速被管理员踢。抽象层次：可在 `message-normalizer.ts` 或 `channel-message-handler.ts` 层加一个 `shouldEngage(msg, config)` 函数统一所有渠道。

---

### §3.13 `format_message` Markdown → WhatsApp 格式（drift 新增）

**hermes**（`.research/19f-whatsapp.md Addendum §A, §B` + `whatsapp.py:535-590`） —— 2026-04-16 drift audit 新增 56 行:

1. 保护 fenced code blocks + inline code 到占位符（避免被后续转换破坏）。
2. Bold / Strikethrough 转换（`**` → `*`，`~~` 保留为 WhatsApp 的删除线语法）。
3. Header（`#`）→ **bold**（WhatsApp 不支持原生 heading）。
4. Link 转换（`[text](url)` → `text (url)`）。
5. 恢复保护片段。

**EvoClaw**（weixin 类比方向相反）:
```bash
# packages/core/src/channel/adapters/weixin-markdown.ts (80 行)
# 功能: Markdown → 纯文本降级（微信个人号不支持任何 markdown 渲染）
```

**判定 🟡**：思路（格式保护 + 转换 + 恢复）同构可复用，但 **目标格式不同**：
- weixin：全部剥除 → 纯文本（微信个人号无富文本）
- WhatsApp：部分保留（`*bold*` / `_italic_` / `~strikethrough~` / `` `code` ``）→ WhatsApp 风格 Markdown
- Matrix（见 `19e-matrix-gap.md §3.15`）：Markdown → HTML（需要 DOMPurify sanitize）

建议抽象跨渠道 `MessageFormatter` 接口：每个渠道声明自己的格式化策略，减少重复轮子。

---

### §3.14 `MAX_MESSAGE_LENGTH=4096` 分块发送（drift 调低）

**hermes**（`.research/19f-whatsapp.md Addendum §A, §B` + `whatsapp.py:125, 592-651`）—— drift audit 新增:

- 旧 `MAX_MESSAGE_LENGTH=65536`（WhatsApp 协议上限）→ 新 **`4096`**（UX 限制：65K 消息在移动端不可读）。
- `send()` 改为分块逻辑:

```python
# whatsapp.py:592-651（drift 后精简）
formatted = self.format_message(content)
chunks = self.truncate_message(formatted, self.MAX_MESSAGE_LENGTH)
for i, chunk in enumerate(chunks):
    # 仅首块设 replyTo（不然所有分块都回复原消息，UI 混乱）
    payload = {"chatId": chat_id, "message": chunk}
    if i == 0 and reply_to: payload["replyTo"] = reply_to
    await self._post("/send", payload)
```

**EvoClaw**（weixin 同量级）:
```typescript
// packages/core/src/channel/adapters/weixin.ts:53
const TEXT_CHUNK_LIMIT = 4000;
```
weixin 也有 `4000` 分块阈值（比 WhatsApp 4096 略小，微信消息限制），但**无 "首块才设 replyTo"** 的语义（weixin 原本就没有 Telegram/Matrix 那种 reply 关系字段）。

**判定 🟡**：阈值数量级一致（4000 vs 4096），工程模板可复用；"首块才设 replyTo" 需补齐（若接入 WhatsApp/Matrix/Telegram 都是 reply 语义，抽象到跨渠道 `sendChunked(chunks, replyTo)` 工具函数）。

---

### §3.15 Typing 状态（`POST /typing isTyping`）

**hermes**（`.research/19f-whatsapp.md §3.5` + `whatsapp.py` + `bridge.js`）:

```
POST /typing { chatId, isTyping: true|false }
```
Bridge 侧自维持 typing 循环（WhatsApp Web 协议每 10s 刷新一次 "composing" presence）。

**EvoClaw**（weixin 有同名方法但模型不同）:
```typescript
// packages/core/src/channel/adapters/weixin.ts:238-257
async sendTyping(peerId: string, cancel = false): Promise<void> {
    let ticket = this.typingTicketCache.get(peerId);
    // ... 需要先通过 getConfig 获取 typing_ticket
    if (resp.typing_ticket) {
      ticket = resp.typing_ticket;
      this.typingTicketCache.set(peerId, ticket);
    }
    // ...
}
```
weixin sendTyping 需要 `typing_ticket`（一次性使用 token）；WhatsApp 只需 boolean `isTyping`。ChannelAdapter 接口（`channel-adapter.ts:50-51`）已暴露 `sendTyping?(peerId, cancel)` 可选方法，形态一致。

**判定 🟡**：接口层已对齐（`ChannelAdapter.sendTyping`），weixin 实现可作为模板；WhatsApp 具体实现简单（无 ticket 缓存），补齐工作量低。

---

### §3.16 消息编辑（`POST /edit messageId`）

**hermes**（`.research/19f-whatsapp.md §3.5`）:

```
POST /edit { chatId, messageId, message }
```
把已发送消息替换为新内容（WhatsApp 协议支持 15 分钟内编辑）。Bridge 侧 Baileys `sendMessage({ edit })`。

**EvoClaw**（缺失证据）:
```bash
$ grep -rn "editMessage\|edit_message\|messageEdit" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/channel/
# 零结果
```

**判定 🔴**：完全缺失，且是**跨渠道未覆盖的维度**。与 `19e-matrix-gap.md §3.14`（Matrix `m.replace`）/ `19a-telegram-gap.md` 相应章节同问题——EvoClaw **所有渠道**都是"一次性发送"模型，没法支持"流式 edit 覆盖最新消息"UX（agent 边想边写，edit 覆盖而不是新发多条）。补齐 WhatsApp 时应顺便抽象跨渠道 `editMessage` 接口到 `ChannelAdapter`。

---

### §3.17 Bridge 调试日志开关（`WHATSAPP_DEBUG`）

**hermes**（`.research/19f-whatsapp.md §3.8` + `bridge.js:38-42, 196, 320, 328`）:

- `WHATSAPP_DEBUG` 环境变量（值为 `1` / `true` / `yes` / `on`，case-insensitive）启用 verbose 输出：原始 Baileys event / 媒体下载 trace / allowlist 决策细节。
- **生产必须关闭**，否则用户消息内容会记录到 stdout（泄露风险）。

**EvoClaw**（weixin-debug 模板同构）:
```bash
# packages/core/src/channel/adapters/weixin-debug.ts (84 行)
# packages/core/src/channel/adapters/weixin-redact.ts (60 行)
```
weixin 已有 `/toggle-debug` slash 命令（CLAUDE.md "微信个人号渠道…全链路 Debug 追踪"），配合 `weixin-redact.ts` PII 脱敏使用。模型：内置 debug 模式默认关 / `/toggle-debug` 命令热切换 / 日志经 `sanitizePII()` 过滤。

**判定 🟡**：EvoClaw 侧（TS）debug 开关可直接复用 weixin 模板；**Node bridge 侧**需新建 `WHATSAPP_DEBUG` 环境变量 + Baileys `pino` logger level 切换。两层 debug 开关需要对齐（bridge 侧开 → Python/TS 侧 warn；Python/TS 侧开 ≠ bridge 侧自动开）。

---

### §3.18 媒体缓存 / session creds 文件权限

**hermes**（`.research/19f-whatsapp.md §7 风险` — 未解之谜）:

- **媒体缓存**：`bridge.js` 下载 WhatsApp 媒体到 `~/.hermes/{image,audio,document}_cache/` 时**未显式 `chmod`**，默认 umask 产生 `0644` 权限——同主机其他用户可读。多用户共享主机或容器共用 hermes-home 时**私密媒体泄露**。建议 bridge 启动 `process.umask(0o077)` 或写入后 `fs.chmodSync(path, 0o600)`。
- **session/creds.json**：`useMultiFileAuthState` 持久化到 `~/.hermes/whatsapp/session/creds.json`，含 Noise 协议密钥和 pairing secret，**绝对不能进 git**。需 `.gitignore` 覆盖 hermes-home 映射路径，或 setup script 强制 `chmod 0600` 整个 session 目录。
- **媒体缓存 TTL**：hermes 无 TTL 清理，长时间运行磁盘爆满。

**EvoClaw**（缺失证据）:
```bash
$ grep -rn "chmod\|umask\|fs\.chmodSync\|gitignore.*session" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src/channel/
# 零结果
```

**判定 🔴**：完全缺失，且**是 hermes 自己的未解之谜**。EvoClaw 如果补齐可一次性解决 hermes 的漏洞：
1. Node bridge 启动时 `process.umask(0o077)`（兜底所有写操作默认 0600）。
2. `~/.evoclaw/whatsapp/session/` 目录 `fs.chmodSync(dir, 0o700)`。
3. 媒体缓存挂载到 EvoClaw 通用 `CacheCleanupTask`（可复用 CLAUDE.md 已有的"优雅关闭 registerShutdownHandler"骨架加一个 TTL 扫描任务）。

---

## 4. 建议改造蓝图（不承诺实施）

> **前提**：仅当产品决策明确"面向海外 C 端 / WhatsApp 用户基数大的东南亚 / 中东 / 拉美市场"或"企业客户要求 WhatsApp 客服"时才启动。当前 EvoClaw 定位"企业级国内用户"，WhatsApp 优先级天然靠后；且**双进程 Node bridge 架构是 EvoClaw 未使用过的模式**，架构引入成本高。

### P0（必须，启动 WhatsApp 渠道即须覆盖） — 预计 3-4 人周

| 项 | 范围 | 工作量 | ROI |
|---|---|---|---|
| P0-1 | 扩展 `ChannelType` 加 `'whatsapp'`（`packages/shared/src/types/channel.ts:2`），新建 `packages/core/src/channel/adapters/whatsapp.ts` 骨架，实现 `ChannelAdapter`（`channel-adapter.ts:31`） | 0.5d | ★★★ 架构入口 |
| P0-2 | Node bridge 目录（`scripts/whatsapp-bridge/`）：`bridge.js` 框架 + Baileys 依赖 + `package.json` + `package-lock.json` + `.gitignore` 覆盖 `session/` | 2d | ★★★ 协议层（Node bridge 是唯一可行路径，无 TS 原生替代） |
| P0-3 | `BridgeProcessManager`（TS 侧）：subprocess 生命周期 / `/health` 探测复用 / `detached: true` 进程组 / 异常退出 exit code 分类 + 自动重启 / 平台分支（macOS/Linux/Windows） | 3d | ★★★ |
| P0-4 | 杀端口残留（Linux `fuser` + macOS `lsof -i :3000` + Windows `netstat+taskkill`） | 1d | ★★ |
| P0-5 | 两阶段就绪（HTTP 15s + WA socket 15s） | 0.5d | ★★★ |
| P0-6 | 长轮询 `_pollMessages`（35s 客户端超时 + 30s 服务端超时 + 异常 5s 退避 + 正常 1s 间隔） | 1d | ★★★ |
| P0-7 | Node 依赖前置检查（`node --version` / `node_modules` 缺失时 `npm install`）+ 用户引导 UI（类 Docker 首次安装引导） | 1.5d | ★★ |
| P0-8 | 会话路径锁（`proper-lockfile` 或 bun 原生 flock，以 `~/.evoclaw/whatsapp-session/` 为 key） | 0.5d | ★★ 多实例互斥 |
| P0-9 | QR 扫码登录流程（Node bridge 侧 `qrcode-terminal` → HTTP 推回 PNG → 桌面端展示扫码 UI） | 2d | ★★★ 用户入口 |
| P0-10 | 消息 normalizer：Text / Image / Video / Audio / PTT / Document → `ChannelMessage`（`packages/shared/src/types/channel.ts`） | 1.5d | ★★★ |
| P0-11 | 出站 `/send` 文本 + 分块 4096 + 首块 replyTo | 1d | ★★★ |
| P0-12 | `format_message` Markdown → WhatsApp 格式（参考 hermes drift 56 行） | 1d | ★★ |
| P0-13 | Typing 状态（`POST /typing`）实现 `ChannelAdapter.sendTyping` | 0.5d | ★★ |
| P0-14 | 群聊响应门控（私聊总放行 + `REQUIRE_MENTION` + chat_id 白名单 + 命令前缀 + mention + reply-to-bot） | 1.5d | ★★★ 不做即被踢 |
| P0-15 | Allowlist Bridge 侧（`allowlist.js` 完整移植）+ EvoClaw `NameSecurityPolicy` 管理白黑名单持久化 | 1.5d | ★★★ |

### P1（强推荐，进入生产前补齐） — 预计 2-3 人周

| 项 | 范围 | 工作量 | ROI |
|---|---|---|---|
| P1-1 | 媒体缓存（`~/.evoclaw/whatsapp/{image,audio,document}_cache/`）+ Baileys `downloadMediaMessage` bridge 侧落地 + Python/TS 侧路径读取 | 2d | ★★★ |
| P1-2 | 媒体缓存文件权限（`0600` + `umask(0o077)`）+ session 目录 `0700` + `.gitignore` 强校验 | 1d | ★★★ 安全基线 |
| P1-3 | 媒体缓存 TTL 清理（挂载到 CLAUDE.md "registerShutdownHandler" 骨架，启动时 + 每日扫描） | 1d | ★★ hermes 未解之谜之一 |
| P1-4 | Document 文本内联（≤100KB mime 为 text/* 直接进 body） | 0.5d | ★★ LLM 友好 |
| P1-5 | 消息编辑 `POST /edit`（+ 跨渠道 `editMessage` 接口抽象提升到 `ChannelAdapter`） | 2d | ★★★ 架构红利 |
| P1-6 | 媒体出站 `POST /send-media`（image/video/audio/document）+ MIME 识别（可复用 `weixin-mime.ts`） | 2d | ★★ |
| P1-7 | Debug 日志开关（`WHATSAPP_DEBUG` env + `/toggle-debug` slash 命令对齐 weixin-debug 模板） + 日志 PII 脱敏 | 1d | ★★ |
| P1-8 | `--pair-only` 模式（bridge 只做配对不启动主流程，便于部署前预配对）+ 桌面端"重新配对"UI | 1.5d | ★★ |
| P1-9 | 自消息去重缓存（maxlen=50，防 bot 收到自己刚发的消息又触发 agent） | 0.5d | ★★★ 经典 bug 防御 |

### P2（选做） — 预计 1-2 人周

| 项 | 范围 | 工作量 | ROI |
|---|---|---|---|
| P2-1 | SILK 音频转码（可复用 `weixin-silk.ts:1-138`）—— WhatsApp PTT 语音是 Opus，不需要 SILK，但语音统一前置降噪/转码 pipeline 可复用 | 1d | ★ |
| P2-2 | 群聊 `free_response_chats` 白名单 UI（让用户勾选"这个群里 bot 想说就说"） | 1d | ★ |
| P2-3 | `lid-mapping-*.json` BFS 身份合并（冷启动从 Baileys 历史会话拉取已知身份映射） | 2d | ★ hermes 未解之谜（多 lid-mapping 冲突） |
| P2-4 | Baileys 版本升级演练手册（7.0.0-rc.9 是预发布，协议易变） | 0.5d | ★ |
| P2-5 | 与 `19-gateway-platforms-gap.md` 的跨渠道抽象共同演进：`editMessage` / `groupEngageGate` / `mediaCacheCleanup` / `processManager` 抽到 `ChannelAdapter` 基座 | 3d | ★ 架构红利 |

### 不建议做

- **WhatsApp Business API（Cloud API / On-Premises API）**：官方 API 要求企业认证、按消息计费、模板化消息审核严格，不适合 C 端 agent UX；Baileys 走 WhatsApp Web 协议是**社区事实标准**，hermes 选择正确，EvoClaw 跟随即可。
- **自研 WhatsApp 协议栈**（反向工程 Noise / Signal 协议）：Baileys / whatsmeow / WhatsApp-Web.js 等已有成熟实现，重造轮子无意义。
- **Bun 原生 Baileys 端口**：Baileys 深度依赖 Node 生态（`libsignal`、`protobufjs`、特定版本 `ws`），Bun 兼容性不完美；强行走 Bun 会引入无法预测的运行时 bug。接受 Node bridge 双进程架构。

---

## 5. EvoClaw 反超点汇总（无反超，列出可迁移资产）

> **本章节 EvoClaw 无明显反超（整体缺失）**；以下为**可迁移资产**——EvoClaw 已有的通用 / 类微信能力在补齐 WhatsApp 时可直接复用，缩短工期。共 13 项（weixin 形态同构 6 项 + 通用基础设施 7 项）。

| 可迁移资产 | 代码证据 | 迁移到 WhatsApp 的价值 |
|---|---|---|
| **`ChannelAdapter` 统一抽象** | `packages/core/src/channel/channel-adapter.ts:31-55`（9 方法：`connect`/`disconnect`/`onMessage`/`sendMessage`/`sendMediaMessage?`/`sendTyping?`/`getStatus`/readonly `type`；4 个现有 adapter `implements ChannelAdapter` 作为参考实现） | 新 `WhatsAppAdapter` 实现接口即无缝接入 ChannelManager / 自动重连 / 全局消息回调；hermes 的 `BasePlatformAdapter` 复刻清单约半数由 EvoClaw 抽象天然覆盖 |
| **QR 扫码登录 UX 模板** | `weixin.ts:8` 注释"QR 扫码登录获取 botToken"+ `weixin-api.ts:287` `get_bot_qrcode` + `weixin-types.ts:14, 226-228` `qrcode_img_content` | 桌面端 QR 展示 + 扫码状态轮询 + 失败重试 UX 可 1:1 复用；WhatsApp 只需换掉后端 QR 来源（Baileys 推过来的 buffer 替代 iLink API 返回的 PNG） |
| **长轮询工程模板** | `weixin.ts:56-62`（`MAX_CONSECUTIVE_FAILURES=3` / `MAX_BACKOFF_MS=30_000` / `BASE_BACKOFF_MS=2_000`）+ L295-320（循环骨架 + 游标持久化 + 退避） | WhatsApp `_pollMessages` 代码结构可 1:1 参考；差异仅在"WhatsApp 无游标"（bridge 侧自维护队列，Python 拉空即可） |
| **媒体 CDN 管线模板** | `weixin-upload.ts:1-237` 上传 + `weixin-send-media.ts:1-217` 发送 + `weixin-cdn.ts:1-159` 下载 + `weixin-crypto.ts:1-91`（AES-128-ECB 解密）+ `weixin-mime.ts:1-98` MIME 识别 + `weixin-silk.ts:1-138` SILK 音频转码 | 加密算法换（AES-256-CBC + HMAC，由 Baileys bridge 侧处理）/ MIME 识别可直接复用 / 缓存管理思路复用 |
| **Markdown 格式降级器模板** | `weixin-markdown.ts:1-80`（Markdown → 纯文本） | WhatsApp `format_message`（Markdown → WhatsApp 格式）方向相反但思路（格式保护 + 转换 + 恢复）同构 |
| **Typing 状态接口** | `ChannelAdapter.sendTyping?`（`channel-adapter.ts:50-51`）+ `weixin.ts:238-257` ticket 缓存实现 | 接口层已抽象；WhatsApp 无 ticket 反而实现更简单 |
| **命令分发** | `packages/core/src/channel/command/command-dispatcher.ts:2-16` + `command-registry.ts:8-35` + 4 个 builtin（`echo`/`help`/`forget`/等） | WhatsApp 群聊门控的"命令前缀"部分直接复用（`body.startsWith(self._command_prefixes)`）；可新增 WhatsApp 专用命令 |
| **凭据 Keychain 存储** | CLAUDE.md 声明 `macOS Keychain (security-framework) + AES-256-GCM (ring)` | Baileys `useMultiFileAuthState` 生成的 creds.json 可整体塞进 Keychain（JSON 序列化 → AES-256-GCM 加密），比 hermes 明文落盘更安全 |
| **PII 脱敏 / Debug 追踪** | `weixin-debug.ts:1-84` + `weixin-redact.ts:1-60` + `infrastructure/logger.ts` 的 `sanitizePII()`（CLAUDE.md 声明自动脱敏 API Key / Bearer / JWT / 邮箱 / 手机号）+ `/toggle-debug` slash 命令 | WhatsApp bridge 的 `WHATSAPP_DEBUG` 日志经 EvoClaw logger 走脱敏；`/toggle-debug` 命令可扩展为同时切换 Node bridge 侧 log level |
| **优雅关闭 registerShutdownHandler** | CLAUDE.md 声明 `SIGTERM/SIGINT → registerShutdownHandler 按优先级串行执行（调度器→渠道→MCP→数据库→日志）→ 30s 宽限期` | WhatsApp bridge 子进程可注册为渠道级关闭钩子（`channel` 优先级），`SIGTERM` 整组 kill（`detached: true` + `process.kill(-pid)`）+ 等待 exit → fall through 到 `SIGKILL` |
| **NameSecurityPolicy 白黑名单** | CLAUDE.md 声明 `统一 NameSecurityPolicy（allowlist/denylist/disabled）覆盖 Skills + MCP Servers，denylist 绝对优先` | `WHATSAPP_ALLOWED_USERS` / `WHATSAPP_FREE_RESPONSE_CHATS` 白名单可复用同一 Policy 抽象（`lid`/phone 标识需新建 normalizer，但 allowlist/denylist 引擎完整复用） |
| **ChannelStateRepo 断点续传** | `weixin.ts:91-115`（注入 `ChannelStateRepo` → `stateRepo.getState('weixin', STATE_KEY_BUF)` 游标持久化） | WhatsApp 虽无游标，但 `contextTokenCache` 等类状态（近期对话上下文、未读消息 tracker）可走同一 state repo；命名空间改 `'whatsapp'` 即可 |
| **bun:sqlite + WAL** | CLAUDE.md `bun:sqlite / better-sqlite3（运行时自动选择）+ WAL 模式，MigrationRunner 自动执行 migrations` | WhatsApp `lid-mapping-*.json` 可从 JSON 文件迁到 sqlite 表（支持事务 + 查询性能），比 hermes 用多个 JSON 文件管理 mapping 更可维护 |

**结论**：EvoClaw 在"渠道框架 + QR 登录 UX + 长轮询 + 媒体管线 + 命令分发 + 安全策略"上的工程资产**能显著降低** WhatsApp 适配器的构建成本——尤其 weixin 作为 "QR 扫码 + 长轮询 + 媒体 CDN" 形态同构的参考实现几乎 1:1 可参考。但 **Node bridge 双进程架构**（subprocess 管理 / `/health` 探测 / exit code 分类 / 整组 kill / 两阶段就绪）是 EvoClaw 从未使用过的模式，也是 WhatsApp 工期的**首要风险项**（占 P0 工作量约 40%）。完整 P0+P1 = 5-7 人周，不含 P2。

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（已 Bash/Grep/Read 验证 2026-04-16）

1. `ls packages/core/src/channel/adapters/` — 16 个文件（`desktop.ts / feishu.ts / wecom.ts / weixin-*.ts` × 14），**无 `whatsapp.ts`**；`wc -l` 确认 2845 行，weixin 全家桶 2067 行。
2. `packages/shared/src/types/channel.ts:2` — `export type ChannelType = 'local' | 'feishu' | 'wecom' | 'dingtalk' | 'qq' | 'weixin'` — **无 `'whatsapp'`**。
3. `grep -rni "whatsapp\|baileys\|qrcode-terminal" packages/` — 源码（`packages/core/src/` + `packages/shared/src/`）**零命中**；仅 `docs/evoclaw-vs-hermes-research/*.md` 研究文档里出现（不计）。
4. `grep -rni "bridge\.js\|subprocess.Popen\|preexec_fn\|os\.setsid\|detached.*true" packages/core/src/channel/` — **零结果**。
5. `grep -rn "setsid\|fuser\|taskkill" packages/core/src/` — channel 层零结果；全项目仅 `tools/background-process.ts` / `infrastructure/async-exec.ts` 有 subprocess 维度，非 bridge 场景。
6. `grep -rn "acquire_scoped_lock\|acquire_platform_lock\|session.*lock\|flock\|proper-lockfile" packages/core/src/` — **零结果**。
7. `grep -rn "allowlist\|allow_list\|allowedUsers\|whitelist" packages/core/src/channel/` — **零结果**；NameSecurityPolicy 在 `skill` / `mcp` 层面有，channel 层未覆盖。
8. `grep -rn "editMessage\|edit_message\|messageEdit\|m\.replace" packages/core/src/channel/` — **零结果**（跨渠道缺口）。
9. `grep -rn "node --version\|npm install\|node_modules" packages/core/src/channel/` — **零结果**。
10. `grep -rn "chmod\|umask\|fs\.chmodSync" packages/core/src/channel/` — **零结果**（session / 媒体文件权限未显式保护）。
11. `packages/core/src/channel/channel-adapter.ts:31-55` — `export interface ChannelAdapter`（9 个方法 / 可迁移基础）。
12. `packages/core/src/channel/adapters/weixin.ts:1-12` — 注释"QR 扫码登录 / 长轮询 / context_token 缓存 / sendMessage"（形态同构 WhatsApp 的 QR + 长轮询 + replyTo）。
13. `packages/core/src/channel/adapters/weixin.ts:53` — `TEXT_CHUNK_LIMIT = 4000`（≈ WhatsApp `MAX_MESSAGE_LENGTH=4096`）。
14. `packages/core/src/channel/adapters/weixin.ts:56-62` — 长轮询常量 `MAX_CONSECUTIVE_FAILURES=3 / MAX_BACKOFF_MS=30_000 / BASE_BACKOFF_MS=2_000`（长轮询工程模板）。
15. `packages/core/src/channel/adapters/weixin.ts:238-257` — `sendTyping(peerId, cancel)` ticket 缓存实现（typing 接口模板）。
16. `packages/core/src/channel/adapters/weixin.ts:91-115` — `ChannelStateRepo` 注入 + `stateRepo.getState('weixin', STATE_KEY_BUF)` 游标持久化。
17. `packages/core/src/channel/adapters/weixin-api.ts:287` — `get_bot_qrcode` API 调用（QR 扫码登录入口）。
18. `packages/core/src/channel/adapters/weixin-types.ts:12-14, 226-228` — `WeixinCredentials { botToken }` 扫码后凭证结构 + `qrcode_img_content`。
19. `packages/core/src/channel/command/command-dispatcher.ts:2, 11-16` — Slash 命令分发器 / `isSlashCommand` / `parseCommand`。
20. `packages/core/src/channel/command/command-registry.ts:8, 12, 35` — Command Map 存储 / `registerCommand` / `getAll`（4 builtin 命令 `echo`/`help`/`forget`/等）。
21. `packages/core/src/channel/adapters/weixin-markdown.ts`（80 行）— Markdown → 纯文本降级（`format_message` 模板，方向相反）。
22. `packages/core/src/channel/adapters/weixin-cdn.ts`（159 行）+ `weixin-crypto.ts`（91 行 AES-128-ECB）+ `weixin-mime.ts`（98 行）+ `weixin-silk.ts`（138 行）+ `weixin-upload.ts`（237 行）+ `weixin-send-media.ts`（217 行）— 完整媒体管线模板。
23. `packages/core/src/channel/adapters/weixin-debug.ts`（84 行）+ `weixin-redact.ts`（60 行）— Debug 追踪 + PII 脱敏模板。

### 6.2 hermes 研究引用（章节 §）

- `.research/19f-whatsapp.md §1` 架构概览（双进程 Python + Node Baileys / mermaid 流程图 / Bridge 生命周期 / Allowlist 集中 / 媒体下载）
- `.research/19f-whatsapp.md §2` 目录/文件分布（`whatsapp.py` 941 / `bridge.js` 571 / `allowlist.js` 84 / Bridge 依赖 / 7 个 HTTP endpoint / 消息字段 JSON schema）
- `.research/19f-whatsapp.md §3.1` 连接序列（L274-479：Node 存在性 → npm install 60s → session 锁 → `/health` 复用 → spawn setsid → 两阶段等待 → aiohttp session → `_poll_messages`）
- `.research/19f-whatsapp.md §3.2` 心跳（L490-505：`_check_managed_bridge_exit` 可重试/致命分类）
- `.research/19f-whatsapp.md §3.3` 长轮询（L779-811：`GET /messages?timeout=30000` + 35s 客户端超时 + 异常 5s 退避 + 正常 1s 间隔）
- `.research/19f-whatsapp.md §3.4` 入站消息处理（Text/Image/Video/Audio/PTT/Document + Document ≤100KB 文本内联 + `_should_process_message` 群聊门控 5 条 L257-272）
- `.research/19f-whatsapp.md §3.5` 出站（文本 `POST /send replyTo` + 编辑 `POST /edit` + 媒体 `POST /send-media` + Typing `POST /typing isTyping`）
- `.research/19f-whatsapp.md §3.6` Allowlist（`allowlist.js`：normalize + BFS expand `lid-mapping-*.json` + match 空/`*` 放行）
- `.research/19f-whatsapp.md §3.7` 孤立进程清理（`_kill_port_process` L35-67：Linux `fuser` / Windows `netstat+taskkill`）
- `.research/19f-whatsapp.md §3.8` Bridge 调试日志开关（`WHATSAPP_DEBUG` env + `bridge.js:38-42, 196, 320, 328`）
- `.research/19f-whatsapp.md §4.1` Adapter 构造器（L103-148：bridge_process / bridge_port / bridge_script / session_path / http_session / poll_task / mention_patterns / session_lock_identity）
- `.research/19f-whatsapp.md §4.2` 连接两阶段（L274-479：node/npm/session lock/probe health/setsid spawn/await http ready/await wa ready）
- `.research/19f-whatsapp.md §4.3` 子进程退出监控（L490-505：RETRYABLE_EXIT_CODES 分类 + BridgeFatalError 上抛）
- `.research/19f-whatsapp.md §4.4` 长轮询循环（L779-811 精简代码）
- `.research/19f-whatsapp.md §4.5` 群聊响应门控（L257-272：isGroup + require_mention + free_response_chats + command_prefixes + bot_mentioned + is_reply_to_bot）
- `.research/19f-whatsapp.md §4.6` Bridge allowlist BFS 展开（`allowlist.js:40-52`）
- `.research/19f-whatsapp.md §4.7` Bridge 媒体下载（`bridge.js:250-311`：downloadMediaMessage + writeFileSync ~/.hermes/image_cache/）
- `.research/19f-whatsapp.md §4.8` 杀端口（L35-67）
- `.research/19f-whatsapp.md §5` 与其它模块交互（BasePlatformAdapter / Baileys 栈解耦 / 媒体缓存共享 / 会话锁 / 反滥用出口在 bridge）
- `.research/19f-whatsapp.md §6` 复刻清单 17 项（双进程 / Node 前置 / 会话锁 / `/health` 复用 / setsid / 两阶段就绪 / 长轮询 30s/5s/1s / 队列 maxlen=100 / 自消息 maxlen=50 / exit 监控 / 媒体落地 / Document 内联 / 群聊门控 / Allowlist / lid↔phone BFS / 端口自愈 / QR 认证 / 环境变量最小集）
- `.research/19f-whatsapp.md §7` 风险 & 待验证（Baileys RC 版本 / npm install 冷启动 / 消息队列溢出 / Bridge 崩溃恢复 / lid-mapping 一致性 / 媒体缓存 TTL 膨胀 / Windows 兼容 / 端口冲突 / session 泄漏 / 媒体缓存文件权限 / session/creds.json 泄露）
- `.research/19f-whatsapp.md Addendum drift audit @ 00ff9a26` — 净 +48 行 / 新增 `format_message` 56 行 / `send()` 分块 +25 行 / 平台锁基类化 -27 行 / `MAX_MESSAGE_LENGTH` 65536→4096

### 6.3 关联差距章节（crosslink）

- **[`./19-gateway-platforms-gap.md`](./19-gateway-platforms-gap.md)**（同批，总览）— Gateway 平台适配器架构对比 / `BasePlatformAdapter` vs `ChannelAdapter` / 国产渠道反超 vs 国际平台缺失
- **[`./19a-telegram-gap.md`](./19a-telegram-gap.md)**（同批）— Telegram 适配器 / `editMessage` 流式 edit 覆盖 UX / Inline Keyboard / Long Polling Updates API
- **[`./19b-discord-gap.md`](./19b-discord-gap.md)**（同批）— Discord 适配器 / 反应表情生命周期 / Thread / Slash Command
- **[`./19c-slack-gap.md`](./19c-slack-gap.md)**（同批）— Slack 企业 IM / 编辑消息 / Thread 模式 / Block Kit
- **[`./19d-signal-gap.md`](./19d-signal-gap.md)**（同批）— Signal E2EE IM / signald daemon 双进程架构（与 WhatsApp bridge 同形态，可互借 `BridgeProcessManager` 抽象）/ PII 脱敏
- **[`./19e-matrix-gap.md`](./19e-matrix-gap.md)**（同批）— Matrix 联邦 IM / E2EE OlmMachine / `m.replace` 编辑 / Markdown → HTML 格式转换
- **[`./05-agent-loop-gap.md`](./05-agent-loop-gap.md) §3.6** — Retry / Fallback 框架（WhatsApp Bridge 异常分类可参考）
- **[`./14-state-sessions-gap.md`](./14-state-sessions-gap.md)** — Session Key 扩展（WhatsApp chatId / senderId → SessionKey 映射）

---

**本章完成**。所有 18 个机制均基于 grep 零结果（channel 层 / WhatsApp-Baileys-bridge 关键词全部零命中）或 weixin 形态同构证据判定为 🔴（11 项）/ 🟡（7 项）；无反超。可迁移资产集中在 weixin 全家桶（6 项：QR 登录 / 长轮询 / 媒体管线 / Markdown 降级 / Typing / Debug+Redact）和通用基础设施（7 项：ChannelAdapter / 命令分发 / Keychain / 优雅关闭 / NameSecurityPolicy / ChannelStateRepo / bun:sqlite WAL）共 13 项。**Node Baileys Bridge 双进程架构**（subprocess 管理 / `/health` 复用 / exit code 分类 / 整组 kill / 两阶段就绪）是 EvoClaw 未使用过的模式，工期首要风险项，占 P0 约 40%；安全三项（媒体文件 `0600` / session `0700` / 缓存 TTL）同时可修 hermes 未解之谜。完整 P0+P1 估计 5-7 人周。
