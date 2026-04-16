# 14 — 状态与会话 (SessionDB / conversation_log) 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/14-state-sessions.md`（~600 行，Phase C1 draft）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`hermes_state.py:1-1304` + `tests/test_hermes_state.py` ~1200 行
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16）
> **综合判定**: 🟡 **部分覆盖，含多项 🟢 反超**（架构形态差异显著）

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes `SessionDB`**（`.research/14-state-sessions.md` §1-§2） — 单文件 SQLite + FTS5 + WAL 持久化层（`~/.hermes/state.db`）。核心模型：`sessions` 表（26 字段，含 `parent_session_id` FK）+ `messages` 表（13 字段，含 `reasoning` / `reasoning_details` / `codex_reasoning_items`）+ `messages_fts` 虚拟表（BM25 排名 + snippet 高亮）。整体强调**持久化深度**（Token/Billing/Reasoning 全入库）与**跨会话搜索**（FTS5 + 3 个同步 trigger）。写入层 `_execute_write` 以 `threading.Lock` + `BEGIN IMMEDIATE` + 15 次 jitter 重试 + 每 50 次 `PRAGMA wal_checkpoint(PASSIVE)` 构建 4 层并发保护。

**EvoClaw 会话子系统** — 由多个协作组件构成，**没有统一的 SessionDB 类**：
- `packages/core/src/routing/session-key.ts:12-19` `generateSessionKey()` — 构造 `agent:<agentId>:<channel>:<chatType>:<peerId>` 组合键
- `packages/core/src/routing/binding-router.ts:26-95` `BindingRouter` — Channel → Agent 最具体优先匹配
- `packages/core/src/infrastructure/db/migrations/004_conversation_log.sql` + `022_incremental_persist.sql` + `023_session_runtime_state.sql` + `019_session_summary.sql` — 日志/快照/摘要三表分离
- `packages/core/src/agent/kernel/incremental-persister.ts:43-232` — per-turn 批量持久化（100ms batch + streaming/final/orphaned 状态机）
- `packages/core/src/infrastructure/system-events.ts:37-150` — per-session 内存事件队列
- `packages/core/src/agent/lane-queue.ts:21-140` — 按 sessionKey 串行的并发锁
- `packages/core/src/scheduler/heartbeat-runner.ts:207-233` / `scheduler/cron-runner.ts:107-148` — Heartbeat 共享主会话 vs Cron 独立 session 分流
- `packages/core/src/routes/fork-session.ts:31-103` — Fork（INSERT...SELECT 单事务）

**量级对比**: hermes 单文件 1304 行 + 1200 行测试聚合于 `SessionDB`。EvoClaw 将同等职责拆为 session-key/binding-router/incremental-persister/lane-queue/system-events 5 个模块，每个 100-250 行，总量相当但耦合度低、可替换性高。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | Session 抽象维度 | 🟡 | hermes 一张 sessions 表含 26 字段；EvoClaw 用组合 key + agents/conversation_log/runtime_state 三张表 |
| §3.2 | Session Key 路由（多租户定位） | 🟢 | **反超**：EvoClaw 内建 `agent:<id>:<channel>:<dm|group>:<peer>` 5 维组合键，hermes 仅单一 UUID |
| §3.3 | 持久化层（消息主表） | 🟡 | conversation_log 字段密度低于 hermes messages（无 reasoning_details / codex_reasoning_items） |
| §3.4 | WAL 写入保护 | 🟡 | EvoClaw 仅 WAL + `foreign_keys=ON`；缺 `BEGIN IMMEDIATE` + 15 次 jitter retry + 定期 `wal_checkpoint` |
| §3.5 | 会话恢复（崩溃后加载） | 🟢 | **反超**：EvoClaw `streaming → orphaned → final` 三态崩溃恢复，hermes 无等价机制 |
| §3.6 | 会话隔离（Heartbeat vs Cron） | 🟢 | **反超**：EvoClaw `isolatedSession` / cron `agent:<id>:cron:<jobId>` 明确隔离，hermes 无对应语义 |
| §3.7 | System Events 队列（意识注入） | 🟢 | **反超**：per-session 内存队列 + 去重 + 噪音过滤 + 时间戳格式化，hermes 无 |
| §3.8 | Binding Router（Channel → Agent） | 🟢 | **反超**：4 级最具体优先匹配，hermes 无对应机制 |
| §3.9 | 并发锁（同 session 串行） | 🟢 | **反超**：LaneQueue 按 sessionKey 保证串行 + 三车道并发隔离，hermes 仅 `threading.Lock` 全局锁 |
| §3.10 | 会话元数据（last_activity / tokens / billing） | 🔴 | agents.last_chat_at 粒度粗；无 sessions.input/output/cache tokens / billing 字段 |
| §3.11 | FTS5 全文搜索（跨会话检索） | 🔴 | hermes 有 messages_fts + snippet + 3 个 trigger；EvoClaw FTS5 仅用于记忆检索，conversation_log 无 FTS |
| §3.12 | 会话分页与列表 | 🟡 | `/recents` 用 SQL 窗口函数做列表；hermes `list_sessions_rich` 的 correlated subquery + 预览 63 字符 EvoClaw 无等价 |
| §3.13 | Fork / 会话分裂 | 🟢 | **反超**：EvoClaw Fork 同时复制 log + summary + runtime_state + file_attributions；hermes 仅 `parent_session_id` FK |
| §3.14 | Session 清理 / 归档 | 🔴 | hermes `prune_sessions(older_than_days)` / `delete_session(cascade)`；EvoClaw 无通用清理入口 |

**统计**: 🔴 3 / 🟡 4 / 🟢 7（其中 6 项明确反超）。

---

## 3. 机制逐条深度对比

每条同时给出 **hermes 实现**（源码行号引用自 `.research/14-state-sessions.md`）+ **EvoClaw 实现**（带源码行号）+ **判定与分析**。

### §3.1 Session 抽象维度

