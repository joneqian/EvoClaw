# 新增品牌接入指南

> 本指南帮你给 EvoClaw/HealthClaw 加一个新品牌（如 FooClaw），**无需改脚本代码**。

## 一、前置约定

一个"品牌"是同一代码库的一套视觉/数据隔离产物：
- 独立的 **产品名**、**Bundle Identifier**、**数据目录**、**Keychain Service**
- 独立的 **品牌色** 和 **图标**
- 独立的 **签名/公证/auto-update endpoint**（Phase 2 签名阶段启用）
- 共享所有 **代码逻辑**、**功能特性** 以及 **Tauri Updater 签名密钥对**

## 二、接入 5 步

### 1. 创建品牌目录和配置

```bash
mkdir -p brands/fooclaw
cp brands/evoclaw/brand.json brands/fooclaw/brand.json
```

编辑 `brands/fooclaw/brand.json`，改动所有品牌特有字段：

```json
{
  "name": "FooClaw",
  "identifier": "com.fooclaw.app",
  "abbreviation": "FC",
  "dataDir": ".fooclaw",
  "dbFilename": "fooclaw.db",
  "configFilename": "foo_claw.json",
  "keychainService": "com.fooclaw",
  "eventPrefix": "fooclaw",
  "colors": {
    "primary": "#FF6B35",
    "primaryDark": "#CC4D1F",
    "gradient": ["#FF6B35", "#CC4D1F"]
  },
  "windowTitle": "FooClaw",
  "release": {
    "macOS": {
      "signingIdentity": "${APPLE_SIGNING_IDENTITY_FOOCLAW}",
      "entitlements": "${APPLE_ENTITLEMENTS_FOOCLAW}",
      "minimumSystemVersion": "13.0"
    },
    "windows": {
      "certificateThumbprint": "${WINDOWS_CERT_THUMBPRINT_FOOCLAW}",
      "digestAlgorithm": "sha256"
    },
    "updater": {
      "endpoints": ["${UPDATER_ENDPOINT_FOOCLAW}"],
      "pubkey": "${TAURI_UPDATER_PUBKEY}"
    }
  },
  "defaultLanguage": "zh",
  "features": {
    "WEIXIN": true,
    "MCP": true,
    "SILK_VOICE": true,
    "WECOM": false,
    "FEISHU": false
  }
}
```

**关键命名规范**：
- `${APPLE_SIGNING_IDENTITY_<BRAND>}` 必须带品牌后缀（避免双品牌签名身份混淆）
- `${TAURI_UPDATER_PUBKEY}` **不**带品牌后缀 — 全品牌共用 1 套密钥对
- `${UPDATER_ENDPOINT_<BRAND>}` 带品牌后缀 — 每品牌独立托管路径

### 2. 准备图标资源

```bash
mkdir brands/fooclaw/icons
# 从 brands/evoclaw/icons/ 复制文件名参考：
# 32x32.png, 128x128.png, 128x128@2x.png, icon.png, icon.ico, logo.svg, brand-header.png
```

放入对应尺寸的品牌图标。`brand-apply` 会自动复制到 `apps/desktop/src-tauri/icons/` 和前端 `public/`。

### 3. 在根 `package.json` 加品牌脚本（可选）

```jsonc
{
  "scripts": {
    "dev:fooclaw": "BRAND=fooclaw ./scripts/dev.sh",
    "build:fooclaw": "BRAND=fooclaw bun scripts/brand-apply.mjs && turbo run build",
    "build:desktop:fooclaw": "BRAND=fooclaw bun scripts/brand-apply.mjs && turbo run build --filter=@evoclaw/desktop",
    "build:dmg:fooclaw": "BRAND=fooclaw ./scripts/build-dmg.sh"
  }
}
```

(可跳过这步，直接用 `BRAND=fooclaw pnpm <cmd>` 形式调用。)

### 4. 验证品牌应用

```bash
BRAND=fooclaw bun scripts/brand-apply.mjs
```

期望看到：
```
🏷️  应用品牌: FooClaw (fooclaw)
  ✅ packages/shared/src/brand.ts
  ✅ apps/desktop/src-tauri/tauri.conf.json
  ✅ apps/desktop/src-tauri/Cargo.toml (fooclaw-desktop)
  ✅ apps/desktop/src-tauri/src/main.rs (fooclaw_desktop_lib)
  ✅ 图标已复制
  ...
```

### 5. 构建验证

```bash
BRAND=fooclaw pnpm build:desktop
BRAND=fooclaw ./scripts/build-dmg.sh
```

## 三、Phase 2 签名/分发配置（证书就绪后）

当 Apple Developer 证书 + 阿里云 OSS 账号就绪：

### 3.1 macOS 签名

本地 Keychain 导入 Developer ID 证书后，设置环境变量：
```bash
export APPLE_SIGNING_IDENTITY_FOOCLAW="Developer ID Application: <Company> (TEAMID)"
export APPLE_ENTITLEMENTS_FOOCLAW="entitlements.plist"  # 放 apps/desktop/src-tauri/entitlements.plist
```

### 3.2 Updater 密钥（全品牌共用）

```bash
cargo tauri signer generate -w ~/.tauri/tauri-updater.key
# 私钥存 ~/.tauri/，公钥提取后设到环境变量
export TAURI_UPDATER_PUBKEY="<pubkey>"
export UPDATER_ENDPOINT_FOOCLAW="https://updates.fooclaw.com/{{target}}/{{current_version}}/latest.json"
```

### 3.3 GitHub Secrets（CI 用）

在仓库 Settings → Secrets and variables → Actions 加：
- `APPLE_SIGNING_IDENTITY_FOOCLAW`
- `APPLE_CERTIFICATE_P12_BASE64_FOOCLAW` / `APPLE_CERTIFICATE_PASSWORD_FOOCLAW`
- `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`（全品牌共用 Apple Developer 账号时）
- `TAURI_UPDATER_PRIVATE_KEY` / `TAURI_UPDATER_PUBKEY`（全品牌共用）
- `UPDATER_ENDPOINT_FOOCLAW`

GitHub Actions `release.yml` 的 matrix 行追加 `- fooclaw` 即可让 CI 自动打包该品牌。

## 四、常见问题

### Q: 环境变量没设会发生什么？
A: `applyRelease` 占位符解析失败时**整块跳过**该配置段。签名变量没设 → 产出未签名 DMG（Phase 1 正常状态）。Updater 未设 → `plugins.updater` 不出现，客户端不会检查更新。

### Q: 两个品牌能共享一套 Apple Developer 账号吗？
A: 可以。Team ID 共用，每品牌独立的 Developer ID Application 证书即可。`signingIdentity` 环境变量按品牌区分。

### Q: 如果我想让新品牌复用某个现有品牌的配置怎么办？
A: 当前不支持 `extends` 机制。复制一份 brand.json 手工改品牌特有字段是最简单的路径。若出现 3+ 品牌共用大多数字段，可考虑未来再加 extends 支持。

### Q: 新品牌的 Windows 签名必须用 EV 证书吗？
A: 不必。OV/IV 证书也能签名，只是 SmartScreen 仍会显示 "Unknown publisher"（EV 零警告）。Phase 2 T8 默认用 OV 即可。
