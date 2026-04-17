# 13 — 插件系统 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/13-plugins.md`（~880 行）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`hermes_cli/plugins.py:1-611` + `plugins_cmd.py:1-690`
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16）
> **综合判定**: 🟡 **部分覆盖，形态差异显著**（脚本式 plugin hooks vs 系统级 ContextPlugin；单例 memory provider vs 独立插件）

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但形态不同，各有取向
- 🟢 **EvoClaw 对齐或反超** — 能力持平或表现更佳

---

## 1. 定位

**hermes 插件系统**（`.research/13-plugins.md §1-2`）— v0.8.0 关键扩展，让第三方代码**不改源码**即可：
1. 注册新工具（`ctx.register_tool()` → `tools.registry`）
2. 订阅 10 种 hook 事件（tool / LLM / API / session 四层）
3. 贡献 CLI 子命令（`hermes <plugin-name> ...`）
4. 注册 memory provider（单例）
5. 安装时交互收集 env var（manifest 驱动）

**三源发现**：`~/.hermes/plugins/` (user) / `./.hermes/plugins/` (project, opt-in) / pip entry_points (entrypoint)。**动态 import** 为 `hermes_plugins.<name>` module，`register(ctx)` 回调注册扩展点。

**EvoClaw 插件系统**（`packages/core/src/context/plugin.interface.ts` + `packages/core/src/context/plugins/` 12 个）— 系统级架构，**5-hook 生命周期 + 10 个内置插件**：
1. `bootstrap` — 会话启动（一次）
2. `beforeTurn` — 每轮对话前（串行按 priority）
3. `compact` — token 超限时压缩
4. `afterTurn` — 每轮对话后（并行）
5. `shutdown` — 会话关闭

**特点**：插件是类型化接口（不是动态脚本），插件生命周期与 **Agent 核心循环紧耦合**（见 `query-loop.ts:360-380`）。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 插件定义与加载 | 🟡 | hermes 脚本式 + YAML manifest vs EvoClaw 接口化 + 类型 |
| §3.2 | Hook 生命周期粒度 | 🟡 | hermes 10 hook（工具/LLM/API/会话） vs EvoClaw 5 hook（引导/轮次/压缩/终止/关闭） |
| §3.3 | Hook 触发点覆盖 | 🟡 | hermes `pre/post_api_request` + tool level vs EvoClaw 无 per-tool hook |
| §3.4 | 插件发现机制 | 🟡 | hermes 三源（user/project/entrypoint）+ 动态 import vs EvoClaw 硬编码 10 插件 |
| §3.5 | Memory Provider 注册 | 🔴 | hermes `register_memory_provider()` 单例 vs EvoClaw 无对应（memory 不是插件） |
| §3.6 | 工具注册 | 🟡 | hermes `ctx.register_tool()` 委托 tools.registry vs EvoClaw 无工具注册（SKills 系统独立） |
| §3.7 | CLI 子命令注册 | 🔴 | hermes `register_cli_command()` + dispatch vs EvoClaw 无 CLI plugin 扩展点 |
| §3.8 | Env var 交互收集 | 🔴 | hermes manifest 驱动 + secret 用 getpass vs EvoClaw 无对应 |
| §3.9 | 插件隔离与错误处理 | 🟡 | hermes 异常隔离（加载/执行失败不影响其它） vs EvoClaw 同进程紧耦合 |
| §3.10 | 插件禁用/管理 | 🔴 | hermes `config.yaml:plugins.disabled` + CLI 管理 vs EvoClaw 无禁用机制 |
| §3.11 | Enterprise Extension Pack | 🟢 | **反超**：EvoClaw `evoclaw-pack.json`（Skills + MCP + 安全策略合一）vs hermes 无 |
| §3.12 | MCP 作为插件机制 | 🟢 | **反超**：EvoClaw `MCP Client` 原生集成（12 个工具 + prompt 注入）vs hermes MCP 在 21 章独立 |

**统计**: 🔴 4 / 🟡 6 / 🟢 2（其中 1 项反超）。

---

## 3. 机制逐条深度对比

### §3.1 插件定义与加载

**hermes**（`.research/13-plugins.md §3.1-3.2`）— 脚本式 + YAML manifest:

```python
# plugin.yaml
name: honcho
version: 1.0.0
requires_env:
  - name: HONCHO_API_KEY
    description: "..."
    secret: true
hooks:
  - on_session_end

# __init__.py（~1400 行，包含完整实现）
class HonchoMemoryProvider:
    async def save_memory(self, ...): ...

def register(ctx):
    ctx.register_memory_provider(HonchoMemoryProvider())
    ctx.register_hook("on_session_end", on_session_end_handler)
```

加载流程（`plugins.py:368-414`）：
1. 读 `plugin.yaml` → `PluginManifest`
2. 检查禁用列表（`_disabled` set）
3. 动态 import `__init__.py` 为 `hermes_plugins.<name>` module
4. 调 `module.register(ctx)` — plugin 自行注册扩展点
5. LoadedPlugin 记录已加载（含 error 字段）

**异常隔离**：每一步都 try/except 包装，单个 plugin 加载/执行失败只影响自己。

**EvoClaw**（`packages/core/src/context/plugin.interface.ts` + `packages/core/src/context/plugins/`）— 接口化 + 类型安全:

