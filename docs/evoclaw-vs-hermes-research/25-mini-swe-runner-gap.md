# 25 — Mini SWE Runner（轻量 SWE 任务执行器）差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/25-mini-swe-runner.md`（196 行，Phase E draft）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`mini_swe_runner.py:1-709`（709 行，轻量级 SWE benchmark 任务执行器，`terminal` 工具 + Hermes 轨迹格式）
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16）
> **综合判定**: 🔴 **整体缺失 / 产品定位正交** — EvoClaw 无 SWE-bench 集成、无 mini-SWE-agent 框架依赖、无训练/评测轨迹生成 CLI；与 24-batch-runner 同属"研究员数据生产"工具链，在"企业非技术用户的 AI 伴侣桌面应用"定位下**按设计**缺失。无 P0 建议项，仅 1 项可借鉴思路（完成信号硬编码）

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes Mini SWE Runner**（`.research/25-mini-swe-runner.md` §1，`mini_swe_runner.py:1-709`）—— **轻量级 Software Engineering 任务执行器**，单文件 709 行。定位非常具体：**将自然语言 SWE 任务（"在 repo X 中修复 bug Y"）转成 LLM 驱动的多轮代理轨迹**，用 `terminal` 工具（bash 执行环境）逐步完成编程任务，输出**符合 Hermes 格式的 ShareGPT JSONL 轨迹**（`[{from, value}]`）。面向场景：

1. **SWE-bench 评估**（研究 §7 "与 SWE-Bench 的兼容性"）— 输出可直接用于 SWE-bench 评测管线
2. **训练数据生产** — 产出轨迹作为 `batch_runner.py`（24 章）/ `trajectory_compressor.py`（17 章）的上游
3. **单任务调试** — `fire.Fire(main)` CLI 支持单 prompt / prompts_file 批处理两种模式

关键特征：**三执行后端**（`LocalEnvironment` / `DockerEnvironment` / `ModalEnvironment` 工厂模式动态选择，研究 §3.2）；**terminal JSON Schema 固化**（command + timeout，研究 §2 `TERMINAL_TOOL_DEFINITION` L52-94）；**完成信号硬编码**（`MINI_SWE_AGENT_FINAL_OUTPUT` 字符串检测 L507-523）；**OpenAI chat completion → Hermes `{from, value}` 格式双向转换**（L288-396，含 `<tool_call>` / `<tool_response>` XML 包装）；**流式 JSONL 写入**（L577-605，`f.flush()` 防崩溃丢失）；**LLM 路由双路径**（显式 api_key/base_url 直连 OR `resolve_provider_client("openrouter")` 自动路由 L189-212）。

**EvoClaw 对应子系统** —— **不存在**。EvoClaw 是面向企业非技术用户的 AI 伴侣桌面应用（CLAUDE.md "面向企业级用户非开发者"），**没有 SWE-bench 集成、没有 mini-SWE-agent 框架依赖、没有 terminal-only 轨迹生成 CLI**。与"bash 工具驱动 SWE 任务"在**工具**维度最接近的是 EvoClaw 的 `createEnhancedExecTool()`（`packages/core/src/agent/embedded-runner-tools.ts:56-60`），但：

- 它是 **Agent Kernel 5 阶段工具注入**中的一个（CLAUDE.md "Kernel builtin tools → Enhanced bash → EvoClaw-specific → Channel tools → MCP + Skills"），不是独立 runner
- 无 `MINI_SWE_AGENT_FINAL_OUTPUT` 完成信号语义（停止条件由 queryLoop 的 LLM `stop_reason` 决定，见 05-agent-loop-gap.md）
- 无 Hermes ShareGPT 轨迹导出（见 16-trajectory-format-gap.md 判定 🔴 缺失）
- 无独立 CLI（见 27-cli-architecture-gap.md 计划章节）

**grep 验证**（`packages/core/src/` 范围，2026-04-17）:
- `grep -r "mini_swe\|mini-swe\|MiniSWE" packages/core/src/` → **0 结果**
- `grep -r "swebench\|SWE-bench\|SWEBench" packages/core/src/` → **0 结果**
- `grep -r "MINI_SWE_AGENT_FINAL_OUTPUT\|FINAL_OUTPUT" packages/core/src/` → **0 结果**
- `grep -r "TERMINAL_TOOL_DEFINITION\|terminal_tool\|TERMINAL_TOOL" packages/core/src/` → **0 结果**
- `grep -r "LocalEnvironment\|DockerEnvironment\|ModalEnvironment" packages/core/src/` → **0 结果**
- `grep -r "fire\.Fire\|argparse\|commander\|yargs" packages/core/src/` → **0 结果**（Sidecar 是 HTTP 服务而非 CLI 工具）
- `grep -r "run_task\|run_conversation" packages/core/src/` → **0 结果**
- `grep -r "resolve_provider_client\|auxiliary_client\|openrouter" packages/core/src/` → **0 结果**
- `grep -r "ShareGPT\|sharegpt" packages/core/src/` → **0 结果**

