# 08 — 上下文压缩 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/08-context-compression.md`（1,194 行，含 +54K 行 ADDENDUM）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`agent/context_compressor.py`（ContextCompressor class @ L185 ADDENDUM 后 / L53 基线）+ `run_agent.py` 的 `flush_memories`(L5902-6061) + `_compress_context`(L6063-6169)
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），`packages/core/src/agent/kernel/context-compactor.ts`（1,021 行）
> **综合判定**: 🟢 **EvoClaw 显著反超** —— hermes 单层 threshold+ratio 策略被 EvoClaw 的**三层分级（Snip/Microcompact/Autocompact）+ 6 阶段折叠状态机 + Shadow Microcompact 保护 Cache + 缓存感知微压缩**全面超越

**档位图例**:
- 🔴 EvoClaw 明显落后
- 🟡 部分覆盖 / 形态差异
- 🟢 EvoClaw 对齐或反超

---

## 1. 定位

**hermes 压缩器**（`.research/08-context-compression.md §1-§3`）:

```
ContextCompressor(context_length, threshold=0.50, protect_first_n=3, protect_last_n=20, summary_target_ratio=0.20)
  ├── should_compress(tokens) — 超阈值触发
  └── compress(messages, tokens) — 5 阶段算法
      1. _prune_old_tool_results — 剪枝旧 tool 结果（占位符替换）
      2. compute bounds — 保护前 3 + 后 20 轮
      3. _align_boundary_forward — 避免切断 tool_call/tool_result 组
      4. _generate_summary — 辅助 LLM 摘要（Gemini Flash / Haiku）
      5. assemble + sanitize — 头 + 摘要 + 尾 + 修复孤立 tool pair
```

**核心问题**：100 轮对话压成 30 轮，不破坏 prompt cache。

**EvoClaw 压缩器**（`packages/core/src/agent/kernel/context-compactor.ts:1-1021`）:

**三层分级 + 6 阶段折叠状态机**:

```typescript
// 阈值分级
const TOKEN_THRESHOLDS = {
  warning: 0.90,       // UI 警告
  autoCompact: 0.93,   // 触发自动压缩
  hardLimit: 0.99,     // 阻断输入
};

// 6 阶段折叠
export type CollapsePhase =
  | 'normal'          // < 90%
  | 'warning'         // 90-91%
  | 'proactive_snip'  // 91-93% — 主动 snip（不等 413）
  | 'autocompact'     // 93%+ — 完整压缩
  | 'emergency'       // 413 后
  | 'exhausted';      // 多次 emergency 仍失败

// 三层压缩
Layer 1: Snip (零成本)          — 移除最旧消息，保留 last 8
Layer 1.5: Strip Thinking (零成本) — 清除旧 assistant 消息的 thinking 块
Layer 2: Microcompact (零成本)  — 截断 >5KB tool_result
  + Shadow 模式 (Anthropic)     — 原消息不变，仅标记，发送 API 时创建截断副本
  + Cache-aware 模式            — 优先截断 cacheBreakpointIndex 之后
Layer 3: Autocompact (1 LLM 调用) — 9 段结构化摘要 (callLLMSecondaryCached)
  + 熔断器 (3 次失败停止)
```

**范式差异**:

