# 03 — 总体架构 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/03-architecture.md`（438 行）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`AIAgent` class @ `run_agent.py:535`，6 路入口汇聚到单一中心
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），Tauri 三层（Rust 主进程 + Bun Sidecar + React 前端）
> **综合判定**: 🟡 **形态完全不同**（单 Python 进程 vs 三层 IPC 架构）**但设计模式有深度交集**（Agent 核心 while loop / 工具注册 / prompt cache 硬约束 / profile 隔离），EvoClaw 在**安全分层（Rust 本地加密）/ 多层记忆 / 通道抽象**三项反超

**档位图例**:
- 🔴 EvoClaw 明显落后
- 🟡 部分覆盖 / 形态差异
- 🟢 EvoClaw 对齐或反超

---

## 1. 定位

**hermes 架构**（`.research/03-architecture.md §1, §2`）: **单进程 + 6 路入口汇聚模式**

```
[CLI / Gateway / ACP / MCP Server / Batch / RL]
     ↓ 所有入口都构造同一个 AIAgent
[AIAgent (run_agent.py:535)] ——中心枢纽——
     ├── prompt_builder / context_compressor / prompt_caching
     ├── model_tools._discover_tools() ← tools/registry.py 单例
     ├── tools/environments/base.py ← 9 种 spawn 后端
     └── hermes_state.py ← SessionDB (SQLite + FTS5)
```

- **纯 Python 同步主循环**（`AGENTS.md:110` "The core loop is inside `run_conversation()` — entirely synchronous"）
- 异步只在工具执行层通过 `model_tools._run_async()` 桥接
- **tool 注册是 import-time 副作用**（`tools/*.py` 模块 load 时调 `registry.register()`）

**EvoClaw 架构**（`docs/architecture/Architecture_2026-03-20.md §1.1` + `CLAUDE.md §关键架构模式`）: **Tauri 三层 IPC 架构**

```
┌────────────── Tauri 主进程 (Rust, 703 行) ────────────┐
│  sidecar.rs (420 行, 进程管理/自动重启)               │
│  crypto.rs  (164 行, AES-256-GCM via ring)           │
│  credential.rs (77 行, macOS Keychain)               │
│  lib.rs      (37 行, Tauri 入口/命令注册)            │
└─────── spawn + 解析首行 JSON {port, token} ──────────┘
               ↓
┌────── Node.js/Bun Sidecar (@evoclaw/core, 94 文件 ~15K 行) ──────┐
│  Hono HTTP Server (14 路由)                                       │
│  EmbeddedRunner (Agent Kernel) + Fetch 回退                      │
│  Context Engine (9 ContextPlugins: bootstrap/beforeTurn/...)     │
│  Memory System (L0/L1/L2)                                        │
│  LaneQueue (3 车道: main=4, subagent=8, cron=可配) + ToolSafety │
│  Channel Manager / Scheduler / Skill / Evolution / RAG          │
└──────── 127.0.0.1:{49152-65535} + 256-bit Bearer Token ─────────┘
               ↑
┌────────── React 前端 (16 页面 ~7K 行, 4 Zustand Store) ──────┐
│  ChatPage / AgentsPage / MemoryPage / SkillPage / ...        │
└──────────────────────────────────────────────────────────────┘
```

- **三语言分层**（Rust / TypeScript / React）
- **Sidecar HTTP + SSE 通信**（随机端口 + Bearer Token，仅绑定 `127.0.0.1`）
- TypeScript 全异步（`async/await`），无"同步主循环 + async bridge"范式

**关键差异**:

| 维度 | hermes | EvoClaw |
|---|---|---|
| 进程模型 | 单 Python 进程 | Tauri 主进程 + Sidecar 子进程（双进程，IPC） |
| 入口数 | 6（CLI/GW/ACP/MCP/Batch/RL） | 1（Tauri App）+ Channel 消息入（飞书/企微/iLink） |
| 通信 | 进程内函数调用 | HTTP 内嵌 + SSE 流 |
| Agent 中心 | `AIAgent` 类（`run_agent.py:535`） | `AgentManager` + Agent Kernel（`packages/core/src/agent/`） |
| 同步/异步 | 主循环同步，工具层 async bridge | 全链路 async/await |
| Tool 注册 | import 副作用（58 个 tools/\*.py） | 静态 `CORE_TOOLS` 清单（`tool-catalog.ts:18-59`）+ ContextPlugin 动态注入 |
| 状态存储 | `~/.hermes/` 单目录 SQLite+FS | `~/.evoclaw/` + 加密凭据到 macOS Keychain |
| Profile 隔离 | `HERMES_HOME` 环境变量 | `BRAND=evoclaw/healthclaw` 构建时替换 |

