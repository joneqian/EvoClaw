# PI 内核替换技术方案 — EvoClaw Agent Kernel v2

> 融合 Claude Code 架构研究 + REFACTOR_PLAN.md 设计 + EvoClaw 现有基础设施

---

## Context

EvoClaw 当前通过 PI 框架 (pi-ai + pi-agent-core + pi-coding-agent) 实现 Agent 核心能力。PI 提供了 ReAct 循环、流式输出、工具执行、上下文压缩、会话管理等关键功能，但作为第三方黑盒存在以下问题：

1. **API 不稳定** — `session.prompt()` 内部行为不透明，process.exit 拦截等 hack
2. **工具签名不一致** — PI 4 参数签名 vs EvoClaw 1 参数签名，需双层包装
3. **Usage 补丁** — `ensureUsageOnAssistantMessages()` 防御性补零
4. **XML 过滤** — PI `<tool_call>` XML 混入 text_delta，需状态机过滤
5. **Compaction 不可控** — 只能通过 `_rebuildSystemPrompt` hack 注入 post-compaction 恢复
6. **Provider 映射** — `pi-provider-map.ts` 做 `glm→zai` 映射

**目标**: 用自研 Agent 内核替换 PI 全部功能，参考 Claude Code async-generator 架构，获得完全透明可控的 Agent 能力。重构后的 Agent 能力是唯一要求，不留"以后再做"。

---

## PI 耦合面分析 (6 文件)

| 文件 | PI 耦合内容 | 替换策略 |
|------|------------|---------|
| `embedded-runner-attempt.ts` (534行) | `createAgentSession`, `session.prompt`, `session.subscribe`, `session.abort`, `AuthStorage`, `SessionManager`, `SettingsManager`, `ModelRegistry`, `DefaultResourceLoader`, `streamSimple` | **完全重写** |
| `embedded-runner-tools.ts` (401行) | `buildPIBuiltInTools(piCoding, ...)`, `wrapPITool()` (4参签名), `createToolXmlFilter()` | **大幅简化** |
| `pi-provider-map.ts` (30行) | `toPIProvider()` | **删除** |
| `routes/doctor.ts` (~15行) | `require.resolve()` 健康检查 | **移除** PI 检查 |
| `adaptive-read.ts` (153行) | 包装 PI read 4 参签名 | **迁入** builtin-tools |
| `package.json` | 3 个 PI 依赖 | **删除** |

### 完全不受影响

`embedded-runner.ts` (入口) / `embedded-runner-loop.ts` (重试循环 278行) / `embedded-runner-prompt.ts` (系统提示 258行) / `embedded-runner-errors.ts` / `embedded-runner-timeout.ts` / `tool-safety.ts` / `schema-adapter.ts` / `llm-client.ts` (已有双协议) / `lane-queue.ts` / `sub-agent-spawner.ts` / `agent-manager.ts` / `agent-builder.ts` / 所有 ContextPlugin、Memory、Permission、Route 代码

### 关键不变量

1. **`AttemptResult` 接口不变** — 外层循环 `embedded-runner-loop.ts` 完全不改
2. **`AgentRunConfig` 接口不变** — 路由层 `chat.ts` 不改
3. **`RuntimeEvent` 接口不变** — 前端 SSE 消费者不受影响

---

## 架构总览

```
┌───────────────────────────────────────────────────────────┐
│              Hono HTTP Server (routes/chat.ts)             │
├───────────────────────────────────────────────────────────┤
│  embedded-runner.ts → embedded-runner-loop.ts (不变)        │
│  └→ embedded-runner-attempt.ts (重写)                      │
│     └→ queryLoop() from kernel/                           │
├───────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │               kernel/ (新建 Agent 内核)               │ │
│  │                                                      │ │
│  │  ┌─────────────────────────────────────────────┐    │ │
│  │  │  Query Loop (async generator)                │    │ │
│  │  │  while(true) {                               │    │ │
│  │  │    compress? → stream API → execute tools     │    │ │
│  │  │    → has tool_use? continue : break           │    │ │
│  │  │  }                                           │    │ │
│  │  └────────┬──────────────┬─────────────────────┘    │ │
│  │           │              │                          │ │
│  │  ┌────────▼─────┐ ┌─────▼────────────┐            │ │
│  │  │ Stream Client │ │ Tool Executor    │            │ │
│  │  │ (双协议 SSE)  │ │ (并行/串行分区)   │            │ │
│  │  │ + 看门狗      │ │ + 流中预执行      │            │ │
│  │  └──────────────┘ └──────────────────┘            │ │
│  │                                                      │ │
│  │  ┌──────────────┐ ┌──────────────────┐            │ │
│  │  │ Context      │ │ Builtin Tools    │            │ │
│  │  │ Compactor    │ │ (read/write/edit  │            │ │
│  │  │ (3层压缩)    │ │  grep/find/ls)   │            │ │
│  │  └──────────────┘ └──────────────────┘            │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  现有模块 (不变)                                       │ │
│  │  ToolSafetyGuard │ SchemaAdapter │ LLMClient         │ │
│  │  SubAgentSpawner │ LaneQueue │ ContextPlugin          │ │
│  │  Permission │ Memory │ Channels │ Scheduling          │ │
│  └──────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

---

## 模块设计

### 新增: `packages/core/src/agent/kernel/`

```
kernel/
├── index.ts                    # 公共 API
├── types.ts                    # 核心类型
├── stream-client.ts            # 流式 LLM 调用 (Anthropic + OpenAI SSE)
├── stream-parser.ts            # SSE 行解析器 (双格式)
├── streaming-tool-executor.ts  # 流中工具预执行 + 并发/串行分区
├── query-loop.ts               # async generator Agent 循环 (核心)
├── context-compactor.ts        # 三层压缩 (snip + microcompact + autocompact)
├── builtin-tools.ts            # 内置文件工具 (read/write/edit/grep/find/ls)
├── tool-adapter.ts             # EvoClaw ToolDefinition → KernelTool 适配
└── error-recovery.ts           # API 错误恢复 (413/max_output/流式回退)
```

---

## 核心类型 (`kernel/types.ts`)

```typescript
// ═══ Content Blocks ═══
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'thinking'; thinking: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

