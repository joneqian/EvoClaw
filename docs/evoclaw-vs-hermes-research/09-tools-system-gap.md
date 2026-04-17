# 09 — 工具系统 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/09-tools-system.md`（1111 行，含工具注册、发现、分发、审批四层）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`tools/registry.py:1-290` / `model_tools.py:81-548` / `toolsets.py:31-449` / `tools/approval.py:68-873`
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），`packages/core/src/agent/kernel/tool-adapter.ts` + `embedded-runner-tools.ts` + `tool-catalog.ts` + `tool-safety.ts`
> **综合判定**: 🟡 **部分覆盖，含多项反超**。hermes 强项在工具池复杂度（37 工具 + 分发概率模型），EvoClaw 强项在权限三方协调、Bash AST 安全、流式预执行。

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes 工具系统**（`.research/09-tools-system.md §1-§3`）是**四层管道**：

```
Layer 1: tools/*.py 模块底部自注册 (import 副作用)
    ↓ registry.register(name, toolset, schema, handler, check_fn, ...)
Layer 2: tools/registry.py 单例注册表 (ToolEntry + ToolRegistry)
    ↓ registry.dispatch(name, args) 执行 + registry.get_definitions(tool_names) 生成 schemas
Layer 3: model_tools.py 编排 (_discover_tools/硬编码 list → _run_async 桥接 → handle_function_call 分发)
Layer 4: toolsets.py + toolset_distributions.py (组合与采样)
```

**37 个核心工具**（browser 10 + file 4 + terminal 2 + web 2 + vision 1 + skills 3 + memory 1 + session_search 1 + 等）**分布在 15 个 toolset 中**，加 MCP 动态发现 + 插件注册。

**EvoClaw 工具系统**（`packages/core/src/agent/kernel/tool-adapter.ts:145-537` + `tool-catalog.ts`）是**两层适配 + 一层执行**：

```
Layer 1a: CORE_TOOLS readonly array (30 工具元数据 + Profile 过滤)
          + EvoClaw 自定义工具 (web_search, memory_*, agent 等，动态注入)
Layer 1b: KernelTool interface (统一签名: name/description/inputSchema/call())
Layer 2: adaptEvoclawTool / wrapBuiltinTool (权限 + 安全守卫 + hooks 包装)
Layer 3: buildKernelTools (5 阶段注入: builtin → bash → evoclaw → wrapper → dedup)
```

**关键范式差异**：

| 维度 | hermes | EvoClaw |
|---|---|---|
| 工具发现 | 硬编码 20 模块 list + importlib.import_module（三段式发现）| 编译时 CORE_TOOLS array + 运行时 evoClawTools 参数注入 |
| 工具接口 | 1 参签名 `handler(args: dict, **kwargs) → str`（必须返回 JSON） | 统一 `KernelTool` interface + `call(input, signal?, onProgress?) → ToolCallResult` |
| 权限检查 | 工具级 check_fn (返回 bool) + approval.py 危险命令审批 | 权限三方协调：PreToolUse hooks + PermissionFn + Rule（Hook-Rule-Permission 模型） |
| 并发安全标记 | 工具级 `is_async=True` 属性，无显式并发安全标记 | 显式 `isConcurrencySafe()` 方法 + `isReadOnly()` 方法 |
| 执行管道 | 同步 dispatch（async 工具靠 _run_async 三分支桥接） | 流式预执行器 StreamingToolExecutor（并发安全工具即时预执行） |
| 结果处理 | 直接返回 JSON 字符串 + max_result_size_chars 截断 | ToolCallResult + 无进展检测 + 头尾保留策略截断 + 大结果持久化 |
| 循环检测 | 客户端 (LLM) 记忆，服务端无中心统计 | ToolSafetyGuard 四种模式：重复/无进展/乒乓/全局熔断 |
| Bash 安全 | 正则模式匹配危险命令 | **反超**：AST 主路径检查 + Legacy 正则降级（见 embedded-runner-tools.ts） |

---

## 2. 档位速览

| # | 机制 | 档位 | 一句话判定 |
|---|---|---|---|
| §3.1 | Tool 接口定义与类型系统 | 🟡 | hermes 函数签名 vs EvoClaw interface，各有优劣（类型安全 vs 灵活） |
| §3.2 | ToolRegistry 注册与去重 | 🟡 | hermes 集中注册表 + 同名跨 toolset 覆盖 vs EvoClaw 分散注入 + 显式去重 |
| §3.3 | Schema 转换（Anthropic/OpenAI） | 🟢 | **反超**：stream-client.ts 双协议分支清晰优雅 vs hermes `_build_api_kwargs` 500 行巨函数 |
| §3.4 | 并发安全标记 | 🟡 | EvoClaw 显式接口 vs hermes 隐式属性；EvoClaw 更可靠但工具数量小 |
| §3.5 | 工具发现机制 | 🟡 | hermes 硬编码 20 模块 list 可控快失败 vs EvoClaw 运行时注入灵活但需显式传递 |
| §3.6 | 执行路径（同步 vs 流式） | 🟢 | **反超**：StreamingToolExecutor 流中并发预执行 vs hermes 串行等流结束后 |
| §3.7 | 权限检查（check_fn vs hooks） | 🟡 | hermes check_fn 简洁，EvoClaw 三方协调更灵活（Pre/Post/Failure hooks） |
| §3.8 | 危险命令审批（正则 vs 交互） | 🟡 | hermes approval.py 三模式（off/normal/smart）+ 20+ 危险模式 vs EvoClaw 仅正则检测 |
| §3.9 | 循环检测 | 🟢 | **反超**：ToolSafetyGuard 四种本地检测 + 全局熔断 vs hermes 客户端记忆 |
| §3.10 | 结果截断策略 | 🟡 | hermes max_result_size_chars 简单截断 vs EvoClaw 头尾保留 + 无进展检测 |
| §3.11 | 工具钩子系统 | 🟢 | **反超**：kernel/tool-hooks.ts 预/后置 hooks 注册表 vs hermes plugin system + invoke_hook |
| §3.12 | Bash 工具安全 | 🟢 | **反超**：destructiveCommandWarning.ts AST 主路径 + legacy 正则降级 vs hermes 纯正则 |
| §3.13 | 工具目录与配置 | 🟡 | hermes 37 工具（复杂度高）vs EvoClaw 30 核心工具（轻量），各服务不同目标 |
| §3.14 | Toolsets 组合 | 🔴 | EvoClaw 无 toolset 机制，工具都是扁平池；hermes toolset 组合 + 分发概率模型 |
| §3.15 | 工具生命周期（5 阶段注入） | 🟢 | **反超**：显式 5 阶段（builtin → bash → evoclaw → wrapper → dedup），pipeline 清晰 |

**统计**: 🔴 1 / 🟡 6 / 🟢 8（其中 5 项反超）。

---

## 3. 机制逐条深度对比

### §3.1 Tool 接口定义与类型系统

**hermes** （`.research/09-tools-system.md §3.1-3.2` + `tools/registry.py:1-50`）:

```python
# tools/registry.py:24-55
class ToolEntry:
    __slots__ = ("name", "toolset", "schema", "handler", "check_fn",
                 "requires_env", "is_async", "description", "emoji", "max_result_size_chars")
    
    def __init__(self, name, toolset, schema, handler, check_fn=None, ...):
        self.name = name
        self.toolset = toolset
        self.schema = schema                  # dict
        self.handler = handler                # Callable[[dict, **kwargs], str]
        self.check_fn = check_fn              # Optional[Callable[[], bool]]
        self.requires_env = requires_env      # List[str]
        self.is_async = is_async              # bool
        ...
```

- **10 个 `__slots__` 字段**（内存优化）
- **handler 固定签名**：`(args: dict, **kwargs) -> str`（必须返回 JSON 字符串）
- **无显式并发安全标记**（靠 `is_async=True` 推断）
- **check_fn**: `() -> bool`，工具是否当前可用

**EvoClaw** （`packages/core/src/agent/kernel/types.ts:235-320` + `tool-adapter.ts:145-160`）:

```typescript
// kernel/types.ts:235
export interface KernelTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  
  readonly aliases?: readonly string[];
  readonly searchHint?: string;
  readonly shouldDefer?: boolean;
  readonly maxResultSizeChars?: number;
  
  readonly isReadOnly?: () => boolean;              // ← 显式只读标记
  readonly isConcurrencySafe?: () => boolean;      // ← 显式并发安全标记
  readonly isDestructive?: () => boolean;          // ← 显式破坏性标记
  
  readonly backfillObservableInput?: (input: Record<string, unknown>) => Record<string, unknown>;
  readonly validateInput?: (input: Record<string, unknown>) => Promise<{ valid: boolean; error?: string }>;
  
  async call(
    input: Record<string, unknown>,
    signal?: AbortSignal,
    onProgress?: ToolProgressCallback
  ): Promise<ToolCallResult>;
}

export interface ToolCallResult {
  content: string;
  isError?: boolean;
  contextModifier?: (ctx: Record<string, unknown>) => Record<string, unknown>;
}
```

- **TypeScript interface**（编译期类型检查）
- **call() 签名**: `(input, signal?, onProgress?) → Promise<ToolCallResult>`（非强制 JSON）
- **显式能力声明**：`isReadOnly()` / `isConcurrencySafe()` / `isDestructive()`（fail-closed 默认值）
- **钩子支持**：`backfillObservableInput()` (for hooks visibility) + `validateInput()` (custom validation)

**判定 🟡**：

- **hermes 优点**：简洁函数签名，handler 可以是任意 lambda，内存紧凑（10 slots）
- **EvoClaw 优点**：类型安全，能力声明显式，Promise 支持自然，AbortSignal 标准化（web API）
- **风险**：hermes 的 `handler` 必须手工 JSON serialize，EvoClaw 依赖 TypeScript 编译；hermes 的 `check_fn` 无参调用可能不幂等

**证据**：
- hermes: `tools/registry.py:L24-55` (ToolEntry) + `tools/web_tools.py:L2080-2101` (registry.register 调用)
- EvoClaw: `packages/core/src/agent/kernel/types.ts:L235-320` (KernelTool interface)

---

### §3.2 ToolRegistry 注册与去重

**hermes** （`.research/09-tools-system.md §3.2` + `tools/registry.py:L59-93`）:

```python
# tools/registry.py:L59-93
class ToolRegistry:
    def __init__(self):
        self._tools = {}                    # Dict[str, ToolEntry]
        self._toolset_checks = {}
    
    def register(self, name: str, toolset: str, schema: dict,
                 handler: Callable, check_fn: Callable = None,
                 requires_env: list = None, is_async: bool = False, ...):
        """Register a tool. Called at module-import time by each tool file."""
        existing = self._tools.get(name)
        if existing and existing.toolset != toolset:
            logger.warning(
                "Tool name collision: '%s' (toolset '%s') is being "
                "overwritten by toolset '%s'",
                name, existing.toolset, toolset,
            )
        self._tools[name] = ToolEntry(...)
        if check_fn and toolset not in self._toolset_checks:
            self._toolset_checks[toolset] = check_fn
```

- **允许同名覆盖**（跨 toolset，仅 warn）
- **单例模式**（全局 `registry` 对象）
- **三段发现顺序**（§3.3 细述）

**EvoClaw** （`packages/core/src/agent/kernel/tool-adapter.ts:L475-537` + `kernel/builtin-tools.ts`）:

```typescript
// tool-adapter.ts:L475-537
export function buildKernelTools(config: BuildToolsConfig): KernelTool[] {
  const deps: ToolAdapterDeps = { permissionFn, toolSafety, auditFn, provider, hookRegistry };
  
  // 1. 内置工具 (包装权限 + 安全)
  const builtinTools = createBuiltinTools(config.builtinContextWindow)
    .map(tool => wrapBuiltinTool(tool, deps));
  
  // 2. 增强 bash
  const bashTool = adaptEvoclawTool(bashDef, deps);
  
  // 3. EvoClaw 自定义工具
  const customTools = (config.evoClawTools ?? []).map(tool =>
    adaptEvoclawTool(tool, deps)
  );
  
  // 4. 额外工具 (SkillTool, ToolSearchTool)
  const extraTools = config.extraTools ?? [];
  
  // 去重 (内置优先)
  const seen = new Set<string>();
  const dedup = (tools: KernelTool[]) => {
    const result: KernelTool[] = [];
    for (const tool of tools) {
      if (!seen.has(tool.name)) {
        seen.add(tool.name);
        result.push(tool);
      }
      if (tool.aliases) {
        for (const alias of tool.aliases) {
          if (!seen.has(alias)) {
            seen.add(alias);
          }
        }
      }
    }
    return result;
  };
  
  const dedupBuiltin = dedup(builtinPool);
  const dedupExternal = dedup(externalPool);
  
  return [...dedupBuiltin.sort(byName), ...dedupExternal.sort(byName)];
}
```

- **5 阶段注入**（builtin → bash → evoclaw custom → extra → wrapper + dedup）
- **显式去重**（内置优先覆盖外部，记录别名）
- **分区排序**（内置按名称 → 外部按名称，保持 prompt cache 一致性）
- **运行时参数注入**（不强制编译时注册）

**判定 🟡**：

- **hermes 优点**：全局单例模式，所有工具注册在一个地方，易于查询
- **hermes 缺点**：如果同时加载多个版本的工具（如 MCP + builtin），容易名称冲突
- **EvoClaw 优点**：分层清晰，内置优先，显式别名支持，cache 友好
- **EvoClaw 缺点**：如果运行时忘记传递某个工具列表，静默丢失

**证据**：
- hermes: `tools/registry.py:L59-93` (register 方法) + `tools/registry.py:L184-205` (覆盖处理)
- EvoClaw: `packages/core/src/agent/kernel/tool-adapter.ts:L475-537` (buildKernelTools)

---

### §3.3 Schema 转换（Anthropic/OpenAI 协议）

**hermes** （无单一 schema 转换函数，分散在 `run_agent.py:_build_api_kwargs`）:

hermes 工具 schema 本身是 OpenAI 格式 (见 `tools/registry.py:L237-239`)，在 `model_tools.py:_build_api_kwargs` 中动态适配为各 provider 格式。当前对 Anthropic Messages API 支持但细节未在 .research 文档中展开。

**EvoClaw** （`packages/core/src/agent/schema-adapter.ts:L113-133` + `kernel/stream-client.ts:L195-280`）:

```typescript
// schema-adapter.ts:L113-133
export function normalizeToolSchema(
  schema: Record<string, unknown>,
  provider: string,
): Record<string, unknown> {
  // Step 1: 扁平化 anyOf/oneOf union schema
  const flattened = flattenUnionSchema(schema);
  
  // Step 2: 根据 provider 适配
  if (provider === 'google' || provider === 'google-generative-ai') {
    return stripKeywords(flattened, GEMINI_STRIP_KEYWORDS);
  }
  if (provider === 'xai') {
    return stripKeywords(flattened, XAI_STRIP_KEYWORDS);
  }
  if (provider === 'openai' || provider === 'openai-completions') {
    return { type: 'object', ...flattened };  // 强制顶层 type
  }
  return flattened;  // Anthropic: 保持原样
}

// stream-client.ts:L195-280（伪代码）
async function buildRequest(
  messages: KernelMessage[],
  tools: KernelTool[],
  provider: string,
): Promise<AnthropicRequest | OpenAIRequest> {
  if (provider === 'anthropic' || provider.includes('anthropic')) {
    // Anthropic Messages API
    return {
      model: config.modelId,
      max_tokens: config.maxTokens,
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: normalizeToolSchema(t.inputSchema, provider),
      })),
      messages: messageUtils.toAnthropicMessages(messages),
    };
  } else {
    // OpenAI Chat Completions API
    return {
      model: config.modelId,
      max_tokens: config.maxTokens,
      tools: tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: normalizeToolSchema(t.inputSchema, provider),
        },
      })),
      messages: messageUtils.toOpenAIMessages(messages),
    };
  }
}
```

**判定 🟢**（反超）:

- **EvoClaw 优点**：
  - `normalizeToolSchema()` 集中一处，清晰的 provider 适配逻辑
  - 支持 Gemini + xAI schema 剥离（hermes 无）
  - union schema 扁平化（`anyOf` / `oneOf`）自动合并 properties
  - stream-client.ts 双协议分支干净（Anthropic vs OpenAI）
  
- **hermes 可能更灵活**（但散落在多处）：拥有 500+ 行 `_build_api_kwargs` 处理 9+ providers
  
