# 23 — RL 训练环境（environments/）差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/23-rl-environments.md`（316 行，draft / Phase E）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`environments/` 目录 ~7,577 行（核心框架 1,720 + 具体环境 1,930 + 12 个 parser + benchmarks）
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16）
> **综合判定**: 🔴 **整体缺失 / 架构定位完全不同 / 不建议补齐**

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes `environments/`**（`.research/23-rl-environments.md §1-§2`，~7,577 行） — **Atropos RL 训练框架**。把 hermes 的 `AIAgent` 多轮 LLM 调用包装成符合 `atroposlib.BaseEnv` 接口的训练环境，对接策略梯度训练 / SFT 数据生成 / On-Policy Distillation / 基准评测。核心组件：

- `HermesAgentBaseEnv`（`hermes_base_env.py` 714 行）：5 个抽象方法 + `collect_trajectories()` 编排
- `HermesAgentLoop`（`agent_loop.py` 534 行）：OpenAI tool-calling 多轮引擎，128 worker 线程池
- `ToolContext`（`tool_context.py` 474 行）：reward 函数的无限制工具访问接口，与 rollout 共享 task_id
- `tool_call_parsers/` 12 个文件：11 个开源模型工具调用解析器（Hermes/Mistral/DeepSeek/Llama/Qwen3-Coder/GLM/Kimi/LongCat 等）
- 具体环境：`agentic_opd_env.py`（~1,200 行）/ `web_research_env.py`（719 行）/ `hermes_swe_env/` / `terminal_test_env/`
- `benchmarks/`：TerminalBench2 / YC Bench / tblite 评测集

**EvoClaw 架构**（`packages/core/src/`） — **终端用户的桌面 AI 伴侣**（Tauri + Bun Sidecar）。目标是让非开发者通过自然语言和多渠道 IM 使用 AI Agent，核心度量是"用户体验 + 多渠道可达性 + 记忆连续性"，**完全不涉及 RL 训练 / SFT 数据生成 / 基准评测**。

- 没有 `environments/` / `gym` / `BaseEnv` / `collect_trajectories` / `compute_reward` / rollout / reward model 等抽象
- 没有 `tool_call_parsers/` — Kernel 走双协议统一入口（Anthropic Messages + OpenAI Chat Completions），工具调用由 **服务端原生解析**，无需客户端解析 11 个开源模型的自定义格式
- 没有 benchmarks — 不做模型能力评测；Vitest 单测只覆盖业务逻辑（bash parser / chat routes / memory extractor 等），不是 agent task benchmark

**架构本质差异**：
- hermes `environments/` 是**训练侧数据源**（training-time artifact），服务于"用 hermes 数据蒸馏/训练更好的模型"
- EvoClaw 是**推理侧产品**（inference-time product），服务于"把已有模型包装成好用的桌面 agent"
- 两者在 Claude Code 谱系上属于"训练轨道"vs"产品轨道"，**正交关系**，不是能力覆盖关系

**量级对比**：hermes `environments/` 单目录 ~7,577 行，EvoClaw 对应侧**零行**。grep 验证见 §6.1。

**本章基本不做补齐建议**：EvoClaw 的目标用户是企业员工（CLAUDE.md "面向非程序员企业用户"），引入 Atropos 训练框架 = 给家电厂开一条 chip fab，ROI 为负。若哪天 EvoClaw 真要训练"更懂本企业员工的 small model"，正确做法是**把 `conversation_log` + `memory_feedback` 导出成 ShareGPT JSONL**（见 §4 / crosslink 16），而不是重写 atroposlib BaseEnv。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | `HermesAgentBaseEnv` 抽象骨架 | 🔴 | 完全缺失；EvoClaw 无 BaseEnv / `collect_trajectories` / 5 抽象方法 |
| §3.2 | `HermesAgentLoop` 训练侧多轮引擎 | 🔴 | 完全缺失；EvoClaw 的 `queryLoop` 是推理产品循环，不是训练 rollout 引擎 |
| §3.3 | `ToolContext` reward-side 工具访问 | 🔴 | 完全缺失；EvoClaw 没有 reward 函数概念，工具只有 agent-side 一种使用方 |
| §3.4 | Phase 1/2 双模式（OpenAI / VLLM ManagedServer） | 🔴 | 完全缺失；EvoClaw 无 `ManagedServer` / `logprobs` 回传 / `masks` 概念 |
| §3.5 | 12 个 Tool Call Parser（开源模型兼容层） | 🔴 | 完全缺失；EvoClaw 依赖服务端原生工具解析，不对接裸 HF 模型输出 |
| §3.6 | Per-group 工具采样（`_resolve_tools_for_group`） | 🔴 | 完全缺失；EvoClaw 无 group size 概念，单次对话单次采样 |
| §3.7 | 结果预算（5000 字符/工具，20000 字符/turn） | 🟡 | EvoClaw 有工具结果截断（Microcompact 5KB + context budget 50%），语义面向推理压缩不是训练标签 |
| §3.8 | Task ID 隔离 → 独立 VM 会话 | 🟡 | EvoClaw 有 session key + agent 工作区隔离，但不隔离 VM，执行在本机 Sidecar 进程内 |
| §3.9 | `compute_reward()` 奖励函数接口 | 🔴 | 完全缺失；EvoClaw 有 memory_feedback 机制但是异步用户反馈，不是 rollout-time reward |
| §3.10 | `evaluate()` 周期性评测 | 🔴 | 完全缺失；EvoClaw 无 eval loop / 基准任务集 / 正确率指标 |
| §3.11 | AgenticOPD On-Policy Distillation 管道 | 🔴 | 完全缺失；EvoClaw 不做蒸馏 |
| §3.12 | 具体训练环境（SWE / Web / Terminal） | 🔴 | 完全缺失；EvoClaw 无 HumanEval / FRAMES / TerminalBench 适配器 |
| §3.13 | `benchmarks/` 评测集 | 🔴 | 完全缺失；EvoClaw 无基准数据集 / pytest 评测 runner |
| §3.14 | WandB 训练指标上报 | 🔴 | 完全缺失；EvoClaw 有 logger + PII 脱敏但非训练指标流 |
| §3.15 | Trajectory 训练格式（ShareGPT JSONL） | 🔴 | 完全缺失；EvoClaw `conversation_log` 表是推理历史，不是训练样本 |

