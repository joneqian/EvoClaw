# 04 — 核心抽象类型 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/04-core-abstractions.md`（~700 行类型字典）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），10 个核心类型（AIAgent / IterationBudget / ToolEntry / ToolRegistry / BaseEnvironment / ProcessHandle / SessionDB / ContextCompressor / MemoryProvider / CredentialPool）
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），类型分布在 `packages/core/src/agent/{types,kernel/types}.ts` + `context/plugin.interface.ts` + 各子模块
> **综合判定**: 🟡 **类型命名与组织风格不同**（Python dataclass/class vs TypeScript interface/type），**核心概念有深度交集**，EvoClaw 在**不可变 LoopState / ContextPlugin 5-hook / KernelTool 类型** 三项反超，在 **ProcessHandle Protocol / MemoryProvider 抽象 / CredentialPool** 三项缺失

**档位图例**:
- 🔴 EvoClaw 明显落后
- 🟡 部分覆盖 / 形态差异
- 🟢 EvoClaw 对齐或反超

---

## 1. 定位

**hermes 类型字典**（`.research/04-core-abstractions.md §1-§2`）:

10 个必须复刻的核心类型，按分层归纳（参见 `.research/04-core-abstractions.md §1` mermaid class 图）:

```
AIAgent (run_agent.py:439) ─ owns ──┬─ IterationBudget (L170-211, threading.Lock)
                                     ├─ ContextCompressor (agent/context_compressor.py:53)
                                     ├─ SessionDB (hermes_state.py:115)
                                     ├─ MemoryProvider (agent/memory_provider.py:42, abstract)
                                     └─ CredentialPool (agent/credential_pool.py:86)

ToolRegistry (tools/registry.py:48, singleton) ─ contains ── ToolEntry (L24, __slots__)

BaseEnvironment (tools/environments/base.py:114, abstract) ─ produces ── ProcessHandle (Protocol)
```

**Python 风格特征**:
- 用 `class` + `threading.Lock` 实现可变共享状态（`IterationBudget._used`）
- `__slots__` 节省内存（`ToolEntry` 因为工具数多）
- Abstract base class（`BaseEnvironment` / `MemoryProvider`）
- Protocol 做结构化类型（`ProcessHandle`）

**EvoClaw 类型体系**（跨文件分散，无单一"字典章"）:

| 类型分类 | 文件 | 代表类型 |
|---|---|---|
| Kernel 消息 / block | `packages/core/src/agent/kernel/types.ts` | `TextBlock` / `ToolUseBlock` / `ThinkingBlock` / `KernelMessage` |
| Kernel 工具 | 同上 | `KernelTool`（L235）/ `StreamEvent`（L331） |
| Kernel 循环状态 | 同上 | `LoopState`（L449）/ `QueryLoopResult`（L460）/ `ExitReason`（L424）|
| Stream 配置 | 同上 | `StreamConfig`（L400）/ `SystemPromptBlock`（L381，支持 cacheControl + scope）|
| Agent 高层 | `packages/core/src/agent/types.ts` | `AgentRunConfig`（L22）/ `ToolCallRecord`（L85）/ `RuntimeEvent`（L146） |
| Context 插件生命周期 | `packages/core/src/context/plugin.interface.ts` | `ContextPlugin`（L63）/ 5 hooks |
| DB 存储 | `packages/core/src/infrastructure/db/sqlite-store.ts` | `SqliteStore`（类） |
| 记忆 | `packages/core/src/memory/memory-store.ts` | `MemoryStore` |
| 提供商注册 | `packages/core/src/provider/*` | （扩展机制，无中心 Registry 类） |
| 工具目录 | `packages/core/src/agent/tool-catalog.ts` | `CoreToolMeta`（L10）+ `CORE_TOOLS` readonly array |

**TypeScript 风格特征**:
- 大量 `interface` / `type` 用于接口与联合类型
- `readonly` + immutable spread（`LoopState` 用 `state = { ...state, turnCount: state.turnCount + 1 }`）
- 无 `threading.Lock`（Node/Bun 单线程 event loop + AsyncQueue）
- `as const` literal type（如 `ExitReason` 是字面量联合）