本章按"架构维度"做横向对比，不展开具体子系统细节（那些在 Phase B/C 对应 gap 文档）。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 进程模型 | 🟡 | 单 Python vs Tauri + Sidecar 双进程 IPC，形态本质不同 |
| §3.2 | 入口架构 | 🟡 | hermes 6 路入口汇聚，EvoClaw 单 GUI + 多 Channel 消息入口 |
| §3.3 | Agent 中心类 | 🟢 | EvoClaw `AgentManager + Agent Kernel` 分层更清晰，hermes `AIAgent` 11K 行单类 |
| §3.4 | 主循环同步性 | 🟡 | hermes 同步（设计决策，Phase E ADDENDUM 解释） vs EvoClaw 全异步 |
| §3.5 | 工具注册机制 | 🟡 | import 副作用（灵活但隐式）vs 静态 CORE_TOOLS 清单（显式可读） |
| §3.6 | 执行环境沙箱层 | 🔴 | hermes 9 种 spawn 后端，EvoClaw 无（进程内直调，CLAUDE.md 声称 Docker 未实现） |
| §3.7 | 状态存储架构 | 🟢 | **反超**: EvoClaw 凭据→Keychain / 敏感→ring AES-GCM，hermes `~/.hermes/` 明文 |
| §3.8 | Session 持久化时机 | 🟡 | hermes 循环结束批量 flush，EvoClaw per-turn（见 05 §3.10）|
| §3.9 | Prompt Caching 硬约束 | 🟢 | 两者都有；EvoClaw `cacheBreakpointIndex` 追踪反超 |
| §3.10 | Profile / 多实例隔离 | 🟡 | `HERMES_HOME` 环境变量（数据级）vs `BRAND=xxx` 构建时替换（品牌级），语义不同 |
| §3.11 | Gateway / Channel 抽象 | 🟢 | **反超**: EvoClaw `BindingRouter` + 统一 `ChannelManager` + session key `agent:<id>:<channel>:dm:<peer>` |
| §3.12 | Agent 间协作（Subagent） | 🟡 | hermes 同进程递归 `_run_single_child`，EvoClaw LaneQueue 3 车道 + spawn_agent 工具 |
| §3.13 | Context 组装管道 | 🟢 | **反超**: EvoClaw `ContextPlugin` 5-hook 生命周期（bootstrap/beforeTurn/compact/afterTurn/shutdown）+ 10 个插件 |
| §3.14 | 异步事件流（SSE） | 🟢 | EvoClaw Hono `streamSSE` 一等公民，hermes 是 callbacks 累积，不是 SSE 原生 |
| §3.15 | Rust 侧原生能力参与 | 🟢 | **反超独有**：EvoClaw 关键安全能力在 Rust 侧实现，hermes 无对应 |

**统计**: 🔴 1 / 🟡 7 / 🟢 7（其中 6 项反超）。

---

## 3. 机制逐条深度对比

### §3.1 进程模型

**hermes** （`.research/03-architecture.md §2` 组件图）

- **单 Python 进程**（`run_agent.py` 9,811 行 + `cli.py` 9,043 行，共 ~18.8K LOC）
- 子系统全部 in-process module（`agent/` / `tools/` / `hermes_cli/` / `gateway/` / `cron/` / `acp_adapter/`）
- 异步 event loop 仅在必要时（工具层桥接）
- 优势：启动快，无 IPC 序列化开销
- 劣势：单点故障（崩溃整个进程重启）

**EvoClaw** （`docs/architecture/Architecture_2026-03-20.md §1.1` + `apps/desktop/src-tauri/src/sidecar.rs`）

**双进程**:
1. **Tauri 主进程（Rust）**，`apps/desktop/src-tauri/src/`：
   - `sidecar.rs:420` 行 —— spawn Sidecar 子进程 + 自动重启
   - `crypto.rs:164` 行 —— AES-256-GCM 加密
   - `credential.rs:77` 行 —— macOS Keychain 绑定
   - `lib.rs:37` 行 —— Tauri 命令注册
2. **Sidecar 子进程（Bun/Node）**，`packages/core/src/server.ts` 启动 Hono HTTP server，bind `127.0.0.1:{49152-65535}` 随机端口

**通信**:
- Tauri Rust 侧 spawn Sidecar 后 **解析首行 JSON** `{port, token}`
- 256-bit Bearer Token 绑定（`bearerAuth` 中间件，`server.ts`）
- 前端（React）通过 Tauri `shell plugin` 调 HTTP 或 Tauri command 调 Rust

**优势**:
- **进程隔离** —— Sidecar 崩溃不影响 Tauri 主进程 + UI
- **自动重启**（`sidecar.rs` 逻辑）
- **Rust 侧能保留敏感凭据**（Keychain），不穿过 TypeScript 运行时

**劣势**:
- 启动需要两阶段（Tauri 启动 → spawn Sidecar → 握手端口/Token）
- IPC 序列化开销（JSON over HTTP）
- 调试复杂度高（跨进程 log）

**判定 🟡**：两种路线都成立:
- hermes 单进程 → 适合 CLI + 开发者用户
- EvoClaw 双进程 → 适合桌面 App + 企业合规（进程隔离增加攻击面分析粒度）

---

### §3.2 入口架构

**hermes** （`.research/03-architecture.md §2` 6 路入口）

```
┌─ hermes (CLI)         — cli.py HermesCLI 类，40+ slash 命令
├─ hermes gateway       — gateway/run.py，事件驱动
├─ hermes-acp           — acp_adapter/entry.py，IDE 集成
├─ mcp_serve.py         — FastMCP 暴露 hermes 能力
├─ batch_runner.py      — 批量数据生成
└─ rl_cli.py            — RL 训练
```

全部汇聚到 `AIAgent(...)` 构造 + `run_conversation()` 调用。

**EvoClaw** （`apps/desktop/src-tauri/src/lib.rs` + `packages/core/src/server.ts` + `packages/core/src/channel/`）

**单一 GUI 入口 + 多 Channel 消息入口**:

```
┌─ React GUI (ChatPage 等 16 页面)
│     ↓ HTTP to Sidecar
├─ Channel Adapters（被动消息入口，非 CLI）
│   ├── feishu.ts      — 飞书 webhook
│   ├── wecom-app.ts   — 企微应用回调
│   ├── wechat-ilink.ts — iLink 微信长轮询
│   └── desktop.ts     — 桌面本地通知回环
└─ Cron Scheduler（cron-runner.ts 定时触发）
```

所有入口统一通过 `packages/core/src/routes/channel-message-handler.ts` 的 `handleChannelMessage(deps)` 处理。

**判定 🟡**：形态完全不同。hermes 是"主动入口"（用户启动 CLI / 用户发 TG 消息 → 拉起 Agent），EvoClaw 是"被动 + 主动混合"（用户在 GUI 点击 → HTTP 调 Sidecar / 外部 IM 消息通过 webhook 进来 → handleChannelMessage 分发）。**没有谁更好的结论**，都是各自场景的合理设计。