**统计**: 🔴 13 / 🟡 2 / 🟢 0（0 项反超，本章 EvoClaw 无对应能力也无对应定位，§5 EvoClaw 反超点**为空**）。

---

## 3. 机制逐条深度对比

每条同时给出 **hermes 实现**（含 `.research/23-rl-environments.md §N` 章节引用）+ **EvoClaw 实现**（含 `packages/core/src/XX.ts:LN` 引用或 grep 零结果证据）+ **判定与分析**。

### §3.1 `HermesAgentBaseEnv` 抽象骨架

**hermes**（`.research/23-rl-environments.md §3.1`，`hermes_base_env.py:1-714`） — 继承 `atroposlib.BaseEnv`，5 个抽象方法：

```python
class HermesAgentBaseEnv(BaseEnv):
    async def setup(self): ...                  # 加载数据集
    async def get_next_item(self) -> dict: ...  # 迭代获取训练样本
    def format_prompt(self, item: dict) -> List[dict]: ...
    async def compute_reward(self, item, result, ctx: ToolContext) -> float: ...
    async def evaluate(self) -> dict: ...       # 周期性评测

    async def collect_trajectories(self, group_size):
        self._current_group_tools = self._resolve_tools_for_group()
        for _ in range(group_size):
            await self.collect_trajectory()   # 单个 rollout
```

关键不变量：`collect_trajectories` 是 **Atropos 训练循环**的入口，每次吐出 `ScoredDataGroup(tokens, masks, scores)` 供策略梯度更新。工具集 group 级别采样一次，组内共享，减少方差。

**EvoClaw** — **完全无对应抽象**：

```bash
$ grep -rn "BaseEnv\|collect_trajectories\|get_next_item\|compute_reward" packages/core/src
# (零结果 — 已验证，见 §6.1)
```

EvoClaw 最接近的抽象是 `queryLoop`（`packages/core/src/agent/kernel/query-loop.ts:340`），但它是**产品侧单次对话循环**：输入是用户消息 + 历史，输出是 assistant 消息 + 工具结果流，**没有 reward 概念，没有 group，没有评分聚合**，不可等价映射。

**判定 🔴 完全缺失**：EvoClaw 既没有这个抽象骨架，也不需要这个抽象骨架。补齐 = 引入 `atroposlib` 依赖 + 数据集加载管线 + 奖励函数 + ScoredDataGroup 序列化，约 **2-3 人周**工作量，**但对终端用户桌面应用零产品价值**。

---

### §3.2 `HermesAgentLoop` 训练侧多轮引擎

**hermes**（`.research/23-rl-environments.md §3.2`，`agent_loop.py:1-534`） — 标准 OpenAI tool-calling 循环，训练特化：

```python
for turn in range(max_turns):
    response = await self.server.chat_completion(messages, tools=schemas)
    if msg.tool_calls:
        for tc in msg.tool_calls:
            # 服务端原生解析 OR tool_call_parsers/ 客户端解析
            result = await run_in_executor(
                self._tool_executor,  # ThreadPoolExecutor(max_workers=128)
                handle_function_call, tc.function.name, args, self.task_id)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
    else:
        finished_naturally = True; break
# 返回 AgentResult(messages, managed_state, turns_used, finished_naturally,
#                  reasoning_per_turn, tool_errors)
```

**128 worker 线程池** 是关键：单个 rollout 内可并发调用 128 个工具（训练时每 rollout 都要跑满回合以喂数据）。`managed_state` 字段专供 Phase 2 VLLM ManagedServer 的 logprobs/masks 回传。

**EvoClaw**（`packages/core/src/agent/kernel/query-loop.ts:340-697`） — 770 行产品侧推理循环，并发上限 **8**：

```typescript
const executor = new StreamingToolExecutor(config.tools, 8, config.abortSignal);
//                                                      ^^^ hermes 是 128
```

对比：
- EvoClaw `queryLoop` 有 Kernel 双协议、流式预执行、三层压缩、413/max_output_tokens 恢复、Stop Hook、Tombstone（见 05-agent-loop-gap.md §3.1 / §3.8 / §3.9 / §3.11）
- hermes `HermesAgentLoop` 有 `managed_state` 回传、128 并发、`finished_naturally` 标记、`reasoning_per_turn` 按轮聚合、`tool_errors` 列表（训练侧指标）
- **两者不可替代**：即便强行把 `queryLoop` 嵌进 `HermesAgentBaseEnv.collect_trajectory`，也得重新实现 `managed_state` / logprobs / ScoredDataGroup 包装层

