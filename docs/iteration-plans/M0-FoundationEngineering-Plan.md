# M0 — 基础工程详细开发方案

> **基于**: [`CapabilityUpgradePlan_2026-04-17.md`](./CapabilityUpgradePlan_2026-04-17.md) 模块 M0
> **优先级**: P0
> **预估**: 3-4 人天
> **前置依赖**: 无
> **下游解锁**: M3（Agent 核心）、M9（发布与分发）、M10（文档站）
> **参考文档**:
> - [`30-build-packaging-gap.md`](../evoclaw-vs-hermes-research/30-build-packaging-gap.md) §3.10 CI/CD 工作流
> - [`31-testing-gap.md`](../evoclaw-vs-hermes-research/31-testing-gap.md) §3.5 超时、§3.10 CI/CD、§3.11 并行
> - [`33-release-process-gap.md`](../evoclaw-vs-hermes-research/33-release-process-gap.md) §3.1 版本号策略、§3.2 版本号同步

---

## 1. 目标与范围

### 1.1 目标

建立 EvoClaw 的基础工程设施，为后续所有模块提供质量守护网和可预测的发布流程：

1. **CI/CD 工作流**：PR 自动触发测试 + Lint + Typecheck + 版本一致性检查
2. **版本号单一事实源**：7 处硬编码 `0.1.0` 由脚本统一管理，改一处同步全部
3. **测试加速与稳定化**：全局超时防护 + 多核并行 + CI 友好 reporter

### 1.2 范围

**做**:
- GitHub Actions `test.yml`（Linux runner，Node 22 + Bun 1.3.6）
- 版本管理脚本（`version-bump.mjs` + `version-check.mjs`）
- Vitest 配置增强（testTimeout/pool/reporters）
- Typecheck 脚本（两包 + 根）

**不做**（留给后续模块）:
- 跨平台构建（macOS/Windows/Linux 矩阵）→ M9
- 代码签名 + auto-update → M9
- CHANGELOG 自动生成 → M9
- E2E 测试跑 CI（需 Tauri Rust 工具链）→ M9
- 文档站部署 → M10
- Docker 镜像 → P2

---

## 2. 现状盘点

### 2.1 CI/CD

| 项 | 状态 |
|----|------|
| `.github/` 目录 | ❌ 完全不存在 |
| oxlint 配置 | ✅ `.oxlintrc.json` 已有 |
| `turbo.json` pipeline | ✅ build/test/lint/dev，test `cache: false` |
| typecheck 脚本 | ❌ 无 |
| PR gate | ❌ 无 |

### 2.2 版本号硬编码清单（7 处）

| # | 路径 | 行号 | 当前值 |
|---|------|------|--------|
| 1 | `package.json` | 3 | `"version": "0.1.0"` |
| 2 | `apps/desktop/package.json` | 3 | `"version": "0.1.0"` |
| 3 | `packages/core/package.json` | 3 | `"version": "0.1.0"` |
| 4 | `packages/shared/package.json` | 3 | `"version": "0.1.0"` |
| 5 | `apps/desktop/src-tauri/Cargo.toml` | 3 | `version = "0.1.0"` |
| 6 | `apps/desktop/src-tauri/tauri.conf.json` | 4 | `"version": "0.1.0"` |
| 7 | `packages/core/build.ts` | 111 | `version: '0.1.0'` |

### 2.3 测试现状

| 项 | 状态 |
|----|------|
| 测试文件数 | 187（core 170 + shared 17）|
| E2E 测试数 | 9（独立 e2e-*.test.ts）|
| `vitest.workspace.ts` | ✅ 已有 |
| `testTimeout` | ❌ 默认 10s |
| `pool` / `maxForks` | ❌ 未配置 |
| coverage | ❌ 未配置 |
| `pnpm typecheck` | ❌ 不存在 |

---

## 3. 技术架构

### 3.1 子任务拆分与实施顺序

```
  ┌─────────────────────┐    ┌──────────────────────────┐
  │ A: 测试稳定化 (0.5d) │    │ B: 版本号单一事实源 (1-1.5d)│
  │  (与 B 并行)         │    │  (与 A 并行)              │
  └──────────┬──────────┘    └──────────┬───────────────┘
             │                           │
             └───────────┬───────────────┘
                         ▼
             ┌─────────────────────────┐
             │ C: CI/CD 工作流 (1-2d)   │
             │  (依赖 A + B)            │
             └─────────────────────────┘

合计：2.5-4 人天
```

