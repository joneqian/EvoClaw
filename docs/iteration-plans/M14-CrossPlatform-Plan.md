# EvoClaw 跨平台支持方案（Windows 优先，Linux 后插）

## Context

**问题**：EvoClaw 当前只支持 macOS（DMG），但企业员工市场主流仍是 Windows。需要打通 Windows + Linux 跨平台支持，让一份代码在三 OS 都能装能用。

**研究依据**：
- 调研 `/Users/mac/src/github/hermes-desktop`（Electron + 明文 JSON 凭证 + electron-builder 三 OS release）
- 扫描 EvoClaw 当前 18 个 mac-only 痛点（凭证 + Tauri bundle + sidecar binary + 品牌 ico + CI matrix）

**用户决策**（2026-05-12）：
- **D1 凭证存储**：**三 OS 全明文 JSON**，完全抄 Hermes（理由：没证书 + 尽快落地 + 跨平台代码完全统一不要 cfg 分支）
- **D2 节奏**：Windows 优先（企业市场主流），Linux 后插
- **D3 签名**：本期未签名发行，签名 / 公证另立 PR（等证书）
- **D4 macOS 不保 Keychain**：macOS 也退化到 JSON 文件，与 Win/Linux 一致 — 抄 Hermes 100%

**Migration 原则**：现有 macOS 用户启动时自动从 Keychain 读旧凭证 → 写入新 JSON 文件 → 删除 Keychain 条目。用户无感知，凭证不丢。

---

## 一、范围对照（Hermes vs EvoClaw）

| 维度 | Hermes-desktop | EvoClaw 现状 | 本方案 |
|---|---|---|---|
| 桌面框架 | Electron | Tauri 2.0 | 保留 Tauri（更轻、更安全） |
| 凭证存储 | 明文 JSON（三 OS 统一）| macOS Keychain | **三 OS 全明文 JSON**（完全抄 Hermes），macOS migration 旧 Keychain |
| sidecar 分发 | 不内置，首启跑 install.sh | 内置 bun + node binary | 保持内置，扩展 Windows 下载 |
| 应用打包 | electron-builder dmg/exe/AppImage/deb/rpm | Tauri DMG | 加 NSIS（Win）+ AppImage/deb（Linux） |
| 签名 | macOS ad-hoc，Win 无，Linux 无 | macOS Apple Developer 计划中 | 本期全 OS 未签名 |
| CI matrix | macos+windows+ubuntu | 仅 ubuntu-latest（test/lint） | 加 win/mac runner + release workflow |

---

## 二、痛点清单 → 实施映射

调研发现的 18 个 mac-only 点，按 PR 分组：

### 凭证模块（PR-A1）
- `apps/desktop/src-tauri/Cargo.toml:18` — **完全移除** `security-framework = "3.2"`（三 OS 都不需要）
- `apps/desktop/src-tauri/src/credential.rs` 全文 — **完全重写**为单一 fs JSON 实现（三 OS 一致）
- 新增一次性 migration：启动时检测 macOS Keychain 旧条目 → 读出来 → 写入 JSON 文件 → 删除 Keychain 条目（migration 完成后该代码块可移除，但 1-2 个版本内保留兼容）

### Sidecar binary 跨平台（PR-A2 + A3）
- `scripts/download-bun.mjs:31` — `bun-darwin-${arch}` 加 platform 检测分支（windows-x64/linux-x64/linux-aarch64）
- `scripts/download-node.mjs:26-29` — `const platform = 'darwin'` 同上
- `apps/desktop/src-tauri/src/sidecar.rs:268,273` — `bun-bin/bun` 加 Windows `.exe` 后缀
- `apps/desktop/src-tauri/src/sidecar.rs:294-309` — bun 系统路径查找仅 Unix 风格，加 Windows 分支（%USERPROFILE%\.bun\bin\bun.exe）

### Tauri bundle（PR-A4）
- `apps/desktop/src-tauri/tauri.conf.json:30-31` — `targets: ["dmg"]` 改成 `["dmg", "nsis"]`（Phase 1）→ 后续加 `"appimage", "deb"`
- `apps/desktop/src-tauri/tauri.conf.json` — 加 `windows` bundle 配置块（nsis installer mode、digestAlgorithm）
- `scripts/generate-brand-icons.mjs:94-98` — `.ico` 仅是 32x32 副本，需生成多尺寸 ICO（16/32/48/64/128/256 合并）