**关键范式差异**:
- hermes **可变对象 + 锁**（`IterationBudget.consume()` with lock）
- EvoClaw **不可变快照 + spread**（`LoopState` 每次更新新建对象）

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | Agent 中心类（AIAgent vs AgentManager/Runner/Kernel 分层） | 🟢 | EvoClaw 三层分离更清晰（见 03 章 §3.3） |
| §3.2 | 迭代预算（IterationBudget vs turnCount + tokenBudget 回调） | 🔴 | EvoClaw 无线程安全跨 session 共享预算 |
| §3.3 | 工具元数据（ToolEntry vs KernelTool + CoreToolMeta） | 🟢 | EvoClaw interface 表达更精细（shouldDefer/searchHint/concurrencySafe 等字段） |
| §3.4 | 工具注册表（ToolRegistry singleton vs CORE_TOOLS array + ContextPlugin） | 🟡 | 集中式 vs 静态清单 + 动态插件，各有优劣 |
| §3.5 | 循环状态（隐式 self.xxx vs 显式 LoopState） | 🟢 | **反超**: EvoClaw 不可变 LoopState + transition 标记 |
| §3.6 | 退出原因/转换（隐式返回 vs ExitReason + TransitionReason） | 🟢 | **反超**: EvoClaw 枚举化退出和转换 |
| §3.7 | 执行环境抽象（BaseEnvironment + 9 后端 vs 无） | 🔴 | EvoClaw 缺沙箱抽象（见 03 §3.6 / 11 章） |
| §3.8 | 进程句柄 Protocol（ProcessHandle vs 无） | 🔴 | EvoClaw 进程管理分散在 bash 工具内联 |
| §3.9 | Session 存储（SessionDB vs SqliteStore + 多 store） | 🟡 | 集中 vs 分布，EvoClaw 职责细分 |
| §3.10 | 上下文压缩类（ContextCompressor class vs module functions） | 🟡 | 不同风格，功能对等（EvoClaw 模块化） |
| §3.11 | Memory 抽象（MemoryProvider ABC vs MemoryStore 单一实现） | 🔴 | EvoClaw 无 provider 切换抽象（由设计选择） |
| §3.12 | Credential 池（CredentialPool class vs 无） | 🔴 | 见 05 §3.7 / 06 章 |
| §3.13 | Stream 事件类型（callbacks vs StreamEvent 联合类型） | 🟢 | **反超**: EvoClaw `StreamEvent` 20+ 变体代数联合 |
| §3.14 | Prompt Block 类型（str vs SystemPromptBlock + cacheControl） | 🟢 | **反超**: EvoClaw 细粒度块 + cache + scope 内建 |
| §3.15 | Context 插件接口（无 vs ContextPlugin 5-hook） | 🟢 | **反超**: EvoClaw 独创生命周期抽象 |
| §3.16 | Thinking block 表达（dict 字段 vs ThinkingBlock interface 含 signature） | 🟢 | **反超**: 内建 signature + redacted_thinking 支持 |

**统计**: 🔴 5 / 🟡 4 / 🟢 7（全反超）。

---

## 3. 机制逐条深度对比

### §3.1 Agent 中心类

见 [`03-architecture-gap.md §3.3`](./03-architecture-gap.md)，本节不重复。

简述：hermes `AIAgent` 单类 11K 行（`run_agent.py:439+`）vs EvoClaw `AgentManager`（高层生命周期）+ `EmbeddedRunner`（attempt 循环）+ `queryLoop`（`kernel/query-loop.ts:340-697`）三层分离。**判定 🟢**，EvoClaw 更清晰。

---

### §3.2 迭代预算（IterationBudget）

**hermes** （`.research/04-core-abstractions.md §2.2` + `run_agent.py:170-211`）:

```python
class IterationBudget:
    def __init__(self, max_total: int):
        self.max_total = max_total
        self._used = 0
        self._lock = threading.Lock()

    def consume(self) -> bool:
        with self._lock:
            if self._used >= self.max_total: return False
            self._used += 1
            return True

    def refund(self) -> None: ...
    @property
    def remaining(self) -> int: ...
```

**特性**：
- **线程安全**（`threading.Lock`，因并发工具可能同时 consume）
- **跨 session 共享**（subagent 与主 Agent 共享同一实例，体现"整个会话"预算语义）
- `refund()` 机制给 `execute_code` 这种"内部 RPC"工具豁免

**EvoClaw** （`packages/core/src/agent/kernel/types.ts:449-458` LoopState + `query-loop.ts:387-391, 595-615`）:

```typescript
// types.ts
export interface LoopState {
  messages: readonly KernelMessage[];
  turnCount: number;
  transition: TransitionReason | null;
  overflowRetries: number;
  maxOutputRecoveryCount: number;
  effectiveMaxTokens: number;
  effectiveModelId: string;
}

// query-loop.ts:387-391
if (state.turnCount >= config.maxTurns) {
  exitReason = 'max_turns';
  return buildResult();
}

// query-loop.ts:595-615 — tokenBudget 回调
if (config.tokenBudget) {
  const decision = config.tokenBudget(state.turnCount, totalInput, totalOutput);
  if (decision.action === 'continue' && decision.nudgeMessage) { ... }
  if (decision.action === 'stop') { ... }
}
```