---

### §3.3 Agent 中心类

**hermes** （`.research/03-architecture.md §4.1` + `run_agent.py:535`）

```python
class AIAgent:  # run_agent.py:535（ADDENDUM 后行号，基线是 L439）
    def __init__(self, model=..., max_iterations=90, enabled_toolsets=..., ...):
        ...  # 50+ 构造参数

    def chat(self, message: str) -> str:  # run_agent.py:9581
        """Simple interface"""

    def run_conversation(self, ...) -> dict:  # run_agent.py:7041（基线） / 8102+（ADDENDUM）
        """Full interface — returns dict with final_response + messages"""
```

**单类承担**: 构造 + chat 便捷方法 + 主循环 + retry/fallback + tool dispatch + session persist + trajectory + reasoning 聚合。类定义 ~9,811 行中的大部分。

**EvoClaw** （`packages/core/src/agent/agent-manager.ts` + `packages/core/src/agent/kernel/query-loop.ts`）

**分层设计**:

```
AgentManager (高层外壳)
  ├── CRUD（创建/更新/删除 Agent）
  ├── initWorkspace（9 个工作区文件: SOUL/IDENTITY/AGENTS/TOOLS/HEARTBEAT/USER/MEMORY/BOOT/BOOTSTRAP）
  ├── 注册 slash 命令
  ├── 绑定 Channel
  └── ... （包括 deleteAgent cascade）

EmbeddedRunner (PI 框架延续，`packages/core/src/agent/embedded-runner-*.ts`)
  ├── embedded-runner-loop.ts — 外层 attempt 循环
  ├── embedded-runner-attempt.ts — 单次 attempt 调用 queryLoop
  ├── embedded-runner-prompt.ts — 系统 prompt 组装
  ├── embedded-runner-errors.ts — 错误分类 + 恢复
  └── embedded-runner-timeout.ts — 超时管理

Agent Kernel (`packages/core/src/agent/kernel/`)
  ├── query-loop.ts:340-697 — 核心 while(true) 主循环（770 行）
  ├── stream-client.ts:1-1026 — Anthropic/OpenAI 双协议流式客户端
  ├── context-compactor.ts:1-1021 — 三层压缩（Snip/Microcompact/Autocompact）
  ├── builtin-tools.ts — 内置工具定义（read/write/edit/grep/ls/bash 等）
  ├── streaming-tool-executor.ts — 流中预执行工具 + 并发控制
  ├── prompt-cache-monitor.ts — Anthropic cache 命中监控
  ├── error-recovery.ts — 413 分层恢复 + fallback trigger 分类
  └── types.ts — 类型定义
```

**判定 🟢 反超**：EvoClaw 的 3 层设计（AgentManager → EmbeddedRunner → Kernel）职责清晰可复用，hermes 的 `AIAgent` 11K 行单类混合了"Agent 生命周期 + 主循环 + 工具调度 + 持久化"所有职责，是 hermes 研究报告自己承认的**设计债**（`.research/03-architecture.md §7` "为什么 `run_agent.py` 有 9,811 行？"）。

---

### §3.4 主循环同步性

**hermes** （`.research/03-architecture.md §3.1` + `AGENTS.md:110`）

> "The core loop is inside `run_conversation()` — entirely synchronous"

主循环纯同步：
- `while api_call_count < max_iterations and iteration_budget.remaining > 0: ...`
- LLM 调用用 `client.chat.completions.create(..., stream=True)`（openai SDK 同步 API）
- 工具调用 `handle_function_call(name, args)` 同步返回
- 对于 async 工具（如 MCP、async file IO）用 `model_tools._run_async()`（`model_tools.py:81`）桥接：持久 event loop / per-worker loop / fresh thread 三种策略

**设计理由**（AGENTS.md 隐含）:
- 主循环控制流清晰，易调试
- 避免 Python asyncio 的已知陷阱（task 泄漏 / 取消语义）
- Subagent 委托直接同步递归（`_run_single_child`），不涉及 nested event loop

**EvoClaw** （`packages/core/src/agent/kernel/query-loop.ts:340-697`）

**全链路 async/await**:

```typescript
export async function queryLoop(config: QueryLoopConfig): Promise<QueryLoopResult> {
  let state: LoopState = { ... };
  while (true) {
    if (config.abortSignal?.aborted) { ... return buildResult(); }
    collapseState = await maybeCompressPhased(...);
    const roundResult = await streamOneRound(config, state.messages, executor, ...);
    state.messages.push(roundResult.assistantMessage);
    // ...
  }
}
```

- TypeScript 原生 `async/await`，配合 `ReadableStream` 做流式
- 所有子系统都是 async（`ContextPlugin` hooks / 工具 handler / LLM 流式 / DB query）
- 无"同步核心 + async bridge"特殊范式

**判定 🟡**：两种路线各有取向：
- hermes 同步核心 —— 与 Python SDK 生态默认同步一致，调试线性
- EvoClaw 全 async —— 与 Bun/Node/Hono 生态一致，非阻塞 I/O 天然

两者都能工作。EvoClaw 的 AsyncIterableQueue（`query-loop.ts:710-736`）作为事件流的背压机制，是 TS 生态的规范做法。

---

### §3.5 工具注册机制

**hermes** （`.research/03-architecture.md §3.4` + `AGENTS.md:69-78`）

```python
# model_tools._discover_tools() 硬编码 import list
import tools.terminal_tool       # ← module load 时 tools/terminal_tool.py:bottom
                                  #   调用 registry.register(...)
import tools.file_tools
# ...（58 个硬编码 import）

# tools/example_tool.py bottom
registry.register(
    name="example_tool",
    schema={...},
    handler=lambda args, **kw: example_tool(...),
    check_fn=lambda: bool(os.getenv("KEY")),
    requires_env=["KEY"],
)
```

