# M9 — 发布与分发详细开发方案

> **基于**: [`CapabilityUpgradePlan_2026-04-17.md`](./CapabilityUpgradePlan_2026-04-17.md) 模块 M9
> **优先级**: P1
> **预估**: 7-9 人天（Phase 1: 4-5d，Phase 2: 3-4d）
> **前置依赖**: M0 ✅ 已完成（CI 基线 + 版本管理脚本）
> **下游解锁**: 客户 Pilot 真正可跑；所有前序模块（M1-M6）能力能到用户端；线上 fix → 推送缩到分钟级
> **参考文档**:
> - [`30-build-packaging-gap.md`](../evoclaw-vs-hermes-research/30-build-packaging-gap.md) §3.4 跨平台、§3.8 代码签名
> - [`33-release-process-gap.md`](../evoclaw-vs-hermes-research/33-release-process-gap.md) §3.6 CHANGELOG、§3.7-§3.8 Release + auto-update

## 执行状态（2026-04-20）

| 任务 | 状态 | 说明 |
|------|------|------|
| T1 CHANGELOG 自动化 | ✅ | PR #26 合并 |
| T2 多品牌构建抽象 | ✅ | PR #26 核心 + PR #28 根治入库噪声（brands/_base/ 模板 + 13 项 gitignore + postinstall）|
| **构建治理附加成果** | ✅ | brand-apply.mjs 退役 Rust crate 名改写段；Cargo.toml / main.rs 稳定化 |
| T3 Windows 打包基础 | 🔒 暂停 | 等 Windows 本地/远程环境就绪 |
| T4 GitHub Actions release.yml | 🔒 暂停 | 依赖 T3（CI matrix Windows runner 前需本地验证通过）|
| T5 Auto-update 客户端骨架 | 🔒 暂停 | 建议与 T4 同 PR 起步（密钥 + endpoint placeholder + UI banner）|
| T6 macOS 签名 + 公证 | 🔒 阻塞 | 等 Apple Developer Program 注册 + Developer ID 证书 |
| T7 阿里云 OSS + 函数计算 | 🔒 阻塞 | 等阿里云账号 + bucket / 函数计算开通 |
| T8 Windows 非 EV 签名 | 📋 延后 | 等首客户投诉 SmartScreen 再评估是否升 OV/EV 证书 |

**剩余工作量**：Phase 1 余 3-4.5d（T3/T4/T5），Phase 2 余 3-4d（T6/T7/T8）。

**恢复条件**：任一满足即可开始解锁的任务 —
- Windows 环境就绪（本地 VM 或远程 runner）→ 解锁 T3 → T4/T5
- Apple Developer 证书到手 → 解锁 T6
- 阿里云账号就绪 → 解锁 T7

---

## 1. 目标与范围

### 1.1 目标

让 EvoClaw / HealthClaw 从"本地能跑"升级到"客户能装、能升、能追踪版本"：

1. **零门槛装机**：macOS 签名 + 公证 → 双击直装不弹 Gatekeeper；Windows NSIS 装机不被普通 Defender 拦
2. **闭环升级管道**：Tauri Updater + 阿里云 OSS + 函数计算 → 支持**回滚**和**按用户 ID 哈希灰度**
3. **多品牌可扩展构建**：EvoClaw + HealthClaw 同一流水线；新增品牌只加 `brands/{new}/` 配置即可
4. **发版可持续**：Conventional Commits → CHANGELOG 自动生成；tag push 触发 GitHub Actions 全平台打包上传

### 1.2 范围

**做**（本计划覆盖）:
- CHANGELOG 自动化（解析 conventional commits → 分版本段落追加）
- 多品牌构建抽象强化（`brand.json` 扩展 signing/updater 字段，`brand-apply` 覆盖 tauri.conf.json 更多字段）
- Windows NSIS 打包（内嵌 Bun Windows 二进制 + tauri bundle）
- GitHub Actions `release.yml`（tag 触发，matrix `brand × os` 并行）
- Tauri Updater 客户端接入（`@tauri-apps/plugin-updater`）
- macOS Developer ID 签名 + notarytool 公证（Phase 2）
- Windows signtool 非 EV 签名（Phase 2）
- 阿里云 OSS + CDN + 函数计算（Phase 2，灰度 + 回滚）

