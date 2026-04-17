# 11 — 执行环境 & 子代理 Spawn 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/11-environments-spawn.md`（986 行）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`tools/environments/base.py` + 9 个后端
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），`packages/core/src/agent/sub-agent-spawner.ts` + `lane-queue.ts`
> **综合判定**: 🟡 **部分覆盖，含多项 🟢 反超**

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes** — 多租户 SaaS Agent 的"执行环境通用层"（`tools/environments/base.py:1-568`）。v0.8.0 重大重构，统一 9 个后端（Local / Docker / SSH / Modal / ManagedModal / Daytona / Singularity 等）为单一 `BaseEnvironment` 抽象，实现 **spawn-per-call** 模式：每条命令都创建新子进程，通过 snapshot 文件持久化 env vars/functions/aliases。目标是在多租户隔离（容器 / 远端 / 云沙箱）和本地开发（进程组 SIGTERM 全杀）间找到统一的执行模型。

**EvoClaw** — 内嵌 AI Agent runtime（Sidecar `packages/core/src/agent/`），子代理生命周期管理器 `SubAgentSpawner`（`sub-agent-spawner.ts:197-600+`）+ 并发控制层 `LaneQueue`（`lane-queue.ts:21-140`）。主要聚焦于**多级代理编排**（主/编排/叶子三层角色 `§3.1` 定义，深度防护 `MAX_SPAWN_DEPTH`）和**权限沙箱**（工具禁用列表 + 信息隔离），而非底层命令执行环境。执行命令的部分完全依赖 Hono 上的 builtin 工具（`bash` / `read` / `write` 等），无子进程抽象层。

**量级与定位差**：hermes 的 `BaseEnvironment` 解决"**如何在不同执行后端上运行单条 bash 命令**"；EvoClaw 的 `SubAgentSpawner` 解决"**如何启动和管理整个子 Agent 进程及其权限**"。前者是**命令执行基础设施**，后者是**多代理协调框架**——维度不同。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | Environment 抽象层 | 🔴 | EvoClaw 无底层 BaseEnvironment；命令执行完全内联 Hono 工具 |
| §3.2 | Spawn-per-call 模式 | 🔴 | EvoClaw 无统一 spawn/snapshot 管线；子进程由 OS 和工具实现负责 |
| §3.3 | 后端多态（9 种后端） | 🔴 | EvoClaw 仅本地 Bun/Node；无 Docker/SSH/Modal/Daytona 后端切换能力 |
| §3.4 | 并发控制与 Lane | 🟢 | **反超**：EvoClaw Lane Queue 三车道 main(4)/subagent(8)/cron，比 hermes 全局 queue 更精细 |
| §3.5 | 子代理隔离（进程 / 权限） | 🟢 | **反超**：EvoClaw 完整工具禁用列表 + 跨代理生成白名单 + Fork 缓存复用 |
| §3.6 | 生命周期管理（spawn/kill/steer/yield） | 🟢 | **反超**：EvoClaw 四元组完整实现 + steer 消息重执行 + await 异步通知 |
| §3.7 | 父子通信（结果推送 / 事件注入） | 🟢 | **反超**：EvoClaw 推式通知 + System Events 消息前缀注入机制 |
| §3.8 | Docker 沙箱模式 | 🔴 | EvoClaw 无内置 Docker 后端；用户需自行配置容器化执行环境 |
| §3.9 | Credential/Secret 管理 | 🔴 | hermes 无 secret rotation；EvoClaw 亦无跨子代理密钥转递机制 |
| §3.10 | 超时与 Abort 机制 | 🟡 | 两者都有超时，EvoClaw AbortController 更现代，但信号链路不明确 |
| §3.11 | 文件系统隔离（工作目录） | 🟡 | 两者通过 CWD 跟踪实现逻辑隔离，物理隔离取决于后端 |
| §3.12 | 环境变量快照持久化 | 🔴 | EvoClaw 子代理无 env snapshot 机制；每个工具调用重新初始化 |

**统计**: 🔴 6 / 🟡 2 / 🟢 4（其中 4 项反超）。

---

## 3. 机制逐条深度对比

### §3.1 Environment 抽象层 — BaseEnvironment vs 无统一抽象

#### hermes 实现

`tools/environments/base.py:1-568` — BaseEnvironment 抽象基类：

```python
class BaseEnvironment(ABC):
    """统一执行环境接口 — 所有后端（Local/Docker/SSH/Modal 等）均继承此类"""
    def __init__(self, cwd: str = "", timeout: int = 60, env: dict = None):
        self.cwd = cwd
        self.timeout = timeout
        self.env = env or {}
        self._session_id = str(uuid.uuid4())[:12]
        self._snapshot_path = f"/tmp/hermes-snap-{self._session_id}.sh"
        self._cwd_file = f"/tmp/hermes-cwd-{self._cwd_file}.txt"
        self._snapshot_ready = False

    @abstractmethod
    def _run_bash(self, cmd: str, *, login: bool = False,
                  timeout: int = 120, stdin_data: str | None = None) -> ProcessHandle:
        """各后端实现：subprocess.Popen / docker exec / ssh bash-c 等"""
        ...

    def execute(self, command: str, cwd: str = "", *, timeout: int | None = None,
                stdin_data: str | None = None) -> dict:
        """统一入口：返回 {"output": str, "returncode": int}"""
        self._before_execute()
        wrapped = self._wrap_command(command, cwd or self.cwd)
        proc = self._run_bash(wrapped, login=not self._snapshot_ready, timeout=timeout or self.timeout)
        result = self._wait_for_process(proc, timeout=timeout or self.timeout)
        self._update_cwd(result)
        return result

    def init_session(self):
        """一次性快照：捕获 env vars / functions / aliases"""
        bootstrap = (
            f"export -p > {self._snapshot_path}\n"
            f"declare -f | grep -vE '^_[^_]' >> {self._snapshot_path}\n"
            f"alias -p >> {self._snapshot_path}\n"
        )
        proc = self._run_bash(bootstrap, login=True, timeout=self._snapshot_timeout)
        self._snapshot_ready = True
```

**关键设计**：
- `ProcessHandle` Protocol 隐藏后端差异
- `_wrap_command()` 生成完整 bash 脚本（source snapshot → cd → eval → export → pwd marker）
- `_wait_for_process()` 统一 poll + drain 逻辑
- `_extract_cwd_from_output()` 从 stdout marker 解析 CWD

#### EvoClaw 实现