- **副作用注册**（import = register）
- 添加新 tool 需改 3 个文件：`tools/your_tool.py` + `model_tools._discover_tools()` import list + `toolsets.py` `_HERMES_CORE_TOOLS`
- 灵活：lambda 闭包 + check_fn runtime gate，工具可以按 env var 启用

**EvoClaw** （`packages/core/src/agent/tool-catalog.ts:18-59` + `packages/core/src/context/plugins/tool-registry.ts`）

**静态 CORE_TOOLS 清单 + Plugin 动态注入**:

```typescript
// tool-catalog.ts:18-59
export const CORE_TOOLS: readonly CoreToolMeta[] = [
  { id: 'read', section: 'fs', label: '读取', description: '读取文件内容（支持文本和图片）' },
  { id: 'write', section: 'fs', label: '写入', description: '写入新文件或覆盖文件' },
  // ... 33 个工具
];

// context/plugins/tool-registry.ts
// ContextPlugin hook: beforeTurn(ctx) { 注入工具到 prompt }
```

- **静态清单**（33 个核心工具，`tool-catalog.ts`）
- **ContextPlugin 动态注入** —— ToolRegistryPlugin 在 `beforeTurn` hook 中根据 session 上下文、Agent profile、Skill 扫描结果动态组合可用工具
- 新增工具需在 `builtin-tools.ts` 定义 handler + `tool-catalog.ts` 注册元数据

**判定 🟡**：
- hermes 副作用注册模式 —— **灵活但隐式**，新成员容易漏看 `tools/*.py` 底部的 register 调用
- EvoClaw 静态清单模式 —— **显式可读**，`CORE_TOOLS` 一眼看全工具全貌；但新增工具需要改多处

实践上 EvoClaw 对**企业级可审计性**更友好（IT 采购方能对着 CORE_TOOLS 审查所有工具），hermes 对**开发者扩展**更友好。

---

### §3.6 执行环境沙箱层

**hermes** （`.research/03-architecture.md §2` + `.research/11-environments-spawn.md`）

**统一 `tools/environments/base.py BaseEnvironment.spawn()`** —— v0.8.0 重大重构:

```
BaseEnvironment (abstract)
  ├── LocalEnvironment (subprocess + os.setsid)
  ├── DockerEnvironment (docker exec + cpu/memory/disk 限制)
  ├── SSHEnvironment (ControlMaster + rsync)
  ├── ModalEnvironment (Modal SDK sandbox)
  ├── ManagedModalEnvironment (Gateway HTTP API 代理)
  ├── DaytonaEnvironment (Daytona SDK + hibernation)
  └── SingularityEnvironment (singularity instance + overlay)
```

统一 `execute(command, cwd, timeout, stdin_data)` 接口 + snapshot 机制跨调用保持 env/cwd/alias（见 `.research/11-environments-spawn.md §3`）。

**EvoClaw** —— **无沙箱层**（CLAUDE.md 声称未兑现）:

- CLAUDE.md:18 声称"Docker (可选，3 模式: off/selective/all，首次使用时引导安装)"
- 实测：`grep -rn "docker\|sandbox" packages/core/src -i` 仅返回辅助提及（security/destructive-detector.ts 检测 docker 命令、Skill 描述），**无沙箱后端实现**
- 实际工具执行：`builtin-tools.ts:172` 等处直接 `execSync` / `spawn` 在 Sidecar 主进程

**判定 🔴**：EvoClaw 执行环境是**文档声称与代码未实现**的 gap。详见 `11-environments-spawn-gap.md` 建议 Docker 后端 MVP（~5d）。企业合规场景是硬需求（避免工具逃逸攻破整个 Sidecar）。

---

### §3.7 状态存储架构

**hermes** （`.research/03-architecture.md §2` + `.research/14-state-sessions.md`）

```
~/.hermes/
  ├── sessions.json      — 会话索引
  ├── sessions/
  │   └── sessions.db    — SQLite + FTS5
  ├── cron/              — Cron jobs
  ├── skills/            — 已安装 Skill
  ├── logs/              — agent.log + errors.log
  ├── memories/          — Memory provider 数据（每 provider 子目录）
  ├── SOUL.md            — Agent 人格文件（Docker 镜像内拷贝）
  └── .credentials.json  — API keys + OAuth tokens（明文）
```

- **明文存储**凭据（`~/.hermes/.credentials.json`），文件权限 0600
- FTS5 单独管理
- Profile 通过 `HERMES_HOME` 环境变量切换（所有 119+ 处 `get_hermes_home()` 读同一 env var）

**EvoClaw** （`packages/core/src/infrastructure/` + `apps/desktop/src-tauri/src/credential.rs`）

```
~/.evoclaw/           （数据目录）
  ├── evoclaw.db      — SQLite WAL（MigrationRunner 自动执行 migrations/*.sql）
  ├── vectors/        — sqlite-vec 向量索引
  ├── skills/         — 已安装 Skill
  ├── memory/         — 记忆辅助文件
  └── config/         — 多层配置合并后的结果

macOS Keychain           （原生加密存储）
  └── evoclaw-api-keys  — Provider API Keys（AES 加密，进程启动时用 Rust ring crate 解密）
```

**关键设计**（CLAUDE.md §关键架构模式）:
- `security-framework + ring` 在 Rust 侧操作 Keychain
- 敏感字段（API Key）由 **Tauri Rust 主进程**管理，TypeScript Sidecar 仅在需要时通过 Tauri command 取得解密值
- WAL 模式 + FTS5 + sqlite-vec（同一 SQLite 实例）

**判定 🟢 反超**：
- hermes 明文 `.credentials.json` 是企业合规的短板（即使 0600 权限，root/备份工具都能看到）
- EvoClaw Rust 侧 Keychain + ring AES 的**本地加密存储**是企业级安全的正确姿势
- 两者 Profile 语义不同：hermes 是**数据级多实例**（`--profile work`），EvoClaw 是**品牌级多产品**（`BRAND=healthclaw`），功能不对等（见 §3.10）