**顺序理由**: C 的 CI step 依赖 A 的超时配置 + B 的 version-check 脚本；A/B 互不依赖可并行。

---

### 3.2 子任务 A：测试加速与稳定化

#### A1. Vitest 全局配置增强

**目标文件**: `packages/core/vitest.config.ts`、`packages/shared/vitest.config.ts`

**增量配置**:

```typescript
test: {
  globals: false,
  environment: 'node',
  include: ['src/__tests__/**/*.test.ts'],

  // 超时防护
  testTimeout: 30000,
  hookTimeout: 30000,
  teardownTimeout: 10000,

  // 并行（Vitest 3.x 推荐 forks 模式，隔离性 > threads）
  pool: 'forks',
  poolOptions: {
    forks: {
      singleFork: false,
      maxForks: 4,     // CI 典型 4 core；本地若内存紧张可调低
      minForks: 1,
    },
  },

  // CI 友好
  reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
},
```

#### A2. Typecheck 脚本

| 文件 | 变更 |
|------|------|
| `packages/core/package.json` | 增 `"typecheck": "tsc --noEmit"` |
| `packages/shared/package.json` | 增 `"typecheck": "tsc --noEmit"` |
| `package.json`（根）| 增 `"typecheck": "turbo run typecheck"` |
| `turbo.json` | 增 `"typecheck": { "dependsOn": ["^build"] }` |

#### A3. Coverage（可选）

```json
// packages/core/package.json
"scripts": {
  "test:coverage": "vitest run --coverage"
},
"devDependencies": {
  "@vitest/coverage-v8": "^3.1.0"
}
```

```typescript
// vitest.config.ts 增
coverage: {
  provider: 'v8',
  reporter: ['text', 'lcov', 'html'],
  exclude: ['**/__tests__/**', 'build.ts', 'dist/**'],
}
```

#### A 验收

```bash
pnpm test             # 187 个测试通过，耗时较之前缩短
pnpm typecheck        # 两包 exit 0
pnpm test:coverage    # 生成 lcov（可选）
```

---

### 3.3 子任务 B：版本号单一事实源

**核心思想**: 根 `package.json` 是唯一 source of truth，其余 6 处由 `version-bump.mjs` 同步。`build.ts:111` 改为从 `packages/core/package.json` 动态读取（彻底消除第 7 处硬编码）。

#### B1. 新建 `scripts/version-bump.mjs`

**CLI 接口**:

```bash
node scripts/version-bump.mjs patch              # 0.1.0 → 0.1.1
node scripts/version-bump.mjs minor              # 0.1.0 → 0.2.0
node scripts/version-bump.mjs major              # 0.1.0 → 1.0.0
node scripts/version-bump.mjs --set 1.2.3        # 直接设为 1.2.3
node scripts/version-bump.mjs --dry-run patch    # 只预览不写入
```

**同步目标**:

```javascript
const TARGETS = [
  { path: 'apps/desktop/package.json',            type: 'json', field: 'version' },
  { path: 'packages/core/package.json',           type: 'json', field: 'version' },
  { path: 'packages/shared/package.json',         type: 'json', field: 'version' },
  { path: 'apps/desktop/src-tauri/tauri.conf.json', type: 'json', field: 'version' },
  { path: 'apps/desktop/src-tauri/Cargo.toml',    type: 'toml-cargo-version' },
];
```

**关键实现要点**:
- **原子性**：先全部读取 + 预览 diff，全部验证通过才写入；任一失败 → 不写任何文件
- **JSON**：`JSON.parse` → 改 version 字段 → `JSON.stringify(obj, null, 2) + '\n'`（保留 2-space 缩进 + trailing newline）
- **TOML**（Cargo.toml）：正则定位 `[package]` 段下第一个 `version = "..."`，只替换该行；不碰 `[dependencies]` 中的版本号
- **日志**：每次改动前输出 `旧值 → 新值`，写入后输出 `✅ <path> updated`

#### B2. 新建 `scripts/version-check.mjs`

**职责**: CI 中验证 6 处目标 + 根 `package.json` 共 7 处全一致。