**hermes**（`.research/14-state-sessions.md` §2.1，`hermes_state.py:81-109`）— 单表 26 字段承载全部会话元数据:

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,           -- UUID
  source TEXT NOT NULL,          -- 'cli' / 'telegram' / 'discord' / ...
  user_id TEXT,                  -- gateway 维度的对端 ID
  model TEXT,                    -- 该会话首选模型
  model_config TEXT,             -- JSON: temperature/max_tokens/...
  system_prompt TEXT,            -- 完整 prompt（可能 10KB+）
  parent_session_id TEXT,        -- 压缩后 split 的继承链
  started_at REAL NOT NULL,
  ended_at REAL,
  end_reason TEXT,
  message_count INTEGER,
  tool_call_count INTEGER,
  input_tokens INTEGER, output_tokens INTEGER,
  cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER,
  billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT,
  estimated_cost_usd REAL, actual_cost_usd REAL,
  cost_status TEXT, cost_source TEXT, pricing_version TEXT,
  title TEXT,
  FOREIGN KEY (parent_session_id) REFERENCES sessions(id)
);
```

**EvoClaw** — 无 sessions 表，**组合 key + 多表协作**:

```typescript
// packages/core/src/routing/session-key.ts:12-19
export function generateSessionKey(
  agentId: string,
  channel: string = 'default',
  chatType: string = 'direct',
  peerId: string = '',
): SessionKey {
  return `agent:${agentId}:${channel}:${chatType}:${peerId}` as SessionKey;
}
```

```sql
-- packages/core/src/infrastructure/db/migrations/004_conversation_log.sql:1-14
CREATE TABLE conversation_log (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  ...
);
```

- `agents` 表保管模型配置 / soul / last_chat_at（`migrations/011_agent_last_chat.sql:2`）
- `session_summaries`（`migrations/019_session_summary.sql:2-13`）保管压缩摘要
- `session_runtime_state`（`migrations/023_session_runtime_state.sql:2-10`）保管 CollapseState / FileStateCache 等

**判定 🟡**：
- hermes 的"把一切都装进 sessions 表"模式**查询简单**（单表扫描可得全景），但**违反第三范式**（system_prompt 重复存储、model 字段在 agents 和 sessions 中冲突）
- EvoClaw 的**多表 + 组合 key** 模式耦合度低，但**缺少 sessions 聚合视图**——要列出"所有活跃会话 + 最后消息时间 + 消息总数"需要 `/recents` 路由用窗口函数临时聚合（`routes/chat.ts:351-372`），非一次索引查找
- 架构取向不同，各有优劣。本节归为🟡因为 EvoClaw **聚合查询需要计算而非查询**

---

### §3.2 Session Key 路由（多租户定位）

**hermes** — Session ID 是 **不透明 UUID**:

```python
# hermes_state.py create_session:
session_id = str(uuid.uuid4())  # 示意
```

- 通过 `source` 字段（"cli" / "telegram" / "discord"）区分渠道
- 通过 `user_id` 字段区分对端
- **没有结构化可解析的 session key**—— 所有路由判断靠 WHERE source=? AND user_id=? 做 column 过滤

**EvoClaw**（`packages/core/src/routing/session-key.ts:1-41`）:

```typescript
// §3.1 已引用 generateSessionKey
// packages/core/src/routing/session-key.ts:22-30
export function parseSessionKey(key: SessionKey | string): ParsedSession {
  const parts = key.split(':');
  return {
    agentId: parts[1] ?? '',
    channel: parts[2] ?? 'default',
    chatType: parts[3] ?? 'direct',
    peerId: parts[4] ?? '',
  };
}

// packages/core/src/routing/session-key.ts:33-40
export function isGroupChat(key: SessionKey | string): boolean {
  return parseSessionKey(key).chatType === 'group';
}
```

实际应用（`packages/core/src/context/plugins/session-router.ts:9-19`）:
```typescript
export const sessionRouterPlugin: ContextPlugin = {
  name: 'session-router',
  priority: 10,
  async beforeTurn(ctx: TurnContext) {
    const info = parseSessionKey(ctx.sessionKey);
    ctx.injectedContext.push(
      `[Session] channel=${info.channel} chatType=${info.chatType} peerId=${info.peerId}`
    );
  },
};
```

子代理/心跳/cron 的 session key 前缀规约（`sub-agent-spawner.ts:290` / `heartbeat-runner.ts:210` / `cron-runner.ts:127`）:
- `agent:<id>:local:subagent:<taskId>` — 子代理
- `agent:<id>:heartbeat` — 独立心跳
- `agent:<id>:cron:<jobId>` — Cron

**判定 🟢 反超**：
- 5 维组合 key 天然承载 (agent, channel, chat_type, peer) 四元组，`LIKE 'agent:%:local:%'` / `NOT LIKE '%:cron:%'`（`heartbeat-runner.ts:222-225`）做语义过滤不需要 join
- 前缀保留设计使得 session 类型可通过**字符串后缀**（`:subagent:` / `:heartbeat` / `:cron:` / `:fork:`）快速分类
- Session 路由插件（`session-router.ts:13-17`）自动将 parsed 信息注入 LLM 上下文，让模型感知"现在是私聊还是群聊"
- hermes 同等语义需要 `SELECT * FROM sessions WHERE source='telegram' AND user_id='U123'` + 额外列区分 isolated session（它根本没有这个概念）

**代价**：session key 作为主键拼接字符串，**不可变更**（agent 重命名不影响 UUID，但 EvoClaw 的 channel 字段一旦写入就固化）。这不是严重问题，因为 channel 标识在业务层是稳定的。

---

### §3.3 持久化层（消息主表）

**hermes**（`.research/14-state-sessions.md` §2.1，`hermes_state.py:112-126`）:

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT,
  tool_call_id TEXT,
  tool_calls TEXT,              -- JSON: [{"id":..., "function":{...}}, ...]
  tool_name TEXT,
  timestamp REAL NOT NULL,
  token_count INTEGER,
  finish_reason TEXT,
  reasoning TEXT,                -- Anthropic thinking / OpenAI reasoning 原始文本
  reasoning_details TEXT,        -- 结构化详情 JSON
  codex_reasoning_items TEXT     -- Codex Responses 格式 JSON
);
```

13 字段覆盖 tool_call_id、finish_reason、3 套 reasoning 字段（provider 分流）。

**EvoClaw**（`packages/core/src/infrastructure/db/migrations/004_conversation_log.sql:1-18` + `022_incremental_persist.sql:4-6` + `021_conversation_log_hierarchy.sql:4-6` + `015_conversation_tool_calls.sql`）:

```sql
CREATE TABLE conversation_log (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_input TEXT,
  tool_output TEXT,
  compaction_status TEXT NOT NULL DEFAULT 'raw'
    CHECK (compaction_status IN ('raw','extracted','compacted','archived')),
  compaction_ref TEXT,
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- + 022 扩展：turn_index / kernel_message_json / persist_status
-- + 021 扩展：parent_message_id / is_sidechain / entry_type
-- + 015 扩展：tool_calls_json
```

关键字段：
- `compaction_status` — hermes 没有，EvoClaw 追踪消息 raw/extracted/compacted/archived 状态（Sprint 15.12 记忆系统配套）
- `kernel_message_json`（`022_incremental_persist.sql:5`）— 完整序列化 KernelMessage，支持 thinking / redacted_thinking / tool_use / tool_result 全量字段
- `parent_message_id` + `is_sidechain`（`021:4-5`）— 子代理消息关联
- `entry_type`（`021:6`）— 区分 `message` / `compaction_boundary` / `memory_saved` / `agent_spawned` / `agent_completed` / `error_snapshot`（`conversation-logger.ts:4-10`）