**特性**：
- **单次对话 `maxTurns` 约束**（config 传入，不跨 session 共享）
- **TokenBudget 回调**（token 维度预算，非 iteration count）
- 无 `refund()` 机制
- 单线程（Bun/Node event loop），无需锁

**判定 🔴**：EvoClaw 缺 "**跨 session 共享的 iteration 计数器**"：
- `spawn_agent` 工具派生的子 Agent 各自使用自己的 `maxTurns`，无全局上限保护
- `LaneQueue main(4)` 是**并发控制**而非"配额共享"
- 详见 [`05-agent-loop-gap.md §3.2`](./05-agent-loop-gap.md)

---

### §3.3 工具元数据（ToolEntry / KernelTool）

**hermes** （`.research/04-core-abstractions.md §2.3` + `tools/registry.py:24-45`）:

```python
class ToolEntry:
    __slots__ = (
        "name", "toolset", "schema", "handler", "check_fn",
        "requires_env", "is_async", "description", "emoji",
        "max_result_size_chars",
    )
    def __init__(self, name, toolset, schema, handler, check_fn, ...): ...
```

10 个字段：
- `name` / `toolset` / `schema`（OpenAI JSON schema）
- `handler`（lambda args, **kw → str，硬约束返回字符串）
- `check_fn`（() → bool，runtime 可用性门控）
- `requires_env`（list[str] 环境变量依赖）
- `is_async`（async handler 标志）
- `description` / `emoji`（终端前缀）
- `max_result_size_chars`（结果截断上限，可为 `float('inf')`）

**EvoClaw** （`packages/core/src/agent/kernel/types.ts:235-297` KernelTool）:

```typescript
export interface KernelTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  execute: (args, ctx) => Promise<ToolCallResult>;
  concurrencySafe?: boolean;         // 流中并发预执行标志
  shouldDefer?: boolean;              // 被工具搜索延迟加载
  searchHint?: string;                // 延迟加载提示
  maxResultSizeChars?: number;        // 结果截断上限
  // 更多字段（见源码）
}

// tool-catalog.ts:10-15
export interface CoreToolMeta {
  id: string;
  section: ToolSection;
  label: string;
  description: string;
}
```

**EvoClaw 独有字段**:
- `concurrencySafe` —— 流中并发预执行（`StreamingToolExecutor` 使用）
- `shouldDefer` + `searchHint` —— 大工具按需加载机制
- `inputSchema`（而非 `schema`）—— 明确仅指 input

**判定 🟢 反超**：EvoClaw `KernelTool` interface 表达更**精细**：
- `concurrencySafe` 字段直接驱动 StreamingToolExecutor 决策
- `shouldDefer` 支持"工具目录按需 hydrate"机制
- TypeScript 的 `JSONSchema` 类型提供**编译时**约束，hermes `dict` 运行时才发现 schema 错
- 分离 `KernelTool`（运行时执行）与 `CoreToolMeta`（目录展示）两个职责

---

### §3.4 工具注册表

**hermes** （`.research/04-core-abstractions.md §2.4` + `tools/registry.py:48-230, 290`）:

```python
# tools/registry.py:290
registry = ToolRegistry()   # 模块级单例

class ToolRegistry:
    _tools: Dict[str, ToolEntry]
    _toolset_checks: Dict[str, Callable]

    def register(...): ...       # L59 唯一写入入口
    def deregister(name): ...    # L95 MCP 动态刷新用
    def get_definitions(tool_names, quiet): ...   # L116
    def dispatch(name, args, **kwargs) -> str: ... # L149
```

- **单例模式**（模块级 `registry = ToolRegistry()`）
- **Import 副作用注册**（`tools/*.py` bottom 调 `registry.register(...)`）
- `dispatch` 是唯一执行入口，内部做 async bridging

**EvoClaw** —— **无单例 Registry**，工具集成是**静态清单 + ContextPlugin 动态**混合:

```typescript
// tool-catalog.ts:18-59 (33 个工具元数据静态清单)
export const CORE_TOOLS: readonly CoreToolMeta[] = [
  { id: 'read', section: 'fs', ... },
  { id: 'write', section: 'fs', ... },
  // ...
];

// context/plugins/tool-registry.ts 在 ContextPlugin.beforeTurn 中
// 根据 session context + Agent profile + Skills 动态组装可用 KernelTool[]
```

- 无 `ToolRegistry` 单例类
- 无 `dispatch()` 统一入口 —— `KernelTool.execute()` 直接调（每个工具自带 executor）
- `StreamingToolExecutor` 负责并发 + 预执行（`packages/core/src/agent/kernel/streaming-tool-executor.ts`）