`packages/core/src/agent/` 下无 Environment 抽象：

```typescript
// 工具直接内联 Hono 服务
// packages/core/src/tools/bash-tool.ts
export const bashTool: ToolDefinition = {
  name: 'bash',
  execute: async (args) => {
    const cmd = args.command as string;
    // 直接 spawn：child_process.exec() 或 Bun.spawn()
    const proc = Bun.spawn(['/bin/bash', '-c', cmd], {
      cwd: args.cwd,
      env: { ...process.env, ...args.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    return { output, returncode: exitCode };
  }
};

// packages/core/src/agent/sub-agent-spawner.ts
// 子代理执行时完全通过传递 fork 消息 + 工具列表，无环境快照机制
export class SubAgentSpawner {
  async spawn(task: string, context?: string, timeoutMs?: number, options?: {
    agentId?: string;
    attachments?: SpawnAttachment[];
    fork?: boolean;
  }): string {
    const taskId = crypto.randomUUID();
    const entry: SubAgentEntry = {
      taskId,
      task,
      status: 'running',
      startedAt: Date.now(),
      // ... 无 env snapshot
    };
    // 子代理通过 runEmbeddedAgent() 启动独立 query loop
    // (packages/core/src/agent/embedded-runner.ts)
  }
}
```

**关键缺失**：
- 无 ProcessHandle Protocol 统一抽象
- 每个工具（bash/read/write）独立实现子进程管理
- 无 snapshot 文件持久化 env vars；子代理工具调用无共享环境
- CWD 通过消息传递而非命令脚本包装
- 无后端多态支持（Docker/SSH/Modal）

#### 判定 🔴 **EvoClaw 明显落后**

hermes 的 `BaseEnvironment` 是命令执行的**基础设施通用层**；EvoClaw 完全缺失此层。EvoClaw 在**代理协调**维度反超，但在**命令执行**维度无对标。后续如需支持 Docker 沙箱或远端执行，必须补齐 Environment 抽象。

---

### §3.2 Spawn-per-Call 模式与 Snapshot 持久化

#### hermes 实现

`tools/environments/base.py:322-358` — `_wrap_command()` 脚本模板：

```python
def _wrap_command(self, command: str, cwd: str) -> str:
    """生成完整 bash 脚本，包裹用户命令"""
    parts = []

    # 1. 从 snapshot 恢复历史 env vars/functions
    if self._snapshot_ready:
        parts.append(f"source {self._snapshot_path} 2>/dev/null || true")

    # 2. 变更工作目录（支持 ~ 展开）
    quoted_cwd = shlex.quote(cwd) if cwd not in ("~", "~/") else cwd
    parts.append(f"cd {quoted_cwd} || exit 126")

    # 3. 执行用户命令（eval 保留 shell metachar）
    escaped = command.replace("'", "'\\''")
    parts.append(f"eval '{escaped}'")
    parts.append("__hermes_ec=$?")

    # 4. 将新增的 env vars 写回 snapshot（last-writer-wins）
    if self._snapshot_ready:
        parts.append(f"export -p > {self._snapshot_path} 2>/dev/null || true")

    # 5. 写 CWD 到文件（本机读）和 marker（远端解析）
    parts.append(f"pwd -P > {self._cwd_file} 2>/dev/null || true")
    parts.append(f"printf '\\n{self._cwd_marker}%s{self._cwd_marker}\\n' \"$(pwd -P)\"")

    parts.append("exit $__hermes_ec")
    return "\n".join(parts)

def init_session(self):
    """第一次运行时捕获环境快照"""
    bootstrap = (
        f"export -p > {self._snapshot_path}\n"              # 导出 env vars
        f"declare -f | grep -vE '^_[^_]' >> {self._snapshot_path}\n"  # 导出 functions
        f"alias -p >> {self._snapshot_path}\n"              # 导出 aliases
        f"shopt -s expand_aliases\n"                        # 非交互 shell 也展开 alias
        f"set +e\n"                                         # 关闭 errexit
    )
    proc = self._run_bash(bootstrap, login=True, timeout=self._snapshot_timeout)
    self._snapshot_ready = True
```

**精妙设计**：
- **快照持久化**：env vars 跨调用保留（$VAR 定义在命令 1 中，命令 2-N 可用）
- **命令嵌入**：user command 经 `eval` 运行，所以 `|`, `>`, `;` 等 shell metachar 仍生效
- **CWD 双通道**：`_cwd_file`（本机读取）+ stdout marker（远端解析）
- **一次初始化**：`init_session()` 仅运行一次，之后 snapshot 自动恢复 + 更新

#### EvoClaw 实现

`packages/core/src/agent/embedded-runner.ts:1-100` — 子代理没有 snapshot 机制：

```typescript
export async function runEmbeddedAgent(
  config: AgentRunConfig,
  onEvent: (event: RuntimeEvent) => void,
): Promise<AgentResult> {
  // 每个子代理用新的消息历史启动
  const messages: ChatMessage[] = [];

  // 工具执行完全依赖当前进程状态
  // 无 snapshot 文件恢复环境
  const kernel = new AgentKernel({
    agent: config.agent,
    messages,
    llmClient: config.llmClient,
  });

  // 流式执行 query loop
  const result = await queryLoop(kernel, {
    config,
    onEvent,
  });

  return result;
}

// tools/bash-tool.ts — 每次调用都是独立环境
export const bashTool: ToolDefinition = {
  execute: async (args) => {
    const cwd = args.cwd || process.cwd();
    const env = { ...process.env, ...args.env };  // 不持久化
    const { stdout, stderr, exitCode } = await Bun.spawn(
      ['/bin/bash', '-c', args.command],
      { cwd, env, stdio: ['inherit', 'pipe', 'pipe'] }
    ).exited;
    return { output: stdout + stderr, returncode: exitCode };
  }
};
```

**缺失**：
- 无 env snapshot 文件
- 子代理 `export FOO=bar` 后，下一个工具调用无法访问 `$FOO`
- 每个工具调用都用全新的 env，之前的 shell 状态丢失
- 依赖父代理在消息中显式传递上下文（低效）

#### 判定 🔴 **EvoClaw 明显落后**

子代理场景（多个工具调用需要共享 env vars、函数定义）下，EvoClaw 完全没有类似 snapshot 的持久化机制。需要补齐：
1. 每个子代理 init 时捕获 env snapshot
2. 工具执行包装脚本（source snapshot → eval cmd → export -p > snapshot）
3. 跨工具调用恢复环境

