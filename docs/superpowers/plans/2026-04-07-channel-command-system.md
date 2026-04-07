# 渠道命令系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将死代码的渠道 slash command 激活为跨渠道统一命令系统，支持 7 个内置命令 + 技能 fallback。

**Architecture:** 在 `channel/command/` 下新建命令注册表 + 分发器。命令拦截点在 `server.ts` 的 `channelManager.onMessage` 回调中，`handleChannelMessage` 之前。内置命令直接回复（不消耗 LLM token），未匹配命令 fallback 到已安装技能。

**Tech Stack:** TypeScript, Vitest, Hono (server.ts 集成)

**Spec:** `docs/superpowers/specs/2026-04-07-channel-command-system-design.md`

---

### Task 1: CommandContext / ChannelCommand / CommandResult 接口

**Files:**
- Create: `packages/core/src/channel/command/types.ts`

- [ ] **Step 1: 创建接口定义文件**

```typescript
// packages/core/src/channel/command/types.ts
/**
 * 渠道命令系统类型定义
 */

import type { ChannelType } from '@evoclaw/shared';
import type { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import type { AgentManager } from '../../agent/agent-manager.js';
import type { ChannelManager } from '../channel-manager.js';
import type { ConfigManager } from '../../infrastructure/config-manager.js';
import type { ChannelStateRepo } from '../channel-state-repo.js';
import type { SkillDiscoverer } from '../../skill/skill-discoverer.js';

/** 命令执行上下文 */
export interface CommandContext {
  /** Agent ID（通过 BindingRouter 解析） */
  readonly agentId: string;
  /** 渠道类型 */
  readonly channel: ChannelType;
  /** 对话对象 ID（用户或群组） */
  readonly peerId: string;
  /** 发送者 ID */
  readonly senderId: string;
  /** 账号 ID */
  readonly accountId: string;

  // 服务依赖
  readonly store: SqliteStore;
  readonly agentManager: AgentManager;
  readonly channelManager: ChannelManager;
  readonly configManager?: ConfigManager;
  readonly stateRepo?: ChannelStateRepo;
  readonly skillDiscoverer?: SkillDiscoverer;
}

/** 渠道命令定义 */
export interface ChannelCommand {
  /** 命令名（不含 /） */
  readonly name: string;
  /** 别名列表 */
  readonly aliases?: readonly string[];
  /** 描述（用于 /help 展示） */
  readonly description: string;
  /** 执行命令 */
  execute(args: string, ctx: CommandContext): Promise<CommandResult>;
}

/** 命令执行结果 */
export interface CommandResult {
  /** 是否已处理（true 表示不继续走 AI 管线） */
  handled: boolean;
  /** 直接回复的文本 */
  response?: string;
  /** true = 技能 fallback，注入对话继续 AI 处理 */
  injectToConversation?: boolean;
  /** fallback 时的技能名 */
  skillName?: string;
  /** fallback 时的技能参数 */
  skillArgs?: string;
}
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/mac/src/github/jone_qian/EvoClaw && pnpm build`
Expected: 编译成功，无错误

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/channel/command/types.ts
git commit -m "feat(channel-command): 定义 CommandContext/ChannelCommand/CommandResult 接口"
```

---

### Task 2: CommandRegistry

**Files:**
- Create: `packages/core/src/channel/command/command-registry.ts`
- Create: `packages/core/src/__tests__/channel/command-registry.test.ts`

- [ ] **Step 1: 编写 CommandRegistry 测试**

```typescript
// packages/core/src/__tests__/channel/command-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { CommandRegistry } from '../../channel/command/command-registry.js';
import type { ChannelCommand, CommandContext } from '../../channel/command/types.js';

function makeCommand(name: string, aliases?: string[]): ChannelCommand {
  return {
    name,
    aliases,
    description: `${name} 命令`,
    execute: async () => ({ handled: true, response: name }),
  };
}