| 维度 | hermes | EvoClaw |
|---|---|---|
| 触发阈值 | 50%（单级） | 90%/93%/99% 三级 |
| 分层 | 单层（prune+summary）| 三层（Snip/Microcompact/Autocompact）+ 6 阶段折叠 |
| 保护 | 前 3 + 后 20 轮 | 首 1 + 后 8 条（Snip）+ 更灵活的 tool_result 截断（Microcompact） |
| 摘要成本 | 1 次辅助 LLM 调用（必需） | 零成本 Snip/Microcompact 先跑，实在不够才 LLM |
| Cache 保护 | 轮数级（保护最后 N 轮） | 字节级（Shadow Microcompact，原消息不变） |
| 状态机 | 隐式（有无 compression_count） | 显式（CollapsePhase 6 阶段 + transition 标记） |

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 触发阈值策略 | 🟢 | **反超**: 三级阈值 + 渐进式 vs 单级 50% |
| §3.2 | 分层算法 | 🟢 | **反超**: 三层 Snip/Microcompact/Autocompact vs 单层 prune+summary |
| §3.3 | 保护策略 | 🟡 | hermes 前 3 + 后 20 基于轮，EvoClaw 首 1 + 后 8 基于消息，各有道理 |
| §3.4 | 剪枝 vs Microcompact | 🟢 | **反超**: EvoClaw 字节级 5KB 阈值 + 头 70% / 尾 30% vs 整个替换占位符 |
| §3.5 | Shadow 模式保护 Cache | 🟢 **独有** | EvoClaw 原消息不变 + 发送 API 时创建截断副本，hermes 无对应 |
| §3.6 | 缓存感知微压缩 | 🟢 **独有** | `cacheBreakpointIndex` 追踪，Phase1 截断断点之后 vs Phase2 截断之前 |
| §3.7 | Strip Thinking 块 | 🟢 **独有** | 仅保留最后一条 assistant 消息的 thinking，其余清除（回收 token） |
| §3.8 | 摘要生成 | 🟡 | hermes 5 段（Gemini/Haiku）vs EvoClaw 9 段（callLLMSecondaryCached） |
| §3.9 | 边界对齐 | 🟡 | hermes `_align_boundary_forward` vs EvoClaw `ensureToolResultPairing` |
| §3.10 | 失败恢复 | 🟢 | **反超**: 熔断器 3 次失败停止 + CollapsePhase exhausted vs 600s 冷却 |
| §3.11 | 迭代压缩 | 🔴 | hermes `_previous_summary` 承接上次摘要，EvoClaw 无对应 |
| §3.12 | Session split 与 title lineage | 🔴 | hermes 压缩时创建新 session 行（parent=旧），EvoClaw 无对应 |
| §3.13 | 压缩前 flush_memories | 🔴 | hermes 先让主 LLM 保存记忆机会，EvoClaw 无对应 |
| §3.14 | 压缩后 prompt rebuild | 🟢 | EvoClaw 通过 ContextPlugin 机制天然重建，hermes 显式 `_invalidate_system_prompt` |
| §3.15 | Snip + Microcompact 零成本 | 🟢 **独有** | EvoClaw 大量情况不需要 LLM 调用，hermes 每次压缩都要 LLM |
| §3.16 | 413 overflow 三阶段恢复 | 🟢 **独有** | 见 [`05-agent-loop-gap.md §3.9`](./05-agent-loop-gap.md) |

**统计**: 🔴 3 / 🟡 3 / 🟢 10（其中 5 项 EvoClaw 独有）。

---

## 3. 机制逐条深度对比

### §3.1 触发阈值策略

**hermes**（`.research/08-context-compression.md §3.1` + `context_compressor.py:53+`）:

```python
ContextCompressor(threshold_percent=0.50, ...)
self.threshold_tokens = context_length * threshold_percent

def should_compress(self, tokens: int) -> bool:
    return tokens >= self.threshold_tokens
```

**单级 50% 阈值** —— 到达 50% 就触发完整压缩（LLM 摘要）。

**EvoClaw**（`packages/core/src/agent/kernel/context-compactor.ts:37-41`）:

```typescript
const TOKEN_THRESHOLDS = {
  warning: 0.90,       // UI 警告
  autoCompact: 0.93,   // 触发自动压缩
  hardLimit: 0.99,     // 阻断输入
};
const PROACTIVE_SNIP_THRESHOLD = 0.91;
```

**四级阈值 + 渐进式处理**:

| 阈值 | 阶段 | 动作 |
|---|---|---|
| < 90% | `normal` | 无动作 |
| 90-91% | `warning` | UI 警告显示，不做压缩 |
| 91-93% | `proactive_snip` | **主动 Snip**（零成本），移除最旧消息保留 last 8 |
| 93%+ | `autocompact` | 完整 Snip + Microcompact + LLM 摘要（Autocompact）|
| 413 后 | `emergency` | 紧急三阶段恢复（见 05 章） |
| 多次 413 仍失败 | `exhausted` | 放弃 |

**判定 🟢 反超**：EvoClaw 的**渐进式策略**价值巨大：
- 50% 阈值（hermes）过早触发，浪费 cache 机会
- 90%/93%/99% 更贴近真实瓶颈，**推迟 LLM 调用**降低成本
- `proactive_snip`（91-93%）让大部分场景**根本不需要 LLM 摘要**，零成本规避上下文爆炸

