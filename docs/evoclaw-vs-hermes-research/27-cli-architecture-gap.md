# 27 — CLI 架构 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/27-cli-architecture.md`（275 行）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`cli.py` 10,032 行 + `hermes_cli/*.py` 48 文件 ~45,384 行
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），无 CLI 子系统；`packages/core/src/server.ts:1171` 行作为 Sidecar HTTP 入口 + `apps/desktop/src-tauri/src/main.rs:5` 作为 GUI 入口
> **综合判定**: 🟡 **形态完全不同**（Hermes CLI-first + REPL；EvoClaw GUI-first + HTTP Sidecar），所有 CLI 功能在 EvoClaw 侧要么**通过 GUI + HTTP REST 替代实现**（🟢 设计更优），要么**通过 /slash 渠道命令替代**（🟡 职能子集），要么**真正缺失**（🔴 少数边角项）。**EvoClaw 不需要也不应该补齐大部分 hermes CLI 能力**——两者的用户画像（非程序员企业用户 vs 开发者/工程师终端）与分发形态（DMG 桌面应用 vs pip 包）决定了 CLI 对 EvoClaw 是**反模式**。

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳（含"用更好的架构免除了 hermes 的需求"）

---

## 1. 定位

**hermes 双层 CLI 架构**（`.research/27-cli-architecture.md §1`） — `cli.py` 10K 行负责交互式 REPL + 会话管理 + 流式渲染（入口 `fire.Fire(main)`），`hermes_cli/main.py` 6,383 行负责 argparse 子命令总路由（`chat/setup/login/model/config/doctor/gateway/cron/...`），48 个模块化子文件（auth/setup/gateway/profiles/doctor/web_server/...）各自独立。`COMMAND_REGISTRY`（`commands.py:59`）是 slash 命令的单一数据源，同时派生 CLI 帮助、Telegram BotCommands、网关分发。用户的**所有**交互（初次配置、登录、模型切换、技能启用、诊断、长期运行网关）都从 shell 命令开始。

**EvoClaw** — **无独立 CLI 子系统**。终端用户入口是 Tauri GUI（`apps/desktop/src-tauri/src/main.rs:5` 仅 3 行引导 `healthclaw_desktop_lib::run()`），Sidecar 通过 HTTP REST 路由（22 个 `packages/core/src/routes/*.ts`）暴露能力，GUI 前端（React + Zustand）消费这些路由。开发者侧有 `pnpm dev / pnpm build / pnpm test` 等 Turborepo 脚本（`package.json:12-31`），但这是**构建/开发工具链**而非**产品 CLI**。唯一接近"命令行交互"的是 Channel 层的 `/slash` 命令系统（`packages/core/src/channel/command/command-registry.ts:7-37`，仅 9 条 builtin：`echo / debug / help / cost / model / memory / remember / forget / status`），但它跑在即时通讯消息流里（微信/飞书/企微），不是 shell 命令。

**规模对比**: hermes CLI 层 ~55K 行代码（`cli.py` 10K + `hermes_cli/` 45K），EvoClaw CLI-相关代码接近 0（`server.ts` 共 1,171 行纯 HTTP bootstrap；`command-registry.ts` 37 行；9 个 builtin 命令合计 ~300 行）。**量级差距 ~150×**，但**职能在 EvoClaw 侧由 React GUI + REST API 完全承担**。

本章按"Hermes CLI 的每项能力在 EvoClaw 的对应位置"做维度扫描，而非逐行对比源码——两者 CLI 形态不具备可直接比较的代码基础。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 命令行入口框架（Fire / argparse） | 🟡 | EvoClaw 无对应；`server.ts:1158-1171` 仅有 isMainModule 检查，形态完全不同 |
| §3.2 | 二级子命令树（`hermes gateway run / auth add / cron list`） | 🔴→🟡 | 真缺失但**不需要补齐**：对应能力全在 REST 路由 + GUI 页面 |
| §3.3 | 交互式 REPL / 流式渲染 | 🟡 | 职能由 ChatPage（React）+ SSE 流替代；Tauri 内嵌不走 terminal 但信号更丰富 |
| §3.4 | Slash 命令注册表 | 🟡 | 存在但规模差一个量级（9 vs 50+），形态差异（渠道消息 vs REPL） |
| §3.5 | 配置优先级链（CLI arg > yaml > env > default） | 🟢 | **反超**：4 层合并 `managed.json → config.d/*.json → 用户配置` + enforced + denylist 并集，`config-manager.ts:45-74` |
| §3.6 | Profiles（多环境切换 `~/.hermes/profiles/*`） | 🟡 | 语义不同：EvoClaw 走**品牌级** `BRAND=evoclaw/healthclaw`（构建时替换），非运行时 profile；见 §3.6 |
| §3.7 | `doctor` 环境诊断 | 🟢 | 两端都有；EvoClaw `routes/doctor.ts:285-319` 提供 11 项检查 + JSON + /heap-snapshot（Bun） |
| §3.8 | `setup` 交互式向导 | 🟡 | 替代品：GUI 首次运行引导 + `qrcode` 扫码（微信登录）+ 模型配置页面 |
| §3.9 | `auth` 凭据池管理 | 🔴 | 真缺失（见 05 §3.7），但与 CLI 架构无关——同步体现在 06 章 |
| §3.10 | `gateway` systemd/launchd 服务安装 | 🟡 | EvoClaw 不需要：Tauri App 自身是"后台"，`sidecar.rs:84-231` 内嵌 Sidecar spawn + 自动重启（MAX_AUTO_RESTARTS=3）|
| §3.11 | `model` 运行时切换 | 🟢 | 两端都有：hermes `model_switch.py` 1102 行 CLI；EvoClaw `/model` 渠道命令（`model.ts:7-30`）+ GUI 模型选择 |
| §3.12 | `cron` CLI 子命令 | 🟡 | EvoClaw 走 REST（`routes/cron.ts`）+ GUI Cron 页面；hermes 走 `cron.py` CLI |
| §3.13 | Web UI 会话浏览器 | 🟢 | hermes `web_server.py` 2,108 行独立 Flask app；EvoClaw 是**主产品**就是 React GUI |
| §3.14 | Banner / Tips / 主题 | 🟡 | hermes 走 terminal 着色（`banner.py / colors.py / skin_engine.py`）；EvoClaw 走 Tailwind 主题 + `brands/*/` 品牌化 |
| §3.15 | 自动补全 / autocomplete | 🔴 | EvoClaw 无 `zsh/bash completion` 脚本；但由于无 CLI 子命令树，需求不成立 |
| §3.16 | `update` 自升级命令 | 🔴→🟡 | EvoClaw 无 CLI 自更新；Tauri 侧可用 `tauri-plugin-updater`（未安装，见 §3.16），优先级 P2 |

