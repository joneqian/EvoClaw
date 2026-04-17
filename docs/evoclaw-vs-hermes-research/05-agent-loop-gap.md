# 05 — Agent 主循环 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/05-agent-loop.md`（977 行，含 +1651 行 ADDENDUM）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`run_agent.py` ~11,462 行
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16）
> **综合判定**: 🟡 **部分覆盖，含多项 🟢 反超**

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes `AIAgent.run_conversation()`**（`run_agent.py:8102-11230`，~3100 行含 retry/fallback 重组） — 项目的"灵魂函数"，6 种入口（CLI / Gateway / ACP / MCP / Batch / RL）都构造一个 `AIAgent` 并调用此函数。ADDENDUM（基线 `b87d0028 → 00ff9a26` 间 +1651 行）重点补齐了**活动心跳 / 工具执行分路径 / 压缩后 retry 重置 / primary runtime 恢复**四大类。

**EvoClaw `queryLoop(config)`**（`packages/core/src/agent/kernel/query-loop.ts:340-697`，770 行，明确声明"参考 Claude Code query.ts while(true) + state 模式"——见 `query-loop.ts:17-23` 注释） — Sidecar 作为内嵌 runtime（`embedded-runner-*.ts`）调用 `queryLoop` 处理单次对话。状态以**不可变 LoopState + transition 标记**驱动，比 hermes 的命令式赋值风格更干净。

**量级对比**: hermes 主循环代码约为 EvoClaw 的 4×（3100 vs 770 行）。差距主要来自 hermes 的多 provider 兼容分支（Codex Responses / Bedrock Converse / Moonshot reasoning_content / OpenRouter cache_control 等），而 EvoClaw 用**双协议**（Anthropic Messages + OpenAI Chat Completions）+ 国产模型走 `openai-completions + 自定义 baseUrl` 策略统一入口，业务代码大幅收敛。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 主循环骨架 | 🟢 | 同构；EvoClaw state 不可变更干净 |
| §3.2 | 预算机制 | 🔴 | EvoClaw 无跨 session 共享的 IterationBudget，subagent 场景可能超配额 |
| §3.3 | 流式调用 / 活动保活 | 🔴 | EvoClaw 仅 90s idle watchdog，无主动 30s 心跳，长任务 gateway 假超时风险 |
| §3.4 | Reasoning / Thinking Block | 🟢 | **反超**：thinking_signature 内建，hermes 通过 PR #6112 才引入 |
| §3.5 | 工具分发并发策略 | 🟡 | EvoClaw 依赖工具级 concurrencySafe 标记，缺 hermes 的 path 重叠检测和破坏性正则 |
| §3.6 | 错误恢复与 Fallback | 🟡 | 模型级 fallback 同构，但 EvoClaw 无 credential rotation，hermes 无 max_output_tokens 恢复 |
| §3.7 | Credential 管理 | 🔴 | 完全无 CredentialPool、多 key 轮换、OAuth 刷新、非 ASCII 清理 |
| §3.8 | 压缩策略 | 🟢 | **反超**：三层 Snip/Microcompact/Autocompact + 6 阶段折叠状态机 vs hermes 单层 threshold+ratio |
| §3.9 | 413 / max_output_tokens 恢复 | 🟢 | **反超**：EvoClaw 三阶段 413 恢复 + max_output_tokens 升级 + Resume 消息注入，hermes 均无 |
| §3.10 | Session 持久化 / Trajectory | 🟡 | per-turn vs batch 时机差异；ShareGPT JSONL 格式 EvoClaw 无 |
| §3.11 | Stop Hook / Tombstone / Checkpoint | 🟢 | **反超** Stop Hook + Tombstone；🔴 缺 Checkpoint 工具级回滚 |
| §3.12 | Cache 监控 / 断点追踪 | 🟢 | **反超**：PromptCacheMonitor + cacheBreakpointIndex，hermes 无对应 |
| §3.13 | 工具摘要 | 🟡 | 取向不同：EvoClaw 异步 LLM 摘要面向 UI；hermes `save oversized` 面向上下文节省 |
| §3.14 | 达 maxTurns / 预算耗尽处理 | 🟡 | EvoClaw Grace Nudge 是"续行"语义；hermes `_handle_max_iterations` 是"收尾摘要"语义 |
| §3.15 | Agent-level 工具拦截 | 🟢 | EvoClaw 统一 KernelTool 接口，无 hermes 6 层 if/elif 包袱 |

**统计**: 🔴 3 / 🟡 6 / 🟢 6（其中 5 项反超）。

---

## 3. 机制逐条深度对比

每条同时给出 **hermes 实现**（带源码行号）+ **EvoClaw 实现**（带源码行号）+ **判定与分析**。

### §3.1 主循环骨架

**hermes**（`run_agent.py:8444+` 基线 L7354）—— 双重约束 + 固定 5 步顺序:
```python
while api_call_count < self.max_iterations and self.iteration_budget.remaining > 0:
    if self._interrupt_requested: break       # 1. 中断
    api_call_count += 1                        # 2. 计数先加
    if not self.iteration_budget.consume(): break  # 3. 消费
    messages, _ = self._compress_context(...)  # 4. 压缩预检
    # 5. 内层 retry 循环 (见 §3.6)
```
关键不变量：`api_call_count += 1` 必须在 consume 之前（L7366/L8444），否则 max_iterations 含义错位。

**EvoClaw**（`query-loop.ts:380-696`）—— immutable state + 前置检查:
```typescript
while (true) {
  if (config.abortSignal?.aborted) { exitReason = 'abort'; return buildResult(); }
  if (state.turnCount >= config.maxTurns) { exitReason = 'max_turns'; return buildResult(); }
  if (state.turnCount > 0) {
    collapseState = await maybeCompressPhased(state.messages, config, collapseState);
  }
  // ... streamOneRound / 工具处理 / 附件 / 工具后压缩
  state = { ...state, turnCount: state.turnCount + 1 };
}
```
关键不变量：`turnCount` 在 assistant 消息被 append 之后才递增（`query-loop.ts:508`），保证中断时 `buildResult` 的 turn 计数反映的是**实际完成**的轮数。