**判定 🟡**：
- 🟢 EvoClaw 独有：compaction_status 状态机、entry_type 事件类型、kernel_message_json 完整保真、parent_message_id/is_sidechain 子代理树形结构
- 🔴 EvoClaw 缺失：reasoning_details（结构化思考详情）、codex_reasoning_items（Codex 格式）、finish_reason（stop / tool_calls / length 等 provider-reported 终止原因）
- 现状：EvoClaw 的 `kernel_message_json` 实际把 thinking/signature/redacted_thinking 都存进了 JSON（见 `05-agent-loop-gap.md §3.4`），所以**信息量未丢**，只是**没有独立列可索引/查询**。若未来需要按 "最近生成 thinking 超过 1KB 的所有 session" 这类分析，缺独立列会变慢

---

### §3.4 WAL 写入保护

**hermes**（`.research/14-state-sessions.md` §3.1-§3.2，`hermes_state.py:157, 164-214`）— 4 层并发保护:

```python
# 初始化
self._conn.execute("PRAGMA journal_mode=WAL")
self._conn.execute("PRAGMA foreign_keys=ON")
# isolation_level=None + timeout=1.0s

def _execute_write(self, fn):
    for attempt in range(15):  # _WRITE_MAX_RETRIES
        try:
            with self._lock:                          # threading.Lock
                self._conn.execute("BEGIN IMMEDIATE") # 立即获取 WAL 写锁
                try:
                    result = fn(self._conn)
                    self._conn.commit()
                except BaseException:
                    self._conn.rollback()
                    raise
            self._write_count += 1
            if self._write_count % 50 == 0:           # _CHECKPOINT_EVERY_N_WRITES
                self._try_wal_checkpoint()             # PRAGMA wal_checkpoint(PASSIVE)
            return result
        except sqlite3.OperationalError as exc:
            if "locked" in str(exc).lower() or "busy" in str(exc).lower():
                time.sleep(random.uniform(0.020, 0.150))  # 20-150ms jitter
                continue
            raise
```

**EvoClaw**（`packages/core/src/infrastructure/db/sqlite-store.ts:17-74`）:

```typescript
export class SqliteStore {
  constructor(dbPath?: string) {
    // ...
    this.db = createDatabase(this.dbPath);
    pragmaSet(this.db, 'journal_mode', 'WAL');      // ✅ WAL 启用
    pragmaSet(this.db, 'foreign_keys', 'ON');       // ✅ FK 约束启用
  }

  run(sql: string, ...params: unknown[]): RunResult {
    return this.db.prepare(sql).run(...params);     // ❌ 无 lock / retry / checkpoint
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();                // 使用 bun:sqlite/better-sqlite3 内置事务
  }
}
```

**增量写入层**（`packages/core/src/agent/kernel/incremental-persister.ts:204-231`）:
```typescript
private drainQueue(): void {
  if (this.queue.length === 0) return;
  const batch = this.queue.splice(0);
  try {
    this.store.transaction(() => {
      for (const entry of batch) {
        this.store.run(`INSERT OR IGNORE INTO conversation_log ...`, ...);
      }
    });
  } catch (err) {
    log.warn(`批量写入失败 (${batch.length} 条): ${err}`);
    // 不重试，不阻塞 — 降级跳过
  }
}
```

**判定 🟡**：
- 🟢 EvoClaw 正确启用 WAL + foreign_keys（与 hermes 对齐）
- 🟢 EvoClaw 用 100ms batch + `INSERT OR IGNORE` + 事务包裹替代了 hermes 的"每次 write 都 BEGIN IMMEDIATE"，**在 Node/Bun 单线程事件循环下本就没有"两个 Python 线程抢锁"的问题**（bun:sqlite/better-sqlite3 都是同步 API 串行执行）
- 🔴 缺 `wal_checkpoint(PASSIVE)` 定期调用——长期运行时 WAL 文件会无限增长（SQLite 默认 `-wal` 文件 ~4MB 后自动 PASSIVE checkpoint，但主动控制间隔更稳）
- 🔴 缺显式 `busy_timeout` / `PRAGMA busy_timeout=1000`——bun:sqlite 默认 5s busy timeout 但 better-sqlite3 可能更短
- 🔴 崩溃中途的 batch 会丢失（降级跳过）——这是设计取舍（"不阻塞 Agent 循环"），但相比 hermes 15 次 jitter retry 更激进

**风险场景**: 多 sidecar 进程同时访问同一 DB 文件（应用升级切换期间）会触发 `SQLITE_BUSY`，EvoClaw 的"不重试降级跳过"会丢消息。实际 EvoClaw 设计是单 sidecar 进程，无此并发写风险，但**未来 HA 部署**（两个 sidecar 并行 + 共享 DB）需要补齐。

---

### §3.5 会话恢复（崩溃后加载历史）

**hermes**（`.research/14-state-sessions.md` §3.6 `list_sessions_rich` + `get_messages`）— **基于完整提交模型**:

- 所有 write 都在 `_execute_write` 内 commit 后返回
- 崩溃只会丢失"未 commit 的 fn"（通常 = 1 条 message 的 INSERT）
- 恢复就是重新查 `SELECT * FROM messages WHERE session_id = ?`
- **没有"部分写入 / 中断恢复"的概念**——一条消息要么存在要么不存在

**EvoClaw**（`packages/core/src/agent/kernel/incremental-persister.ts:42-192`）— **streaming → final/orphaned 三态机**:

```typescript
// migrations/022_incremental_persist.sql:6-12
ALTER TABLE conversation_log ADD COLUMN persist_status TEXT NOT NULL DEFAULT 'final'
  CHECK (persist_status IN ('streaming', 'final', 'orphaned'));

CREATE INDEX IF NOT EXISTS idx_convlog_persist
  ON conversation_log(agent_id, session_key, persist_status)
  WHERE persist_status != 'final';
```

```typescript
// incremental-persister.ts:207-226 — 写入时标为 streaming
this.store.run(
  `INSERT OR IGNORE INTO conversation_log
   (id, agent_id, session_key, role, content, turn_index, kernel_message_json, persist_status, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'streaming', ?)`, ...);

// incremental-persister.ts:108-124 — queryLoop 正常结束标为 final
finalize(): void {
  this.flush();
  this.store.run(
    `UPDATE conversation_log
     SET persist_status = 'final'
     WHERE agent_id = ? AND session_key = ? AND persist_status = 'streaming'
       AND id LIKE ?`,
    this.agentId, this.sessionKey, `${this.batchId}:%`,
  );
}

// incremental-persister.ts:144-192 — 下次启动时 orphaned → 加载 → 标回 final
static loadOrphaned(store, agentId, sessionKey): KernelMessage[] {
  store.run(
    `UPDATE conversation_log SET persist_status = 'orphaned'
     WHERE agent_id = ? AND session_key = ? AND persist_status = 'streaming'`,
    agentId, sessionKey,
  );
  const rows = store.all(
    `SELECT kernel_message_json, turn_index FROM conversation_log
     WHERE ... AND persist_status = 'orphaned' AND kernel_message_json IS NOT NULL
     ORDER BY turn_index ASC, rowid ASC`, ...);
  // 反序列化 + 合并回历史 + 标为 final
}
```

