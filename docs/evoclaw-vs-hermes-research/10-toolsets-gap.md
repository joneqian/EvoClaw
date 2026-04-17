# 10 — Toolsets 组合与分发 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/10-toolsets.md`（811 行，41 个 toolset + 17 个分布）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），toolsets.py + toolset_distributions.py 完整系统
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），packages/core/src/agent/tool-catalog.ts + context/plugins/tool-registry.ts + mcp/
> **综合判定**: 🟡 **部分覆盖，形态差异**（tool profile 思路新颖，但缺 toolset 组合、分发、分布层）

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 机制或流程完全缺失，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes 工具集合系统**（`.research/10-toolsets.md § 整体`）— **41 个 toolset + 17 个分布**的两层组织：

```
Layer 1: TOOLSETS dict (41 个)
├─ 20 个基础 toolset (web, search, vision, terminal, ... 叶子)
├─ 2 个复合 toolset (debugging, safe — 包含其它 toolset)
├─ 15 个平台 toolset (hermes-telegram, discord, slack, ... 复用 _HERMES_CORE_TOOLS)
└─ 4 个特殊 toolset (hermes-cli, hermes-acp, hermes-api-server, hermes-gateway)

Layer 2: DISTRIBUTIONS dict (17 个)
├─ 14 个训练分布 (default, research, science, safe, browser_use, ...)
└─ 3 个数据集分布 (browser_tasks, terminal_tasks, mixed_tasks)
   → 每个分布 = toolset 名 → 概率 (0-100, 独立投骰)
```

**关键特点**：
- `resolve_toolset(name)` 递归展开（含菱形去重）
- `sample_toolsets_from_distribution(name)` 独立采样多个 toolset
- `AIAgent(enabled_toolsets=[], disabled_toolsets=[])` 三分支互斥逻辑
- `execute_code` 动态 schema 重建（基于可用沙箱工具）
- `browser_navigate` description 动态裁剪（移除不可用工具的引用）
- 所有 hermes 平台共享同一套 37 核心工具（`_HERMES_CORE_TOOLS`）

**EvoClaw 工具目录系统**（`packages/core/src/agent/tool-catalog.ts:18-118` + `context/plugins/tool-registry.ts`）— **静态清单 + Profile + MCP/Skill 动态注入**：

```
Layer 1: CORE_TOOLS 静态清单 (59 条元数据)
├─ fs (read, write, edit, apply_patch)
├─ runtime (bash, exec_background, process)
├─ web (web_search, web_fetch, browser)
├─ memory (memory_search/get/write/update/delete/pin, knowledge_query)
├─ agent (spawn_agent, list_agents, kill_agent, steer_agent, yield_agents, todo_write)
├─ media (image, pdf, image_generate)
└─ channel (桌面通知、飞书、企微、微信 — 动态按 session 注入)

Layer 2: TOOL_PROFILES (4 个)
└─ minimal / coding / messaging / full
   → 每个 profile = 允许的工具 ID allowlist (null = 允许所有)

Layer 3: 动态注入层（Context Plugin + MCP Bridge）
├─ ToolRegistry Plugin (beforeTurn)
│  ├─ 扫描 ~/tools / ~/agents/{id}/workspace/tools 的技能目录
│  ├─ 按 gate + disableModelInvocation + Agent 禁用过滤
│  ├─ Tier 1 (目录) / Tier 2 (按需 read 完整 SKILL.md)
│  └─ Bundled 技能享有预算豁免权
└─ MCP Tool Bridge (mcp-tool-bridge.ts)
   └─ MCP 工具转为 EvoClaw ToolDefinition (mcp_serverName_toolName 命名)
```

**量级对比**：
- hermes: 41 toolset + 17 分布 + toolset 递归解析 + 分布采样
- EvoClaw: 59 CORE_TOOLS meta + 4 profile + Skills Tier 1/2 + MCP 工具桥接

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | Toolset 单元定义（工具组 + 启用条件） | 🔴 | EvoClaw 无 toolset 抽象，只有静态清单 + profile |
| §3.2 | 工具注入 5 阶段划分（hermes CLAUDE.md 声称） | 🟡 | EvoClaw 隐含分阶段但无显式命名 |
| §3.3 | 工具作用域（全局/per-agent/per-channel/per-session） | 🟡 | EvoClaw per-session 粒度较细，缺 per-agent 全局控制 |
| §3.4 | 条件启用机制（Feature flag / profile / channel binding） | 🟢 | EvoClaw Profile + NameSecurityPolicy 更灵活 |
| §3.5 | 工具 ID 命名空间（kernel: / mcp: / channel: / skill:） | 🟢 | **反超**：mcp_serverName_toolName 规范清晰 |
| §3.6 | Builtin vs Enhanced（内核文件工具 vs web/vision/pdf） | 🟡 | 都有两层，EvoClaw 分布更均衡 |
| §3.7 | Channel-specific tools（平台工具注入） | 🟡 | hermes 15 平台 toolset，EvoClaw channel 动态注入 |
| §3.8 | MCP server → tool 转换 + 冲突检测 | 🟢 | **反超**：explicit conflict detection + naming policy |
| §3.9 | Skills → 工具引导（Tier 1 目录 vs Tier 2 详情） | 🟢 | **反超**：EvoClaw 的两级注入 + 预算豁免机制 |
| §3.10 | 工具 allowlist / denylist（NameSecurityPolicy） | 🟢 | **反超**：EvoClaw 的统一扩展安全策略 |
| §3.11 | 工具可见度对 LLM 的影响（目录注入 vs 按需加载） | 🟡 | EvoClaw shouldDefer + searchHint 更细，但缺 Tier 1 预告 |
| §3.12 | Toolset 分布采样（训练数据多样化） | 🔴 | EvoClaw 无分布概念，不支持多样化采样 |
| §3.13 | 执行时工具动态校正（execute_code / browser_navigate） | 🟡 | hermes 详尽，EvoClaw 无对应 |
| §3.14 | 工具注册注入的五个阶段 | 🟡 | EvoClaw 隐含but未显式文档化 |