**判定 🔴 架构不可复用**：`queryLoop` 是推理循环，`HermesAgentLoop` 是 rollout 引擎。前者优化延迟 / cache / UI 反馈，后者优化 throughput / tokens+masks 精确记账。**并发 8 vs 128 的差距不是调参，是场景**：128 在 128 核机器跑 128 个独立 rollout 合理；8 在用户桌面跑 1 个交互 session 合理。

---

### §3.3 `ToolContext` reward-side 工具访问

**hermes**（`.research/23-rl-environments.md §3.3`，`tool_context.py:1-474`） — 给 `compute_reward()` 用的**无限制工具句柄**：

| 类别 | 方法 | 用途 |
|------|------|------|
| 终端 | `terminal(cmd, timeout=180)` | 在模型 VM 中运行命令（如 `pytest -v`） |
| 文件 | `read_file/write_file/upload_file/download_file` | 文本/二进制安全 I/O |
| 搜索 | `search(query, path)` | 正则搜索 |
| 网络 | `web_search/web_extract` | 网络查询 |
| 浏览器 | `browser_navigate/browser_snapshot` | 网页交互 |
| 通用 | `call_tool(name, args)` | 任意工具转义舱 |
| 清理 | `cleanup()` | 释放 VM/浏览器 |

**关键语义**：`ToolContext` 与 rollout **共享同一 `task_id`**（同一 VM 会话），所以 reward 函数能看到模型刚写的文件、刚执行的命令输出。典型用法：

```python
async def compute_reward(self, item, result, ctx):
    test = ctx.terminal("pytest -v", timeout=60)
    if test["exit_code"] == 0: return 1.0
    content = ctx.read_file("/workspace/solution.py")
    if content.get("content"): return 0.5
    return 0.0
```

**EvoClaw** — **完全无对应概念**：

```bash
$ grep -rn "ToolContext\|compute_reward\|task_id" packages/core/src | grep -v test
# (零结果 — 工具只有 agent-side 一种调用方)
```

EvoClaw 的工具（`tool-catalog.ts:18` `CORE_TOOLS`，`builtin-tools.ts` handler）只服务于 **agent 本身执行**（Kernel 流中 `StreamingToolExecutor` 调度）。没有"第二个主体"（reward 函数）访问工具这一概念，因为没有训练循环，自然也没有 reward 函数。

**判定 🔴 完全缺失 + 概念不适用**：即便把 `CORE_TOOLS` 包一层"ToolContext 视角"，也没有任何调用者（产品里没有 reward 函数）。这是训练场景特有的双主体（rollout + judge）设计，单主体的产品应用不需要。

---

### §3.4 Phase 1/2 双模式（OpenAI / VLLM ManagedServer）

**hermes**（`.research/23-rl-environments.md §3.4`）：

| 特性 | Phase 1 (OpenAI) | Phase 2 (VLLM ManagedServer) |
|------|-----------------|------------------------------|
| 服务器 | OpenAI / VLLM / OpenRouter | VLLM / SGLang + ManagedServer |
| 工具解析 | 服务端原生 | 客户端 `tool_call_parsers/`（12 个） |
| Token 追踪 | 占位符 | 精确（logprobs + masks） |
| 用途 | SFT 数据生成 / 验证 | RL 训练（策略梯度） |

自动选择：`_use_managed_server() = not isinstance(server, OpenAIServer)`。Phase 2 的 `ManagedServer.get_logprobs()` 是 RL 特有 API，用于把每个 token 的 logprob 对齐到 mask 里喂 PPO/GRPO。

**EvoClaw**（`packages/core/src/agent/kernel/stream-client.ts:1-16`） — **只有 Phase 1 类别**：

```typescript
/**
 * 流式 LLM 客户端 — 双协议 (Anthropic Messages + OpenAI Chat Completions)
 *
 * 核心设计:
 * - 原生 fetch() + ReadableStream，不依赖 SDK
 * - 归一化 StreamEvent async generator 输出
 * - 90 秒空闲看门狗 + 非流式回退
 */
```

EvoClaw 的双协议是 **Anthropic Messages vs OpenAI Chat Completions**（两种 API 规范），不是 hermes 的 **OpenAIServer vs ManagedServer**（推理模式）。EvoClaw 永远走"服务端原生工具解析 + 占位符 token 追踪"，无 logprobs / masks 需求：

```bash
$ grep -rn "logprobs\|ManagedServer\|get_logprobs\|managed_state" packages/core/src
# (零结果)
```

**判定 🔴 完全缺失**：Phase 2 是"RL 训练才需要的精确 token 追踪"，EvoClaw 推理产品场景永远用 Phase 1 语义，补齐无意义。

---

### §3.5 12 个 Tool Call Parser（开源模型兼容层）

**hermes**（`.research/23-rl-environments.md §3.5`，`environments/tool_call_parsers/`）— 11 个解析器 + `__init__.py`：