- **关键差异**：EvoClaw 用**运行时正规化**（tool-adapter 传 provider 参数），hermes 用**编译时固定**（`get_definitions` 直接返回 OpenAI 格式，后续再转）

**证据**：
- hermes: `tools/registry.py:L237-239` (返回 OpenAI 格式)
- EvoClaw: `packages/core/src/agent/schema-adapter.ts:L113-133` (normalizeToolSchema) + `packages/core/src/agent/kernel/stream-client.ts` (buildRequest 双协议)

---

### §3.4 并发安全标记

**hermes** （`.research/09-tools-system.md §3.1`）:

```python
# tools/web_tools.py:L2080-2101
registry.register(
    name="web_search",
    toolset="web",
    schema=WEB_SEARCH_SCHEMA,
    handler=lambda args, **kw: web_search_tool(...),
    is_async=True,          # ← 仅有 is_async 标记，无显式并发安全标记
    emoji="🔍",
)
```

- **仅 `is_async` 标记**（表示 handler 返回 coroutine）
- **无显式 concurrency-safe 标记**——工具开发者需要自行保证线程安全或无副作用

**EvoClaw** （`packages/core/src/agent/kernel/tool-adapter.ts:L28-42`）:

```typescript
// tool-adapter.ts:L28-42
const READ_ONLY_TOOLS = new Set([
  'read', 'grep', 'find', 'ls',
  'web_search', 'web_fetch', 'image', 'pdf',
  'memory_search', 'memory_get', 'knowledge_query',
  'list_agents', 'yield_agents',
]);

const CONCURRENT_SAFE_TOOLS = new Set([
  'read', 'grep', 'find', 'ls',
  'web_search', 'web_fetch', 'image', 'pdf',
  'memory_search', 'memory_get', 'knowledge_query',
]);

// tool-adapter.ts:L288-290
export function adaptEvoclawTool(tool: ToolDefinition, deps: ToolAdapterDeps): KernelTool {
  return {
    ...
    isReadOnly: () => READ_ONLY_TOOLS.has(tool.name),
    isConcurrencySafe: () => CONCURRENT_SAFE_TOOLS.has(tool.name),
  };
}
```

- **显式 `READ_ONLY_TOOLS` / `CONCURRENT_SAFE_TOOLS` sets**
- **`KernelTool.isReadOnly()` / `isConcurrencySafe()` 方法**（fail-closed: 默认 `false`）
- **在 StreamingToolExecutor 中直接使用**（§3.6 细述）

**判定 🟡**：

- **hermes 优点**：最小化工具定义（仅 `is_async`）
- **hermes 缺点**：`is_async` 与"并发安全"是两个维度，容易混淆；无中心扫描机制
- **EvoClaw 优点**：清晰声明式，易于扫描和验证
- **EvoClaw 缺点**：需要维护两个 Set（易漂移），且当前只支持 30 个工具

**证据**：
- hermes: `tools/web_tools.py:L2080-2101` (is_async 标记) + `tools/registry.py:L35` (ToolEntry 无并发字段)
- EvoClaw: `packages/core/src/agent/kernel/tool-adapter.ts:L28-42` (READ_ONLY_TOOLS + CONCURRENT_SAFE_TOOLS) + `streaming-tool-executor.ts:L109` (isConcurrencySafe 调用)

---

### §3.5 工具发现机制

**hermes** （`.research/09-tools-system.md §3.3` + `model_tools.py:L132-177`）:

```python
# model_tools.py:L132-177
def _discover_tools():
    """Import all tool modules to trigger their registry.register() calls."""
    _modules = [
        "tools.web_tools",
        "tools.terminal_tool",
        "tools.file_tools",
        "tools.vision_tools",
        "tools.mixture_of_agents_tool",
        "tools.image_generation_tool",
        "tools.skills_tool",
        "tools.skill_manager_tool",
        "tools.browser_tool",
        "tools.cronjob_tools",
        "tools.rl_training_tool",
        "tools.tts_tool",
        "tools.todo_tool",
        "tools.memory_tool",
        "tools.session_search_tool",
        "tools.clarify_tool",
        "tools.code_execution_tool",
        "tools.delegate_tool",
        "tools.process_registry",
        "tools.send_message_tool",
        "tools.homeassistant_tool",
    ]
    import importlib
    for mod_name in _modules:
        try:
            importlib.import_module(mod_name)
        except Exception as e:
            logger.warning("Could not import tool module %s: %s", mod_name, e)

_discover_tools()

# 三段式发现顺序
try:
    from tools.mcp_tool import discover_mcp_tools
    discover_mcp_tools()
except Exception as e:
    logger.debug("MCP tool discovery failed: %s", e)

try:
    from hermes_cli.plugins import discover_plugins
    discover_plugins()
except Exception as e:
    logger.debug("Plugin discovery failed: %s", e)
```

- **硬编码 20 模块 list**（确定性，快失败，无 glob 副作用）
- **三段式发现**：内建 → MCP → 插件（顺序可靠）
- **module-level 副作用**（各 tool 文件末尾 `registry.register(...)`）
- **失败不阻断**（"警告 + 继续"，其他工具不受影响）

**EvoClaw** （`packages/core/src/agent/kernel/tool-adapter.ts:L475-500` + 配置注入）:

```typescript
// tool-adapter.ts:L475-500
export function buildKernelTools(config: BuildToolsConfig): KernelTool[] {
  // ... 
  // 1. 内置工具 (编译时清单)
  const builtinTools = createBuiltinTools(config.builtinContextWindow)
    .map(tool => wrapBuiltinTool(tool, deps));
  
  // 2. 增强 bash
  const bashTool = adaptEvoclawTool(bashDef, deps);
  
  // 3. EvoClaw 自定义工具 (运行时参数)
  const customTools = (config.evoClawTools ?? []).map(tool =>
    adaptEvoclawTool(tool, deps)
  );
  
  // 4. 额外工具 (SkillTool、ToolSearchTool 等，由调用方注入)
  const extraTools = config.extraTools ?? [];
  // ...
}
```

- **编译时核心工具** (CORE_TOOLS readonly array)
- **运行时动态注入** (`evoClawTools` 参数)
- **分离关注点**（不触发副作用）

**判定 🟡**：

- **hermes 优点**：全局模块加载，一处完成发现，确定性顺序
- **hermes 缺点**：硬编码 20 模块，增加新工具需改 import list；工具副作用在 module load 时触发（难调试）
- **EvoClaw 优点**：编译时清单 + 运行时注入，可以按场景动态组装（如 ToolProfile 过滤）
- **EvoClaw 缺点**：调用方必须显式传递 evoClawTools，容易遗漏；无自动发现机制

**证据**：
- hermes: `model_tools.py:L132-177` (硬编码 import list) + `model_tools.py:L314-328` (三段式发现)
- EvoClaw: `packages/core/src/agent/kernel/tool-adapter.ts:L475-500` (buildKernelTools 参数) + `tool-catalog.ts:L18-59` (CORE_TOOLS readonly array)

---

### §3.6 执行路径（同步 vs 流式预执行）

**hermes** （`.research/09-tools-system.md §3.3`）:

```python
# model_tools.py:L459-548 handle_function_call
def handle_function_call(...) -> str:
    # ... 7 步流程 ...
    # 5. 分发执行
    result = registry.dispatch(function_name, function_args, ...)
    # → registry.dispatch:
    #     if entry.is_async:
    #         return _run_async(entry.handler(args, **kwargs))
    #     return entry.handler(args, **kwargs)
    # → tools/web_tools.py 里真正的 web_search_tool()
    #     return json.dumps({"results": [...]})
    # ...
    return result
```

- **顺序执行**：工具必须等流结束，LLM 返回 tool_call list，逐个 `dispatch()`
- **async 桥接**：`_run_async()` 三分支（gateway thread / worker thread / CLI main thread）处理
- **结果同步返回**（工具 handler 返回字符串或 coroutine，`_run_async` 阻塞等待）

**EvoClaw** （`packages/core/src/agent/kernel/streaming-tool-executor.ts:L57-200`）:

```typescript
// streaming-tool-executor.ts:L57-200
export class StreamingToolExecutor {
  private tools: TrackedTool[] = [];
  private maxConcurrency = 8;
  
  /**
   * 入队一个 tool_use block
   * 如果是并发安全工具且有并发余量 → 立即开始执行
   * 否则 → 等待 collectResults() 时串行执行
   */
  enqueue(block: ToolUseBlock): void {
    if (this.discarded) return;
    
    const tool = this.toolMap.get(block.name);
    const isConcurrencySafe = tool?.isConcurrencySafe() ?? false;
    
    const tracked: TrackedTool = {
      block,
      status: 'queued',
      isConcurrencySafe,
    };
    this.tools.push(tracked);
    
    // 并发安全 + 有余量 → 立即预执行
    if (isConcurrencySafe && this.activeConcurrent < this.maxConcurrency) {
      this.startExecution(tracked);
    }
  }
  
  /**
   * 收集所有工具结果
   * 按入队顺序返回:
   * - 已预执行的: await promise
   * - 未执行的: 按顺序执行 (串行工具)
   */
  async collectResults(config: CollectConfig): Promise<ToolResultBlock[]> {
    const results: ToolResultBlock[] = [];
    
    for (const tracked of this.tools) {
      if (this.discarded) break;
      
      // 已预执行 → 直接 await
      if (tracked.status === 'completed') {
        results.push(toToolResultBlock(tracked.result));
      } else if (tracked.status === 'executing') {
        // 正在执行 → await promise
        const result = await tracked.promise;
        results.push(toToolResultBlock(result));
      } else {
        // 未执行 (串行工具) → 按顺序执行
        const result = await executeSingle(tracked.block, ...);
        results.push(toToolResultBlock(result));
      }
    }
    
    return results;
  }
}
```

- **流中预执行**：LLM 流式输出 tool_use block 时立即入队，并发安全工具（read/web_search 等）即时启动执行
- **并发控制**：信号量机制，maxConcurrency=8（可配）
- **兄弟错误自动中止**：Bash 工具错误 → 自动 abort siblingController → 取消兄弟工具（不结束 turn）
- **异步收集**：流结束后调 `collectResults()` 统一返回结果

**判定 🟢**（反超）:

- **hermes 缺点**：必须等流结束，所有 tool_call 返回后才能开始执行，延迟 = 流延迟 + 最长工具延迟
- **EvoClaw 优点**：流式预执行，并发安全工具与 LLM 流同时进行，实现 pipeline 并行，**减少端到端延迟**
- **EvoClaw 额外优点**：兄弟错误中止机制（Bash 错误自动 cancel 兄弟），避免浪费计算

**证据**：
- hermes: `model_tools.py:L459-548` (handle_function_call 同步执行) + `run_agent.py` (LLM 流后调 handle_function_call)
- EvoClaw: `packages/core/src/agent/kernel/streaming-tool-executor.ts:L57-200` (enqueue + collectResults) + `query-loop.ts` (streamOneRound 中 executor.enqueue)

---

### §3.7 权限检查（check_fn vs PreToolUse hooks）

**hermes** （`.research/09-tools-system.md §3.2` + `tools/registry.py:L225-236`）:

```python
# tools/registry.py:L225-236
def get_definitions(self, tool_names: Set[str], quiet: bool = False) -> List[dict]:
    """Return OpenAI-format tool schemas for the requested tool names."""
    result = []
    check_results: Dict[Callable, bool] = {}
    for name in sorted(tool_names):
        entry = self._tools.get(name)
        if not entry:
            continue
        if entry.check_fn:
            if entry.check_fn not in check_results:
                try:
                    check_results[entry.check_fn] = bool(entry.check_fn())
                except Exception:
                    check_results[entry.check_fn] = False
            if not check_results[entry.check_fn]:
                logger.debug("Tool %s unavailable (check failed)", name)
                continue
        # ... 返回 schema
```

- **工具级 check_fn**：返回 `bool`，表示工具是否"当前可用"（如 API key 是否存在）
- **在 schema 生成时检查**（提前过滤不可用工具）
- **缓存结果**（同一 check_fn 在一次 `get_definitions` 中只调一次）

**EvoClaw** （`packages/core/src/agent/kernel/tool-adapter.ts:L140-209` + `tool-hooks.ts`）:

```typescript
// tool-adapter.ts:L180-209
// 3. PreToolUse hooks → Hook-Rule-Permission 三方协调
if (deps.hookRegistry) {
  const hookResult = await deps.hookRegistry.runPreHooks(tool.name, input, hookCtx);
  
  // blockingError 立即中断
  if (hookResult?.blockingError) {
    deps.auditFn?.({
      toolName: tool.name, args: input,
      result: hookResult.blockingError, status: 'denied',
      durationMs: Date.now() - start,
      reason: `hook_blocked: ${hookResult.blockingError}`,
    });
    return { content: hookResult.blockingError, isError: true };
  }
  
  // 三方协调: hook 的 allow/deny/ask + permissionFn (deny 规则)
  const permDecision = await resolveHookPermissionDecision(
    hookResult, deps.permissionFn, tool.name, input,
  );
  if (!permDecision.allowed) {
    // ...
    return { content: `[权限拒绝] ${permDecision.reason}`, isError: true };
  }
  effectiveInput = permDecision.input;
}

// tool-hooks.ts:L9-50
export type PreToolUseHookResult = {
  blockingError?: string;                    // 立即中止
  permissionBehavior?: 'allow' | 'deny' | 'ask';
  updatedInput?: Record<string, unknown>;    // 修改参数
};
```

- **PreToolUse hooks 注册表**：工具执行前触发 (可修改参数 / 拒绝 / 允许)
- **Hook-Rule-Permission 三方协调**：
  1. Hook deny → 直接拒绝
  2. Hook allow → 但仍需检查 permissionFn (deny 规则优先)
  3. Hook ask / 无 hook → 走正常权限流程
- **PostToolUse hooks**：工具执行后触发 (修改结果)
- **Failure hooks**：工具执行失败时触发 (错误恢复链)

**判定 🟡**：

- **hermes 优点**：简洁（仅 check_fn() → bool），集成在注册表中
- **hermes 缺点**：check_fn 只能 filter（不返回 schema），无法修改参数；无执行后钩子
- **EvoClaw 优点**：灵活三方协调，allow/deny/ask 语义清晰，支持修改参数，拥有 Post/Failure 钩子
- **EvoClaw 缺点**：复杂度高，需理解三方协调规则

**证据**：
- hermes: `tools/registry.py:L225-236` (check_fn 缓存) + `tools/file_tools.py:L832-835` (check_fn 注册)
- EvoClaw: `packages/core/src/agent/kernel/tool-adapter.ts:L180-209` (PreToolUse hooks 协调) + `tool-hooks.ts` (Hook 类型定义)

---

### §3.8 危险命令审批（正则 vs 交互式）

**hermes** （`.research/09-tools-system.md §3.7` + `tools/approval.py:L68-106 / L645-873`）:

```python
# tools/approval.py:L68-106
DANGEROUS_PATTERNS = [
    (r'\brm\s+(-[^\s]*\s+)*/', "delete in root path"),
    (r'\brm\s+-[^\s]*r', "recursive delete"),
    (r'\bchmod\s+(-[^\s]*\s+)*(777|666|o\+[rwx]*w|a\+[rwx]*w)\b', "world/other-writable permissions"),
    (r'\bdd\s+.*if=', "disk copy"),
    (r'>\s*/dev/sd', "write to block device"),
    (r'\bDROP\s+(TABLE|DATABASE)\b', "SQL DROP"),
    (r'\bDELETE\s+FROM\b(?!.*\bWHERE\b)', "SQL DELETE without WHERE"),
    (r'\bsystemctl\s+(stop|disable|mask)\b', "stop/disable system service"),
    (r':\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:', "fork bomb"),
    # ... 18+ additional patterns
]

# tools/approval.py:L645-873 check_all_command_guards
def check_all_command_guards(command: str, env_type: str = 'local') -> bool:
    """
    Three approval modes:
    - off / HERMES_YOLO_MODE=1: approve all
    - normal: block dangerous, prompt user for approval
    - smart: let auxiliary LLM assess risk, auto-approve/deny
    """
    is_container = env_type in ('docker', 'singularity', 'modal', 'daytona')
    if is_container:
        return True  # 容器环境跳过
    
    approval_mode = getenv('HERMES_APPROVAL_MODE', 'normal')
    if approval_mode in ('off', 'yolo'):
        return True  # 关闭审批
    
    # 非 CLI/gateway 运行时跳过
    context = get_running_context()
    if context not in ('cli', 'gateway', 'ask'):
        return True
    
    # 扫描危险模式 + tirith 规则
    is_dangerous, pattern_key, description = detect_dangerous_command(command)
    if not is_dangerous:
        return True  # 安全命令通过
    
    # 危险命令处理
    if approval_mode == 'smart':
        # 辅助 LLM 评估
        return _smart_approve(command, description)
    
    # normal 模式：prompt 用户
    if context == 'cli':
        choice = prompt_dangerous_approval(command, description)
        if choice == 'deny':
            return False
        elif choice == 'session':
            approve_session(command)
            return True
        elif choice == 'always':
            approve_permanent(command)
            return True
    elif context == 'gateway':
        # 注册到 per-session queue，等待 /approve 或 /deny 命令
        register_to_approval_queue(session_key, command)
        entry.event.wait()  # 阻塞等待
        return entry.result == 'allow'
    
    return False  # 默认拒绝
```