**统计**: 🔴 2 / 🟡 8 / 🟢 4。

---

## 3. 机制逐条深度对比

### §3.1 Toolset 单元定义

**hermes**（`.research/10-toolsets.md §2.2` + `toolsets.py:129-183`）：

```python
TOOLSETS = {
    "web": {
        "description": "Web research and content extraction tools",
        "tools": ["web_search", "web_extract"],
        "includes": [],                          # 可包含其它 toolset
    },
    "debugging": {
        "description": "Debugging and troubleshooting toolkit",
        "tools": ["terminal", "process"],
        "includes": ["web", "file"],             # 递归包含
    },
}
```

**定义方式**：每个 toolset = `{description: str, tools: List[str], includes: List[str]}`，支持递归包含，菱形去重。

**EvoClaw**（`tool-catalog.ts:78-118` + `context/plugins/tool-registry.ts`）：

```typescript
// 没有 Toolset 抽象，只有静态清单
export const CORE_TOOLS: readonly CoreToolMeta[] = [
  { id: 'read', section: 'fs', label: '读取', description: '...' },
  // ... 59 条元数据
];

// Profile 机制（按场景预配置）
export const TOOL_PROFILES: Record<ToolProfileId, readonly string[] | null> = {
  minimal: ['read', 'ls', 'find', 'grep'],
  coding: ['read', 'write', 'edit', 'apply_patch', 'bash', ...],  // 24 条
  messaging: ['read', 'memory_search', ...],                        // 12 条
  full: null,                                                       // null = 允许所有
};
```

**判定 🔴**：EvoClaw **无 toolset 抽象**。当前用 CORE_TOOLS 元数据 + TOOL_PROFILES 简单列表替代：
- 无递归 include 机制 → 新增 profile 需手工列举所有工具
- 无组合复用 → 若想"web + file + vision"组合，需新建 profile
- 无平台特化 → 无"hermes-telegram"vs"hermes-slack"差异化表达
- Profile 仅在调用方（CLI/API）指定，运行时无法查询、编辑、保存

**与 §3.2-§3.7 的关系**：toolset 缺失导致后续的分发、条件启用等机制都需重新设计。

---

### §3.2 工具注入 5 阶段划分（CLAUDE.md 声明）

**hermes**（文档无明确 5 阶段描述，但代码体现）：

1. **Kernel builtin** —— AIAgent `__init__` 时加载 37 核心工具
2. **Provider-specific** —— 按 `enabled_toolsets / disabled_toolsets` 过滤
3. **MCP tools** —— `run_agent.py:1093` 后收听 MCP 通知，动态注册
4. **Batch runner** —— `batch_runner.py` 按 distribution 采样 toolset
5. **Session/Agent 级** —— 无显式二级控制（CLI 级别可设置，Agent 级别仅继承）

**EvoClaw**（`CLAUDE.md:48-108` 声明 5 阶段）：

```
Phase 1: Kernel builtin (read/write/edit/bash/grep/find/ls)
Phase 2: Enhanced bash (exec_background, process, streaming-tool-executor)
Phase 3: EvoClaw-specific (memory, web_search, web_fetch, todo, knowledge_graph)
Phase 4: Channel tools (desktop_notify, feishu_send, weixin_send, ...)
Phase 5: MCP + Skills (MCP server tools + skill SKILL.md 加载)
```

**实现**：
- Phase 1-3: `createEvoClawTools` 返回 ToolDefinition[]（`tools/evoclaw-tools.ts:31-44`）
- Phase 4: Channel 层通过 session context 注入（`tools/channel-tools.ts`）
- Phase 5: ToolRegistry plugin (beforeTurn) 注入 + MCP tool bridge（`mcp/mcp-tool-bridge.ts`）

**判定 🟡**：
- EvoClaw **有隐含的 5 阶段**（见 CLAUDE.md），但在主循环代码中**无显式标记**（没有 phase 枚举、没有 stage 注释）
- hermes 在 `AIAgent.__init__` → `get_tool_definitions` → `registry.get_definitions` 的链路中隐含完成
- EvoClaw 用 plugin 链式调用更模块化，但**缺统一的阶段命名和文档**
- 实际差异：hermes all-at-once，EvoClaw plugin-chained（取向不同，功能对等）

---

### §3.3 工具作用域（全局 / per-agent / per-channel / per-session）

**hermes**（`.research/10-toolsets.md §2.1` + `run_agent.py:659-660, 894-912`）：

```python
class AIAgent:
    def __init__(self, ..., enabled_toolsets=None, disabled_toolsets=None):
        self.enabled_toolsets = enabled_toolsets      # Agent 级
        self.disabled_toolsets = disabled_toolsets
        self.tools = get_tool_definitions(...)         # 继承到本 Agent 所有调用
```

**作用域**：Agent 级（`AIAgent` 实例固定），所有 session/turn 继承。平台级（CLI `--toolsets telegram` 选项）也存在。