| Parser | 模型家族 | 格式 |
|--------|---------|------|
| `hermes` | Hermes2Pro / Qwen 2.5 | `<tool_call>{...}</tool_call>` 标签式 |
| `mistral` | Mistral | `[TOOL_CALLS]` JSON |
| `llama3_json` | Llama 3/4 | JSON 数组 |
| `qwen3_coder` | Qwen3-Coder | XML 嵌套 `<function=name><parameter=key>` |
| `deepseek_v3` | DeepSeek V3 | Unicode 标记 `<｜tool▁calls▁begin｜>` |
| `kimi_k2` | Moonshot Kimi | 自定义边界标记 |
| `glm45/47` | GLM | 自定义 |
| `longcat` | LongCat | 自定义 |

用法：`parser = get_parser("hermes"); content, tool_calls = parser.parse(raw_output)`。**只在 Phase 2（自托管 VLLM/SGLang + 裸 HF checkpoint）用**：Phase 1 的 OpenAI/OpenRouter 已在服务端做完工具解析。

**EvoClaw** — **完全无对应**：

```bash
$ grep -rn "tool_call_parser\|hermes_parser\|mistral_parser\|parse.*tool.*call" \
    packages/core/src --include="*.ts" | grep -v test
# (零结果，除去测试里的 bash-parser 误匹配)
```

EvoClaw 国产模型（Qwen / GLM / Doubao）全部走 `api:"openai-completions" + 自定义 baseUrl`（见 CLAUDE.md L63-L68）。关键假设：**这些 provider 的服务端已经按 OpenAI Chat Completions 规范把工具调用规整好**（返回 `choices[0].message.tool_calls`），无需客户端二次解析。

**判定 🔴 完全缺失 + 产品上不需要**：
- hermes 需要这 11 个 parser 是因为训练时要对接**裸 HF checkpoint**（原始 tokenizer 输出，无 OpenAI 兼容层）
- EvoClaw 永远对接**商用 API endpoint**（Anthropic / OpenAI / Qwen / GLM 官方），服务端已经处理，客户端无需 parser
- 即便某天要接一个没有 OpenAI 兼容层的 local model，EvoClaw 的策略是**让用户自行架一个 vLLM + `--chat-template` + `--enable-auto-tool-choice`**，不是在 EvoClaw 里内嵌 11 个 parser

---

### §3.6 Per-group 工具采样（`_resolve_tools_for_group`）

**hermes**（`.research/23-rl-environments.md §3.1 / §4.5`） — group 级别采样：

```python
# hermes_base_env.collect_trajectories()
self._current_group_tools = self._resolve_tools_for_group()
# 同组所有 rollout 共享工具集，减少分布采样的随机性
for _ in range(group_size):
    await self.collect_trajectory()
```

关键语义：RL 训练时组大小 G（通常 8）的 rollout 共享同一个工具集采样结果，保证 reward 方差主要来自 policy 而不是环境随机（工具集变化）。

**EvoClaw** — **概念不适用**：

EvoClaw 没有 group / rollout / 方差控制概念。工具集决策路径：
- 默认：`CORE_TOOLS`（`packages/core/src/agent/tool-catalog.ts:18`）
- Profile 过滤：按 agent 配置（`filterToolsByProfile`，见 20-acp-adapter-gap.md §3.7）
- Channel 注入：Channel 相关工具（飞书/企微/微信）
- MCP 注入：`bridgeAllMcpTools()` 运行时从 MCP server 拉取
- Skill 注入：`available_skills` XML 目录 + 按需 invoke_skill

工具集对每个用户会话是**确定的**（配置驱动），不存在"采样"概念。

**判定 🔴 概念不适用**：per-group 采样是 RL 方差控制手段，EvoClaw 单用户会话场景下工具集确定性配置反而更好（用户能预测 agent 能做什么）。

---

### §3.7 结果预算（5000 字符/工具，20000 字符/turn）

**hermes**（`.research/23-rl-environments.md §3.2`） — `HermesAgentLoop` 强制预算：

```
强制结果预算（5000 字符/工具，20000 字符/turn）
```

超限结果通过 `tools/tool_result_storage` 持久化到文件，给 LLM 返回文件路径 + 预览（见 05-agent-loop-gap.md §3.13）。**训练场景**的考量是：训练样本长度分布可控，tokens 不超 4K/turn（后续压进 mask）。

**EvoClaw** — 有工具结果截断，但语义是**推理侧上下文节省**：

- Microcompact（`packages/core/src/agent/kernel/context-compactor.ts:37-78`）：`MICROCOMPACT_TRUNCATE_THRESHOLD = 5_000`，tool_result 超 5KB 头尾 7:3 保留
- Context budget 50%：超 context budget 50% 自动截断（CLAUDE.md `# 工具安全` 段）
- Tool Use Summary（`query-loop.ts:636-660`）：异步 LLM 摘要面向 UI（见 05-agent-loop-gap.md §3.13）

**判定 🟡 部分形态相似**：
- 阈值 5KB 数值巧合（hermes 5000 字符 ≈ EvoClaw 5000 字节）但语义不同：hermes 是**训练样本长度硬上限**，EvoClaw 是**cache-safe 延迟截断**（见 05-agent-loop-gap.md §3.8 Shadow Microcompact）
- EvoClaw 没有"每 turn 总预算 20000 字符"这一硬约束，改为"总 context budget 占比触发自动压缩"（93% 自动 compact，99% 硬阻断）
- 补齐意义小：训练场景的 per-turn 硬预算不适合产品场景（产品要保留上下文做多轮推理）