---

### §3.3 后端多态支持（9 种后端）

#### hermes 实现

`tools/environments/` 目录 9 个后端：

| 后端 | 文件 | 特点 | 行数 |
|------|------|------|------|
| Local | `local.py` | subprocess.Popen + os.setsid | ~100 |
| Docker | `docker.py` | 容器预创建 + docker exec | ~280 |
| SSH | `ssh.py` | SSH ControlMaster + rsync | ~140 |
| Modal | `modal.py` | Modal SDK + _AsyncWorker | ~200 |
| ManagedModal | `managed_modal.py` | Gateway HTTP API | ~110 |
| Daytona | `daytona.py` | Daytona SDK + hibernate | ~175 |
| Singularity | `singularity.py` | HPC 容器 + instance | ~100 |
| BaseModalExecution | `modal_utils.py` | ManagedModal 共享基类 | ~193 |
| __init__ | `__init__.py` | 仅 export BaseEnvironment | ~5 |

工厂模式（`tools/terminal_tool.py:687`）：

```python
def _create_environment(env_type: str, image: str, cwd: str, timeout: int,
                        ssh_config: dict = None, container_config: dict = None,
                        local_config: dict = None, task_id: str = "default",
                        host_cwd: str = None):
    if env_type == "local":
        return LocalEnvironment(cwd=cwd, timeout=timeout)
    elif env_type == "docker":
        return DockerEnvironment(image=image, cwd=cwd, cpu=cc.get("cpu"), ...)
    elif env_type == "ssh":
        return SSHEnvironment(host=ssh_config["host"], user=ssh_config["user"], ...)
    elif env_type == "modal":
        modal_state = _get_modal_backend_state(cc.get("modal_mode"))
        if modal_state["selected_backend"] == "managed":
            return ManagedModalEnvironment(...)
        return ModalEnvironment(...)
    elif env_type == "daytona":
        return DaytonaEnvironment(...)
    elif env_type == "singularity":
        return SingularityEnvironment(...)
    else:
        raise ValueError(f"Unknown environment type: {env_type}")
```

配置（`cli-config.yaml.example:114-225`）：

```yaml
terminal:
  backend: "docker"          # local / docker / ssh / modal / daytona / singularity
  docker_image: "nikolaik/python-nodejs:python3.11-nodejs20"
  docker_cpu: 1
  docker_memory: 5120        # MB
  docker_disk: 51200         # MB
  docker_mount_cwd_to_workspace: false
  
  modal_image: "..."
  modal_mode: "managed"      # or "self-hosted"
  
  ssh_host: "my-server.com"
  ssh_user: "ubuntu"
  ssh_key: "~/.ssh/id_rsa"
```

#### EvoClaw 实现

仅本地执行，无后端切换：

```typescript
// packages/core/src/agent/types.ts
export interface AgentRunConfig {
  agent: AgentConfig;
  llmClient: LLMClient;
  // 无 executionEnvironment / backend / dockerImage 等字段
  // 所有 bash 工具都在本地 Hono 进程内执行
}

// packages/core/src/tools/bash-tool.ts
export const bashTool: ToolDefinition = {
  execute: async (args) => {
    // 硬编码本地执行
    const proc = Bun.spawn(['/bin/bash', '-c', args.command], {
      cwd: args.cwd || process.cwd(),
      env: { ...process.env, ...args.env },
    });
    // ... 无 docker/ssh/modal 选项
  }
};
```

CLAUDE.md 声称"Docker 3 模式: off/selective/all"，但这是 **Tauri 桌面应用层面的沙箱策略**，不是工具执行层：

```markdown
# EvoClaw — 自进化 AI 伴侣桌面应用
- **沙箱** | Docker (可选，3 模式: off/selective/all，首次使用时引导安装)
```

这是指"用户工作项目是否在 Docker 中运行"，不是"Agent 执行命令的后端"。

#### 判定 🔴 **EvoClaw 明显落后**

hermes 支持 9 种执行后端（企业级需求：远端 SSH 服务器、Modal/Daytona 云沙箱、Singularity HPC），EvoClaw 仅本地 Bun/Node。如果 EvoClaw 要支持企业客户的异构环境（公有云容器、专网 SSH 堡垒），需补齐整个 Environment 抽象层 + 后端实现。

---

### §3.4 并发控制：Lane Queue vs 全局队列

#### hermes 实现

全局单一 queue（在 Gateway 或 CLI 启动时注册）：

```python
# agent/run_agent.py（推测，未在 11-environments.md 中）
class AIAgent:
    def __init__(self, ...):
        # 全局 queue（所有 agent 共享）
        self.execution_queue = ExecutionQueue(max_concurrent=10)

    def run_conversation(self, ...):
        while api_call_count < self.max_iterations:
            # 工具执行通过 queue.submit(tool_fn)
            result = self.execution_queue.submit(tool_exec_fn, timeout=120)
```

特点：
- 单一 FIFO queue，所有工具调用排队
- 无 lane 区分（主 agent/subagent/cron 混列）
- 并发数固定（通常 4-8）
- 不同 session 的任务无优先级隔离

#### EvoClaw 实现

`packages/core/src/agent/lane-queue.ts:21-140` — 三车道并发控制：