**不做**（延后/独立模块）:
- Linux 构建（AppImage/deb）→ 按需启动，记为未排期 A4
- Windows EV 证书（$300-500/年，SmartScreen 零警告）→ 首个客户 SmartScreen 投诉再升
- Mac App Store 上架 → 沙盒限制与 Sidecar 模型不兼容，不做
- 应用内"下载进度"UI 细节 → 先用 Tauri Updater 默认 UI，后续 Sprint 打磨

### 1.3 平台与品牌矩阵

| 品牌 | macOS (arm64) | macOS (x86_64) | Windows (x86_64) |
|------|---------------|----------------|-------------------|
| EvoClaw | ✅ 主力 | ✅ | ✅ |
| HealthClaw | ✅ | ✅ | ✅ |
| _新品牌_ | ✅（加配置即得） | ✅ | ✅ |

---

## 2. 现状盘点

### 2.1 已有基础（可复用）

| 项 | 现状 |
|----|------|
| `brands/{evoclaw,healthclaw}/brand.json` | ✅ 已有多品牌配置 |
| `scripts/brand-apply.mjs` | ✅ 已覆写 `tauri.conf.json` productName/identifier/window title |
| `scripts/build-dmg.sh` | ✅ 本地手工打 DMG（未签名） |
| `scripts/version-bump.mjs` + `version-check.mjs` | ✅ 7 处版本号一致性 |
| `scripts/download-bun.mjs` | ✅ macOS Bun 内嵌 |
| `scripts/download-node.mjs` | ✅ Node 回退机制 |
| `.github/workflows/test.yml` | ✅ CI 测试基线 |
| `@tauri-apps/api` 2.5 | ✅ Tauri 2，原生支持 updater 插件 |

### 2.2 缺口清单

| 缺口 | 影响 |
|------|------|
| `scripts/download-bun.mjs` 仅下 macOS Bun | Windows 装机包无 sidecar 二进制 |
| `.github/workflows/release.yml` 不存在 | 无 tag 触发 release 管道 |
| `CHANGELOG.md` 不存在 | 发版无变更记录 |
| `tauri.conf.json.bundle.targets` 仅 `["dmg"]` | 无 Windows NSIS 配置 |
| `tauri.conf.json.plugins.updater` 未配置 | 客户端无自动升级能力 |
| 无 `@tauri-apps/plugin-updater` 依赖 | 无 updater 运行时 |
| `brand.json` 无 `macOS`/`windows`/`updater` 字段 | 签名身份 + updater endpoint 无品牌级配置 |
| macOS 签名身份未配置 | DMG 装机弹 Gatekeeper 警告 |
| 阿里云 OSS 项目未建 | 无 update manifest 托管 |
| 阿里云函数计算未设计 | 无灰度/回滚能力 |

---

## 3. Phase 1 — 证书无关（4-5d）

### T1 — CHANGELOG 自动化（0.5d）✅ 已完成（PR #26）

**实际产物**（合入 main）：
- `scripts/lib/changelog-helpers.mjs` + `.d.mts`（5 纯函数 + 32 tests）
- `scripts/changelog-generate.mjs` CLI（支持 `--version` / `--from` / `--to` / `--dry-run` / `--stdout`）
- `scripts/version-bump.mjs` 集成：bump 后自动调用 changelog-generate（`--no-changelog` 可跳过）
- `CHANGELOG.md` 初始化（245 commits 分组覆盖 features/bugfixes/documentation/tests/refactor/chores/other）

**目的**：`git tag v0.2.0 && git push --tags` 前，从 commit 历史自动写入 `CHANGELOG.md`。

**设计**：
- 新脚本 `scripts/changelog-generate.mjs`（Bun / Node 双兼容）：
  - 用 `git log v{prev}..HEAD --format=...` 抓 commits
  - 按 Conventional Commits 前缀分组：`feat:` → `### ✨ Features`，`fix:` → `### 🐛 Bug Fixes`，`perf:` → `### ⚡ Performance`，`docs:`/`refactor:`/`chore:` 归入 Other
  - 从 `apps/desktop/package.json` 读目标版本，追加到 `CHANGELOG.md` 顶部（倒序）
  - 过滤 `Co-Authored-By:` 和 `Merge ...` 行
