# brand-apply 生成文件说明

> 本仓库启用多品牌（EvoClaw / HealthClaw / 未来品牌），以下文件是 **运行时生成的品牌产物**，**不入 git**。

## 不入 git 的生成文件清单

| 路径 | 来源 | 说明 |
|------|------|------|
| `packages/shared/src/brand.ts` | brand-apply §1 | TS 品牌常量（BRAND_NAME / BRAND_DATA_DIR 等） |
| `apps/desktop/src-tauri/tauri.conf.json` | brand-apply §2 | Tauri 配置（productName / identifier / updater） |
| `apps/desktop/src-tauri/icons/32x32.png` | brand-apply §3 | Tauri 应用图标 |
| `apps/desktop/src-tauri/icons/128x128.png` | brand-apply §3 | Tauri 应用图标 |
| `apps/desktop/src-tauri/icons/128x128@2x.png` | brand-apply §3 | Tauri 应用图标（HiDPI） |
| `apps/desktop/src-tauri/icons/brand-header.png` | brand-apply §3 | Tauri 品牌 header |
| `apps/desktop/src-tauri/icons/icon.png` | brand-apply §3 | Tauri 通用图标 |
| `apps/desktop/src-tauri/icons/icon.ico` | brand-apply §3 | Windows 图标 |
| `apps/desktop/public/brand-logo.png` | brand-apply §3 | 前端 logo |
| `apps/desktop/public/brand-header.png` | brand-apply §3 | 前端 header |
| `apps/desktop/public/brand-icon.png` | brand-apply §3 | 前端 icon |
| `apps/desktop/index.html` | brand-apply §4 | HTML 模板（`<title>` + 内联 loading） |
| `apps/desktop/src/index.css` | brand-apply §5 | 品牌色 CSS 变量 |
| `packages/core/.env.brand` | brand-apply §6 | Feature Flag 环境变量（已在 .gitignore 更前面忽略） |

**真正入 git 的"品牌源"**：
- `brands/{brand}/brand.json` —— 品牌特化配置（每品牌一份）
- `brands/{brand}/icons/*` —— 品牌图标
- `brands/_base/*.template` —— 所有品牌共享的基础模板（tauri.conf.json / index.html / index.css）

**为什么需要 `_base/` 模板**：tauri.conf.json / index.html / index.css 是 "基础 + 品牌覆写" 模式 —— brand-apply 从 `_base/` 模板读取，覆写品牌相关字段后写到 `apps/desktop/*` 实际位置。所以生成物能完全 gitignore，不依赖 dest 文件先前存在。

## 这些文件何时生成？

| 入口 | 机制 |
|------|------|
| `pnpm install` | **postinstall** hook 自动跑 `node scripts/brand-apply.mjs`（默认 BRAND=evoclaw） |
| `pnpm dev` / `pnpm dev:healthclaw` | `scripts/dev.sh` 开头跑 brand-apply |
| `pnpm build` / `pnpm build:desktop` | script 链前置 `bun scripts/brand-apply.mjs` |
| `pnpm build:dmg` | `scripts/build-dmg.sh` 开头跑 brand-apply |
| CI（`.github/workflows/test.yml`） | 专门的 `Apply brand (evoclaw)` step |

## 切换品牌

```bash
BRAND=healthclaw node scripts/brand-apply.mjs   # 切到 HealthClaw
BRAND=evoclaw node scripts/brand-apply.mjs      # 切回 EvoClaw
```

**关键特性**：切换后 `git status` 应保持干净（生成文件被 .gitignore 忽略）。若看到 modified，说明有泄漏到 .gitignore 外的文件 —— 报 bug。

## 故障排查

### Q: `tsc` 或 VS Code 报 `packages/shared/src/brand.ts` 不存在

首次 clone 后 `pnpm install` 没触发 postinstall（`--ignore-scripts` 等），或 IDE 先于 install 加载了 TS Server。

**解决**：手动跑一次 `node scripts/brand-apply.mjs`，然后 VS Code 重启 TS Server（`Cmd+Shift+P → TypeScript: Restart TS Server`）。

### Q: 切换品牌后 `git status` 显示了 modified 文件

这是 bug —— 说明有新文件加入了 brand-apply 生成范围但没加 .gitignore。

**解决**：把泄漏文件补进 `.gitignore` 的 "brand-apply 生成产物" 段，并在本文档表格里登记。

### Q: 想修改 `Cargo.toml` 或 `src-tauri/src/main.rs` 的品牌字段

**不要改**。这两个文件是稳定源码（`evoclaw-desktop` / `evoclaw_desktop_lib`），不参与品牌切换。Rust crate 名是内部标识，不影响最终用户看到的 Bundle ID / 产品名 / 图标（后者由 tauri.conf.json 定）。

历史上 brand-apply 曾覆写它们切换品牌 → 已退役。

### Q: 新增一个品牌 `fooclaw`，怎么让生成文件自动出现？

见 [`adding-new-brand.md`](./adding-new-brand.md)。简单步骤：
1. `brands/fooclaw/brand.json` 配置
2. `brands/fooclaw/icons/` 放图标
3. `BRAND=fooclaw node scripts/brand-apply.mjs`

## Rationale

**为什么不入 git？** 生成文件入库导致双事实源：
- 代码里每次 `brand-apply` 产生 diff 噪声
- 切品牌时 `git status` 满屏 modified
- 历史上甚至出现"修了生成文件 → 被下一次 brand-apply 覆盖"的事故

**为什么 postinstall 不用 bun？** pnpm lifecycle script 默认走 node。用 `node scripts/brand-apply.mjs`，避免"新开发者没装 bun → pnpm install 报错"。brand-apply.mjs 只用 `node:fs/path/url` 内置 API，node 兼容。
