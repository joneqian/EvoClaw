# 01 — 技术栈 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/01-tech-stack.md`（358 行）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），Python 3.11+ / uv 锁文件 / ~13 py-modules + 9 子包
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），TypeScript 5.8 + Rust（Tauri 2）+ React 19，Bun 1.3+ / pnpm 10.14 / 3 packages
> **综合判定**: 🟡 **两套栈各自成熟、无可比性**（TS/Bun/Tauri 生态 vs Python/uv/Nix 生态），但**依赖策略、锁文件校验、系统二进制管理**三项 EvoClaw 有明显可借鉴点

**档位图例**:
- 🔴 EvoClaw 明显落后
- 🟡 部分覆盖 / 形态差异
- 🟢 EvoClaw 对齐或反超

---

## 1. 定位

**hermes 技术栈**（`.research/01-tech-stack.md §1`）:

- 主语言：**Python ≥ 3.11**（`pyproject.toml:10` `requires-python = ">=3.11"`）
- 构建：**setuptools**（`[build-system] requires = ["setuptools>=61.0"]`, `pyproject.toml:1-3`）
- 包管理：**`uv`**（`uv.lock` 哈希校验）
- 次语言：**Node.js ≥ 18**（仅用于浏览器自动化 + WhatsApp bridge + Docusaurus 文档站，`package.json:20-24`）
- 系统依赖：`ripgrep` / `ffmpeg` / `git` / `openssh` / `chromium`（via Playwright）
- 发行通道：**PyPI wheel** + **Docker** + **Nix flake**（`Dockerfile` + `flake.nix`）
- 依赖策略：**所有依赖固定 `>=X.Y.Z,<X+1`**（防 major 破坏性变更 + 供应链攻击，`pyproject.toml:14` 直接注释说明）
- 安装策略：**uv sync --locked**（严格锁 + 哈希）+ 两段降级兜底

**EvoClaw 技术栈**（`package.json` + `packages/*/package.json` + `apps/desktop/src-tauri/Cargo.toml`）:

- 主语言：**TypeScript 5.8**（`packages/core/package.json:31`, `packages/shared/package.json:12`）+ **Rust**（Tauri 2，`Cargo.toml:2`）+ **React 19.1**（`apps/desktop/package.json:17`）
- 构建：**Turborepo 2.5**（`turbo.json`） + **tsx + esbuild 0.27**（core） + **Vite 6.3 + tsc**（desktop） + **Tauri build**（DMG 打包）
- 包管理：**pnpm 10.14**（`package.json:11` `packageManager`）
- 运行时：**Bun ≥ 1.3 主选 + Node ≥ 22 回退**（`package.json:7-10` engines）
- 次语言：—（无独立 Node bridge 进程；Rust 在 Tauri 侧作主机层）
- 系统依赖（实测）：`ripgrep`（`builtin-tools.ts:622`）/ `sips`（macOS 图片压缩，`builtin-tools.ts:172`）/ `pdftoppm`（PDF→JPEG，`builtin-tools.ts:203`）/ `unzip`（`skill-installer.ts:163`）/ `git`（Skill 克隆，`skill-installer.ts:178`）/ `chromium`（可选，通过 `playwright` 包）
- 发行通道：**Tauri DMG 单通道**（`scripts/build-dmg.sh`，`package.json:21`）
- 依赖策略：大多数 `^X.Y.Z`（SemVer 兼容自动升级），核心 pin：`pnpm.onlyBuiltDependencies: ["esbuild"]`（`package.json:41-45`）
- 安装策略：`pnpm-lock.yaml` SHA512 哈希校验（pnpm 默认行为）

**范式对比**:

| 维度 | hermes | EvoClaw |
|---|---|---|
| 项目组织 | 单 Python 项目（setuptools py-modules + find packages） | pnpm monorepo（`pnpm-workspace.yaml` 定义 `apps/*` + `packages/*`） |
| 编译产物 | `.whl`（Python wheel） | `dist/` 目录（esbuild 产 JS）+ Rust 二进制（Tauri App） |
| 运行时分发 | 解释型（Python interp + deps） | 混合（TS/JS + Rust Native App + Bun runtime bundled 或 系统 Node） |
| Rust 参与 | 无 | `apps/desktop/src-tauri/` Rust 核心（Keychain + crypto + HTTP Tauri 命令） |