- `scripts/version-bump.mjs` 扩展：bump 后自动调用 `changelog-generate`
- `pnpm version:bump patch|minor|major` 一条命令完成版本 + CHANGELOG

**产物**：
- `scripts/changelog-generate.mjs`
- `CHANGELOG.md`（新建，初始化从 v0.1.0 开始）
- `scripts/__tests__/changelog-generate.test.ts`

---

### T2 — 多品牌构建抽象强化（1d）✅ 已完成（PR #26 + #28）

**实际产物**（合入 main）：
- `scripts/lib/brand-apply-helpers.mjs` + `.d.mts`（4 纯函数 `resolveEnv/resolveDeep/hasUnset/applyRelease`，24 tests，含幂等性测试）
- `brands/{evoclaw,healthclaw}/brand.json` 扩展 `release.{macOS,windows,updater}` 字段，`${ENV_VAR}` 占位符
- `scripts/brand-apply.mjs` 集成 `applyRelease`，BrandConfig TS 接口扩展
- `docs/release/adding-new-brand.md` 5 步零脚本改动接入指南
- **附加成果（PR #28 根治）**：
  - 退役 brand-apply §3 Rust crate 名改写段（Cargo.toml + main.rs 稳定化为 `evoclaw-desktop` / `evoclaw_desktop_lib`，永不被品牌覆写）
  - `brands/_base/{tauri.conf.json,index.html,index.css}.template` 基础模板抽出
  - 13 个 brand-apply 生成产物从 git 追踪移除 + `.gitignore`
  - root `package.json` 加 `postinstall: node scripts/brand-apply.mjs`
  - `docs/release/brand-apply-generated-files.md` 故障排查文档

**目的**：Tauri signing/updater 字段支持品牌级配置；新品牌只改 `brands/{new}/brand.json` 无需动 script。

**brand.json schema 扩展**：

```json
{
  "name": "EvoClaw",
  "identifier": "com.evoclaw.app",
  // ... 既有字段
  "release": {
    "macOS": {
      "signingIdentity": "Developer ID Application: <Company Name> (TEAMID)",
      "entitlements": "entitlements.plist",
      "minimumSystemVersion": "13.0"
    },
    "windows": {
      "certificateThumbprint": null,
      "digestAlgorithm": "sha256"
    },
    "updater": {
      "endpoint": "https://updates.evoclaw.com/{{target}}/{{current_version}}/latest.json",
      "pubkey": "<TAURI_UPDATER_PUBKEY>"
    }
  }
}
```

**`brand-apply.mjs` 扩展**：
- 读 `config.release.macOS.signingIdentity` → 写入 `tauri.conf.json.bundle.macOS.signingIdentity`
- 读 `config.release.windows.certificateThumbprint` → 写入 `tauri.conf.json.bundle.windows.certificateThumbprint`
- 读 `config.release.updater.endpoint` + `pubkey` → 写入 `tauri.conf.json.plugins.updater.endpoints[0]` + `pubkey`
- 敏感字段（signingIdentity、certificateThumbprint、pubkey）允许 `${ENV_VAR}` 占位符，运行时 brand-apply 从环境变量替换（避免 brand.json 入仓库泄漏）

**CI secrets 命名规范**：
- `APPLE_SIGNING_IDENTITY_EVOCLAW` / `APPLE_SIGNING_IDENTITY_HEALTHCLAW`
- `TAURI_UPDATER_PRIVATE_KEY`（全品牌共用）
- `TAURI_UPDATER_PUBKEY`（全品牌共用）

**产物**：
- `brands/evoclaw/brand.json` + `brands/healthclaw/brand.json` 扩展
- `scripts/brand-apply.mjs` 扩展
- `docs/release/adding-new-brand.md` 新品牌接入指南

---

### T3 — Windows 打包基础（1.5-2d）🔒 暂停

**暂停原因**：子任务 4 "本地 Windows 验证" 需要 Windows 环境（本地 VM 或远程 runner）。用户侧 Windows 环境未就绪，先不开工以免在没法端到端验证的情况下盲写代码。

