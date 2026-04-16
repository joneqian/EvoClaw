# 17 — Trajectory 压缩 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/17-trajectory-compression.md`（1,047 行，Phase C3 draft）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`trajectory_compressor.py:1-1517`（训练前离线批处理）+ `scripts/sample_and_compress.py:1-410` + `tests/test_trajectory_compressor{,_async}.py` ~534 行
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），`packages/core/src/agent/kernel/context-compactor.ts`（1,021 行）+ `packages/core/src/memory/session-summarizer.ts:1-112` + `packages/core/src/memory/conversation-logger.ts:1-187` + 数据库迁移 `004_conversation_log.sql` / `019_session_summary.sql` / `021_conversation_log_hierarchy.sql`
> **综合判定**: 🟡 **形态差异显著，压缩算法层 EvoClaw 反超，训练预处理层缺失** —— hermes 的 `trajectory_compressor.py` 是**离线训练前**的批处理预处理器（从 HuggingFace 数据集采样 → 压缩 → 产出 JSONL 喂训练），目标是让 `max_seq_length` 不溢出；EvoClaw 不训练模型，没有对应需求。但作为"trajectory 档案的压缩"这个更广义命题，EvoClaw 的三层压缩 + SM Compact + 压缩边界持久化 + 会话摘要 UPSERT 链路在**压缩算法质量**上全面领先，只是应用场景是运行时而非训练前。

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes `TrajectoryCompressor`**（`.research/17-trajectory-compression.md §1-§3`） — 完全独立于运行时的**训练数据预处理模块**。职责：读取 batch_runner 产出的 ShareGPT JSONL → 用 HuggingFace tokenizer 精确计数 → 识别"头 4 种 first role + 尾 4 轮"保护区 → 调 Gemini Flash Preview 生成自由文本摘要（`[CONTEXT SUMMARY]:` 前缀）→ 拼装新 JSONL 写回磁盘。整体是**磁盘 → 磁盘**的批处理流水线，50 路 `asyncio.Semaphore` 并发，HuggingFace `AutoTokenizer` 精确 tokenize，默认 `target_max_tokens=15_250` 对齐训练窗口 16K。**和运行时 `context_compressor.py` 是"双压缩器"的另一半**（见 [`08-context-compression-gap.md`](./08-context-compression-gap.md) 覆盖运行时那半）。

**EvoClaw 的"trajectory 压缩"等价物** — EvoClaw 作为 C 端产品不做模型训练，没有 `batch_runner.py → trajectories.jsonl → 压缩 → 训练`这条流水线；但 **"长对话归档压缩"这个命题**由三条路径共同承担：

- **运行时 Kernel 三层压缩**（`context-compactor.ts:149-828`）— Snip → Microcompact → Autocompact 三层，产出 9 段结构化摘要替换消息尾，见 [`08-context-compression-gap.md`](./08-context-compression-gap.md)。
- **SessionSummarizer**（`memory/session-summarizer.ts:14-112`）— 周期性生成/增量更新 Markdown 会话笔记，UPSERT 到 `session_summaries` 表（migration `019_session_summary.sql`），独立于 Kernel 上下文压缩，用于会话回顾与崩溃恢复。
- **ConversationLogger + compaction_boundary 事件**（`memory/conversation-logger.ts` + `routes/chat.ts:985-997`）— 每次压缩完成通过 `postCompactHook` 向 `conversation_log` 写入 `entry_type='compaction_boundary'` 标记行（记录 trigger/tokensBefore/tokensAfter），原始消息 `compaction_status` 同步转为 `raw → extracted → compacted → archived`，支撑下次启动时的三级会话恢复（`routes/chat.ts:110-220`）。

**量级对比**: hermes `trajectory_compressor.py` 单文件 1517 行 + 534 行测试，目标训练数据；EvoClaw 将类似职责拆为 `context-compactor.ts`（1,021 行）+ `session-summarizer.ts`（112 行）+ `conversation-logger.ts`（187 行）+ `routes/chat.ts` 恢复层（~220 行），目标运行时与崩溃恢复。**同量级但用途几乎不重叠**。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | Trajectory 压缩定位（训练前 vs 运行时归档） | 🟡 | 定位根本不同：hermes 磁盘→磁盘训练前；EvoClaw 运行时压缩 + DB 归档 |
| §3.2 | 批处理 + 并发架构 | 🔴 | hermes `asyncio.Semaphore(50)` + `num_workers=4` 多进程；EvoClaw 无批处理入口 |
| §3.3 | 精确 tokenizer（HuggingFace AutoTokenizer） | 🔴 | hermes 精确 tokenize 每个 turn；EvoClaw 仅 `chars/4` 粗估 |
| §3.4 | 触发条件（长度/时间/手动） | 🟢 | **反超**：EvoClaw 有 3 档阈值 + 6 阶段状态机 + 413 紧急折叠，hermes 仅单一 `target_max_tokens` 硬阈值 |
| §3.5 | 压缩算法（分层 vs 单层） | 🟢 | **反超**：EvoClaw 三层 Snip/Microcompact/Autocompact；hermes 单层"保护头尾 + 中间摘要" |
| §3.6 | Snip 零成本移除旧消息 | 🟢 **独有** | EvoClaw `snipOldMessages` 保留首 1 + 末 8 条；hermes trajectory 无零成本路径 |
| §3.7 | Microcompact 零成本截断 tool_result | 🟢 **独有** | EvoClaw 字节级 5KB + 70/30 + Shadow 模式；hermes `_extract_turn_content_for_summary` 仅 3000 字符一刀切 |
| §3.8 | Autocompact LLM 9 段摘要 | 🟢 | **反超**：EvoClaw 9 段结构化 prompt；hermes 自由文本 4 点要求 + `[CONTEXT SUMMARY]:` 前缀 |
| §3.9 | 熔断器（连续失败停止） | 🟢 **独有** | EvoClaw 3 次失败后停 Autocompact；hermes 仅 `max_retries=3` 内部重试，单轨迹失败 fallback 占位 |
| §3.10 | 压缩结果持久化 | 🟡 | hermes 产出新 JSONL（磁盘）；EvoClaw 写 `compaction_boundary` + `session_summaries`（DB），各适其场 |
| §3.11 | 可回溯性（原始数据能否取回） | 🟡 | hermes 保留输入文件（原始 JSONL 仍在）；EvoClaw `compaction_status='compacted'` 的原始消息仍在 conversation_log，可按 boundary 前后查询 |
| §3.12 | 多次压缩级联（二次压缩） | 🟡 | hermes trajectory 每条独立、无级联；EvoClaw 渐进式折叠 `CollapsePhase` 支持多次触发，`session_summaries` UPSERT 式增量更新 |
| §3.13 | 压缩指标（token 节省率 / 聚合统计） | 🔴 | hermes `TrajectoryMetrics` + `AggregateMetrics` 双层聚合（median/mean/error_rate + JSON 落盘）；EvoClaw 仅 log.info 文本 |
| §3.14 | 与 Memory L0/L1/L2 的协同 | 🟢 **独有** | EvoClaw `trySessionMemoryCompact` 将已提取记忆直接当摘要（零 API）；hermes trajectory 无记忆层 |

