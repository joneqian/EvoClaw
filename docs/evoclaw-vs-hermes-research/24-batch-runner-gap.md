# 24 — Batch Runner（批量处理引擎）差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/24-batch-runner.md`（232 行，Phase E draft）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`batch_runner.py:1-1287`（1287 行，单文件大规模离线批处理引擎）
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16）
> **综合判定**: 🔴 **整体缺失 / 取向不同** — EvoClaw 无评测/训练数据生成型批处理引擎；产品定位差异导致大部分能力"不建议补齐"，仅 2 项（quality gate / 内容匹配续传思路）可借鉴到 Cron 领域

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes Batch Runner**（`.research/24-batch-runner.md` §1，`batch_runner.py:1-1287`）—— **大规模离线批处理引擎**，单文件 1287 行。职责非常明确：**给定 JSONL 数据集 + batch_size + num_workers，用 `multiprocessing.Pool` 多进程并发跑 AIAgent，把每条 prompt 的 trajectory / tool_stats / reasoning_stats 写到 `data/{run_name}/batch_*.jsonl`，最终合并成 `trajectories.jsonl` + `statistics.json`**。面向三类用户：

1. **评测研究员** — 不同模型/参数/toolset 分布对比基线
2. **微调 / RL 训练数据生产者** — 产出 ShareGPT 格式的 trajectory 喂给训练管线
3. **Dataset 清洗者** — 过滤幻觉条目、推理覆盖不足样本等质量控制

关键特征：**每 prompt 独立 AIAgent 实例**（`save_trajectories=False` + `skip_memory=True` 隔离状态避免跨 prompt 污染）；**内容匹配续传**（扫 `batch_*.jsonl` 已保存 prompt 文本）而非索引续传——支持数据集重排序后恢复；**ALL_POSSIBLE_TOOLS 自动导出**（`.research/24-batch-runner.md` §2）保证 HuggingFace datasets schema 一致；**`has_any_reasoning` 质量控制**丢弃推理覆盖为空样本。

**EvoClaw 对应子系统** —— **不存在**。EvoClaw 是面向企业非技术用户的 AI 伴侣桌面应用（CLAUDE.md "面向企业级用户非开发者"），没有"给研究员跑 1000 条 prompt 生成数据集"这类场景。与"批量执行 Agent"在工程上最接近的三个子系统，语义都不是 hermes batch runner 的对应物：

- `packages/core/src/scheduler/cron-runner.ts:56-309` — **Cron 定时任务**：运维/用户定时推送导向（"每天 9 点发晨报"），单 Job 单次触发，**无数据集 / 无批次 / 无结果收集 / 无 checkpoint / 无多进程**
- `packages/core/src/scheduler/heartbeat-manager.ts:25-139` + `heartbeat-runner.ts:52-234` — **Heartbeat 心跳**：per-Agent 长心跳，面向"持续意识注入"，同样无批次/数据集概念
- `packages/core/src/agent/sub-agent-spawner.ts:197-1200+` — **Sub-Agent Spawn + LaneQueue**：Agent 派生子 Agent 执行子任务，走 `subagent` 车道（8 并发），有 `yield_agents` 等待多子代完成——这在"并发执行多个独立 Agent 任务"维度最接近，但**无 JSONL 数据集驱动、无 trajectory 收集导出、无 checkpoint、无质量过滤**

**grep 验证**:
- `grep -r "batch_runner\|BatchRunner" packages/core/src/` → **0 结果**（含测试/文档，下同）
- `grep -r "multiprocessing\|ThreadPoolExecutor" packages/core/src/` → **0 结果**
- `grep -r "dataset" packages/core/src/` → 仅命中少量 SKILL.md 字面词，无实际批处理代码
- `grep -r "trajectories.jsonl\|rollout\|evaluator" packages/core/src/` → **0 结果**