**根本差异**: hermes 是"Python 脚本 + 多 entrypoint 发行"，EvoClaw 是"Tauri 桌面 App + 多语言 monorepo"，两者**生态不可互换**。以下对比聚焦**依赖治理策略、锁文件、CVE 管理、系统二进制管理**等**可跨语言借鉴**的工程实践。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 主语言 + 运行时选择 | 🟡 | Python vs TS+Rust+React，生态不可互换 |
| §3.2 | 包管理器 + monorepo 组织 | 🟡 | `uv`（单项目）vs `pnpm`（monorepo 3 包 + Turbo），各自生态 |
| §3.3 | 依赖版本约束策略 | 🔴 | hermes 全量 `>=X.Y.Z,<X+1` 防破坏性升级，EvoClaw 多数 `^X.Y.Z` 依赖 SemVer 兼容约定 |
| §3.4 | 锁文件哈希校验 | 🟡 | uv.lock + `uv sync --locked` 显式哈希校验 vs pnpm-lock.yaml SHA512（默认行为） |
| §3.5 | CVE 标注策略 | 🔴 | hermes 依赖行尾直接写 `# CVE-2026-25645`，EvoClaw 零 CVE 注释 |
| §3.6 | 可选 extras 机制 | 🔴 | hermes `[project.optional-dependencies]` 18+ extras，EvoClaw 无对应（monorepo 子 package 部分覆盖） |
| §3.7 | 核心 LLM SDK | 🟡 | hermes openai + anthropic 双 SDK，EvoClaw HTTP 直调（无 SDK） |
| §3.8 | CLI 框架 | 🟡 | fire + prompt_toolkit + rich vs 无（桌面应用无 CLI） |
| §3.9 | 数据库 | 🟡 | SQLite + sqlite3 内置 vs better-sqlite3 + sqlite-vec + FTS5 |
| §3.10 | MCP 依赖形态 | 🟢 | **反超**: hermes `mcp` 是 optional extras，EvoClaw `@modelcontextprotocol/sdk` 是 core 依赖 |
| §3.11 | 浏览器自动化 | 🟡 | agent-browser + Camofox（Nous 专属 npm 包）vs playwright 可选依赖 |
| §3.12 | 国产 IM 依赖 | 🟡 | `lark-oapi` + `dingtalk-stream` extras 可选 vs HTTP 直调（无特定包） |
| §3.13 | 文档站 | 🔴 | Docusaurus 3.9.2 单独项目 vs 仅 `docs/*.md` 无站点 |
| §3.14 | 测试框架 | 🟡 | pytest + asyncio + xdist + mark 体系 vs Vitest（默认并行，配置简单） |
| §3.15 | 系统二进制依赖 | 🟡 | hermes Dockerfile 预装 ripgrep/ffmpeg/chromium，EvoClaw 运行时按需检测（无统一文档） |
| §3.16 | Linter / 格式化 | 🟡 | black / ruff / isort（hermes 未在 pyproject 硬声明但社区惯例）vs oxlint 0.17 |
| §3.17 | 安全敏感本地能力 | 🟢 | **反超**: EvoClaw Rust 侧 `security-framework` + `ring`，macOS Keychain 本地加密，hermes 无对应 |
| §3.18 | `[all]` 聚合装哲学 | 🟡 | hermes `[all]` 刻意排除 `matrix`（说明"宁可失去一个平台也不让全家桶炸"），EvoClaw monorepo 无类似选择 |

**统计**: 🔴 4 / 🟡 12 / 🟢 2。

---

## 3. 机制逐条深度对比

### §3.1 主语言 + 运行时选择

**hermes** （`.research/01-tech-stack.md §1` + `pyproject.toml:10`）:

```toml
# pyproject.toml
requires-python = ">=3.11"
```

- **Python 3.11+ 是最低要求**（3.12 可用，但 3.11 是底线）
- 次语言 Node.js ≥ 18（`package.json:20-24`），仅用于：
  - `agent-browser` + `@askjo/camoufox-browser`（浏览器自动化）
  - `scripts/whatsapp-bridge/`（WhatsApp Web 桥）
  - `website/`（Docusaurus 文档站，独立 Node ≥ 20）
- 无 Rust / Go / C++ 参与

**EvoClaw** （`package.json:7-10` + 3 个 `package.json` + `apps/desktop/src-tauri/Cargo.toml`）:

```json
// package.json:7-11
"engines": {
  "bun": ">=1.3",
  "node": ">=22",
  "pnpm": ">=10"
}
```

- **TypeScript 5.8**（`packages/core/package.json:31`）—— 主力
- **Bun ≥ 1.3**（主运行时，`CLAUDE.md:52` "Bun >= 1.3（主运行时），Node.js >= 22（回退兼容）"）
- **Node.js ≥ 22**（回退兼容，支持无 Bun 环境）
- **Rust**（Tauri 2.x，`apps/desktop/src-tauri/Cargo.toml:6` `edition = "2021"`）——桌面 App 核心
- **React 19.1 + React Router 7.6 + Zustand 5.0**（`apps/desktop/package.json:17-20`）——前端
- Cargo 依赖（`Cargo.toml:13-19`）：`tauri 2 + tauri-plugin-shell 2 + serde 1 + security-framework 3.2 + ring 0.17 + base64 0.22`

**判定 🟡**：两套语言栈**各自成熟**，对齐不可能也不应该。值得关注：
- hermes 是**纯 Python + 少量 Node**，部署只要 Python interp
- EvoClaw 是**TS + Rust + React 三语言混合**，部署是打包后的 Tauri App（含 Bun 或 Node runtime）
- Rust 参与让 EvoClaw 获得**原生系统能力**（macOS Keychain / 加密）但增加**跨平台编译复杂度**（参考 §3.17）

---

### §3.2 包管理器 + monorepo 组织

**hermes** （`.research/01-tech-stack.md §1` + `pyproject.toml:117-121`）:

```toml
[tool.setuptools]
py-modules = [
  "run_agent", "model_tools", "toolsets", "batch_runner",
  "trajectory_compressor", "toolset_distributions", "cli",
  "hermes_constants", "hermes_state", "hermes_time", "hermes_logging",
  "rl_cli", "utils"
]

[tool.setuptools.packages.find]
include = ["agent", "tools", "tools.*", "hermes_cli", "gateway", "gateway.*", "cron", "acp_adapter", "plugins", "plugins.*"]
```

- **单项目**（root `pyproject.toml`），setuptools py-modules + find packages
- **uv** 作为依赖解析 + 安装器（`uv.lock` 5,467 行说明传递依赖 500+，`.research/01-tech-stack.md §7`）

**EvoClaw** （`pnpm-workspace.yaml` + `turbo.json` + 3 `package.json`）:

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

```json
// turbo.json
{
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test":  { "dependsOn": ["build"], "cache": false },
    "lint":  { "dependsOn": ["^build"] },
    "dev":   { "dependsOn": ["^build"], "cache": false, "persistent": true }
  }
}
```

