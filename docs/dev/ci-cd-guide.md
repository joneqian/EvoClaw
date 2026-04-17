# EvoClaw CI/CD 工程手册（M0）

> **范围**: M0 基础工程的日常使用 — 版本管理、CI 触发、分支保护、失败排查
> **不含**: 跨平台构建、代码签名、发布流程（→ M9）；文档站部署（→ M10）
> **基于**: `.github/workflows/test.yml` + `scripts/version-bump.mjs` + `scripts/version-check.mjs`

---

## 1. 版本号管理

**单一事实源**: 根 `package.json` 的 `version` 字段。其余 6 处由脚本同步：

```
package.json (root)               ← source of truth
├── apps/desktop/package.json
├── packages/core/package.json
├── packages/shared/package.json
├── apps/desktop/src-tauri/tauri.conf.json
├── apps/desktop/src-tauri/Cargo.toml ([package].version, 不动 [dependencies])
└── packages/core/dist/package.json   ← build.ts 编译时从 packages/core/package.json 动态读取
```

### 1.1 命令速查

```bash
# 检查 7 处是否一致（CI 必跑）
pnpm version:check                    # exit 0 一致 / exit 1 不一致 + diff 表

# 升版本（原子写入：任一失败 → 不写任何文件）
pnpm version:bump patch               # 0.1.0 → 0.1.1
pnpm version:bump minor               # 0.1.0 → 0.2.0
pnpm version:bump major               # 0.1.0 → 1.0.0
pnpm version:bump --set 1.2.3         # 直接设为 1.2.3

# 预览不写
pnpm version:bump --dry-run patch
```

### 1.2 何时手动 bump

| 场景 | 时机 | 命令 |
|---|---|---|
| Bug 修复合入 main | 合并后 | `pnpm version:bump patch` |
| 新功能合入 main | 合并后 | `pnpm version:bump minor` |
| Breaking change | 合并后 | `pnpm version:bump major` |
| 准备 RC / 测试版 | 临时 | `pnpm version:bump --set 1.0.0-rc.1` |

> ⚠️ M0 阶段 bump 是**手动**操作。M9 会接入 changesets / release-please 自动化。

### 1.3 常见错误

**"version field not found"** — 某个 JSON 文件缺 `"version"` 字段。检查 `git log` 看是谁删的。

**"[package] section with version not found"** — `Cargo.toml` 没有 `[package].version`。通常是文件被破坏。

**`pnpm version:check` exit 1** — 7 处不一致。直接跑 `pnpm version:bump --set <根版本>` 强制同步。

---

## 2. CI 触发

### 2.1 自动触发（无需操作）

| 事件 | 触发条件 |
|---|---|
| `push` | 任何 push 到 `main` |
| `pull_request` | 对任意分支开 PR、PR 更新 |
| `workflow_dispatch` | 手动触发（见 2.2）|

> Feature 分支单独 push **不会**触发 CI（避免无 PR 的浪费）。要观察 feature 分支状态，开 Draft PR。

### 2.2 手动触发

```bash
# 触发 main 分支
gh workflow run test.yml

# 触发指定分支
gh workflow run test.yml --ref feat/xxx
```

或浏览器：Actions → Test → Run workflow → 选分支。

### 2.3 看结果

```bash
gh run list --workflow=test.yml --limit 5    # 最近 5 次
gh run watch                                  # 实时跟踪最新一次
gh run view --log-failed                      # 只看失败 step 日志
gh run view <run-id>                          # 看指定 run
```

浏览器：`https://github.com/<owner>/<repo>/actions`

---

## 3. CI 流水线

`.github/workflows/test.yml` 在 ubuntu-latest 上按顺序执行：

```
checkout
  ↓
install pnpm 10.14.0 + Node 22 + Bun 1.3.6
  ↓
pnpm install --frozen-lockfile         ← 失败常因 pnpm-lock.yaml 未提交
  ↓
pnpm version:check                     ← 失败 = 7 处版本不一致
  ↓
pnpm brand:apply                       ← 默认应用 evoclaw 品牌
  ↓
pnpm --filter @evoclaw/shared build    ← shared 必须先 build（core 依赖其类型）
pnpm --filter @evoclaw/core build
  ↓
pnpm typecheck                         ← 全 3 包 tsc --noEmit
  ↓
pnpm lint                              ← oxlint，warning 不阻塞
  ↓
pnpm test                              ← vitest workspace（core + shared + scripts）
```