```typescript
// plugin.interface.ts
export interface ContextPlugin {
  name: string;
  priority: number;
  bootstrap?(ctx: BootstrapContext): Promise<void>;
  beforeTurn?(ctx: TurnContext): Promise<void>;
  compact?(ctx: CompactContext): Promise<ChatMessage[]>;
  afterTurn?(ctx: TurnContext): Promise<void>;
  shutdown?(ctx: ShutdownContext): Promise<void>;
}

// plugins/context-assembler.ts（~200 行，类型化）
export function createContextAssemblerPlugin(): ContextPlugin {
  return {
    name: 'context-assembler',
    priority: 30,
    bootstrap: async (ctx) => { ... },
    beforeTurn: async (ctx) => { ... },
  };
}
```

加载流程（`query-loop.ts:360-365`）：
```typescript
const plugins: ContextPlugin[] = [
  createContextAssemblerPlugin(config.systemPrompt),
  createMemoryRecallPlugin(config.searcher),
  createToolRegistryPlugin(config.skillPaths),
  // ... 10 个插件
];
// 按 priority 排序后逐个触发 hook
```

**关键差异**：
- hermes **脚本式 + 动态 import** —— 灵活但隐式（新成员需理解 register() 约定）
- EvoClaw **接口化 + 类型** —— 显式可读但需编译时注册

**判定 🟡**：
- ✅ EvoClaw 类型安全 + IDE 自动补全
- ❌ EvoClaw 失去了"第三方 plugin 不改源码即可扩展"的能力（所有插件都要写在 `plugins/` 目录内）
- ✅ hermes 脚本式更灵活（用户可 `~/.hermes/plugins/my-plugin/` 自己写）
- ❌ hermes 动态 import 难以编辑器追踪

---

### §3.2 Hook 生命周期粒度

**hermes**（`.research/13-plugins.md §3.2, §3.4`）— 10 种 hook，分 4 层:

```python
VALID_HOOKS: Set[str] = {
    # Tool 层（per-tool-call）
    "pre_tool_call",      # tools.py:502
    "post_tool_call",     # tools.py:520
    
    # LLM 层（per-turn）
    "pre_llm_call",       # run_agent.py:7177
    "post_llm_call",      # run_agent.py:9200
    
    # API 层（per-API-call，含 retry）
    "pre_api_request",    # run_agent.py:7418
    "post_api_request",   # run_agent.py:8597
    
    # Session 层（per-session 生命周期）
    "on_session_start",   # run_agent.py:7086
    "on_session_end",     # cli.py:8508
    "on_session_finalize",# cli.py:617
    "on_session_reset",   # gateway/run.py:3325
}
```

**关键设计**：
- `pre_api_request` vs `pre_llm_call`：一个 agent turn 可能包含多次 API call（retry + tool call），前者细粒度，后者粗粒度
- `task_id` correlation ID：`pre_api_request` 和 `post_api_request` 共享 task_id，plugin 可做性能统计

**EvoClaw**（`packages/core/src/context/plugin.interface.ts`）— 5 种 hook，与 Agent 核心循环同步:

```typescript
interface ContextPlugin {
  // Agent 启动时（创建工作区、初始化记忆等）
  bootstrap?(ctx: BootstrapContext): Promise<void>;
  
  // 每轮对话**前**（注入工具、记忆、知识等）——串行按 priority
  beforeTurn?(ctx: TurnContext): Promise<void>;
  
  // Token 超限时**压缩**——返回压缩后的 messages
  compact?(ctx: CompactContext): Promise<ChatMessage[]>;
  
  // 每轮对话**后**（更新记忆、事件日志等）——并行
  afterTurn?(ctx: TurnContext): Promise<void>;
  
  // Agent 关闭时（保存状态、清理资源）
  shutdown?(ctx: ShutdownContext): Promise<void>;
}
```

**hook 调用点**（`query-loop.ts` 内联）：
- `bootstrap` @ 会话开始
- `beforeTurn`(串行) @ 每轮 LLM 调用前
- `compact` @ 上下文超限时（在 `maybeCompressPhased` 内）
- `afterTurn`(并行) @ 工具结果收集后
- `shutdown` @ 会话结束

**判定 🟡**：
- 🔴 EvoClaw **缺少 tool 级 hook**（`pre_tool_call` / `post_tool_call`）—— 无法在工具调用前拦截参数、调用后监测结果
- 🔴 EvoClaw **缺少 API 级 hook**（`pre_api_request` / `post_api_request`）—— 无法做 API 调用监控、retry 检测
- 🔴 EvoClaw **无 session 生命周期 hook**（`on_session_start/end` 仅 bootstrap/shutdown，无 reset）
- ✅ EvoClaw `compact` hook 是**额外设计**（hermes 无，见 §3.8）
- ✅ EvoClaw 上下文对象（`TurnContext` 含 messages/systemPrompt/injectedContext）比 hermes 更结构化

**反超**：EvoClaw 的 `beforeTurn` + `afterTurn` 配对模式（分别用于注入和反馈）比 hermes 的单向 hook 设计更对称。

---

### §3.3 Hook 触发点覆盖

**hermes**（`.research/13-plugins.md §3.4`）— 5 个关键触发点:

```python
# model_tools.py:502-533 — tool 执行
def handle_function_call(...):
    invoke_hook("pre_tool_call", tool_name=function_name, args=function_args, task_id=...)
    result = registry.dispatch(function_name, function_args, ...)
    invoke_hook("post_tool_call", tool_name=function_name, result=result, ...)

# run_agent.py:7177-7195 — turn 开始
_pre_results = invoke_hook(
    "pre_llm_call",
    session_id=self.session_id,
    user_message=original_user_message,
    conversation_history=list(messages),
    is_first_turn=(not bool(conversation_history)),
)

# run_agent.py:7418-7433 — API 调用前（含 retry）
invoke_hook(
    "pre_api_request",
    task_id=effective_task_id,
    api_call_count=api_call_count,
    message_count=len(api_messages),
    approx_input_tokens=approx_tokens,
)

# run_agent.py:8597-8599 — API 调用后
invoke_hook("post_api_request", task_id=..., assistant_text=..., tool_calls=...)

# run_agent.py:9200-9202 — turn 结束
invoke_hook("post_llm_call", ...)
```

**特点**：
- **tool 级粒度** —— 每个 tool call 的前后都能拦截
- **API 级粒度** —— 包括 retry（同一 agent turn 可能多次 pre/post_api_request）
- **Session 级粒度** —— start/end/finalize/reset 四个生命周期

**EvoClaw**（`packages/core/src/agent/kernel/query-loop.ts`）— hook 内联在主循环:

```typescript
// L360-365: bootstrap 一次
for (const plugin of plugins.sort((a, b) => a.priority - b.priority)) {
  await plugin.bootstrap?.({ agentId, sessionKey, workspacePath });
}

// L380-382: 每轮循环开始
for (const plugin of plugins) {
  await plugin.beforeTurn?.({ agentId, messages, systemPrompt, injectedContext: [], ... });
}

// L410-420: streamOneRound 调用（LLM 流式）
const roundResult = await streamOneRound(config, state.messages, executor, ...);

// L630-640: 工具结果收集后（并行）
await Promise.all(plugins.map(p => p.afterTurn?.({ ... })));

// L695: 会话结束
for (const plugin of plugins) {
  await plugin.shutdown?.({ agentId, sessionKey });
}
```

**关键缺失**：
- ❌ 无 `pre_tool_call` / `post_tool_call` —— 工具调用前拦截参数（如参数合规性检查）、调用后监测结果
- ❌ 无 `pre_api_request` / `post_api_request` —— 无法做细粒度的 API 调用监控、retry 检测
- ❌ `beforeTurn` 是**串行**的（按 priority），但**无反馈机制** —— plugin 无法修改 messages 或停止循环

**判定 🟡**：覆盖面不如 hermes 全面。建议 Phase D 补齐 tool 级 hook（见 §4）。

---

### §3.4 插件发现机制

**hermes**（`.research/13-plugins.md §3.2`）— 三源扫描 + 字母序:

```python
def discover_and_load(self) -> None:
    # 1. 用户插件 (~/.hermes/plugins/*)
    user_root = get_hermes_home() / "plugins"
    for plugin_dir in sorted(user_root.iterdir()):  # 字母序
        self._try_load_directory(plugin_dir, source="user")
    
    # 2. 项目插件 (./.hermes/plugins/*) — opt-in via HERMES_ENABLE_PROJECT_PLUGINS
    if os.getenv("HERMES_ENABLE_PROJECT_PLUGINS", "").lower() in ("1", "true", "yes"):
        project_root = Path.cwd() / ".hermes" / "plugins"
        for plugin_dir in sorted(project_root.iterdir()):
            self._try_load_directory(plugin_dir, source="project")
    
    # 3. Pip entry_points
    for ep in im.entry_points(group="hermes_agent.plugins"):
        module = ep.load()
        self._register_module(module, source="entrypoint")
```

**三源的语义**：
- **User** —— 全局用户插件（跨所有 agent/CLI 共用）
- **Project** —— 项目特定插件（`./.hermes/plugins/`，opt-in 防不小心加载）
- **Entrypoint** —— Python 包发布的 plugin（通过 pip 安装）

**EvoClaw**（`packages/core/src/agent/kernel/query-loop.ts:360-370`）— 硬编码 10 插件:

```typescript
const plugins: ContextPlugin[] = [
  createContextAssemblerPlugin(config.systemPrompt),
  createMemoryRecallPlugin(config.searcher),
  createToolRegistryPlugin(config.skillPaths),
  createCacheControlPlugin(config.modelId),
  createGapDetectionPlugin(config.agentId),
  createHeartbeatPlugin(),
  createSkillInjectorPlugin(config.skillPaths),
  createStandingOrdersPlugin(config.agentId),
  createSystemEventsPlugin(config.sessionKey),
  createKnowledgeGraphPlugin(),
];
```

加载：编译时注册，无运行时发现。

**判定 🔴**：
- ✅ hermes 三源设计覆盖开发者/用户/企业三层需求
- ❌ EvoClaw 完全无第三方 plugin 机制 —— 所有插件都必须编译进代码

**后果**：
- 用户无法 `~/.evoclaw/plugins/my-custom-plugin` 自己扩展
- 企业无法通过 pip 包的形式发布 plugin
- 新需求都要改源码 + 重新编译

**建议**：EvoClaw 可引入**混合模式**（见 §4）：
- 保留硬编码 10 个内置插件（确保正确性）
- 新增"扩展插件 loader"支持 user/project/entrypoint 三源

---

### §3.5 Memory Provider 注册

**hermes**（`.research/13-plugins.md §3.2, §4.1`）— Memory Provider 是插件的**特殊 extension point**:

```python
# PluginContext
def register_memory_provider(self, provider) -> None:
    """Register a singleton memory provider."""
    self._manager._memory_provider = provider

# plugins.py:326-345
class PluginManager:
    def __init__(self, ...):
        self._memory_provider = None  # 单例 slot
    
    @property
    def memory_provider(self):
        return self._memory_provider
```