**判定 🟢**：骨架同构（外层 while + 中断 + 压缩 + API + 工具 + 退出），EvoClaw 用不可变 state + transition 字段（`'tool_use' | 'overflow_retry' | 'model_fallback' | 'stop_hook_blocking' | 'max_tokens_recovery' | 'token_budget_continue' | null`）记录每次状态转换原因，**调试可追溯性强于 hermes**。

---

### §3.2 预算机制

**hermes**（`run_agent.py:170-211`，ADDENDUM 微调到 L170-212） — `IterationBudget` 线程安全:
```python
class IterationBudget:
    def __init__(self, max_total: int):
        self.max_total = max_total
        self._used = 0
        self._lock = threading.Lock()
    def consume(self) -> bool:
        with self._lock:
            if self._used >= self.max_total: return False
            self._used += 1; return True
    def refund(self) -> None:      # execute_code 内部 RPC 不计数
        with self._lock:
            if self._used > 0: self._used -= 1
```
双层约束：
- `max_iterations`（默认 90）—— **本次对话**上限
- `IterationBudget` —— **整个会话**上限，subagent 共享（主 agent 和 spawn 的子 agent 共享同一 budget 实例）
- `refund()` 在 `execute_code` 工具内部 RPC 调用时触发（L8722, L9113），这些内部调用不消耗用户可见配额

**EvoClaw**（`query-loop.ts:387-391, 595-615`）—— 单重约束 + Token Budget 回调:
```typescript
if (state.turnCount >= config.maxTurns) { exitReason = 'max_turns'; return buildResult(); }
// ...
if (config.tokenBudget) {
  const decision = config.tokenBudget(state.turnCount, totalInput, totalOutput);
  if (decision.action === 'continue' && decision.nudgeMessage) {
    state.messages.push({ /* 注入 nudgeMessage */ });
    continue;  // 续行
  }
  if (decision.action === 'stop' && decision.stopReason === 'budget_exhausted') {
    exitReason = 'token_budget_exhausted'; return buildResult();
  }
}
```

预算管理设计:
- `maxTurns` 是**调用方传入**的单轮对话上限，**不跨 subagent 共享**
- `config.tokenBudget` 是回调式的 **token** 预算（非 iteration count）
- `grep -r "IterationBudget\|iterationBudget\|iteration_budget" packages/core/src` 零结果

**判定 🔴**：EvoClaw 缺失"跨 session 共享的 iteration 计数器"。CLAUDE.md 声称"Lane Queue main(4) / subagent(8) / cron"是**并发控制**，不是**配额共享**——它限制的是同时运行的 agent 数，而不是 agent 间共享的 iteration 次数。subagent 场景（`spawn_agent`）下，每个子 agent 可以消耗完自己的 `maxTurns`，没有全局上限保护。

---

### §3.3 流式调用与活动保活

**hermes** — 三通道保活:
- `_touch_activity()` at L3097（ADDENDUM 新增）—— 每次 API 调用起始触发
- 流式循环内每个 delta 更新 `last_chunk_time` —— 自然心跳
- 并发工具执行时每 30s polling —— 强制心跳
- 目的：防 gateway（Telegram/Discord/Slack）对长任务假超时断开

流式入口 `_interruptible_streaming_api_call`（`run_agent.py:4379+` 旧基线，ADDENDUM 迁移后 L4940-5095）有 3 个 `_fire_*` delta 回调:
- `_fire_stream_delta`（L4331） → `stream_delta_callback` + `_stream_callback`
- `_fire_reasoning_delta`（L4347） → `reasoning_callback`（Anthropic thinking）
- `_fire_tool_gen_started`（L4357） → `tool_gen_callback`（工具名开始组装）

另有 2 个独立 callback（**不走 streaming 管线**）：`thinking_callback`（spinner 更新）、`step_callback`（session 级进度）。

**EvoClaw** — 被动 watchdog 无主动心跳:

`packages/core/src/agent/kernel/stream-client.ts:38-92` 两级 watchdog:
```typescript
const STREAM_IDLE_TIMEOUT_MS = 90_000;        // 90s 空闲超时
const STREAM_IDLE_WARNING_MS = STREAM_IDLE_TIMEOUT_MS / 2;  // 45s 警告
const NONSTREAMING_FALLBACK_TIMEOUT_MS = 300_000;  // 非流式回退 300s

function createIdleWatchdog(timeoutMs, onTimeout): IdleWatchdog {
  return {
    reset() { /* 每个 delta 调用，重置 timer */ },
    clear() { /* 流结束清理 */ },
  };
}
```

事件回调统一走 `config.onEvent(event: RuntimeEvent)`（`query-loop.ts:414` 等处），事件类型含 `text_delta / thinking_delta / tool_start / tool_end / message_start / message_end / tombstone / ...`。

`grep -rn "heartbeat\|touchActivity\|_touchActivity" packages/core/src/agent/kernel` 零结果。

**判定 🔴**：EvoClaw 有 watchdog 但**无主动心跳**。企业场景当前用 webhook 短连接（飞书/企微），Channel 层通过异步处理规避了 webhook 5s 超时。但未来若接入长连接 gateway（如 Telegram Bot API 长轮询、WebSocket stream）或 Gateway 有中间代理层（企业内网反代）会发生 idle 断连。工具执行期间（例如 LLM 已返回 tool_use，Sidecar 正在跑 30s 长工具）也无心跳。

---