**总耗时上限**: 15 分钟（`timeout-minutes: 15`）。
**并发取消**: 同分支新 push 自动 cancel 旧 run（`concurrency.cancel-in-progress`）。

---

## 4. 分支保护（一次性手工配置）

CI 跑完只是**显示状态**，不会**阻塞合并**。要让 PR 合并按钮在 CI 红时变灰，配置 **Branch Ruleset**（GitHub 主推的新方式，比 classic branch protection 更灵活）。

> ⚠️ **前置**：先确保 GHA 至少绿跑过一次，否则 status check 列表里搜不到。

### 4.1 操作步骤

1. 打开 `https://github.com/<owner>/<repo>/settings/rules`
2. 点 **Add branch ruleset**（不是 "Add classic branch protection rule"）
3. 按下表填写：

| 区段 | 字段 | 值 |
|---|---|---|
| Ruleset basics | **Ruleset Name** | `main-protection` |
| Ruleset basics | **Enforcement status** | `Active` |
| Targets | **Target branches** → Add target → **Include default branch** | 一键覆盖 main |
| Branch rules | ✅ **Restrict deletions** | 防止 main 被误删 |
| Branch rules | ✅ **Require a pull request before merging** | 见 4.1.1 关于 approvals 的说明 |
| Branch rules | ✅ **Require status checks to pass** | 见 4.1.2 |
| Branch rules | ✅ **Block force pushes** | 防止 force push 覆盖 main |

4. 滚到底点 **Create**

#### 4.1.1 Pull Request 子选项

展开 "Require a pull request before merging" 下的 additional settings：

| 字段 | 单人项目 | 多人协作 | 备注 |
|---|---|---|---|
| **Required approvals** | `0` | `1` 或更多 | ⚠️ 单人项目设 1 会把自己锁死 — GitHub 不允许 PR 作者批准自己的 PR |
| Dismiss stale approvals | ☐ | ☑ 推荐 | push 新 commit 后旧 approval 失效 |
| Require review from specific teams | ☐ | ☐/☑ | 仅当组织有 team 时启用 |
| Require review from Code Owners | ☐ | ☐/☑ | 需先创建 `.github/CODEOWNERS` 文件 |
| Require approval of most recent push | ☐ | ☑ 推荐 | 防止"批了再偷偷塞代码" |
| **Require conversation resolution** | ☑ 推荐 | ☑ 推荐 | 所有 PR 评论解决后才能合 |
| **Allowed merge methods** | **只留 Squash** 推荐 | 同 | Squash 让 main 历史每个 commit = 一个 PR，干净易回滚 |

#### 4.1.2 Status checks 子选项

展开 "Require status checks to pass"：

- ☑ **Require branches to be up to date before merging**（推荐）— PR 必须 rebase/merge 最新 main 才能跑最终的 CI
- 在搜索框输入 `Test`，勾选 `Test / Lint + Typecheck + Test`
- 不要勾 "Do not require status checks on creation"（默认未勾，保持）

### 4.2 验证生效

- 开一个 PR 故意写 typecheck 失败的代码 → CI 红
- PR 页面应显示 "Required statuses must pass before merging"
- 合并按钮变灰，鼠标悬停显示 "Required check ... has not succeeded"
- 修复后 push → CI 绿 → 合并按钮恢复

### 4.2.1 单人项目"自批"问题

如果你设了 `Required approvals: 1` 又是单人项目，会发现：
- 自己的 PR 永远没法 approve（GitHub 灰掉 "Approve" 按钮）
- 合并按钮一直灰
- 解决：要么 `Required approvals: 0`，要么把自己加到 Bypass list（见 4.3）

### 4.3 Bypass（紧急情况）

Ruleset 默认所有人受约束，包括管理员。如需临时绕过：
- Ruleset 编辑页 → **Bypass list** → Add bypass → 选择 role / team
- 仅紧急 hotfix 推荐使用，平时不应配置任何 bypass

---

## 5. 本地复现 CI 序列

调试 CI 失败时先在本地跑同样序列：

```bash
pnpm install --frozen-lockfile
pnpm version:check
pnpm brand:apply
pnpm --filter @evoclaw/shared build
pnpm --filter @evoclaw/core build
pnpm typecheck
pnpm lint
CI=true pnpm test
```

`CI=true` 会启用 vitest 的 `github-actions` reporter，输出格式与 CI 一致。

---

## 6. 常见 CI 失败排查

### 6.1 `pnpm install --frozen-lockfile` 失败

**症状**: `ERR_PNPM_OUTDATED_LOCKFILE` / `Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date`