---

### §3.8 Session 持久化时机

**hermes** （`.research/03-architecture.md §3.1` + `.research/05-agent-loop.md §3.10`）

- `__init__` 时 `create_session(session_id, model, provider, ...)`
- **每次 API 调用后**：`update_token_counts(...)`（细粒度 token 统计，`run_agent.py:8023`）
- **循环结束后**：`_flush_messages_to_session_db(...)` 批量 flush 所有 messages
- 可选 `_save_trajectory(...)` → `trajectory_samples.jsonl`

**EvoClaw** （`packages/core/src/agent/kernel/query-loop.ts:507, 634, 366`）

```typescript
// 每轮 assistant 消息
config.persister?.persistTurn(state.turnCount, [roundResult.assistantMessage]);
// 每轮 tool_result
config.persister?.persistTurn(state.turnCount, [toolResultMsg]);
// 循环结束
config.persister?.finalize();
```

- **Per-turn 持久化**（断电/崩溃损失小）
- Persister 是可选的（`config.persister?` optional chaining）
- 具体实现：`packages/core/src/agent/kernel/incremental-persister.ts`

**判定 🟡**：两种路线取向不同：
- hermes batch flush —— DB write 次数少，吞吐量高
- EvoClaw per-turn —— 中断保障强，追求最终一致性

EvoClaw 的 per-turn 设计**更适合桌面应用**（用户可能随时关机），hermes 的 batch 设计**更适合服务器长会话**。

---

### §3.9 Prompt Caching 硬约束

**hermes** （`.research/03-architecture.md §4.4` + `AGENTS.md:339-347`）

> "Hermes-Agent ensures caching remains valid throughout a conversation. Do NOT implement changes that would:
> - Alter past context mid-conversation
> - Change toolsets mid-conversation
> - Reload memories or rebuild system prompts mid-conversation
>
> Cache-breaking forces dramatically higher costs."

- 唯一允许改历史消息的时机：`context_compressor` 触发压缩
- 设计上**禁止** mid-conversation 的 system prompt 重建、toolset 切换

**EvoClaw** （`packages/core/src/agent/kernel/query-loop.ts:128-152, 194-209, 361, 513-525`）

**Shadow Microcompact**（`applyDeferredTruncation`）:
```typescript
// query-loop.ts:128-152
function applyDeferredTruncation(msg: KernelMessage): KernelMessage {
  // 原消息 content 不变（保护 Prompt Cache），
  // 仅在发送给 API 时创建截断版本
  return { ...msg, content: newContent, microcompacted: undefined };
}
```

**ToolSchemaCache**（`stream-client.ts:104-164`）—— 稳定工具 schema 字节:
```typescript
class ToolSchemaCache {
  getAnthropicTools(tools): object[] { /* Object.freeze 缓存 schema */ }
}
```

**PromptCacheMonitor + cacheBreakpointIndex**（`query-loop.ts:361, 513-525`）:
```typescript
if (roundResult.usage.cacheWriteTokens > 0) {
  cacheBreakpointIndex = state.messages.length;  // 追踪最后一次 cache write
  collapseState = { ...collapseState, cacheBreakpointIndex };
}
```

**判定 🟢 反超**：两者都遵守硬约束，但 EvoClaw 的**三项细节反超**：
1. Shadow Microcompact 让压缩"看上去像没压缩"（原消息不变保护 cache）
2. ToolSchemaCache 稳定 tool bytes（防止工具定义微动破坏 cache）
3. `cacheBreakpointIndex` 追踪允许未来的**缓存感知微压缩**（只削断点之后的消息）

---

### §3.10 Profile / 多实例隔离

**hermes** （`.research/03-architecture.md §4.3` + `AGENTS.md:370-379`）

**HERMES_HOME 环境变量 + 延迟 import 模式**:
```python
# hermes_cli/main.py:83 (ADDENDUM 后行号)
def _apply_profile_override():
    # Parse -p <profile>
    os.environ["HERMES_HOME"] = f"/path/to/profile"
    # 之后才 import hermes_constants / run_agent 等
```

所有 119+ 处 `get_hermes_home()` 读同一 env var，**自动 scope 到正确 profile**:
```bash
hermes --profile work chat "hello"     # → ~/.hermes/profiles/work/
hermes --profile personal chat "hi"    # → ~/.hermes/profiles/personal/
```

完全隔离：独立配置 / API 密钥 / 记忆 / 会话 / 技能 / gateway。

**EvoClaw** （`package.json:28-31` + `scripts/brand-apply.mjs` + `packages/shared/src/brand.ts`）

**BRAND 环境变量 + 构建时字符串替换**:
```json
// package.json
"build:healthclaw": "BRAND=healthclaw bun scripts/brand-apply.mjs && turbo run build"
```

- `brand-apply.mjs` 在构建前替换品牌字符串（产品名、Logo、主题色、版权信息）
- 构建产出**不同的 DMG**（`EvoClaw.dmg` vs `HealthClaw.dmg`）
- 单一用户**只装一个品牌**，不切换

**判定 🟡**：**形态完全不同**:
- hermes Profile = 同一安装 + 多数据隔离（同一 binary，`--profile` 切换）
- EvoClaw BRAND = 多品牌 + 单数据（不同 binary，安装时已定）

两者不可对比，是**战略取向**决定的（hermes 多租户 per-user，EvoClaw 多产品 per-vertical）。**EvoClaw 当前无"用户在同一安装内切换多账号/多数据域"的能力**，若未来企业场景需要（如一个员工同时是主公司 + 子公司身份），需补充类似 HERMES_HOME 的多数据目录机制。

---

