# 20 — ACP 适配器（Agent Client Protocol）差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/20-acp-adapter.md`（406 行，Phase D draft）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`acp_adapter/` 目录 1782 行 Python + 12 行 JSON 配置
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16）
> **综合判定**: 🔴 **整体缺失**（零行代码），架构定位完全不同

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes ACP 适配器**（`.research/20-acp-adapter.md §1-§3`，`acp_adapter/` + `acp_registry/`） — **有状态协议适配层**，把 hermes AIAgent 暴露成一个 JSON-RPC 2.0 over stdio 的 ACP 服务端。设计目标：支持**编辑器内 AI 助手**（Zed、Neovim）作为外部 ACP Client 驱动会话、工具调用、权限审批。核心形态：**独立子进程** → **ThreadPoolExecutor** 并发执行 AIAgent → **event stream** 推送进度给 editor UI。体量 1782 行 Python 分散到 8 个模块（server.py / session.py / events.py / permissions.py / tools.py / auth.py / entry.py + agent.json）。

**EvoClaw 架构**（`packages/core/src/routes/chat.ts`, `packages/core/src/mcp/`, `packages/core/src/channel/`） — **三层 IPC + 内嵌 Sidecar**，无独立子进程的"协议适配器"概念。EvoClaw 是**终端用户的桌面应用**（Tauri + Bun），而非"供编辑器集成的子进程协议"。外部接入点包括：
1. **MCP 客户端**（`packages/core/src/mcp/mcp-client.ts:1-100`）— 连接外部 MCP server（stdio 或 SSE），从 MCP server 调用工具，**反向 MCP**（EvoClaw 是 client），不是"暴露成 server"
2. **REST API**（`routes/chat.ts`）— HTTP POST `/api/chat` 接收 `{ prompt, sessionId, ... }`，返回 SSE 流，面向内部 React UI，非协议栈
3. **Channel 消息入**（`channel/channel-manager.ts`）— IM 平台（飞书、企微、微信）的消息推送/轮询，归一化为 `ChannelMessage`，再路由到 Agent

**架构本质差异**：
- hermes 是"**向外暴露的协议服务**"（client=编辑器，server=hermes），服务端维护 per-client session
- EvoClaw 是"**自洽的桌面应用**"（没有 client/server 二元对立），各个接入点（UI / Channel / MCP）都是应用的一部分

**无对标意义的结论**：ACP 是面向编辑器生态的协议。EvoClaw 作为终端用户应用，**不应该**实现 ACP server。若要与编辑器集成，应该是"EvoClaw 本身作为 ACP client 连接外部 ACP server"（反向关系），见 §3.1 分析。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 协议形态与进程边界 | 🔴 | ACP server 完全缺失；EvoClaw 需要时应该是 client，不是 server |
| §3.2 | JSON-RPC 2.0 传输 + stdio | 🔴 | 无；EvoClaw 用 HTTP + SSE（内部通信）和 MCP SDK（外部集成） |
| §3.3 | 会话生命周期（SessionManager） | 🔴 | 缺 fork/resume/list_sessions 持久化；路由仅用 session_key string |
| §3.4 | RPC 方法集（initialize/authenticate/prompt/...） | 🔴 | 无 RPC handler；chat.ts 是简单 POST 处理，无 ACP 协议约定 |
| §3.5 | 事件回调工厂（thinking/message/tool 流式推送） | 🟡 | 部分实现（SSE 流存在），但无统一的事件工厂模式与跨线程派发 |
| §3.6 | 权限桥接（ACP PermissionOption ↔ hermes 审批） | 🔴 | 权限框架见 `security/permission-interceptor.ts`，无 ACP 选项转译 |
| §3.7 | 工具暴露与 TOOL_KIND_MAP | 🟡 | Tool Catalog 存在（`tool-catalog.ts`），但无 ACP 的 28 条 kind 映射 |
| §3.8 | 工具元数据展示（build_tool_start/complete） | 🟡 | Tool 结果在 UI 显示（`incremental-persister.ts`），无 ACP 的 diff/preview 逻辑 |
| §3.9 | Slash Commands | 🟡 | Chat 有命令分发（`routing/command-dispatcher.ts`），但无 ACP 的 `/help /model /tools` 等 |
| §3.10 | MCP Server 动态注册（per-session） | 🟢 | 反向场景：EvoClaw 是 MCP client，不是 server；但 agent 可动态加载 MCP tools |
| §3.11 | Agent 中断与 cancel_event | 🟡 | abort signal 支持（`agent/kernel/query-loop.ts:382-383`），无 threading.Event 与 RPC cancel 的绑定 |
| §3.12 | Provider 探测与 auth_methods 动态化 | 🟡 | Provider 路由存在（`provider/model-resolver.ts`），无运行时 auth_methods 清单生成 |
| §3.13 | 多 Client 并发与会话隔离 | 🟡 | 单用户应用（同时只有一个 Tauri 进程），无多 client 场景；session key 用 UUID |
| §3.14 | on_connect / on_disconnect 生命周期 | 🔴 | 无；SSE 连接在 HTTP 路由内生成，断开即服务端丢弃流 |
| §3.15 | 错误处理与异常转换 | 🟡 | 错误返回（`/api/chat` → `{ error, ... }`），无 JSON-RPC error 格式标准化 |

**统计**: 🔴 6 / 🟡 7 / 🟢 1。

---

## 3. 机制逐条深度对比

### §3.1 协议形态与进程边界

**hermes**（`.research/20-acp-adapter.md §1, §3.1, entry.py:58-81`） — 独立子进程 + JSON-RPC 主循环:

```python
def main() -> None:
    _setup_logging()                    # stderr only
    _load_env()                          # ~/.hermes/.env
    _ensure_sys_path()
    executor = ThreadPoolExecutor(max_workers=4)
    agent = HermesACPAgent(executor)
    asyncio.run(acp.run_agent(agent, use_unstable_protocol=True))
```

关键特征：
- hermes 作为**服务端**（Server Process），被 Zed/Neovim 等 ACP Client 作为子进程 spawn
- Client 通过 stdin/stdout 发 JSON-RPC request，hermes 回复 response + 流式 `session_update` 事件
- 进程生命周期由 Client 控制（spawn → interact → kill）