### 构建脚本（PR-A5）
- `scripts/build-dmg.sh` — 拆为 `scripts/lib/build-bundle.mjs` 统一入口，按 process.platform 派生命令
- `package.json` scripts — 加 `build:exe`、`build:exe:healthclaw`（Phase 1）

### CI（PR-A6）
- `.github/workflows/test.yml:19` — 单 ubuntu-latest 改 matrix `[ubuntu-latest, macos-latest, windows-latest]`
- 新增 `.github/workflows/release.yml` — 三 OS 并行打包（Phase 1 含 mac+win，Phase 2 加 linux）

### 文档（PR-A7）
- 新增 `docs/install/INSTALL_WINDOWS.md`（含 SmartScreen 警告 + 数据目录 %APPDATA%\.healthclaw 说明 + Bun 跑不起来排错）
- 更新 CLAUDE.md "安全宪法"段落：明确 macOS 走 Keychain / Win+Linux 走文件加密 + 引用 hermes 取舍来源
- 新增 `docs/architecture/cross-platform-credential.md`：三 OS 凭证策略

---

## 三、PR 拆分（Phase 1：Windows 优先，~2-3w）

### PR-A1 — Rust 凭证模块改文件实现 + macOS migration（2d）
**分支**：`feat/credential-unified-file-storage`

**改动**：
- `Cargo.toml`：
  - **完全移除** `security-framework = "3.2"`
  - 移除 cfg 条件依赖（不再需要）
  - 短期保留 `security-framework` 仅在 migration 模块用，2 版本后彻底删
- `src/credential.rs` 完全重写为单一文件实现（不分 cfg 分支）：
  ```rust
  // 文件路径：{home}/.{brand}/credentials.json
  // 格式：{ "service.account": "value", ... }
  // 权限：
  //   - Unix（macOS + Linux）：std::os::unix::fs::PermissionsExt::set_mode(0o600)
  //   - Windows：std::os::windows::fs ACL（仅当前用户 RWX）
  
  pub fn credential_set(service, account, value) { /* read+merge+write 0600 */ }
  pub fn credential_get(service, account) { /* read+lookup */ }
  pub fn credential_delete(service, account) { /* read+remove+write */ }
  ```
- 新增 `src/credential_migration.rs`（一次性迁移）：
  ```rust
  #[cfg(target_os = "macos")]
  pub fn migrate_from_keychain_if_needed() {
      // 1. 检查 credentials.json 是否存在 + 是否已 migrate（marker file）
      // 2. 遍历已知 service 前缀（com.evoclaw.app.*, com.healthclaw.app.*）
      // 3. 用 security_framework 读 Keychain → 写入新 JSON
      // 4. 删除 Keychain 条目
      // 5. 写 marker file（.credentials-migrated）
  }
  ```
- `lib.rs` setup 阶段调用 migration（macOS 独有，Win/Linux noop）
- 新增单测 `#[cfg(test)]`：set → get → delete + 文件权限验证
- macOS migration 集成测试：种 Keychain 条目 → 跑 migration → 验 JSON 文件有 + Keychain 没了

**Verification**：
- macOS：`cargo test` 走文件分支 + migration 模块测试
- 干净 Mac 上跑旧版 EvoClaw 存 5 个凭证 → 升级到新版 → 验证 5 个凭证仍可读 + Keychain Access.app 看不到这些条目
- Windows：`cargo build --target x86_64-pc-windows-msvc` 编译通过（migration 模块被 cfg 屏蔽）
- 文件权限：`ls -l ~/.healthclaw/credentials.json` → `-rw-------`

---

### PR-A2 — sidecar binary 下载跨平台（1.5d）
**分支**：`feat/sidecar-bin-cross-platform`

**改动**：
- `scripts/download-bun.mjs`：
  - 加 `getPlatform()` 函数：detect process.platform → 'darwin'/'win32'/'linux'
  - URL 模板：`bun-${platformBunName}-${arch}.zip`（darwin / windows / linux）
  - Windows binary 名 `bun.exe`，其他 `bun`
  - 解压：Windows 用 `tar -xf`（PowerShell 自带）或 `Expand-Archive`，Unix 用 `unzip`
  - 跳过逻辑用 `--version` 检查不变
- `scripts/download-node.mjs`：
  - Windows 是 `.zip` 不是 `.tar.gz`（Node 官方 dist 命名差异）
  - Windows 输出 `node.exe`
  - linux/darwin 保持 tar.gz