**判定 🟢 反超**：
- hermes 依赖 WAL + commit 原子性，**没有"中断但半提交"场景**——但这也意味着"LLM 流式生成一半崩溃后的 partial text"无法保存（hermes 压根不保存 partial）
- EvoClaw 有**真正的断点续传语义**：sidecar 崩溃重启 → `loadOrphaned` 把上次 streaming 状态的消息复活 → chat.ts 在 loadMessageHistory 时自动合并（`routes/chat.ts:148-156`）
- 部分索引 `WHERE persist_status != 'final'`（`022:10-12`）只索引少量未完成记录，**零查询开销**
- hermes 在 `.research/14-state-sessions.md §7` 中提到"messages.tool_name 列——仅 role='tool' 时设值？" 这种边界问题在 EvoClaw 通过 `kernel_message_json` 一次性解决

**注意**：EvoClaw 的 batchId 机制（`incremental-persister.ts:55-57`）避免了多实例相互覆盖 finalize——`id LIKE '<batchId>:%'` 精确定位本次 persister 写入的记录。

---

### §3.6 会话隔离（Heartbeat vs Cron）

**hermes** — 无此概念。session 只分 "source" (cli / telegram / ...)，所有轮次共享同一 session_id 的 messages 栈。

**EvoClaw**（`packages/core/src/scheduler/heartbeat-runner.ts:207-233` + `scheduler/cron-runner.ts:107-148`）:

**Heartbeat 双模式**:
```typescript
// heartbeat-runner.ts:207-213
private resolveSessionKey(): string {
  if (this.config.isolatedSession) {
    return `agent:${this.agentId}:heartbeat`;       // 独立会话
  }
  return this.resolveMainSessionKey();               // 共享主会话
}

// heartbeat-runner.ts:217-233
private resolveMainSessionKey(): string {
  if (this.db) {
    // 查找最近的本地对话 session（排除 heartbeat/cron/boot/subagent 会话）
    const row = this.db.get(
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
```

**Cron 双模式**（`cron-runner.ts:105-148`）:
```typescript
// event 模式：注入系统事件到主会话，不走隔离 session
if (job.action_type === 'event') {
  const mainSessionKey = `agent:${job.agent_id}:local:direct:local-user`;
  enqueueSystemEvent(text, mainSessionKey);         // 主会话事件注入
  continue;
}

// 默认模式：通过 LaneQueue cron 车道执行（隔离会话）
const sessionKey = `agent:${job.agent_id}:cron:${job.id}`;
this.laneQueue.enqueue({ sessionKey, lane: 'cron', task: ..., timeoutMs: 300_000 });
```

**判定 🟢 反超**：
- 明确区分两种语义：
  1. **共享主会话**（heartbeat default / cron event）：运行结果用户立即可见，上下文延续
  2. **隔离会话**（heartbeat isolated / cron 默认）：后台任务独立 session，不污染主对话历史
- Session key 前缀（`:heartbeat` / `:cron:<jobId>` / `:subagent:<taskId>` / `:boot`）支持通过 `LIKE` 过滤做排除——`heartbeat-runner.ts:222-225` 的查询精妙地排除了所有非用户对话
- hermes 若要实现"心跳不污染主对话"，要么创建新 session_id（丢失上下文），要么加新字段（schema 变更）。EvoClaw 通过 **key 约定**解决，零 schema 变更

**企业价值**: 客户端显示"最近对话"时过滤 cron/heartbeat，`/recents` 路由自动屏蔽（`routes/chat.ts:363-366`），UI 不会被自动化噪音淹没。

---

### §3.7 System Events 队列（意识注入）

**hermes** — 无对应机制。

**EvoClaw**（`packages/core/src/infrastructure/system-events.ts:37-150`）— **per-session 内存事件队列**:

```typescript
// system-events.ts:37-52
const MAX_EVENTS = 20;

interface SessionQueue {
  queue: SystemEvent[];
  lastText: string | null;
}

const queues = new Map<string, SessionQueue>();

// system-events.ts:55-89 — 入队（3 层去重）
export function enqueueSystemEvent(
  text: string, sessionKey: string, opts?: EnqueueOpts,
): boolean {
  const cleaned = text.trim();
  if (!cleaned || !sessionKey) return false;
  const entry = getOrCreateQueue(sessionKey);
  if (entry.lastText === cleaned) return false;      // 连续重复去重
  entry.lastText = cleaned;
  if (opts?.contextKey) {
    const idx = entry.queue.findIndex(e => e.contextKey === opts.contextKey);
    if (idx >= 0) entry.queue.splice(idx, 1);       // contextKey 去重（保留最新）
  }
  entry.queue.push({ text: cleaned, ts: Date.now(), contextKey: opts?.contextKey ?? null, ... });
  if (entry.queue.length > MAX_EVENTS) entry.queue.shift();  // 容量限制
  return true;
}

// system-events.ts:126-135 — drain 时噪音过滤 + 时间戳格式化
export function drainFormattedSystemEvents(sessionKey: string): string[] {
  const events = drainSystemEventEntries(sessionKey);
  return events
    .filter(e => !isHeartbeatNoiseEvent(e.text))
    .map(e => {
      const ts = new Date(e.ts).toISOString().slice(11, 19); // HH:mm:ss
      return `[${ts}] ${e.text}`;
    });
}
```

**注入点**（`routes/chat.ts:1034-1038`）:
```typescript
// System Events 注入 — drain 待处理事件（噪音过滤 + 时间戳格式化），前缀拼接到 LLM 输入消息
const systemLines = drainFormattedSystemEvents(sessionKey);
const effectiveMessage = systemLines.length > 0
  ? `System:\n${systemLines.map(l => `  ${l}`).join('\n')}\n\n${message}`
  : message;
```

**生产者**：
- Cron event 模式（`cron-runner.ts:115`）— 定时任务注入主会话
- Heartbeat wake（`heartbeat-wake.ts`）— 用户操作触发的唤醒
- Task notification（`task-notifications.ts`）— 子代理/cron 完成回流
- `routes/system-events.ts:23` — 外部 REST API 手动入队

**判定 🟢 反超**：
- 这是 EvoClaw 架构的**关键创新**——在不打断用户对话流的前提下，把"后台系统事件"折叠进下一次 user turn 的 prompt 前缀，模型像"一觉醒来"看到时间线
- 3 层去重（连续重复 + contextKey 最新 + 20 容量）防止高频事件爆内存
- 噪音过滤（`isHeartbeatNoiseEvent`）自动屏蔽"Read HEARTBEAT.md"之类的自引用干扰
- hermes 要实现同等效果，需要在主循环前显式注入 system message，缺少**会话级事件总线**抽象