**恢复条件**：以下任一满足即可开工
- 准备好本地 Windows 10+ VM（Parallels / UTM / VMware，联网 + 8GB+ 内存）
- 愿意接受"只做前 3 个子任务，最后一步借 CI windows-latest runner 代验证"——但这样 T3 得和 T4（release workflow）并发推进，初期迭代慢

**目的**：`cargo tauri build --target x86_64-pc-windows-msvc` 能产出可双击运行的 `.exe` 装机包（未签名）。

**子任务**：

1. **内嵌 Bun Windows 二进制**（0.5d）
   - `scripts/download-bun.mjs` 扩展：按 `process.platform` + `process.arch` 分别下 `bun-darwin-aarch64` / `bun-darwin-x64` / `bun-windows-x64.zip`
   - 验证 `bun.exe` 在 Windows 能启动 sidecar 并监听 127.0.0.1 端口

2. **Tauri Windows bundle 配置**（0.5d）
   - `tauri.conf.json.bundle.targets` 加 `"nsis"`（先选 NSIS 不选 MSI，更轻）
   - `tauri.conf.json.bundle.windows.{certificateThumbprint,digestAlgorithm,tsp}` 占位，Phase 2 填
   - 资源路径修正：`"../../../packages/core/dist/server.mjs"` 在 Windows cargo 路径解析是否正常 — 本地 Windows runner 实测

3. **Sidecar 启动路径 Windows 适配**（0.5d）
   - `apps/desktop/src-tauri/src/sidecar.rs`（或 main.rs）：Windows 下 spawn `bun.exe` 而非 `bun`；路径分隔符统一用 `std::path::PathBuf`
   - Windows 下临时文件夹用 `%LOCALAPPDATA%\EvoClaw` 而非 `~/.evoclaw`（依据 `BRAND.dataDir` 但加 Windows 分支）

4. **本地 Windows 验证**（0.5d）
   - 借用或远程 Windows VM，执行完整 `build-release.ps1` 脚本
   - 装机、启动、打开首页、发送一条消息、关闭验证
   - 输出 `.exe` 到 `target/release/bundle/nsis/`，文件名 `EvoClaw_{version}_x64-setup.exe`

**产物**：
- `scripts/download-bun.mjs` 跨平台扩展
- `scripts/build-release.ps1`（Windows 本地打包，对标 `build-dmg.sh`）
- `tauri.conf.json.bundle.targets` + Windows 配置块
- `apps/desktop/src-tauri/src/` 相关 Windows 适配

---

### T4 — GitHub Actions Release Workflow（1-1.5d）🔒 暂停

**暂停原因**：依赖 T3 产出的 NSIS 配置 + Windows 适配已本地验证过。未验证直接搭 CI matrix 会把 CI 当"试错环境"浪费 minutes。

**目的**：`git tag v0.2.0 && git push --tags` → CI 自动打所有品牌 + 所有平台 → 上传 GitHub Release assets。

**`.github/workflows/release.yml` 设计**：

```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        brand: [evoclaw, healthclaw]
        include:
          - os: macos-latest
            target: aarch64-apple-darwin
            artifact-ext: dmg
          - os: macos-latest
            target: x86_64-apple-darwin
            artifact-ext: dmg
          - os: windows-latest
            target: x86_64-pc-windows-msvc
            artifact-ext: exe
    runs-on: ${{ matrix.os }}
    env:
      BRAND: ${{ matrix.brand }}
    steps:
      - checkout
      - setup node 22, pnpm 10, bun 1.3.6, rust stable
      - cache: cargo registry + target dir
      - pnpm install --frozen-lockfile
      - bun scripts/brand-apply.mjs
      - bun scripts/download-bun.mjs --target ${{ matrix.target }}
      - pnpm build
      - pnpm --filter @evoclaw/desktop tauri build --target ${{ matrix.target }}
      - upload artifact named "${BRAND}-${VERSION}-${{ matrix.target }}.${{ matrix.artifact-ext }}"

  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - download all artifacts
      - extract release notes from CHANGELOG.md
      - gh release create ${{ github.ref_name }} --notes-file release-notes.md --draft
      - upload all artifacts to release
```

**产物命名规范**：
- macOS: `EvoClaw-0.2.0-aarch64-apple-darwin.dmg` / `HealthClaw-0.2.0-x86_64-apple-darwin.dmg`
- Windows: `EvoClaw-0.2.0-x86_64-pc-windows-msvc.exe`