### §3.11 Gateway / Channel 抽象

**hermes** （`.research/03-architecture.md §3.3` + `.research/19-gateway-platforms.md`）

```
gateway/run.py
  ├── gateway/session.py SessionStore
  ├── gateway/platforms/
  │   ├── telegram.py
  │   ├── discord.py
  │   ├── slack.py
  │   ├── signal.py
  │   ├── matrix.py
  │   └── whatsapp.py
  └── gateway/delivery.py  — 跨平台消息投递
```

每个 `platforms/*.py` 处理：事件 → `enqueue(event)` → `gateway/run.py` consume → `AIAgent(...).run_conversation(msg)` → callbacks 流回。

**EvoClaw** （`packages/core/src/channel/` + `packages/core/src/routing/binding-router.ts` + `routes/channel-message-handler.ts`）

```
channel/
  ├── adapters/
  │   ├── feishu.ts
  │   ├── wecom-app.ts
  │   ├── wechat-ilink.ts
  │   └── desktop.ts
  ├── channel-manager.ts      — 统一生命周期管理
  ├── channel-state-repo.ts   — 渠道状态持久化（access_token 等）
  ├── command/                — Slash 命令系统（/remember /forget 等）
  └── session-key             — `agent:<agentId>:<channel>:dm:<peerId>`

routing/
  ├── binding-router.ts       — Channel → Agent 最具体优先匹配
  └── session-key.ts          — Session 路由键生成

routes/channel-message-handler.ts  — 统一消息入口（handleChannelMessage(deps)）
```

**独有设计**（CLAUDE.md §关键架构模式）:
- **Session Key 路由**：`agent:<agentId>:<channel>:dm:<peerId>` / `agent:<agentId>:<channel>:group:<groupId>`
- **Binding Router**: 最具体优先匹配（Channel → Agent 绑定，支持 pattern）
- **System Events**: 内存 per-session 事件队列（enqueueSystemEvent → chat.ts drainSystemEvents）
- **Standing Orders**: AGENTS.md 结构化 Program（Scope/Trigger/Approval/Escalation）系统 prompt 注入

**判定 🟢 反超**：EvoClaw 的 Channel 抽象更**工程化**:
- `BindingRouter` + `SessionKey` 是比 hermes gateway/session 更明确的"多 Agent × 多 Channel × 多会话"矩阵组织
- `ChannelStateRepo` 独立持久化 Channel 状态（access_token 轮换、iLink session cookie 等）
- Slash 命令系统作为一等公民（`remember.ts` / `forget.ts`）

详见 `19-gateway-platforms-gap.md`（Wave 2 W2-5）。

---

### §3.12 Agent 间协作（Subagent）

**hermes** （`.research/03-architecture.md §7` + `.research/05-agent-loop.md §3.8`）

- `delegate_task` 工具（`tools/delegate_tool.py`）—— 在当前进程内递归构造子 AIAgent
- `_run_single_child()` 保存/恢复 `_last_resolved_tool_names` 全局，临时切换 tool scope
- **同进程同步递归**（主循环 A 等子 Agent B 返回）
- 并发工具调用用 ThreadPoolExecutor（`_MAX_TOOL_WORKERS = 8`）

**EvoClaw** （`packages/core/src/agent/lane-queue.ts` + `packages/core/src/agent/kernel/builtin-tools.ts` spawn_agent）

- `spawn_agent` / `list_agents` / `kill_agent` / `steer_agent` / `yield_agents` 五个 Agent 级工具（`tool-catalog.ts:41-45`）
- **LaneQueue 3 车道**（`CLAUDE.md §关键架构模式`）:
  - `main(4)` —— 用户主对话（最多 4 并发）
  - `subagent(8)` —— 子 Agent（最多 8 并发）
  - `cron` —— 定时任务（可配）
- 每个 session key 车道内**串行**（同一 Agent 同一 Channel 不会冲突）

**判定 🟡**:
- hermes 递归模式更直观（父 Agent 等子 Agent）
- EvoClaw LaneQueue 模式更**现代化**（车道 + 并发控制 + session 串行保障）

EvoClaw 的 LaneQueue 设计更适合**多 Agent + 多 Channel 并发场景**（企业级多用户同时调用不同 Agent），hermes 的递归模式更适合**单用户深度任务链**。

---

### §3.13 Context 组装管道

**hermes** （`.research/03-architecture.md §3.1` + `.research/07-prompt-system.md`）

每轮 LLM call 前:
- `prompt_builder` 构造 system prompt（SOUL.md + memory + hints）
- `context_compressor` 触发压缩（threshold + target ratio）
- `prompt_caching` 设置 cache_control

无"hooks 生命周期"抽象 —— 都是 AIAgent 内部直接调方法。

**EvoClaw** （`packages/core/src/context/plugin.interface.ts` + `packages/core/src/context/plugins/*.ts`）

**ContextPlugin 5-hook 生命周期**（CLAUDE.md §关键架构模式）:

```typescript
interface ContextPlugin {
  name: string;
  bootstrap?(ctx: BootstrapContext): Promise<void>;     // 启动一次
  beforeTurn?(ctx: TurnContext): Promise<void>;         // 每轮开始
  compact?(ctx: CompactContext): Promise<void>;         // 压缩触发
  afterTurn?(ctx: TurnContext): Promise<void>;          // 每轮结束
  shutdown?(ctx: ShutdownContext): Promise<void>;       // 关闭
}
```

**10 个插件**（`packages/core/src/context/plugins/`）:
- context-assembler (system prompt 组装)
- tool-registry (工具注入)
- memory-recall (记忆召回)
- skill-injector (Skill 注入)
- standing-orders (Standing Orders 注入)
- heartbeat (心跳上下文)
- cache-control (cache 配置)
- gap-detection (TODO 列表注入)
- system-events (事件队列注入)
- knowledge-graph (实体关系)