// ═══ Messages ═══
export interface KernelMessage {
  id: string;        // UUID
  role: 'user' | 'assistant';
  content: ContentBlock[];
  usage?: TokenUsage;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

// ═══ Tool Interface (统一签名，参考 Claude Code) ═══
export interface KernelTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema

  call(input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolCallResult>;

  // 能力声明 (fail-closed: 默认 false)
  isReadOnly(): boolean;
  isConcurrencySafe(): boolean;
}

export interface ToolCallResult {
  content: string;
  isError?: boolean;
}

// ═══ Streaming Events (统一双协议，从 SSE 解析后) ═══
export type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; delta: string }
  | { type: 'tool_use_end'; id: string; input: Record<string, unknown> }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; message: string; status?: number };

// ═══ Query Loop ═══
export interface QueryLoopConfig {
  // API
  protocol: 'anthropic-messages' | 'openai-completions';
  baseUrl: string;
  apiKey: string;
  modelId: string;
  maxTokens: number;
  contextWindow: number;
  thinking: boolean;

  // Tools
  tools: KernelTool[];

  // System prompt
  systemPrompt: string;

  // History
  messages: KernelMessage[];

  // Limits
  maxTurns: number;      // 默认 50
  timeoutMs: number;     // 默认 600_000

  // Callbacks — 桥接到 RuntimeEvent
  onEvent: (event: RuntimeEvent) => void;

  // Safety
  toolSafety: ToolSafetyGuard;

  // Abort
  abortSignal?: AbortSignal;

  // Compaction (可选：用于 autocompact 的轻量模型)
  compaction?: {
    protocol: string;
    baseUrl: string;
    apiKey: string;
    modelId: string;
  };
}

export interface QueryLoopResult {
  fullResponse: string;
  toolCalls: ToolCallRecord[];
  messages: KernelMessage[];
  totalInputTokens: number;
  totalOutputTokens: number;
}
```

---

## Phase 1: 流式基础 — SSE 解析 + 双协议客户端

### 1.1 SSE 解析器 (`kernel/stream-parser.ts`)

```typescript
/**
 * 行级 SSE 解析，async generator，双格式支持
 * Anthropic: event: xxx\ndata: {...}\n\n
 * OpenAI: data: {...}\n\n (无 event: 行)
 */
export async function* parseSSE(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<{ event?: string; data: string }> {
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent: string | undefined;

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;
        yield { event: currentEvent, data };
        currentEvent = undefined;
      } else if (line.trim() === '') {
        currentEvent = undefined;
      }
    }
  }
}
```

### 1.2 流式客户端 (`kernel/stream-client.ts`)

```typescript
/**
 * 统一双协议流式 LLM 调用
 * 输出: 归一化的 StreamEvent async generator
 *
 * 关键:
 * - Anthropic: tool_result 在 user message content 数组
 * - OpenAI: tool_result 在 role: 'tool' message
 * - OpenAI tool_calls delta 需要 ToolCallAccumulator 缓冲拼接
 */
export async function* streamLLM(config: StreamConfig): AsyncGenerator<StreamEvent> {
  // 构建请求体
  const { url, headers, body } = config.protocol === 'anthropic-messages'
    ? buildAnthropicRequest(config)
    : buildOpenAIRequest(config);

  // 空闲看门狗 (90s)
  const watchdog = createIdleWatchdog(90_000);

  const response = await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(body),
    signal: config.signal,
  });

  if (!response.ok) {
    yield { type: 'error', message: await response.text(), status: response.status };
    return;
  }

  // 解析 SSE → 归一化 StreamEvent
  if (config.protocol === 'anthropic-messages') {
    yield* processAnthropicStream(response.body!, watchdog);
  } else {
    yield* processOpenAIStream(response.body!, watchdog);
  }

  watchdog.clear();
}
```

**OpenAI ToolCallAccumulator** — 关键细节:
```typescript
class ToolCallAccumulator {
  private calls = new Map<number, { id: string; name: string; args: string }>();

  feed(delta: { index: number; id?: string; function?: { name?: string; arguments?: string } }) {
    const existing = this.calls.get(delta.index) ?? { id: '', name: '', args: '' };
    if (delta.id) existing.id = delta.id;
    if (delta.function?.name) existing.name += delta.function.name;
    if (delta.function?.arguments) existing.args += delta.function.arguments;
    this.calls.set(delta.index, existing);
  }