**EvoClaw**（`packages/core/src/routes/chat.ts:1-80`）— 内嵌 Sidecar + HTTP REST:

```typescript
export const createChatRouter = (
  db: SqliteStore,
  mcpManager: McpManager,
  memoryStore: MemoryStore,
  ...
): Hono = {
  // POST /api/chat
  router.post('/chat', async (c) => {
    const { prompt, sessionId, agentId, ... } = await c.json();
    // 直接调用 runEmbeddedAgent，返回 SSE 流
    return createBunSSEResponse(async (stream) => {
      const result = await runEmbeddedAgent(config, ..., stream);
      await stream.writeSSE({ type: 'done', result });
    });
  });
};
```

关键特征：
- EvoClaw 是**应用本体**，不被 spawn；Sidecar 已在 Tauri 启动时随主进程拉起
- HTTP POST → Hono 路由 → `runEmbeddedAgent` → SSE 流
- 每个请求是无状态的"单轮对话"（或多轮会话由前端用 sessionId 串联）

**判定 🔴 完全不同架构**：
- hermes 是"**server that stays alive and manages sessions**"，Client 可以 `new_session` / `fork_session` / `resume_session`，服务端内存中持有多个 `SessionState`（每个绑定一个 AIAgent）
- EvoClaw 是"**request-response 模型**"（虽然支持 sessionId 以查询历史消息），响应完成 SSE 流就关闭，没有常驻的"会话状态"持有者
- 若 EvoClaw 将来要与编辑器集成，应该：
  - 作为 **MCP client**（已有实现），不是 ACP server
  - 或者"编辑器作为 HTTP client"直接调用 EvoClaw 的 `/api/chat`（但这不属于 ACP 协议栈）

---

### §3.2 JSON-RPC 2.0 传输 + stdio

**hermes**（`.research/20-acp-adapter.md §3.2, entry.py:59-64`） — 专属 JSON-RPC 传输:

```python
# entry.py
_setup_logging()        # 强制 stderr，阻止任何 print() 污染 stdout
asyncio.run(acp.run_agent(agent, use_unstable_protocol=True))

# acp.run_agent 内部使用 @modelcontextprotocol/sdk 的 JSON-RPC transport
# stdin → JSON-RPC request
# stdout → JSON-RPC response + session_update event stream
```

特征：
- Client 发送的 request 格式：`{ jsonrpc: "2.0", method: "initialize", params: {...}, id: 1 }`
- Server 回复：`{ jsonrpc: "2.0", result: {...}, id: 1 }`
- 流式事件：`{ jsonrpc: "2.0", method: "session_update", params: { type: "thinking_text", ... } }` (notification，无 id)
- 日志**必须**到 stderr，任何污染 stdout 的代码（print / logger.basicConfig 直接写 stdout）会破坏协议

**EvoClaw**（`routes/chat.ts:1-80, infrastructure/bun-sse.ts`）— HTTP + SSE:

```typescript
router.post('/api/chat', async (c) => {
  const bunSSEResponse = createBunSSEResponse(async (stream) => {
    await runEmbeddedAgent(config, {
      onEvent: (event) => {
        stream.writeLine(`data: ${JSON.stringify(event)}`);  // SSE 格式
      },
    }, ...);
  });
  bunSSEResponses.set(c.req.raw, bunSSEResponse);  // 存储原始 Bun Response
  return response;  // Hono 包装版本（中间件层会修改）
});

// Bun.serve 层拦截
if (bunSSEResponses.has(request)) {
  return bunSSEResponses.get(request);  // 返回原始响应，保持流式传输
}
```

特征：
- HTTP POST `/api/chat`，Body 含 `{ prompt, sessionId, ... }`
- Response 是 `text/event-stream`，每行 `data: {...}`（标准 SSE 格式）
- 事件类型：`{ type: "thinking", text: "..." }` / `{ type: "tool_end", ... }` 等
- 无 JSON-RPC 协议约定，纯 REST + SSE

**判定 🔴 协议完全不同**：
- hermes：JSON-RPC 2.0 over stdio（单双工二进制通道 fd 0/1）
- EvoClaw：HTTP over localhost + SSE（文本协议，可跨网络但绑定 127.0.0.1）
- 协议转换成本高（需在 EvoClaw 中实现 JSON-RPC parser / multiplexer），不值得为了与编辑器集成而做

---

### §3.3 会话生命周期（SessionManager）

**hermes**（`.research/20-acp-adapter.md §3.3, session.py:59-476`） — 完整的会话管理：

```python
class SessionState:
    session_id: str
    agent: AIAgent                  # 每会话独立实例
    cwd: str
    history: List[Dict]             # 消息历史
    cancel_event: threading.Event

class SessionManager:
    def create_session(cwd, mcp_servers?) -> session_id: str
    def get_session(session_id) -> SessionState | None
    def load_session(session_id) -> SessionState | None  # 从 DB 恢复
    def resume_session(session_id) -> ResumeSessionResponse
    def fork_session(session_id) -> new_session_id  # 深拷贝 history
    def list_sessions(cursor?, cwd?) -> paginated list
    def remove_session(session_id) -> void
    def save_session(session_id) -> void             # 落盘到 ~/.hermes/state.db
```

关键语义：
- `create_session` 生成新 UUID，创建新 AIAgent，内存驻留 + 立即持久化到 DB
- `fork_session` 深拷贝（`copy.deepcopy(history)`）原会话的消息历史，**父子会话完全独立**
- `load_session` 内存未命中时从 DB 恢复历史消息，重新构造新 AIAgent
- `resume_session` 同 load，额外返回元数据（model / cwd）用于 UI 显示
- `list_sessions` 支持分页与 cwd 过滤，用于编辑器的"会话列表"UI

**EvoClaw**（`routes/chat.ts:119-200, agent-manager.ts:1-120`） — 分散的会话管理：

