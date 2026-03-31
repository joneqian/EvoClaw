# Heartbeat 对齐 OpenClaw — 完整开发文档

> **目标**: 将 EvoClaw 的 Heartbeat 机制对齐 OpenClaw 的生产级实现，覆盖调度优化、Token 节省、提示词工程、任务追踪、System Events 增强共 8 个模块。

---

## 目录

1. [改进总览](#1-改进总览)
2. [P0 — HEARTBEAT.md 空文件检测（Token 节省）](#2-p0--heartbeatmd-空文件检测)
3. [P0 — HEARTBEAT_OK 鲁棒检测](#3-p0--heartbeat_ok-鲁棒检测)
4. [P0 — 提示词体系重构](#4-p0--提示词体系重构)
5. [P1 — Wake 合并与优先级调度](#5-p1--wake-合并与优先级调度)
6. [P1 — 隔离 Session 支持（lightContext）](#6-p1--隔离-session-支持lightcontext)
7. [P1 — System Events 增强](#7-p1--system-events-增强)
8. [P2 — Cron 错误追踪与状态机](#8-p2--cron-错误追踪与状态机)
9. [P2 — TaskRegistry 统一任务追踪](#9-p2--taskregistry-统一任务追踪)
10. [类型定义变更](#10-类型定义变更)
11. [测试计划](#11-测试计划)
12. [实施顺序与依赖关系](#12-实施顺序与依赖关系)

---

## 1. 改进总览

| # | 模块 | 优先级 | 影响范围 | 改动文件 | 预估 |
|---|------|--------|----------|----------|------|
| 1 | HEARTBEAT.md 空文件检测 | P0 | Token 节省 | heartbeat-runner.ts, heartbeat-utils.ts(新) | 小 |
| 2 | HEARTBEAT_OK 鲁棒检测 | P0 | 响应处理 | heartbeat-utils.ts(新), heartbeat-runner.ts, chat.ts | 小 |
| 3 | 提示词体系重构 | P0 | Prompt 工程 | heartbeat-prompts.ts(新), heartbeat-runner.ts, chat.ts | 中 |
| 4 | Wake 合并与优先级调度 | P1 | 调度层 | heartbeat-wake.ts(新), heartbeat-runner.ts, heartbeat-manager.ts | 中 |
| 5 | 隔离 Session（lightContext） | P1 | Token 优化 | heartbeat-runner.ts, chat.ts, HeartbeatConfig 类型 | 中 |
| 6 | System Events 增强 | P1 | 事件队列 | system-events.ts, chat.ts, heartbeat-runner.ts | 中 |
| 7 | Cron 错误追踪 | P2 | Cron 稳定性 | cron-runner.ts, 新 migration | 小 |
| 8 | TaskRegistry | P2 | 可观测性 | task-registry.ts(新), cron-runner.ts, heartbeat-runner.ts | 大 |

---

## 2. P0 — HEARTBEAT.md 空文件检测

### 2.1 问题

当前 EvoClaw 每次 heartbeat tick 都会调用 LLM，即使 HEARTBEAT.md 为空或只有标题/空列表。OpenClaw 在预检阶段检测空文件，直接跳过 LLM 调用，**这是最大的 Token 节省点**。

### 2.2 OpenClaw 参考实现

```typescript
// openclaw/src/auto-reply/heartbeat.ts:23-53
export function isHeartbeatContentEffectivelyEmpty(content: string | undefined | null): boolean {
  if (content === undefined || content === null) return false; // 文件不存在 → 交给 LLM 决定
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;                          // 空行
    if (/^#+(\s|$)/.test(trimmed)) continue;         // Markdown 标题
    if (/^[-*+]\s*(\[[\sXx]?\]\s*)?$/.test(trimmed)) continue; // 空列表项
    return false; // 有实际内容
  }
  return true;
}
```

### 2.3 EvoClaw 实现方案

**新建文件**: `packages/core/src/scheduler/heartbeat-utils.ts`

```typescript
/**
 * 检测 HEARTBEAT.md 内容是否"有效为空"
 *
 * "有效为空"指文件仅包含：空行、Markdown 标题、空列表项、HTML 注释。
 * 这类内容不构成可执行任务，跳过 LLM 调用以节省 Token。
 *
 * 注意：文件不存在（null/undefined）返回 false，让 LLM 自行判断。
 */
export function isHeartbeatContentEffectivelyEmpty(
  content: string | undefined | null,
): boolean {
  if (content == null) return false;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#+(\s|$)/.test(trimmed)) continue;
    if (/^[-*+]\s*(\[[\sXx]?\]\s*)?$/.test(trimmed)) continue;
    if (/^<!--.*-->$/.test(trimmed)) continue; // HTML 注释行
    return false;
  }
  return true;
}
```

**修改**: `heartbeat-runner.ts` — `tick()` 方法添加预检

```typescript
// 在 "3. 构建 heartbeat prompt" 之前插入：
// 2.5 HEARTBEAT.md 空文件预检 — 无可执行内容时跳过 LLM 调用
if (this.db) {
  const heartbeatContent = this.readWorkspaceFile?.('HEARTBEAT.md');
  if (isHeartbeatContentEffectivelyEmpty(heartbeatContent)) {
    // 检查是否有 system events 待处理（有事件则仍需执行）
    if (!hasSystemEvents(sessionKey)) {
      log.debug(`agent ${this.agentId} HEARTBEAT.md 为空且无系统事件，跳过`);
      return 'skipped';
    }
  }
}
```

**需要新增 HeartbeatRunner 构造参数**：

```typescript
constructor(
  private agentId: string,
  private config: HeartbeatConfig,
  private executeFn: HeartbeatExecuteFn,
  private onResult?: HeartbeatResultCallback,
  private db?: SqliteStore,
  private readWorkspaceFile?: (filename: string) => string | null,  // 新增
) {}
```

---

## 3. P0 — HEARTBEAT_OK 鲁棒检测

### 3.1 问题

当前 EvoClaw 使用 `cleanResponse.includes('HEARTBEAT_OK')` 做简单字符串包含检测。LLM 经常返回带 Markdown 包裹（`**HEARTBEAT_OK**`）、HTML 标签（`<b>HEARTBEAT_OK</b>`）、尾随标点（`HEARTBEAT_OK.`）的变体，导致检测失败，产生无意义的消息污染。

### 3.2 OpenClaw 参考实现

OpenClaw 有两层检测：

1. **stripHeartbeatToken**: 剥离 HTML/Markdown 标记后检测 token，支持 `ackMaxChars` 阈值
2. **isHeartbeatAckEvent**: 用于 System Event 过滤，前缀匹配 + 边界字符检查

### 3.3 EvoClaw 实现方案

**添加到** `heartbeat-utils.ts`：

```typescript
const HEARTBEAT_TOKEN = 'HEARTBEAT_OK';

/**
 * 剥离 Markdown/HTML 包裹
 */
function stripMarkup(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')       // HTML 标签
    .replace(/&nbsp;/gi, ' ')       // HTML 实体
    .replace(/^[*`~_]+/, '')        // Markdown 前缀
    .replace(/[*`~_]+$/, '')        // Markdown 后缀
    .trim();
}

/**
 * 检测响应是否为 Heartbeat 空闲确认
 *
 * 支持：
 * - 纯文本: "HEARTBEAT_OK"
 * - Markdown 包裹: "**HEARTBEAT_OK**", "`HEARTBEAT_OK`"
 * - HTML 包裹: "<b>HEARTBEAT_OK</b>"
 * - 尾随标点: "HEARTBEAT_OK.", "HEARTBEAT_OK!"
 * - 附带短文本: "HEARTBEAT_OK，一切正常" (≤ ackMaxChars 时视为空闲)
 *
 * @param response   LLM 原始响应（已清理 PI 标记）
 * @param ackMaxChars  token 剥离后允许的最大剩余字符数，超过则视为有效内容（默认 300）
 * @returns { isAck: true } 为空闲确认，{ isAck: false, text } 为有效内容
 */
export function detectHeartbeatAck(
  response: string | null | undefined,
  ackMaxChars = 300,
): { isAck: true } | { isAck: false; text: string } {
  if (!response || !response.trim()) return { isAck: true };

  const trimmed = response.trim();

  // NO_REPLY 直接判空闲
  if (trimmed === 'NO_REPLY') return { isAck: true };

  // 标准化后检测 token
  const normalized = stripMarkup(trimmed);
  const hasToken =
    trimmed.includes(HEARTBEAT_TOKEN) || normalized.includes(HEARTBEAT_TOKEN);

  if (!hasToken) return { isAck: false, text: trimmed };

  // 剥离 token 后检查剩余内容长度
  const stripped = normalized
    .replace(new RegExp(HEARTBEAT_TOKEN, 'gi'), '')
    .replace(/^[\s.!,;:?，。！；：？\-—]+/, '')  // 前缀标点
    .replace(/[\s.!,;:?，。！；：？\-—]+$/, '')  // 后缀标点
    .trim();

  if (stripped.length <= ackMaxChars) {
    return { isAck: true };
  }

  return { isAck: false, text: stripped };
}
```

**修改**: `heartbeat-runner.ts` — `tick()` 中的检测逻辑

```typescript
// 替换当前的简单 includes 检测
import { detectHeartbeatAck } from './heartbeat-utils.js';

// 旧代码:
// const isOk = typeof result === 'string' && (result.includes('HEARTBEAT_OK') || result.includes('NO_REPLY'));

// 新代码:
const ack = detectHeartbeatAck(result, this.config.ackMaxChars);
const status = ack.isAck ? 'ok' as const : 'active' as const;
```

**修改**: `chat.ts` — 零污染回滚同步使用新检测

```typescript
// 旧代码:
// const isHeartbeatNoOp = isHeartbeat && (
//   !cleanResponse || cleanResponse.includes('HEARTBEAT_OK') || cleanResponse === 'NO_REPLY'
// );

// 新代码:
import { detectHeartbeatAck } from '../scheduler/heartbeat-utils.js';

const isHeartbeatNoOp = isHeartbeat && detectHeartbeatAck(cleanResponse).isAck;
```

---

## 4. P0 — 提示词体系重构

### 4.1 当前问题

EvoClaw 使用单一硬编码中文 prompt，无法区分 heartbeat / cron event / exec event 等不同触发原因。OpenClaw 有完整的 reason-based prompt 切换体系。

### 4.2 OpenClaw 提示词体系

| 触发原因 | Prompt | 投递指示 |
|----------|--------|----------|
| 定时 heartbeat | `Read HEARTBEAT.md if it exists...` | 无 |
| Cron event (投递) | `A scheduled reminder has been triggered. The reminder content is: [text]. Please relay this reminder to the user...` | `deliverToUser=true` |
| Cron event (内部) | `...Handle this reminder internally. Do not relay it...` | `deliverToUser=false` |
| Exec completion (投递) | `An async command you ran earlier has completed... Please relay the command output to the user...` | `deliverToUser=true` |
| Exec completion (内部) | `...Handle the result internally...` | `deliverToUser=false` |
| 空 cron event | `...but no event content was found. Reply HEARTBEAT_OK.` | N/A |

### 4.3 EvoClaw 提示词重构方案

**新建文件**: `packages/core/src/scheduler/heartbeat-prompts.ts`

```typescript
/**
 * Heartbeat 提示词模块
 *
 * 参考 OpenClaw 的 reason-based prompt 切换体系，
 * 根据触发原因（定时/cron/exec/手动唤醒）生成不同的 LLM prompt。
 */

// ─── Token ───
export const HEARTBEAT_TOKEN = 'HEARTBEAT_OK';

// ─── 触发原因 ───
export type HeartbeatReason =
  | 'interval'      // 定时触发
  | 'wake'          // 手动唤醒
  | 'cron-event'    // Cron 事件
  | 'exec-event';   // 异步命令完成

// ─── Prompt 构建选项 ───
export interface HeartbeatPromptOptions {
  reason: HeartbeatReason;
  /** 自定义 prompt 覆盖（用户配置） */
  customPrompt?: string;
  /** 当前时间 ISO 字符串 */
  currentTime: string;
  /** Cron 事件文本（reason=cron-event 时使用） */
  cronEventTexts?: string[];
  /** 是否投递给用户（影响 cron/exec prompt 措辞） */
  deliverToUser?: boolean;
  /** 工作区路径提示 */
  workspacePath?: string;
}

/**
 * 构建 Heartbeat prompt
 *
 * 策略：
 * 1. exec-event → 异步命令完成 prompt
 * 2. cron-event → 定时提醒 prompt（区分投递/内部处理）
 * 3. interval/wake → 标准 heartbeat prompt（支持自定义覆盖）
 */
export function buildHeartbeatPrompt(opts: HeartbeatPromptOptions): string {
  switch (opts.reason) {
    case 'exec-event':
      return buildExecEventPrompt(opts.deliverToUser ?? false);

    case 'cron-event':
      return buildCronEventPrompt(
        opts.cronEventTexts ?? [],
        opts.deliverToUser ?? false,
      );

    case 'interval':
    case 'wake':
    default:
      return resolveStandardPrompt(opts);
  }
}

// ─── 标准 Heartbeat Prompt ───

const DEFAULT_HEARTBEAT_PROMPT =
  `Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. ` +
  `Do not infer or repeat old tasks from prior chats. ` +
  `If nothing needs attention, reply ${HEARTBEAT_TOKEN}.`;

/**
 * 解析标准 heartbeat prompt
 * 优先使用用户自定义 prompt，否则使用默认 prompt + 时间戳
 */
function resolveStandardPrompt(opts: HeartbeatPromptOptions): string {
  const base = opts.customPrompt?.trim() || DEFAULT_HEARTBEAT_PROMPT;
  return `[Heartbeat] Current time: ${opts.currentTime}\n${base}`;
}

// ─── Cron Event Prompt ───

function buildCronEventPrompt(
  eventTexts: string[],
  deliverToUser: boolean,
): string {
  const content = eventTexts.filter(Boolean).join('\n');

  if (!content) {
    return deliverToUser
      ? `A scheduled cron event was triggered, but no event content was found. Reply ${HEARTBEAT_TOKEN}.`
      : `A scheduled cron event was triggered, but no event content was found. Handle this internally and reply ${HEARTBEAT_TOKEN} when nothing needs user-facing follow-up.`;
  }

  const instruction = deliverToUser
    ? 'Please relay this reminder to the user in a helpful and friendly way.'
    : 'Handle this reminder internally. Do not relay it to the user unless explicitly requested.';

  return (
    `A scheduled reminder has been triggered. The reminder content is:\n\n` +
    `${content}\n\n` +
    `${instruction}`
  );
}

// ─── Exec Event Prompt ───

function buildExecEventPrompt(deliverToUser: boolean): string {
  return deliverToUser
    ? `An async command you ran earlier has completed. The result is shown in the system messages above. Please relay the command output to the user in a helpful way. If the command succeeded, share the relevant output. If it failed, explain what went wrong.`
    : `An async command you ran earlier has completed. The result is shown in the system messages above. Handle the result internally. Do not relay it to the user unless explicitly requested.`;
}
```

### 4.4 提示词评估：EvoClaw 当前 vs OpenClaw vs 建议版本

| 维度 | EvoClaw 当前 | OpenClaw | 建议版本 |
|------|-------------|----------|----------|
| **语言** | 中文 | 英文 | 英文（LLM 对英文 prompt 遵从性更高） |
| **时间注入** | `当前时间: ISO` 在 prompt 中 | 无时间（Agent 可自行调用系统工具） | 保留时间注入（Agent 缺少系统时钟工具时有用） |
| **指令清晰度** | "读取 HEARTBEAT.md 并严格执行" | "Read HEARTBEAT.md if it exists. Follow it strictly." | 对齐 OpenClaw，使用 "if it exists" 防御性措辞 |
| **任务防污染** | "不要从历史对话推断旧任务" | "Do not infer or repeat old tasks from prior chats." | 对齐 OpenClaw 英文原文 |
| **空闲回复指令** | "回复 HEARTBEAT_OK" | "reply HEARTBEAT_OK" | 统一使用常量 `HEARTBEAT_TOKEN` |
| **Reason 区分** | 无（单一 prompt） | 3 种 prompt（heartbeat/cron/exec） | 完整对齐 4 种 reason |
| **投递指示** | 无 | "relay to user" vs "handle internally" | 完整对齐 |
| **自定义覆盖** | 无 | 支持 per-agent `heartbeat.prompt` 覆盖 | 支持 `customPrompt` 字段 |
| **工作区路径** | 无 | `appendHeartbeatWorkspacePathHint` | 暂不实现（EvoClaw 工作区路径固定） |

### 4.5 Prompt 效果对比分析

**问题 1: 中文 vs 英文 prompt**

当前 EvoClaw 使用中文 prompt，但大多数 LLM（包括 GPT-4、Claude）对英文指令的遵从性更高，尤其在以下场景：
- Token 输出（`HEARTBEAT_OK`）的精确匹配 — 中文 prompt 更容易引起 LLM 用中文解释后再附加 token
- 否定指令（"不要推断旧任务"）— 英文否定指令遵从率更高
- 格式约束 — 英文 prompt 的格式控制力更强

**建议**: 切换为英文 prompt。Agent 的 SOUL.md/IDENTITY.md 已经定义了人格和语言偏好，heartbeat prompt 是系统级指令，不需要匹配 Agent 的交互语言。

**问题 2: 单一 prompt vs Reason-based prompt**

当前 EvoClaw 无论是定时触发还是 Cron 事件注入，都使用相同的 "读取 HEARTBEAT.md" prompt。这导致：
- Cron event 被混入 HEARTBEAT.md 检查流程，可能被忽略
- 异步命令完成事件无法得到正确处理
- 无法区分"投递给用户"和"内部处理"两种模式

**建议**: 完整实现 reason-based prompt 切换。

### 4.6 修改 heartbeat-runner.ts

```typescript
import {
  buildHeartbeatPrompt,
  type HeartbeatReason,
} from './heartbeat-prompts.js';

// tick() 方法改造：
async tick(reason: HeartbeatReason = 'interval'): Promise<'skipped' | 'ok' | 'active'> {
  // ... 活跃时段 + 间隔门控（保持不变）...

  // 检查 system events 确定实际 reason
  const sessionKey = this.resolveMainSessionKey();
  const pendingEvents = peekSystemEvents(sessionKey);
  const effectiveReason = pendingEvents.length > 0 ? 'cron-event' as const : reason;

  // 构建 prompt
  const prompt = buildHeartbeatPrompt({
    reason: effectiveReason,
    customPrompt: this.config.prompt,
    currentTime: new Date().toISOString(),
    cronEventTexts: effectiveReason === 'cron-event' ? pendingEvents : undefined,
    deliverToUser: this.config.target !== 'none',
  });

  // ... 执行 + 结果处理（保持不变）...
}
```

---

## 5. P1 — Wake 合并与优先级调度

### 5.1 问题

当前 EvoClaw 只有定时 `setInterval` 触发，无法手动唤醒。如果未来添加手动唤醒（API 调用、Cron 事件触发），多个唤醒请求可能导致重复执行。

### 5.2 OpenClaw 参考

- `heartbeat-wake.ts`: 250ms 合并窗口 + 4 级优先级
- `requestHeartbeatNow()`: 立即唤醒接口
- 忙碌时轮询重试

### 5.3 EvoClaw 实现方案

**新建文件**: `packages/core/src/scheduler/heartbeat-wake.ts`

```typescript
/**
 * Heartbeat Wake 合并器
 *
 * 将短时间内的多个唤醒请求合并为单次执行，
 * 防止 Cron 事件 + 手动唤醒 + 定时触发同时命中导致重复 LLM 调用。
 */
import type { HeartbeatReason } from './heartbeat-prompts.js';

/** 唤醒优先级（数字越大优先级越高） */
export const WakePriority = {
  RETRY: 0,
  INTERVAL: 1,
  DEFAULT: 2,
  ACTION: 3,
} as const;

export type WakePriorityValue = (typeof WakePriority)[keyof typeof WakePriority];

interface PendingWake {
  reason: HeartbeatReason;
  priority: WakePriorityValue;
  resolve: () => void;
}

/** 默认合并窗口 (ms) */
const DEFAULT_COALESCE_MS = 250;

export class HeartbeatWakeCoalescer {
  private pending: PendingWake | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onWake: (reason: HeartbeatReason) => Promise<void>,
    private readonly coalesceMs = DEFAULT_COALESCE_MS,
  ) {}

  /**
   * 请求唤醒
   *
   * 在合并窗口内：保留最高优先级的请求。
   * 窗口结束后执行一次。
   */
  request(reason: HeartbeatReason, priority: WakePriorityValue): void {
    if (this.pending && this.pending.priority >= priority) {
      return; // 已有更高优先级的请求
    }

    this.pending = { reason, priority, resolve: () => {} };

    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.coalesceMs);
    }
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const wake = this.pending;
    this.pending = null;

    if (wake) {
      await this.onWake(wake.reason);
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
  }
}
```

**修改 HeartbeatRunner**：添加 `requestNow()` 方法

```typescript
// heartbeat-runner.ts 新增方法：
private wakeCoalescer?: HeartbeatWakeCoalescer;

/** 请求立即执行一次心跳（合并防抖） */
requestNow(reason: HeartbeatReason = 'wake'): void {
  if (!this.wakeCoalescer) {
    this.wakeCoalescer = new HeartbeatWakeCoalescer(
      (r) => this.tick(r).then(() => {}),
    );
  }
  this.wakeCoalescer.request(reason, WakePriority.ACTION);
}
```

**修改 HeartbeatManager**：暴露 `requestNow()` 接口

```typescript
// heartbeat-manager.ts 新增方法：
requestNow(agentId: string, reason?: HeartbeatReason): void {
  this.runners.get(agentId)?.requestNow(reason);
}
```

---

## 6. P1 — 隔离 Session 支持（lightContext）

### 6.1 问题

当前 EvoClaw heartbeat 固定复用主会话 session，加载完整对话历史（可达 100K+ tokens）。OpenClaw 支持 `isolatedSession` + `lightContext` 模式，将 heartbeat 的 token 消耗降至 2-5K。

### 6.2 实现方案

**修改 HeartbeatConfig 类型** (`packages/shared/src/types/evolution.ts`)：

```typescript
export interface HeartbeatConfig {
  // ... 现有字段 ...

  /** 是否使用隔离 session（默认 false = 共享主 session） */
  isolatedSession?: boolean;
  /** 是否使用轻量上下文（默认 false = 加载全部 bootstrap 文件） */
  lightContext?: boolean;
  /** 自定义 prompt 覆盖 */
  prompt?: string;
  /** HEARTBEAT_OK 后允许的最大附带文本字符数（默认 300） */
  ackMaxChars?: number;
  /** 模型覆盖（使用更便宜的模型运行 heartbeat） */
  model?: string;
}
```

**修改 heartbeat-runner.ts** — session key 解析：

```typescript
private resolveSessionKey(): string {
  if (this.config.isolatedSession) {
    // 隔离 session：每次 heartbeat 使用独立会话，不污染主对话
    return `agent:${this.agentId}:heartbeat`;
  }
  return this.resolveMainSessionKey();
}
```

**修改 heartbeat-execute.ts** — 传递 lightContext 标志：

```typescript
body: JSON.stringify({
  message,
  sessionKey,
  isHeartbeat: true,
  lightContext: opts?.lightContext ?? false,
  modelOverride: opts?.model,
}),
```

**修改 chat.ts** — 响应 lightContext 标志：

```typescript
const isLightContext = isHeartbeat && body.lightContext === true;

// 根据 lightContext 选择加载文件
const filesToLoad = isLightContext
  ? ['HEARTBEAT.md']                    // 轻量模式：仅 HEARTBEAT.md
  : isHeartbeat
    ? HEARTBEAT_FILES                   // 标准 heartbeat: HEARTBEAT.md + AGENTS.md
    : (isSubAgent || isCron)
      ? MINIMAL_FILES
      : ALL_FILES;
```

### 6.3 Token 节省估算

| 模式 | 加载内容 | 估算 Token |
|------|----------|-----------|
| 主 session（当前） | 全部历史 + 9 文件 | 50K-200K |
| 标准 heartbeat（当前） | HEARTBEAT.md + AGENTS.md | 1K-5K |
| lightContext | 仅 HEARTBEAT.md | 0.5K-2K |
| isolatedSession + lightContext | 独立 session + 仅 HEARTBEAT.md | 0.5K-2K（无历史） |

---

## 7. P1 — System Events 增强

### 7.1 需要补齐的能力

| 能力 | OpenClaw | EvoClaw 当前 | 改动 |
|------|----------|-------------|------|
| contextKey 跟踪 | `contextKey` 字段防重复 | 无 | 新增 |
| deliveryContext | 路由上下文合并 | 无 | 新增 |
| 时间戳格式化 | `[timestamp] text` | `[System Event] text` | 改造 |
| 噪音过滤 | 过滤 heartbeat prompt/poll 标记 | 无 | 新增 |

### 7.2 实现方案

**修改 SystemEvent 接口**：

```typescript
export interface SystemEvent {
  text: string;
  ts: number;
  /** 上下文标识，用于去重和追踪来源（如 "cron:jobId" / "wake"） */
  contextKey?: string | null;
  /** 投递上下文（渠道、接收者等路由信息） */
  deliveryContext?: DeliveryContext;
}

export interface DeliveryContext {
  channel?: string;
  accountId?: string;
}
```

**修改 enqueueSystemEvent 签名**：

```typescript
export function enqueueSystemEvent(
  text: string,
  sessionKey: string,
  opts?: {
    contextKey?: string | null;
    deliveryContext?: DeliveryContext;
  },
): boolean {
  // ... 现有逻辑 ...

  // contextKey 去重（同一 contextKey 的事件只保留最新）
  if (opts?.contextKey) {
    const idx = entry.queue.findIndex(
      e => e.contextKey === opts.contextKey,
    );
    if (idx >= 0) {
      entry.queue.splice(idx, 1); // 移除旧事件
    }
  }

  entry.queue.push({
    text: cleaned,
    ts: Date.now(),
    contextKey: opts?.contextKey ?? null,
    deliveryContext: opts?.deliveryContext,
  });

  // ...
}
```

**添加噪音过滤**：

```typescript
/** 过滤 heartbeat 噪音事件 */
export function isHeartbeatNoiseEvent(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('read heartbeat.md') ||
    lower.includes('heartbeat poll') ||
    lower.includes('heartbeat wake') ||
    lower.includes('reason periodic')
  );
}

/** drain 时过滤噪音 */
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

**修改 chat.ts** — 使用格式化 drain：

```typescript
// 旧代码:
// const pendingEvents = drainSystemEvents(sessionKey);
// const effectiveMessage = pendingEvents.length > 0
//   ? `${pendingEvents.map(e => `[System Event] ${e}`).join('\n')}\n\n${message}`
//   : message;

// 新代码:
import { drainFormattedSystemEvents } from '../infrastructure/system-events.js';

const systemLines = drainFormattedSystemEvents(sessionKey);
const effectiveMessage = systemLines.length > 0
  ? `System:\n${systemLines.map(l => `  ${l}`).join('\n')}\n\n${message}`
  : message;
```

---

## 8. P2 — Cron 错误追踪与状态机

### 8.1 问题

当前 EvoClaw 的 Cron 仅记录 `last_run_at`，无错误计数、无执行状态追踪。OpenClaw 有完整的 `CronJobState`：`consecutiveErrors`、`lastRunStatus`、`lastDeliveryStatus`。

### 8.2 数据库迁移

**新建文件**: `packages/core/src/infrastructure/db/migrations/0XX_cron_job_state.sql`

```sql
ALTER TABLE cron_jobs ADD COLUMN consecutive_errors INTEGER DEFAULT 0;
ALTER TABLE cron_jobs ADD COLUMN last_run_status TEXT DEFAULT NULL;
ALTER TABLE cron_jobs ADD COLUMN last_delivery_status TEXT DEFAULT NULL;
```

### 8.3 修改 cron-runner.ts

```typescript
// 成功时：
this.db.run(
  `UPDATE cron_jobs
   SET last_run_at = ?, last_run_status = 'ok', consecutive_errors = 0, updated_at = ?
   WHERE id = ?`,
  now, now, job.id,
);

// 失败时：
this.db.run(
  `UPDATE cron_jobs
   SET last_run_status = 'error',
       consecutive_errors = consecutive_errors + 1,
       updated_at = ?
   WHERE id = ?`,
  now, job.id,
);

// 连续失败 5 次自动禁用：
const updatedJob = this.db.get<CronJobRow>(
  'SELECT consecutive_errors FROM cron_jobs WHERE id = ?', job.id,
);
if (updatedJob && updatedJob.consecutive_errors >= 5) {
  this.db.run('UPDATE cron_jobs SET enabled = 0 WHERE id = ?', job.id);
  log.warn(`任务 ${job.name} 连续失败 5 次，已自动禁用`);
}
```

---

## 9. P2 — TaskRegistry 统一任务追踪

### 9.1 问题

当前 EvoClaw 没有统一的任务生命周期管理。Cron 任务、Heartbeat 执行、SubAgent 任务各自独立，无法查询"当前有哪些任务在运行"。

### 9.2 OpenClaw 参考

```typescript
type TaskRecord = {
  taskId: string;
  runtime: 'cron' | 'cli' | 'heartbeat' | 'subagent';
  status: 'running' | 'queued' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'lost';
  label: string;
  task: string;
  createdAt: number;
  startedAt: number;
  endedAt?: number;
  sessionKey: string;
  agentId: string;
};
```

### 9.3 EvoClaw 实现方案

**新建文件**: `packages/core/src/scheduler/task-registry.ts`

```typescript
/**
 * TaskRegistry — 统一任务生命周期追踪
 *
 * 追踪所有异步任务（Cron / Heartbeat / SubAgent）的执行状态。
 * 纯内存实现，可选持久化 snapshot。
 */

export type TaskRuntime = 'cron' | 'heartbeat' | 'subagent' | 'boot';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

export interface TaskRecord {
  taskId: string;
  runtime: TaskRuntime;
  sourceId: string;
  status: TaskStatus;
  label: string;
  agentId: string;
  sessionKey: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

const tasks = new Map<string, TaskRecord>();

export function createTask(record: Omit<TaskRecord, 'createdAt'>): string {
  const full: TaskRecord = { ...record, createdAt: Date.now() };
  tasks.set(record.taskId, full);
  return record.taskId;
}

export function updateTask(
  taskId: string,
  update: Partial<Pick<TaskRecord, 'status' | 'startedAt' | 'endedAt' | 'error'>>,
): void {
  const existing = tasks.get(taskId);
  if (existing) {
    Object.assign(existing, update);
  }
}

export function getTask(taskId: string): TaskRecord | undefined {
  return tasks.get(taskId);
}

export function listTasks(filter?: {
  agentId?: string;
  runtime?: TaskRuntime;
  status?: TaskStatus;
}): TaskRecord[] {
  let result = Array.from(tasks.values());
  if (filter?.agentId) result = result.filter(t => t.agentId === filter.agentId);
  if (filter?.runtime) result = result.filter(t => t.runtime === filter.runtime);
  if (filter?.status) result = result.filter(t => t.status === filter.status);
  return result.sort((a, b) => b.createdAt - a.createdAt);
}

/** 清理已结束超过 1 小时的任务记录 */
export function pruneCompleted(maxAgeMs = 3_600_000): number {
  const cutoff = Date.now() - maxAgeMs;
  let pruned = 0;
  for (const [id, task] of tasks) {
    if (
      task.endedAt &&
      task.endedAt < cutoff &&
      ['succeeded', 'failed', 'timed_out', 'cancelled'].includes(task.status)
    ) {
      tasks.delete(id);
      pruned++;
    }
  }
  return pruned;
}
```

### 9.4 集成点

- **Cron**: `cron-runner.ts` 执行前 `createTask()`，完成后 `updateTask()`
- **Heartbeat**: `heartbeat-runner.ts` 执行前后分别 create/update
- **API**: 新增 `GET /tasks?agentId=X` 路由，暴露任务列表

---

## 10. 类型定义变更

**文件**: `packages/shared/src/types/evolution.ts`

```typescript
/** Heartbeat 配置 — 完整版 */
export interface HeartbeatConfig {
  /** 心跳间隔（分钟） */
  intervalMinutes: number;
  /** 活跃时段 */
  activeHours: { start: string; end: string };
  /** 是否启用 */
  enabled: boolean;
  /** 最小执行间隔（分钟），防止频繁触发（默认 5） */
  minIntervalMinutes?: number;
  /** 投递目标：'none' | 'last' | 渠道 ID */
  target?: 'none' | 'last' | string;
  /** 是否投递 HEARTBEAT_OK 确认消息（默认 false） */
  showOk?: boolean;
  /** 是否投递告警内容（默认 true） */
  showAlerts?: boolean;

  // ── 以下为新增字段 ──

  /** 自定义 prompt 覆盖（默认使用内置 prompt） */
  prompt?: string;
  /** HEARTBEAT_OK 后允许的最大附带文本字符数（默认 300） */
  ackMaxChars?: number;
  /** 是否使用隔离 session（默认 false = 共享主 session） */
  isolatedSession?: boolean;
  /** 是否使用轻量上下文 — 仅加载 HEARTBEAT.md（默认 false） */
  lightContext?: boolean;
  /** 模型覆盖 — 使用更便宜的模型运行 heartbeat */
  model?: string;
}
```

---

## 11. 测试计划

### 11.1 单元测试（新增 + 修改）

| 测试文件 | 测试内容 |
|----------|---------|
| `heartbeat-utils.test.ts` | `isHeartbeatContentEffectivelyEmpty()` — 空文件/标题/空列表/注释/有内容 |
| `heartbeat-utils.test.ts` | `detectHeartbeatAck()` — 纯文本/Markdown/HTML/尾标点/短附带文本/长附带文本 |
| `heartbeat-prompts.test.ts` | `buildHeartbeatPrompt()` — 4 种 reason × 2 种 deliverToUser |
| `heartbeat-wake.test.ts` | Wake 合并器 — 优先级覆盖/窗口合并/dispose 清理 |
| `heartbeat-runner.test.ts` | 空文件跳过/reason 传递/隔离 session/鲁棒 ACK 检测 |
| `system-events.test.ts` | contextKey 去重/噪音过滤/格式化 drain/deliveryContext |
| `task-registry.test.ts` | CRUD/过滤/清理 |

### 11.2 需要修改的现有测试

- `heartbeat-runner.test.ts`: 更新 `tick()` 的 prompt 断言（中文→英文）
- `system-events.test.ts`: 适配新增的 `opts` 参数
- `chat.ts` 相关集成测试: 适配新的检测函数和事件格式

---

## 12. 实施顺序与依赖关系

```
Phase 1 (P0 — Token 节省 + 核心鲁棒性)
├── Step 1: heartbeat-utils.ts — 空文件检测 + ACK 鲁棒检测
├── Step 2: heartbeat-prompts.ts — 提示词模块
├── Step 3: heartbeat-runner.ts — 集成 Step 1+2
├── Step 4: chat.ts — 使用新检测函数
└── Step 5: 更新现有测试 + 新增测试

Phase 2 (P1 — 调度优化 + 上下文优化)
├── Step 6: HeartbeatConfig 类型扩展 ← 依赖 Phase 1 完成
├── Step 7: heartbeat-wake.ts — Wake 合并器
├── Step 8: heartbeat-runner.ts — isolatedSession + lightContext + requestNow
├── Step 9: heartbeat-execute.ts — 传递 lightContext/model
├── Step 10: chat.ts — 响应 lightContext
├── Step 11: system-events.ts — contextKey + deliveryContext + 噪音过滤
└── Step 12: 测试

Phase 3 (P2 — 可观测性)
├── Step 13: DB migration — cron_job_state 字段
├── Step 14: cron-runner.ts — 错误追踪 + 自动禁用
├── Step 15: task-registry.ts — 统一任务追踪
├── Step 16: 集成 task-registry 到 cron/heartbeat
├── Step 17: API 路由 — /tasks 端点
└── Step 18: 测试
```

### 依赖图

```
heartbeat-utils.ts ──┐
                     ├── heartbeat-runner.ts ──┐
heartbeat-prompts.ts ┘                        ├── heartbeat-manager.ts
                                              │
heartbeat-wake.ts ────────────────────────────┘

system-events.ts ─── chat.ts

task-registry.ts ─── cron-runner.ts
                 └── heartbeat-runner.ts
```

---

## 附录 A: 文件清单

### 新建文件
| 文件 | Phase | 说明 |
|------|-------|------|
| `packages/core/src/scheduler/heartbeat-utils.ts` | 1 | 空文件检测 + ACK 鲁棒检测 |
| `packages/core/src/scheduler/heartbeat-prompts.ts` | 1 | 提示词模块 |
| `packages/core/src/scheduler/heartbeat-wake.ts` | 2 | Wake 合并器 |
| `packages/core/src/scheduler/task-registry.ts` | 3 | 统一任务追踪 |
| `packages/core/src/infrastructure/db/migrations/0XX_cron_job_state.sql` | 3 | Cron 错误追踪字段 |
| `packages/core/src/__tests__/heartbeat-utils.test.ts` | 1 | |
| `packages/core/src/__tests__/heartbeat-prompts.test.ts` | 1 | |
| `packages/core/src/__tests__/heartbeat-wake.test.ts` | 2 | |
| `packages/core/src/__tests__/task-registry.test.ts` | 3 | |

### 修改文件
| 文件 | Phase | 改动 |
|------|-------|------|
| `packages/shared/src/types/evolution.ts` | 1+2 | HeartbeatConfig 新增字段 |
| `packages/core/src/scheduler/heartbeat-runner.ts` | 1+2 | 集成所有改进 |
| `packages/core/src/scheduler/heartbeat-manager.ts` | 2 | requestNow 接口 |
| `packages/core/src/scheduler/heartbeat-execute.ts` | 2 | 传递 lightContext/model |
| `packages/core/src/routes/chat.ts` | 1+2 | ACK 检测 + lightContext + 事件格式 |
| `packages/core/src/infrastructure/system-events.ts` | 2 | contextKey + 噪音过滤 |
| `packages/core/src/scheduler/cron-runner.ts` | 3 | 错误追踪 |
| `packages/core/src/__tests__/heartbeat-runner.test.ts` | 1 | 适配新 prompt |
| `packages/core/src/__tests__/system-events.test.ts` | 2 | 适配新接口 |