### §3.4 Reasoning / Thinking Block

**hermes** — provider-specific 字段分流:

消息侧（`run_agent.py:7437-7446`）:
```python
if msg.get("role") == "assistant":
    reasoning_text = msg.get("reasoning")
    if reasoning_text:
        api_msg["reasoning_content"] = reasoning_text   # Moonshot / Novita / OpenRouter
if "reasoning" in api_msg:
    api_msg.pop("reasoning")    # 移除 hermes 内部字段
```

响应侧（`_build_assistant_message` L5743+）聚合 `reasoning_parts` → `reasoning`（内部 str）/ `reasoning_content`（API 字段）/ `reasoning_details`（SessionDB JSON）/ `codex_reasoning_items`（Codex 格式）**4 套字段**。

Anthropic thinking block **signature** 必须跨轮保持才能复用 cache —— 通过 RELEASE_v0.8.0 PR #6112 "smart thinking block signature management" 才引入，在 `agent/anthropic_adapter.py` 中处理。

**EvoClaw** — 统一 content block 模型:

`query-loop.ts:230-247`:
```typescript
case 'thinking_delta':
  appendOrCreateThinkingBlock(blocks, event.delta);
  break;
case 'thinking_signature': {
  // 将 signature 附加到最后一个 thinking 块（Anthropic 要求后续轮次回传）
  const lastBlock = blocks[blocks.length - 1];
  if (lastBlock && lastBlock.type === 'thinking') {
    (lastBlock as ThinkingBlock).signature = event.signature;
  }
  break;
}
case 'redacted_thinking':
  // 已编辑思考块 — 原样存入 content blocks，后续轮次回传给 API
  blocks.push({ type: 'redacted_thinking' as const, data: event.data });
  break;
```

- thinking 块天然在 `content: ContentBlock[]` 里（类型见 `packages/core/src/agent/kernel/types.ts` ThinkingBlock），**不需要 side-channel 字段**
- signature 跨轮保持**自 Sprint 15.8 起内建**（早于 hermes PR #6112）
- redacted_thinking 原样透传

**判定 🟢 反超**:
- Signature 跨轮保持 EvoClaw 内建在 stream 事件处理里，不需要额外的 adapter 层
- 统一 content block 模型避免了 hermes 的 4 套 reasoning 字段分流（`reasoning` / `reasoning_content` / `reasoning_details` / `codex_reasoning_items`）

**代价**：EvoClaw 若未来接入 Moonshot / Novita / OpenRouter 的 `reasoning_content` 字段（注意这不是 Anthropic thinking，是另一类 provider 的非标字段），需要在 stream-client.ts 做 provider-specific 序列化，不能直接用 content block 模型。目前 EvoClaw 只支持双协议（Anthropic + OpenAI Chat Completions），未触碰此问题。

---

### §3.5 工具分发并发策略

**hermes**（`run_agent.py:214-336` 模块级常量 + `_execute_tool_calls` L7158-7180 分发器）—— 多维白/黑名单:

```python
_NEVER_PARALLEL_TOOLS = frozenset({"clarify"})                    # L216
_PARALLEL_SAFE_TOOLS = frozenset({                                 # L219
    "ha_get_state", "ha_list_entities", "ha_list_services",
    "read_file", "search_files", "session_search",
    "skill_view", "skills_list", "vision_analyze",
    "web_extract", "web_search",
})
_PATH_SCOPED_TOOLS = frozenset({"read_file", "write_file", "patch"})  # L234
_MAX_TOOL_WORKERS = 8                                              # L237
_DESTRUCTIVE_PATTERNS = re.compile(r"""...rm\s|mv\s|sed -i|...""") # L240
_REDIRECT_OVERWRITE = re.compile(r'[^>]>[^>]|^>[^>]')              # L253
```

`_should_parallelize_tool_batch(tool_calls)`（L267-308）:
1. `len <= 1` → 顺序
2. 任一在 `_NEVER_PARALLEL_TOOLS` → 顺序
3. 每个必须要么在 `_PARALLEL_SAFE_TOOLS`，要么是 `_PATH_SCOPED_TOOLS` 且 path 无重叠（`_paths_overlap` 基于 `Path.parts` 前缀比较）

ADDENDUM 后拆分为两条独立路径：
- `_execute_tool_calls_concurrent`（L7293） — ThreadPoolExecutor max 8，含 heartbeat polling
- `_execute_tool_calls_sequential`（L7531） — 顺序执行，中断时为剩余 tool_calls append 占位 `{"role":"tool", "content":"cancelled..."}` 消息（否则 OpenAI 下轮拒绝）

**EvoClaw**（`query-loop.ts:416, 623-627` + `streaming-tool-executor.ts`）—— 工具级自声明 + 统一执行器:

```typescript
// query-loop.ts:416
const executor = new StreamingToolExecutor(config.tools, 8, config.abortSignal);
// 流中预执行：每个工具自带 concurrencySafe 标记（KernelTool.concurrencySafe）
// 流结束后统一收集
const toolResults = await executor.collectResults({ onEvent: config.onEvent, signal: config.abortSignal });
```

- `StreamingToolExecutor` 固定并发 8（对标 hermes `_MAX_TOOL_WORKERS`）
- 并发安全由**工具自声明** `KernelTool.concurrencySafe`（见 `packages/core/src/agent/kernel/builtin-tools.ts` 各工具 concurrencySafe 字段）
- **流式预执行**：LLM 流还在生成 text_delta 时，Tool use 一完成就并发执行（CLAUDE.md L64）
- 中断时 `ensureToolResultPairing(state.messages)`（`query-loop.ts:371`，实际在 `message-utils.ts`）为未配对的 tool_use 补占位 tool_result