**与 Heartbeat 的协同**（`heartbeat-runner.ts:119-141`）：
```typescript
// HEARTBEAT.md 空文件预检 — 无可执行内容且无系统事件时跳过 LLM 调用
if (isHeartbeatContentEffectivelyEmpty(heartbeatContent)) {
  if (!hasSystemEvents(sessionKey)) return 'skipped';
}
// 有 system events 时覆盖触发原因为 cron-event
const effectiveReason = pendingEvents.length > 0 ? 'cron-event' as const : reason;
```
Heartbeat + SystemEvents 的**事件驱动互补**让"空轮询"能跳过 LLM 调用（成本优化）。

---

### §3.8 Binding Router（Channel → Agent 最具体优先匹配）

**hermes** — 无对应机制。每个 gateway 独立管理 session ↔ user 映射（见 `.research/14-state-sessions.md §5` 提到 `gateway/session.py:SessionStore` 是 gateway 维度的会话管理，但这是**不同存储**且 hermes 研究文档未展开）。

**EvoClaw**（`packages/core/src/routing/binding-router.ts:26-95`）— **4 级最具体优先**:

```typescript
// binding-router.ts:63-94
resolveAgent(message: ChannelMessage): string | null {
  // 1. peerId 精确匹配（个人号精准分配）
  if (message.peerId) {
    const exact = this.db.get(
      'SELECT * FROM bindings WHERE channel = ? AND peer_id = ? ORDER BY priority DESC LIMIT 1',
      message.channel, message.peerId,
    );
    if (exact) return exact['agent_id'];
  }
  // 2. accountId + channel 匹配（群号级别）
  if (message.accountId) {
    const account = this.db.get(
      'SELECT * FROM bindings WHERE channel = ? AND account_id = ? AND peer_id IS NULL ORDER BY priority DESC LIMIT 1',
      message.channel, message.accountId,
    );
    if (account) return account['agent_id'];
  }
  // 3. channel 匹配（渠道默认）
  const channelMatch = this.db.get(
    'SELECT * FROM bindings WHERE channel = ? AND account_id IS NULL AND peer_id IS NULL AND is_default = 0 ORDER BY priority DESC LIMIT 1',
    message.channel,
  );
  if (channelMatch) return channelMatch['agent_id'];
  // 4. 默认 Agent
  const defaultAgent = this.db.get(
    'SELECT * FROM bindings WHERE is_default = 1 ORDER BY priority DESC LIMIT 1',
  );
  return defaultAgent ? defaultAgent['agent_id'] : null;
}
```

配合 `bindings` 表（`migrations/007_bindings.sql`）存储 agent_id / channel / account_id / peer_id / priority / is_default。

**判定 🟢 反超**：
- 这是 EvoClaw 面向**企业多 Channel 场景**的核心路由能力——同一 sidecar 服务多个渠道（wechat / telegram / feishu / email），每个渠道再细分到群/个人/用户级别，动态选择不同 Agent 应答
- hermes 作为 **CLI-first 工具**没有此需求（用户直接在 CLI 指定模型），但这使它在部署为企业共享服务时**缺少多租户路由层**
- 优先级设计（priority DESC + LIMIT 1）允许管理员配置 overrides（例如"此 peerId 强制走 A agent，即使 channel 默认是 B"）

**与 §3.2 Session Key 的关系**：BindingRouter 解析 `message.channel/accountId/peerId` → 得到 `agentId` → `generateSessionKey(agentId, channel, chatType, peerId)` 生成具体 session key。两者职责分层清晰：Binding 解决"谁接"，SessionKey 解决"在哪谈"。

---

### §3.9 并发锁（同 session 串行）

**hermes**（`.research/14-state-sessions.md` §3.1）— 单层 `threading.Lock`:

```python
# hermes_state.py:164-214
with self._lock:                               # 进程级全局互斥
    self._conn.execute("BEGIN IMMEDIATE")
    # ...
```

- 所有写入串行化
- 无 per-session 锁粒度
- `lease(cred)` 是凭据级而非会话级

**EvoClaw**（`packages/core/src/agent/lane-queue.ts:22-139`）— **三车道 + per-session 串行**:

```typescript
// lane-queue.ts:22-26
private queues: Map<LaneName, QueueItem<any>[]> = new Map();
private running: Map<LaneName, Set<string>> = new Map();
private runningKeys: Map<string, string> = new Map();  // sessionKey -> itemId（串行保障）
private runningItems: Map<string, QueueItem<any>> = new Map();

// lane-queue.ts:102-138 drain
while (queue.length > 0 && runningSet.size < this.concurrency[lane]) {
  // 查找 sessionKey 未在运行中的下一个任务（串行保障）
  const idx = queue.findIndex(item => !this.runningKeys.has(item.sessionKey));
  if (idx === -1) break;
  const [item] = queue.splice(idx, 1);
  runningSet.add(item.id);
  this.runningKeys.set(item.sessionKey, item.id);
  this.runningItems.set(item.sessionKey, item);
  // ... 执行，finally 清理 runningKeys
}
```

- 三车道 `main(4)` / `subagent(8)` / `cron(configurable)` 并发独立
- 同 sessionKey 的任务**永远串行**——即使车道有空位，已运行的 sessionKey 任务未完成时，其他同 key 任务跳过
- `abortRunning(sessionKey)` 支持精准中止（`lane-queue.ts:82-87`）

**判定 🟢 反超**：
- hermes 的"全局锁"在 CLI 单用户场景下够用，但多用户共享会话时成为瓶颈
- EvoClaw 的"per-session 串行 + 车道并发"是**典型 actor model**——每个 session 是独立 actor，多 actor 可并行，同一 actor 串行
- `abortRunning` 精准到 sessionKey 级别，hermes 要中止某 session 需要全局 `_interrupt_requested`，会影响其他并发任务
- 与 §3.5 的 per-session `IncrementalPersister.batchId` 配合：同一 sessionKey 同时只有一个 persister 实例，`batchId LIKE '<id>:%'` 的 finalize 天然不冲突

**企业价值**: 多租户场景下 Agent A 的长任务不阻塞 Agent B 的快速查询。主/子代理/定时任务用三条独立通道，子代理爆量不挤占主对话资源。

---

### §3.10 会话元数据（last_activity / tokens / billing）

**hermes**（`.research/14-state-sessions.md` §2.1 v5 迁移）:

```sql
-- sessions 表字段（§3.3 已引用）
input_tokens INTEGER, output_tokens INTEGER,
cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER,
billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT,
estimated_cost_usd REAL, actual_cost_usd REAL,
cost_status TEXT, cost_source TEXT, pricing_version TEXT
```

`update_token_counts(absolute=False)` 支持增量（`+= delta`）和绝对（`= value`）两种更新模式（`.research/14-state-sessions.md §3.4`）。

**EvoClaw**:

```sql
-- migrations/011_agent_last_chat.sql:2
ALTER TABLE agents ADD COLUMN last_chat_at TEXT;
```

