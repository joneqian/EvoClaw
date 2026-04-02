# 启动流程优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 EvoClaw Sidecar 的启动流程 — 添加启动性能观测、并行化独立初始化步骤、引入延迟预取模式、集中管理全局启动状态。

**Architecture:** 新建 `startup-profiler.ts` 提供毫秒级性能打点；重构 `server.ts` 的 `main()` 函数将独立步骤并行化（Promise.all）；新建 `bootstrap-state.ts` 集中管理全局运行时状态；将非关键初始化延迟到 HTTP 就绪之后。

**Tech Stack:** TypeScript, Hono, Vitest

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `packages/core/src/infrastructure/startup-profiler.ts` | 创建 | 启动性能打点工具 |
| `packages/core/src/infrastructure/bootstrap-state.ts` | 创建 | 全局启动状态集中管理 |
| `packages/core/src/server.ts` | 修改 | 并行初始化 + profiler 打点 + 延迟预取 |
| `packages/core/src/__tests__/infrastructure/startup-profiler.test.ts` | 创建 | profiler 测试 |
| `packages/core/src/__tests__/infrastructure/bootstrap-state.test.ts` | 创建 | bootstrap state 测试 |

---

### Task 1: 启动性能打点工具 (startup-profiler.ts)

**Files:**
- Create: `packages/core/src/infrastructure/startup-profiler.ts`
- Test: `packages/core/src/__tests__/infrastructure/startup-profiler.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/infrastructure/startup-profiler.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { StartupProfiler } from '../../infrastructure/startup-profiler.js';

describe('StartupProfiler', () => {
  let profiler: StartupProfiler;

  beforeEach(() => {
    profiler = new StartupProfiler();
  });

  it('应记录检查点并计算耗时', () => {
    profiler.checkpoint('start');
    profiler.checkpoint('end');
    const report = profiler.getReport();
    expect(report.checkpoints).toHaveLength(2);
    expect(report.checkpoints[0].name).toBe('start');
    expect(report.checkpoints[1].name).toBe('end');
    expect(report.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('每个检查点应有相对于起点的耗时', () => {
    profiler.checkpoint('a');
    profiler.checkpoint('b');
    const report = profiler.getReport();
    expect(report.checkpoints[0].elapsedMs).toBe(0); // 第一个是起点
    expect(report.checkpoints[1].elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('应计算相邻检查点间的 delta', () => {
    profiler.checkpoint('a');
    profiler.checkpoint('b');
    profiler.checkpoint('c');
    const report = profiler.getReport();
    expect(report.checkpoints[0].deltaMs).toBe(0);
    expect(report.checkpoints[1].deltaMs).toBeGreaterThanOrEqual(0);
    expect(report.checkpoints[2].deltaMs).toBeGreaterThanOrEqual(0);
  });

  it('formatReport 应返回可读字符串', () => {
    profiler.checkpoint('config_loaded');
    profiler.checkpoint('db_ready');
    const text = profiler.formatReport();
    expect(text).toContain('config_loaded');
    expect(text).toContain('db_ready');
    expect(text).toContain('ms');
  });

  it('空 profiler 应返回空报告', () => {
    const report = profiler.getReport();
    expect(report.checkpoints).toHaveLength(0);
    expect(report.totalMs).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/__tests__/infrastructure/startup-profiler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// packages/core/src/infrastructure/startup-profiler.ts
/**
 * 启动性能打点工具
 *
 * 在启动流程关键节点调用 checkpoint()，记录高精度时间戳。
 * getReport() 返回结构化报告，formatReport() 返回人类可读文本。
 *
 * 参考 Claude Code startupProfiler.ts — 8 个检查点覆盖完整启动链路。
 */

export interface CheckpointEntry {
  name: string;
  /** 相对于第一个检查点的毫秒数 */
  elapsedMs: number;
  /** 相对于上一个检查点的毫秒数 */
  deltaMs: number;
  /** 高精度时间戳 (performance.now) */
  timestamp: number;
}

export interface StartupReport {
  checkpoints: CheckpointEntry[];
  /** 第一个到最后一个检查点的总耗时 (ms) */
  totalMs: number;
}

export class StartupProfiler {
  private entries: { name: string; timestamp: number }[] = [];

  /** 记录一个检查点 */
  checkpoint(name: string): void {
    this.entries.push({ name, timestamp: performance.now() });
  }

  /** 获取结构化报告 */
  getReport(): StartupReport {
    if (this.entries.length === 0) {
      return { checkpoints: [], totalMs: 0 };
    }

    const origin = this.entries[0].timestamp;
    const checkpoints: CheckpointEntry[] = this.entries.map((entry, i) => ({
      name: entry.name,
      elapsedMs: Math.round(entry.timestamp - origin),
      deltaMs: i === 0 ? 0 : Math.round(entry.timestamp - this.entries[i - 1].timestamp),
      timestamp: entry.timestamp,
    }));

    const totalMs = Math.round(
      this.entries[this.entries.length - 1].timestamp - origin,
    );

    return { checkpoints, totalMs };
  }

  /** 格式化为人类可读文本 */
  formatReport(): string {
    const report = this.getReport();
    if (report.checkpoints.length === 0) return '(no checkpoints)';

    const lines = report.checkpoints.map(
      (cp) => `  ${cp.name.padEnd(30)} +${cp.deltaMs}ms (${cp.elapsedMs}ms)`,
    );
    lines.push(`  ${'TOTAL'.padEnd(30)} ${report.totalMs}ms`);
    return lines.join('\n');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/__tests__/infrastructure/startup-profiler.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/infrastructure/startup-profiler.ts packages/core/src/__tests__/infrastructure/startup-profiler.test.ts
git commit -m "feat(startup): add StartupProfiler for boot-time observability"
```