**EvoClaw**（`agent/kernel/query-loop.ts:416` + `context/plugins/tool-registry.ts:117-150`）：

```typescript
// StreamingToolExecutor 接收工具列表（per-turn）
const executor = new StreamingToolExecutor(config.tools, 8, config.abortSignal);

// ToolRegistry plugin 在 beforeTurn 时注入
async beforeTurn(ctx: TurnContext) {
  let skills = skillCache.get(ctx.agentId);          // per-agent 缓存
  // 按 ctx.agentId + channel + session 过滤
  const disabledSet = opts.getDisabledSkills?.(ctx.agentId);
}
```

**作用域**：
- **per-turn 粒度**：`StreamingToolExecutor(config.tools)` 每轮重建
- **per-agent 粒度**：Skill 缓存 `skillCache.get(agentId)` + `getDisabledSkills(agentId)`
- **per-channel 粒度**：无（channel tools 通过 session context 注入，不区分 channel）
- **per-session 粒度**：隐含（ToolRegistry beforeTurn 中 `TurnContext.sessionKey` 可用但未用）

**判定 🟡**：
- hermes 粗粒度（Agent 级固定）vs EvoClaw 细粒度（per-turn + per-agent + per-session）
- EvoClaw **缺 per-channel 全局配置**（例如"Slack 永不给 terminal 工具"）
- EvoClaw **缺 per-agent 全局作用域**（skill 是 per-agent 的，但 kernel 工具无法 per-agent 改）

---

### §3.4 条件启用机制（Feature flag / profile / channel binding）

**hermes**（`toolsets.py:535-551` + `model_tools.py:204-227, 234-353`）：

```python
# 分支 A: enabled_toolsets is not None
if enabled_toolsets is not None:
    for ts in enabled_toolsets:
        if validate_toolset(ts):
            tools_to_include.update(resolve_toolset(ts))
        elif ts in _LEGACY_TOOLSET_MAP:                    # 兼容旧名称
            tools_to_include.update(_LEGACY_TOOLSET_MAP[ts])
    # ⚠️  disabled_toolsets 在此分支被完全忽略！

# 分支 B: only disabled_toolsets
elif disabled_toolsets:
    # 先收集所有工具，再扣掉 disabled

# 分支 C: 两者都为空
else:
    # 默认全部工具
```

**特点**：互斥分支（enabled 优先级最高），支持 legacy toolset 名称兼容。

**EvoClaw**（`tool-catalog.ts:107-117` + `context/plugins/tool-registry.ts:142-149`）：

```typescript
// Profile 过滤
export function filterToolsByProfile<T extends { name: string }>(tools: T[], profile: ToolProfileId): T[] {
  const allowList = TOOL_PROFILES[profile];
  if (!allowList) return tools;   // full profile = 不过滤
  return tools.filter(t => allowSet.has(t.name));
}

// NameSecurityPolicy（IT 管理员白名单/黑名单）
if (opts.securityPolicy) {
  const { allowed, denied } = filterByPolicy(activeSkills, s => s.name, opts.securityPolicy);
  if (denied.length > 0) {
    log.warn(`拦截 ${denied.length} 个技能`);
  }
  activeSkills = allowed;
}
```

**特点**：
- Profile 是调用方选择（CLI / API 初始化时）
- NameSecurityPolicy 是 IT 后置审计（可单独配置白名单/黑名单）
- **两层过滤**（Profile allowlist + Security policy），而非互斥分支

**判定 🟢 反超**：
- hermes 的三分支互斥比较生硬（enabled 和 disabled 不能共存）
- EvoClaw 的 Profile + NameSecurityPolicy **两层次**更灵活：
  - Profile = 场景预设（coding/messaging/full）
  - NameSecurityPolicy = IT 审计层（超出 Profile 的额外约束）
- EvoClaw 支持 MCP prompt 技能合并（低优先级，同名本地覆盖）

---

### §3.5 工具 ID 命名空间（kernel: / mcp: / channel: / skill:）

**hermes**（无显式命名空间，工具名扁平）：

```python
# tools/registry.py:290
registry = ToolRegistry()   # 模块级全局

# 所有工具名直接注册，无前缀
registry.register("web_search", ...)
registry.register("read_file", ...)
# 若两个 MCP server 都提供 "run_shell"，冲突
```

**冲突检测**：无（文档也没提到处理冲突策略）。

**EvoClaw**（`mcp/mcp-tool-bridge.ts:36-70`）：

```typescript
// 工具命名规范：mcp_<serverName>_<toolName>
export function mcpToolToDefinition(mcpTool: McpToolInfo, manager: McpManager): ToolDefinition {
  const qualifiedName = `mcp_${mcpTool.serverName}_${mcpTool.name}`;
  
  return {
    name: qualifiedName,  // e.g. "mcp_brave_search_web"
    description: mcpTool.description ?? `MCP tool: ${mcpTool.name} (from ${mcpTool.serverName})`,
    // ...
  };
}

// 保留工具名检测
const RESERVED_TOOL_NAMES = new Set([
  'read', 'write', 'edit', 'bash', 'grep', 'find', 'ls',
  'web_search', 'web_fetch', 'image', 'pdf',
  'memory_search', 'spawn_agent', /* ... */
]);

// 冲突检测在 bridgeAllMcpTools 中
export function bridgeAllMcpTools(manager: McpManager, existingToolNames?: Set<string>): ToolDefinition[] {
  const allMcpTools = manager.getAllTools();
  return bridgeMcpToolList(allMcpTools, manager, existingToolNames);
  // existingToolNames 用于避免 MCP 工具与内置工具重名
}
```

