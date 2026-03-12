# EvoClaw — 自进化 AI 伴侣桌面应用

## 项目概述

pnpm monorepo + Tauri 2.0 桌面应用，Node.js Sidecar 架构。用户创建具有独立人格（Soul）、记忆（Memory）、权限的 AI Agent，通过 Vercel AI SDK 对接多家 LLM。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri 2.0 (Rust) |
| 前端 | React 19 + TypeScript + Tailwind CSS 4 + Zustand |
| Sidecar | Hono + Node.js + better-sqlite3 (WAL) |
| LLM | Vercel AI SDK (`ai` + `@ai-sdk/openai`) |
| 构建 | Turborepo + pnpm 10 + Vitest + Oxlint |
| 安全 | macOS Keychain (security-framework) + AES-256-GCM (ring) |

## Monorepo 结构

```
apps/desktop/          — Tauri 2.0 桌面应用 (Rust + React)
packages/core/         — Node.js Sidecar (Hono HTTP 服务)
packages/model-providers/ — LLM Provider 注册 (OpenAI/Anthropic/DeepSeek/...)
packages/shared/       — 共享 TypeScript 类型
docs/                  — PRD, Architecture, IterationPlan
```

## 关键架构模式

- **Sidecar 通信**: Tauri → 随机端口(49152-65535) + 256-bit Bearer Token → Node.js HTTP，仅绑定 127.0.0.1
- **Middleware Pipeline**: before (串行) → LLM 调用 → after (并行)，当前有 PermissionMiddleware + ContextMiddleware
- **ModelRouter**: Agent 配置 → 用户偏好 → 系统默认 → 硬编码 fallback (gpt-4o-mini)
- **Agent Builder**: 6 阶段会话式创建 (role → expertise → style → constraints → preview → done)
- **Soul/Memory**: SOUL.md (YAML frontmatter + Markdown) + MEMORY.md 存储在 `~/.evoclaw/agents/{id}/`
- **Permission Model**: 7 类别 × 4 作用域 (once/session/always/deny)，带审计日志

## 开发命令

```bash
pnpm install              # 安装依赖
pnpm build                # 构建所有包
pnpm test                 # 运行所有测试 (Vitest)
pnpm lint                 # Oxlint 检查
pnpm dev                  # 启动开发 (Turbo)
pnpm dev:core             # 仅启动 Sidecar
pnpm build:desktop        # 构建桌面应用
```

## 数据库

better-sqlite3 + WAL 模式，MigrationRunner 自动执行 `packages/core/src/infrastructure/db/migrations/*.sql`。

核心表: agents, conversations, messages, memories, permissions, audit_log, model_configs

## 编码规范

- TypeScript strict 模式，ES2022 + NodeNext
- 导入路径带 `.js` 后缀 (ESM)
- 测试文件放 `src/__tests__/`，使用 Vitest
- Rust 代码在 `apps/desktop/src-tauri/`
- 中文注释和提示语

## 注意事项

- `pnpm.onlyBuiltDependencies` 已配置 better-sqlite3 和 esbuild
- Anthropic provider 使用动态 import 避免硬依赖 `@ai-sdk/anthropic`
- Node.js >= 22，Rust >= 1.94
- 设计文档: `docs/PRD.md`, `docs/Architecture.md`, `docs/IterationPlan.md`