**量级对比**: hermes 单文件 709 行 vs EvoClaw 0 行。这不是"量级"差异——**EvoClaw 本就不覆盖"SWE 评测执行 + 轨迹数据生产"这一工程路径**，与 24-batch-runner / 23-rl-environments 同属"研究员训练数据生产"工具链（hermes `.research/25-mini-swe-runner.md` §5 明确指出"输出格式兼容，可被 batch_runner 消费"）。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | Runner 骨架：自然语言任务 → LLM → bash → 轨迹 | 🔴 | EvoClaw 完全缺失；`grep mini_swe\|run_task` 零结果 |
| §3.2 | 环境工厂（Local / Docker / Modal 三后端动态选择） | 🔴 | EvoClaw 无环境工厂抽象；`grep LocalEnvironment\|DockerEnvironment\|ModalEnvironment` 零结果；Docker 是全局 Sandbox 配置 |
| §3.3 | `terminal` 工具 JSON Schema 固化（command + timeout） | 🔴 | EvoClaw 有 `bash` 工具但属于 Kernel 5 阶段工具链，非 mini-swe 独立 schema |
| §3.4 | LLM 客户端初始化（OpenAI SDK + OpenRouter/Anthropic 路由） | 🔴 | EvoClaw 无 OpenRouter 自动路由；Kernel 双协议（Anthropic/OpenAI）由 ModelRouter 而非本层决策 |
| §3.5 | 代理执行主循环（`run_task` L398-555） | 🔴 | EvoClaw 有 `queryLoop`（05 章）但非 mini-swe 语义；无任务级 `run_task` 入口 |
| §3.6 | 完成信号检测（`MINI_SWE_AGENT_FINAL_OUTPUT` 字符串硬编码） | 🔴 | EvoClaw 用 LLM `stop_reason` + 无 tool_calls 退出，无完成信号字符串匹配 |
| §3.7 | Hermes 轨迹格式转换（OpenAI chat → `{from, value}` XML 包装） | 🔴 | 详见 16-trajectory-format-gap.md；EvoClaw 用 ChatMessage 结构存 SQLite，非 ShareGPT |
| §3.8 | 批处理流式 JSONL 写入（逐行 flush） | 🔴 | EvoClaw 无 JSONL 输出路径，`grep .jsonl` 仅命中 runtime.ts 运行时检测 |
| §3.9 | 环境生命周期（创建 → 执行 → 清理） | 🟡 | EvoClaw Kernel 有 Tool 生命周期 + Plugin shutdown hook，但无"可替换执行环境"抽象 |
| §3.10 | CLI 双模式（`--task` 单任务 / `--prompts_file` 批处理） | 🔴 | EvoClaw 桌面应用架构下仅 REST（`/chat/:agentId/send`），无 CLI |
| §3.11 | Tool response XML 包装（`<tool_response>` + tool_call_id） | 🔴 | EvoClaw 工具结果用 JSON 对象回传 Kernel，无 XML 字符串标签 |
| §3.12 | 迭代上限熔断（`max_iterations` 默认 15） | 🟡 | EvoClaw Kernel 有 maxIterations 配置但语义与 SWE 任务"放弃"不同（更偏向安全防护） |
| §3.13 | 环境隔离（Docker/Modal 容器级） | 🟡 | EvoClaw 有 Docker Sandbox（3 模式 off/selective/all）但是 Agent 级配置，非 per-task 选择 |

**统计**: 🔴 10 / 🟡 3 / 🟢 0（零反超；产品定位差异导致绝大多数项不建议补齐，见 §4）。

---

## 3. 机制逐条深度对比

### §3.1 Runner 骨架：自然语言任务 → LLM → bash → 轨迹

**hermes**（`.research/25-mini-swe-runner.md` §1 图 + `mini_swe_runner.py:L141-607`）—— 完整闭环:

```
main → MiniSWERunner(model, env_type, ...)
     → create_environment(env_type)      # 工厂模式创建执行环境
     → run_task(prompt)                   # 启动任务
        → while api_call_count < max_iterations:
            → LLM 推理 → 解析 tool_calls
            → env.execute(command)        # bash 执行
            → 检测 MINI_SWE_AGENT_FINAL_OUTPUT → completed=True
        → 转换 Hermes `{from, value}` 格式
        → 保存 JSONL
        → 清理环境
```

**EvoClaw** —— **完全缺失**:

```
grep -r "mini_swe\|MiniSWE\|run_task\|run_conversation" packages/core/src/ → 0 结果
```

最接近的闭环是 `packages/core/src/agent/embedded-runner.ts:33-60` `runEmbeddedAgent()` + Kernel `queryLoop`（见 05-agent-loop-gap.md），但：

- 入口签名是 `(config, message, onEvent, abortSignal, options)`，**无环境类型参数、无轨迹输出文件参数、无 max_iterations 显式参数**（由 AgentRunConfig 内部隐含）
- 委托给 `runEmbeddedLoop()`（`embedded-runner.ts:50`）做 Provider Failover 和错误恢复，**非 SWE 任务导向**
- 输出走 `onEvent` 回调 + `conversation_log` SQLite 表，**非 JSONL 文件**

**判定 🔴**：这是 hermes Mini SWE Runner 的**全部存在意义**——完全缺失。与 §3.5 / §3.7 / §3.10 同源。企业用户场景不需要"把自然语言任务转成 bash 轨迹"这种工具形态。

---

### §3.2 环境工厂（Local / Docker / Modal 三后端动态选择）

**hermes**（`mini_swe_runner.py:L101-134`，研究文档 §3.2）—— **工厂模式动态导入**:

```python
def create_environment(env_type, image, cwd, timeout):
    if env_type == "local":
        from tools.environments.local import LocalEnvironment
        return LocalEnvironment(cwd=cwd, timeout=timeout)
    elif env_type == "docker":
        from tools.environments.docker import DockerEnvironment
        return DockerEnvironment(image=image, cwd=cwd, timeout=timeout)
    elif env_type == "modal":
        from tools.environments.modal import ModalEnvironment
        return ModalEnvironment(image=image, cwd=cwd, timeout=timeout)
```

三后端语义：`local` 无隔离，`docker` 容器级隔离，`modal` 云端隔离。CLI 通过 `--env` 参数选择。

**EvoClaw** —— **无环境工厂**:

```
grep -r "LocalEnvironment\|DockerEnvironment\|ModalEnvironment" packages/core/src/ → 0 结果
grep -r "createEnvironment\|create_environment" packages/core/src/ → 0 结果
```

EvoClaw 有 Docker Sandbox 能力（CLAUDE.md "Docker（可选，3 模式: off/selective/all，首次使用时引导安装）"）但是:

- **全局/Agent 级配置**（不是 per-task 选择）
- **沙箱用途是**"工具执行安全隔离"，不是"替换整个 runner 执行后端"
- 无 "Modal 云端执行" 对应概念（`grep Modal` 仅命中 `ModalityType` 类型无关字面词）

**判定 🔴**：缺失。企业用户场景不需要 3 执行后端选择（桌面应用本地运行即可，Docker 是可选加固）。Modal 云端后端对 EvoClaw 产品完全无关。

---

### §3.3 `terminal` 工具 JSON Schema 固化（command + timeout）

**hermes**（`mini_swe_runner.py:L52-94`，研究文档 §2）—— 硬编码单一工具:

```python
TERMINAL_TOOL_DEFINITION = {
  "type": "function",
  "function": {
    "name": "terminal",
    "description": "Execute shell command. ...",
    "parameters": {
      "type": "object",
      "properties": {
        "command": {"type": "string", "description": "..."},
        "timeout": {"type": "integer", "description": "..."}
      },
      "required": ["command"]
    }
  }
}
```

**关键特征**：Mini SWE Runner 故意**只暴露一个工具**（terminal），让 LLM 必须用 bash 命令完成所有操作（读文件、编辑、运行测试、查状态等）。这是 mini-SWE-agent 框架的设计哲学——最小工具面。

**EvoClaw**（`packages/core/src/agent/embedded-runner-tools.ts:56-60`）—— **bash 仅是 Kernel 5 阶段工具链的一部分**:

```typescript
// embedded-runner-tools.ts:56-60
export function createEnhancedExecTool() {
  return {
    name: 'bash',  // 保持名称为 bash，模型更熟悉
    description: `执行 shell 命令。输出截断到 ${MAX_OUTPUT_CHARS / 1000}K 字符...`,
    parameters: {
      // ...
    }
  };
}
```

CLAUDE.md "5 阶段工具注入：Kernel builtin tools (read/write/edit/grep/find/ls) → Enhanced bash → EvoClaw-specific → Channel tools → MCP + Skills"——bash 与 read/write/edit/grep/find/ls **并列**，不是**唯一**工具。

**判定 🔴**：形态差异显著。Mini SWE Runner 的 "bash-only" 哲学与 EvoClaw 的"多工具并列"哲学取向不同，对 EvoClaw 而言**不应对齐**——LLM 拿 read/write/edit 专用工具比用 `cat/sed` bash 命令更可控、更可审计、更符合企业用户 UI 需求（read/edit 可走权限面板、grep 走 Kernel 封装）。

---

### §3.4 LLM 客户端初始化（OpenAI SDK + OpenRouter/Anthropic 路由）

**hermes**（`mini_swe_runner.py:L189-212`，研究文档 §3.3）—— 双路径:

```python
if api_key or base_url:
    from openai import OpenAI
    self.client = OpenAI(
        base_url=base_url or "https://openrouter.io/api/v1",
        api_key=api_key,
    )
else:
    from agent.auxiliary_client import resolve_provider_client
    self.client, _ = resolve_provider_client("openrouter", model=model)
```

**关键特征**：默认走 OpenRouter 聚合器（单一入口兼容 Anthropic/OpenAI/其它模型），`resolve_provider_client` 根据 model 字符串自动路由 provider。

**EvoClaw**（ModelRouter 系，见 06-llm-providers-gap.md）—— **无 OpenRouter 路由**:

```
grep -r "openrouter\|OpenRouter\|resolve_provider_client" packages/core/src/ → 0 结果
```

EvoClaw 策略（CLAUDE.md "Kernel 双协议: Anthropic Messages (x-api-key + anthropic-version) + OpenAI Chat Completions (Bearer token)，国产模型统一走 openai-completions + 自定义 baseUrl"）:

- Provider 层面直接对接 Anthropic / OpenAI / 国产模型（Qwen/GLM/Doubao），不走 OpenRouter 聚合器
- `ModelRouter` 做模型选择（Agent 配置 → 用户偏好 → 系统默认 → 硬编码 fallback `gpt-4o-mini`），**不是 mini-swe 的"OpenRouter 二级路由"**

