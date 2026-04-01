# Agent Kernel 补全方案 v2 — 合并 Gap Analysis + 工具质量对齐

> ✅ **P0 安全加固** — 已完成 (Sprint A: f5f8d99)
> ✅ **P1 功能完整** — 已完成 (Sprint B: e0e4910)
> 🔄 **P2 体验优化** — 进行中
>
> 整合两次审计结果：kernel 架构缺口 + 工具实现质量对比

---

## Context

Phase 1-7 已完成 PI 框架替换（10 个 kernel 模块、146 个测试全绿、集成兼容性验证通过）。经过两轮审计：
1. **Gap Analysis**: kernel 架构级缺口（非流式回退、兄弟取消、max_output_tokens 恢复等）
2. **工具质量对比**: 逐工具对比 Claude Code 源码，发现安全和健壮性差距

两次审计结果高度重合，合并为统一补全方案。

---

## 补全清单（按优先级）

### P0 — 安全与稳定性（不修则有风险）

| # | 补全项 | 影响 | 涉及文件 | 参考 Claude Code |
|---|--------|------|---------|-----------------|
| P0-1 | **非流式回退** | 流式挂起时用户卡死，无恢复手段 | `stream-client.ts` | claude.ts `executeNonStreamingRequest()` 300s/120s 超时 |
| P0-2 | **Bash 兄弟工具取消** | Bash 失败后兄弟工具继续执行导致级联错误 | `streaming-tool-executor.ts` | StreamingToolExecutor.ts `siblingAbortController` |
| P0-3 | **Read 设备路径拦截** | 读 `/dev/zero`、`/proc/*/fd` 可挂死进程 | `builtin-tools.ts` | FileReadTool 阻止 15+ 危险路径 |
| P0-4 | **危险命令检测** | `rm -rf`、`git reset --hard`、`DROP TABLE` 无任何警告 | `builtin-tools.ts` (bash) | BashTool/destructiveCommandWarning.ts |
| P0-5 | **危险文件保护** | Agent 可修改 `.gitconfig`、`.bashrc`、`.env`、`.ssh/` | `builtin-tools.ts` (edit/write) | FileEditTool 危险路径拒绝列表 |
| P0-6 | **Write/Edit 先读后写校验** | 可覆盖未读取或已被外部修改的文件 | `builtin-tools.ts` + 新建 `file-state-cache.ts` | FileEditTool `readFileState` LRU 缓存 |

### P1 — 功能完整性（不修则 Agent 能力降级）

| # | 补全项 | 影响 | 涉及文件 | 参考 Claude Code |
|---|--------|------|---------|-----------------|
| P1-1 | **max_output_tokens 恢复** | 长生成任务直接报错，无法续写 | `query-loop.ts` | query.ts 升级 64k + "Resume directly" 恢复消息，最多 3 次 |
| P1-2 | **Edit XML 反消毒 (Step 3)** | 模型输出 `&lt;`/`&gt;` 时 old_string 匹配失败 | `builtin-tools.ts` | FileEditTool/utils.ts 14 种 XML 实体反转 |
| P1-3 | **Edit 引号风格保留** | 弯引号文件替换后变直引号，破坏排版 | `builtin-tools.ts` | FileEditTool/utils.ts 左/右弯引号上下文推断 |
| P1-4 | **Read 编码检测** | 非 UTF-8 文件（UTF-16LE 等）读取乱码 | `builtin-tools.ts` | FileReadTool UTF-16LE BOM 检测 |
| P1-5 | **Read PDF 支持** | 无法读取 PDF 文件 | `builtin-tools.ts` | FileReadTool pages 参数 + pdftoppm 转换 |
| P1-6 | **Grep VCS 排除 + 多输出模式** | 搜索结果含 `.git` 噪声；只有匹配行，无 files/count 模式 | `builtin-tools.ts` | GrepTool `--glob '!.git'` + 3 种 output_mode + 分页 |
| P1-7 | **Glob 改用原生 API** | shell `find` 不跨平台，无 mtime 排序 | `builtin-tools.ts` | GlobTool 使用 glob() 原生 API + mtime 排序 |

### P2 — 体验优化（不修也能工作）