**判定 🟢 反超**：ContextPlugin 抽象**显著优于** hermes 的命令式组装:
- 可扩展性：插件独立文件，新需求只需加 plugin 不改 AIAgent
- 可测试性：每个 hook 独立测试
- 可观测性：每个 plugin 的耗时/错误单独记录
- 职责分离：10 个职责 10 个文件 vs hermes 全在 AIAgent 里

---

### §3.14 异步事件流（SSE）

**hermes** （`.research/03-architecture.md §3.3`）

- 流式回传用 **callbacks**:
  - `stream_delta_callback` / `reasoning_callback` / `tool_gen_callback` / `thinking_callback` / `step_callback`
- 每个平台（Telegram/Discord 等）自己实现 callback 处理器
- 无标准化 Server-Sent Events

**EvoClaw** （`packages/core/src/routes/chat.ts` + `packages/core/src/agent/kernel/query-loop.ts`）

**Hono `streamSSE` 一等公民**:
```typescript
// routes/chat.ts 使用
return streamSSE(c, async (stream) => {
  for await (const event of queryLoopGenerator({ ... })) {
    await stream.writeSSE({ data: JSON.stringify(event) });
  }
});
```

- **SSE 是标准协议**（W3C 规范），任何 HTTP 客户端可消费
- `queryLoopGenerator`（`query-loop.ts:755-770`）是 `queryLoop` 的 async generator 包装
- 前端用 `EventSource` 原生 API 订阅（或 fetch + ReadableStream）
- 事件类型齐全：`text_delta` / `thinking_delta` / `tool_start` / `tool_end` / `tombstone` / `message_start` / `message_end` / `recall_meta` 等

**判定 🟢 反超**：EvoClaw 的 SSE 是**原生标准协议**，hermes 的 callbacks 是**应用层约定**。EvoClaw 的方案：
- 前端 `EventSource` 开箱即用
- 外部 HTTP 客户端（如 curl）可直接消费流
- Browser DevTools 可观察网络流

---

### §3.15 Rust 侧原生能力参与

**hermes** —— 无 Rust 侧（纯 Python + Node.js）。