- 抽 `scripts/lib/platform.mjs` 共享 platform/arch/extension 检测

**Verification**：
- `node scripts/download-bun.mjs` 在 mac 上跑（产 bun，验证向后兼容）
- 在 Windows 机器手动跑（产 bun.exe）
- 检查 zip / tar.gz 解压都不留 _tmp 目录

---

### PR-A3 — Tauri Rust 端 Windows binary 路径解析（1d）
**分支**：`feat/sidecar-rs-windows-path`

**改动** `apps/desktop/src-tauri/src/sidecar.rs`：
- 函数 `find_bundled_bun`：
  ```rust
  let bun_name = if cfg!(target_os = "windows") { "bun.exe" } else { "bun" };
  // candidates 用 bun_name 拼路径
  ```
- 函数 `find_bun_binary`（系统 bun 查找）：
  ```rust
  #[cfg(target_os = "windows")]
  let candidates = [
      format!("{}/.bun/bin/bun.exe", home),
      "C:\\Program Files\\Bun\\bun.exe".to_string(),
  ];
  #[cfg(not(target_os = "windows"))]
  let candidates = [/* 现有 */];
  ```
- shell 查找代码（`/bin/zsh`、`/bin/bash`）加 cfg 屏蔽 Windows（Windows 不走 shell fallback）
- Node binary 同步处理（`node` → `node.exe`）

**Verification**：
- macOS：`pnpm build` + 启动，sidecar 正常 spawn
- Windows：`pnpm build:exe` + 启动，sidecar 正常 spawn（看 stderr 是否打印 "使用内嵌 bun: ...bun.exe"）

---

### PR-A4 — Tauri bundle 加 NSIS + 真 .ico（1.5d）
**分支**：`feat/tauri-windows-bundle`

**改动**：
- `tauri.conf.json`：
  ```jsonc
  "bundle": {
    "targets": ["dmg", "nsis"],
    "windows": {
      "wix": { "language": ["zh-CN", "en-US"] },
      "nsis": {
        "installMode": "perUser",
        "languages": ["SimpChinese", "English"],
        "displayLanguageSelector": false
      }
    },
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.png",
      "icons/icon.ico"   // 新增
    ]
  }
  ```
- `scripts/generate-brand-icons.mjs`：
  - 用 `png-to-ico` npm 包（已是 sharp/resvg 调用风格）生成 multi-resolution ICO（16/32/48/64/128/256）
  - 替换 line 94-98 的 `copyFileSync(32x32.png, icon.ico)`
- `package.json` 新增：
  - `"build:exe": "BRAND=evoclaw pnpm --filter @evoclaw/desktop tauri build --bundles nsis"`
  - `"build:exe:healthclaw": "BRAND=healthclaw ..."`
- `brand-apply.mjs`：处理 brand 切换时复制对应 ico

**Verification**：
- macOS `pnpm build` 产 DMG（不退化）
- Windows `pnpm build:exe` 产 `.exe` NSIS 安装包
- 在干净 Windows 机装一次（验证图标显示 + 中文界面 + 数据目录创建）

---

### PR-A5 — CI matrix + release workflow（1d）
**分支**：`feat/ci-cross-platform-matrix`

**改动**：
- `.github/workflows/test.yml`：
  - `runs-on: ubuntu-latest` → `runs-on: ${{ matrix.os }}`
  - 加 `strategy.matrix.os: [ubuntu-latest, macos-latest, windows-latest]`
  - 步骤 `download-bun/node` 在 matrix 跑（验证下载脚本三 OS 都过）
  - Windows runner 跳过 shell-script-only 步骤（用 `if: runner.os != 'Windows'` 条件）
- 新增 `.github/workflows/release.yml`：
  ```yaml
  jobs:
    release-mac:
      runs-on: macos-latest
      steps: [..., pnpm build:dmg]
    release-windows:
      runs-on: windows-latest
      steps: [..., pnpm build:exe]
    # release-linux 在 Phase 2 加
  ```
- artifact upload + GitHub Release 草稿（手动 publish）

**Verification**：
- PR 跑通 `test.yml`（三 OS 都绿）
- 手动 trigger release workflow，看 Win artifact 是否能下载

---

### PR-A6 — 数据目录跨平台 + 配置路径修正（0.5d）
**分支**：`feat/data-dir-cross-platform`