**统计**: 🔴 3 / 🟡 4 / 🟢 7（其中 4 项 EvoClaw 独有）。

---

## 3. 机制逐条深度对比

### §3.1 Trajectory 压缩定位（训练前 vs 运行时归档）

**hermes**（`.research/17-trajectory-compression.md §1`）：

> `trajectory_compressor.py`（1517 行）是**完全独立于运行时** `context_compressor.py` 的训练数据预处理模块。它的用途：**把长对话轨迹**（batch_runner 生成的 ShareGPT JSONL）**压缩到训练窗口**（默认 15,250 tokens）；**让 HuggingFace 数据集训练时不超出 max_seq_length**；**批量 + 并发**（默认 50 个 concurrent API calls）。

**EvoClaw**（`packages/core/src/agent/kernel/context-compactor.ts:1-22` 头部注释）：

```typescript
/**
 * 三层上下文压缩 — 参考 Claude Code 压缩策略
 *
 * Layer 1: Snip (零成本) — 移除最旧的非关键消息
 * Layer 2: Microcompact (零成本) — 截断过大的 tool_result
 * Layer 3: Autocompact (1 次 LLM 调用) — 结构化摘要替换历史
 * ...
 * 参考文档: docs/research/16-context-management.md
 */
```

EvoClaw 定位是**运行时上下文压缩 + DB 归档**；没有 hermes 那种面向训练数据集的离线 trajectory 预处理器。

**判定 🟡**：定位不相交。hermes trajectory 压缩是 ML 工程链路的一环（没这步训练会 OOM），EvoClaw 作为 C 端企业应用根本不训练模型，这是产品需求决定的缺口而非能力缺口。**不建议补齐**：EvoClaw 没有训练流水线上游；若未来引入自有模型微调，届时再评估即可。

---

### §3.2 批处理 + 并发架构

**hermes**（`.research/17-trajectory-compression.md §3.2, §3.4` / `trajectory_compressor.py:316-405, 594-654`）：

```python
class CompressionConfig:
    num_workers: int = 4                       # 多进程 worker 数
    max_concurrent_requests: int = 50          # asyncio 并发 API 调用数
    per_trajectory_timeout: int = 300          # 单条轨迹超时（秒）

# _process_directory_async 里:
semaphore = asyncio.Semaphore(self.config.max_concurrent_requests)    # 默认 50
async def process_one(entry):
    async with semaphore:
        return await self.process_entry_async(entry)
tasks = [process_one(entry) for entry in entries]
results = await asyncio.gather(*tasks)
```

两层并发：`num_workers=4` 多进程 + `max_concurrent_requests=50` 异步 API 并发 + 单轨迹 300s 超时。

**EvoClaw**（`packages/core/src/agent/kernel/context-compactor.ts:526-676` `autocompact()`）：

```typescript
export async function autocompact(
  messages: KernelMessage[],
  config: QueryLoopConfig,
): Promise<string> {
  // ...
  const response = await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  // 串行，单次调用，60s 超时
```

EvoClaw 没有批处理入口 —— `autocompact` 在 `maybeCompress` 内同步调用一次，单次 60s 超时。整个代码库搜索 `Semaphore` / `num_workers` / `trajectory.*jsonl` 无匹配。

**判定 🔴**：EvoClaw 无批处理预处理管线。但语义场景也不同 —— EvoClaw 每次压缩是单用户单会话一次，没有"批量压 2500 条训练数据"的需求。**若未来接入训练流水线需补齐**，工作量约 1 人周（TrajectoryCompressor 本体 + sample_and_compress.py + Metrics 聚合）。

---

### §3.3 精确 tokenizer（HuggingFace AutoTokenizer）

**hermes**（`.research/17-trajectory-compression.md §3.2` / `trajectory_compressor.py:161-213`）：

```python
def _init_tokenizer(self):
    """Default: moonshotai/Kimi-K2-Thinking (general-purpose agentic tokenizer)"""
    from transformers import AutoTokenizer
    self._tokenizer = AutoTokenizer.from_pretrained(
        self.config.tokenizer_name,
        trust_remote_code=self.config.trust_remote_code,
    )

def count_tokens(self, text: str) -> int:
    """Count tokens using HuggingFace tokenizer."""
    return len(self._tokenizer.encode(text, add_special_tokens=False))
```

训练场景必须精确 tokenize（超 max_seq_length 会训练失败）。默认 tokenizer 是 `moonshotai/Kimi-K2-Thinking`（对 XML/JSON/代码优化）。

**EvoClaw**（`packages/core/src/agent/kernel/context-compactor.ts:106-134`）：

```typescript
export function estimateTokens(messages: readonly KernelMessage[]): number {
  // 尝试从 usage 累积
  let totalFromUsage = 0;
  let hasUsage = false;
  for (const msg of messages) {
    if (msg.usage) {
      totalFromUsage += (msg.usage.inputTokens ?? 0) + (msg.usage.outputTokens ?? 0);
      hasUsage = true;
    }
  }
  if (hasUsage && totalFromUsage > 0) return totalFromUsage;
  // 回退: chars / 4
  let totalChars = 0;
  for (const msg of messages) { /* accumulate chars per block */ }
  return Math.ceil(totalChars / CHARS_PER_TOKEN);    // CHARS_PER_TOKEN = 4
}
```