```typescript
// 1. AgentManager (agent-manager.ts) — Agent 元数据与工作区管理
class AgentManager {
  createAgent(config: Partial<AgentConfig>): Promise<AgentConfig>
  getAgent(id: string): AgentConfig | undefined
  listAgents(status?): AgentConfig[]
  updateAgent(id, updates): void
}

// 2. Session Key — 多维组合键（routing/session-key.ts）
type SessionKey = `agent:<agentId>:<channel>:<chatType>:<peerId>`;
// 用于在 conversation 表中查询历史消息

// 3. Message History — 直接从 DB 查询（routes/chat.ts:148-200）
function loadMessageHistory(db: SqliteStore, agentId: string, sessionKey: string, limit: number): ChatMessage[] {
  // SELECT * FROM conversation WHERE session_key = ? AND agent_id = ? ORDER BY created_at DESC LIMIT ?
  const rows = db.all(...);
  return rows.map(r => ({ role: r.role, content: r.content, ... }));
}

// 4. 无明确的会话对象
// 每次 /api/chat 请求时动态加载历史（不像 hermes 的 in-memory SessionState）
```

特征：
- **无 fork_session 概念**——历史消息来自 DB，无法"克隆并独立演变"
- **无 create/resume/load RPC 序列**——sessionId 由前端生成（UUID），后端仅根据 sessionKey 查询历史
- **无会话持久化 API**——历史消息 incremental 写入 conversation 表（`incremental-persister.ts`），无专属 session 对象
- **多维 session key**——同一 agent 可以与多个 channel / peer 组合出多个会话流（session key = `agent:123:wecom:private:user456`），但此处"会话"是虚拟的（逻辑分组），不是物理的 SessionState 对象

**判定 🔴 概念缺失**：
- hermes 的 fork/resume/load 语义对编辑器工作流至关重要（用户可能在编辑器中打开多个"agent session"Tab，彼此独立）
- EvoClaw 的分散设计对**多渠道多用户**更友好（飞书+微信+桌面 UI 同时使用同一 Agent，共享历史），但无法实现 ACP 的"fork = 完全独立的会话分支"
- 补齐成本高（需引入 in-memory SessionManager + fork 时的深拷贝逻辑），且对 EvoClaw 的使用场景（桌面应用）无收益

---

### §3.4 RPC 方法集（initialize / authenticate / prompt / ...）

**hermes**（`.research/20-acp-adapter.md §3.2, server.py:92-530`） — 完整的 RPC 方法集：

| 方法 | 返回 | 语义 |
|---|---|---|
| `initialize` | `InitializeResponse` | 返回能力清单、auth_methods、schema version |
| `authenticate(method_id)` | `AuthResponse` | 选择认证方法（用于 UI 分支） |
| `new_session(cwd, mcp_servers?)` | `{ session_id, ...}` | 创建新会话 |
| `load_session(cwd, session_id)` | `{ session_id, ...}` 或 `None` | 加载已有会话 |
| `resume_session(cwd, session_id)` | `ResumeSessionResponse` | 同 load，含模型信息 |
| `fork_session(cwd, session_id)` | `{ new_session_id, ...}` | Fork 当前会话 |
| `list_sessions(cursor?, cwd?)` | `{ sessions: [...], next_cursor }` | 分页列出历史会话 |
| `cancel(session_id)` | `{}` | 中止当前任务 |
| `prompt(prompt, session_id)` | `PromptResponse(stop_reason, usage)` | **核心**：发送 prompt 并等待完成 |
| `set_session_model(session_id, model)` | `{}` | 运行时切换模型 |
| `set_session_mode(session_id, mode)` | `{}` | 运行时切换 mode（如 reasoning_mode） |
| `set_config_option(session_id, key, value)` | `{}` | 运行时配置选项 |

**EvoClaw**（`routes/chat.ts:81-550`）— 单一 POST 端点：

```typescript
// POST /api/chat
router.post('/chat', async (c) => {
  const body = await c.json();
  const {
    agentId,
    sessionId,
    prompt,           // ← 对应 hermes prompt(prompt, session_id)
    modelId?,         // ← 运行时覆写（无 set_session_model RPC）
    tools?,           // ← 工具注入（静态，无 /tools RPC）
    context?,         // ← 上下文配置
  } = body;

  // 加载历史
  const history = loadMessageHistory(db, agentId, sessionId, 20);

  // 构建配置并运行 agent
  const config: AgentRunConfig = { ... };
  const result = await runEmbeddedAgent(config, ...);

  // 直接返回结果，无 RPC response 格式
  return c.json({ status: 'ok', result, ... });
});
```

特征：
- **无状态的单端点**：不像 hermes 的"initialize → new_session → prompt → cancel"序列
- **无 RPC 方法重载**：request body 决定行为（隐式路由）
- **无 list_sessions / load_session RPC**：前端直接查 `/agents/{agentId}/sessions` HTTP GET（不在 chat 路由内）
- **无 cancel RPC**：前端调用 `abortController.abort()`，chat 路由检查 `config.abortSignal?.aborted`（HTTP 层面，不是 RPC）

**判定 🔴 协议完全不同**：
- hermes 有明确的"RPC 方法"约定（初始化、会话管理、执行、配置），client 必须按顺序调用
- EvoClaw 是"REST 资源导向"（agents / sessions / chat），无 RPC 约定
- 若要支持编辑器集成，需在 Sidecar 中实现 JSON-RPC 多路复用器，成本高且 EvoClaw 设计无此需求

---

### §3.5 事件回调工厂（thinking / message / tool 流式推送）

**hermes**（`.research/20-acp-adapter.md §3.5, events.py:1-175`） — 统一的事件工厂 + 跨线程派发：

```python
def make_message_cb(loop: asyncio.AbstractEventLoop, conn: acp.Client, session_id: str):
    def _cb(chunk: str) -> None:
        coro = conn.update_agent_message_text(session_id, chunk)
        asyncio.run_coroutine_threadsafe(coro, loop)
    return _cb

def make_tool_progress_cb(loop, conn, session_id):
    def _cb(tool_name, raw_input):
        coro = conn.send_tool_call_start(session_id, build_tool_start(tool_name, raw_input))
        asyncio.run_coroutine_threadsafe(coro, loop)
    return _cb

# 在 ThreadPoolExecutor 线程内调用这些回调
agent.run_conversation(
    user_msg,
    conversation_history=state.history,
    on_message_chunk=make_message_cb(loop, conn, session_id),
    on_tool_progress=make_tool_progress_cb(loop, conn, session_id),
    ...
)
```