**改动**：
- 扫 `packages/core` 所有 `os.homedir() + DEFAULT_DATA_DIR` 用法（Windows 上 homedir 是 `C:\Users\xxx`，拼 `.healthclaw` 是合法 hidden dir 但不符合 Windows 习惯）
- 决策：保持现状 `~/.healthclaw`（跨 OS 统一，员工易迁移）— 抄 Hermes（`HERMES_HOME = process.env.HERMES_HOME || ~/.hermes`）
- 加环境变量覆盖：`{BRAND}_HOME` 让 IT 部门可自定义（C:\ProgramData\HealthClaw 等企业部署场景）
- 修任何 path.posix / Unix 分隔符硬编码（grep `\.healthclaw/'` 之类）

**Verification**：
- `grep -rn "homedir()" packages/core/src/` 全部走 path.join 而非字符串拼接
- Windows 启动后查看 `C:\Users\xxx\.healthclaw\` 创建正常

---

### PR-A7 — 文档（0.5d）
**分支**：`docs/cross-platform-windows`

**改动**：
- 新增 `docs/install/INSTALL_WINDOWS.md`：
  - 下载 `.exe` 后双击安装
  - SmartScreen 警告："更多信息" → "仍要运行"
  - 数据目录 `C:\Users\<你>\.healthclaw\`
  - 排错：bun 跑不起来 / 凭证文件位置 / 卸载残留清理
- 新增 `docs/architecture/cross-platform-credential.md`：
  - 三 OS 凭证存储策略表（全文件实现，无 OS 分支）
  - macOS Keychain → JSON 文件 migration 说明
  - 文件权限保护机制（0600 / Windows ACL）
  - 引用 Hermes 决策来源（同样三 OS 全明文）
  - 用户警告：`~/.{brand}/credentials.json` 不要加入云盘同步
- 更新 `CLAUDE.md`：
  - 技术栈表"安全"行改成"凭证文件 (0600/ACL) + AES-256-GCM (ring)，跨 OS 统一"（删除 macOS Keychain 表述）
  - 当前冲刺加"M14 跨平台 Phase 1 (Windows)"
- 更新 `README.md`：装机说明加 Windows 一节

---

## 四、Phase 2（Linux 后插，~1w）

PR-B1: Linux bundle + sidecar binary（0.5w）
- tauri.conf.json `targets` 加 `appimage`, `deb`
- download-bun/node.mjs Linux 下载（Linux glibc / musl 选 glibc 默认）
- sidecar.rs Linux bun 路径 `~/.bun/bin/bun`（已是 fallback）
- 凭证模块 Linux 0o600（PR-A1 已统一处理，无需新代码）

PR-B2: CI Linux release runner + 文档（0.5w）
- release.yml 加 `release-linux: runs-on: ubuntu-latest`
- 新增 `docs/install/INSTALL_LINUX.md`：.deb / AppImage 二选一，企业 IT 部署用 .deb 默认
- 验证 secret-tool / libsecret 在 Linux desktop 上的可选集成（可推到 Phase 3，本期纯文件够用）

---

## 五、Phase 3（未来，证书 + 公证 + 商店上架）

不在本次 plan 范围：
- macOS Apple Developer 公证（M9 原计划）
- Windows Authenticode 签名（DigiCert/Sectigo 商用证书，~$300-800/年）
- Linux PGP 签名（GPG key 自管）
- Windows Store / Mac App Store / Snap Store / Flatpak 上架
- 自动更新 Tauri updater 跨 OS endpoint

---

## 六、关键文件改动总览

### 新增
- `apps/desktop/src-tauri/src/credential_migration.rs`（macOS Keychain 一次性 migration）
- `scripts/lib/platform.mjs`（共享 platform/arch/extension 检测）
- `.github/workflows/release.yml`
- `docs/install/INSTALL_WINDOWS.md`
- `docs/architecture/cross-platform-credential.md`
- `docs/iteration-plans/M14-CrossPlatform-Plan.md`（plan 落地存档）

### 修改
- `apps/desktop/src-tauri/Cargo.toml`（移除 security-framework，仅 migration 模块短期保留）
- `apps/desktop/src-tauri/src/credential.rs`（完全重写为单一文件实现，无 cfg 分支）
- `apps/desktop/src-tauri/src/lib.rs`（setup 阶段调 migration）
- `apps/desktop/src-tauri/src/sidecar.rs`（Windows binary 路径）
- `apps/desktop/src-tauri/tauri.conf.json`（NSIS bundle + 多 ICO）
- `scripts/download-bun.mjs`（platform 派生 URL）
- `scripts/download-node.mjs`（同上）
- `scripts/generate-brand-icons.mjs`（真 .ico 多尺寸）
- `package.json`（build:exe scripts）
- `.github/workflows/test.yml`（matrix）
- `CLAUDE.md`（安全宪法 + 当前冲刺）
- `README.md`（Windows 装机段）

### 复用（不改）
- bun runtime 选择策略（runtime-fallback.ts）
- 数据目录布局 `~/.{brand}/`
- Tauri sidecar spawn 机制
- permission_state 权限模型（凭证访问控制）

---

## 七、决策点汇总

| 编号 | 议题 | 选择 | 理由 |
|---|---|---|---|
| D1 | 凭证存储 | 三 OS 全明文 JSON（完全抄 Hermes）| 用户决策（无证书）+ 跨 OS 统一无 cfg 分支 + 抄 Hermes 100%。代价：mac 退化 Keychain，需 migration |
| D2 | Phase 节奏 | Windows 优先，Linux 后插 | 用户决策（企业市场主流） |
| D3 | 本期签名 | 全 OS 未签名 | 用户决策（不阻塞）、文档解释绕过 |
| D4 | 数据目录 | 统一 `~/.{brand}/` | 跨 OS 一致，员工易迁移；BRAND_HOME 环境变量给 IT 覆盖 |
| D5 | sidecar 分发 | 保持内置 bun/node | 不学 Hermes 跑 install.sh（企业用户不能依赖 curl+bash） |
| D6 | NSIS 安装模式 | perUser（不需 admin） | 员工无管理员权限场景常见 |
| D7 | .ico 格式 | png-to-ico 多尺寸 | Windows 任务栏 / 开始菜单 / 桌面图标都漂亮 |
| D8 | CI 触发 | release.yml 手动 trigger（workflow_dispatch） | 不在每 PR 跑（成本控制） |

---

## 八、风险

| 风险 | 缓解 |
|---|---|
| Windows binary 路径混用反斜杠 / 正斜杠 | Rust 用 `PathBuf`，TS 用 `path.join`，禁字符串拼接 |
| Windows ACL 写权限不当 | 用 `cacls` / `icacls` cmd 兜底，主路用 `windows-acl` crate |
| Bun Windows 兼容性 bug（历史上 Bun 1.0 Win 支持迟缓）| 已用 1.3.6（Bun 官方明确 Windows 一等公民），保留 Node fallback |
| SmartScreen 警告劝退用户 | 文档明确"更多信息→仍要运行" 截图；长远靠签名 |
| CI Windows runner 比 Linux 慢 3-5x | release workflow 手动 trigger（不阻塞日常 PR） |
| pnpm Windows 文件锁问题（known issue） | 用 `--frozen-lockfile` + workspace 配置 |
| 凭证 JSON 文件被备份工具同步到云盘泄漏 | 文档警告 .healthclaw 不要加入 Dropbox/iCloud Drive |
| Tauri 2.0 Windows NSIS 模板已稳定但 deb/appimage 仍有边界 case | Phase 2 单独深测 |

---

## 八.5、无签名 vs 签名 UX 对照（决策树）

> 用户提问（2026-05-12）："整个开发完成后，在我没有证书的情况下，是否也可以在三个平台终端安装？"
> 答：**能装**，但 UX 三档不同，越往后越麻烦。企业 IT 渠道部署比员工个人零售好处理。

### 三平台无签名实际安装体验

| 平台 | 能装吗 | 用户阻力 | 用户必须做的事 | 文档承诺截图 |
|---|---|---|---|---|
| **Linux .deb** | ✅ 能 | 几乎零 | `sudo dpkg -i evoclaw.deb` 一键装。apt 仓库才需要 GPG，直接装不需要 | INSTALL_LINUX.md |
| **Linux AppImage** | ✅ 能 | 几乎零 | `chmod +x EvoClaw.AppImage && ./EvoClaw.AppImage` | 同上 |
| **Windows .exe (NSIS)** | ✅ 能 | 中等 | 1️⃣ SmartScreen 警告 "Windows 已保护你的电脑"<br>2️⃣ 点 "更多信息"<br>3️⃣ 点 "仍要运行"<br>装完后正常使用，无后续阻力 | INSTALL_WINDOWS.md 必须有截图 |
| **macOS .dmg** | ✅ 能但最痛苦 | **最高** | Gatekeeper 拒绝："xxx 已损坏 / 无法验证开发者"。三种绕过任选其一：<br>1️⃣ Finder 右键 → 打开 → "仍要打开"（mac 13+ 仍可用）<br>2️⃣ 终端 `sudo xattr -cr /Applications/EvoClaw.app` 剥离 quarantine<br>3️⃣ 系统设置 → 隐私与安全 → "仍要打开"（mac 14+ 推荐路径） | INSTALL_MACOS.md 加 "未公证版本" 一节 |

### 企业 IT 部署绕过表（关键 — EvoClaw 主战场）

EvoClaw 面向企业员工，IT 部门统一部署比员工自下载多。IT 能这么做免去员工被阻：

| 平台 | IT 统一部署绕过 |
|---|---|
| macOS | MDM profile 推 `xattr -cr` 脚本 / Jamf 加 EvoClaw 到白名单 / 企业证书自签 |
| Windows | GPO 加 Defender SmartScreen 例外 / Endpoint Manager (Intune) 推白名单 / 自建分发服务器 |
| Linux | 内部 apt 仓库（自管 GPG）/ Ansible 推 .deb / Salt/Puppet/Chef 编排 |

### 风险升级表（不签名的真实代价）

| 场景 | 影响等级 | 描述 |
|---|---|---|
| 员工个人下载 + 首次装（无 IT 支持） | **高** | Mac 最糟，30-50% 用户卡 Gatekeeper 直接放弃。Win 中等，能教会。Linux 几乎无 |
| 企业 EDR/AV（CrowdStrike / Sophos / Norton）| **高** | 可能直接隔离未签名 binary。**必须**让 IT 提前加白名单 |
| 杀软误报（VirusTotal 偶发）| 中 | Bitdefender/卡巴/360 可能标红。无解，只能定期投诉到 false positive |
| Tauri Auto-Updater | **致命** | macOS 上不签名 updater 直接不工作。Win/Linux 可用。Phase 3 启用 updater 前必须解决 mac 公证 |
| 二次品牌（HealthClaw）| 中 | 同样问题，每个品牌独立一套 |
| 政企客户安全审计 | **致命** | 大型政企必查代码签名，无签名直接 PO 出不来 |

### 决策树：何时投资签名

```
┌─ 你目标的客户是？
│
├─ 个人开发者 / 极客员工自下载 → 不签名 OK（接受 UX 痛苦）
│
├─ 中小企业（IT 弱）→ Mac 痛苦但能用，Win/Linux 顺
│  └─ 升级动力：Mac 公证 (Apple Developer $99/年) 解决最痛点
│
├─ 大企业（IT 强）→ 不签名 OK，靠 IT 渠道部署
│  └─ 升级动力：长期合规，先 Mac 公证再 Win 签
│
└─ 政企 / 金融 / 医疗（合规严）→ **必须三签**
   └─ Mac 公证 + Windows Authenticode OV + Linux GPG
       预算 ~$500-1500/年 + Apple Developer 账号
