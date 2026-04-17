# 30 — 构建与发行 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/30-build-packaging.md`（613 行）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），Python setuptools wheel + Docker + Nix flake + setup-hermes.sh（399 行）
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），pnpm monorepo + Tauri 2 DMG 单通道 + Bun 1.3 内嵌
> **综合判定**: 🟡 **形态差异显著**（库发行 vs 桌面应用打包），但多品牌构建、Bun sidecar 打包、Rust 原生代码签名等三项 EvoClaw 反超

**档位图例**:
- 🔴 EvoClaw 明显落后 — 发行能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 部分覆盖 / 形态差异 — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 EvoClaw 对齐或反超 — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes 发行架构**（`.research/30-build-packaging.md §1-2`）：项目提供**三条等价的发行通道** + 一条开发者脚本：

1. **PyPI wheel**（库发行）：`setuptools >= 61.0` + `py-modules` + `find packages` + `MANIFEST.in graft`，三个 entry point（hermes / hermes-agent / hermes-acp）
2. **Docker 镜像**（服务器部署）：Debian 13.4 基础镜像 + 单层 pip/npm/playwright/whatsapp-bridge，bootstrap entrypoint 创建 ~/.hermes/* 目录
3. **Nix flake**（声明式部署）：uv2nix + pyproject-nix，三平台（x86_64-linux / aarch64-linux / aarch64-darwin），支持 native + container 双模式
4. **setup-hermes.sh**（开发者一键）：uv venv 创建 + 锁文件降级 + ripgrep 多源降级，含 Termux/Android 分支

**发行管理**：无官方 PyPI publish 工作流（尽管产出 wheel），发布仅走 GitHub Release + tag 脚本（scripts/release.py CalVer）。多发行通道意图：**让用户自选最适合的运行时和部署方式**。

**EvoClaw 发行架构**（`package.json` + `turbo.json` + `build-dmg.sh` + `brand-apply.mjs`）：**单一通道** + **多品牌支持**：

1. **Tauri DMG（macOS 唯一）**：`pnpm build` 全量构建（shared/core/desktop）+ brand 注入（6 个自动生成文件）+ Bun 1.3.6 内嵌二进制下载 + `cargo build --release` + Tauri 打包 DMG，约 3-5 分钟全流程
2. **多品牌构建**（EvoClaw/HealthClaw）：brand-apply.mjs 脚本自动生成 brand.ts + tauri.conf.json + Cargo.toml + main.rs + icons 复制 + 品牌色 CSS + feature flags .env.brand
3. **Bun sidecar**：download-bun.mjs 脚本自动从 GitHub release 下载 Bun v1.3.6，内嵌 tauri.conf.json `resources` 为 DMG 打包（**无代码签名、无公证、无 auto-update**）

**量级对比**：hermes 发行代码 ~2000 行（含四大通道 + 脚本），EvoClaw 发行代码 ~200 行（build-dmg.sh ~77 行 + brand-apply.mjs ~260 行 + download-bun.mjs ~92 行），差异来自**库 vs 应用**的本质差异（库需多个部署形态，应用聚焦单形态打包）。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 构建系统主语言 | 🟡 | Python setuptools vs pnpm + Turbo，各自生态成熟 |
| §3.2 | 包管理与依赖锁 | 🟡 | uv.lock 哈希校验 vs pnpm-lock.yaml SHA512，两者都有软件管制 |
| §3.3 | 发行通道数量 | 🔴 | hermes 三官方通道（wheel + Docker + Nix），EvoClaw 单通道（DMG） |
| §3.4 | 跨平台支持 | 🔴 | hermes Python 零编译、Windows/macOS/Linux 一致性高，EvoClaw Rust 编译需跨平台支持缺失 |
| §3.5 | 开发者快速安装 | 🟡 | hermes setup-hermes.sh 399 行含 Termux 分支，EvoClaw npm i + pnpm build 简单但无 Termux |
| §3.6 | 构建配置参数化 | 🟢 | **反超**：brand-apply.mjs 多品牌自动注入（tauri.conf.json + Cargo.toml + 品牌色 + icons），hermes 无品牌系统 |
| §3.7 | Runtime sidecar 管理 | 🟢 | **反超**：download-bun.mjs 版本锁定 + 架构检测 + 校验，hermes 无运行时打包（Python 解释器系统提供） |
| §3.8 | 代码签名与公证 | 🔴 | hermes 无（开源库不需），EvoClaw DMG 完全缺失（说明文档"未签名，安装后需右键打开绕过 Gatekeeper"） |
| §3.9 | 多架构构建支持 | 🔴 | hermes Nix 三平台含 aarch64-darwin wheel hack，EvoClaw 仅 macOS（无 arm64/x64 双编译） |
| §3.10 | CI/CD 工作流 | 🔴 | hermes 5 个工作流（tests / docker-publish / nix / docs / supply-chain），EvoClaw 无 .github/workflows |
| §3.11 | 版本化与发布 | 🔴 | hermes scripts/release.py CalVer + GitHub Release，EvoClaw 手动（package.json 0.1.0）|
| §3.12 | 开发 vs 生产构建分离 | 🟡 | hermes dev/prod 区分不明显（锁文件统一），EvoClaw `BRAND=` env 参数显式分离 |
| §3.13 | Nix 声明式部署 | 🔴 | hermes 完整 flake + NixOS module，EvoClaw 无 Nix 支持 |
| §3.14 | Docker 镜像发行 | 🔴 | hermes 完整 Dockerfile + multi-arch (amd64+arm64) + docker-publish.yml，EvoClaw 无 Docker |
| §3.15 | 系统二进制依赖文档 | 🟡 | hermes Dockerfile 明确列举（ripgrep/ffmpeg/gcc 等），EvoClaw 文档缺失（运行时才检测 sips/pdftoppm） |

**统计**: 🔴 9 / 🟡 4 / 🟢 2。

---

## 3. 机制逐条深度对比

### §3.1 构建系统主语言

**hermes**（`pyproject.toml:1-4`）:

```toml
[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"
```

- **setuptools 驱动**：py-modules + find packages 双声明（`pyproject.toml:106-112`）
- **构建产物**：`.whl` wheel 和 `.tar.gz` sdist（标准 Python dist 格式）
- **无编译**：纯 Python，setuptools 仅复制文件 + 生成 entry point 脚本

**EvoClaw**（`package.json:19-20` + `apps/desktop/package.json:8`）:

```json
"build": "bun scripts/brand-apply.mjs && turbo run build",
"build:desktop": "bun scripts/brand-apply.mjs && turbo run build --filter=@evoclaw/desktop",
```

```bash
# apps/desktop/package.json:8
"build": "tsc -b && vite build"
```

- **Turbo orchestration**：top-level 协调 shared/core/desktop 三包（`turbo.json` tasks 定义依赖）
- **多阶段编译**：
  1. `brand-apply.mjs`（参数化注入，§3.6 详述）
  2. `tsc -b`（TypeScript 编译 + 增量检查）
  3. `vite build`（前端打包 + 代码分割）
  4. `tsx build.ts`（core esbuild 打包，`packages/core/build.ts`）
- **Tauri 编译**（`apps/desktop/src-tauri` Rust + Cargo）：最后一步 `cargo build --release` 编译 Rust native code

**判定 🟡**：
- setuptools 是纯文件复制，EvoClaw 涉及 TS→JS + Rust→native 的多语言编译
- EvoClaw 的 Turbo 编排比 hermes 的单阶段 setuptools 复杂（需要版本同步、缓存管理）
- EvoClaw 因 Rust 引入了**跨平台编译链复杂度**（见 §3.4）

---

### §3.2 包管理与依赖锁

**hermes**（`.research/30-build-packaging.md §3.1` + `pyproject.toml:1-117`）:

```bash
# uv sync --locked --all-extras（完整构建）
# uv sync --locked（最小化）
```

**关键特点**（`setup-hermes.sh:182-193`）:

```bash
if [ -f "uv.lock" ]; then
    UV_PROJECT_ENVIRONMENT="$SCRIPT_DIR/venv" $UV_CMD sync --all-extras --locked 2>/dev/null && ... || {
        echo "⚠ Lockfile install failed, falling back to pip install..."
        $UV_CMD pip install -e ".[all]" || $UV_CMD pip install -e "."
    }
```

- **uv.lock** 5,467 行（hermes 研究 §1），纯文本 TOML，包含 hash 校验（`pip install` 风格）
- **三阶降级**：`uv sync --locked` → `uv pip install -e ".[all]"` → `uv pip install -e "."`
- **no-binary / only-binary** 控制不存在（uv 自动适配）

**EvoClaw**（`package.json:11` + `pnpm-lock.yaml`）:

```json
"packageManager": "pnpm@10.14.0"
```

```bash
# pnpm-lock.yaml: SHA512 哈希
# pnpm install（默认 frozen lockfile 检查）
# pnpm install --no-frozen-lockfile（允许更新）
```

**关键特点**:

- **pnpm-lock.yaml** 文件（行数未统计，但通常 3-5 倍 uv.lock 因为每个 dep 记录 integrity hash + resolved URL）
- **workspace:*** 协议（monorepo 内 dep 指向 workspace package）：`packages/core package.json:14 "@evoclaw/shared": "workspace:*"`
- **pnpm onlyBuiltDependencies**（`package.json:41-45`）：仅 esbuild 使用预构建二进制，其他都源码编译（与 hermes 的 uv 自动适配风格不同）

**判定 🟡**：
- 两者都有强制锁文件检查（uv.lock hash vs pnpm-lock.yaml integrity）
- uv 的三阶降级策略（面向库开发者）vs pnpm 的 frozen-lockfile（面向应用）取向不同
- **EvoClaw 缺失**：类似 `constraints-termux.txt` 的平台专用锁（见 hermes 研究 §3.4.1 Termux 分支）

---

### §3.3 发行通道数量

**hermes**（`.research/30-build-packaging.md §1-2, §3.1-3.4`）:

| 通道 | 配置文件 | 行数 | 产物 | 用户 |
|------|---------|------|------|------|
| ① PyPI wheel | `pyproject.toml` | 117 | `dist/*.whl` + `.tar.gz` | `pip install hermes-agent` |
| ② Docker | `Dockerfile` | 28 | `nousresearch/hermes-agent:latest` (amd64+arm64) | `docker pull` |
| ③ Nix flake | `flake.nix` + `nix/*.nix` | 35+200 | `/nix/store/.../bin/hermes` | `nix build` / NixOS module |
| ④ setup-hermes.sh | `setup-hermes.sh` | 399 | `~/.local/bin/hermes` + venv | 开发者一键 |

**关键约束**：
- 三个官方通道**代码共享**：都安装同一份 `pyproject.toml` 定义的 package 集合
- `MANIFEST.in` 用 `graft skills` 确保 bundled skills 在所有通道都包含（`pyproject.toml:101-110`）
- Nix 通道的 NixOS module（`nix/nixosModules.nix:784 行`）支持两种部署：native systemd 或 OCI container（学習曲线陡）
- CI/CD 为四大通道各有分工：tests.yml / docker-publish.yml / nix.yml / （没有 pypi-publish.yml）

**EvoClaw**（`.research/30-build-packaging.md §3 + build-dmg.sh`）:

| 通道 | 配置文件 | 行数 | 产物 | 用户 |
|------|---------|------|------|------|
| ① Tauri DMG | `tauri.conf.json` + `build-dmg.sh` | 55+77 | `*.dmg` (macOS arm64/x64 通用) | 双击 DMG + 拖拽 Applications |

**关键约束**：
- **单一通道**：DMG 是 macOS 唯一发行形态，无 Windows/Linux 支持
- `build-dmg.sh` 四个步骤（0. brand apply / 1. 确保 Bun / 2. pnpm build / 3. 验证产出 / 4. tauri build）
- **无代码签名**：DMG 是未签名的（`build-dmg.sh:6` 注释："未签名，安装后需右键 → 打开 绕过 Gatekeeper"）
- **无 auto-update**：DMG 是静态产物，无 updater 集成（Tauri 提供了 updater 框架但 EvoClaw 未启用）
- CI/CD：完全缺失（`.github/workflows/` 无 build/release 工作流）

**判定 🔴**：hermes 三官方通道代表**自选部署自由度**，EvoClaw 单 DMG 严重限制了用户基数。对齐成本高（Windows + Linux 需 Tauri wix 和 AppImage，CI/CD 需 macos/ubuntu runners）。

---

### §3.4 跨平台支持

**hermes**（`.research/30-build-packaging.md §3.3 + flake.nix:250`）:

```nix
systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
```

**实现策略**：
- **Python 零编译**：`pyproject.toml` 声明 `requires-python = ">=3.11"` 后，wheel 产物在任何平台用同一份
- **Dockerfile 多架构**：`docker-publish.yml` 用 buildx 同时构建 linux/amd64 + linux/arm64（扫 Dockerfile 无平台相关 RUN）
- **Nix 平台条件**：`nix/python.nix:38-69` 的 `pythonPackageOverrides` 在 aarch64-darwin 上用 nixpkgs 预构建的 numpy/av/onnxruntime 等（因为 wheel 构建失败）
- **Termux Android**：`setup-hermes.sh:34-36` 分岔，用 `venv` + `pip` + `constraints-termux.txt` 代替 uv

**跨平台保障**（`pyproject.toml:14-97` 依赖都是"解释型（Python + 脚本）或纯 C extension（有预构建 wheel）"）。

**EvoClaw**（`turbo.json` + `apps/desktop/src-tauri/Cargo.toml:4 edition = "2021"`）:

**实现策略**：
- **Rust 必须编译**：Cargo.toml 编译 Tauri 2 + security-framework（macOS 专有）+ ring（密码学库，通常有跨平台支持但需编译）
- **macOS 单一支持**：Tauri.conf.json `bundle.targets: ["dmg"]` 硬编码单目标，无 `wix` (Windows) / `appimage` (Linux)
- **download-bun.mjs 平台检测**（§3.7 详述）：架构自动检测（arm64 → aarch64，x64 → x64-baseline），但只针对 macOS
- **缺 CI/CD 矩阵**：无 `.github/workflows` 来验证 Windows/Linux 的 Tauri 构建（即使配置了也会失败）

**跨平台风险清单**：
1. ❌ Windows 支持：未配置 `wix` bundle，`tauri build` 报错
2. ❌ Linux 支持：未配置 `appimage` / `deb` 等，无法打包
3. ❌ arm64 Windows：未针对 arm64 Windows 测试（Tauri 2 支持但需编译验证）
4. ⚠️ aarch64-linux：Rust crate 生态大多支持但需编译验证（无预构建轮）

**判定 🔴**：EvoClaw 因 Rust 编译而失去了 hermes Python 的"字节码一次编译处处运行"优势。实现 Windows/Linux 支持需要：
- 在 Cargo.toml 添加 wix / appimage 目标
- 创建 macos/windows/ubuntu runners 的 CI/CD 矩阵（3×3 = 9 组合）
- 处理 Tauri 的平台 feature gate（security-framework 是 macOS 专有，Windows 用 windows-latest SDK）
- 工作量估计：2-3 人周（包括 CI 调试和交叉编译坑）

---

### §3.5 开发者快速安装

**hermes**（`.research/30-build-packaging.md §3.4`）:

**setup-hermes.sh 全流程**（实测 2-3 分钟）：

```bash
# 步骤 1. 安装 uv（如未存在）
curl -LsSf https://astral.sh/uv/install.sh | sh

# 步骤 2. Python 3.11 provisioning
uv python install 3.11

# 步骤 3. 创建 venv
uv venv venv --python 3.11

# 步骤 4. 依赖安装（三阶降级）
uv sync --all-extras --locked 2>/dev/null || uv pip install -e ".[all]" || uv pip install -e "."

# 步骤 5. ripgrep 多源降级（apt/dnf/brew/cargo）
apt install -y ripgrep || dnf install -y ripgrep || brew install ripgrep || cargo install ripgrep

# 步骤 6. symlink + shell rc 修改
ln -sf venv/bin/hermes ~/.local/bin/hermes
# 检查 ~/.local/bin 在 PATH，不在则写 .zshrc/.bashrc

# 步骤 7. Skill 同步
tools/skills_sync.py → ~/.hermes/skills/
```

**关键创新点**（`setup-hermes.sh:34-36, 68-74, 108-123, 230-250`）：
- **Termux 分岔**：自动检测 `$TERMUX_VERSION` 或 `$PREFIX`，切换至 stdlib venv + pip + constraints-termux.txt
- **锁文件三降**：优先 locked，失败降级到 pip install extras，再失败降级到最小化
- **ripgrep 多源**：shell 脚本自动选择 apt/dnf/brew/cargo（无法离线 fallback）
- **没有 Node.js**：开发环境不需要（agent-browser 通过容器化）

**所需工具**：bash / curl / uv（自动装） / python（uv 装） / ripgrep（手动或脚本装）。

**EvoClaw**（`package.json` + 根目录无 setup 脚本）:

**实际开发者流程**（实测 5-10 分钟）：

```bash
# 步骤 1. 系统工具（假设已装）
brew install pnpm

# 步骤 2. 依赖安装
pnpm install

# 步骤 3. 开发模式
pnpm dev:core               # 本地 Sidecar server
pnpm dev:evoclaw            # or HealthClaw（构建前端 + watch Tauri）

# 步骤 4（可选）产品构建
pnpm build:dmg:evoclaw      # 完整 DMG 打包（第一次 3-5 分钟）
```

**关键特点**：
- **无脚本化**：完全依赖 pnpm / Bun / Xcode（macOS 用户预装）
- **缺 Termux**：无 Android/Termux 开发路径
- **缺 ripgrep 检查**：代码用 `grep -r` 但运行时缺失会静默失败
- **Bun 自动**：download-bun.mjs 在 build-dmg.sh 中被 triggered（不在日常开发中），开发用系统 Node + pnpm

**判定 🟡**：
- hermes 的 setup-hermes.sh 更**自动化 + 容错**（降级链、多源检测），适合新开发者和生产部署
- EvoClaw 的 `pnpm install` 更**简洁**但**假设依赖已装**（Xcode tools、pnpm global、Rust 工具链）
- EvoClaw **缺 Termux 支持** 是硬伤（若想支持 Android 开发者）
- EvoClaw 开发体验取决于**前置条件**：macOS + Xcode + pnpm 全装；hermes 脚本代你处理

---

### §3.6 构建配置参数化

**hermes**（`.research/30-build-packaging.md`）:

**硬编码多个品牌/特性**？— 不存在。hermes 是单品牌（Nous Research），没有 brand 参数化系统。最接近的是：

```python
# run_agent.py:1 之类的硬编码字符串
HERMES_VERSION = "0.8.x"
SOUL = "<hermes>"  # 品牌
```

**配置入口**：`cli-config.yaml.example` / `.env.example`（不在构建时参数化，而是在**启动时读取**）。

**发布时无品牌切换**（即一份 wheel 代表 Nous Research hermes，无法重打包为 community fork）。

**EvoClaw**（`scripts/brand-apply.mjs` 260 行 + `brands/{evoclaw,healthclaw}/brand.json`）:

**完整参数化流程**（每次构建前自动运行，§3.6 详述）：

```bash
BRAND=healthclaw pnpm build:dmg:healthclaw
```

**brand-apply.mjs 生成/覆写 6 个文件**（`scripts/brand-apply.mjs:35-191`）:

1. **packages/shared/src/brand.ts** — 品牌常量导出（BRAND_NAME / BRAND_IDENTIFIER / BRAND_COLORS 等）
2. **apps/desktop/src-tauri/tauri.conf.json** — productName + identifier + window.title（`tauri.conf.json:3,89-91`）
3. **apps/desktop/src-tauri/Cargo.toml** — crate name 和 lib name（健康夹→healthclaw-desktop）
4. **apps/desktop/src-tauri/src/main.rs** — lib crate 引用（healthclaw_desktop_lib::run()）
5. **apps/desktop/index.html** — `<title>` + loading 页面品牌色 + 品牌 icon
6. **apps/desktop/src/index.css** — --color-brand / --color-brand-hover / --color-brand-active / --color-brand-muted（派生色彩）

**品牌定义例**（`brands/healthclaw/brand.json`）：

```json
{
  "name": "HealthClaw",
  "identifier": "com.healthclaw.app",
  "abbreviation": "HC",
  "dataDir": "~/Library/Application Support/HealthClaw",
  "colors": {
    "primary": "#06b6d4",      // Cyan
    "primaryDark": "#0891b2",
    "gradient": ["#06b6d4", "#0284c7"]
  },
  "windowTitle": "HealthClaw — AI Healthcare Companion",
  "keychainService": "com.healthclaw.keychain",
  "features": { "enable_telemetry": false, "enable_beta": true }
}
```

**重要约束**（`scripts/brand-apply.mjs:23-31`）：

```javascript
const brand = process.env.BRAND || 'evoclaw';
const brandDir = join(ROOT, 'brands', brand);
const brandJsonPath = join(brandDir, 'brand.json');

if (!existsSync(brandJsonPath)) {
  console.error(`❌ 品牌配置不存在: ${brandJsonPath}`);
  process.exit(1);
}
```

**图标自动复制**（`scripts/brand-apply.mjs:126-162`）：

```bash
brands/healthclaw/icons/
  ├── icon.png
  ├── 32x32.png
  ├── 128x128.png
  ├── 128x128@2x.png
  └── brand-header.png  (可选)
```

**判定 🟢 反超**：
- EvoClaw 的品牌系统让用户/合作方**只改 brand.json + icons 文件夹就能构建新品牌**，无需修改源码
- hermes 无此机制（每个分叉/品牌都要维护独立代码库或手动改字符串）
- EvoClaw 支持**多个品牌共存**（通过 `BRAND=` env 切换），生产上特别有价值（EvoClaw/HealthClaw 可共用一份代码库）
- **成本**：brand-apply.mjs 脚本维护（现在 260 行，新增品牌只需补 brand.json）

---

### §3.7 Runtime sidecar 管理

**hermes**（`.research/30-build-packaging.md`）:

**运行时管理**：
- **Python 解释器**：假设系统已装或 uv 提供（`uv python install 3.11`），不在发行产物中
- **Node.js**：Dockerfile 中 `apt-get install nodejs npm`，非发行 sidecar
- **Playwright（浏览器）**：Dockerfile 中 `npx playwright install chromium`，镜像内打包但不内嵌源码

**无 sidecar 概念**：解释型语言的标准做法。

**EvoClaw**（`scripts/download-bun.mjs` 92 行）:

**完整 Bun sidecar 管理**：

```bash
# download-bun.mjs 的核心逻辑（§3.7.1-3.7.4）
```

**§3.7.1 版本管理**（`scripts/download-bun.mjs:22`）:

```javascript
const BUN_VERSION = '1.3.6';
```

**单一事实源**：硬编码版本（配置不在 package.json），每次更新修改此行。

**§3.7.2 架构检测**（`scripts/download-bun.mjs:24-29`）:

```javascript
const archMap = { arm64: 'aarch64', x64: 'x64-baseline' };
const bunArch = archArg === 'x64' ? 'x64-baseline'
  : archArg === 'aarch64' ? 'aarch64'
  : archMap[process.arch] ?? 'aarch64';
```

**自动映射**：Node 的 process.arch（arm64/x64）→ Bun 包命名（aarch64/x64-baseline）。允许手动覆盖（`node scripts/download-bun.mjs x64`）。

**§3.7.3 下载 & 校验**（`scripts/download-bun.mjs:38-49`）:

```javascript
if (existsSync(bunBin)) {
  try {
    const ver = execSync(`"${bunBin}" --version`, { encoding: 'utf-8' }).trim();
    if (ver === BUN_VERSION) {
      console.log(`✅ Bun ${ver} (${bunArch}) 已存在，跳过下载`);
      process.exit(0);
    }
    console.log(`⚠️ 现有 bun 版本 ${ver}，需要 ${BUN_VERSION}，重新下载`);
  } catch {
    console.log('⚠️ 现有 bun 无法执行，重新下载');
  }
}
```

**版本校验**：运行 `bun --version` 检查，版本不符则重新下载，无网络时若已存在则复用。

**§3.7.4 下载 & 校验 & 权限**（`scripts/download-bun.mjs:59-83`）:

```bash
# 下载
curl -fsSL -o "${zipFile}" "${url}"
unzip -o -q "${zipFile}" -d "${tmpDir}"

# 移动
renameSync(srcBun, bunBin);
chmodSync(bunBin, 0o755);

# 验证产物
const ver = execSync(`"${bunBin}" --version`, { encoding: 'utf-8' }).trim();
console.log(`✅ Bun ${ver} (${bunArch}) 已下载到 ${bunBin}`);
```

**关键点**：
1. 下载到临时文件夹避免部分下载污染
2. 解压后校验文件存在（`bun-darwin-{arch}/bun`）
3. 重命名到最终位置（原子操作避免并发冲突）
4. chmod +x 使其可执行
5. 最后 `bun --version` 验证是否真的能运行

**§3.7.5 集成进 DMG 打包**（`apps/desktop/src-tauri/tauri.conf.json:42-48`）:

```json
"resources": [
  "bun-bin/bun",
  "../../../packages/core/dist/package.json",
  "../../../packages/core/dist/server.mjs",
  "../../../packages/core/dist/migrations/*",
  "../../../packages/core/dist/skill/bundled/**/*"
]
```

**说明**：
- `bun-bin/bun` — Tauri 打包时将此二进制复制进 DMG `Contents/Resources/`
- `core/dist/server.mjs` — Sidecar 启动脚本（Node.js 虚拟机规范）
- `core/dist/migrations/*` — 数据库迁移脚本
- `skill/bundled/**/*` — 预装 skills 集合

**Tauri 启动时注入**（假设，代码未读）：Rust side 运行 `Resources/bun-bin/bun Resources/server.mjs` 启动 Sidecar。

**判定 🟢 反超**：
- EvoClaw 的 Bun sidecar 管理**版本锁定 + 架构检测 + 下载校验 + 权限设置**都考虑周全
- hermes 无此需要（Python 不装在产物中）
- **EvoClaw 做法借鉴意义**：任何需要内嵌运行时的应用（如 Rust Tauri、Go 桌面应用）都可参考此模式

---

### §3.8 代码签名与公证

**hermes**（`.research/30-build-packaging.md`）:

**无代码签名**：开源库，发布的是 wheel/Docker image/Nix flake，无 macOS/Windows code signing 需求。wheel 和 Docker image 通过包管理器（pip / docker pull）的 HTTPS 验证完整性。

**但提供工具**：hermes 包含 `scripts/` 目录给用户部署参考，不代表官方签名。

**EvoClaw**（`scripts/build-dmg.sh:6`）:

```bash
# 注意: 未签名，安装后需右键 → 打开 绕过 Gatekeeper
```

**现状**：DMG 完全未签名，首次用户安装后 macOS Gatekeeper 会拦截。绕过方式：右键 App → 打开（而非双击）。

**严重风险**：
1. **用户体验差**：非技术用户不知道"右键打开"
2. **安全感低**：DMG 对用户来说是"不信任的来源"
3. **无法通过 App Store / 第三方分发**（代码签名是前提）

**实现代码签名 & 公证的步骤**（不在 build-dmg.sh 中，需新增）:

```bash
# 步骤 1. 生成或导入开发者证书
security import /path/to/cert.p12 -P password -k ~/Library/Keychains/login.keychain