EvoClaw 首选 LLM 返回的真实 `usage` 字段（精确），回退到 `chars/4` 粗估（±20% 误差）。无本地 tokenizer 依赖。

**判定 🔴**：对训练场景是硬缺口（精度决定能否装进 max_seq_length 窗口）。但对运行时场景影响有限 —— EvoClaw 已用真实 usage 兜底，粗估仅在首轮/无 usage 时启用，且阈值 93% 本身留了 7% 安全余量。**若未来做训练预处理**，需引入 `@huggingface/tokenizers` 或 `tiktoken` Node 绑定。

---

### §3.4 触发条件（长度/时间/手动）

**hermes**（`.research/17-trajectory-compression.md §3.3` / `trajectory_compressor.py:656-774`）：

```python
def compress_trajectory(self, trajectory):
    turn_tokens = self.count_turn_tokens(trajectory)
    total_tokens = sum(turn_tokens)
    # 提前退出：已经在目标以下
    if total_tokens <= self.config.target_max_tokens:
        metrics.skipped_under_target = True
        return trajectory, metrics
```

单阈值 `target_max_tokens=15_250`：超过就压，不超就跳过。无时间阈值、无分级、无状态机。

**EvoClaw**（`packages/core/src/agent/kernel/context-compactor.ts:37-59, 929-1021`）：

```typescript
const TOKEN_THRESHOLDS = {
  warning: 0.90,       // UI 警告
  autoCompact: 0.93,   // 触发自动压缩
  hardLimit: 0.99,     // 阻断输入
};
const PROACTIVE_SNIP_THRESHOLD = 0.91;
const TIME_BASED_MC_THRESHOLD_MS = 5 * 60 * 1000;    // Anthropic Prompt Cache TTL

export type CollapsePhase =
  | 'normal'          // < 90%
  | 'warning'         // 90-91%
  | 'proactive_snip'  // 91-93% — 主动 snip（不等 413）
  | 'autocompact'     // 93%+ — 完整压缩
  | 'emergency'       // 413 后
  | 'exhausted';      // 多次 emergency 仍失败

export async function maybeCompressPhased(messages, config, collapseState) {
  const ratio = estimated / contextWindow;
  if (ratio < TOKEN_THRESHOLDS.warning) return { ...collapseState, phase: 'normal' };
  if (ratio < PROACTIVE_SNIP_THRESHOLD) return { ...collapseState, phase: 'warning' };
  if (ratio < TOKEN_THRESHOLDS.autoCompact) { /* 主动 snip */ return { ...collapseState, phase: 'proactive_snip' }; }
  // >= 93%: 完整三层压缩 ...
}
```

触发维度：3 档阈值（90/93/99%）+ 时间（Anthropic Cache TTL 5 分钟）+ 手动（`hard_limit` trigger）+ 413 emergency + 熔断器耗尽。6 阶段状态机驱动。

**判定 🟢**：反超。hermes trajectory 是离线批处理，单阈值够用；但"trajectory 压缩"作为通用命题看，EvoClaw 的分级阈值 + 时间触发 + 状态机远胜单阈值。

---

### §3.5 压缩算法（分层 vs 单层）

**hermes**（`.research/17-trajectory-compression.md §3.3` / `trajectory_compressor.py:294-387` 5 阶段）：

```python
# 阶段 1：令牌计数
# 阶段 2：识别保护区域 (_find_protected_indices)
# 阶段 3：计算压缩预算
# 阶段 4：LLM 摘要生成 (Gemini Flash Preview)
# 阶段 5：组装（头 + 摘要[human] + 尾）
compressed.append({"from": "human", "value": summary})    # 摘要插入为 human role
```

单层：一次性计算需压缩的中间区间 → 调一次 LLM → 替换。**没有"先零成本尝试，再 LLM"的分层**。

**EvoClaw**（`packages/core/src/agent/kernel/context-compactor.ts:710-828, 929-1021`）：

```typescript
// maybeCompressPhased / maybeCompress 内部流程（93% 阈值触发后）：

// Layer 1: Snip (零成本)
const snipped = snipOldMessages(messages);
if (estimateTokens(messages) < threshold) return true;    // 够了就停

// Layer 1.5: Strip old thinking blocks (零成本)
stripOldThinkingBlocks(messages);
if (estimateTokens(messages) < threshold) return true;

// Layer 2: Microcompact (零成本, Anthropic 协议 Shadow 模式)
const truncated = microcompactToolResults(messages, config.protocol);
if (estimateTokens(messages) < threshold) return true;

// Layer 3: Autocompact (1 次 LLM 调用) — 上面都不够才调 LLM
const summaryText = await autocompact(messages, config);
```

分层短路：零成本路径优先，LLM 摘要最后。Layer 1.5 还清理旧 assistant 的 thinking 块（Anthropic API 约束下可回收大量 token）。

**判定 🟢**：反超。分层能显著节省 LLM 成本 —— 许多场景 Snip + Microcompact 已够。对运行时压缩尤其关键（hermes trajectory 是离线一次性花销，不在乎那点钱；EvoClaw 运行时每次触发都要付成本）。

---

### §3.6 Snip 零成本移除旧消息

**hermes**（trajectory 压缩无对应机制）：

hermes trajectory 的"保护区"只是识别保护范围，**中间 35 条 turn → 1 条 human role 摘要**（`.research/17-trajectory-compression.md §4.1` 压缩前后对比示例）。没有"零成本路径"，每次 compress 必调 LLM。

```python
# hermes _find_protected_indices 只识别，不移除
# 真正的"移除"是在 _generate_summary 调 LLM 后用摘要替换中间段
```

**EvoClaw**（`packages/core/src/agent/kernel/context-compactor.ts:149-167`）：

```typescript
const SNIP_KEEP_RECENT = 8;

export function snipOldMessages(messages: KernelMessage[]): number {
  if (messages.length <= SNIP_KEEP_RECENT + 1) return 0;
  const keepFirst = messages[0]; // 初始上下文
  const keepRecent = messages.slice(-SNIP_KEEP_RECENT);
  const removed = messages.length - 1 - SNIP_KEEP_RECENT;
  messages.length = 0;
  if (keepFirst) messages.push(keepFirst);
  messages.push(...keepRecent);
  if (removed > 0) log.info(`Snip: 移除 ${removed} 条旧消息，保留 ${messages.length} 条`);
  return Math.max(0, removed);
}
```