---

### Task 2: 全局启动状态 (bootstrap-state.ts)

**Files:**
- Create: `packages/core/src/infrastructure/bootstrap-state.ts`
- Test: `packages/core/src/__tests__/infrastructure/bootstrap-state.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/infrastructure/bootstrap-state.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { BootstrapState } from '../../infrastructure/bootstrap-state.js';

describe('BootstrapState', () => {
  let state: BootstrapState;

  beforeEach(() => {
    state = new BootstrapState();
  });

  it('初始状态应为 pending', () => {
    expect(state.phase).toBe('pending');
    expect(state.isReady()).toBe(false);
  });

  it('应正确追踪阶段变迁', () => {
    state.transition('initializing');
    expect(state.phase).toBe('initializing');

    state.transition('ready');
    expect(state.phase).toBe('ready');
    expect(state.isReady()).toBe(true);
  });

  it('应存储和检索组件引用', () => {
    const mockDb = { close: () => {} };
    state.set('db', mockDb);
    expect(state.get('db')).toBe(mockDb);
  });

  it('get 不存在的 key 应返回 undefined', () => {
    expect(state.get('nonexistent')).toBeUndefined();
  });

  it('应记录端口和 token', () => {
    state.setServerInfo(12345, 'abc123');
    expect(state.port).toBe(12345);
    expect(state.token).toBe('abc123');
  });

  it('error 阶段应记录错误信息', () => {
    state.transition('error', '数据库初始化失败');
    expect(state.phase).toBe('error');
    expect(state.errorMessage).toBe('数据库初始化失败');
  });

  it('getSnapshot 应返回当前状态快照', () => {
    state.transition('ready');
    state.setServerInfo(9999, 'tok');
    const snap = state.getSnapshot();
    expect(snap.phase).toBe('ready');
    expect(snap.port).toBe(9999);
    expect(snap.components).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/__tests__/infrastructure/bootstrap-state.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// packages/core/src/infrastructure/bootstrap-state.ts
/**
 * 全局启动状态管理
 *
 * 集中管理 Sidecar 启动过程中的全局状态，替代 main() 中的散落局部变量。
 * 参考 Claude Code bootstrap/state.ts — 15+ 全局状态集中管理。
 *
 * 使用方式:
 *   const state = new BootstrapState();
 *   state.transition('initializing');
 *   state.set('db', dbInstance);
 *   state.transition('ready');
 */

export type BootstrapPhase =
  | 'pending'       // 未开始
  | 'initializing'  // 初始化中
  | 'ready'         // HTTP 就绪
  | 'error';        // 启动失败

export interface BootstrapSnapshot {
  phase: BootstrapPhase;
  port: number | null;
  errorMessage: string | null;
  components: string[];
  startedAt: number;
  readyAt: number | null;
}

export class BootstrapState {
  private _phase: BootstrapPhase = 'pending';
  private _port: number | null = null;
  private _token: string | null = null;
  private _errorMessage: string | null = null;
  private _components = new Map<string, unknown>();
  private _startedAt = Date.now();
  private _readyAt: number | null = null;

  get phase(): BootstrapPhase { return this._phase; }
  get port(): number | null { return this._port; }
  get token(): string | null { return this._token; }
  get errorMessage(): string | null { return this._errorMessage; }

  /** 阶段变迁 */
  transition(phase: BootstrapPhase, errorMessage?: string): void {
    this._phase = phase;
    if (phase === 'ready') this._readyAt = Date.now();
    if (phase === 'error' && errorMessage) this._errorMessage = errorMessage;
  }

  /** 是否就绪 */
  isReady(): boolean { return this._phase === 'ready'; }

  /** 记录服务器信息 */
  setServerInfo(port: number, token: string): void {
    this._port = port;
    this._token = token;
  }

  /** 存储组件引用 */
  set(key: string, value: unknown): void { this._components.set(key, value); }

  /** 获取组件引用 */
  get<T = unknown>(key: string): T | undefined { return this._components.get(key) as T | undefined; }

  /** 状态快照（用于诊断） */
  getSnapshot(): BootstrapSnapshot {
    return {
      phase: this._phase,
      port: this._port,
      errorMessage: this._errorMessage,
      components: [...this._components.keys()],
      startedAt: this._startedAt,
      readyAt: this._readyAt,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/__tests__/infrastructure/bootstrap-state.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/infrastructure/bootstrap-state.ts packages/core/src/__tests__/infrastructure/bootstrap-state.test.ts
git commit -m "feat(startup): add BootstrapState for centralized global state"
```