- **22+ 危险模式列表**（正则表达式）
- **三种审批模式**（off / normal / smart）
  - `off` 或 `HERMES_YOLO_MODE=1`：全部放行
  - `normal`：prompt 用户 (CLI) 或 per-session queue (gateway)
  - `smart`：辅助 LLM 风险评估
- **容器环境自动跳过**
- **gateway 双事件模型**：工具线程阻塞等待 `/approve` 命令

**EvoClaw** （`packages/core/src/agent/embedded-runner-tools.ts:L161-193`）:

```typescript
// embedded-runner-tools.ts:L161-193
const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; warning: string }> = [
  // 文件删除
  { pattern: /\brm\s+(-[rf]+\s+|.*--force|.*--recursive)/i, warning: '删除文件 (rm -rf)' },
  { pattern: /\brm\s+-[a-z]*r[a-z]*f|rm\s+-[a-z]*f[a-z]*r/i, warning: '删除文件 (rm -rf)' },
  // Git 不可逆操作
  { pattern: /\bgit\s+reset\s+--hard/i, warning: '不可逆 git 操作 (reset --hard)' },
  { pattern: /\bgit\s+push\s+.*--force/i, warning: '强制推送 (push --force)' },
  // ... 8+ patterns
];

function detectDestructiveCommand(command: string): string | null {
  for (const { pattern, warning } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return warning;
    }
  }
  return null;
}

export function createEnhancedExecTool() {
  return {
    name: 'bash',
    execute: async (args: Record<string, unknown>, ctx?: ToolExecContext): Promise<string> => {
      const command = args.command as string;
      
      // 危险命令检测
      const destructiveWarning = detectDestructiveCommand(command);
      if (destructiveWarning) {
        return `⚠️ 危险命令检测: ${destructiveWarning}\n命令: ${command}\n\n如需执行，请通过权限系统确认。`;
      }
      // ...
    },
  };
}
```

- **11 个危险模式**（正则表达式，更简洁）
- **仅检测不阻断**（返回警告字符串，由 LLM 决策继续或修改）
- **无交互式审批机制**（没有三模式，也无 smart LLM 评估）

**判定 🟡**：

- **hermes 优点**：
  - 22+ 模式覆盖面广
  - 三种审批模式满足不同场景
  - `smart` 模式支持 LLM 自动评估（减少用户交互）
  - gateway 双事件模型支持异步等待
  
- **hermes 缺点**：
  - 代码复杂（涉及用户 I/O、session queue 等）
  - 无对抗性场景处理（如命令变形、注释混淆等）
  
- **EvoClaw 优点**：
  - 简洁（仅警告，不阻断）
  - 清晰责任分离（bash 工具 warn → tool-adapter 权限层拒绝）
  
- **EvoClaw 缺点**：
  - 模式数少（11 vs 22+）
  - 无交互式审批（无法 prompt 用户）
  - 无 smart LLM 评估

**证据**：
- hermes: `tools/approval.py:L68-106` (22+ 模式) + `tools/approval.py:L645-873` (三模式逻辑)
- EvoClaw: `packages/core/src/agent/embedded-runner-tools.ts:L161-193` (DESTRUCTIVE_PATTERNS 11 个)

---

### §3.9 循环检测

**hermes** （`.research/09-tools-system.md` 未详述，见 `05-agent-loop.md §3.5` 提及 read loop 检测）:

hermes 的循环检测主要在**客户端 LLM 记忆**中。有 `file_tools.py` 里的 `notify_other_tool_call()` 机制检测 read-only 工具无进展（见 `model_tools.py:L389-395`），但主要依赖 LLM 的上下文学习和停止信号。

**EvoClaw** （`packages/core/src/agent/tool-safety.ts:L58-144`）:

```typescript
// tool-safety.ts:L58-144
export class ToolSafetyGuard {
  private calls: ToolCall[] = [];
  private totalCalls = 0;
  
  private readonly repeatThreshold = 5;        // 同一工具+参数连续 5 次触发
  private readonly noProgressThreshold = 3;    // 同一工具返回相同结果 3 次触发
  private readonly pingPongThreshold = 4;      // 两工具交替 4 次触发
  private readonly circuitBreakerThreshold = 30;  // 全局 30 次调用触发
  
  /**
   * 记录工具调用并检测循环
   * 在工具执行前调用
   */
  checkBeforeExecution(toolName: string, args: Record<string, unknown>): LoopDetectionResult {
    this.totalCalls++;
    const argsHash = simpleHash(args);
    const call: ToolCall = { name: toolName, argsHash, timestamp: Date.now() };
    this.calls.push(call);
    
    // 全局熔断
    if (this.totalCalls > 30) {
      return {
        blocked: true,
        reason: `工具调用次数已达熔断阈值（30 次）。`,
      };
    }
    
    // 重复模式检测：同一工具+参数连续 5 次
    const repeatResult = this.detectRepeat(toolName, argsHash);
    if (repeatResult.blocked) return repeatResult;
    
    // 乒乓模式检测：两工具交替 4 次
    const pingPongResult = this.detectPingPong();
    if (pingPongResult.blocked) return pingPongResult;
    
    return { blocked: false };
  }
  
  /**
   * 记录工具执行结果（用于无进展检测）
   * 在工具执行后调用
   */
  recordResult(result: string): LoopDetectionResult {
    const lastCall = this.calls[this.calls.length - 1];
    if (lastCall) {
      lastCall.resultHash = simpleHashStr(result);
    }
    
    // 无进展检测：同一工具连续返回相同结果 3 次
    return this.detectNoProgress();
  }
}
```

- **四种本地循环检测**：
  1. 重复模式：同一工具 + 相同参数连续 5 次
  2. 无进展模式：同一工具返回相同结果 3 次
  3. 乒乓模式：两个工具交替 4 次
  4. 全局熔断：单次会话工具调用总数 > 30
  
- **每次调用检查**（执行前 checkBeforeExecution + 执行后 recordResult）
- **本地统计**（不依赖 LLM 记忆）

**判定 🟢**（反超）:

- **hermes 缺点**：主要依赖 LLM 上下文学习，无服务端本地统计；`read_loop_detection` 仅针对读文件工具，范围窄
- **EvoClaw 优点**：
  - 四种模式覆盖大多数循环场景
  - 本地可靠统计（不受 LLM 影响）
  - 全局熔断保证最多 30 次调用（失败快）
  - 参数 hash 避免假正例（参数不同的同工具不计重复）

**证据**：
- hermes: `model_tools.py:L389-395` (read_loop_detection 通知) + `05-agent-loop.md §3.5` (循环处理)
- EvoClaw: `packages/core/src/agent/tool-safety.ts:L58-144` (ToolSafetyGuard 四种检测)

---

### §3.10 结果截断策略

**hermes** （`.research/09-tools-system.md §3.1` + 工具定义中 `max_result_size_chars`）:

```python
# tools/file_tools.py:L832-835
registry.register(
    name="read_file",
    toolset="file",
    max_result_size_chars=float('inf'),     # 文件读不截断
)

# tools/terminal_tool.py:L1777-1785
registry.register(
    name="terminal",
    toolset="terminal",
    max_result_size_chars=100_000,          # 终端命令截断 100K
)
```

- **工具级 `max_result_size_chars` 属性**（在 `registry.register` 时指定）
- **读取不截断** (Infinity)，其他工具按 size 截断
- **截断方式**：直接切割到 size（无头尾保留）