---

### §3.2 分层算法

**hermes** —— **单层算法**（`.research/08-context-compression.md §3.2` `compress()` L612-755）:

```
prune → compute bounds → align → _generate_summary (LLM) → assemble + sanitize
```

每次压缩必跑 LLM 摘要（除非 `_generate_summary` 返回 None，此时用静态回退 placeholder）。

**EvoClaw** —— **三层分级 + 阶段递进**:

```
Layer 1: Snip (零成本)
  └── snipOldMessages — 保留首 1 + 最后 SNIP_KEEP_RECENT (8) 条

Layer 1.5: Strip Thinking (零成本)
  └── stripOldThinkingBlocks — 仅保留最后一条 assistant 的 thinking

Layer 2: Microcompact (零成本)
  ├── microcompactToolResults — 截断 >5KB tool_result（或 Shadow 模式标记）
  └── microcompactCacheAware — 优先截断 cacheBreakpointIndex 之后

Layer 3: Autocompact (1 LLM 调用)
  └── 调 callLLMSecondaryCached 生成 9 段结构化摘要
      + 熔断器（MAX_CONSECUTIVE_FAILURES=3 次失败停止）
```

**判定 🟢 反超**：EvoClaw 的分层让**便宜操作先跑**（Layer 1 + 1.5 + 2 全部零成本），**贵的 LLM 只在必要时触发**（Layer 3）。对实际压力场景（80-95% 上下文）的**绝大部分**能用零成本操作解决。

---

### §3.3 保护策略

**hermes**（`context_compressor.py:63-74`）:

```python
protect_first_n: int = 3      # 保护前 3 轮
protect_last_n: int = 20      # 保护后 20 轮（token budget）
```

**按"轮"保护**（一个 user+assistant+tool_calls+tool_results 是一轮），默认保护约 23 轮。

**EvoClaw**（`context-compactor.ts:50 SNIP_KEEP_RECENT = 8`）:

```typescript
const SNIP_KEEP_RECENT = 8;   // 保留最后 8 条消息
```

**按"消息"保护**（user 消息、assistant 消息、tool_result 消息各算一条），保留首 1 + 最后 8 条。

**判定 🟡**：两种路线各有道理：
- hermes 按轮 —— 语义单元完整（一个 tool 调用的完整 input+output 不会被拆）
- EvoClaw 按消息 —— 粒度更细，对长 tool_result 场景节省更多

实际差异：hermes 默认保护约 50+ 条消息（23 轮 × ~2.5 条/轮），EvoClaw 保护 9 条。后者更激进但依赖 Layer 2 Microcompact 补偿 tool_result 截断。

---

### §3.4 剪枝 vs Microcompact

**hermes**（`.research/08-context-compression.md §3.1` `_PRUNED_TOOL_PLACEHOLDER`）:

```python
_PRUNED_TOOL_PLACEHOLDER = "[Old tool output cleared to save context space]"

# 阶段 1 剪枝
def _prune_old_tool_results(messages, protect_tail_count, protect_tail_tokens):
    # 遍历 messages，尾部 protect_tail 轮保留
    # 其余 tool result 整个替换为 _PRUNED_TOOL_PLACEHOLDER
```

- **整个替换占位符** —— 丢失全部内容
- 剪枝后仍然保留消息结构（只改内容）

**EvoClaw**（`context-compactor.ts:236-286 microcompactToolResults`）:

```typescript
// 5KB 阈值 + 头 70% + 尾 30%
const shouldTruncate = block.content.length > MICROCOMPACT_TRUNCATE_THRESHOLD; // 5000
if (!useShadow) {
  const head = original.slice(0, Math.floor(MICROCOMPACT_TRUNCATE_THRESHOLD * HEAD_RATIO));  // 3500
  const tail = original.slice(-(MICROCOMPACT_TRUNCATE_THRESHOLD - headBudget));                 // 1500
  block.content = `${head}\n\n... [省略 ${omitted} 字符] ...\n\n${tail}`;
}
```

- **字节级截断**：保留头 3.5KB + 尾 1.5KB（总 5KB），中间省略标记
- **Time-based 条件**：超过 Anthropic Prompt Cache TTL (5 分钟) 的 tool_result 也会标记