**量级对比**: hermes 单文件 1287 行 vs EvoClaw 0 行。形态差异不是"量级"能衡量的——**EvoClaw 没有"训练 / 评测 / 数据集"三层面向的工程路径**，这是产品定位差异（企业用户桌面 IM 助手 vs. 研究员离线训练数据生成）的必然结果。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | Batch 引擎骨架（多进程并发 prompt 池） | 🔴 | EvoClaw 完全缺失；`grep multiprocessing` 零结果；Sub-Agent Spawn 不等价 |
| §3.2 | JSONL 数据集加载 / 批次切分 | 🔴 | EvoClaw 无 dataset 概念；`grep dataset` 仅命中 SKILL.md 字面词 |
| §3.3 | 每 prompt 隔离 AIAgent（`skip_memory / skip_context_files / save_trajectories=False`） | 🔴 | EvoClaw `runEmbeddedAgent` 入口恒返回 memory/workspace，无"纯净实例"选项 |
| §3.4 | Tool Stats 提取（count/success/failure per tool） | 🔴 | EvoClaw 无聚合统计；只有 per-session TaskRegistry 进度 |
| §3.5 | Reasoning Stats / `has_any_reasoning` 质量门 | 🔴 | EvoClaw 无推理覆盖检测，`grep reasoning_stats\|has_any_reasoning` 零结果 |
| §3.6 | Trajectory 格式导出（ShareGPT `{from, value}`） | 🔴 | 见 16-trajectory-format-gap.md（格式已判定 🔴 缺失） |
| §3.7 | Checkpoint 原子写入（断点续传） | 🔴 | EvoClaw `grep checkpoint` 零结果；Cron `consecutive_errors` 是熔断不是续传 |
| §3.8 | 内容匹配续传（prompt text 匹配 vs 索引匹配） | 🔴 | EvoClaw 无续传概念可谈 |
| §3.9 | ALL_POSSIBLE_TOOLS 自动导出（数据 schema 一致性） | 🔴 | EvoClaw 工具目录 `tool-catalog.ts` 服务于 UI/权限，不生成 datasets schema |
| §3.10 | 容器镜像 per-prompt 覆盖（Docker/Modal image 预拉取） | 🔴 | EvoClaw 仅 Docker Sandbox 全局配置（CLAUDE.md "3 模式 off/selective/all"），无 per-prompt 镜像路由 |
| §3.11 | 质量控制 / 损坏条目过滤（幻觉工具名） | 🔴 | EvoClaw 无 dataset 产出，无对应过滤环节 |
| §3.12 | 并发模型：多进程 vs. 异步车道 | 🟡 | 取向不同：hermes `Pool(num_workers)` 多进程进程级隔离；EvoClaw `LaneQueue` 单进程异步 |
| §3.13 | CLI 入口（`dataset_file / batch_size / run_name / resume`） | 🔴 | EvoClaw 无等价 CLI；仅 REST（`/chat/:agentId/send`） |

**统计**: 🔴 12 / 🟡 1 / 🟢 0（零反超；产品定位差异使得绝大多数项不建议补齐，见 §4）。

---

## 3. 机制逐条深度对比

### §3.1 Batch 引擎骨架（多进程并发 prompt 池）

**hermes**（`.research/24-batch-runner.md` §1 图 + `batch_runner.py:L514-623, L914-1036`）—— `multiprocessing.Pool(num_workers)` + `pool.imap_unordered` 分发:

```
main → BatchRunner(dataset, batch_size, num_workers, ...)
     → _create_batches()                 # 按 batch_size 切，保留原始索引
     → Pool(num_workers)                  # 多进程池
     → pool.imap_unordered(_process_batch_worker, tasks)
         → _process_single_prompt()       # 每 prompt 创建独立 AIAgent
         → batch_{N}.jsonl 增量追加
         → _save_checkpoint()             # 每完成一批原子写
     → 合并 → trajectories.jsonl + statistics.json
```

关键能力：**进程级隔离**（不同 prompt 的 AIAgent 实例位于不同 Python 进程）、**故障隔离**（单个 worker 崩溃不影响其他 worker）、**CPU 并行**（绕过 GIL）。

**EvoClaw** —— **完全缺失**:

```
grep -r "multiprocessing\|ThreadPoolExecutor\|Worker.*agent" packages/core/src/ → 0 结果
grep -r "batch_runner\|BatchRunner" packages/core/src/ → 0 结果
```

最接近的是 `packages/core/src/agent/lane-queue.ts:21-100` 的 LaneQueue 三车道并发，但**是单进程异步** `Promise` 调度，非多进程。见 §3.12 对比。

**判定 🔴**：这是 hermes Batch Runner **全部存在意义**——完全缺失。但如 §4 所述，**企业 IM 助手产品不需要**此类引擎，建议不补齐。

---

### §3.2 JSONL 数据集加载 / 批次切分

**hermes**（`batch_runner.py:L624-654`，见 `.research/24-batch-runner.md` §3.2）:

```python
def _load_dataset(dataset_file):
    for line in f:
        entry = json.loads(line)
        if "prompt" not in entry: continue   # 跳过无 prompt 字段
        entries.append(entry)
    return entries

def _create_batches(entries, batch_size):
    # 保留原始索引：[(0, entry0), (1, entry1), ...]
    return [entries[i:i+batch_size] for i in range(0, len(entries), batch_size)]
```

**EvoClaw** —— **完全缺失**:

```
grep -r "dataset" packages/core/src/ → 仅少量 SKILL.md 字面词，无代码路径
grep -r "\.jsonl" packages/core/src/ → 2 个文件（runtime.ts / runtime.test.ts），非 dataset loader
```

`packages/core/src/infrastructure/runtime.ts` 中的 jsonl 提及仅与 Node 运行时检测相关，完全无关 dataset 加载。

**判定 🔴**：EvoClaw 没有 dataset 概念。企业场景的"数据集"概念通过 `memory_units`（记忆，见 15-memory-providers-gap.md）和 conversation_log（对话历史）承载，不是 JSONL 输入。

---

### §3.3 每 prompt 隔离 AIAgent（`skip_memory / skip_context_files / save_trajectories=False`）