---

### §3.8 Task ID 隔离 → 独立 VM 会话

**hermes**（`.research/23-rl-environments.md §6 复刻清单 L280`）：

> **Task ID 隔离**：每个 rollout 独立 UUID → 独立 VM 会话

每个 rollout 在 Modal / Docker 里启独立 VM（`environments/agentic_opd_env.py` 后端 `modal/local` 选项），`task_id` 是 VM 命名空间。ToolContext 和 AgentLoop 共享同一 task_id 所以能看到同一个文件系统。

**EvoClaw** — 有 session 隔离但**不隔离 VM**：

- Session Key（`routing/session-key.ts`）：`agent:<agentId>:<channel>:dm:<peerId>` / `...:group:<groupId>`
- Agent 工作区（CLAUDE.md `# 关键架构模式 L38`）：`agentsBaseDir/{agentId}/` 9 文件系统（SOUL.md / IDENTITY.md / ...）
- Docker 沙箱（CLAUDE.md L17）：3 模式 off/selective/all，面向**工具执行隔离**（bash/apply_patch 危险操作），不是**每 session 独立 VM**

**判定 🟡 形态差异**：
- EvoClaw 有逻辑隔离（session key + 工作区文件系统 + 可选 Docker 沙箱），对单用户产品**足够**
- 没有 hermes 的"每 rollout 独立 VM"因为：(1) 产品场景用户数据要持久化，不能每次起新 VM；(2) 单机 Sidecar 跑不起 8x VM 并行
- 补齐意义：零（产品场景不需要 rollout-level VM 隔离）

---

### §3.9 `compute_reward()` 奖励函数接口

**hermes**（`.research/23-rl-environments.md §3.1 / §4.3 / §7`）— 5 个抽象方法之一：

```python
async def compute_reward(self, item: dict, result: AgentResult, ctx: ToolContext) -> float: ...
```

具体环境的 reward 设计（§7 "具体环境对比"表）：

| 环境 | 奖励信号 |
|------|---------|
| AgenticOPD | 正确性(0.7)+效率(0.15)+工具(0.15) |
| WebResearch | 正确性(0.6)+工具(0.2)+效率(0.2) |
| SWE | 测试通过(1.0)/部分(0.1)/失败(0.0) |
| TerminalTest | 完全匹配(1.0)/否(0.0) |

reward 被 Atropos 训练器聚合成 ScoredDataGroup 喂 PPO。

**EvoClaw** — **无 rollout-time reward 概念**，但有**异步用户反馈**：

- `memory_feedback` 表（Sprint 15.12，CLAUDE.md "上一冲刺"段）：用户对记忆 flag 标记
- 热度衰减（CLAUDE.md "注意事项"段）：`sigmoid(log1p(access_count)) × exp(-0.099 × age_days)`，7 天半衰期
- Standing Orders approval（CLAUDE.md `# Standing Orders`）：AGENTS.md 里 `Approval` 字段

这些是**人类反馈循环**（RLHF-adjacent 概念），但都是**异步产品信号**，不是 rollout 结束时算出来的 scalar reward。

**判定 🔴 完全缺失 + 概念定位不同**：
- hermes `compute_reward` = 训练时同步计算的 scalar，用于梯度
- EvoClaw 的反馈 = 推理后异步聚合的用户行为信号，用于**记忆排序**（不是模型参数）
- 理论上 `memory_feedback` 可以作为未来 RLHF 数据源，但那是**另一个项目**（EvoClaw 导出数据 → 外部训练）

---

### §3.10 `evaluate()` 周期性评测

**hermes**（`.research/23-rl-environments.md §3.1 / §7 "运行方式"`） — 第 5 个抽象方法：

```python
async def evaluate(self) -> dict: ...

# CLI
python environments/web_research_env.py evaluate --env.eval_size 50
```

在训练过程中每 N 步跑一次 eval set（独立于 train set），返回 `{accuracy, mean_reward, ...}` 字典。

**EvoClaw** — **无 eval loop / 基准任务集**：

```bash
$ grep -rn "evaluate\|eval_size\|accuracy\|benchmark" packages/core/src | grep -v test
# (agent/kernel 零结果；evaluate 仅出现在 skill/bundled/*.md 作为普通英文词)
```

EvoClaw 的质量保障：
- Vitest 单元/集成测试（`packages/core/src/__tests__/`）— 代码行为正确性
- Doctor 路由（`routes/doctor.ts`）— 运行时健康检查
- 人工使用反馈 — 最终评价

没有"跑 50 个基准任务测准确率"这种概念。

**判定 🔴 完全缺失**：这是训练流水线的独立阶段，产品项目不做。

---

### §3.11 AgenticOPD On-Policy Distillation 管道

**hermes**（`.research/23-rl-environments.md §7 未解之谜`）：

> AgenticOPDEnv 实现了 On-Policy Distillation（LLM judge 投票 → hint 提取 → 增强对话 → logprobs 蒸馏），是最复杂的环境（~1,200 行），细节待进一步研究。

核心流程：学生模型生成 trajectory → LLM judge 投票打分 → 从 judge 反馈提取 hint → 拼回 trajectory 形成"增强对话" → 用 logprobs 做蒸馏 loss。目标：把 GPT-4 级别判断**注入**学生模型参数。

**EvoClaw** — **完全无对应**：