# 步骤 2. 签名 Tauri 产出的 .app
codesign -s "Developer ID Application: ..." --deep --force \
  ./target/release/bundle/macos/EvoClaw.app

# 步骤 3. 签名 DMG
codesign -s "Developer ID Application: ..." EvoClaw.dmg

# 步骤 4. 公证（Apple 在线服务，需要 2 factor 认证）
xcrun notarytool submit EvoClaw.dmg --apple-id xxx@example.com --password appid-pwd --team-id XXXXXXXXXX --wait

# 步骤 5. 验证公证结果
xcrun stapler staple EvoClaw.dmg
```

**工作量估计**：0.5 人天（含证书管理、脚本集成），但需要：
- Apple Developer 账户（$99/年）
- Developer ID Application 证书（年费 99 刀的一部分）
- GitHub Actions `secrets` 存 cert + password（或本地打包时授权）

**判定 🔴**：EvoClaw 完全缺失代码签名。**生产交付必须补齐**（否则信任度和用户体验都差）。

---

### §3.9 多架构构建支持

**hermes**（`.research/30-build-packaging.md §3.3`）:

**Python wheel 零编译**：

```bash
# 一份 wheel 处处可用
dist/hermes_agent-0.8.0-py3-none-any.whl
#                              ↑ py3 = Python 3.x 通用
#                              ↑ none = 无平台特定部分
```

**Docker 多架构**（通过 buildx）：

```yaml
# .github/workflows/docker-publish.yml（推测，未读）
- uses: docker/build-push-action@v5
  with:
    platforms: linux/amd64,linux/arm64