**判定 🟢 反超**：EvoClaw 的 `mcp_<server>_<name>` 命名空间规范**显式清晰**：
- MCP 工具天然隔离（不同 server 的同名工具不冲突）
- RESERVED_TOOL_NAMES 白名单清晰（哪些名称被核心占用）
- `existingToolNames` 参数让调用方显式避免冲突
- 隐含其他命名空间（`channel_*`, `skill_*`）但代码中未见实现

---

### §3.6 Builtin vs Enhanced（内核 vs 增强工具）

**hermes**（`tools/registry.py` + `model_tools.py`）：

```
Builtin (由 hermes 核心提供，37 个):
  └─ file tools: read_file, write_file, patch, search_files
  └─ terminal: terminal, process, execute_code
  └─ vision: vision_analyze
  └─ web: web_search, web_extract

Enhanced (条件启用或依赖外部 API):
  └─ browser_*: 10 个浏览器工具（Playwright）
  └─ image_generate: DALL-E (需 API key)
  └─ tts / voice: TTS 工具
  └─ home_assistant: HA 集成
```

**划分标准**：是否需要外部 API key 或运行时环境。

**EvoClaw**（`packages/core/src/agent/kernel/builtin-tools.ts` + `tools/evoclaw-tools.ts`）：

```
Layer 1 - Kernel Builtin (Phase 1-2, 文件/运行时工具):
  └─ read, write, edit, bash, exec_background, process
  └─ grep, find, ls （未在 CORE_TOOLS 中？ 见源码注释）

Layer 2 - EvoClaw Specific (Phase 3, 增强工具):
  └─ web_search (需 Brave API key，可选）
  └─ web_fetch (无需 key)
  └─ browser (Playwright)
  └─ image / pdf / image_generate
  └─ memory_* + knowledge_query
  └─ todo_write
  └─ spawn_agent, list_agents, kill_agent, steer_agent, yield_agents

Layer 3 - Channel Tools (Phase 4):
  └─ desktop_notify, feishu_send, weixin_send, wecom_send, ...

Layer 4 - Skills + MCP (Phase 5):
  └─ .skill.md 文件 + MCP server 工具
```

**判定 🟡**：
- hermes 37 个 builtin + 扩展工具
- EvoClaw 59 CORE_TOOLS meta（包括 channel tools 占位符）+ 动态 skill + MCP
- **差异**：
  - EvoClaw 缺 grep/find/ls 在 CORE_TOOLS 中（可能在 builtin-tools.ts 中实现但未在目录里）
  - EvoClaw memory 工具是 Phase 3，hermes 无对标
  - EvoClaw channel tools 是 Phase 4（per-session 动态），hermes 是 15 个 toolset（静态）

---

### §3.7 Channel-specific tools（平台工具注入）

**hermes**（`.research/10-toolsets.md §2.2` + `toolsets.py:159-182`）：

```python
TOOLSETS = {
    "hermes-telegram": {
        "description": "Telegram messaging toolset",
        "tools": _HERMES_CORE_TOOLS,              # 37 个核心工具（复用）
        "includes": [],
    },
    "hermes-discord": {
        "description": "Discord messaging toolset",
        "tools": _HERMES_CORE_TOOLS,              # 同样 37 个
        "includes": [],
    },
    # ... 所有 15 个平台都用同一个 _HERMES_CORE_TOOLS
    
    "hermes-api-server": {
        "description": "REST API server",
        "tools": [                                 # 显式裁剪列表
            "web_search", "web_extract", "terminal", "process",
            "read_file", "write_file", "patch", "search_files",
            # ... (缺 text_to_speech, send_message, clarify)
        ],
        "includes": [],
    },
}
```

**特点**：15 个平台 toolset 共享 37 个核心工具；API server 和 ACP 是显式裁剪版本。

**EvoClaw**（`tools/channel-tools.ts` + `context/plugins/tool-registry.ts:122-135`）：

```typescript
// Channel tools 由 Channel Handler 动态注入
// 例如 feishu.ts 执行时，session context 中注入 feishu_send / feishu_card

// ToolRegistry plugin 的 MCP skill 合并（低优先级）
if (opts.mcpPromptsProvider) {
  const seen = new Set(skills.map(s => s.name));
  const mcpSkills = opts.mcpPromptsProvider().filter(s => !seen.has(s.name));
  if (mcpSkills.length > 0) {
    skills = [...skills, ...mcpSkills];
  }
}
```

**区别**：
- hermes: 预定义 15 个 toolset，每个平台 `AIAgent(enabled_toolsets=["hermes-telegram"])`
- EvoClaw: 运行时按 channel type 注入（无显式 "hermes-telegram" toolset）

**判定 🟡**：
- hermes 显式、可配置、可按平台差异化
- EvoClaw 隐含、受 channel handler 控制、不易修改
- 无法在 EvoClaw 里设置"Slack 上不给 terminal"（需改 code）vs hermes 可创建 `"hermes-slack-safe"` toolset

---

### §3.8 MCP server → tool 转换 + 冲突检测

**hermes**（`tools/registry.py` + 相关文档无 MCP 详细记载）：

```python
# run_agent.py:1093 左右监听 MCP 通知
# 当 notifications/tools/list_changed 时：
for new_tool in new_mcp_tools:
    registry.register(new_tool)           # 动态注册
    self.valid_tool_names.add(new_tool["name"])

# 冲突处理：文档未明确说，代码可能有但未在 10-toolsets 中提及
```