  flush(): Array<{ id: string; name: string; input: Record<string, unknown> }> {
    return [...this.calls.values()].map(c => ({
      id: c.id,
      name: c.name,
      input: JSON.parse(c.args || '{}'),
    }));
  }
}
```

**看门狗 (Watchdog)** — 参考 Claude Code:
```typescript
function createIdleWatchdog(timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout>;
  let reject: (err: Error) => void;
  const promise = new Promise((_, rej) => { reject = rej; });

  return {
    reset() { clearTimeout(timer); timer = setTimeout(() => reject(new IdleTimeoutError()), timeoutMs); },
    clear() { clearTimeout(timer); },
    promise,
  };
}
```

**非流式回退**: 看门狗触发 → abort 流 → 300s 超时非流式 `callLLM()` → 构建等价的 StreamEvent 序列

### 新建文件
- `kernel/types.ts`
- `kernel/stream-parser.ts`
- `kernel/stream-client.ts`

### 验证
- 单测: mock SSE 数据 (双格式) 验证解析
- 集成: 真实 API 调用验证流式输出

---

## Phase 2: 内置工具

### 2.1 builtin-tools.ts

替代 PI 的 `codingTools`, `grepTool`, `findTool`, `lsTool`:

| 工具 | 实现 | ReadOnly | ConcurrencySafe | 关键细节 |
|------|------|----------|----------------|---------|
| `read` | `fs.readFile` + cat -n 格式 | Yes | Yes | 整合 adaptive-read 逻辑，根据 contextWindow 动态 maxLines |
| `write` | `fs.writeFile` + mkdirSync(recursive) | No | No | — |
| `edit` | 精确字符串替换 (oldText→newText) | No | No | 唯一性验证 + replace_all 参数 |
| `grep` | `execSync('grep -rn')` 或 `rg` | Yes | Yes | 最大 100 匹配 |
| `find` | `execSync('find')` + glob | Yes | Yes | 最大 1000 文件 |
| `ls` | `fs.readdirSync` + stats | Yes | Yes | — |

**read 工具格式** (严格匹配 PI 的 cat -n 以保持模型行为一致):
```
     1\t第一行内容
     2\t第二行内容
     ...
```

**edit 工具匹配逻辑** (参考 Claude Code FileEditTool):
1. 精确匹配 oldText
2. 如果不唯一 → 报错 "old_string 在文件中出现多次"
3. 如果找不到 → 报错 "old_string 未在文件中找到"
4. `replace_all: true` 支持全局替换

**bash 工具**: 复用现有 `createEnhancedExecTool()` (已独立于 PI)

### 2.2 tool-adapter.ts

将 EvoClaw `ToolDefinition` (1参签名) 适配为 `KernelTool`:

```typescript
export function adaptEvoclawTool(tool: ToolDefinition, deps: ToolAdapterDeps): KernelTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: normalizeToolSchema(tool.parameters, deps.provider),

    async call(input, signal) {
      // 1. 权限检查 (复用现有 permissionFn)
      const rejection = await deps.permissionFn?.(tool.name, input);
      if (rejection) return { content: `[权限拒绝] ${rejection}`, isError: true };

      // 2. 安全检查 (复用 ToolSafetyGuard)
      const check = deps.toolSafety.checkBeforeExecution(tool.name, input);
      if (check.blocked) return { content: `⚠️ ${check.reason}`, isError: true };

      // 3. 执行
      const start = Date.now();
      try {
        const rawResult = await tool.execute(input);
        // 4. 后处理: 无进展检测 + 截断
        const noProgress = deps.toolSafety.recordResult(rawResult);
        if (noProgress.blocked) return { content: `⚠️ ${noProgress.reason}`, isError: true };
        const truncated = deps.toolSafety.truncateResult(rawResult);
        deps.auditFn?.({ toolName: tool.name, args: input, result: truncated, status: 'success', durationMs: Date.now() - start });
        return { content: truncated };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.auditFn?.({ toolName: tool.name, args: input, result: msg, status: 'error', durationMs: Date.now() - start });
        return { content: msg, isError: true };
      }
    },

    isReadOnly: () => READ_ONLY_TOOLS.has(tool.name),
    isConcurrencySafe: () => CONCURRENT_SAFE_TOOLS.has(tool.name),
  };
}

const READ_ONLY_TOOLS = new Set(['read', 'grep', 'find', 'ls', 'web_search', 'web_fetch', 'image', 'memory_search', 'memory_get', 'knowledge_query', 'list_agents']);
const CONCURRENT_SAFE_TOOLS = new Set(['read', 'grep', 'find', 'ls', 'web_search', 'web_fetch', 'image', 'memory_search', 'memory_get', 'knowledge_query']);
```

### 新建文件
- `kernel/builtin-tools.ts`
- `kernel/tool-adapter.ts`

### 复用
- `schema-adapter.ts` → `normalizeToolSchema()`
- `tool-safety.ts` → `ToolSafetyGuard`
- `embedded-runner-tools.ts` → `createEnhancedExecTool()`

---

## Phase 3: 流中工具执行器

### streaming-tool-executor.ts

**核心改进**: 参考 Claude Code 的 StreamingToolExecutor — 在 API 流式输出过程中就开始执行工具，而非等流完全结束。

```typescript
export class StreamingToolExecutor {
  private toolMap: Map<string, KernelTool>;
  private queue: Array<{ block: ToolUseBlock; promise?: Promise<ToolCallResult> }> = [];
  private concurrencySemaphore: number;

