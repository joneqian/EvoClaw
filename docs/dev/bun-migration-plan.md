# Bun 运行时迁移开发计划

## Context

EvoClaw 桌面应用当前使用 Node.js 22 作为 Sidecar 运行时。为获得原生 TS 执行、~5x 启动速度提升、内置 SQLite 等优势，计划迁移至 Bun 运行时。

POC 验证结果（分支 `poc/bun-runtime`）：
- better-sqlite3 ❌ 不兼容，需替换为 `bun:sqlite`
- bun:sqlite ✅ 12/12 测试通过，API 90% 兼容
- Hono HTTP ✅ 5/5，可用 `Bun.serve` 替代 `@hono/node-server`
- PI Framework ✅ 5/6（仅 `require.resolve` 需改）
- Vitest ✅ 1147/1148 测试通过

## 迁移分 5 个阶段，可逐步合入

---

## Phase 1: SQLite 适配层（核心，无破坏性）

**目标**: 抽象 SQLite 访问，使 `better-sqlite3` 和 `bun:sqlite` 可互换。

### 1.1 创建 SQLite 适配接口

**新建文件**: `packages/core/src/infrastructure/db/sqlite-adapter.ts`

```
运行时检测:
  typeof Bun !== 'undefined' → import('bun:sqlite')
  否则 → import('better-sqlite3')

适配差异:
  - pragma(): bun:sqlite 没有此方法
    → 封装 pragmaSet(name, value) 和 pragmaGet(name)
    → better-sqlite3: db.pragma('journal_mode = WAL')
    → bun:sqlite: db.exec("PRAGMA journal_mode = WAL")
    
  - 构造函数: 两者签名相同 new Database(path, options?)
  
  - prepare/run/get/all/exec/transaction/close: 两者 API 相同，无需适配
```

### 1.2 修改 sqlite-store.ts

**文件**: `packages/core/src/infrastructure/db/sqlite-store.ts`

改动点（仅 2 处 pragma 调用）:
- Line 29: `this.db.pragma('journal_mode = WAL')` → `pragmaSet(this.db, 'journal_mode', 'WAL')`
- Line 31: `this.db.pragma('foreign_keys = ON')` → `pragmaSet(this.db, 'foreign_keys', 'ON')`

Database 创建改为通过适配层工厂函数，自动选择 `bun:sqlite` 或 `better-sqlite3`。

### 1.3 验证

- `bun vitest run` — 全量测试通过
- `node` 运行仍然兼容（双运行时支持）

---

## Phase 2: 构建系统适配

**目标**: esbuild 配置去 Node 化，移除 better-sqlite3 原生模块打包。

### 2.1 修改 build.ts

**文件**: `packages/core/build.ts`

改动点:
1. **target**: `node22` → `esnext`（Bun 兼容）
2. **external**: 移除 `better-sqlite3`（bun:sqlite 内置，无需 external）
3. **banner**: 重写 Node-specific 注入代码

当前 banner（需替换）:
```js
import { createRequire } from "module";
const require = createRequire(import.meta.url);
process.env.NODE_PATH = ...
import Module from "module"; Module._initPaths();
```

新 banner（Bun 兼容）:
```js
// Bun 原生支持 import.meta.dirname，无需 polyfill
// Bun 不需要 createRequire（直接支持 require in ESM）
// Bun 不需要 NODE_PATH / Module._initPaths()
```

如需保留 Node 兼容性，可做运行时检测:
```js
const __isBun = typeof Bun !== 'undefined';
if (!__isBun) {
  // Node fallback: createRequire + NODE_PATH
}
```

4. **移除 `bundleBetterSqlite3()` 函数**（Lines 45-128）:
   - 不再需要复制 `.node` 原生模块
   - 不再需要 patch `database.js`

5. **保留**: 迁移文件复制、bundled skills 复制、`dist/package.json` 生成

### 2.2 验证

- `pnpm build` 成功
- `dist/server.mjs` 可被 `bun run` 执行
- `dist/` 目录不再包含 `node_modules/better-sqlite3/`

---

## Phase 3: Sidecar 运行时切换

**目标**: Tauri 桌面应用从启动 Node 改为启动 Bun。

### 3.1 创建 download-bun.mjs

**新建文件**: `scripts/download-bun.mjs`（替代 `download-node.mjs`）

逻辑:
- Bun 版本: 与开发环境一致（当前 1.3.6）
- 下载 URL: `https://github.com/oven-sh/bun/releases/download/bun-v{VERSION}/bun-darwin-{arch}.zip`
- 输出: `apps/desktop/src-tauri/bun-bin/bun`
- 缓存: 检查已有二进制版本，跳过重复下载
- 验证: `bun --version`

### 3.2 修改 sidecar.rs

**文件**: `apps/desktop/src-tauri/src/sidecar.rs`

改动点:

1. **`find_bundled_node` → `find_bundled_bun`** (Lines 261-284):
   - 搜索路径: `node-bin/node` → `bun-bin/bun`

2. **`find_node_binary` → `find_bun_binary`** (Lines 310-396):
   - 系统搜索路径调整:
     - `~/.bun/bin/bun`（Bun 默认安装位置）
     - `/opt/homebrew/bin/bun`
     - `/usr/local/bin/bun`
   - 移除 nvm/fnm/volta 搜索逻辑（Bun 不需要版本管理器）