**EvoClaw**（`mcp/mcp-tool-bridge.ts:36-100` + `mcp/mcp-client.ts`）：

```typescript
/**
 * 将 MCP 工具转换为 EvoClaw ToolDefinition
 * 使用 mcp_<serverName>_<toolName> 格式避免冲突
 */
export function mcpToolToDefinition(
  mcpTool: McpToolInfo,
  manager: McpManager,
): ToolDefinition {
  const qualifiedName = `mcp_${mcpTool.serverName}_${mcpTool.name}`;
  
  return {
    name: qualifiedName,
    description: mcpTool.description ?? `MCP tool: ${mcpTool.name} (from ${mcpTool.serverName})`,
    parameters: mcpTool.inputSchema as Record<string, unknown>,
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const result: McpToolResult = await manager.callTool(
        mcpTool.serverName,
        mcpTool.name,
        args,
      );
      // ... 文本聚合
    },
  };
}

/**
 * 批量转换并检测冲突
 */
export function bridgeAllMcpTools(
  manager: McpManager,
  existingToolNames?: Set<string>,  // 检测与已有工具的冲突
): ToolDefinition[] {
  const allMcpTools = manager.getAllTools();
  return bridgeMcpToolList(allMcpTools, manager, existingToolNames);
}

/**
 * 桥接指定 MCP 服务器的工具（Agent 级 MCP 过滤）
 */
export function bridgeMcpToolsForAgent(
  manager: McpManager,
  serverNames: string[] | undefined,  // 允许的服务器清单
  existingToolNames?: Set<string>,
): ToolDefinition[] {
  const allMcpTools = manager.getAllTools();
  // undefined 或空 = 使用全部
}
```

**判定 🟢 反超**：EvoClaw 的 MCP 桥接**显式、细粒度**：
- 命名空间规范（`mcp_<server>_<name>`）避免冲突
- `existingToolNames` 参数让调用方检测与已有工具的冲突
- `bridgeMcpToolsForAgent(serverNames)` 支持 per-agent MCP 服务器过滤
- 完整的 error handling（返回 `[MCP 错误] ...` 的可读格式）

---

### §3.9 Skills → 工具引导（Tier 1 目录 vs Tier 2 详情）

**hermes**（无对应机制。skills 是 `/skill-name` 注入，不通过 toolset）

**EvoClaw**（`context/plugins/tool-registry.ts:170-182, 288-400`）：

```typescript
// Tier 1: 生成 XML 目录（自动降级）
const catalog = buildSkillsPrompt(activeSkills);  // 返回 prompt 文本
ctx.injectedContext.push(catalog);
ctx.estimatedTokens += activeSkills.length * 75;  // 估算 token

/**
 * 构建技能 prompt — 含引导语 + XML 目录
 * 自动在完整模式和紧凑模式之间降级
 *
 * G1 Bundled 预算豁免：bundled 技能享有不可截断特权
 */
function buildSkillsPrompt(skills: InstalledSkill[]): string {
  const header = `## Skills (optional reference library)
Built-in tools are your **primary** action interface...
If a built-in tool can do the job, use the built-in tool.
Constraint: invoke at most one skill per turn.`;

  // 尝试完整模式（含 description）
  const fullEntries = skills.map(skillToFullEntry);
  if (fullPrompt.length <= MAX_SKILLS_PROMPT_CHARS) {
    return fullPrompt;  // Tier 1 full
  }

  // 降级 1: others 转 compact（仅 name，省 description）
  const othersCompactEntries = others.map(skillToCompactEntry);  // <skill><name>...</name></skill>

  // 降级 2: others 按比例截断（bundled 完整保留）
  // 极端情况：others 全舍弃，bundled 必须保留
}

// Tier 2: 模型用 Read 工具按需加载完整 SKILL.md
// （在 skillToFullEntry 中声明 whenToUse + argumentHint，模型看到后可决定是否调用）
function skillToFullEntry(s: InstalledSkill): string {
  const whenTag = s.whenToUse ? `\n    <when>${escapeXml(s.whenToUse)}</when>` : '';
  const hintTag = s.argumentHint ? `\n    <argument-hint>${escapeXml(s.argumentHint)}</argument-hint>` : '';
  return `  <skill>\n    <name>...</name>\n    <description>...</description>${whenTag}${hintTag}...\n  </skill>`;
}

function skillToCompactEntry(s: InstalledSkill): string {
  return `  <skill><name>${escapeXml(s.name)}</name></skill>`;  // 紧凑
}
```

**特点**：
- **Tier 1（目录）** — 自动降级（full → compact → truncated）
  - Full mode: 名 + 描述 + whenToUse + argumentHint + 参数列表
  - Compact mode: 仅 name
  - Truncated: 按预算比例选择部分
- **Tier 2（详情）** — 模型按需 read SKILL.md（通过 read 工具）
- **Bundled 预算豁免** — 内置技能不被截断（优先级最高）
- **自动 token 估算** — 每个技能 ~75 tokens

**判定 🟢 反超**：
- hermes 无 skill → tool 的形式化机制（skills 是 `/skill-name` 特殊命令，不通过 toolset）
- EvoClaw 的 Tier 1/2 **自动降级 + 预算管理** 是独创
- EvoClaw 的 `argumentHint`（对非技术用户的填空提示）vs hermes 无

---

### §3.10 工具 allowlist / denylist（NameSecurityPolicy）

**hermes**（无对应机制。只有 `check_fn` 和 `enabled/disabled_toolsets`）

