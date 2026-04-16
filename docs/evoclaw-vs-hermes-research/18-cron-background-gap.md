# 18 — Cron 与后台调度 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/18-cron-background.md`（459 行，Phase D draft）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`cron/jobs.py:1-759` + `cron/scheduler.py:1-905` + `tools/cronjob_tools.py:1-532` + `hermes_cli/cron.py:1-290` + `gateway/run.py:7425-7476`
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16）
> **综合判定**: 🟡 **部分覆盖，含多项 🟢 明确反超**（EvoClaw 双轨架构：Heartbeat + Cron 各司其职）

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes Cron 子系统**（`.research/18-cron-background.md` §1-§2） — 单一职责的"用户可创建定时 agent 任务"引擎，4 层架构：CLI/Tool 入口 → `cron/jobs.py` Job CRUD + 调度解析 → `cron/scheduler.py` tick 主循环 + 执行 + 投递 → 14 种 delivery 平台。Job 使用 **JSON 文件** 持久化（`~/.hermes/cron/jobs.json` 原子写入 tmpfile+os.replace），而非 SessionDB。Tick 触发源为 Gateway 后台线程每 60s 调用 `cron_tick`，执行时 `fcntl.flock` 文件锁防并发。支持 3 种调度语法（once / interval / cron 表达式，依赖可选 `croniter`）。`_build_job_prompt` 负责注入 cron 系统提示 + 可选 script 输出 + Skills 加载。`[SILENT]` 约定式回复跳过投递。`cronjob_tools.py` 在 Agent 创建 Job 时执行 10 类 Prompt 注入扫描 + 零宽字符检测。**无重试**（失败跳到下一个 next_run_at）、**无心跳**、**无主会话意识注入**。

**EvoClaw 调度子系统** — 双轨架构，两个互补的后台调度器 + 统一的 Lane Queue 并发控制 + 优雅关闭链路：

- `packages/core/src/scheduler/cron-runner.ts:56-309` — **CronRunner**：SQLite `cron_jobs` 表持久化，每 60s tick 扫描到期任务，`cron-parser` 解析表达式，走 `LaneQueue` cron 车道（并发 2），隔离 session key `agent:<id>:cron:<jobId>`
- `packages/core/src/scheduler/heartbeat-manager.ts:25-139` — **HeartbeatManager**：管理多 Agent `HeartbeatRunner` 实例的容器
- `packages/core/src/scheduler/heartbeat-runner.ts:52-234` — **HeartbeatRunner**：per-Agent 长心跳（默认 30min），活跃时段门控，共享主会话 session key 做"意识注入"
- `packages/core/src/scheduler/heartbeat-execute.ts:16-86` — **executeFn**：**通过内部 HTTP 复用 `/chat/:agentId/send` 管道**（SSE 流式回收）
- `packages/core/src/scheduler/heartbeat-wake.ts:27-71` — **HeartbeatWakeCoalescer**：250ms 合并窗口防重复唤醒
- `packages/core/src/infrastructure/system-events.ts:55-150` — **System Events 队列**：Cron `actionType='event'` 注入主会话
- `packages/core/src/infrastructure/graceful-shutdown.ts:41-122` — **优雅关闭**：SIGTERM/SIGINT → 30s 宽限期 → 按优先级串行关闭（调度器 10 → 渠道 20 → MCP 30 → DB 80 → 日志 99）

**量级对比**: hermes Cron 单一用途 ~2500 行（jobs+scheduler+tools+CLI）。EvoClaw Cron 约 310 行 + Heartbeat 约 480 行 + shutdown 约 120 行 + LaneQueue/SystemEvents/TaskRegistry 辅助，**总量更小但职责更清晰**：hermes 把"执行 + 投递 + 多平台路由"全塞进 scheduler，EvoClaw 把"定时触发 + 周期心跳"分离为两个调度器，"投递"交给 `ChannelManager`（见 19 平台差距系列），"路由"交给 `BindingRouter`。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 调度引擎骨架 | 🟢 | **反超**：EvoClaw 双轨 Cron+Heartbeat 互补；hermes 仅单轨 Cron |
| §3.2 | Cron 表达式解析 | 🟡 | 二者都用库（hermes croniter / EvoClaw cron-parser），但 hermes 额外支持 `every 30m` / ISO once |
| §3.3 | Heartbeat 模型 | 🟢 | **反超**：per-Agent 长心跳 + 活跃时段门控 + 空文件预检 + 间隔门控，hermes 完全无 |
| §3.4 | Heartbeat vs Cron 会话隔离 | 🟢 | **反超**：Heartbeat 共享主会话 / Cron 独立 session 明确分轨，hermes 仅 Cron 独立 |
| §3.5 | 执行管道复用 | 🟢 | **反超**：`createHeartbeatExecuteFn` 通过内部 HTTP 打 `/send` 端点，一份代码覆盖对话/心跳/Cron，hermes 手写 AIAgent 实例 |
| §3.6 | 任务状态机（queued/running/success/failure） | 🟢 | **反超**：TaskRegistry 统一追踪（cron/heartbeat/subagent 三 runtime），hermes 仅 last_status 字段 |
| §3.7 | 失败重试 / 连续失败自动禁用 | 🟡 | EvoClaw 连续 5 次失败自动 `enabled=0`；hermes 明确"无重试"（失败跳下一个 next_run_at） |
| §3.8 | 并发控制（Lane Queue） | 🟢 | **反超**：三车道独立并发 + 同 sessionKey 串行锁，hermes 仅 `fcntl.flock` 文件锁（进程级） |
| §3.9 | Standing Orders 与 Heartbeat 协同 | 🟢 | **反超**：AGENTS.md `### Program: ... Trigger: heartbeat` 结构化程序，hermes 无对应机制 |
| §3.10 | 任务持久化（重启恢复） | 🟡 | EvoClaw SQLite cron_jobs 表 + `next_run_at` 索引；hermes JSON 文件原子写入+宽恕期快进 |
| §3.11 | System Events 注入（Cron→主会话） | 🟢 | **反超**：Cron `actionType='event'` 直接 enqueueSystemEvent 到主 session，hermes 无对应 |
| §3.12 | 宽限期 / 误差补偿（补跑 vs 快进） | 🔴 | hermes 有宽恕期（每日 2h / 每小时 30m 半周期）快进防雪崩；EvoClaw 未实现，关机期间的 tick 全丢 |
| §3.13 | 优雅关闭链路 | 🟢 | **反超**：`registerShutdownHandler` 优先级串行 + 30s 宽限期强制退出，hermes 依赖 gateway stop_event |
| §3.14 | Prompt 注入防护（安全） | 🔴 | hermes 10 类正则 + 零宽字符检测 + script 路径遍历检查；EvoClaw Cron 创建面无对应安全扫描 |
| §3.15 | 告警 / 失败通知回流 | 🟢 | **反超**：`enqueueTaskNotification` 把 cron 成败消息投递回主 session；hermes 仅本地 log + last_delivery_error 字段 |