零成本：只保留首条（初始上下文）+ 末 8 条，中间全丢。无 LLM 调用。

**判定 🟢 独有**：hermes trajectory 压缩没有零成本路径（每次压缩都必须调 Gemini Flash）。EvoClaw 的 Snip 在"对话只是很长但信息尾部集中"的典型场景能零成本脱困，大幅降低成本。

---

### §3.7 Microcompact 零成本截断 tool_result

**hermes**（`.research/17-trajectory-compression.md §3.5` / `trajectory_compressor.py:491-515`）：

```python
def _extract_turn_content_for_summary(self, trajectory, start, end):
    parts = []
    for i in range(start, end):
        value = turn.get("value", "")
        # 截断超长 turn（保留前 3000 字符）
        if len(value) > 3000:
            value = value[:3000] + "... [truncated]"
        parts.append(f"[{role.upper()}]: {value}")
    return "\n\n".join(parts)
```

一刀切 3000 字符前缀 + `[truncated]`。只发生在"摘要输入准备"阶段，**不改变原轨迹**（原 JSONL 仍保留完整 tool_result）。

**EvoClaw**（`packages/core/src/agent/kernel/context-compactor.ts:52-57, 236-343`）：

```typescript
const MICROCOMPACT_TRUNCATE_THRESHOLD = 5_000;
const HEAD_RATIO = 0.7;     // 头 70% + 尾 30%

export function microcompactToolResults(
  messages: KernelMessage[],
  protocol?: import('./types.js').ApiProtocol,
): number {
  const useShadow = protocol === 'anthropic-messages';
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type !== 'tool_result') continue;
      const oversized = block.content.length > MICROCOMPACT_TRUNCATE_THRESHOLD;
      if (!shouldTruncate) continue;
      if (!useShadow) {
        const headBudget = Math.floor(MICROCOMPACT_TRUNCATE_THRESHOLD * HEAD_RATIO);
        const tailBudget = MICROCOMPACT_TRUNCATE_THRESHOLD - headBudget;
        const head = original.slice(0, headBudget);
        const tail = original.slice(-tailBudget);
        (block as { content: string }).content =
          `${head}\n\n... [省略 ${omitted} 字符] ...\n\n${tail}`;
      }
      // Shadow 模式: 仅标记 microcompacted=true，不改 content（保护 Prompt Cache）
    }
  }
}
```

字节级 5KB 阈值 + 头 70% / 尾 30%（保留入参头 + 结论尾）+ Shadow 模式（Anthropic 协议下不改原消息，延迟到 API 构建时截断）。还有 `microcompactCacheAware`（L297-321）优先截断 cacheBreakpoint 之后。

**判定 🟢 独有**：hermes 的 3000 字符一刀切是"最简实现"，EvoClaw 的 70/30 保留 + Shadow 模式对 Anthropic Prompt Cache 友好。对运行时优化敏感，训练前批处理则无所谓。

---

### §3.8 Autocompact LLM 9 段摘要

**hermes**（`.research/17-trajectory-compression.md §3.4` / `trajectory_compressor.py:410-471`）：

```python
prompt = f"""Summarize the following agent conversation turns concisely. This summary will replace these turns in the conversation history.

Write the summary from a neutral perspective describing what the assistant did and learned. Include:
1. What actions the assistant took (tool calls, searches, file operations)
2. Key information or results obtained
3. Any important decisions or findings
4. Relevant data, file names, values, or outputs

Keep the summary factual and informative. Target approximately {self.config.summary_target_tokens} tokens.

---
TURNS TO SUMMARIZE:
{content}
---

Write only the summary, starting with "[CONTEXT SUMMARY]:" prefix."""
```

4 点自由文本要求 + `[CONTEXT SUMMARY]:` 前缀。目标 750 tokens。摘要作为 `human` role 插入（避免 `gpt → gpt` 角色碰撞）。

**EvoClaw**（`packages/core/src/agent/kernel/context-compactor.ts:402-417`）：

```typescript
const AUTOCOMPACT_SYSTEM_PROMPT = '你是对话摘要助手。请用中文生成准确、详细的对话摘要。';

const AUTOCOMPACT_TEMPLATE = `请总结以下对话，使用以下 9 个章节:

1. **用户核心需求** — 所有用户的明确请求和意图
2. **关键技术概念** — 涉及的框架、技术、工具
3. **文件和代码** — 读取、修改、创建的文件，包含关键代码片段
4. **错误与修复** — 遇到的错误及解决方式，特别是用户反馈
5. **问题解决** — 已解决的问题和进行中的排查
6. **用户消息摘要** — 所有非工具结果的用户消息
7. **待办任务** — 明确被要求但尚未完成的工作
8. **当前工作** — 摘要前正在进行的具体工作，含文件名和代码
9. **下一步** — 与最近工作直接相关的下一步计划

对话内容:
`;
```

9 段结构化（参考 Claude Code prompt.ts 模板）—— 信息保留维度更细（尤其待办/下一步/错误三段对会话续作关键）。

**判定 🟢**：反超。hermes 4 点自由文本适合训练数据（模型会学习任意格式），EvoClaw 9 段结构化更适合运行时回放（重启会话时 LLM 能直接按 9 段结构恢复工作记忆）。对 hermes trajectory 场景 9 段过重，但对 EvoClaw 场景更合适。

---

### §3.9 熔断器（连续失败停止）

**hermes**（`.research/17-trajectory-compression.md §3.4` / `trajectory_compressor.py:432-471`）：

```python
for attempt in range(self.config.max_retries):    # max_retries=3
    try:
        response = self.client.chat.completions.create(...)
        return response.choices[0].message.content
    except Exception as e:
        metrics.summarization_errors += 1
        if attempt < self.config.max_retries - 1:
            wait = jittered_backoff(attempt + 1, base_delay=self.config.retry_delay, max_delay=30.0)
            time.sleep(wait)
        else:
            # 最后一次尝试也失败 → fallback
            return f"[CONTEXT SUMMARY]: [Summary generation failed - {len(content)} chars of content omitted]"
```