**hermes**（`batch_runner.py:L314-337`，见 `.research/24-batch-runner.md` §4.2）—— **明确的 3 个开关关闭所有持久性/上下文注入**:

```python
agent = AIAgent(
    base_url=config.get("base_url"),
    api_key=config.get("api_key"),
    model=config["model"],
    max_iterations=config["max_iterations"],
    enabled_toolsets=toolsets,
    save_trajectories=False,           # batch_runner 自管轨迹保存
    ephemeral_system_prompt=...,       # 系统提示仅用于推理，不进入轨迹
    reasoning_config=...,
    skip_context_files=True,           # 不注入 context files 污染轨迹
    skip_memory=True,                  # batch 不用持久化内存
    # 省略：providers_allowed/ignored/order、log_prefix、prefill_messages 等
)
result = agent.run_conversation(prompt, task_id=task_id)
```

这套开关保证**每个 prompt 在"无记忆 / 无 context 文件 / 无轨迹持久化"的干净环境下执行**，避免跨 prompt 污染。

**EvoClaw**（`packages/core/src/agent/embedded-runner.ts:33-60` + `types.ts`）—— **无对应开关**:

```typescript
// embedded-runner.ts:33-44 —— 入口签名只有 config + message + onEvent
export async function runEmbeddedAgent(
  config: AgentRunConfig,
  message: string,
  onEvent: EventCallback,
  externalAbortSignal?: AbortSignal,
  options?: {
    persistentRetry?: boolean;      // 仅 Cron/Heartbeat 相关
    isBackgroundQuery?: boolean;    // 仅 529 放弃策略
  },
): Promise<EmbeddedAgentResult | undefined>
```

- `AgentRunConfig` 未定义 `skipMemory` / `skipContextFiles` / `saveTrajectories=false` 开关
- Memory 召回是 ContextPlugin 生命周期的一部分（CLAUDE.md "ContextPlugin 10 个插件替代旧 12 层中间件链"），被所有调用路径共享
- Workspace 文件（9 文件系统 SOUL.md/IDENTITY.md/...）在 `runEmbeddedAgent` 入口自动加载；sub-agent-spawner 的 "Fork" 模式是**最大化继承**（cache-safe）而非**隔离**

**判定 🔴**：EvoClaw 无"纯净实例"选项。与 batch_runner 的设计取向相反——EvoClaw 刻意让每次对话都带上完整记忆/工作区/人格，这是产品核心价值。若未来需要"数据集评测"能力，则需要新增 `CleanRunConfig` 重载 ContextPlugin 链。

---

### §3.4 Tool Stats 提取（count/success/failure per tool）

**hermes**（`batch_runner.py:L114-194`，见 `.research/24-batch-runner.md` §3.4 / §4.1）—— 遍历消息历史统计工具调用:

```python
for msg in messages:
    if msg["role"] == "assistant" and "tool_calls" in msg:
        for tool_call in msg["tool_calls"]:
            tool_name = tool_call["function"]["name"]
            tool_stats[tool_name]["count"] += 1
            tool_calls_map[tool_call_id] = tool_name
    elif msg["role"] == "tool":
        tool_name = tool_calls_map.get(msg["tool_call_id"])
        if error_in_content: tool_stats[tool_name]["failure"] += 1
        else: tool_stats[tool_name]["success"] += 1
```

输出形如 `{"terminal": {"count": 5, "success": 4, "failure": 1}}`，供 statistics.json 聚合。

**EvoClaw** —— **无对应聚合**:

```
grep -r "tool_stats\|toolStats" packages/core/src/ → 0 结果
```

最接近的能力：
- `packages/core/src/agent/sub-agent-spawner.ts:135-141` SubAgentProgress `toolUseCount` 仅有**单数字计数**，无 per-tool 拆分
- `packages/core/src/infrastructure/task-registry.ts:27-33` TaskProgress 仅 `toolUseCount` 字段
- `tool-summary` 功能（CLAUDE.md "Tool Use Summary"）是**异步 LLM 自然语言摘要**面向 UI，不是数值统计

**判定 🔴**：EvoClaw 无 per-tool 聚合统计。对企业用户 UI 展示而言这是合理的（用户不关心"read 工具调用了 12 次"），但对"产出训练数据集"场景完全缺失。

---

### §3.5 Reasoning Stats / `has_any_reasoning` 质量门

**hermes**（`batch_runner.py:L197-230, L443-447`，见 `.research/24-batch-runner.md` §3.5 / §4.3）—— **质量控制丢弃推理覆盖为空的样本**:

```python
# L197-230 _extract_reasoning_stats: 检测 <REASONING_SCRATCHPAD> 或原生 reasoning 字段
def _extract_reasoning_stats(messages):
    return {
        "total_assistant_turns": ...,
        "turns_with_reasoning": ...,
        "has_any_reasoning": ...,
    }

# L443-447 质量控制
reasoning = result.get("reasoning_stats", {})
if not reasoning.get("has_any_reasoning", True):
    print(f"🚫 Prompt {prompt_index} discarded (no reasoning in any turn)")
    discarded_no_reasoning += 1
    continue
```

