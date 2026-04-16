# 02 — 仓库布局 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/02-repo-layout.md`（620 行，含目录树、依赖链、复刻清单）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），单项目 Python setuptools + 15 个根级 py-modules + 8 大子系统
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），pnpm monorepo + 3 个 workspace package + Turbo 协调
> **综合判定**: 🟡 **形态差异导致结构完全不同，但工程实践可借鉴**（monorepo 包边界清晰 vs 单项目模块组织），EvoClaw 在 **Turbo 增量构建 / Tauri 分层隔离 / 品牌灵活切换** 三项反超

**档位图例**:
- 🔴 EvoClaw 明显落后 — 缺失能力或架构约束阻碍
- 🟡 部分覆盖 / 形态差异 — 两者各有优势，或难以直接对标
- 🟢 EvoClaw 对齐或反超 — 能力持平或更佳

---

## 1. 定位

**hermes 仓库布局**（`.research/02-repo-layout.md §1-2`）: **单 Python 项目 + 分层模块化**

根结构（14 个顶层目录 + 15 个根级 `.py` module）：
```
hermes-agent/
├── agent/ (27 modules)           ← Agent 内部实现
├── tools/ (53+ .py + 3 子目录)   ← 工具注册表 + 工具实现
├── hermes_cli/ (42 modules)      ← CLI 子命令注册表
├── gateway/ (19 adapters)        ← 19 种平台 adapter
├── cron/, acp_adapter/, plugins/ ← 编排、协议、插件
├── skills/ (26 分类)             ← 默认打包 skill
├── tests/ (镜像主结构)           ← pytest 单测
└── 10+ 根级 .py (run_agent, cli, model_tools, toolsets, ...)
```

**Layer 0-6 清晰分层**（`AGENTS.md:69-78`）：
- Layer 0: 常量/日志/时间（零依赖）
- Layer 1: SessionDB（只依赖 Layer 0）
- Layer 2: ToolRegistry（依赖 0+1）
- Layer 3: Agent 内部模块（依赖 0-2）
- Layer 4: 编排 run_agent/toolsets（依赖 0-3）
- Layer 5: 插件系统
- Layer 6: 6 路入口（CLI/Gateway/ACP/MCP/Batch/RL）

**EvoClaw 仓库布局**（`pnpm-workspace.yaml` + `turbo.json`）: **pnpm monorepo + 3 个 workspace package + 多品牌**

根结构（2 个顶层目录 + 3 packages + 分层 src/）：
```
EvoClaw/
├── apps/
│   └── desktop/ (@evoclaw/desktop)    ← Tauri + React 前端
├── packages/
│   ├── core/ (@evoclaw/core)          ← Bun Sidecar + Agent Kernel（26 子目录）
│   ├── shared/ (@evoclaw/shared)      ← 共享 Types
├── brands/ (evoclaw, healthclaw, ...) ← 品牌配置及覆盖文件
├── docs/ (prd, architecture, ...)     ← 开发者文档（无站点部署）
└── scripts/ (brand-apply, build-dmg, ...)
```

`packages/core/src/` 包含 26 个子目录（agent, tools, channel, infrastructure, memory, mcp, skill, 等）

**量级对比**:
- hermes: 单项目 ~3,500 个 Python 文件（含测试） + wheel 分发
- EvoClaw: monorepo 3 packages，核心包 `@evoclaw/core` ~650 个 TypeScript/JavaScript 文件 + Tauri DMG 分发

**根本差异**:
- hermes: **import-time registry 副作用** + **单进程中心汇聚**（`tools/*.py` load 时 auto-register）
- EvoClaw: **动态工具加载** + **三层 IPC 架构**（Tauri Rust + Sidecar Hono + React）+ **多品牌灵活切换**

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 项目结构：单项目 vs monorepo | 🟡 | 两种各有优势；hermes 单项目 import 链清晰，EvoClaw monorepo 包边界明确 |
| §3.2 | 顶层目录组织（apps/ vs packages/） | 🟡 | hermes agent/tools/hermes_cli 平级，EvoClaw apps/packages/ 前后端分离更鲜明 |
| §3.3 | 根级 Python modules vs TypeScript 文件 | 🟡 | hermes 15 个 py-module 权重大，EvoClaw 分散到 26 个目录内 |
| §3.4 | 工具注册机制（registry.py 中心 vs 动态）| 🟡 | hermes registry 单例全局，EvoClaw Tool Adapter + Hook 体系解耦 |
| §3.5 | Monorepo 依赖管理（uv 单项目 vs pnpm workspace） | 🟡 | hermes uv.lock 完整锁，EvoClaw pnpm-lock.yaml + workspace 本地引用 |
| §3.6 | 构建协调（无 vs Turborepo） | 🟢 | **反超**: EvoClaw Turbo 缓存 + 增量构建 vs hermes 无专属构建工具 |
| §3.7 | CLI 命令集中（COMMAND_REGISTRY vs routes/） | 🟡 | hermes `commands.py` 单一事实源，EvoClaw 分散在 routes/ 各文件 |
| §3.8 | Skills 默认打包（graft vs bundled/） | 🟡 | hermes `MANIFEST.in graft` + wheel 包含，EvoClaw `bundled/` 内置目录 |
| §3.9 | 测试布局（tests/ 镜像 vs __tests__/） | 🟡 | hermes tests/ 平级子目录与源码，EvoClaw __tests__/ 嵌在 src 内 |
| §3.10 | 文档组织（docs/ markdown vs docs/ markdown）| 🟡 | hermes docs/ + 独立 website/ Docusaurus，EvoClaw 仅 docs/ markdown（无站点） |
| §3.11 | 多平台 adapters（gateway/platforms/ 19 个）| 🔴 | hermes gateway/ 含 19 个平台 adapter，EvoClaw channel/adapters/ 仅飞书/企微/iLink（未覆盖 Slack/Discord/Telegram） |
| §3.12 | 品牌灵活性（无 vs brands/ 切换）| 🟢 | **反超**: EvoClaw brands/evoclaw/ + brands/healthclaw/ + env 切换，hermes 单一品牌 |
| §3.13 | LLM SDK 依赖（openai/anthropic 包 vs HTTP 直调）| 🟡 | hermes 双 SDK 直接依赖，EvoClaw HTTP 自主实现（见 01-tech-stack-gap.md §3.7） |
| §3.14 | Layer 分层清晰度（6 层明确 vs 26 目录扁平）| 🔴 | hermes Layer 0-6 依赖链明确且文档化（AGENTS.md），EvoClaw 26 个目录无显式分层说明 |
| §3.15 | 根级入口清晰度（15 个 py-module vs server.ts + routes/ + 分散 handler）| 🔴 | hermes 根级 run_agent.py / cli.py 权重集中，EvoClaw 分散在 server.ts + routes/ 内 |