**判定 🔴**：缺失 OpenRouter 路由。但 EvoClaw 直接对接 provider 的架构**更契合企业用户场景**（可控的 API Key 管理 + JWT (GLM) 等差异化认证，见 CLAUDE.md "model-fetcher.ts buildAuthHeaders()"），不建议引入 OpenRouter 中间层。

---

### §3.5 代理执行主循环（`run_task` L398-555）

**hermes**（`mini_swe_runner.py:L398-555`，研究文档 §3.4）—— **157 行一体化循环**:

```
run_task(prompt):
    env = _create_env()                    # L413
    while api_call_count < max_iterations:  # L436-534
        response = client.chat.completions.create(...)   # L445-450
        assistant_message = response.choices[0].message

        if assistant_message.tool_calls:
            for tc in assistant_message.tool_calls:       # L462-479
                command = json.loads(tc.function.arguments)["command"]
                result = self._execute_command(command, timeout)  # L483-519
                if "MINI_SWE_AGENT_FINAL_OUTPUT" in result["output"]:
                    completed = True
                messages.append(tool_response)
        else:
            # Final Response 退出
            break

    env.close()                             # L540-541
    return convert_to_hermes(messages)      # L543-544
```

**EvoClaw** —— **有 Kernel 的 `queryLoop` 但非 SWE 语义**（见 05-agent-loop-gap.md）:

- `packages/core/src/agent/kernel/query-loop.ts` 是 `while(true)` 循环（流式 API → 工具执行 → 继续/退出）
- 出口条件是 LLM `stop_reason`（end_turn / tool_use 未触发），**不依赖字符串匹配完成信号**
- 不做 Hermes 格式转换（轨迹持久化到 `conversation_log` 表，不落 JSONL）
- 无 "单 prompt → 单轨迹 JSONL" 入口；最接近的入口是 `runEmbeddedAgent()`（§3.1）

**判定 🔴**：SWE 任务导向的 `run_task` 入口缺失。05-agent-loop-gap.md 已判定 Kernel queryLoop 在**压缩 / thinking / 错误恢复**维度反超，但在**轨迹导出 / 完成信号检测 / 环境生命周期**维度为空白。

---

### §3.6 完成信号检测（`MINI_SWE_AGENT_FINAL_OUTPUT` 字符串硬编码）

**hermes**（`mini_swe_runner.py:L77, L507-523`，研究文档 §7 "完成信号设计"）:

```python
# L77 system prompt 中硬编码指令
system_prompt = """When your task is complete, output:
MINI_SWE_AGENT_FINAL_OUTPUT
followed by a summary."""

# L507-523 检测
for tc in assistant_message.tool_calls:
    result = self._execute_command(command, timeout)
    if "MINI_SWE_AGENT_FINAL_OUTPUT" in result["output"]:
        completed = True
```

**关键 insight**（研究文档 §7）：**Agent 自行输出该字符串来显式标记完成**——绕过了 LLM `stop_reason` 的不确定性，也不依赖"无 tool_calls → 视为完成"的暗示。

**EvoClaw** —— **无完成信号**:

```
grep -r "MINI_SWE_AGENT_FINAL_OUTPUT\|FINAL_OUTPUT" packages/core/src/ → 0 结果
```

EvoClaw Kernel 退出语义（由 queryLoop 管理，见 05-agent-loop-gap.md §3.6）:

- LLM 返回 `stop_reason: "end_turn"` → 退出
- LLM 返回 `stop_reason: "tool_use"` → 执行工具 + 继续
- 工具循环检测（CLAUDE.md "重复/乒乓/熔断器阈值 30"）→ 熔断退出
- maxIterations 溢出 → 退出

无字符串匹配的"完成信号"机制。

**判定 🔴**：形态差异。EvoClaw 的 `stop_reason` + 循环熔断对**实时对话场景**足够，对**SWE 任务**则不够——例如 Agent 把 repo 修复完了但继续在调用 `ls` 探查，stop_reason 不会触发；此时完成信号字符串能让 Agent 主动"打包收工"。**可借鉴思路**（§4 P2）：Standing Orders / Cron 任务可加"主动完成信号"约定，避免长任务无意义循环。

---

### §3.7 Hermes 轨迹格式转换（OpenAI chat → `{from, value}` XML 包装）

**hermes**（`mini_swe_runner.py:L288-396`，研究文档 §3.5）:

```python
# L354-380 — tool response 包装
tool_response = "<tool_response>\n"
tool_response += json.dumps({
    "tool_call_id": tool_msg.get("tool_call_id", ""),
    "name": msg["tool_calls"][len(tool_responses)]["function"]["name"],
    "content": tool_content
}, ensure_ascii=False)
tool_response += "\n</tool_response>"

# 完整映射
# system        → {"from": "system", "value": "..."}
# user          → {"from": "human", "value": "..."}
# assistant+tc  → {"from": "gpt", "value": "<tool_call>...</tool_call>"}
# tool response → {"from": "tool", "value": "<tool_response>...</tool_response>"}
```

**关键特征**：输出**直接兼容 Hermes 训练格式 + SWE-bench 评测管线**，是整个 runner 存在的核心产出物。

**EvoClaw** —— **完全缺失**（已在 16-trajectory-format-gap.md 详细判定 🔴）:

```
grep -r "ShareGPT\|sharegpt\|<tool_call>\|<tool_response>" packages/core/src/ → 0 结果
```

EvoClaw 轨迹结构:

- 存入 `conversation_log` 表（SQLite，见 CLAUDE.md "conversation_log (原始消息+压缩状态)"）
- 内存结构 `ChatMessage` `{role, content, toolCalls, toolResults, ...}`
- 面向"应用内查询 / 恢复 / 压缩追踪"，不是训练格式

**判定 🔴**：见 16-trajectory-format-gap.md 详细分析。企业产品**不需要** ShareGPT 导出——用户不在训练模型。如需补齐应作为**独立导出工具**（`conversation_log → jsonl` 转换脚本），而非嵌入 runner。

---

### §3.8 批处理流式 JSONL 写入（逐行 flush）

**hermes**（`mini_swe_runner.py:L577-605`，研究文档 §3.6）:

```python
with open(output_file, 'w', encoding='utf-8') as f:
    for i, prompt in enumerate(prompts, 1):
        result = self.run_task(prompt)
        f.write(json.dumps(result, ensure_ascii=False) + "\n")
        f.flush()   # 防止崩溃丢失
```

**关键特征**：与 24-batch-runner 共享"流式写入 + flush"设计，进程崩溃后已完成 prompt 不丢失。

**EvoClaw** —— **无 JSONL 输出路径**:

```
grep -r "\.jsonl" packages/core/src/ → 仅 runtime.ts 命中（Node 运行时检测无关）
```

EvoClaw 持久化路径:

- `conversation_log` 表由 `IncrementalPersister`（`packages/core/src/agent/kernel/incremental-persister.ts`）增量写入 SQLite
- 压缩后的 L0/L1/L2 记忆走 `memory_units` 表
- 无 JSONL 外部文件输出

**判定 🔴**：缺失。对企业产品而言 SQLite + 应用内查询更合适（用户不读原始 JSONL），不建议补齐。

---

### §3.9 环境生命周期（创建 → 执行 → 清理）

**hermes**（`mini_swe_runner.py:L413, L540-541`）—— **显式 create / close 对**:

```python
env = self._create_env()   # L413 创建
# ... 使用 env 执行 commands ...
env.close()                 # L540 清理
```

**EvoClaw** —— **Plugin 生命周期 + 工具级独立**:

- ContextPlugin 有 `bootstrap` / `shutdown` hook（CLAUDE.md "5 hooks: bootstrap → beforeTurn → compact → afterTurn → shutdown"），但**作用于 Agent 整体的插件状态**，不是 per-task 执行环境
- `createEnhancedExecTool()`（`embedded-runner-tools.ts:56`）内部的 `asyncExec` 有 AbortController 管理子进程生命周期（CLAUDE.md "异步执行引擎（spawn 非阻塞 → AbortController → 超时 SIGTERM/SIGKILL"），但**每次 bash 调用独立 fork/spawn**，无跨调用共享的"环境"概念
- 无"可替换执行环境 + 显式 create/close"抽象

**判定 🟡**：**形态差异**——EvoClaw 有 Plugin shutdown hook 和工具级 AbortController（各自覆盖了清理语义），但没有 Mini SWE Runner 的"单一可替换执行环境"模型。这反映产品定位差异：Runner 强调"跑完 SWE 任务就销毁环境"，EvoClaw 强调"Agent 长生命周期 + 共享插件状态"。

---

### §3.10 CLI 双模式（`--task` 单任务 / `--prompts_file` 批处理）

**hermes**（`mini_swe_runner.py:L614-709`，研究文档 §3.1）—— `fire.Fire(main)` 自动生成:

```bash
# 单任务
python mini_swe_runner.py --task "Fix bug in foo.py" --env local --output_file result.jsonl

# 批处理
python mini_swe_runner.py --prompts_file tasks.jsonl --output_file trajectories.jsonl
```

**EvoClaw**（`packages/core/src/server.ts`）—— **仅 REST / Sidecar 架构**:

```
grep -r "fire\.Fire\|argparse\|commander\|yargs" packages/core/src/ → 0 结果
```

- Sidecar 是 HTTP 服务（`Bun.serve` 监听 127.0.0.1:49152-65535，CLAUDE.md "Sidecar 通信"）
- 交互入口：Tauri UI（主）+ REST (`/chat/:agentId/send`) + 渠道 gateway（辅）
- 无 CLI 子命令；详见 27-cli-architecture-gap.md（计划章节）

**判定 🔴**：缺失 CLI。桌面应用架构下 Tauri UI 是主入口，不应新增 CLI 路径分裂运维。

---

### §3.11 Tool response XML 包装（`<tool_response>` + tool_call_id）

**hermes**（`mini_swe_runner.py:L354-380`）:

```python
tool_response = "<tool_response>\n" + json.dumps({...}) + "\n</tool_response>"
```

**关键特征**：工具响应在轨迹中以 **XML 字符串标签**形式出现（不是结构化对象），方便训练管线识别 tool-use 片段。

**EvoClaw**（Kernel `tool-adapter.ts`）—— **结构化 JSON 对象**:

- 工具结果作为 `ToolCallResult` 对象回传 Kernel（`packages/core/src/agent/kernel/types.ts`）
- 序列化到 `conversation_log` 时走 JSON 字段，不加 XML 包装
- 参考 16-trajectory-format-gap.md 详细分析