| # | 补全项 | 影响 | 涉及文件 | 参考 Claude Code |
|---|--------|------|---------|-----------------|
| P2-1 | **Stall 检测 (30s)** | 无法诊断模型计算挂起 | `stream-client.ts` | claude.ts 30s 间隔日志 |
| P2-2 | **大结果磁盘持久化** | 长输出 bloat 消息历史 | `tool-adapter.ts` | 30K chars 阈值写磁盘 |
| P2-3 | **Token 阈值分级** | 压缩只有单触发点，缺分级预警 | `context-compactor.ts` | 90%/93%/99% 三级 |
| P2-4 | **图片自适应压缩** | 5MB 硬限无优化，浪费 token | `builtin-tools.ts` | Token 感知降采样 |
| P2-5 | **Read 文件不存在时路径建议** | 只说 "文件不存在"，无帮助 | `builtin-tools.ts` | `findSimilarFile()` + `suggestPathUnderCwd()` |

---

## 实施分组

### Sprint A: 安全加固 (P0 全部)

**新建文件**:
- `kernel/file-state-cache.ts` — LRU 文件状态缓存 (100 条目, 25MB)

**修改文件**:

#### `stream-client.ts` — P0-1 非流式回退
- 新增 `nonStreamingFallback(config)` 函数
- 在 `streamLLM()` catch `IdleTimeoutError` 时调用
- 复用 `buildAnthropicRequest`/`buildOpenAIRequest` 但 `stream: false`
- 300s 超时，解析非流式响应为 StreamEvent 序列

#### `streaming-tool-executor.ts` — P0-2 兄弟取消
- 新增 `siblingAbortController: AbortController`
- `executeSingle()` 传递 signal 给 `tool.call(input, signal)`
- Bash 工具错误时 `siblingAbortController.abort('sibling_error')`
- `collectResults()` 为已中止工具生成合成错误 tool_result

#### `builtin-tools.ts` — P0-3/4/5/6

**Read 工具 (P0-3)**:
```typescript
const BLOCKED_PATHS = new Set([
  '/dev/zero', '/dev/random', '/dev/urandom', '/dev/full',
  '/dev/stdin', '/dev/tty', '/dev/console',
  '/dev/stdout', '/dev/stderr',
]);
// + /dev/fd/*, /proc/*/fd/* 正则
```

**Bash 工具 (P0-4)** — 在 `createEnhancedExecTool` 中:
```typescript
const DESTRUCTIVE_PATTERNS = [
  { pattern: /\brm\s+(-[rf]+\s+|.*--force)/i, warning: '删除文件' },
  { pattern: /\bgit\s+(reset\s+--hard|push\s+--force|clean\s+-f)/i, warning: '不可逆 git 操作' },
  { pattern: /\bdrop\s+(table|database)/i, warning: '删除数据库' },
  { pattern: /\bkubectl\s+delete/i, warning: '删除 K8s 资源' },
  { pattern: /\bterraform\s+destroy/i, warning: '销毁基础设施' },
];
// 检测到 → 返回 warning 前缀，不阻止执行（由权限层决定）
```

**Edit/Write 工具 (P0-5)**:
```typescript
const DANGEROUS_FILES = new Set([
  '.gitconfig', '.gitmodules', '.bashrc', '.zshrc', '.profile',
  '.env', '.aws/credentials', '.ssh/config', '.ssh/authorized_keys',
]);
const DANGEROUS_DIRS = new Set(['.git', '.vscode', '.idea', '.claude']);
// 匹配 → 返回错误 "此文件受保护，不允许修改"
```

**Edit/Write 工具 (P0-6)** — 集成 FileStateCache:
- Read 时 `cache.set(path, { content, timestamp })`
- Edit/Write 时:
  1. `cache.wasReadBefore(path)` → 否则报错 "请先用 read 读取文件"
  2. `cache.wasModifiedSinceRead(path)` → 检测 mtime 变化 → 报错 "文件已被外部修改"

### Sprint B: 功能完整 (P1 全部)