目的：训练数据必须包含 reasoning，无推理的样本会污染训练目标（教模型"不思考直接答"）。

**EvoClaw** —— **无对应检测**:

```
grep -r "reasoning_stats\|has_any_reasoning\|REASONING_SCRATCHPAD" packages/core/src/ → 0 结果
```

EvoClaw 的 thinking block 支持见 05-agent-loop-gap.md §3.4（判定 🟢 反超 `thinking_signature`），但那是**推理时功能**，不是**产出后质量门**。

**判定 🔴**：EvoClaw 无质量门。这是 batch_runner 为"训练数据生产"优化的专有功能——对企业 IM 助手产品无直接价值（用户不会想"丢弃我刚才的对话因为模型没推理"）。但可以**部分借鉴**思路到 Cron 领域：例如 Cron event 投递前检查 Agent 回复是否包含 `<REASONING>` 标签决定是否回流通知（§4 P2 项）。

---

### §3.6 Trajectory 格式导出（ShareGPT `{from, value}`）

**hermes**（`batch_runner.py:L992-1036`，见 `.research/24-batch-runner.md` §3.8 / §6 项 #4）—— ShareGPT JSONL 格式:

```python
# trajectory: [{"from": "system|human|gpt|tool", "value": "..."}]
# 合并所有 batch_*.jsonl → trajectories.jsonl
# 过滤损坏条目（模型幻觉的无效工具名）
```

**EvoClaw** —— **无对应导出**（在 16-trajectory-format-gap.md 已判定 🔴 缺失 ShareGPT 导出路径）。EvoClaw 的轨迹存在 `conversation_log` 表（SQLite），格式为 `ChatMessage` `{role, content, toolCalls, toolResults, ...}`，面向应用内查询/恢复，非 HuggingFace 训练格式。

**判定 🔴**：见 16-trajectory-format-gap.md 详细分析。对企业产品而言不建议补齐（理由同 §3.5）。

---

### §3.7 Checkpoint 原子写入（断点续传）

**hermes**（`batch_runner.py:L670-756, L926-939`，见 `.research/24-batch-runner.md` §3.7 / §4.4）—— 每批次完成后原子更新:

```python
# L926-939 增量 checkpoint
for result in pool.imap_unordered(_process_batch_worker, tasks):
    completed_prompts_set.update(result.get('completed_prompts', []))
    checkpoint_data['completed_prompts'] = sorted(completed_prompts_set)
    self._save_checkpoint(checkpoint_data, lock=checkpoint_lock)
    # utils.atomic_json_write → tmpfile + os.replace
```

结构：
```json
{"run_name": "...", "completed_prompts": [0,1,2,...], "batch_stats": {"0": {...}}, "last_updated": "ISO-8601"}
```

保证 worker 崩溃 / 用户 ^C 后重启不丢进度。

**EvoClaw** —— **无对应机制**:

```
grep -r "checkpoint\|Checkpoint" packages/core/src/ → 命中 5 文件均非 batch 续传相关:
  - server.ts / stream-client.ts / startup-profiler.ts —— SSE/性能检查点，非任务续传
  - kernel/types.ts —— kernel 内部类型
  - startup-profiler.test.ts —— 测试
```

与"恢复"相关的机制：
- `packages/core/src/scheduler/cron-runner.ts:281-297` `recordError` + `consecutive_errors >= 5 → enabled=0` 是**熔断**（停止恶化）而非**续传**（恢复进度）
- `packages/core/src/agent/embedded-runner-loop.ts` 的 Provider Failover 是**单次对话内**的模型降级重试
- Sub-agent `lastMessagesSnapshot`（`sub-agent-spawner.ts:166`）保留 abort 后的消息快照用于 steer 重执行，但是**单 Agent 实例级**非**批次级**

**判定 🔴**：EvoClaw 无批次级续传机制。与 §3.1 同源缺失。

---

### §3.8 内容匹配续传（prompt text 匹配 vs 索引匹配）

**hermes**（`batch_runner.py:L714-756`，见 `.research/24-batch-runner.md` §3.7 / §4.5 / §7 项 #3）—— **按 prompt 文本匹配**恢复:

```python
# L714-740
for batch_file in output_dir.glob("batch_*.jsonl"):
    for line in f:
        data = json.loads(line)
        if data.get("success") and "trajectory" in data:
            prompt_text = data.get("original_prompt", "")
            if prompt_text:
                completed_prompts.add(prompt_text)
```

**关键 insight**（研究文档 §7 项 #3）：**比索引更鲁棒**——数据集如果被重排序（加样本/删样本），索引续传会错位，但文本匹配依然准确。

**EvoClaw** —— **完全缺失**（§3.7 的子问题）。

**判定 🔴**：缺失。但这是 hermes batch runner 非常聪明的设计，可**借鉴思路**到 EvoClaw 其它领域：例如 memory 去重 / 导入记忆时按**内容 hash** 判重而非 ID 判重（CLAUDE.md "反馈循环防护 零宽空格标记"思路已沿此方向）。