```javascript
// 读取 7 处 version
// 全等 → exit 0
// 不一致 → 打印 diff 表格 + exit 1
```

#### B3. 根 `package.json` 新增脚本

```json
"scripts": {
  "version:bump": "node scripts/version-bump.mjs",
  "version:check": "node scripts/version-check.mjs"
}
```

#### B4. 消除 `build.ts:111` 硬编码

**当前**（`packages/core/build.ts:111`）:
```typescript
version: '0.1.0',
```

**改为**:
```typescript
// build.ts 顶部
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

// L111
version: pkg.version,
```

> 不用 `assert { type: 'json' }` 语法（Node 22 vs 更低版本行为不一致），显式 readFileSync 更稳。

#### B 验收

```bash
pnpm version:check                      # 初始 exit 0
pnpm version:bump patch --dry-run       # 显示预览 0.1.0 → 0.1.1（无文件变动）
pnpm version:bump patch                 # 真实写入
pnpm version:check                      # 再次 exit 0
grep -rn '"version"' package.json apps/*/package.json packages/*/package.json  # 全部 0.1.1
grep 'version' apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/tauri.conf.json  # 全部 0.1.1
# 人为破坏一处
sed -i '' 's/0.1.1/0.1.2/' apps/desktop/src-tauri/Cargo.toml
pnpm version:check                      # exit 1，输出 diff
git checkout -- .                       # 恢复
```

---

### 3.4 子任务 C：CI/CD 工作流

#### C1. 新建 `.github/workflows/test.yml`

```yaml
name: Test

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: test-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.14.0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.6

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Version consistency check
        run: pnpm version:check

      - name: Typecheck
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint

      - name: Apply brand (evoclaw)
        run: pnpm brand:apply

      - name: Build
        run: pnpm --filter @evoclaw/shared build && pnpm --filter @evoclaw/core build

      - name: Test
        run: pnpm test
        env:
          CI: true
```

**设计决策**:
- **不跑 E2E**: 需要 Tauri Rust 工具链，会大幅延长 CI → 留给 M9
- **只 build shared + core**: desktop 需要 Rust，暂缓 → 留给 M9
- **`--frozen-lockfile`**: 确保 pnpm-lock.yaml 与 PR 一致
- **`cache: pnpm`**: GHA 内建 pnpm store 缓存
- **`concurrency.cancel-in-progress`**: 旧 push 被新 push 取代时自动取消旧任务

#### C2. 新建 `.github/dependabot.yml`（可选）

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
    groups:
      vitest:
        patterns: ["vitest", "@vitest/*"]
      typescript:
        patterns: ["typescript", "@types/*"]