单轨迹内部 3 次重试 + fallback 到错误占位符。**没有"跨轨迹累计失败熔断"**—— 如果 OpenRouter 整体挂了，全部 2500 条都会重试 3 次（浪费 API 预算）。

**EvoClaw**（`packages/core/src/agent/kernel/context-compactor.ts:46-47, 699-827, 993-1020`）：

```typescript
const MAX_CONSECUTIVE_FAILURES = 3;
let consecutiveAutocompactFailures = 0;

// maybeCompress 内:
if (consecutiveAutocompactFailures >= MAX_CONSECUTIVE_FAILURES) {
  log.warn(`Autocompact 熔断器触发: 连续 ${consecutiveAutocompactFailures} 次失败，跳过`);
  return true; // snip + microcompact 已执行
}
try {
  const summaryText = await autocompact(messages, config);
  consecutiveAutocompactFailures = 0;
} catch (err) {
  consecutiveAutocompactFailures++;
  log.warn(`Autocompact 失败 (${consecutiveAutocompactFailures}/${MAX_CONSECUTIVE_FAILURES}): ...`);
}

// maybeCompressPhased 内同样机制，追踪在 CollapseState.consecutiveFailures，
// 失败 3 次后进入 'exhausted' 阶段
```

跨请求累计失败熔断 + `CollapsePhase.exhausted` 终态。Provider 宕机时后续请求直接跳过 Autocompact，不浪费 API 预算。

**判定 🟢 独有**：hermes 无跨请求累计熔断，EvoClaw 对运行时故障场景更鲁棒。对 hermes 训练前批处理场景影响较小（单次批作业，失败率容忍度高），对 EvoClaw 7×24 运行时关键。

---

### §3.10 压缩结果的持久化

**hermes**（`.research/17-trajectory-compression.md §2, §3.7`）：

```python
# scripts/sample_and_compress.py main():
sampled_dir = Path(f"data/{output_name}/sampled")        # 阶段 1 输出
compressed_dir = Path(f"data/{output_name}/compressed")  # 阶段 2 输出（每 trajectory 独立 JSONL）
final_output = Path(f"data/{output_name}/final_compressed.jsonl")  # 阶段 3 merge
# 同时输出 compression_metrics.json（相对 output 目录）
```

磁盘 JSONL 产物：原始 JSONL → sampled JSONL → compressed JSONL → merged JSONL + metrics JSON。**产出新文件，原 JSONL 不变**。

**EvoClaw**（`packages/core/src/routes/chat.ts:983-1002` + `packages/core/src/memory/conversation-logger.ts:140-155` + `packages/core/src/memory/session-summarizer.ts:86-111`）：

```typescript
// routes/chat.ts: postCompactHook
postCompactHook: async (trigger, tokensBefore, tokensAfter, summaryText) => {
  // 1. 写入 compaction_boundary 到 conversation_log
  store.run(
    `INSERT INTO conversation_log (id, agent_id, session_key, role, content, compaction_status, entry_type, created_at)
     VALUES (?, ?, ?, 'system', ?, 'compacted', 'compaction_boundary', ?)`,
    crypto.randomUUID(), agentId, sessionKey,
    JSON.stringify({ trigger, tokensBefore, tokensAfter }),
    new Date().toISOString(),
  );
  // 2. 持久化摘要到 session_summaries
  if (summaryText && sessionSummarizer) {
    sessionSummarizer.save(agentId, sessionKey, summaryText, tokensAfter, 0, 0);
  }
},

// memory/session-summarizer.ts: UPSERT
if (existing) {
  this.db.run(`UPDATE session_summaries SET summary_markdown = ?, ...`);
} else {
  this.db.run(`INSERT INTO session_summaries (id, agent_id, session_key, summary_markdown, ...) VALUES (?, ?, ?, ?, ...)`);
}

// memory/conversation-logger.ts: 压缩状态流转
markCompacted(ids: string[], summaryId: string): void {
  this.db.run(
    `UPDATE conversation_log
     SET compaction_status = 'compacted', compaction_ref = ?
     WHERE id IN (${placeholders})`,
    summaryId, ...ids,
  );
}
```

持久化到 SQLite：`conversation_log.compaction_boundary` 事件行（记 trigger/tokensBefore/tokensAfter 为 JSON）+ `session_summaries` 表（UPSERT 9 段摘要）+ 原始消息 `compaction_status` 由 `raw` 流转为 `compacted`（见 migration `004_conversation_log.sql:10` CHECK 约束）。

**判定 🟡**：形态差异 —— hermes 磁盘 JSONL（适合喂训练），EvoClaw SQLite 行（适合 DB 查询/崩溃恢复/跨启动会话续作）。**各自场景最优**，互不替代。

---

### §3.11 可回溯性（压缩后能否取回原始）

**hermes**（`.research/17-trajectory-compression.md §1-§2`）：

- 压缩前 JSONL（sampled）仍保留在 `data/{output_name}/sampled/`
- 压缩后 JSONL（compressed）是独立产物
- 可通过 diff 原始 vs 压缩 JSONL 取回中间段
- 但压缩中间段的原始 turns **不在**最终 JSONL 里，只是磁盘上仍留有 sampled 版本

**EvoClaw**（`packages/core/src/memory/conversation-logger.ts:140-155` + `packages/core/src/infrastructure/db/migrations/004_conversation_log.sql:10`）：

```sql
compaction_status TEXT NOT NULL DEFAULT 'raw' CHECK (compaction_status IN ('raw','extracted','compacted','archived')),
compaction_ref TEXT,
```

原始消息行仍在 `conversation_log`，只是 `compaction_status` 变为 `compacted`，`compaction_ref` 指向摘要 ID。查询时可用 `WHERE compaction_status='raw' OR compaction_status='compacted'` 拿回全部原始消息。`routes/chat.ts:110-220` 的三级恢复策略（Level 1: 最近 compaction_boundary / Level 2: session_summary / Level 3: last-N）正是基于这种可回溯性。

**判定 🟡**：各有取回路径。hermes 靠多份文件保留（训练后可人工 diff），EvoClaw 靠 DB 状态字段（运行时可 SQL 查询）。EvoClaw 对"用户想看压缩前原对话"场景更顺手。

---

### §3.12 多次压缩级联（二次压缩 / 压缩链）