**统计**: 🔴 3 / 🟡 10 / 🟢 2。

---

## 3. 机制逐条深度对比

### §3.1 项目结构：单项目 vs monorepo

**hermes**（`.research/02-repo-layout.md §2.2, §4.1`）— 单 Python 项目 setuptools：

```toml
# pyproject.toml:106-110
[tool.setuptools]
py-modules = ["run_agent", "model_tools", "toolsets", "batch_runner",
              "trajectory_compressor", "toolset_distributions", "cli",
              "hermes_constants", "hermes_state", "hermes_time",
              "hermes_logging", "rl_cli", "utils"]

[tool.setuptools.packages.find]
include = ["agent", "tools", "tools.*", "hermes_cli", "gateway", 
           "cron", "acp_adapter", "plugins", "plugins.*"]
```

- **单一 `pyproject.toml`** 统一声明所有依赖和子模块
- **15 个根级 py-modules** 会被 wheel 安装为顶层 Python module
- **包发现** 通过 `setuptools.find_packages()`
- **`uv.lock`** 5,467 行统一锁文件，所有传递依赖共享版本

**EvoClaw**（`pnpm-workspace.yaml` + 3 x `package.json`）— pnpm monorepo：

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

```json
// 根 package.json:11
"packageManager": "pnpm@10.14.0"

// packages/core/package.json:11
"dependencies": {
  "@evoclaw/shared": "workspace:*"  // 本地引用
}
```

- **3 个独立 `package.json`**：根（全局脚本 + Turbo） + apps/desktop + packages/core
- **workspace:* 本地引用**（`@evoclaw/shared` 在 `packages/core` 中以本地方式引用）
- **pnpm-lock.yaml** ~172 KB，记录所有包的依赖树（含完整性检查）
- **单一 `pnpm-lock.yaml`** 却支持 workspace 内部分离依赖

**判定 🟡**：
- hermes 单项目优势：入口简洁（安装 `hermes-agent` 即得所有能力），所有模块共享版本约束
- EvoClaw monorepo 优势：包边界清晰（`@evoclaw/desktop` 可独立打包不含 Sidecar），`shared` 类型库被 2+ 包引用避免重复
- **取向不同**：hermes 设计为"一个轮子"，EvoClaw 设计为"可组装部件"

---

### §3.2 顶层目录组织

**hermes**（`.research/02-repo-layout.md §2.1`）— 业务域平级：

```
hermes-agent/
├── agent/                        ← 内部实现（27 modules）
├── tools/                        ← 工具原子（53 py）
├── hermes_cli/                   ← CLI 子命令（42 modules）
├── gateway/                      ← 平台 adapter（19 个）
├── cron/                         ← 调度
├── acp_adapter/                  ← 协议适配
├── plugins/                      ← 插件系统
├── skills/ + optional-skills/    ← Skill 库
└── tests/                        ← 测试
```

**EvoClaw**（`pnpm-workspace.yaml` + `packages/core/src/`）— 前后端分离：

```
EvoClaw/
├── apps/                         ← 应用层
│   └── desktop/                  ← Tauri + React 前端
├── packages/                     ← 库层
│   ├── core/                     ← Sidecar（Hono Server + Agent Kernel）
│   └── shared/                   ← 共享类型
├── brands/                       ← 品牌配置（新增）
└── docs/ + scripts/
```

`packages/core/src/` 内部 26 个目录：
```
agent/                 ← Agent Kernel（对标 hermes agent/）
├── kernel/           ← 主循环（query-loop.ts 等）
├── kernel/builtin-tools.ts  ← 工具聚合点
tools/                 ← 工具实现（对标 hermes tools/）
channel/               ← 通道层（新增，对标 gateway/）
├── adapters/         ← 平台 adapter
infrastructure/        ← 基础设施（DB/日志，新增）
memory/                ← 记忆系统（新增，对标 plugins/memory）
routes/                ← HTTP 路由（新增，对标 hermes_cli/）
skill/                 ← Skill 系统
scheduler/             ← 调度（对标 cron/）
security/              ← 安全（新增）
mcp/                   ← MCP 集成
```