- **pnpm monorepo**，3 个 workspace package：
  - `@evoclaw/core`（`packages/core/package.json`）—— Bun Sidecar
  - `@evoclaw/desktop`（`apps/desktop/package.json`）—— Tauri 桌面应用 + React 前端
  - `@evoclaw/shared`（`packages/shared/package.json`）—— 共享类型
- **Turborepo 2.5** 做任务协调 + 增量缓存（`turbo.json`）
- Workspace 依赖用 `workspace:*`（如 `"@evoclaw/shared": "workspace:*"`）

**判定 🟡**：两者都有清晰的项目组织约定，但**粒度不同**：
- hermes 单项目内部分模块，全部共享 `pyproject.toml` 依赖声明
- EvoClaw monorepo 每个 package 独立 `package.json` 声明依赖，子 package 通过 `workspace:*` 互引

EvoClaw 的 monorepo 架构对**前后端分离 + 多品牌共享类型库**场景有天然优势（`shared` 包同时被 `core` 和 `desktop` 引用）。

---

### §3.3 依赖版本约束策略

**hermes** （`.research/01-tech-stack.md §4.1` + `pyproject.toml:13-37`）:

```toml
# pyproject.toml:13-37
dependencies = [
  # Core — pinned to known-good ranges to limit supply chain attack surface
  "openai>=2.21.0,<3",
  "anthropic>=0.39.0,<1",
  "python-dotenv>=1.2.1,<2",
  "fire>=0.7.1,<1",
  "httpx>=0.28.1,<1",
  "rich>=14.3.3,<15",
  "tenacity>=9.1.4,<10",
  "pyyaml>=6.0.2,<7",
  "requests>=2.33.0,<3",  # CVE-2026-25645
  "jinja2>=3.1.5,<4",
  "pydantic>=2.12.5,<3",
  "prompt_toolkit>=3.0.52,<4",
  "exa-py>=2.9.0,<3",
  "firecrawl-py>=4.16.0,<5",
  ...
  "PyJWT[crypto]>=2.12.0,<3",  # CVE-2026-32597
]
```

**每一行依赖都固定到 `>=X.Y.Z,<X+1`**——防 major 升级破坏性变更 + 限制供应链攻击面（详见 `.research/01-tech-stack.md §3.1` 注释"Core — pinned to known-good ranges to limit supply chain attack surface"）。

**EvoClaw** （`packages/core/package.json:13-33` + `apps/desktop/package.json:13-37`）:

```json
// packages/core/package.json
"dependencies": {
  "@hono/node-server": "^1.14.0",
  "@modelcontextprotocol/sdk": "^1.29.0",
  "better-sqlite3": "^11.9.0",
  "hono": "^4.7.0",
  "mammoth": "^1.8.0",
  "xlsx": "^0.18.5",
  "zod": "^4.3.6"
}
```

- 大多数依赖用 **`^X.Y.Z`** （caret range，SemVer 兼容升级，允许 Y 和 Z 任意升，Y=0 时退化为锁 patch）
- 唯一的 pin 表达式：`package.json:41-45` `pnpm.onlyBuiltDependencies: ["esbuild"]`（只允许 esbuild 执行 install 脚本 — 安全防护）
- 无对 `@evoclaw/...` 以外依赖的 CVE 注释
- 无 `<X+1` 上限（允许 caret range 自动升到 `2.0.0`、`5.0.0` 等）

**判定 🔴**：EvoClaw 的依赖约束策略**比 hermes 弱**：
- `^1.29.0` 允许自动升级到 `1.999.999`（若发布），**但不会跨越到 `2.x`**，所以 caret range 实际上已经限制了 major 升级（与 hermes `<2` 等价）——在这一点上 EvoClaw 并不比 hermes 差
- 但 EvoClaw **没有 CVE 内联注释**的工程实践，追踪已知漏洞需要额外工具（`npm audit` / `pnpm audit`），不在 `package.json` 中留存"为什么要 pin 这个版本"的文档
- hermes 的 `pyproject.toml:14` 直接注释"pinned to known-good ranges to limit supply chain attack surface"值得借鉴

**建议**：在 EvoClaw 关键依赖（`@hono/node-server` / `better-sqlite3` / `@modelcontextprotocol/sdk`）后加 `// security: <理由>` 注释，增加供应链透明度。

---

### §3.4 锁文件哈希校验

**hermes** （`.research/01-tech-stack.md §3.2` + `setup-hermes.sh:182-194`）:

```bash
if [ -f "uv.lock" ]; then
    echo "→ Using uv.lock for hash-verified installation..."
    UV_PROJECT_ENVIRONMENT="$SCRIPT_DIR/venv" $UV_CMD sync --all-extras --locked 2>/dev/null && \
        echo "✓ Dependencies installed (lockfile verified)" || {
        echo "⚠ Lockfile install failed (may be outdated), falling back to pip install..."
        $UV_CMD pip install -e ".[all]" || $UV_CMD pip install -e "."
        echo "✓ Dependencies installed"
    }
else
    $UV_CMD pip install -e ".[all]" || $UV_CMD pip install -e "."
fi
```

**三段降级安装**:
1. `uv sync --all-extras --locked`（严格锁 + 哈希校验）
2. `uv pip install -e ".[all]"`（未锁，装所有 extras）
3. `uv pip install -e "."`（未锁，只装核心）

**EvoClaw** （`pnpm-lock.yaml` + `package.json:11`）:

- `pnpm-lock.yaml` 由 pnpm 自动维护，含每个 package 的 SHA512 integrity（SHA512 哈希校验是 pnpm 的默认行为）
- 安装命令：`pnpm install`（默认严格模式 `--frozen-lockfile` 在 CI 环境启用）
- 无显式降级兜底脚本
- **EvoClaw 未声明 `engines-strict`**（无法阻止不匹配版本 Bun/Node 的用户安装）