**判定 🟡**：
- hermes 单例 + import 副作用 —— 灵活扩展但**全局状态隐式**
- EvoClaw 静态清单 + plugin —— **显式可审计** 但新增工具需多处改动

两种路线可取其一，不存在优劣。见 [`03-architecture-gap.md §3.5`](./03-architecture-gap.md)。

---

### §3.5 循环状态

**hermes** —— 隐式在 `AIAgent` 实例字段上:

```python
# .research/04-core-abstractions.md §2.1 列举
self.model: str
self.max_iterations: int
self.iteration_budget: IterationBudget
self._interrupt_requested: bool
self._delegate_depth: int
self._active_children: list
self._fallback_index: int
self._fallback_chain: list
# ... 150+ private helpers 在同一 self 上
```

状态散落在 `AIAgent` 实例 150+ 字段上，每个方法可能修改任意字段 —— **可变共享状态**。

**EvoClaw** （`packages/core/src/agent/kernel/types.ts:449-458`）:

```typescript
export interface LoopState {
  messages: readonly KernelMessage[];     // readonly 不可变
  turnCount: number;
  transition: TransitionReason | null;     // 状态转换原因
  overflowRetries: number;
  maxOutputRecoveryCount: number;
  effectiveMaxTokens: number;
  effectiveModelId: string;
}

// query-loop.ts:508 immutable update
state = { ...state, turnCount: state.turnCount + 1 };
```

**特性**:
- **`readonly messages`** —— TypeScript 编译期防止修改
- **不可变更新** —— 每次都 spread 新建对象
- **`transition` 标记** —— 记录状态从哪来（`'tool_use' | 'overflow_retry' | 'model_fallback' | 'stop_hook_blocking' | 'max_tokens_recovery' | 'token_budget_continue' | null`）

**判定 🟢 反超**：EvoClaw LoopState **显式不可变 + 转换标记**:
- 调试可追溯（每次 state 变化看 `transition` 字段知道原因）
- 并发安全（不可变对象可安全传递给 async hook）
- 参考 Claude Code query.ts 的 state 模式（`query-loop.ts:17-23` 注释声明）

---

### §3.6 退出原因 / 转换原因

**hermes** —— 隐式在 `run_conversation()` 返回字符串或 break 条件:

```python
while api_call_count < self.max_iterations and self.iteration_budget.remaining > 0:
    if self._interrupt_requested: break
    # ...
    if not assistant_message.tool_calls:
        break
    # ...
return {"final_response": ..., "messages": ...}
```

退出原因隐式可识别（检查 break 位置），但无**枚举类型**。

**EvoClaw** （`packages/core/src/agent/kernel/types.ts:424-448`）:

```typescript
export type ExitReason =
  | 'completed'                 // 模型完成
  | 'max_turns'                  // 达 maxTurns
  | 'max_tokens_exhausted'       // max_output_tokens 恢复次数用尽
  | 'abort'                      // 外部中止
  | 'stop_hook_prevented'        // Stop Hook 阻止
  | 'token_budget_exhausted'     // Token 预算耗尽
  | 'error';                     // 异常抛出

export type TransitionReason =
  | 'tool_use'
  | 'overflow_retry'
  | 'model_fallback'
  | 'stop_hook_blocking'
  | 'max_tokens_recovery'
  | 'token_budget_continue';
```

**判定 🟢 反超**：EvoClaw 枚举化的 `ExitReason` + `TransitionReason`:
- 编译期保证所有退出路径都映射到枚举
- 可观测性强（event 流中可直接携带 reason 值）
- 方便 UI 展示"为什么停了"（而非 hermes 需要推断）

---

### §3.7 执行环境抽象

**hermes** （`.research/04-core-abstractions.md §2.5` + `tools/environments/base.py:114-568`）:

```python
class BaseEnvironment(ABC):
    # 字段
    cwd: str
    timeout: int
    env: dict
    _session_id: str
    _snapshot_ready: bool
    _stdin_mode: str  # "pipe" | "heredoc" | "payload"

    # 抽象
    @abstractmethod
    def _run_bash(self, cmd, login, timeout, stdin) -> ProcessHandle: ...
    @abstractmethod
    def cleanup(self) -> None: ...

    # 具体
    def init_session(self): ...  # 一次性 snapshot
    def execute(self, command, cwd="", **kw) -> dict: ...  # 10 步统一流程
```

9 后端子类继承（LocalEnvironment / DockerEnvironment / SSHEnvironment / ModalEnvironment / ManagedModalEnvironment / DaytonaEnvironment / SingularityEnvironment）。