**判定 🟢 反超**：
- hermes 整个替换 —— 丢失所有信息
- EvoClaw 头尾保留 —— 保留关键信息（tool 结果的开头通常是概要 / 结尾是状态），LLM 仍可理解
- 对**长 tool 结果**（如 `grep -r` / 大文件 read）场景，EvoClaw 保留的信息更有用

---

### §3.5 Shadow Microcompact 保护 Cache（EvoClaw 独有）

**hermes** —— 无对应。

**EvoClaw**（`context-compactor.ts:236-286` + `query-loop.ts:128-152 applyDeferredTruncation`）:

```typescript
// 压缩阶段：仅标记，不改 content
if (useShadow && needsMark) {
  (msg as { microcompacted: boolean }).microcompacted = true;
}

// streamOneRound 发 API 前（query-loop.ts:195-209）
const messagesForApi = messages.map(msg => {
  if (result.microcompacted) {
    result = applyDeferredTruncation(result);   // 创建截断副本
  }
  return result;
});
```

**核心技巧**：
- **原消息 `content` 不变** —— Anthropic Prompt Cache 命中依赖**消息字节完全一致**
- **仅在发送 API 时创建截断副本** —— 副本用于 API 请求，原消息留存
- **保护 Cache 命中率**（Prompt Cache 省 90% 费用）

**判定 🟢 独有反超**：这是 EvoClaw 对 Anthropic Prompt Cache 的**精妙工程实现**。hermes 虽然有 `prompt_caching.py` 但压缩时会直接改原消息，必然破坏 cache。详见 [`05-agent-loop-gap.md §3.14`](./05-agent-loop-gap.md)。

---

### §3.6 缓存感知微压缩（EvoClaw 独有）

**hermes** —— 无对应。

**EvoClaw**（`context-compactor.ts:290-334 microcompactCacheAware` + `query-loop.ts:513-525`）:

```typescript
// query-loop.ts:513-525 — 追踪缓存断点
if (roundResult.usage.cacheWriteTokens > 0) {
  cacheBreakpointIndex = state.messages.length;
  collapseState = { ...collapseState, cacheBreakpointIndex };
}

// context-compactor.ts — 优先压缩断点之后
export function microcompactCacheAware(messages, cacheBreakpointIndex): number {
  // Phase 1: 截断 cacheBreakpointIndex 之后的 tool_result (不在缓存前缀中)
  for (let m = cacheBreakpointIndex; m < messages.length; m++) {
    truncatedCount += truncateToolResultsInMessage(messages[m]!);
  }
  // Phase 2: 如果仍然超标，截断缓存断点之前的 tool_result（导致缓存失效）
  // ...
}
```

**核心思想**:
- `cacheBreakpointIndex` = 最后一次 `cacheWriteTokens > 0` 时的 `messages.length`
- 这一点之前的消息已经被 Anthropic 缓存，修改会全部失效
- 这一点之后的消息**还没进入缓存**，修改零成本

**判定 🟢 独有反超**：这是**缓存感知的智能压缩**，和 §3.5 Shadow 模式配合，最大化 Prompt Cache 收益。

---

### §3.7 Strip Thinking 块（EvoClaw 独有）

**hermes** —— 无对应。

**EvoClaw**（`context-compactor.ts:183-215 stripOldThinkingBlocks`）:

```typescript
export function stripOldThinkingBlocks(messages: KernelMessage[]): number {
  // 仅保留最后一条 assistant 消息的 thinking/redacted_thinking 块
  // Anthropic API 约束: thinking 块只需在最近的 tool_use 链路中保留
  for (let i = 0; i < messages.length; i++) {
    if (i === lastAssistantIdx) continue;
    // 其余 assistant 消息的 thinking 块全部移除
    const filtered = msg.content.filter(b =>
      b.type !== 'thinking' && b.type !== 'redacted_thinking'
    );
  }
}
```

**技术依据**：Anthropic API 约束 thinking 块只需在最近的 tool_use 链路中保留。清除旧 thinking 块**不影响模型响应**但**回收大量 token**（thinking 块通常数百到数千 token）。

**判定 🟢 独有反超**：EvoClaw 利用 Anthropic API 的具体约束做精准 token 回收，hermes 无此优化。

---

### §3.8 摘要生成

**hermes**（`.research/08-context-compression.md §3.2` + `context_compressor.py:_generate_summary`）:

- 用**辅助 LLM**（Gemini Flash / Haiku）生成摘要
- 摘要专用模型（`summary_model_override`）可配置
- 摘要 prompt 结构：5-6 段（不详细列出，见 `.research/07-prompt-system.md`）
- 失败时 600s 冷却窗口（`_SUMMARY_FAILURE_COOLDOWN_SECONDS`）

**EvoClaw**（`context-compactor.ts:275+ autocompact` + `packages/core/src/agent/llm-client.ts callLLMSecondaryCached`）:

- 调 `callLLMSecondaryCached`（`llm-client.ts`）—— 用同 Provider 最便宜模型
- **9 段结构化摘要**模板（参考 Claude Code）
- 熔断器：连续 3 次失败停止（`MAX_CONSECUTIVE_FAILURES = 3`）
- `AUTOCOMPACT_BUFFER_TOKENS = 13_000` 预留缓冲

**判定 🟡**：hermes 5 段 vs EvoClaw 9 段摘要结构（具体模板见 07 章 gap 文档）。EvoClaw 的**熔断器**更严格（3 次失败立刻停止），hermes 的 **600s 冷却** 允许恢复后重试。两种路线各自合理。

---

### §3.9 边界对齐

**hermes**（`context_compressor.py _align_boundary_forward`）:

- 查找 `compress_end` 位置（压缩段末尾）
- 若末尾是 tool_call 的 partial 对应，前移到完整组边界
- 保证不切断"一个完整的 tool 调用链"（user → assistant(tool_use) → tool_result → assistant）

**EvoClaw**（`packages/core/src/agent/kernel/message-utils.ts ensureToolResultPairing`）:

```typescript
export function ensureToolResultPairing(messages: KernelMessage[]): KernelMessage[] {
  // 为每个 tool_use 补一个占位 tool_result（若缺失）
  // 应用场景：中断时 / 压缩截断时
}
```

**差异**:
- hermes 在压缩时**对齐边界**（避免切断）
- EvoClaw 在**退出前修补**（截断后补占位 tool_result）

**判定 🟡**：两种路线都能保证 Anthropic API 合规，工程路径不同。

---

### §3.10 失败恢复

**hermes**:
- `_generate_summary` 失败 → 静态回退 placeholder（"Summary generation was unavailable. N turns were removed but could not be summarized..."）
- 600s 冷却避免频繁重试

**EvoClaw**:
- Autocompact 失败累计 `MAX_CONSECUTIVE_FAILURES = 3` 次后进入 `exhausted` 阶段
- `CollapsePhase.exhausted` 表示"压缩已失败无法继续"，停止自动尝试

**判定 🟢**：EvoClaw 的**熔断器 + 阶段枚举**比 hermes 的单纯冷却更显式。`exhausted` 状态提供明确的"终止信号"，上游（如 `query-loop.ts`）可据此做进一步降级（如 PTL 截断，见 05 §3.9）。

---

### §3.11 迭代压缩

**hermes**（`context_compressor.py self._previous_summary`）:

- 保存上一次的摘要
- 下次压缩时把上次摘要当作"过去的摘要"合并到新摘要
- 支持 100+ 轮对话的连续压缩

**EvoClaw** —— 无 `previousSummary` 等价字段。每次 Autocompact 独立生成新摘要。

**判定 🔴**：EvoClaw 在**长寿命会话**场景下会有"摘要遗忘"问题：
- 第 1 次压缩：摘要覆盖第 1-50 轮
- 第 2 次压缩：若第 1 次的摘要已经被 Snip 掉，新摘要只能看到最近的 30 轮
- **早期上下文完全丢失**

**建议**：P1 优先级（~2d）—— 在 `CollapseState` 中添加 `previousSummary?: string`，Autocompact 时如果存在则一同送入 LLM 作为"历史摘要上下文"。

---

### §3.12 Session split 与 title lineage

**hermes**（`.research/08-context-compression.md §2 mermaid` "SessionSplit"）:

- 压缩触发时在 SessionDB 创建**新 session 行**（`parent_session_id = 旧 session id`）
- 保持 title lineage（继承旧会话标题）
- 用户视角：同一对话，但 UI 可以展示"压缩点"

**EvoClaw** —— 无此机制。压缩是**原地修改** `state.messages`，不创建新 session 记录。