```

#### C 验收

- 在分支 push commit → 自动触发 Test workflow
- workflow 通过（全部 step 绿）
- 故意 break 一个测试 → CI 变红
- 修复后 push → CI 变绿
- workflow 总耗时 <= 15 分钟

---

## 4. 交付物清单

### 4.1 新建文件

| 路径 | 用途 |
|------|------|
| `.github/workflows/test.yml` | CI 主工作流 |
| `.github/dependabot.yml` | 依赖更新（可选）|
| `scripts/version-bump.mjs` | 版本号同步脚本 |
| `scripts/version-check.mjs` | 版本号一致性检查 |

### 4.2 修改文件

| 路径 | 变更 |
|------|------|
| `packages/core/vitest.config.ts` | 增 testTimeout / pool / reporters |
| `packages/shared/vitest.config.ts` | 同上 |
| `packages/core/package.json` | 增 typecheck + @vitest/coverage-v8（可选）|
| `packages/shared/package.json` | 增 typecheck |
| `package.json`（根）| 增 typecheck / version:bump / version:check |
| `turbo.json` | 增 typecheck 任务 |
| `packages/core/build.ts` | L111 改为从 package.json 动态读取 |

### 4.3 不改

- `scripts/brand-apply.mjs`（不涉及 version 管理）
- `scripts/build-dmg.sh`（M9 的事）
- 187 个测试文件本身（不改测试代码）

---

## 5. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Vitest 并行后 SQLite tmpdir 竞争 | 测试偶发失败 | `e2e-helpers.ts` 已用 UUID 独立 tmpdir；抽查 9 个 E2E 后再开 forks；发现 bug 先修后开 |
| `@vitest/coverage-v8` 减慢测试 | CI 耗时 +20% | coverage 默认关闭，仅 `pnpm test:coverage` 启用 |
| CI runner 内存不足（maxForks=4）| ubuntu-latest 7GB 可能溢出 | 从 maxForks=2 起步观察 |
| `build.ts` 读 package.json 路径问题 | 构建失败 | 用 `new URL('./package.json', import.meta.url)` 显式解析；测试验证 |
| version-bump 改 Cargo.toml 正则误伤 | 破坏 Rust 构建 | `--dry-run` 预览；写 version-bump.mjs 的单元测试 |
| `pnpm install --frozen-lockfile` CI 失败 | 阻塞 CI | 本地先 `pnpm install` 确保 lockfile 更新并提交 |
| pnpm/action-setup v4 与 Node v4 API 变动 | workflow 失败 | 参考 hermes tests.yml 的稳定实践 |

---

## 6. 实施步骤

### Day 1：子任务 A + B 并行

**上午 - A（测试稳定化）**
- A1: 两包 `vitest.config.ts` 增 timeout / forks / reporters
- A2: 两包 + 根加 typecheck 脚本，`turbo.json` 加任务
- A3: 可选装 coverage
- 验证: `pnpm test`（187 个通过）+ `pnpm typecheck`（两包 exit 0）

**下午 - B（版本号管理）**
- B1: 写 `scripts/version-bump.mjs`
- B2: 写 `scripts/version-check.mjs`
- B3: 根 `package.json` 加脚本
- B4: 改 `packages/core/build.ts:111`
- 验证: `pnpm version:bump patch --dry-run` + 真实 bump + `pnpm version:check`

### Day 2：子任务 C（CI/CD）

**上午**
- C1: 写 `.github/workflows/test.yml`
- 本地逐步验证（`pnpm install --frozen-lockfile` + `pnpm version:check` + `pnpm typecheck` + `pnpm lint` + `pnpm brand:apply` + 分别 build + `pnpm test`）
- push 到远程分支观察 Actions

**下午**
- 根据 CI 失败信息调整（常见：lockfile、环境变量、路径）
- C2: 可选添加 dependabot.yml
- 归档：本文档 + 实施笔记

### Day 3（buffer）

- 修复 CI 不稳定性
- 优化缓存（pnpm store + turbo cache action）
- 补充 `pool` / `maxForks` 的真实 CI 表现调优

---

## 7. 验证

### 7.1 子任务级验证

**A 验证**:
```bash
pnpm test             # 187 个通过，耗时缩短
pnpm typecheck        # 两包 exit 0
pnpm test:coverage    # 生成 lcov
```

**B 验证**:
```bash
pnpm version:check    # exit 0
pnpm version:bump patch --dry-run
pnpm version:bump patch
pnpm version:check    # 再次 exit 0
# 破坏验证
sed -i '' 's/0.1.1/0.1.2/' apps/desktop/src-tauri/Cargo.toml
pnpm version:check    # exit 1
git checkout -- .
```

**C 验证**:
- push 到 feature 分支观察 Actions
- 破坏测试 → CI 红
- 修复 → CI 绿
- 耗时 ≤ 15min

### 7.2 端到端验证

```bash
pnpm install
pnpm version:check
pnpm typecheck
pnpm lint
pnpm brand:apply
pnpm build
pnpm test
```

全绿 → M0 完成。

---

## 8. 后续衔接

M0 完成后解锁:

| 模块 | 如何受益于 M0 |
|------|--------------|
| M1 安全增强 | 在 CI 保护下开发 SSRF / Secret 脱敏，PR 自动回归测试 |
| M2 配置增强 | 凭证权限改动有 CI 兜底 |
| M3 Agent 核心 | Grace call / IterationBudget 在 CI 下验证无主循环回归 |
| M9 发布与分发 | 基于 M0 CI 扩展 build-dmg.yml + 代码签名 + auto-update + CHANGELOG |
| M10 文档站 | 基于 M0 CI 扩展 deploy-docs.yml |

---

## 9. 实施笔记（实施后回填）

> 本节用于记录实际实施中遇到的坑、调整和实际耗时，供后续模块参考。

- 预估: 3-4d
- 实际耗时: 待回填
- 关键调整: 待回填
- 踩坑记录: 待回填