**统计**: 🔴 2 / 🟡 3 / 🟢 10（其中 9 项明确反超）。

---

## 3. 机制逐条深度对比

### §3.1 调度引擎骨架

**hermes**（`.research/18-cron-background.md` §1 图 + §3.4，`cron/scheduler.py:812-901` + `gateway/run.py:7425-7476`）—— 单轨 Cron，Gateway 后台线程每 60s tick:

```python
# gateway/run.py:7425-7476
def _start_cron_ticker(stop_event, adapters=None, loop=None, interval=60):
    while not stop_event.is_set():
        cron_tick(verbose=False, adapters=adapters, loop=loop)
        stop_event.wait(timeout=interval)

# cron/scheduler.py:812-901
def tick(verbose=True, adapters=None, loop=None) -> int:
    lock_fd = open(_LOCK_FILE, "w")
    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    due_jobs = get_due_jobs()
    for job in due_jobs:
        advance_next_run(job["id"])
        success, output, final_response, error = run_job(job)
        # ...
```

**EvoClaw**（`packages/core/src/scheduler/cron-runner.ts:65-78` + `heartbeat-manager.ts:102-119`）—— **双轨独立调度器**:

```typescript
// cron-runner.ts:65-78 — Cron 每分钟 tick（setInterval）
start(): void {
  if (this.timer) return;
  this.timer = setInterval(() => this.tick(), 60_000);
  this.tick();  // 启动时立即执行一次
}

// heartbeat-manager.ts:102-119 — 管理多 Agent 的长心跳 runner
startAll(): void {
  const agents = this.db.all<{ id: string }>(
    `SELECT id FROM agents WHERE status = 'active'`,
  );
  for (const agent of agents) {
    this.ensureRunner(agent.id);
  }
}
```

**判定 🟢 反超**：
- hermes 只有"到点执行一次性/周期性任务"这一种调度，EvoClaw 把"周期性任务"（Cron）和"Agent 持续意识"（Heartbeat）分开：**前者是外部时钟驱动业务**，后者是**Agent 自身的持续在线循环**，语义完全不同
- 启动时立即 tick（`cron-runner.ts:69`）缩短冷启动延迟
- Heartbeat 是**per-Agent** 独立 timer（`heartbeat-runner.ts:67-71`），不同 Agent 的间隔可以差异化；hermes cron 是全局单线程 tick

---

### §3.2 Cron 表达式解析

**hermes**（`.research/18-cron-background.md` §3.1 / §4.1，`cron/jobs.py:117-204`）—— 3 类语法 + 优先级解析:

```python
def parse_schedule(schedule: str) -> Dict[str, Any]:
    schedule_lower = schedule.strip().lower()
    if schedule_lower.startswith("every "):
        minutes = parse_duration(schedule[6:].strip())
        return {"kind": "interval", "minutes": minutes,
                "display": f"every {minutes}m"}
    parts = schedule.split()
    if len(parts) >= 5 and all(re.match(r'^[\d\*\-,/]+$', p) for p in parts[:5]):
        croniter(schedule)  # 验证语法
        return {"kind": "cron", "expr": schedule, "display": schedule}
    dt = datetime.fromisoformat(schedule)
    return {"kind": "once", "run_at": dt.isoformat(), "display": f"once at {dt}"}
```

3 种 kind：`once` / `interval` / `cron`，外部依赖 `croniter`（可选）。

**EvoClaw**（`packages/core/src/scheduler/cron-runner.ts:1, 299-303`）—— 单类表达式:

```typescript
import cronParser from 'cron-parser';

/** 计算下次运行时间 */
private computeNextRun(cronExpression: string): string {
  const interval = cronParser.parseExpression(cronExpression);
  return interval.next().toISOString();
}
```

- 仅支持标准 5 字段 cron 表达式（依赖 `cron-parser` 包）
- 无 `every 30m` / ISO once 快捷语法
- 无宽恕期快进（见 §3.12）

**判定 🟡**：
- 二者都用成熟第三方库解析 cron，引擎本身无差距
- EvoClaw 缺 `every Nm/Nh/Nd` 简化语法：用户想配"每 30 分钟"必须写 `*/30 * * * *`（不够人性）
- EvoClaw 缺 `once` 一次性任务语义：`cron-parser` 的周期性表达式无法表达"仅执行一次"，当前必须删除 job 实现
- interval / once 快捷语法缺失对企业用户（CLAUDE.md "target users"）不友好

---

### §3.3 Heartbeat 模型（EvoClaw 独有）

**hermes** — **完全不存在**。`grep heartbeat .research/18-cron-background.md` 零结果。hermes Gateway 有"activity heartbeat"（见 05 agent-loop gap §3.3）但那是**流式心跳**，不是调度层概念。

**EvoClaw**（`heartbeat-runner.ts:103-195`）—— 5 层门控的 per-Agent 长心跳:

```typescript
async tick(reason: HeartbeatReason = 'interval'): Promise<'skipped' | 'ok' | 'active'> {
  // 1. 活跃时段检查（8:00-22:00 默认，支持跨午夜）
  const activeHours = this.config.activeHours ?? DEFAULT_ACTIVE_HOURS;
  if (!isInActiveHours(activeHours)) return 'skipped';

  // 2. 间隔门控 — 距上次执行够久才触发
  const minIntervalMs = (this.config.minIntervalMinutes ?? 5) * 60_000;
  if (Date.now() - this.lastExecutedAt < minIntervalMs) return 'skipped';

  // 3. 解析 session key（支持隔离 session）
  const sessionKey = this.resolveSessionKey();

  // 4. HEARTBEAT.md 空文件预检 — 无可执行内容且无系统事件时跳过 LLM 调用
  if (this.readWorkspaceFile) {
    const heartbeatContent = this.readWorkspaceFile('HEARTBEAT.md');
    if (isHeartbeatContentEffectivelyEmpty(heartbeatContent)) {
      if (!hasSystemEvents(sessionKey)) return 'skipped';
    }
  }

  // 5. 确定实际触发原因 + 构建 reason-based prompt
  const pendingEvents = peekSystemEvents(sessionKey);
  const effectiveReason = pendingEvents.length > 0 ? 'cron-event' as const : reason;
  const prompt = buildHeartbeatPrompt({ reason: effectiveReason, ... });

  // TaskRegistry + executeFn 调用
  const result = await this.executeFn(this.agentId, prompt, sessionKey, { ... });
  const ack = detectHeartbeatAck(result, this.config.ackMaxChars);
  return ack.isAck ? 'ok' : 'active';
}
```

关键设计点：
- **HEARTBEAT.md 空文件预检**（`heartbeat-runner.ts:120-128`）— 文件为空且无系统事件则跳过 LLM 调用，零成本省 token
- **零污染回滚**（`heartbeat-runner.ts:168-170` `detectHeartbeatAck`）— 回复 `HEARTBEAT_OK` 识别后在 conversation_log 侧记"轻量 ACK"而非完整对话污染
- **反馈循环防护**（CLAUDE.md L210）— 零宽空格标记防止注入记忆被重复存储