  constructor(tools: KernelTool[], maxConcurrency = 8) {
    this.toolMap = new Map(tools.map(t => [t.name, t]));
    this.concurrencySemaphore = maxConcurrency;
  }

  /**
   * 流中收到 tool_use_end 时入队
   * 如果是 concurrencySafe 工具 → 立即开始执行
   */
  enqueue(block: ToolUseBlock): void {
    const tool = this.toolMap.get(block.name);
    const entry = { block, promise: undefined as Promise<ToolCallResult> | undefined };
    this.queue.push(entry);

    if (tool?.isConcurrencySafe() && this.concurrencySemaphore > 0) {
      this.concurrencySemaphore--;
      entry.promise = this.executeSingle(block).finally(() => { this.concurrencySemaphore++; });
    }
  }

  /**
   * 流结束后，执行剩余工具 (串行) 并收集所有结果
   */
  async collectResults(config: { toolSafety, onEvent, signal }): Promise<ToolResultBlock[]> {
    const results: ToolResultBlock[] = [];

    for (const entry of this.queue) {
      if (!entry.promise) {
        // 未预执行的 (串行工具)
        entry.promise = this.executeSingle(entry.block);
      }
      const result = await entry.promise;
      config.onEvent({ type: 'tool_end', toolName: entry.block.name, toolResult: result.content, isError: result.isError ?? false, timestamp: Date.now() });
      results.push({
        type: 'tool_result',
        tool_use_id: entry.block.id,
        content: result.content,
        is_error: result.isError,
      });
    }

    this.queue = [];
    return results;
  }

  private async executeSingle(block: ToolUseBlock): Promise<ToolCallResult> {
    const tool = this.toolMap.get(block.name);
    if (!tool) return { content: `未知工具: ${block.name}`, isError: true };
    return tool.call(block.input);
  }
}
```

### 新建文件
- `kernel/streaming-tool-executor.ts`

---

## Phase 4: Agent 循环 (核心)

### query-loop.ts

```typescript
/**
 * Agentic Loop — async function (非 generator)
 *
 * 选择 async function + onEvent 回调 而非 async generator 的原因:
 * EvoClaw 的 embedded-runner-loop.ts 期望 runSingleAttempt() 返回 AttemptResult，
 * 不消费 generator。保持 onEvent 回调与现有 RuntimeEvent 接口兼容。
 *
 * 内部实现参考 Claude Code queryLoop() 的 while(true) 模式。
 */