**判定 🟡**：**实际效果接近**，两者都有 SHA 哈希校验，但：
- hermes 的 `setup-hermes.sh` **显式封装**三段降级，文档化清晰
- EvoClaw 依赖 pnpm **默认行为**，无文档化的"锁文件坏了如何降级"约定

---

### §3.5 CVE 标注策略

**hermes** （`.research/01-tech-stack.md §4.1` 关键代码片段）:

```toml
# pyproject.toml 片段（hermes 风格）
"requests>=2.33.0,<3",  # CVE-2026-25645
"PyJWT[crypto]>=2.12.0,<3",  # CVE-2026-32597
```

- **CVE 直接内联注释**在依赖行尾
- 说明"为什么要 pin 这个下限"（避开已知漏洞）
- 审查依赖时可直接看到 CVE 规避决策

**EvoClaw** （`grep -rn "CVE" packages/ apps/` 零结果）:

- 无任何 `# CVE-xxx` 或 `// CVE-xxx` 注释
- 依赖漏洞追踪依赖外部工具（`pnpm audit`）
- 无"为什么 pin 这个版本"的文档

**判定 🔴**：CVE 内联注释是 hermes 学习供应链安全实践的精华之一，EvoClaw **完全缺失**。虽然 `pnpm audit` 能查出漏洞，但**在 `package.json` 中保留 CVE 规避决策**有助于：
- 新成员一眼看到"为什么不用最新版"
- 依赖升级时能对照 CVE 判断是否可放开约束
- 安全审计时的证据留存

**建议**：建立约定——凡是因为 CVE/漏洞 pin 的依赖，必须加注释（如 `"some-pkg": "^1.2.3" // security: CVE-2026-XXXX`）。P2 优先级，0.5d 工作量。

---

### §3.6 可选 extras 机制

**hermes** （`.research/01-tech-stack.md §4.2` + `pyproject.toml:39-110`）:

```toml
[project.optional-dependencies]
modal = ["modal>=1.0.0,<2"]
daytona = ["daytona>=0.148.0,<1"]
dev = ["debugpy>=1.8.0,<2", "pytest>=9.0.2,<10", "pytest-asyncio>=1.3.0,<2", ...]
messaging = ["python-telegram-bot[webhooks]>=22.6,<23", "discord.py[voice]>=2.7.1,<3", ...]
cron = ["croniter>=6.0.0,<7"]
matrix = ["matrix-nio[e2e]>=0.24.0,<1", ...]
voice = ["faster-whisper>=1.0.0,<2", "sounddevice>=0.4.6,<1", "numpy>=1.24.0,<3"]
mcp = ["mcp>=1.2.0,<2"]
honcho = ["honcho-ai>=2.0.1,<3"]
acp = ["agent-client-protocol>=0.9.0,<1.0"]
dingtalk = ["dingtalk-stream>=0.1.0,<1"]
feishu = ["lark-oapi>=1.5.3,<2"]
rl = [
  "atroposlib @ git+https://github.com/NousResearch/atropos.git",
  "tinker @ git+https://github.com/thinking-machines-lab/tinker.git",
  ...
]
all = [ ... ]  # 组合大多数，刻意排除 matrix
```

- **18+ optional extras 分类**（messaging / cron / matrix / voice / mcp / honcho / modal / daytona / rl / acp / cli / tts-premium / homeassistant / sms / mistral / dingtalk / feishu / termux / yc-bench）
- 用户按需装：`pip install hermes-agent[messaging]` / `pip install hermes-agent[all]`
- **`[all]` 刻意排除 `matrix`**（`python-olm` 在新 macOS 编译坏，会把 `[all]` 整个拖挂）

**EvoClaw** （3 个 `package.json`）:

- **无 optional dependencies 机制**（pnpm/npm 的 `optionalDependencies` 语义不同——是"装不上不报错"，非"用户按需启用"）
- 通过 **workspace package 切分**部分覆盖：
  - 核心能力（`@evoclaw/core`）—— Sidecar + Agent Kernel
  - 桌面能力（`@evoclaw/desktop`）—— Tauri + React UI
  - 共享类型（`@evoclaw/shared`）—— Types
- 企业垂直品牌通过**构建时环境变量**（`BRAND=healthclaw`）切换，而非安装时选择

**判定 🔴**：EvoClaw 的 workspace 切分**不是 extras 的替代品**。若未来要支持"企业 IT 按需选择启用 Matrix Channel / Telegram Channel"这类场景，monorepo 架构需要额外设计（feature flag + 动态 import + 按需安装）。

**实际场景**：当前 EvoClaw 只面向国内市场（飞书 / 企微 / iLink 微信），**没有"可选平台扩展"的业务需求**，所以 optional extras 机制缺失不是短板。但若未来国际化，需补充。

---

### §3.7 核心 LLM SDK

**hermes** （`.research/01-tech-stack.md §4.1`）:

```toml
"openai>=2.21.0,<3",
"anthropic>=0.39.0,<1",
```

- 双 SDK 直接依赖 —— `openai` 包 + `anthropic` 包
- SDK 层面提供了 streaming / retry / pagination 等抽象
- 多 provider 兼容通过 "OpenAI-compatible" 替换 baseURL 实现（OpenRouter / DeepSeek / Kimi 等）

**EvoClaw** （`packages/core/package.json:13-22` + `stream-client.ts`）:

- **没有 openai / @anthropic-ai/sdk 依赖**（`grep -l "openai\|anthropic-ai" packages/core/package.json` 零结果）
- Kernel 层直接构造 HTTP 请求（`packages/core/src/agent/kernel/stream-client.ts:270-314` Anthropic / OpenAI 分别构建 `RequestSpec`）
- 双协议支持：`api: 'anthropic-messages'` / `api: 'openai-completions'`（`CLAUDE.md:61`）
- 国产模型（Qwen / GLM / Doubao）统一走 `openai-completions` + 自定义 baseURL

**判定 🟡**：**两种路线各有优劣**：
- hermes SDK 派 —— 维护成本低，SDK 社区维护 retry / streaming 等；但耦合官方 SDK 升级节奏
- EvoClaw HTTP 直调派 —— 完全自主控制协议细节（见 `05-agent-loop-gap.md §3.4` thinking_signature 跨轮保持），能精细化支持国产模型；但需自己实现 retry / jittered_backoff / credential_pool 等基础能力

EvoClaw 选择 HTTP 直调是**战略决策**（为了控制国产模型的协议细节），**不能简单判为落后**。

---

### §3.8 CLI 框架

**hermes** （`.research/01-tech-stack.md §7` + `pyproject.toml:13-37`）:

- `fire>=0.7.1,<1` —— 类 → CLI 子命令映射（`hermes_cli.main:main` 是一个类的方法集）
- `prompt_toolkit>=3.0.52,<4` —— REPL 多行编辑 / slash 命令补全 / 历史导航
- `rich>=14.3.3,<15` —— 终端富文本渲染（table / syntax highlighting / progress bar）
- `simple-term-menu` —— 交互式菜单选择（`[cli]` extras）

**EvoClaw**:

- **无 CLI 框架**（桌面应用为主）
- 用户交互全部走 React GUI（`apps/desktop/src/pages/*.tsx`）
- 开发者脚本用 **tsx**（TypeScript 直接执行）而非 CLI 生成工具（`packages/core/package.json:8` `"dev": "tsx watch src/server.ts"`）

**判定 🟡**：形态不同。hermes 用户接触 CLI，EvoClaw 用户接触 GUI，**依赖栈自然分化**。EvoClaw 未来若要做开发者辅助 CLI（如 `evoclaw doctor` / `evoclaw export-memory`），需引入 CLI 生成库（推荐 `commander` 或 `citty` 或 `clipanion`）。

---

### §3.9 数据库

**hermes** （`.research/14-state-sessions.md` 详述）:

- Python 标准库 `sqlite3`（内置，无需依赖）
- FTS5 全文搜索（SQLite 扩展，Debian `apt-get install sqlite3` 默认含）
- 用 Python 标准 cursor / 参数化查询

**EvoClaw** （`packages/core/package.json:17-18` + `CLAUDE.md §数据库`）:

```json
"better-sqlite3": "^11.9.0",
"@types/better-sqlite3": "^7.6.13",
```

- `better-sqlite3`（Node 同步 SQLite 绑定，性能好于 async 方案）
- Bun 运行时自动优先 `bun:sqlite`（内置原生），Node 回退 `better-sqlite3`（`CLAUDE.md` 数据库段）
- FTS5（全文搜索）+ **sqlite-vec**（向量搜索，`CLAUDE.md:61` 记忆系统引擎）
- MigrationRunner 自动执行 `packages/core/src/infrastructure/db/migrations/*.sql`

**判定 🟡**：EvoClaw 在数据库层**额外引入 sqlite-vec**（向量搜索），支持 L0/L1/L2 三层记忆的混合检索（FTS5 + 向量），这是 hermes **没有的能力**（详见 `15-memory-providers-gap.md`）。但这是**记忆系统**层面的差异，在技术栈层面看仅是"多引入一个 native module"。

---

### §3.10 MCP 依赖形态

**hermes** （`pyproject.toml:42`）:

```toml
mcp = ["mcp>=1.2.0,<2"]
```

- `mcp` 是 **optional extras**，装 `hermes-agent` 默认不含
- 用户需显式 `pip install hermes-agent[mcp]` 才启用
- `.research/21-mcp.md §1` "在 `hermes_cli/mcp_config.py:1-646` 读配置 + `tools/mcp_tool.py` client + `mcp_serve.py` server"

**EvoClaw** （`packages/core/package.json:16`）:

```json
"@modelcontextprotocol/sdk": "^1.29.0"
```

- **`@modelcontextprotocol/sdk` 是 `@evoclaw/core` 的核心依赖**（非 optional）
- 装 `@evoclaw/core` 自动含 MCP SDK
- 未来 MCP Server 端（当前缺失，见 `21-mcp-gap.md`）实施时**库基础已到位**，无需添加依赖

**判定 🟢 反超**：EvoClaw 把 MCP SDK 当核心依赖预装是**战略前瞻**——即便当前 MCP Server 端未实现，未来接入时无需单独声明或引导用户开启 extras。hermes 的 optional 机制更灵活但企业用户可能漏装。

---

### §3.11 浏览器自动化

**hermes** （`.research/01-tech-stack.md §3.4` + `package.json:18-22`）:

```json
"dependencies": {
  "agent-browser": "^0.13.0",
  "@askjo/camoufox-browser": "^1.0.0"
}
```

- `agent-browser`（Nous 自研 npm 包，~13.0 版本）—— 基于 Cheerio 的 DOM 自动化
- `@askjo/camoufox-browser` —— 反检测浏览器引擎（Camoufox = Firefox fork）
- Dockerfile 额外安装 Chromium（`npx playwright install chromium`，`Dockerfile:19`）

**EvoClaw** （`packages/core/src/tools/browser-tool.ts:38-40` + `package.json`）:

```typescript
// browser-tool.ts:38-40
// 尝试加载 Playwright（可选依赖）
const pw = await import('playwright').catch(() => null);

if (pw) {
  return await executeWithPlaywright(pw, action, args);
}

// Fallback: 基础 HTTP 模式
```