---

### §3.9 ALL_POSSIBLE_TOOLS 自动导出（数据 schema 一致性）

**hermes**（`.research/24-batch-runner.md` §2 / `batch_runner.py:L54`）:

```python
ALL_POSSIBLE_TOOLS = derive_from(model_tools.TOOL_TO_TOOLSET_MAP)
# 未使用的工具填充 {count: 0, success: 0, failure: 0}
# 保证 HuggingFace datasets 加载时 schema 一致
```

目的：HuggingFace `datasets` 库要求所有 JSONL 行 schema 一致，不能某行有字段 `terminal` 另一行没有。此处预填充全部工具名，满足训练管线需求。

**EvoClaw**（`packages/core/src/agent/tool-catalog.ts`）:

```typescript
// tool-catalog.ts 面向 UI 工具开关面板 + 权限系统
// 不产出 datasets schema
// grep -r "ALL_POSSIBLE_TOOLS" packages/core/src/ → 0 结果
```

EvoClaw 有 `tool-catalog.ts` 但服务于**权限显示 / 启用切换 / 分组展示**（见 09-tools-system-gap.md），不是为了训练数据集 schema 对齐。

**判定 🔴**：缺失。对 EvoClaw 无价值（无训练管线）。

---

### §3.10 容器镜像 per-prompt 覆盖（Docker/Modal image 预拉取）

**hermes**（`batch_runner.py:L256-303`）—— 每 prompt 可覆盖 docker/modal image，Docker 模式预拉取镜像:

```python
# 片段（精简）
if entry.get("docker_image"):
    # 注册 task 级覆盖
    register_task_env_overrides(task_id, {"docker_image": ...})
    # Docker 模式下预拉取（避免运行时卡顿）
    docker_pull(image)
```

**EvoClaw**（CLAUDE.md "沙箱: Docker（可选，3 模式: off/selective/all，首次使用时引导安装）"）—— **全局模式**:

- Docker 沙箱是 Agent 级 / 全局级配置，不是 per-prompt 覆盖
- 无"每条 prompt 指定镜像"能力
- 无镜像预拉取机制（首次使用时引导安装是**用户级**交互，不是 batch 级预热）

**判定 🔴**：缺失。企业用户场景不需要 per-prompt 镜像切换（每个 Agent 的运行环境应该可预测、不应由 prompt 动态改变）。

---

### §3.11 质量控制 / 损坏条目过滤（幻觉工具名）

**hermes**（`batch_runner.py:L1020-1027`，见 `.research/24-batch-runner.md` §7 项 #4）—— 最终合并时检查工具名是否在 `VALID_TOOLS`:

```python
# 损坏条目：模型偶尔幻觉无效工具名，需 VALID_TOOLS 过滤
# 在合并 trajectories.jsonl 阶段丢弃
```

**EvoClaw**（`packages/core/src/agent/kernel/tool-adapter.ts` + `tool-catalog.ts`）—— **工具调用前检查**（即时拦截），非产出后过滤:

- Kernel 在 tool_use 事件解析时验证工具名存在于 registeredTools
- 不存在的工具名会返回 error 给模型，而不是**产出后过滤数据集**
- 由于 EvoClaw 不产出数据集，无"合并阶段过滤"需求

**判定 🔴**：形态差异——EvoClaw 在**执行时**拦截而非**产出后**过滤。从产品角度看，EvoClaw 方式更好（立即反馈），但不等价于 batch_runner 的需求。

---

### §3.12 并发模型：多进程 vs. 异步车道

**hermes**（`batch_runner.py` + `.research/24-batch-runner.md` §1 图）—— `multiprocessing.Pool(num_workers)`:

- **进程级隔离**：每 worker 独立 Python 进程，GIL 不再是限制
- **故障隔离**：单 worker 崩溃（AIAgent 异常）不影响其他 worker
- **资源代价**：每进程独立加载 AIAgent 状态（memory footprint × num_workers）
- **CPU 并行**：真正利用多核

**EvoClaw**（`packages/core/src/agent/lane-queue.ts:21-100` + `packages/shared/src/constants.ts`）—— **单进程异步 3 车道**:

```typescript
// lane-queue.ts:22-38
export class LaneQueue {
  private queues: Map<LaneName, QueueItem<any>[]> = new Map();
  private running: Map<LaneName, Set<string>> = new Map();
  private runningKeys: Map<string, string> = new Map(); // sessionKey 串行
  private concurrency: Record<LaneName, number>;

  constructor(concurrency?: Partial<Record<LaneName, number>>) {
    this.concurrency = {
      main: concurrency?.main ?? LANE_CONCURRENCY.main,      // 默认 4
      subagent: concurrency?.subagent ?? LANE_CONCURRENCY.subagent,  // 默认 8
      cron: concurrency?.cron ?? LANE_CONCURRENCY.cron,      // 默认 2
    };
  }
}
```