**判定 🟢 反超**：这是 EvoClaw 独有的**概念**，用于支撑 Agent 意识持续在线（Standing Orders / 异步任务结果回流 / 主动行为），不是 hermes "to-do list" 定时任务能取代的。

---

### §3.4 Heartbeat vs Cron 会话隔离

**hermes**（`.research/18-cron-background.md` §3.5 sequence 图）—— 仅 Cron，每个 Job 内部创建新 AIAgent 实例:

```python
# cron/scheduler.py:520-810 (简化)
def run_job(job):
    prompt = _build_job_prompt(job)  # 注入 cron system hint + skills
    agent = AIAgent(...)             # 新实例，独立 session
    success, output, response, error = agent.run_turn(prompt)
    return success, output, response, error
```

所有 cron job 隐式独立于用户主对话，且无"共享主会话"的概念。

**EvoClaw**（`heartbeat-runner.ts:207-233` + `cron-runner.ts:105-124`）—— **显式双轨**:

```typescript
// heartbeat-runner.ts:207-213 — Heartbeat 默认共享主会话
private resolveSessionKey(): string {
  if (this.config.isolatedSession) {
    return `agent:${this.agentId}:heartbeat`;   // 可选隔离
  }
  return this.resolveMainSessionKey();           // 默认共享
}

// heartbeat-runner.ts:216-233 — 查找最近活跃的本地对话 session
private resolveMainSessionKey(): string {
  if (this.db) {
    const row = this.db.get<{ session_key: string }>(
      `SELECT session_key FROM conversation_log
       WHERE agent_id = ?
         AND session_key LIKE 'agent:%:local:%'
         AND session_key NOT LIKE '%:cron:%'
         AND session_key NOT LIKE '%:subagent:%'
         AND session_key NOT LIKE '%:boot%'
       ORDER BY created_at DESC LIMIT 1`,
      this.agentId,
    );
    if (row) return row.session_key;
  }
  return `agent:${this.agentId}:local:direct:local-user`;
}

// cron-runner.ts:106-107 — event 型注入主会话
if (job.action_type === 'event') {
  const mainSessionKey = `agent:${job.agent_id}:local:direct:local-user`;
  enqueueSystemEvent(text, mainSessionKey);   // § 3.11 详述
  // ...
}

// cron-runner.ts:127 — prompt/tool/pipeline 型独立 session
const sessionKey = `agent:${job.agent_id}:cron:${job.id}`;
```

**判定 🟢 反超**：
- **Heartbeat 共享主会话**语义独特：Agent 在主对话流里"醒来补一句"，用户感知"Agent 在持续关注"，不会产生一堆孤立的后台对话记录
- **Cron 独立 session**避免定时任务污染用户主对话（例如每天 9 点的天气查询不该进主对话历史）
- **Cron event 型**（§3.11）又可选择"注入主会话"而非启新 session，覆盖了"定时提醒"场景
- hermes 只能选 1 种语义，EvoClaw 3 种（Heartbeat 共享 / Cron 独立 / Cron event 注入）全部覆盖
- 参考 14-state-sessions-gap.md §3.6（已判定 🟢 反超）

---

### §3.5 执行管道（executeFn 通过内部 HTTP 复用 /send）

**hermes**（`cron/scheduler.py:520-810` `run_job`）—— Cron 内部手构 AIAgent:

```python
def run_job(job: dict) -> Tuple[bool, str, str, Optional[str]]:
    prompt = _build_job_prompt(job)
    agent = AIAgent(model=job.get("model"), provider=job.get("provider"), ...)
    success, output, response, error = agent.run_turn(prompt)
    return success, output, response, error
```

Cron 执行路径与 Gateway 执行路径**并行但不复用**——每次 run_job 重新实例化 AIAgent，错过 session cache / runtime state 共享。

**EvoClaw**（`heartbeat-execute.ts:16-86`）—— **通过内部 HTTP 复用 /send 端点**:

```typescript
export function createHeartbeatExecuteFn(port: number, token: string): HeartbeatExecuteFn {
  return async (agentId, message, sessionKey, opts): Promise<string> => {
    const url = `http://127.0.0.1:${port}/chat/${agentId}/send`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        message, sessionKey,
        isHeartbeat: true,
        lightContext: opts?.lightContext ?? false,
        modelOverride: opts?.model,
      }),
    });
    // 消费 SSE 流，拼接 text_delta 为完整响应
    let fullResponse = '';
    // ... SSE 解析，略
    return fullResponse;
  };
}
```

关键意图（`heartbeat-execute.ts:6-16` 注释）：**"通过内部 HTTP 调用复用 chat /send 端点（SSE 流式），收集完整响应文本返回。保持与普通对话完全一致的执行管道，包括 ContextPlugin 生命周期、工具调用、零污染回滚等。"**

**判定 🟢 反超**：
- 一份代码路径（`/chat/:agentId/send`）覆盖：用户对话 / Heartbeat / Cron event 注入 / Cron prompt 触发
- **ContextPlugin 10 个插件**（CLAUDE.md "5 阶段工具注入"）自动生效，不需要在 Cron 侧复制
- **零污染回滚 / Prompt Cache / 工具执行**都是 Agent Kernel 内置能力，Cron 自动继承
- 代价：HTTP overhead（localhost + Bearer token 解密）约 1-3ms，对分钟级 tick 可忽略
- 调用方也不必知晓 Kernel 的 Plugin 装配细节，降低耦合

---

### §3.6 任务状态机（pending/running/success/failure）

**hermes**（`cron/jobs.py:430-458` + `mark_job_run` L577-624）—— Job 级持久字段:

```python
job = {
    # ...
    "state": str,           # "scheduled" | "paused" | "completed"
    "last_status": str,     # "ok" | "error"
    "last_error": Optional[str],
    "last_delivery_error": Optional[str],
}

def mark_job_run(job_id, success, error, delivery_error):
    # last_run_at = now
    # last_status = "ok" | "error"
    # repeat.completed += 1
    # 若 repeat.completed >= repeat.times → 删除 Job
```

仅 Job 级元数据，无执行实例层追踪。

**EvoClaw**（`cron-runner.ts:110-138, 157-184` + `heartbeat-runner.ts:143-195` + `infrastructure/task-registry.ts`）—— TaskRegistry 统一追踪:

```typescript
// cron-runner.ts:128-138
const cronTaskId = `cron-${job.id}-${crypto.randomUUID()}`;
createTask({
  taskId: cronTaskId,
  runtime: 'cron',                    // cron / heartbeat / subagent 三 runtime
  sourceId: job.id,
  status: 'queued',                   // queued → running → succeeded | failed
  label: `cron:${job.action_type}:${job.name}`,
  agentId: job.agent_id,
  sessionKey,
  startedAt: undefined,
  cancelFn: () => { this.laneQueue.cancel(cronTaskId); },
});