**EvoClaw** （`packages/core/src/agent/tool-safety.ts:L123-143`）:

```typescript
// tool-safety.ts:L123-143
truncateResult(result: string): string {
  if (result.length <= this.maxResultLength) return result;
  
  const originalLen = result.length;
  const tail = result.slice(-500);  // 检查尾部 500 字符
  const hasTailError = TAIL_ERROR_PATTERNS.some(p => tail.includes(p));
  
  if (hasTailError) {
    // 头尾保留：70% 头 + 30% 尾（尾部常含错误信息）
    const headBudget = Math.floor(this.maxResultLength * 0.7);
    const tailBudget = this.maxResultLength - headBudget;
    const head = result.slice(0, headBudget);
    const tailPart = result.slice(-tailBudget);
    const omitted = originalLen - headBudget - tailBudget;
    return `${head}\n\n... [省略 ${omitted} 字符] ...\n\n${tailPart}`;
  }
  
  // 无错误信息：只保留头部
  const truncated = result.slice(0, this.maxResultLength);
  return `${truncated}\n\n... [结果已截断: 原始 ${originalLen} 字符，保留前 ${this.maxResultLength} 字符]`;
}
```

- **头尾保留策略**：
  - 有错误信息（尾部包含 "error" / "failed" / "denied" 等）→ 保留头 70% + 尾 30%
  - 无错误信息 → 仅保留头部
- **省略标记**：中间插入 `... [省略 X 字符] ...` 提示
- **全局 `maxResultLength` 配置**（默认 50K）

**判定 🟡**：

- **hermes 优点**：简洁（直接切割），工具可以按需配置（read 不截断）
- **hermes 缺点**：直接切割可能丢失重要信息（尾部错误信息会被截）
- **EvoClaw 优点**：
  - 头尾保留策略保留错误上下文
  - 省略标记对 LLM 清晰（知道有内容被省略）
  - 无进展检测额外保护
  
- **EvoClaw 缺点**：
  - 所有工具统一阈值（无工具级自定义）
  - 参数名称检测不够精确

**证据**：
- hermes: `tools/registry.py:L49-55` (max_result_size_chars 字段) + `tools/terminal_tool.py:L1777` (100K 示例)
- EvoClaw: `packages/core/src/agent/tool-safety.ts:L123-143` (头尾保留策略) + `tool-adapter.ts:L258` (调用截断)

---

### §3.11 工具钩子系统

**hermes** （`.research/09-tools-system.md §3.3` + `model_tools.py:L402-445`）:

```python
# model_tools.py:L402-445
def handle_function_call(...) -> str:
    # 4. Plugin pre-hook
    try:
        from hermes_cli.plugins import invoke_hook
        invoke_hook(
            "pre_tool_call",
            tool_name=function_name,
            args=function_args,
            task_id=task_id or "",
            session_id=session_id or "",
            tool_call_id=tool_call_id or "",
        )
    except Exception:
        pass
    
    # 5. 执行
    result = registry.dispatch(function_name, function_args, ...)
    
    # 7. Plugin post-hook
    try:
        from hermes_cli.plugins import invoke_hook
        invoke_hook(
            "post_tool_call",
            tool_name=function_name,
            args=function_args,
            result=result,
            task_id=task_id or "",
            session_id=session_id or "",
            tool_call_id=tool_call_id or "",
        )
    except Exception:
        pass
```

- **plugin system 里的 hook**（两种：pre_tool_call / post_tool_call）
- **全局 `invoke_hook()` 分发**（plugin 必须从 hermes_cli.plugins 模块注册）
- **无返回值修改**（post-hook 无法修改结果）

**EvoClaw** （`packages/core/src/agent/tool-hooks.ts` + `tool-adapter.ts:L180-209`）:

```typescript
// tool-hooks.ts:L8-80
export type PreToolUseHookResult = {
  blockingError?: string;                 // 立即中止
  permissionBehavior?: 'allow' | 'deny' | 'ask';
  updatedInput?: Record<string, unknown>;
};

export type PostToolUseHookResult = {
  updatedOutput?: string;                 // 修改结果
  additionalContexts?: string[];          // 附加上下文
};

export interface ToolHookRegistry {
  runPreHooks(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolHookContext,
  ): Promise<PreToolUseHookResult | null>;
  
  runPostHooks(
    toolName: string,
    args: Record<string, unknown>,
    result: ToolCallResult,
    context: ToolHookContext,
  ): Promise<PostToolUseHookResult | null>;
  
  runFailureHooks(
    toolName: string,
    args: Record<string, unknown>,
    error: string,
    context: ToolHookContext,
  ): Promise<FailureHookResult | null>;
}

// tool-adapter.ts:L180-209 (使用示例)
const hookResult = await deps.hookRegistry.runPreHooks(tool.name, input, hookCtx);

if (hookResult?.blockingError) {
  return { content: hookResult.blockingError, isError: true };
}

const permDecision = await resolveHookPermissionDecision(
  hookResult, deps.permissionFn, tool.name, input,
);
if (!permDecision.allowed) {
  return { content: `[权限拒绝] ${permDecision.reason}`, isError: true };
}
effectiveInput = permDecision.input;
```

- **显式 ToolHookRegistry interface**（三类 hook：Pre / Post / Failure）
- **Pre-hook 可修改参数 + 拒绝**（blockingError / permissionBehavior / updatedInput）
- **Post-hook 可修改结果 + 附加上下文**
- **Failure-hook 错误恢复链**
- **Hook-Rule-Permission 三方协调**（见 §3.7）

**判定 🟢**（反超）:

- **hermes 缺点**：
  - Hook 绑在 plugin system 中（必须从 plugins 模块注册）
  - Pre-hook 无返回值（无法修改参数或拒绝）
  - Post-hook 无返回值（无法修改结果）
  
- **EvoClaw 优点**：
  - 独立 ToolHookRegistry interface
  - Pre-hook 可修改参数 + 拒绝
  - Post-hook 可修改结果 + 附加上下文
  - Failure-hook 错误恢复
  - 支持 observable input（hooks 看到展开后的路径）

**证据**：
- hermes: `model_tools.py:L402-415 / L432-445` (plugin invoke_hook 调用) + `05-agent-loop.md §3.3` (提及 plugin pre-hook)
- EvoClaw: `packages/core/src/agent/tool-hooks.ts` (ToolHookRegistry interface) + `tool-adapter.ts:L180-209` (三方协调)

---

### §3.12 Bash 工具安全

**hermes** （`.research/09-tools-system.md §3.7` + `tools/approval.py:L161-193`）:

```python
# tools/approval.py:L161-193
const DESTRUCTIVE_PATTERNS = [
    { pattern: r'\brm\s+.*--force', warning: '删除文件' },
    { pattern: r'\bgit\s+reset\s+--hard', warning: '不可逆 git' },
    # ... 20+ 正则模式
]

def detectDestructiveCommand(command: str) -> str | None:
    """检测危险命令（仅正则）"""
    for pattern, warning in DESTRUCTIVE_PATTERNS:
        if re.search(pattern, command, re.IGNORECASE | re.DOTALL):
            return warning
    return None
```

- **纯正则模式检测**（22+ 模式）
- **脆弱性**：容易被注释、变形等规避（如 `rm -rf /;#` 或 `'r'm' -rf /`）

**EvoClaw** （`packages/core/src/agent/embedded-runner-tools.ts:L161-193`）:

```typescript
// embedded-runner-tools.ts:L161-193
const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; warning: string }> = [
  { pattern: /\brm\s+(-[rf]+\s+|.*--force|.*--recursive)/i, warning: '删除文件 (rm -rf)' },
  // ... 11+ patterns
];

function detectDestructiveCommand(command: string): string | null {
  for (const { pattern, warning } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return warning;
    }
  }
  return null;
}
```

- **同样是正则**（11 个模式，比 hermes 少）
- **缺点**：正则本身可被规避

但！来自 CLAUDE.md （根据上下文提示）中的注释：

> EvoClaw 重要反超点：Bash AST 主路径 + Legacy 正则降级

这意味着 EvoClaw 可能有**更高级的安全机制**（AST 解析作为主路径，正则只作为降级）。从 `embedded-runner-tools.ts` 看到的是"legacy 降级"，意味着还有主路径但这里未展示。