- **单进程 Node/Bun**：8 个 subagent 并发实际是 Promise 交织，共享事件循环
- **I/O 并发为主**：LLM 流式调用是 I/O-bound，异步模型天然合适
- **共享状态**：所有 Agent 共享 sqlite 连接、LLM client、ContextPlugin 实例——**节约资源**，但单点故障影响面大
- **session key 串行**：同一 session 内严格串行，避免冲突
- **无 CPU 并行**：对 LLM 调用场景是合理的（绝大多数时间在等待 network I/O），对重计算任务会是瓶颈

**判定 🟡**：**取向不同，各有优劣**:

- hermes batch runner 定位是**离线批处理**（CPU 也需要并行，故多进程合理）
- EvoClaw LaneQueue 定位是**实时用户交互 / 后台定时任务**（I/O 为主，单进程异步高吞吐）
- 若 EvoClaw 未来需要补齐 batch 能力，**不应直接改造 LaneQueue**（会破坏实时语义）而应新增独立"评测 runtime"

---

### §3.13 CLI 入口（`dataset_file / batch_size / run_name / resume`）

**hermes**（`batch_runner.py:L1113-1286`，见 `.research/24-batch-runner.md` §3.1）—— 完整 argparse CLI:

```bash
python batch_runner.py \
  --dataset_file ./prompts.jsonl \
  --batch_size 50 \
  --run_name exp_001 \
  --num_workers 8 \
  --distribution toolset_a \
  --max_iterations 20 \
  --model claude-sonnet-4 \
  --resume \
  --max_samples 1000
```

必需参数：`dataset_file / batch_size / run_name`。
可选：`--list_distributions / --resume / --reasoning_disabled / --max_samples / --prefill_messages_file / --providers_allowed`。

**EvoClaw**（`packages/core/src/server.ts` + REST routes）—— **仅 REST API**（Sidecar 架构）:

- Sidecar 作为 HTTP 服务启动（`server.ts:890+`），无独立 CLI 子命令
- 所有操作通过 `/chat/:agentId/send`、`/cron`、`/tasks` 等 REST 端点
- 参考 27-cli-architecture-gap.md（计划中）会详细覆盖 CLI 形态差异

**判定 🔴**：无等价 CLI。桌面应用架构下不需要——用户通过 Tauri UI 操作。

---

## 4. 建议改造蓝图（不承诺实施）

**产品定位判断前提**：EvoClaw 定位"面向企业非技术用户的 AI 伴侣桌面应用"（CLAUDE.md），**不是**"研究员训练数据生成工具"。batch_runner.py 绝大多数能力（JSONL 数据集 / ShareGPT 轨迹 / ALL_POSSIBLE_TOOLS schema / reasoning 质量门）为训练/评测场景而生——因此本章档位虽全红，但**大部分项不建议补齐**。

**P0**（高 ROI，建议尽快）: **无** —— 无高 ROI 项。Batch Runner 的核心价值（离线训练数据生产）与 EvoClaw 产品定位不交集。

**P1**（中等 ROI，可选）:

| # | 项目 | 对应差距 | 工作量 | ROI | 价值 |
|---|---|---|---|---|---|
| 1 | **轻量评测 runtime**（内部 QA 场景：给 Agent 跑 N 条测试 prompt 对比模型） | §3.1 / §3.3 | 5-8d | 🔥 | 企业升级模型时可运行 QA 回归，但需新增 `ContextPlugin` 旁路跳过记忆注入 |
| 2 | **Cron Pipeline 类型激活**（008 migration 已预留 `action_type IN (prompt, tool, pipeline)`，pipeline 未实现） | §3.1 扩展思路 | 3-5d | 🔥 | 复用 Cron 架构实现"多步骤定时工作流"，比 batch runner 更契合企业场景 |
| 3 | **Memory import 内容匹配去重** | §3.8 借鉴 | 1-2d | 🔥 | 用 hermes 的 prompt text 匹配思路重构 memory 去重（目前主要靠零宽字符标记） |

**P2**（长期规划）:

| # | 项目 | 对应差距 | 工作量 |
|---|---|---|---|
| 4 | Per-Agent Tool 聚合统计（UI 仪表盘） | §3.4 | 2d |
| 5 | 对话质量信号（借鉴 `has_any_reasoning`，检测 Agent 回复是否包含 thinking / tool_use） | §3.5 借鉴 | 1-2d |

**不建议做**（高工作量低/负 ROI）:

- ❌ **多进程 Pool 改造**（§3.12）：EvoClaw 单进程异步模型契合 I/O-bound 的 LLM 调用场景；引入 multiprocessing 会破坏 sqlite 连接共享、ContextPlugin 实例共享、LaneQueue 全局状态，得不偿失
- ❌ **JSONL 数据集 + ShareGPT 轨迹导出**（§3.2 / §3.6）：企业用户无此需求；若真有研究员用户，应导出后用独立 Python 脚本做 batch processing，而不是内置到 Sidecar
- ❌ **ALL_POSSIBLE_TOOLS schema 自动导出**（§3.9）：与产品无关
- ❌ **Per-prompt 容器镜像覆盖**（§3.10）：Agent 级 Docker 配置已足够，per-prompt 切换会增加首次使用引导复杂度
- ❌ **Checkpoint 原子续传**（§3.7）：无批次任务就无续传需求；Cron `consecutive_errors` 熔断已覆盖"失败恢复"语义
- ❌ **独立 CLI 入口**（§3.13）：桌面应用 Tauri UI 是主入口，REST API 是次级入口；引入 CLI 子命令会分裂运维路径