**插件侧**（例如 `plugins/memory/honcho/__init__.py`）:

```python
class HonchoMemoryProvider(BaseMemoryProvider):
    async def get_memories(self, session_id, ...): ...
    async def save_memory(self, session_id, ...): ...

def register(ctx):
    ctx.register_memory_provider(HonchoMemoryProvider())
```

**特点**：
- **单例约束** —— 同一时刻只有一个 memory provider active
- **内置 CLI** —— active memory provider 的 CLI 自动暴露（`hermes honcho --help`）
- **9 个内置 memory providers** in `plugins/memory/`：honcho / mem0 / byterover / ...

**EvoClaw**（`packages/core/src/context/plugins/memory-recall.ts` + `packages/core/src/memory/hybrid-searcher.ts`）— Memory **不是插件**:

```typescript
// memory-recall.ts — 是 ContextPlugin 的一个应用
export function createMemoryRecallPlugin(searcher: HybridSearcher): ContextPlugin {
  return {
    name: 'memory-recall',
    priority: 40,
    async beforeTurn(ctx: TurnContext) {
      const results = await searcher.hybridSearch(...);
      // 直接注入到 injectedContext
      ctx.injectedContext.push(formattedMemory);
    },
  };
}

// 初始化（query-loop.ts 侧）
const memorySearcher = new HybridSearcher(db, vectorEngine);
const plugins = [
  createMemoryRecallPlugin(memorySearcher),
  // ...
];
```

**关键差异**：
- hermes **Memory Provider 接口化** —— 可以切换实现（honcho / mem0 / ...），用户选择
- EvoClaw **Memory 不可替换** —— 硬编码用 HybridSearcher（L0/L1/L2 向量记忆），无 API/扩展接口

**判定 🔴**：
- ❌ EvoClaw 无 memory provider 注册点
- ❌ 用户无法替换记忆后端（必须用 EvoClaw 的 HybridSearcher）
- ✅ hermes 的单例设计优雅（同时只有一个 active）

**影响**：企业如果已有 proprietary memory 系统（如 Neo4j 图数据库），无法接入 EvoClaw。

---

### §3.6 工具注册

**hermes**（`.research/13-plugins.md §3.2, §4.1`）— Plugin 通过 context 注册工具:

```python
# PluginContext
def register_tool(
    self, name: str, toolset: str, schema: dict, handler: Callable,
    check_fn: Callable = None, requires_env: list = None, ...
) -> None:
    """Delegate to tools.registry.register()."""
    from tools.registry import registry
    registry.register(
        name=name, toolset=toolset, schema=schema, handler=handler,
        check_fn=check_fn, requires_env=requires_env, ...
    )
    self.tools_registered.append(name)
```

**插件侧示例**（`.research/13-plugins.md §4.1`）:

```python
def _my_tool_handler(args, **kwargs):
    api_key = os.getenv("MY_API_KEY")
    # ... do something ...
    return json.dumps({"success": True})

def register(ctx):
    ctx.register_tool(
        name="my_tool",
        toolset="my-plugin",
        schema={...},
        handler=_my_tool_handler,
        check_fn=lambda: bool(os.getenv("MY_API_KEY")),
    )
```

**特点**：
- Plugin 可以**动态注册新工具**（不改源码）
- `check_fn` gate 允许条件启用（例如仅当 env var 存在）
- 工具由 registry 统一管理（见 `09-tools-system-gap.md`）

**EvoClaw**（`packages/core/src/context/plugins/tool-registry.ts`）— **无工具注册**，用 Skills 系统:

```typescript
// ToolRegistry 插件的职责是**注入** Skill 指令，不是**注册工具**
export function createToolRegistryPlugin(options: ToolRegistryOptions): ContextPlugin {
  return {
    name: 'tool-registry',
    priority: 60,
    
    async beforeTurn(ctx: TurnContext) {
      // 扫描 Skills，生成 <available_skills> XML 注入 system prompt
      const skills = await loadSkills(ctx.agentId, options);
      const skillIndex = generateSkillIndex(skills);
      ctx.injectedContext.push(`<available_skills>\n${skillIndex}\n</available_skills>`);
    },
  };
}
```

**关键差异**：
- hermes **工具注册** —— plugin 添加新的 LLM-callable function
- EvoClaw **Skill 注入** —— plugin 添加 AI-readable 指导文档（Skills），LLM 用已有工具（read/write/bash）按指导执行

**评论**（CLAUDE.md）：EvoClaw 的 Skill 系统是**"渐进式两级注入"**（Tier 1 = 目录、Tier 2 = 按需加载完整 SKILL.md），而非直接注册新工具。这是**设计选择**，而非遗漏。

**判定 🟡**：
- ✅ EvoClaw Skills 系统与 hermes tools 系统**功能等价**（都是扩展 LLM 的能力）
- ❌ EvoClaw **无第三方工具注册机制**（Skills 系统是文件驱动，不是代码驱动）
- ❌ plugin 无法动态注册条件工具（如 `check_fn` gate）

**后果**：复杂的工具逻辑（需条件判断、跨会话状态）无法以 Skill 形式表达。

---

### §3.7 CLI 子命令注册

**hermes**（`.research/13-plugins.md §3.5`）— Plugin CLI 一等公民:

```python
# PluginContext
def register_cli_command(
    self, name: str, help: str, setup_fn: Callable,
    handler_fn: Callable | None = None, description: str = "",
) -> None:
    """Register 'hermes <name> ...' subcommand."""
    self._manager._cli_commands[name] = {
        "name": name, "help": help, "description": description,
        "setup_fn": setup_fn,      # 配置 argparse
        "handler_fn": handler_fn,  # 实际执行
        "plugin": self.manifest.name,
    }
```