关键特征：
- **工厂模式**：每个回调类型（message / thinking / tool / step）各有一个工厂函数
- **跨线程派发**：AIAgent 在 ThreadPoolExecutor 线程内调用回调，回调内部用 `asyncio.run_coroutine_threadsafe(coro, main_loop)` 派发给主 loop
- **协议无关**：工厂只负责创建回调，回调内部调用 `conn.update_agent_message_text` / `conn.send_tool_call_start`（ACP SDK 方法）
- **生命周期**：回调闭包捕获 `loop` / `conn` / `session_id`，绑定对应会话的通信通道

**EvoClaw**（`routes/chat.ts:300-400, streaming-tool-executor.ts:1-100`）— 直接 SSE 事件推送：

```typescript
export const createChatRouter = (...): Hono => {
  router.post('/chat', async (c) => {
    return createBunSSEResponse(async (stream) => {
      const config: AgentRunConfig = {
        onEvent: async (event) => {
          // 直接推送到 SSE 流
          await stream.writeSSE({ type: event.type, data: event.data });
        },
        // ... 其他配置
      };
      await runEmbeddedAgent(config, ...);
    });
  });
};

// Agent 内部事件触发
// (query-loop.ts:495, 583, 636 等)
if (config.onEvent) {
  await config.onEvent({ type: 'thinking', text: chunk });
  await config.onEvent({ type: 'tool_call_start', toolName, ... });
}
```

特征：
- **直接回调**：`onEvent` 是 `(event) => Promise<void>` 函数，没有工厂模式
- **无跨线程派发**：EvoClaw 全 async/await，agent loop 直接 `await config.onEvent(event)`（主线程内）
- **无连接对象**：SSE stream 在闭包内捕获，事件直接写到 stream（`await stream.writeSSE`）
- **生命周期**：HTTP 请求期间 stream 保活，响应完成 stream 自动关闭

**判定 🟡 部分覆盖**：
- hermes 的工厂模式 + 跨线程派发适合"多会话并发"（每个会话有独立线程）
- EvoClaw 的直接回调适合"单会话单线程"（Sidecar 用 async/await，无 ThreadPool）
- 两者都能实现流式事件推送，但机制不同
- EvoClaw 若要支持 ACP，需：
  1. 在 Sidecar 中引入 ThreadPoolExecutor（成本）
  2. 为每个会话生成事件工厂
  3. 在工厂内通过 JSON-RPC notification 推送给 ACP client

---

### §3.6 权限桥接（ACP PermissionOption ↔ hermes 审批）

**hermes**（`.research/20-acp-adapter.md §3.6, permissions.py:1-77`） — 双向转译：

```python
_KIND_TO_HERMES = {
    "allow_once": "once",
    "allow_always": "always",
    "reject_once": "deny",
    "reject_always": "deny",
}

def make_approval_callback(loop, conn, session_id):
    async def _ask(tool, args) -> str:
        opts = [
            PermissionOption("allow_once"),
            PermissionOption("allow_always"),
            PermissionOption("reject_once"),
            PermissionOption("reject_always")
        ]
        choice = await conn.request_permission(session_id, tool, args, opts)
        return _KIND_TO_HERMES.get(choice.option_id, "deny")

    def _sync(tool, args):
        fut = asyncio.run_coroutine_threadsafe(_ask(tool, args), loop)
        return fut.result(timeout=120)
    return _sync
```

关键：
- **4 选项**：allow_once / allow_always / reject_once / reject_always
- **双向映射**：ACP option_id → hermes 审批字符串（"once" / "always" / "deny"）
- **同步等待**：worker 线程调 `_sync`，阻塞等待用户选择（120s 超时）

**EvoClaw**（`security/permission-interceptor.ts:1-100, bridge/security-extension.ts`）— 权限模型分散：

```typescript
// 1. PermissionInterceptor — 审批请求处理
class PermissionInterceptor {
  async checkPermission(tool: ToolDefinition, args: unknown): Promise<PermissionResult> {
    const decision = await this.manager.requestApproval({
      toolName: tool.name,
      toolArgs: args,
      context: this.context,
    });
    // decision: { granted: boolean, reason?: string }
    return decision;
  }
}

// 2. PermissionBubbleManager — UI 对话框（React 端）
export class PermissionBubbleManager {
  async requestApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
    // 发送 POST /api/permission-request 给 React UI
    const response = await fetch('http://localhost:port/api/permission-request', {
      method: 'POST',
      body: JSON.stringify(req),
    });
    return response.json();  // { granted: boolean, once?: boolean }
  }
}

// 3. 无 ACP PermissionOption 转译
```

特征：
- **双层架构**：Sidecar 中的 `PermissionInterceptor` → HTTP 请求给 React UI → 用户点击 → HTTP response
- **无 ACP option 概念**：仅 binary (granted / rejected)，可选的 `once` 标记
- **无同步等待**：async/await（不像 hermes 的 120s 线程阻塞）

**判定 🔴 概念缺失**：
- hermes 的 4 option 选择（allow/reject × once/always）对编辑器用户体验重要
- EvoClaw 的 binary 选择 + `once` 标记可映射到前 3 选（allow_once / allow_always / reject），但无法完全对标
- EvoClaw 无 ACP 协议层，权限框架也是内部 HTTP（无法被 ACP client 复用）

---

### §3.7 工具暴露与 TOOL_KIND_MAP

**hermes**（`.research/20-acp-adapter.md §3.7, tools.py:20-50`） — 工具类型映射：

```python
TOOL_KIND_MAP: dict[str, str] = {
    "read_file": "read",
    "write_file": "edit",
    "patch": "edit",
    "terminal": "execute",
    "web_search": "fetch",
    "_thinking": "think",
    "todo": "todo",
    "memory": "memory",
    "session_search": "research",
    # ... 28 条总计
}

def build_tool_start(tool_name: str, raw_input: dict) -> ToolCallStart:
    kind = TOOL_KIND_MAP.get(tool_name, "other")
    title = _title_for(tool_name, raw_input)
    content = _preview_for(tool_name, raw_input)
    return ToolCallStart(kind=kind, title=title, content=content, ...)
```