#### `query-loop.ts` — P1-1 max_output_tokens 恢复
- `streamOneRound()` 返回 `stopReason`
- 在 while 循环中检测 `stopReason === 'max_tokens'`
- 第一次: 升级 maxTokens 到 64k（如果当前 < 64k）
- 后续: 注入 "Resume directly" 恢复消息
- 最多 3 次恢复，超过后正常退出

#### `builtin-tools.ts` — P1-2/3/4/5/6/7

**Edit XML 反消毒 (P1-2)** — Step 2 之后:
```typescript
const XML_DESANITIZATIONS: Record<string, string> = {
  '&lt;': '<', '&gt;': '>', '&amp;': '&',
  '&quot;': '"', '&#39;': "'", '&#x27;': "'",
  '&apos;': "'",
};
```

**Edit 引号风格保留 (P1-3)**:
```typescript
function applyQuoteStyle(newString: string, originalContext: string): string {
  // 检测原文是否使用弯引号
  // 是 → 将 newString 中的直引号转为对应位置的弯引号
  // 左引号上下文: 空格/行首/([{ 之后
  // 右引号上下文: 其他位置
  // 缩写检测: 两字母间的 ' → 右单弯引号
}
```

**Read 编码检测 (P1-4)**:
```typescript
function detectEncoding(buffer: Buffer): 'utf-8' | 'utf-16le' {
  if (buffer[0] === 0xFF && buffer[1] === 0xFE) return 'utf-16le';
  return 'utf-8';
}
```

**Read PDF (P1-5)**:
```typescript
const PDF_MAGIC = Buffer.from('%PDF-');
if (buffer.slice(0, 5).equals(PDF_MAGIC)) {
  // pages 参数解析 (最大 20 页)
  // < 3MB: 直接 base64
  // >= 3MB: execSync('pdftoppm -jpeg -r 100 ...')
}
```

**Grep 增强 (P1-6)**:
- 添加 `output_mode` 参数: `'content' | 'files_with_matches' | 'count'`
- ripgrep 默认添加 `--glob '!.git' --glob '!.svn' --glob '!node_modules'`
- 添加 `head_limit` (默认 250) + `offset` 分页

**Glob 原生化 (P1-7)**:
- 用 `node:fs` 递归 + `picomatch` 或简单 glob 匹配替代 shell `find`
- 结果按 mtime 排序 (最新优先)
- 限制 100 文件 + truncated 标记

### Sprint C: 体验优化 (P2)

按需实施，不阻塞主线。

---

## 验证方案

每个 Sprint 完成后:
1. 新增/更新对应单元测试
2. `npx vitest run packages/core/src/__tests__/kernel/` 全绿
3. `npx vitest run packages/core/src/__tests__/embedded-runner.test.ts packages/core/src/__tests__/error-recovery.test.ts` 无回归

Sprint A 专项验证:
- 测试读取 `/dev/zero` 被拦截
- 测试 `rm -rf /` 命令触发警告
- 测试编辑 `.bashrc` 被拒绝
- 测试未 read 就 edit 被拒绝
- 测试流式超时后回退非流式
- 测试 Bash 错误取消兄弟 grep

Sprint B 专项验证:
- 测试 max_tokens 恢复消息注入
- 测试 `&lt;function&gt;` 作为 old_string 的 XML 反消毒
- 测试 UTF-16LE 文件读取
- 测试 PDF 文件读取 (需要测试 PDF 文件)
- 测试 grep `--glob '!.git'` 排除
- 测试 glob mtime 排序

---

## 关键文件清单

| 文件 | Sprint | 修改内容 |
|------|--------|---------|
| `kernel/stream-client.ts` | A | P0-1 非流式回退 |
| `kernel/streaming-tool-executor.ts` | A | P0-2 兄弟取消 |
| `kernel/builtin-tools.ts` | A+B | P0-3/4/5/6 安全 + P1-2/3/4/5/6/7 功能 |
| `kernel/file-state-cache.ts` (新建) | A | P0-6 文件状态 LRU |
| `kernel/query-loop.ts` | B | P1-1 max_output_tokens 恢复 |
| `kernel/tool-adapter.ts` | C | P2-2 大结果持久化 |
| `kernel/context-compactor.ts` | C | P2-3 阈值分级 |
| `embedded-runner-tools.ts` | A | P0-4 危险命令检测 (bash) |