EvoClaw 不做模型蒸馏。记忆 L0→L1→L2 的"层级压缩"是**数据结构压缩**（省 token），不是**参数蒸馏**（改权重）。最接近的东西是 `memory-consolidator.ts`（LCM 概念），但它也是数据聚合，不是 logprobs loss。

**判定 🔴 完全缺失 + 最复杂的训练场景**：AgenticOPD 是 hermes 最深的训练工程，涉及 judge pool / hint extraction / 参考 policy frozen / logprobs alignment 等，单机不可复刻（需要训练集群）。EvoClaw 不应该也不可能做。

---

### §3.12 具体训练环境（SWE / Web / Terminal）

**hermes**（`.research/23-rl-environments.md §7 "具体环境对比"`）：

| 环境 | 数据集 | 工具集 | 后端 |
|------|--------|--------|------|
| AgenticOPD | HF/编码 | terminal+file | modal/local |
| WebResearch | FRAMES | web+file | modal/local |
| SWE | HumanEval | terminal+file+web | modal |
| TerminalTest | 内联任务 | terminal+file | local/modal |

每个环境是一个 `HermesAgentBaseEnv` 子类，负责**数据集加载 + prompt 构造 + reward 计算**。

**EvoClaw** — **完全无对应**：

```bash
$ grep -rn "humaneval\|swe.bench\|FRAMES\|TerminalBench" packages/core/src
# (零结果)
```

EvoClaw 没有"跑 HumanEval/SWE-bench/FRAMES"这类 agent benchmark harness。CLAUDE.md 明确定位是"自进化 AI 伴侣桌面应用"，面向企业员工办公场景，不是 coding agent benchmark 平台。

**判定 🔴 完全缺失 + 场景不匹配**：即便未来要评估 EvoClaw 的 agent 能力，合适的 benchmark 是**IM 场景任务**（多轮对话连贯性 / 记忆召回准确率 / 渠道响应延迟），不是 SWE-bench（非开发者企业用户根本不会给 agent 布置 coding 任务）。

---

### §3.13 `benchmarks/` 评测集

**hermes**（`.research/23-rl-environments.md §2 目录`）：

```
environments/benchmarks/
├── terminalbench_2/          - TB2 官方评测
├── yc_bench/                 - Y Combinator 任务集
└── tblite/                   - TB2 轻量版
```

独立的基准任务集 + 评分逻辑 + pytest 驱动评测。

**EvoClaw** — **完全无对应**：

```bash
$ find /Users/mac/src/github/jone_qian/EvoClaw -type d -name "benchmarks" -o -name "bench" \
    -not -path "*/node_modules/*"
# (零结果)
```

EvoClaw 的 `packages/core/src/__tests__/` 是代码单测（chat-routes / memory-extractor / bash-parser 等），不是 agent task benchmark。

**判定 🔴 完全缺失**：不适用。

---

### §3.14 WandB 训练指标上报

**hermes**（`.research/23-rl-environments.md §5`）：

| 模块 | 交互方式 |
|------|---------|
| WandB | 训练指标上报（wandb_log） |

标准 RL 训练监控：loss / reward / KL divergence / entropy 等指标实时上报。

**EvoClaw** — 无训练指标，但有**应用可观测性**：

- Logger（`infrastructure/logger.ts` + PII 脱敏，CLAUDE.md "注意事项"段）
- MigrationRunner 自动执行 SQL（`infrastructure/db/`）
- conversation_log 表的 compaction_status 字段追踪

这些是**应用运行指标**（请求延迟、错误率、压缩次数），与 wandb 训练指标完全不同。

**判定 🔴 完全缺失 + 类别不同**：wandb 是训练指标 sink，EvoClaw 若要加可观测性应该走 OpenTelemetry / Prometheus（应用栈），不是 wandb。

---

### §3.15 Trajectory 训练格式（ShareGPT JSONL）

**hermes**（`.research/23-rl-environments.md §4.4 / §6 L270-281`）—— trajectory 的训练用途：

- `_save_trajectory(...)` → `trajectory_samples.jsonl`（ShareGPT 格式，每行 `{"conversations": [{"from": "human/gpt/tool", "value": ...}], "mask": [...]}`）
- `<think>...</think>` 和 `<tool_call>...</tool_call>` 作为 XML 内嵌在 value 里
- 直接喂 LLaMA-Factory / axolotl / Atropos

**EvoClaw**（`packages/core/src/memory/conversation-logger.ts:3-10`） — 有 trajectory 但**非训练格式**：

```typescript
export type LogEntryType =
  | 'message'              // 普通对话消息
  | 'compaction_boundary'  // Autocompact/Snip/Microcompact 压缩边界
  | 'memory_saved'         // 记忆保存事件
  | 'agent_spawned'        // 子代理启动
  | 'agent_completed'      // 子代理完成
  | 'error_snapshot';      // 错误快照
```

- `conversation_log` 表是**推理历史**（用于记忆提取、回溯），不是**训练样本**
- 字段面向应用需求（parentMessageId / isSidechain / tokenCount），不是训练需求（mask / role / think-xml）
- 无 ShareGPT 格式导出（见 05-agent-loop-gap.md §3.10 / 16-trajectory-format-gap.md）