**插件侧**（例如 `plugins/memory/honcho/cli.py`）:

```python
def register_cli(subparser):
    """Configure argparse subparser."""
    subparser.add_argument("--api-key", help="Override API key")
    subparser.add_argument("--test", action="store_true")

def honcho_command(args):
    """Handler for 'hermes honcho ...'"""
    if args.test:
        test_connection(args.api_key)

# __init__.py
def register(ctx):
    ctx.register_memory_provider(HonchoMemoryProvider())
    ctx.register_cli_command(
        name="honcho",
        help="Honcho memory provider CLI",
        setup_fn=_cli.register_cli,
        handler_fn=_cli.honcho_command,
    )
```

**CLI dispatch**（`hermes_cli/main.py`）:

```python
for name, info in plugin_manager.cli_commands.items():
    subparser = subparsers.add_parser(name, help=info["help"])
    info["setup_fn"](subparser)
    subparser.set_defaults(func=info["handler_fn"])
```

**用户体验**：`hermes honcho --help` 自动显示 plugin 的 CLI 帮助。

**EvoClaw** — **无 CLI plugin 扩展点**:

- EvoClaw 是 Tauri App（GUI 优先），无主动 CLI
- `packages/core/src/routes/` 只有 HTTP 路由，无 plugin command 扩展
- Plugin 无法注册新的 slash 命令（相对 hermes `hermes <plugin> ...` 的概念）

**判定 🔴**：
- ❌ EvoClaw 无 CLI plugin 扩展点
- ⚠️ 可能不是劣势 —— EvoClaw 定位是 GUI App，CLI 功能由 Agent 内的 slash 命令（如 `/remember`）提供，而非外部 CLI

---

### §3.8 Env var 交互收集

**hermes**（`.research/13-plugins.md §3.3`）— 两种 manifest 格式 + 交互式收集:

```yaml
# 简单列表（向后兼容）
requires_env:
  - MY_API_KEY
  - MY_SECRET

# 富元数据
requires_env:
  - name: MY_API_KEY
    description: "API key for Acme service"
    url: "https://acme.com/keys"
    secret: true
```

**收集流程**（`plugins_cmd.py:459-497`）:

```python
def _prompt_env_vars(requires_env: List) -> None:
    missing = [e for e in normalized if e["name"] not in os.environ]
    if not missing:
        return
    
    for entry in missing:
        name = entry["name"]
        description = entry.get("description", "")
        url = entry.get("url", "")
        secret = entry.get("secret", False)
        
        prompt = "Enter value (or press Enter to skip): "
        if secret:
            value = getpass.getpass(prompt)  # 密码输入，不显示
        else:
            value = input(prompt)
        
        if value:
            save_env_value(name, value)       # 写 ~/.hermes/.env
            os.environ[name] = value          # 立即生效
```

**特点**：
- **manifest 驱动** —— plugin 声明需要的 env var
- **secret 安全输入** —— 用 getpass 而非 input
- **URL 指引** —— 告诉用户去哪里获取 key
- **持久化到 ~/.hermes/.env** —— 下次启动自动加载

**EvoClaw** — **无对应机制**:

- Extension pack 机制（`evoclaw-pack.json`）有 metadata（name/version/description），但**无 env var 处理**
- Plugin 配置（如需要 API key）由**用户手动**写入 `~/.evoclaw/config/` YAML 或环境变量
- 无 manifest 驱动的交互式收集

**判定 🔴**：
- ❌ EvoClaw 无 env var 交互收集机制
- ❌ 用户体验差 —— 必须手动编辑配置文件或导出环境变量

**影响**：企业安装流程更复杂（用户不知道 plugin 需要哪些 env var）。

---

### §3.9 插件隔离与错误处理

**hermes**（`.research/13-plugins.md §3.2, §3.4`）— 异常隔离设计:

```python
# _try_load_directory (L368-414)
try:
    spec = importlib.util.spec_from_file_location(f"hermes_plugins.{manifest.name}", ...)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # 可能抛异常
except Exception as e:
    loaded = LoadedPlugin(manifest=manifest, error=str(e))
    self._loaded.append(loaded)
    return

# invoke_hook (L468-515)
def invoke_hook(hook_name: str, **kwargs) -> List[Any]:
    callbacks = _manager._hooks.get(hook_name, [])
    results = []
    for cb in callbacks:
        try:
            result = cb(**kwargs)
            if result is not None:
                results.append(result)
        except Exception as e:
            logger.warning("Plugin hook %s callback failed: %s", hook_name, e, exc_info=True)
    return results
```

**关键设计**：
- **加载隔离** —— 一个 plugin 加载失败，其它 plugin 继续加载；失败信息存在 `LoadedPlugin.error`
- **执行隔离** —— hook 回调执行失败，catch 并 log，不向上抛；不影响其它 callback
- **错误可见** —— `hermes plugins list` 显示 disabled/error 状态

**EvoClaw**（`packages/core/src/agent/kernel/query-loop.ts:360-380`）— 插件**同进程紧耦合**:

```typescript
const plugins: ContextPlugin[] = [
  createContextAssemblerPlugin(...),
  // ... 10 个插件
];

for (const plugin of plugins.sort((a, b) => a.priority - b.priority)) {
  await plugin.bootstrap?.({ ... });  // 无 try/catch
}

for (const plugin of plugins) {
  await plugin.beforeTurn?.({ ... });  // 无 try/catch
}
```