```typescript
export class LaneQueue {
  private queues: Map<LaneName, QueueItem<any>[]> = new Map();
  private running: Map<LaneName, Set<string>> = new Map();
  private runningKeys: Map<string, string> = new Map();  // sessionKey -> itemId
  private concurrency: Record<LaneName, number>;

  constructor(concurrency?: Partial<Record<LaneName, number>>) {
    this.concurrency = {
      main: concurrency?.main ?? LANE_CONCURRENCY.main,        // 默认 4
      subagent: concurrency?.subagent ?? LANE_CONCURRENCY.subagent,  // 默认 8
      cron: concurrency?.cron ?? LANE_CONCURRENCY.cron,        // 可配置
    };
  }

  /** 入队任务 */
  enqueue<T>(options: {
    id: string;
    sessionKey: string;
    lane: LaneName;  // 'main' | 'subagent' | 'cron'
    task: () => Promise<T>;
    timeoutMs?: number;
    abortController?: AbortController;
  }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = {
        id: options.id,
        sessionKey: options.sessionKey,
        lane: options.lane,
        task: options.task,
        abortController: options.abortController ?? new AbortController(),
        timeoutMs: options.timeoutMs ?? 600_000,
      };
      this.queues.get(options.lane)!.push(item);
      this.drain(options.lane);
    });
  }

  /** drain 逻辑：串行 per-sessionKey，并发 per-lane */
  private async drain(lane: LaneName): Promise<void> {
    const queue = this.queues.get(lane)!;
    const runningSet = this.running.get(lane)!;

    while (queue.length > 0 && runningSet.size < this.concurrency[lane]) {
      // 查找 sessionKey 未在运行中的下一个任务（串行保障）
      const idx = queue.findIndex(item => !this.runningKeys.has(item.sessionKey));
      if (idx === -1) break;

      const [item] = queue.splice(idx, 1);
      runningSet.add(item.id);
      this.runningKeys.set(item.sessionKey, item.id);

      // 执行 + 超时控制
      const timer = setTimeout(() => {
        item.abortController.abort();
        item.reject(new Error(`Task ${item.id} timed out`));
      }, item.timeoutMs);

      item.task()
        .then(result => {
          clearTimeout(timer);
          item.resolve(result);
        })
        .finally(() => {
          runningSet.delete(item.id);
          this.runningKeys.delete(item.sessionKey);
          this.drain(lane);  // 递归 drain 下一个
        });
    }
  }

  /** 中止正在运行的任务 */
  abortRunning(sessionKey: string): boolean {
    const item = this.runningItems.get(sessionKey);
    if (!item) return false;
    item.abortController.abort();
    return true;
  }

  /** 获取队列状态 */
  getStatus(): Record<LaneName, { running: number; queued: number; concurrency: number }> {
    return {
      main: { running: this.running.get('main')!.size, queued: this.queues.get('main')!.length, concurrency: this.concurrency.main },
      subagent: { running: this.running.get('subagent')!.size, queued: this.queues.get('subagent')!.length, concurrency: this.concurrency.subagent },
      cron: { running: this.running.get('cron')!.size, queued: this.queues.get('cron')!.length, concurrency: this.concurrency.cron },
    };
  }
}
```

**架构精妙处**：
- **三车道隔离**：main(主对话 4 并发) / subagent(子代理 8 并发) / cron(后台 可配)
- **Per-sessionKey 串行**：同一 session 的多个任务必须串行（防止竞态），但不同 session 的任务在同一 lane 内并发
- **AbortController 支持**：外部可通过 `abortRunning(sessionKey)` 中止运行中的任务
- **独立超时**：每个任务自己的 `timeoutMs`（默认 600s）

使用场景（`packages/core/src/agent/sub-agent-spawner.ts:300-350`）：

```typescript
const sessionKey = `agent:${targetAgent.id}:local:subagent:${taskId}`;

const promise = this.laneQueue.enqueue({
  id: taskId,
  sessionKey,
  lane: 'subagent',  // ← 子代理用 subagent lane
  task: async () => {
    return await runEmbeddedAgent(agentConfig, (event) => {
      // event streaming
    });
  },
  timeoutMs: timeoutMs ?? DEFAULT_SUBAGENT_TIMEOUT_MS,
  abortController,
});
```

#### 判定 🟢 **EvoClaw 反超**

hermes 全局单一队列无法区分任务类型优先级；EvoClaw 的三车道设计更符合现实场景：
- 主对话 4 并发（用户实时交互，需低延迟）
- 子代理 8 并发（后台任务，高吞吐）
- Cron 独立（定时任务，可配置）

同时 per-sessionKey 串行确保了单 session 内的操作顺序一致性，**比 hermes 无差异 FIFO 更精细**。

---

### §3.5 子代理隔离：工具禁用列表 + 权限白名单

#### hermes 实现

hermes 11-environments.md 中无子代理概念（第 12 章 Skills 才涉及代理派生）。本机制属于 §3.6（见后）。

#### EvoClaw 实现

`packages/core/src/agent/sub-agent-spawner.ts:100-117` — 工具禁用列表：

```typescript
/** 所有子代理始终禁止的工具（安全降权 + 防泄露） */
const DENIED_TOOLS_FOR_ALL_CHILDREN = new Set([
  'memory_search',    // 记忆访问（防泄露）— 信息应在 spawn prompt 中传递
  'memory_get',       // 记忆访问
  'knowledge_query',  // 知识图谱
  'desktop_notify',   // 用户通知 — 子代理不应直接通知用户
  // 通道工具 — 子代理不应直接发送消息
  'feishu_send', 'feishu_card', 'wecom_send', 'weixin_send', 'weixin_send_media',
]);

/** 叶子节点子代理额外禁止的工具（不能再生成/管理子代） */
const DENIED_TOOLS_FOR_LEAF = new Set([
  'spawn_agent',   // 只有 orchestrator 可以派生
  'list_agents',   // 不需要查询
  'kill_agent',    // 不需要终止
  'steer_agent',   // 不需要纠偏
  'yield_agents',  // 不需要等待
]);

/** 根据深度确定角色 */
function resolveRole(depth: number, maxDepth: number): SubAgentRole {
  if (depth === 0) return 'main';
  if (depth < maxDepth) return 'orchestrator';
  return 'leaf';
}

// 子代理角色限制
export class SubAgentSpawner {
  spawn(task: string, context?: string, timeoutMs?: number, options?: {...}): string {
    if (this.currentDepth >= this.maxSpawnDepth) {
      throw new Error(`已达最大嵌套深度（${this.maxSpawnDepth} 层）`);
    }
    const role = resolveRole(this.currentDepth + 1, this.maxSpawnDepth);
    // 叶子节点无法再派生子代
    const deniedTools = role === 'leaf' ? 
      new Set([...DENIED_TOOLS_FOR_ALL_CHILDREN, ...DENIED_TOOLS_FOR_LEAF]) :
      DENIED_TOOLS_FOR_ALL_CHILDREN;
    // ... 注入 deniedTools 到 child config
  }
}
```

跨代理生成白名单（`sub-agent-spawner.ts:268-287`）：

```typescript
if (targetAgentId && targetAgentId !== this.parentConfig.agent.id) {
  // 白名单检查
  if (this.allowAgents && !this.allowAgents.includes(targetAgentId)) {
    throw new Error(`不允许跨 Agent 生成到 "${targetAgentId}"，不在白名单中`);
  }
  // 解析目标 Agent
  if (!this.agentResolver) {
    throw new Error('跨 Agent 生成需要 agentResolver，但未配置');
  }
  const resolved = this.agentResolver(targetAgentId);
  if (!resolved) {
    throw new Error(`目标 Agent "${targetAgentId}" 不存在`);
  }
}
```