```

### 签名成本与建议节奏

| 平台 | 证书 | 年费用 | 解决问题 | 建议时机 |
|---|---|---|---|---|
| macOS | Apple Developer Program | ~$99/年 | Gatekeeper 警告 + updater 可用 | **第一优先**（M9 原计划，已等账号到位） |
| Windows | DigiCert/Sectigo OV 证书 | ~$300-800/年 | SmartScreen 警告减少（仍可能出现，需积累 SmartScreen 信誉）| 第二（Phase 3） |
| Windows | EV 证书（更高级）| ~$500-2000/年 | SmartScreen 警告**完全消失** | 政企客户后再考虑 |
| Linux | 自管 GPG key | 免费 | apt 仓库验签可用 | 与 Linux Phase 2 一起免费做 |

### 本期立场（D3 决策）

- 本期**全 OS 未签名发行**
- 文档承诺：三平台分别提供"未签名版本绕过指南"截图教程
- macOS 公证留 M9（Apple 账号到位即做，不在 M14 范围）
- Windows Authenticode 留 Phase 3（看是否要做政企渠道再投入预算）
- Linux GPG 留 Phase 2 末期（基本零成本，顺手做）

**简言之**：本期完成后 = "员工跟着文档手动绕过 + 企业 IT 渠道顺畅 + 个人零售场景痛苦"。
公测 / 内部使用够用，大规模 To B 销售要等签名补齐。

---

## 九、对其他模块的影响

| 模块 | 影响 |
|---|---|
| M13 Phase 1（已 ✅） | 无（sessionKey 纯 TS，跨 OS 无差异） |
| M7 自进化（已 ✅） | 无（skill 文件 IO 都走 path.join） |
| 飞书 / 微信 Channel | 无（HTTP / WebSocket 跨 OS） |
| MCP Servers | MCP 子进程 spawn 命令需 cfg Windows 分支（.cmd / .bat），已知 issue 单独修 |
| SILK 语音转码 | Windows 上 silk-tools 二进制可能不存在（feature flag SILK_VOICE 已默认 off for HealthClaw） |
| 自动更新 | Tauri updater 需为每 OS 配 endpoint（Phase 3） |

---

## 十、工作量小结

| Phase | PR | 工作日 | 主要交付 |
|---|---|---|---|
| **Phase 1 (Windows)** | A1 | 2d | Rust 凭证 cfg 分支 |
| | A2 | 1.5d | bun/node 下载跨平台 |
| | A3 | 1d | sidecar.rs Windows 路径 |
| | A4 | 1.5d | NSIS bundle + 真 ICO |
| | A5 | 1d | CI matrix + release workflow |
| | A6 | 0.5d | 数据目录跨平台 |
| | A7 | 0.5d | 文档 |
| | **小计** | **8d** | + Windows 实机调试 buffer 5d → 真实 2-3w |
| **Phase 2 (Linux)** | B1 | 3d | Linux bundle + 凭证 + sidecar |
| | B2 | 2d | CI Linux + 文档 |
| | **小计** | **5d** | + buffer 2d → 真实 1-1.5w |
| **Phase 3 (签名)** | — | — | 等证书，本期不做 |
| **合计** | | **13d 净工时 + buffer** | 真实 3-4w |

---

## Verification

### 自动化
- `pnpm test`（core / shared / desktop）三 OS 都过 — CI matrix 保护
- `cargo test` macOS / Windows 分别走对应 backend
- `cargo clippy -- -D warnings` 三 OS 都过
- `scripts/check-feature-flags.ts` 验证 Tauri config 完整性

### 手测（Phase 1 完成后）
- **macOS（migration 验证）**：
  - 旧版 EvoClaw 装机，存 5 个凭证（验证 Keychain Access.app 看到条目）
  - 升级到新版 → 首次启动看 `~/.healthclaw/credentials.json` 是否有 5 个条目
  - 验证 Keychain Access.app 中相关条目已删除
  - 文件权限 `ls -l` 应为 `-rw-------`
  - 凭证 set/get/delete 仍正常工作（API 不变，仅 backend 切换）
  - 现有 M7 / M13 / 飞书 / Channel 流程零回归
- **Windows（新增）**：
  - 干净 Windows 11 机
  - 下 `.exe`，触发 SmartScreen 警告，"仍要运行" 装成功
  - 启动后看到 `C:\Users\<你>\.healthclaw\.runtime-info.json`（sidecar 起来）
  - 创建 Agent → 设 LLM API Key（凭证存到 `C:\Users\<你>\.healthclaw\credentials.json`）
  - 看文件 ACL：右键 → 安全 → 仅 `<你>` 有 RWX
  - 跟 Agent 对话一轮（验证 skill load + memory write 都走 path.join 不报错）
  - 测试微信 channel 连接（如果用 SILK_VOICE 默认 off 跳过）
  - 退出 → 文件删 → 重启验证 fresh install 正常

### 手测（Phase 2 完成后）
- Ubuntu 22.04：装 `.deb`，启动，secret-tool 不在时 fallback 文件加密 OK
- AppImage：双击启动，无需安装

---

## 落地存档

按 [feedback_design_docs_location.md](../memory/feedback_design_docs_location.md)：
- 批准 plan 后第一步：拷贝本文件到 `docs/iteration-plans/M14-CrossPlatform-Plan.md`
- 架构文档：新增 `docs/architecture/cross-platform-credential.md`
- 同步更新 `CLAUDE.md` "当前冲刺" 与"技术栈"段

---

**等用户审批后**，按 PR-A1 → A2 → A3 → A4 → A5 → A6 → A7 顺序串行开发（小 PR 滚动 review，不堆大 PR）。Phase 2 在 Phase 1 全部 merge 后启动。