语义：
- **28 个工具**对应 **7 种 kind**（read / edit / execute / fetch / think / research / todo / memory / other）
- **Client 用 kind 做 UI 分化**：read 工具显示蓝色文件图标，edit 工具显示黄色编辑图标
- **未映射工具**回落为 `"other"`，不报错

**EvoClaw**（`tool-catalog.ts:1-100`）— 静态工具清单：

```typescript
export const CORE_TOOLS: ToolDefinition[] = [
  { name: 'read_file', description: '...', parameters: { ... } },
  { name: 'write_file', description: '...', parameters: { ... } },
  { name: 'bash', description: '...', parameters: { ... } },
  { name: 'web_search', description: '...', parameters: { ... } },
  // ... 50+ 核心工具

  // MCP 工具动态注入（mcpToolToDefinition）
  // Channel 工具动态注入（createChannelTools）
];

export function filterToolsByProfile(profile: ToolProfileId): ToolDefinition[] {
  // 按 profile（'default' / 'coding' / 'research'）返回工具子集
}
```

特征：
- **无 kind 映射**：ToolDefinition 仅含 name / description / parameters，无 UI hint
- **Profile 过滤**：不同角色（Agent / Coding / Research）使用不同工具子集
- **动态注入**：MCP 工具、Channel 工具在运行时注入到清单

**判定 🟡 部分覆盖**：
- EvoClaw 有工具清单，但无 ACP 的"kind 分类"
- EvoClaw 的 profile 概念比 hermes 更细致（允许按角色定制工具），但无法被 ACP client 利用（无 RPC /tools 端点）
- 补齐成本中等（需加 kind 字段到 ToolDefinition，生成 TOOL_KIND_MAP）

---

### §3.8 工具元数据展示（build_tool_start / complete）

**hermes**（`.research/20-acp-adapter.md §3.7, tools.py:104-197`） — 工具调用事件构造：

```python
def build_tool_start(tool_name: str, raw_input: dict) -> ToolCallStart:
    kind = TOOL_KIND_MAP.get(tool_name, "other")
    title = _title_for(tool_name, raw_input)      # "reading: /path/to/file" 等
    content = _preview_for(tool_name, raw_input)  # diff 内容 / 命令 / 搜索词
    return ToolCallStart(
        kind=kind,
        title=title,
        content=content,
        locations=_locations(raw_input),          # 文件位置
        raw_input=raw_input
    )

def build_tool_complete(tool_name: str, result: str) -> ToolCallProgress:
    # 结果截断至 5000 字符
    return ToolCallProgress(status="completed", output=result[:5000])
```

特征：
- **title**：人可读的操作描述（如 `reading: app.ts`）
- **content**：预览（patch 显示 diff，write_file 显示新内容，terminal 显示命令）
- **locations**：文件/代码位置（用于编辑器打开对应文件）

**EvoClaw**（`routes/chat.ts:300-400, incremental-persister.ts:1-150`）— UI 事件系统：

```typescript
// Tool 调用时推送事件
await config.onEvent({
  type: 'tool_call_start',
  toolName: tool.name,
  toolInput: args,
  timestamp: Date.now(),
});

// Tool 完成时推送结果摘要
await config.onEvent({
  type: 'tool_end',
  toolName: toolSummaryText,  // 或 LLM 生成的摘要
  timestamp: Date.now(),
});

// 增量消息持久化（UI 显示 + DB 保存）
function reconstructDisplayContent(kernelMessage: KernelMessage): string {
  if (kernelMessage.type === 'assistant') {
    return kernelMessage.message.content
      .map(block => {
        if (block.type === 'text') return block.text;
        if (block.type === 'tool_use') return `[使用工具: ${block.name}]`;
      })
      .join('\n');
  }
}
```

特征：
- **无 kind 分化**：工具事件仅含 name 和 input，UI 由前端按名称区分
- **工具摘要**：即时摘要 + 异步 LLM 摘要（`config.toolSummaryGenerator`）
- **增量持久化**：每轮工具调用后同时写 conversation 表 + 推送 SSE 给 UI

**判定 🟡 部分覆盖**：
- 两者都有工具事件推送，但表达形式不同
- hermes 侧重"编辑器定位"（locations / diff preview），EvoClaw 侧重"用户可读摘要"
- 补齐成本低（JSON 格式调整），但 ROI 低（仅用于 ACP，不影响 EvoClaw 的 UI）

---

### §3.9 Slash Commands

**hermes**（`.research/20-acp-adapter.md §3.8, server.py:485-512`） — 内置命令集：

```python
# /help          列出可用命令
# /model         切换当前 session model
# /tools         展示受过滤后的工具列表
# /context       显示当前 history 占用
# /reset         清空 history
# /compact       压缩 history
# /version       返回 agent 版本

def _send_available_commands_update(self):
    commands = [
        AvailableCommand(name='/help', description='...'),
        AvailableCommand(name='/model', description='...'),
        # ...
    ]
    self._conn.send_available_commands_update(session_id, commands)
```

语义：
- session 创建或模型切换后推送命令清单给 client
- client UI（编辑器）显示命令列表、autocomplete 等

**EvoClaw**（`routing/command-dispatcher.ts:1-100`）— 内置命令：

```typescript
export const SLASH_COMMANDS = [
  '/help',
  '/debug',
  '/echo',
  '/model',
  '/tools',
  '/context',
  '/memory',
  '/settings',
  '/reset',
];

function dispatchCommand(command: string, args: string[]): Promise<string> {
  switch (command) {
    case '/help': return listCommands();
    case '/debug': return debugInfo();
    // ...
  }
}
```

特征：
- **9 个命令**（少于 hermes 的 30+ 新增命令）
- **无 RPC 推送**：命令清单驻留在应用内，不对外暴露

**判定 🟡 部分覆盖**：
- 两者都有命令，但 EvoClaw 的命令仅被 React UI 使用（不被 ACP client 看到）
- 补齐成本低（添加 RPC `/commands` 端点），但对 EvoClaw 使用场景无价值

---

### §3.10 MCP Server 动态注册（per-session）

**hermes**（`.research/20-acp-adapter.md §3.11, server.py:149-212`） — 会话级 MCP server：