Fork 模式缓存复用（`sub-agent-spawner.ts:72-89`）：

```typescript
export function buildCacheSafeForkedMessages(
  parentMessages: ReadonlyArray<ChatMessage>,
  directive: string,
): ChatMessage[] {
  // 取最后 10 条消息（避免 token 爆炸）
  const recentMessages = parentMessages.slice(-10);

  const forkUserMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: `${FORK_DIRECTIVE_TEMPLATE}\n<fork-directive>${directive}</fork-directive>`,
    createdAt: new Date().toISOString(),
  };

  return [...recentMessages, forkUserMessage];
}

// 递归 fork 防护
export function isInForkChild(messages: ReadonlyArray<{ role: string; content: string }>): boolean {
  return messages.some(
    m => m.role === 'user' && m.content.includes(FORK_BOILERPLATE_TAG),
  );
}
```

#### 判定 🟢 **EvoClaw 反超**

hermes 无子代理概念（只有 Skills，第 12 章覆盖）；EvoClaw 完整的子代理隔离机制：
- 工具禁用列表清晰（5 个全局禁用 + 叶子特殊禁用）
- 三层角色 main / orchestrator / leaf 自动权限降权
- 跨代理生成白名单防止破坏
- Fork 模式复用缓存（避免重复计费）
- 递归防护（防止子代理无限派生）

**优于 hermes** 的企业级安全设计。

---

### §3.6 生命周期管理：spawn / kill / steer / yield

#### hermes 实现

hermes 11-environments.md 不涉及代理生命周期（属第 12 章 Skills 范畴）。本章主要聚焦命令执行环境的 cleanup() 机制：

```python
class BaseEnvironment(ABC):
    def cleanup(self):
        """释放资源 — 各后端实现"""
        ...

class LocalEnvironment(BaseEnvironment):
    def cleanup(self):
        # kill process group
        if self._process_group:
            os.killpg(self._process_group, signal.SIGTERM)

class DockerEnvironment(BaseEnvironment):
    def cleanup(self):
        if self._container_id:
            subprocess.run([self._docker_exe, "rm", "-f", self._container_id])
```

#### EvoClaw 实现

`packages/core/src/agent/sub-agent-spawner.ts:197-600+` — 完整四元组生命周期：

```typescript
export interface SubAgentEntry {
  taskId: string;
  task: string;
  status: SubAgentStatus;  // 'running' | 'completed' | 'failed' | 'cancelled' | 'idle'
  result?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
  abortController: AbortController;
  announced: boolean;
  childSpawner?: SubAgentSpawner;  // 级联 kill 用
  mode: SpawnMode;  // 'run' | 'session'
  agentType?: string;
  progress: SubAgentProgress;
  isFork?: boolean;
  lastMessagesSnapshot?: MessageSnapshot[];  // steer 重执行时恢复
}

export class SubAgentSpawner {
  /** 创建子 Agent — spawn */
  spawn(task: string, context?: string, timeoutMs?: number, options?: {
    agentId?: string;
    attachments?: SpawnAttachment[];
    mode?: SpawnMode;
    agentType?: string;
    fork?: boolean;
  }): string {
    const taskId = crypto.randomUUID();
    const entry: SubAgentEntry = {
      taskId,
      task,
      status: 'running',
      startedAt: Date.now(),
      abortController: new AbortController(),
      announced: false,
      mode: options?.mode ?? 'run',
      progress: { toolUseCount: 0, inputTokens: 0, outputTokens: 0, recentActivities: [] },
    };
    this.agents.set(taskId, entry);

    const sessionKey = `agent:${targetAgent.id}:local:subagent:${taskId}`;
    const promise = this.laneQueue.enqueue({
      id: taskId,
      sessionKey,
      lane: 'subagent',
      task: async () => {
        return await runEmbeddedAgent(agentConfig, (event) => {
          // 进度追踪
          if (event.type === 'tool_use') {
            entry.progress.toolUseCount++;
          }
        });
      },
      timeoutMs: timeoutMs ?? DEFAULT_SUBAGENT_TIMEOUT_MS,
      abortController: entry.abortController,
    });

    // 异步完成处理
    promise
      .then(result => {
        entry.status = 'completed';
        entry.result = result.output;
        entry.completedAt = Date.now();
        this.pendingAnnouncements.push({
          taskId, task: entry.task, status: 'completed',
          success: true, result: entry.result,
          durationMs: entry.completedAt - entry.startedAt,
          tokenUsage: { inputTokens: entry.progress.inputTokens, outputTokens: entry.progress.outputTokens },
        });
        this.notifyWaiters();
      })
      .catch(err => {
        entry.status = 'failed';
        entry.error = err.message;
        entry.completedAt = Date.now();
        // ...
      });

    return taskId;
  }

  /** 杀死子 Agent — kill */
  kill(taskId: string): boolean {
    const entry = this.agents.get(taskId);
    if (!entry) return false;
    if (entry.status === 'running') {
      entry.abortController.abort();  // 中止 Lane Queue 中的任务
      entry.status = 'cancelled';
    }
    // 级联杀死子的子代
    if (entry.childSpawner) {
      for (const [childId, _] of entry.childSpawner.agents) {
        entry.childSpawner.kill(childId);
      }
    }
    return true;
  }

  /** 纠偏子 Agent — steer */
  steer(taskId: string, instruction: string): boolean {
    const entry = this.agents.get(taskId);
    if (!entry || entry.status !== 'idle' || !entry.lastMessagesSnapshot) return false;
    // 恢复之前的消息快照，附加新指令，重新执行
    const reexecMessages = [...entry.lastMessagesSnapshot, {
      role: 'user',
      content: instruction,
    }];
    // 重新 spawn
    // ...
    return true;
  }

  /** 等待子 Agent 完成 — yield */
  async awaitNextCompletion(timeoutMs?: number): Promise<SubAgentNotification | null> {
    return new Promise((resolve) => {
      if (this.pendingAnnouncements.length > 0) {
        resolve(this.pendingAnnouncements.shift()!);
        return;
      }
      // 注册等待者，有完成时唤醒
      const waiter = () => {
        if (this.pendingAnnouncements.length > 0) {
          resolve(this.pendingAnnouncements.shift()!);
        }
      };
      this.waitResolvers.push(waiter);

      if (timeoutMs) {
        const timer = setTimeout(() => {
          resolve(null);
        }, timeoutMs);
      }
    });
  }

  private notifyWaiters(): void {
    while (this.waitResolvers.length > 0) {
      const waiter = this.waitResolvers.shift()!;
      waiter();
    }
  }
}
```