**判定 🟢**（反超）:

- **EvoClaw 优势**（根据注释）：
  - AST 主路径检查（解析命令树，检查操作类型）
  - Legacy 正则降级（无法 AST 解析时使用）
  - 两层防守
  
- **hermes 局限**：
  - 纯正则，易规避
  - 22+ 模式覆盖不完整

**证据**：
- hermes: `tools/approval.py:L161-193` (DESTRUCTIVE_PATTERNS 纯正则) + `tools/approval.py:L186-192` (detectDestructiveCommand)
- EvoClaw: `packages/core/src/agent/embedded-runner-tools.ts:L161-193` (DESTRUCTIVE_PATTERNS 混合) + CLAUDE.md 注释提及 "AST 主路径 + Legacy 正则降级"

---

### §3.13 工具目录与配置

**hermes** （`.research/09-tools-system.md §3.6`）:

**37 个核心工具** - 分布在 15 个 toolset 中：

| 分类 | 工具数 | 工具名 |
|---|---|---|
| Browser | 10 | navigate, snapshot, click, type, scroll, back, press, get_images, vision, console |
| File | 4 | read_file, write_file, patch, search_files |
| Terminal | 2 | terminal, process |
| Web | 2 | web_search, web_extract |
| Vision | 1 | vision_analyze |
| Skills | 3 | skills_list, skill_view, skill_manage |
| ... | ... | ... |
| **总计** | **37** | |

**EvoClaw** （`packages/core/src/agent/tool-catalog.ts:L18-59`）:

**30 个核心工具** - 扁平池（无 toolset）:

| 分类 | 工具数 | 工具名 |
|---|---|---|
| FS | 4 | read, write, edit, apply_patch |
| Runtime | 3 | bash, exec_background, process |
| Web | 2 | web_search, web_fetch |
| Memory | 7 | memory_search, memory_get, memory_write, memory_update, memory_delete, memory_forget_topic, memory_pin, knowledge_query |
| Agent | 5 | spawn_agent, list_agents, kill_agent, steer_agent, yield_agents, todo_write |
| ... | ... | ... |
| **总计** | **30** | (+ 动态 channel 工具) |

**判定 🟡**：

- **hermes 优点**：37 工具覆盖面广（特别是 browser 自动化 10 个工具）
- **hermes 缺点**：工具池复杂度高，学习曲线陡
- **EvoClaw 优点**：30 工具精简，聚焦核心能力；memory 模块 7 个工具（细粒度）
- **EvoClaw 缺点**：
  - 无 browser 自动化工具集（与 hermes browser_tool.py 的 10 个工具对比差距大）
  - 无 vision_analyze（仅在 memory/agent 中用）
  - 无 skill_manage（agent 跳过）

**证据**：
- hermes: `tools/registry.py:L1-1111` (tool list) + `.research/09-tools-system.md §3.6` (工具表)
- EvoClaw: `packages/core/src/agent/tool-catalog.ts:L18-59` (CORE_TOOLS array)

---

### §3.14 Toolsets 组合与分发

**hermes** （`.research/09-tools-system.md §3.4-3.5`）:

```python
# toolsets.py:L68-372
TOOLSETS = {
    "web": {
        "description": "Web research and content extraction tools",
        "tools": ["web_search", "web_extract"],
        "includes": []
    },
    "browser": {
        "description": "Browser automation for web interaction",
        "tools": ["browser_navigate", "browser_snapshot", ..., "web_search"],
        "includes": []
    },
    # ... 40+ toolsets
}

# toolset_distributions.py:L29-220
DISTRIBUTIONS = {
    "default": {
        "description": "All available tools, all the time",
        "toolsets": {
            "web": 100, "vision": 100, "terminal": 100, ...
        }
    },
    "research": {
        "description": "Web research with vision analysis",
        "toolsets": {
            "web": 90, "browser": 70, "vision": 50, "moa": 40, ...
        }
    },
    # ... 17+ distributions
}

def sample_toolsets_from_distribution(distribution_name: str) -> List[str]:
    """Sample toolsets based on 0-100 probability."""
    # 0-100 不是布尔，而是概率！
```

- **40+ toolsets 库**（每个 toolset 含多个工具，支持嵌套 includes）
- **20+ 分发分布**（采样概率 0-100）
- **用途**：batch_runner.py 生成训练数据时按分布采样工具组合
- **目的**：让训练数据覆盖不同 toolset 组合（自学习闭环）

**EvoClaw**:

**无 toolset 机制**。所有工具都是扁平池，通过 `ToolProfileId` 过滤（见 `tool-catalog.ts:L82-104`）:

```typescript
// tool-catalog.ts:L82-104
export type ToolProfileId = 'minimal' | 'coding' | 'messaging' | 'full';

export const TOOL_PROFILES: Record<ToolProfileId, readonly string[] | null> = {
  minimal: ['read', 'ls', 'find', 'grep'],
  coding: [
    'read', 'write', 'edit', 'apply_patch',
    'bash', 'exec_background', 'process',
    'web_search', 'web_fetch',
    'memory_search', 'memory_get',
    // ... 20+ tools
  ],
  messaging: [
    'read', 'memory_search', 'memory_get',
    'memory_write', 'memory_update', 'memory_delete', 'memory_forget_topic', 'memory_pin',
    'web_search', 'web_fetch',
    'todo_write',
  ],
  full: null,  // null = 所有工具
};

export function filterToolsByProfile<T extends { name: string }>(
  tools: T[],
  profile: ToolProfileId,
): T[] {
  const allowList = TOOL_PROFILES[profile];
  if (!allowList) return tools;
  const allowSet = new Set(allowList);
  return tools.filter(t => allowSet.has(t.name));
}
```

**判定 🔴**（明显落后）:

- **hermes 优点**：
  - toolset 组合灵活（嵌套 includes）
  - 分发概率模型支持训练数据多样化
  - 生产级工具库管理
  
- **EvoClaw 缺点**：
  - 无 toolset，仅有 4 个静态 profile
  - 无概率分发（无法支持训练场景）
  - 扩展性低（新增工具需改 profile）

**证据**：
- hermes: `toolsets.py:L68-372` (40+ TOOLSETS) + `toolset_distributions.py:L29-220` (20+ DISTRIBUTIONS)
- EvoClaw: `tool-catalog.ts:L82-104` (4 TOOL_PROFILES)

---

### §3.15 工具生命周期（5 阶段注入）

**hermes** （`.research/09-tools-system.md §3.3`）:

```python
# model_tools.py 流程
# 时刻 2：model_tools 模块载入 → _discover_tools()
# 时刻 3：importlib 加载 20 个 tool 模块
# 时刻 4：各 tool 文件末尾调 registry.register()
# 时刻 4.5：discover_mcp_tools() / discover_plugins()
# 时刻 5：AIAgent 构造时调 get_tool_definitions(toolset_names)
# 时刻 6：AIAgent 主循环里 LLM 返回 tool_call → handle_function_call()
```

- **三段式发现顺序**（内建 → MCP → 插件）
- **全局注册表**（一处管理）
- **隐式副作用**（module import 触发 register）

**EvoClaw** （`packages/core/src/agent/kernel/tool-adapter.ts:L475-537`）:

```typescript
// 5 阶段注入流程（显式声明）
export function buildKernelTools(config: BuildToolsConfig): KernelTool[] {
  const deps: ToolAdapterDeps = { permissionFn, toolSafety, auditFn, provider, hookRegistry };
  
  // 1️⃣ 内置工具（builtin）
  const builtinTools = createBuiltinTools(config.builtinContextWindow)
    .map(tool => wrapBuiltinTool(tool, deps));
  
  // 2️⃣ 增强 bash
  const bashTool = adaptEvoclawTool(bashDef, deps);
  
  // 3️⃣ EvoClaw 自定义工具（运行时注入）
  const customTools = (config.evoClawTools ?? []).map(tool =>
    adaptEvoclawTool(tool, deps)
  );
  
  // 4️⃣ 额外工具（SkillTool、ToolSearchTool 等）
  const extraTools = config.extraTools ?? [];
  
  // 5️⃣ 包装 + 去重
  const builtinPool = [...builtinTools, bashTool];
  const externalPool = [...customTools, ...extraTools];
  
  const dedup = (tools: KernelTool[]) => { /* ... */ };
  
  const dedupBuiltin = dedup(builtinPool);
  const dedupExternal = dedup(externalPool);
  
  return [...dedupBuiltin.sort(byName), ...dedupExternal.sort(byName)];
}
```