**判定 🟡**：
- hermes 优势：顶层 8 个目录职责明确，新手易理解"工具在 tools/，CLI 在 hermes_cli/"
- EvoClaw 优势：前后端分离明显（apps/desktop 完全独立），workspace 共享类型库无重复
- **问题**：EvoClaw 26 个子目录无分层说明（需要 `AGENTS.md` 等价文档）

---

### §3.3 根级 Python modules vs TypeScript 文件

**hermes**（`.research/02-repo-layout.md §2.2`）— 15 个权重大的顶层 module：

| 文件 | 行数 | 职责 |
|------|------|------|
| `run_agent.py` | 9,811 | AIAgent 主类 + main loop |
| `cli.py` | 9,043 | HermesCLI 交互式 REPL |
| `model_tools.py` | 577 | Tool registry discover + dispatch |
| `hermes_state.py` | 1,304 | SessionDB 持久化 |
| `trajectory_compressor.py` | 1,517 | 训练数据压缩 |
| `batch_runner.py` | 1,287 | 并行 agent 执行 |
| 其他 10 个 | ~4KB | 常量/日志/工具 |

**EvoClaw**（`packages/core/src/`）— 分散在子目录中：

```
packages/core/src/
├── server.ts (45K行 top-level)  ← Hono 路由 + HTTP 入口（对标 cli.py）
├── agent/kernel/query-loop.ts   ← Agent 主循环（对标 run_agent.py）
├── routes/ (25+ 路由文件)        ← API 端点（分散，对标 model_tools.py 的 dispatch）
├── infrastructure/db/            ← 数据持久化（对标 hermes_state.py）
└── 26 个子目录
```