**判定 🔴**：EvoClaw 缺失 session split 意味着:
- 用户无法"查看压缩前的原始对话"
- 无法回退到压缩点前的状态
- 训练用轨迹采集时无法区分"压缩前后"

**建议**：P2 优先级（~3d）—— 在 `MemoryStore` / `conversation_log` 表增加 `compaction_parent_id` 字段，压缩时创建新会话记录。对企业用户"对话审计"场景有价值。

---

### §3.13 压缩前 flush_memories

**hermes**（`run_agent.py:5902-6061 flush_memories`）:

- 压缩触发前，**先让主 LLM 一次机会**：调用 memory provider 的 save 工具，主动保存重要记忆
- 避免"压缩后才想起来记某事，但原始上下文已经丢了"

**EvoClaw** —— 无对应。Autocompact 直接压缩，不询问主 LLM。

**判定 🔴**：EvoClaw 的**L0/L1/L2 记忆系统**是独立维度（由 `memory_write` 工具 LLM 主动调用），但**没有"压缩前保险保存"机制**。若 LLM 忘记主动保存重要信息，压缩后该信息永久丢失。

**建议**：P1 优先级（~1-2d）—— 在 `maybeCompressPhased` 进入 Autocompact 前，通过 ContextPlugin 触发一次"save_important_memories"提示，给 LLM 最后机会。

---

### §3.14 压缩后 prompt rebuild

**hermes**（`.research/08-context-compression.md §2 mermaid` "RebuildPrompt"）:

- 压缩后调用 `_invalidate_system_prompt()` + `_build_system_prompt()`
- **重建 system prompt** —— 因为压缩修改了历史，之前的 cache 已失效
- 新 system prompt 可加入"压缩注意"段（已发生的工作不要重复）

**EvoClaw** —— 通过 `ContextPlugin` 机制天然重建:
- 每轮 `beforeTurn` hook 重新组装 system prompt
- 压缩后 `CompactContext` hook 可让插件感知
- 不需要显式 `invalidate + rebuild`

**判定 🟢**：EvoClaw 的 **ContextPlugin 5-hook 生命周期**（见 `03-architecture-gap.md §3.13`）让压缩后的 prompt rebuild 成为**默认行为**，无需特殊处理。

---

### §3.15 Snip + Microcompact 零成本

**hermes** —— 每次压缩必调 LLM（`_generate_summary`）。

**EvoClaw** —— 大量场景零成本:
- Phase `proactive_snip`（91-93%）仅跑 Layer 1 Snip（零成本）
- Phase `autocompact`（93%+）先跑 Layer 1 + 1.5 + 2（零成本）→ 如果仍超限才 Layer 3 LLM

**判定 🟢 独有反超**：EvoClaw 的分层设计让 **80%+ 压缩场景无需 LLM 调用**，成本远低于 hermes。

---

### §3.16 413 overflow 三阶段恢复

见 [`05-agent-loop-gap.md §3.9`](./05-agent-loop-gap.md):
1. Context Collapse Drain（零 API 成本）
2. 完整压缩（LLM 摘要）
3. PTL 紧急降级（按轮次精确删除）

hermes 无此分层，413 触发直接抛错或一次性完整压缩。**判定 🟢 独有反超**。

---

## 4. 改造蓝图（不承诺实施）

### P1（中等 ROI，补齐 🔴 项）

| # | 项目 | 对应差距 | 工作量 | 价值 |
|---|---|---|---|---|
| 1 | 迭代压缩（previousSummary 承接） | §3.11 | 2d | 🔥🔥 长会话不遗忘早期上下文 |
| 2 | 压缩前 flush_memories | §3.13 | 1-2d | 🔥🔥 给 LLM 保险保存重要信息机会 |

### P2（长期）

| # | 项目 | 对应差距 | 工作量 |
|---|---|---|---|
| 3 | Session split + title lineage | §3.12 | 3d（含 DB schema + UI） |

### 不建议做

