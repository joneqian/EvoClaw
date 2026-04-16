# 16 — Trajectory 格式 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/16-trajectory-format.md`（~800 行，Phase C2 draft）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`agent/trajectory.py:1-56` + `run_agent.py:1981-2160` (`_convert_to_trajectory_format` / `_save_trajectory`) + `batch_runner.py:440-474, 992-1036` + `trajectory_compressor.py:54-313`
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），`packages/core/src/agent/kernel/incremental-persister.ts:1-415` + `packages/core/src/infrastructure/db/migrations/004_conversation_log.sql` + `015`/`021`/`022`/`023`/`024` 扩展 + `packages/core/src/memory/conversation-logger.ts`
> **综合判定**: 🟡 **部分覆盖，形态显著不同（含多项 🟢 反超 + 1 项明确 🔴 缺口）** —— EvoClaw 为**运行时会话存储**设计，hermes 为**离线 RL 训练**设计，两套系统正交：EvoClaw 在"实时崩溃恢复、流式增量、压缩快照、多 Agent 层级、WeChat 级附件"维度反超，但**无 ShareGPT JSONL 导出 / 无 `<think>` `<tool_call>` XML 标签化 / 无 tool_stats 规范化**，意味着无法直接喂 HuggingFace / LLaMA-Factory 训练管线

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes trajectory 子系统**（`.research/16-trajectory-format.md §1-§3`）—— 专为 **RL 训练**设计的对话轨迹格式。核心是 **ShareGPT JSONL + XML 风格工具调用**：每行一个 JSON 对象 `{conversations, timestamp, model, completed}`，其中 `conversations` 是 `{from, value}` 数组（system/human/gpt/tool 4 种 role）。`gpt` turn 内嵌 `<think>...</think>` + `<tool_call>{json}</tool_call>`，`tool` turn 批量合并连续消息为 `<tool_response>{json}</tool_response>`。目的：(1) HuggingFace datasets / LLaMA-Factory 直接可加载；(2) `<think>` 标签统一 Anthropic thinking / OpenAI reasoning / 老式 `<REASONING_SCRATCHPAD>`；(3) `TrajectoryCompressor`（独立模块）可在训练前把长轨迹压到 15250 token 预算内。**触发时机**：`run_conversation` 结束时一次性调用 `_save_trajectory`（**批量**），输出到 `trajectory_samples.jsonl`（完成）/ `failed_trajectories.jsonl`（失败）或 `batch_NNN_output.jsonl`（batch runner）。`batch_runner` 额外附加 `prompt_index / metadata / api_calls / toolsets_used / tool_stats`（37 个工具全量 zero-padding）等训练元数据。

**EvoClaw 对话日志子系统** —— 面向**运行时持久化 + 崩溃恢复 + 前端展示 + 记忆提取**设计，没有统一的 "trajectory" 概念，而是多张 SQLite 表协作：
- `conversation_log` 表（`004_conversation_log.sql` + 6 个后续 ALTER）—— 主日志，每行一条消息（不是每行一个对话），字段含 `role / content / tool_name / tool_input / tool_output / compaction_status / compaction_ref / token_count / parent_message_id / is_sidechain / entry_type / turn_index / kernel_message_json / persist_status`
- `IncrementalPersister`（`incremental-persister.ts:43-232`）—— **每轮** 消息进入 100ms batch 队列，异步写入；状态机 `streaming → final / orphaned`
- `session_summaries`（`019_session_summary.sql`）—— 压缩摘要指针
- `session_runtime_state`（`023_session_runtime_state.sql`）—— FileStateCache / CollapseState 快照
- `file_attributions`（`024_file_attribution.sql`）—— 文件读写追踪
- `ConversationLogger`（`conversation-logger.ts:75-102`）—— 记忆流水线入口（`raw → extracted → compacted → archived` 四态）

**量级对比**: hermes `trajectory.py` 56 行 + `_convert_to_trajectory_format` 165 行 + `batch_runner` 600+ 行，几乎全部聚焦 ShareGPT 化和训练格式对齐。EvoClaw 单 `incremental-persister.ts` 即 415 行（含显示文本重构 / UI ToolCall 提取 / orphaned 恢复），数据路径更长但**形态完全不同**：EvoClaw 存的是**运行时 ContentBlock[] JSON 快照**（`kernel_message_json` 列，与 Anthropic API content block 格式对齐），不做 ShareGPT 转换。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | Trajectory 数据结构 | 🟡 | JSONL 行 vs SQLite 表行：hermes 每行一对话；EvoClaw 每行一消息 + `turn_index` 聚合 |
| §3.2 | 消息块 schema | 🟡 | hermes `<think>+<tool_call>` XML 文本；EvoClaw ContentBlock[] JSON（与 Anthropic API 对齐） |
| §3.3 | 持久化时机 | 🟢 | **反超**：EvoClaw per-turn 100ms batch 增量写入；hermes 循环结束一次性批量 |
| §3.4 | 索引字段 | 🟡 | 两者都有 session/turn/timestamp；EvoClaw 缺 `cache_read/write/reasoning_tokens` 细粒度 |
| §3.5 | 跨提供商差异吸收 | 🟢 | **反超**：EvoClaw 统一 ContentBlock 内建 thinking signature / redacted_thinking；hermes 需 4 套 reasoning 字段分流 |
| §3.6 | 增量 streaming/final/orphaned 状态机 | 🟢 | **反超**：EvoClaw 三态崩溃恢复 `loadOrphaned`；hermes 无对应概念 |
| §3.7 | 压缩状态快照 | 🟢 | **反超**：EvoClaw `compaction_status` 4 态 + `compaction_ref` + `entry_type='compaction_boundary'` 边界事件；hermes 压缩直接改 trajectory 不留指针 |
| §3.8 | 回放 / 重建上下文 | 🟡 | EvoClaw 三级智能恢复（boundary → summary → last-N）+ `stream-vcr.ts` SSE 回放；hermes 依赖 ShareGPT 训练管线自己消费 |
| §3.9 | 审计 / 调试能力 | 🟢 | **反超**：EvoClaw `parent_message_id` + `is_sidechain` + `entry_type` + `requestId` + `file_attributions`；hermes 无 |
| §3.10 | Schema 版本迁移 | 🟢 | **反超**：EvoClaw 25 份独立 migration（MigrationRunner 自动执行）；hermes 依赖 Python dict 向后兼容 + dataclass 默认值 |
| §3.11 | 归档 / 长会话截断 | 🟡 | EvoClaw `archived` 状态 + Fork 隔离；hermes `TrajectoryCompressor` 目标 15250 tokens 训练前压缩 |
| §3.12 | 二进制附件（图片 / PDF） | 🟡 | EvoClaw ImageBlock base64 内嵌 + `file_attributions` 路径引用；hermes `tool_result_storage` 超大结果存盘 |
| §3.13 | ShareGPT JSONL 导出 | 🔴 | **明确缺口**：EvoClaw 无 `_convert_to_trajectory_format` 等价，无法直接喂 HuggingFace / LLaMA-Factory |
| §3.14 | Tool 统计规范化（训练友好） | 🔴 | EvoClaw 无 `_normalize_tool_stats` 等价 zero-padding，也无 batch merge 聚合 |