- **Playwright 是可选运行时依赖**（`pnpm add -D playwright` 用户自行安装，`browser-tool.ts:50` 提示 "完整浏览器功能需要安装 Playwright: pnpm add -D playwright"）
- Fallback 到基础 fetch + HTML 文本剥离
- 无反检测浏览器（Camofox / undetected-chromedriver 等）
- 无 agent-browser 等自研 DOM 自动化 npm 包

**判定 🟡**：能力层差距显著（见 `22-browser-stack-gap.md`），但**依赖栈层面**两者都采用"运行时动态加载"策略（hermes 的 Playwright 也不是必装），取向相近。

---

### §3.12 国产 IM 依赖

**hermes** （`pyproject.toml:56-57`）:

```toml
dingtalk = ["dingtalk-stream>=0.1.0,<1"]
feishu = ["lark-oapi>=1.5.3,<2"]
```

- `dingtalk-stream`（钉钉官方 Python SDK，gRPC 连接）
- `lark-oapi`（飞书/Lark 官方 Python SDK）
- **无企微 SDK**（hermes 不覆盖）
- **无微信 SDK**（hermes 不覆盖）

**EvoClaw** （`packages/core/src/channel/adapters/` 目录 + HTTP 直调）:

- 无任何国产 IM npm 包依赖（`grep -n "lark\|feishu\|dingtalk\|wecom" packages/core/package.json` 零结果）
- 飞书 / 企微 / iLink 微信 adapter 全部**HTTP 直调**实现（如 `packages/core/src/channel/adapters/feishu.ts`）
- 优势：**不受官方 SDK 升级节奏影响**
- 劣势：需自己处理 access_token 轮换、消息加解密、webhook 签名等

**判定 🟡**：EvoClaw 选择"HTTP 直调"与 hermes "extras SDK" 是**战略取舍**：
- hermes extras → 官方 SDK 协议更新时获益自动
- EvoClaw 自实现 → 协议细节完全可控，适配国内合规场景更灵活

当前阶段 EvoClaw 自实现合理，未来 Channel 稳定后可考虑引入官方 SDK 减少维护负担。

---

### §3.13 文档站

**hermes** （`.research/01-tech-stack.md §3.4` + `website/` 目录）:

- `website/` 独立 Docusaurus 3.9.2 项目
- React 19 + TypeScript 5.6
- Node ≥ 20 要求（与主 package.json 的 ≥18 不同）
- 部署到 GitHub Pages 或类似静态站点托管

**EvoClaw** （仓库根 + `docs/`）:

- 无文档站 —— 仅 `docs/*.md` 直接放在 repo 中
- 子目录结构：`docs/{prd,architecture,iteration-plans,reports,dev,superpowers,...}`
- 所有文档通过 GitHub/GitLab 的 repo markdown 渲染阅读，无静态站点部署

**判定 🔴**：面向企业客户 GA 后，**文档站是必需**（企业 IT 采购方期望有独立文档门户，而非 GitHub repo 页面）。hermes 的 Docusaurus 方案可参考。

**建议**：P2 优先级（非能力阻塞）。详见 `32-docs-website-gap.md`（Wave 2 W2-11）。

---

### §3.14 测试框架

**hermes** （`.research/01-tech-stack.md §4.2, §4.4`）:

```toml
dev = ["debugpy>=1.8.0,<2", "pytest>=9.0.2,<10", "pytest-asyncio>=1.3.0,<2",
       "pytest-xdist>=3.0,<4", "mcp>=1.2.0,<2"]

[tool.pytest.ini_options]
testpaths = ["tests"]
markers = ["integration: marks tests requiring external services (API keys, Modal, etc.)"]
addopts = "-m 'not integration' -n auto"
```

- **pytest + pytest-asyncio + pytest-xdist**（并行）
- `integration` mark 区分单元测试 vs 集成测试（默认排除集成）
- `-n auto` 自动用满 CPU 核心
- 测试规模：11,800+ 测试函数 / 413+ 测试类（见 `31-testing.md`）

**EvoClaw** （`packages/core/package.json:32` + `packages/shared/package.json:14`）:

- **Vitest 3.1**（所有 package 统一使用）
- 默认并行（基于 vitest threads）
- 无 integration mark 分层体系（所有测试混合跑）
- 测试规模：2,414 tests（Sprint 15.12 完成时）
- 目前测试分布在 `packages/core/src/__tests__/`

**判定 🟡**：两者都使用**各自生态的标准选择**。EvoClaw 的 Vitest 选择合理，但缺失 hermes 的**集成测试分层机制**——未来若接入真实的 LLM API、真实的 Channel webhook 测试，需引入类似 mark 系统。

---

### §3.15 系统二进制依赖

**hermes** （`.research/01-tech-stack.md §4.3` + `Dockerfile:2-5`）:

```dockerfile
# Dockerfile
RUN apt-get install -y --no-install-recommends \
    build-essential nodejs npm python3 python3-pip ripgrep ffmpeg gcc python3-dev libffi-dev
```

- **在 Dockerfile 里统一声明**
- 需要的系统包：`ripgrep`（全文搜索） / `ffmpeg`（语音/视频）/ `git` / `openssh`（SSH 环境后端）/ `chromium`（via Playwright）
- 编译时依赖：`build-essential` / `gcc` / `python3-dev` / `libffi-dev`（编译 `faster-whisper`, `python-olm` C 扩展）

**EvoClaw**（`grep -rn "execSync\|ripgrep\|sips\|pdftoppm" packages/core/src --include="*.ts"` 结果整理）:

实测 EvoClaw 运行时需要：