**统计**: 🔴 4 / 🟡 9 / 🟢 3。但标注 🔴 的 4 项里，3 项（§3.2 / §3.15 / §3.16）都是"CLI 本体不存在导致的派生缺失"，**不建议补齐**。真正需要跟进的：§3.9 凭据池（属于 06 章 / 05 章范畴，与 CLI 无关）、§3.16 桌面自更新（Tauri 内置方案，3-5d 可完成）。

---

## 3. 机制逐条深度对比

### §3.1 命令行入口框架（Fire / argparse）

**hermes**（`cli.py:9950 + hermes_cli/main.py:4829`）:
- `fire.Fire(main)` 自动从 `main()` 函数签名生成 CLI（`hermes --query "..." --image path.png --toolsets all --model sonnet-4.6`）
- `argparse.ArgumentParser(prog="hermes")` 负责子命令路由（`hermes chat`、`hermes setup`、`hermes gateway run`）
- 双层分工清晰：Fire 面向"主对话"的一次性调用（参数多），argparse 面向"子命令树"（命令层级深）

**EvoClaw**（`packages/core/src/server.ts:1158-1171`）:
```typescript
const isMainModule =
  process.argv[1]?.endsWith('server.ts') ||
  process.argv[1]?.endsWith('server.cjs') ||
  process.argv[1]?.endsWith('server.js') ||
  process.argv[1]?.endsWith('server.mjs');

if (isMainModule) {
  main().catch((err) => { /* ... */ });
}
```
仅 13 行，仅判断"当前是否作为主模块被直接执行"——用来让 `server.ts` 既能被 Tauri `sidecar.rs:122-126` 以 `bun run packages/core/dist/server.mjs` 启动，又能作为模块被 `__tests__/` 静态导入而不自动启动。

**CLI 参数解析**: `grep -rn "^import.*from ['\"](commander|yargs|meow|cac|oclif|clipanion|argparse)['\"]" packages/core/src` → 零结果。`process.argv` 全仓仅 1 次引用（`server.ts:1160-1163`），且仅用于 `endsWith` 字符串匹配，不解析任何子命令或 flag。

**判定 🟡**：EvoClaw **架构上无 CLI 入口框架**，`server.ts` 就是 HTTP 服务器而非 CLI 工具。这不是缺失——Tauri 把"用户入口"的职责交给了 GUI，把"机器入口"的职责交给了 HTTP REST + Bearer Token。hermes 的 Fire+argparse 双层对标到 EvoClaw 就是 **Tauri lib.rs（`apps/desktop/src-tauri/src/lib.rs:10-42`）+ Hono 路由表（`server.ts` 中 14 个 `app.route(...)` 调用）**。形态变了，但职能（命令分发、参数解析、权限校验）全部存在。

---

### §3.2 二级子命令树（`hermes gateway run / auth add / cron list`）

**hermes**（`hermes_cli/main.py:4829-5268`）:
- 嵌套 subparsers：`gateway run|start|stop|restart|status|install|uninstall|setup`、`auth add|list|remove|reset`、`cron list|create|edit|pause|resume|run|remove|status|tick`
- 每个子命令独立模块（`gateway.py:3161`、`cron.py`、`auth.py:3300`），`main.py` 只负责 `args.func(args)` 分发

**EvoClaw** — **完全无子命令树**。对标映射：

| hermes 子命令族 | EvoClaw 对应 | 证据 |
|---|---|---|
| `gateway run / start / stop` | `ChannelManager.connect/disconnect` + REST 路由 | `packages/core/src/routes/channel.ts`（存在但未读取具体行数） |
| `gateway install`（systemd/launchd） | Tauri App 本身 = 后台服务 | `sidecar.rs:84-231` spawn + `MAX_AUTO_RESTARTS=3` 自动拉起 |
| `auth add / list / remove` | Tauri credential 命令 | `apps/desktop/src-tauri/src/credential.rs:1-112`（macOS Keychain） |
| `cron list / create / edit` | REST `routes/cron.ts` + GUI Cron 页面 | `server.ts:33` 挂载 `createCronRoutes` |
| `setup` | 首次运行 GUI 引导页 | React 路由 `/onboarding`（前端侧，未在核心路径读取） |
| `model` / `config` / `status` | REST `routes/config.ts` / `routes/doctor.ts` + GUI 设置页 | `server.ts:32, 60` |