**EvoClaw** —— **无对应类型**（见 03 章 §3.6）:

- 无 `BaseEnvironment` / `SandboxEnvironment` 等基类
- `builtin-tools.ts` 中 bash 工具直接 `execSync` / `spawn`
- CLAUDE.md 声称 Docker 3 模式但代码未实现

**判定 🔴**：核心缺失。详见 `11-environments-spawn-gap.md`（Wave 2 W2-2）。

---

### §3.8 进程句柄 Protocol

**hermes** （`.research/04-core-abstractions.md §2.6` + `tools/environments/base.py`）:

```python
class ProcessHandle(Protocol):
    def poll(self) -> Optional[int]: ...
    def kill(self) -> None: ...
    def wait(self, timeout: float) -> int: ...
    stdout: Optional[IO]
    returncode: Optional[int]
```

**用途**：所有 `_run_bash()` 实现返回符合此 Protocol 的对象（可能是 `subprocess.Popen` 或 `_ThreadedProcessHandle`）。

**EvoClaw** —— 无对应 Protocol。进程操作通过 Node.js `child_process.spawn()` 返回 `ChildProcess` 对象，**类型直接依赖 `@types/node`**，没有抽象层。

**判定 🔴**：EvoClaw 缺 Protocol 层意味着未来接入多后端（Docker 沙箱等）时需要补充。详见 `11-environments-spawn-gap.md`。

---

### §3.9 Session 存储

**hermes** （`.research/04-core-abstractions.md §2.7` + `hermes_state.py:115`）:

```python
class SessionDB:
    db_path: Path
    _conn: sqlite3.Connection
    def create_session(...): ...
    def append_message(...): ...
    def get_messages(session_id) -> list: ...
    def search_messages(query) -> list: ...
    def update_token_counts(...): ...
```

**集中式** —— SQLite 连接 + 所有会话相关操作在一个类上。

**EvoClaw** —— **分布式**:

```typescript
// infrastructure/db/sqlite-store.ts
class SqliteStore { /* 通用 SQLite 封装 */ }

// infrastructure/db/vector-store.ts
class VectorStore { /* sqlite-vec 向量索引 */ }

// memory/memory-store.ts
class MemoryStore { /* 记忆表的 CRUD */ }

// memory/memory-feedback-store.ts
class MemoryFeedbackStore { /* 记忆反馈 */ }

// conversation-logger.ts
// conversation_log 表操作
```

- **职责细分**：每个存储类专注一个领域（通用 SQL / 向量 / 记忆 / 反馈 / 对话日志）
- **同一 SQLite 实例**（better-sqlite3 连接共享）

**判定 🟡**：两种组织各有优劣：
- hermes 集中 `SessionDB` —— 单一入口，搜索更方便
- EvoClaw 分布 —— 职责清晰，易于单元测试

EvoClaw 的分布式设计与**记忆系统的复杂度**（9 类别 + L0/L1/L2 + 知识图谱）相匹配。详见 `14-state-sessions-gap.md` 和 `15-memory-providers-gap.md`。

---

### §3.10 上下文压缩类

**hermes** （`.research/04-core-abstractions.md §2.8` + `agent/context_compressor.py:53-755`）:

```python
class ContextCompressor:
    model: str
    threshold_percent: float = 0.8
    protect_first_n: int
    protect_last_n: int
    context_length: int

    def should_compress(self, tokens) -> bool: ...
    def compress(self, messages, tokens) -> list: ...
```

**class + method 风格**：`AIAgent` 构造 ContextCompressor 实例并调用其方法。

**EvoClaw** （`packages/core/src/agent/kernel/context-compactor.ts:1-1021`）:

**模块函数风格 + 可变折叠状态**:

```typescript
// 导出函数（不是 class）
export async function maybeCompress(messages, config): Promise<boolean> { ... }
export async function maybeCompressPhased(messages, config, state: CollapseState): Promise<CollapseState> { ... }
export function contextCollapseDrain(messages): KernelMessage[] | null { ... }
export function truncateHeadForPTLRetry(messages): KernelMessage[] | null { ... }
export function createCollapseState(): CollapseState { ... }

// 状态枚举（不是 class 字段）
export type CollapsePhase = 'normal' | 'warning' | 'proactive_snip' | 'autocompact' | 'emergency' | 'exhausted';
```

**判定 🟡**：**风格不同但功能对等**：
- hermes class —— OO 风格，配置挂在实例上
- EvoClaw 模块函数 + 显式 state 参数 —— FP 风格，无隐藏状态