**EvoClaw**（`context/plugins/tool-registry.ts:82-83, 143-149`）：

```typescript
/** 工具安全策略接口（IT 管理员配置） */
export interface ToolRegistryOptions {
  paths?: Partial<SkillPaths>;
  getDisabledSkills?: DisabledSkillsFn;           // Agent 级禁用函数
  securityPolicy?: NameSecurityPolicy;            // **统一扩展安全策略**
  mcpPromptsProvider?: () => InstalledSkill[];
}

// beforeTurn 中的应用
async beforeTurn(ctx: TurnContext) {
  // ...
  const disabledSet = opts.getDisabledSkills?.(ctx.agentId) ?? new Set<string>();
  let activeSkills = skills.filter(s => 
    s.gatesPassed && !s.disableModelInvocation && !disabledSet.has(s.name)
  );

  // 安全策略过滤（IT 管理员白名单/黑名单）
  if (opts.securityPolicy) {
    const { allowed, denied } = filterByPolicy(activeSkills, s => s.name, opts.securityPolicy);
    if (denied.length > 0) {
      log.warn(`[${ctx.agentId}] 安全策略拦截 ${denied.length} 个技能: ...`);
    }
    activeSkills = allowed;
  }
}
```

**NameSecurityPolicy** 是 `@evoclaw/shared` 中定义的统一扩展安全策略（也用于 MCP tools）：

```typescript
// 伪代码（实际定义见 @evoclaw/shared）
export interface NameSecurityPolicy {
  // 允许清单（null = 不限）
  allowlist?: string[] | RegExp[] | null;
  // 拒绝清单
  denylist?: string[] | RegExp[] | null;
  // 默认策略：allowlist 非空时默认拒绝；denylist 非空时默认允许
}

// 使用
const { allowed, denied } = filterByPolicy(items, getItemName, securityPolicy);
```

**判定 🟢 反超**：
- hermes 无统一安全策略（只有 per-agent `check_fn` 和 per-toolset `enabled/disabled`）
- EvoClaw 的 **NameSecurityPolicy** 是 IT 管理员审计层，跨 skills/MCP/future extensions
- 支持**白名单 + 黑名单 + 默认策略**三合一

---

### §3.11 工具可见度对 LLM 的影响（目录注入 vs 按需加载）

**hermes**（`.research/10-toolsets.md §3.1` + `run_agent.py:7437-7446`）：

```python
# 系统 prompt 的第 ② 层"工具指导"根据 valid_tool_names 过滤：
# 所有工具都一次性放在 system prompt 的工具定义 JSON 数组里

# 若某工具不在 enabled_toolsets，不出现在 system prompt 中
# 模型看不到，自然不会调用
```

**特点**：工具都是"硬编码"在 system prompt 的 JSON schema 里。

**EvoClaw**（`agent/kernel/types.ts:245-247` + `agent/tool-catalog.ts:78-118`）：

```typescript
/** 是否延迟加载（true = 初始 prompt 不含完整 schema，需通过 ToolSearch 发现） */
readonly shouldDefer?: boolean;

/** 搜索提示词（3-10 词能力描述，供 ToolSearch 匹配） */
readonly searchHint?: string;

// TOOL_PROFILES 中按 profile 决定哪些工具可见
export const TOOL_PROFILES: Record<ToolProfileId, readonly string[] | null> = {
  minimal: ['read', 'ls', 'find', 'grep'],       // 仅这 4 个可见
  coding: [/* ... */],
  messaging: [/* ... */],
  full: null,                                    // null = 全部可见
};

// ToolRegistry plugin Tier 1 XML 目录（相比 system prompt JSON，更紧凑）
// 模型只看到 name + description（full mode）或 name（compact mode）
// 完整 schema 通过 ToolSearch 按需加载（Tier 2）
```

**判定 🟡**：
- hermes: 工具全部硬编码，按 toolset 过滤（无按需加载）
- EvoClaw: 
  - ✅ `shouldDefer + searchHint` 支持按需加载（但代码中未见 ToolSearch 实装）
  - ✅ TOOL_PROFILES 按场景过滤（profile 级别）
  - ✅ Skills Tier 1/2 自动降级（节省 token）
  - ❌ 缺"Tier 1 预告"概念（即"这是可用工具的目录，工具 X 暂未加载"的显式提示）

---

### §3.12 Toolset 分布采样（训练数据多样化）

**hermes**（`.research/10-toolsets.md §3.4` + `toolset_distributions.py:223-288`）：

```python
DISTRIBUTIONS = {
    "default": {
        "description": "All tools 100% (maximum coverage)",
        "toolsets": {
            "web": 100, "vision": 100, "image_gen": 100,
            "terminal": 100, "file": 100, "moa": 100, "browser": 100,
        },
    },
    "research": {
        "description": "Web research focus",
        "toolsets": {
            "web": 90, "browser": 70, "vision": 50, "moa": 40, "terminal": 10,
        },
    },
    # ... 14 个训练分布 + 3 个数据集分布

}

def sample_toolsets_from_distribution(distribution_name: str) -> List[str]:
    """根据概率采样返回实际启用的 toolset list"""
    dist = get_distribution(distribution_name)
    selected_toolsets = []
    for toolset_name, probability in dist["toolsets"].items():
        if random.random() * 100 < probability:  # 独立投骰子
            selected_toolsets.append(toolset_name)

    # 保障：如果采样结果为空，至少选最高概率的那个
    if not selected_toolsets and dist["toolsets"]:
        highest_prob_toolset = max(dist["toolsets"].items(), key=lambda x: x[1])[0]
        selected_toolsets.append(highest_prob_toolset)

    return selected_toolsets
```

