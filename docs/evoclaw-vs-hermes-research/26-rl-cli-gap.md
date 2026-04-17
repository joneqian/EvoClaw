# 26 — RL 训练命令行（rl_cli.py）差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/26-rl-cli.md`（197 行，draft / Phase E）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`rl_cli.py` ~446 行 + `~/.hermes/config.yaml` 载入 + `tinker-atropos/` 子模块 + 8 个 RL 工具函数
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16）
> **综合判定**: 🔴 **整体缺失 / 架构定位完全不同 / 不建议补齐**

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes `rl_cli.py`**（`.research/26-rl-cli.md §1`，446 行）— **Hermes Agent 专用的强化学习训练 CLI**。它是 hermes 整个"训练流水线"的人类入口：研究员在终端敲 `python rl_cli.py "Train a model on GSM8k"`，进程内构造一个 `AIAgent`（`run_agent.py`），套上 57 行 RL 专业系统提示（8 步工作流 DISCOVER→INSPECT→CREATE→CONFIGURE→TEST→TRAIN→EVALUATE），启用 `["terminal", "web", "rl"]` 工具集，把 `max_iterations` 从通用 30 拉高到 **200** 以容纳小时级训练，交互式 / 单任务 / `--list-environments` / `--check-server` 四种入口模式。关键配套：`fire.Fire` 自动参数映射 + `~/.hermes/config.yaml` 嵌套 dict 解析 + `tinker-atropos/` 子模块可用性校验 + WandB/OpenRouter/TINKER/HF token 四类环境变量加载。

**EvoClaw CLI 面**（`packages/core/src/`）— **根本没有 CLI 命令树**。EvoClaw 是 Tauri 2.0 桌面 GUI（CLAUDE.md 第一行"自进化 AI 伴侣桌面应用"），Bun Sidecar 被 Tauri Rust 作为**子进程**启动，`packages/core/src/server.ts:1159-1170` 的"主入口"只是判断 `process.argv[1]` 是否以 `server.ts/.cjs/.js/.mjs` 结尾，然后 `main()` 起 Hono HTTP 服务，没有任何 subcommand / flag 解析 / interactive REPL / list-xxx 子命令。package.json（`packages/core/package.json`）的 `dependencies` 不含 commander / yargs / meow / cac / clipanion / ink / arg / mri / minimist / inquirer 任何一个 CLI 框架（见 §6.1 grep 零结果）。

**量级对比**: hermes `rl_cli.py` 单文件 446 行 + YAML 配置协议 + 4 种入口模式 + 57 行 RL 系统提示常量；EvoClaw 对应面**零行**。本章是 23-rl-environments-gap 的"入口侧对偶章"：23 章说"EvoClaw 无训练框架", 本章说"EvoClaw 无训练框架的 CLI 驱动"—— 两者作为"模块"与"入口"关系同进同出。

**架构本质**：
- hermes `rl_cli.py` 服务 **研究员**（一周启动 N 次训练）
- EvoClaw 服务 **终端企业用户**（桌面 GUI 一键启动，CLI 对用户不可见）
- 两者在用户画像和交互形态上完全正交