**判定 🔴**：缺失 XML 包装路径。与 §3.7 同源——输出格式差异。EvoClaw 的结构化对象对**应用内消费**更好（直接 .toolResults 访问），但对**训练数据生产**不友好。不建议补齐。

---

### §3.12 迭代上限熔断（`max_iterations` 默认 15）

**hermes**（`mini_swe_runner.py:L141-607` 字段表 + 研究文档 §2）—— **默认 15 迭代**:

```python
while api_call_count < max_iterations:   # 默认 15
    ...
```

**语义**：SWE 任务"放弃"边界——15 轮后认为任务无法完成，返回未完成轨迹供下游分析。

**EvoClaw**（Kernel `queryLoop`）—— **有 maxIterations 但语义不同**:

- EvoClaw Kernel 的迭代上限偏向"安全防护"（避免无限循环消耗 token），不是 SWE 任务语义的"放弃边界"
- 配合 "循环检测（重复/乒乓/熔断器阈值 30）"（CLAUDE.md）形成立体防护
- 熔断后不产出"未完成轨迹"用于下游分析——直接报错

**判定 🟡**：**形态相似语义不同**。EvoClaw 的防护更全面（重复检测 + 乒乓检测 + 熔断阈值 30），但**SWE 任务的"15 轮放弃"语义不覆盖**——对企业用户而言无需区分，熔断即结束对话。

---

### §3.13 环境隔离（Docker/Modal 容器级）

**hermes**（研究文档 §7 "环境隔离"）:

- `local` → 无隔离
- `docker` → 容器级隔离（每 task 一容器）
- `modal` → 云端隔离（Modal.com 无服务器函数）

**EvoClaw**（CLAUDE.md "沙箱: Docker（可选，3 模式: off/selective/all，首次使用时引导安装）"）:

- Docker Sandbox 是 **Agent 级 / 全局级**配置（off/selective/all 三模式）
- 非 per-task 选择，无"某个任务用 docker 另一个用 local"的能力
- 无 Modal 云端执行后端（`grep Modal` 仅命中 `ModalityType` 类型无关字面词）

**判定 🟡**：**能力存在但颗粒度不同**。企业用户场景更契合"Agent 级统一沙箱策略"（管理员设置一次全局生效），而非 "per-task 动态切换"（管理复杂度失控）。Modal 云端后端对 EvoClaw 产品**完全无关**。

---

## 4. 建议改造蓝图（不承诺实施）

**产品定位判断前提**：EvoClaw 定位"面向企业非技术用户的 AI 伴侣桌面应用"（CLAUDE.md），**不是**"SWE-bench 评测工具 / 训练数据生产者"。Mini SWE Runner 的全部能力（terminal-only 工具面 / Hermes 轨迹导出 / Docker/Modal 环境工厂 / CLI 批处理）为 SWE 评测场景而生——因此本章档位全部 🔴/🟡，但**几乎全部项不建议补齐**。

**P0**（高 ROI，建议尽快）: **无** —— 无高 ROI 项。Mini SWE Runner 的核心价值（SWE benchmark 评测 + 轨迹生产）与 EvoClaw 产品定位不交集。

**P1**（中等 ROI，可选）:

| # | 项目 | 对应差距 | 工作量 | ROI | 价值 |
|---|---|---|---|---|---|
| 1 | **轻量内部 QA runner**（给 Agent 跑 N 条测试 prompt 对比模型 / 回归新 prompt 行为） | §3.1 / §3.5 骨架 | 5-7d | 🔥 | 企业升级模型时可运行 QA 回归，复用现有 `runEmbeddedAgent`，参考 24-batch-runner-gap.md P1 #1 同源提案 |

**P2**（长期规划）:

| # | 项目 | 对应差距 | 工作量 |
|---|---|---|---|
| 2 | **主动完成信号约定**（Standing Orders / Cron 长任务可选声明 `FINAL_OUTPUT` 字符串，Agent 主动打包收工避免无意义循环） | §3.6 借鉴 | 2-3d |
| 3 | **轨迹导出工具**（独立脚本 `conversation_log → Hermes/ShareGPT JSONL`，满足企业 IT 的"导出对话审计 / 送研究员"诉求） | §3.7 / §3.8 | 3-5d |

**不建议做**（高工作量低/负 ROI）:

- ❌ **Terminal-only 工具面改造**（§3.3）：与 EvoClaw "5 阶段工具链"（CLAUDE.md）哲学冲突；read/write/edit 专用工具比 `cat/sed` bash 命令更可控、审计链路更清晰
- ❌ **OpenRouter 聚合路由**（§3.4）：EvoClaw 直接对接 provider（含 GLM JWT 等差异认证）更适合企业管控，中间层反而增加审计复杂度
- ❌ **环境工厂（Local/Docker/Modal 三后端）**（§3.2 / §3.13）：企业用户场景 Agent 级全局 Sandbox 已足够；Modal 云端对桌面应用完全无关
- ❌ **CLI 双模式入口**（§3.10）：Tauri UI 是主入口，REST 是次级入口；CLI 分裂运维路径
- ❌ **`MINI_SWE_AGENT_FINAL_OUTPUT` 字符串检测**（§3.6）：stop_reason + 循环熔断对实时对话足够；P2 #2 仅在长任务场景借鉴思路而非照搬
- ❌ **XML 标签轨迹包装**（§3.11）：结构化对象对应用内消费更好；仅在 P2 #3 轨迹导出脚本按需转换