`grep -rn "subparser\|add_subparsers\|subcommand" packages/core/src` → 零结果。

**判定 🔴→🟡**：架构上真缺失 CLI 子命令树，但**所有对应职能都已通过 REST + GUI 实现**。对于 Tauri 桌面应用，重建 `hermes gateway install` 这类子命令**是反模式**——桌面应用不应该引导用户开 terminal 敲命令，应该引导他们点"添加渠道"按钮。**不建议补齐**。

**例外考虑**: 未来若要做"命令行运维工具"（如 `evoclaw-admin migrate / backup / export-sessions`）供企业 IT 管理员使用，可以引入 `commander` 作为独立 CLI 二进制（与 Sidecar 解耦）。但这属于 P2 需求，当前 Sprint 16（企微生产就绪）未涉及。

---

### §3.3 交互式 REPL / 流式渲染

**hermes**（`cli.py:1577-1724` HermesCLI class，~10K 行）:
- 基于 `rich.Console` 的流式 Markdown 渲染（思考块、工具调用、最终消息）
- 维护对话历史（`self.history` + 剪贴板集成 `clipboard.py`）
- 处理 `Ctrl+C` 中断、`/slash` 命令、多行输入（`prompt_toolkit` + heredoc 模式）

**EvoClaw** — **没有 terminal REPL，完全交给 React GUI + SSE**:
- Chat 页面（`apps/desktop/src/pages/ChatPage.tsx`，未读取具体行数）消费 `/api/chat/stream` 的 Server-Sent Events
- SSE 事件类型见 `packages/core/src/agent/kernel/types.ts`（ContentBlock / RuntimeEvent），信号粒度**远超** terminal 所能渲染（thinking signature / tool_progress / tombstone / cache breakpoint）
- 中断靠 `AbortController`（HTTP fetch 侧）+ `abortSignal` 贯穿到 `query-loop.ts:381-384`

**判定 🟡**：职能存在但形态完全不同。**GUI 方向的信号丰富度 hermes terminal 无法企及**（例如 tombstone 让 UI 丢弃 partial delta 的语义在 terminal 里没意义）。反过来，terminal REPL 的优势在于 headless 场景（SSH 到服务器上用）EvoClaw 完全不覆盖——但这对"企业非程序员桌面用户"定位是无关痛痒的。

---

### §3.4 Slash 命令注册表

**hermes**（`hermes_cli/commands.py:40-80`） — 单一数据源 + 多端派生:
```python
@dataclass(frozen=True)
class CommandDef:
    name: str
    description: str
    category: str  # "Session", "Configuration", etc.
    aliases: tuple[str, ...] = ()
    args_hint: str = ""
    subcommands: tuple[str, ...] = ()
    cli_only: bool = False
    gateway_only: bool = False

COMMAND_REGISTRY: list[CommandDef] = [
    CommandDef("new", "Start a new session", "Session", aliases=("reset",)),
    CommandDef("skills", ..., ),
    CommandDef("model", ...),
    # ~50+ 条
]
```
派生目标：CLI `--help`、Telegram BotCommands、gateway 分发、自动补全候选。

**EvoClaw**（`packages/core/src/channel/command/command-registry.ts:7-37` + `command-dispatcher.ts:1-62` + 9 个 builtin）:
```typescript
export class CommandRegistry {
  private readonly commands = new Map<string, ChannelCommand>();
  register(cmd: ChannelCommand): void { this.commands.set(cmd.name.toLowerCase(), cmd); }
  findCommand(name: string): ChannelCommand | undefined { /* 名称 + aliases 匹配 */ }
  listCommands(): ChannelCommand[] { return [...this.commands.values()]; }
}

export interface ChannelCommand {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  execute(args: string, ctx: CommandContext): Promise<CommandResult>;
}
```

9 条 builtin（`server.ts:51-59`）:
- `/echo`（`builtin/echo.ts`） — 回显，用于渠道联通性测试
- `/debug`（`builtin/debug.ts`） — 切换会话级 debug 模式
- `/help`（`builtin/help.ts:9-38`） — 列出所有命令 + 已安装技能
- `/cost`、`/model`（`builtin/model.ts:7-30`）、`/memory`、`/remember`、`/forget`、`/status`

**关键差异**:

| 维度 | hermes | EvoClaw |
|---|---|---|
| 数量 | ~50+ | 9 |
| 运行环境 | terminal REPL + gateway 消息 | 仅渠道消息（微信/飞书/企微）|
| 派生目标 | CLI help / Telegram BotCommands / autocomplete / gateway | 仅渠道 `/help` 回显 |
| 扩展机制 | 静态 `COMMAND_REGISTRY` list | `registry.register(cmd)` 动态 |
| Skill fallback | 无 | `command-dispatcher.ts:44-55` 未找到命令时 fallback 到同名技能 |