**用途**：在 `batch_runner.py` 中为每条 prompt 独立采样，生成工具集多样化的训练数据。

**EvoClaw**（无对应机制，搜索无 distribution 相关代码）

**判定 🔴**：EvoClaw **完全缺失 distribution 概念**，无法：
- 在 batch mode 中为不同 prompt 分配不同的工具集
- 生成"仅 terminal + file"或"仅 web + vision"的多样化训练数据
- 支持 RL 环境（`hermes_base_env.py:97-102`）的 `distribution: Optional[str]` 配置

**影响**：若要用 EvoClaw 训练多工具 agent，每条 prompt 都看到**完整工具集**，模型无法学会"在工具不可用时的降级决策"。

---

### §3.13 执行时工具动态校正（execute_code / browser_navigate）

**hermes**（`model_tools.py:314-341`）：

```python
# execute_code 动态 schema 重建
if "execute_code" in available_tool_names:
    from tools.code_execution_tool import SANDBOX_ALLOWED_TOOLS, build_execute_code_schema
    sandbox_enabled = SANDBOX_ALLOWED_TOOLS & available_tool_names  # 交集
    dynamic_schema = build_execute_code_schema(sandbox_enabled)
    for i, td in enumerate(filtered_tools):
        if td.get("function", {}).get("name") == "execute_code":
            filtered_tools[i] = {"type": "function", "function": dynamic_schema}
            break

# browser_navigate description 裁剪（若 web_search / web_extract 不可用）
if "web_search" not in available_tool_names:
    # 从 browser_navigate description 中删除 "您也可以使用 web_search ..." 的引用
```

**特点**：根据实际可用工具集，动态调整某些工具的 schema 或 description。

**EvoClaw**（无对应代码，grep 无 execute_code 动态重建的痕迹）

**判定 🟡**：
- hermes 细致（execute_code 和 browser_navigate 的 schema 与 available_tool_names 联动）
- EvoClaw 缺少这种"工具间互指"的动态修正

---

### §3.14 工具注册注入的五个阶段（文档化）

**hermes**（代码中体现，但文档无名），按调用链：

1. **`AIAgent.__init__`** → `get_tool_definitions(enabled_toolsets, disabled_toolsets)`
2. **分支判定** — enabled 优先，disabled 次之，默认全部
3. **registry.get_definitions(tools_to_include)** → 过滤 check_fn
4. **execute_code 动态 schema** → 基于 sandbox_enabled
5. **browser_navigate 描述裁剪** → 基于 available_tool_names

**EvoClaw**（CLAUDE.md 声称 5 阶段，但代码中：）

```
Phase 1: createBuiltinTools() (read/write/edit/bash/...)
Phase 2: StreamingToolExecutor (并发执行框架)
Phase 3: createEvoClawTools() (memory/web/browser/...)
Phase 4: Channel Handler (per-session 注入 channel-tools)
Phase 5: ToolRegistry Plugin + MCP Bridge (skills + MCP server)
```

**差异**：
- hermes 按 AIAgent 初始化时的**分支选择**划分阶段
- EvoClaw 按**执行时间点**划分阶段（建议明确化）

**判定 🟡**：EvoClaw 的 5 阶段更清晰，但缺少**文档和代码中的显式 phase 标记**。建议：
```typescript
// Phase 1: Kernel builtin
// Phase 2: Enhanced bash
// Phase 3: EvoClaw-specific
// Phase 4: Channel tools
// Phase 5: MCP + Skills
```

---

## 4. 建议改造蓝图（不承诺实施）

### P0（高 ROI，建议尽快）

| # | 项目 | 对应差距 | 工作量 | ROI | 备注 |
|---|---|---|---|---|---|
| 1 | Toolset 抽象（递归 include + 菱形去重） | §3.1 | 2-3d | 🔥🔥 | 为后续 toolset-aware 机制铺路 |
| 2 | 显式 5 阶段注释 + 文档化 | §3.14 | 0.5d | 🔥 | 可维护性 |
| 3 | per-agent 工具全局配置（kernel + skill） | §3.3 | 1-2d | 🔥 | 支持"Slack agent 永不给 bash" |

### P1（中等 ROI）

| # | 项目 | 对应差距 | 工作量 | ROI | 备注 |
|---|---|---|---|---|---|
| 4 | Toolset 分布系统 (17 个分布，采样函数) | §3.12 | 2-3d | 🔥🔥 | RL 训练数据多样化根基 |
| 5 | 工具动态校正（execute_code / browser_navigate） | §3.13 | 1d | 🔥 | 避免模型幻觉调用不可用工具 |
| 6 | per-channel 全局 toolset 绑定 | §3.7 | 1d | 🔥 | Channel-specific 工具配置 |
| 7 | ToolSearch 实装（shouldDefer + searchHint） | §3.11 | 2d | 🔥 | 大型工具集的按需加载 |

### P2（长期规划）

| # | 项目 | 对应差距 | 工作量 | 备注 |
|---|---|---|---|---|
| 8 | 平台 toolset (15 个平台 + 裁剪版) | §3.7 | 1-2d | 对标 hermes 的完整平台集合 |
| 9 | Tier 1 预告（"工具尚未加载"的显式提示） | §3.11 | 0.5d | UX 改进 |

### 不建议做