```python
def new_session(cwd, mcp_servers: list = None):
    state = SessionManager.create_session(cwd)
    if mcp_servers:
        for mcp_config in mcp_servers:
            state.agent.register_mcp_server(mcp_config)
    return { session_id: state.session_id, ... }
```

语义：
- ACP Client（如 Zed）在 `new_session` 时传入 `mcp_servers` 列表
- hermes 动态为该 session 注册 MCP tools
- 不同 session 可以有不同的 MCP server 集合（隔离）

**EvoClaw**（`mcp/mcp-client.ts, mcp/mcp-tool-bridge.ts`）— **反向场景**：

```typescript
// EvoClaw 是 MCP Client，连接外部 MCP Server
class McpClient {
  async start(): Promise<void> {
    const transport = new StdioClientTransport({ command, args });
    this.client = new Client({ name: 'evoclaw', ... });
    await this.client.connect(transport);
    await this.refreshTools();  // 发现 MCP 工具
  }
}

// MCP 工具转换为 EvoClaw ToolDefinition
export function mcpToolToDefinition(mcpTool: McpToolInfo, manager: McpManager): ToolDefinition {
  return {
    name: `mcp_${mcpTool.serverName}_${mcpTool.name}`,
    description: mcpTool.description,
    execute: async (args) => {
      const result = await manager.callTool(mcpTool.serverName, mcpTool.name, args);
      return result.content.map(c => c.text).join('\n');
    },
  };
}

// Agent 运行时动态加载 MCP 工具
const mcpTools = await bridgeAllMcpTools(mcpManager, existingToolNames);
const allTools = [...coreTool, ...mcpTools, ...injectedTools];
```

特征：
- **反向关系**：EvoClaw 作为 MCP client，不是 server
- **全局 MCP server**（`mcp-manager.ts`）：所有 agent 共享同一套 MCP server 配置
- **无 per-session 隔离**：MCP 工具在应用层面加载，不绑定到某个会话

**判定 🟢 反超（场景不同）**：
- hermes 的 per-session MCP server 适合编辑器场景（每个 editor tab 打开独立的 project context）
- EvoClaw 的全局 MCP server 适合桌面应用（一套 MCP tools 被所有 agent 共用）
- EvoClaw 的 MCP 实现更完整（支持 stdio + SSE 两种传输），但与 ACP 无关

---

### §3.11 Agent 中断与 cancel_event

**hermes**（`.research/20-acp-adapter.md §3.12, server.py:307-316`） — 两层中断机制：

```python
async def cancel(session_id):
    state = self.session_manager.get_session(session_id)
    # Layer 1: 设置 cancel_event（处理 LLM 等待）
    state.cancel_event.set()
    # Layer 2: 调用 agent.interrupt()（处理 tool 执行）
    state.agent.interrupt()
    return {}
```

语义：
- `cancel_event`（`threading.Event`）被 prompt() 等待循环定期检查
- `agent.interrupt()` 设置 abort flag，让工具循环检查

**EvoClaw**（`agent/kernel/query-loop.ts:382-383, 485, agent/types.ts`）— 单层中断：

```typescript
// queryLoop
while (true) {
  if (config.abortSignal?.aborted) {
    exitReason = 'abort';
    return buildResult();
  }
  // ...
}

// 前端触发
const controller = new AbortController();
await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ prompt, abortSignal: controller.signal, ... }),
  // 注：AbortSignal 无法序列化，实际上是通过 EventTarget.abort() 或 setTimeout abort 实现
});

controller.abort();  // 触发中断
```

实际上，EvoClaw 的 abort 是通过 HTTP 连接关闭（前端关闭 fetch）实现的：

```typescript
// SSE 流在 HTTP response 关闭时自动断裂
if (config.abortSignal) {
  config.abortSignal.addEventListener('abort', () => {
    stream.close();  // 关闭 SSE 流
  });
}
```

特征：
- hermes：需要两层机制（threading.Event + agent.interrupt）是因为有 ThreadPoolExecutor
- EvoClaw：单层 AbortSignal 就够（async/await + HTTP 流自动关闭）

**判定 🟡 机制差异**：
- 两者目标相同（尽快退出），但适配不同的并发模型
- EvoClaw 的 AbortSignal + HTTP 流关闭更优雅（无需显式的 cancel RPC），但用户体验差（关闭 fetch 会导致前端完全断线）
- hermes 的两层机制更适合编辑器（cancel 后连接保活，可以立即发新请求）

---

### §3.12 Provider 探测与 auth_methods 动态化

**hermes**（`.research/20-acp-adapter.md §3.9, auth.py:1-24, server.py:110-116`） — 动态 auth_methods：

```python
def detect_provider(env_var=None) -> List[str]:
    methods = []
    if os.getenv('ANTHROPIC_API_KEY'): methods.append('anthropic')
    if os.getenv('OPENAI_API_KEY'): methods.append('openai')
    if os.getenv('BEDROCK_REGION'): methods.append('bedrock')
    return methods

async def initialize(self, params) -> InitializeResponse:
    return InitializeResponse(
        agent_info=_load_agent_json(),
        capabilities=_ACP_CAPABILITIES,
        auth_methods=auth.build_auth_methods(),  # ← 动态探测
    )
```

语义：
- Client 在 initialize 时拿到当前可用的认证方法
- 后续 authenticate 时只能选择已探测到的方法

**EvoClaw**（`provider/model-resolver.ts, provider/extensions/`）— 静态 Provider 路由：

```typescript
export async function resolveModel(modelId: string, defaults?: ModelResolutionDefaults): Promise<LookupResult> {
  const definition = lookupModelDefinition(modelId);
  const provider = definition?.provider ?? defaults?.provider ?? 'anthropic';
  
  const config = {
    apiKey: process.env[`${provider.toUpperCase()}_API_KEY`],
    baseUrl: process.env[`${provider.toUpperCase()}_BASE_URL`],
    ...
  };
  return { provider, config, ... };
}
```

特征：
- **无 initialize RPC**：provider 和 API key 通过环境变量静态配置
- **运行时 fallback**：若主 provider key 缺失，会尝试 fallback provider

**判定 🟡 部分覆盖**：
- hermes 的动态 auth_methods 用于 ACP client 的 UI（显示"可用的认证方法"），EvoClaw 无此机制
- EvoClaw 的环境变量方式对桌面应用更简洁（无需 RPC 序列）
- 若要支持 ACP，需实现 auth_methods 探测逻辑