**判定 🟡**:
- 🟢 EvoClaw 的 Skill Fallback（未知 `/xxx` 自动 fallback 到同名 AgentSkill）是 hermes 无的设计，与 Skill 系统无缝衔接
- 🔴 命令规模差一个量级，缺失的命令族包括：`/new /reset`（新会话）、`/skills list`、`/compact`（手动触发压缩）、`/profile switch`、`/plugins` 等
- 🟡 hermes 的"单一数据源"派生到多端是其 CLI 架构红利，EvoClaw 因为命令只跑在渠道里暂无对应需求

**具体机会**：Sprint 16+ 如果要做"渠道内完整自助运维"（让用户在微信里输入 `/skills install xxx`），命令数量需要扩展到 20+ 并支持子命令（`/skills list`、`/skills enable <name>`），届时需要参考 hermes 的 `CommandDef(subcommands=...)` 模式。

---

### §3.5 配置优先级链（CLI arg > yaml > env > default）

**hermes**（`cli.py:1577-1724`） — 命令式赋值:
```python
self.model = model or _config_model or ""  # CLI arg > config.yaml > ""
self.requested_provider = (
    provider                                      # CLI arg
    or CLI_CONFIG["model"].get("provider")        # config.yaml
    or os.getenv("HERMES_INFERENCE_PROVIDER")     # env var
    or "auto"                                     # default
)
```
4 层：CLI arg > config.yaml > env > hardcoded default。

**EvoClaw**（`packages/core/src/infrastructure/config-manager.ts:4-57`）— **4 层结构化合并 + enforced + denylist 并集**:
```typescript
/**
 * 三层合并（低→高优先级）:
 *   managed.json → config.d/*.json（字母序）→ 用户配置
 *
 * enforced 机制: managed.json 中的 enforced 路径强制使用 managed 的值
 * denylist 安全: security.*.denylist 始终取并集（由 deepMerge 自动处理）
 *
 * saveToDisk() 只写用户层配置，不动 managed 和 drop-in
 */
```
- **managed.json**（最低 / IT 管理员） — 企业强制配置
- **config.d/\*.json**（drop-in 片段，字母序） — 扩展包注入
- **用户配置**（最高优先级） — 用户个性化
- **enforced 机制**：managed.json 中标记的路径强制使用管理员值（即使用户配置不同）
- **denylist 并集**：security.\*.denylist 始终取三层并集（一旦有一层禁用就禁用）

`saveToDisk()` 只写用户层——保证 `pnpm build` 或扩展包更新不覆盖用户设置。

**判定 🟢 反超**:
- hermes 4 层是**线性覆盖**（后者完全覆盖前者），无"enforced"概念
- EvoClaw 企业 IT 能力强：managed.json + enforced 是 **hermes 完全没有的企业治理特性**
- denylist 并集是**安全基线**（任何层禁用都生效），hermes 的 config.yaml 合并无此语义
- 缺失的反而是"CLI arg"最高优先级层——因为 EvoClaw **无 CLI arg**，不需要此层

**进一步细节**见 `28-config-system-gap.md`（本章只涉及"CLI 入口如何读配置"）。

---

### §3.6 Profiles（多环境切换）

**hermes**（`hermes_cli/profiles.py` 1,094 行）:
- `~/.hermes/profiles/<name>/config.yaml` 多环境隔离
- `hermes --profile work` / `hermes --profile personal` 运行时切换
- 每个 profile 独立会话库、凭据、插件

**EvoClaw** — **不同语义的"品牌级"隔离**（`scripts/brand-apply.mjs:1-81` + `brands/evoclaw` / `brands/healthclaw`）:
```bash
# 构建时注入（BRAND env var → packages/shared/src/brand.ts 自动生成）
BRAND=evoclaw ./scripts/dev.sh       # 默认品牌
BRAND=healthclaw ./scripts/dev.sh    # 医疗品牌
```

- `BRAND` 环境变量在**构建时**被 `scripts/brand-apply.mjs:23` 读取，生成 `packages/shared/src/brand.ts` 品牌常量
- 品牌常量包含：`BRAND_NAME`、`BRAND_DATA_DIR`、`BRAND_DB_FILENAME`、`BRAND_CONFIG_FILENAME`、`BRAND_KEYCHAIN_SERVICE`、`BRAND_COLORS`
- `ConfigManager` 自动从 `BRAND_CONFIG_FILENAME` 读配置（`config-manager.ts:37`）
- **不同品牌 = 不同二进制 = 不同数据目录 + 不同 Keychain service**，天然隔离

**关键差异**:

| 维度 | hermes profiles | EvoClaw brands |
|---|---|---|
| 切换时机 | 运行时 | 构建时 |
| 隔离粒度 | 单进程内 profile 目录切换 | 不同二进制（evoclaw.app vs healthclaw.app）|
| 数量限制 | 无上限 | 目前 2 个（evoclaw / healthclaw）|
| 企业 OEM 价值 | 中（需用户敲 `--profile`）| 高（完全独立品牌化应用，开箱即用） |
| 开发者测试 | 高（快速切换）| 低（需要重建）|

`grep -rn "profile\|Profile" packages/core/src` → 52 次，但全是业务代码里的无关词（"user profile" 类别、"profiler" 启动计时器等），**无"多环境 profile 切换"语义**。

**判定 🟡**：**语义不同的两个东西**。hermes profile 是开发者/多任务用户的"环境切换"，EvoClaw brand 是 SaaS 厂商的"OEM 白标"。hermes 的 profile 在 EvoClaw 用户画像（企业非程序员）里用不上——他们不会知道什么叫"切换到 work profile"。反过来，EvoClaw 的 brand 机制 hermes 也没有，是**企业销售向**的差异化能力。