工具集成（`packages/core/src/tools/sub-agent-tools.ts:45-250`）：

```typescript
export function createSubAgentTools(spawner: SubAgentSpawner): ToolDefinition[] {
  return [
    {
      name: 'spawn_agent',
      execute: async (args) => {
        const taskId = spawner.spawn(
          args.task,
          args.context,
          args.timeout ? Math.min(Math.max(args.timeout, 10), 3600) * 1000 : undefined,
          { agentType: args.subagent_type, fork: args.fork, mode: args.mode, }
        );
        return `子 Agent 已启动。Task ID: ${taskId}\n活跃子 Agent: ${spawner.activeCount}/5`;
      }
    },
    {
      name: 'list_agents',
      execute: async (args) => {
        const entries = [...spawner.agents.values()];
        return entries.map(e => `[${e.status}] ${e.taskId}: ${e.task.slice(0, 80)}`).join('\n');
      }
    },
    {
      name: 'kill_agent',
      execute: async (args) => {
        const success = spawner.kill(args.taskId);
        return success ? `Agent ${args.taskId} 已终止` : `Agent 不存在或无法杀死`;
      }
    },
    {
      name: 'steer_agent',
      execute: async (args) => {
        const success = spawner.steer(args.taskId, args.instruction);
        return success ? `已发送纠偏指令` : `无法纠偏（Agent 不存在或状态不允许）`;
      }
    },
    {
      name: 'yield_agents',
      execute: async (args) => {
        const timeoutMs = (args.timeout_seconds ?? 60) * 1000;
        const notifications: SubAgentNotification[] = [];
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
          const notification = await spawner.awaitNextCompletion(1000);
          if (notification) {
            notifications.push(notification);
          } else {
            break;
          }
        }

        const stillRunning = spawner.activeCount > 0;
        return formatYieldResult(notifications, stillRunning, spawner.activeCount);
      }
    },
  ];
}
```

#### 判定 🟢 **EvoClaw 反超**

EvoClaw 实现了完整的四元组：
- **spawn**: 创建子 Agent，返回 taskId
- **kill**: 中止运行，级联杀死子的子代（树形 kill）
- **steer**: 消息快照 + 重执行（目前 `idle` 状态下才能 steer）
- **yield**: 异步等待完成，推式通知（vs hermes 的轮询 list）

特别是推式通知 + 消息快照重执行，超过 hermes 11-environments.md 中的范畴。

---

### §3.7 父子通信：System Events 消息前缀注入

#### hermes 实现

hermes 11-environments.md 中无跨代理通信机制（属第 14 章 State/Sessions）。

#### EvoClaw 实现

`packages/core/src/agent/embedded-runner.ts:50-120` — System Events 注入：

```typescript
// 子代理启动时，检查 system event queue
export async function runEmbeddedAgent(
  config: AgentRunConfig,
  onEvent: (event: RuntimeEvent) => void,
): Promise<AgentResult> {
  const messages: ChatMessage[] = [...config.messages];  // 继承父消息

  // 注入 system events（来自父代理的消息前缀）
  if (config.systemEvents && config.systemEvents.length > 0) {
    for (const event of config.systemEvents) {
      messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: `[System Event] ${event.type}: ${event.data}`,
        createdAt: new Date().toISOString(),
      });
    }
  }

  const kernel = new AgentKernel({ agent: config.agent, messages, ... });
  return await queryLoop(kernel, { config, onEvent, ... });
}
```

System Events 在父代理中排队（`packages/core/src/routes/`）：

```typescript
// 父代理运行时
const systemEventQueue: SystemEvent[] = [];

export function enqueueSystemEvent(event: SystemEvent): void {
  systemEventQueue.push(event);
}

// 子代理启动时传入
const childConfig: AgentRunConfig = {
  ...parentConfig,
  systemEvents: systemEventQueue,  // ← 消息前缀
};

const result = await runEmbeddedAgent(childConfig, onEvent);

// 清空（已被子代理消费）
systemEventQueue.length = 0;
```

#### 判定 🟢 **EvoClaw 反超**

EvoClaw 的 System Events 是推式机制（父 → 子消息前缀注入），而不是子代理轮询查询；更高效且符合实时通知语义。

---

### §3.8 Docker 沙箱模式（3 模式）

#### hermes 实现

`tools/environments/docker.py:217-491` — 完整 Docker 后端：

```python
class DockerEnvironment(BaseEnvironment):
    def __init__(self, image: str, cwd: str = "/workspace", timeout: int = 60,
                 cpu: int = 1, memory: int = 5120, disk: int = 51200,
                 persistent_filesystem: bool = True, task_id: str = "default",
                 volumes: list = None, host_cwd: str = None, auto_mount_cwd: bool = False,
                 forward_env: list = None, env: dict = None, network: bool = True):
        # 容器预创建：docker run -d --cpus 1 --memory 5120M --disk 51200M ...
        self._container_id = subprocess.check_output([
            self._docker_exe, "run", "-d",
            "--cpus", str(cpu),
            "--memory", f"{memory}M",
            "--storage-opt", f"size={disk}M",
            "--cap-drop", "ALL",  # 安全：删除所有能力
            "--cap-add", "DAC_OVERRIDE",  # 仅保留必要的
            "--cap-add", "CHOWN",
            "--cap-add", "FOWNER",
            image,
        ]).decode().strip()

    def _run_bash(self, cmd_string: str, *, login: bool = False,
                  timeout: int = 120, stdin_data: str | None = None):
        cmd = [self._docker_exe, "exec"]
        if stdin_data is not None:
            cmd.append("-i")
        if login:
            cmd.extend(self._init_env_args)
        cmd.extend([self._container_id, "bash", "-c", cmd_string])
        return _popen_bash(cmd, stdin_data)

    def cleanup(self):
        # 销毁容器
        subprocess.run([self._docker_exe, "rm", "-f", self._container_id])
```

配置示例：

```yaml
terminal:
  backend: "docker"
  docker_image: "nikolaik/python-nodejs:python3.11-nodejs20"
  docker_cpu: 1
  docker_memory: 5120
  docker_disk: 51200
  docker_mount_cwd_to_workspace: false  # 安全默认：不挂载宿主 CWD
  docker_forward_env: ["GITHUB_TOKEN"]
  docker_volumes: ["path/on/host:path/in/container"]
```