export async function queryLoop(config: QueryLoopConfig): Promise<QueryLoopResult> {
  const messages: KernelMessage[] = [...config.messages];
  let turnCount = 0;
  let fullResponse = '';
  const allToolCalls: ToolCallRecord[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  while (true) {
    // ─── 1. 中止检查 ───
    if (config.abortSignal?.aborted) {
      throw new AbortError('外部中止');
    }
    if (turnCount >= config.maxTurns) {
      break; // 正常退出，由外层判断
    }

    // ─── 2. 上下文压缩 (turn > 0) ───
    if (turnCount > 0) {
      const compressed = await maybeCompress(messages, config);
      if (compressed) {
        config.onEvent({ type: 'compaction_start', timestamp: Date.now() });
        config.onEvent({ type: 'compaction_end', timestamp: Date.now() });
      }
    }

    // ─── 3. 流式 API 调用 + 流中工具预执行 ───
    config.onEvent({ type: 'message_start', timestamp: Date.now() });

    const executor = new StreamingToolExecutor(config.tools);
    const { assistantMessage, usage } = await streamOneRound(
      config, messages, executor,
    );

    messages.push(assistantMessage);
    turnCount++;
    totalInput += usage.inputTokens;
    totalOutput += usage.outputTokens;

    // ─── 4. 累积文本 ───
    for (const block of assistantMessage.content) {
      if (block.type === 'text') fullResponse += block.text;
    }

    config.onEvent({ type: 'message_end', timestamp: Date.now() });

    // ─── 5. 收集工具结果 (流中已预执行的直接获取) ───
    const toolUseBlocks = assistantMessage.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use'
    );

    if (toolUseBlocks.length === 0) {
      break; // 模型完成，无工具调用
    }

    const toolResults = await executor.collectResults({
      toolSafety: config.toolSafety,
      onEvent: config.onEvent,
      signal: config.abortSignal,
    });

    allToolCalls.push(...mapToToolCallRecords(toolUseBlocks, toolResults));

    // ─── 6. 构建 tool result message (双协议适配) ───
    messages.push(buildToolResultMessage(toolResults, config.protocol));
  }

  return {
    fullResponse,
    toolCalls: allToolCalls,
    messages,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
  };
}
```

**`streamOneRound()`** — 单轮流式调用:
```typescript
async function streamOneRound(
  config: QueryLoopConfig,
  messages: KernelMessage[],
  executor: StreamingToolExecutor,
): Promise<{ assistantMessage: KernelMessage; usage: TokenUsage }> {
  const blocks: ContentBlock[] = [];
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  for await (const event of streamLLM({
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    modelId: config.modelId,
    systemPrompt: config.systemPrompt,
    messages,
    tools: config.tools,
    maxTokens: config.maxTokens,
    thinking: config.thinking,
    signal: config.abortSignal,
  })) {
    switch (event.type) {
      case 'text_delta':
        config.onEvent({ type: 'text_delta', delta: event.delta, timestamp: Date.now() });
        appendOrCreateTextBlock(blocks, event.delta);
        break;

      case 'thinking_delta':
        config.onEvent({ type: 'thinking_delta', delta: event.delta, timestamp: Date.now() });
        appendOrCreateThinkingBlock(blocks, event.delta);
        break;

      case 'tool_use_start':
        config.onEvent({ type: 'tool_start', toolName: event.name, toolArgs: {}, timestamp: Date.now() });
        // 开始累积 tool use block
        break;

      case 'tool_use_end':
        // 完整 tool_use block → 入队预执行
        blocks.push({ type: 'tool_use', id: event.id, name: event.name, input: event.input });
        executor.enqueue({ type: 'tool_use', id: event.id, name: event.name, input: event.input });
        break;

      case 'usage':
        usage = event.usage;
        break;

      case 'error':
        throw new ApiError(event.message, event.status);
        break;

      case 'done':
        break;
    }
  }

  return {
    assistantMessage: {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: blocks,
      usage,
    },
    usage,
  };
}
```

**Tool Result Message 双协议适配**:
```typescript
function buildToolResultMessage(results: ToolResultBlock[], protocol: string): KernelMessage {
  if (protocol === 'anthropic-messages') {
    // Anthropic: tool_result 放在 user message content 数组
    return {
      id: crypto.randomUUID(),
      role: 'user',
      content: results,  // [{ type: 'tool_result', tool_use_id, content, is_error }]
    };
  } else {
    // OpenAI: 多个 role:'tool' messages → 合并为单条 user message
    // 因为 KernelMessage 只有 user/assistant，用 content 数组携带
    return {
      id: crypto.randomUUID(),
      role: 'user',
      content: results,
    };
  }
}
```

注意: OpenAI 格式的 tool result 在 `buildOpenAIRequest()` 时会被展开为独立的 `role: 'tool'` messages。

### 新建文件
- `kernel/query-loop.ts`
- `kernel/error-recovery.ts`

---

## Phase 5: 三层上下文压缩

### context-compactor.ts

```typescript
export async function maybeCompress(
  messages: KernelMessage[],
  config: QueryLoopConfig,
): Promise<boolean> {
  const estimatedTokens = estimateTokens(messages, config);
  const threshold = config.contextWindow * 0.85;
  if (estimatedTokens < threshold) return false;

  // Layer 1: Snip (免费)
  snipOldMessages(messages);
  if (estimateTokens(messages, config) < threshold) return true;

  // Layer 2: Microcompact (免费)
  microcompactToolResults(messages);
  if (estimateTokens(messages, config) < threshold) return true;

  // Layer 3: Autocompact (1 次 LLM 调用)
  await autocompact(messages, config);
  return true;
}
```

**Snip**: 保留第 1 条 user message (上下文) + 最后 8 条消息，移除中间

**Microcompact**: 
- 截断 >5KB 的 tool_result (head 70% + tail 30%)
- 去重: 相同 tool_use_id 的重复结果合并

**Autocompact** (参考 Claude Code 9 段模板):
```typescript
async function autocompact(messages: KernelMessage[], config: QueryLoopConfig): Promise<void> {
  const compactionConfig = config.compaction ?? config; // 可选用轻量模型
  const summary = await callLLM(/* ... */, {
    systemPrompt: '你是对话摘要助手。',
    userMessage: `请总结以下对话，用以下结构:
1. 用户核心需求
2. 已完成工作
3. 当前进行中任务
4. 重要代码文件和修改
5. 未解决问题
6. 用户偏好和约束
7. 关键决策
8. 下一步计划
9. 最近上下文

对话内容:
${serializeMessages(messages)}`,
  });

  // 替换: 保留最后 4 条消息，前面的替换为摘要
  const recentMessages = messages.splice(-4);
  messages.length = 0;
  messages.push({
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: `[对话摘要 — 由系统生成]\n\n${summary}` }],
  });
  messages.push(...recentMessages);

  // Post-compaction 恢复指令 (从 embedded-runner-attempt.ts 的 hack 迁入)
  const today = new Date().toISOString().slice(0, 10);
  messages.push({
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: `[Post-compaction context refresh]
会话刚刚被压缩。请立即执行:
1. 读取 AGENTS.md — 你的操作规程
2. 读取 MEMORY.md — 你的长期记忆
3. 读取 memory/${today}.md — 今日笔记（如果存在）
从最新的文件状态恢复上下文，然后继续对话。` }],
  });
}
```

**Token 估算**: 
- 首选: 使用累积的 `usage` 字段 (真实值)
- 回退: `JSON.stringify(messages).length / 4` (近似)

### 新建文件
- `kernel/context-compactor.ts`

### 复用
- `llm-client.ts` → `callLLM()` 用于 autocompact

---

## Phase 6: 错误恢复

### error-recovery.ts

API 层错误恢复 (在 query-loop 内部处理):

```typescript
export function classifyApiError(err: unknown): { type: ErrorType; message: string; retryable: boolean } {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 413: return { type: 'overflow', message: err.message, retryable: true };
      case 429: return { type: 'overload', message: err.message, retryable: true };
      case 401: case 403: return { type: 'auth', message: err.message, retryable: false };
      case 402: return { type: 'billing', message: err.message, retryable: false };
      case 529: return { type: 'overload', message: err.message, retryable: true };
    }
  }
  if (err instanceof IdleTimeoutError) {
    return { type: 'timeout', message: '流式空闲超时 (90s)', retryable: true };
  }
  // 检查 body 中的错误码
  const msg = err instanceof Error ? err.message : String(err);
  if (/prompt.too.long|prompt_too_long/i.test(msg)) return { type: 'overflow', message: msg, retryable: true };
  if (/overloaded|rate.limit/i.test(msg)) return { type: 'overload', message: msg, retryable: true };
  if (/thinking|reasoning/i.test(msg)) return { type: 'thinking', message: msg, retryable: true };
  return { type: 'unknown', message: msg, retryable: false };
}
```

**在 queryLoop 中的错误处理策略**:
- `overflow` (413) → 调用 `maybeCompress(messages, config)` 强制压缩 → 重试本轮
- `IdleTimeoutError` → 回退到非流式 `callLLM()` → 300s 超时
- 其他错误 → 直接抛出，由 `embedded-runner-attempt.ts` catch → 映射到 `AttemptResult`

注意: `overload`/`auth`/`billing`/`thinking` 降级 由外层 `embedded-runner-loop.ts` 处理 (接口不变)

### 新建文件
- `kernel/error-recovery.ts`

### 修改
- `embedded-runner-errors.ts` — 更新错误消息正则 (API 原生格式 vs PI 包装格式)

---

## Phase 7: 集成 — 重写 attempt + 简化 tools

### 7.1 `embedded-runner-attempt.ts` — 完全重写 (534行 → ~150行)

```typescript
import { queryLoop, type QueryLoopConfig, type QueryLoopResult } from './kernel/index.js';
import { buildKernelTools } from './kernel/tool-adapter.js';
import { buildSystemPrompt } from './embedded-runner-prompt.js';
import { classifyError, isAbortError } from './embedded-runner-errors.js';
import { createSmartTimeout, abortable } from './embedded-runner-timeout.js';
import { shouldTriggerFlush, buildMemoryFlushPrompt, createFlushPermissionInterceptor } from './memory-flush.js';
import { ToolSafetyGuard } from './tool-safety.js';