**统计**: 🔴 2 / 🟡 6 / 🟢 6（其中 6 项明确反超）。

---

## 3. 机制逐条深度对比

每条同时给出 **hermes 实现**（带 `.research/16-trajectory-format.md §N` 引用）+ **EvoClaw 实现**（带 `packages/core/src/**.ts:LN` 精确行号）+ **判定与分析**。

### §3.1 Trajectory 数据结构

**hermes**（`.research/16-trajectory-format.md §2, §3.4`）—— **JSONL 每行一对话 ShareGPT 数组**:

```json
{"conversations": [
  {"from":"system","value":"You are Hermes...\n\n<tools>\n[...]\n</tools>"},
  {"from":"human","value":"What Python version is installed?"},
  {"from":"gpt","value":"<think>\n...\n</think>\n<tool_call>\n{...}\n</tool_call>"},
  {"from":"tool","value":"<tool_response>\n{...}\n</tool_response>"},
  {"from":"gpt","value":"<think>\n...\n</think>\nPython 3.11.6"}
], "timestamp":"2026-04-09T10:30:15", "model":"anthropic/claude-opus-4.6", "completed":true}
```

**外层 schema**：`conversations / timestamp / model / completed` 4 字段（`trajectory.py:80-111`）。
**写入约定**：`open(filename, "a")` 追加模式（同一文件累计多条对话）。

**EvoClaw**（`packages/core/src/infrastructure/db/migrations/004_conversation_log.sql:1-18` + `022_incremental_persist.sql:4-12` + `021_conversation_log_hierarchy.sql:4-11`）—— **SQLite 表每行一消息**:

```sql
-- 004 基础
CREATE TABLE conversation_log (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  tool_name TEXT, tool_input TEXT, tool_output TEXT,
  compaction_status TEXT NOT NULL DEFAULT 'raw'
    CHECK (compaction_status IN ('raw','extracted','compacted','archived')),
  compaction_ref TEXT,
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 022 增量持久化扩展
ALTER TABLE conversation_log ADD COLUMN turn_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_log ADD COLUMN kernel_message_json TEXT;
ALTER TABLE conversation_log ADD COLUMN persist_status TEXT NOT NULL DEFAULT 'final'
  CHECK (persist_status IN ('streaming', 'final', 'orphaned'));

-- 021 层级关系
ALTER TABLE conversation_log ADD COLUMN parent_message_id TEXT;
ALTER TABLE conversation_log ADD COLUMN is_sidechain INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_log ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'message';

-- 015 工具调用元数据
ALTER TABLE conversation_log ADD COLUMN tool_calls_json TEXT;
```

一次会话对应**多行**（每轮 2-3 行：user / assistant / 可选 tool_result），通过 `(agent_id, session_key)` + `ORDER BY created_at, rowid` 重建。

**判定 🟡**: 两者形态完全不同。
- hermes 以"一对话一行"为最小单位，便于**训练框架按行采样**（load_dataset / dataset shuffle）；
- EvoClaw 以"一消息一行"为最小单位，便于**运行时增量 append + 索引查询**（某轮恢复、FTS、聚合统计）；
- 转换方向存在但不对称：EvoClaw → ShareGPT 需要额外 `_convert_to_trajectory_format` 等价（见 §3.13），ShareGPT → EvoClaw 则需要解析 `<think>` / `<tool_call>` 文本（边界容易错）。

---

### §3.2 消息块 schema（user/assistant/tool_use/tool_result 类型）

**hermes**（`.research/16-trajectory-format.md §3.2, §3.6`）—— **XML 标签化文本**，单条消息的结构化信息嵌入 `value` 字符串:

```python
# assistant turn 的 value 组装（run_agent.py:1981-2075 对应片段）
think_block = f"<think>\n{reasoning}\n</think>\n"   # 原生 reasoning 优先
# ...
for tc in tool_calls:
    tc_json = json.dumps({"name": name, "arguments": args}, ensure_ascii=False)
    tool_call_blocks.append(f"<tool_call>\n{tc_json}\n</tool_call>")
value = think_block + "\n".join(tool_call_blocks)
return {"from": "gpt", "value": value}
```

4 个规则（`§3.2` 关键点列表）：
1. **每个 gpt turn 必有 `<think>` 块**（空也算，保证训练结构一致）
2. `arguments` 字段**已解析为 dict**（非 OpenAI 原始字符串）
3. 多 tool_call 合并在一个 gpt turn
4. 连续 tool messages 合并为一个 tool turn（ShareGPT 约定）

**EvoClaw**（`packages/core/src/agent/kernel/types.ts:21-74` + `incremental-persister.ts:65-85`）—— **ContentBlock[] JSON 数组**，与 Anthropic API content block **同构**:

```typescript
// types.ts:21-74
export interface TextBlock { readonly type: 'text'; text: string; }
export interface ToolUseBlock {
  readonly type: 'tool_use'; readonly id: string; readonly name: string;
  input: Record<string, unknown>;
}
export interface ToolResultBlock {
  readonly type: 'tool_result'; readonly tool_use_id: string;
  content: string; is_error?: boolean;
}
export interface ThinkingBlock {
  readonly type: 'thinking'; thinking: string;
  /** 思考签名（Anthropic API 要求在后续轮次中回传） */
  signature?: string;
}
export interface RedactedThinkingBlock { readonly type: 'redacted_thinking'; readonly data: string; }
export interface ImageBlock {
  readonly type: 'image';
  readonly source: { readonly type: 'base64'; readonly media_type: string; readonly data: string; };
}
export type ContentBlock =
  | TextBlock | ToolUseBlock | ToolResultBlock
  | ThinkingBlock | RedactedThinkingBlock | ImageBlock;
```

序列化路径（`incremental-persister.ts:71-82`）:
```typescript
for (const msg of messages) {
  this.queue.push({
    // ...
    kernelMessageJson: JSON.stringify(msg),   // 完整 KernelMessage（含 content: ContentBlock[]）
    // ...
  });
}
```

**判定 🟡**: 两者正交，各有代价：
- hermes 把结构塞进字符串（XML）便于**训练 tokenizer 学习标签**，但**重建时需要 parser**（容易因模型"<think>"前缀注入被污染，见 hermes `.research/16 §7` 未解之谜）；
- EvoClaw 用 JSON ContentBlock 数组，**重建零解析成本**（`JSON.parse(kernelMessageJson)`），但**不能直接训练**——训练框架不理解 `{"type":"tool_use","id":"...","input":{...}}` 这种嵌套对象，需要先转 XML。