**判定 🟡**：
- 并发控制 **粗粒度有**（concurrencySafe 标记）但**细粒度缺失**:
  - ❌ 无 hermes 的 path 重叠检测（两个 write_file 到同一子树会并发执行）
  - ❌ 无 `_DESTRUCTIVE_PATTERNS` 正则（rm -rf 等通过 concurrencySafe=false 阻止并发，但不阻止执行）
  - ❌ 无 `_NEVER_PARALLEL_TOOLS` 显式清单（clarify 等交互工具应永远顺序）
- 设计差异：EvoClaw 是**工具自治**（每个工具自己声明是否并发安全），hermes 是**中心策略**（主循环侧维护白黑名单）。EvoClaw 模式对新增工具更友好，hermes 模式对集中审计更友好。

**具体风险案例**: 
- 模型一次生成 `[write_file("a/b/c.txt"), write_file("a/b/d.txt")]`，两者 concurrencySafe 都为 true（写不同文件），但如果**二者其实指向同一 inode 的不同路径名**（符号链接场景），hermes 的 path 重叠检测能捕捉前缀相同，EvoClaw 会并发执行产生竞态。

---

### §3.6 错误恢复与 Fallback

**hermes**（`run_agent.py:7544-8655` 旧基线，ADDENDUM 后 L8655-10200）:

单轮 API 调用外包 3 次 retry:
```python
retry_count = 0
max_retries = 3
while retry_count < max_retries:
    try:
        response = self._interruptible_streaming_api_call(...)
        if not _looks_valid(response):
            if self._try_activate_fallback():
                retry_count = 0                           # 切 provider 重置
                continue
            retry_count += 1
            time.sleep(jittered_backoff(retry_count))     # 5s → 120s 指数退避
            continue
        break
    except Exception as api_error:
        retry_count += 1
        # 429 → fallback / 413 → 压缩提示 / credential → 刷新
        time.sleep(jittered_backoff(retry_count))
```

- `_try_activate_fallback`（L4924-5058 旧） — `self._fallback_chain[self._fallback_index]` 切换 provider，成功 `_fallback_index += 1`
- `_restore_primary_runtime`（L5989 新 ADDENDUM） — fallback 恢复为**单轮作用域**：某次 API 成功后下一次又用主 provider，不再永久卡在 fallback
- `jittered_backoff(attempt, base_delay=5.0, max_delay=120.0)`（`agent/retry_utils.py:19-57`）:
  - 1-based attempt，实际指数 `2^(attempt-1)`
  - jitter `uniform(0, 0.5 * delay)`
  - 独立 seed（`time.time_ns() ^ counter`）解相关 thundering herd

**ADDENDUM 关键更新**：**压缩后重置 retry_count = 0**，防止压缩前失败次数 carry over 误判。

**EvoClaw**（`query-loop.ts:437-504`）:

单一 try-catch 三阶段恢复:
```typescript
try {
  roundResult = await streamOneRound(config, state.messages, executor, state.effectiveMaxTokens, modelOverride);
  state = { ...state, overflowRetries: 0 };
} catch (err) {
  const classified = classifyApiError(err);
  // 413 overflow 三阶段
  if (isRecoverableInLoop(classified) && state.overflowRetries < MAX_OVERFLOW_RETRIES /* = 3 */) {
    if (nextOverflowRetries === 1) {
      const collapsed = contextCollapseDrain(state.messages);   // 零 API 成本
      if (collapsed) { /* 继续 */ continue; }
    }
    if (nextOverflowRetries <= 2) {
      await maybeCompress(state.messages, config);              // LLM 摘要
      continue;
    }
    // 第 3 次：PTL 紧急降级
    const truncated = truncateHeadForPTLRetry(state.messages);
    if (truncated) { /* 覆写 state.messages */ continue; }
  }
  // 模型 fallback (一次性)
  if (config.fallbackModel && !fallbackActivated && isFallbackTrigger(classified)) {
    fallbackActivated = true;
    await config.onEvent({ type: 'tombstone', timestamp: Date.now() });   // UI 丢弃 partial
    state = { ...state, effectiveModelId: config.fallbackModel.modelId, transition: 'model_fallback' };
    continue;
  }
  throw err;
}
```

- `fallbackActivated: boolean` 是**持久**的（本轮对话内不会再切回），与 hermes 旧版行为一致；**ADDENDUM 新增的 `_restore_primary_runtime` 单轮作用域恢复 EvoClaw 无对应**
- 无外层 `max_retries` 控制（依赖 `stream-client` 内部 watchdog + EventSource 重连）
- 无 `jittered_backoff`（但有 `stream-client.ts:42 NONSTREAMING_FALLBACK_TIMEOUT_MS = 300_000` 作为非流式最大等待）

**判定 🟡**：
- 🟢 EvoClaw 的 413 三阶段（Collapse Drain → 完整压缩 → PTL 降级）比 hermes 精细
- 🟢 Tombstone 事件（`query-loop.ts:495`）UI 一致性保护 hermes 无
- 🔴 无 credential 级 rotation（所以 key 过期 / 非 ASCII 崩溃都会直接 throw）
- 🔴 fallback 不自动恢复主 provider（长对话内可能一直卡在 fallback 模型）
- 🔴 无 jittered_backoff 防 thundering herd（多 session 并发 retry 可能同时打满）

---

### §3.7 Credential 管理

**hermes**（`agent/credential_pool.py:86-886`）—— 800 行完整实现:

```python
class CredentialPool:
    # 4 种选择策略
    FILL_FIRST: 用尽一个再换下一个
    ROUND_ROBIN: 轮转
    RANDOM: 随机
    LEAST_USED: 最少使用

    # 关键方法
    def select(...) -> Credential      # 选下一个可用 key
    def mark_exhausted_and_rotate(key) # 标记失效 + 600s 冷却
    def refresh_oauth(cred)             # Anthropic ↔ ~/.claude/.credentials.json 同步

    # 并发支持
    def lease(cred) -> context_manager  # 多线程场景下避免两个请求同用一 key
```

