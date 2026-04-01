# Bun 运行时 POC 测试结果

> 测试日期: 2026-04-01
> Bun 版本: 1.3.6 (macOS arm64)
> 测试分支: poc/bun-runtime

## 1. better-sqlite3 — ❌ 不兼容

```
error: 'better-sqlite3' is not yet supported in Bun.
Track the status in https://github.com/oven-sh/bun/issues/4290
```

**结论**: better-sqlite3 无法在 Bun 中运行，需要替换为 `bun:sqlite`。

## 2. bun:sqlite — ✅ 全部通过 (12/12)

| 测试项 | 结果 |
|--------|------|
| WAL 模式 | ✅ |
| 创建表 | ✅ |
| INSERT 预编译语句 | ✅ |
| SELECT all/get | ✅ |
| 事务 (transaction) | ✅ |
| UPDATE + changes | ✅ |
| FTS5 全文搜索 | ✅ |
| JSON 函数 | ✅ |
| 并发读写 (多句柄) | ✅ |

### API 差异（需适配）

| better-sqlite3 | bun:sqlite | 影响范围 |
|-----------------|-----------|---------|
| `db.pragma(name)` | `db.query("PRAGMA name")` | sqlite-store.ts 约 5 处 |
| `stmt.run()` → `{changes, lastInsertRowid}` | `stmt.run()` → `{changes, lastInsertRowid}` ✅ 相同 | 无需修改 |
| `new Database(path)` | `new Database(path)` | ✅ 相同 |
| `stmt.all() / get()` | `stmt.all() / get()` | ✅ 相同 |
| `db.exec(sql)` | `db.exec(sql)` | ✅ 相同 |
| `db.transaction(fn)` | `db.transaction(fn)` | ✅ 相同 |

**结论**: API 高度兼容，仅 `pragma()` 需要适配，可封装兼容层。

## 3. Hono HTTP 服务 — ✅ 全部通过 (5/5)

| 测试项 | 结果 |
|--------|------|
| 启动 Hono 服务 (Bun.serve) | ✅ |
| GET 无 auth | ✅ |
| Bearer auth 保护 | ✅ |
| 无 auth → 401 | ✅ |
| SSE Streaming | ✅ |

**结论**: Hono 在 Bun 中完美兼容，且可用 `Bun.serve` 替代 `@hono/node-server`。

## 4. PI Framework — ✅ 基本通过 (5/6)

| 测试项 | 结果 |
|--------|------|
| import pi-ai (48 exports) | ✅ |
| import pi-agent-core | ✅ |
| import pi-coding-agent | ✅ |
| require.resolve | ❌ (Bun ESM 限制) |
| 核心 API 类型检查 | ✅ |
| child_process spawn | ✅ |

**require.resolve 问题**: Bun 对 ESM 包不支持 `require.resolve()`，需改为 `import.meta.resolve()` 或动态 `import()`。仅 `doctor.ts` 健康检查使用，改动量极小。

**结论**: PI 框架可在 Bun 中加载和使用，`require.resolve` 问题可轻松绕过。

## 迁移可行性结论

| 组件 | 状态 | 迁移策略 |
|------|------|---------|
| SQLite | ⚠️ 需替换 | better-sqlite3 → bun:sqlite 适配层 |
| Hono HTTP | ✅ | Bun.serve 替代 @hono/node-server |
| PI Framework | ✅ | require.resolve → import.meta.resolve |
| 构建系统 | ⚠️ 需调整 | esbuild → bun build, 去除 Node banner |
| Tauri Sidecar | ⚠️ 需调整 | download-node → download-bun, sidecar.rs 适配 |

**整体评估**: 从 30-40% 提升到 **70-80% 可行性**。最大工作量是 SQLite 适配层。