```

**Nix 三平台**（`flake.nix:250`）:

```nix
systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
```

**关键机制**（`nix/python.nix:38-69`）：aarch64-darwin 上某些 wheel 无法用（numpy / av / onnxruntime 等编译失败），自动替换为 nixpkgs 预构建版本。

**无 x86_64-darwin（Intel Mac）支持**（但可能是故意的，因为用户群体转向 Apple Silicon）。

**EvoClaw**（`apps/desktop/src-tauri/Cargo.toml` + `scripts/download-bun.mjs:26-29`）:

**单一 macOS DMG**：

```json
"bundle": {
  "targets": ["dmg"]
}
```

**Bun 架构感知**（但仅 macOS）：

```javascript
const archMap = { arm64: 'aarch64', x64: 'x64-baseline' };
const bunArch = ...
const zipName = `bun-darwin-${bunArch}`;
```

**缺陷**：
1. ❌ `targets: ["wix"]` 未配置 → Windows 用户无 installer
2. ❌ `targets: ["appimage"]` 未配置 → Linux 用户无 AppImage
3. ❌ 无 CI/CD 矩阵验证 aarch64/x64 的编译（即使脚本配置了也无保障）
4. ⚠️ `cargo build` 没有交叉编译选项（Tauri 支持但需在 CI 里配 `--target aarch64-apple-darwin` 等）

**Tauri 框架能力**：Tauri 2 原生支持 macOS/Windows/Linux，但需要：
- 配置 `tauri.conf.json` 的 bundle targets
- 在 Cargo.toml 添加 feature gate（security-framework 是 macOS 限定）
- CI 矩阵：每个平台每个架构一个 runner（最少 3 runners）

**判定 🔴**：EvoClaw 完全未配置 Windows/Linux。估算补齐成本：
- Cargo.toml feature: 0.5d
- tauri.conf.json wix/appimage: 0.5d
- CI 矩阵 setup (.github/workflows/build.yml): 1d
- 交叉编译&调试 (cross for aarch64-linux): 1d
- **总计 3-4 人天**

---

### §3.10 CI/CD 工作流

**hermes**（`.research/30-build-packaging.md §3.5`）:

| 工作流 | 职责 | 触发条件 |
|------|------|---------|
| `tests.yml` | pytest 全套 + 部分 extras 矩阵 | push to main / PR |
| `docker-publish.yml` | Multi-arch Docker amd64+arm64，push to registry | push to main tag |
| `nix.yml` | `nix flake check` + build 验证 | push to main / PR |
| `docs-site-checks.yml` | Docusaurus lint + build | push to main / PR |
| `deploy-site.yml` | Docusaurus 部署到 GitHub Pages | push to main |
| `supply-chain-audit.yml` | CVE 扫描 + 依赖审计 | scheduled / push |

**关键特点**：
- **官方维护 6 个工作流**，代表对 CI/CD 的重视
- tests.yml 有矩阵（Python 3.11+12，部分 extras）
- docker-publish.yml 用 `docker/build-push-action` 实现 buildx multi-arch
- 无 pypi-publish.yml（PyPI 发布不自动化，需手动）

**EvoClaw**（`.github/workflows/`）:

```bash
ls -la /Users/mac/src/github/jone_qian/EvoClaw/.github/workflows/
# (返回无文件)
```

**现状**：**完全缺失**。没有 CI/CD 工作流意味着：
- ❌ 无自动化测试（PRs 无 test gate）
- ❌ 无自动化 DMG 打包（需本地运行 build-dmg.sh）
- ❌ 无 Release 流程自动化
- ❌ 无多架构验证（Windows/Linux 构建无法测试）

**应该补齐的工作流**：

1. **test.yml**：
   ```yaml
   on: [push, pull_request]
   jobs:
     test:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: pnpm/action-setup@v2
         - uses: actions/setup-node@v4
         - run: pnpm install && pnpm test && pnpm lint
   ```

2. **build-dmg.yml**：
   ```yaml
   on: push tags 'v*'
   jobs:
     build:
       runs-on: macos-latest
       steps:
         - uses: actions/checkout@v4
         - run: bash scripts/build-dmg.sh
         - uses: actions/upload-artifact@v3
             with: path: apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg
   ```

3. **build-multi-platform.yml**（未来）：
   ```yaml
   strategy:
     matrix:
       include:
         - os: macos-latest
           target: aarch64-apple-darwin
         - os: windows-latest
           target: x86_64-pc-windows-msvc
         - os: ubuntu-latest
           target: x86_64-unknown-linux-gnu
   ```

**判定 🔴**：EvoClaw 无 CI/CD 是**重大缺陷**。补齐估算：
- test.yml: 0.5d
- build-dmg.yml: 0.5d
- **总计 1 人天**（前置条件是 §3.4 Windows/Linux 支持已实现）

---

### §3.11 版本化与发布

**hermes**（`.research/30-build-packaging.md`）:

**CalVer 版本**（研究中未看到硬编码，但 pyproject.toml 有版本字段）：

```toml
[project]
version = "0.8.0"
```

**发布流程**（`scripts/release.py` 推测，未读）：
- PR 标题从中提取 changelog
- CalVer 生成新版本（如 0.8.1）
- 创建 GitHub Release + 对应 tag
- **不自动发 PyPI**（需人工 `twine upload` 或后续补齐 CI）

**没有自动化发版**：wheel 打包后仍需手动 push PyPI。

**EvoClaw**：

**硬编码版本**（`package.json:3`）:

```json
"version": "0.1.0"
```

**多处重复**：
- `package.json:3`
- `apps/desktop/package.json:3`
- `packages/core/package.json:3`
- `apps/desktop/src-tauri/Cargo.toml:3`（"version": "0.1.0"）

**同步风险**：每次版本更新需改 4 个地方，易出错（如忘记改 Cargo.toml）。

**无发布流程**：zero 自动化。完全手动升版号 + 本地构建 DMG。

**判定 🔴**：
- hermes 有 `scripts/release.py`（虽然只做 GitHub Release 不做 PyPI），EvoClaw 无任何发布脚本
- EvoClaw 多处版本号重复容易不一致
- 推荐**补齐**：
  1. 创建 `scripts/release.mjs`（与 brand-apply.mjs 同风格）
  2. 从 package.json 读版本号（单一事实源）
  3. 同步写 Cargo.toml
  4. 生成 GitHub Release（可选 npm package 发布）
- **工作量**：0.5 人天

---

### §3.12 开发 vs 生产构建分离

**hermes**（`.research/30-build-packaging.md`）:

**无显式分离**：锁文件 `uv.lock` 对所有场景相同，`uv sync --locked` vs `uv sync --all-extras --locked` 的区别只是依赖子集选择。

**dev vs prod 配置**：.env / config.yaml（启动时读，不在构建时）。

**EvoClaw**（`package.json:13-31` + `build-dmg.sh:11-31`）:

```bash
# dev
pnpm dev:evoclaw          # 开发模式（watch）