// cron-runner.ts:157
updateTask(cronTaskId, { status: 'succeeded', endedAt: Date.now() });
// cron-runner.ts:172
updateTask(cronTaskId, { status: 'failed', endedAt: Date.now(), error: String(err) });

// heartbeat-runner.ts:145-159
createTask({
  taskId, runtime: 'heartbeat', sourceId: this.agentId,
  status: 'running', label: `heartbeat:${effectiveReason}`,
  agentId: this.agentId, sessionKey, startedAt: Date.now(),
  cancelFn: () => { this.stop(); },
});
```

Job 级依然有 `last_run_at / last_run_status / consecutive_errors / last_delivery_status`（见 `migrations/016_cron_job_state.sql:1-6`）。

**判定 🟢 反超**：
- 双层追踪：**Job 级**（长期元数据）+ **Task 级**（执行实例生命周期）
- TaskRegistry 跨 runtime 统一语义（cron/heartbeat/subagent 在任务面板用同一个 UI 显示）
- `cancelFn` 让前端任务面板可以直接取消运行中的 Cron/Heartbeat，hermes 无对应（hermes `trigger_job` 是"手动触发"，不是"取消"）
- 参考 CLAUDE.md "Sprint 15.11 MCP 客户端企业化" 企业可见度路线

---

### §3.7 失败重试 / 连续失败自动禁用

**hermes**（`.research/18-cron-background.md` §7 延伸阅读 #4） —— **明确设计为不重试**:

> 周期性 Job 失败后不重试当期，直接跳到下一个 `next_run_at`——这是有意设计，避免在 agent 出错时产生雪崩。

```python
# cron/jobs.py:577-624 (简化)
def mark_job_run(job_id, success, error, ...):
    # 失败仅更新 last_status = "error" + last_error
    # 不变更 next_run_at 触发逻辑，直接等下周期
```

**EvoClaw**（`cron-runner.ts:13-14, 281-297`）—— 连续失败自动禁用（熔断器风格）:

```typescript
const MAX_CONSECUTIVE_ERRORS = 5;

private recordError(jobId: string, jobName: string): void {
  const ts = new Date().toISOString();
  this.db.run(
    `UPDATE cron_jobs SET last_run_status = 'error',
     consecutive_errors = consecutive_errors + 1, updated_at = ? WHERE id = ?`,
    ts, jobId,
  );
  const row = this.db.get<{ consecutive_errors: number }>(
    'SELECT consecutive_errors FROM cron_jobs WHERE id = ?', jobId,
  );
  if (row && row.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
    this.db.run('UPDATE cron_jobs SET enabled = 0, updated_at = ? WHERE id = ?', ts, jobId);
    log.warn(`任务 ${jobName} 连续失败 ${MAX_CONSECUTIVE_ERRORS} 次，已自动禁用`);
  }
}

// 成功时重置（cron-runner.ts:152-156）
`SET last_run_at = ?, last_run_status = 'ok', consecutive_errors = 0, updated_at = ? WHERE id = ?`
```

**判定 🟡**：
- EvoClaw **熔断**思路避免坏任务持续占用 cron 车道并污染日志，适合企业用户（避免莫名的错误累积）
- hermes **静默跳过**思路更简单，避免自动禁用的"不透明"效应（用户可能觉得任务莫名停了）
- 二者各有优劣；理想状态应支持配置（EvoClaw 可加 `retryPolicy: 'none' | 'skip' | 'circuit-break'`）
- EvoClaw 缺"指数退避"真正意义上的重试（连续失败是累计，不是当轮重试）。hermes 也无

---

### §3.8 并发控制（Lane Queue cron 车道）

**hermes**（`cron/scheduler.py:812-901` + `.research/18-cron-background.md` §7 #2）—— 进程级 fcntl 文件锁:

```python
# cron/scheduler.py:tick()
lock_fd = open(_LOCK_FILE, "w")
fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)   # advisory lock
try:
    due_jobs = get_due_jobs()
    for job in due_jobs:
        # ... 单线程串行执行所有 due job
finally:
    fcntl.flock(lock_fd, fcntl.LOCK_UN)
```

- 整个 tick 串行（单线程）—— 10 个 due job 必须排队
- Windows 通过 msvcrt fallback
- 同进程多线程调用 tick 时**同 fd** 文件锁不生效（hermes §7 #2 明示）

**EvoClaw**（`lane-queue.ts:21-80` + `shared/constants.ts:40-44` + `cron-runner.ts:140-149`）—— 三车道并发 + 同 session 串行:

```typescript
// shared/constants.ts:40-44
export const LANE_CONCURRENCY = {
  main: 4,
  subagent: 8,
  cron: 2,    // cron 车道默认 2 并发
} as const;

// cron-runner.ts:140-149
this.laneQueue.enqueue({
  id: cronTaskId,
  sessionKey,                // agent:<id>:cron:<jobId>
  lane: 'cron',
  task: async () => { /* ... */ },
  timeoutMs: 300_000,        // 5 分钟
}).then(...).catch(...)

// lane-queue.ts (§3.9 of 14-state-sessions) — 同 sessionKey 串行保障
private runningKeys: Map<string, string> = new Map();
```

**判定 🟢 反超**：
- **粒度精细**：cron 车道默认 2 个并发，main/subagent 各自独立（互不干扰）
- **同 sessionKey 串行**：同一个 Cron Job 如果前次还没跑完，新一次不会并发开始（由 `runningKeys` Map 保证）
- **不同 Job 可并发**：10 个不同 Agent 的 cron job 同时到期，前 2 个并发执行，后 8 个排队——比 hermes 单线程吞吐高
- **超时保护**：300s `timeoutMs` + `AbortController` 可中途取消
- 参考 14-state-sessions-gap.md §3.9（已判定 🟢 反超）

---

### §3.9 Standing Orders 与 Heartbeat 协同

**hermes** — **无对应概念**。hermes Cron Job 的 prompt 是**一次性字符串**，无"持续授权"语义。

**EvoClaw**（`agent-manager.ts:420-438` 默认 AGENTS.md 模板 + `heartbeat-prompts.ts:38-66` prompt 构建 + CLAUDE.md "Standing Orders"）:

```typescript
// agent-manager.ts:420-438 — AGENTS.md 模板结构化 Program
/* ## Standing Orders
<!-- Define your persistent programs here. Each program grants you ongoing authority
     to act autonomously within defined boundaries.

### Program: [Name]
- **Scope**: What you are authorized to do
- **Trigger**: When to execute (heartbeat / cron / event)
- **Approval**: What requires human sign-off before acting
- **Escalation**: When to stop and ask for help

Example:

### Program: Inbox Triage
- **Scope**: Check inbox, categorize messages, summarize urgent items
- **Trigger**: heartbeat
- **Approval**: None for summaries; escalate before sending replies
- **Escalation**: Unknown message types or suspicious content
--> */

// heartbeat-prompts.ts:58-66 — 标准心跳 prompt 指引 Agent 读 HEARTBEAT.md
const DEFAULT_HEARTBEAT_PROMPT =
  `Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. ` +
  `Do not infer or repeat old tasks from prior chats. ` +
  `If nothing needs attention, reply ${HEARTBEAT_TOKEN}.`;