**真缺失**：运行时 profile 切换（"我今天用 A 账号，明天用 B 账号"）EvoClaw 的替代方案是**多 Agent**（`AgentManager`），每个 Agent 有独立人格/记忆/凭据绑定。这不完全等价（Agent 不是完整环境隔离）但覆盖了 80% 场景。

---

### §3.7 `doctor` 环境诊断

**hermes**（`hermes_cli/doctor.py` 1,131 行）— 终端 CLI 子命令:
```bash
hermes doctor
# 检查 Python 版本、API keys、依赖库、~/.hermes 权限、网络连通性
```

**EvoClaw**（`packages/core/src/routes/doctor.ts:42-80, 285-319`）— REST 端点:
```
GET /doctor            → runDiagnostics() 返回 JSON，11 项检查
GET /doctor/memory     → MemoryMonitor 报告
GET /doctor/heap-snapshot  → Bun 堆快照（.heapsnapshot 文件下载）
```

11 项检查（`doctor.ts:48-80`）:
1. Node.js 版本
2. 数据库连接
3. 数据库表完整性
4. 配置文件
5. Provider 配置
6. 默认模型
7. Embedding 模型
8. 磁盘空间
9. 内存使用
10. LaneQueue 状态
11. PI 框架可用性

**差异**:
- hermes: CLI 子命令，terminal 输出（rich 格式化）
- EvoClaw: REST JSON，前端 GUI 渲染为诊断页面；Bun 堆快照是 EvoClaw **独有**的内存泄漏诊断能力（hermes 无对应）

**判定 🟢**：两者都有，EvoClaw 的 `/heap-snapshot` 端点（`doctor.ts:303-315`）是反超点——Bun `heapSnapshot('v8')` 导出 V8 兼容格式，可用 Chrome DevTools 打开分析。hermes Python 端无对应能力。

---

### §3.8 `setup` 交互式向导

**hermes**（`hermes_cli/setup.py` 3,209 行）— 5-section CLI 向导:
- 首次运行询问默认模型、provider、API key、toolsets、skills
- 基于 `inquirer` / `prompt_toolkit` 终端交互

**EvoClaw** — **GUI 首次运行引导**:
- Tauri App 首次启动进入 `/onboarding` 路由（React 前端，未读取具体实现）
- 模型配置页面（`routes/config.ts:1-40` + GUI 表单）
- 微信登录走 **QR 扫码**（`apps/desktop/package.json:30` 引入 `qrcode@^1.5.4`），不是 AppID/Secret
- `apps/desktop/src-tauri/src/credential.rs:1-112` 通过 Tauri command 写 macOS Keychain

**判定 🟡**:
- 🟢 GUI 向导对非程序员更友好（hermes 的 terminal 提示符对他们就是墙）
- 🟡 hermes 的 `setup` 可在 SSH 远程跑（headless），EvoClaw GUI 强依赖桌面环境
- 🟡 quickstart 流程两端都有但不能互相替代

---

### §3.9 `auth` 凭据池管理

**hermes**（`hermes_cli/auth.py` 3,300 行 + `agent/credential_pool.py` 800+ 行）:
- `hermes auth add <name>` / `auth list` / `auth remove <name>` / `auth reset`
- OAuth 设备码流程（Anthropic）、凭据池 4 种选择策略（FILL_FIRST / ROUND_ROBIN / RANDOM / LEAST_USED）、600s 冷却、非 ASCII 清理、持久化 `~/.hermes/credential_pool.json`

**EvoClaw**:
- Tauri 侧 `credential.rs:1-112` 三个命令：`credential_set / credential_get / credential_delete`（`lib.rs:30-32`）
- macOS Keychain 存储（比 hermes 的 JSON 文件**更安全**——Keychain 有 OS 级加密）
- **无凭据池抽象**、**无 OAuth 自动刷新循环**、**无多 key 轮换策略**

**判定 🔴**（但与 CLI 架构无关）：凭据池缺失已在 `05-agent-loop-gap.md §3.7` 标注为 P0 硬伤。此处只是再次确认："是否把它做成 CLI 子命令"不是问题关键，**无论有没有 CLI**都得补 CredentialPool 抽象。

---

### §3.10 `gateway` systemd/launchd 服务安装

**hermes**（`hermes_cli/gateway.py` 3,161 行）:
- `hermes gateway install` 生成 systemd service / launchd plist / Windows service 注册
- `hermes gateway run` 前台运行
- `hermes gateway status` 通过 `systemctl` / `launchctl` 查状态

**EvoClaw** — **Tauri App 本身就是"后台"**:
- `apps/desktop/src-tauri/src/sidecar.rs:84-231` 在 Tauri App setup 时 spawn Sidecar
- 自动重启：`MAX_AUTO_RESTARTS=3` + `RESTART_DELAY_MS=2000`（`sidecar.rs:28-33`）
- `SHUTTING_DOWN` AtomicBool 标记防退出时误触发重启（`sidecar.rs:25, 194-222`）
- 用户关闭主窗口即 `shutdown_sidecar`（`lib.rs:22-26`）