**hermes**（`.research/17-trajectory-compression.md §1 表格`）：

> | **迭代更新** | 有（保留 `_previous_summary`） | 无（每条轨迹独立） |

hermes `trajectory_compressor` **每条轨迹独立处理，无级联**。runtime `context_compressor.py` 有 `_previous_summary` 迭代更新，trajectory 侧没有。

**EvoClaw**（`packages/core/src/agent/kernel/context-compactor.ts:929-1021` + `packages/core/src/memory/session-summarizer.ts:21-74`）：

```typescript
// maybeCompressPhased: 同一 session 内可多次触发
// CollapsePhase: normal → warning → proactive_snip → autocompact → emergency → exhausted
// consecutiveFailures 追踪累计失败

// SessionSummarizer.summarize: 增量更新 Markdown 笔记
async summarize(agentId, sessionKey, messages, existingSummary?) {
  let userPrompt: string;
  if (existingSummary) {
    userPrompt = `以下是之前的会话摘要：\n${existingSummary}\n\n以下是新增的对话内容：...
请在之前摘要的基础上，整合新增对话的关键信息，生成更新后的摘要。`;
  } else {
    userPrompt = `请为以下对话生成摘要笔记：...`;
  }
  const summary = await this.llmCall(system, userPrompt);
  this.save(agentId, sessionKey, summary, messages.length, 0, 0);    // UPSERT
  return summary;
}
```

两层级联：
- Kernel 三层压缩**在同一 session 内可多次触发**（每次超 93% 阈值），`CollapseState` 追踪阶段转换
- `SessionSummarizer` 增量更新（含 `existingSummary` 时 LLM prompt 会整合旧摘要 + 新增对话）

**判定 🟡**：形态差异。hermes trajectory 每条独立（训练样本互不影响）是设计选择；EvoClaw 运行时必须支持级联（一次会话可能跨天/多次压缩）。EvoClaw 的 UPSERT 增量更新在运行时更合理。

---

### §3.13 压缩指标（token 节省率 / 信息损失估计）

**hermes**（`.research/17-trajectory-compression.md §3.6` / `trajectory_compressor.py:155-302`）：

```python
@dataclass
class TrajectoryMetrics:
    original_tokens: int = 0
    compressed_tokens: int = 0
    tokens_saved: int = 0
    compression_ratio: float = 1.0
    original_turns: int = 0
    compressed_turns: int = 0
    turns_removed: int = 0
    turns_compressed_start_idx: int = -1
    turns_compressed_end_idx: int = -1
    turns_in_compressed_region: int = 0
    was_compressed: bool = False
    still_over_limit: bool = False
    skipped_under_target: bool = False
    summarization_api_calls: int = 0
    summarization_errors: int = 0

@dataclass
class AggregateMetrics:
    # 累计统计 + mean/median/error_rate 分布
    compression_ratios: List[float] = field(default_factory=list)
    tokens_saved_list: List[int] = field(default_factory=list)
    ...
    # 输出到 compression_metrics.json
```

双层聚合：per-trajectory 14 字段 + aggregate（含 mean/median/error_rate + processing_duration_seconds）。JSON 落盘便于事后分析。

**EvoClaw**（`packages/core/src/agent/kernel/context-compactor.ts:162-163, 211-213, 282, 316-317, 509, 674, 775, 792, 811, 825, 955, 1003` 及相关 log 点）：

```typescript
log.info(`Snip: 移除 ${removed} 条旧消息，保留 ${messages.length} 条`);
log.info(`Strip thinking: 清除 ${stripped} 个旧 thinking 块`);
log.info(`Microcompact: ${useShadow ? '标记' : '截断'} ${truncatedCount} 个 tool_result`);
log.info(`Autocompact: 摘要 ${summary.length} 字符，保留 ${keepCount} 条最近消息`);
log.info(`Autocompact 边界: ${msgCountBefore} → ${messages.length} 消息`);
```

仅 log.info 文本，无结构化 Metrics 类、无聚合统计、无 JSON 落盘。`postCompactHook` 传了 `tokensBefore/tokensAfter/trigger` 但只写 `conversation_log.content` JSON 字符串，没有专门的 metrics 表。

**判定 🔴**：缺失。hermes 的双层 Metrics 对运维分析（"压缩率分布如何？哪些 session 压缩最无效？"）很有用。EvoClaw 需补齐结构化 CompressionMetrics + AggregateMetrics 类 + `compression_metrics` 表或 JSON 导出入口。**P1 工作量约半人周**。

---

### §3.14 与 Memory L0/L1/L2 的协同

**hermes**（`.research/17-trajectory-compression.md`）：

hermes `trajectory_compressor` **无记忆层**，每条轨迹独立，所有可压缩信息走 LLM 摘要路径。`_previous_summary` 只存在于 runtime `context_compressor.py`。

**EvoClaw**（`packages/core/src/agent/kernel/session-memory-compact.ts:89-143, 252-291` + `packages/core/src/agent/kernel/context-compactor.ts:736-749`）：