- agents 级别有 `last_chat_at`，**但粒度是 agent 不是 session**
- `conversation_log.token_count`（`004:12`）是**每条消息**的 token 数，没有 session 聚合
- **无 cache_read / cache_write / reasoning_tokens 拆分字段**
- **无 billing 字段**（EvoClaw 的 cost 追踪在 `cost-tracker.ts`，使用独立表，非按 session 聚合到本层）

Session 级元数据散落在：
- `session_summaries.token_count_at / turn_count_at / tool_call_count_at`（`migrations/019:7-9`）— 摘要生成时快照
- `session_runtime_state`（`migrations/023:2-10`）— 任意 KV 状态（CollapseState / FileStateCache）

**判定 🔴**：
- EvoClaw 缺**session 级 usage 聚合表**。要回答 "session X 总花了多少钱" 需要扫 conversation_log 累加 token_count 并 join 价格表，不是 O(1) 查询
- hermes 的 `update_token_counts(absolute=True)` gateway 模式在 EvoClaw 无对应——gateway agent 多轮后一次性上报总数的场景 EvoClaw 未覆盖
- cache_read/cache_write 分离对 Prompt Cache 成本分析至关重要（见 `05-agent-loop-gap.md §3.12` 的 `PromptCacheMonitor`），EvoClaw 运行时有统计但**未写入会话表**

**补齐成本**: 新增 `session_usage` 表（session_key, agent_id, input_tokens, output_tokens, cache_read, cache_write, reasoning_tokens, estimated_cost_usd, actual_cost_usd, last_activity_at, tool_call_count, message_count, updated_at），写入时机接入 queryLoop 每轮 `roundResult.usage`。工作量 2-3 人日。

---

### §3.11 FTS5 全文搜索（跨会话检索）

**hermes**（`.research/14-state-sessions.md` §3.3，`hermes_state.py:135-154` + `999-1153`）:

```sql
-- FTS5 虚拟表 + 3 个同步 trigger
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content, content=messages, content_rowid=id
);
CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages ...
CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages ...
CREATE TRIGGER messages_fts_update AFTER UPDATE ON messages ...
```

```python
# _sanitize_fts5_query — 6 步消毒防注入
# search_messages — 3-way JOIN + snippet('>>>','<<<','...',40) + BM25 rank + 上下文附加
```

**EvoClaw**:

```bash
$ ls packages/core/src/infrastructure/db/
fts-store.ts  sqlite-store.ts  vector-store.ts  ...
```

- `fts-store.ts` 存在 ✅ — 但用于**记忆检索**（memory_units 的 FTS5）
- `conversation_log` 表**无对应 FTS5 虚拟表 / trigger**
- `grep -n "messages_fts\|conversation_log_fts" packages/core/src/infrastructure/db/migrations/` 零结果

**判定 🔴**：
- 跨会话"找我之前和 A 讨论过的 X 话题"这类查询 EvoClaw 无法做 FTS5，只能 `LIKE '%X%'`（无索引慢查询）或走记忆检索（不完整，因为记忆是压缩过的）
- hermes 的 snippet 高亮 + BM25 + 上下文附加（前后 1 条消息）对 UI 搜索体验关键
- EvoClaw 的 `session_search` 入口在**记忆层**实现，对原始对话日志不可见

**架构权衡**: EvoClaw 哲学是"压缩后的记忆 + 即时对话日志"，搜索需求下沉到记忆层（经过 LLM 提炼）。但**失去按关键字回溯原始对话**能力——这是 hermes 的一大优势，对调试/审计场景有价值。

**补齐成本**: 添加 `migrations/026_conversation_log_fts.sql`（CREATE VIRTUAL TABLE conversation_log_fts + 3 trigger），`fts-store.ts` 增加 `searchConversation()` 方法，search API 增加 endpoint。工作量 1-2 人日。

---

### §3.12 会话分页与列表

**hermes**（`.research/14-state-sessions.md` §3.6，`hermes_state.py:783-851`）:

```sql
-- list_sessions_rich: correlated subquery + preview(63 chars) + last_active
SELECT s.*,
  COALESCE((SELECT SUBSTR(REPLACE(m.content, X'0A', ' '), 1, 63)
            FROM messages m WHERE m.session_id = s.id AND m.role = 'user'
            ORDER BY m.timestamp, m.id LIMIT 1), '') AS _preview_raw,
  COALESCE((SELECT MAX(m2.timestamp) FROM messages m2 WHERE m2.session_id = s.id),
           s.started_at) AS last_active
FROM sessions s
WHERE include_children OR s.parent_session_id IS NULL  -- 默认排除 fork 子会话
ORDER BY s.started_at DESC
```

**EvoClaw**（`packages/core/src/routes/chat.ts:340-402`）— 窗口函数 + 过滤前缀:

```typescript
// /recents 路由
app.get('/recents', (c) => {
  const rows = store.all(
    `SELECT session_key, agent_id, content AS last_content,
            role AS last_role, created_at AS last_at, cnt AS msg_count
     FROM (
       SELECT cl.*,
         COUNT(*) OVER (PARTITION BY cl.session_key) AS cnt,
         ROW_NUMBER() OVER (PARTITION BY cl.session_key ORDER BY cl.created_at DESC) AS rn
       FROM conversation_log cl
       WHERE cl.role IN ('user', 'assistant')
         AND cl.session_key NOT LIKE '%:boot'
         AND cl.session_key NOT LIKE '%:heartbeat%'
         AND cl.session_key NOT LIKE '%:cron:%'
     ) sub
     WHERE rn = 1 ORDER BY last_at DESC LIMIT ?`, limit,
  );
  // 补充 Agent 信息 + 第一条用户消息作为 title（前 30 字）
});
```

**判定 🟡**:
- 🟢 EvoClaw 用窗口函数一次完成 "最近消息 + 总数 + 排序"，比 hermes 的 correlated subquery 性能更好（单次全表扫描 vs N 次嵌套查询）
- 🟢 通过 session_key `LIKE '%:cron:%'` 等前缀过滤自然屏蔽自动化会话
- 🟡 标题提取是**临时查询**（每次 /recents 都 N+1 次 SELECT 第一条 user 消息），hermes 把 title 作为 sessions 表持久字段（`set_session_title()` 一次性生成）
- 🔴 缺 `sanitize_title()` 机制（100 字符上限、Unicode 零宽过滤、部分唯一索引 `WHERE title IS NOT NULL`）——EvoClaw 标题就是"消息前 30 字"，不保证唯一、不做清理
- 🔴 缺 `get_next_title_in_lineage()` 的 `"My Session #2"` 编号逻辑

**优化点**: 给 conversation_log 加 `first_user_message_hash` 列 + generated column 做索引，或 /recents 查询结果做进程内缓存（60s TTL）。

---

### §3.13 Fork / 会话分裂

**hermes**（`.research/14-state-sessions.md` §2.1 v4 `parent_session_id`）:

```sql
-- sessions 表有 parent_session_id FK
parent_session_id TEXT,
FOREIGN KEY (parent_session_id) REFERENCES sessions(id)
```