**问题**：
- ❌ 无 try/catch —— 一个 plugin hook 抛异常，整个 agent 循环中断
- ❌ 无加载隔离 —— plugin 静态编译，加载失败 = 程序启动失败
- ❌ 无禁用机制 —— 无法通过配置关闭出问题的 plugin

**判定 🟡**：
- ✅ 类型安全 / 编译时检查 —— 类似 hermes 的 entrypoint 插件
- ❌ 运行时灵活性差 —— 无动态加载/禁用/恢复的能力

**改进建议**（见 §4）：为 beforeTurn/afterTurn 添加 try/catch；新增 plugin 禁用机制。

---

### §3.10 插件禁用/管理

**hermes**（`.research/13-plugins.md §3.6, §3.3`）— 禁用列表 + CLI 管理:

```yaml
# config.yaml
plugins:
  disabled:
    - experimental-plugin
    - broken-plugin
```

**加载检查**（`plugins.py:78-91, 368-414`）:

```python
def _get_disabled_plugins() -> Set[str]:
    config = load_hermes_config()
    return set(config.get("plugins", {}).get("disabled", []) or [])

def _try_load_directory(self, plugin_dir: Path, source: str) -> None:
    manifest = self._parse_manifest(...)
    
    if manifest.name in self._disabled:
        loaded = LoadedPlugin(manifest=manifest, enabled=False)
        self._loaded.append(loaded)
        return  # 不加载
```

**CLI 管理**（`plugins_cmd.py:464-488`）:

```bash
hermes plugins disable <name>      # 添加到禁用列表
hermes plugins enable <name>       # 从禁用列表移除
hermes plugins list                # 显示状态（active/disabled/error）
hermes plugins                     # 交互式 toggle（curses checklist）
```

**特点**：
- **持久化禁用** —— 写入 config.yaml，下次启动仍生效
- **原子操作** —— disable/enable 直接修改禁用集合，无需重启
- **可见性** —— list 显示每个 plugin 的状态

**EvoClaw** — **无禁用机制**:

- Plugin 是硬编码的（10 个内置 plugin）
- 无 `config.yaml` 的 `plugins.disabled` 字段
- 无 CLI/API 禁用 plugin 的方法
- 无法通过配置"关闭"出问题的 plugin

**判定 🔴**：
- ❌ EvoClaw 无 plugin 禁用机制
- ❌ 无法热修复（必须改代码 + 重新编译）

**影响**：企业测试新 plugin 时，出问题无法快速禁用；必须 git revert + rebuild。

---

### §3.11 Enterprise Extension Pack（独有）

**hermes** — **无 Extension Pack 概念**。Plugin 由用户逐个 install（`hermes plugins install owner/repo`），无法一次性安装整套企业级能力（Skills + MCP + 安全策略）。

**EvoClaw**（`packages/core/src/extension-pack/` + `packages/shared/src/types/extension-pack.ts`）— **独有设计**：

```typescript
// evoclaw-pack.json 示例
{
  "name": "enterprise-ai-pack",
  "version": "1.0.0",
  "description": "Enterprise AI capabilities bundle",
  "author": "Acme Corp",
  
  // Skills 打包
  "skills": [
    {
      "name": "custom-analysis",
      "version": "1.0.0",
      "path": "skills/custom-analysis"
    }
  ],
  
  // MCP Servers 打包
  "mcp_servers": [
    {
      "name": "private-knowledge",
      "type": "stdio",
      "command": "python",
      "args": ["-m", "mcp_private_knowledge"]
    }
  ],
  
  // 安全策略（与 Skills 绑定）
  "security_policies": {
    "custom-analysis": {
      "readonly": false,
      "allowed_paths": ["/data/customer/*"],
      "forbidden_patterns": ["rm -rf"]
    }
  }
}
```

**流程**（`pack-installer.ts + pack-parser.ts`）:

1. 解压 ZIP → 验证 manifest
2. 扫描 skills 目录 → 安装到 `~/.evoclaw/skills/`
3. 注册 MCP servers → 启动连接
4. 应用安全策略 → 写入 `security.json`

**关键优势**：
- **一键部署** —— 整套企业能力（Skills + MCP + 策略）一次安装
- **版本管理** —— manifest 声明版本，可追踪升级历史
- **安全策略合一** —— Skills 和它们的权限策略打包一起，防止权限泄露

**hermes 缺失** —— 需用户分别：
1. `hermes plugins install org/skills-plugin`
2. 手动配置 MCP servers（`~/.hermes/mcp_servers.json`）
3. 手动设置安全策略（`~/.hermes/security.yaml`）

**判定 🟢 反超**：
- ✅ EvoClaw Extension Pack 是**企业级最佳实践**（整体部署 > 零散安装）
- ✅ 安全策略与能力绑定 —— 防止错误配置
- 🟡 hermes 可以学习这个模式，将 plugin + tool registry + MCP 打包成一个 "bundle"

---

### §3.12 MCP 作为插件机制（独有）

**hermes**（`.research/21-mcp.md` Phase C3）— MCP 作为**独立子系统**:
- `mcp_serve.py` 暴露 hermes 能力给 MCP 客户端
- MCP Server 通过 `tools/mcp_tool.py:discover_mcp_tools()` 动态发现工具
- 工具注册到 `tools.registry`，与内置工具混在一起

**EvoClaw**（`packages/core/src/mcp/mcp-client.ts` + `packages/core/src/mcp/mcp-tool-bridge.ts`）— **MCP 是原生 ContextPlugin**:

```typescript
// mcp-client.ts:47-100
export class McpClient {
  async start(): Promise<void> {
    // 创建传输（stdio / SSE）
    let transport = this.config.type === 'stdio'
      ? new StdioClientTransport({ command: this.config.command, args: this.config.args })
      : new StreamableHTTPClientTransport(new URL(this.config.url));
    
    // 连接并发现工具 + prompts
    this.client = new Client({ name: 'evoclaw', version: '1.0.0' }, { capabilities: {} });
    await this.client.connect(transport);
    await this.refreshTools();
  }
  
  get tools(): ReadonlyArray<McpToolInfo> { return this._tools; }
}

// mcp-tool-bridge.ts
export function createMcpBridgePlugin(clients: McpClient[]): ContextPlugin {
  return {
    name: 'mcp-bridge',
    priority: 70,
    
    async beforeTurn(ctx: TurnContext) {
      // 动态注入 MCP 工具到 system prompt
      for (const client of clients) {
        const tools = client.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
          hints: { destructive: t.destructiveHint, ... }
        }));
        ctx.injectedContext.push(formatToolsForPrompt(tools));
      }
    },
    
    async afterTurn(ctx: TurnContext) {
      // 工具结果收集后，同步到 MCP（如需）
    },
  };
}
```

**架构集成**（`query-loop.ts`）:

```typescript
// MCP clients 通过 config 传入
const mcpClients = [
  new McpClient({ name: 'knowledge-base', type: 'stdio', command: 'python', args: [...] }),
  new McpClient({ name: 'slack-api', type: 'sse', url: 'http://localhost:3000/mcp' }),
];

const plugins = [
  // ... 10 个内置
  createMcpBridgePlugin(mcpClients),  // MCP 作为插件集成
];
```

**关键优势**：
- **一级公民** —— MCP 工具与内置工具**平等对待**（都通过 prompt 注入）
- **动态发现** —— 每轮对话前刷新 MCP 工具列表（支持热加载）
- **Prompt 注入** —— MCP 工具信息通过 `injectedContext` 混入，无需改 system prompt
- **生命周期管理** —— bootstrap 启动 MCP clients，shutdown 清理连接

**hermes 对比** —— MCP 和 plugin 是**平行的扩展机制**，不互相感知：
- Plugin hooks 在主循环
- MCP 工具在 tools registry
- 两套系统独立维护

**判定 🟢 反超**：
- ✅ EvoClaw MCP 集成更**深** —— 作为 plugin 框架的一部分
- ✅ 动态注入 + 一键启动 —— 用户只需配置 MCP server URL/command，自动发现工具
- 🟡 hermes 的平行设计也有优点 —— plugin 和 MCP 职责分离，各自独立

---

## 4. 建议改造蓝图（不承诺实施）

### P0（高 ROI，建议尽快）

| # | 项目 | 对应差距 | 工作量 | 价值 |
|---|---|---|---|---|
| 1 | 为 beforeTurn / afterTurn 添加异常隔离 | §3.9 | 0.5d | 一个 plugin 挂掉不影响整个 agent |
| 2 | Plugin 禁用机制 + CLI/API | §3.10 | 1d | 企业热修复 —— 禁用出问题 plugin 无需重启 |

### P1（中等 ROI）

| # | 项目 | 对应差距 | 工作量 | 价值 |
|---|---|---|---|---|
| 3 | Tool-level hooks (pre_tool_call / post_tool_call) | §3.3 | 1-2d | 工具调用监控、参数校验、结果审查 |
| 4 | API-level hooks (pre_api_request / post_api_request) | §3.3 | 1d | API 调用监控、retry 检测、成本统计 |
| 5 | 混合 Plugin Loader（支持 user/project/entrypoint） | §3.4 | 3-4d | 第三方 plugin 扩展能力，打破内置插件限制 |
| 6 | Memory Provider 注册点 | §3.5 | 2-3d | 支持多种 memory 后端（honcho / mem0 / custom graph DB） |
| 7 | Env var 交互收集 + manifest 驱动 | §3.8 | 1-2d | 企业安装流程优化（无需手动编辑配置） |

### P2（长期规划）

| # | 项目 | 对应差距 | 工作量 |
|---|---|---|---|
| 8 | CLI plugin 扩展点（slash 命令） | §3.7 | 1-2d |
| 9 | Session 生命周期 hook (on_session_reset, on_session_finalize) | §3.2 | 0.5d |

### 不建议做

| # | 项目 | 理由 |
|---|---|---|
| — | 完全模仿 hermes 脚本式 plugin | EvoClaw 类型安全优势不应放弃；建议"混合模式"而非完全替代 |
| — | 让所有 plugin 都可替换（如 context-assembler） | 核心插件（context-assembler / memory-recall）应保持内置；只支持扩展性插件的第三方注册 |

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应 |
|---|---|---|---|
| 1 | Extension Pack — 一次性部署整套企业能力（Skills + MCP + 策略） | `packages/core/src/extension-pack/pack-parser.ts` + `evoclaw-pack.json` | 无（需用户逐个 install plugin） |
| 2 | MCP 作为原生 ContextPlugin — 动态发现 + 一键启动 | `packages/core/src/mcp/mcp-client.ts` + `mcp-tool-bridge.ts` | MCP 是独立子系统，与 plugin 平行 |
| 3 | ContextPlugin 类型安全 + priority 排序 | `packages/core/src/context/plugin.interface.ts` | 脚本式 + 动态 import，无类型检查 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用（本章所有路径均经 Read 工具验证 2026-04-16）