describe('CommandRegistry', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  it('注册并按名称查找命令', () => {
    const cmd = makeCommand('help');
    registry.register(cmd);
    expect(registry.findCommand('help')).toBe(cmd);
  });

  it('按别名查找命令', () => {
    const cmd = makeCommand('debug', ['toggle-debug']);
    registry.register(cmd);
    expect(registry.findCommand('toggle-debug')).toBe(cmd);
  });

  it('查找不存在的命令返回 undefined', () => {
    expect(registry.findCommand('nonexistent')).toBeUndefined();
  });

  it('精确名称优先于别名', () => {
    const cmd1 = makeCommand('foo');
    const cmd2 = makeCommand('bar', ['foo']); // bar 的别名是 foo
    registry.register(cmd1);
    registry.register(cmd2);
    // 精确匹配 foo → cmd1
    expect(registry.findCommand('foo')).toBe(cmd1);
  });

  it('listCommands 返回所有已注册命令', () => {
    registry.register(makeCommand('help'));
    registry.register(makeCommand('cost'));
    registry.register(makeCommand('model'));
    expect(registry.listCommands()).toHaveLength(3);
  });

  it('命令名匹配忽略大小写', () => {
    registry.register(makeCommand('help'));
    expect(registry.findCommand('HELP')).toBeDefined();
    expect(registry.findCommand('Help')).toBeDefined();
  });

  it('重复注册同名命令覆盖旧命令', () => {
    const old = makeCommand('help');
    const updated = makeCommand('help');
    registry.register(old);
    registry.register(updated);
    expect(registry.findCommand('help')).toBe(updated);
    expect(registry.listCommands()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/mac/src/github/jone_qian/EvoClaw && pnpm vitest run packages/core/src/__tests__/channel/command-registry.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 CommandRegistry**

```typescript
// packages/core/src/channel/command/command-registry.ts
/**
 * 渠道命令注册表 — 注册、查找、列举渠道命令
 */

import type { ChannelCommand } from './types.js';

export class CommandRegistry {
  private readonly commands = new Map<string, ChannelCommand>();

  /** 注册命令（同名覆盖） */
  register(cmd: ChannelCommand): void {
    this.commands.set(cmd.name.toLowerCase(), cmd);
  }

  /** 按名称或别名查找命令（忽略大小写） */
  findCommand(name: string): ChannelCommand | undefined {
    const normalized = name.toLowerCase();

    // 1. 精确名称匹配
    const exact = this.commands.get(normalized);
    if (exact) return exact;

    // 2. 别名匹配
    for (const cmd of this.commands.values()) {
      if (cmd.aliases?.some(a => a.toLowerCase() === normalized)) {
        return cmd;
      }
    }

    return undefined;
  }

  /** 列出所有已注册命令 */
  listCommands(): ChannelCommand[] {
    return [...this.commands.values()];
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/mac/src/github/jone_qian/EvoClaw && pnpm vitest run packages/core/src/__tests__/channel/command-registry.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/channel/command/command-registry.ts packages/core/src/__tests__/channel/command-registry.test.ts
git commit -m "feat(channel-command): 实现 CommandRegistry 注册表"
```

---

### Task 3: 命令分发器 (dispatchCommand)

**Files:**
- Create: `packages/core/src/channel/command/command-dispatcher.ts`
- Create: `packages/core/src/__tests__/channel/command-dispatcher.test.ts`

- [ ] **Step 1: 编写分发器测试**

```typescript
// packages/core/src/__tests__/channel/command-dispatcher.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommandRegistry } from '../../channel/command/command-registry.js';
import { createCommandDispatcher, isSlashCommand, parseSlashCommand } from '../../channel/command/command-dispatcher.js';
import type { CommandContext, ChannelCommand } from '../../channel/command/types.js';

// Mock logger
vi.mock('../../infrastructure/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

function makeCtx(overrides?: Partial<CommandContext>): CommandContext {
  return {
    agentId: 'agent-1',
    channel: 'weixin',
    peerId: 'user-1',
    senderId: 'user-1',
    accountId: 'acc-1',
    store: {} as any,
    agentManager: {} as any,
    channelManager: {} as any,
    ...overrides,
  };
}

describe('isSlashCommand', () => {
  it('识别 / 开头文本', () => {
    expect(isSlashCommand('/help')).toBe(true);
    expect(isSlashCommand('  /cost')).toBe(true);
  });

  it('非 / 开头返回 false', () => {
    expect(isSlashCommand('hello')).toBe(false);
    expect(isSlashCommand('')).toBe(false);
  });
});

describe('parseSlashCommand', () => {
  it('解析命令名和参数', () => {
    expect(parseSlashCommand('/model gpt-4o')).toEqual({ name: 'model', args: 'gpt-4o' });
  });

  it('无参数命令', () => {
    expect(parseSlashCommand('/help')).toEqual({ name: 'help', args: '' });
  });

  it('大写命令名转小写', () => {
    expect(parseSlashCommand('/HELP')).toEqual({ name: 'help', args: '' });
  });
});

describe('createCommandDispatcher', () => {
  let registry: CommandRegistry;
  let dispatch: ReturnType<typeof createCommandDispatcher>;

  beforeEach(() => {
    registry = new CommandRegistry();
    dispatch = createCommandDispatcher(registry);
  });

  it('匹配内置命令并执行', async () => {
    const cmd: ChannelCommand = {
      name: 'help',
      description: '帮助',
      execute: async () => ({ handled: true, response: '帮助信息' }),
    };
    registry.register(cmd);

    const result = await dispatch('/help', makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toBe('帮助信息');
  });

  it('未匹配命令 + 无 skillDiscoverer → 未知命令提示', async () => {
    const result = await dispatch('/unknown', makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toContain('未知命令');
    expect(result.response).toContain('/help');
  });

  it('未匹配命令 + skillDiscoverer 找到技能 → injectToConversation', async () => {
    const mockDiscoverer = {
      listLocal: () => [{ name: 'summarize', slug: 'summarize', description: '总结', source: 'local' as const }],
    };
    const ctx = makeCtx({ skillDiscoverer: mockDiscoverer as any });

    const result = await dispatch('/summarize 最近的对话', ctx);
    expect(result.handled).toBe(true);
    expect(result.injectToConversation).toBe(true);
    expect(result.skillName).toBe('summarize');
    expect(result.skillArgs).toBe('最近的对话');
  });

  it('未匹配命令 + skillDiscoverer 未找到技能 → 未知命令提示', async () => {
    const mockDiscoverer = {
      listLocal: () => [],
    };
    const ctx = makeCtx({ skillDiscoverer: mockDiscoverer as any });

    const result = await dispatch('/nonexistent', ctx);
    expect(result.handled).toBe(true);
    expect(result.response).toContain('未知命令');
  });

  it('命令执行出错返回错误信息', async () => {
    const cmd: ChannelCommand = {
      name: 'broken',
      description: '坏命令',
      execute: async () => { throw new Error('boom'); },
    };
    registry.register(cmd);

    const result = await dispatch('/broken', makeCtx());
    expect(result.handled).toBe(true);
    expect(result.response).toContain('执行失败');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/mac/src/github/jone_qian/EvoClaw && pnpm vitest run packages/core/src/__tests__/channel/command-dispatcher.test.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现命令分发器**

```typescript
// packages/core/src/channel/command/command-dispatcher.ts
/**
 * 渠道命令分发器 — 解析 slash command 文本，分发到注册表或 fallback 到技能
 */

import { createLogger } from '../../infrastructure/logger.js';
import type { CommandContext, CommandResult } from './types.js';
import type { CommandRegistry } from './command-registry.js';

const log = createLogger('channel-command');

/** 检查文本是否是 slash command */
export function isSlashCommand(text: string): boolean {
  return text.trimStart().startsWith('/');
}

/** 解析 slash command 文本为命令名和参数 */
export function parseSlashCommand(text: string): { name: string; args: string } {
  const trimmed = text.trim();
  const spaceIdx = trimmed.indexOf(' ');
  const rawName = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);
  // 去掉 / 前缀并转小写
  const name = rawName.slice(1).toLowerCase();
  return { name, args };
}

/** 创建命令分发函数 */
export function createCommandDispatcher(registry: CommandRegistry) {
  return async function dispatchCommand(text: string, ctx: CommandContext): Promise<CommandResult> {
    const { name, args } = parseSlashCommand(text);
    log.info(`渠道命令: /${name}, args: ${args.slice(0, 50)}`);

    // 1. 内置命令
    const cmd = registry.findCommand(name);
    if (cmd) {
      try {
        return await cmd.execute(args, ctx);
      } catch (err) {
        log.error(`命令 /${name} 执行失败: ${err}`);
        return { handled: true, response: `命令 /${name} 执行失败: ${String(err).slice(0, 200)}` };
      }
    }

    // 2. 技能 fallback
    if (ctx.skillDiscoverer) {
      const locals = ctx.skillDiscoverer.listLocal();
      const matched = locals.find(s => s.name.toLowerCase() === name || s.slug?.toLowerCase() === name);
      if (matched) {
        log.info(`命令 /${name} fallback 到技能: ${matched.name}`);
        return {
          handled: true,
          injectToConversation: true,
          skillName: matched.name,
          skillArgs: args,
        };
      }
    }

    // 3. 未知命令
    return { handled: true, response: `未知命令 /${name}，输入 /help 查看可用命令` };
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/mac/src/github/jone_qian/EvoClaw && pnpm vitest run packages/core/src/__tests__/channel/command-dispatcher.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/channel/command/command-dispatcher.ts packages/core/src/__tests__/channel/command-dispatcher.test.ts
git commit -m "feat(channel-command): 实现命令分发器，支持内置命令 + 技能 fallback"
```

---

### Task 4: 内置命令 — echo + debug（迁移）

**Files:**
- Create: `packages/core/src/channel/command/builtin/echo.ts`
- Create: `packages/core/src/channel/command/builtin/debug.ts`

- [ ] **Step 1: 实现 echo 命令**

```typescript
// packages/core/src/channel/command/builtin/echo.ts
/**
 * /echo — 回显消息（用于通道连通性测试）
 */

import type { ChannelCommand } from '../types.js';

export const echoCommand: ChannelCommand = {
  name: 'echo',
  description: '回显消息（通道测试）',
  async execute(args) {
    const message = args.trim();
    return { handled: true, response: message || '(空消息)' };
  },
};
```

- [ ] **Step 2: 实现 debug 命令**

```typescript
// packages/core/src/channel/command/builtin/debug.ts
/**
 * /debug — 切换 debug 模式
 */

import type { ChannelCommand } from '../types.js';

export const debugCommand: ChannelCommand = {
  name: 'debug',
  aliases: ['toggle-debug'],
  description: '切换调试模式',
  async execute(_args, ctx) {
    if (!ctx.stateRepo) {
      return { handled: true, response: '调试模式不可用（缺少状态仓库）' };
    }

    const key = `debug:${ctx.accountId}`;
    const current = ctx.stateRepo.getState(ctx.channel, key);
    const enabled = current !== 'true';
    ctx.stateRepo.setState(ctx.channel, key, enabled ? 'true' : 'false');
    return { handled: true, response: enabled ? 'Debug 模式已开启' : 'Debug 模式已关闭' };
  },
};
```

- [ ] **Step 3: 验证编译**

Run: `cd /Users/mac/src/github/jone_qian/EvoClaw && pnpm build`
Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/channel/command/builtin/echo.ts packages/core/src/channel/command/builtin/debug.ts
git commit -m "feat(channel-command): 迁移 echo + debug 内置命令"
```

---

### Task 5: 内置命令 — help

**Files:**
- Create: `packages/core/src/channel/command/builtin/help.ts`

- [ ] **Step 1: 实现 help 命令**

```typescript
// packages/core/src/channel/command/builtin/help.ts
/**
 * /help — 列出所有可用命令和已安装技能
 */

import type { ChannelCommand, CommandContext } from '../types.js';
import type { CommandRegistry } from '../command-registry.js';

/** 创建 help 命令（需要 registry 引用来列举命令） */
export function createHelpCommand(registry: CommandRegistry): ChannelCommand {
  return {
    name: 'help',
    description: '显示可用命令列表',
    async execute(_args, ctx) {
      const lines: string[] = ['━━━ 可用命令 ━━━'];

      // 列出所有内置命令
      for (const cmd of registry.listCommands()) {
        const nameStr = `/${cmd.name}`.padEnd(12);
        lines.push(`${nameStr} - ${cmd.description}`);
      }

      // 列出已安装技能
      if (ctx.skillDiscoverer) {
        const skills = ctx.skillDiscoverer.listLocal();
        if (skills.length > 0) {
          lines.push(`━━━ 已安装技能 (${skills.length}) ━━━`);
          const skillNames = skills.map(s => `/${s.name}`);
          // 每行最多 3 个技能名
          for (let i = 0; i < skillNames.length; i += 3) {
            lines.push(skillNames.slice(i, i + 3).join('  '));
          }
        }
      }

      return { handled: true, response: lines.join('\n') };
    },
  };
}
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/mac/src/github/jone_qian/EvoClaw && pnpm build`
Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/channel/command/builtin/help.ts
git commit -m "feat(channel-command): 实现 /help 命令"
```

---

### Task 6: 内置命令 — cost

**Files:**
- Create: `packages/core/src/channel/command/builtin/cost.ts`

- [ ] **Step 1: 实现 cost 命令**

```typescript
// packages/core/src/channel/command/builtin/cost.ts
/**
 * /cost — 显示当前 Agent 的 token 用量和费用
 */

import type { ChannelCommand } from '../types.js';

export const costCommand: ChannelCommand = {
  name: 'cost',
  description: '查看费用统计',
  async execute(_args, ctx) {
    // 查询今日 token 用量
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayRows = ctx.store.all<{
      total_input: number;
      total_output: number;
    }>(
      `SELECT
         COALESCE(SUM(json_extract(content, '$.usage.input_tokens')), 0) as total_input,
         COALESCE(SUM(json_extract(content, '$.usage.output_tokens')), 0) as total_output
       FROM conversation_log
       WHERE agent_id = ? AND role = 'assistant'
         AND created_at >= ?`,
      ctx.agentId,
      todayStart.toISOString(),
    );

    const { total_input = 0, total_output = 0 } = todayRows[0] ?? {};

    // 查询本月用量
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthRows = ctx.store.all<{
      total_input: number;
      total_output: number;
    }>(
      `SELECT
         COALESCE(SUM(json_extract(content, '$.usage.input_tokens')), 0) as total_input,
         COALESCE(SUM(json_extract(content, '$.usage.output_tokens')), 0) as total_output
       FROM conversation_log
       WHERE agent_id = ? AND role = 'assistant'
         AND created_at >= ?`,
      ctx.agentId,
      monthStart.toISOString(),
    );

    const monthInput = monthRows[0]?.total_input ?? 0;
    const monthOutput = monthRows[0]?.total_output ?? 0;

    // 获取当前模型
    const agent = ctx.agentManager.getAgent(ctx.agentId);
    const modelName = agent?.config?.defaultModel ?? '未配置';

    const lines = [
      '━━━ 费用统计 ━━━',
      `今日: 输入 ${total_input.toLocaleString()} / 输出 ${total_output.toLocaleString()} tokens`,
      `本月: 输入 ${monthInput.toLocaleString()} / 输出 ${monthOutput.toLocaleString()} tokens`,
      `模型: ${modelName}`,
    ];

    return { handled: true, response: lines.join('\n') };
  },
};
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/mac/src/github/jone_qian/EvoClaw && pnpm build`
Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/channel/command/builtin/cost.ts
git commit -m "feat(channel-command): 实现 /cost 命令"
```

---

### Task 7: 内置命令 — model + memory + status

**Files:**
- Create: `packages/core/src/channel/command/builtin/model.ts`
- Create: `packages/core/src/channel/command/builtin/memory.ts`
- Create: `packages/core/src/channel/command/builtin/status.ts`

- [ ] **Step 1: 实现 model 命令**

```typescript
// packages/core/src/channel/command/builtin/model.ts
/**
 * /model — 查看或切换当前模型
 */

import type { ChannelCommand } from '../types.js';

export const modelCommand: ChannelCommand = {
  name: 'model',
  description: '查看/切换模型',
  async execute(args, ctx) {
    const agent = ctx.agentManager.getAgent(ctx.agentId);
    if (!agent) {
      return { handled: true, response: '未找到 Agent 配置' };
    }

    const modelArg = args.trim();

    // 无参数 → 查看当前模型
    if (!modelArg) {
      const current = agent.config?.defaultModel ?? '未配置';
      return { handled: true, response: `当前模型: ${current}` };
    }

    // 有参数 → 切换模型
    ctx.agentManager.updateAgent(ctx.agentId, {
      config: { ...agent.config, defaultModel: modelArg },
    });
    return { handled: true, response: `模型已切换为: ${modelArg}` };
  },
};
```

- [ ] **Step 2: 实现 memory 命令**

```typescript
// packages/core/src/channel/command/builtin/memory.ts
/**
 * /memory — 显示 Agent 记忆统计
 */

import type { ChannelCommand } from '../types.js';

export const memoryCommand: ChannelCommand = {
  name: 'memory',
  description: '记忆统计',
  async execute(_args, ctx) {
    // 按类别统计记忆数量
    const rows = ctx.store.all<{ category: string; cnt: number }>(
      `SELECT category, COUNT(*) as cnt
       FROM memory_units
       WHERE agent_id = ?
       GROUP BY category
       ORDER BY cnt DESC`,
      ctx.agentId,
    );

    if (rows.length === 0) {
      return { handled: true, response: '暂无记忆数据' };
    }

    const total = rows.reduce((sum, r) => sum + r.cnt, 0);
    const lines = [`━━━ 记忆统计 (共 ${total} 条) ━━━`];
    for (const row of rows) {
      lines.push(`${row.category}: ${row.cnt}`);
    }

    return { handled: true, response: lines.join('\n') };
  },
};
```

- [ ] **Step 3: 实现 status 命令**

```typescript
// packages/core/src/channel/command/builtin/status.ts
/**
 * /status — 显示 Agent 运行状态
 */

import type { ChannelCommand } from '../types.js';

export const statusCommand: ChannelCommand = {
  name: 'status',
  description: '运行状态',
  async execute(_args, ctx) {
    const agent = ctx.agentManager.getAgent(ctx.agentId);
    if (!agent) {
      return { handled: true, response: '未找到 Agent' };
    }

    // 统计今日会话数
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const sessionRow = ctx.store.get<{ cnt: number }>(
      `SELECT COUNT(DISTINCT session_key) as cnt
       FROM conversation_log
       WHERE agent_id = ? AND created_at >= ?`,
      ctx.agentId,
      todayStart.toISOString(),
    );

    const lines = [
      '━━━ Agent 状态 ━━━',
      `名称: ${agent.name ?? ctx.agentId}`,
      `模型: ${agent.config?.defaultModel ?? '未配置'}`,
      `今日会话: ${sessionRow?.cnt ?? 0}`,
      `渠道: ${ctx.channel}`,
    ];

    return { handled: true, response: lines.join('\n') };
  },
};
```

- [ ] **Step 4: 验证编译**

Run: `cd /Users/mac/src/github/jone_qian/EvoClaw && pnpm build`
Expected: 编译成功

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/channel/command/builtin/model.ts packages/core/src/channel/command/builtin/memory.ts packages/core/src/channel/command/builtin/status.ts
git commit -m "feat(channel-command): 实现 /model /memory /status 内置命令"
```

---

### Task 8: 内置命令单元测试

**Files:**
- Create: `packages/core/src/__tests__/channel/builtin-commands.test.ts`

- [ ] **Step 1: 编写内置命令测试**

```typescript
// packages/core/src/__tests__/channel/builtin-commands.test.ts
import { describe, it, expect, vi } from 'vitest';
import { echoCommand } from '../../channel/command/builtin/echo.js';
import { debugCommand } from '../../channel/command/builtin/debug.js';
import { costCommand } from '../../channel/command/builtin/cost.js';
import { modelCommand } from '../../channel/command/builtin/model.js';
import { memoryCommand } from '../../channel/command/builtin/memory.js';
import { statusCommand } from '../../channel/command/builtin/status.js';
import { createHelpCommand } from '../../channel/command/builtin/help.js';
import { CommandRegistry } from '../../channel/command/command-registry.js';
import type { CommandContext } from '../../channel/command/types.js';

// Mock logger
vi.mock('../../infrastructure/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

function makeCtx(overrides?: Partial<CommandContext>): CommandContext {
  return {
    agentId: 'agent-1',
    channel: 'weixin',
    peerId: 'user-1',
    senderId: 'user-1',
    accountId: 'acc-1',
    store: {
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
    } as any,
    agentManager: {
      getAgent: vi.fn().mockReturnValue({ name: 'TestBot', config: { defaultModel: 'gpt-4o' } }),
      updateAgent: vi.fn(),
    } as any,
    channelManager: {} as any,
    ...overrides,
  };
}

describe('echo', () => {
  it('回显参数文本', async () => {
    const result = await echoCommand.execute('hello world', makeCtx());
    expect(result.response).toBe('hello world');
  });

  it('无参数返回空消息提示', async () => {
    const result = await echoCommand.execute('', makeCtx());
    expect(result.response).toBe('(空消息)');
  });
});

describe('debug', () => {
  it('开启 debug 模式', async () => {
    const stateRepo = {
      getState: vi.fn().mockReturnValue(null),
      setState: vi.fn(),
      deleteState: vi.fn(),
    };
    const result = await debugCommand.execute('', makeCtx({ stateRepo: stateRepo as any }));
    expect(result.response).toBe('Debug 模式已开启');
    expect(stateRepo.setState).toHaveBeenCalledWith('weixin', 'debug:acc-1', 'true');
  });

  it('关闭 debug 模式', async () => {
    const stateRepo = {
      getState: vi.fn().mockReturnValue('true'),
      setState: vi.fn(),
      deleteState: vi.fn(),
    };
    const result = await debugCommand.execute('', makeCtx({ stateRepo: stateRepo as any }));
    expect(result.response).toBe('Debug 模式已关闭');
  });

  it('无 stateRepo 返回不可用', async () => {
    const result = await debugCommand.execute('', makeCtx());
    expect(result.response).toContain('不可用');
  });
});

describe('cost', () => {
  it('返回 token 统计', async () => {
    const store = {
      all: vi.fn().mockReturnValue([{ total_input: 1000, total_output: 500 }]),
      get: vi.fn(),
    };
    const ctx = makeCtx({ store: store as any });
    const result = await costCommand.execute('', ctx);
    expect(result.response).toContain('费用统计');
    expect(result.response).toContain('1,000');
  });
});

describe('model', () => {
  it('无参数显示当前模型', async () => {
    const result = await modelCommand.execute('', makeCtx());
    expect(result.response).toBe('当前模型: gpt-4o');
  });

  it('有参数切换模型', async () => {
    const agentManager = {
      getAgent: vi.fn().mockReturnValue({ name: 'Bot', config: { defaultModel: 'gpt-4o' } }),
      updateAgent: vi.fn(),
    };
    const result = await modelCommand.execute('claude-sonnet-4-6', makeCtx({ agentManager: agentManager as any }));
    expect(result.response).toContain('claude-sonnet-4-6');
    expect(agentManager.updateAgent).toHaveBeenCalled();
  });
});

describe('memory', () => {
  it('有记忆数据返回统计', async () => {
    const store = {
      all: vi.fn().mockReturnValue([
        { category: 'entity', cnt: 10 },
        { category: 'event', cnt: 5 },
      ]),
      get: vi.fn(),
    };
    const result = await memoryCommand.execute('', makeCtx({ store: store as any }));
    expect(result.response).toContain('共 15 条');
    expect(result.response).toContain('entity: 10');
  });

  it('无记忆数据返回提示', async () => {
    const result = await memoryCommand.execute('', makeCtx());
    expect(result.response).toBe('暂无记忆数据');
  });
});

describe('status', () => {
  it('返回 Agent 状态', async () => {
    const result = await statusCommand.execute('', makeCtx());
    expect(result.response).toContain('TestBot');
    expect(result.response).toContain('gpt-4o');
  });
});

describe('help', () => {
  it('列出已注册命令', async () => {
    const registry = new CommandRegistry();
    registry.register(echoCommand);
    registry.register(costCommand);
    const helpCmd = createHelpCommand(registry);

    const result = await helpCmd.execute('', makeCtx());
    expect(result.response).toContain('/echo');
    expect(result.response).toContain('/cost');
  });

  it('列出已安装技能', async () => {
    const registry = new CommandRegistry();
    const helpCmd = createHelpCommand(registry);
    const mockDiscoverer = {
      listLocal: () => [{ name: 'summarize', slug: 'summarize', description: '总结', source: 'local' as const }],
    };

    const result = await helpCmd.execute('', makeCtx({ skillDiscoverer: mockDiscoverer as any }));
    expect(result.response).toContain('已安装技能');
    expect(result.response).toContain('/summarize');
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

Run: `cd /Users/mac/src/github/jone_qian/EvoClaw && pnpm vitest run packages/core/src/__tests__/channel/builtin-commands.test.ts`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/channel/builtin-commands.test.ts
git commit -m "test(channel-command): 内置命令单元测试"
```

---

### Task 9: 集成到 server.ts + 清理旧代码

**Files:**
- Modify: `packages/core/src/server.ts:700-733`
- Modify: `packages/core/src/routes/channel-message-handler.ts:51-74`
- Delete: `packages/core/src/channel/adapters/weixin-slash-commands.ts`
- Delete: `packages/core/src/__tests__/weixin-slash-commands.test.ts`

- [ ] **Step 1: 在 server.ts 中创建 CommandRegistry 并注册内置命令**

在 `server.ts` 的 `channelMsgDeps` 定义之前（约 687 行），插入：

```typescript
// --- 渠道命令系统 ---
import { CommandRegistry } from './channel/command/command-registry.js';
import { createCommandDispatcher, isSlashCommand } from './channel/command/command-dispatcher.js';
import { echoCommand } from './channel/command/builtin/echo.js';
import { debugCommand } from './channel/command/builtin/debug.js';
import { createHelpCommand } from './channel/command/builtin/help.js';
import { costCommand } from './channel/command/builtin/cost.js';
import { modelCommand } from './channel/command/builtin/model.js';
import { memoryCommand } from './channel/command/builtin/memory.js';
import { statusCommand } from './channel/command/builtin/status.js';

const commandRegistry = new CommandRegistry();
commandRegistry.register(echoCommand);
commandRegistry.register(debugCommand);
commandRegistry.register(costCommand);
commandRegistry.register(modelCommand);
commandRegistry.register(memoryCommand);
commandRegistry.register(statusCommand);
// help 命令需要 registry 引用，最后注册
commandRegistry.register(createHelpCommand(commandRegistry));

const dispatchCommand = createCommandDispatcher(commandRegistry);
```

- [ ] **Step 2: 修改 onMessage 回调，在 handleChannelMessage 之前插入命令拦截**

将 `server.ts:702-733` 的 `channelManager.onMessage` 回调修改为：

```typescript
channelManager.onMessage(async (msg) => {
  const targetAgentId = bindingRouter.resolveAgent({
    channel: msg.channel,
    accountId: msg.accountId,
    peerId: msg.peerId,
  });
  if (!targetAgentId) {
    log.warn(`渠道消息无路由: channel=${msg.channel} peer=${msg.peerId}`);
    return;
  }

  // --- 渠道命令拦截 ---
  if (isSlashCommand(msg.content)) {
    const cmdCtx = {
      agentId: targetAgentId,
      channel: msg.channel,
      peerId: msg.peerId,
      senderId: msg.senderId,
      accountId: msg.accountId,
      store: db,
      agentManager,
      channelManager,
      configManager,
      stateRepo: channelStateRepo,
      skillDiscoverer,
    };

    const result = await dispatchCommand(msg.content, cmdCtx);
    if (result.handled) {
      if (result.injectToConversation) {
        // 技能 fallback — 将原始消息中的 /skill-name 转为自然语言传给 AI
        const skillMessage = result.skillArgs
          ? `请执行技能 ${result.skillName}，参数: ${result.skillArgs}`
          : `请执行技能 ${result.skillName}`;

        const chatTypeForKey = msg.chatType === 'group' ? 'group' : 'direct';
        const sessionKey = generateSessionKey(targetAgentId, msg.channel, chatTypeForKey, msg.peerId);

        try {
          await handleChannelMessage(
            {
              agentId: targetAgentId,
              sessionKey,
              message: skillMessage,
              channel: msg.channel,
              peerId: msg.peerId,
              chatType: msg.chatType,
              mediaPath: msg.mediaPath,
              mediaType: msg.mediaType,
            },
            channelMsgDeps,
          );
        } catch (err) {
          log.error(`技能 fallback 处理失败: ${err}`);
        }
        return;
      }

      // 内置命令 — 直接回复
      if (result.response) {
        try {
          await channelManager.sendMessage(msg.channel, msg.peerId, result.response, msg.chatType);
        } catch (err) {
          log.error(`命令回复发送失败: ${err}`);
        }
      }
      return;
    }
  }

  // --- 正常 AI 管线 ---
  const chatTypeForKey = msg.chatType === 'group' ? 'group' : 'direct';
  const sessionKey = generateSessionKey(targetAgentId, msg.channel, chatTypeForKey, msg.peerId);

  try {
    await handleChannelMessage(
      {
        agentId: targetAgentId,
        sessionKey,
        message: msg.content,
        channel: msg.channel,
        peerId: msg.peerId,
        chatType: msg.chatType,
        mediaPath: msg.mediaPath,
        mediaType: msg.mediaType,
      },
      channelMsgDeps,
    );
  } catch (err) {
    log.error(`渠道消息处理失败: ${err}`);
  }
});
```

- [ ] **Step 3: 删除旧的 weixin-slash-commands.ts 和对应测试**

删除文件:
- `packages/core/src/channel/adapters/weixin-slash-commands.ts`
- `packages/core/src/__tests__/weixin-slash-commands.test.ts`

检查是否有其他文件引用 `weixin-slash-commands`：

Run: `cd /Users/mac/src/github/jone_qian/EvoClaw && grep -r "weixin-slash-commands" packages/core/src/ --include="*.ts" -l`

如果有引用，移除对应 import。

- [ ] **Step 4: 验证编译**

Run: `cd /Users/mac/src/github/jone_qian/EvoClaw && pnpm build`
Expected: 编译成功

- [ ] **Step 5: 运行全部测试**

Run: `cd /Users/mac/src/github/jone_qian/EvoClaw && pnpm test`
Expected: 全部 PASS（旧测试文件已删除，新测试覆盖对应场景）

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(channel-command): 集成命令系统到消息管线，清理旧 weixin-slash-commands"
```

---

### Task 10: 最终验证

- [ ] **Step 1: 运行全部测试**

Run: `cd /Users/mac/src/github/jone_qian/EvoClaw && pnpm test`
Expected: 全部 PASS

- [ ] **Step 2: 构建验证**

Run: `cd /Users/mac/src/github/jone_qian/EvoClaw && pnpm build`
Expected: 编译成功

- [ ] **Step 3: Lint 检查**

Run: `cd /Users/mac/src/github/jone_qian/EvoClaw && pnpm lint`
Expected: 无错误

- [ ] **Step 4: 手动验证清单（启动 Sidecar 后通过 IM 渠道测试）**

| 测试用例 | 预期结果 |
|---------|---------|
| 发送 `/help` | 返回命令列表 + 已安装技能 |
| 发送 `/cost` | 返回 token 统计 |
| 发送 `/model` | 返回当前模型名 |
| 发送 `/model gpt-4o` | 返回"模型已切换" |
| 发送 `/memory` | 返回记忆统计或"暂无" |
| 发送 `/status` | 返回 Agent 状态 |
| 发送 `/echo hello` | 返回 "hello" |
| 发送 `/debug` | 返回 Debug 模式开启/关闭 |
| 发送 `/toggle-debug` | 同上（别名） |
| 发送 `/summarize`（已安装技能） | 进入 AI 管线 |
| 发送 `你好` | 正常 AI 对话 |
| 发送 `/xxx` | 返回"未知命令" |