```

- AGENTS.md 中的 Program 是**持续授权**（CLAUDE.md "Standing Orders 意识注入"），通过 system prompt 的 `<standing_orders>` 段注入 Agent
- Trigger=heartbeat 的 Program 由 HeartbeatRunner 每次 tick 激活
- Approval / Escalation 是**策略层**而非**代码层**，Agent 自己按 prompt 约束判断
- 与 §3.3 HEARTBEAT.md 空文件预检协同：没有 Program / 没有 HEARTBEAT.md 则跳过 LLM 调用

**判定 🟢 反超**：这是 EvoClaw 面向企业（非技术用户）的关键设计——用户在 AGENTS.md 里写**自然语言 Program**，Agent 自主执行；不需要写代码配 cron。hermes 的 Cron Job 必须写具体 prompt，每个新任务都要重新配。

---

### §3.10 任务持久化（重启恢复）

**hermes**（`.research/18-cron-background.md` §2.4 + §7 #1）—— JSON 文件 + 原子写入:

```json
// ~/.hermes/cron/jobs.json
{
  "jobs": [ /* CronJob 对象数组 */ ],
  "updated_at": "2026-02-03T14:00:00+01:00"
}
```

- 写入：tmpfile + `os.replace`（原子）
- 输出存档：`~/.hermes/cron/output/{job_id}/{timestamp}.md`
- Tick 锁：`~/.hermes/cron/.tick.lock`
- 人类可读，简单部署
- 不依赖 SessionDB

**EvoClaw**（`migrations/008_cron_jobs.sql:1-17` + `migrations/016_cron_job_state.sql:1-6`）—— SQLite + 索引:

```sql
CREATE TABLE IF NOT EXISTS cron_jobs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('prompt', 'tool', 'pipeline')),
  action_config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cron_agent ON cron_jobs(agent_id);
CREATE INDEX IF NOT EXISTS idx_cron_next_run ON cron_jobs(next_run_at) WHERE enabled = 1;

-- 016_cron_job_state.sql — 新增状态机字段
ALTER TABLE cron_jobs ADD COLUMN consecutive_errors INTEGER DEFAULT 0;
ALTER TABLE cron_jobs ADD COLUMN last_run_status TEXT DEFAULT NULL;
ALTER TABLE cron_jobs ADD COLUMN last_delivery_status TEXT DEFAULT NULL;
```

**判定 🟡**：
- EvoClaw SQLite 方式：
  - ✅ 索引加速（`idx_cron_next_run WHERE enabled = 1`）
  - ✅ `action_type CHECK` 约束避免非法 type（但 §3.11 表明实际支持了 `'event'` 第 4 类，schema 与代码不一致是**发现**）
  - ✅ 外键 `ON DELETE CASCADE` 自动清理
  - ❌ 不人类可读（hermes JSON 可直接 vim 编辑）
- hermes JSON 方式：
  - ✅ 简单部署，备份/版本控制友好
  - ❌ 大规模 Job 数（1000+）写入有 O(n) IO
  - ❌ 无索引，每次 tick 必须全表扫

**修改发现（仅记录不执行）**: `migrations/008_cron_jobs.sql:7` 的 CHECK 约束 `action_type IN ('prompt', 'tool', 'pipeline')` 与 `cron-runner.ts:106` 实际使用的 `'event'` 类型**不一致**。新 action_type='event' 插入会被 SQLite 约束阻止，除非有后续 migration 放宽。

---

### §3.11 System Events 注入（Cron actionType='event'）

**hermes** — **无对应机制**。

**EvoClaw**（`cron-runner.ts:105-124` + `system-events.ts:55-150`）:

```typescript
// cron-runner.ts:105-124 — event 型 Cron 不启新 session，直接注入主会话
if (job.action_type === 'event') {
  const mainSessionKey = `agent:${job.agent_id}:local:direct:local-user`;
  const text = config.prompt ?? `[Cron: ${job.name}] 请执行计划任务。`;
  const eventTaskId = `cron-event-${job.id}-${crypto.randomUUID()}`;
  createTask({ taskId: eventTaskId, runtime: 'cron', sourceId: job.id,
    status: 'running', label: `cron:event:${job.name}`,
    agentId: job.agent_id, sessionKey: mainSessionKey, startedAt: Date.now() });
  enqueueSystemEvent(text, mainSessionKey);
  // ... 更新 last_run_at / consecutive_errors=0
  updateTask(eventTaskId, { status: 'succeeded', endedAt: Date.now() });
  continue;
}

// system-events.ts:55-89 — 注入逻辑
export function enqueueSystemEvent(text, sessionKey, opts): boolean {
  // 连续重复去重 + contextKey 去重
  // MAX_EVENTS=20 容量限制
  // drain 时消费并清空
}
```

下游消费（CLAUDE.md "System Events"）：`chat.ts drainSystemEvents → message 前缀注入`，下次对话时自动带上 cron 注入的 event 文本。

**判定 🟢 反超**：
- **意识注入**新范式：cron 不是"执行一次任务"而是"给 Agent 留一条消息"，下次 Agent 上线/心跳时看到
- 与 Heartbeat 协同：`heartbeat-runner.ts:131` `peekSystemEvents(sessionKey)` 发现事件时把 reason 从 `interval` 切为 `cron-event`，使用 cron-event prompt
- 为"日历提醒 / 邮件通知 / 异步任务完成"这类场景提供原生支持
- 参考 14-state-sessions-gap.md §3.7（已判定 🟢 反超）

---

### §3.12 宽限期 / 误差补偿（补跑 vs 快进）

**hermes**（`.research/18-cron-background.md` §3.3，`cron/jobs.py:655-731`）—— 宽恕期快进:

```python
grace = _compute_grace_seconds(schedule)
# 每日任务 2h，每小时任务 30m，5 分钟任务 2.5m（半周期）
if (now - next_run_dt).total_seconds() > grace:
    # 跳过本次，快进到下一个未来时间
    new_next = compute_next_run(schedule, now)
