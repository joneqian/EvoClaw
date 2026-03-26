# Sub-Agent & ReAct 循环优化方案

> **文档版本**: v1.0
> **创建日期**: 2026-03-26
> **文档状态**: 待实施
> **研究基础**: OpenClaw 源码对比分析
> **对应迭代**: Sprint 15（Sub-Agent & ReAct 追平 OpenClaw）
> **前置依赖**: Sprint 14 ✅ 已完成

---

## 1. 背景

对比分析 OpenClaw 源码后，发现 EvoClaw 在 ReAct 循环和 Sub-Agent 编排上有 7 项差距。本方案逐项给出实现设计，按复杂度从低到高排序。

### 差距总览

| # | 维度 | 当前状态 | OpenClaw 做法 | 复杂度 |
|---|------|----------|--------------|--------|
| 1 | 嵌套深度 | 硬编码 2 级 | 可配置 | 极低 |
| 2 | 重试上限 | 硬编码 20 次 | 按 provider 数量动态缩放 | 极低 |
| 3 | Thinking 降级 | on/off 二元，失败直接禁用 | 5 级渐进降级 | 低 |
| 4 | Streaming 事件 | 7 种，compaction 不转发 | 丰富（含 compaction/message 生命周期） | 低 |
| 5 | 级联 Kill | 仅终止直接子代 | 递归终止所有后代 | 低 |
| 6 | 结果返回 | Pull（yield_agents 主动拉取） | Push（自动注入父 session） | 中 |
| 7 | Spawn 模式 | 仅 run（一次性） | run + session（持久化/可续） | 高 |

---

## 2. 改进 1：可配置嵌套深度

### 现状
`MAX_SPAWN_DEPTH = 2` 硬编码在 `sub-agent-spawner.ts:26`，所有 Agent 统一。

### 设计
- `MAX_SPAWN_DEPTH` 常量 → 实例属性 `this.maxSpawnDepth`
- 构造函数新增 `maxSpawnDepth?: number` 参数，默认 `DEFAULT_MAX_SPAWN_DEPTH`（2）
- `resolveRole()` 和 `spawn()` 的深度检查引用实例属性
- spawn 子代时传递 `maxSpawnDepth` 给子代的 spawner

### 涉及文件
| 文件 | 改动 |
|------|------|
| `packages/shared/src/constants.ts` | 新增 `DEFAULT_MAX_SPAWN_DEPTH = 2` |
| `packages/core/src/agent/sub-agent-spawner.ts` | 构造函数 + resolveRole + spawn |
| `packages/core/src/agent/embedded-runner-attempt.ts` | 创建 spawner 时传入配置 |

---

## 3. 改进 2：动态重试上限

### 现状
`MAX_LOOP_ITERATIONS = 20` 硬编码在 `embedded-runner-loop.ts:27`。

### 设计
```typescript
// 基础 5 次 + 每个 provider 5 次重试空间，上限 30
const maxIterations = Math.min(5 + providerChain.length * 5, 30);
```

- 1 个 provider → 10 次
- 2 个 → 15 次
- 3 个 → 20 次
- 上限 30（防止过长重试）

### 涉及文件
| 文件 | 改动 |
|------|------|
| `packages/core/src/agent/embedded-runner-loop.ts` | `MAX_LOOP_ITERATIONS` → 动态计算 |

---

## 4. 改进 3：Thinking 5 级 + 渐进降级

### 现状
`reasoning: boolean`（默认 false），thinking 错误时 `reasoning = false` 一刀切。

### 设计

**ThinkLevel 类型**：
```typescript
export type ThinkLevel = 'off' | 'low' | 'medium' | 'high';
```

**默认级别映射**：
```
Anthropic → 'high'（PI 映射为 reasoning: true）
OpenAI    → 'medium'（PI 映射为 reasoning: true）
国产模型   → 'off'（PI 映射为 reasoning: false）
```

**渐进降级**：
```
thinking 错误 → high→medium→low→off（每次降一级）
```

**PI 兼容**：PI 目前只接受 `reasoning: boolean`，所以 `thinkLevel !== 'off'` → `true`。多级信息保留在 EvoClaw 层用于降级决策，未来 PI 支持多级时可直接传递。