**细节**：EvoClaw 的 `RedactedThinkingBlock`（`types.ts:53-57`）是 Anthropic 专属、**必须原样回传**的块类型，hermes trajectory 里把 thinking 统一成文本 `<think>` 后会丢失 Anthropic 的 `signature` 字段（hermes `.research/16 §7` 自己列为未解之谜："Anthropic thinking block 含 `signature` 字段，trajectory 里只保留文本内容。训练时丢失 signature 会不会影响推理？"）。

---

### §3.3 持久化时机（每 turn / 流式增量 / 最终快照）

**hermes**（`.research/16-trajectory-format.md §3.4, §3.5`）—— **循环结束一次性**:

```python
# run_agent.py:9181-9184
completed = final_response is not None and api_call_count < self.max_iterations
self._save_trajectory(messages, user_message, completed)
# → 内部 _convert_to_trajectory_format 全量扫描 messages + 一次 append 到 JSONL
```

语义：**完成（或失败）后才落盘**，循环过程中进程崩溃则**本轮 trajectory 全部丢失**（messages 还在内存，未写入文件）。

**EvoClaw**（`packages/core/src/agent/kernel/incremental-persister.ts:65-101, 196-231` + `query-loop.ts:507, 634`）—— **每轮 100ms batch**:

```typescript
// incremental-persister.ts:22
const FLUSH_INTERVAL_MS = 100;

// incremental-persister.ts:65-85
persistTurn(turnIndex: number, messages: readonly KernelMessage[]): void {
  if (this.disposed) return;
  const createdAt = new Date().toISOString();
  for (const msg of messages) {
    this.queue.push({
      id: `${this.batchId}:${turnIndex}:${msg.id}`,
      // ...
      kernelMessageJson: JSON.stringify(msg),
      createdAt,
    });
  }
  this.scheduleDrain();
}

// 主循环每轮调用（query-loop.ts:507, 634）
config.persister?.persistTurn(state.turnCount, [roundResult.assistantMessage]);
// ...
config.persister?.persistTurn(state.turnCount, [toolResultMsg]);
```

三种刷盘入口:
1. 自动：`scheduleDrain` 100ms 后 `drainQueue` → 事务内批量 INSERT
2. 同步：`flush()` 供优雅关闭和异常路径调用
3. 终结：`finalize()` 将本批次所有 `streaming` UPDATE 成 `final`（`incremental-persister.ts:108-125`）

**判定 🟢 反超**: EvoClaw 增量持久化**崩溃损失最小化**（最多丢 100ms 数据）；hermes 完全批量则**崩溃损失可能整个对话**。企业级会话管理（Heartbeat 长跑、Cron 后台、WeChat 长连接）下 EvoClaw 模式优势显著。代价：每 100ms 一次 SQLite write，但 WAL 模式下影响极小（WAL 锁 < 1ms）。

---

### §3.4 索引字段（session / turn / timestamp / token）

**hermes**（`.research/14-state-sessions.md` §2.1 sessions 表 26 字段）—— **会话级聚合指标**（不是 trajectory 行指标）:
- `input_tokens / output_tokens / cache_read_tokens / cache_write_tokens / reasoning_tokens` 5 维 token 统计
- `estimated_cost_usd / actual_cost_usd / billing_provider / pricing_version` 计费元数据
- trajectory JSONL **外层** 仅 `timestamp / model / completed` 3 个索引字段，**无 per-turn 细粒度**

**EvoClaw**（`conversation_log` 多列索引）:

```sql
-- 004_conversation_log.sql
CREATE INDEX idx_convlog_agent_session ON conversation_log(agent_id, session_key);
CREATE INDEX idx_convlog_status ON conversation_log(agent_id, compaction_status);

-- 022_incremental_persist.sql
CREATE INDEX idx_convlog_persist
  ON conversation_log(agent_id, session_key, persist_status)
  WHERE persist_status != 'final';   -- 部分索引，减小体积

-- 021_conversation_log_hierarchy.sql
CREATE INDEX idx_convlog_parent ON conversation_log(parent_message_id) WHERE parent_message_id IS NOT NULL;
CREATE INDEX idx_convlog_entry_type ON conversation_log(agent_id, entry_type) WHERE entry_type != 'message';
```

每条消息自带:
- `turn_index INTEGER`（顺序重建）
- `token_count INTEGER`（单消息 token 数）
- `created_at TEXT ISO8601`（时间戳）
- `compaction_status`（压缩流水线状态）
- `entry_type`（`message` / `compaction_boundary` / `memory_saved` / `agent_spawned` / `agent_completed` / `error_snapshot`，见 `conversation-logger.ts:4-10`）

**判定 🟡**:
- EvoClaw 胜在**per-message 细粒度索引**（单条查询、按状态过滤、按类型抽取事件）
- hermes 胜在**per-session 聚合指标**（tokens/billing 分维度统计，EvoClaw 无对应字段，见 `14-state-sessions-gap.md §3.10` 🔴 记录）
- 两者互补：EvoClaw 可以 `SUM(token_count) GROUP BY session_key` 推算会话总 token，但 hermes 的 cache_read vs cache_write 分离 EvoClaw 无法复原（`kernel_message_json` 里 `usage.cacheReadTokens` 存在但未展开为列，查询困难）

---

### §3.5 跨提供商差异吸收（Anthropic tool_use vs OpenAI tool_calls）

**hermes**（`.research/16-trajectory-format.md §3.5, §3.8`）—— **4 套 reasoning 字段 + 转换时规范化**:

```python
# run_agent.py 消息侧（§3.5 配套）
if msg.get("role") == "assistant":
    reasoning_text = msg.get("reasoning")            # 1. 内部字段
    if reasoning_text:
        api_msg["reasoning_content"] = reasoning_text   # 2. Moonshot/Novita/OpenRouter API 字段
# 响应侧额外聚合:
#   - reasoning (内部 str)
#   - reasoning_content (API 字段)
#   - reasoning_details (SessionDB JSON)
#   - codex_reasoning_items (Codex 格式)
```

`_convert_to_trajectory_format` 时（`.research/16 §3.2`）:
- 优先 `msg["reasoning"]` → `<think>` 块
- 回退 `convert_scratchpad_to_think(content)` 把老式 `<REASONING_SCRATCHPAD>` 替换为 `<think>`
- 都没有则插空块 `<think>\n</think>\n`

老式 `<REASONING_SCRATCHPAD>` 在 grep 统计中**仅出现在 `agent/trajectory.py` 和 `hermes_parser.py`**（`.research/16 §3.8`），hermes 正在向 `<think>` 完全收敛。

**EvoClaw**（`query-loop.ts:230-247`，见 `05-agent-loop-gap.md §3.4`）—— **统一 ContentBlock 内建**:

```typescript
// query-loop.ts:230-247
case 'thinking_delta':
  appendOrCreateThinkingBlock(blocks, event.delta);
  break;
case 'thinking_signature': {
  const lastBlock = blocks[blocks.length - 1];
  if (lastBlock && lastBlock.type === 'thinking') {
    (lastBlock as ThinkingBlock).signature = event.signature;
  }
  break;
}
case 'redacted_thinking':
  blocks.push({ type: 'redacted_thinking' as const, data: event.data });
  break;
```

thinking 块天然在 `content: ContentBlock[]` 里，**signature 字段 kernel_message_json 原样持久化**，redacted_thinking 原样透传，不需要转换时规范化。Tool 调用侧同理：ToolUseBlock 保留 `id / name / input`（已解析 dict），不需要像 hermes 一样 `json.loads(arguments_str)`。

**判定 🟢 反超**: EvoClaw 架构上**消除了这类格式歧义**，代价是不支持 Moonshot / Novita / OpenRouter 的 `reasoning_content` 非标字段（但这些 provider 本来就不在 EvoClaw 双协议范围，见 `05-agent-loop-gap.md §3.4`）。EvoClaw 的 `signature` 跨轮保持内建早于 hermes PR #6112。

---

### §3.6 增量持久化（streaming/final/orphaned 状态机）

**hermes**（`.research/16-trajectory-format.md §3.4, §3.10`）—— **无对应状态机**:
- `_save_trajectory` 循环结束时一次性写（§3.3 已述）
- 被截断的 `<REASONING_SCRATCHPAD>` 用 `has_incomplete_scratchpad` 检测 + 2 次重试（`.research/16 §3.7`），但这是**内存层重试**，不是**持久化层恢复**
- 崩溃则本对话 trajectory **全部丢失**

**EvoClaw**（`incremental-persister.ts:108-192`）—— **streaming → final / orphaned 三态**:

```typescript
// incremental-persister.ts:212-224 drainQueue 写入 streaming
INSERT OR IGNORE INTO conversation_log
  (id, ..., persist_status, created_at)
  VALUES (?, ..., 'streaming', ?)

// incremental-persister.ts:112-122 finalize 标记 streaming → final
UPDATE conversation_log
  SET persist_status = 'final'
  WHERE agent_id = ? AND session_key = ? AND persist_status = 'streaming'
    AND id LIKE ?     -- batchId 前缀，精确定位本次执行

// incremental-persister.ts:144-191 loadOrphaned 崩溃恢复
// 启动时发现任何 streaming 状态行 → 说明上次崩溃，先 UPDATE 为 orphaned
// 然后反序列化 kernel_message_json 返回给调用方
// 返回后 UPDATE 为 final，避免重复恢复
```

调用位置（`chat.ts:151`）: 每次 `loadMessageHistory` 先跑 `IncrementalPersister.loadOrphaned` 做崩溃恢复。

**判定 🟢 反超**: EvoClaw 独有，hermes 无对应概念。对比意义:
- Heartbeat / Cron / WeChat 长连接场景下 Sidecar 进程可能 OOM / 升级重启，EvoClaw 能精确恢复到**最后一轮 final**
- 配合 `batchId = crypto.randomUUID()`（`incremental-persister.ts:55`）保证多次 sidecar 启动的 streaming 互不干扰
- 部分索引 `WHERE persist_status != 'final'`（`022_incremental_persist.sql:10-12`）让恢复查询仅扫描少量行

这是**运行时持久化 vs 离线训练数据**两个维度设计取向的核心差异。

---

### §3.7 压缩状态快照（compacted_at / 摘要指针）

**hermes**（`.research/17-trajectory-compression.md` 预告）—— **单独压缩器 `TrajectoryCompressor`**（`trajectory_compressor.py:54-313`）:
- 独立于运行时 `context_compressor`
- 输入 `trajectories.jsonl` → 输出 `trajectories_compressed.jsonl`（同 ShareGPT 格式）
- 中间 turn 被一条 human role summary 替换
- **压缩发生在训练前**，不影响运行时日志；trajectory 里**无压缩指针**，压缩后原轨迹可丢

**EvoClaw**（`004_conversation_log.sql:10-11` + `chat.ts:985-997` + `019_session_summary.sql` + `conversation-logger.ts:4-10`）—— **完整快照系统**:

```sql
-- 004 基础字段
compaction_status TEXT NOT NULL DEFAULT 'raw'
  CHECK (compaction_status IN ('raw','extracted','compacted','archived'))
compaction_ref TEXT    -- 指向摘要或下一状态

-- 021 新增边界事件类型
entry_type TEXT NOT NULL DEFAULT 'message'
-- 取值: 'message' / 'compaction_boundary' / 'memory_saved' / 'agent_spawned' / 'agent_completed' / 'error_snapshot'
```

**PostCompact Hook 落盘**（`chat.ts:983-1002`）:
```typescript
postCompactHook: async (trigger, tokensBefore, tokensAfter, summaryText) => {
  // 1. 写入 compaction_boundary 到 conversation_log
  store.run(
    `INSERT INTO conversation_log (id, agent_id, session_key, role, content,
                                   compaction_status, entry_type, created_at)
     VALUES (?, ?, ?, 'system', ?, 'compacted', 'compaction_boundary', ?)`,
    crypto.randomUUID(), agentId, sessionKey,
    JSON.stringify({ trigger, tokensBefore, tokensAfter }),
    new Date().toISOString(),
  );
  // 2. 持久化摘要到 session_summaries
  if (summaryText && sessionSummarizer) {
    sessionSummarizer.save(agentId, sessionKey, summaryText, tokensAfter, 0, 0);
  }
}
```

`session_summaries` 独立表（`019_session_summary.sql:2-13`）含 `summary_markdown / token_count_at / turn_count_at / tool_call_count_at`，`UNIQUE INDEX idx_session_summary_key`。

**判定 🟢 反超**: EvoClaw 的设计更精细：
- 压缩是**运行时一等事件**，`entry_type='compaction_boundary'` 在日志流中留痕
- `compaction_status` 四态流水线（raw → extracted → compacted → archived）供记忆提取管线复用（`conversation-logger.ts:107-122` 的 `getPendingMessages` 正是按 'raw' 过滤）
- `session_summaries` 一对一挂靠 `(agent_id, session_key)`，支持**智能恢复**（`chat.ts:148-256` 三级加载策略：boundary → summary → last-N）
- hermes 的 `TrajectoryCompressor` 面向**离线训练**，EvoClaw 面向**在线会话延续**，目标不同但 EvoClaw 系统更完整

---

### §3.8 回放 / 重建上下文