---

## 5. EvoClaw 反超点汇总

**本章无反超点**。

Batch Runner 是 hermes 为"研究员 / 训练数据生产者 / 数据集清洗者"三类角色专门构建的引擎，EvoClaw 作为"企业非技术用户的 AI 伴侣桌面应用"在这个维度**按设计**没有对应能力。零反超不代表"落后"——而是产品定位的自然结果。

**间接相关的 EvoClaw 优势**（不属于 batch runner 范畴，但在对话/调度领域反超 hermes，crosslink 见 §6.3）:

| 领域 | EvoClaw 优势 | 所在章节 |
|---|---|---|
| 后台调度 | Cron + Heartbeat 双轨 + Standing Orders + System Events 意识注入 | 18-cron-background-gap.md |
| 并发模型 | LaneQueue 三车道 + 同 session 串行 + cancelFn 取消协议 | 14-state-sessions-gap.md §3.9 |
| Sub-Agent | Fork / 跨 Agent spawn / 叶子节点工具降权 / `yield_agents` 阻塞等待 | 11-environments-spawn-gap.md |
| Trajectory | conversation_log FTS5 + 压缩状态追踪 | 17-trajectory-compression-gap.md |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（本章所有 `path:line` 均经 Read 工具验证 2026-04-17）

- `packages/core/src/agent/embedded-runner.ts:33-60` ✅ `runEmbeddedAgent` 入口签名（仅 `persistentRetry / isBackgroundQuery` 开关，无 `skipMemory/skipContextFiles` 等价）
- `packages/core/src/agent/lane-queue.ts:21-100` ✅ LaneQueue 类定义 + 三车道并发 + sessionKey 串行
- `packages/shared/src/constants.ts:40-44` ✅ LANE_CONCURRENCY main:4 / subagent:8 / cron:2（参考 18-cron-background-gap.md §6.1）
- `packages/core/src/scheduler/cron-runner.ts:56-309` ✅ CronRunner 完整实现（参考 18-cron-background-gap.md §6.1）
- `packages/core/src/scheduler/cron-runner.ts:281-297` ✅ recordError 熔断逻辑（非续传）
- `packages/core/src/infrastructure/task-registry.ts:14-53` ✅ TaskRuntime 枚举（`cron | heartbeat | subagent | boot | bash`，无 `batch`）+ TaskProgress 字段（仅 `toolUseCount` 汇总，无 per-tool 拆分）
- `packages/core/src/routes/tasks.ts:1-50` ✅ Tasks REST 端点（无 batch 端点）
- `packages/core/src/agent/sub-agent-spawner.ts:134-142` ✅ SubAgentProgress 结构（无 per-tool 统计）
- `packages/core/src/agent/sub-agent-spawner.ts:197-260` ✅ SubAgentSpawner 类（spawn/kill/yield_agents 接口，无 batch-style prompt 池）
- `packages/core/src/agent/tool-catalog.ts:40-91` ✅ 工具目录面向 UI，非 ALL_POSSIBLE_TOOLS schema 导出
- `packages/core/src/rag/embedding-provider.ts:64-99` ✅ `generateBatch(texts, batchSize=20)`（仅 embedding 层批量 API 调用，不是 agent-level batch）
- `packages/core/src/rag/rag-indexer.ts:46` ✅ `batchEmbedFn(texts)`（indexer 内部批量 embedding，不是 batch_runner 语义）
- `packages/core/src/server.ts` ✅ 仅 REST 入口，无 CLI 子命令

### 6.1.1 关键 grep 零结果（证明缺失）

- `grep -r "batch_runner\|BatchRunner" packages/core/src/` → **0 结果**
- `grep -r "multiprocessing\|ThreadPoolExecutor" packages/core/src/` → **0 结果**
- `grep -r "reasoning_stats\|has_any_reasoning\|REASONING_SCRATCHPAD" packages/core/src/` → **0 结果**
- `grep -r "tool_stats\|toolStats\|ALL_POSSIBLE_TOOLS" packages/core/src/` → **0 结果**
- `grep -r "evaluator\|rollout\|trajectories.jsonl" packages/core/src/` → **0 结果**
- `grep -r "prompt_index\|completed_prompts\|_scan_completed" packages/core/src/` → **0 结果**
- `grep -r "sample_toolsets\|skip_memory\|skip_context_files\|save_trajectories" packages/core/src/` → **0 结果**
- `grep -r "checkpoint\|Checkpoint" packages/core/src/` → 5 文件命中，全部非 batch 续传相关（SSE/性能/kernel 内部类型）

### 6.2 hermes 研究引用（章节 §）