**原因**: 你改了 `package.json` 的 dependencies 但忘记提交 `pnpm-lock.yaml`。

**修复**:
```bash
pnpm install                    # 本地重新生成 lockfile
git add pnpm-lock.yaml
git commit -m "chore: update lockfile"
```

### 6.2 `pnpm version:check` 失败

**症状**: `❌ 版本号不一致（参考根 package.json 为 X.Y.Z）`

**原因**: 7 处版本号有人手动改了某一处没用脚本同步。

**修复**:
```bash
pnpm version:bump --set <根版本>     # 强制以根为准同步
git add -u
git commit -m "chore: sync versions"
```

### 6.3 `pnpm typecheck` 失败

**症状**: `error TS2xxx: ...`

**原因**: 你写了类型错误的代码，或者改了 shared 类型但没改 core 调用方。

**修复**: 本地跑 `pnpm typecheck` 看完整报错；用 `tsc --noEmit --pretty` 看友好输出。常见根因：
- `@evoclaw/shared` 类型变了 → 重新 `pnpm --filter @evoclaw/shared build`
- 测试 mock 签名与实现漂移 → 同步更新
- 缺 `.d.ts` 声明 → 加到 `packages/core/src/declarations.d.ts`（参考 playwright/silk-wasm 模式）

### 6.4 `pnpm test` 失败

**症状**: 某个 `*.test.ts` 报错

**修复路径**:
1. 本地复现: `pnpm --filter @evoclaw/core test src/__tests__/<file>.test.ts`
2. 单测排查: 看是不是 brand 应用问题（`pnpm brand:apply` 后再跑）
3. 并发竞争: 临时加 `pool: 'forks', poolOptions: { forks: { singleFork: true } }` 排除并发因素
4. 测试本身错: 检查 mock、临时目录清理、异步 await

### 6.5 `pnpm lint` 警告但不失败

`oxlint` 默认 warning 不退出非 0。当前策略：warning 不阻塞 CI。
要严格化：CI step 改为 `pnpm lint --max-warnings 0`。

### 6.6 `pnpm brand:apply` 失败

**症状**: 找不到 `brands/<brand>/brand.json`

**原因**: `BRAND` 环境变量值与 `brands/` 子目录名不符。

**修复**: 确认目录存在；CI 默认应用 `evoclaw`，要切其他品牌设置 `env: BRAND: healthclaw`。

### 6.7 Job 超时（>15 min）

**症状**: `The job running on runner ... has exceeded the maximum execution time of 15 minutes`

**修复路径**:
- 看是不是某个测试卡死（vitest 单测有 30s `testTimeout` 兜底）
- 缓存命中差导致 `pnpm install` 慢 → 检查 `cache: pnpm` 是否生效（看 step "Setup Node.js"）
- 真的需要更多时间 → `.github/workflows/test.yml` 的 `timeout-minutes` 上调

---

## 7. Dependabot

`.github/dependabot.yml` 配置：

| 生态 | 频率 | 上限 | 分组 |
|---|---|---|---|
| npm | 周更 | 5 PR | vitest / typescript / hono 各为一组 |
| github-actions | 月更 | 3 PR | 无 |
| cargo | 月更 | 3 PR | 无 |

**处理 Dependabot PR**:
1. 看 PR 描述的 changelog / breaking changes
2. 等 CI 跑完
3. 全绿且变更可控 → squash merge
4. 一组里有 breaking → 拆开单独评估，不要直接合

---

## 8. 测试覆盖率（可选）

```bash
pnpm --filter @evoclaw/core test:coverage    # 生成 coverage/lcov.info + html/
open packages/core/coverage/index.html       # 浏览器看
```

> M0 不强制覆盖率门槛。M3+ 会在 CI 加 Codecov 上传 + 阈值检查。

---

## 9. 触发 CI 的清单（before push）

```
[ ] pnpm version:check 本地通过
[ ] pnpm typecheck 本地通过
[ ] pnpm lint 本地通过
[ ] pnpm test 本地通过
[ ] pnpm-lock.yaml 已提交（如果改了 package.json）
[ ] 没有遗漏的 brand-apply 副产物（git status 检查）
```

---

## 10. 后续衔接（M9）

M9 会扩展本流水线：
- 新增 `build-dmg.yml`：matrix(macos / windows) + Tauri build + 代码签名 + auto-update
- 新增 `release.yml`：tag 触发 → CHANGELOG → GitHub Release → 上传二进制
- 接入 changesets 自动 bump version + 发布通知
- E2E 测试（webapp-testing）跑 CI

本手册届时一并扩。