```typescript
// context-compactor.ts: 压缩入口优先级
export async function maybeCompress(messages, config) {
  // ──── 优先级 1: Session Memory Compact（零 API 成本）────
  if (Feature.SESSION_MEMORY_COMPACT && _memoryQueryFn && config.agentId && config.sessionKey) {
    const smResult = trySessionMemoryCompact(
      messages, config.agentId, config.sessionKey, _memoryQueryFn, estimateTokens,
    );
    if (smResult.success) {
      messages.length = 0;
      messages.push(...smResult.messages);
      log.info(`SM Compact: 释放 ~${smResult.tokensFreed} tokens (零 API 成本)`);
      return true;
    }
  }
  // ──── 优先级 2: 传统三层压缩 ────
  // ...
}

// session-memory-compact.ts: 记忆 → 摘要文本
function buildSMSummary(memories: readonly MemoryUnit[]): string {
  const grouped = new Map<MemoryCategory, MemoryUnit[]>();
  for (const m of memories) { /* group by category */ }
  const sections: string[] = ['[Session Memory 摘要 — 零成本压缩]'];
  for (const [category, units] of sortedCategories) {
    sections.push(`### ${CATEGORY_LABELS[category]}`);
    const sorted = units.sort((a, b) => b.activation - a.activation).slice(0, MAX_ENTRIES_PER_CATEGORY);
    for (const unit of sorted) {
      const text = unit.l1Overview.trim() || unit.l0Index.trim();    // L1 优先，L0 回退
      if (text) sections.push(`- ${text}`);
    }
  }
  return sections.join('\n');
}
```

SM Compact 将已提取的 L1 概览（9 类别分组 + 按 activation 排序 + 每类 Top 20）直接拼接为摘要替换历史 —— **零 API 调用**。优先级链：SM Compact → Snip → Microcompact → Autocompact。

**判定 🟢 独有**：hermes trajectory 完全无记忆层，EvoClaw 利用 L0/L1/L2 三层记忆将"已知总结"直接复用。在记忆提取管线跑够一段时间的 session 上，SM Compact 几乎 100% 命中，Autocompact 几乎不触发，成本节省显著。

---

## 4. 建议改造蓝图（不承诺实施）

### P0（重要且紧急）

无。trajectory 压缩与 EvoClaw 场景不重叠（hermes 面向训练，EvoClaw 面向运行时），运行时压缩层的反超已在 Sprint 8-10 完成。

### P1（可做，有 ROI）

1. **CompressionMetrics 结构化落库**（估 3-5 天）— §3.13 的硬缺口
   - 新增 `compression_metrics` 表：agent_id / session_key / trigger / tokens_before / tokens_after / messages_before / messages_after / layers_used（snip/micro/auto 位标记）/ duration_ms / created_at
   - `postCompactHook` 写 metrics 行
   - 新增 `/api/metrics/compression/aggregate?agent_id=X&window=7d` 端点返回 mean/median/p95 压缩率
   - ROI：运维可视化 + 诊断"哪些 session 压缩失效"

2. **SessionSummarizer 级联质量评估**（估 2 天）
   - 每次 UPSERT 时记录"上一轮摘要 → 本轮整合后摘要"的差异（Jaccard 相似度/token 增量）
   - 识别"摘要坍缩"现象（连续几轮差异过小说明 LLM 没提取新增信息）
   - ROI：SessionSummarizer 质量闭环

### P2（技术储备）

3. **Trajectory 导出工具**（估 1 周）
   - 新增 `/api/trajectory/export?agent_id=X&session_key=Y&format=sharegpt` 将 `conversation_log` 按 ShareGPT 格式导出为 JSONL
   - 配合 §3.11 可回溯性，提供"长 session 原样导出 + 压缩导出"两种模式
   - ROI：未来接入自有模型微调时直接复用，且用户可导出自己的对话数据

4. **精确 tokenizer 支持**（估 3-5 天）— §3.3
   - 引入 `@huggingface/tokenizers` 或 `tiktoken` Node 绑定
   - `estimateTokens` 增加可选的 `tokenizerName` 参数
   - ROI：在做 RAG 窗口预算或导出训练数据时，精度变重要

### 不建议做

- **HuggingFace 数据集批采样流水线**（hermes `sample_and_compress.py`）— EvoClaw 不训练模型，不需要上游数据。
- **`num_workers=4` 多进程架构**— Bun/Node 单进程 + worker_threads 足够，Python 的 multiprocessing 是 GIL 逃逸手段，JS 无此问题。
- **`asyncio.Semaphore(50)` 批并发**— 运行时场景每次只压缩 1 个 session，并发无意义；有意义时已由 `LaneQueue` 按车道并发处理。
- **直连 OpenRouter**— EvoClaw 已走 ModelRouter 统一路由（CLAUDE.md 明确规定"所有 LLM 调用统一走 ModelRouter"，辅助 LLM 走 callLLMSecondaryCached）。

---

## 5. EvoClaw 反超点汇总

> **注意**：§3 中已在 [`08-context-compression-gap.md`](./08-context-compression-gap.md) 重合的通用"三层压缩 / Shadow Microcompact / 9 段摘要结构 / 熔断器 / Strip Thinking / 缓存感知微压缩"不再重复列出。本表仅聚焦 **trajectory 维度**独有的反超（即"长会话归档压缩"这个更广义命题上 EvoClaw 胜出的能力）。

| # | 反超能力 | 代码证据 | hermes 对应缺失 |
|---|---|---|---|
| 1 | **SM Compact 与 Memory 记忆层协同** — 已提取的 L1 概览直接当摘要，零 API 成本 | `session-memory-compact.ts:89-143` `trySessionMemoryCompact`；`context-compactor.ts:736-749` 优先级链 | hermes trajectory 无记忆层，每条轨迹独立处理，每次必调 LLM |
| 2 | **compaction_boundary 持久化事件** — 压缩行为本身作为审计/恢复锚点 | `routes/chat.ts:985-1002` `postCompactHook` 写 conversation_log；migration `004_conversation_log.sql:10` 与 `021_conversation_log_hierarchy.sql:6` `entry_type='compaction_boundary'` | hermes 压缩产出新 JSONL 但未记录"压缩事件"本身 |
| 3 | **三级会话恢复链路** — compaction_boundary → session_summary → last-N 逐级回落 | `routes/chat.ts:110-220` `loadMessageHistory` Level 1/2/3 | hermes trajectory 压缩后无"压缩后 restore"路径（训练完不需要恢复） |
| 4 | **SessionSummarizer UPSERT 增量更新** — 整合 previous_summary + 新增对话 | `memory/session-summarizer.ts:42-74` `summarize()` 含 existingSummary 分支；`migration 019_session_summary.sql` UNIQUE INDEX on (agent_id, session_key) | hermes trajectory "每条轨迹独立、无迭代"（`.research/17-trajectory-compression.md §1 表格`） |
| 5 | **跨请求熔断器** — `consecutiveAutocompactFailures` 跨 session 累计 | `context-compactor.ts:46-47, 699-827`；`CollapseState.consecutiveFailures` @ `context-compactor.ts:80-90` | hermes 仅单轨迹内 `max_retries=3`，无跨轨迹熔断，Provider 宕机时浪费 2500× API 预算 |
| 6 | **compaction_status 生命周期流转** — raw → extracted → compacted → archived 四态 | `migration 004_conversation_log.sql:10` CHECK 约束；`memory/conversation-logger.ts:128-155` `markExtracted`/`markCompacted` | hermes 只有"原始 JSONL vs 压缩 JSONL"两态，无记忆化中间态 |
| 7 | **Memory 提取管线与压缩联动** — 压缩前已提取的记忆不会丢失 | `memory/conversation-logger.ts:107-123` `getPendingMessages(compaction_status='raw')` + `memory/memory-extractor.ts`（见 [`15-memory-providers-gap.md`](./15-memory-providers-gap.md)） | hermes trajectory 无记忆提取管线 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样

| # | 文件路径 | 行号范围 | 功能 | 已 Read |
|---|---|---|---|---|
| 1 | `packages/core/src/agent/kernel/context-compactor.ts` | 1-1021 | 三层压缩主模块 | ✅ |
| 2 | `packages/core/src/agent/kernel/context-compactor.ts` | 37-59 | TOKEN_THRESHOLDS + MICROCOMPACT_TRUNCATE_THRESHOLD | ✅ |
| 3 | `packages/core/src/agent/kernel/context-compactor.ts` | 72-94 | CollapsePhase + CollapseState | ✅ |
| 4 | `packages/core/src/agent/kernel/context-compactor.ts` | 149-167 | snipOldMessages | ✅ |
| 5 | `packages/core/src/agent/kernel/context-compactor.ts` | 183-215 | stripOldThinkingBlocks | ✅ |
| 6 | `packages/core/src/agent/kernel/context-compactor.ts` | 236-343 | microcompactToolResults + microcompactCacheAware | ✅ |
| 7 | `packages/core/src/agent/kernel/context-compactor.ts` | 402-417 | AUTOCOMPACT 9 段 prompt 模板 | ✅ |
| 8 | `packages/core/src/agent/kernel/context-compactor.ts` | 526-676 | autocompact 主函数 | ✅ |
| 9 | `packages/core/src/agent/kernel/context-compactor.ts` | 699-828 | maybeCompress + 熔断器 | ✅ |
| 10 | `packages/core/src/agent/kernel/context-compactor.ts` | 929-1021 | maybeCompressPhased 渐进式压缩 | ✅ |
| 11 | `packages/core/src/agent/kernel/session-memory-compact.ts` | 1-292 | SM Compact 零成本路径 | ✅ |
| 12 | `packages/core/src/memory/session-summarizer.ts` | 1-112 | SessionSummarizer UPSERT + 增量更新 | ✅ |
| 13 | `packages/core/src/memory/conversation-logger.ts` | 1-187 | ConversationLogger + compaction_status 流转 | ✅ |
| 14 | `packages/core/src/infrastructure/db/migrations/004_conversation_log.sql` | 1-18 | conversation_log 表 + compaction_status 四态 | ✅ |
| 15 | `packages/core/src/infrastructure/db/migrations/019_session_summary.sql` | 1-16 | session_summaries 表 + UNIQUE INDEX | ✅ |
| 16 | `packages/core/src/infrastructure/db/migrations/021_conversation_log_hierarchy.sql` | 1-12 | entry_type 字段（含 compaction_boundary） | ✅ |
| 17 | `packages/core/src/routes/chat.ts` | 110-220 | loadMessageHistory 三级恢复 | ✅ |
| 18 | `packages/core/src/routes/chat.ts` | 983-1002 | postCompactHook 持久化 | ✅ |
| 19 | `packages/core/src/agent/kernel/types.ts` | 504-599 | PreCompactHookFn / PostCompactHookFn 类型 | ✅ |

### 6.2 hermes 研究引用（章节 §）

- `.research/17-trajectory-compression.md §1` — 角色与定位（训练前 vs 运行时双压缩器对比表格）
- `.research/17-trajectory-compression.md §2` — 压缩流水线全景 mermaid
- `.research/17-trajectory-compression.md §3.1` — CompressionConfig 完整字段（L54-151）
- `.research/17-trajectory-compression.md §3.2` — TrajectoryCompressor 主类（L304-1297，含 _init_tokenizer / count_tokens）
- `.research/17-trajectory-compression.md §3.3` — compress_trajectory 5 阶段算法（L656-774）
- `.research/17-trajectory-compression.md §3.4` — _generate_summary 同步/异步版本（L532-654，含 prompt 模板）
- `.research/17-trajectory-compression.md §3.5` — _extract_turn_content_for_summary（L491-515，3000 字符截断）
- `.research/17-trajectory-compression.md §3.6` — TrajectoryMetrics + AggregateMetrics（L155-302）
- `.research/17-trajectory-compression.md §3.7` — sample_and_compress.py 两阶段流水线（L117-221, L316-409）
- `.research/17-trajectory-compression.md §4.1` — 压缩前后对比示例（20k/45 turns → 15k/9 turns）
- `.research/17-trajectory-compression.md §6` — 复刻清单
- `.research/17-trajectory-compression.md §7` — 延伸阅读（`_use_call_llm` flag、add_summary_notice 污染 prompt cache 等）

### 6.3 关联差距章节

- [`05-agent-loop-gap.md`](./05-agent-loop-gap.md) §3.8 —— 压缩策略入口（maybeCompressPhased 如何嵌入主循环），§3.9 —— 413 / max_output_tokens 恢复（contextCollapseDrain 紧急路径）
- [`08-context-compression-gap.md`](./08-context-compression-gap.md) —— 运行时压缩的完整对比（**"双压缩器"的另一半**，本章与其互补：08 聚焦入模型前的 context 压缩，本章聚焦 trajectory/长会话归档维度）
- [`14-state-sessions-gap.md`](./14-state-sessions-gap.md) §3.5 Session 恢复 / §3.13 Fork 会话分裂 —— compaction_boundary 作为恢复锚点的上游依赖
- [`15-memory-providers-gap.md`](./15-memory-providers-gap.md) —— §3.14 Memory L0/L1/L2 协同的上游，SM Compact 依赖 Memory 提取管线
- [`16-trajectory-format-gap.md`](./16-trajectory-format-gap.md) —— Trajectory 格式（ShareGPT JSONL schema），是本章压缩算法的输入格式

---

**文档结束**。综合判定 🟡，含 7 项 🟢 反超（其中 4 项独有），3 项 🔴 缺失（均与训练前批处理相关，产品定位决定不补齐或低优先级补齐）。