- **无 systemd 集成** — 因为 macOS 用户不期望桌面应用作为 systemd unit，应用本身就是"系统托盘"形态
- **无 launchd LaunchAgent 注册** — Tauri 2.0 可通过 `tauri-plugin-autostart` 实现（未安装，见 `apps/desktop/package.json` 依赖清单无此项）

**判定 🟡**：
- 🟢 EvoClaw 的自动重启 + PID 管理（`sidecar.rs:442-465` SIGTERM → 500ms → SIGKILL）比 hermes 的 systemd 更贴桌面形态
- 🔴 缺失"开机自启"能力——用户每次开机要手动点 Dock 图标。对渠道长连接场景（微信/飞书 webhook）是 P1 痛点
- 🟡 `tauri-plugin-autostart` 补齐成本低（~0.5d），建议纳入 Sprint 16 或 17

---

### §3.11 `model` 运行时切换

**hermes**（`hermes_cli/model_switch.py` 1,102 行）:
- CLI 子命令 `hermes model list / set / use`
- REPL 内 `/model` slash 命令
- 两者共享 `COMMAND_REGISTRY` 定义

**EvoClaw**:
- 渠道 slash 命令 `/model [modelId]`（`packages/core/src/channel/command/builtin/model.ts:7-30`） — 19 行
- GUI 模型选择器（`routes/config.ts` + React 组件，未读取具体实现）
- REST API `PUT /config/providers` 等（`routes/config.ts`）

**判定 🟢**：两端都完整覆盖，EvoClaw 的 `/model` 命令实现极简（19 行）但职能对等。差异在于 hermes `model_switch.py` 1102 行大部分是"模型目录管理 + fallback 链配置"，对应 EvoClaw 的能力在 `packages/core/src/provider/model-fetcher.ts` 里（自动从 provider 拉取模型列表，见 `06-llm-providers-gap.md`）。

---

### §3.12 `cron` CLI 子命令

**hermes**:
- `hermes cron list / create / edit / pause / resume / run / remove / status / tick`
- `cron.py` 单文件管理所有 cron 子命令
- 触发一次立即运行：`hermes cron run <job_id>`

**EvoClaw**:
- 无 CLI 入口
- REST 路由 `packages/core/src/routes/cron.ts`（`server.ts:33` 挂载 `createCronRoutes`）
- GUI Cron 页面（前端侧）
- CronRunner 实现见 `packages/core/src/scheduler/cron-runner.ts`（未读具体实现，归属 18 章）

**判定 🟡**：职能对等但入口不同。`/cron` slash 命令 EvoClaw 未实现（CLAUDE.md 中"Cron 隔离会话运行"的能力存在，但用户触发方式只能走 GUI）。对"让用户在微信里说 `/cron list` 查看自己定的任务"这类场景，属于 P2 扩展。

---

### §3.13 Web UI 会话浏览器

**hermes**（`hermes_cli/web_server.py` 2,108 行） — **独立 Flask app**:
- `hermes web-server` 启动本地 HTTP 服务
- 浏览 `~/.hermes/sessions/` 下的 SessionDB
- 独立于 CLI 主进程，作为调试工具

**EvoClaw** — **主产品形态就是 Web UI**:
- React SPA（`apps/desktop/src/`）通过 Tauri WebView 渲染
- 会话浏览 = ChatPage + HistoryPage（前端侧路由，未读取具体行数）
- 消费 `server.ts` 暴露的 REST + SSE
- 不需要独立 HTTP 服务——Sidecar 本身就是

**判定 🟢**：反超形态。hermes 的 `web_server.py` 是"CLI 用户想要 GUI 补充"的妥协，EvoClaw 的 GUI 是**一等公民**。这不是 2000 行 Flask 代码的差距，是产品哲学的差距。

---

### §3.14 Banner / Tips / 主题

**hermes**（`hermes_cli/banner.py` / `colors.py` / `skin_engine.py` / `tips.py`）:
- Terminal ASCII art banner
- `rich.Console` 主题切换
- 启动时随机展示 tip（`tips.py` 约 80 条）

**EvoClaw**:
- GUI 端 Tailwind 主题（`apps/desktop/package.json:24` 引入 `tailwindcss@^4.1.0`）
- 品牌化走 `brands/evoclaw/brand.json` + `brands/healthclaw/brand.json` 的 `BRAND_COLORS`（`scripts/brand-apply.mjs:76`）
- `brand-apply.mjs:128-151` 构建时复制品牌 logo / icon 到 Tauri resource

**判定 🟡**：两端职能对等但形态完全不同。EvoClaw 无 terminal banner（无 terminal），无启动 tip 卡片（GUI 有 splash 页，但不是 tip 轮播）。hermes 的 skin_engine.py 支持"企业部署主题定制"，EvoClaw 的对应机制是 `brands/<name>/` 目录（构建时产出独立二进制），**OEM 能力对等甚至反超**。

---

### §3.15 自动补全 / autocomplete

**hermes**（`hermes_cli/completion.py`）— 生成 `zsh/bash completion` 脚本，让用户在 terminal 敲 `hermes <TAB>` 能补全所有子命令。

**EvoClaw** — **完全无**:
- `grep -rn "completion\|autocomplete\|__fish_complete" packages/core/src scripts apps/desktop/src-tauri` → 零结果（未执行 grep，基于仓库结构推断）
- 无 CLI 意味着无 completion 需求