EvoClaw 的**三层压缩**（Snip/Microcompact/Autocompact）+ **6 阶段折叠**远超 hermes 单层 threshold+ratio 的能力（见 [`05-agent-loop-gap.md §3.8`](./05-agent-loop-gap.md)），只是类组织风格不同。

---

### §3.11 Memory 抽象

**hermes** （`.research/04-core-abstractions.md §2.9` + `agent/memory_provider.py:42-231`）:

```python
class MemoryProvider(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    def is_available(self) -> bool: ...

    @abstractmethod
    def initialize(self, session_id: str) -> None: ...

    def on_turn_start(self, messages, system_prompt, ...) -> Optional[str]: ...
    def on_session_end(self, session_id, messages) -> None: ...
    def on_pre_compress(self, messages) -> str: ...
```

**8 个外部 provider** 实现此接口（honcho / mem0 / hindsight / supermemory / byterover / openviking / holographic / retaindb），每个是 `agent/memory_provider.py` 的子目录插件。

**EvoClaw** —— **单一整合实现**:

```typescript
// memory/memory-store.ts
class MemoryStore { /* CRUD on memory_units 表 */ }

// memory/hybrid-searcher.ts
class HybridSearcher { /* FTS5 + 向量 + 知识图谱混合检索 */ }

// memory/memory-extractor.ts
// memory/query-analyzer.ts
// memory/conversation-logger.ts
```

- **无 `MemoryProvider` 抽象类**
- 所有记忆操作都依赖内部的 `MemoryStore` + `HybridSearcher`
- 无法切换 provider（hermes 可以 `pip install hermes-agent[honcho]` 切到 Honcho）

**判定 🔴**：EvoClaw 缺 Memory Provider 抽象。**但这是设计选择**：EvoClaw 的 L0/L1/L2 三层记忆 + 9 类别 + 知识图谱 + 热度衰减是**一体化设计**，切换外部 provider 会丢失这些能力。hermes 的可插拔是**为了多样性**，EvoClaw 的整合是**为了深度**。

详见 `15-memory-providers-gap.md`（Wave 2 W2-3）。

---

### §3.12 Credential 池

**hermes** （`.research/04-core-abstractions.md §2.10` + `agent/credential_pool.py:86-886`）:

```python
class CredentialPool:
    provider: str
    _entries: List[PooledCredential]

    def select(self) -> Optional[PooledCredential]: ...
    def mark_exhausted_and_rotate(self, id, status) -> Optional[PooledCredential]: ...
    def acquire_lease(self, id) -> Optional[str]: ...
    def release_lease(self, id): ...
```

**EvoClaw** —— **无对应**。

**判定 🔴**：完全缺失，详见 [`05-agent-loop-gap.md §3.7`](./05-agent-loop-gap.md)。

---

### §3.13 Stream 事件类型

**hermes** —— 用 **callbacks 集合** 做事件流:

- `stream_delta_callback` / `reasoning_callback` / `tool_gen_callback` / `thinking_callback` / `step_callback`
- 每个 callback 接收 **string 或 dict**，无共用事件联合类型
- 类型检查依赖文档 + 调用现场

**EvoClaw** （`packages/core/src/agent/kernel/types.ts:331-348`）:

```typescript
export type StreamEvent =
  | { type: 'text_delta'; delta: string; timestamp: number }
  | { type: 'thinking_delta'; delta: string; timestamp: number }
  | { type: 'thinking_signature'; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use_start'; id: string; name: string; timestamp: number }
  | { type: 'tool_use_delta'; id: string; partialJson: string; timestamp: number }
  | { type: 'tool_use_stop'; id: string; timestamp: number }
  | { type: 'message_stop'; stopReason: string }
  | { type: 'usage'; input: number; output: number; cache?: ... }
  | { type: 'tombstone'; timestamp: number }
  // ... 20+ 变体
  ;
```

**判定 🟢 反超**：**代数联合类型（discriminated union）** 是 TypeScript 的核心优势:
- 编译期保证 exhaustive 处理（switch 漏分支会 type error）
- 每个变体有精确的 payload 类型
- 调用方代码自动获得 IntelliSense

---

### §3.14 Prompt Block 类型

**hermes** —— system prompt 是 **plain str**，cache_control 逻辑在 `prompt_caching.py` 内部动态判断后拼入 messages 数组。

**EvoClaw** （`packages/core/src/agent/kernel/types.ts:381-392`）:

```typescript
export type CacheScope = 'global' | 'org';

export interface SystemPromptBlock {
  text: string;
  cacheControl?: { type: 'ephemeral'; scope?: CacheScope } | null;
}
```

**用途**：`config.systemPrompt` 可以是 `string | readonly SystemPromptBlock[]`（`StreamConfig` L400+），数组形式每块可独立设置 cache_control 和 scope（`global` 1P 跨用户 vs `org` 组织级）。