- OAuth 自动刷新（Anthropic token 过期续期）
- 600s 冷却窗口（标记 exhausted 后 10 分钟再尝试）
- 持久化到 `~/.hermes/credential_pool.json`
- 非 ASCII key 清理：加载时 `key.encode('ascii', 'ignore').decode('ascii')`（hermes ADDENDUM 教训：非 ASCII 会让 `requests` / `httpx` 的 latin-1 header 编码崩溃）

**EvoClaw**（`packages/core/src/provider/model-fetcher.ts` + `packages/core/src/routes/provider.ts`）:

```typescript
// routes/provider.ts:146-182
registerProvider(id, { apiKey, baseUrl, ... })   // 每 provider 单 key
```

- 无 CredentialPool 抽象
- 无多 key 轮换
- 无 OAuth 自动刷新循环
- 无 ASCII 清理：`buildAuthHeaders(apiKey, kind, baseUrl)` 直接拼接 `Bearer ${apiKey}` 或 `x-api-key: ${apiKey}`
- GLM JWT 认证专门处理（`from id.secret` 生成 JWT）是**特殊 case 逻辑**而非**统一池抽象**

**判定 🔴**：EvoClaw 完全缺失凭据池，属于企业生产的硬伤:
- 单 key 耗尽即中断请求（无 fallback）
- 429 rate limit 只能单次重试，无跨 key 规避
- Anthropic OAuth token 过期需用户手动更新
- 国产模型用户粘贴带中文空格 / 全角标点的 key 会触发 `ERR_HTTP_INVALID_HEADER_VALUE`

**与 §3.6 的关系**：hermes `_try_activate_fallback` 是**模型/provider 级** fallback（切到另一家模型），CredentialPool 是**凭据级** rotation（同一 provider 多 key 轮换）。EvoClaw 只有前者。

---

### §3.8 压缩策略

**hermes**（`agent/context_compressor.py:28-50` + `run_agent.py:6063-6170` 旧 / L7042-7157 新）— 单层策略:

```python
class ContextCompressor:
    threshold_percent: float = 0.8       # 达到 80% 上下文触发
    summary_target_ratio: float = 0.3    # 压缩到 30% 目标
```

流程: 预检 → 剪枝 → 边界对齐 → LLM 摘要 → 重组。ADDENDUM 新增 `_emit_context_pressure("Compacting context: 45%...")` 反馈 + 压缩后重置 retry_count。

**EvoClaw**（`packages/core/src/agent/kernel/context-compactor.ts:37-78`）— 三层 + 6 阶段状态机:

```typescript
const TOKEN_THRESHOLDS = {
  warning: 0.90,       // UI 警告
  autoCompact: 0.93,   // 触发自动压缩
  hardLimit: 0.99,     // 阻断输入
};
const AUTOCOMPACT_BUFFER_TOKENS = 13_000;
const MAX_CONSECUTIVE_FAILURES = 3;    // 熔断器
const SNIP_KEEP_RECENT = 8;
const MICROCOMPACT_TRUNCATE_THRESHOLD = 5_000;  // 5KB tool_result
const PROACTIVE_SNIP_THRESHOLD = 0.91;

export type CollapsePhase =
  | 'normal'          // < 90%
  | 'warning'         // 90-91%
  | 'proactive_snip'  // 91-93% 主动 snip（不等 413）
  | 'autocompact'     // 93%+ 完整压缩
  | 'emergency'       // 413 后
  | 'exhausted';      // 多次 emergency 仍失败
```

三层:
- **Layer 1 Snip**（零成本）: 移除最旧非关键消息，保留首 + 最后 8 条
- **Layer 2 Microcompact**（零成本）: 截断 >5KB 的 tool_result，头/尾 7:3 保留
- **Layer 3 Autocompact**（1 次 LLM 调用）: 9 段结构化摘要 + 熔断器 3 次失败停止

**Shadow Microcompact**（`query-loop.ts:128-152 applyDeferredTruncation`）— EvoClaw 独创:
- 原消息 content **不变**（保护 Anthropic Prompt Cache 稳定字节）
- 仅在 `streamOneRound` 发送 API 时创建截断副本（`msg.microcompacted` 标记，见 `query-loop.ts:203-206`）

**判定 🟢 反超**:
- EvoClaw 三层分级比 hermes 单层 threshold+ratio 精细
- Shadow Microcompact 的 cache-aware 设计 hermes 无
- 6 阶段折叠状态机 (normal → warning → proactive_snip → autocompact → emergency → exhausted) 可观测性强

**细节见后续章节**: 本章只涉及"主循环如何调用压缩"，压缩内部机制见 `08-context-compression-gap.md`。

---

### §3.9 413 / max_output_tokens 恢复

**hermes** — 无分层:
- 413 payload too large：retry 重试 + 提示用户压缩
- `max_output_tokens` 耗尽：简单 `break` 退出循环

**EvoClaw**（`query-loop.ts:440-481, 568-593`）:

**413 三阶段**（`state.overflowRetries < MAX_OVERFLOW_RETRIES = 3`）:
1. 第 1 次：`contextCollapseDrain(state.messages)` — 零 API 成本轻量折叠
2. 第 2 次：`maybeCompress(state.messages, config)` — 完整 LLM 摘要
3. 第 3 次：`truncateHeadForPTLRetry(state.messages)` — PTL 紧急降级（按轮次分组精确删除）