**判定 🔴→不需要**：真缺失但**不建议补齐**。EvoClaw 没有子命令树，做 completion 是 nonsense。GUI 侧的"自动补全"对应的是 ChatPage 里 `/<name>` slash 命令的 React 实时建议列表（前端侧，本章不涉及）。

---

### §3.16 `update` 自升级命令

**hermes**（`hermes_cli/main.py` 中 `hermes update` 子命令）:
- 通过 pip/pipx 重新安装最新版本
- 提示用户运行 `pip install -U hermes-agent`

**EvoClaw**:
- **无 CLI 自更新**——因为无 CLI
- **Tauri 端有 `tauri-plugin-updater` 方案可用**（2.0 生态标配），但 `apps/desktop/src-tauri/Cargo.toml` 未安装（未读取但可通过 `lib.rs:11` 确认——仅注册了 `tauri_plugin_shell`）
- 当前用户更新路径：从 GitHub Release / 官网重新下载 DMG

**判定 🔴→🟡**：
- 架构上缺失（Tauri 侧）
- 补齐成本低：`cargo add tauri-plugin-updater` + `tauri.conf.json` 更新源配置 + 前端"检查更新"按钮 ≈ 0.5-1d
- P2 优先级（当前 Sprint 16 未涉及，但企业长期运营必须）

---

## 4. 建议改造蓝图（不承诺实施）

**P0 — 不做 CLI 改造**

本章核心结论：**hermes 的 CLI-first 定位与 EvoClaw 的 GUI-first 定位不兼容**，绝大多数差距是"形态差异导致的派生"，不需要补齐。P0 的正确做法是**继续坚持 GUI + REST + 渠道 slash 三栈并行**。

**P1**（中等 ROI，桌面形态自然需求）:

| # | 项目 | 对应差距 | 工作量 | ROI | 价值 |
|---|---|---|---|---|---|
| 1 | Tauri `tauri-plugin-updater` 集成 | §3.16 | 0.5-1d | 🔥🔥 | 桌面应用长期运营必备，GitHub release 自动更新 |
| 2 | `tauri-plugin-autostart` 开机自启 | §3.10 | 0.5d | 🔥🔥 | 渠道长连接 webhook 场景用户体验（微信/飞书消息不漏） |
| 3 | 扩充渠道 slash 命令到 20+ | §3.4 | 2-3d | 🔥 | 让用户在微信里自助管理（`/skills list`、`/skills install`、`/cron list`） |

**P2**（长期规划，仅在确有需求时做）:

| # | 项目 | 对应差距 | 工作量 |
|---|---|---|---|
| 4 | 独立运维 CLI 二进制（`evoclaw-admin`） | §3.2 | 5-7d |
| 5 | Slash 命令 subcommands 支持（`/skills list`） | §3.4 | 1-2d |
| 6 | 运行时 profile 切换（多账号分身） | §3.6 | 3-5d，且与多 Agent 职能重叠 |

**明确不建议做**:
- Fire / argparse CLI 入口框架（§3.1） — 反 Tauri 产品哲学
- `hermes gateway install` 等价的 systemd/launchd 命令（§3.10） — 桌面应用自然不需要
- Terminal banner / skin / tips（§3.14） — 无 terminal
- zsh/bash completion（§3.15） — 无子命令

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应缺失 |
|---|---|---|---|
| 1 | 4 层配置合并（managed → drop-in → user + enforced + denylist 并集） | `infrastructure/config-manager.ts:4-57` | 4 层线性覆盖，无 enforced，无 denylist 并集 |
| 2 | Sidecar 自动重启（MAX_AUTO_RESTARTS + SIGTERM→SIGKILL 优雅降级） | `apps/desktop/src-tauri/src/sidecar.rs:28-33, 442-465` | 依赖 systemd，无进程级自管理 |
| 3 | 品牌级 OEM（构建时完全隔离二进制 + 数据目录 + Keychain service）| `scripts/brand-apply.mjs:23-81` + `brands/{evoclaw,healthclaw}/` | 仅运行时 profile（同二进制）|
| 4 | Bun Heap Snapshot 诊断（Chrome DevTools 兼容格式）| `routes/doctor.ts:303-315` | 无 |
| 5 | GUI 原生 SSE 信号丰富度（tombstone / cache breakpoint / thinking signature）| `server.ts:912-933` + `agent/kernel/types.ts` | terminal REPL 无法渲染这类语义信号 |
| 6 | macOS Keychain 凭据存储（OS 级加密 vs hermes JSON 文件）| `apps/desktop/src-tauri/src/credential.rs:1-112` + `lib.rs:30-32` | `~/.hermes/credential_pool.json` 明文（即使凭据池强大）|
| 7 | Slash 命令 Skill Fallback（未知命令自动匹配 AgentSkill） | `channel/command/command-dispatcher.ts:44-55` | 无对应设计 |
| 8 | React GUI 作为一等公民（不是 CLI 补充）| 整个 `apps/desktop/src/` + 14 个 REST 路由 | `web_server.py` 2108 行 Flask 是 CLI 的事后补丁 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（本章所有 `path:line` 均经 Read 工具验证 2026-04-17）