---

## 5. EvoClaw 反超点汇总

**本章无反超点**。

Mini SWE Runner 是 hermes 为 SWE-bench 评测和训练数据生产定制的工具，EvoClaw 作为"企业非技术用户的 AI 伴侣桌面应用"在这个维度**按设计**没有对应能力。零反超不代表"落后"——而是产品定位的自然结果（同 24-batch-runner / 23-rl-environments 章节的判定结论）。

**间接相关的 EvoClaw 优势**（不属于 mini-swe-runner 范畴，但在工具链 / 对话领域反超 hermes，crosslink 见 §6.3）:

| 领域 | EvoClaw 优势 | 所在章节 |
|---|---|---|
| Agent 主循环 | Kernel 三层压缩（Snip/Microcompact/Autocompact）+ 熔断器 3 次失败停止 + StreamingToolExecutor 90s 看门狗 | 05-agent-loop-gap.md |
| 工具系统 | 5 阶段工具注入 + read/write/edit 专用工具 + Bash 双路径安全体系（AST + Legacy 正则降级） | 09-tools-system-gap.md |
| 环境执行 | asyncExec 非阻塞 + SIGTERM/SIGKILL + 大输出持久化 + 图片检测 | 11-environments-spawn-gap.md |
| Trajectory 存储 | conversation_log FTS5 全文检索 + 压缩状态追踪（虽然不产出 ShareGPT） | 17-trajectory-compression-gap.md |
| 上下文压缩 | 三层 Snip/Microcompact/Autocompact 零成本优先 + 熔断器 | 08-context-compression-gap.md |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（本章所有 `path:line` 均经 Read 工具验证 2026-04-17）

- `packages/core/src/agent/embedded-runner.ts:33-60` ✅ `runEmbeddedAgent` 入口签名（无 env_type / output_file / max_iterations 等 mini-swe 参数）
- `packages/core/src/agent/embedded-runner-tools.ts:56-60` ✅ `createEnhancedExecTool` 返回 `{name: 'bash', ...}`（"保持名称为 bash，模型更熟悉"，与 mini-swe terminal 同职能但属于 Kernel 5 阶段工具链）
- `packages/core/src/agent/kernel/builtin-tools.ts:1-50` ✅ 内置工具 read/write/edit/grep/find/ls 六件套（参考 09-tools-system-gap.md）
- `packages/core/src/agent/kernel/query-loop.ts` ✅ Kernel 主循环入口（参考 05-agent-loop-gap.md §3）
- `packages/core/src/agent/kernel/incremental-persister.ts` ✅ 增量持久化到 conversation_log 表（非 JSONL）
- `packages/core/src/server.ts:278` ✅ Sidecar 仅作 HTTP 服务（Liveness 探针注释："零依赖，Docker/K8s 用"）
- `packages/core/src/infrastructure/runtime.ts` ✅ 唯一命中 `.jsonl` 字面词的文件，与运行时检测相关，非 dataset 加载/轨迹导出
- `packages/core/src/infrastructure/async-exec.ts` ✅ bash 工具底层异步执行引擎（AbortController + SIGTERM → 3s grace → SIGKILL）

### 6.1.1 关键 grep 零结果（证明缺失，路径 `packages/core/src/`，2026-04-17）

- `grep -r "mini_swe\|mini-swe\|MiniSWE" packages/core/src/` → **0 结果**
- `grep -r "swebench\|SWE-bench\|SWEBench" packages/core/src/` → **0 结果**
- `grep -r "MINI_SWE_AGENT_FINAL_OUTPUT\|FINAL_OUTPUT" packages/core/src/` → **0 结果**
- `grep -r "TERMINAL_TOOL_DEFINITION\|terminal_tool\|TERMINAL_TOOL" packages/core/src/` → **0 结果**
- `grep -r "LocalEnvironment\|DockerEnvironment\|ModalEnvironment" packages/core/src/` → **0 结果**
- `grep -r "fire\.Fire\|argparse\|commander\|yargs" packages/core/src/` → **0 结果**
- `grep -r "run_task\|run_conversation" packages/core/src/` → **0 结果**
- `grep -r "resolve_provider_client\|auxiliary_client\|openrouter" packages/core/src/` → **0 结果**
- `grep -r "ShareGPT\|sharegpt\|<tool_call>\|<tool_response>" packages/core/src/` → **0 结果**
- `grep -r "createEnvironment\|create_environment" packages/core/src/` → **0 结果**

### 6.2 hermes 研究引用（章节 §）