**判定 🔴 概念重名但语义不同**：
- EvoClaw "trajectory" = 消息轨迹（conversation history），用于**推理回放**
- hermes "trajectory" = 训练样本（scored rollout），用于**模型更新**
- 同名不同物，不可混淆。详细对比见 16-trajectory-format-gap.md

---

## 4. 建议改造蓝图（不承诺实施）

### 为什么不建议 EvoClaw 实现 `environments/`

1. **架构本质差异**：EvoClaw 是**推理侧产品**（终端用户桌面应用），`environments/` 是**训练侧数据源**（研究团队 RL 训练框架）。两者在 AI 系统全生命周期中属于正交环节。
2. **成本极高**：7,577 行 Python 代码 + `atroposlib` 依赖 + 数据集管线 + reward 函数 + WandB 接入 + 12 个 parser + benchmarks，保守估计 **5-8 人周**工作量。
3. **ROI 为零**：
   - 终端用户不会用 benchmark
   - 产品不做模型训练
   - 训练数据已经是"其他公司（Anthropic / OpenAI）的事"
4. **反向污染**：引入训练框架 = 把"推理产品"和"训练流水线"两种完全不同的工程复杂度压在同一 codebase，CLAUDE.md 的产品焦点会被稀释。

### 如果未来真要让 EvoClaw 产生训练价值

**P2（唯一可能的方向）**：**数据导出**而不是**训练框架**：

| # | 项目 | 对应差距 | 工作量 | 价值 |
|---|---|---|---|---|
| 1 | ShareGPT JSONL trajectory 导出 | §3.15 / 16 章 | 1-2d | 让 EvoClaw 用户能把自己的对话+记忆导出给第三方训练框架消费 |
| 2 | memory_feedback 作为 RLHF 数据源 | §3.9 | 0.5d | `SELECT * FROM memory_feedback WHERE action IN ('accept', 'reject')` → 可做偏好对 |
| 3 | PII 脱敏版 trajectory 导出 | §3.14 / 30 章 | 0.5d | 复用已有 `sanitizePII()`，保证导出不泄漏 |

**总工作量**：约 2-3 人日，**都属于"产品的数据导出能力"**，不是训练框架。这种方向和 EvoClaw "企业扩展包"、"记忆企业可见度"的路线契合，可以自然成为 **Sprint 18+** 的候选。

### 明确不建议做

- 🚫 `HermesAgentBaseEnv` 及其 5 抽象方法 — 给产品抽象塞训练语义
- 🚫 `HermesAgentLoop`（128 并发）— EvoClaw `queryLoop` 已经是最合适的推理循环，改成 128 并发会浪费单机资源
- 🚫 `ToolContext` reward-side 工具 — 产品里没有 reward 函数这个调用方
- 🚫 12 个 tool_call_parser — 商用 API 已统一，不需要客户端重新解析 11 种裸 HF 模型格式
- 🚫 AgenticOPD 蒸馏管道 — 需要训练集群 + judge model 池 + logprobs 对齐，单机不可能
- 🚫 benchmarks/ + evaluate() + WandB — 训练流水线基础设施，对产品零价值

---

## 5. EvoClaw 反超点汇总

**本章无反超点**。

EvoClaw 在"RL 训练环境"维度**既无对应实现，也无对应定位**。§5 反超点表格在"架构不同但能力覆盖"的章节（如 20-acp-adapter-gap §5 列出 MCP 客户端 / 多渠道 IM / QR 登录等）有存在价值；本章因为 EvoClaw 根本不在"训练侧"做事，没有可并置的反超项。

**非反超但值得说明的侧链能力**（和训练生态**没有**直接关系，只是顺带提一下避免被误读）：

| # | EvoClaw 能力 | 为什么不是本章反超 |
|---|---|---|
| 1 | 三层记忆 L0/L1/L2（CLAUDE.md `# 关键架构模式`） | 数据结构压缩，不是参数蒸馏 |
| 2 | `memory_feedback` 表（Sprint 15.12） | 产品级反馈信号，不是 rollout reward |
| 3 | `conversation_log.compaction_status` | 推理侧压缩状态，不是训练样本 mask |
| 4 | PII 脱敏 | 日志安全，不是训练数据清洗流水线 |

如果某天要用，它们可以被**第三方训练框架**当作输入（详见 §4 P2 建议），但在 EvoClaw 内部，它们只解决产品问题。

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样与零结果验证（2026-04-16）

**组件存在性验证**（已通过 Read 工具确认）：

- `packages/core/src/agent/kernel/query-loop.ts:340-697` ✅ `queryLoop` 主循环（770 行，推理侧）
- `packages/core/src/agent/kernel/stream-client.ts:1-16` ✅ 双协议（Anthropic Messages + OpenAI Chat Completions）说明注释
- `packages/core/src/agent/kernel/context-compactor.ts:37-78` ✅ Microcompact 5KB 阈值
- `packages/core/src/agent/tool-catalog.ts:18` ✅ `CORE_TOOLS` 单向静态清单
- `packages/core/src/memory/conversation-logger.ts:3-10` ✅ `LogEntryType` 6 种（应用事件，非训练 mask）

**RL 相关零结果验证**（本章的核心证据）：