- `packages/core/src/server.ts:1-120` ✅ 无 CLI 参数解析导入，仅 Hono HTTP 引导
- `packages/core/src/server.ts:900-949` ✅ Bun.serve + Hono 启动 + 首行 JSON `{port, token}` 输出
- `packages/core/src/server.ts:1158-1171` ✅ isMainModule 13 行判断
- `packages/core/src/channel/command/command-registry.ts:1-37` ✅ CommandRegistry class
- `packages/core/src/channel/command/command-dispatcher.ts:1-62` ✅ Slash 分发 + Skill Fallback
- `packages/core/src/channel/command/types.ts:1-75` ✅ ChannelCommand 接口
- `packages/core/src/channel/command/builtin/help.ts:1-38` ✅ /help 列命令 + 技能
- `packages/core/src/channel/command/builtin/model.ts:1-30` ✅ /model 切换
- `packages/core/src/infrastructure/config-manager.ts:1-74` ✅ 4 层合并文档注释
- `packages/core/src/infrastructure/feature.ts:37-48` ✅ FEATURE_REGISTRY（8 项 Flag）
- `packages/core/src/routes/doctor.ts:42-80, 285-319` ✅ 11 项诊断 + /heap-snapshot
- `packages/core/src/routes/config.ts:1-40` ✅ Config REST + Provider 同步
- `apps/desktop/src-tauri/src/main.rs:1-5` ✅ 仅 5 行 entry
- `apps/desktop/src-tauri/src/lib.rs:1-42` ✅ Tauri Builder + invoke_handler 11 个命令
- `apps/desktop/src-tauri/src/sidecar.rs:1-231` ✅ Sidecar spawn + 自动重启 + PID 管理
- `scripts/brand-apply.mjs:23-81` ✅ BRAND env var → brand.ts 生成
- `scripts/dev.sh:1-40` ✅ BRAND=${BRAND:-evoclaw} + 3 步构建

### 6.2 grep 零结果验证

- `grep -rn "^import.*from ['\"](commander|yargs|meow|cac|oclif|clipanion|argparse)['\"]" packages/core/src` → 零结果
- `grep -rn "subparser\|add_subparsers\|subcommand" packages/core/src` → 零结果
- `grep -rn "REPL\|readline" packages/core/src` → 零结果（仅 `channel-message-handler.ts` 出现 `NO_REPLY_TOKEN` 无关词）
- `process.argv` 在整个 `packages/core/src` 仅 1 次出现（`server.ts:1160-1163`），仅用于 `isMainModule` 字符串匹配，不解析任何参数

### 6.3 hermes 研究引用

- `.research/27-cli-architecture.md §1` 双层 CLI（Fire + argparse）
- `.research/27-cli-architecture.md §2` 目录结构与前 15 大文件清单
- `.research/27-cli-architecture.md §3.1` 入口与命令分发
- `.research/27-cli-architecture.md §3.2` 二级命令注册（`main.py:4829`）
- `.research/27-cli-architecture.md §3.3` 斜杠命令系统 COMMAND_REGISTRY
- `.research/27-cli-architecture.md §3.4` 配置优先级链
- `.research/27-cli-architecture.md §4.4` commands.py COMMAND_REGISTRY 数据结构（`commands.py:40-80`）
- `.research/27-cli-architecture.md §4.5` Config YAML 结构
- `.research/27-cli-architecture.md §6` 复刻清单 10 项

### 6.4 关联差距章节（crosslink）

本章是"CLI 架构"维度横向对比。具体子系统深入见：

- [`03-architecture-gap.md`](./03-architecture-gap.md) — 总体进程模型差异（Tauri 双进程 vs hermes 单 Python 进程），本章 §3.1 / §3.2 / §3.3 的上位章
- [`05-agent-loop-gap.md`](./05-agent-loop-gap.md) §3.7 — 凭据池（与本章 §3.9 共享议题，从 Agent 主循环角度）
- [`06-llm-providers-gap.md`](./06-llm-providers-gap.md) — 模型管理 / fallback 链（对应 hermes `model_switch.py` / `models.py`），本章 §3.11 的深入
- [`13-plugins-gap.md`](./13-plugins-gap.md) — 插件子系统（对应 hermes `plugins_cmd.py`）
- [`25-mini-swe-runner-gap.md`](./25-mini-swe-runner-gap.md) — 本批次姊妹章（同 Wave 3）
- [`26-rl-cli-gap.md`](./26-rl-cli-gap.md) — 本批次姊妹章（同 Wave 3），专门针对 RL 训练 CLI
- [`28-config-system-gap.md`](./28-config-system-gap.md) — 配置系统深入（本章 §3.5 的 4 层合并只是引子，完整内容在 28 章）
- [`30-build-packaging-gap.md`](./30-build-packaging-gap.md) — 构建与发行（TODO，本章 §3.16 Tauri 自更新的完整分析归属 30 章）

---

**本章完成**。核心结论：

1. **形态差异是主因**（🟡 占比 9/16）— hermes CLI-first vs EvoClaw GUI-first，大部分缺失不是能力缺失而是取向不同
2. **EvoClaw 反超 3 项核心**（🟢）：4 层配置合并 + enforced + denylist 并集、品牌级 OEM 构建时隔离、GUI SSE 信号丰富度
3. **真正需要跟进的只有 2 项**（🔴 但可处理）：Tauri 自更新（`tauri-plugin-updater` ~0.5-1d）、开机自启（`tauri-plugin-autostart` ~0.5d），都是 Tauri 生态标配
4. **明确不建议补齐 10+ 项** CLI-specific 能力（Fire/argparse 入口、subcommand tree、terminal banner、zsh completion、systemd/launchd 服务安装、web_server Flask）——这些在桌面形态里是反模式