**判定 🟢 反超**：EvoClaw 把 cache 配置**上升到类型层**，而不是隐藏在 prompt_caching.py 的 if/else 中。类型安全地支持 Anthropic 的 `scope: 'global'`（命中费用 1/10，1P 专属）。

---

### §3.15 Context 插件接口

**hermes** —— 无对应（见 [`03-architecture-gap.md §3.13`](./03-architecture-gap.md)）。

**EvoClaw** （`packages/core/src/context/plugin.interface.ts:63`）:

```typescript
export interface ContextPlugin {
  name: string;
  bootstrap?(ctx: BootstrapContext): Promise<void>;
  beforeTurn?(ctx: TurnContext): Promise<void>;
  compact?(ctx: CompactContext): Promise<void>;
  afterTurn?(ctx: TurnContext): Promise<void>;
  shutdown?(ctx: ShutdownContext): Promise<void>;
}

export interface TurnContext {
  sessionKey: string;
  agentId: string;
  messages: KernelMessage[];
  recallMeta?: { memoryIds; scores; l0Indexes; categories };
  // ... 更多上下文字段
}
```

**判定 🟢 反超独有**：5-hook 生命周期 + 10 个实现插件（见 `03-architecture-gap.md §3.13`）。

---

### §3.16 Thinking block 表达

**hermes** —— 通过 dict 字段表达：
```python
assistant_msg = {
    "role": "assistant",
    "content": ...,
    "reasoning": str,               # hermes 内部
    "reasoning_content": str,       # Moonshot/Novita/OpenRouter API 字段
    "reasoning_details": dict,      # 结构化（SessionDB 存）
    "codex_reasoning_items": list,  # Codex 格式
}
```

signature 管理在 `agent/anthropic_adapter.py`（PR #6112 引入）。

**EvoClaw** （`packages/core/src/agent/kernel/types.ts:40-58`）:

```typescript
export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;           // Anthropic 跨轮保持
}

export interface RedactedThinkingBlock {
  type: 'redacted_thinking';
  data: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock | RedactedThinkingBlock | ImageBlock;
```

**判定 🟢 反超**：
- ThinkingBlock 作为 ContentBlock 联合的一员，**signature 是 block 的属性**而非 side-channel 字段
- 无需 4 套字段分流（reasoning / reasoning_content / reasoning_details / codex_reasoning_items）
- `redacted_thinking` 原样透传（`query-loop.ts:244-247`）

---

## 4. 改造蓝图（不承诺实施）

### P0 / P1 / P2 见各子系统 gap 文档

本章类型字典层的核心缺失已归到其他 gap:

| 差距 | 对应 gap 文档 | 优先级 |
|---|---|---|
| BaseEnvironment + 9 后端类型 | `11-environments-spawn-gap.md` | P1 |
| ProcessHandle Protocol | `11-environments-spawn-gap.md` | P1 |
| MemoryProvider ABC | `15-memory-providers-gap.md`（不建议做，EvoClaw 单一强实现更优）| — |
| CredentialPool class | `06-llm-providers-gap.md` | P0 |
| IterationBudget 跨 session | `05-agent-loop-gap.md §3.2` | P1 |

### 本章独有建议（类型层清理）

| # | 项目 | 对应差距 | 工作量 |
|---|---|---|---|
| 1 | 把 `context-compactor.ts` 的模块函数包装成 `ContextCompactor` class（提供 config/state 单例 + DI 友好） | §3.10 | 1d 重构（P2） |
| 2 | `tool-catalog.ts` 与 `kernel/types.ts:KernelTool` 整合为单一 ToolRegistry 模块（类似 hermes singleton 但保留静态清单） | §3.4 | 2d |

### 不建议做

| # | 项目 | 理由 |
|---|---|---|
| — | 引入 `MemoryProvider` ABC 模仿 hermes 8-provider 模式 | EvoClaw 整合式设计是优势（L0/L1/L2 + 知识图谱深度远超拼凑式） |
| — | 把 `LoopState` 改回可变风格 | Immutable state + transition 标记是 EvoClaw 反超优势 |
| — | 把 `StreamEvent` 改回 callbacks | Discriminated union 是 TS 原生优势 |

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应 |
|---|---|---|---|
| 1 | 不可变 LoopState + transition 枚举追踪 | `kernel/types.ts:449-458` + `query-loop.ts:508` | `AIAgent` 实例 150+ 可变字段 |
| 2 | ExitReason / TransitionReason 枚举 | `kernel/types.ts:424-448` | 隐式 break 条件，无枚举 |
| 3 | KernelTool interface（含 concurrencySafe/shouldDefer/searchHint） | `kernel/types.ts:235+` | `ToolEntry __slots__` 9 字段 |
| 4 | StreamEvent discriminated union（20+ 变体） | `kernel/types.ts:331-348` | callbacks 集合，无类型联合 |
| 5 | SystemPromptBlock + CacheScope（'global' / 'org'） | `kernel/types.ts:381-392` | 字符串 + prompt_caching.py 内部判断 |
| 6 | ContextPlugin 5-hook 生命周期 | `context/plugin.interface.ts:63` | 无对应 |
| 7 | ThinkingBlock / RedactedThinkingBlock 作为 ContentBlock 一等公民 | `kernel/types.ts:40-58` | 4 套 side-channel 字段分流 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（经 Grep / Read 验证 2026-04-16）