| 工具 | 用途 | 证据位置 |
|---|---|---|
| `ripgrep` | 代码/文本搜索快路径 | `packages/core/src/agent/kernel/builtin-tools.ts:622` 注释 "P1-6: ripgrep + VCS 排除" |
| `sips` | macOS 图片压缩（JPEG 转换） | `builtin-tools.ts:172` `execSync(\`sips --resampleWidth ...)` |
| `pdftoppm` | PDF → JPEG（用于 vision 工具） | `builtin-tools.ts:203` `execSync(\`pdftoppm ...)` |
| `unzip` | Skill 解压 / 扩展包解压 | `skill-installer.ts:163` + `extension-pack/pack-parser.ts:40` |
| `git` | Skill 从 GitHub URL 克隆 | `skill-installer.ts:178` `git clone --depth 1` |
| `which` | 二进制探测 | `skill-gate.ts:45` `execSync(\`which ${bin}\`)` |

**无统一文档声明**。`CLAUDE.md` 未列出系统二进制依赖。若用户在无 `ripgrep` 的系统上运行，会运行时报错而非安装时阻止。

**判定 🟡**：EvoClaw 的系统二进制依赖**藏在代码中**，hermes 至少在 Dockerfile 里显式声明。**建议**:
- 在 `CLAUDE.md` 或 `docs/dev/system-deps.md` 统一文档化系统二进制依赖清单
- `doctor` 命令（类似 `hermes doctor`）检测必需二进制是否可达
- Docker 打包方案（见 `11-environments-spawn-gap.md`）统一管理

---

### §3.16 Linter / 格式化

**hermes** （`.research/01-tech-stack.md §7` + hermes 社区惯例）:

- `pyproject.toml` 未显式声明 linter
- 社区惯例：**black**（格式化） + **ruff**（linter，快替代 flake8）+ **isort**（import 排序）
- `scripts/release.py` 中可能有 lint 调用（待 33 章确认）

**EvoClaw** （`package.json:36` + 各 package.json）:

```json
// package.json
"devDependencies": {
  "oxlint": "^0.17.0"
}

// packages/core/package.json:10
"lint": "oxlint src/"
```

- **oxlint 0.17**（Rust 写的 JS/TS linter，速度极快）
- 统一用 `turbo run lint` 触发所有 package 的 lint
- 无显式格式化器（预计依赖编辑器 Prettier）

**判定 🟡**：两者各用生态标准，oxlint 的选择是 EvoClaw 的性能取向——oxlint 比 ESLint 快 50-100×，适合 monorepo 场景。

---

### §3.17 安全敏感本地能力（Rust 侧）

**hermes** —— 无对应（纯 Python + Node，无系统级能力）。