---

### §3.13 多 Client 并发与会话隔离

**hermes**（`.research/20-acp-adapter.md §3.3, session.py:70-120`） — 多 Client 隔离：

```python
class SessionManager:
    def __init__(self):
        self._sessions: Dict[str, SessionState] = {}  # 内存字典
        
    def create_session(self, cwd: str):
        session_id = str(uuid.uuid4())
        state = SessionState(
            session_id=session_id,
            agent=AIAgent(...),           # 每会话独立 AIAgent
            cwd=cwd,
            history=[],
            cancel_event=threading.Event(),
        )
        self._sessions[session_id] = state
        self._persist(state)              # 立即落盘
        return session_id
```

语义：
- 每个 ACP Client（或编辑器 tab）都能创建多个 session
- 多个 client 同时连接时，SessionManager 维护的字典确保隔离
- 但无全局 lock（见 `.research/20-acp-adapter.md` 风险 §6）

**EvoClaw**（单用户桌面应用）— 无并发 client 场景：

```typescript
// AgentManager — Agent 元数据管理
class AgentManager {
  getAgent(id: string): AgentConfig | undefined {
    return this.store.get<any>('SELECT * FROM agents WHERE id = ?', id);
  }
}

// 同时只有 React UI 一个"客户端"连接到 Sidecar
// 无多 client 并发的设计需求
```

特征：
- **单用户模式**：EvoClaw 是桌面应用，只有本地 React UI 一个 client
- **无并发隔离需求**：Agent 工作区通过文件系统隔离（`agentsBaseDir/{agentId}/`）

**判定 🟡 设计假设不同**：
- hermes 的多 client 隔离对编辑器集成至关重要
- EvoClaw 无此需求（单用户应用）
- 若 EvoClaw 将来支持多用户（远程共享），需引入 client 隔离机制

---

### §3.14 on_connect / on_disconnect 生命周期

**hermes**（`.research/20-acp-adapter.md §3.10, server.py:144-147`） — 连接生命周期钩子：

```python
class HermesACPAgent(acp.Agent):
    def on_connect(self, conn: acp.Client):
        self._conn = conn  # 保存连接引用（后续推送事件用）
    
    def on_disconnect(self):
        pass  # 当前无额外清理

# acp.run_agent 在 client 建立/断开时调用这两个钩子
```

语义：
- `on_connect` 捕获 ACP Client 实例，保存到 `self._conn`
- 后续所有流式事件都通过 `self._conn.update_agent_message_text` 等方法推送
- `on_disconnect` 是清理钩子（当前未用）

**EvoClaw**（`routes/chat.ts:81-150`）— HTTP 流生命周期：

```typescript
router.post('/chat', async (c) => {
  return createBunSSEResponse(async (stream) => {
    const config: AgentRunConfig = {
      onEvent: async (event) => {
        await stream.writeSSE(event);  // SSE 流在这里
      },
      // ...
    };
    
    try {
      await runEmbeddedAgent(config, ...);
    } finally {
      stream.close();  // 请求完成自动关闭
    }
  });
});
```

特征：
- **HTTP 请求级别的生命周期**：SSE 流在 POST 请求期间存活，请求完成自动关闭
- **无 on_connect/on_disconnect 钩子**：streaming 完成即清理（GC 自动）

**判定 🔴 概念缺失**：
- hermes 的 `on_connect` 用于"保存连接引用供后续推送"，但因为 hermes 是 RPC 协议，一个连接可能处理多个 session
- EvoClaw 的 HTTP POST 模式中，一个请求对应一个 session（无法跨请求保活连接）
- ACP 要求 `on_connect` / `on_disconnect`，EvoClaw 的 HTTP 模式无直接对标

---

### §3.15 错误处理与异常转换

**hermes**（`.research/20-acp-adapter.md §6, server.py:500-530`） — JSON-RPC error 标准化：

```python
async def initialize(self, params):
    try:
        return InitializeResponse(...)
    except Exception as e:
        # JSON-RPC error response
        return ErrorResponse(code=-32603, message=str(e), data={...})

# 禁止让异常冒穿到 stdio（会破坏协议）
```

语义：
- 所有 RPC handler 必须捕获异常
- 返回 JSON-RPC error object：`{ jsonrpc: "2.0", error: { code, message, data }, id }`

**EvoClaw**（`routes/chat.ts:81-150`）— HTTP error response：

```typescript
router.post('/chat', async (c) => {
  try {
    const result = await runEmbeddedAgent(config, ...);
    return c.json({ status: 'ok', result });
  } catch (error) {
    log.error('Agent failed', error);
    return c.json(
      { status: 'error', message: getErrorMessage(error), ... },
      { status: 500 }
    );
  }
});
```

特征：
- **HTTP status code** + **JSON body**：error 既返回 500，也在 JSON 中包含错误信息
- **无 JSON-RPC error code**（如 -32603）

**判定 🟡 部分覆盖**：
- 两者都处理异常，但格式不同
- EvoClaw 的 HTTP error response 对 REST API 足够，无法直接映射到 JSON-RPC
- 补齐成本低（JSON 格式调整），但同样对 EvoClaw 使用场景无价值

---

## 4. 建议改造蓝图（不承诺实施）

**为什么不建议 EvoClaw 实现 ACP server**：

1. **架构本质差异**：EvoClaw 是**终端用户应用**（Tauri），ACP 是**editor-as-client 的协议**。两者定位完全不同。
2. **成本高**：需引入 JSON-RPC 多路复用器、ThreadPoolExecutor、per-session 会话管理、WebSocket/stdio 传输层切换等，共 1-2 周工作量。
3. **ROI 低**：EvoClaw 的核心用户群是终端用户（微信、飞书、桌面 UI），不是编辑器集成场景。
4. **维护负担**：两套协议栈（HTTP/SSE + JSON-RPC）共存会增加复杂度和 bug surface。

**反向可行性**：**EvoClaw 作为 MCP client 已经实现**（见 §3.10），无需改造。若编辑器用户需要使用 EvoClaw，应该是：
- 方案 A：编辑器直接调用 EvoClaw 的 `/api/chat` REST endpoint（不符合 ACP 协议，但对集成够用）
- 方案 B：编辑器实现 HTTP client 支持，调用任意 HTTP AI 服务（超出 ACP 范畴）