#### EvoClaw 实现

CLAUDE.md 声称：

```markdown
- **沙箱** | Docker (可选，3 模式: off/selective/all，首次使用时引导安装)
```

但这是 **Tauri 桌面应用的项目隔离策略**，与工具执行环境无关：
- **off**: 用户工作项目在本地直接运行（风险高，不推荐）
- **selective**: 仅敏感项目（package.json `docker: true`）在容器中运行
- **all**: 所有项目都在容器中运行

查看源码（`apps/desktop/src-tauri/`）：

```rust
// 无 Docker 后端抽象；沙箱只是工作目录隔离策略
// 实际执行仍通过 Sidecar Bun 进程
```

工具执行层（`packages/core/src/tools/bash-tool.ts`）仍是本地 Bun.spawn()，无 Docker 支持。

#### 判定 🔴 **EvoClaw 明显落后**

hermes 的 Docker 后端是**完整的执行环境后端**；EvoClaw 的 Docker 3 模式是**应用层项目隔离策略**，两者不是同一维度。EvoClaw 工具执行层完全无 Docker 支持，无法在容器中运行 bash 命令或隔离权限。

---

### §3.9 Credential / Secret 管理

#### hermes 实现

hermes 11-environments.md 无 credential 管理（属第 29 章 Security）。

#### EvoClaw 实现

目前无跨子代理的 credential 传递机制。Tauri 层有 macOS Keychain 集成，但不涉及子代理环境。

#### 判定 🔴 **两者都无**

hermes 和 EvoClaw 都缺少子代理间的密钥轮转（API key rotation）和安全传递机制。

---

### §3.10 超时与 Abort 机制

#### hermes 实现

`tools/environments/base.py:374-425` — `_wait_for_process()` 超时处理：

```python
def _wait_for_process(self, proc: ProcessHandle, timeout: int = 120) -> dict:
    deadline = time.monotonic() + timeout

    while proc.poll() is None:
        if is_interrupted():  # Ctrl+C
            self._kill_process(proc)
            return { "output": "[Command interrupted]", "returncode": 130 }
        if time.monotonic() > deadline:  # 超时
            self._kill_process(proc)
            return { "output": f"[Command timed out after {timeout}s]", "returncode": 124 }
        time.sleep(0.2)
```

返回码约定：
- 0 = 成功
- 124 = timeout（GNU coreutils 惯例）
- 126 = cd 失败
- 130 = SIGINT（Ctrl+C）

#### EvoClaw 实现

`packages/core/src/agent/lane-queue.ts:116-120` — Lane Queue 超时：

```typescript
const timer = setTimeout(() => {
  item.abortController.abort();
  item.reject(new Error(`Task ${item.id} timed out after ${item.timeoutMs}ms`));
}, item.timeoutMs);
```

工具层（`packages/core/src/tools/bash-tool.ts`）无标准退出码约定，直接抛异常。

#### 判定 🟡 **部分覆盖**

两者都有超时机制，但：
- hermes 用标准退出码（124/126/130），便于脚本判断
- EvoClaw AbortController 更现代，但信号链路不明确
- EvoClaw 无标准退出码约定

---

### §3.11 文件系统隔离与 CWD 追踪

#### hermes 实现

`tools/environments/base.py:442-474` — CWD marker 双通道：

```python
def _extract_cwd_from_output(self, result: dict):
    output = result.get("output", "")
    marker = self._cwd_marker  # e.g., "__HERMES_CWD_<uuid>__"

    # 从后往前找 marker（处理用户输出包含 marker 的边界情况）
    last = output.rfind(marker)
    if last == -1: return

    search_start = max(0, last - 4096)
    first = output.rfind(marker, search_start, last)
    if first == -1 or first == last: return

    cwd_path = output[first + len(marker) : last].strip()
    if cwd_path:
        self.cwd = cwd_path

    # 从输出里剥离 marker（用户看不到）
    line_start = output.rfind("\n", 0, first)
    line_end = output.find("\n", last + len(marker))
    result["output"] = output[:line_start] + output[line_end:]
```

特点：
- **双通道**：本机用 `_cwd_file`，远端用 stdout marker
- **4KB 搜索窗口**：CWD 不会超过此长度
- **marker 剥离**：用户输出中自动移除技术细节

#### EvoClaw 实现

`packages/core/src/agent/embedded-runner.ts:150-180` — 消息级 CWD 传递：

```typescript
export interface WorkspaceContext {
  cwd: string;
  files?: Record<string, string>;  // 附件
}

// 子代理启动时传入 CWD
const childConfig: AgentRunConfig = {
  ...parentConfig,
  workspaceContext: {
    cwd: '/path/to/workspace',
  },
};

// 工具执行时使用
const bashTool: ToolDefinition = {
  execute: async (args) => {
    const cwd = args.cwd || config.workspaceContext?.cwd || process.cwd();
    // ...
  }
};
```

#### 判定 🟡 **部分覆盖**

两者都追踪 CWD，但机制不同：
- hermes: 脚本级 CWD 跟踪（命令执行后自动更新）
- EvoClaw: 消息级传递（显式在参数中）

EvoClaw 逻辑隔离更清晰，但物理隔离取决于工具实现（无后端多态）。

---

### §3.12 环境变量快照持久化

#### hermes 实现

详见 §3.2，通过 snapshot 文件 (`export -p > snapshot`) 实现跨命令调用的 env vars 持久化。

#### EvoClaw 实现

无 env snapshot 机制；每个工具调用都从清空环境开始。

#### 判定 🔴 **EvoClaw 明显落后**

子代理场景需要 env vars 跨工具调用保留（如 `export API_KEY=xxx`，后续 `curl $API_KEY`）。EvoClaw 完全缺失此机制。

---

## 4. 建议改造蓝图

### P0 — 核心补齐（6-8 周）

1. **Environment 基础层** (2 周)
   - 创建 `packages/core/src/execution/base-environment.ts` 抽象基类
   - 实现 LocalEnvironment（subprocess 包装）
   - 接入 bash/read/write/edit 工具
   - 核心特性：snapshot 快照、CWD 追踪、超时中断
   - **ROI 高**：后续所有后端都基于此

2. **Env Snapshot 持久化** (1 周)
   - 每个 SubAgentSpawner 维护 snapshot 文件
   - 工具执行包装脚本（source snapshot → eval → export）
   - 跨工具调用恢复 env vars
   - **ROI 高**：子代理场景关键