**Draft 机制**：默认创建 draft release，手工 review 后 publish，防止误发。

**产物**：
- `.github/workflows/release.yml`
- `scripts/extract-release-notes.mjs`（从 CHANGELOG.md 抽取 tag 对应段落）
- `docs/release/release-playbook.md`（发版 SOP）

---

### T5 — Auto-update 客户端骨架（0.5-1d）🔒 暂停

**暂停原因**：建议与 T4 release workflow 同 PR 起步（密钥对 + endpoint placeholder + UI banner 能端到端验证从 release artifact 到客户端检测的完整链路）。单独先做客户端骨架无法 smoke-test。

**目的**：装上 `@tauri-apps/plugin-updater`，客户端能拉 endpoint 检测新版、显示 toast（先不真实下载安装，等 Phase 2 证书齐开启）。

**子任务**：

1. 安装 + 配置（0.25d）
   - `apps/desktop` 加 dep `@tauri-apps/plugin-updater@^2`
   - `src-tauri/Cargo.toml` 加 `tauri-plugin-updater`
   - `src-tauri/src/main.rs` `.plugin(tauri_plugin_updater::Builder::new().build())`
   - `tauri.conf.json.plugins.updater` 配置 endpoints + pubkey（从 brand-apply 注入）
   - `tauri.conf.json.bundle.createUpdaterArtifacts` = `true`

2. 生成 Tauri Updater 密钥对（0.1d）
   - `cargo tauri signer generate -w ~/.tauri/evoclaw-signing.key`
   - 私钥放本地 `~/.tauri/`（gitignore），公钥填入 `brands/*/brand.json.release.updater.pubkey`
   - 密钥备份到 1Password / 安全位置，遗失 = 全用户无法升级

3. 启动检查 + UI（0.3-0.5d）
   - 新组件 `apps/desktop/src/components/UpdateChecker.tsx`
   - `useEffect` 启动 30s 后调用 `@tauri-apps/plugin-updater` 的 `check()`
   - 有新版 → 顶部 banner 提示"有新版 v{new} 可用"+"查看详情"按钮
   - **暂不触发下载/安装**（等 Phase 2 证书齐了再开）
   - 设置页加 "检查更新" 手动触发按钮

4. 未签名兼容（0.15d）
   - Tauri Updater 要求 bundle 有签名才能 `.downloadAndInstall()`
   - Phase 1 未签名状态下仅用 `check()` + 跳转下载页面（GitHub Release URL）
   - Phase 2 证书齐后切换为 `.downloadAndInstall()`

**产物**：
- `apps/desktop/package.json` + `src-tauri/Cargo.toml` 依赖
- `apps/desktop/src/components/UpdateChecker.tsx`
- `apps/desktop/src-tauri/src/main.rs` 插件注册
- `~/.tauri/evoclaw-signing.key` 生成（本地，gitignore）

---

## 4. Phase 2 — 证书就绪后（3-4d）

> **触发时机**：Apple Developer Program 注册完成 + Developer ID 证书生成；阿里云账号就绪 + OSS bucket 建好 + 函数计算开通。

### T6 — macOS 签名 + 公证（1d）🔒 阻塞（等 Apple 证书）

**步骤**：
1. Apple Developer Program 注册（$99/年，个人 1-2d 审核 / 企业更久）— 用户侧预备
2. Apple Developer 控制台创建 Developer ID Application 证书（双品牌共用 Team ID，证书通用）
3. 证书导出为 `.p12` → Base64 → GitHub Secret `APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD`
4. App-Specific Password (notarytool 用) → GitHub Secret `APPLE_ID` + `APPLE_PASSWORD` + `APPLE_TEAM_ID`
5. `release.yml` macOS step 增加：
   - `security create-keychain` + `security import` 导入证书
   - `pnpm tauri build` 自动读 `tauri.conf.json.bundle.macOS.signingIdentity` 触发签名
   - `xcrun notarytool submit ... --wait` 公证
   - `xcrun stapler staple` 钉装
6. 本地 Mac 验证：DMG 双击 → 无 Gatekeeper 警告 → 首次打开不弹 "from unidentified developer"

