# 渠道命令系统设计

> 日期: 2026-04-07  
> 状态: 已批准  
> 分支: feat/agent-kernel

## Context

EvoClaw 的渠道 slash command 目前是死代码——`weixin-slash-commands.ts` 定义了 `/echo` 和 `/toggle-debug` 但从未在消息管线中调用。同时命令硬编码在微信适配器中，飞书/企微渠道无法共享。

本设计将 slash command 从死代码激活为跨渠道统一的命令系统，采用注册表模式实现可扩展性，并支持命令→技能 fallback。

**前提**: 桌面端不提供 `/command` 入口（确定性操作通过 UI 按钮触发），本设计仅覆盖 IM 渠道（微信/飞书/企微）。

## 1. 接口定义

### CommandContext

```typescript
// packages/core/src/channel/command/types.ts

export interface CommandContext {
  // 基础信息
  agentId: string;
  channel: ChannelType;
  peerId: string;
  senderId: string;
  accountId: string;

  // 服务依赖
  store: SqliteStore;
  agentManager: AgentManager;
  channelManager: ChannelManager;
  configManager?: ConfigManager;
  stateRepo?: ChannelStateRepo;
  skillDiscoverer?: SkillDiscoverer;
}
```

### ChannelCommand

```typescript
export interface ChannelCommand {
  name: string;                        // 命令名（不含 /）
  aliases?: string[];                  // 别名
  description: string;                 // 描述（用于 /help）
  execute(args: string, ctx: CommandContext): Promise<CommandResult>;
}
```

### CommandResult

```typescript
export interface CommandResult {
  handled: boolean;
  response?: string;                   // 文本回复
  injectToConversation?: boolean;      // true = 技能 fallback，注入对话继续 AI 处理
  skillName?: string;                  // fallback 时的技能名
  skillArgs?: string;                  // fallback 时的技能参数
}
```

## 2. 命令分发流程

拦截点在 `server.ts` 的 `channelManager.onMessage` 回调中，`handleChannelMessage` 之前：

```
channelManager.onMessage(msg)
  ↓
  BindingRouter.resolveAgent() → agentId
  ↓
  isSlashCommand(msg.content)?  ─── 否 ──→ handleChannelMessage(正常 AI 管线)
  ↓ 是
  解析: name="cost", args="detail"
  ↓
  registry.findCommand(name)
  ↓
  ├─ 找到内置命令 → command.execute(args, ctx) → channelManager.sendMessage() 直接回复
  ├─ 未找到 → skillDiscoverer.findByName(name, agentId)
  │   ├─ 找到技能 → handleChannelMessage(注入技能指令到对话)
  │   └─ 未找到 → 回复 "未知命令，输入 /help 查看可用命令"
  └─ 命令执行出错 → 回复错误信息
```

**设计要点**:
- 内置命令不消耗 LLM token（直接回复）
- 技能 fallback 走正常 AI 管线（需要 LLM 处理技能指令）
- Desktop 渠道不经过此路径（走 Chat SSE 路由），不受影响
- `findCommand` 匹配顺序：精确名 → 别名

## 3. CommandRegistry

```typescript
// packages/core/src/channel/command/command-registry.ts

class CommandRegistry {
  private commands: Map<string, ChannelCommand>;

  register(cmd: ChannelCommand): void;
  findCommand(name: string): ChannelCommand | undefined;  // 精确名 → 别名
  listCommands(): ChannelCommand[];                        // 用于 /help
}
```

- 单例，在 server.ts 启动时创建并注册所有内置命令
- `findCommand` 先匹配 name，再遍历 aliases

## 4. 命令分发器

```typescript
// packages/core/src/channel/command/command-dispatcher.ts

async function dispatchCommand(text: string, ctx: CommandContext): Promise<CommandResult> {
  const { name, args } = parseSlashCommand(text);

  // 1. 内置命令
  const cmd = registry.findCommand(name);
  if (cmd) return cmd.execute(args, ctx);

  // 2. 技能 fallback
  if (ctx.skillDiscoverer) {
    const skill = ctx.skillDiscoverer.findByName(name, ctx.agentId);
    if (skill) {
      return { handled: true, injectToConversation: true, skillName: name, skillArgs: args };
    }
  }

  // 3. 未知命令
  return { handled: true, response: `未知命令 /${name}，输入 /help 查看可用命令` };
}
```