- `.research/24-batch-runner.md` §1 角色定位 + 架构图（main → BatchRunner → Pool → worker → batch_*.jsonl → trajectories.jsonl + statistics.json）
- `.research/24-batch-runner.md` §2 BatchRunner 类字段（L514-623）+ 单 Prompt 处理结果 Schema（L352-367）+ Checkpoint 结构（L678-695）
- `.research/24-batch-runner.md` §2 ALL_POSSIBLE_TOOLS（L54）
- `.research/24-batch-runner.md` §3.1 入口与 CLI（L1113-1286）
- `.research/24-batch-runner.md` §3.2 数据集加载（L624-654）+ 批次切分
- `.research/24-batch-runner.md` §3.3 单 Prompt 处理（`_process_single_prompt` L233-386）+ 容器镜像 per-prompt 覆盖（L256-303）
- `.research/24-batch-runner.md` §3.4 工具统计提取（`_extract_tool_stats` L114-194）
- `.research/24-batch-runner.md` §3.5 推理覆盖统计（`_extract_reasoning_stats` L197-230）
- `.research/24-batch-runner.md` §3.6 批量 Worker（`_process_batch_worker` L388-511）
- `.research/24-batch-runner.md` §3.7 断点续传（L670-756）+ 内容匹配扫描（`_scan_completed_prompts_by_content` L714-756）
- `.research/24-batch-runner.md` §3.8 轨迹合并与过滤（L992-1036）
- `.research/24-batch-runner.md` §4.1 工具统计代码 L129-146
- `.research/24-batch-runner.md` §4.2 Agent 实例化 L314-337（`save_trajectories=False / skip_memory=True / skip_context_files=True`）
- `.research/24-batch-runner.md` §4.3 质量控制丢弃 L443-447
- `.research/24-batch-runner.md` §4.4 增量 Checkpoint L926-939
- `.research/24-batch-runner.md` §4.5 内容匹配断点续传 L714-740
- `.research/24-batch-runner.md` §5 模块交互（AIAgent / toolset_distributions / model_tools / terminal_tool / atomic_json_write）
- `.research/24-batch-runner.md` §6 复刻清单 12 项
- `.research/24-batch-runner.md` §7 延伸：每 prompt 独立 AIAgent / ephemeral_system_prompt / 内容匹配续传设计意图 / 损坏条目 / 并发安全

### 6.3 关联差距章节

本章的配套深入见：

- [`05-agent-loop-gap.md`](./05-agent-loop-gap.md) — `queryLoop` 主循环（batch_runner 每 prompt 会调用一次 `AIAgent.run_conversation`，等价于走 queryLoop 一次完整 while(true)）。EvoClaw 在 thinking_signature / 三层压缩 / Stop Hook 等维度反超；但缺 `skip_memory/skip_context_files` 开关（见本章 §3.3）
- [`18-cron-background-gap.md`](./18-cron-background-gap.md) — **同为后台/自动化任务领域**。Cron + Heartbeat 双轨架构是 EvoClaw 在"定时/周期任务"领域的正解（参考 §4 P1 项 #2 "Cron Pipeline 类型激活"），与 batch_runner 的"离线数据生产"定位互补不冲突
- [`22-browser-stack-gap.md`](./22-browser-stack-gap.md) — **同批次（Phase E 工具链批次）**，浏览器栈差距分析
- [`23-rl-environments-gap.md`](./23-rl-environments-gap.md) — **同批次**，RL 环境差距分析。batch_runner 的下游消费者之一就是 RL 训练管线
- [`16-trajectory-format-gap.md`](./16-trajectory-format-gap.md) — ShareGPT JSONL 轨迹格式（batch_runner §3.8 / §6 项 #4 的核心产出物，EvoClaw 判定 🔴 缺失）
- [`17-trajectory-compression-gap.md`](./17-trajectory-compression-gap.md) — Trajectory 压缩（与 batch_runner 的 `_extract_tool_stats / _extract_reasoning_stats` 产出后处理相关）
- [`09-tools-system-gap.md`](./09-tools-system-gap.md) — `tool-catalog.ts` 工具目录（EvoClaw 面向 UI/权限，不是 batch_runner 的 `ALL_POSSIBLE_TOOLS` schema 导出）

---

**本章完成**。机制总计 13 个（🔴 12 / 🟡 1 / 🟢 0），综合判定 🔴 **整体缺失 / 产品定位差异导致不建议补齐**。batch_runner.py 是 hermes 为"研究员 / 训练数据生产者 / 数据集清洗者"定制的离线批处理引擎，EvoClaw 作为"企业非技术用户的 AI 伴侣桌面应用"在设计上不覆盖此维度。**无 P0 建议项**——§4 仅保留 3 项 P1 可选改造（轻量评测 runtime / Cron Pipeline 激活 / Memory 内容匹配去重），以及 5 项明确"不建议做"的负面清单。本章的核心结论是：**"缺失 ≠ 落后"** 当产品定位本就不需要时，强行补齐会破坏现有的实时 / 共享状态 / 单进程异步架构优势。