**hermes**（`.research/16-trajectory-format.md §4.3`）—— **训练管线消费**:
```python
from datasets import load_dataset
ds = load_dataset("json", data_files="trajectories.jsonl", split="train")
ds = ds.filter(lambda x: x.get("completed", False))
def format_for_training(example):
    messages = example["conversations"]
    text = ""
    for msg in messages:
        # system/human/gpt/tool → <|im_start|>...<|im_end|>
    return {"text": text}
```
"回放"等价于 HuggingFace datasets 直接 `ds[i]["conversations"]` 取出 list 喂模型。无运行时会话重建逻辑。

**EvoClaw**——**双轨回放**:

**轨道 1: 会话重建**（`chat.ts:148-256` 三级智能恢复）—— 已在 §3.7 展示。三级优先级:
```
Level 0: loadOrphaned 先恢复崩溃残留
Level 1: compaction_boundary → boundary 之后消息（含摘要前缀）
Level 2: session_summary → 摘要 + 最近 N 条
Level 3: last-N 原始消息
```

**轨道 2: SSE 流式回放**（`packages/core/src/agent/kernel/stream-vcr.ts:22-103`）:
```typescript
export interface VCRCassette {
  protocol: ApiProtocol; modelId: string;
  events: VCREntry[]; recordedAt: string;
  eventCount: number; durationMs: number;
}

export function recordStream(
  source: AsyncGenerator<StreamEvent>,
  meta: { protocol: ApiProtocol; modelId: string },
): { stream: AsyncGenerator<StreamEvent>; getCassette: () => VCRCassette };

export async function* replayStream(
  cassette: VCRCassette, realtime = false,
): AsyncGenerator<StreamEvent>;
```

**判定 🟡**: 两套系统目标不同：
- hermes 的"回放"是训练数据集消费（离线），EvoClaw 无等价
- EvoClaw 的"回放"是 (a) 生产会话崩溃恢复 + (b) 调试用 SSE cassette，hermes 无等价
- 如果 EvoClaw 要加训练功能，VCR cassette 是另一种潜在数据源（每个 turn 的 StreamEvent 序列），但目前无集成

---

### §3.9 审计 / 调试能力（trace_id / parent_message_id / 错误栈）

**hermes**（`.research/16-trajectory-format.md §3.5` batch_runner 扩展）—— **批量维度元数据**:
```json
{
  "prompt_index": 0,
  "conversations": [...],
  "metadata": {...},
  "completed": true, "partial": false,
  "api_calls": 7,
  "toolsets_used": ["terminal", "file"],
  "tool_stats": {"terminal": 3, ...},
  "tool_error_counts": {...}
}
```
单轨迹内部**无父子消息追踪**、无错误快照事件、无请求 ID。

**EvoClaw**（`021_conversation_log_hierarchy.sql:4-11` + `types.ts:105-106` + `conversation-logger.ts:4-30` + `024_file_attribution.sql:1-17`）—— **多维审计**:

```sql
-- 021: 层级追踪
ALTER TABLE conversation_log ADD COLUMN parent_message_id TEXT;
ALTER TABLE conversation_log ADD COLUMN is_sidechain INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_log ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'message';
```

```typescript
// types.ts:105-106 KernelMessage 自带
/** API 请求 ID — 生产调试用 (Anthropic: request-id, OpenAI: x-request-id) */
requestId?: string;

// conversation-logger.ts:4-10 entry_type 枚举
export type LogEntryType =
  | 'message'              // 普通对话消息
  | 'compaction_boundary'  // Autocompact/Snip/Microcompact 压缩边界
  | 'memory_saved'         // 记忆保存事件
  | 'agent_spawned'        // 子代理启动
  | 'agent_completed'      // 子代理完成
  | 'error_snapshot';      // 错误快照
```