```bash
$ grep -rn "gym\|BaseEnv\|collect_trajectories\|get_next_item\|compute_reward" \
    packages/core/src
# (零结果 — 已验证)

$ grep -rn "ToolContext\|task_id\|atropos\|ScoredDataGroup\|managed_state" \
    packages/core/src
# (零结果 — 已验证)

$ grep -rn "tool_call_parser\|hermes_parser\|mistral_parser" \
    packages/core/src --include="*.ts" | grep -v test
# (零结果 — 测试中的 "bash-parser" 是不同概念，不含训练用 parser)

$ grep -rn "logprobs\|ManagedServer\|get_logprobs" packages/core/src
# (零结果)

$ grep -rn "humaneval\|swe.bench\|FRAMES\|TerminalBench\|yc.bench\|wandb" \
    packages/core/src
# (零结果，仅 skill/bundled/*.md 中出现 "training update" 这类普通英文词)

$ find /Users/mac/src/github/jone_qian/EvoClaw -type d \
    \( -name "environments" -o -name "benchmarks" -o -name "tool_call_parsers" \) \
    -not -path "*/node_modules/*"
# (零结果)
```

**结论**：EvoClaw 源码**完全无 RL 训练环境实现**，确认本章 🔴 整体缺失判定。

### 6.2 hermes 研究引用（章节 §）

- `.research/23-rl-environments.md §1` 角色与定位（L9-56）
- `.research/23-rl-environments.md §2` 目录/文件分布（L60-89）
- `.research/23-rl-environments.md §3.1` HermesAgentBaseEnv 抽象骨架 / 5 抽象方法 / `collect_trajectories`
- `.research/23-rl-environments.md §3.2` HermesAgentLoop 多轮引擎 / 128 worker
- `.research/23-rl-environments.md §3.3` ToolContext 接口与 task_id 共享
- `.research/23-rl-environments.md §3.4` Phase 1 / Phase 2 双模式
- `.research/23-rl-environments.md §3.5` 12 个 Tool Call Parser
- `.research/23-rl-environments.md §4` 代码片段（抽象方法 / agent_loop / compute_reward 示例 / parser / per-group 采样）
- `.research/23-rl-environments.md §5` 与其它模块交互（wandb / atroposlib / model_tools）
- `.research/23-rl-environments.md §6` 复刻清单（10 项）
- `.research/23-rl-environments.md §7` 具体环境对比表 + OPD 未解之谜 + 运行方式 CLI

### 6.3 关联差距章节（Crosslink）

本章作为"训练侧整体缺失"类分析，与以下同批次 / 同主题章节密切相关：

- **`11-environments-spawn-gap.md`** — 执行环境 & spawn：hermes `tools/environments/*`（Local/Docker/Modal 执行后端）是 `environments/` 的**执行后端**。EvoClaw 的 Docker 沙箱和 bash 执行体系属于这一层（已在 11 章分析）。
- **`22-browser-stack-gap.md`**（同 Wave 批次）— 浏览器栈：hermes `ToolContext.browser_navigate/browser_snapshot`（§3.3）依赖浏览器栈。EvoClaw 的浏览器能力（web_fetch / web_search）属于 agent 推理侧工具，与训练侧 reward 判定无关。
- **`24-batch-runner-gap.md`**（同 Wave 批次）— Batch 运行器：hermes batch runner 调度训练侧 rollout 并行；EvoClaw 的 Lane Queue（main/subagent/cron）是推理侧并发控制，不是训练 rollout 并行。
- **`05-agent-loop-gap.md`** — Agent 主循环：本章 §3.2 / §3.7 多次引用 05 章的 §3.8 / §3.13。05 章已分析 `queryLoop` vs `run_conversation`，本章补充 `queryLoop` vs `HermesAgentLoop`（训练侧）的维度。
- **`16-trajectory-format-gap.md`** — Trajectory 格式：本章 §3.15 的详细格式对比在 16 章。两章互为补充，16 章重点是"推理历史格式"，本章重点是"为什么训练侧不适用"。
- **`17-trajectory-compression-gap.md`** — Trajectory 压缩：本章 §3.7 的结果预算 / 微压缩语义详细对比在 17 章。
- **`26-rl-cli-gap.md`**（待写）— RL CLI：与本章互为"模块"与"入口"关系，RL CLI 是训练者用来驱动 `environments/` 的入口。EvoClaw 无 RL CLI 也无 environments。

**全局定位**：

- hermes `environments/` 是"**训练数据源**"（为 RL / SFT 提供结构化 rollout 与 reward）
- EvoClaw 是"**推理产品**"（服务终端用户的桌面 agent）
- 两者在 Claude Code 生态光谱上属于**训练轨道 vs 产品轨道**，正交关系
- 本章不建议补齐，唯一可能的长期方向是 §4 P2 **数据导出**（让 EvoClaw 成为第三方训练框架的输入源，而不是自己做训练）

---

**本章完成**。核心结论：

- 🔴 `environments/` 目录 **7,577 行零实现**（确认 §6.1 grep 零结果）
- 🔴 15 个机制中 13 个完全缺失，2 个仅形态上相似（结果截断阈值 / session 隔离方式）但语义完全不同
- 🟢 无反超点（本章不存在"架构不同但能力覆盖"的场景）
- **不建议补齐**：架构正交、成本 5-8 人周、ROI 为零、反向污染产品焦点
- **唯一可探索方向**：数据导出（§4 P2），让 EvoClaw 的推理数据能成为**外部训练框架**的输入，而不是在 EvoClaw 里内嵌训练框架