export async function runSingleAttempt(params: AttemptParams): Promise<AttemptResult> {
  const { config, providerOverride, thinkLevel, messagesOverride, message, onEvent, abortSignal } = params;

  // ─── 构建 QueryLoopConfig ───
  const effectiveProvider = providerOverride?.provider ?? config.provider;
  const effectiveModelId = providerOverride?.modelId ?? config.modelId;
  const effectiveApiKey = providerOverride?.apiKey ?? config.apiKey;
  const effectiveBaseUrl = providerOverride?.baseUrl ?? config.baseUrl;
  const effectiveProtocol = providerOverride?.apiProtocol ?? config.apiProtocol ?? 'openai-completions';
  const contextWindow = providerOverride?.contextWindow ?? config.contextWindow ?? 128_000;
  const maxTokens = providerOverride?.maxTokens ?? config.maxTokens ?? 8192;

  if (!effectiveApiKey) {
    return { success: false, errorType: 'auth', error: 'API key 未配置', timedOut: false, timedOutDuringCompaction: false, aborted: false, fullResponse: '', toolCalls: [] };
  }

  // 系统提示
  const systemPrompt = buildSystemPrompt(config);

  // 工具池
  const toolSafety = new ToolSafetyGuard();
  const kernelTools = buildKernelTools({
    builtinContextWindow: contextWindow,
    evoClawTools: config.tools,
    permissionFn: config.permissionInterceptFn,
    toolSafety,
    auditFn: config.auditLogFn,
    provider: effectiveProvider,
  });

  // 消息历史
  const effectiveMessages = messagesOverride
    ?? (config.messages ?? []).map(m => ({
      id: crypto.randomUUID(),
      role: m.role as 'user' | 'assistant',
      content: [{ type: 'text' as const, text: m.content }],
    }));

  // 追加当前用户消息
  const allMessages = [
    ...effectiveMessages,
    { id: crypto.randomUUID(), role: 'user' as const, content: [{ type: 'text' as const, text: message }] },
  ];

  // ─── Smart Timeout ───
  const timeoutController = new AbortController();
  let isCompacting = false;
  const smartTimeout = createSmartTimeout({
    timeoutMs: 600_000,
    isCompacting: () => isCompacting,
    onTimeout: () => timeoutController.abort('超时'),
  });

  const mergedSignal = abortSignal
    ? AbortSignal.any([abortSignal, timeoutController.signal])
    : timeoutController.signal;

  // 包装 onEvent 以追踪 compaction 状态
  const wrappedOnEvent = (event: RuntimeEvent) => {
    if (event.type === 'compaction_start') isCompacting = true;
    if (event.type === 'compaction_end') isCompacting = false;
    onEvent(event);
  };

  // ─── 构建 QueryLoopConfig ───
  const loopConfig: QueryLoopConfig = {
    protocol: normalizeProtocol(effectiveProtocol),
    baseUrl: effectiveBaseUrl,
    apiKey: effectiveApiKey,
    modelId: effectiveModelId,
    maxTokens,
    contextWindow,
    thinking: thinkLevel !== 'off',
    tools: kernelTools,
    systemPrompt,
    messages: allMessages,
    maxTurns: 50,
    timeoutMs: 600_000,
    onEvent: wrappedOnEvent,
    toolSafety,
    abortSignal: mergedSignal,
  };

  try {
    // ─── 执行 Agent 循环 ───
    const result = await queryLoop(loopConfig);

    // ─── Memory Flush ───
    const totalTokens = result.totalInputTokens + result.totalOutputTokens;
    if (shouldTriggerFlush(totalTokens, contextWindow)) {
      try {
        const flushTools = buildKernelTools({
          builtinContextWindow: contextWindow,
          evoClawTools: config.tools,
          permissionFn: createFlushPermissionInterceptor(),
          toolSafety: new ToolSafetyGuard(),
          auditFn: config.auditLogFn,
          provider: effectiveProvider,
        });
        await queryLoop({
          ...loopConfig,
          tools: flushTools,
          messages: result.messages,
          systemPrompt: systemPrompt + '\n\n' + buildMemoryFlushPrompt(),
          maxTurns: 5,
        });
      } catch { /* flush 失败不阻塞 */ }
    }

    return {
      success: true,
      timedOut: false, timedOutDuringCompaction: false, aborted: false,
      messagesSnapshot: result.messages.map(toMessageSnapshot),
      fullResponse: result.fullResponse,
      toolCalls: result.toolCalls,
    };
  } catch (err) {
    if (smartTimeout.timedOut) {
      return { success: false, errorType: 'timeout', error: '超时', timedOut: true, timedOutDuringCompaction: smartTimeout.timedOutDuringCompaction, aborted: false, fullResponse: '', toolCalls: [] };
    }
    if (abortSignal?.aborted || isAbortError(err)) {
      return { success: false, errorType: 'abort', error: '中止', timedOut: false, timedOutDuringCompaction: false, aborted: true, fullResponse: '', toolCalls: [] };
    }
    const classified = classifyError(err);
    return { success: false, errorType: classified.type, error: classified.message, timedOut: false, timedOutDuringCompaction: false, aborted: false, fullResponse: '', toolCalls: [] };
  } finally {
    smartTimeout.clear();
  }
}
```

**移除的 PI 代码** (全部):
- `import('@mariozechner/pi-ai')` / `import('@mariozechner/pi-coding-agent')`
- `piAi.registerBuiltInApiProviders()`
- `piCoding.AuthStorage.inMemory()` / `SessionManager` / `SettingsManager` / `ModelRegistry`
- `piCoding.DefaultResourceLoader` + `resourceLoader.reload()`
- `piCoding.createAgentSession()`
- `session.agent.streamFn = piAi.streamSimple`
- `session.agent.setSystemPrompt()` + `_rebuildSystemPrompt` hack
- `session.subscribe()` 事件订阅
- `session.prompt()` 调用
- `session.abort()` / `session.dispose()`
- `process.exit` 拦截/恢复
- `process.chdir()` 切换
- `ensureUsageOnAssistantMessages()`
- `PI_CODING_AGENT_DIR` 环境变量
- `extractMessagesSnapshot()` (PI session 内部消息提取)

### 7.2 `embedded-runner-tools.ts` — 大幅简化

**移除**:
- `buildPIBuiltInTools()` — 替换为 kernel builtin-tools
- `wrapPITool()` — 不再有 4 参签名
- `createToolXmlFilter()` — kernel 不产生 XML
- `PIToolResult` 类型

**保留**:
- `createEnhancedExecTool()` — kernel/tool-adapter 引用
- `AuditLogEntry` 类型 — 审计接口

**删除 `runGuards()` + `postProcess()`** — 逻辑已在 `tool-adapter.ts` 中

### 7.3 其他修改

| 文件 | 变更 |
|------|------|
| `pi-provider-map.ts` | **删除** |
| `adaptive-read.ts` | **删除** (逻辑迁入 `kernel/builtin-tools.ts`) |
| `routes/doctor.ts` | 移除 PI 可用性检查 |
| `embedded-runner-errors.ts` | 更新错误消息正则 (API 原生 vs PI 包装) |
| `package.json` | 移除 3 个 PI 依赖 |
| `CLAUDE.md` | 更新架构描述，移除 PI 引用 |

### 不变文件
- `embedded-runner.ts` — 入口
- `embedded-runner-loop.ts` — 外层重试循环 (AttemptResult 兼容)
- `embedded-runner-prompt.ts` — 系统提示
- `embedded-runner-timeout.ts` — Smart timeout
- `types.ts` — RuntimeEvent/AttemptResult/AgentRunConfig 不变
- `tool-safety.ts`, `schema-adapter.ts`, `llm-client.ts`
- `sub-agent-spawner.ts` — 调用 `runEmbeddedAgent()` (入口不变)
- `lane-queue.ts`, `agent-manager.ts`, `agent-builder.ts`

---

## Phase 8: 测试

### 新建测试
| 测试文件 | 覆盖范围 |
|---------|---------|
| `__tests__/kernel/stream-parser.test.ts` | SSE 解析: partial chunk, 双格式, [DONE], 空行 |
| `__tests__/kernel/stream-client.test.ts` | mock fetch: 请求构建 (双协议), 看门狗, 非流式回退 |
| `__tests__/kernel/query-loop.test.ts` | 多轮循环, 正常结束, 工具调用, max_turns, 413恢复 |
| `__tests__/kernel/streaming-tool-executor.test.ts` | 并发/串行分区, 流中预执行, 超时 |
| `__tests__/kernel/context-compactor.test.ts` | 三层压缩阈值, snip保留策略, autocompact模板 |
| `__tests__/kernel/builtin-tools.test.ts` | read (cat -n格式, 图片, 大文件), write, edit (唯一性), grep, find, ls |
| `__tests__/kernel/tool-adapter.test.ts` | EvoClaw→KernelTool适配, 权限/安全集成 |

### 更新测试
- `__tests__/embedded-runner.test.ts` — 移除 PI mock
- `__tests__/error-recovery.test.ts` — 更新错误消息模式

---

## 实施依赖图

```
Phase 1: types + stream-parser + stream-client          ← 基础，无依赖
Phase 2: builtin-tools + tool-adapter                   ← 可与 Phase 1 并行
Phase 3: streaming-tool-executor                        ← 依赖 Phase 1 types
Phase 4: query-loop                                     ← 依赖 Phase 1 + 3
Phase 5: context-compactor                              ← 依赖 Phase 1 (可与 4 并行)
Phase 6: error-recovery                                 ← 可与 Phase 4-5 并行
Phase 7: 集成 (重写 attempt + 简化 tools + 删除 PI)      ← 依赖全部
Phase 8: 测试                                           ← 每个 Phase 完成后持续进行
```

**并行机会**: Phase 1+2 并行 / Phase 4+5+6 并行

---

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| OpenAI tool_calls 增量 JSON | 参数解析失败 | `ToolCallAccumulator` 缓冲，`finish_reason: 'tool_calls'` 时 parse |
| read 工具输出格式差异 | 模型行为偏移 | 严格匹配 PI 的 `cat -n` 格式 `{行号}\t{内容}` |
| Token 估算不准 (chars/4) | 过早/过晚压缩 | 优先用 API `usage` 字段，chars/4 仅作首次估算 |
| 413 错误格式变化 | 无法识别 overflow | 同时检测 HTTP 413 + body `prompt_too_long` |
| Memory Flush 二次调用 | 耦合 PI session | 独立 `queryLoop()` 调用，传入精简工具集 |
| 流式看门狗误触发 | 中断正常长思考 | thinking_delta 事件也重置看门狗 |
| Anthropic baseUrl 路径 | `/v1` 拼接错误 | 复用 `llm-client.ts` 中已有的 `/v1` 自动补全逻辑 |

---

## 验证方案

每个 Phase 的验收标准:

| Phase | 验收标准 |
|-------|---------|
| 1 | Anthropic + OpenAI SSE 流式解析正确，看门狗触发回退 |
| 2 | read/write/edit/grep/find/ls 输出格式与 PI 一致 |
| 3 | 并发安全工具在流中预执行，串行工具按顺序 |
| 4 | 多轮对话 + 工具调用 + 正常终止 |
| 5 | 200+ 轮对话后上下文不溢出 |
| 6 | 413/429/401 错误正确分类，外层循环恢复正常 |
| 7 | 完整 E2E: Anthropic (claude-sonnet) + OpenAI-compatible (通义千问) |
| 8 | vitest 覆盖率 ≥80% |

---

## 文件清单

### 新建 (10 文件)
```
packages/core/src/agent/kernel/index.ts
packages/core/src/agent/kernel/types.ts
packages/core/src/agent/kernel/stream-parser.ts
packages/core/src/agent/kernel/stream-client.ts
packages/core/src/agent/kernel/streaming-tool-executor.ts
packages/core/src/agent/kernel/query-loop.ts
packages/core/src/agent/kernel/context-compactor.ts
packages/core/src/agent/kernel/builtin-tools.ts
packages/core/src/agent/kernel/tool-adapter.ts
packages/core/src/agent/kernel/error-recovery.ts
```

### 重写 (1 文件)
- `embedded-runner-attempt.ts` — 534行 → ~150行

### 大幅修改 (1 文件)
- `embedded-runner-tools.ts` — 移除 PI 相关代码

### 小幅修改 (2 文件)
- `embedded-runner-errors.ts` — 更新错误正则
- `routes/doctor.ts` — 移除 PI 检查

### 删除 (3 文件)
- `pi-provider-map.ts`
- `adaptive-read.ts` (逻辑迁入 builtin-tools)
- PI npm 依赖 (package.json)