## 5. 内置命令集

| 命令 | 别名 | 说明 | 数据来源 |
|------|------|------|---------|
| `/help` | — | 列出所有可用命令 + 已安装技能 | registry + skillDiscoverer |
| `/cost` | — | 当前 Agent 的 token 用量和费用 | `conversation_log` 表统计 |
| `/model` | — | 查看当前模型，`/model gpt-4o` 切换 | ConfigManager + AgentManager |
| `/memory` | — | 记忆统计（各类别数量、总条数） | `memory_units` 表统计 |
| `/status` | — | Agent 运行状态（在线时长、会话数、模型） | AgentManager + store |
| `/echo` | — | 回显测试（从 weixin-slash-commands.ts 迁移） | 直接回显 |
| `/debug` | — | 切换调试模式（从 weixin-slash-commands.ts 迁移） | ChannelStateRepo |

**输出格式**: 纯文本（IM 渠道不渲染 Markdown）。

```
/cost 示例:
━━━ 费用统计 ━━━
今日: ¥2.35 (输入 12,450 tokens / 输出 3,200 tokens)
本月: ¥45.80
模型: claude-sonnet-4-6

/help 示例:
━━━ 可用命令 ━━━
/help    - 显示此帮助
/cost    - 查看费用统计
/model   - 查看/切换模型
/memory  - 记忆统计
/status  - 运行状态
/echo    - 回显测试
/debug   - 切换调试模式
━━━ 已安装技能 (3) ━━━
/summarize  /brave-search  /planning
```

## 6. 文件结构

### 新增

```
packages/core/src/channel/command/
├── types.ts                    # CommandContext, ChannelCommand, CommandResult
├── command-registry.ts         # CommandRegistry 类
├── command-dispatcher.ts       # dispatchCommand() — 解析+分发+技能fallback
└── builtin/
    ├── help.ts                 # /help
    ├── cost.ts                 # /cost
    ├── model.ts                # /model [name]
    ├── memory.ts               # /memory
    ├── status.ts               # /status
    ├── echo.ts                 # /echo
    └── debug.ts                # /debug
```

### 修改

| 文件 | 改动 |
|------|------|
| `server.ts` (~700行) | onMessage 回调中，handleChannelMessage 之前插入命令分发逻辑 |
| `channel-message-handler.ts` | 新增可选参数支持技能指令注入（fallback 场景） |
| `weixin-slash-commands.ts` | 删除，逻辑迁移到 builtin/ |

### 不改动

- 各渠道适配器（weixin.ts, feishu.ts, wecom.ts）— 命令拦截在适配器之后、handler 之前
- desktop.ts — 不走 channelManager.onMessage 路径
- skill-tool.ts / skill-arguments.ts — 参数替换已实现，无需改动

## 7. 测试计划

| 层级 | 范围 | 文件 |
|------|------|------|
| 单元测试 | CommandRegistry（注册、查找、别名、列举） | `__tests__/channel/command-registry.test.ts` |
| 单元测试 | 每个内置命令的 execute 逻辑 | `__tests__/channel/builtin-commands.test.ts` |
| 单元测试 | dispatchCommand（内置匹配→技能fallback→未知命令） | `__tests__/channel/command-dispatcher.test.ts` |
| 集成验证 | 启动 Sidecar + 微信渠道发送命令 | 手动 |

### 手动验证步骤

1. `/help` → 返回命令列表 + 已安装技能
2. `/cost` → 返回费用统计
3. `/model` → 返回当前模型
4. `/summarize`（已安装技能）→ 进入 AI 管线执行技能
5. `你好` → 正常 AI 对话（不被拦截）
6. `/xxx` → 返回"未知命令"提示

### 现有测试处理

`__tests__/weixin-slash-commands.test.ts` → 删除，场景迁移到新测试中覆盖。