**entitlements.plist**：
- 默认最小权限集，预留 `com.apple.security.network.client` + `com.apple.security.files.user-selected.read-write`
- 不开 hardened runtime 例外（除非运行时发现需要）

---

### T7 — 阿里云 OSS + 函数计算 Update 托管（1.5-2d）🔒 阻塞（等阿里云账号）

**架构**：

```
┌──────────────────┐   HTTPS   ┌─────────────────────────┐
│  Tauri Client    │──────────▶│ 阿里云函数计算          │
│ (with pubkey)    │           │  update-manifest-api    │
└──────────────────┘           │  - 读 OSS manifest      │
                                │  - 按 ?user_id= hash    │
                                │    分灰度组            │
                                │  - 返回 latest.json    │
                                └──────┬──────────────────┘
                                       │ 读
                                       ▼
                                ┌─────────────────────┐
                                │ 阿里云 OSS + CDN    │
                                │  /{brand}/          │
                                │    /{target}/       │
                                │      v0.2.0.dmg     │
                                │      v0.2.0.sig     │
                                │    /manifest-a.json │ 主版本
                                │    /manifest-b.json │ 灰度版本
                                └─────────────────────┘
```

**子任务**：

1. **阿里云 OSS bucket 建设**（0.3d）
   - Bucket 名 `evoclaw-updates`（region 上海/杭州）
   - 目录结构 `/{brand}/{target}/{version}/{binary,signature}`
   - 接 CDN（阿里云 CDN / Cloudflare）加速下载
   - 开启 HTTPS 证书（阿里云免费 SSL 或自有证书）
   - 设 CORS：只允许 `app://` / `tauri://` 来源拉 manifest

2. **上传脚本**（0.3d）
   - `scripts/upload-release.mjs` 用 `ali-oss` SDK
   - 输入：版本号 + 品牌列表 + artifact 目录
   - 动作：上传 `.dmg` / `.exe` / `.sig` 到 OSS，生成主 manifest JSON 并上传
   - 支持 `--dry-run` 预览路径

3. **阿里云函数计算 manifest API**（0.6-1d）
   - Runtime: Node.js 20 或 Python 3.11
   - Endpoint: `https://updates.evoclaw.com/{brand}/{target}/latest.json`
   - 逻辑：
     - 请求带 query `?user_id=xxx`（客户端在 `UpdateChecker.tsx` 里加）
     - 读取 OSS 下该 brand/target 的"灰度配置"（例如 `/config/rollout-evoclaw.json`：`{ version: "0.2.0", percentage: 10, user_id_hash_prefix: ["0","1"] }`）
     - 按 user_id MD5 首字母匹配 rollout config → 返回 `manifest-b.json` 或 `manifest-a.json`
   - **回滚**：改 `/config/rollout-{brand}.json` 中的 version 字段 + 重跑 manifest 生成即回滚
   - **灰度**：改 percentage 字段或 user_id_hash_prefix 列表

4. **回滚 / 灰度 CLI**（0.3d）
   - `scripts/rollout-control.mjs`：
     - `rollout-control.mjs promote --brand evoclaw --version 0.2.0` → 设 percentage=100
     - `rollout-control.mjs rollback --brand evoclaw` → 从 history 里取上一稳定版
     - `rollout-control.mjs percentage --brand evoclaw --version 0.2.0 --pct 20` → 改灰度百分比
   - 脚本更新 OSS 上的 rollout config 即生效（函数计算下次请求读新值）

**产物**：
- 阿里云 OSS + CDN 配置文档
- `scripts/upload-release.mjs`
- `scripts/rollout-control.mjs`
- `serverless/update-manifest-api/` （函数计算代码）
- `docs/release/rollout-operations.md`（发布/灰度/回滚 SOP）

---

### T8 — Windows 非 EV 签名（0.5-1d，可再延后）📋 按需启动

**方案**：
- 用 OV（Organization Validation）代码签名证书或个人 Code Signing 证书（成本 $100-300/年）
- `signtool sign /a /fd sha256 /tr http://timestamp.sectigo.com /td sha256 /v EvoClaw-setup.exe`
- CI 步骤：`import-pfx` → `tauri build` 自动读 `certificateThumbprint` 触发 signtool