- 压缩后创建新会话：`create_session(parent_session_id=old_id)` + `get_next_title_in_lineage("My Session #N")`
- **只记录谱系 FK，不复制消息**——新会话是从头开始的
- `list_sessions_rich(include_children=False)` 默认隐藏子会话

**EvoClaw**（`packages/core/src/routes/fork-session.ts:31-103`）— **完整复制**:

```typescript
// fork-session.ts:42-93 单事务复制 4 张表
store.transaction(() => {
  // 1. conversation_log 全部消息（新 id 前缀 + 新 session_key）
  store.run(
    `INSERT INTO conversation_log (...)
     SELECT ? || ':' || rowid, agent_id, ?, role, content, tool_name, ...
            turn_index, kernel_message_json, persist_status
     FROM conversation_log WHERE agent_id = ? AND session_key = ?`,
    crypto.randomUUID(), targetSessionKey, agentId, sourceSessionKey,
  );
  // 2. session_summaries（如有）
  store.run(`INSERT OR IGNORE INTO session_summaries ...`, ...);
  // 3. session_runtime_state（如有）
  store.run(`INSERT OR IGNORE INTO session_runtime_state ...`, ...);
  // 4. file_attributions（如有）
  store.run(`INSERT OR IGNORE INTO file_attributions ...`, ...);
});
```

新 session key 格式（`fork-session.ts:110-113`）:
```typescript
function generateForkSessionKey(sourceKey: string): string {
  const shortId = crypto.randomUUID().slice(0, 8);
  return `${sourceKey}:fork:<shortId>`;
}
```

**判定 🟢 反超**：
- EvoClaw Fork 是**真正的会话副本**，可在 fork 分支上继续对话不影响原会话——适合"在某个节点重新探索另一条路径"
- hermes 的 parent_session_id 仅仅是**谱系追踪**（知道这是从哪来的），fork 后新会话是空的，用户要重新建立上下文
- EvoClaw 一并复制 runtime_state 和 file_attributions，确保 fork 后"工具状态、文件归属"连贯
- 新 session key 带 `:fork:<hash>` 后缀，UI 显示时可识别"这是从 X 分叉来的"
- 性能：单事务 INSERT...SELECT 一次完成，不需要逐条 read + write

**与 §3.10 的关系**：Fork 后 usage 聚合是否应该继承？EvoClaw 当前未实现（因为无 session_usage 表），hermes 也没有明确处理（token counts 是 sessions 表的列，不会自动继承）。这是**两侧都未定义**的语义空白。

---

### §3.14 Session 清理 / 归档

**hermes**（`.research/14-state-sessions.md` §6 复刻清单）:

```python
def delete_session(self, session_id: str) -> None:
    """cascade delete 子会话"""

def prune_sessions(self, older_than_days: int, source: Optional[str] = None) -> int:
    """批量清理：删除 N 天前的 sessions（可选按 source 过滤）"""
```

`.research/14-state-sessions.md §7` 也提到："prune_sessions 的默认调用频率——是否有定时任务？还是只在用户手动调 `hermes prune`？" 作为未解之谜，但至少入口存在。

**EvoClaw** — 无等价 API:

```bash
$ grep -rn "pruneSession\|pruneConversation\|deleteConversation\|archive" packages/core/src/ | head -20
# 无命中 — 没有通用会话清理入口
```

仅有的 conversation_log cleanup 场景：
- `compaction_status = 'archived'` 字段存在（`004:10`）但**只记状态不触发删除**
- 压缩插件（`context-compactor.ts`）会把旧消息标为 `compacted`，原消息仍保留在表中

**判定 🔴**：
- 长期运行后 conversation_log 会无限增长
- 管理员无"清理 30 天前非活跃会话"的批量操作入口
- 删除单个 session（比如用户主动"删除这个对话"）必须手动 SQL
- 企业审计场景下"删除某用户所有数据"（GDPR）无工具支撑

**补齐成本**:
- `deleteSession(agentId, sessionKey)` 级联删除 log + summary + runtime_state + file_attributions（1 人日）
- `pruneSessions(olderThanDays, agentId?)` 按时间窗口批量归档（1 人日）
- `archiveSession(...)` 软删除（标 `compaction_status='archived'` + 移到冷表）（1-2 人日）
- 合计 3-4 人日

---

## 4. 建议改造蓝图（不承诺实施）

**P0**（高 ROI，建议尽快）:

| # | 项目 | 对应差距 | 工作量 | ROI | 价值 |
|---|---|---|---|---|---|
| 1 | Session 清理 API (`deleteSession` / `pruneSessions`) | §3.14 | 3-4d | 🔥🔥🔥 | GDPR 合规 + DB 大小控制 |
| 2 | `session_usage` 聚合表（input/output/cache/cost/last_activity） | §3.10 | 2-3d | 🔥🔥🔥 | 企业账单 + session 粒度用量面板 |
| 3 | `conversation_log_fts` FTS5 + search API | §3.11 | 1-2d | 🔥🔥 | 跨会话关键字检索，客服/审计场景必需 |
| 4 | 定期 `PRAGMA wal_checkpoint(PASSIVE)` | §3.4 | 0.5d | 🔥🔥 | 长运行 WAL 膨胀防护 |

**P1**（中等 ROI）:

| # | 项目 | 对应差距 | 工作量 | ROI | 价值 |
|---|---|---|---|---|---|
| 5 | Session title 持久化 + `sanitize_title` | §3.12 | 1-2d | 🔥 | UI 列表性能 + 标题清洁 |
| 6 | `reasoning_details` / `finish_reason` 独立列 | §3.3 | 1d | 🔥 | 思考链分析查询 |
| 7 | `update_token_counts(absolute=True)` gateway 模式 | §3.10 | 0.5d | 🔥 | 未来多实例 gateway 需要 |
| 8 | `busy_timeout` + `BEGIN IMMEDIATE` 写入保护 | §3.4 | 1d | 🔥 | 多进程部署的并发边界 |
| 9 | `list_sessions_rich(include_children=false)` 语义 | §3.12 | 0.5d | 🔥 | fork 子会话默认隐藏 |

**P2**（长期规划）:

| # | 项目 | 对应差距 | 工作量 |
|---|---|---|---|
| 10 | `get_next_title_in_lineage("#N")` 编号 | §3.12 | 0.5d |
| 11 | Session 审计日志（who deleted what） | §3.14 | 2-3d |