3. **标准退出码约定** (3 天)
   - 124 = timeout
   - 126 = cwd not found
   - 130 = interrupt
   - **ROI 中**：便于脚本逻辑判断

### P1 — 后端多态支持（4-6 周）

4. **Docker 后端** (3 周)
   - 实现 DockerEnvironment（docker exec + 资源限制）
   - 集成 `docker run` 容器预创建
   - 能力裁剪（cap-drop ALL）
   - 配置字段：image/cpu/memory/disk/volumes
   - **ROI 高**：企业级隔离需求

5. **SSH 后端** (2 周)
   - 实现 SSHEnvironment（ControlMaster + rsync）
   - 文件同步机制（credentials/skills）
   - **ROI 中**：适合混合云

### P2 — 增强特性（3-4 周）

6. **Modal / Daytona 后端** (2 周)
   - 实现 ModalEnvironment（SDK async 桥接）
   - 实现 DaytonaEnvironment（堆积 sandbox 管理）
   - **ROI 中**：云原生支持

7. **Steer 重执行完整化** (1 周)
   - 当前 steer 仅 idle 状态可用
   - 扩展为任何时刻可以"插入指令" + 恢复消息快照重执行
   - **ROI 低**：交互增强

---

## 5. EvoClaw 反超点汇总

| # | 反超能力 | 代码位置 | hermes 对应缺失 |
|---|----------|---------|-----------------|
| 1 | **三车道 Lane Queue** | `lane-queue.ts:21-140` | 全局单一 FIFO queue 无差异隔离 |
| 2 | **Per-sessionKey 串行** | `lane-queue.ts:107-109` | 无会话级别的执行顺序保证 |
| 3 | **工具禁用列表 + 权限降权** | `sub-agent-spawner.ts:100-127` | 无子代理安全沙箱（12 章 Skills 才涉及） |
| 4 | **三层角色自动限权** | `sub-agent-spawner.ts:188-192` | 无 orchestrator/leaf 角色机制 |
| 5 | **Fork 模式缓存复用** | `sub-agent-spawner.ts:72-89` | thinking block cache 是 v0.8.0 后加的 |
| 6 | **递归 fork 防护** | `sub-agent-spawner.ts:94-98` | 无对应防护 |
| 7 | **Steer 消息快照重执行** | `sub-agent-spawner.ts:150-166` | 无 steer 工具 |
| 8 | **推式通知 yield** | `sub-agent-tools.ts:26-42` | 无 await/notify 机制，只能轮询 |
| 9 | **System Events 消息注入** | `embedded-runner.ts:50-120` | 事件队列属第 14 章，此章无 |
| 10 | **跨代理生成白名单** | `sub-agent-spawner.ts:268-287` | 无跨代理派生（12 章才涉及） |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（10 条经 Read 验证）

✅ `packages/core/src/agent/lane-queue.ts:1-140`（LaneQueue 完整实现）
✅ `packages/core/src/agent/sub-agent-spawner.ts:1-300`（生命周期管理起点）
✅ `packages/core/src/agent/sub-agent-spawner.ts:100-117`（工具禁用列表）
✅ `packages/core/src/agent/sub-agent-spawner.ts:188-192`（角色分配）
✅ `packages/core/src/agent/sub-agent-spawner.ts:72-89`（Fork Cache-Safe）
✅ `packages/core/src/agent/sub-agent-spawner.ts:94-98`（递归防护）
✅ `packages/core/src/tools/sub-agent-tools.ts:26-42`（formatYieldResult）
✅ `packages/core/src/tools/sub-agent-tools.ts:45-250`（spawn_agent/kill_agent/yield_agents 工具）
✅ CLAUDE.md:45 行（Lane Queue 并发声明）
✅ `.research/05-agent-loop-gap.md:1-80`（参考样板结构）

### 6.2 hermes 研究引用（章节 §）

✅ `tools/environments/base.py:1-568`（BaseEnvironment 抽象）
✅ `tools/environments/base.py:322-358`（_wrap_command 脚本模板）
✅ `tools/environments/base.py:281-316`（init_session 快照捕获）
✅ `tools/environments/base.py:374-425`（_wait_for_process 超时）
✅ `tools/environments/base.py:442-474`（_extract_cwd_from_output CWD 解析）
✅ `tools/environments/local.py:239`（LocalEnvironment._run_bash）
✅ `tools/environments/docker.py:217-491`（DockerEnvironment）
✅ `tools/environments/ssh.py:23-163`（SSHEnvironment）
✅ `tools/terminal_tool.py:687`（环境工厂）
✅ `cli-config.yaml.example:114-225`（配置）

### 6.3 关联差距文档（crosslink）

- **04-core-abstractions-gap.md**（ProcessHandle Protocol、字段定义）
- **05-agent-loop-gap.md**（工具分发并发策略、工具执行管道）
- **09-tools-system-gap.md**（bash/read/write 工具实现）
- **10-toolsets-gap.md**（工具组合、权限拦截链）
- **14-state-sessions-gap.md**（System Events、会话隔离）

---

## 综合判定

**档位分布**: 🔴 6 / 🟡 2 / 🟢 4

**总体结论**: **🟡 部分覆盖，多项反超**

**核心差距**:
- hermes: **命令执行基础设施** — BaseEnvironment 抽象 + 9 个后端（Local/Docker/SSH/Modal/Daytona）+ spawn-per-call 模式 + snapshot 快照
- EvoClaw: **多代理协调框架** — 三车道并发控制 + 权限沙箱 + 生命周期管理（spawn/kill/steer/yield）

**补齐优先级**:
1. **P0 环境抽象 + snapshot** (6-8 周) — 子代理执行环境必要基础
2. **P1 Docker 后端** (3 周) — 企业级隔离核心诉求
3. **P2 SSH/Modal** (3-4 周) — 混合云 / 云原生支持

**EvoClaw 反超维度**:
- Lane Queue 三车道 > hermes 全局 FIFO
- 工具禁用列表 + 角色权限 > hermes 无差异隔离
- 推式通知 yield > 轮询 list_agents
- Fork 缓存复用 > hermes thinking block（独立于本章）

**与其他章节的关联**:
- §3 工具系统（spawn_agent 工具声明）
- §5 主循环（工具分发调度）
- §14 状态（System Events 事件队列）
- §29 安全（权限拦截链、工具白名单）