```

- **宽恕期**：错过窗口小于半周期则正常执行（视为"及时"）
- **超过半周期**：快进到下一个时间点（避免 Gateway 重启后雪崩触发累积的所有 tick）
- **一次性 Job 补偿窗口**：`ONESHOT_GRACE_SECONDS = 120`（`cron/jobs.py:225-249`）

**EvoClaw**（`cron-runner.ts:81-100`）—— 无宽恕期:

```typescript
async tick(): Promise<number> {
  const now = new Date().toISOString();
  // 查询到期任务（next_run_at <= now 全部触发）
  const dueJobs = this.db.all<CronJobRow>(
    `SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at <= ?`,
    now,
  );
  for (const job of dueJobs) {
    // 计算下次运行时间（基于当前 tick 时刻 + cron 表达式）
    const nextRun = this.computeNextRun(job.cron_expression);
    // ... 执行
  }
}
```

- **所有 `next_run_at <= now` 的任务都会在本次 tick 触发一次**（但因为 `computeNextRun` 基于 now 前向推，不会多次重复）
- **关机期间**（sidecar 下线）累积的 cron tick **全部丢失**——重启后只执行最近一次的"下次触发"
- 无 ONESHOT_GRACE 对应

**判定 🔴**：
- 企业场景 laptop 关盖 / sidecar 崩溃 / 服务重启 跨越 cron 点后，用户预期的"9:00 晨报"如果 9:05 才重启会**完全丢失**
- hermes 的 2h 宽恕期会在 9:05 重启时补跑 9:00 的任务
- 补齐建议：在 `cron-runner.ts:95` 计算 `nextRun` 前先判断 `now - next_run_at` 是否在宽恕期内决定补跑 vs 快进

---

### §3.13 优雅关闭链路

**hermes**（`gateway/run.py:7425-7476`）—— Gateway 的 `stop_event`:

```python
def _start_cron_ticker(stop_event, adapters=None, loop=None, interval=60):
    while not stop_event.is_set():
        cron_tick(verbose=False, adapters=adapters, loop=loop)
        stop_event.wait(timeout=interval)   # 60s 默认
```

- 依赖外部 `stop_event`（由 gateway 主进程管理）
- 无优先级 / 无宽限期 / 无 force-exit 保护

**EvoClaw**（`infrastructure/graceful-shutdown.ts:41-122` + `server.ts:890-906`）—— **带优先级的串行关闭 + 30s 宽限期**:

```typescript
// graceful-shutdown.ts:67-122
export function installShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      log.warn(`重复收到 ${signal}，强制退出`);
      process.exit(1);
    }
    shuttingDown = true;

    // 30s 强制退出定时器
    const forceTimer = setTimeout(() => {
      log.error('宽限期超时，强制退出');
      process.exit(1);
    }, GRACE_PERIOD_MS /* 30_000 */);
    if (forceTimer.unref) forceTimer.unref();

    // 优先 flush 所有活跃的 IncrementalPersister
    // ...

    // 按优先级排序执行（数字小的先执行）
    const sorted = [...handlers].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    for (const { name, handler } of sorted) {
      log.info(`关闭: ${name}...`);
      await handler();
      log.info(`关闭: ${name} ✓`);
    }
    clearTimeout(forceTimer);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// server.ts:892-904 — 优先级链路