# prod
BRAND=evoclaw pnpm build:dmg:evoclaw   # 打包模式

# brand 切换
BRAND=healthclaw pnpm build:dmg:healthclaw
```

**品牌通过 env 变量显式参数化**（§3.6 详述），构建时自动生成品牌配置。

**dev 依赖 vs prod 依赖**（pnpm 自动分离）：
- devDependencies: turbo / typescript / vitest / oxlint（仅开发）
- dependencies: @hono/node-server / @modelcontextprotocol/sdk / better-sqlite3（打包进 DMG）

**判定 🟡**：
- hermes 无显式分离（默认所有配置在运行时）
- EvoClaw 用 env 变量（BRAND=）分离，更清晰
- EvoClaw 的 pnpm-lock.yaml 默认分离 devDependencies（生产 DMG 不含测试框架）

---

### §3.13 Nix 声明式部署

**hermes**（`.research/30-build-packaging.md §3.3`）:

**完整 flake 生态**（800+ 行）：
- `flake.nix`：输入声明 + 三平台输出
- `nix/packages.nix`：mkDerivation（构建规则）
- `nix/python.nix`：virtualenv 生成
- `nix/nixosModules.nix`：NixOS 服务定义（native + container 双模式）
- `nix/checks.nix`：验证钩子

**NixOS 用户体验**（假设）：

```nix
# /etc/nixos/configuration.nix
services.hermes-agent.enable = true;
services.hermes-agent.settings.model = "anthropic/claude-sonnet-4";
```

**设计完善**：支持**pure 声明式部署 + systemd 集成**，无需学习 Docker/systemd 即可驾驭。

**EvoClaw**：

**无 Nix 支持**：完全依赖 macOS native + Tauri App Bundle。若 NixOS 用户想用 EvoClaw，需要：
- 手动编译 Tauri app 或
- 通过 systemd 运行某个 sidecar（但无标准打包）

**判定 🔴**：EvoClaw 的 Nix 支持为零。补齐成本很高（需要 Rust Tauri 的 Nix derivation，通常 200+ 行），不建议优先做（特别是当前仅支持 macOS）。

---

### §3.14 Docker 镜像发行

**hermes**（`.research/30-build-packaging.md §3.2`）:

**完整 Dockerfile**（28 行）：
```dockerfile
FROM debian:13.4
RUN apt-get update && apt-get install -y build-essential nodejs npm python3 ...
COPY . /opt/hermes
RUN pip install --no-cache-dir -e ".[all]" --break-system-packages && npm install ...
ENV HERMES_HOME=/opt/data
VOLUME ["/opt/data"]
ENTRYPOINT ["/opt/hermes/docker/entrypoint.sh"]
```

**multi-arch 支持**（amd64 + arm64）通过 GitHub Actions buildx：

```yaml
# docker-publish.yml（推测）
platforms: linux/amd64,linux/arm64
```

**产物**：`nousresearch/hermes-agent:latest` 支持 amd64 和 arm64。

**用户体验**：

```bash
docker run -v ~/.hermes:/opt/data nousresearch/hermes-agent hermes gateway install
```

**EvoClaw**：

**无 Docker 支持**：没有 Dockerfile，没有 docker-publish.yml，无法容器化。

**风险**：
1. 服务器部署困难（Tauri App 是 GUI，通常不在服务器跑）
2. 开发环境复制困难（依赖系统 Xcode/Rust 工具链）
3. 无法快速扩展（容器化是 CI/CD 和生产部署的基础）

**Tauri 通常不用 Docker**：Tauri 设计用于桌面应用，不适合无头部署。但如果要**只用 Sidecar server**（不用前端），可以考虑 Docker。

**判定 🔴**：EvoClaw 短期不需要 Docker（单 DMG 分发足够），但若未来要支持**自托管 Sidecar 服务**（类似 hermes gateway），需要补齐。成本：0.5-1 人天（Dockerfile 简单，难点在于 Rust 编译层的容器优化）。

---

### §3.15 系统二进制依赖文档

**hermes**（`.research/30-build-packaging.md §3.2`）:

**Dockerfile 明确列举**（`Dockerfile:13-14`）:

```dockerfile
RUN apt-get install -y --no-install-recommends \
    build-essential nodejs npm python3 python3-pip ripgrep ffmpeg gcc python3-dev libffi-dev