- `.research/25-mini-swe-runner.md` §1 角色定位 + 架构图（开始 → create_environment → API 循环 → 检测 FINAL_OUTPUT → 转换 Hermes → 保存 JSONL → 清理环境）
- `.research/25-mini-swe-runner.md` §2 MiniSWERunner 类字段（L141-607）+ TERMINAL_TOOL_DEFINITION（L52-94）+ 输出结果结构
- `.research/25-mini-swe-runner.md` §3.1 入口与 CLI（L614-709）
- `.research/25-mini-swe-runner.md` §3.2 环境选择（`create_environment()` L101-134）+ 工厂模式动态导入 local/docker/modal
- `.research/25-mini-swe-runner.md` §3.3 LLM 客户端初始化（L189-212）+ OpenRouter 路由
- `.research/25-mini-swe-runner.md` §3.4 代理执行流程（`run_task()` L398-555）
- `.research/25-mini-swe-runner.md` §3.5 轨迹格式转换（L288-396）+ Hermes `{from, value}` 映射规则
- `.research/25-mini-swe-runner.md` §3.6 批处理流程（L577-605，`f.flush()`）
- `.research/25-mini-swe-runner.md` §4.1 工具调用解析与执行（L483-519）+ `MINI_SWE_AGENT_FINAL_OUTPUT` 检测
- `.research/25-mini-swe-runner.md` §4.2 轨迹格式转换 — tool response（L354-380）+ XML 包装
- `.research/25-mini-swe-runner.md` §4.3 LLM 客户端初始化代码片段（L189-212）
- `.research/25-mini-swe-runner.md` §4.4 批处理流式写入（L577-605）
- `.research/25-mini-swe-runner.md` §5 模块交互（LocalEnvironment / DockerEnvironment / ModalEnvironment / auxiliary_client / batch_runner / trajectory_compressor）
- `.research/25-mini-swe-runner.md` §6 复刻清单 8 项（环境工厂 / LLM 客户端 / 工具定义 / 迭代循环 / 完成信号 / 轨迹转换 / 流式 JSONL / 环境清理）
- `.research/25-mini-swe-runner.md` §7 延伸：完成信号硬编码（L77）/ Token budget（15250 默认） / 环境隔离 / SWE-Bench 兼容性 / 无内置评估

### 6.3 关联差距章节

本章的配套深入见：

- [`23-rl-environments-gap.md`](./23-rl-environments-gap.md) — **同属"研究员训练数据生产"工具链**（RL 环境是 mini-swe 的上游任务源之一），同样判定 🔴 整体缺失 / 产品定位不同 / 不建议补齐
- [`24-batch-runner-gap.md`](./24-batch-runner-gap.md) — **同属"研究员训练数据生产"工具链**（mini_swe_runner 输出可被 batch_runner 消费，hermes `.research/25-mini-swe-runner.md` §5 明确说明），本章的"无 P0 / 产品定位正交"判定与 24 章完全一致
- [`26-rl-cli-gap.md`](./26-rl-cli-gap.md) — **同批次（Phase E 工具链）**，RL CLI 差距分析（另一个研究员向 CLI）
- [`27-cli-architecture-gap.md`](./27-cli-architecture-gap.md) — **同批次**，CLI 架构差距分析（mini-swe 的 fire.Fire CLI 是该章的典型案例之一）
- [`11-environments-spawn-gap.md`](./11-environments-spawn-gap.md) — 执行环境差距分析（mini-swe 的 Local/Docker/Modal 环境工厂 § 3.2，EvoClaw 有 asyncExec / AbortController / SIGTERM/SIGKILL 等反超点但无可替换后端工厂）
- [`05-agent-loop-gap.md`](./05-agent-loop-gap.md) — Kernel `queryLoop` 主循环（本章 §3.5 的对照物，EvoClaw 在三层压缩 / thinking / 错误恢复维度反超，但缺 SWE-task 导向的 `run_task` 入口）
- [`16-trajectory-format-gap.md`](./16-trajectory-format-gap.md) — Hermes / ShareGPT 轨迹格式（本章 §3.7 / §3.11 的核心产出物，EvoClaw 判定 🔴 缺失；P2 #3 轨迹导出工具应基于该章节的分析）
- [`17-trajectory-compression-gap.md`](./17-trajectory-compression-gap.md) — Trajectory 压缩（与本章上下游相关，mini-swe 产出的轨迹是 17 章压缩的输入）
- [`09-tools-system-gap.md`](./09-tools-system-gap.md) — 工具系统（本章 §3.3 的对照物，EvoClaw 5 阶段工具链 vs mini-swe terminal-only 设计哲学差异）
- [`06-llm-providers-gap.md`](./06-llm-providers-gap.md) — LLM Provider 路由（本章 §3.4 的对照物，EvoClaw 直接对接 provider vs mini-swe OpenRouter 聚合）

---

**本章完成**。机制总计 13 个（🔴 10 / 🟡 3 / 🟢 0），综合判定 🔴 **整体缺失 / 产品定位正交 / 不建议补齐**。Mini SWE Runner 是 hermes 为 SWE-bench 评测和训练数据生产定制的轻量级执行器，EvoClaw 作为"企业非技术用户的 AI 伴侣桌面应用"在设计上不覆盖此维度（与 23-rl-environments / 24-batch-runner 同批次产品定位判断一致）。**无 P0 建议项**——§4 仅保留 1 项 P1 可选改造（轻量内部 QA runner，与 24-batch-runner-gap.md P1 #1 同源）+ 2 项 P2 借鉴（主动完成信号约定 / 独立轨迹导出脚本），以及 6 项明确"不建议做"的负面清单。本章核心结论与 24 章一致：**"缺失 ≠ 落后"** 当产品定位本就不需要时，强行补齐会破坏现有的"实时对话 + 长生命周期 Agent + 5 阶段工具链"架构优势。