registerShutdownHandler({ name: '调度器', priority: 10, handler: () => {
  cronRunner.stop();
  heartbeatManager?.stopAll();
  decayScheduler?.stop();
  consolidator?.stop();
  memoryMonitor.stop();
}});
registerShutdownHandler({ name: '渠道', priority: 20, handler: () => { channelManager.disconnectAll(); }});
registerShutdownHandler({ name: 'MCP', priority: 30, handler: () => mcpManager.disposeAll() });  // server.ts:993
registerShutdownHandler({ name: '数据库', priority: 80, handler: () => { db.close(); }});
registerShutdownHandler({ name: '日志', priority: 99, handler: () => { closeLogger(); }});
```

关闭顺序：**调度器(10) → 渠道(20) → MCP(30) → DB(80) → 日志(99)** —— 先停生产者（调度器/渠道/MCP 不再产生新任务），再关消费者（DB/日志）。

**判定 🟢 反超**：
- 正式的关闭协议（CLAUDE.md "优雅关闭"章节 = 设计文档级承诺）
- 30s 宽限期 + force exit 保护死锁场景
- **IncrementalPersister flush 前置**（`graceful-shutdown.ts:85-96`）—— 优先刷盘，确保崩溃前对话不丢数据
- hermes 无等价协议——gateway 退出时如果 cron tick 正在跑，行为未定义

---

### §3.14 Prompt 注入防护（安全）

**hermes**（`.research/18-cron-background.md` §4.4-§4.5，`tools/cronjob_tools.py:36-52`）—— 10 类扫描 + 零宽字符检测:

```python
# tools/cronjob_tools.py:36-46 _CRON_SUSPICIOUS_PATTERNS
| 类别 | 正则（精简） |
|------|-----------------|
| prompt_injection | ignore ... (previous|all|above|prior) ... instructions |
| deception_hide | do not tell the user |
| sys_prompt_override | system prompt override |
| disregard_rules | disregard (your|all|any) (instructions|rules|guidelines) |
| exfil_curl | curl ... ${(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API) |
| exfil_wget | wget ... ${(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API) |
| read_secrets | cat ... (.env|credentials|.netrc|.pgpass) |
| ssh_backdoor | authorized_keys |
| sudoers_mod | /etc/sudoers|visudo |
| destructive_root_rm | rm -rf / |

# tools/cronjob_tools.py:49-52 _CRON_INVISIBLE_CHARS
{'\u200b', '\u200c', '\u200d', '\u2060', '\ufeff',       # 零宽字符
 '\u202a', '\u202b', '\u202c', '\u202d', '\u202e'}       # RTL 覆盖

# cron/scheduler.py:349-427 _run_job_script 路径遍历防护
if raw.startswith(("/", "~")) or (len(raw) >= 2 and raw[1] == ":"):
    return False, f"Blocked: absolute path {script_path!r}"
path = (scripts_dir / raw).resolve()
try:
    path.relative_to(scripts_dir_resolved)  # 沙箱边界
except ValueError:
    return False, f"Script escapes directory"
```

**EvoClaw**（`routes/cron.ts:1-75` + `cron-runner.ts:197-232`）—— **无针对 Cron 的专项扫描**:

```typescript
// routes/cron.ts:13-34 — POST / 创建任务
app.post('/', async (c) => {
  const body = await c.req.json<{
    agentId: string; name: string; cronExpression: string;
    actionType: string; actionConfig?: Record<string, unknown>;
  }>();
  // 无 Prompt 注入扫描 / 无零宽字符检测 / 无 script 路径校验
  const job = cronRunner.scheduleJob(body.agentId, { ... });
});
```

- Cron 不支持 script 路径执行（EvoClaw 无 `~/.hermes/scripts/` 等价概念），路径遍历风险不存在
- 但 `config.prompt` 字段可被构造性注入（`consecutive_errors=0` 复位后 Agent 每天执行恶意 prompt）
- CLAUDE.md "Bash 安全体系" 是工具执行层防护，不是 Cron 创建层防护

**判定 🔴**：
- Cron Job 创建端的 prompt 注入扫描缺失：企业用户（例如 IT 管理员粘贴来路不明的 "Program 建议" 到 AGENTS.md 或 Cron）可能导致 Agent 执行恶意 prompt
- 零宽字符 / RTL 覆盖检测缺失：`\u200b` 隐形字符可绕过人工审阅
- 补齐建议：在 `routes/cron.ts:13` 和 `scheduleJob` 前加 `sanitizeCronPrompt(body)` 复用 hermes 的 `_CRON_SUSPICIOUS_PATTERNS`

**注意**: EvoClaw 在 CLAUDE.md "PII 脱敏 / NameSecurityPolicy / Zod Schema 验证"等层面有其他安全机制，但它们不覆盖 Cron prompt 注入这个细分点。

---

### §3.15 告警 / 失败通知回流

**hermes**（`cron/scheduler.py:77-346` + `cron/jobs.py` mark_job_run）—— 本地日志 + 投递错误字段:

```python
# cron/jobs.py Job 字段
"last_error": Optional[str],
"last_delivery_error": Optional[str],
```

- `last_delivery_error` 仅记录投递失败（例如 Telegram 返回 400）
- `last_error` 仅记录执行错误
- 无**主会话感知**通道——用户只能主动 `hermes cron list` 查看

**EvoClaw**（`cron-runner.ts:157-184`）—— **成败都通知回主 session**:

```typescript
// 成功回流
this.laneQueue.enqueue({ ... }).then(() => {
  // ... 更新 DB
  // 通知回流 — 主 session 感知 cron 完成
  try {
    const mainSessionKey = `agent:${job.agent_id}:local:direct:local-user`;
    enqueueTaskNotification({
      taskId: cronTaskId,
      kind: 'cron',
      status: 'completed',
      title: job.name,
      durationMs: Date.now() - cronStartedAt,
    }, mainSessionKey);
  } catch { /* 通知失败不影响主流程 */ }
}).catch((err) => {
  // ... 记录错误 + 连续失败计数
  // 通知回流 — 失败也让主 session 感知
  try {
    enqueueTaskNotification({
      taskId: cronTaskId,
      kind: 'cron',
      status: 'failed',
      title: job.name,
      error: String(err),
      durationMs: Date.now() - cronStartedAt,
    }, mainSessionKey);
  } catch { /* ignore */ }
});
```

- `enqueueTaskNotification` 走 `infrastructure/task-notifications.ts`（与 `system-events.ts` 类似但专门用于任务状态通知）
- 主 session 下次激活时感知 cron 任务的成败，Agent 可在主对话中告知用户"你配的晨报任务完成了"或"失败了，原因是 X"

**判定 🟢 反超**：面向企业用户的**主动告知**，避免"任务悄悄失败 3 天用户才发现"的问题。hermes 需用户手动查询。

---

## 4. 建议改造蓝图（不承诺实施）

**P0**（高 ROI，建议尽快）:

| # | 项目 | 对应差距 | 工作量 | ROI | 价值 |
|---|---|---|---|---|---|
| 1 | Cron 宽恕期快进 + 错过补跑 | §3.12 | 1-2d | 🔥🔥🔥 | 关盖/重启场景用户体验关键：晨报任务不丢 |
| 2 | `action_type='event'` schema 修正 | §3.11 | 0.5d | 🔥🔥 | CHECK 约束与代码一致化（008 migration CHECK 不包含 'event'） |
| 3 | Cron Prompt 注入扫描 + 零宽字符检测 | §3.14 | 1-2d | 🔥🔥 | 企业用户粘贴不明 prompt 的安全底线 |

**P1**（中等 ROI）:

| # | 项目 | 对应差距 | 工作量 | ROI | 价值 |
|---|---|---|---|---|---|
| 4 | `every Nm/Nh/Nd` 快捷语法 + `once` 一次性任务 | §3.2 | 1-2d | 🔥🔥 | 非技术用户更易用 |
| 5 | Cron 重试策略（none/skip/circuit-break 可配） | §3.7 | 1d | 🔥 | 细粒度失败处理 |
| 6 | Cron 输出存档（`~/.evoclaw/cron/output/<jobId>/<ts>.md`） | §3.10 | 1d | 🔥 | 调试 / 审计友好 |

**P2**（长期规划）:

| # | 项目 | 对应差距 | 工作量 |
|---|---|---|---|
| 7 | Cron Job 触发手动按钮（REST 端点 `POST /cron/:id/trigger`） | §3.6 扩展 | 0.5d |
| 8 | Cron / Heartbeat 的度量（Prometheus-style） | §3.6 扩展 | 2d |

**不建议做**:

- hermes `[SILENT]` 约定式 API：EvoClaw 有等价的 `detectHeartbeatAck(HEARTBEAT_OK)` + `enqueueTaskNotification` 机制，不必再加约定
- hermes 14 平台 delivery 路由：EvoClaw `ChannelManager` 已覆盖（见 19 系列 gap）

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应 |
|---|---|---|---|
| 1 | 双轨调度器（Cron + Heartbeat） | `cron-runner.ts:56-309` / `heartbeat-manager.ts:25-139` | 仅单轨 Cron |
| 2 | Heartbeat 共享主会话（意识注入） | `heartbeat-runner.ts:207-233` | 无 Heartbeat 概念 |
| 3 | Cron 独立 session (`agent:<id>:cron:<jobId>`) | `cron-runner.ts:127` | 隐式独立（新 AIAgent 实例） |
| 4 | 内部 HTTP /send 管道复用 | `heartbeat-execute.ts:16-86` | 手构 AIAgent，不复用用户对话路径 |
| 5 | Standing Orders 结构化 Program（Trigger=heartbeat） | `agent-manager.ts:420-438` + CLAUDE.md | 无持续授权概念 |
| 6 | System Events Cron→主会话注入（`actionType='event'`） | `cron-runner.ts:105-124` + `system-events.ts:55-89` | 无 |
| 7 | Lane Queue cron 车道（2 并发 + 同 session 串行） | `lane-queue.ts:21-80` + `constants.ts:40-44` | 仅 fcntl 文件锁（串行） |
| 8 | TaskRegistry 统一追踪（queued/running/succeeded/failed） | `cron-runner.ts:128-138` + `heartbeat-runner.ts:145-159` | 仅 Job 级 `last_status` |
| 9 | 连续失败自动禁用熔断 | `cron-runner.ts:13, 281-297` | 明确不重试 |
| 10 | 优雅关闭链路（优先级 10-99 串行 + 30s 宽限期 + force exit） | `graceful-shutdown.ts:41-122` + `server.ts:892-904` | 仅 gateway stop_event |
| 11 | 任务通知回主会话（成败都回流） | `cron-runner.ts:158-184` | 仅 last_delivery_error 字段 |
| 12 | HEARTBEAT.md 空文件预检 + 间隔门控 | `heartbeat-runner.ts:111-128` | 无 |
| 13 | HeartbeatWakeCoalescer 250ms 合并窗口 | `heartbeat-wake.ts:27-71` | 无 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（本章所有 `path:line` 均经 Read 工具验证 2026-04-16）

- `packages/core/src/scheduler/cron-runner.ts:1` ✅ cron-parser import
- `packages/core/src/scheduler/cron-runner.ts:13-14` ✅ MAX_CONSECUTIVE_ERRORS = 5
- `packages/core/src/scheduler/cron-runner.ts:56-78` ✅ CronRunner.start/stop（setInterval 60_000）
- `packages/core/src/scheduler/cron-runner.ts:81-194` ✅ tick() 调度检查主函数
- `packages/core/src/scheduler/cron-runner.ts:105-124` ✅ actionType='event' System Events 注入
- `packages/core/src/scheduler/cron-runner.ts:127-138` ✅ cron 独立 sessionKey + TaskRegistry 入队
- `packages/core/src/scheduler/cron-runner.ts:140-149` ✅ LaneQueue cron 车道 enqueue
- `packages/core/src/scheduler/cron-runner.ts:157-184` ✅ 成败 enqueueTaskNotification 回流
- `packages/core/src/scheduler/cron-runner.ts:281-297` ✅ recordError 连续失败自动禁用
- `packages/core/src/scheduler/cron-runner.ts:299-303` ✅ computeNextRun
- `packages/core/src/scheduler/heartbeat-manager.ts:25-139` ✅ HeartbeatManager 完整类定义
- `packages/core/src/scheduler/heartbeat-manager.ts:102-110` ✅ startAll 查询 active Agent
- `packages/core/src/scheduler/heartbeat-runner.ts:52-234` ✅ HeartbeatRunner 完整类
- `packages/core/src/scheduler/heartbeat-runner.ts:103-195` ✅ tick() 5 层门控
- `packages/core/src/scheduler/heartbeat-runner.ts:120-128` ✅ HEARTBEAT.md 空文件预检
- `packages/core/src/scheduler/heartbeat-runner.ts:207-233` ✅ resolveSessionKey + resolveMainSessionKey
- `packages/core/src/scheduler/heartbeat-execute.ts:16-86` ✅ createHeartbeatExecuteFn 内部 HTTP
- `packages/core/src/scheduler/heartbeat-wake.ts:27-71` ✅ HeartbeatWakeCoalescer 250ms
- `packages/core/src/scheduler/heartbeat-prompts.ts:38-66` ✅ buildHeartbeatPrompt + DEFAULT_HEARTBEAT_PROMPT
- `packages/core/src/scheduler/active-hours.ts:1-29` ✅ isInActiveHours 跨午夜支持
- `packages/core/src/infrastructure/graceful-shutdown.ts:41-122` ✅ 优雅关闭协议
- `packages/core/src/infrastructure/system-events.ts:55-100` ✅ enqueueSystemEvent/drainSystemEvents
- `packages/core/src/agent/lane-queue.ts:21-80` ✅ LaneQueue 三车道并发 + sessionKey 串行
- `packages/shared/src/constants.ts:40-44` ✅ LANE_CONCURRENCY main:4 / subagent:8 / cron:2
- `packages/core/src/server.ts:890-906` ✅ registerShutdownHandler 优先级链路
- `packages/core/src/server.ts:962` ✅ cronRunner.start() 延迟启动
- `packages/core/src/server.ts:1060, 1107-1111` ✅ createHeartbeatExecuteFn + HeartbeatManager.startAll
- `packages/core/src/routes/cron.ts:1-75` ✅ Cron REST 路由（无安全扫描）
- `packages/core/src/agent/agent-manager.ts:420-438` ✅ AGENTS.md Standing Orders 模板
- `packages/core/src/infrastructure/db/migrations/008_cron_jobs.sql:1-17` ✅ cron_jobs 表 schema
- `packages/core/src/infrastructure/db/migrations/016_cron_job_state.sql:1-6` ✅ consecutive_errors / last_run_status 字段

### 6.2 hermes 研究引用（章节 §）

- `.research/18-cron-background.md` §1 架构图（4 层 CLI/Tool → Jobs/Scheduler → Gateway Ticker → 14 平台 delivery）
- `.research/18-cron-background.md` §2.2 CronJob 对象字段（L64-96）
- `.research/18-cron-background.md` §2.3 Schedule 对象 3 kind（once/interval/cron）
- `.research/18-cron-background.md` §2.4 持久化格式（jobs.json + output/ + .tick.lock）
- `.research/18-cron-background.md` §3.1 parse_schedule 三类优先级
- `.research/18-cron-background.md` §3.2 compute_next_run
- `.research/18-cron-background.md` §3.3 过期 Job 宽恕期快进（2h/30m 半周期）
- `.research/18-cron-background.md` §3.4 tick 主循环 + fcntl 文件锁
- `.research/18-cron-background.md` §3.5 run_job sequence 图 + AIAgent 实例化
- `.research/18-cron-background.md` §3.6 投递路径 + 14 个 _KNOWN_DELIVERY_PLATFORMS
- `.research/18-cron-background.md` §3.7 create_job 入口 + 原子写入
- `.research/18-cron-background.md` §3.8 mark_job_run + repeat 计数 + 自动删除
- `.research/18-cron-background.md` §4.1 parse_schedule 源码
- `.research/18-cron-background.md` §4.2 _build_job_prompt + SILENT 约定
- `.research/18-cron-background.md` §4.3 gateway _start_cron_ticker
- `.research/18-cron-background.md` §4.4 _run_job_script 路径遍历防护
- `.research/18-cron-background.md` §4.5 cronjob_tools 10 类 Prompt 注入扫描 + 零宽字符
- `.research/18-cron-background.md` §5 模块交互（AIAgent / Gateway / hermes_state / redact / delivery）
- `.research/18-cron-background.md` §7 延伸（#1 JSON vs SQLite / #2 文件锁 / #3 SILENT / #4 无重试设计 / #5 脚本沙箱）

### 6.3 关联差距章节

本章的配套深入见：

- [`05-agent-loop-gap.md`](./05-agent-loop-gap.md) — Agent Kernel queryLoop 主循环（本章的 Heartbeat executeFn 通过 /send 打到这里），ADDENDUM "活动心跳"与 Gateway 流式保活的差异
- [`11-environments-spawn-gap.md`](./11-environments-spawn-gap.md) — spawn_agent 与 Cron 共享 LaneQueue（subagent 车道 vs cron 车道），隔离 session 语义
- [`14-state-sessions-gap.md`](./14-state-sessions-gap.md) — session key 生成规则 + §3.6 Heartbeat/Cron 会话隔离 + §3.7 System Events 队列 + §3.9 LaneQueue 并发锁（本章 §3.4 / §3.8 / §3.11 的底层依赖）
- [`17-trajectory-compression-gap.md`](./17-trajectory-compression-gap.md) — Cron 独立 session 与 Heartbeat 共享主 session 的压缩策略差异（本章 §3.4 的下游影响）

---

**本章完成**。机制总计 15 个（🔴 2 / 🟡 3 / 🟢 10），综合判定 🟡 **部分覆盖，含多项 🟢 明确反超**。EvoClaw Cron/Heartbeat 双轨架构在**调度形态**（§3.1）、**会话隔离**（§3.4）、**管道复用**（§3.5）、**意识注入**（§3.9 / §3.11）、**并发控制**（§3.8）、**可观测性**（§3.6 / §3.15）、**关闭协议**（§3.13）七个维度显著超越 hermes 单轨设计；在**宽恕期补跑**（§3.12）和**Cron Prompt 注入防护**（§3.14）两个细粒度安全/可用性维度需要补齐。