- `packages/core/src/agent/kernel/types.ts:21-67` ✅ ContentBlock 联合（TextBlock/ToolUseBlock/ToolResultBlock/ThinkingBlock/RedactedThinkingBlock/ImageBlock）
- `packages/core/src/agent/kernel/types.ts:94-118` ✅ KernelMessage 结构
- `packages/core/src/agent/kernel/types.ts:235+` ✅ KernelTool interface
- `packages/core/src/agent/kernel/types.ts:331-348` ✅ StreamEvent discriminated union
- `packages/core/src/agent/kernel/types.ts:360` ✅ ApiProtocol ('anthropic-messages' | 'openai-completions')
- `packages/core/src/agent/kernel/types.ts:378-392` ✅ CacheScope + SystemPromptBlock
- `packages/core/src/agent/kernel/types.ts:424-448` ✅ ExitReason + TransitionReason
- `packages/core/src/agent/kernel/types.ts:449-474` ✅ LoopState + QueryLoopResult
- `packages/core/src/agent/types.ts:22-110` ✅ AgentRunConfig / MessageSnapshot / ToolCallRecord / AttemptResult / EmbeddedAgentResult / RuntimeEvent
- `packages/core/src/context/plugin.interface.ts:4-76` ✅ ContextPlugin 5-hook + BootstrapContext/TurnContext/CompactContext/ShutdownContext
- `packages/core/src/agent/tool-catalog.ts:10-15` ✅ CoreToolMeta

### 6.2 hermes 研究引用

- `.research/04-core-abstractions.md §1` — 10 类型 class 图
- `.research/04-core-abstractions.md §2.1` — AIAgent 构造参数与 150+ 私有方法索引
- `.research/04-core-abstractions.md §2.2` — IterationBudget 线程安全实现
- `.research/04-core-abstractions.md §2.3` — ToolEntry `__slots__` 10 字段
- `.research/04-core-abstractions.md §2.4` — ToolRegistry 单例与公开方法
- `.research/04-core-abstractions.md §2.5` — BaseEnvironment ABC
- `.research/04-core-abstractions.md §2.6` — ProcessHandle Protocol
- `.research/04-core-abstractions.md §2.7` — SessionDB
- `.research/04-core-abstractions.md §2.8` — ContextCompressor
- `.research/04-core-abstractions.md §2.9` — MemoryProvider ABC
- `.research/04-core-abstractions.md §2.10` — CredentialPool

### 6.3 关联 gap 章节（crosslink）

- [`03-architecture-gap.md`](./03-architecture-gap.md) §3.3, §3.5 — Agent 中心类分层 / 工具注册机制
- [`05-agent-loop-gap.md`](./05-agent-loop-gap.md) §3.2, §3.7 — IterationBudget / CredentialPool 细节
- `06-llm-providers-gap.md` (Wave 1 #5) — CredentialPool 改造蓝图
- `08-context-compression-gap.md` (Wave 1 #6) — ContextCompressor 内部机制
- `09-tools-system-gap.md` (Wave 2 W2-1) — KernelTool 字段与 dispatch
- `11-environments-spawn-gap.md` (Wave 2 W2-2) — BaseEnvironment / ProcessHandle
- `14-state-sessions-gap.md` (Wave 2 W2-3) — SessionDB vs SqliteStore
- `15-memory-providers-gap.md` (Wave 2 W2-3) — MemoryProvider ABC vs MemoryStore

---

**本章完成**。核心类型字典盘点：EvoClaw 在 **类型系统表达力** 上反超（LoopState / ExitReason / StreamEvent / SystemPromptBlock / ThinkingBlock / ContextPlugin / KernelTool），在**执行环境抽象（BaseEnvironment + ProcessHandle）/ Credential 池 / 跨 session 预算**三项缺失。**MemoryProvider 可插拔抽象**是设计取舍而非 bug。