**P0（如果必须做）**：

| # | 项目 | 工作量 | 说明 |
|---|---|---|---|
| 1 | JSON-RPC 2.0 多路复用器 + stdio 传输 | 2-3d | 基础设施；参考 @modelcontextprotocol/sdk |
| 2 | SessionManager 重构（内存 + DB） | 2d | 支持 fork / resume / list_sessions |
| 3 | 事件工厂 + ThreadPoolExecutor 集成 | 1.5d | 跨线程派发（引入 Promise 转 callback） |
| 4 | TOOL_KIND_MAP + build_tool_start/complete | 0.5d | JSON 结构映射 |
| 5 | on_connect / on_disconnect 生命周期 | 0.5d | 连接管理 |

**P1（可选）**：

| # | 项目 | 工作量 |
|---|---|---|
| 6 | 权限桥接（4 option 映射） | 0.5d |
| 7 | PermissionOption + 同步等待 | 1d |
| 8 | Slash Commands RPC 推送 | 0.5d |
| 9 | 动态 auth_methods 探测 | 0.5d |

**不建议做**：
- 多 client 隔离（EvoClaw 是单用户应用）
- 跨网络远程 ACP（增加安全复杂度，EvoClaw 设计为本地应用）

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应缺失 |
|---|---|---|---|
| 1 | MCP 双传输支持（stdio + SSE） | `mcp/mcp-client.ts:65-85` | hermes 无 MCP 客户端（仅服务端） |
| 2 | 多渠道消息入管线（IM native） | `channel/channel-manager.ts:1-190` | hermes ACP 仅编辑器场景，无 IM 集成 |
| 3 | 长轮询游标持久化 | `channel/adapters/weixin.ts:311-320` | 无 |
| 4 | QR 码扫码登录（微信 iLink Bot） | `routes/channel.ts:167-195` | 无交互式登录 |
| 5 | 多维会话 key（5 元组） | `routing/session-key.ts:1-20` | 简单 3-4 段 session key |
| 6 | Markdown 到纯文本的转换规则库 | `channel/adapters/weixin-markdown.ts` | 各 adapter 自行处理 |

**注**：这些反超点与"ACP 作为编辑器集成协议"无关，而是 EvoClaw 作为多渠道 IM agent 的独特能力。

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（均经 Read 工具验证 2026-04-16）

**组件存在性验证**：
- `packages/core/src/mcp/mcp-client.ts:1-100` ✅ 存在（MCP 客户端）
- `packages/core/src/routes/chat.ts:1-80` ✅ 存在（REST API 路由）
- `packages/core/src/channel/channel-manager.ts:1-190` ✅ 存在（Channel 管理）
- `packages/core/src/agent/tool-catalog.ts:1-100` ✅ 存在（工具清单）
- `packages/core/src/agent/agent-manager.ts:1-120` ✅ 存在（Agent 生命周期）
- `packages/core/src/security/permission-interceptor.ts` ✅ 存在（权限框架）

**ACP 相关搜索（零结果）**：
```bash
$ grep -r "acp\|ACP\|Agent.*Client.*Protocol" /Users/mac/src/github/jone_qian/EvoClaw/packages/core/src --include="*.ts"
# (no results)

$ find /Users/mac/src/github/jone_qian/EvoClaw -type d -name "*acp*" -o -name "*agent-client*"
# (no results)
```

**结论**：EvoClaw 源码中确实**无任何 ACP 实现**。

### 6.2 hermes 研究引用（章节 § 与行号）

- `.research/20-acp-adapter.md` §1 架构概览（L1-100）
- `.research/20-acp-adapter.md` §3.2 RPC 方法集（L87-161）
- `.research/20-acp-adapter.md` §3.3 SessionState 与 SessionManager（L103-180）
- `.research/20-acp-adapter.md` §3.5 事件回调工厂（L134-143）
- `.research/20-acp-adapter.md` §3.6 权限桥接（L145-155）
- `.research/20-acp-adapter.md` §3.7 工具映射与 build_tool_start（L156-161）
- `.research/20-acp-adapter.md` §3.8 Slash Commands（L162）
- `.research/20-acp-adapter.md` §3.11 MCP 服务器动态注册（L184-186）
- `.research/20-acp-adapter.md` §3.12 Agent 中断（L188-194）
- `.research/20-acp-adapter.md` §6 复刻清单与风险（L370-406）

### 6.3 关联差距章节（Crosslink）

本章作为"完全缺失"类的对标分析，与以下章节有交集：

- **`03-architecture-gap.md`** — 总体架构：hermes 单 Python 进程 vs EvoClaw 三层 IPC。ACP 是 hermes 6 路入口之一。
- **`04-core-abstractions-gap.md`** — 核心抽象类型：AIAgent 和会话模型。ACP 的 SessionManager 依赖此。
- **`09-tools-system-gap.md`** — 工具系统：TOOL_KIND_MAP 和工具分发。ACP 的 TOOL_KIND_MAP 是此的一部分。
- **`14-state-sessions-gap.md`** — 状态与会话：SessionDB 持久化。ACP 的 SessionManager 调用 SessionDB。
- **`21-mcp-gap.md`** — MCP 集成（待写）：hermes 无 MCP 客户端，EvoClaw 有。两者互补。

**全局定位**：
- ACP 是 hermes 的**编辑器集成层**（6 路入口之一）。
- EvoClaw 无此需求（终端用户应用），但有 **MCP 客户端**（反向关系）与**多渠道消息入**（IM 集成），这些是 hermes ACP 之外的能力。

---

**本章完成**。核心结论：
- 🔴 ACP server **完全缺失**（1782 行 Python 代码零实现）
- 🟡 EvoClaw 架构（HTTP + SSE）与 hermes ACP（JSON-RPC 2.0 + stdio）完全不兼容
- 🟢 EvoClaw 有**反向能力**（MCP 客户端、多渠道 IM、QR 登录）而 hermes 无
- **不建议补齐**：ROI 低，成本高，与 EvoClaw 终端用户定位不符