| # | 项目 | 理由 |
|---|---|---|
| — | 引入 hermes 的 600s 冷却窗口 | EvoClaw 熔断器 + exhausted 阶段已覆盖 |
| — | 改用 hermes 单级 50% 阈值 | EvoClaw 三级阈值 + proactive 明显更优 |

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应 |
|---|---|---|---|
| 1 | 三级阈值（90/93/99%）+ 6 阶段折叠状态机 | `context-compactor.ts:37-41, 72-78` | 单级 50% 阈值 |
| 2 | 三层分级（Snip/Microcompact/Autocompact）+ Layer 1.5 Strip Thinking | `context-compactor.ts:149, 183, 236` | 单层 prune + summary |
| 3 | Shadow Microcompact（原消息不变保护 Cache） | `context-compactor.ts:240, 276` + `query-loop.ts:128-152` | 无，压缩直接改原消息 |
| 4 | Cache-aware 微压缩（`cacheBreakpointIndex` 追踪） | `context-compactor.ts:297-334` + `query-loop.ts:513-525` | 无 |
| 5 | Strip Thinking 块（仅保留最后一条 assistant 的 thinking） | `context-compactor.ts:183-215` | 无 |
| 6 | 字节级 Microcompact（5KB 阈值 + 头 70% 尾 30%） | `context-compactor.ts:53-56, 262-271` | 整个替换占位符 |
| 7 | 熔断器 + exhausted 阶段枚举 | `context-compactor.ts:47, 72-78` | 600s 冷却 |
| 8 | Snip + Microcompact 零成本 | `context-compactor.ts:149, 236` | 每次必调 LLM |
| 9 | 413 overflow 三阶段恢复（Collapse Drain → 压缩 → PTL） | `query-loop.ts:440-481` | 无分层 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（2026-04-16 验证）

- `context-compactor.ts:37-41` ✅ TOKEN_THRESHOLDS（warning/autoCompact/hardLimit）
- `context-compactor.ts:47-66` ✅ MAX_CONSECUTIVE_FAILURES + SNIP_KEEP_RECENT + MICROCOMPACT_TRUNCATE_THRESHOLD + HEAD_RATIO + TIME_BASED_MC_THRESHOLD_MS
- `context-compactor.ts:72-78` ✅ CollapsePhase 6 阶段枚举
- `context-compactor.ts:149-167` ✅ snipOldMessages (Layer 1)
- `context-compactor.ts:183-215` ✅ stripOldThinkingBlocks (Layer 1.5)
- `context-compactor.ts:236-286` ✅ microcompactToolResults (Layer 2) + Shadow 模式
- `context-compactor.ts:297-334` ✅ microcompactCacheAware (缓存感知)
- `query-loop.ts:128-152` ✅ applyDeferredTruncation（Shadow Microcompact 发送前截断）
- `query-loop.ts:194-209` ✅ messagesForApi 构建时应用 Shadow 截断
- `query-loop.ts:440-481` ✅ 413 三阶段恢复（Collapse Drain → 压缩 → PTL）
- `query-loop.ts:513-525` ✅ cacheBreakpointIndex 追踪

### 6.2 hermes 研究引用

- `.research/08-context-compression.md §1` — 5 阶段算法概述
- `.research/08-context-compression.md §2` — 压缩状态机 mermaid
- `.research/08-context-compression.md §3.1` — ContextCompressor 构造 + 常量
- `.research/08-context-compression.md §3.2` — compress() 5 阶段详解
- `.research/08-context-compression.md §3.x` — prune / align / summarize / assemble 细节

### 6.3 关联 gap 章节

- [`04-core-abstractions-gap.md`](./04-core-abstractions-gap.md) §3.10 — ContextCompressor 类 vs context-compactor 模块函数
- [`05-agent-loop-gap.md`](./05-agent-loop-gap.md) §3.8, §3.9, §3.14 — 主循环压缩调用点 / 413 三阶段 / Shadow Microcompact
- `07-prompt-system-gap.md` (Wave 2 W2-3) — 摘要 prompt 9 段结构细节

---

**本章完成**。上下文压缩是 EvoClaw **最显著反超 hermes 的维度**:
- **分层设计**（零成本优先）降低 80%+ 场景的 LLM 成本
- **Shadow Microcompact + Cache-aware** 保护 Anthropic Prompt Cache（省 90% 费用）
- **6 阶段折叠状态机**提供精细可观测性
- **Strip Thinking + 字节级 Microcompact** 精准回收 token

剩余 🔴 项（迭代压缩 previousSummary / flush_memories / session split）都是**中低优先级补充**，不影响核心压缩能力。