**本章基本不做补齐建议**：CLAUDE.md 明确定位"面向非程序员企业用户"。RL CLI 的预设用户（研究员 + 懂 WandB / OpenRouter / fire 语法）**不是 EvoClaw 目标人群**。即使未来 EvoClaw 要暴露 CLI，合适的方向是"给 IT 管理员一个诊断 / 配置 CLI"（28-config-system / 30-build-packaging 范畴），而不是"给研究员一个 RL 训练 CLI"。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | `fire.Fire(main)` CLI 入口 | 🔴 | EvoClaw 完全无 CLI 框架；server.ts 只判断 argv[1] 文件名启动 HTTP |
| §3.2 | YAML 配置协议（`~/.hermes/config.yaml`） | 🔴 | EvoClaw 用 JSON（managed.json + config.d/*.json），无 YAML 依赖 |
| §3.3 | RL 系统提示常量（57 行 8 步工作流） | 🔴 | EvoClaw 无 RL-focused system prompt，也不支持 CLI 注入 ephemeral prompt |
| §3.4 | `max_iterations=200` RL 特化 | 🔴 | EvoClaw 默认 maxTurns=50（embedded-runner），无"小时级训练"预算模式 |
| §3.5 | `enabled_toolsets=["terminal", "web", "rl"]` | 🔴 | EvoClaw 无 toolset 组合开关，工具集由 Profile + Channel + MCP + Skill 四路决定 |
| §3.6 | 交互模式（while-loop + `status/quit`） | 🔴 | EvoClaw 无 CLI REPL；对话界面在 React 前端 |
| §3.7 | 单任务模式（`python rl_cli.py "task"`） | 🔴 | EvoClaw 无"CLI 命令行接收单次任务"接口，任务通过 HTTP /chat 或 Channel 入口 |
| §3.8 | `--list-environments` 子命令 | 🔴 | EvoClaw 无"列出可用训练环境"概念（因为根本没 environments/ 目录） |
| §3.9 | `--check-server` / 依赖校验 | 🟡 | EvoClaw 有 `/doctor` 路由做类似事但服务端内嵌，非 CLI 外部 |
| §3.10 | `tinker-atropos/` 子模块检查 | 🔴 | EvoClaw 不依赖 git 子模块，Bundled Skills 用 `fs.cpSync` 预装 |
| §3.11 | 环境变量载入（OPENROUTER/TINKER/WANDB 4 类） | 🔴 | EvoClaw 有 `syncEnvVarsFromConfig` 但面向 Skill/工具运行时，不是 RL 训练 API |
| §3.12 | `save_trajectories=True` 默认开 | 🔴 | EvoClaw `conversation_log` 表永远写，但不是 ShareGPT 训练样本格式 |
| §3.13 | `KeyboardInterrupt` 优雅退出 | 🟡 | EvoClaw 有 graceful-shutdown（SIGTERM/SIGINT + 30s 宽限）但面向 HTTP 服务不是 CLI |
| §3.14 | 30 分钟状态检查间隔（频控） | 🔴 | EvoClaw 无"训练状态检查频率"概念，Heartbeat 间隔面向 agent 存活 |
| §3.15 | Fire 自动参数映射（无需 argparse） | 🔴 | 概念不适用 — EvoClaw 没有需要被映射的 CLI 函数 |

**统计**: 🔴 13 / 🟡 2 / 🟢 0（0 项反超，本章 EvoClaw 无 CLI 实现也无 CLI 定位，§5 反超点**为空**）。

**与 23-rl-environments-gap 对照**：23 章 15 条里 🔴 13 / 🟡 2 / 🟢 0，本章 15 条里 🔴 13 / 🟡 2 / 🟢 0，两章呈现**同构缺失**（入口与模块同时 🔴），符合"模块不在 → 入口也不在"的本质推论。

---

## 3. 机制逐条深度对比

每条同时给出 **hermes 实现**（含 `.research/26-rl-cli.md §N` 章节引用）+ **EvoClaw 实现**（含 `packages/core/src/XX.ts:LN` 引用或 grep 零结果证据）+ **判定与分析**。

### §3.1 `fire.Fire(main)` CLI 入口

**hermes**（`.research/26-rl-cli.md §3.1` L69-74，`rl_cli.py:L235-274`） — Google `fire` 库自动映射：

```python
# rl_cli.py:L235-274
import fire

def main(task=None, model=None, api_key=None,
         max_iterations=200, interactive=False,
         list_environments=False, check_server=False,
         save_trajectories=True):
    ...

fire.Fire(main)  # 函数签名 → CLI flags 自动生成
```

用户可按三种互斥模式调用：
1. `python rl_cli.py "Train a model on GSM8k"` — 单任务
2. `python rl_cli.py --interactive` — 交互
3. `python rl_cli.py --list-environments` / `--check-server` — 工具信息

**EvoClaw** — **无对应 CLI 框架**：

```bash
$ grep -rnE "^import .* from ['\"](commander|yargs|meow|cac|clipanion|ink|arg|mri|minimist)" \
    packages/core/src
# (零结果 — 已验证)

$ cat packages/core/package.json | grep -E "commander|yargs|meow|cac|fire|inquirer"
# (零结果 — 依赖列表只有 @evoclaw/shared / hono / @modelcontextprotocol/sdk / better-sqlite3 / zod / mammoth / xlsx)
```

EvoClaw 的 `server.ts:1159-1170` 唯一用到 `process.argv` 的地方是判断自身是否为入口文件：

```typescript
// packages/core/src/server.ts:1158-1170
const isMainModule =
  process.argv[1]?.endsWith('server.ts') ||
  process.argv[1]?.endsWith('server.cjs') ||
  process.argv[1]?.endsWith('server.js') ||
  process.argv[1]?.endsWith('server.mjs');

if (isMainModule) {
  main().catch((err) => { log.error('启动失败', err); process.exit(1); });
}
```

没有 subcommand dispatch，没有 flag 解析，没有 help 生成。Sidecar 被 Tauri Rust 作为子进程拉起（`apps/desktop/src-tauri/src/sidecar.rs`），所有"用户选项"通过 HTTP `/config` 路由走 JSON，不走 argv。

**判定 🔴 完全缺失 + 架构不需要**：补齐 = 给一个"GUI-first" 产品硬插 CLI 入口 = 目标用户（企业员工）永远用不到 = 纯污染。即便真要暴露 CLI（如 IT 管理员预配置 / 诊断），用 `cac` 或 `commander` 3-5d 工作量，**与 RL 训练毫无关系**。

---

### §3.2 YAML 配置协议（`~/.hermes/config.yaml`）

**hermes**（`.research/26-rl-cli.md §3.1 / §4.1` L69-102）：

```python
# rl_cli.py:L69-102
def load_hermes_config() -> dict:
    config_path = _hermes_home / 'config.yaml'
    config = {"model": DEFAULT_MODEL, "base_url": DEFAULT_BASE_URL}
    if config_path.exists():
        file_config = yaml.safe_load(open(config_path)) or {}
        if isinstance(file_config.get("model"), str):
            config["model"] = file_config["model"]
        elif isinstance(file_config.get("model"), dict):
            config["model"] = file_config["model"].get("default", DEFAULT_MODEL)
    return config
```

**协议细节**：`model` 字段支持标量（`"anthropic/claude-opus-4.5"`）或嵌套 dict（`{default: "...", vision: "...", fast: "..."}`）。依赖 `yaml.safe_load`。

**EvoClaw**（`packages/core/src/infrastructure/config-manager.ts:5-47`）— **全 JSON 协议**：

```typescript
// config-manager.ts:5 注释
 *   managed.json → config.d/*.json（字母序）→ 用户配置
 * enforced 机制: managed.json 中的 enforced 路径强制使用 managed 的值
// L40
const MANAGED_FILENAME = 'managed.json';
```

```bash
$ grep -rn "yaml\|yamljs\|js-yaml" packages/core/package.json
# (零结果 — 无 YAML 依赖)
```

EvoClaw 走**三层 JSON 合并**：`managed.json`（IT 管理员）→ `config.d/*.json`（drop-in 片段）→ 用户配置（最高优先级），`enforced` 标记字段强制使用管理员值（见 CLAUDE.md "多层配置合并"段）。`denylist` 始终并集。`saveToDisk` 只写用户层。

**判定 🔴 协议完全不同**：
- hermes YAML 面向**研究员**（YAML 可读性好，注释方便）
- EvoClaw JSON 面向**IT 管理员**（JSON Schema 验证 + Zod safeParse 兼容，结构化强，程序化写入方便）
- 补齐 = 重新引入 YAML 依赖 + 解析器 + Zod→YAML 转换 = 零产品价值。JSON 路径更适合桌面应用 / 企业分发场景。
- **不是反超也不是落后，只是取向不同**（但因为本章是"RL CLI 专用 YAML 协议"，结论仍是 🔴 缺失，EvoClaw 不会加）

---

### §3.3 RL 系统提示常量（57 行 8 步工作流）

**hermes**（`.research/26-rl-cli.md §3.2` L113-170）— 57 行 `RL_SYSTEM_PROMPT` 常量，作为 `ephemeral_system_prompt` 注入 AIAgent：

```python
# rl_cli.py:L113-170（节选）
RL_SYSTEM_PROMPT = """
You are an RL Training Specialist for the Hermes project.
Your workflow:
1. DISCOVER — list available environments (rl_list_environments)
2. INSPECT  — read the environment file
3. CREATE   — if needed, create a new BaseEnv subclass
4. CONFIGURE — set training config (model, lr, batch_size)
5. TEST     — run one rollout to verify reward signal works
6. TRAIN    — launch training (rl_start_training)
7. EVALUATE — track wandb metrics (reward/mean, percent_correct)
8. ITERATE  — adjust based on metrics

Key constraints:
- Status check interval: 30 minutes (don't spam rl_check_status)
- Environment files location: tinker-atropos/tinker_atropos/environments/*.py
- WandB metrics to watch: reward/mean, percent_correct
"""
```

专门给 Agent 注入"我正在做 RL 训练"的上下文，让 LLM 在选工具 / 判断继续与否时偏向训练语义（比如不要每 5s 查 wandb）。

**EvoClaw** — **无 RL-focused system prompt**：

```bash
$ grep -rn "RL_SYSTEM_PROMPT\|RL_MAX_ITERATIONS\|RL_TOOLSETS\|training specialist" \
    packages/core/src
# (零结果 — 已验证)
```

EvoClaw 的系统提示架构（CLAUDE.md "关键架构模式"段"模块化系统提示"）：**安全宪法 + 记忆召回指令 + 运行时信息 + 工具使用指导 + 技能扫描**（22 段式）。完全面向**企业用户办公对话**：记忆召回 / 多渠道消息 / 技能驱动，没有任何"RL training"/ "wandb metrics"/ "BaseEnv subclass"语义。

**判定 🔴 完全缺失 + 概念不适用**：
- hermes 系统提示 = 给 Agent 注入"训练员 persona"
- EvoClaw 系统提示 = 给 Agent 注入"企业助理 persona"（Soul / Identity / Memory 一体）
- 两者是**互斥角色定位**。补齐意义 = 给桌面 AI 伴侣突然长一条"你要训练模型"的人格分裂指令，**反向污染**。

---

### §3.4 `max_iterations=200` RL 特化预算

**hermes**（`.research/26-rl-cli.md §2 / §3.3` L61/105-109）：

```python
# rl_cli.py:L105-109
RL_MAX_ITERATIONS = 200      # 通用 AIAgent 默认 ~30
RL_TOOLSETS = ["terminal", "web", "rl"]

# L369-379
agent = AIAgent(
    base_url=base_url, api_key=api_key, model=model,
    max_iterations=RL_MAX_ITERATIONS,  # 200
    enabled_toolsets=RL_TOOLSETS,
    ephemeral_system_prompt=RL_SYSTEM_PROMPT,
    save_trajectories=save_trajectories,
)
```

语义：RL 训练一次完整 session 会运行小时级，需要 200 次 LLM 迭代（每次启动 wandb 读取、pytest 检查、代码改动循环）。**专门为训练场景调高**。

**EvoClaw**（`packages/core/src/agent/agent-types.ts:38-84` + `embedded-runner-attempt.ts:322`）：

```typescript
// agent-types.ts
maxTurns: 10,  // 默认
maxTurns: 5,   // 子代理
maxTurns: 15,  // 深度推理

// embedded-runner-attempt.ts:322
maxTurns: 50,  // 内嵌 runner 主路径默认
```

**无"RL 小时级预算"档位**。最高值 50（主 session）也只是日常对话上限。EvoClaw 场景一次对话典型 2-10 turns（用户问一次 → agent 调几个工具 → 回复 → 等下条消息）。

**判定 🔴 预算量级差 4×**：
- hermes 200 turns = 小时级自动化训练循环
- EvoClaw 50 turns = 人类交互上限保护
- 即便把 EvoClaw 默认改到 200，没有对应的 RL 训练工具 / 长耗时任务设计（见 §3.5），只是数字虚标。补齐无意义。

---

### §3.5 `enabled_toolsets=["terminal", "web", "rl"]`

**hermes**（`.research/26-rl-cli.md §2` L50-51 / §3.3）— 工具集组合开关：

| toolset | 内容 |
|---|---|
| `terminal` | bash / file I/O / pytest |
| `web` | search / fetch |
| `rl` | 8 个 RL 函数：`rl_list_environments` / `rl_start_training` / `rl_check_status` / ... |

`run_agent.AIAgent` 根据 `enabled_toolsets` 参数 opt-in 注册对应工具。**RL CLI 永远开三个全集**，通用 CLI 按需启用。

**EvoClaw** — **无 toolset 组合开关**：

```bash
$ grep -rn "enabled_toolsets\|toolset\|toolsets.*rl" packages/core/src
# (零结果 — 已验证，EvoClaw 没有 toolset 这一抽象层)
```

EvoClaw 工具注入是**5 阶段确定性管线**（CLAUDE.md "5 阶段工具注入"）：
1. Kernel builtin tools（read/write/edit/grep/find/ls）
2. Enhanced bash
3. EvoClaw-specific（web_search / web_fetch / image / pdf / apply_patch）
4. Channel tools（飞书/企微/微信特定）
5. MCP + Skills

每阶段根据 Agent profile / Channel / MCP 配置**全量注入**，没有"我要 `rl` toolset"这样的组合开关。最接近的是 `filterToolsByProfile`（见 20-acp-adapter-gap §3.7），但也是按 profile 白名单过滤，不是语义 toolset 分类。

**判定 🔴 概念不对等**：
- hermes toolset = 研究员选择器（"这次训练用 web 吗？"）
- EvoClaw 5 阶段 = 平台注入（确定性，不让用户选）
- 补齐 = 引入新的工具分类维度（toolset）+ CLI 暴露 = 把企业产品的"开箱即用"变成"你得挑 4 个 toolset"= 反用户。

---

### §3.6 交互模式（while-loop + `status/quit`）

**hermes**（`.research/26-rl-cli.md §3.4` L381-425）：

```python
while True:
    user_input = input("🎯 RL Task> ")
    if user_input.lower() in ('quit', 'exit', 'q'): break
    if user_input.lower() == 'status':
        # 调用 rl_list_runs() 显示活跃训练
        continue
    response = agent.run_conversation(user_input)
    print(response)
```

CLI REPL 语义：研究员在同一 terminal 会话里反复问问题 / 查训练状态 / 继续上一轮。

**EvoClaw** — **无 CLI REPL**：

```bash
$ grep -rn "readline\|inquirer\|@inquirer/prompts\|prompts.*import\|process.stdin.resume" \
    packages/core/src
# (零结果 — 已验证，EvoClaw 没有终端交互循环)
```

EvoClaw 的"交互"有三处：
1. **React 前端**（`apps/desktop/src/` — 非本研究范围）
2. **HTTP /chat SSE 流**（`packages/core/src/routes/chat.ts`）
3. **Channel IM 长连接**（微信 / 飞书 / 企微）

没有 `process.stdin.on('line', ...)` 那样的 terminal REPL。Sidecar 作为 Hono HTTP 服务永远后台运行。

**判定 🔴 完全缺失 + 架构不需要**：EvoClaw 的"REPL"等价物已经是前端聊天框。补齐 CLI REPL = 复制一遍前端功能到 terminal = 冗余，非企业用户需求。

---

### §3.7 单任务模式（`python rl_cli.py "task"`）

**hermes**（`.research/26-rl-cli.md §3.5` L427-442）：

```python
# 非交互：单次 agent.run_conversation(task) 执行
response = agent.run_conversation(task)
print(response)
# 支持 KeyboardInterrupt 优雅退出
```

研究员把训练任务当成 shell one-liner 提交，脚本跑完输出结果退出。适合自动化 pipeline（nohup / cron / GitHub Actions）。

**EvoClaw** — **无"CLI 单次任务"接口**：

```bash
$ grep -rn "process.argv\[2\]\|argv.slice\|parseArgs" packages/core/src
# (零结果，除了 server.ts 判断自身入口文件名)
```

EvoClaw 提交任务的三种正规路径：
1. `POST /chat` HTTP + Bearer token
2. Channel 消息（用户在微信 / 飞书发）
3. Cron / Heartbeat 定时触发（`packages/core/src/scheduler/cron-runner.ts`）

CLI 单任务 = 需要新写一个 `cli.ts` 文件调用 `queryLoop`，但 `queryLoop` 需要完整 LoopConfig（`query-loop.ts:340`）:tools, messages, model, abortSignal, sessionKey 等——这些目前全部由 `embedded-runner-*.ts` + `chat.ts` HTTP 路由组装，没有 CLI 版。

**判定 🔴 完全缺失 + 工作量大**：补齐需要：(1) CLI 框架 0.5d；(2) `queryLoop` CLI 适配层 1.5d；(3) 参数解析 + 模型选择 + session key 伪造 1d。**约 3d**。但目标用户（非程序员）不会用，ROI 为零。

---

### §3.8 `--list-environments` 子命令

**hermes**（`.research/26-rl-cli.md §3.6 / §4.3` L310-342）：

```python
# rl_cli.py:L310-342
if list_environments:
    data = list_environments_sync()
    envs = data.get("environments", [])
    for env in envs:
        print(f"  📦 {env['name']}")
        print(f"     Class: {env['class_name']}")
        print(f"     Path: {env['file_path']}")
    print(f"📊 Total: {len(envs)} environments")
```

扫描 `tinker-atropos/tinker_atropos/environments/*.py`，枚举 BaseEnv 子类作为可用训练环境。

**EvoClaw** — **概念不存在**（因为 EvoClaw 根本没 environments/，见 23-rl-environments-gap §3.12-§3.13）：

```bash
$ grep -rn "listEnvironments\|list_environments\|rl_list_environments" packages/core/src
# (零结果)

$ find /Users/mac/src/github/jone_qian/EvoClaw -type d \
    \( -name "environments" -o -name "tinker-atropos" \) \
    -not -path "*/node_modules/*"
# (零结果)
```

EvoClaw 最接近"列出可用资源"的操作是 HTTP API：
- `GET /agents`（列 Agent）
- `GET /skill`（列技能，参见 `routes/skill.ts`）
- `GET /provider`（列 Provider）

都是 HTTP JSON 返回，不是 CLI print。

**判定 🔴 完全缺失 + 不适用**：即便补 CLI，列什么呢？EvoClaw 的"可训练环境"概念零。这条是 23 章 §3.12 的直接对偶。

---

### §3.9 `--check-server` / 依赖校验

**hermes**（`.research/26-rl-cli.md §3.6 / §4.2` L202-216）：

```python
# rl_cli.py:L202-216
def check_tinker_atropos():
    tinker_path = Path(__file__).parent / "tinker-atropos"
    if not tinker_path.exists():
        return False, "tinker-atropos submodule not found"
    envs_path = tinker_path / "tinker_atropos" / "environments"
    env_files = [f for f in envs_path.glob("*.py") if not f.name.startswith("_")]
    return True, {"path": str(tinker_path), "environments_count": len(env_files)}
```

+ `--check-server` 校验 atroposlib server 可达性（`rl_cli.py:L202+`）。研究员在跑训练前先做 pre-flight check。

**EvoClaw**（`packages/core/src/routes/doctor.ts`）— **有自诊断但不是 CLI 路径**：

```typescript
// server.ts:377
app.route('/doctor', createDoctorRoutes(store, configManager, laneQueue, memoryMonitor));
```

`/doctor` 路由检查 db / config / agents / MCP / lane queue 等子系统状态，供前端 / 管理员调用。此外还有：
- `/health`（server.ts:263）— 无需认证的配置状态
- `/healthz`（server.ts:279）— liveness 探针
- `/readyz`（server.ts:282）— readiness 探针（检查 db+config+agents）

**判定 🟡 形态差异（概念有对应）**：
- hermes `--check-server` = **CLI 外部命令**，pre-flight 校验
- EvoClaw `/doctor` / `/readyz` = **HTTP 内部路由**，运行时校验
- 覆盖场景相同（诊断依赖），语义差异在"谁调用"：hermes 是 shell 用户手敲，EvoClaw 是桌面 GUI 或 K8s 探针
- EvoClaw 形态更适合桌面 / 容器场景，但不提供"我想在 terminal 检查 sidecar 是否健康"的体验
- 改造成本低（1-2d 加一个 `evoclaw-ctl doctor` 命令行），但非本章 RL 场景

---

### §3.10 `tinker-atropos/` 子模块检查

**hermes**（`.research/26-rl-cli.md §3.6 / §6 L178` + `.research/26-rl-cli.md §7 "atroposlib 来源"`）：

```python
# check_tinker_atropos（见 §3.9）校验 git 子模块存在
# 另外 atroposlib 从 GitHub 安装：
# pip install 'atroposlib @ git+https://github.com/NousResearch/atropos.git'
# pip install 'tinker @ git+https://github.com/thinking-machines-lab/tinker.git'
```

依赖管理形态：git submodule（代码） + pip git+https（Python 包）。

**EvoClaw** — **完全不同的依赖形态**：

```bash
$ grep -rn "submodule\|git\+https\|tinker" packages/core/package.json .gitmodules 2>/dev/null
# (零结果 — 无 git submodule)

$ ls /Users/mac/src/github/jone_qian/EvoClaw/.gitmodules 2>/dev/null
# (文件不存在)
```

EvoClaw 的"资源分发"走：
- **Bundled Skills**（`server.ts:541-598` `seedBundledSkills()`）— `fs.cpSync(srcBundled, targetDir, {recursive: true})` 首次启动预装到 `~/.evoclaw/skills/`
- **Extension Packs**（`packages/core/src/extension-pack/` + `routes/extension-pack-routes.ts`）— `evoclaw-pack.json manifest + ZIP` 企业扩展包
- **MCP servers**（`packages/core/src/mcp/`）— 运行时 `addServer(config)` 通过 stdio / http 挂载
- **npm 依赖**（`package.json`）— 通过 pnpm / npm registry

**判定 🔴 完全不同的分发哲学**：
- hermes git submodule 绑定特定 commit 适合研究固化（复现性）
- EvoClaw 分层分发适合产品演进（Bundled 内置 / Extension 扩展 / MCP 外部）
- 不需要补 submodule。但本章仍标 🔴 因为 hermes 这一机制无对应实现。

---

### §3.11 环境变量载入（OPENROUTER/TINKER/WANDB 4 类）

**hermes**（`.research/26-rl-cli.md §5 / §6 L186` + `hermes_cli/env_loader.py`）：

| 环境变量 | 用途 |
|---|---|
| `OPENROUTER_API_KEY` | 默认 LLM provider |
| `TINKER_API_KEY` | tinker inference server |
| `WANDB_API_KEY` | 训练指标上报 |
| `HF_TOKEN`（隐含） | HuggingFace 模型 / 数据集下载 |

`rl_cli.py` 启动时调用 `hermes_cli/env_loader.py` 从 `.env` 文件载入。

**EvoClaw**（`packages/core/src/server.ts:482-538` `syncEnvVarsFromConfig`）— 有环境变量同步**但面向不同场景**：

```typescript
// server.ts:482-538（节选）
function syncEnvVarsFromConfig(configManager: ConfigManager): void {
  // 新格式: envVars
  if (config.envVars) {
    for (const [key, value] of Object.entries(config.envVars)) {
      if (value) { process.env[key] = value; count++; }
    }
  }
  // 自动同步 LLM provider API Key
  const providerEnvMap: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GOOGLE_API_KEY',
    // ... + deepseek / minimax / kimi / qwen / glm
  };
  // ...把 config 里的 apiKey 自动注入 process.env
}
```

**关键差异**：
- EvoClaw env vars 服务 **Skill 运行时**（bundled Skills 可能要读 `BRAVE_API_KEY` 做 web search）+ **Provider 调用**（ModelRouter 从 process.env 取 LLM key）
- hermes env vars 服务 **RL 训练基础设施**（WandB 指标 / Tinker inference / OpenRouter quota）
- EvoClaw 不同步 `WANDB_API_KEY` / `TINKER_API_KEY`，因为不做训练

**判定 🔴 目标不同**：同名机制（"读 env var"）但服务完全不同层次。hermes 是训练基础设施 keys，EvoClaw 是 agent 工具 keys。本章 hermes 侧的四个 key 在 EvoClaw 一个都不需要。

---

### §3.12 `save_trajectories=True` 默认开

**hermes**（`.research/26-rl-cli.md §2 L52 + §3.3`）— CLI 参数默认 True，把 RL trajectory 保存为 ShareGPT JSONL（见 23-rl-environments-gap §3.15 / 16-trajectory-format-gap）。训练流水线下游消费。

**EvoClaw**（`packages/core/src/memory/conversation-logger.ts:3-10`）— `conversation_log` 表**永远写**：

```typescript
export type LogEntryType =
  | 'message'              // 普通对话消息
  | 'compaction_boundary'  // Autocompact/Snip/Microcompact 压缩边界
  | 'memory_saved'         // 记忆保存事件
  | 'agent_spawned'        // 子代理启动
  | 'agent_completed'      // 子代理完成
  | 'error_snapshot';      // 错误快照
```

```bash
$ grep -rn "save_trajectories\|saveTrajectories\|save.*trajectory\|trajectory.*jsonl" \
    packages/core/src
# (零结果 — EvoClaw 无 ShareGPT 训练样本导出)
```

**关键差异**：
- hermes `save_trajectories` = CLI flag 可选择不存 + 存的是训练样本格式
- EvoClaw `conversation_log` = 数据库表永远存 + 存的是推理历史格式（推理回放 / 记忆提取 / 6 种事件类型）
- 同名词（"trajectory"）含义不同：见 23-rl-environments-gap §3.15 / 16-trajectory-format-gap

**判定 🔴 概念重名但语义与用途不同**：补齐 ShareGPT 导出是 23-rl-environments-gap §4 P2 提过的方向（2-3 人日工作量），**不属于本章**（本章是 CLI flag 层，不是数据格式层）。

---

### §3.13 `KeyboardInterrupt` 优雅退出

**hermes**（`.research/26-rl-cli.md §3.5` L427-442）：

```python
try:
    response = agent.run_conversation(task)
except KeyboardInterrupt:
    print("\n🛑 Training interrupted by user. Cleaning up...")
    # 清理逻辑
```

CLI 场景：研究员 Ctrl+C 中断，程序捕获 → 清理子进程 / flush wandb → 退出。

**EvoClaw**（`packages/core/src/infrastructure/graceful-shutdown.ts` + `server.ts:889-906`）— 有完善的**服务级优雅关闭**但触发与语义不同：

```typescript
// server.ts:892-904
registerShutdownHandler({ name: '调度器', priority: 10, handler: () => { ... }});
registerShutdownHandler({ name: '渠道', priority: 20, handler: () => { ... }});
registerShutdownHandler({ name: 'MCP', priority: 30, handler: () => ... });
registerShutdownHandler({ name: '数据库', priority: 80, handler: () => { db.close(); }});
registerShutdownHandler({ name: '日志', priority: 99, handler: () => { closeLogger(); }});
installShutdownHandlers();
```

**语义**：SIGTERM/SIGINT → 按优先级串行执行 handler → 30s 宽限期超时强制退出（CLAUDE.md "优雅关闭"段）。

**判定 🟡 形态差异（EvoClaw 更完善）**：
- hermes `KeyboardInterrupt` = **CLI Python try/except** 一处处理
- EvoClaw `registerShutdownHandler` = **注册式多阶段优雅关闭**（调度器→渠道→MCP→DB→日志，5 级优先级，30s 总预算）
- EvoClaw 的形态**比 hermes 更工程化**（多资源按序清理 + 硬超时保护），但面向 HTTP 服务不是 CLI
- 本章 🟡 因为"优雅退出"概念有对应，但不是 CLI 形态，且 EvoClaw 实现更接近 SRE 产品栈要求
- 注：此条不算"反超"入 §5，因为比较不对等（CLI vs 服务）

---

### §3.14 30 分钟状态检查间隔（频控）

**hermes**（`.research/26-rl-cli.md §3.2 / §7 "30 分钟间隔强制"`）：

```python
# tools/rl_training_tool.py (rl_cli 下游依赖)
MIN_STATUS_CHECK_INTERVAL = 30 * 60  # 30 分钟
# rl_check_status() 中强制执行，防止 Agent 过于频繁查看训练进度
```

RL 训练 **小时级**，一分钟查一次 wandb 没意义还花 API 调用。强制 30 分钟间隔作为系统级频控。

**EvoClaw** — **无"训练状态检查频控"概念**：

```bash
$ grep -rn "MIN_STATUS_CHECK_INTERVAL\|status.*interval.*30\|rl_check_status" packages/core/src
# (零结果)
```

EvoClaw 有几个**间隔相关概念**但语义完全不同：
- **Heartbeat 间隔**（`scheduler/heartbeat-manager.ts`）— Agent 存活心跳（默认数分钟，配置驱动）
- **DecayScheduler**（`memory/decay-scheduler.ts`）— 记忆热度衰减，7 天半衰期
- **Cron 间隔**（`scheduler/cron-runner.ts`）— 用户配置的定时任务

都是"产品侧主动触发"频率，不是"Agent 查第三方训练 API 的频控"。

**判定 🔴 概念不存在**：因为 EvoClaw 没有"正在训练的 wandb run"这种外部长耗时任务，自然也不需要限频。补齐无意义。

---

### §3.15 Fire 自动参数映射（无需 argparse）

**hermes**（`.research/26-rl-cli.md §3.1`）— `fire.Fire(main)` 通过反射把函数签名（参数名 + 默认值 + 注解）映射成 CLI：

```python
def main(task=None, model=None, max_iterations=200, ...): ...
fire.Fire(main)

# 自动生成:
# python rl_cli.py --task "..." --model "..." --max-iterations 300
```

Python 生态特性（Google fire 库）。省去手写 argparse 模板代码。

**EvoClaw** — **概念不适用**：

没有 CLI 入口函数需要被映射（见 §3.1）。即便未来补 CLI，TypeScript 生态等价物是 `@commander-js/extra-typings` 或 `cac` 的 schema 推断，不是 fire 语义。

**判定 🔴 概念不适用 + 生态不同**：Python Fire 的"零模板 CLI"模式优雅，但 TS 生态的 `cac` + TypeScript 类型推断其实能做到类似效果。若哪天 EvoClaw 要补 CLI（IT 诊断场景），`cac` 更合适。

---

## 4. 建议改造蓝图（不承诺实施）

### 为什么不建议 EvoClaw 实现 `rl_cli.py`

1. **目标用户完全错位**：CLAUDE.md 明确"面向非程序员企业用户"。RL CLI 的预设用户（研究员 + 懂 fire / wandb / OpenRouter / YAML 语法）**不是 EvoClaw 目标人群**。在桌面 GUI 产品里塞一个研究员 CLI = 把产品从"桌面 AI 伴侣"错位成"ML 研究工具"。
2. **依赖链式崩坏**：补 RL CLI 等于必须先补 23-rl-environments（`environments/`, 7577 行 / 5-8 人周）+ tinker-atropos 子模块 + atroposlib pip 包 + WandB 集成。本章 446 行只是**冰山一角**。
3. **架构语言切换**：hermes 整个训练栈是 Python（`rl_cli.py` / `atroposlib` / `tinker` 都是 Python）。EvoClaw Sidecar 是 TypeScript/Bun。补 CLI 要么在 TS 里重写整个 Python 训练栈（不可能），要么在 EvoClaw 里内嵌 Python 进程（污染 Bun 运行时 + 复杂度爆炸）。
4. **ROI 完全为负**：企业用户永远不会用 `evoclaw-rl-train "Train a model on GSM8k"`。

### 如果未来真要让 EvoClaw 暴露 CLI（非 RL 方向）

**P2（唯一有意义的方向）**：**面向 IT 管理员的诊断 / 配置 CLI**（与 RL 无关，只是"EvoClaw 暴露 CLI"这个更广议题的合理子集）：

| # | 项目 | 对应 §3 | 工作量 | 价值 |
|---|---|---|---|---|
| 1 | `evoclaw-ctl doctor` | §3.9（Doctor CLI 化） | 1-2d | SRE / IT 管理员排查 sidecar 健康 |
| 2 | `evoclaw-ctl config` | §3.2（JSON 配置读写 CLI） | 1-2d | 无 GUI 环境下改 managed.json |
| 3 | `evoclaw-ctl memory export` | §3.12（对话历史导出） | 2-3d | 企业审计 / 迁移 / 23 章 §4 P2 数据导出方向 |
| 4 | `evoclaw-ctl cron list/run` | §3.6（Cron 管理 CLI） | 1d | 运维调试定时任务 |

**工作量**：约 5-8 人日，**都属于"企业运维工具"**，与 RL 训练毫无关系。建议走 `cac` + TypeScript 类型推断，不走 fire / yargs 这类 JS 传统框架。

**何时做**：**Sprint 18+ 视客户反馈而定**。如果企业客户反馈"我司没有 GUI 终端（远程服务器），需要 CLI"，再做；否则不主动做。

### 明确不建议做

- 🚫 `fire.Fire(main)` Python CLI 直接迁移 — 生态不同，生搬硬套
- 🚫 `RL_SYSTEM_PROMPT` 57 行 8 步工作流 — EvoClaw 人格体系已完整（Soul/Identity/Memory）
- 🚫 `max_iterations=200` 特化档位 — 桌面产品不需要小时级训练循环
- 🚫 `--list-environments` / `--check-server` RL 语义子命令 — 对应的 environments/ 根本不存在（见 23-rl-environments-gap）
- 🚫 `~/.hermes/config.yaml` YAML 协议 — EvoClaw JSON 栈更适合桌面 / 企业分发
- 🚫 `KeyboardInterrupt` CLI 优雅退出 — EvoClaw `graceful-shutdown` 服务级更完善
- 🚫 30 分钟状态检查频控 — 没有对应的训练长任务
- 🚫 `tinker-atropos/` git 子模块 — EvoClaw 用 Bundled Skills / Extension Pack 分发

---

## 5. EvoClaw 反超点汇总

**本章无反超点**。

EvoClaw 在"RL 训练 CLI"维度**既无对应实现，也无对应定位**。与 23-rl-environments-gap §5 对偶——两章同时 🟢 0，符合"训练轨道 vs 产品轨道"正交关系。

**非反超但值得说明的侧链能力**（与 RL CLI 无关，只是避免被误读成"EvoClaw 没 CLI 就是全面落后"）：

| # | EvoClaw 能力 | 为什么不是本章反超 |
|---|---|---|
| 1 | `registerShutdownHandler` 多阶段优雅关闭（`server.ts:892-906`） | 服务级而非 CLI 级，不对等 |
| 2 | `/doctor` + `/healthz` + `/readyz` 三层探针（`server.ts:263-290 + 377`） | HTTP 路由而非 CLI 子命令 |
| 3 | `syncEnvVarsFromConfig` 三路 env 注入（`server.ts:482-538`） | Sidecar 内部机制，非 CLI 载入 |
| 4 | `seedBundledSkills` 首次启动预装（`server.ts:541-598`） | fs.cpSync 分发，非 git submodule |
| 5 | `ConfigManager` 三层 JSON 合并 + enforced（`config-manager.ts:5-47`） | 分发协议不同（JSON vs YAML），非能力反超 |

这 5 项在"EvoClaw 运维 / 管理能力"维度比 hermes RL CLI 的单文件方案更工程化，但如果非要和"RL CLI 这个功能"比较，它们**不解决 RL CLI 解决的问题**（启动 RL 训练 / 枚举环境 / 监控 wandb），所以不能算反超。

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样与零结果验证（2026-04-16）

**组件存在性验证**（已通过 Read 工具确认）：

- `packages/core/src/server.ts:1158-1170` ✅ 唯一 `process.argv` 使用，仅判断入口文件名
- `packages/core/src/server.ts:263-290` ✅ `/health` / `/healthz` / `/readyz` 三层 HTTP 探针
- `packages/core/src/server.ts:377` ✅ `/doctor` 路由挂载
- `packages/core/src/server.ts:482-538` ✅ `syncEnvVarsFromConfig` 三路环境变量注入
- `packages/core/src/server.ts:541-598` ✅ `seedBundledSkills` 首次启动预装
- `packages/core/src/server.ts:892-906` ✅ `registerShutdownHandler` 5 级优雅关闭注册
- `packages/core/src/infrastructure/config-manager.ts:5-47` ✅ 三层 JSON 配置合并 + enforced
- `packages/core/src/agent/agent-types.ts:38-84` ✅ maxTurns 默认值 10/5/15
- `packages/core/src/agent/embedded-runner-attempt.ts:322` ✅ 内嵌 runner maxTurns=50
- `packages/core/src/memory/conversation-logger.ts:3-10` ✅ `LogEntryType` 6 种事件（非 ShareGPT 格式）
- `packages/core/package.json` ✅ dependencies 无任何 CLI 框架

**RL CLI 相关零结果验证**（本章的核心证据）：

```bash
$ grep -rnE "^import .* from ['\"](commander|yargs|meow|cac|clipanion|ink|arg|mri|minimist)" \
    packages/core/src
# (零结果 — 已验证，EvoClaw 无任何 CLI 框架 import)

$ grep -rn "rl.cli\|rl_cli\|train.*cli\|rollout.*cli\|evaluate.*cli" packages/core/src
# (零结果 — 已验证)

$ grep -rn "RL_SYSTEM_PROMPT\|RL_MAX_ITERATIONS\|RL_TOOLSETS\|tinker.atropos\|rl_start_training\|rl_check_status" \
    /Users/mac/src/github/jone_qian/EvoClaw
# (零结果 — 已验证)

$ grep -rn "rollout\|reinforcement\|PPO\|GRPO\|ScoredDataGroup\|trajectory_sample\|wandb\|atropos\|tinker" \
    packages/core/src
# (零结果 — 已验证，sop-doc-parser 中的 "SUPPORTED_EXTENSIONS" 是 'support' 词根误匹配，非 RL 概念)

$ grep -rn "yaml\|yamljs\|js-yaml" packages/core/package.json
# (零结果 — EvoClaw 无 YAML 依赖)

$ grep -rn "readline\|inquirer\|@inquirer/prompts\|process.stdin.resume" packages/core/src
# (零结果 — 无 CLI REPL)

$ grep -rn "listEnvironments\|list_environments\|rl_list_environments\|check_server\|--check-server" \
    packages/core/src
# (零结果 — 无列出训练环境 / 校验训练服务器接口)

$ grep -rn "save_trajectories\|saveTrajectories\|trajectory.*jsonl\|ShareGPT" packages/core/src
# (零结果 — 无 ShareGPT 训练样本导出)

$ grep -rn "MIN_STATUS_CHECK_INTERVAL" packages/core/src
# (零结果 — 无 30 分钟状态检查频控)

$ find /Users/mac/src/github/jone_qian/EvoClaw -type d \
    \( -name "environments" -o -name "tinker-atropos" -o -name "atroposlib" \) \
    -not -path "*/node_modules/*"
# (零结果 — 无训练子模块目录)

$ ls /Users/mac/src/github/jone_qian/EvoClaw/.gitmodules 2>/dev/null
# (文件不存在 — 无 git submodule)
```

**结论**：EvoClaw 源码**完全无 RL CLI 实现 + 完全无 CLI 框架 + 完全无 YAML 协议**，确认本章 🔴 整体缺失判定。

### 6.2 hermes 研究引用（章节 §）

- `.research/26-rl-cli.md §1` 角色与定位（L9-35）
- `.research/26-rl-cli.md §2` 数据结构 / CLI 参数 / 配置结构 / RL 常量（L40-64）
- `.research/26-rl-cli.md §3.1` 入口 `fire.Fire(main)` 三种互斥模式（L69-74）
- `.research/26-rl-cli.md §3.2` RL 系统提示 57 行 8 步工作流（L76-82）
- `.research/26-rl-cli.md §3.3` Agent 创建 `max_iterations=200` + `RL_TOOLSETS`（L84-94）
- `.research/26-rl-cli.md §3.4` 交互模式 while-loop + status/quit（L96-105）
- `.research/26-rl-cli.md §3.5` 非交互单次 run_conversation + KeyboardInterrupt（L107-109）
- `.research/26-rl-cli.md §3.6` Tinker-Atropos 子模块检查（L111-114）
- `.research/26-rl-cli.md §4.1` 配置加载代码片段（L119-133）
- `.research/26-rl-cli.md §4.2` tinker-atropos 检查代码片段（L135-146）
- `.research/26-rl-cli.md §4.3` list-environments 代码片段（L148-160）
- `.research/26-rl-cli.md §5` 模块交互（AIAgent / rl_training_tool / tinker-atropos / config.yaml / .env）（L164-174）
- `.research/26-rl-cli.md §6` 复刻清单 8 项（L177-187）
- `.research/26-rl-cli.md §7` 延伸阅读 / 30 分钟间隔 / atroposlib 来源 / tinker 来源 / WandB 集成（L189-197）

### 6.3 关联差距章节（Crosslink）

本章作为"RL 训练 CLI 整体缺失"类分析，与以下章节密切相关：

- **`23-rl-environments-gap.md`** — RL 训练环境：本章的**模块对偶章**。23 章分析"EvoClaw 无 `environments/` 训练框架"，本章分析"EvoClaw 无 `rl_cli.py` 训练 CLI"。两章呈现同构缺失（🔴 13/🟡 2/🟢 0 vs 🔴 13/🟡 2/🟢 0），共同印证"训练轨道 vs 产品轨道"的正交关系。23 章 §4 P2 "数据导出"方向（ShareGPT JSONL + memory_feedback + PII 脱敏）在本章 §3.12 有所触及。
- **`24-batch-runner-gap.md`**（同批次 Wave 2-8）— Batch 运行器：hermes batch runner 是 RL CLI 的"非交互批量版"，同样是训练流水线工具。EvoClaw 无 batch runner 也无 RL CLI，两者同属训练侧缺失。
- **`25-mini-swe-runner-gap.md`**（同批次 Wave 3）— Mini SWE runner：hermes 面向 SWE-bench 的最小化 runner CLI，与 RL CLI 共享"Python CLI + fire + 单任务/列出/检查"骨架。EvoClaw 无对应。
- **`27-cli-architecture-gap.md`**（同批次 Wave 3）— CLI 架构：hermes 整体 CLI 架构分析。RL CLI 是其专用子集，本章已说明 EvoClaw 的"GUI-first"架构决定了整体 CLI 面的缺失。27 章会从全局视角汇总（含 `run_agent.py` / `rl_cli.py` / `acp_server.py` / gateway CLI 等各种入口）。
- **`05-agent-loop-gap.md`** — Agent 主循环：本章 §3.4 的 maxTurns 档位引用 05 章的 `queryLoop` 默认值。hermes `rl_cli.py` 构造的 AIAgent 内部循环仍是 05 章分析的 `run_conversation`，本章 CLI 入口层不重复 05 章循环细节。
- **`28-config-system-gap.md`**（待写）— 配置系统：本章 §3.2 YAML vs JSON 协议差异在 28 章会有更详细的"完整配置协议"对比。本章 RL CLI 视角只看 `~/.hermes/config.yaml` 的 model 字段，28 章会看全栈。
- **`20-acp-adapter-gap.md`** — ACP 适配器：本章 §3.5 工具集组合语义 hermes `enabled_toolsets` vs EvoClaw 5 阶段工具注入，20 章 §3.7 `filterToolsByProfile` 有详细分析。

**全局定位**：

- hermes `rl_cli.py` = "**训练研究员入口**"（给懂 RL 的人一个方便的 Python shell）
- EvoClaw Sidecar = "**桌面产品后端**"（给企业非程序员一个零 CLI 的 GUI）
- 两者在用户画像（研究员 vs 企业员工）、交互形态（terminal REPL vs 桌面聊天）、分发方式（git submodule vs Bundled/Extension Pack）三个维度**全面正交**
- 本章不建议补齐。唯一有意义的长期 CLI 方向是 §4 P2 "IT 管理员诊断 CLI"（与 RL 无关），工作量约 5-8 人日，视客户反馈决定是否 Sprint 18+ 提上日程

---

**本章完成**。核心结论：

- 🔴 `rl_cli.py` 446 行对应 EvoClaw **零行**，且 EvoClaw 根本无任何 CLI 框架（commander/yargs/meow/cac 全部零结果）
- 🔴 15 个机制中 13 个完全缺失，2 个（§3.9 Doctor / §3.13 优雅退出）在 EvoClaw 有服务级对应但不是 CLI 形态
- 🟢 无反超点（本章和 23-rl-environments-gap 同构，都是"产品轨道不做训练轨道的事"）
- **不建议补齐**：目标用户错位、依赖链级联（需先补 23 章 7577 行）、语言栈不同（Python vs TS）、ROI 为零
- **唯一可能方向**：P2 IT 管理员 CLI（与 RL 无关，约 5-8 人日）。RL CLI 本身保持不做