**妥协**：
- 非 EV 仍会触发 SmartScreen "Unknown publisher" 警告（但比无签名好）
- EV 证书能消除 SmartScreen 警告但贵 $300-500/年 → 延后到首客户投诉再升

**可延后理由**：Phase 1 + Phase 2 T6 T7 完成后，macOS 闭环 + Windows 能跑就能对接 Mac 主力客户；Windows 用户量起来再做签名不晚。

**产物**（做的话）：
- CI secrets `WINDOWS_CERT_PFX_BASE64` + `WINDOWS_CERT_PASSWORD`
- `tauri.conf.json.bundle.windows.certificateThumbprint` 填充
- `docs/release/windows-signing.md`

---

## 5. Sprint / PR 切分建议

按证书就绪节奏拆成 4-5 个独立 PR：

| PR | 范围 | 预估 | 前置 |
|----|------|------|------|
| **PR 1** | T1 CHANGELOG 自动化 + T2 多品牌构建抽象强化 | 1.5d | - |
| **PR 2** | T3 Windows 打包基础（含 Bun Windows 下载 + NSIS 配置 + Windows 本地验证） | 1.5-2d | PR 1 |
| **PR 3** | T4 GitHub Actions release.yml + T5 Auto-update 客户端骨架 | 1.5-2.5d | PR 1, PR 2 |
| **PR 4** | T6 macOS 签名 + 公证（证书就绪后） | 1d | Apple 证书 |
| **PR 5** | T7 阿里云 OSS + 函数计算 + T8 Windows 签名（可选） | 2-3d | 阿里云账号 |

每个 PR 独立发布小版本，`v0.2.0-alpha.{n}` 标签，不阻塞后续模块。

---

## 6. 验收标准

### Phase 1 完成标准
- [ ] `pnpm version:bump minor` → `CHANGELOG.md` 自动生成新版本段落
- [ ] `BRAND=healthclaw bun scripts/brand-apply.mjs` → `tauri.conf.json` 的 `productName/identifier/updater.endpoint/signing.identity` 都被正确覆盖
- [ ] 新增 `brands/testbrand/brand.json` → `BRAND=testbrand pnpm build:desktop` 产出正确命名 `.dmg`，零代码改动
- [ ] `pnpm --filter @evoclaw/desktop tauri build --target x86_64-pc-windows-msvc` 本地 Windows 成功产出 `.exe`，双击能装，装后能启动、发消息
- [ ] `git tag v0.2.0-alpha.1 && git push --tags` → GitHub Actions release.yml 跑完，Release 页面能看到 4 个 artifact（EvoClaw+HealthClaw × macOS+Windows）
- [ ] 客户端启动 30s 后，console 能看到 `updater.check()` 请求发出（即使 endpoint 返回 404）

### Phase 2 完成标准
- [ ] macOS DMG 双击装机零 Gatekeeper 警告
- [ ] `spctl -a -v /Applications/EvoClaw.app` 输出 `accepted, source=Notarized Developer ID`
- [ ] 阿里云 OSS bucket 能看到 `/evoclaw/aarch64-apple-darwin/0.2.0/EvoClaw-0.2.0.dmg` 等 artifact
- [ ] `curl "https://updates.evoclaw.com/evoclaw/aarch64-apple-darwin/latest.json?user_id=abc"` 返回合法 manifest
- [ ] 手工修改 rollout config 把 EvoClaw 0.2.0 的 percentage 设为 20% → 10 个不同 user_id 请求约 2 个拿到 0.2.0
- [ ] 客户端 v0.1.0 启动 → 30s 内 `check()` 返回 0.2.0 → 用户点"立即更新" → 下载验签 → 重启成 0.2.0
- [ ] `scripts/rollout-control.mjs rollback --brand evoclaw` → OSS rollout config 更新 → 下次客户端 check 拿到旧版本号

---