**不建议做**:
- 把 conversation_log 合并为 hermes 风格的单一 sessions + messages 表：EvoClaw 的组合 key + 多表设计在企业多租户/多渠道场景下**明显更优**（§3.2 / §3.8）
- 放弃 streaming/final/orphaned 三态恢复：这是 EvoClaw 相对 hermes 的核心反超（§3.5）
- 放弃 system-events 内存队列：改为持久化队列反而会失去"sidecar 重启清空"的自洁语义（§3.7）

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应 |
|---|---|---|---|
| 1 | Session Key 5 维组合键 + 语义前缀过滤 | `routing/session-key.ts:12-40` | 仅 UUID + source/user_id 列过滤 |
| 2 | Binding Router 4 级最具体优先匹配 | `routing/binding-router.ts:63-94` | 无（gateway 内各自实现） |
| 3 | System Events 内存队列 + 3 层去重 + 噪音过滤 | `infrastructure/system-events.ts:55-135` | 无 |
| 4 | streaming/final/orphaned 三态崩溃恢复 | `agent/kernel/incremental-persister.ts:108-192` + `migrations/022:6-12` | 无（基于 commit 原子性） |
| 5 | Heartbeat 共享主会话 vs Cron 独立会话 分流 | `scheduler/heartbeat-runner.ts:207-233` + `cron-runner.ts:107-148` | 无该抽象 |
| 6 | LaneQueue per-session 串行 + 三车道并发 | `agent/lane-queue.ts:22-138` | 单层 `threading.Lock` 全局串行 |
| 7 | Fork 多表一致性复制（log+summary+runtime_state+file_attribution） | `routes/fork-session.ts:42-93` | 仅 `parent_session_id` FK，不复制消息 |
| 8 | `compaction_status` 四态机 + `entry_type` 事件分类 | `migrations/004:10` + `021:6` + `conversation-logger.ts:4-10` | 仅 messages 表无状态 |
| 9 | `kernel_message_json` 完整 KernelMessage 序列化 | `migrations/022:5` + `incremental-persister.ts:71-82` | 需 3 套 reasoning 列分流 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（本章所有 `path:line` 均经 Read 工具验证 2026-04-16）

- `packages/core/src/routing/session-key.ts:12-40` ✅ generateSessionKey / parseSessionKey / isGroupChat
- `packages/core/src/routing/binding-router.ts:26-95` ✅ BindingRouter.resolveAgent 4 级匹配
- `packages/core/src/infrastructure/db/migrations/004_conversation_log.sql:1-18` ✅ conversation_log 基础表
- `packages/core/src/infrastructure/db/migrations/019_session_summary.sql:1-15` ✅ session_summaries 表
- `packages/core/src/infrastructure/db/migrations/021_conversation_log_hierarchy.sql:1-11` ✅ parent/sidechain/entry_type
- `packages/core/src/infrastructure/db/migrations/022_incremental_persist.sql:1-12` ✅ turn_index/kernel_message_json/persist_status
- `packages/core/src/infrastructure/db/migrations/023_session_runtime_state.sql:1-10` ✅ runtime_state KV 表
- `packages/core/src/infrastructure/db/sqlite-store.ts:17-74` ✅ WAL + foreign_keys 启用
- `packages/core/src/infrastructure/system-events.ts:37-150` ✅ per-session 内存队列 + drain/enqueue API
- `packages/core/src/agent/kernel/incremental-persister.ts:43-232` ✅ streaming→final→orphaned 三态
- `packages/core/src/agent/lane-queue.ts:22-139` ✅ per-session 串行 + 三车道并发
- `packages/core/src/scheduler/heartbeat-runner.ts:207-233` ✅ isolatedSession / resolveMainSessionKey
- `packages/core/src/scheduler/cron-runner.ts:105-148` ✅ event 模式 vs cron 隔离 session
- `packages/core/src/routes/chat.ts:340-402` ✅ /recents 窗口函数聚合
- `packages/core/src/routes/chat.ts:1034-1038` ✅ drainFormattedSystemEvents 注入 prompt 前缀
- `packages/core/src/routes/fork-session.ts:31-113` ✅ 单事务 4 表复制
- `packages/core/src/context/plugins/session-router.ts:9-19` ✅ sessionRouterPlugin 上下文注入
- `packages/core/src/agent/sub-agent-spawner.ts:290` ✅ subagent session key 格式

### 6.2 hermes 研究引用（章节 §）

- `.research/14-state-sessions.md §1` 角色与定位（SessionDB ~/.hermes/state.db）
- `.research/14-state-sessions.md §2.1` 完整 Schema SQL（sessions 26 字段 + messages 13 字段）
- `.research/14-state-sessions.md §2.2` Schema v1→v6 迁移历史
- `.research/14-state-sessions.md §3.1` `_execute_write` — Lock + BEGIN IMMEDIATE + 15 次 jitter + 周期 checkpoint
- `.research/14-state-sessions.md §3.2` WAL 模式 + PRAGMA wal_checkpoint(PASSIVE)
- `.research/14-state-sessions.md §3.3` FTS5 搜索（_sanitize_fts5_query + search_messages + snippet + BM25）
- `.research/14-state-sessions.md §3.4` Token 计数双模式（incremental vs absolute）
- `.research/14-state-sessions.md §3.5` Title 管理（sanitize_title + 部分唯一索引 + lineage 编号）
- `.research/14-state-sessions.md §3.6` list_sessions_rich correlated subquery
- `.research/14-state-sessions.md §4.1` 会话生命周期时序图
- `.research/14-state-sessions.md §5` gateway/session.py SessionStore 与 hermes_state.py SessionDB 的关系说明
- `.research/14-state-sessions.md §6` 复刻清单（Schema / 写入机制 / CRUD / FTS5 / Title）
- `.research/14-state-sessions.md §7` 延伸阅读（prune_sessions 调度未定、FTS5 tokenization、并发写场景）

### 6.3 关联差距章节（crosslink）

本章的配套深入见：

- `03-architecture-gap.md` — Sidecar / ContextPlugin / LaneQueue 总体架构定位
- `04-core-abstractions-gap.md` §2.7 SessionDB 类型定义（hermes 侧）
- `05-agent-loop-gap.md` §3.10 Session 持久化时机（per-turn vs batch）+ `PromptCacheMonitor`（§3.12）
- `07-prompt-system-gap.md`（同批）— system_prompt 持久化策略
- `08-context-compression-gap.md` — compaction_status 状态机在压缩层的消费、Shadow Microcompact 与 session_runtime_state 的交互
- `15-memory-providers-gap.md`（同批）— 会话结束后如何从 conversation_log 提取记忆（extracted → compacted）
- `18-cron-background-gap.md`（未来）— Cron action_type='event' vs 隔离 session、Heartbeat 双模式的调度细节

---

**本章完成**。模板要点:
- §1 定位（单边简介，EvoClaw 多模块协作 vs hermes 单类聚合）
- §2 档位速览（14 个机制，🔴 3 / 🟡 4 / 🟢 7，反超率 50%）
- §3 机制逐条并置（每个机制只写一次，两侧源码对照 + 判定 emoji）
- §4 改造蓝图 P0/P1/P2 + 不建议做（会话清理 + usage 聚合是企业级必补）
- §5 反超点单独汇总（9 项结构性优势）
- §6 附录引用双向可验（18 个 EvoClaw path:line + 13 个 hermes §）