**EvoClaw** （`apps/desktop/src-tauri/Cargo.toml` + `apps/desktop/src-tauri/src/`）

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
security-framework = "3.2"    # macOS Keychain Services 绑定
ring = "0.17"                  # 现代加密库（AES-256-GCM 等）
base64 = "0.22"
```

Rust 关键职责（`docs/architecture/Architecture_2026-03-20.md §1.1`）:

| 模块 | 行数 | 职责 |
|---|---|---|
| `sidecar.rs` | 420 | spawn Sidecar 子进程 + 自动重启 + 解析首行握手 JSON |
| `crypto.rs` | 164 | AES-256-GCM 加解密（敏感字段如 API Key） |
| `credential.rs` | 77 | macOS Keychain Services 读写 |
| `lib.rs` | 37 | Tauri 入口 + 命令注册 |
| **合计** | **703** | **Rust 核心** |

**判定 🟢 反超**（独有能力，hermes 无对应）:
- **Keychain 原生访问** —— Python 通过 `keyring` 间接调用，依赖系统 Keyring 进程；Rust 直接 `security-framework` crate 调 macOS API
- **ring AES-GCM** —— Rust 生态成熟加密库，性能 + 安全边界均好于纯 Python `cryptography`
- **Tauri 命令** —— 前端可以通过 `invoke()` 直接调 Rust 函数，无需过 HTTP 层，减少暴露面

此能力支撑 EvoClaw"企业级安全至上"的战略定位（见 `00-overview-gap.md §3.1`）。

---

## 4. 改造蓝图（不承诺实施）

### P0 / P1 / P2 见各子系统 gap 文档

本章是**架构级**对比，具体改造项均归到对应子系统 gap 文档:

| 差距来源 | 对应 gap 文档 | 改造优先级 |
|---|---|---|
| 执行环境沙箱（§3.6） | `11-environments-spawn-gap.md` | P1 |
| Credential 级 rotation（§3.7 反超但仍有不足） | `06-llm-providers-gap.md` | P0 |
| 活动心跳（§3.8 关联） | `05-agent-loop-gap.md` §3.3 | P1 |

### 本章独有建议（架构级，不属于任一子系统）

| # | 项目 | 对应差距 | 工作量 | 备注 |
|---|---|---|---|---|
| 1 | 多数据目录隔离（EVOCLAW_HOME 或 profile 机制） | §3.10 | 3-5d | 企业用户多账号/多身份场景（P2 长期） |
| 2 | Architecture 文档修正"Docker 3 模式"声称 | §3.6 | 0.5d + 沙箱实施后补文档 | 文档与代码一致性 |

### 不建议做

| # | 项目 | 理由 |
|---|---|---|
| — | 把 AIAgent 拆成单类（hermes 风格） | EvoClaw 分层设计（AgentManager/EmbeddedRunner/Kernel）是优势 |
| — | 同步主循环改造 | TS 全异步 vs Python 同步是生态决定，无需迁移 |
| — | Tool 注册改成 import 副作用 | EvoClaw CORE_TOOLS 静态清单更适合企业可审计场景 |

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应 |
|---|---|---|---|
| 1 | Agent 核心分层设计（AgentManager / EmbeddedRunner / Kernel）vs hermes AIAgent 11K 单类 | `packages/core/src/agent/{agent-manager.ts,embedded-runner-*.ts,kernel/*.ts}` | `run_agent.py:535+` 单类 |
| 2 | Rust 侧原生安全能力（Keychain + ring AES + Tauri 命令） | `apps/desktop/src-tauri/src/{sidecar,crypto,credential,lib}.rs` | 无对应，纯解释型 |
| 3 | 双进程 IPC 隔离（Tauri 主进程 + Sidecar 崩溃自恢复） | `apps/desktop/src-tauri/src/sidecar.rs:420` | 单进程崩溃需重启 |
| 4 | ContextPlugin 5-hook 生命周期 + 10 个独立插件 | `packages/core/src/context/plugin.interface.ts` + `context/plugins/*.ts` | 命令式组装，全在 AIAgent 里 |
| 5 | Session Key 路由 + Binding Router 最具体优先匹配 | `packages/core/src/routing/binding-router.ts` + `session-key.ts` | gateway/session 无精细路由 |
| 6 | LaneQueue 3 车道（main/subagent/cron）+ session key 内串行 | `packages/core/src/agent/lane-queue.ts` | 同进程递归 + ThreadPoolExecutor |
| 7 | SSE 标准协议原生支持（Hono `streamSSE` + async generator） | `packages/core/src/routes/chat.ts` + `query-loop.ts:755-770 queryLoopGenerator` | Callbacks 应用层约定 |
| 8 | PromptCacheMonitor + cacheBreakpointIndex 追踪 | `query-loop.ts:361, 513-525` + `prompt-cache-monitor.ts` | 无对应 |
| 9 | Shadow Microcompact（压缩原消息不变保护 cache） | `query-loop.ts:128-152 applyDeferredTruncation` | 压缩直接改原消息 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（本章所有 `path:line` 均经 Read / Bash 验证 2026-04-16）

- `apps/desktop/src-tauri/Cargo.toml:13-19` ✅ Rust 依赖（tauri 2 + security-framework + ring + base64）
- `packages/core/src/server.ts:1-50` ✅ 14+ 路由注册
- `packages/core/src/agent/tool-catalog.ts:18-59` ✅ 33 个 CORE_TOOLS 静态清单
- `packages/core/src/agent/kernel/query-loop.ts:340-697` ✅ queryLoop 主函数
- `packages/core/src/agent/kernel/query-loop.ts:507, 634, 366` ✅ per-turn persister
- `packages/core/src/agent/kernel/query-loop.ts:128-152` ✅ Shadow Microcompact
- `packages/core/src/agent/kernel/query-loop.ts:755-770` ✅ queryLoopGenerator
- `packages/core/src/agent/kernel/stream-client.ts:104-164` ✅ ToolSchemaCache
- `packages/core/src/agent/kernel/prompt-cache-monitor.ts` ✅ PromptCacheMonitor
- `packages/core/src/context/plugin.interface.ts` ✅ ContextPlugin 5-hook（bootstrap/beforeTurn/compact/afterTurn/shutdown）
- `packages/core/src/context/plugins/` ✅ 10 个插件目录
- `packages/core/src/routing/binding-router.ts` ✅ BindingRouter
- `packages/core/src/agent/lane-queue.ts` ✅ LaneQueue 3 车道
- `docs/architecture/Architecture_2026-03-20.md §1.1` ✅ 系统全局架构图（Rust 703 行 / Sidecar 94 文件 ~15K 行 / React 16 页面 ~7K 行）

### 6.2 hermes 研究章节引用

- `.research/03-architecture.md §1, §2` — 6 路入口组件图
- `.research/03-architecture.md §3.1` — CLI 入口时序
- `.research/03-architecture.md §3.2` — AGENTS.md 主循环伪代码
- `.research/03-architecture.md §3.3` — Gateway 入口时序
- `.research/03-architecture.md §3.4` — Tool 注册发现链（import-time 魔法）
- `.research/03-architecture.md §4.1` — AIAgent 构造签名
- `.research/03-architecture.md §4.2` — Tool 注册典型代码
- `.research/03-architecture.md §4.3` — HERMES_HOME profile 机制
- `.research/03-architecture.md §4.4` — Prompt Caching 硬约束
- `.research/03-architecture.md §6` — 复刻清单（静态结构 + 动态结构）
- `AGENTS.md:82-125` — AIAgent 主循环伪代码源

### 6.3 关联 gap 章节（crosslink）

- [`00-overview-gap.md`](./00-overview-gap.md) §3.3 — 入口形态（本章 §3.2 深化）
- [`01-tech-stack-gap.md`](./01-tech-stack-gap.md) §3.17 — Rust 侧原生能力（本章 §3.15 技术栈视角）
- [`05-agent-loop-gap.md`](./05-agent-loop-gap.md) — Agent 主循环细节（本章 §3.3-§3.4 深化）
- `04-core-abstractions-gap.md` (Wave 1 #4) — AIAgent / LoopState / ContextPlugin 等类型
- `07-prompt-system-gap.md` (Wave 2 W2-3) — prompt_builder vs ContextAssembler 细节
- `08-context-compression-gap.md` (Wave 1 #6) — context_compressor vs context-compactor 细节
- `09-tools-system-gap.md` (Wave 2 W2-1) — 工具注册细节（本章 §3.5 深化）
- `11-environments-spawn-gap.md` (Wave 2 W2-2) — 执行环境沙箱（本章 §3.6 深化）
- `14-state-sessions-gap.md` (Wave 2 W2-3) — SessionDB 细节
- `19-gateway-platforms-gap.md` (Wave 2 W2-5) — Channel/Gateway 抽象细节（本章 §3.11 深化）
- `29-security-approval-gap.md` (Wave 2 W2-10) — Rust 侧安全能力（本章 §3.15）

---

**本章完成**。架构级对比盘点：**进程模型根本不同**（单 Python vs Tauri 双进程），但在**Agent 中心 / 工具注册 / Prompt Cache 硬约束** 等抽象层面设计思路相近。EvoClaw 在**Rust 侧原生安全 / Agent 分层 / ContextPlugin 生命周期 / Binding Router / SSE 标准 / LaneQueue**六个维度反超 hermes；**执行环境沙箱缺失**是唯一明显 🔴 差距（已在 CLAUDE.md 声称但代码未实现）。