3. **进程启动** (Lines 119-123):
   - `shell.command(&node_bin).args([&script_path])` → `shell.command(&bun_bin).args(["run", &script_path])`

4. **日志文案**: 全部 "Node" → "Bun"

5. **JSON 协议**: 无变化（首行 `{port, token}` 和 `__event` 转发保持不变）

### 3.3 修改 tauri.conf.json

**文件**: `apps/desktop/src-tauri/tauri.conf.json`

Resources 部分:
```json
// 移除:
"node-bin/node"
"better-sqlite3/**"

// 新增:
"bun-bin/bun"
```

保留:
- `server.mjs`、`package.json`、`migrations/*`、`skill/bundled/*`

### 3.4 修改构建脚本

**文件**: `scripts/dev.sh`
- Line 24: `node scripts/brand-apply.mjs` → `bun scripts/brand-apply.mjs`（或保持 node，构建时不强制 Bun）

**文件**: `scripts/build-dmg.sh`
- Line 25: `node scripts/download-node.mjs` → `bun scripts/download-bun.mjs`
- Lines 33-47: 移除 `better_sqlite3.node` 存在性校验
- 新增: `bun-bin/bun` 存在性校验

### 3.5 验证

- `pnpm dev` 启动后 sidecar 日志显示 Bun 版本
- 前端正常连接 sidecar（port/token 握手成功）
- `pnpm build:dmg` 打包成功，DMG 中包含 `bun-bin/bun`

---

## Phase 4: 依赖清理与优化

**目标**: 移除 Node-only 依赖，利用 Bun 内置能力。

### 4.1 移除 better-sqlite3

**文件**: `packages/core/package.json`
- 移除 `"better-sqlite3": "^11.9.0"`
- 移除 `"@types/better-sqlite3": "^7.6.13"`

**文件**: `package.json`（根）
- `pnpm.onlyBuiltDependencies` 中移除 `better-sqlite3`

### 4.2 移除 @hono/node-server

**文件**: `packages/core/package.json`
- 移除 `"@hono/node-server"`

**文件**: `packages/core/src/server.ts`
- `import { serve } from '@hono/node-server'` → `Bun.serve({ fetch: app.fetch, port })`

### 4.3 修复 require.resolve

**文件**: `packages/core/src/routes/doctor.ts`
- `require.resolve('@mariozechner/pi-ai')` → 动态 `import()` 或 `import.meta.resolve()`

### 4.4 package.json engines 更新

```json
"engines": {
  "bun": ">=1.3",
  "pnpm": ">=10"
}
```

### 4.5 验证

- `pnpm install` 不再编译原生模块
- 安装速度提升（无 better-sqlite3 编译）
- `bun vitest run` 全量通过

---

## Phase 5: 文档与迭代计划更新

### 5.1 更新 CLAUDE.md

- 技术栈表: `Sidecar: Hono + Node.js + better-sqlite3` → `Sidecar: Hono + Bun + bun:sqlite`
- 开发命令: 添加 Bun 相关说明
- 注意事项: `Node.js >= 22` → `Bun >= 1.3`

### 5.2 更新迭代计划

在 `IterationPlan_2026-03-20.md` 中记录此迁移为已完成工作。

### 5.3 清理 POC 目录

移除 `poc-bun/` 目录（已验证完毕）。

---

## 关键文件清单

| 文件 | 操作 | Phase |
|------|------|-------|
| `packages/core/src/infrastructure/db/sqlite-adapter.ts` | 新建 | 1 |
| `packages/core/src/infrastructure/db/sqlite-store.ts` | 修改 | 1 |
| `packages/core/build.ts` | 修改 | 2 |
| `scripts/download-bun.mjs` | 新建 | 3 |
| `apps/desktop/src-tauri/src/sidecar.rs` | 修改 | 3 |
| `apps/desktop/src-tauri/tauri.conf.json` | 修改 | 3 |
| `scripts/dev.sh` | 修改 | 3 |
| `scripts/build-dmg.sh` | 修改 | 3 |
| `packages/core/src/server.ts` | 修改 | 4 |
| `packages/core/src/routes/doctor.ts` | 修改 | 4 |
| `packages/core/package.json` | 修改 | 4 |
| `package.json`（根） | 修改 | 4 |
| `CLAUDE.md` | 修改 | 5 |
| `scripts/download-node.mjs` | 删除 | 3 |
| `poc-bun/` | 删除 | 5 |

## 工期估算

| Phase | 预估 | 风险 |
|-------|------|------|
| Phase 1: SQLite 适配层 | 0.5 天 | 低 |
| Phase 2: 构建系统适配 | 1 天 | 中 |
| Phase 3: Sidecar 切换 | 1.5 天 | 中 |
| Phase 4: 依赖清理 | 0.5 天 | 低 |
| Phase 5: 文档更新 | 0.5 天 | 低 |
| **总计** | **4 天** | |

## 验证方案

每个 Phase 完成后:
1. `bun vitest run` — 全量测试通过
2. `pnpm dev` — 桌面应用正常启动
3. Agent 创建 → 对话 → 记忆提取 → 全流程验证
4. `pnpm build:dmg` — DMG 打包成功且可安装运行

## 回滚策略

- Phase 1 的适配层支持双运行时，随时可切回 Node
- 所有改动在 `poc/bun-runtime` 分支，不影响 `main`
- 保留 `download-node.mjs` 直到 Phase 5 确认稳定后再删除