**max_output_tokens 恢复**（`state.maxOutputRecoveryCount < MAX_OUTPUT_RECOVERY_LIMIT`）:
```typescript
if (roundResult.stopReason === 'max_tokens' && ...) {
  if (nextRecoveryCount === 1 && state.effectiveMaxTokens < ESCALATED_MAX_TOKENS /* 64_000 */) {
    state = { ...state, effectiveMaxTokens: ESCALATED_MAX_TOKENS, ... };
    log.info(`max_output_tokens 恢复: 升级到 ${ESCALATED_MAX_TOKENS} tokens`);
  } else {
    // 后续次数：注入 Resume 消息 MAX_OUTPUT_RECOVERY_MESSAGE
  }
  state.messages.push({ role: 'user', content: [{ type: 'text', text: MAX_OUTPUT_RECOVERY_MESSAGE }], isMeta: true });
  continue;
}
```

**判定 🟢 反超**：两类错误 EvoClaw 都有分层恢复，hermes 均无对应。max_output_tokens 自动升级到 64K 的设计对**长 code generation / long prose 场景**特别有价值。

---

### §3.10 Session 持久化与 Trajectory

**hermes**:
- `__init__` 时 `create_session(...)`（L953-973）
- **每次 API 调用后**：`update_token_counts(...)`（L8023） — 细粒度 token 统计
- **循环结束后**：`_flush_messages_to_session_db(...)`（L1927 / L2431-2443） — 批量 flush 所有 messages
- 可选 `_save_trajectory(...)`（L2195 / L2712-2726） — ShareGPT JSONL 格式 `trajectory_samples.jsonl`，`_convert_to_trajectory_format` 渲染 `<think>...</think>` 和 `<tool_call>...</tool_call>` XML

**EvoClaw**:
- 每轮 assistant 消息持久化：`config.persister?.persistTurn(state.turnCount, [roundResult.assistantMessage])`（`query-loop.ts:507`）
- 每轮 tool_result 持久化：`config.persister?.persistTurn(state.turnCount, [toolResultMsg])`（`query-loop.ts:634`）
- 循环结束：`config.persister?.finalize()`（`query-loop.ts:366`）
- Trajectory 格式：`conversation_log` 表内部格式，**非 ShareGPT JSONL**
- `conversation_logger.ts` 含 `compaction_status` 字段（'raw' / 'extracted' / 'compacted'）追踪压缩状态

**判定 🟡**:
- 持久化时机：EvoClaw **per-turn** 更及时（断电/崩溃时损失小），hermes **batch** 更高效（少 DB write）。取向不同。
- Trajectory 格式差距 🔴（细节见 `16-trajectory-format-gap.md`）：ShareGPT JSONL 是 RL 训练业界标准，EvoClaw 的内部格式无法直接导入训练框架

---

### §3.11 Stop Hook / Tombstone / Checkpoint

**hermes**:
- **Pre-tool-call hook**（`model_tools.py:488-495`） — `invoke_hook("pre_tool_call", ...)` plugin 系统扩展点
- **CheckpointManager**（ADDENDUM L1164） — 每轮重置检查点，write_file/terminal 前后自动快照，支持回滚
- 无 Tombstone / Post-hook 概念

**EvoClaw**:
- **Stop Hook**（`query-loop.ts:541-565`） — post-hook，每轮无 tool_use 退出前调用:
  ```typescript
  if (config.stopHook) {
    const hookResult = await config.stopHook(roundResult.assistantMessage, state.messages);
    if (hookResult.preventContinuation) { exitReason = 'stop_hook_prevented'; return buildResult(); }
    if (hookResult.blockingErrors.length > 0) {
      state.messages.push({ /* 注入修复提示 */ });
      state = { ...state, transition: 'stop_hook_blocking' };
      continue;
    }
  }
  ```
- **Tombstone 事件**（`query-loop.ts:495`） — 模型 fallback 前广播 `{ type: 'tombstone' }` 让 UI 丢弃本轮 partial delta
- **无 CheckpointManager** — `grep -rn "checkpoint" packages/core/src/agent/kernel` 零结果

**判定**:
- 🟢 **反超** Stop Hook + Tombstone: 方向不同（hermes pre / EvoClaw post），EvoClaw 对"完工前质检"语义（例如输出必须通过 lint 才算完）更友好
- 🔴 缺 **Checkpoint**: 工具错误回滚能力缺失。hermes 的 write_file 失败可回滚到前一快照，EvoClaw 写坏文件只能依赖 `apply_patch` 人工修

---

### §3.12 Cache 监控与断点追踪

**hermes** — 无对应机制。

**EvoClaw**（`query-loop.ts:361, 422-427, 513-525` + `packages/core/src/agent/kernel/prompt-cache-monitor.ts`）:

```typescript
const cacheMonitor = new PromptCacheMonitor();

// 调用前: 记录状态（system prompt / tools / model / thinking）
cacheMonitor.recordPreCallState({ systemPrompt, tools, modelId, thinkingEnabled });

// 调用后: 检测 cache 是否断裂
cacheMonitor.checkForBreak({
  cacheReadTokens: roundResult.usage.cacheReadTokens ?? 0,
  cacheWriteTokens: roundResult.usage.cacheWriteTokens ?? 0,
  ...
});

// 追踪缓存断点（用于缓存感知微压缩）
if (roundResult.usage.cacheWriteTokens > 0) {
  cacheBreakpointIndex = state.messages.length;
  collapseState = { ...collapseState, cacheBreakpointIndex };
}
```

- PromptCacheMonitor 独立类，检测 cache 命中率变化并记录断裂原因
- `cacheBreakpointIndex` 追踪"最后一次成功 cache write 时的 messages 长度"，供 Snip/Microcompact 决定"不能削减断点之前的消息"

**判定 🟢 反超**：Anthropic Prompt Cache 的观测与利用 EvoClaw 做得比 hermes 深。细节见 `07-prompt-system-gap.md` / `08-context-compression-gap.md`。

---

### §3.13 工具摘要