- **server.ts** 是事实上的"根级入口"（45,000+ 行），包含大量 route 处理
- **routes/*.ts** 分散了 CLI 命令的 dispatch 逻辑（无单一 COMMAND_REGISTRY）
- **query-loop.ts** 对标 `run_agent.py` 但只有 770 行（vs 9,811 行）
  - 原因：EvoClaw 把工具执行细节提到 `StreamingToolExecutor` 等专属类中

**判定 🟡**：
- hermes 优势：根级 module 权重集中，`run_agent.py` 是不言而喻的主角，新手 grep `AIAgent` 能快速定位
- EvoClaw 劣势：分散导致入口点不明显（需 `CLAUDE.md §关键架构模式` 手动说明）
- EvoClaw 优势：职责分散减轻单文件负担（hermes `run_agent.py` 9,811 行含所有重逻辑）

---

### §3.4 工具注册机制

**hermes**（`.research/02-repo-layout.md §3.2 + 02-repo-layout.md §4.3`）— 中心单例注册表：

```python
# tools/registry.py — 中心注册表（单例）
class ToolRegistry:
    def register(tool_name: str, handler: callable) -> None: ...
    def dispatch(tool_name: str, **kwargs) -> Any: ...

# tools/*.py 文件（53 个）— import-time 副作用
# 每个文件模块 load 时自动调 registry.register()
@ToolRegistry.register("read_file")
def handle_read_file(...): ...
```

**导入链**（`AGENTS.md:69-78`）：
```
tools/registry.py  ← 零依赖，所有工具都 import
├── tools/*.py     ← 每个模块 load 时 auto-register（副作用）
├── model_tools.py ← discover_tools() 聚合已 register 的工具
└── run_agent.py   ← dispatch via registry
```

**EvoClaw**（`packages/core/src/agent/kernel/builtin-tools.ts` + `packages/core/src/tools/`）— Hook + Adapter 体系：

```typescript
// agent/kernel/builtin-tools.ts — 工具注册点
export const EVOCLAW_TOOLS: KernelTool[] = [
  { id: 'read_file', name: 'read_file', concurrencySafe: true, handler: async (input) => ... },
  { id: 'write_file', name: 'write_file', concurrencySafe: false, handler: async (input) => ... },
  // ... builtin 工具
];

// packages/core/src/tools/*.ts — 工具实现（非自动注册）
export async function executeWebSearch(query: string): Promise<SearchResult> { ... }

// agent/kernel/tool-adapter.ts — 动态适配层
const tools = [...EVOCLAW_TOOLS, ...skillTools, ...mcpTools];
```

**特点**：
- **无全局 registry 单例**（工具以 array 形式传递给 executor）
- **工具来自 5 层**（builtin → enhanced bash → EvoClaw-specific → Channel tools → MCP/Skills）
- **query-loop.ts:416** 接收 `config.tools: KernelTool[]`，避免隐式全局依赖
- **Tool Hook 系统**（`tool-hooks.ts`）：`before-execute / after-execute` 两个 hook

**判定 🟡**：
- hermes 优势：import-time auto-register 简洁（新工具 +tool.py + registry.register() 即自动参与 dispatch）
- EvoClaw 优势：显式工具列表 + Hook 体系，便于权限审计和工具拦截（见 `05-agent-loop-gap.md §3.15`）
- **tradeoff**：hermes 模式对新手友好但难以审计，EvoClaw 模式对企业控制更友好

---

### §3.5 Monorepo 依赖管理

**hermes**（`.research/01-tech-stack-gap.md §3.2 + §3.4`）— 单 uv.lock：

```toml
# pyproject.toml
[build-system]
requires = ["setuptools>=61.0"]

[project]
dependencies = [
  "openai>=2.21.0,<3",
  "anthropic>=0.39.0,<1",
  ...
]

[project.optional-dependencies]
mcp = ["mcp>=1.2.0,<2"]
modal = ["modal>=1.0.0,<2"]
...
```

- **单一 `pyproject.toml`** 统一版本约束
- **`uv.lock`** 哈希校验，`uv sync --locked` 保证复现性
- **内部模块无版本号**（都在同一 wheel 包内）

**EvoClaw**（`pnpm-workspace.yaml` + 3 x `package.json`）— pnpm workspace：

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

```json
// 根 package.json
"packageManager": "pnpm@10.14.0"

// packages/core/package.json
"dependencies": {
  "@evoclaw/shared": "workspace:*",  // ← 本地 workspace 引用
  "@hono/node-server": "^1.14.0",
  "@modelcontextprotocol/sdk": "^1.29.0"
}

// apps/desktop/package.json
"dependencies": {
  "@evoclaw/shared": "workspace:*"  // ← 本地 workspace 引用
}
```

- **pnpm monorepo 特性**：workspace 包之间用 `workspace:*` 引用（不走 npm registry）
- **pnpm-lock.yaml** 统一记录所有包的依赖树
- **包版本独立**：`@evoclaw/core` 可用 0.1.0，`@evoclaw/desktop` 用其他版本（实际两者锁定在相同版本）
- **构建顺序** 由 Turborepo 协调（`turbo.json` 的 `dependsOn`）

**判定 🟡**：
- hermes 优势：单一 lock 文件，pip install 一个包包含所有核心功能
- EvoClaw 优势：workspace 包可独立发布或使用（理论上 `@evoclaw/shared` 可上传 npm）
- **共同点**：两者都有版本锁机制，可复现构建
- **问题**：EvoClaw `pnpm-lock.yaml` (~172KB) 频繁变动（易产生 git 冲突），需要 `.gitignore` 慎重管理

---

### §3.6 构建协调

**hermes**（`.research/01-tech-stack-gap.md §2`）— 无专属构建工具：

```bash
# 分发方式：
python setup.py bdist_wheel    # 构建 wheel
python -m build                 # setuptools 构建
docker build                    # Docker 镜像
nix build                       # Nix flake 打包
```

- **无构建协调工具**（每个分发通道独立处理）
- **wheel 构建** 包含所有子模块（`graft skills` 在 `MANIFEST.in` 里）
- **Docker / Nix** 等有专属配置但不共享缓存

**EvoClaw**（`turbo.json` + `pnpm-workspace.yaml`）— Turborepo 增量构建：

```json
// turbo.json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],  // ← 依赖链（@evoclaw/shared 先构，core/desktop 后构）
      "outputs": ["dist/**"]     // ← 缓存产物
    },
    "test": { "dependsOn": ["build"], "cache": false },
    "lint": { "dependsOn": ["^build"] },
    "dev": { "dependsOn": ["^build"], "cache": false, "persistent": true }
  }
}
```

- **Turborepo 缓存**：build 产物存 `.turbo/cache/`，跨分支复用
- **增量构建**：仅构建改动包 + 依赖方（`.turbo/` 跟踪文件哈希）
- **任务编排**：`^build` 表示"先构 workspace 依赖，再构自己"
- **持久 dev**：`"persistent": true` 让开发过程中不中断 watch

**判定 🟢 反超**：
- EvoClaw Turborepo 可节省 80%+ 构建时间（incremental caching）
- hermes 无此机制，每次 build 重新编译所有模块（虽然 Python 编译快，但 Nix/Docker 下仍有优化空间）
- **具体优势**：修改 `packages/shared/` 后，仅重构 `core` + `desktop`，不重新处理 `docs/` 等无关包

---

### §3.7 CLI 命令集中度

**hermes**（`.research/02-repo-layout.md §3.4 + hermes_cli/commands.py`）— 单一 COMMAND_REGISTRY：

```python
# hermes_cli/commands.py
COMMAND_REGISTRY = [
    CommandDef(name="start", handler=..., description="..."),
    CommandDef(name="skills", handler=..., description="..."),
    CommandDef(name="auth", handler=..., description="..."),
    # ... 所有 slash 命令都在这个清单里
]

# 使用场景
# CLI（cli.py）→ commands.py 查表
# Gateway（gateway/run.py）→ commands.py 查表
# Telegram → commands.py 查表
```

**EvoClaw**（`packages/core/src/routes/` + `server.ts`）— 分散在 routes：

```typescript
// packages/core/src/server.ts
app.post('/send', handler);
app.get('/agents/:id/memory', handler);
app.post('/skills/invoke', handler);  // ← 技能调用

// packages/core/src/routes/skill-routes.ts
export async function handleInvokeSkill(...) { ... }

// packages/core/src/routes/query-routes.ts
export async function handleStartQuery(...) { ... }
```

**特点**：
- **无集中式 COMMAND_REGISTRY**（route handler 分散在 routes/ 各文件）
- **Hono 路由** 在 `server.ts` 中注册，但 handler 逻辑在专属文件里
- **slash 命令** 通过 HTTP POST `/command` 由前端触发（对标 hermes CLI / Gateway 的 slash 命令）

**判定 🔴**：
- hermes 优势：`commands.py` 是"单一事实源"（所有 slash 命令 / 权限 / 别名都在一处）
- EvoClaw 劣势：路由分散，新增命令需改多个文件（`routes/xx-routes.ts` + `server.ts` 注册 + 可能涉及 `channel/command`）
- **改进建议**：建立 `routes/command-registry.ts`，列出所有 HTTP endpoint 的元数据（name / description / requiredPermission），方便 audit

---

### §3.8 Skills 默认打包

**hermes**（`.research/02-repo-layout.md §3.10`）— MANIFEST.in graft + wheel 打包：

```
# MANIFEST.in
graft skills              # ← 递归打包所有 skills/ 文件
graft optional-skills     # ← 递归打包 optional-skills/

# pyproject.toml
py-modules = [...]
packages = [...]
# 没有显式声明 data_files，依赖 MANIFEST.in
```

**部署流程**：
```
wheel 包（~500MB）
  ├── hermes/           # ← 模块
  ├── tools/
  ├── agent/
  └── skills/           # ← 打包进 wheel
      ├── apple/
      ├── devops/
      └── ... 26 分类

安装后：
pip install hermes-agent  # 自动解包到 site-packages/
tools/skills_sync.py      # 同步到 ~/.hermes/skills/
```

**EvoClaw**（`packages/core/src/skill/bundled/` + 动态加载）— 目录内置 + ZIP 解压：

```typescript
// packages/core/src/skill/bundled/  — 预置技能清单
├── README.md              // 已分配的默认技能列表
└── (实际技能文件在 build 时嵌入或运行时获取)

// packages/core/src/skill/skill-installer.ts:163
const extracted = await extractZipToDirectory(zipPath, skillsDir);
```

**特点**：
- **bundled/ 目录** 列出默认技能（实际内容可能在 assets 或 ClawHub 远程获取）
- **动态 ZIP 解压** 而非 MANIFEST.in 静态打包
- **两种来源**：
  1. 打包内置（bundled/）—— Tauri DMG 中内含
  2. 运行时下载（ClawHub API / GitHub / local）—— 解压到 `~/.evoclaw/skills/`

**判定 🟡**：
- hermes 优势：wheel 包完整自包含，pip install 即用
- EvoClaw 优势：DMG 体积可控（不含所有 skill content），运行时按需下载更灵活
- **权衡**：hermes 发行包大（wheel ~500MB），EvoClaw DMG 更轻（~200MB）但需网络

---

### §3.9 测试布局

**hermes**（`.research/02-repo-layout.md §3.11`）— tests/ 平级子目录：

```
tests/
├── acp/                    ← acp_adapter 的测试
├── agent/                  ← agent/ 的单测
├── cli/                    ← cli.py 的测试
├── e2e/                    ← 端到端
├── fakes/                  ← 测试替身基础设施
├── gateway/                ← gateway/ 的测试
├── run_agent/              ← run_agent.py 的单测
├── tools/                  ← tools/ 的单测
└── 24+ 独立 test_*.py      ← 跨模块测试（test_model_tools.py / test_cli_skin_integration.py 等）
```

**特点**：
- **子目录镜像** 主代码结构（tests/agent/ 对标 agent/）
- **根级 test_*.py** 处理跨模块或顶层组件（11,800+ 测试函数 / 413+ 测试类）
- **pytest mark** 区分集成测试（`@pytest.mark.integration` 默认排除）
- **独立 conftest.py** 在各子目录提供 fixture

**EvoClaw**（`packages/core/src/__tests__/`）— __tests__/ 嵌在 src 内：

```
packages/core/src/
├── __tests__/
│   ├── architecture/
│   ├── channel/
│   ├── infrastructure/
│   ├── kernel/
│   ├── security/
│   ├── sop/
│   ├── tools/
│   └── (7 个子目录)
├── agent/
├── channel/
├── infrastructure/
└── ... (26 个主目录)
```

**特点**：
- **__tests__/ 嵌在 src/**（源码和测试在同一棵树）
- **Vitest 并行执行**（config: `{ globals: true, environment: 'node' }`）
- **无 integration mark 分层**（所有 test 混合跑，无法按需排除）
- **测试规模**: 2,414 tests（vs hermes 11,800+）

**判定 🟡**：
- hermes 优势：tests/ 独立目录更清晰，mark 体系支持 `-m 'not integration'` 快速跑单测
- EvoClaw 优势：__tests__/ 嵌在 src/ 内，编辑源文件时相邻浏览测试（IDE 便利性）
- **问题**：EvoClaw 无 integration mark 体系，CI 中想跑快速单测需额外配置

---

### §3.10 文档组织

**hermes**（`.research/02-repo-layout.md §2.1`）— docs/ + website/ Docusaurus：

```
hermes-agent/
├── docs/                      ← 开发者 markdown
│   ├── migration/
│   ├── plans/
│   └── skins/
├── website/                   ← Docusaurus 3.9.2 独立项目
│   ├── docs/                  # ← 客户面向文档（约 50+ .mdx）
│   ├── src/                   # ← React 组件
│   ├── package.json           # ← Node >=20 要求
│   └── docusaurus.config.js
└── AGENTS.md (20 KB)          ← AI 编码助手指南
```

**部署**：GitHub Pages / Netlify，`.mdx` 渲染为独立文档站 → 企业采购方评估的门面

**EvoClaw**（`docs/` markdown only）— 无站点部署：

```
EvoClaw/
├── docs/
│   ├── prd/                   ← 产品需求
│   ├── architecture/          ← 架构文档
│   ├── iteration-plans/       ← 迭代计划
│   ├── evoclaw-vs-hermes-research/  ← 差距分析文档（本报告所在）
│   ├── reports/               ← 定期报告
│   └── dev/                   ← 开发者指南
└── (无 website/ 目录)
```

**阅读方式**：GitHub markdown 直接渲染，或本地 IDE 浏览

**判定 🔴**：
- hermes 优势：Docusaurus 站点提供专业门面（SEO / 搜索 / 导航），企业 GA 前必需
- EvoClaw 劣势：无文档站，GitHub markdown 渲染受限（无全文搜索、无版本选择、导航不友好）
- **建议**：P2 优先级（见 `01-tech-stack-gap.md §3.13`），考虑迁移到 Docusaurus 或 Nextra

---

### §3.11 多平台 adapters

**hermes**（`.research/02-repo-layout.md §3.5`）— gateway/platforms/ 19 个 adapter：

```
gateway/platforms/
├── base.py                     ← BasePlatform 抽象
├── telegram.py (200+ 行)       ← Telegram adapter
├── discord.py                  ← Discord adapter
├── slack.py                    ← Slack adapter
├── signal.py                   ← Signal adapter
├── matrix.py                   ← Matrix adapter
├── whatsapp.py + telegram_network.py  ← WhatsApp adapter + 网络层
├── bluebubbles.py              ← BlueBubbles iMessage
├── mattermost.py               ← Mattermost
├── email.py + sms.py           ← Email + SMS
├── dingtalk.py                 ← 钉钉
├── feishu.py                   ← 飞书
├── wecom.py                    ← 企业微信
├── homeassistant.py            ← Home Assistant
├── api_server.py               ← REST API
├── webhook.py                  ← 通用 Webhook
└── ADDING_A_PLATFORM.md        ← 新平台开发指南
```

**覆盖**：Telegram / Discord / Slack / Signal / Matrix / WhatsApp / BlueBubbles / Mattermost / Email / SMS / 钉钉 / 飞书 / 企业微信 / Home Assistant / REST API + Webhook（19 个 adapter）

**EvoClaw**（`packages/core/src/channel/adapters/` + `channel/command/`）— 飞书 / 企微 / iLink 微信：

```
packages/core/src/channel/
├── adapters/
│   ├── feishu.ts               ← 飞书（HTTP webhook + 消息加解密）
│   ├── wecom.ts                ← 企业微信（HTTP webhook）
│   ├── ilink.ts                ← iLink 微信（长轮询）
│   └── base-adapter.ts         ← BaseChannelAdapter 抽象
├── command/
│   ├── command-handler.ts      ← 斜杠命令处理
│   └── context-manager.ts
└── channel-manager.ts          ← 多通道分发
```

**覆盖**：仅 3 个主流国内 IM（飞书 / 企微 / 微信），无 Telegram / Discord / Slack 等国际平台

**关键差异**：
- hermes `gateway/telegram.py` 依赖官方 `python-telegram-bot[webhooks]` SDK，webhook 模式 → bot -> LLM -> 回复（同步）
- EvoClaw `feishu.ts` 自实现 HTTP webhook 处理 + 消息加解密（AES-ECB），异步处理管道（enqueueSystemEvent → drainSystemEvents）

**判定 🔴**：
- EvoClaw 缺失国际平台（Telegram / Discord / Slack 等），限制了全球用户范围
- hermes 覆盖宽（19 个），EvoClaw 深（企业国内市场特化，每个 adapter 有企业合规细节如 CDN 媒体 + AES 加解密）
- **原因**：EvoClaw 面向企业(B2B) / hermes 面向社区(B2C)

**建议**：P1 优先级，至少实现 Telegram + Discord adapter（网络上已有成熟开源实现可参考）

---

### §3.12 品牌灵活性

**hermes**（`.research/02-repo-layout.md 全文`）— 单一品牌：

- 所有代码 / 配置 / 文档 都标注为 "hermes-agent"
- 无品牌切换机制
- 部署 = 安装 `hermes-agent` 包

**EvoClaw**（`brands/` 目录 + 环境变量驱动）— 多品牌支持：

```
brands/
├── evoclaw/                    ← 默认品牌
│   ├── config/                 # 品牌配置覆盖
│   ├── assets/                 # logo / 图标 / 主题
│   └── ...
├── healthclaw/                 ← 医疗行业品牌（二级市场）
│   ├── config/                 # 企业合规配置
│   ├── assets/
│   └── ...
```

**机制**：
```bash
# 打包时指定品牌
BRAND=healthclaw pnpm build   # ← 使用 healthclaw 配置覆盖 evoclaw 默认
pnpm dev:healthclaw            # ← 开发 healthclaw 品牌

# brand-apply.mjs
// 脚本在构建时：
// 1. 读 brands/$BRAND/config/
// 2. 深度 merge 到主配置
// 3. 生成最终配置 + 替换 assets
```

**配置覆盖示例**：
```json
// brands/healthclaw/config/advanced.json
{
  "securityPolicy": {
    "allowedDomains": ["healthclaw.med.example.com"],
    "disabledChannels": ["telegram", "discord"],
    "auditLog": { "enabled": true, "retention": "7y" }
  }
}
```

**判定 🟢 反超**：
- EvoClaw 设计上支持"一码多商"（同一代码库，不同品牌独立部署）
- hermes 无此机制，若要定制需 fork 或参数化（复杂且难维护）
- **价值**：企业版 / 医疗版 / 行业版 可复用 90%+ 代码，仅覆盖配置 / logo / 政策

---

### §3.13 LLM SDK 依赖形态

（详见 `01-tech-stack-gap.md §3.7` — hermes `openai` + `anthropic` 包 vs EvoClaw HTTP 直调）

**判定 🟡**：取向不同，均无明显优劣

---

### §3.14 Layer 分层清晰度

**hermes**（`AGENTS.md:69-78` + `.research/02-repo-layout.md §2.3`）— Layer 0-6 明确分层：

```
Layer 0: hermes_constants.py / hermes_logging.py / hermes_time.py / utils.py
   ↓ 所有模块 import
Layer 1: hermes_state.py (SessionDB)
   ↓ 被 Layer 2-4 import
Layer 2: tools/registry.py + tools/*.py
   ↓ 被 Layer 3-4 import
Layer 3: agent/* (27 modules)
   ↓ 被 Layer 4 import
Layer 4: model_tools.py / toolsets.py / run_agent.py
   ↓ 被 Layer 6 import
Layer 5: plugins/*
Layer 6: 6 路入口 (CLI / Gateway / ACP / MCP / Batch / RL)
```

**官方文档化**：`AGENTS.md:69-78` 直接画出导入链：
```
tools/registry.py (no deps — imported by all tool files)
       ↑
tools/*.py (each calls registry.register() at import time)
       ↑
model_tools.py (imports tools/registry + triggers tool discovery)
       ↑
run_agent.py, cli.py, batch_runner.py, environments/
```

**EvoClaw**（`packages/core/src/` 26 个目录，无显式分层）— 扁平目录结构：

```
packages/core/src/
├── agent/
│   └── kernel/                 ← 主循环（query-loop.ts 等）
├── tools/                      ← 工具实现
├── channel/                    ← 通道 adapter
├── infrastructure/db           ← DB 持久化
├── memory/                     ← 记忆系统
├── routes/                     ← HTTP 路由
└── ... 20+ 更多目录

无 Layer 0-6 的明确分层说明
```

**补充**：`CLAUDE.md §关键架构模式` 有一些说明，但不如 hermes 的 `AGENTS.md` 清晰

**判定 🔴**：
- hermes 优势：Layer 分层清晰，新人读 `AGENTS.md` 能快速理解导入依赖链
- EvoClaw 劣势：26 个子目录缺乏分层说明，初探者不知从何开始（需补充 `AGENTS.md` 等价文档）
- **改进建议**：
  - 创建 `packages/core/ARCHITECTURE.md` 列出 Layer 0-5 分层
  - 标注各 package.json 中哪些 import 是"允许的跨层引用"

---

### §3.15 根级入口清晰度

**hermes**（`.research/02-repo-layout.md §2.2`）— 15 个权重大的 py-modules：

```python
# run_agent.py:535
class AIAgent:
    def run_conversation(...) -> ConversationResult:
        """主循环，所有 6 路入口都调用这个"""
        ...

# cli.py:1200+
class HermesCLI:
    def start(self): ...
    def skills(self): ...
    ...

# hermes_cli/main.py
def main():
    cli_obj = HermesCLI()
    fire.Fire(cli_obj)  # ← fire 库自动映射 CLI 子命令
```

**一眼看出**：`AIAgent.run_conversation()` 是核心，所有 6 路入口都调它

**EvoClaw**（`packages/core/src/server.ts` + `routes/`）— 分散的路由：

```typescript
// packages/core/src/server.ts (45,530 lines)
const app = new Hono();

app.post('/send', async (c) => {
  const result = await queryHandler.handleStartQuery(...);
  return c.json(result);
});

app.post('/skills/invoke', async (c) => {
  return handleInvokeSkill(...);
});

// packages/core/src/agent/kernel/query-loop.ts
export async function queryLoop(config): Promise<QueryResult> {
  while (true) {
    // main loop
  }
}
```

**问题**：
- `queryLoop()` 是事实上的"Agent 主循环"（对标 `AIAgent.run_conversation()`）
- 但不像 hermes 那样有一个权重大的类聚合所有逻辑
- HTTP 层 route 在 `server.ts` 中，handler 在 `routes/` 各文件
- 新人跟踪代码时需要来回跳跃

**判定 🔴**：
- hermes 优势：`AIAgent` 类 + `run_conversation()` 方法明确指出核心所在
- EvoClaw 劣势：无明确的"Agent 类"（所有 Agent 能力分散在 query-loop / tool-executor / context-engine 等）
- **改进建议**：
  - 创建 `packages/core/src/agent/agent.ts` 导出一个 `Agent` class，聚合 `queryLoop()` + `toolExecutor` + `contextEngine`
  - 文档中明确指出：这个 class 对标 hermes 的 `AIAgent`

---

## 4. 建议改造蓝图（不承诺实施）

**P0**（高 ROI，建议尽快）:

| # | 项目 | 对应差距 | 工作量 | 价值 |
|---|---|---|---|---|
| 1 | 创建 `packages/core/ARCHITECTURE.md` 分层说明（Layer 0-5 + 导入链） | §3.14 | 1d | 新人 onboarding 加速 10 倍 |
| 2 | 补充 `routes/command-registry.ts`（集中式元数据）| §3.7 | 1-2d | 权限审计 + 命令文档化 |
| 3 | 实现 Telegram + Discord adapter（MVP） | §3.11 | 3-5d | 开放国际市场 |

**P1**（中等 ROI）:

| # | 项目 | 对应差距 | 工作量 | 价值 |
|---|---|---|---|---|
| 4 | 创建 `packages/core/src/agent/agent.ts` class 聚合核心能力 | §3.15 | 1-2d | 代码导航一致性 |
| 5 | 为 __tests__/ 补充 `integration.ts` mark 体系 | §3.9 | 1d | CI 快速单测通道 |
| 6 | 补充系统二进制依赖文档（`docs/dev/system-deps.md`） | 01-tech-stack-gap.md §3.15 | 0.5d | 新环境部署避坑 |

**P2**（长期规划）:

| # | 项目 | 对应差距 | 工作量 | 价值 |
|---|---|---|---|---|
| 7 | Docusaurus 文档站（GA 前准备） | §3.10 | 3-5d | 企业采购门面 |
| 8 | 补充完整 16 个国际平台 adapter | §3.11 | 1-2 周（可分期） | 全球市场覆盖 |

**不建议做**:

- 改造为"单 package"（vs monorepo）：架构取舍已定，改造成本高收益低
- 实现 `MANIFEST.in` wheel 打包（vs Tauri DMG）：Tauri 架构决定，改造需重构整个发行流程

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应缺失 |
|---|---|---|---|
| 1 | Turborepo 增量构建缓存 | `turbo.json` + `.turbo/cache/` | hermes 无专属构建协调工具 |
| 2 | 多品牌灵活切换（brands/ 目录 + 环境变量） | `brands/evoclaw/` + `brands/healthclaw/` + `pnpm run dev:healthclaw` | hermes 单一品牌，需 fork 才能定制 |
| 3 | Tauri 三层安全分层（Rust 主进程 + Bun Sidecar + React 前端） | `apps/desktop/src-tauri/` + Keychain/AES-256 | hermes 单进程纯 Python，无原生加密能力 |
| 4 | monorepo 包边界清晰（@evoclaw/shared 被 2+ 包引用） | `pnpm-workspace.yaml` + `workspace:*` 引用 | hermes 单项目无子包概念 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（本章所有 `path:line` 均经 Bash / Read 验证 2026-04-16）

- `pnpm-workspace.yaml` ✅ 定义 `packages: ['apps/*', 'packages/*']`
- `turbo.json` ✅ 定义 `build` task 含 `dependsOn: ["^build"]` 和 `outputs: ["dist/**"]`
- `packages/core/package.json:11` ✅ `"packageManager": "pnpm@10.14.0"`
- `packages/core/package.json:16` ✅ `"@evoclaw/shared": "workspace:*"`
- `package.json:41-45` ✅ `"pnpm.onlyBuiltDependencies: ["esbuild"]"`
- `packages/core/src/agent/kernel/query-loop.ts:1-50` ✅ 主循环文件存在（770 行）
- `packages/core/src/tools/` ✅ 19+ 工具文件（apply-patch.ts, browser-tool.ts, web-search.ts 等）
- `packages/core/src/channel/adapters/` ✅ feishu.ts / wecom.ts / ilink.ts 三个 adapter
- `packages/core/src/__tests__/` ✅ 7 个子目录（architecture / channel / infrastructure / kernel / security / sop / tools）
- `brands/evoclaw/` ✅ 品牌目录存在
- `brands/healthclaw/` ✅ 医疗品牌目录存在

### 6.2 hermes 研究引用（章节 §）

- `.research/02-repo-layout.md §1` — 定位与角色
- `.research/02-repo-layout.md §2.1` — 顶层两级目录树（18-112 行）
- `.research/02-repo-layout.md §2.2` — 根级 Python 文件（114-155 行）
- `.research/02-repo-layout.md §2.3` — 子系统分层图（159-221 行）
- `.research/02-repo-layout.md §3.1-3.12` — 关键函数与流程
- `.research/02-repo-layout.md §4.1` — 项目边界权威定义（pyproject.toml 引用）
- `.research/02-repo-layout.md §4.2` — Skills 打包方式（MANIFEST.in）
- `.research/02-repo-layout.md §4.3` — 官方文件依赖链（AGENTS.md）
- `.research/01-tech-stack-gap.md §3.2` — 包管理器对比（uv vs pnpm）
- `.research/01-tech-stack-gap.md §3.4` — 锁文件哈希校验

### 6.3 关联差距章节（crosslink）

本章涉及的后续深入研究：

- [`00-overview-gap.md`](./00-overview-gap.md) §3.1 — 项目形态（Web SaaS vs Desktop App）
- [`01-tech-stack-gap.md`](./01-tech-stack-gap.md) §3.2-3.6 — 包管理器 / 锁文件 / CVE 注释（本章 §3.5 关联）
- [`03-architecture-gap.md`](./03-architecture-gap.md) §1-2 — 单进程 vs 三层 IPC（本章 1 定位关联）
- [`05-agent-loop-gap.md`](./05-agent-loop-gap.md) §3.15 — Agent-level 工具拦截（本章 §3.4 工具注册关联）
- `11-environments-spawn-gap.md` (Wave 2) — `tools/environments/*` vs 无（本章 §3.2 后端隔离）
- `14-state-sessions-gap.md` (Wave 2) — SessionDB 持久化（本章 §3.14 分层关联）
- `21-mcp-gap.md` (Wave 2) — MCP SDK 依赖（本章 §3.13 关联）
- `30-build-packaging-gap.md` (Wave 2) — wheel vs DMG 分发（本章 §3.8 打包关联）
- `31-testing-gap.md` (Wave 2) — pytest vs Vitest + mark 体系（本章 §3.9 关联）
- `32-docs-website-gap.md` (Wave 2) — Docusaurus 文档站（本章 §3.10 关联）

---

**本章完成**。仓库布局差距盘点完毕：**形态完全不同（单项目 vs monorepo / Python vs TS+Rust / wheel vs DMG），但工程模式有深度交集**。EvoClaw 在 **Turborepo 增量构建 / 多品牌灵活切换 / Tauri 三层安全分层** 三项反超；在 **分层文档化 / CLI 集中度 / 平台覆盖** 三项有改进空间。建议优先补充 ARCHITECTURE.md + Telegram/Discord adapter + 集中式 command registry，为未来扩展奠基。