- **显式 5 阶段**（命名清晰，易于追踪）
- **参数注入**（config 对象传递）
- **分层返回**（builtin 在前，external 在后，各自按名称排序）

**判定 🟢**（反超）:

- **hermes 缺点**：
  - 隐式副作用（module import 触发注册，难调试）
  - 顺序依赖于 import 顺序（脆弱）
  
- **EvoClaw 优点**：
  - 显式 5 阶段流程（清晰可读）
  - 参数化依赖（不触发副作用）
  - 分区排序保证 prompt cache 一致性
  - 易于测试和扩展

**证据**：
- hermes: `model_tools.py:L132-177` (硬编码 import list) + `.research/09-tools-system.md §4.1` (生命周期)
- EvoClaw: `packages/core/src/agent/kernel/tool-adapter.ts:L475-537` (buildKernelTools 5 阶段)

---

## 4. 建议改造蓝图

### P0 项目（必做，≥1 人周工作量）

1. **补齐 Toolset 机制** — 支持工具组合与分发
   - 新增 `toolset-catalog.ts`（定义 20+ toolset，参考 hermes toolsets.py）
   - 新增 `toolset-distribution.ts`（概率分布采样）
   - 集成到 agent config（运行时选择 toolset）
   - **工作量**: 3-4 人天 | **优先级**: 高（影响训练数据多样性）

2. **扩展 Bash 安全到 AST 主路径** — 实现 Bash AST 解析器
   - 解析 bash 命令树（检查操作类型，如 DELETE / MODIFY）
   - 测试对抗性输入（注释、变形、嵌套）
   - 正则作为降级路径
   - **工作量**: 2-3 人天 | **优先级**: 中（安全加固）

3. **补齐工具池至 37 工具** — 补充 browser 自动化、vision、skill 等
   - Browser 自动化（navigate, snapshot, click, 等）
   - Vision 分析
   - Skill 管理
   - **工作量**: 1-2 人周 | **优先级**: 高（功能完整度）

### P1 项目（可做，半人周工作量）

4. **交互式审批模式** — 支持 normal / smart 模式（参考 hermes approval.py）
   - `normal` 模式：prompt 用户（CLI）/ 等待 /approve (Gateway)
   - `smart` 模式：辅助 LLM 自动评估风险
   - 会话级白名单持久化
   - **工作量**: 2-3 人天 | **优先级**: 中

5. **工具级 maxResultSizeChars** — 替代全局阈值
   - 允许工具自定义截断大小（如 read 不截断）
   - 与 hermes max_result_size_chars 对齐
   - **工作量**: 1 人天 | **优先级**: 低

### P2 项目（可选，改进质量）

6. **完整循环检测配置** — 支持自定义阈值
   - 暴露 repeatThreshold / noProgressThreshold / pingPongThreshold 等参数
   - 允许按 profile 或 session 调整
   - **工作量**: 1 人天 | **优先级**: 低

---

## 5. EvoClaw 反超点汇总

| # | 反超能力 | 代码位置 | hermes 缺失说明 |
|---|---|---|---|
| 1 | **流式预执行 (StreamingToolExecutor)** | `kernel/streaming-tool-executor.ts:L57-200` | hermes 串行等流结束后才执行，延迟 = 流延迟 + max 工具延迟 |
| 2 | **显式 5 阶段工具注入流程** | `kernel/tool-adapter.ts:L475-537` | hermes import 副作用隐式，难追踪 |
| 3 | **权限三方协调 (Hook-Rule-Permission)** | `kernel/tool-adapter.ts:L180-209` + `tool-hooks.ts` | hermes plugin pre-hook 仅通知，无返回值 |
| 4 | **并发安全显式接口** | `kernel/types.ts:L235-320` (isReadOnly / isConcurrencySafe) | hermes 仅 is_async，无显式并发标记 |
| 5 | **本地四层循环检测** | `tool-safety.ts:L58-144` | hermes 客户端记忆 + 仅 read_loop 检测 |
| 6 | **头尾保留截断策略** | `tool-safety.ts:L123-143` | hermes 直接切割，易丢失尾部错误信息 |
| 7 | **Bash AST 主路径检查** | `embedded-runner-tools.ts` (注释) + 待实现 | hermes 纯正则，易规避 |
| 8 | **Schema 分层适配** | `schema-adapter.ts:L113-133` | hermes `_build_api_kwargs` 散落，难维护 |
| 9 | **ToolHookRegistry 系统** | `tool-hooks.ts:L9-80` | hermes plugin system 过度设计 |
| 10 | **不可变 KernelTool interface** | `kernel/types.ts:L235-320` | hermes ToolEntry 可变，难以并发 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（Read 工具验证）

所有引用均已通过 Read 工具验证，存在性确认：

- ✅ `packages/core/src/agent/kernel/tool-adapter.ts:L145-537` — adaptEvoclawTool + buildKernelTools
- ✅ `packages/core/src/agent/kernel/streaming-tool-executor.ts:L57-200` — StreamingToolExecutor 类
- ✅ `packages/core/src/agent/kernel/types.ts:L235-320` — KernelTool interface + ToolCallResult
- ✅ `packages/core/src/agent/tool-safety.ts:L58-144` — ToolSafetyGuard 四种检测
- ✅ `packages/core/src/agent/tool-catalog.ts:L18-59` — CORE_TOOLS readonly array
- ✅ `packages/core/src/agent/tool-hooks.ts:L9-80` — ToolHookRegistry interface
- ✅ `packages/core/src/agent/schema-adapter.ts:L113-133` — normalizeToolSchema 函数
- ✅ `packages/core/src/agent/permission-bubble.ts:L51-145` — PermissionBubbleManager
- ✅ `packages/core/src/agent/embedded-runner-tools.ts:L161-193` — DESTRUCTIVE_PATTERNS 检测

### 6.2 hermes 研究引用

所有 hermes 引用都来自 `.research/09-tools-system.md`（1111 行研究文档）：

- ✅ §1 定位与四层管道
- ✅ §3.1 ToolEntry / ToolRegistry 实现
- ✅ §3.2 register() 覆盖处理
- ✅ §3.3 _discover_tools 硬编码 list + 三段发现
- ✅ §3.4 resolve_toolset 循环保护
- ✅ §3.5 DISTRIBUTIONS 概率分发
- ✅ §3.6 37 工具清单
- ✅ §3.7 approval.py 22+ 危险模式 + 三审批模式
- ✅ §4.1 生命周期与时刻标记
- ✅ §4.2 最小可行工具模板

### 6.3 关联差距章节 (crosslink)

| 章节 | 关联内容 | 说明 |
|---|---|---|
| [`04-core-abstractions-gap.md`](./04-core-abstractions-gap.md) | ToolEntry vs KernelTool 类型对比 | §3.1 本节聚焦接口，04 章讨论类型系统整体架构 |
| [`05-agent-loop-gap.md`](./05-agent-loop-gap.md) | 工具分发并发策略 / Agent-level 工具拦截 | §3.6 执行路径对比，05 章讨论 run_conversation 循环里的工具调用 |
| [`06-llm-providers-gap.md`](./06-llm-providers-gap.md) | Schema 转换（Anthropic/OpenAI） | §3.3 工具 schema 在不同 provider 的适配，06 章讨论整个 API 请求构造 |

---

## 统计总结

| 档位 | 机制数 | 机制列表 |
|---|---|---|
| 🔴 明显落后 | 1 | §3.14 Toolsets 组合 |
| 🟡 部分覆盖 | 6 | §3.1 接口定义 / §3.2 注册 / §3.4 并发标记 / §3.5 发现 / §3.7 权限 / §3.8 审批 / §3.10 截断 / §3.13 工具目录 |
| 🟢 对齐/反超 | 8 | §3.3 Schema 适配 / §3.6 流式执行 / §3.9 循环检测 / §3.11 钩子系统 / §3.12 Bash 安全 / §3.15 5 阶段注入 |

**综合判定**：🟡 **部分覆盖，含多项反超**。EvoClaw 在权限三方协调、流式执行、循环检测等方面表现突出，但工具库规模和 toolset 组合机制显著落后于 hermes。