**hermes**（`run_agent.py` 相关 + `tools/tool_result_storage.py`）— **存储维度**:
- PR #5210 `save oversized tool results to file`：超过 `max_result_size_chars` 时保存到文件，给 LLM 只返回文件路径 + 预览
- 目的：**上下文节省**

**EvoClaw**（`query-loop.ts:636-660`）— **UI 可读性维度**:
```typescript
const summaryText = hasErrors
  ? `${toolNames.join(', ')} (${toolResults.length} 次调用, 有错误)`
  : `${toolNames.join(', ')} (${toolResults.length} 次调用)`;
await config.onEvent({ type: 'tool_end', toolName: summaryText, timestamp: Date.now() });

if (config.toolSummaryGenerator) {
  // 异步用低成本 LLM 生成 git-commit-subject 风格摘要
  config.toolSummaryGenerator.generateAsync(summaryTools).then(async llmSummary => {
    if (llmSummary && llmSummary !== summaryText) {
      await config.onEvent({ type: 'tool_end', toolName: llmSummary, ... });
    }
  });
}
```
- 立即发送简单摘要（toolNames + 次数）
- 异步用低成本二级 LLM 生成更好的摘要，覆盖显示
- 目的：**UI 实时反馈 + 后续压缩可用的短摘要**（Sprint 15.10 实装）

**判定 🟡**：两者取向不同，EvoClaw 面向**用户**可读性，hermes 面向**LLM** 上下文节省。两者可互补（理论上 EvoClaw 也该加 oversized 存盘），但这是**不同语义的功能**，不是简单缺失。

---

### §3.14 达 maxTurns / 预算耗尽处理

**hermes** — ADDENDUM 新增"收尾摘要":
- `_handle_max_iterations()`（ADDENDUM L7951）：达 max_iterations 时请求 LLM 生成**最终摘要**而非静默返回
- Budget Grace Call（L8460-8469）：`iteration_budget.remaining == 0` 后允许**一次额外** call 请求摘要

**EvoClaw** — "续行" nudge 语义:
- `state.turnCount >= config.maxTurns` 直接 `return buildResult()` 退出（`query-loop.ts:387-391`），**无摘要**
- `config.tokenBudget` 回调返回 `nudgeMessage` 注入续行（`query-loop.ts:595-615`）:
  ```typescript
  state.messages.push({ role: 'user', content: [{ type: 'text', text: decision.nudgeMessage }], isMeta: true });
  continue;
  ```
- 语义差异：hermes 的 Grace Call 是**收尾**（请求摘要后结束），EvoClaw 的 nudgeMessage 是**续行**（给 LLM 一个提示让它继续干活）

**判定 🟡**：语义相关但不同。EvoClaw 当前方式对"无人值守长任务"合适（让 agent 继续），hermes 的 Grace Call 对"有用户在等最终答案"合适（确保返回摘要而非空响应）。理想状态应两者都有（EvoClaw 可加 `onMaxTurns?: 'break' | 'summarize'` 选项）。

---

### §3.15 Agent-level 工具拦截

**hermes**（`run_agent.py:6194-6266` 旧 / L7181 `_invoke_tool`）—— 6 层 if/elif:
```python
if function_name == "todo": ...                # L6202
elif function_name == "session_search": ...   # L6209 — 必须是第 2 个
elif function_name == "memory": ...            # L6220
elif self._memory_manager and self._memory_manager.has_tool(function_name): ...  # L6241
elif function_name == "clarify": ...           # L6243
elif function_name == "delegate_task": ...    # L6250
else: return handle_function_call(...)        # L6260 fallback 到 registry
```

加上 `_AGENT_LOOP_TOOLS = {"todo", "memory", "session_search", "delegate_task"}`（`model_tools.py`），registry 看到这几个会直接返回 error，因为它们的 dispatch 永远在 AIAgent 层。

**EvoClaw**（`query-loop.ts:416-627` + `streaming-tool-executor.ts`）:
- 所有工具统一经过 `KernelTool` 接口
- `StreamingToolExecutor` 不区分 agent-level vs tool-level
- Memory 工具（memory_search / memory_get / memory_write / ...）注册在 `CORE_TOOLS`（`tool-catalog.ts:32-39`），由 `createEvoClawTools`（`tools/evoclaw-tools.ts`）实现 handler，handler 内部调 `MemoryStore`
- todo_write / spawn_agent 等也都走统一接口

**判定 🟢**：EvoClaw 统一接口设计更干净，无 hermes 的层次包袱（hermes 承认"session_search 必须是第 2 个分支"这种顺序硬编码是设计债）。新增"agent-state-aware"工具只需在 handler 里注入 agent state，无需改主循环。

---

## 4. 建议改造蓝图（不承诺实施）

**P0**（高 ROI，建议尽快）:

| # | 项目 | 对应差距 | 工作量 | ROI | 价值 |
|---|---|---|---|---|---|
| 1 | API Key 非 ASCII 清理 | §3.7 | 0.5d | 🔥🔥 | 国产模型用户粘贴 key 边界防崩溃 |
| 2 | Credential Pool + 多 key 轮换 | §3.7 | 3-4d | 🔥🔥🔥 | 生产高可用根基，429 自动跨 key |
| 3 | 30s 活动心跳 | §3.3 | 1d | 🔥🔥 | Gateway 长任务防假超时 |

**P1**（中等 ROI）:

| # | 项目 | 对应差距 | 工作量 | ROI | 价值 |
|---|---|---|---|---|---|
| 4 | IterationBudget 跨 session 共享 | §3.2 | 1-2d | 🔥 | subagent 全局配额保护 |
| 5 | Path 重叠检测 + 破坏性正则 | §3.5 | 2d | 🔥 | 并发写入竞态边界 |
| 6 | 模型 fallback 单轮作用域恢复 | §3.6 | 1d | 🔥 | 长对话不永久卡 fallback |
| 7 | 达 maxTurns 摘要模式 | §3.14 | 0.5d | 🔥 | 退出语义更完整 |
| 8 | CheckpointManager | §3.11 | 3-5d | 🔥 | 工具错误回滚 |
| 9 | jittered_backoff 防雷群 | §3.6 | 0.5d | 🔥 | 多 session 并发 retry 保护 |

**P2**（长期规划）:

| # | 项目 | 对应差距 | 工作量 |
|---|---|---|---|
| 10 | ShareGPT JSONL Trajectory 导出 | §3.10 | 见 16 章 |
| 11 | oversized tool result 存盘 | §3.13 | 1-2d |

**不建议做**:
- Agent-level 工具 6 层拦截（§3.15）：hermes 的设计债，EvoClaw 统一接口更优
- Reasoning provider-specific 字段分流（§3.4）：架构上不需要

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应 |
|---|---|---|---|
| 1 | Thinking signature 跨轮保持内建 | `query-loop.ts:235-242` | PR #6112 才引入 |
| 2 | 三层压缩 + 6 阶段折叠状态机 | `context-compactor.ts:37-78` | 单层 threshold+ratio |
| 3 | Shadow Microcompact（延迟截断保护 cache） | `query-loop.ts:128-152` | 无，压缩直接改原消息 |
| 4 | 413 三阶段恢复 | `query-loop.ts:440-481` | 无分层 |
| 5 | max_output_tokens 恢复（升级 + Resume 注入） | `query-loop.ts:568-593` | 无（简单 break） |
| 6 | PromptCacheMonitor + cacheBreakpointIndex | `query-loop.ts:361, 513-525` | 无 |
| 7 | Stop Hook（post-hook）+ Tombstone 事件 | `query-loop.ts:541-565, 495` | 仅 pre-hook，无 Tombstone |
| 8 | 不可变 LoopState + transition 追踪 | `query-loop.ts:342-350` | 命令式赋值 |
| 9 | 统一 KernelTool 接口（无 agent-level 层次） | `query-loop.ts:416-627` | 6 层 if/elif 包袱 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（本章所有 `path:line` 均经 Read 工具验证 2026-04-16）

- `packages/core/src/agent/kernel/query-loop.ts:17-23` ✅ 顶部注释（参考 Claude Code query.ts）
- `query-loop.ts:128-152` ✅ applyDeferredTruncation (Shadow Microcompact)
- `query-loop.ts:235-242` ✅ thinking_signature 处理
- `query-loop.ts:340-350` ✅ LoopState 初始化
- `query-loop.ts:380-696` ✅ while(true) 主循环
- `query-loop.ts:416` ✅ StreamingToolExecutor(config.tools, 8, ...)
- `query-loop.ts:440-481` ✅ 413 三阶段恢复
- `query-loop.ts:490-500` ✅ 模型 fallback + Tombstone
- `query-loop.ts:541-565` ✅ Stop Hook
- `query-loop.ts:568-593` ✅ max_output_tokens 恢复
- `query-loop.ts:595-615` ✅ Token Budget nudgeMessage
- `query-loop.ts:636-660` ✅ Tool Use Summary
- `stream-client.ts:38-45` ✅ 90s idle watchdog / 45s warning / 300s nonstreaming fallback
- `stream-client.ts:59-92` ✅ createIdleWatchdog
- `context-compactor.ts:37-78` ✅ TOKEN_THRESHOLDS + CollapsePhase 枚举

### 6.2 hermes 研究引用（章节 §）

- `.research/05-agent-loop.md` §3.2 主循环结构（L87-161）
- `.research/05-agent-loop.md` §3.3 双重预算
- `.research/05-agent-loop.md` §3.4 流式 vs 非流式（`_fire_*` 三回调）
- `.research/05-agent-loop.md` §3.5 Reasoning / Thinking block（4 套字段分流）
- `.research/05-agent-loop.md` §3.6 工具分发顺序 vs 并发（`_should_parallelize_tool_batch`）
- `.research/05-agent-loop.md` §3.8 Agent-level 工具 6 层拦截
- `.research/05-agent-loop.md` §3.9 重试 + fallback + jittered_backoff
- `.research/05-agent-loop.md` §3.10 Session 持久化
- `.research/05-agent-loop.md` §3.11 Trajectory 保存
- `.research/05-agent-loop.md` §4.2 IterationBudget 线程安全实现（L170-211）
- `.research/05-agent-loop.md` §4.3 _execute_tool_calls_sequential 中断保护
- `.research/05-agent-loop.md` §Addendum（activity heartbeat / grace call / _restore_primary_runtime / CheckpointManager / bedrock_converse / reasoning pass-through）

### 6.3 关联差距章节（写后填 link）

本章的配套深入见：

- `06-llm-providers-gap.md` — `_try_activate_fallback` 链、CredentialPool 细节、jittered_backoff
- `07-prompt-system-gap.md` — `_sanitize_api_messages` / system 注入
- `08-context-compression-gap.md` — 三层压缩内部机制（本章仅涉及"主循环如何调用"）
- `09-tools-system-gap.md` — `handle_function_call` + registry dispatch
- `14-state-sessions-gap.md` — SessionDB SQL / FTS5 schema
- `16-trajectory-format-gap.md` — ShareGPT JSONL vs EvoClaw 内部格式

---

**本章完成**。模板要点:
- §1 定位（单边简介，不展开机制细节）
- §2 档位速览（可扫描索引）
- §3 机制逐条并置（每个机制只写一次，两侧源码对照 + 判定）
- §4 改造蓝图 P0/P1/P2 + 不建议做
- §5 反超点单独汇总
- §6 附录引用双向可验