**EvoClaw** （`apps/desktop/src-tauri/Cargo.toml:17-19`）:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
security-framework = "3.2"
ring = "0.17"
base64 = "0.22"
```

- **`security-framework 3.2`** —— macOS Keychain Services 绑定（Rust crate）
- **`ring 0.17`** —— 现代加密库（AES-256-GCM 等）
- **`base64 0.22`** —— Base64 编码
- CLAUDE.md §技术栈 声称 "macOS Keychain (security-framework) + AES-256-GCM (ring)"

**用途**: 本地 API Key 存储（Keychain）+ 敏感字段加密（AES-256-GCM）—— **企业级数据合规的基石**。

**判定 🟢 反超**：hermes 是解释型纯 Python，**无法直接访问 macOS Keychain**（会通过 `keyring` Python 包间接调用，依赖系统 Keyring 进程）。EvoClaw 的 Rust 侧**原生访问 Keychain Services**——安全边界更小、攻击面更窄、性能更好。

---

### §3.18 `[all]` 聚合装哲学

**hermes** （`.research/01-tech-stack.md §3.1`）:

> "matrix excluded: python-olm (required by matrix-nio[e2e]) is upstream-broken on modern macOS (archived libolm, C++ errors with Clang 21+). Including it here causes the entire [all] install to fail, dropping all other extras."

- **设计模式**: "宁可失去一个平台也不让全家桶炸"
- `[all]` 包含大多数 extras 但**刻意排除 `matrix`**
- 原则：一个损坏的依赖不应拖累全部

**EvoClaw** —— 无 `[all]` 概念，也无等价选择。monorepo 里每个 package 独立声明依赖，若某个 native module（如 `better-sqlite3`）在特定平台编译失败，该 package 整个装不上，但不会影响其他 package。pnpm 的 `onlyBuiltDependencies: ["esbuild"]` 约束能部分缓解 —— 只允许 esbuild 执行 install 脚本，其他依赖的 install 脚本被跳过，减少"编译失败"场景。

**判定 🟡**：**架构不同导致哲学不同**。hermes 需要"安装时按需启用平台"；EvoClaw 所有 Channel 都内置（`CLAUDE.md §1.3` "内置全部能力，安全审计可控"），不需要"用户选择哪些功能安装"。**两种路线各有道理**：
- hermes 适合开发者社区（"我只要 Telegram，不要 Matrix 拖累我"）
- EvoClaw 适合企业集中部署（"IT 一次性审查完所有能力，员工无需配置"）

---

## 4. 改造蓝图（不承诺实施）

本章为**技术栈级**对比，大多数差距是**生态选择**而非"可立即补齐"。

### P2（长期规划，质量提升）

| # | 项目 | 对应差距 | 工作量 | 价值 |
|---|---|---|---|---|
| 1 | 关键依赖 CVE 内联注释约定 | §3.5 | 0.5d + 持续维护 | 供应链透明度 |
| 2 | 系统二进制依赖统一文档化（`docs/dev/system-deps.md`） | §3.15 | 0.5d | 新环境部署避坑 |
| 3 | `evoclaw doctor` 命令 / 构建脚本检测必需二进制 | §3.15 | 1-2d | 错误前置到安装时 |
| 4 | 集成测试 mark 体系（隔离 API/Channel/E2E 测试） | §3.14 | 1d | CI 稳定性 |
| 5 | Docusaurus 文档站（面向企业客户 GA 前） | §3.13 | 3-5d | 企业采购门面 |

### 不建议做

| # | 项目 | 理由 |
|---|---|---|
| — | 改用 openai / @anthropic-ai/sdk 官方 SDK | §3.7 决策是战略取舍（国产模型协议细节控制），切换会破坏 thinking_signature 跨轮保持等精细能力 |
| — | 引入 PyPI 风格 optional extras 机制 | §3.6 当前无业务需求（EvoClaw 内置所有 Channel） |
| — | 改造回 openai/anthropic 双 SDK | 见 §3.7 |

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应缺失 |
|---|---|---|---|
| 1 | MCP SDK 作为 core 依赖（非 optional） | `packages/core/package.json:16` `@modelcontextprotocol/sdk` | hermes `mcp` 是 `[mcp]` optional extras |
| 2 | Rust 侧 Keychain + crypto 原生能力 | `apps/desktop/src-tauri/Cargo.toml:17-19` | hermes 纯解释型，无法原生访问 Keychain |
| 3 | Bun 优先 + Node 回退双运行时 | `package.json:7-10` engines | hermes 仅 Python，无多运行时选择 |
| 4 | Turborepo 增量构建缓存（monorepo 优势） | `turbo.json` | hermes 单项目无增量构建问题 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（本章所有 `path:line` 均经 Read / Bash 验证 2026-04-16）

- `package.json:7-10` ✅ engines（Bun >=1.3 / Node >=22 / pnpm >=10）
- `package.json:11` ✅ `packageManager: "pnpm@10.14.0"`
- `package.json:41-45` ✅ `pnpm.onlyBuiltDependencies: ["esbuild"]`
- `packages/core/package.json:16` ✅ `"@modelcontextprotocol/sdk": "^1.29.0"`
- `packages/core/package.json:17-18` ✅ better-sqlite3 11.9
- `apps/desktop/package.json:15-20` ✅ Tauri 2.5 + React 19.1 + Zustand 5.0
- `apps/desktop/src-tauri/Cargo.toml:17-19` ✅ security-framework + ring + base64
- `packages/core/src/agent/kernel/builtin-tools.ts:622` ✅ ripgrep 注释
- `packages/core/src/agent/kernel/builtin-tools.ts:172` ✅ sips 调用
- `packages/core/src/agent/kernel/builtin-tools.ts:203` ✅ pdftoppm 调用
- `packages/core/src/tools/browser-tool.ts:38-50` ✅ Playwright 可选依赖降级逻辑
- `packages/core/src/skill/skill-installer.ts:163, 178` ✅ unzip + git clone

### 6.2 hermes 研究章节引用

- `.research/01-tech-stack.md §1` — 技术栈总览（Python 3.11+ / uv / Node 18+ / ripgrep / ffmpeg / chromium）
- `.research/01-tech-stack.md §3.1` — 依赖三档分类（核心 / 可选 extras / [all] 聚合）
- `.research/01-tech-stack.md §3.2` — uv.lock 三段降级安装
- `.research/01-tech-stack.md §3.3` — 特殊 git 源依赖（atroposlib / tinker / yc-bench）
- `.research/01-tech-stack.md §3.4` — Node.js 双角色
- `.research/01-tech-stack.md §4.1` — 核心依赖全量清单 + CVE 注释
- `.research/01-tech-stack.md §4.2` — 18+ optional extras 清单
- `.research/01-tech-stack.md §4.3` — Dockerfile 系统依赖
- `.research/01-tech-stack.md §4.4` — pytest 配置
- `.research/01-tech-stack.md §6` — 强制/推荐/可选依赖分类复刻清单

### 6.3 关联 gap 章节（crosslink）

- [`00-overview-gap.md`](./00-overview-gap.md) §3.9 — 技术栈生态 overview（本章深化）
- `11-environments-spawn-gap.md` (Wave 2 W2-2) — Docker 后端对 ripgrep/ffmpeg 等系统依赖的统一管理
- `14-state-sessions-gap.md` (Wave 2 W2-3) — 数据库栈（FTS5 / sqlite-vec） 细节
- `15-memory-providers-gap.md` (Wave 2 W2-3) — sqlite-vec 向量检索（§3.9 关联）
- `21-mcp-gap.md` (Wave 2 W2-7) — MCP SDK core 依赖支撑 MCP Server 端实施
- `22-browser-stack-gap.md` (Wave 2 W2-8) — agent-browser / Camofox vs Playwright 可选依赖（§3.11 深化）
- `29-security-approval-gap.md` (Wave 2 W2-10) — Rust 侧 Keychain + crypto 安全能力（§3.17 深化）
- `30-build-packaging-gap.md` (Wave 2 W2-10) — 三通道发行 vs DMG（技术栈打包层深化）
- `31-testing-gap.md` (Wave 2 W2-11) — pytest vs Vitest 细节（§3.14 深化）
- `32-docs-website-gap.md` (Wave 2 W2-11) — Docusaurus 文档站方案

---

**本章完成**。技术栈级差距盘点完毕：**两套栈各自成熟无可比性**，EvoClaw 在 **MCP SDK core 依赖 / Rust Keychain / Bun+Node 双运行时 / Turbo 增量构建** 四项反超，在 **CVE 内联注释约定 / 系统二进制文档化 / 文档站** 等**工程治理层面**有值得借鉴 hermes 的空间。