---

### Task 3: 重构 main() — 并行初始化 + profiler 打点

**Files:**
- Modify: `packages/core/src/server.ts:548-845`

本 Task 是核心重构。将 `main()` 中串行的独立步骤重组为并行，并在关键节点插入 profiler 打点。

**并行化分析:**

当前串行链路和依赖关系：
```
ConfigManager          ← 无依赖
  ↓
syncProviders          ← 依赖 ConfigManager
syncEnvVars            ← 依赖 ConfigManager  
seedBundledSkills      ← 无依赖 ★ 可与 DB 并行
  ↓
SqliteStore + Migration ← 无依赖 ★ 可与 Config 并行
  ↓
VectorStore            ← 依赖 DB + ConfigManager
MemoryStore/FTS/KG     ← 依赖 DB + VectorStore
MemoryExtractor        ← 依赖 DB + ConfigManager
  ↓
AgentManager           ← 依赖 DB（但实际只存 DB 引用）
LaneQueue              ← 无依赖 ★
CronRunner             ← 依赖 DB + LaneQueue
  ↓
ChannelManager         ← 依赖 DB（ChannelStateRepo）
Channel auto-recovery  ← 依赖 ChannelManager + DB ★ 可延迟
  ↓
BindingRouter          ← 依赖 DB
MemoryMonitor          ← 无依赖 ★
```

**重组为三个并行组：**

```
Phase 1（并行）:
  ├─ Group A: ConfigManager → syncProviders → syncEnvVars
  ├─ Group B: SqliteStore → MigrationRunner  
  └─ Group C: seedBundledSkills（独立）

Phase 2（并行，依赖 Phase 1 的 DB + Config）:
  ├─ VectorStore + Memory 系统
  ├─ AgentManager + LaneQueue + CronRunner
  └─ ChannelManager + adapters + BindingRouter

Phase 3（HTTP 就绪后，延迟执行）:
  ├─ Channel auto-recovery（网络 I/O，可能慢）
  ├─ HeartbeatManager
  ├─ BOOT.md 执行
  └─ MemoryMonitor（后台监控）
```

- [ ] **Step 1: 添加 profiler + bootstrapState 导入并重构 main()**

在 `server.ts` 中修改 `main()` 函数。以下是重构后的完整 `main()`:

关键改动点：
1. 在函数顶部创建 `StartupProfiler` 和 `BootstrapState`
2. Phase 1: `Promise.all` 并行执行 Config 加载、DB 初始化、Skills 预装
3. Phase 2: `Promise.all` 并行执行 Memory 系统、Agent 系统、Channel 系统
4. Phase 3: HTTP 就绪后异步执行延迟任务（渠道恢复、Heartbeat、BOOT.md）
5. 在每个阶段插入 `profiler.checkpoint()`
6. 启动结束时日志输出完整 profiler 报告

具体修改：

**a)** 新增 import（文件顶部 import 区域末尾，在 `FtsStore` import 之后）:
```typescript
import { StartupProfiler } from './infrastructure/startup-profiler.js';
import { BootstrapState } from './infrastructure/bootstrap-state.js';
```

**b)** 替换整个 `main()` 函数（第 548-845 行）为重构版本，具体变更：