**File Attribution**（`024_file_attribution.sql:1-17`）:
```sql
CREATE TABLE file_attributions (
  id TEXT PRIMARY KEY,
  agent_id TEXT, session_key TEXT,
  file_path TEXT NOT NULL,
  action TEXT CHECK (action IN ('read', 'write', 'edit', 'create', 'delete')),
  content_hash TEXT,
  turn_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**判定 🟢 反超**:
- `parent_message_id` 追踪 subagent 返回值回传主 session 的关系
- `is_sidechain=1` 明确标记子代理消息流（UI 可折叠）
- `entry_type='error_snapshot' / 'agent_spawned' / 'agent_completed'` 是**一等事件**（不混在 message 里）
- `requestId` per-message 支持 Anthropic / OpenAI request-id 溯源
- `file_attributions` 独立表记录每次 read/write/edit（hermes 无此机制）

hermes 的 `tool_stats` 是**全局计数器**（单对话内终态），EvoClaw 是**逐事件时间线**（每次调用可追溯到 turn_index + created_at）。

---

### §3.10 Schema 版本迁移

**hermes**（`.research/16-trajectory-format.md §3.5` + Python 惯例）—— **dataclass 默认值 + dict 兼容**:
- 外层 schema（`conversations / timestamp / model / completed`）是 `trajectory.py:103-108` 硬编码 dict
- batch_runner 扩展字段（`prompt_index / api_calls / toolsets_used / tool_stats / tool_error_counts`）通过 `result.get("xxx", 默认值)` 容错
- 新字段靠下游 `lambda x: x.get("new_field")` 自我保护
- **无正式迁移流程**，新字段即新字段

**EvoClaw**（`packages/core/src/infrastructure/db/migrations/*.sql` 25 个文件）—— **MigrationRunner 串行执行**:

```
001_initial.sql
002_memory_units.sql
003_knowledge_graph.sql
004_conversation_log.sql
005_capability_graph.sql
006_tool_audit_log.sql
007_bindings.sql
008_cron_jobs.sql
009_knowledge_base.sql
010_channel_state.sql
011_agent_last_chat.sql
012_agent_skills.sql
013_audit_log_columns.sql
014_workspace_state.sql
015_conversation_tool_calls.sql  ← conversation_log.tool_calls_json
016_cron_job_state.sql
017_audit_log_reason.sql
018_consolidation_log.sql
019_session_summary.sql
020_usage_tracking.sql
021_conversation_log_hierarchy.sql  ← parent_message_id / is_sidechain / entry_type
022_incremental_persist.sql         ← turn_index / kernel_message_json / persist_status
023_session_runtime_state.sql
024_file_attribution.sql
025_memory_feedback.sql
```

`conversation_log` 表经历 5 次 schema 演进（004 → 015 → 021 → 022 → 024），每次通过 `ALTER TABLE ADD COLUMN` 非破坏性升级。

**判定 🟢 反超**: EvoClaw 有正式的 schema 版本化流程（CLAUDE.md 明确 "MigrationRunner 自动执行 `packages/core/src/infrastructure/db/migrations/*.sql`"），hermes 无对应机制。代价：EvoClaw 每个字段都是 SQL 列，变更需要真正迁移；hermes 新字段即 JSON key，成本低但缺强制检查。

---

### §3.11 归档 / 长会话截断

**hermes**（`.research/16-trajectory-format.md §3.11`）—— **TrajectoryCompressor 训练前压缩**:
```python
@dataclass
class CompressionConfig:
    target_max_tokens: int = 15250
    protect_first_system: int = 1
    protect_first_human: int = 1
    protect_first_gpt: int = 1
    protect_first_tool: int = 1
    protect_last_n_turns: int = 4
    summarization_model: str = "google/gemini-3-flash-preview"
    max_concurrent_requests: int = 20
```
保护头 + 保护尾 4 轮 + 中间摘要。输出 `trajectories_compressed.jsonl` 供训练消费。详见 `.research/17-trajectory-compression.md`（待写）。

**EvoClaw**—— **归档 = `compaction_status='archived'` + Fork 隔离**:
- `004_conversation_log.sql:10` `archived` 是 `compaction_status` 合法值之一
- `routes/fork-session.ts:42-93` Fork 整体复制消息到新 session_key，源 session 可按归档策略清理（当前无自动归档任务，见 `14-state-sessions-gap.md §3.14` 🔴）
- 运行时压缩（Snip/Microcompact/Autocompact）详见 `08-context-compression-gap.md`，不在本章

**判定 🟡**: 两者面向不同场景:
- hermes 的 compressor 是**离线数据工程**（训练前批处理），EvoClaw 无对应
- EvoClaw 的归档是**在线状态流转**（raw → extracted → compacted → archived），hermes 无对应
- 若 EvoClaw 要支持训练数据导出，需要叠加离线压缩（可用 `session_summaries` 现有摘要替代中间 turn）

---

### §3.12 二进制附件（图片 / PDF 引用方式）

**hermes**（`.research/09-tools-system.md §3.7` PR #5210 `tool_result_storage`）—— **超大 tool result 存盘**:
- 超过 `max_result_size_chars` 的 tool result 保存到文件
- LLM 只看到文件路径 + 预览
- 目的：上下文节省（不是附件管理）

**EvoClaw**—— **ImageBlock 内嵌 + file_attributions 索引**:

```typescript
// types.ts:59-66
export interface ImageBlock {
  readonly type: 'image';
  readonly source: {
    readonly type: 'base64';
    readonly media_type: string;
    readonly data: string;
  };
}

// builtin-tools.ts:176 读图示例
return { content: `[图片(压缩): ${path.basename(filePath)}, image/jpeg, ${resizedData.length} bytes]\nbase64:${resizedData.toString('base64')}` };
```

图片以 base64 内嵌在 ContentBlock[] 里 → 经 `JSON.stringify(msg)` 存入 `kernel_message_json`。

`file_attributions` 表（见 §3.9）记录文件路径 + content_hash（不是图片本身，是 agent 操作过的文件）。

**微信 Channel 特殊处理**（CLAUDE.md "CDN + AES-128-ECB 媒体加解密管线"）—— 媒体在入链前解密为原始图片 bytes，再走 ImageBlock 通道。

**判定 🟡**: 两者取向不同：
- EvoClaw 把图片作为**一等消息内容**（ImageBlock 直接放 content 数组），hermes 的图片需要通过 `vision_analyze` 等工具返回（`.research/16-trajectory-format.md §3.5` batch_runner 的 `ALL_POSSIBLE_TOOLS` 含 `vision_analyze`）
- EvoClaw 的 base64 内嵌意味着**每张图都占 conversation_log 行空间**（一张 1MB 图 = ~1.3MB base64 = 单行数据），大会话场景需要注意 SQLite row 上限
- hermes 的 tool_result_storage 是**离线取证友好**（文件路径可后续回看），EvoClaw 的 ImageBlock 是**模型推理友好**（API 直接收）

潜在风险: EvoClaw 无"超大 tool_result 存盘"等价，纯文本 tool_result 超大时依赖 Microcompact 截断（`context-compactor.ts` 5KB 阈值），但原始消息仍完整保存在 `kernel_message_json`（存量累积）。

---

### §3.13 ShareGPT JSONL 导出

**hermes**（`.research/16-trajectory-format.md §3.2-§3.4` 核心能力）—— **`_convert_to_trajectory_format` + `save_trajectory` 完整管线**:

```python
# agent/trajectory.py:80-111
def save_trajectory(trajectory, model, completed, filename=None):
    if filename is None:
        filename = "trajectory_samples.jsonl" if completed else "failed_trajectories.jsonl"
    entry = {
        "conversations": trajectory,
        "timestamp": datetime.now().isoformat(),
        "model": model,
        "completed": completed,
    }
    with open(filename, "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
```

`_convert_to_trajectory_format`（`.research/16 §3.2` 165 行）负责:
- system → `{"from":"system", "value": content + "<tools>..."}`
- user → `{"from":"human", "value": content}`
- assistant → `{"from":"gpt", "value": "<think>...</think><tool_call>...</tool_call>"}`
- tool（连续合并）→ `{"from":"tool", "value": "<tool_response>...</tool_response>"}`

**EvoClaw**——**无 ShareGPT 导出**:

```
grep -rn "ShareGPT\|sharegpt\|<tool_call>\|<tool_response>\|trajectory_samples\|failed_trajectories" \
     packages/core/src
→ 零结果
```

`stream-vcr.ts` 是 SSE 事件流录制（调试用），**不是 trajectory 格式**。`conversation_log` 表是 SQLite 行，**不是 JSONL**。

**判定 🔴 明确缺口**:
- 若 EvoClaw 未来要支持**训练数据收集 / 调优 fine-tune / 行为回放对标**，必须补齐该能力
- 实现成本可控（~2-3 人日）：遍历 `conversation_log` → 按 session_key 聚合 → 逐消息解析 `kernel_message_json` → ContentBlock[] → `<think>+<tool_call>` XML 文本 → 写 JSONL
- 关键挑战:
  - thinking signature 在 ShareGPT 里会丢失（hermes `.research/16 §7` 同样困扰）
  - EvoClaw 的 `subagent` / `is_sidechain` 多 Agent 层级需要特殊处理（展开为多条 trajectory? 合并?）
  - 工具 schema 注入 `<tools>` 块需要运行时捕获（当前 `conversation_log` 不存工具清单，要从 `SystemPromptBlock` / 运行时 ToolRegistry 补取）

企业用户（CLAUDE.md "面向非程序员企业用户"）暂不需要训练数据导出，优先级不高，但作为与 hermes 对标的**明确缺失项**记录。

---

### §3.14 Tool 统计规范化（训练友好）

**hermes**（`.research/16-trajectory-format.md §3.5`）—— **`_normalize_tool_stats` zero-padding**:

```python
# batch_runner.py:50-66
ALL_POSSIBLE_TOOLS = [
    "web_search", "web_extract", "terminal", "read_file", "write_file",
    "patch", "search_files", "browser_navigate", "browser_snapshot",
    # ... 全部 37 个工具 ...
]

def _normalize_tool_stats(stats: Dict[str, int]) -> Dict[str, int]:
    """HuggingFace datasets / PyArrow 要求一致 schema，
    如果一个 trajectory 有 {"web_search": 3} 另一个有 {"terminal": 2}，
    合并会 schema mismatch 崩溃。Padding 0 修复。"""
    return {tool: stats.get(tool, 0) for tool in ALL_POSSIBLE_TOOLS}
```

**Batch merge**（`batch_runner.py:992-1036`）: `batch_NNN_output.jsonl` → `trajectories.jsonl` 简单 cat。

**EvoClaw**——**无 zero-padding 约束，无 batch merge**:
- `conversation_log.tool_calls_json`（`015_conversation_tool_calls.sql:3`）存 `[{"name":"bash","status":"done","summary":"..."}]` 单行 JSON 数组，**按消息粒度**
- 无全局 `ALL_POSSIBLE_TOOLS` 常量（工具是动态注册的：`CORE_TOOLS` + `createEvoClawTools` + MCP bridge + Skills + Channel tools，5 阶段注入，见 CLAUDE.md）
- 无 batch runner（CLAUDE.md 明确"EvoClaw 不是离线批处理系统"）

**判定 🔴**: 与 §3.13 同源缺口——EvoClaw 面向**单会话在线体验**，hermes 面向**批量训练数据生成**。若 EvoClaw 未来加训练导出，需要:
1. 枚举所有 built-in + custom 工具名到常量（或通过 registry snapshot 取）
2. 离线脚本聚合 `tool_calls_json` 统计
3. Zero-padding 后附加到导出格式

**工作量**：~1-2 人日（前提是 §3.13 已实现）。

---

## 4. 建议改造蓝图（不承诺实施）

**P0（高 ROI，建议尽快）——** 无。当前 EvoClaw 在运行时持久化维度已反超 hermes，trajectory 训练导出属企业用户不需要的长期规划。

**P1（中等 ROI，可按需补齐）**:

| # | 项目 | 对应差距 | 工作量 | ROI | 价值 |
|---|---|---|---|---|---|
| 1 | `tool_calls_json` 冗余列对齐 `kernel_message_json` | §3.2 | 0.5d | 🔥 | 避免两列同源数据不一致，简化查询 |
| 2 | 单独 `usage_detail` 列展开（cacheRead / cacheWrite / reasoning） | §3.4 | 1-2d | 🔥 | 补齐与 hermes 的会话统计维度差距，计费友好 |
| 3 | 超大 tool_result 外置存储（仿 hermes PR #5210） | §3.12 | 2-3d | 🔥 | 防 conversation_log 行膨胀 + SQLite BLOB limit |

**P2（长期规划，企业用户暂不需）**:

| # | 项目 | 对应差距 | 工作量 |
|---|---|---|---|
| 4 | ShareGPT JSONL 导出脚本 `exportTrajectory(agentId, sessionKey)` | §3.13 | 2-3d |
| 5 | `_convert_to_trajectory_format` 等价（ContentBlock → XML） | §3.13 | 1-2d |
| 6 | Tool stats zero-padding + batch merge（配合训练工程） | §3.14 | 1-2d |
| 7 | `TrajectoryCompressor` 等价（训练前压缩到 token 预算） | §3.11 | 3-5d（可复用 `context-compactor.ts`） |
| 8 | HuggingFace datasets loader example | §3.13 | 0.5d |

**不建议做**:
- **把 conversation_log 改成每行一对话 JSONL** —— EvoClaw 的 per-message 表结构支持更丰富的索引和查询（§3.4），改成每行一对话会丢失 streaming / orphaned 状态机、per-message entry_type 事件、compaction_status 流水线等核心价值。
- **强制 `<think>` XML 标签化** —— EvoClaw 的 ThinkingBlock 类型化已更精细（保留 signature / redacted_thinking），转 XML 是训练时一次性转换即可。
- **全局 `ALL_POSSIBLE_TOOLS` 常量** —— 与 EvoClaw "5 阶段工具注入 + Skill + MCP + Channel 动态注册"架构冲突，应改用 registry snapshot 动态获取。

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应 |
|---|---|---|---|
| 1 | Per-turn 100ms batch 增量持久化 | `incremental-persister.ts:22, 65-85, 196-231` | 循环结束批量（`_save_trajectory` at `run_agent.py:9184`） |
| 2 | streaming/final/orphaned 三态崩溃恢复 | `incremental-persister.ts:108-192` + `022_incremental_persist.sql:6-12` | 无等价 |
| 3 | Schema 版本化迁移流程 | `packages/core/src/infrastructure/db/migrations/*.sql`（25 个） | Python dict + dataclass 默认值 |
| 4 | `compaction_status` 四态流水线 + `compaction_boundary` entry_type | `004_conversation_log.sql:10-11` + `021_conversation_log_hierarchy.sql:6` + `chat.ts:985-997` | 无（trajectory 压缩是离线独立管线） |
| 5 | `parent_message_id` + `is_sidechain` 多 Agent 层级追踪 | `021_conversation_log_hierarchy.sql:4-5` | batch_runner 无，trajectory 无 |
| 6 | `entry_type` 一等事件分类（6 种） | `conversation-logger.ts:4-10` + `021_conversation_log_hierarchy.sql:6` | 无，所有事件塞一个 trajectory |
| 7 | `session_summaries` 独立摘要表 + 智能恢复 | `019_session_summary.sql` + `chat.ts:148-256` | TrajectoryCompressor 只压缩不挂指针 |
| 8 | `requestId` per-message Anthropic/OpenAI request-id 溯源 | `types.ts:105-106` | 无 |
| 9 | `file_attributions` 文件操作追踪 | `024_file_attribution.sql:1-17` | 无 |
| 10 | `kernel_message_json` 保留完整 ContentBlock[] 零损序列化 | `incremental-persister.ts:79` + `types.ts:68-74` | XML 文本化后 signature 等字段丢失 |
| 11 | Fork session（日志 + 摘要 + runtime_state + file_attr 单事务复制） | `fork-session.ts:42-93` | 仅 `parent_session_id` FK |
| 12 | SSE StreamEvent VCR 录制回放 | `stream-vcr.ts:22-103` | 无 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（本章所有 `path:line` 均经 Read 工具验证 2026-04-16）

- `packages/core/src/agent/kernel/incremental-persister.ts:22` ✅ `FLUSH_INTERVAL_MS = 100`
- `packages/core/src/agent/kernel/incremental-persister.ts:43-85` ✅ `class IncrementalPersister` + `persistTurn`
- `packages/core/src/agent/kernel/incremental-persister.ts:108-125` ✅ `finalize()` `streaming → final`
- `packages/core/src/agent/kernel/incremental-persister.ts:144-192` ✅ `loadOrphaned` 静态恢复方法
- `packages/core/src/agent/kernel/incremental-persister.ts:196-231` ✅ `scheduleDrain` + `drainQueue`（事务内批量 INSERT）
- `packages/core/src/agent/kernel/types.ts:21-74` ✅ `ContentBlock` union（6 种块）
- `packages/core/src/agent/kernel/types.ts:94-113` ✅ `KernelMessage` interface（含 requestId / microcompacted / createdAt）
- `packages/core/src/agent/kernel/query-loop.ts:366, 507, 634` ✅ 主循环调用 `persister.persistTurn / finalize`
- `packages/core/src/agent/kernel/stream-vcr.ts:22-103` ✅ VCRCassette + recordStream + replayStream
- `packages/core/src/memory/conversation-logger.ts:4-30` ✅ `LogEntryType` 枚举（6 种）+ `ConversationLogEntry` interface
- `packages/core/src/memory/conversation-logger.ts:75-102` ✅ `ConversationLogger.log` INSERT
- `packages/core/src/routes/chat.ts:127-146` ✅ `dedupeAssistantRows`（persister 与老 saveMessage 冲突处理）
- `packages/core/src/routes/chat.ts:148-256` ✅ 三级智能会话恢复（boundary → summary → last-N）
- `packages/core/src/routes/chat.ts:983-1002` ✅ `postCompactHook` 写入 `compaction_boundary` + `session_summaries`
- `packages/core/src/routes/fork-session.ts:42-93` ✅ Fork 四表单事务复制
- `packages/core/src/infrastructure/db/migrations/004_conversation_log.sql:1-18` ✅ 基础表结构
- `packages/core/src/infrastructure/db/migrations/015_conversation_tool_calls.sql:3` ✅ `tool_calls_json` 列
- `packages/core/src/infrastructure/db/migrations/019_session_summary.sql:1-15` ✅ 摘要表
- `packages/core/src/infrastructure/db/migrations/021_conversation_log_hierarchy.sql:4-11` ✅ parent_message_id / is_sidechain / entry_type
- `packages/core/src/infrastructure/db/migrations/022_incremental_persist.sql:4-12` ✅ turn_index / kernel_message_json / persist_status + 部分索引
- `packages/core/src/infrastructure/db/migrations/024_file_attribution.sql:1-17` ✅ file_attributions 表

### 6.2 缺失引用证据（grep 零结果）

- `grep -rn "ShareGPT\|sharegpt\|<tool_call>\|<tool_response>\|trajectory_samples\|failed_trajectories" packages/core/src` → **零结果**（§3.13 🔴 证据）
- `grep -rn "_normalize_tool_stats\|ALL_POSSIBLE_TOOLS\|batch_runner" packages/core/src` → **零结果**（§3.14 🔴 证据）
- `grep -rn "TrajectoryCompressor\|target_max_tokens" packages/core/src` → **零结果**（§3.11 训练前压缩缺失，但 EvoClaw 运行时压缩见 `context-compactor.ts` 更完整）

### 6.3 hermes 研究引用（章节 §）

- `.research/16-trajectory-format.md §1` —— RL 训练定位 / ShareGPT + XML 工具调用
- `.research/16-trajectory-format.md §2` —— 运行时 OpenAI messages → trajectory ShareGPT 数据结构映射图
- `.research/16-trajectory-format.md §3.1` —— `agent/trajectory.py` 56 行完整内容（`convert_scratchpad_to_think` / `has_incomplete_scratchpad` / `save_trajectory`）
- `.research/16-trajectory-format.md §3.2` —— `_convert_to_trajectory_format` 165 行核心转换（system/user/assistant/tool 4 种 turn 处理）
- `.research/16-trajectory-format.md §3.3` —— 典型 trajectory 完整示例（5 turn 对话）
- `.research/16-trajectory-format.md §3.4` —— `_save_trajectory` 调用链 / JSONL 输出路径
- `.research/16-trajectory-format.md §3.5` —— `batch_runner.py` 扩展格式 + `_normalize_tool_stats` zero-padding
- `.research/16-trajectory-format.md §3.6` —— `<tool_call>` / `<tool_response>` XML 格式详解 + content 智能解析
- `.research/16-trajectory-format.md §3.7` —— `has_incomplete_scratchpad` 检测 + 2 次重试
- `.research/16-trajectory-format.md §3.8` —— `<scratchpad>` vs `<think>` 演化
- `.research/16-trajectory-format.md §3.9` —— ShareGPT role 映射（runtime → trajectory）
- `.research/16-trajectory-format.md §3.10` —— Completion 标记定义
- `.research/16-trajectory-format.md §3.11` —— `trajectory_compressor.py` 与 `context_compressor` 的区别
- `.research/16-trajectory-format.md §4.2` —— Trajectory JSONL 文件格式（扩展字段）
- `.research/16-trajectory-format.md §4.3` —— HuggingFace datasets 训练前处理示例
- `.research/16-trajectory-format.md §6` —— 复刻清单（3 函数 + `_convert_to_trajectory_format` + batch_runner + incomplete scratchpad + reasoning 规范化 + ShareGPT 约定）
- `.research/16-trajectory-format.md §7` —— 未解之谜（含 Anthropic signature 丢失、`<think>` 注入风险、tool_call_id 空值、HF tokenizer 对 `<think>` 的特殊处理等）

### 6.4 关联差距章节

- [`04-core-abstractions-gap.md`](./04-core-abstractions-gap.md) —— ContentBlock / KernelMessage / StreamEvent 类型系统（本章 §3.2 / §3.5 引用）
- [`05-agent-loop-gap.md`](./05-agent-loop-gap.md) —— 主循环调用 `persister.persistTurn` 的时机（本章 §3.3 / §3.6 配套） §3.10 已指向本章
- [`08-context-compression-gap.md`](./08-context-compression-gap.md) —— 运行时压缩（Snip / Microcompact / Autocompact）与本章 §3.7 `compaction_boundary` 一起构成完整闭环
- [`14-state-sessions-gap.md`](./14-state-sessions-gap.md) —— SessionDB / session_key / 会话元数据细节（本章 §3.1 / §3.4 配套），§3.3 / §3.5 / §3.13 主题多处共振
- [`15-memory-providers-gap.md`](./15-memory-providers-gap.md) —— `compaction_status='raw' → 'extracted'` 交给记忆提取的消费侧
- [`17-trajectory-compression-gap.md`](./17-trajectory-compression-gap.md) —— `TrajectoryCompressor` 训练前压缩深度对比（本章 §3.11 预告）

---

**本章完成**。要点:
- §1 定位（两套系统正交：EvoClaw 运行时持久化 vs hermes 离线训练数据）
- §2 档位速览 14 机制
- §3 机制逐条并置（hermes 代码 + EvoClaw 代码 + 判定）
- §4 改造蓝图 P0/P1/P2 + 不建议做
- §5 反超点汇总（12 项）
- §6 附录引用双向可验 + §6.2 grep 零结果证据