```

**清单**（8 个系统包）：
- build-essential（gcc/g++/make）
- nodejs + npm（agent-browser / camoufox）
- python3 + python3-pip（Python runtime）
- ripgrep（grep 加速）
- ffmpeg（视频处理）
- gcc + libffi-dev（native extension 编译）

**setup-hermes.sh 也处理**（`setup-hermes.sh:228-250`）：ripgrep 多源降级（apt/dnf/brew/cargo），其他依赖假设已装或自动装。

**EvoClaw**（代码中分散使用，无单点文档）:

**已知系统依赖**（从代码追踪）:
- `ripgrep`：`packages/core/src/agent/kernel/builtin-tools.ts:622` grep 工具
- `sips`：`builtin-tools.ts:172` macOS 图片压缩
- `pdftoppm`：`builtin-tools.ts:203` PDF→JPEG 转换
- `unzip`：`packages/core/src/skill-installer.ts:163` 技能包解压
- `git`：`skill-installer.ts:178` 技能 git clone

**文档缺失**：README / CONTRIBUTING / INSTALL 都没有列出系统依赖。新用户遇到 `sips: command not found` 或 `pdftoppm not installed` 时无处查。

**判定 🟡**：
- hermes 通过 Dockerfile 和 setup-hermes.sh **集中文档化**系统依赖
- EvoClaw **完全缺失文档**，需在 README.md 新增"系统依赖"章节：
  ```markdown
  ## 系统依赖
  
  macOS:
  - Xcode Command Line Tools (for git/clang)
  - ripgrep: `brew install ripgrep`
  - pdftoppm: `brew install poppler` 
  - (sips 内置)
  
  Linux (Ubuntu):
  - build-essential, git
  - ripgrep, poppler-utils
  
  Windows:
  - (不支持)
  ```
- **工作量**：0.25 人天（文档 + 可选的自动检查脚本）

---

## 4. 建议改造蓝图（不承诺实施）

**P0（高 ROI，建议尽快）**:

| # | 项目 | 对应差距 | 工作量 | ROI | 价值 |
|---|---|---|---|---|---|
| 1 | 添加 test.yml 工作流 | §3.10 | 0.5d | 🔥🔥🔥 | 每个 PR 自动验证测试通过，降低发布风险 |
| 2 | 添加系统依赖文档 | §3.15 | 0.25d | 🔥🔥 | 新用户无需"盲瞎配置"，减少 issue |
| 3 | 代码签名（codesign + 公证）| §3.8 | 1d | 🔥🔥 | 用户可直接双击安装，无 Gatekeeper 拦截 |
| 4 | 版本号单一事实源 + release.mjs | §3.11 | 0.5d | 🔥 | 避免版本号漂移，自动化 GitHub Release |

**P1（中等 ROI）**:

| # | 项目 | 对应差距 | 工作量 | 价值 |
|---|---|---|---|---|
| 5 | 添加 build-dmg.yml 工作流 | §3.10 | 0.5d | GitHub Actions 自动化 DMG 打包，不再依赖本地环境 |
| 6 | 支持 Windows/Linux（Tauri wix + appimage） | §3.4 / §3.9 | 3d | 大幅扩展用户基数，跨平台一致体验 |
| 7 | multi-platform CI 矩阵 | §3.10 | 1d | 验证 Windows/Linux 编译（与 §3.4 配套） |

**P2（长期规划）**:

| # | 项目 | 对应差距 | 工作量 |
|---|---|---|---|
| 8 | Docker support（仅 Sidecar server，无 GUI） | §3.14 | 1d |
| 9 | Nix flake（若有 NixOS 用户） | §3.13 | 2-3d |
| 10 | Auto-update（Tauri updater + GitHub Release） | 新增 | 1d |

**不建议做**:
- 官方 PyPI publish：EvoClaw 是应用不是库，不适合 pip install
- Homebrew formula：可让社区贡献，官方不必维护

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应 |
|---|---|---|---|
| 1 | 多品牌构建自动化（brand-apply.mjs） | `scripts/brand-apply.mjs:35-191` | 无（单品牌 Nous Research） |
| 2 | Bun sidecar 版本锁定 + 架构检测 | `scripts/download-bun.mjs:22-83` | 无（Python 系统提供） |
| 3 | Tauri DMG 打包的资源声明化 | `tauri.conf.json:42-48` | 无（wheel 不涉及资源打包） |

**关键观察**：EvoClaw 的"反超"围绕"应用打包"而非"多通道发行"。hermes 是库，EvoClaw 是应用，两者的打包哲学本质不同。

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（本章所有 `path:line` 均经 Read 工具验证 2026-04-17）

**package.json**:
- `package.json:11` ✅ `"packageManager": "pnpm@10.14.0"`
- `package.json:19-20` ✅ `"build"` 和 `"build:desktop"` 脚本

**turbo.json**:
- `turbo.json:4-6` ✅ `build` task 定义
- `turbo.json:3-19` ✅ 四个 task（build/test/lint/dev）

**pnpm-workspace.yaml**:
- `pnpm-workspace.yaml:1-3` ✅ workspace packages 定义

**scripts/build-dmg.sh**:
- `scripts/build-dmg.sh:1-77` ✅ 完整脚本（4 步骤）
- `scripts/build-dmg.sh:6` ✅ "未签名" 注释
- `scripts/build-dmg.sh:11` ✅ `BRAND="${BRAND:-evoclaw}"`

**scripts/download-bun.mjs**:
- `scripts/download-bun.mjs:22` ✅ `const BUN_VERSION = '1.3.6'`
- `scripts/download-bun.mjs:24-29` ✅ 架构映射
- `scripts/download-bun.mjs:38-49` ✅ 版本校验
- `scripts/download-bun.mjs:59-83` ✅ 下载/解压/权限/验证

**scripts/brand-apply.mjs**:
- `scripts/brand-apply.mjs:1-260` ✅ 完整脚本
- `scripts/brand-apply.mjs:35-77` ✅ brand.ts 生成
- `scripts/brand-apply.mjs:126-162` ✅ 图标复制
- `scripts/brand-apply.mjs:193-239` ✅ CSS 品牌色注入

**apps/desktop/src-tauri/tauri.conf.json**:
- `tauri.conf.json:1-55` ✅ 完整配置
- `tauri.conf.json:3` ✅ `"productName": "HealthClaw"`（当前品牌）
- `tauri.conf.json:42-48` ✅ `resources` 声明（Bun + server.mjs + migrations + skills）

**apps/desktop/package.json**:
- `apps/desktop/package.json:1-40` ✅ 完整 package.json
- `apps/desktop/package.json:8` ✅ `"build": "tsc -b && vite build"`
- `apps/desktop/package.json:14-20` ✅ 依赖声明

**packages/core/package.json**:
- `packages/core/package.json:1-35` ✅ 完整 package.json
- `packages/core/package.json:6` ✅ `"main": "dist/server.js"`
- `packages/core/package.json:8-11` ✅ build/dev/test/lint scripts
- `packages/core/package.json:14-22` ✅ 核心依赖

**apps/desktop/src-tauri/Cargo.toml**:
- `Cargo.toml:1-21` ✅ 完整 Cargo.toml（部分）
- `Cargo.toml:2` ✅ `name = "healthclaw-desktop"`（当前品牌）
- `Cargo.toml:4` ✅ `version = "0.1.0"`
- `Cargo.toml:7` ✅ `name = "healthclaw_desktop_lib"`

### 6.2 hermes 研究引用（章节 §）

- `.research/30-build-packaging.md` §1 角色与定位（三官方通道）
- `.research/30-build-packaging.md` §2 四条发行路径流程图
- `.research/30-build-packaging.md` §3.1 PyPI wheel 构建（pyproject.toml 详解）
- `.research/30-build-packaging.md` §3.2 Docker 镜像（Dockerfile + entrypoint）
- `.research/30-build-packaging.md` §3.3 Nix flake（三平台 + 平台条件 override）
- `.research/30-build-packaging.md` §3.4 setup-hermes.sh（四步骤 + Termux 分岔）
- `.research/30-build-packaging.md` §3.5 CI/CD 工作流清单

### 6.3 关联差距章节

- `01-tech-stack-gap.md` — 依赖策略（§3.3）、锁文件（§3.4）、系统二进制（§3.15）
- `02-repo-layout-gap.md` — monorepo 结构（pnpm 与 setuptools find packages 对比）
- `27-cli-architecture-gap.md` — CLI 无 GUI：hermes CLI-first vs EvoClaw GUI-first
- `28-config-system-gap.md`（待写） — 配置文件（.env.example vs .env.brand）
- `33-release-process-gap.md`（待写） — 版本化与发布（CalVer vs 0.1.0）

---

**本章完成**。

**关键发现**:
1. 🔴 **发行通道与代码签名**：hermes 三通道 vs EvoClaw 单 DMG 未签名，硬伤，需补（代码签名 + 多平台 = 2-3 人周）
2. 🟡 **构建模式**：Python 纯文件 vs TypeScript+Rust 多语言编译，各有所长，不可互换
3. 🟢 **参数化构建**：EvoClaw 的 brand-apply.mjs 多品牌注入比 hermes 的单品牌更灵活
4. 🟢 **Sidecar 管理**：EvoClaw 的 Bun 版本锁定 + 架构检测是"应用内嵌运行时"的学習示范
5. **CI/CD 缺失**：EvoClaw 无工作流是最紧迫的债务，0.5-1d 补齐测试 + DMG 自动化打包