### 涉及文件
| 文件 | 改动 |
|------|------|
| `packages/shared/src/types.ts` | 新增 `ThinkLevel` 类型 |
| `packages/core/src/agent/embedded-runner-loop.ts` | `reasoning` → `thinkLevel`，降级逻辑 |
| `packages/core/src/agent/embedded-runner-attempt.ts` | `reasoning` → `thinkLevel`，映射 |
| `packages/core/src/agent/types.ts` | `AttemptParams.reasoning` → `thinkLevel` |

---

## 5. 改进 4：丰富 Streaming 事件类型

### 现状
`embedded-runner-attempt.ts` 的 session.subscribe 回调中，`auto_compaction_start/end` 只更新内部 `isCompacting` 标记，不转发给 `onEvent`。`message_end` 也仅内部处理。

### 设计

**新增 RuntimeEventType**：
```typescript
| 'message_start'
| 'message_end'
| 'compaction_start'
| 'compaction_end'
```

**转发逻辑**：在现有 subscribe 回调中补充 `emit(onEvent, ...)` 调用。

### 涉及文件
| 文件 | 改动 |
|------|------|
| `packages/core/src/agent/types.ts` | `RuntimeEventType` 新增 4 种 |
| `packages/core/src/agent/embedded-runner-attempt.ts` | subscribe 回调补充转发 |

---

## 6. 改进 5：级联 Kill

### 现状
`kill(taskId)` 只 `abort()` 直接子代的 AbortController，不递归终止孙代。

### 设计

**SubAgentEntry 扩展**：
```typescript
interface SubAgentEntry {
  // ...现有字段
  childSpawner?: SubAgentSpawner;  // 新增：子代的 spawner 引用
}
```

**kill() 递归改造**：
```typescript
kill(taskId: string): boolean {
  const entry = this.agents.get(taskId);
  if (!entry || entry.status !== 'running') return false;

  // 先递归 kill 所有孙代
  if (entry.childSpawner) {
    entry.childSpawner.killAll();
  }

  // 再 kill 自己
  entry.abortController.abort();
  entry.status = 'cancelled';
  entry.completedAt = Date.now();
  return true;
}
```

**新增 killAll() 方法**：
```typescript
killAll(): void {
  for (const entry of this.agents.values()) {
    if (entry.status === 'running') this.kill(entry.taskId);
  }
}
```

### 涉及文件
| 文件 | 改动 |
|------|------|
| `packages/core/src/agent/sub-agent-spawner.ts` | SubAgentEntry + kill() + killAll() |
| `packages/core/src/agent/embedded-runner-attempt.ts` | 创建 spawner 后回传引用给 entry |

---

## 7. 改进 6：Push-based 子代结果通知

### 现状
子代完成后结果存在 `SubAgentEntry.result` 中，父代需调用 `yield_agents` → `collectCompletedResults()` 才能获取。

### 难点
PI 的 `session.prompt()` 是阻塞式的，父 session 正在等待 LLM 响应时无法注入消息。

### 设计

**方案**：子代完成时结果入队，在父 session 的**下一次 prompt 前**自动注入。

**SubAgentSpawner 新增**：
```typescript
private pendingAnnouncements: Array<{
  taskId: string; task: string; result: string; success: boolean;
}> = [];

drainAnnouncements(): string | null {
  if (this.pendingAnnouncements.length === 0) return null;
  const messages = this.pendingAnnouncements.map(a =>
    `[子 Agent 完成] Task: ${a.taskId}\n状态: ${a.success ? '成功' : '失败'}\n结果:\n${a.result}`
  );
  this.pendingAnnouncements = [];
  return messages.join('\n\n---\n\n');
}
```

**注入时机**（embedded-runner-attempt.ts）：
```typescript
// 每次 session.prompt() 前检查
const announcements = spawner?.drainAnnouncements();
if (announcements) {
  session.agent.addMessage({ role: 'user', content: announcements });
}
```

**yield_agents 保留**：作为手动查询的备选，更新工具描述说明结果会自动推送。

**局限**：PI 的 ReAct 循环中 `session.prompt()` 是一次调用完成多轮工具调用+回复的，中间无法注入。Push 发生在两次 `session.prompt()` 之间（即重试/failover 循环的迭代间隙）。