- `packages/core/src/context/plugin.interface.ts:62-78` ✅ ContextPlugin 接口定义（5 hooks）
- `packages/core/src/context/plugins/` ✅ 12 个插件文件列表（session-router / rag / evolution / ... / context-assembler）
- `packages/core/src/context/plugins/tool-registry.ts:1-80` ✅ ToolRegistry 插件（Skill 注入，priority 60）
- `packages/core/src/context/plugins/memory-recall.ts:1-60` ✅ MemoryRecall 插件（hybrid search，priority 40）
- `packages/core/src/mcp/mcp-client.ts:1-100` ✅ MCP 客户端（stdio + SSE 传输）
- `packages/core/src/mcp/mcp-tool-bridge.ts` ✅ MCP 作为 ContextPlugin（beforeTurn 注入）
- `packages/shared/src/types/extension-pack.ts:1-55` ✅ Extension Pack 类型定义（manifest / install result）
- `packages/core/src/extension-pack/pack-parser.ts:1-80` ✅ 解压 + manifest 校验 + 安全检查

### 6.2 hermes 研究引用（章节 §）

- `.research/13-plugins.md` §1 — 插件系统定位（5 个扩展能力）
- `.research/13-plugins.md` §2 — 三源发现流程图（mermaid）
- `.research/13-plugins.md` §3.1-3.2 — `VALID_HOOKS` 10 种、PluginManifest 结构、discover_and_load 三源扫描
- `.research/13-plugins.md` §3.2 — PluginContext 4 个 register_* 方法
- `.research/13-plugins.md` §3.4 — invoke_hook 异常隔离 + 返回值收集
- `.research/13-plugins.md` §3.5 — CLI 子命令注册 + dispatch
- `.research/13-plugins.md` §3.3 — Env var 交互收集（富元数据 + secret getpass）
- `.research/13-plugins.md` §3.6 — 禁用列表 + `config.yaml:plugins.disabled`
- `.research/21-mcp.md`（Phase C3）— MCP 独立子系统（非本文，待完成）

### 6.3 关联 gap 章节（crosslink）

本章涉及的相关系统，详见：

- [`03-architecture-gap.md`](./03-architecture-gap.md) §3.13 — **ContextPlugin 5-hook 生命周期 + 10 个插件**作为架构级设计反超
- [`05-agent-loop-gap.md`](./05-agent-loop-gap.md) §3.12 — Stop Hook + Tombstone（EvoClaw post-hook 设计）
- [`09-tools-system-gap.md`](./09-tools-system-gap.md) (Wave 2 W2-1) — hermes tools.registry vs EvoClaw Skill system
- [`10-toolsets-gap.md`](./10-toolsets-gap.md) (Wave 2 W2-1) — Toolset 组合与 Skill 注入关系
- [`12-skills-system-gap.md`](./12-skills-system-gap.md) (Wave 2 W2-3) — 完整 Skill 系统对比
- [`15-memory-providers-gap.md`](./15-memory-providers-gap.md) — Memory Provider 扩展点（hermes 有、EvoClaw 缺）
- [`21-mcp-gap.md`](./21-mcp-gap.md) (Wave 2 W2-4) — MCP 客户端集成（EvoClaw 原生 vs hermes 独立）
- [`29-security-approval-gap.md`](./29-security-approval-gap.md) (Wave 2 W2-10) — Extension Pack 安全策略验证

---

**本章完成**。

### 小结

**差距分布**：🔴 4 / 🟡 6 / 🟢 2

**综合判定** 🟡 **部分覆盖，形态差异显著**：

- **EvoClaw 优势**（反超 2 项）：
  1. **Extension Pack** —— 企业级一键部署整套能力（Skills + MCP + 策略），hermes 无对应
  2. **MCP 原生集成** —— MCP 作为 ContextPlugin，动态发现 + 自动注入，比 hermes 的平行设计更紧密
  3. **类型安全** —— 接口化 plugin，编译时检查，比脚本式更可靠

- **EvoClaw 劣势**（缺失 🔴 4 项）：
  1. 无第三方 plugin 扩展（所有 plugin 硬编码）
  2. 无 memory provider 注册点（memory 不可替换）
  3. 无工具注册（与 Skill 系统耦合）
  4. 无 CLI 子命令扩展
  5. 无 env var 交互收集
  6. 无 plugin 禁用机制

- **形态差异**（🟡 6 项）：
  1. Hook 生命周期：hermes 10 种（工具/LLM/API/会话） vs EvoClaw 5 种（引导/轮次/压缩/终止/关闭）—— 各有取向
  2. Plugin 发现：hermes 三源动态 vs EvoClaw 硬编码 10 个 —— 灵活性 vs 可维护性的权衡
  3. 工具系统：hermes `register_tool()` vs EvoClaw Skill 注入 —— 功能等价但实现不同

**改造建议**（P0/P1 见 §4）：
- P0：异常隔离（0.5d）+ 禁用机制（1d）
- P1：Tool/API-level hooks（2-3d）+ Plugin loader（3-4d）+ Memory provider（2-3d）+ Env var 收集（1-2d）

**最后建议**：EvoClaw 的 Extension Pack + MCP 集成是**企业级最佳实践**，hermes 可以学习这个模式。同时，EvoClaw 应补齐"第三方 plugin 扩展"能力（混合模式：硬编码内置 plugin + 支持 user/project/entrypoint），以达到 hermes 的灵活性。