- 把 EvoClaw 的 channel tools 全转成 hermes 的 15 toolset（channel binding 动态注入更灵活）
- 去掉 NameSecurityPolicy（EvoClaw 反超优势）

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应 |
|---|---|---|---|
| 1 | MCP 命名空间 + 冲突检测 | `mcp/mcp-tool-bridge.ts:36-70` | 无显式冲突处理 |
| 2 | NameSecurityPolicy 统一扩展策略 | `context/plugins/tool-registry.ts:82-83, 143-149` | 无（仅 per-toolset enabled/disabled） |
| 3 | Skills Tier 1/2 自动降级 + 预算豁免 | `context/plugins/tool-registry.ts:170-182, 288-400` | 无（skills 是 `/skill-name` 命令，不通过 toolset） |
| 4 | Tool Profile（4 个预设场景） | `tool-catalog.ts:78-118` | 无（所有工具一视同仁） |
| 5 | per-agent 禁用函数（`getDisabledSkills`） | `context/plugins/tool-registry.ts:137-140` | 无（仅 Agent 级 enabled_toolsets） |
| 6 | 5 阶段隐含划分（相比 hermes 的链式调用更清晰） | `CLAUDE.md:48-108` | 隐含但无显式命名 |

**缺失关键能力**（🔴）：
- Toolset 组合与递归 include
- Toolset 分布采样（训练数据多样化）
- 工具动态校正（execute_code schema / browser_navigate 裁剪）

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（经 Read/Grep 验证 2026-04-16）

- `packages/core/src/agent/tool-catalog.ts:10-15` ✅ CoreToolMeta 结构
- `packages/core/src/agent/tool-catalog.ts:18-59` ✅ CORE_TOOLS 静态清单 (59 条)
- `packages/core/src/agent/tool-catalog.ts:78-118` ✅ TOOL_PROFILES 四个预设
- `packages/core/src/context/plugins/tool-registry.ts:93-106` ✅ ToolRegistryOptions + createToolRegistryPlugin
- `packages/core/src/context/plugins/tool-registry.ts:117-176` ✅ beforeTurn + 技能过滤逻辑
- `packages/core/src/context/plugins/tool-registry.ts:288-400` ✅ buildSkillsPrompt + 自动降级
- `packages/core/src/mcp/mcp-tool-bridge.ts:36-100` ✅ mcpToolToDefinition + 冲突检测
- `packages/core/src/agent/kernel/types.ts:235-279` ✅ KernelTool interface (shouldDefer/searchHint/maxResultSizeChars/backfillObservableInput)
- `packages/core/src/tools/evoclaw-tools.ts:31-44` ✅ createEvoClawTools 入口 (Phase 3)
- `packages/core/src/agent/kernel/query-loop.ts:416` ✅ StreamingToolExecutor(config.tools, 8)

### 6.2 hermes 研究引用

- `.research/10-toolsets.md §1` — 角色与定位
- `.research/10-toolsets.md §2` — 41 toolset 完整清单 + 17 分布
- `.research/10-toolsets.md §3.1` — TOOLSETS dict 结构
- `.research/10-toolsets.md §3.2` — resolve_toolset 递归算法 + 菱形去重
- `.research/10-toolsets.md §3.3` — 9 个公开函数
- `.research/10-toolsets.md §3.4` — 17 个分布定义
- `.research/10-toolsets.md §3.5` — 5 个分布函数 + sample_toolsets_from_distribution 算法
- `.research/10-toolsets.md §3.6` — batch_runner / hermes_base_env 的 distribution 用途
- `.research/10-toolsets.md §3.7` — 所有 toolset 的使用者
- `.research/10-toolsets.md §3.8` — model_tools.get_tool_definitions 三分支控制流
- `.research/10-toolsets.md §3.9` — 平台默认 toolset (PLATFORMS dict)
- `toolsets.py:129-183` — 41 toolset 源代码
- `toolsets.py:383-455` — resolve_toolset / get_toolset_info 源码
- `toolset_distributions.py:223-288` — sample_toolsets_from_distribution 源码
- `model_tools.py:234-353` — get_tool_definitions 三分支源码
- `run_agent.py:659-660, 894-912` — AIAgent.enabled_toolsets / disabled_toolsets 初始化

### 6.3 关联差距章节（crosslink）

- [`04-core-abstractions-gap.md`](./04-core-abstractions-gap.md) §3.3 / §3.4 — ToolEntry vs KernelTool / ToolRegistry
- [`05-agent-loop-gap.md`](./05-agent-loop-gap.md) §3.5 — 工具分发并发策略
- `09-tools-system-gap.md` (Wave 2) — KernelTool 接口详解、工具执行框架
- `15-memory-providers-gap.md` (Wave 2) — Memory 工具集（EvoClaw 的 9 个 memory_* 工具）
- `21-mcp-gap.md` (Wave 2) — MCP 集成与 server 发现

---

**本章完成**。综合判定 **🟡 部分覆盖，形态差异**：

- ✅ EvoClaw 在**工具 ID 命名空间、MCP 冲突检测、NameSecurityPolicy 统一策略、Skills 两级注入**四项显著反超
- 🔴 **缺失 3 个关键机制**：Toolset 组合、分布采样、动态校正
- 🟡 **形态差异 8 处**（作用域、条件启用、平台工具、可见度等），两者取向不同，可兼容

**优先级建议**：P0 补齐 Toolset 抽象（为后续机制铺路），P1 加入分布采样（RL 训练根基），P1-2 工具动态校正（避免模型幻觉）。