- **profiler 打点**: 在 main 开始、config 完成、db 完成、memory 完成、channel 完成、http 就绪、全部完成 共 7 个检查点
- **Phase 1 并行**: Config 系列和 DB+Migration 用 `Promise.all` 并行，seedBundledSkills 同时执行
- **Phase 2 并行**: Memory 系统初始化和 Agent/CronRunner 创建和 ChannelManager 创建同时执行
- **Phase 3 延迟**: Channel auto-recovery 移到 HTTP 就绪后异步执行，不阻塞服务启动
- **BootstrapState**: 记录阶段变迁和关键组件引用

- [ ] **Step 2: 实际修改 server.ts**

修改 `main()` 函数，保持其他代码不变。

- [ ] **Step 3: 运行全量测试验证不破坏现有功能**

Run: `cd packages/core && npx vitest run`
Expected: 所有现有测试通过（允许预存在的失败）

- [ ] **Step 4: 验证构建**

Run: `pnpm --filter @evoclaw/core build`
Expected: Build complete

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/server.ts
git commit -m "feat(startup): parallelize init, add profiler checkpoints, defer non-critical work"
```

---

### Task 4: 网络预连接 (API preconnect)

**Files:**
- Create: `packages/core/src/infrastructure/preconnect.ts`
- Modify: `packages/core/src/server.ts` (在 Phase 3 延迟任务中添加)

- [ ] **Step 1: Write implementation**

```typescript
// packages/core/src/infrastructure/preconnect.ts
/**
 * API 预连接 — 提前建立 TCP+TLS 到 LLM API 端点
 *
 * 在 HTTP 服务就绪后、首次 LLM 调用前执行。
 * 减少首次请求的 TCP 握手 + TLS 协商延迟 (~100-300ms)。
 *
 * 参考 Claude Code init.ts — mTLS + HTTP proxy + API preconnect。
 */

import https from 'node:https';
import http from 'node:http';
import type { ConfigManager } from './config-manager.js';
import { createLogger } from './logger.js';

const log = createLogger('preconnect');

/**
 * 对所有已配置 Provider 的 baseUrl 发起预连接
 * 仅建立 TCP+TLS，不发送实际请求
 */
export function preconnectProviders(configManager: ConfigManager): void {
  const providerIds = configManager.getProviderIds();
  const urls = new Set<string>();

  for (const id of providerIds) {
    const baseUrl = configManager.getProviderBaseUrl(id);
    if (baseUrl) {
      try {
        const parsed = new URL(baseUrl);
        urls.add(parsed.origin);
      } catch {
        // 无效 URL，跳过
      }
    }
  }

  for (const origin of urls) {
    const parsed = new URL(origin);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(
      { hostname: parsed.hostname, port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80), method: 'HEAD', path: '/', timeout: 5_000 },
      (res) => { res.resume(); },
    );
    req.on('error', () => { /* 预连接失败不影响正常运行 */ });
    req.on('timeout', () => { req.destroy(); });
    req.end();
    log.info(`预连接: ${origin}`);
  }
}
```

- [ ] **Step 2: 在 server.ts Phase 3 延迟任务中调用**

在 HTTP 就绪后的延迟任务块中添加：
```typescript
import { preconnectProviders } from './infrastructure/preconnect.js';

// Phase 3 延迟任务中:
preconnectProviders(configManager);
```

- [ ] **Step 3: 验证构建和测试**

Run: `pnpm --filter @evoclaw/core build && cd packages/core && npx vitest run`
Expected: 构建通过，测试通过

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/infrastructure/preconnect.ts packages/core/src/server.ts
git commit -m "feat(startup): add API preconnect for reduced first-request latency"
```

---

### Task 5: 最终验证 + profiler 报告确认

- [ ] **Step 1: 运行全量测试**

Run: `pnpm --filter @evoclaw/core test`
Expected: 所有测试通过

- [ ] **Step 2: 构建验证**

Run: `pnpm --filter @evoclaw/core build`
Expected: Build complete

- [ ] **Step 3: 确认 profiler 报告格式**

在开发模式下启动 sidecar，观察启动日志中的 profiler 输出：
```
[server] 启动性能报告:
  main_start                     +0ms (0ms)
  config_loaded                  +Xms (Xms)
  phase1_done                    +Xms (Xms)
  phase2_done                    +Xms (Xms)
  http_listening                 +Xms (Xms)
  startup_complete               +Xms (Xms)
  TOTAL                          Xms
```

- [ ] **Step 4: Commit all remaining changes**

```bash
git add -A
git commit -m "feat(startup): complete startup optimization — parallel init, profiler, preconnect"
```