### 涉及文件
| 文件 | 改动 |
|------|------|
| `packages/core/src/agent/sub-agent-spawner.ts` | pendingAnnouncements + drainAnnouncements |
| `packages/core/src/agent/embedded-runner-attempt.ts` | prompt 前注入 |
| `packages/core/src/tools/sub-agent-tools.ts` | 更新 yield_agents 描述 |

---

## 8. 改进 7：Session 模式（持久化子代）

### 现状
每次 spawn 创建新 PI session，执行完即销毁。`steer()` 通过 kill+重新 spawn 实现。

### 设计

**SpawnMode 类型**：
```typescript
type SpawnMode = 'run' | 'session';
```

**SubAgentEntry 扩展**：
```typescript
interface SubAgentEntry {
  // ...现有字段
  mode: SpawnMode;
  sessionState?: {
    messages: MessageSnapshot[];  // 保留对话历史
    config: AgentRunConfig;       // 保留配置用于 resume
  };
}
```

**生命周期**：
```
run 模式:    spawned → running → completed/failed（销毁）
session 模式: spawned → running → idle → resume → running → idle → kill/expired
```

**新增 resume() 方法**：
```typescript
resume(taskId: string, followUp: string): void {
  const entry = this.agents.get(taskId);
  if (!entry || entry.mode !== 'session' || entry.status !== 'idle') {
    throw new Error('只能 resume 处于 idle 状态的 session 模式子代');
  }
  entry.status = 'running';
  const config = { ...entry.sessionState!.config, messages: entry.sessionState!.messages };
  // 追加 followUp 作为新的 user message，enqueue 到 laneQueue
}
```

**steer() 改造**：
- `session` 模式：调用 `resume(taskId, correction)`
- `run` 模式：保持现有行为（kill+重建）

**自动清理**：
- idle 超 30 分钟自动 kill（定时扫描）
- 父代 session 结束时清理所有子代

### 涉及文件
| 文件 | 改动 |
|------|------|
| `packages/core/src/agent/sub-agent-spawner.ts` | SpawnMode + SubAgentEntry + resume + steer 改造 + 自动清理 |
| `packages/core/src/tools/sub-agent-tools.ts` | spawn_agent schema 新增 mode + 新增 resume_agent 工具 |

---

## 9. 实施顺序与依赖关系

```
改进 1 (可配置深度)  ──┐
改进 2 (动态重试)   ───┤
改进 3 (Thinking 多级) ┼──→ 可并行，互不依赖
改进 4 (Streaming 事件) ┤
改进 5 (级联 Kill)  ───┘
                        ↓
改进 6 (Push-based 通知) ──→ 依赖 spawner 结构稳定
                        ↓
改进 7 (Session 模式) ─────→ 依赖改进 5 的 childSpawner + 改进 6 的 announcement 机制
```

## 10. 涉及文件汇总

| 文件 | 改动项 |
|------|--------|
| `packages/shared/src/constants.ts` | #1 DEFAULT_MAX_SPAWN_DEPTH |
| `packages/shared/src/types.ts` | #3 ThinkLevel 类型 |
| `packages/core/src/agent/sub-agent-spawner.ts` | #1 #5 #6 #7 |
| `packages/core/src/agent/embedded-runner-loop.ts` | #2 #3 |
| `packages/core/src/agent/embedded-runner-attempt.ts` | #1 #3 #4 #5 #6 |
| `packages/core/src/agent/types.ts` | #3 #4 |
| `packages/core/src/tools/sub-agent-tools.ts` | #1 #6 #7 |

## 11. 验证方式

1. **改进 1**：单元测试 — 配置 maxSpawnDepth=3，验证 3 级嵌套可用
2. **改进 2**：单元测试 — 验证 1/2/3 个 provider 对应 10/15/20 次上限
3. **改进 3**：单元测试 — ThinkLevel 降级链 high→medium→low→off
4. **改进 4**：集成测试 — 触发 compaction 场景，验证 compaction_start/end 事件转发
5. **改进 5**：单元测试 — spawn 2 级子代后 kill 父代，验证孙代也被终止
6. **改进 6**：集成测试 — spawn 子代，等完成，验证父 session 下一轮自动收到结果
7. **改进 7**：集成测试 — spawn session 模式子代，完成后 resume，验证上下文保留