## 7. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Bun Windows 二进制兼容性问题（sidecar 在 Windows 启动异常） | 中 | 阻塞 T3 | Fallback 到 Node.js（`scripts/download-node.mjs` 已有），T3 预留 0.5d buffer |
| Tauri Updater 密钥遗失 | 低 | 灾难（所有客户端无法自动升级） | 密钥双备份（本地 1Password + 物理加密 U 盘），公钥入仓库 brand.json |
| 阿里云函数计算冷启动延迟 | 中 | Updater check 超时 | 函数保持最低 1 实例常驻 / 预留实例 / 简化函数到纯 OSS 读取逻辑 |
| macOS 公证被拒（entitlements 不匹配） | 中 | PR 4 卡住 | 先用最小权限集提交一次公证试水；失败看 notarytool log 按需加 entitlements |
| Windows Defender 拦截未签名 `.exe` | 高 | Phase 1 客户测试阻塞 | 接受 Phase 1 "测试版需放行" 说明；Phase 2 T8 解决（OV 签名） |
| CI 构建超时（tauri build 慢） | 中 | release.yml 失败 | 开 cargo cache + sccache；matrix 并行降低总墙钟；必要时拆 workflow |
| 双品牌 CI 矩阵同名产物覆盖 | 中 | 上传 artifact 冲突 | 产物强制命名规范 `{brand}-{version}-{target}.{ext}`，CI 校验 |
| 阿里云 OSS/函数计算账单意外膨胀 | 低 | 成本 | 初期设消费预算告警（10 元/月先行），CDN 按量付费可控 |

---

## 8. 前端影响评估（强制）

**前端影响**: ✅ 需要

- `UpdateChecker.tsx` 新组件（顶部 banner + 设置页按钮）
- 设置页 "关于" Tab 显示当前版本号 + "检查更新"手动触发
- 首次升级失败 toast 提示（校验签名失败 / 网络错误）
- Phase 2 升级成功后 toast 提示"已升级到 v{new}"

**前端接入点**：
- `apps/desktop/src/components/UpdateChecker.tsx`（新）
- `apps/desktop/src/pages/SettingsPage.tsx`（扩展 About Tab）
- `apps/desktop/src/stores/`（可选：加 `useUpdateStore` 管理 updater 状态）

---

## 9. 能力提升评估（强制）

| 子任务 | Before | After | 机制 |
|--------|--------|-------|------|
| T1 CHANGELOG | 发版要人工汇总 30-50 条 commit，5-10 分钟 | `pnpm version:bump minor` 一条命令生成，10 秒 | Bun 脚本解析 conventional commits 分组追加 |
| T2 多品牌抽象 | 新品牌要改 4-5 处脚本 + 手动填 tauri.conf.json 字段 | 只加 `brands/{new}/brand.json` + 图标 | brand-apply 扩展覆盖字段 + 环境变量占位符 |
| T3 Windows 打包 | Windows 用户只能看文档自己编译（几乎零采纳） | 双击 `.exe` 装完即用 | Bun Windows 二进制 + NSIS installer |
| T4 Release Workflow | 发版手工跑 `build-dmg.sh` → 手动上传到某处，10-20 分钟 + 易漏 | `git push --tags` → CI 自动全平台全品牌 4 artifact 上传 Release，3-5 分钟 | Actions matrix + `gh release create` |
| T5 Auto-update 客户端 | 用户永远停在初始安装版本 | 客户端启动 30s 自动检查，有新版立即提示 | Tauri Updater plugin + staging endpoint |
| T6 macOS 签名 | 双击 DMG 弹"未识别开发者"，非技术用户流失 80%+ | 双击即装，0 警告 | Developer ID + notarytool |
| T7 阿里云灰度/回滚 | 新版有 bug 只能紧急发下一版 | 灰度发给 5% 用户，有问题 1 分钟回滚 | 函数计算按 user_id hash 路由 + rollout config |
| T8 Windows 签名 | SmartScreen 弹 "Unknown publisher" 警告 | 警告从红色变灰色/消失（OV/EV 分级） | signtool + 代码签名证书 |

---

## 10. 参考文档索引

- Tauri Updater Plugin: https://v2.tauri.app/plugin/updater/
- Apple Developer Code Signing: https://developer.apple.com/support/code-signing/
- notarytool CLI: `man notarytool` / Apple Developer docs
- 阿里云 OSS Node SDK: https://help.aliyun.com/document_detail/111889.html
- 阿里云函数计算 Node Runtime: https://help.aliyun.com/zh/fc/
- Conventional Commits: https://www.conventionalcommits.org/
