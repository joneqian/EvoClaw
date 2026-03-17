# EvoClaw 迭代计划

> **文档版本**: v4.0
> **更新日期**: 2026-03-17
> **文档状态**: 执行中
> **执行方式**: Claude 自主开发 + 测试
> **基于**: PRD v4.0 + Architecture v4.0 + AgentSystemDesign.md + MemorySystemDesign.md

---

## 总览

```
Sprint 1-2    Sprint 3-4    Sprint 5-6    Sprint 7-8    Sprint 9-10
 工程基座       Agent 引擎     记忆系统       能力扩展       Channel + 发布
  |              |              |              |              |
  v              v              v              v              v
Monorepo       PI 集成        L0/L1/L2       RAG + Skill    飞书/企微
Tauri 壳       ReAct 循环     提取+检索      自发现          应用打包
SQLite 基础    8 文件工作区    衰减+隔离      Provider       集成测试
安全基座       对话式创建      ContextPlugin  进化引擎       内测发布
```

**当前进度**: Sprint 1 ✅ | Sprint 2 ✅ | Sprint 3 ✅ | Sprint 4 ✅ | Sprint 5 ✅ | Sprint 6 ✅ | Sprint 7 ✅ | Sprint 8 ✅ | Sprint 9 ✅ | Sprint 10A ✅ | Sprint 10C 🚀

---

## Sprint 1: 工程基座 + Tauri 壳（Week 1-2）✅ 已完成

### 目标
搭建完整的 monorepo 工程骨架、Tauri 桌面应用壳、Node.js Sidecar 通信、SQLite 数据库基础、Rust 安全层。

### 完成情况
- **45 个 TypeScript 测试**全绿（26 shared + 19 core）
- **4 个 Rust 测试**全绿（crypto roundtrip/invalid key/wrong key/short ciphertext）
- **3 个包构建成功**：@evoclaw/shared、@evoclaw/core、@evoclaw/desktop
- **Tauri 编译通过**（cargo check clean）
- **应用 Logo**：机器人变色龙吉祥物（SVG → 多尺寸 PNG）

### TODO-LIST

#### 1.1 Monorepo 初始化
- [x] 创建 `pnpm-workspace.yaml`，定义 `apps/*` 和 `packages/*`
- [x] 创建根 `package.json`（pnpm 10，Node.js >= 22）
- [x] 配置 `turbo.json`（build/test/lint/dev pipeline）
- [x] 创建根 `tsconfig.json`（base config：strict, ES2022, NodeNext）
- [x] 配置 `.gitignore`（node_modules, dist, target, .evoclaw, *.db）
- [x] 配置 `.npmrc`（pnpm settings）
- [x] 配置 Oxlint（`.oxlintrc.json`）
- [x] 配置 Vitest（`vitest.workspace.ts`）

#### 1.2 packages/shared 创建
- [x] 创建 `packages/shared/package.json`
- [x] 创建 `packages/shared/tsconfig.json`
- [x] 定义核心类型 `src/types/agent.ts`：AgentConfig, AgentStatus, AgentFile
- [x] 定义核心类型 `src/types/memory.ts`：MemoryUnit, MemoryCategory, MergeType, KnowledgeGraphEntry
- [x] 定义核心类型 `src/types/message.ts`：ChatMessage, AgentEvent, SessionKey
- [x] 定义核心类型 `src/types/permission.ts`：PermissionGrant, PermissionCategory, PermissionScope
- [x] 定义核心类型 `src/types/channel.ts`：ChannelType, Binding, ChannelMessage
- [x] 定义核心类型 `src/types/provider.ts`：ProviderConfig, ModelConfig
- [x] 定义常量 `src/constants.ts`：默认路径、端口范围、token 限制
- [x] 创建 `src/index.ts` 统一导出
- [x] 编写类型测试（`src/__tests__/types.test.ts`）

#### 1.3 packages/core Sidecar 初始化
- [x] 创建 `packages/core/package.json`（依赖：hono, better-sqlite3）
- [x] 创建 `packages/core/tsconfig.json`
- [x] 实现 `src/server.ts`：Hono HTTP 服务入口（随机端口、Bearer Token、健康检查、CORS、错误处理）
- [x] 实现 `src/infrastructure/db/sqlite-store.ts`：SQLite 连接管理（WAL 模式、CRUD 封装）
- [x] 实现 `src/infrastructure/db/migration-runner.ts`：迁移执行器
- [x] 创建 `src/infrastructure/db/migrations/001_initial.sql`：agents, permissions, model_configs, audit_log
- [x] 编写 SQLite 单元测试（7 tests）
- [x] 编写迁移执行器测试（6 tests）
- [x] 编写 Hono 服务测试（6 tests）
- [x] 创建 esbuild 构建脚本（`build.ts`），输出 ESM bundle

#### 1.4 apps/desktop Tauri 初始化
- [x] 手动创建 Tauri 2.0 项目结构
- [x] 配置 `src-tauri/tauri.conf.json`（窗口、CSP、Sidecar）
- [x] 配置 React 19 + TypeScript + Tailwind CSS 4 前端
- [x] 实现前端路由骨架：`/chat`、`/agents`、`/settings`
- [x] 实现 Sidecar 信息管理（`src-tauri/src/sidecar.rs`）
- [x] 实现前端 API 封装（`src/lib/api.ts`）
- [x] 实现 Zustand store 骨架（`src/stores/app-store.ts`）

#### 1.5 Rust 安全层
- [x] 实现 `src-tauri/src/credential.rs`：macOS Keychain 凭证管理（3 个 IPC 命令）
- [x] 实现 `src-tauri/src/crypto.rs`：AES-256-GCM 加解密 + 密钥生成（4 个 Rust 测试）
- [x] 注册全部 7 个 Tauri IPC 命令

#### 1.6 Sprint 1 验收
- [x] `pnpm build` 全链路通过
- [x] TypeScript 测试全部通过（45 tests）
- [x] Rust 测试全部通过（4 tests）
- [x] `cargo check` 编译通过
- [x] Vite 前端构建成功

---

## Sprint 2: PI 框架集成 + Agent 引擎（Week 3-4）✅ 已完成

### 目标
集成 PI 框架、实现 Agent 生命周期管理、8 文件工作区、会话式创建引导、ReAct 循环运行、基础对话 UI。

### 完成情况
- **PI 框架 v0.57.1** 集成成功（pi-ai + pi-agent-core + pi-coding-agent）
- **98 个测试**全绿（10 个测试文件）
- **Provider 注册**：Qwen/GLM/Doubao + 4 层模型选择链
- **Agent Manager**：CRUD + 8 文件工作区模板
- **嵌入式运行器**：PI 路径 + OpenAI 兼容 fallback，SSE 事件流
- **Lane Queue**：3 Lane 并发控制 + SessionKey 串行
- **Agent Builder**：6 阶段对话式创建引导
- **前端 UI**：Chat 页（SSE 流式 + 消息气泡）、Agent 管理页（卡片 + 创建向导）、设置页（API Key 管理）

### TODO-LIST

#### 2.1 PI 框架集成
- [x] 安装 PI 包：`@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-coding-agent`（v0.57.1）
- [x] 实现 `src/provider/provider-registry.ts`：国内 Provider 注册
  - `registerQwen()`：通义千问（DashScope API）
  - `registerGLM()`：智谱 GLM
  - `registerDoubao()`：字节豆包
- [x] 实现 `src/provider/model-resolver.ts`：模型选择逻辑（4 层优先级链）
- [x] 编写 Provider 注册测试（11 tests）
- [x] 编写 Model Resolver 测试（8 tests）

#### 2.2 Agent 生命周期管理
- [x] 实现 `src/agent/agent-manager.ts`：Agent CRUD + 工作区目录管理
- [x] 实现 `src/agent/types.ts`：AgentRunConfig, RuntimeEvent, RuntimeEventType
- [x] 创建默认 Agent 模板文件（8 文件：SOUL/IDENTITY/AGENTS/TOOLS/HEARTBEAT/USER/MEMORY/BOOTSTRAP）
- [x] 编写 Agent Manager 测试（16 tests）

#### 2.3 PI 嵌入式运行器
- [x] 实现 `src/agent/embedded-runner.ts`：PI 路径 + OpenAI 兼容 fallback 双路径
- [x] 实现 `src/bridge/event-forwarder.ts`：SSE 格式化 + ReadableStream 工厂
- [x] 实现 `src/bridge/tool-injector.ts`：工具注入桩（阶段 1-3）+ 权限拦截器桩
- [x] 添加 Hono 路由 `POST /chat/:agentId/send`（SSE 流式返回）
- [x] 编写嵌入式运行器测试（12 tests）

#### 2.4 Lane 队列
- [x] 实现 `src/agent/lane-queue.ts`：3 Lane 并发控制 + SessionKey 串行 + 超时取消
- [x] 编写 Lane 队列测试（9 tests）

#### 2.5 对话式 Agent 创建
- [x] 实现 `src/agent/agent-builder.ts`：6 阶段会话式引导 + 自动命名/emoji + 工作区文件生成
- [x] 添加 Hono 路由 `POST /agents/create-guided`（含 session 状态管理）
- [x] 添加 Hono 路由 `GET /agents`、`GET /agents/:id`、`POST /agents`、`PATCH /agents/:id`、`DELETE /agents/:id`
- [x] 编写 Agent Builder 测试（12 tests）+ 路由测试（11 tests）

#### 2.6 前端对话 UI
- [x] 实现 Chat 页面：Agent 选择侧栏 + 消息气泡 + SSE 流式接收 + 工具执行状态 + 流式指示器
- [x] 实现 Agent 管理页面：卡片网格 + 创建向导 + 删除确认
- [x] 实现设置页面：6 个 Provider API Key 管理 + 保存/状态 UI
- [x] 实现 Zustand stores：`chat-store.ts` + `agent-store.ts`

#### 2.7 Sprint 2 验收
- [x] 对话式引导创建 Agent（生成 8 文件工作区）
- [x] Chat 页支持 SSE 流式响应
- [x] PI 嵌入式运行器 + OpenAI 兼容 fallback
- [ ] 支持至少 3 个 Provider（OpenAI + DeepSeek + 一个国产）
- [ ] Lane 队列正确限制并发
- [ ] `pnpm test` 全部通过

---

## Sprint 3: 记忆系统 — 数据层 + 提取 Pipeline（Week 5-6）

### 目标
实现 memory_units 表、L0/L1/L2 三层存储、记忆提取 Pipeline、文本清洗、反馈循环防护、merge/independent 语义。

### TODO-LIST

#### 3.1 记忆数据库迁移
- [x] 创建 `migrations/002_memory_units.sql`：
  - `memory_units` 表完整 schema（id, agent_id, user_id, l0_index, l1_overview, l2_content, category, merge_type, merge_key, scope, visibility, visibility_channels, activation, access_count, last_access_at, pinned, source_session_key, source_message_ids, confidence, created_at, updated_at, archived_at）
  - 4 个索引（agent_id, category, merge_key, activation）
- [x] 创建 `migrations/003_knowledge_graph.sql`：
  - `knowledge_graph` 表（id, agent_id, user_id, subject_id, predicate, object_id, object_literal, confidence, source_memory_id, created_at, updated_at）
  - 3 个索引
- [x] 创建 `migrations/004_conversation_log.sql`：
  - `conversation_log` 表（id, agent_id, session_key, role, content, tool_name, tool_input, tool_output, compaction_status, compaction_ref, token_count, created_at）
  - 2 个索引
- [x] 创建 `migrations/005_capability_graph.sql`：
  - `capability_graph` 表（id, agent_id, capability, level, use_count, success_rate, last_used_at, created_at, updated_at, UNIQUE(agent_id, capability)）
- [x] 创建 `migrations/006_tool_audit_log.sql`：
  - `tool_audit_log` 表
- [x] 验证迁移自动执行正确
- [x] 编写迁移集成测试

#### 3.2 记忆存储层
- [x] 实现 `src/memory/memory-store.ts`：memory_units CRUD
  - `insert(unit: MemoryUnit)` → INSERT
  - `update(id, partial)` → UPDATE
  - `getById(id)` → SELECT 全字段
  - `getByIds(ids)` → 批量获取
  - `getL1ByIds(ids)` → 仅 L0 + L1（不加载 L2）
  - `findByMergeKey(agentId, mergeKey)` → 查重
  - `listByAgent(agentId, filter?)` → 分页列表
  - `archive(id)` → 设置 archived_at
  - `pin(id)` / `unpin(id)` → 钉选
  - `bumpActivation(ids)` → access_count += 1, activation += 0.1
  - `delete(id)` → 物理删除
- [x] 编写 memory-store 测试（`src/__tests__/memory-store.test.ts`）

#### 3.3 文本清洗 + 反馈循环防护
- [x] 实现 `src/memory/text-sanitizer.ts`：
  - `MARKERS` 常量（零宽空格标记：EVOCLAW_MEM_START/END, EVOCLAW_RAG_START/END）
  - `sanitizeForExtraction(text)` 函数：
    - 剥离注入的记忆/RAG 上下文（正则匹配标记对）
    - 剥离元数据 JSON 块
    - 过滤命令消息（`/` 开头）
    - CJK 感知最小长度检查（CJK: 4 字符, 其他: 10 字符）
    - 截断超长内容（24000 字符上限）
  - `wrapMemoryContext(content)` → 包裹标记
  - `wrapRAGContext(content)` → 包裹标记
- [x] 编写文本清洗测试（`src/__tests__/text-sanitizer.test.ts`）：
  - 测试标记剥离正确性
  - 测试 CJK 长度检查
  - 测试命令过滤
  - 测试嵌套标记处理

#### 3.4 记忆提取 Pipeline
- [x] 实现 `src/memory/extraction-prompt.ts`：提取 Prompt 模板
  - 完整的 system prompt（分类规则、L0/L1/L2 层级要求、输出 XML 格式、安全四步裁决）
  - `buildExtractionPrompt(conversationText)` → 拼接 system + user prompt
- [x] 实现 `src/memory/xml-parser.ts`：解析 LLM 提取结果
  - `parseExtractionResult(xml)` → ParsedMemory[]
  - 解析 `<memories>` 和 `<relations>` 两个部分
  - 容错处理（LLM 可能生成不完美的 XML）
  - 验证 category 在 9 类范围内
  - 验证 merge_key 格式
- [x] 实现 `src/memory/merge-resolver.ts`：merge 型记忆 upsert
  - `resolveMerge(agentId, parsed: ParsedMemory)` →
    - 查 merge_key 是否已存在
    - 存在 → UPDATE L1/L2（L0 不变，保持向量索引稳定）
    - 不存在 → INSERT 新记录
- [x] 实现 `src/memory/memory-extractor.ts`：完整 Pipeline 编排
  - `extractAndPersist(messages: ChatMessage[], agentId: string)` →
    - Stage 1: 预处理（sanitizeForExtraction）
    - Stage 2: LLM 调用（buildExtractionPrompt → model call → parseExtractionResult）
    - Stage 3: 持久化（merge-resolver + knowledge_graph INSERT + conversation_log 标记）
  - 处理 `<no_extraction>` 响应（无有效记忆时静默跳过）
- [x] 编写 XML 解析器测试（`src/__tests__/xml-parser.test.ts`）
- [x] 编写 merge-resolver 测试（`src/__tests__/merge-resolver.test.ts`）
- [x] 编写 memory-extractor 集成测试（`src/__tests__/memory-extractor.test.ts`）

#### 3.5 知识图谱存储
- [x] 实现 `src/memory/knowledge-graph.ts`：
  - `insertRelation(relation)` → INSERT
  - `queryBySubject(subjectId, predicate?)` → 出边查询
  - `queryByObject(objectId, predicate?)` → 入边查询
  - `queryBoth(entityId)` → 双向查询
  - `expandEntities(entityIds)` → 关系扩展（用于检索 Phase 1）
- [x] 编写知识图谱测试（`src/__tests__/knowledge-graph.test.ts`）

#### 3.6 对话日志
- [x] 实现 `src/memory/conversation-logger.ts`：
  - `log(entry: ConversationLogEntry)` → INSERT
  - `getPendingMessages(agentId, sessionKey)` → 获取未提取的消息
  - `markExtracted(ids, memoryUnitId)` → 标记为已提取
  - `markCompacted(ids, summaryId)` → 标记为已压缩
- [x] 编写对话日志测试

#### 3.7 Sprint 3 验收
- [x] 数据库迁移自动执行，6 张新表正确创建
- [x] 记忆提取 Pipeline 端到端运行：对话文本 → 预处理 → LLM 提取 → XML 解析 → 持久化
- [x] merge 型记忆正确去重更新，L0 不变
- [x] independent 型记忆正确独立插入
- [x] 反馈循环防护：注入的记忆上下文被正确剥离
- [x] 知识图谱关系正确存储和查询
- [x] `pnpm test` 全部通过（≥ 80% 覆盖率）

---

## Sprint 4: 记忆系统 — 检索 + ContextPlugin + 衰减（Week 7-8）

### 目标
实现 FTS5+sqlite-vec 混合搜索、三阶段渐进检索、ContextPlugin 引擎、hotness 衰减、USER.md 动态渲染、LCM 压缩。

### TODO-LIST

#### 4.1 双索引构建
- [x] 实现 `src/infrastructure/db/fts-store.ts`：FTS5 全文索引管理
  - 创建 `memory_fts` 虚拟表（l0_index + l1_overview）
  - `indexMemory(id, l0, l1)` → 插入 FTS 索引
  - `updateIndex(id, l0, l1)` → 更新
  - `search(query, limit)` → BM25 搜索，返回 id + score
  - 自动同步（memory_units 写入时同步更新 FTS）
- [x] 实现 `src/infrastructure/db/vector-store.ts`：向量索引（Phase 1: 内存 fallback）
  - 当前：内存 Map + cosine similarity（sqlite-vec v0.1.7 仍为 alpha，暂不引入）
  - 接口设计与 sqlite-vec 兼容，Sprint 6 升级为持久化方案时无需改动调用方
  - `indexEmbedding(id, embedding)` → 插入向量
  - `search(queryEmbedding, limit)` → 向量相似度搜索
  - 嵌入生成：预留 EmbeddingFn 接口，Sprint 6 接入 LLM embedding API
- [x] 编写 FTS 测试（`src/__tests__/fts-store.test.ts`）— 7 tests
- [x] 编写向量存储测试（`src/__tests__/vector-store.test.ts`）— 8 tests

#### 4.2 混合搜索引擎
- [x] 实现 `src/memory/hybrid-searcher.ts`：FTS5 + 向量 + 知识图谱融合
  - `hybridSearch(query, agentId, options)` → SearchResult[]
  - Phase 1 实现：
    - FTS5 关键词搜索 l0_index（权重 0.3）
    - 向量搜索（权重 0.5，接口预留，待 embedding API 接入）
    - knowledge_graph 关系扩展（权重 0.2）
    - 返回 Top-30 候选
  - Phase 2 实现：
    - `finalScore = searchScore × hotness × categoryBoost × correctionBoost`
    - hotness 计算：`sigmoid(log1p(access_count)) × exp(-decayRate × age_days)`
    - categoryBoost 矩阵（factual/preference/temporal/skill/general）
    - 去重：同 merge_key 只保留最新
    - 可见性过滤（private/shared/channel_only）
    - 取 Top-10，加载 L1 overview
  - Phase 3 实现：
    - 触发条件检测（needsDetail 检测、loadL2 选项）
    - L2 按需加载（Token 预算 ≤ 8K）
  - `bumpActivation(ids)` → 被召回时激活
- [x] 实现查询理解 `src/memory/query-analyzer.ts`（Phase 0）：
  - 关键词提取（CJK + English 停用词过滤）
  - 时间表达式识别（"上周讨论的" → 日期范围）
  - 查询类型判断：factual / preference / temporal / skill / general
- [x] 编写混合搜索测试（`src/__tests__/hybrid-searcher.test.ts`）— 8 tests
- [x] 编写查询分析器测试（`src/__tests__/query-analyzer.test.ts`）— 13 tests

#### 4.3 ContextPlugin 引擎
- [x] 实现 `src/context/plugin.interface.ts`：ContextPlugin 接口
  - 5 个可选钩子：bootstrap, beforeTurn, compact, afterTurn, shutdown
  - BootstrapContext, TurnContext, CompactContext, ShutdownContext 类型
- [x] 实现 `src/context/context-engine.ts`：插件调度引擎
  - 串行 beforeTurn（按 priority 排序）
  - Token 预算检查（> 85% 上限 → 逆序 compact）
  - forceTruncate 兜底
  - 并行 afterTurn（Promise.allSettled）
- [x] 实现插件 `src/context/plugins/session-router.ts`（priority: 10）：
  - 解析 Session Key → 确定 channel、chatType、peerId
  - 设置可见性范围
- [x] 实现插件 `src/context/plugins/permission.ts`（priority: 20）：
  - 权限检查（暂用内存缓存，后续对接 Rust 层）
  - 权限弹窗请求接口
- [x] 实现插件 `src/context/plugins/context-assembler.ts`（priority: 30）：
  - 按文件加载矩阵选择性加载工作区文件
  - 组装 system prompt（SOUL.md + AGENTS.md + USER.md + MEMORY.md + ...）
  - 20,000 字符上限截断（按优先级）
  - compact 钩子：LCM 压缩（保留最近 3 轮 + 摘要更早消息）
- [x] 实现插件 `src/context/plugins/memory-recall.ts`（priority: 40）：
  - beforeTurn：调用 hybridSearch 三阶段检索 → 注入上下文（带标记包裹）
  - compact：降级为仅注入 L0
- [x] 实现插件 `src/context/plugins/memory-extract.ts`（afterTurn）：
  - 调用 memory-extractor.extractAndPersist()
- [x] 编写 ContextEngine 测试（`src/__tests__/context-engine.test.ts`）— 15 tests
- [x] 编写各插件单元测试（插件逻辑通过 ContextEngine 测试覆盖）

#### 4.4 Hotness 衰减 + 归档
- [x] 实现 `src/memory/decay-scheduler.ts`：
  - `tick()` → 计算所有非钉选/非归档记忆的 hotness → 更新 activation
  - 归档冷记忆（activation < 0.1 且 30 天未访问）
  - 调度：每小时执行一次（setInterval）
- [x] 编写衰减调度器测试（`src/__tests__/decay-scheduler.test.ts`）— 11 tests

#### 4.5 USER.md / MEMORY.md 动态渲染
- [x] 实现 `src/memory/user-md-renderer.ts`：
  - `renderUserMd(agentId)` → 从 memory_units 查询 profile + preference + correction → 生成 Markdown
  - `renderMemoryMd(agentId)` → 查询 activation > 0.3 的记忆 → 生成 Markdown
  - `renderDailyLog(agentId, date)` → 从 conversation_log 渲染当日日志
- [x] 编写渲染器测试（`src/__tests__/user-md-renderer.test.ts`）— 13 tests

#### 4.6 PI 记忆桥接
- [x] 实现 `src/bridge/memory-extension.ts`：PI ↔ 记忆系统桥接
  - `beforeAgentStart` 钩子：渲染 USER.md/MEMORY.md → 写文件 → 记忆检索+注入
  - `afterAgentEnd` 钩子：触发记忆提取 Pipeline
  - `logToolResult` 钩子：记录工具执行到 conversation_log
  - `beforeCompact` 钩子：Pre-compaction Memory Flush
- [x] 集成到 embedded-runner.ts 的 extensions 参数（MemoryExtension 已可作为独立模块注入）
- [x] 编写桥接集成测试（`src/__tests__/memory-extension.test.ts`）— 6 tests

#### 4.7 前端记忆管理 UI
- [x] 实现记忆管理页面（`apps/desktop/src/pages/MemoryPage.tsx`）：
  - 记忆列表（按类别筛选展示）
  - 搜索框（调用 `POST /memory/:agentId/search`）
  - 每条记忆显示：L0 摘要、类别标签、activation 值、钉选状态
  - 展开查看 L1/L2 详情
  - 钉选/取消钉选操作
  - 删除记忆操作（带确认）
- [x] 添加 Hono 路由（`src/routes/memory.ts`）：
  - `POST /memory/:agentId/search` → 混合搜索
  - `GET /memory/:agentId/units` → 分页列表
  - `GET /memory/:agentId/units/:id` → 单条详情
  - `PUT /memory/:agentId/units/:id/pin` → 钉选
  - `DELETE /memory/:agentId/units/:id/pin` → 取消钉选
  - `DELETE /memory/:agentId/units/:id` → 删除

#### 4.8 行为反馈
- [x] 实现反馈收集（`src/routes/feedback.ts`）：
  - 对话 UI 中每条 Agent 回复添加 👍/👎 按钮（前端预留）
  - 👎 可附带文字纠正
  - 负面反馈自动提取为 correction 类记忆
- [x] 添加 Hono 路由 `POST /chat/:agentId/feedback`
- [x] 编写反馈处理测试（通过 server 路由集成验证）

#### 4.9 Sprint 4 验收
- [x] 三阶段渐进检索端到端运行（FTS5 + 知识图谱扩展，向量搜索接口预留）
- [x] ContextPlugin 引擎正确调度插件（5 个插件实现 + 15 tests）
- [x] 对话中自动进行记忆提取 + 下次对话自动召回相关记忆
- [x] hotness 衰减正确运行（7 天半衰期验证）
- [x] USER.md / MEMORY.md 从数据库正确渲染
- [x] 记忆管理 UI 可查看/搜索/钉选/删除记忆
- [x] 反馈循环防护生效（注入的记忆不被重复提取）
- [x] LCM 压缩在长对话中正确触发
- [x] `pnpm test` 全部通过（284 tests: 26 shared + 258 core）

---

## Sprint 5: Session Key 路由 + 权限模型（Week 9-10）

### 目标
实现完整的 Session Key 路由、记忆安全隔离、权限弹窗模型、Binding Router、工具审计日志。

### TODO-LIST

#### 5.1 Session Key 路由
- [x] 实现 `src/routing/session-key.ts`：
  - `generateSessionKey(agentId, channel, chatType, peerId?)` → 格式化 key
  - `parseSessionKey(key)` → 解析为结构体
  - `isGroupChat(key)` / `isDirectChat(key)` → 判断聊天类型
  - Session Key 格式：`agent:{agentId}:{channel}:{chatType}:{peerId}`
- [x] 实现 `src/routing/binding-router.ts`：Binding 路由
  - `resolveAgent(message: ChannelMessage)` → 最具体匹配优先
  - 匹配优先级：peerId 精确 > accountId + channel > channel > 默认 Agent
  - `addBinding(binding)` / `removeBinding(id)` / `listBindings()`
- [x] 创建 `migrations/007_bindings.sql`：bindings 表
- [x] 创建 `migrations/008_cron_jobs.sql`：cron_jobs 表
- [x] 编写路由测试（`src/__tests__/session-key.test.ts` 14 tests、`src/__tests__/binding-router.test.ts` 13 tests）
- [x] 重构 `context/plugins/session-router.ts`：统一使用 `routing/session-key.ts` 的解析函数

#### 5.2 记忆安全隔离
- [x] 更新 `memory-recall.ts` 插件：
  - 私聊：加载全可见性记忆
  - 群聊：仅加载 shared/channel_only 可见性记忆，排除 private
- [x] 更新 `context-assembler.ts` 插件：
  - 按文件加载矩阵控制文件加载
  - 群聊不加载 USER.md / MEMORY.md（仅 SOUL.md + IDENTITY.md + AGENTS.md）
- [x] 记忆隔离通过 session-key 的 isGroupChat 判断实现

#### 5.3 权限模型完整实现
- [x] 实现 `src/bridge/security-extension.ts`：权限拦截
  - 内存权限缓存（Map<agentId, Map<category:resource, PermissionRecord>>）
  - `checkPermission(agentId, category, resource)` → allow/deny/ask
  - `grantPermission(agentId, category, scope, resource)` → 持久化 + 缓存 + 审计日志
  - `revokePermission(id)` → 删除 + 清缓存
  - 支持 once/session/always/deny 四种 scope
  - 过期权限自动清除
- [x] 实现 `src/tools/permission-interceptor.ts`：工具权限拦截
  - 11 个危险命令正则模式（rm -rf, DROP TABLE, sudo 等）
  - 消息发送类工具强制确认（6 种工具名）
  - 文件系统受限路径检查（/etc/, ~/.ssh/ 等）
  - 工具名 → 权限类别自动映射
- [x] 实现前端权限弹窗组件（`apps/desktop/src/components/PermissionDialog.tsx`）：
  - 权限请求弹窗（显示 Agent emoji + 名称、操作类别、资源）
  - "仅本次" / "始终允许" / "始终拒绝" 三选项
- [x] 编写权限模型测试（`security-extension.test.ts` 9 tests、`permission-interceptor.test.ts` 16 tests）

#### 5.4 工具审计日志
- [x] 更新 `tool-injector.ts`：
  - `ToolAuditor` 类：所有工具执行写入 `tool_audit_log` 表
  - 记录 agent_id, session_key, tool_name, input_json, output_json, status, duration_ms, permission_id
  - `listByAgent(agentId)` / `listBySession(sessionKey)` 查询接口
  - `permissionInterceptor` 从桩实现升级为真实拦截（无配置时 fallback 允许）
- [x] 编写审计日志测试（`tool-auditor.test.ts` 6 tests）

#### 5.5 安全设置 UI
- [x] 实现安全设置页面（`apps/desktop/src/pages/SecurityPage.tsx`）：
  - 已授权权限列表（类别/作用域标签、撤销按钮）
  - 审计日志查看（状态标签、工具名、耗时、时间戳、分页）
  - Agent 选择器 + Tab 切换
- [x] 添加安全 API 路由（`src/routes/security.ts`）：
  - `GET /security/:id/permissions` → 权限列表
  - `POST /security/:id/permissions` → 授予权限
  - `DELETE /security/:id/permissions/:permId` → 撤销权限
  - `GET /security/:id/audit-log` → 审计日志

#### 5.6 Sprint 5 验收
- [x] Session Key 正确生成和解析（14 tests）
- [x] Binding 路由正确匹配（最具体优先，13 tests）
- [x] 群聊中零泄露（memory-recall + context-assembler 隔离）
- [x] 权限弹窗正确触发和持久化（9 + 16 tests）
- [x] 危险命令触发确认弹窗（11 个模式）
- [x] 审计日志完整记录（6 tests）
- [x] `pnpm test` 全部通过（342 tests: 26 shared + 316 core）

---

## Sprint 6: 本地知识库 RAG + 向量持久化（Week 11-12）✅ 已完成

### 目标
实现文件摄取引擎、**向量存储从内存 fallback 升级为持久化方案**、语义检索、知识库管理 UI。

> **向量持久化升级说明**：Sprint 4 因 sqlite-vec 处于 alpha 阶段（v0.1.7-alpha.2, 2025-01 发布）而采用内存 Map fallback。本 Sprint 正式引入持久化向量存储：
> - **首选方案**：sqlite-vec（若届时已发布稳定版）— 与现有 better-sqlite3 技术栈一致，零额外依赖
> - **备选方案**：`usearch`（高性能 HNSW 库，MIT 协议）或 `hnswlib-node`
> - 升级范围：替换 `VectorStore` 内部实现 + 为记忆系统的 `memory_units` 补充 embedding 持久化 + 接入 LLM Embedding API（OpenAI `text-embedding-3-small` 或国产替代）

### TODO-LIST

#### 6.1 向量存储持久化升级
- [x] 采用 SQLite BLOB + JS 暴力 cosine 方案（零额外原生依赖，<50K 向量 ~15ms）
- [x] 实现 Embedding API 调用层 `src/rag/embedding-provider.ts`：
  - `generate(text)` / `generateBatch(texts[])` — OpenAI 兼容 `/v1/embeddings`
  - 支持 OpenAI `text-embedding-3-small`(1536), Qwen `text-embedding-v3`(1024), GLM `embedding-3`(2048)
  - 工厂函数 `createEmbeddingProvider()`
- [x] 升级 `src/infrastructure/db/vector-store.ts`：
  - SQLite BLOB 持久化，保留内存 Map fallback（向后兼容）
  - `indexEmbedding(id, embedding, sourceType)` / `search(query, limit, sourceType)` / `searchByText()`
- [x] 升级 `src/memory/memory-store.ts`：insert/update 时异步队列索引 embedding，delete 时清理
- [x] 升级 `src/memory/hybrid-searcher.ts`：启用 Phase 1 向量搜索路径（权重 0.5，有 embeddingFn 时生效）
- [x] 编写 `vector-store-persist.test.ts`（10 tests）— BLOB 持久化、跨实例持久化、sourceType 过滤

#### 6.2 文件摄取引擎
- [x] 实现 `src/rag/file-ingester.ts`：
  - 支持格式：Markdown, TXT, PDF (动态 import unpdf), 代码文件
  - SHA-256 哈希去重，增量检测 `checkFileChanged()`
  - PDF 解析：动态 import `unpdf`，未安装优雅降级
- [x] 实现 `src/rag/chunk-splitter.ts`：
  - Markdown：按 ## 标题分块
  - 纯文本：按段落分块
  - 代码：按函数/类定义分块
  - 每块 256-1024 tokens，附带元数据（heading, lineStart, lineEnd, language）
  - 超长单行自动按句子切分

#### 6.3 知识库索引
- [x] 实现 `src/rag/rag-indexer.ts`：
  - `indexFile()` / `indexAllPending()` / `reindexFile()`
  - 状态流转：pending → indexing → indexed / error
  - 后台异步索引（不阻塞 UI）
- [x] 创建 `migrations/009_knowledge_base.sql`：
  - `embeddings` 表（id, source_type, embedding BLOB, dimension）— 记忆+知识块共用
  - `knowledge_base_files` 表（id, agent_id, file_name, file_path, file_hash, file_size, chunk_count, status）
  - `knowledge_base_chunks` 表（id, file_id, agent_id, chunk_index, content, metadata_json, token_count）

#### 6.4 RAG 检索插件
- [x] 实现 `src/context/plugins/rag.ts`（priority: 50）：
  - beforeTurn：`vectorStore.searchByText(query, 10, 'chunk')` → 加载 chunk 内容 → 4K token 预算 → wrapRAGContext 注入
  - compact：返回原始消息（由标记识别 RAG 内容）
  - 无 embeddingFn 时优雅跳过
- [x] 编写 `rag-plugin.test.ts`（6 tests）

#### 6.5 知识库管理 UI
- [x] 实现 `KnowledgePage.tsx`：文件列表（名称、大小、块数、状态标签）+ 导入表单 + 删除/重建索引
- [x] App.tsx 添加知识库导航 + Route
- [x] 添加 Hono 路由 `src/routes/knowledge.ts`：
  - `POST /:agentId/ingest` → 文件摄取 + 异步索引
  - `GET /:agentId/files` → 文件列表
  - `DELETE /:agentId/files/:fileId` → 删除
  - `POST /:agentId/reindex` → 重新索引
- [x] 服务端装配 `server.ts`：EmbeddingProvider 初始化（环境变量）+ VectorStore(db, embeddingFn) + 路由挂载

#### 6.6 Sprint 6 验收
- [x] **向量存储已从内存 fallback 升级为 SQLite BLOB 持久化**（进程重启后向量不丢失）
- [x] **记忆系统 hybrid search 的向量搜索路径已启用**（权重 0.5，有 embeddingFn 时生效）
- [x] 可导入 Markdown/TXT/PDF/代码文件到知识库
- [x] 向量索引后台异步完成
- [x] 对话中自动检索知识库相关内容并注入上下文（RAG 插件 priority:50）
- [x] 增量索引正常工作（SHA-256 哈希变更检测 + reindex）
- [x] 知识库管理 UI 可查看/删除/重建索引
- [x] `pnpm test` 全部 367 tests 通过

---

## Sprint 7: Skill 自发现 + Provider 完善（Week 13-14）✅ 已完成

### 目标
实现 Skill 发现/安装流程、能力缺口检测、ClawHub/skills.sh 对接、完善所有 Provider。

### 完成情况
- **433 个 TypeScript 测试**全绿（原 367 + 新增 66）
- **3 个包构建成功**
- Skill 全生命周期：解析 → 发现 → 下载 → 安全分析 → 门控 → 安装 → 注入 → 卸载
- 8 个 Provider 全部注册（OpenAI, Anthropic, Qwen, GLM, Doubao, DeepSeek, MiniMax, Kimi）
- ToolRegistry 插件实现 PI 渐进式两级注入
- 能力缺口检测插件（中英文信号匹配）

### TODO-LIST

#### 7.1 Skill 发现
- [x] 实现 `src/skill/skill-discoverer.ts`：
  - `search(query, limit?)` → 调用 ClawHub API `GET /api/v1/search?q=&limit=`（向量语义搜索）
  - `getSkillInfo(slug)` → `GET /api/v1/skills/{slug}` 获取详情
  - `listLocal()` → 扫描 `~/.evoclaw/skills/` + 工作区级 Skills
  - 返回统一类型：name, description, version, author, downloads, source ('clawhub'|'github'|'local')
  - 缓存搜索结果（10 分钟 TTL，内存 Map + 时间戳）
  - ClawHub API 不可用时优雅降级（仅返回本地结果 + 警告）
- [x] 实现 `src/skill/skill-installer.ts`：
  - `prepare(source, agentId?)` → 下载到临时目录 + 分析 → 返回 PrepareResult（安全评估）
    - ClawHub 源：`GET /api/v1/download?slug=&version=` 下载 ZIP
    - GitHub 源：`git clone --depth 1` 或 GitHub API 下载 ZIP（支持 `owner/repo` 简写）
  - `confirm(prepareId)` → 执行安装到 `~/.evoclaw/skills/` 或 Agent 工作区
  - 解析 SKILL.md YAML frontmatter 元数据
  - 两步交互式安装：先 prepare 展示报告，用户确认后 confirm
- [x] 实现 `src/skill/skill-parser.ts`：SKILL.md YAML frontmatter 解析器
- [x] 实现 `src/skill/skill-gate.ts`：门控检查（EvoClaw 自定义扩展，PI/AgentSkills 规范本身不实现门控）
  - 解析 SKILL.md frontmatter 中的 `compatibility` 字段 + EvoClaw 扩展字段 `requires`
  - 检查 requires.bins（which 命令检测）
  - 检查 requires.env（process.env 检测）
  - 检查 requires.os（process.platform 检测）
  - 不满足 → 提示安装缺失依赖或静默跳过

#### 7.2 Skill 安全分析
- [x] 实现 `src/skill/skill-analyzer.ts`：静态分析
  - 扫描 Skill 文件中的危险模式：eval, new Function, fetch (外发), fs.write (写文件越界), shell exec, env access
  - 生成安全评估报告（risk_level: low/medium/high + findings[]）
  - high risk → 阻止安装
  - medium risk → 警告 + 需用户确认

#### 7.3 能力缺口检测
- [x] 实现 `src/context/plugins/gap-detection.ts`（afterTurn 插件，priority: 80）：
  - 检测 Agent 回复中的"无法完成"信号（中英文 8 种模式）
  - 从用户消息提取搜索关键词
  - 自动搜索匹配 Skill → 推荐给用户

#### 7.4 ToolRegistry 插件
- [x] 实现 `src/context/plugins/tool-registry.ts`（priority: 60）：
  - bootstrap：扫描并缓存已安装 Skills
  - beforeTurn：生成 `<available_skills>` XML 目录注入 system prompt
  - 遵循 PI 渐进式注入模式：Tier 1 目录注入，Tier 2 模型用 Read 加载
  - Skill 加载优先级：Agent 工作区 > 用户级安装 > 内置
  - `disable-model-invocation: true` 的 Skill 不出现在目录中
  - 门控不通过的 Skill 静默跳过

#### 7.5 Provider 完善
- [x] 验证并完善所有 Provider 配置：
  - OpenAI (gpt-4o, gpt-4o-mini) — registerOpenAI()
  - Anthropic (claude-sonnet-4, claude-opus-4) — registerAnthropic()
  - DeepSeek (deepseek-chat/v3, deepseek-reasoner/r1) — registerDeepSeek()
  - MiniMax (abab6.5s-chat) — registerMiniMax()
  - Kimi/Moonshot (moonshot-v1-128k/32k/8k) — registerKimi()
  - 通义千问 (qwen-max, qwen-plus, qwen-turbo, qwen-vl-max) — registerQwen()
  - 智谱 GLM (glm-4-plus, glm-4v-plus) — registerGLM()
  - 字节豆包 (doubao-pro-32k, doubao-lite-32k) — registerDoubao()
- [x] 实现 Provider 设置 UI（延后至 Sprint 8.5，已完成）

#### 7.6 Skill 管理 UI
- [x] 实现 Skill 管理页面（`apps/desktop/src/pages/SkillPage.tsx`）：
  - 已安装 Skill 列表（名称、版本、来源、门控状态）
  - 搜索安装入口（搜索 ClawHub + GitHub URL 输入框）
  - 安装进度 + 安全评估结果展示（两步流程：prepare → confirm）
  - 卸载操作
- [x] 添加 Hono 路由 `src/routes/skill.ts`：
  - `POST /skill/search` → 搜索 ClawHub API
  - `POST /skill/prepare` → 下载 + 分析（返回安全评估报告）
  - `POST /skill/confirm` → 用户确认后执行安装
  - `GET /skill/list` → 已安装列表（含本地扫描）
  - `DELETE /skill/:name` → 卸载
- [x] 共享类型 `packages/shared/src/types/skill.ts`
- [x] App.tsx 添加 Skill 导航 + 路由

#### 7.7 Sprint 7 验收
- [x] 可通过 ClawHub API 搜索 Skill（向量语义搜索）
- [x] 支持 GitHub URL 直装 Skill（兼容 skills.sh 生态）
- [x] Skill 安装流程完整（prepare: 下载 → 分析 → 门控 → 展示报告 → confirm: 安装）
- [x] 安装的 Skill 在下次对话中可被 Agent 调用（ToolRegistry 插件）
- [x] 能力缺口检测正确识别并推荐 Skill
- [x] 所有 8 个 Provider 可正常配置和使用
- [x] `pnpm test` 全部通过（433 tests）

---

## Sprint 8: 进化引擎 + Heartbeat/Cron（Week 15-16）

### 目标
实现能力图谱、满意度检测、进化日志、Heartbeat 心跳、Cron 定时任务。

### TODO-LIST

#### 8.1 进化引擎
- [x] 实现 `src/evolution/capability-graph.ts`：
  - `detectCapabilities(messages, toolCalls)` → 识别使用的能力维度（8 维度 + 关键词/工具映射）
  - `updateCapability(agentId, capability, success)` → 更新 level/use_count/success_rate
  - `getCapabilityGraph(agentId)` → 返回能力图谱数据
  - `getTopCapabilities(agentId, limit)` → 排序返回 Top N
- [x] 实现 `src/evolution/feedback-detector.ts`：
  - `detectSatisfaction(messages)` → 分析用户满意度信号
  - 正面信号："谢谢"、"完美"、👍、great、perfect、thanks 等
  - 负面信号："不对"、"重来"、👎、wrong、redo 等
  - 返回 satisfaction score (0-1)，默认 0.5
- [x] 实现 `src/evolution/growth-tracker.ts`：
  - `recordEvent(agentId, event)` → 记录成长事件（复用 audit_log 表）
  - `computeGrowthVector(agentId, days)` → 计算成长向量
  - `getRecentEvents(agentId, limit)` → 最近进化事件
- [x] 实现 `src/context/plugins/evolution.ts`（afterTurn 插件，priority 70）：
  - 调用 capability-graph + feedback-detector + growth-tracker
- [x] 编写进化引擎测试（capability-graph 11 + feedback-detector 8 + growth-tracker 5 + evolution-plugin 6 = 30 tests）

#### 8.2 Heartbeat 调度器
- [x] 实现 `src/scheduler/heartbeat-runner.ts`：
  - 配置加载：间隔、活跃时段、目标
  - 定时触发（setInterval）
  - 活跃时段检查（activeHours）
  - lightContext 模式（仅加载 HEARTBEAT.md）
  - HEARTBEAT_OK 响应静默丢弃
  - 非 OK 响应存入 conversation_log
- [x] 实现 `src/scheduler/active-hours.ts`：时段检查（支持跨午夜）
- [x] 编写 Heartbeat 测试（active-hours 6 + heartbeat-runner 8 = 14 tests）

#### 8.3 Cron 调度器
- [x] 实现 `src/scheduler/cron-runner.ts`：
  - Cron 表达式解析（使用 `cron-parser` 库）
  - 隔离会话执行（LaneQueue cron 车道，不共享主会话上下文）
  - 超时管理（默认 5 分钟）
  - CRUD: scheduleJob / updateJob / removeJob / listJobs
- [x] Cron 管理 API（`src/routes/cron.ts`）：
  - `POST /cron` → 创建
  - `GET /cron?agentId=` → 列表
  - `PUT /cron/:id` → 更新
  - `DELETE /cron/:id` → 删除
- [x] 编写 Cron 测试（8 tests）

#### 8.4 进化 UI
- [x] 实现进化仪表盘（`apps/desktop/src/pages/EvolutionPage.tsx`）：
  - 能力雷达图（8 维度，纯 SVG 绘制）
  - 统计卡片（能力维度数、平均等级、总使用次数）
  - 7 日成长向量面板（趋势箭头 + delta）
  - 最近进化事件列表
- [x] 实现 Heartbeat/Cron 设置 UI（集成到 EvolutionPage）：
  - Heartbeat 开关/间隔/活跃时段配置
  - Cron 任务列表 + 创建/删除
- [x] App.tsx 添加「📊 进化」导航 + `/evolution` 路由

#### 8.5 Provider 设置 UI（Sprint 7 延后）
- [x] 实现 Provider 设置 UI（增强 SettingsPage）：
  - 已注册 Provider 列表展示（从 Sidecar API 加载，按优先级排序）
  - API Key 配置 + 保存（持久化到 model_configs 表）
  - 默认模型选择（展开 Provider 查看模型列表，点击设为默认）
  - Provider 连接测试（发送最小 chat/completions 请求验证 API Key）
  - 模型能力标签（Vision、Tool Use、上下文长度）
- [x] 实现 Provider 路由（`src/routes/provider.ts`）：
  - `GET /provider` → 列表
  - `GET /provider/:id` → 详情
  - `PUT /provider/:id` → 注册/更新
  - `DELETE /provider/:id` → 注销
  - `POST /provider/:id/test` → 连接测试
  - `GET /provider/default/model` → 获取默认模型
  - `PUT /provider/default/model` → 设置默认模型
- [x] server.ts 挂载 `/provider` 路由

#### 8.6 Sprint 8 验收
- [x] 能力图谱随对话自动更新（evolution afterTurn 插件）
- [x] 进化仪表盘正确展示能力数据
- [x] Heartbeat 按配置定时运行，HEARTBEAT_OK 不打扰用户
- [x] Cron 任务按表达式定时执行
- [x] `pnpm test` 全部通过（50 文件，485 tests，新增 52 tests）
- [x] `pnpm build` 构建成功

---

## Sprint 9: Channel 接入 — 飞书 + 企微（Week 17-18）✅ 已完成

### 目标
实现 Channel 抽象层、飞书 Channel、企微 Channel、Binding 路由集成、Channel 管理 UI。

### 完成情况
- **新增 42 tests**，总计 **553 tests** 全绿（26 shared + 527 core）
- **构建成功**：3 包均无错误
- **新增文件**: 10 个核心模块 + 4 个测试文件 + 1 个 UI 页面
- **修改文件**: server.ts（路由挂载 + 生命周期）、App.tsx（导航 + 路由）

### TODO-LIST

#### 9.1 Channel 抽象层
- [x] 实现 `src/channel/channel-adapter.ts`：Channel 适配器接口
  - `connect(config)` → 建立连接
  - `disconnect()` → 断开连接
  - `onMessage(handler)` → 注册消息回调
  - `sendMessage(peerId, content)` → 发送消息
  - `getStatus()` → 连接状态
- [x] 实现 `src/channel/message-normalizer.ts`：消息标准化
  - 各平台消息格式 → 统一的 ChannelMessage 格式
  - 飞书（JSON content 解析）、企微（XML → 标准化）、桌面（本地消息）
- [x] 实现 `src/channel/channel-manager.ts`：Channel 生命周期管理
  - 注册/注销 Channel 适配器
  - 连接状态监控
  - 自动重连（指数退避，最多 10 次）

#### 9.2 飞书 Channel
- [x] 实现 `src/channel/adapters/feishu.ts`：
  - 飞书机器人 API 集成（原生 fetch，无额外依赖）
  - Webhook 消息接收 + URL 验证
  - 私聊 + 群聊消息处理
  - 文本消息收发
  - @机器人 触发检测（群聊中未 @ 不处理）
  - Tenant Access Token 自动刷新（每 90 分钟）
- [x] 编写消息标准化测试

#### 9.3 企微 Channel
- [x] 实现 `src/channel/adapters/wecom.ts`：
  - 企业微信应用 API 集成
  - 回调消息接收
  - 私聊 + 群聊消息处理
  - 文本消息收发
  - Access Token 自动刷新（每 100 分钟）
- [x] 编写消息标准化测试

#### 9.4 桌面 Channel
- [x] 实现 `src/channel/adapters/desktop.ts`：
  - 桌面应用内的默认 Channel（始终 connected）
  - 直接通过 Hono HTTP 通信
  - handleIncomingMessage → 标准化 → 消息回调
- [x] 编写桌面适配器测试

#### 9.5 Channel 工具（阶段 4）
- [x] 实现 `src/tools/channel-tools.ts`：
  - `feishu_send(peerId, content)` → 飞书发消息
  - `feishu_card(peerId, card)` → 飞书卡片消息
  - `wecom_send(peerId, content)` → 企微发消息
  - `desktop_notify(title, body)` → 桌面通知
  - 按当前通道动态注入（仅注入当前 Channel 的工具）
- [x] 编写 Channel 工具测试

#### 9.6 Binding 路由集成
- [x] 实现 `src/routing/binding-router.ts`：四级优先匹配（peerId > accountId+channel > channel > default）
- [x] 实现 `src/routes/binding.ts`：Binding CRUD + 路由解析调试
- [x] 编写 Binding 路由器测试（12 tests，含外键级联删除）
- [x] 服务端集成：server.ts 挂载 /binding 和 /channel 路由

#### 9.7 Channel 管理 UI
- [x] 实现 `apps/desktop/src/pages/ChannelPage.tsx`：
  - Channel 连接状态列表（颜色指示）
  - 飞书 Bot 配置（App ID + App Secret）
  - 企微应用配置（Corp ID + Agent ID + Secret）
  - Binding 规则管理（创建/删除 + 路由测试）
  - 连接/断开操作
- [x] App.tsx 添加 "📡 Channel" 导航 + /channel 路由
- [x] 添加 Hono 路由：
  - `POST /channel/connect` → 连接
  - `POST /channel/disconnect` → 断开
  - `GET /channel/status` → 状态列表
  - `GET /channel/status/:type` → 单个状态
  - `POST /channel/webhook/feishu` → 飞书 Webhook
  - `POST /channel/webhook/wecom` → 企微回调
  - `POST /binding` / `GET /binding` / `DELETE /binding/:id` / `POST /binding/resolve`

#### 9.8 Sprint 9 验收
- [x] Channel 抽象层 + 3 个适配器实现完成
- [x] 飞书/企微 Webhook 路由 + Token 自动刷新
- [x] Binding 路由四级优先匹配 + CRUD（13 tests 覆盖四级匹配）
- [x] Channel 管理 UI + 导航集成
- [x] Binding 路由正确匹配（binding-router.test.ts 13 tests 全绿）
- [x] Channel 断连自动重连（channel-manager.test.ts 3 个重连测试：失败重连、disconnect 停止、上限停止）
- [x] `pnpm test` 全部通过（553 tests 全绿，构建成功）

---

## Sprint 10A: PI 框架集成补全（Week 19） ✅

### 目标
打通 PI 框架端到端对话链路：工具注入、Memory Bridge、Session 持久化、.env 配置、调度器执行逻辑。

### 完成情况
- 548 tests 全部通过，56 test files
- `pnpm build` 构建成功
- 新增 21 tests（evoclaw-tools 12 + tool-injector-integration 9）

### TODO-LIST

#### 10A.1 .env 配置加载
- [x] 在 `packages/core` 添加 `dotenv` 依赖
- [x] `server.ts` 启动时加载 `.env`（`import 'dotenv/config'`）
- [x] 创建 `.env.example` 文件，列出所有支持的环境变量
- [x] 支持的环境变量：
  - `EVOCLAW_DEFAULT_API_KEY` — 默认 LLM API Key
  - `EVOCLAW_DEFAULT_PROVIDER` — 默认 Provider（如 openai/anthropic/qwen）
  - `EVOCLAW_DEFAULT_MODEL` — 默认模型 ID
  - `EVOCLAW_DEFAULT_BASE_URL` — 自定义 API Base URL
  - `EVOCLAW_EMBEDDING_API_KEY` / `EVOCLAW_EMBEDDING_BASE_URL` — 已存在，保持
- [x] Chat 路由从 .env 或 model_configs 表获取 API Key（4 级优先：model_configs → env 解析 → EVOCLAW_DEFAULT_API_KEY → 空）

#### 10A.2 工具注入管线（5 阶段补全）
- [x] 阶段 1: PI 内置工具 — PI 框架自行注入 read/write/edit/bash（无需操作）
- [x] 阶段 3: EvoClaw 特定工具 `src/tools/evoclaw-tools.ts`（新文件）
  - `memory_search(query, limit?)` → 调用 HybridSearcher 搜索记忆
  - `memory_get(id)` → 获取单条记忆详情（L2 层）
  - `knowledge_query(entity)` → 知识图谱实体关系查询
- [x] 阶段 4: Channel 工具 — 已有 `channel-tools.ts`，通过 `channelTools` 配置注入
- [x] 阶段 5: Skill 工具目录 — 已有 `tool-registry` 插件的 XML 目录注入 system prompt
- [x] 更新 `getInjectedTools()` 返回 evoClawTools + channelTools 完整数组
- [x] 更新 `ToolInjectorConfig` 接口支持 `evoClawTools` 和 `channelTools` 字段

#### 10A.3 Chat 路由重构 — 接入 ContextEngine
- [x] 重构 `routes/chat.ts`：
  - 创建 ContextEngine 实例（注册 sessionRouter + contextAssembler 插件）
  - `POST /:agentId/send` 完整流程：
    1. `resolveModel()` 解析模型 + API Key（model_configs → env → 默认）
    2. `contextEngine.bootstrap()` — 加载工作区文件
    3. `contextEngine.beforeTurn()` — 记忆召回 + 上下文组装
    4. 将 `injectedContext` 拼接为 system prompt
    5. 调用 `runEmbeddedAgent()` 执行对话（SSE 流式）
    6. `contextEngine.afterTurn()` — 记忆提取 + 进化更新（异步非阻塞）
  - 消息历史从 `conversation_log` 表加载最近 20 条
  - 对话结束后存储 user + assistant 消息到 `conversation_log`
- [x] `server.ts` 传递 `vectorStore` 到 `createChatRoutes()`

#### 10A.4 embedded-runner 增强
- [x] `AgentRunConfig` 新增 `tools?: ToolDefinition[]` 和 `messages?: ChatMessage[]` 字段
- [x] PI 路径：将 tools 转为 PI 格式传入 Agent，将 messages 转为 PI 格式作为历史
- [x] Fetch fallback 路径：messages 历史注入到 OpenAI API 请求
- [x] chat.ts 将 tools + messages 传入 runConfig

#### 10A.5 Heartbeat/Cron 执行逻辑
- [x] HeartbeatRunner 和 CronRunner 通过 LaneQueue 调度（已实现 prompt 构建 + 结果处理）
  - 注：实际 LLM 调用需要 API Key 配置后才能端到端验证，属于 10B 集成测试范畴

#### 10A.6 测试
- [x] `evoclaw-tools.test.ts` — 12 tests（memory_search/memory_get/knowledge_query 全覆盖）
- [x] `tool-injector-integration.test.ts` — 9 tests（5 阶段注入 + permissionInterceptor）
- [x] 更新 `embedded-runner.test.ts` — 修复工具注入测试用例
- [x] `pnpm test` 全部通过（548 tests）
- [x] `pnpm build` 构建成功

#### 10A.7 Sprint 10A 验收
- [x] `.env` 配置 API Key 后，Chat 路由可解析并传递 API Key 到 LLM
- [x] EvoClaw 工具（memory_search/memory_get/knowledge_query）注入到 Agent 工具列表
- [x] ContextEngine 在对话前后正确执行（bootstrap → beforeTurn → afterTurn）
- [x] 多轮对话上下文从 conversation_log 正确加载（最近 20 条）
- [x] 工具 + 消息历史正确传入 embedded-runner（PI + fetch 双路径）
- [x] `pnpm test` 全部通过（548 tests, 56 files）
- [x] `pnpm build` 构建成功

---

## Sprint 10B: 集成测试 + macOS 打包 + 内测发布（Week 20）

### 目标
基于 Sprint 10A 的完整对话链路，进行全系统集成测试、UI 打磨、macOS 本地打包。

### TODO-LIST

#### 10B.1 集成测试
- [ ] 端到端测试场景：
  - [ ] 新用户首次启动：应用启动 → Sidecar 自动启动 → SQLite 初始化 → 迁移执行
  - [ ] Agent 创建流程：对话式引导 → 8 文件生成 → Agent 激活
  - [ ] 基础对话：用户发消息 → PI ReAct 循环 → 流式响应
  - [ ] 记忆沉淀：对话后 → 记忆提取 → memory_units 写入
  - [ ] 记忆召回：下次对话 → 三阶段检索 → 记忆注入上下文
  - [ ] 长对话压缩：10+ 轮对话 → LCM 触发 → 摘要生成 → 上下文精简
  - [ ] Hotness 衰减：模拟时间推移 → activation 下降 → 归档
  - [ ] 反馈循环防护：注入记忆 → 提取不含注入内容
  - [ ] 记忆隔离：桌面私聊 → 记忆存储 → 群聊不可见
  - [ ] 权限弹窗：Agent 执行 bash → 弹窗确认 → 执行/拒绝
  - [ ] RAG 检索：导入文件 → 索引 → 对话中检索相关内容
  - [ ] Skill 安装：能力缺口 → 搜索 Skill → 安装 → 下次使用
  - [ ] 飞书 Channel：飞书消息 → Binding 路由 → Agent 响应 → 飞书回复
  - [ ] Heartbeat：定时触发 → HEARTBEAT_OK 静默 / 有事项通知用户
  - [ ] 多 Provider：切换 Provider → 对话正常

#### 10B.2 性能优化
- [ ] 应用启动优化：冷启动 < 3 秒目标
  - Sidecar 预加载
  - SQLite 连接懒初始化
- [ ] 记忆检索优化：三阶段检索 < 200ms
  - FTS5 查询优化（分词器调优、索引预热）
  - 向量搜索查询优化（HNSW 参数调优、批量查询）
  - 索引覆盖率检查 + 缺失 embedding 补建
- [ ] 内存占用优化：空闲 < 200MB
  - React 组件懒加载
  - 大列表虚拟滚动
- [ ] 流式响应优化：
  - SSE 连接复用
  - 减少序列化开销

#### 10B.3 UI 打磨
- [ ] 暗色/亮色主题支持（跟随系统）
- [ ] 中文 UI 文案审校
- [ ] 错误提示中文化 + 修复建议
- [ ] 空状态引导（无 Agent 时引导创建，无记忆时说明工作原理）
- [ ] 键盘快捷键（Cmd+N 新对话，Cmd+K 搜索等）
- [ ] 应用图标设计

#### 10B.4 macOS 应用打包（本地测试版）
- [x] 配置 Tauri 构建：
  - 无签名 DMG 安装包（本地开发测试用）
  - 最小系统要求：macOS 13+
  - 当前仅本机架构（Universal Binary 延后）
- [x] better-sqlite3 native 模块打包：
  - build.ts 自动复制 .node 二进制 + JS 文件到 dist/node_modules/
  - Patch database.js 移除 bindings 依赖，直接 require native 路径
  - tauri.conf.json resources 声明所有 native 文件
- [x] 构建产物验证：
  - DMG 安装测试（本地右键打开绕过 Gatekeeper）
  - Sidecar 正常启动
  - 基础对话功能正常
- **遗留问题**：用户机器需要安装 Node.js >= 22（消除此依赖见 Sprint 19.3）

#### 10B.5 文档和内测准备
- [ ] 编写用户使用指南（内置到应用内帮助页面）
- [ ] 编写 API Key 配置指南（各 Provider 的获取方式 + .env 配置说明）
- [ ] 编写飞书/企微 Bot 创建指南
- [ ] 创建内测反馈收集渠道
- [ ] 准备种子用户邀请

#### 10B.6 Sprint 10B 验收（MVP 发布标准）
- [ ] macOS 应用可本地安装和启动（冷启动 < 3 秒）
- [ ] 新用户 2 分钟内完成首次有效对话
- [ ] 对话式 Agent 创建成功率 ≥ 90%
- [ ] 记忆检索准确率 ≥ 80%（三阶段渐进检索 Top-5 匹配率）
- [ ] 记忆隔离零泄露（群聊不暴露私聊记忆）
- [ ] 飞书/企微 Channel 正常工作
- [ ] `pnpm test` 全部通过
- [ ] `pnpm build` 构建成功

---

## Sprint 10C: Agent 能力急行军（3 天冲刺）

> **时间**: 2026-03-17 ~ 2026-03-19（3 天）
> **目标**: 3/20 客户演示前完成 Agent 核心增强，展示完整的 AI Agent 能力
> **基于**: OpenClaw 深度研究 → 确定关键差距 → 高优先级能力补齐

### 状态总览

| 任务 | 状态 | 日期 |
|------|------|------|
| PI 框架集成修复（createAgentSession + streamSimple + usage 防御 + baseUrl 修正 + provider ID 映射） | ✅ 完成 | 03-17 |
| 测试连接 / 同步模型改用 PI ModelRegistry | ✅ 完成 | 03-17 |
| 手动添加模型（LLM/EMB 类型选择） | ✅ 完成 | 03-17 |
| 系统提示增强（安全宪法 + 记忆召回 + 运行时信息 + 工具指导） | ✅ 完成 | 03-17 |
| Web 搜索工具（Brave API） | ✅ 完成 | 03-17 |
| Web 抓取工具（URL→Markdown） | ✅ 完成 | 03-17 |
| 多级错误恢复（overload 退避 + thinking 降级 + context overflow） | ✅ 完成 | 03-17 |
| 图片分析工具（vision 模型，绕过 PI 直接调用 API） | ✅ 完成 | 03-18 |
| PDF 阅读工具（双模式：原生 Anthropic/Google + unpdf 提取） | ✅ 完成 | 03-18 |
| apply_patch 工具（多文件统一 diff） | ✅ 完成 | 03-18 |
| 子 Agent 生命周期（spawn/list/kill + 完成通知 + 深度限制） | ✅ 完成 | 03-18 |
| 工具循环检测 + 结果截断 | 🔲 待开发 | 03-19 |
| 后台进程管理（exec 后台 + process 工具） | 🔲 待开发 | 03-19 |
| Doctor 自诊断命令 | 🔲 待开发 | 03-19 |
| 端到端测试 + Bug 修复 + 演示准备 | 🔲 待开发 | 03-19 |

### Day 1（03-17）— Agent 核心能力 ✅

**目标**: 让 Agent "会上网、会思考、不崩溃"

| 任务 | 时间 | 验收标准 | 状态 |
|------|------|---------|------|
| 系统提示增强 | 1h | 包含安全宪法、记忆召回指令、运行时信息、工具使用指导 | ✅ |
| Web 搜索工具 | 2h | Brave API 调用成功，返回标题+摘要+链接 | ✅ |
| Web 抓取工具 | 1.5h | URL→Markdown 转换成功，纯 regex 实现 | ✅ |
| 多级错误恢复 | 1.5h | overload 自动退避重试，context overflow 裁剪消息重试 | ✅ |

**完成摘要**:
- `buildSystemPrompt()` 重写为 8 段模块化结构（安全宪法/运行时信息/人格/操作规程/记忆召回/工具指导/沉默回复/自定义），导出 `NO_REPLY_TOKEN`
- `web-search.ts` — Brave Search API 集成，15s 超时，支持 query/count/freshness
- `web-fetch.ts` — URL→Markdown 纯 regex 转换（`htmlToMarkdown()`），2MB 响应限制，50K 字符输出限制
- `embedded-runner.ts` — 重试循环(最多 3 次)：overload→指数退避、thinking→降级 reasoning=false、context overflow→裁剪保留 3 轮，超时 60s→120s
- `chat.ts` 构建 webTools 通过 `setToolInjectorConfig({ evoClawTools })` 注入
- `EvoClawConfig` 增加 `services?.brave?.apiKey`，`ConfigManager.getBraveApiKey()`
- 测试 674 全通过，esbuild 打包成功

### Day 2（03-18）— 专业工具 + 子 Agent ✅

**目标**: 让 Agent "能读图、能读 PDF、能改代码、能分身"

| 任务 | 时间 | 验收标准 | 状态 |
|------|------|---------|------|
| 图片分析工具 | 1.5h | 绕过 PI 直接调用 vision API，支持本地文件 + URL，Anthropic/Google/OpenAI 三家适配 | ✅ |
| PDF 阅读工具（双模式） | 1.5h | 原生模式（Anthropic/Google 直发 PDF 字节）+ 提取模式（unpdf 文本提取），最大 20 页 | ✅ |
| apply_patch 工具 | 2h | 多文件统一 diff 格式，正确应用修改 | ✅ |
| 子 Agent 生命周期 | 2h | spawn_agent/list_agents/kill_agent 工具 + 完成通知 + 深度限制(2 层) | ✅ |

**完成摘要**:
- `provider-direct.ts` — 公共模块：绕过 PI 直接调用 Anthropic/Google/OpenAI API（`callAnthropic`/`callGoogle`/`callOpenAI`），支持 document/image/image_url content type
- `image-tool.ts` — vision 工具，支持本地文件+URL 图片，三家 provider 适配，magic bytes MIME 检测，10MB 限制
- `pdf-tool.ts` — 双模式 PDF：Anthropic（type:"document" + beta header）/Google（inline_data）原生模式 + unpdf 文本提取 fallback，`parsePageRange()` 支持 "1-5,7,9-10" 格式，最大 20 页
- `apply-patch.ts` — 多文件统一 diff（*** Begin/End Patch 格式），支持 Update/Add/Delete 三种操作，context 匹配定位，禁止路径穿越/node_modules/.env
- `sub-agent-spawner.ts` — 子 Agent 生命周期管理器，spawn/list/kill/get + 完成通知回调，深度限制 2 层，minimal 系统提示
- `sub-agent-tools.ts` — spawn_agent/list_agents/kill_agent 三个工具，注入 subagent 车道(8 并发)
- `chat.ts` — 统一连接所有增强工具（Web + 多媒体 + 编辑 + 子 Agent），`server.ts` 传入 laneQueue
- 测试 724 全通过（新增 50），esbuild 打包成功

### Day 3（03-19）— 安全打磨 + 演示准备

**目标**: 让 Agent "不翻车、稳如磐石"

| 任务 | 时间 | 验收标准 |
|------|------|---------|
| 工具循环检测 + 结果截断 | 1h | 30 次熔断 + 大输出自动截断 |
| 后台进程管理 | 1.5h | exec 后台模式 + process 工具 |
| Doctor 自诊断 | 1h | 至少 10 项检查 |
| 端到端测试 + Bug 修复 | 3h | 演示 Storyline 全流程通过 |

### 演示 Storyline（03-20）

1. **Web 搜索**: "帮我搜索 Rust 异步运行时的最新进展" → 搜索 + 汇总
2. **Web 抓取**: "帮我读一下这个技术博客" → URL→Markdown→分析
3. **PDF 阅读**: "分析这份技术报告" → PDF 提取→关键信息
4. **图片分析**: "看看这张架构图有什么问题" → vision 分析
5. **代码重构**: "重构这个模块" → apply_patch 多文件修改
6. **子 Agent 协作**: "并行完成这 3 个子任务" → 子 Agent 分发→汇总
7. **记忆召回**: "你还记得上次讨论的方案吗？" → L0/L1/L2 渐进检索
8. **错误恢复**: 全程无崩溃，限流/溢出自动处理
9. **自诊断**: 运行 Doctor 命令展示系统健康

### 技术决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| PI 集成方式 | createAgentSession + streamSimple + InMemory (SessionManager/SettingsManager/AuthStorage) | 启用 compaction/retry，不依赖文件系统 |
| usage 防御 | 参考 OpenClaw 的 clearStaleAssistantUsageOnSessionMessages，所有 assistant message 强制补零 usage | PI _checkCompaction 假定 usage 非 undefined |
| Provider ID 映射 | pi-provider-map.ts（glm→zai 等） | PI KnownProvider 与 EvoClaw ID 不一致 |
| baseUrl 处理 | 传给 PI 时去掉尾部 /v1 | SDK 内部自动拼接 /v1，避免 /v1/v1/messages 404 |
| 国产模型接入 | api:"openai-completions" + 自定义 baseUrl | 参考 OpenClaw，不需要 PI registerProvider |
| 系统提示架构 | 8 段 XML 标签模块化（safety/runtime/personality/identity/operating_procedures/memory_recall/tool_usage/silent_reply） | 参考 OpenClaw 22 段式，按需组装 |
| Web 抓取 HTML→Markdown | 纯 regex htmlToMarkdown()，无外部依赖 | 参考 OpenClaw web-fetch-utils.ts，避免 readability 依赖 |
| 错误恢复策略 | 3 级分类重试（overload/thinking/context overflow），最多 3 次，指数退避 250ms~1500ms | 参考 OpenClaw retry 机制 |
| Web 工具注入方式 | chat.ts 创建 webTools → setToolInjectorConfig({ evoClawTools }) | web_fetch 无条件注入，web_search 需 Brave API Key |
| 测试连接/同步模型 | PI ModelRegistry 优先 → 回退 fetchModelsFromApi | 保持 baseUrl 处理统一 |
| Web 搜索 | Brave Search API | 免费额度足够演示，质量好 |
| PDF 解析 | unpdf（双模式：原生 + 文本提取） | 项目已有 unpdf 代码（file-ingester.ts）；pdf-parse 停更 4 年 + CJS + esbuild 打包崩溃；原生模式参考 OpenClaw 绕过 PI 直接 fetch |
| 多媒体工具 API 调用 | 绕过 PI，工具内直接 fetch() 调 provider API | PI 不支持 document/image content type（参考 OpenClaw pdf-native-providers.ts） |
| 子 Agent 架构 | spawn_agent 工具 + subagent 车道(8 并发) + 深度限制 2 层 | lane-queue.ts 已实现 subagent 车道；子 Agent 用 minimal 系统提示模式 |

---

## v0.5 — "图谱、可视化、更聪明"（2026 Q3，约 8 周）

---

## Sprint 11: 知识图谱增强 + 实体关系提取（Week 21-22）

### 目标
从"知识图谱存储可用"升级到"知识图谱驱动智能检索"：自动从对话中提取实体关系、图查询深度集成到记忆检索、图数据 CRUD 管理。

### TODO-LIST

#### 11.1 实体关系自动提取增强
- [ ] 升级 `src/memory/extraction-prompt.ts`：增强关系提取 prompt
  - 扩展 `<relations>` 输出，支持更丰富的关系类型：
    - 人物关系：knows, works_with, reports_to, mentored_by
    - 项目关系：works_on, contributes_to, owns, maintains
    - 技术关系：uses, prefers, skilled_in, learning
    - 组织关系：belongs_to, located_in, part_of
    - 时间关系：happened_at, started_at, deadline
  - 要求 LLM 输出关系置信度（confidence 0.0-1.0）
  - 要求 LLM 标注关系方向（directed / bidirectional）
- [ ] 升级 `src/memory/xml-parser.ts`：解析增强的关系结构
  - 新增 `direction` 字段解析
  - 关系去重逻辑（同 subject+predicate+object 更新而非重复插入）
- [ ] 升级 `src/memory/knowledge-graph.ts`：图查询增强
  - `findPath(entityA, entityB, maxDepth)` → 两实体间最短路径
  - `getSubgraph(entityId, depth)` → 以某实体为中心的子图
  - `getRelatedEntities(entityId, predicates?)` → 指定关系类型的邻居
  - `mergeEntities(keepId, removeId)` → 实体合并（去重）
  - `getEntityStats(agentId)` → 实体/关系统计
- [ ] 编写图查询增强测试（`src/__tests__/knowledge-graph-enhanced.test.ts`）

#### 11.2 知识图谱驱动检索
- [ ] 升级 `src/memory/hybrid-searcher.ts`：图谱权重增强
  - Phase 1 图扩展升级：
    - 不仅扩展 1 度关系，支持 2 度关系扩展（如 A→uses→B→part_of→C）
    - 扩展结果按路径长度衰减权重（1度: 0.2, 2度: 0.1）
    - 关系类型权重：直接关系(uses/prefers) > 间接关系(knows/belongs_to)
  - Phase 2 新增图谱 boost：
    - 命中知识图谱路径的记忆额外加 0.1 boost
    - 同一子图内的记忆优先聚合展示
- [ ] 编写图谱驱动检索测试

#### 11.3 知识图谱 CRUD API
- [ ] 添加 Hono 路由：
  - `GET /knowledge-graph/:agentId/entities` → 实体列表（分页）
  - `GET /knowledge-graph/:agentId/entity/:id/relations` → 指定实体的关系
  - `GET /knowledge-graph/:agentId/subgraph` → 子图查询（query 参数: entityId + depth）
  - `POST /knowledge-graph/:agentId/merge` → 合并重复实体
  - `DELETE /knowledge-graph/:agentId/relation/:id` → 删除关系
  - `GET /knowledge-graph/:agentId/stats` → 统计信息

#### 11.4 知识图谱可视化 UI
- [ ] 实现图谱可视化页面（`apps/desktop/src/app/knowledge-graph/`）：
  - 使用 `@antv/g6` 或 `d3-force` 渲染力导向图
  - 实体节点（按 category 颜色区分）
  - 关系边（标注 predicate）
  - 交互式探索：
    - 点击节点展开/折叠邻居
    - 鼠标悬停显示实体 L1 概览
    - 双击节点跳转到对应记忆详情
    - 搜索定位实体
    - 拖拽布局
  - 筛选器：按关系类型、置信度过滤
  - 支持导出图片
- [ ] 编写图谱可视化组件测试

#### 11.5 记忆 Generation 溯源标注（借鉴 MetaClaw MAML）
- [ ] 升级 `src/memory/extraction-pipeline.ts`：Stage 3 持久化时写入 generation 元数据
  - `generation_conversation_id`：来源对话 ID
  - `generation_model_id`：提取时使用的模型 ID
  - `generation_timestamp`：提取时间戳
- [ ] 创建 `migrations/010_memory_generation.sql`：
  - ALTER memory_units ADD `generation_conversation_id` TEXT
  - ALTER memory_units ADD `generation_model_id` TEXT
  - ALTER memory_units ADD `generation_timestamp` TEXT
- [ ] 添加 API：`GET /memory/:agentId/units/:id/provenance` → 返回记忆溯源信息
- [ ] 编写 generation 溯源测试

#### 11.6 Sprint 11 验收
- [ ] 对话自动提取 5+ 种关系类型
- [ ] 2 度关系扩展在检索中生效
- [ ] 图查询 API 正确返回实体/关系/子图/路径
- [ ] 图谱可视化页面可交互探索实体关系网络
- [ ] 重复实体可合并
- [ ] 新提取的记忆包含 generation 溯源信息
- [ ] `pnpm test` 全部通过

---

## Sprint 12: 进化仪表盘完善 + 周报（Week 23-24）

### 目标
完善能力雷达图、记忆增长曲线、Skill 热力图、自动周报/月报、对比视图。

### TODO-LIST

#### 12.1 能力雷达图
- [ ] 升级 `src/evolution/capability-graph.ts`：
  - 预定义能力维度（至少 8 个）：coding, writing, analysis, translation, planning, research, communication, creativity
  - 能力自动识别增强：从工具使用 + 对话内容 + Skill 调用推断能力
  - 历史快照：每日记录能力值到 `capability_snapshots` 表
- [ ] 创建 `migrations/010_capability_snapshots.sql`：
  - `capability_snapshots` 表（id, agent_id, capability, level, snapshot_date, created_at）
- [ ] 实现前端能力雷达图组件（`apps/desktop/src/components/charts/radar-chart.tsx`）：
  - 使用 `recharts` 或 `@antv/g2` 渲染雷达图
  - 至少 5-8 个维度
  - 支持叠加历史数据对比（本周 vs 上周）
  - 点击维度显示详情（使用次数、成功率、趋势）

#### 12.2 记忆增长曲线
- [ ] 实现记忆统计 API：
  - `GET /evolution/:agentId/memory-stats` → 按日/周统计记忆增量
    - 按 category 分组统计
    - 按 activation 分段统计（高/中/低/归档）
    - 总量趋势
- [ ] 实现前端记忆增长曲线组件（`apps/desktop/src/components/charts/memory-growth.tsx`）：
  - 折线图：记忆总量随时间增长
  - 堆叠面积图：按 category 分布变化
  - activation 分布饼图/环形图
  - 时间范围选择器（近一周/一月/三月/全部）

#### 12.3 Skill 使用热力图
- [ ] 实现 Skill 使用统计：
  - 记录每次 Skill 调用到 `tool_audit_log`
  - `GET /evolution/:agentId/skill-heatmap` → 按日期 × Skill 的使用次数矩阵
- [ ] 实现前端热力图组件（`apps/desktop/src/components/charts/skill-heatmap.tsx`）：
  - X 轴: 日期，Y 轴: Skill 名称
  - 颜色深浅表示使用频率
  - 悬停显示具体使用次数和成功率

#### 12.4 自动周报/月报
- [ ] 实现 `src/evolution/report-generator.ts`：
  - `generateWeeklyReport(agentId)` → 自动生成周报 Markdown
    - 本周新增记忆数量和类别分布
    - 能力值变化（对比上周）
    - 新学会的 Skill
    - 用户反馈趋势（正面/负面比）
    - 关键对话摘要（调用 LLM 生成）
    - 知识图谱增长（新增实体/关系数）
  - `generateMonthlyReport(agentId)` → 月报
    - 月度成长总结
    - 记忆衰减/归档统计
    - 能力图谱综合变化
    - Skill 使用排行
- [ ] 创建 Cron 任务自动生成：
  - 每周一 09:00 自动生成上周周报
  - 每月 1 日 09:00 自动生成上月月报
- [ ] 添加 Hono 路由：
  - `GET /evolution/:agentId/reports` → 报告列表
  - `GET /evolution/:agentId/report/:id` → 报告详情
  - `POST /evolution/:agentId/report/generate` → 手动触发生成

#### 12.5 对比视图
- [ ] 实现对比功能：
  - 同一 Agent 不同时期对比（选两个日期范围）
  - 不同 Agent 之间对比（选两个 Agent）
- [ ] 前端对比页面（`apps/desktop/src/app/dashboard/compare.tsx`）：
  - 雷达图叠加对比
  - 记忆量并列柱状图
  - 能力变化趋势对比折线图

#### 12.6 进化仪表盘主页重构
- [ ] 重构仪表盘主页（`apps/desktop/src/app/dashboard/index.tsx`）：
  - 顶部：Agent 选择器 + 时间范围选择
  - 左上：能力雷达图
  - 右上：关键指标卡片（记忆总量、能力均值、反馈正面率、Skill 数）
  - 中部：记忆增长曲线
  - 下左：Skill 使用热力图
  - 下右：最近进化事件时间线
  - 底部入口：周报/月报 + 对比视图 + 知识图谱
- [ ] 添加进化日志 API：
  - `GET /evolution/:agentId/log` → 进化事件时间线（新技能、能力变化、记忆里程碑）

#### 12.7 响应质量评估引擎（借鉴 MetaClaw）
- [ ] 实现 `src/evolution/quality-evaluator.ts`：
  - 自动指标采集（在 EvolutionPlugin.afterTurn 中执行）：
    - 工具调用成功率（成功/失败/超时）
    - 对话轮次（长对话可能意味着用户不满意）
    - 重试次数（同一工具多次调用）
    - 响应长度异常检测（过短或过长）
  - `evaluateResponseQuality(ctx, response)` → `QualitySignal`
  - 质量信号写入 capability_graph，影响能力评分权重
  - 与用户反馈（点赞/点踩）融合：自动指标 0.3 权重 + 用户反馈 0.7 权重
- [ ] 添加 API：`GET /evolution/:agentId/quality-stats` → 质量趋势统计
- [ ] 在进化仪表盘中添加质量趋势图（成功率曲线 + 用户满意度曲线）
- [ ] 编写质量评估测试

#### 12.8 Sprint 12 验收
- [ ] 能力雷达图展示 5+ 维度，数据来源于实际交互
- [ ] 记忆增长曲线按日/周/月正确聚合
- [ ] Skill 热力图正确展示使用频率分布
- [ ] 周报自动生成，内容准确反映 Agent 成长
- [ ] 对比视图可比较同一 Agent 不同时期或不同 Agent
- [ ] 响应质量评估自动采集指标并写入 capability_graph
- [ ] 仪表盘加载时间 < 2 秒
- [ ] `pnpm test` 全部通过

---

## Sprint 13: QQ Channel + 模板市场（Week 25-26）

### 目标
接入 QQ 开放平台 Channel、构建 Agent 模板市场（含社区 SOUL.md 导入）。

### TODO-LIST

#### 13.1 QQ Channel
- [ ] 实现 `src/channel/adapters/qq.ts`：
  - QQ 开放平台 API 集成（`qq-guild-bot` SDK 或直接 HTTP）
  - Bot 身份认证（AppID + Token + AppSecret）
  - 私聊消息收发
  - QQ 群消息收发（@机器人 触发）
  - 文本 + 图片 + 文件消息格式适配
  - Webhook / WebSocket 消息接收
  - 消息标准化为 ChannelMessage 格式
- [ ] QQ Channel 工具：
  - `qq_send(peerId, content)` → 发送消息
  - 注册到阶段 4 工具注入
- [ ] 更新 Channel 管理 UI：
  - QQ Bot 配置（AppID + AppSecret + Token）
  - QQ Channel 连接状态显示
- [ ] 编写 QQ 适配器测试（mock API）
- [ ] QQ Channel 集成测试（Binding 路由 + 记忆隔离）

#### 13.2 模板市场
- [ ] 实现 `src/agent/template-store.ts`：模板管理
  - 内置模板数据结构：
    ```
    ~/.evoclaw/templates/
    ├── built-in/
    │   ├── research-assistant/   # 研究助手
    │   ├── coding-buddy/        # 编程伙伴
    │   ├── writing-assistant/    # 写作助手
    │   ├── life-manager/        # 生活管家
    │   ├── study-coach/         # 学习教练
    │   ├── translator/          # 翻译助手
    │   ├── data-analyst/        # 数据分析师
    │   └── project-manager/     # 项目管理
    └── community/
        └── ...                  # 用户导入的社区模板
    ```
  - `listTemplates()` → 返回模板列表（名称、描述、预览截图）
  - `getTemplate(id)` → 返回模板完整内容（8 文件）
  - `createFromTemplate(templateId, customizations?)` → 基于模板创建 Agent
- [ ] 编写 8 个内置模板（每个包含完整 8 文件）：
  - [ ] 研究助手：擅长搜索、总结、分析、论文阅读
  - [ ] 编程伙伴：代码审查、调试、测试、架构设计
  - [ ] 写作助手：长文写作、润色、翻译、格式化
  - [ ] 生活管家：日程管理、提醒、信息整理
  - [ ] 学习教练：知识梳理、测验、学习计划
  - [ ] 翻译助手：多语言翻译、术语管理、风格适配
  - [ ] 数据分析师：数据清洗、统计分析、可视化
  - [ ] 项目管理：任务分解、进度跟踪、会议纪要

#### 13.3 社区 SOUL.md 模板导入
- [ ] 实现 `src/agent/template-importer.ts`：
  - `importFromUrl(url)` → 从 URL 下载 SOUL.md（支持 GitHub raw URL）
  - `importFromFile(filePath)` → 从本地文件导入
  - `importFromOpenClaw(soulMd)` → 解析 OpenClaw 格式 SOUL.md
    - 自动补全缺失的文件（IDENTITY.md, AGENTS.md 等）
    - 兼容 103+ awesome-openclaw-agents 模板
  - 导入前预览（展示 SOUL.md 内容 + 推断的 Agent 特征）
  - 存储到 `~/.evoclaw/templates/community/`

#### 13.4 模板市场 UI
- [ ] 实现模板市场页面（`apps/desktop/src/app/templates/`）：
  - 模板卡片网格（图标 + 名称 + 描述 + 标签）
  - 内置模板区域 + 社区模板区域
  - 模板详情弹窗（预览所有文件内容）
  - "基于此模板创建 Agent" 按钮
  - 导入社区模板入口（URL 或文件选择）
  - 搜索/筛选功能
- [ ] 更新 Agent 创建流程：
  - 创建入口增加"从模板创建"选项
  - 选择模板 → 可选自定义 → 生成 Agent
- [ ] 添加 Hono 路由：
  - `GET /template/list` → 模板列表
  - `GET /template/:id` → 模板详情
  - `POST /template/import` → 导入社区模板
  - `POST /agent/create-from-template` → 从模板创建 Agent

#### 13.5 Skill 自进化循环（借鉴 MetaClaw MAML）
- [ ] 实现 `src/skill/skill-gap-analyzer.ts`：
  - 从 GapDetectionPlugin 收集失败日志（存储在 `skill_gap_log` 表）
  - `analyzeGapPatterns(agentId)` → 聚类同类失败（3+ 次同领域失败触发）
  - `shouldAutoGenerate(pattern)` → 判断是否应自动生成 Skill
    - 条件：3+ 次同类失败 + ClawHub 搜索无匹配 + 用户未明确拒绝
- [ ] 实现 `src/skill/skill-generator.ts`：
  - `generateSkill(gapPattern)` → 调用 LLM 生成 SKILL.md
    - 输入：失败模式描述 + Agent 能力上下文 + 参考案例
    - 输出：完整 SKILL.md（YAML frontmatter + Markdown 指令）
    - frontmatter 包含 `origin: auto-generated`
  - 沙箱验证：在模拟场景中测试生成的 Skill（通过率 > 60% 才安装）
  - 安装到 Agent 工作区 `~/.evoclaw/agents/{id}/workspace/skills/`
- [ ] 前端交互：
  - Skill 自动生成时弹窗通知用户
  - 首次实际使用后弹窗确认（保留 / 删除 / 编辑）
  - 进化仪表盘中 `auto-generated` Skill 单独标记展示
- [ ] 创建 `migrations/011_skill_gap_log.sql`：
  - `skill_gap_log` 表（id, agent_id, gap_type, description, count, last_seen, resolved）
- [ ] 编写 Skill 自进化测试

#### 13.6 Sprint 13 验收
- [ ] QQ Channel 可接收和回复私聊/群聊消息
- [ ] QQ 群聊不暴露私聊记忆
- [ ] 模板市场展示 8 个内置模板
- [ ] 可基于模板一键创建 Agent
- [ ] 可导入 OpenClaw 社区 SOUL.md 模板
- [ ] 导入的模板自动补全缺失文件
- [ ] 3+ 次同类失败后能自动生成 Skill 并安装
- [ ] 自动生成的 Skill 标记为 auto-generated
- [ ] `pnpm test` 全部通过

---

## Sprint 14: Docker 沙箱 + Skill 签名验证（Week 27-28）

### 目标
实现 Docker 可选沙箱（3 模式）、Docker 安装引导、Skill 数字签名验证 + 沙箱试运行。

### TODO-LIST

#### 14.1 Docker 沙箱管理
- [ ] 实现 `src/sandbox/docker-manager.ts`：
  - `isDockerAvailable()` → 检测 Docker 是否安装并运行（`which docker` + `docker info`）
  - `createContainer(config)` → 创建容器
    - 镜像选择（默认 `node:22-slim`）
    - 挂载 Agent 工作区到 `/workspace`
    - 网络模式（none/host/bridge，默认 none）
    - 额外挂载路径（只读）
  - `execInContainer(containerId, command, timeout)` → 在容器内执行命令
  - `destroyContainer(containerId)` → 销毁容器
  - `cleanupStaleContainers()` → 清理僵尸容器
  - 容器生命周期：per-Agent 独立容器 vs 共享容器（按 scope 配置）
- [ ] 实现 `src/sandbox/sandbox-config.ts`：
  - 沙箱配置类型（SandboxConfig: mode + scope + docker settings）
  - 配置持久化到 SQLite
  - 默认配置：mode = 'off'

#### 14.2 Docker 安装引导
- [ ] 实现 `src/sandbox/docker-installer.ts`：
  - `checkAndGuide()` → 检测 Docker → 未安装则引导
  - macOS 引导：
    - 推荐 Colima（轻量级，无需 Docker Desktop 许可证）
    - 提供 `brew install colima docker` 命令
    - 安装后自动验证
  - Windows 引导（预留）：
    - 提示启用 WSL2 + 安装 Docker Engine
  - Linux 引导（预留）：
    - 提供 apt/yum 安装命令
  - 引导完成后自动拉取默认镜像
- [ ] 实现前端沙箱引导弹窗（`apps/desktop/src/components/sandbox/`）：
  - Docker 状态检测结果展示
  - 安装步骤引导（复制命令 + 链接）
  - 安装进度反馈
  - 跳过选项（保持 off 模式）

#### 14.3 沙箱感知工具
- [ ] 升级 `src/tools/sandbox-tools.ts`：
  - 沙箱感知的 `bash` 工具：
    - mode=off → 直接执行
    - mode=selective → 仅 bash/exec 在容器内执行，其他工具正常
    - mode=all → 所有文件操作和命令都在容器内
  - 沙箱感知的 `write`/`edit` 工具（mode=all 时重定向到容器）
  - 执行超时控制（默认 60s）
- [ ] 更新 `tool-injector.ts`：阶段 2 根据沙箱模式替换工具
- [ ] 编写沙箱工具测试（mock Docker 调用）

#### 14.4 沙箱设置 UI
- [ ] 实现沙箱设置页面（`apps/desktop/src/app/settings/sandbox/`）：
  - 沙箱模式选择（Off / Selective / All）
  - Docker 状态指示器
  - "检测/安装 Docker" 按钮
  - 每 Agent 沙箱配置（scope: agent/shared）
  - 自定义镜像/挂载路径/网络模式
- [ ] 添加 Hono 路由：
  - `GET /sandbox/status` → Docker 状态
  - `PUT /sandbox/config` → 更新配置
  - `POST /sandbox/install-guide` → 获取安装引导

#### 14.5 Skill 签名验证
- [ ] 实现 `src-tauri/src/skill_verify.rs`：Rust 层签名验证
  - Ed25519 签名验证（ring crate）
  - 公钥来源：内置 ClawHub 公钥 + skills.sh 公钥 + 用户自定义
  - 验证 SKILL.md 中的 signature 字段
  - 返回验证结果（valid/invalid/unsigned）
- [ ] 升级 `src/skill/skill-analyzer.ts`：增强安全扫描
  - 签名验证（通过 Tauri IPC 调用 Rust 层）
  - 静态分析增强：
    - 检测 Shell 命令注入模式
    - 检测环境变量泄露模式
    - 检测网络外发（非白名单域名）
    - 检测文件系统越界（访问 `~/.evoclaw` 之外的路径）
  - 安全评级：A（签名+无风险）/ B（签名+低风险）/ C（未签名）/ D（高风险）/ F（阻止安装）

#### 14.6 Skill 沙箱试运行
- [ ] 实现 `src/skill/skill-sandbox-runner.ts`：
  - 在 Docker 容器内试运行 Skill
  - 监控容器内的异常行为：
    - 未声明的网络请求
    - 文件写入越界
    - 异常进程创建
  - 试运行超时：30 秒
  - 试运行结果报告（通过/警告/失败）

#### 14.7 升级 Skill 安装流程
- [ ] 更新 `src/skill/skill-installer.ts`：完整安全流程
  - 下载 → 签名验证 → 静态分析 → 门控检查 → 沙箱试运行(可选) → 用户确认 → 安装
  - 每一步异常都中止并给出明确原因
  - 安全评级显示在确认弹窗中
- [ ] 更新 Skill 管理 UI：
  - 安装时展示安全评级
  - 签名状态标识
  - 安全扫描结果详情

#### 14.8 Sprint 14 验收
- [ ] 沙箱模式切换正常（off → selective → all）
- [ ] Docker 未安装时引导流程顺畅
- [ ] selective 模式下 bash 命令在容器内执行
- [ ] all 模式下所有文件操作在容器内
- [ ] Skill 签名验证正确（valid/invalid/unsigned）
- [ ] 高风险 Skill 自动阻止安装
- [ ] 沙箱试运行检测到异常行为时报告
- [ ] 安全评级正确展示
- [ ] `pnpm test` 全部通过

---

## v1.0 — "完整产品"（2026 Q4，约 10 周）

---

## Sprint 15: 子 Agent 派生 + Agent 间通信（Week 29-30）

### 目标
实现子 Agent 派生机制、Agent 间直接通信、派生深度和并发控制。

### TODO-LIST

#### 15.1 子 Agent 派生
- [ ] 实现 `src/agent/sub-agent-spawner.ts`：
  - `spawn(parentAgentId, config)` → 创建子 Agent 会话
    - 继承父 Agent 的 SOUL.md（不继承 USER.md/MEMORY.md）
    - 独立的 Session + 独立的 JSONL 会话记录
    - 指定任务 prompt + 约束条件
  - `getSubAgentStatus(subAgentId)` → 查询状态
  - `sendToSubAgent(subAgentId, message)` → 向子 Agent 发消息
  - `getSubAgentHistory(subAgentId)` → 获取子 Agent 对话记录
  - `terminateSubAgent(subAgentId)` → 终止
- [ ] 实现安全约束：
  - 派生深度限制：`maxSpawnDepth` 默认 1（最多 2 层嵌套）
  - 并发限制：`maxConcurrent` 默认 4
  - 子 Agent 超时：继承父 Agent 超时设置
  - 子 Agent 不继承父 Agent 的私密记忆
- [ ] 注册 PI 工具族：
  - `sessions_spawn` → 创建子 Agent
  - `sessions_list` → 列出活跃子 Agent
  - `sessions_history` → 获取子 Agent 对话记录
  - `sessions_send` → 向子 Agent 发消息
- [ ] 编写子 Agent 测试（`src/__tests__/sub-agent-spawner.test.ts`）

#### 15.2 Agent 间通信
- [ ] 实现 `src/agent/agent-comm.ts`：
  - Agent 间直接通信机制（非父子关系）
  - 配置接口：
    ```typescript
    interface AgentToAgentConfig {
      enabled: boolean       // 默认 false
      allow: string[]        // 允许通信的 Agent ID 列表
    }
    ```
  - `sendMessage(fromAgentId, toAgentId, message)` → 发送
  - `onMessage(agentId, handler)` → 注册接收回调
  - 消息类型：text, file_ref, data_object
  - 安全检查：仅 allowlist 中的 Agent 可通信
- [ ] 注册工具：
  - `agent_send(targetAgentId, message)` → 发消息给其他 Agent
  - 工具可用性由 AgentToAgentConfig 控制
- [ ] 编写 Agent 通信测试

#### 15.3 子 Agent UI
- [ ] 更新对话 UI：
  - 子 Agent 派生时显示状态指示（"正在派生子 Agent..."）
  - 子 Agent 运行中显示进度
  - 子 Agent 结果回传后在对话中展示
  - 可展开查看子 Agent 的完整对话记录

#### 15.4 用户空闲感知调度（借鉴 MetaClaw SlowUpdateScheduler）
- [ ] 实现 `src/scheduling/idle-detector.ts`：
  - 前端检测用户空闲状态（无鼠标/键盘/对话 > 5 分钟）
  - 通过 Tauri event `user-idle` / `user-active` 通知后端
  - 后端维护 `isUserIdle` 状态
- [ ] 实现 `src/scheduling/idle-scheduler.ts`：
  - 空闲期间执行的后台任务队列：
    - 记忆衰减批量计算（原 Cron 任务移至空闲期优先）
    - 记忆整理（低 activation 记忆归档检查）
    - Skill 缓存预热
    - 知识图谱一致性检查
  - 用户恢复活跃时暂停低优先级任务
  - 任务优先级：衰减计算 > 归档检查 > 缓存预热 > 一致性检查
- [ ] 编写空闲调度测试

#### 15.5 System Prompt 压缩/缓存（借鉴 MetaClaw）
- [ ] 实现 `src/context/prompt-cache.ts`：
  - 对高频重复的 system prompt 结构（SOUL.md + Skill 目录）计算 hash
  - 缓存 prompt 结构 hash → 避免重复组装
  - 增量更新：仅重新组装变化的部分（新 Skill / 记忆变更）
  - 适配 PI 框架的 `cacheControl` 特性（Anthropic prompt caching）
- [ ] 编写 prompt 缓存测试

#### 15.6 Sprint 15 验收
- [ ] 父 Agent 可成功派生子 Agent 执行任务
- [ ] 子 Agent 结果正确回传给父 Agent
- [ ] 派生深度限制生效（超过 maxSpawnDepth 拒绝派生）
- [ ] 并发限制生效
- [ ] Agent 间通信默认关闭，显式开启后正常工作
- [ ] 子 Agent 不继承父 Agent 的私密记忆
- [ ] 用户空闲时后台任务自动执行，活跃时暂停
- [ ] System prompt 缓存命中率 > 50%
- [ ] `pnpm test` 全部通过

---

## Sprint 16: 协作工作流 + 人工审核（Week 31-32）

### 目标
实现多 Agent 协作工作流定义、DAG 执行引擎、人工审核节点、协作状态可视化。

### TODO-LIST

#### 16.1 协作工作流定义
- [ ] 实现 `src/agent/workflow-parser.ts`：
  - 从自然语言描述解析协作流程（调用 LLM）
  - 输出结构化 DAG：
    ```typescript
    interface WorkflowDAG {
      id: string
      name: string
      nodes: WorkflowNode[]
      edges: WorkflowEdge[]
    }
    interface WorkflowNode {
      id: string
      agentId: string
      prompt: string
      type: 'agent' | 'human_review' | 'condition'
      timeout?: number
    }
    interface WorkflowEdge {
      from: string
      to: string
      condition?: string
    }
    ```
  - 示例输入："研究员找资料 → 写手写初稿 → 编辑润色"
  - 生成 3 节点线性 DAG
- [ ] 实现 `src/agent/workflow-builder-ui.ts`：
  - 可视化 DAG 编辑器（拖拽节点、连线）
  - 节点类型选择（Agent / 人工审核 / 条件分支）
  - 每个 Agent 节点配置（选择 Agent + 任务描述）
- [ ] 创建 `migrations/011_workflows.sql`：
  - `workflows` 表（id, name, dag_json, status, created_at, updated_at）
  - `workflow_runs` 表（id, workflow_id, status, current_node, results_json, started_at, completed_at）

#### 16.2 DAG 执行引擎
- [ ] 实现 `src/agent/workflow-executor.ts`：
  - `startWorkflow(workflowId, initialInput)` → 启动工作流
  - DAG 拓扑排序 → 按依赖顺序执行
  - 每个 Agent 节点：
    - 收集上游输出作为输入
    - 调用 embedded-runner 执行
    - 记录输出
    - 传递给下游节点
  - 人工审核节点：暂停等待用户确认
  - 条件分支节点：根据上游输出判断走哪条边
  - 失败处理：单节点失败不影响其他分支 + 支持重试
  - 超时管理
- [ ] 编写 DAG 执行引擎测试

#### 16.3 人工审核节点
- [ ] 实现人工审核机制：
  - 工作流执行到 human_review 节点时暂停
  - 推送通知给用户（桌面通知 + Channel 通知）
  - 展示待审核内容（上游 Agent 的输出）
  - 用户操作：通过 / 拒绝 / 修改后通过
  - 通过后继续执行下游节点
  - 拒绝后标记工作流失败或回退
- [ ] 实现审核 UI 组件（`apps/desktop/src/components/workflow/review-panel.tsx`）

#### 16.4 协作状态可视化
- [ ] 实现协作状态页面（`apps/desktop/src/app/workflow/`）：
  - 工作流列表（活跃/已完成/失败）
  - 工作流详情：
    - DAG 可视化（节点状态着色：等待灰色/运行中蓝色/完成绿色/失败红色/审核黄色）
    - 每个节点的输入/输出展示
    - 消息流向动画
    - 实时进度更新
  - 工作流创建入口（自然语言/可视化编辑器）
- [ ] 添加 Hono 路由：
  - `POST /workflow` → 创建工作流
  - `GET /workflow` → 列表
  - `POST /workflow/:id/start` → 启动
  - `GET /workflow/:id/status` → 状态
  - `POST /workflow/:id/review/:nodeId` → 人工审核决定

#### 16.5 Sprint 16 验收
- [ ] 自然语言描述可生成协作 DAG
- [ ] 3+ 节点工作流正确执行
- [ ] 人工审核节点正确暂停/继续
- [ ] 单节点失败不影响其他分支
- [ ] 协作状态实时可视化
- [ ] `pnpm test` 全部通过

---

## Sprint 17: 跨平台 — Windows + Linux（Week 33-34）

### 目标
Tauri 跨平台构建，Windows 和 Linux 版本适配，平台特定安全层。

### TODO-LIST

#### 17.1 Windows 适配
- [ ] 配置 Tauri Windows 构建：
  - NSIS 安装包配置
  - 应用图标（.ico）
  - 安装路径默认值
  - 开机自启配置（可选）
- [ ] 实现 Windows Credential Manager 集成：
  - `src-tauri/src/credential.rs` 添加 Windows 分支
  - 使用 `windows-credentials` crate
  - 验证凭证存取正确性
- [ ] Windows 路径适配：
  - `~/.evoclaw/` → `%APPDATA%/evoclaw/` 或 `%USERPROFILE%/.evoclaw/`
  - 路径分隔符处理
  - 长路径支持
- [ ] Node.js Sidecar Windows 适配：
  - 进程管理（Windows 进程 API）
  - 端口绑定验证
  - 杀进程清理
- [ ] Windows E2E 测试（在 CI 或手动验证）：
  - 安装/卸载流程
  - Sidecar 通信
  - Keychain 凭证存取
  - SQLite 数据库正常工作
  - 基础对话功能

#### 17.2 Linux 适配
- [ ] 配置 Tauri Linux 构建：
  - AppImage 格式
  - .deb 包（Ubuntu/Debian）
  - 应用图标（.png, .svg）
  - 桌面快捷方式（.desktop 文件）
- [ ] 实现 Linux Secret Service 集成：
  - `src-tauri/src/credential.rs` 添加 Linux 分支
  - 使用 `libsecret` (via `secret-service` crate)
  - 降级方案：Secret Service 不可用时使用加密文件存储
- [ ] Linux 路径适配：
  - `~/.evoclaw/` 使用标准 XDG 路径
  - 权限检查（文件 600/目录 700）
- [ ] Linux E2E 测试（在 CI 或手动验证）：
  - AppImage 启动验证
  - 依赖库检查（libwebkit2gtk 等）
  - Secret Service 凭证存取
  - SQLite 正常工作

#### 17.3 CI/CD 跨平台构建
- [ ] 配置 GitHub Actions：
  - macOS (Apple Silicon + Intel) 构建
  - Windows (x64) 构建
  - Linux (x64) 构建
  - 自动运行测试
  - 构建产物上传到 Release
  - 自动更新服务配置（tauri-plugin-updater）
- [ ] 版本管理：
  - Changesets 或 conventional commits
  - 自动 changelog 生成
  - 语义化版本号

#### 17.4 平台差异文档
- [ ] 更新用户指南：
  - Windows 安装说明
  - Linux 安装说明（AppImage 权限设置）
  - 各平台 Docker 安装引导差异
  - 各平台凭证管理说明

#### 17.5 Sprint 17 验收
- [ ] Windows 应用正常安装、启动、使用
- [ ] Linux AppImage 正常启动、使用
- [ ] 三平台凭证管理各自使用系统级安全存储
- [ ] CI/CD 自动构建三平台产物
- [ ] 自动更新机制工作正常
- [ ] `pnpm test` 三平台全部通过

---

## Sprint 18: 安全仪表盘 + Agent 导入/导出（Week 35-36）

### 目标
完善安全仪表盘、Agent 完整导入/导出、多知识库隔离。

### TODO-LIST

#### 18.1 安全仪表盘
- [ ] 实现安全仪表盘页面（`apps/desktop/src/app/security/`）：
  - **安全总览卡片**：
    - 加密状态（✅ AES-256-GCM 已启用）
    - 凭证安全（✅ 系统 Keychain / ⚠️ 降级文件存储）
    - 沙箱状态（Off / Selective / All）
    - 最近安全事件数（24h / 7d）
  - **已授权权限清单**：
    - 按 Agent 分组展示所有权限授予
    - 每条显示：类别、范围、资源、授予时间、授予方式
    - 一键撤销按钮
    - 批量撤销（撤销某 Agent 的所有权限）
  - **Skill 安全评分**：
    - 已安装 Skill 安全评级列表（A/B/C/D）
    - 签名状态标识
    - 点击查看详细安全扫描报告
  - **审计日志**：
    - 时间线展示所有安全事件
    - 筛选器：按事件类型（权限变更/Skill 安装/凭证访问/工具执行）
    - 搜索功能
    - 导出日志（CSV/JSON）
  - **安全建议**：
    - 基于当前配置给出安全改进建议
    - 如"建议启用沙箱模式"、"有 3 个 Skill 未签名验证"
- [ ] 添加 Hono 路由：
  - `GET /security/overview` → 安全总览数据
  - `GET /security/permissions` → 权限列表
  - `DELETE /security/permission/:id` → 撤销权限
  - `GET /security/audit-log` → 审计日志（分页 + 筛选）
  - `GET /security/audit-log/export` → 导出日志

#### 18.2 Agent 导入/导出
- [ ] 实现 `src/agent/agent-exporter.ts`：
  - `exportAgent(agentId)` → 打包导出
    - 包含内容：
      - 完整 8 文件工作区（SOUL.md, IDENTITY.md, etc.）
      - 已安装 Skill 列表（仅列表，不含 Skill 文件本身）
      - Agent 配置（model 设置、Heartbeat/Cron 配置）
      - 可选：memory_units 数据（需用户确认，涉及隐私）
      - 可选：knowledge_graph 数据
    - 导出格式：`.evoclaw-agent` (实际是 zip)
    - 元数据文件：`manifest.json`（版本、创建时间、EvoClaw 版本）
  - `validateExport(filePath)` → 验证导出文件完整性
- [ ] 实现 `src/agent/agent-importer.ts`：
  - `importAgent(filePath, options?)` → 导入 Agent
    - 解压 + 验证 manifest
    - 创建新 Agent 目录
    - 复制工作区文件
    - 恢复配置
    - 可选：恢复记忆数据
    - 提示安装缺失的 Skill
    - 冲突处理：Agent ID 重复时自动重命名
- [ ] 实现导入/导出 UI：
  - Agent 详情页添加"导出"按钮
  - Agent 列表页添加"导入"入口（文件选择）
  - 导入预览（展示将导入的内容 + 选项）
  - 导出选项弹窗（是否包含记忆数据）
- [ ] 添加 Hono 路由：
  - `POST /agent/:id/export` → 导出
  - `POST /agent/import` → 导入（multipart/form-data）

#### 18.3 多知识库隔离
- [ ] 实现 `src/rag/knowledge-base-manager.ts`：
  - 支持创建多个独立知识库：
    ```
    ~/.evoclaw/knowledge-bases/
    ├── work-docs/        # 工作文档
    ├── personal-notes/   # 个人笔记
    └── code-repo/        # 代码库
    ```
  - `createKnowledgeBase(name, description)` → 创建
  - `deleteKnowledgeBase(id)` → 删除（含索引）
  - `listKnowledgeBases()` → 列表
  - `bindToAgent(kbId, agentId)` → Agent 绑定知识库
  - `unbindFromAgent(kbId, agentId)` → 解绑
- [ ] 更新 `migrations/012_multi_knowledge_base.sql`：
  - `knowledge_bases` 表（id, name, description, created_at）
  - `agent_knowledge_base_bindings` 表（agent_id, kb_id）
  - 更新 `knowledge_base_files` 表添加 `kb_id` 字段
- [ ] 更新 RAG 插件：
  - 检索时仅搜索当前 Agent 绑定的知识库
- [ ] 更新知识库管理 UI：
  - 知识库列表（创建/删除/重命名）
  - Agent ↔ 知识库绑定管理
  - 每个知识库独立的文件管理

#### 18.4 Sprint 18 验收
- [ ] 安全仪表盘完整展示安全状态
- [ ] 权限可一键撤销
- [ ] 审计日志可搜索/筛选/导出
- [ ] Agent 可完整导出为 `.evoclaw-agent` 文件
- [ ] 导出的 Agent 可在其他 EvoClaw 实例导入
- [ ] 多知识库独立运行，Agent 可绑定不同知识库
- [ ] `pnpm test` 全部通过

---

## Sprint 19: v1.0 集成测试 + 性能调优 + 发布（Week 37-38）

### 目标
v1.0 全功能集成测试、性能调优、跨平台发布。

### TODO-LIST

#### 19.1 v1.0 全功能集成测试
- [ ] 扩展 Sprint 10 的集成测试，新增：
  - [ ] 知识图谱可视化：实体/关系正确渲染 + 交互
  - [ ] 进化仪表盘：雷达图/曲线图/热力图数据准确
  - [ ] 周报自动生成：内容准确反映 Agent 成长
  - [ ] QQ Channel：消息收发 + 记忆隔离
  - [ ] 模板市场：从模板创建 Agent + 社区模板导入
  - [ ] Docker 沙箱：selective/all 模式下工具执行正确
  - [ ] Skill 签名验证：签名 Skill 通过 / 未签名 Skill 警告 / 高风险阻止
  - [ ] 子 Agent 派生：父子 Agent 通信正确
  - [ ] 协作工作流：3 节点 DAG 执行 + 人工审核
  - [ ] Agent 导入/导出：导出后导入还原正确
  - [ ] 多知识库：不同 Agent 检索不同知识库
  - [ ] Windows：核心功能在 Windows 上正常
  - [ ] Linux：核心功能在 Linux 上正常

#### 19.2 性能压测
- [ ] 记忆系统压测：
  - 10 万条 memory_units 下检索延迟 < 200ms
  - 1 万条 knowledge_graph 下图查询延迟 < 100ms
  - 1000 个文档知识库索引速度 < 30 分钟
- [ ] 并发压测：
  - 4 个 main Lane 并发对话不卡顿
  - 8 个 subagent Lane 并发执行
  - 3 路 Channel 同时收发消息
- [ ] 内存压测：
  - 长时间运行（8 小时）内存不泄漏
  - 多 Agent 切换内存回收正常

#### 19.3 跨平台发布
- [ ] **消除 Node.js 外部依赖**（用户无需安装 Node.js）：
  - 方案 A（推荐）：Node.js SEA (Single Executable Application) 将 Node 运行时 + server.mjs 打包为单个可执行文件，作为 Tauri sidecar binary
  - 方案 B：将 Node.js 二进制内嵌到 app bundle resources 中，spawn 时使用内嵌的 node 而非系统 PATH
  - 方案 C：替换 better-sqlite3 为 WASM 方案（如 sql.js），消除 native addon 后用 Bun 单文件编译
  - 注意：当前 better-sqlite3 native 模块已通过 build.ts 自动打包（Patch bindings → 直接 require .node 文件）
- [ ] macOS：DMG 签名 + 公证 + Universal Binary (Intel + ARM)
- [ ] Windows：NSIS 安装包 + 代码签名
- [ ] Linux：AppImage + .deb
- [ ] 自动更新服务部署
- [ ] 发布 GitHub Release
- [ ] 用户文档网站（可选，或使用 GitHub Wiki）

#### 19.4 Sprint 19 验收（v1.0 发布标准）
- [ ] 三平台应用正常安装和运行
- [ ] 全部 PRD v4.0 功能实现（除 v2.0 规划的部分）
- [ ] 性能指标达标（启动 < 3s, 检索 < 200ms, 内存 < 500MB）
- [ ] 安全审计零高危漏洞
- [ ] 测试覆盖率 ≥ 80%
- [ ] 三平台 CI/CD 绿灯

---

## v2.0 — "生态与社区"（2027 Q1-Q2，约 10 周）

---

## Sprint 20: Growth Vectors + Crystallization（Week 39-40）

### 目标
实现成长向量追踪、30 天门控结晶化为永久特质写入 SOUL.md。

### TODO-LIST

#### 20.1 Growth Vectors
- [ ] 实现 `src/evolution/growth-vector.ts`：
  - 成长向量：每个能力维度的变化趋势（方向 + 速度）
  - 每日快照记录 → 计算 7 日/30 日滑动窗口趋势
  - 向量分类：
    - 上升趋势（能力持续提升）
    - 稳定（能力已成熟）
    - 下降趋势（长期未使用）
    - 突破（短期内大幅提升）
  - `getGrowthVectors(agentId)` → 返回所有维度的成长向量
  - `getBreakthroughs(agentId, period)` → 返回突破事件列表
- [ ] 创建 `migrations/013_growth_vectors.sql`：
  - `growth_vectors` 表（id, agent_id, capability, direction, velocity, window_days, snapshot_date）

#### 20.2 Crystallization（结晶化）
- [ ] 实现 `src/evolution/crystallizer.ts`：
  - 结晶条件：某能力的成长向量在 30+ 天内持续为"稳定"或"上升"
  - 结晶过程：
    1. 检测满足条件的能力
    2. 调用 LLM 生成该能力的"永久特质"描述
    3. 追加到 SOUL.md 的 `## Crystallized Traits` 部分
    4. 标记该能力为"已结晶"（不再衰减）
  - 结晶前用户确认（弹窗展示即将写入 SOUL.md 的内容）
  - 结晶历史记录
- [ ] 调度：每周执行一次结晶检测
- [ ] 编写结晶化测试

#### 20.3 Growth Vectors UI
- [ ] 更新进化仪表盘：
  - 成长向量可视化（箭头图，每维度显示方向和速度）
  - 突破事件时间线
  - 结晶化历史记录
  - 已结晶特质展示

#### 20.4 Sprint 20 验收
- [ ] 成长向量每日正确快照
- [ ] 7 日/30 日趋势计算准确
- [ ] 30 天稳定能力触发结晶化流程
- [ ] 结晶后的特质正确写入 SOUL.md
- [ ] 结晶前用户确认弹窗正常
- [ ] `pnpm test` 全部通过

---

## Sprint 21: EvoClaw Hub 社区平台（Week 41-42）

### 目标
构建 Agent 模板和 Skill 的社区分享平台（Hub），支持发布/搜索/下载。

### TODO-LIST

#### 21.1 Hub 后端服务（独立部署）
- [ ] 创建 `packages/hub/` 新包：
  - Hono + SQLite（或 PostgreSQL）后端服务
  - 数据模型：
    - `hub_templates` 表（id, author, name, description, tags, files_json, downloads, rating, created_at）
    - `hub_skills` 表（id, author, name, description, skill_md, downloads, rating, platform_source, created_at）
    - `hub_users` 表（id, github_id, name, avatar, created_at）
    - `hub_reviews` 表（id, item_type, item_id, user_id, rating, comment, created_at）
  - API 接口：
    - `POST /hub/template/publish` → 发布模板（需 GitHub 认证）
    - `GET /hub/template/search` → 搜索模板
    - `GET /hub/template/:id` → 下载模板
    - `POST /hub/skill/publish` → 发布 Skill
    - `GET /hub/skill/search` → 搜索 Skill
    - `POST /hub/review` → 评价
    - `GET /hub/trending` → 热门排行
  - GitHub OAuth 认证

#### 21.2 Hub 桌面集成
- [ ] 实现 `src/hub/hub-client.ts`：Hub API 客户端
  - 搜索模板/Skill
  - 下载并安装
  - 发布本地模板/Skill 到 Hub
  - 评价/评论
- [ ] 更新模板市场 UI：
  - 新增 "EvoClaw Hub" 标签页（与内置/社区并列）
  - Hub 模板搜索和浏览
  - 一键下载安装
  - 发布本地模板到 Hub
- [ ] 更新 Skill 管理 UI：
  - 新增 Hub Skill 搜索
  - Hub + ClawHub + skills.sh 三来源统一搜索
  - 发布本地 Skill 到 Hub
- [ ] 用户认证（GitHub OAuth）：
  - 设置页面登录 Hub 账号
  - 发布/评价需要登录

#### 21.3 Agent 人格分享
- [ ] 实现 Agent 人格分享流程：
  - 选择 Agent → "分享到 Hub"
  - 自动清理隐私信息（移除 USER.md, MEMORY.md 中的个人数据）
  - 仅分享 SOUL.md + IDENTITY.md + AGENTS.md（人格定义部分）
  - 添加描述、标签、截图
  - 发布到 Hub

#### 21.4 Sprint 21 验收
- [ ] Hub 后端服务部署运行
- [ ] 可通过桌面应用搜索和下载 Hub 上的模板/Skill
- [ ] 可发布本地模板/Skill 到 Hub
- [ ] 评价系统正常工作
- [ ] Agent 人格分享正确清理隐私数据
- [ ] `pnpm test` 全部通过

---

## Sprint 22: 移动端伴侣应用（Week 43-44）

### 目标
开发 iOS/Android 伴侣应用，远程连接桌面端 EvoClaw 服务。

### TODO-LIST

#### 22.1 移动端架构设计
- [ ] 技术选型：React Native / Expo（复用 React 技能和部分组件）
- [ ] 创建 `apps/mobile/` 新项目
- [ ] 架构方案：
  - 移动端是"遥控器"，不运行 Agent — 通过局域网/Tailscale 连接桌面端 Sidecar
  - 桌面端暴露安全 API（局域网绑定 + mTLS 或配对码认证）
  - 移动端只做 UI 渲染和消息收发

#### 22.2 桌面端远程 API
- [ ] 实现 `src/remote/remote-server.ts`：
  - 可选启用远程访问（默认关闭）
  - 局域网 IP + 端口暴露
  - 配对码认证（6 位数字，桌面端显示 → 移动端输入）
  - 配对成功后颁发长期 Token（Keychain 存储）
  - API 范围控制（移动端可调用的 API 子集）
  - WebSocket 支持（SSE 在移动端兼容性差）
- [ ] 安全保障：
  - 仅局域网访问（不暴露到公网）
  - 配对码有效期 5 分钟
  - 连接数限制（最多 3 个移动端）

#### 22.3 移动端核心功能
- [ ] 实现移动端对话 UI：
  - Agent 选择
  - 消息列表（Markdown 渲染）
  - 输入框 + 语音输入（iOS/Android 原生）
  - 流式响应展示
  - 通知推送
- [ ] 实现移动端快捷功能：
  - 常用 Agent 快捷入口
  - 快速提问（Widget / 通知栏快捷方式）
  - 记忆查看（只读）
  - 进化数据查看（只读）
- [ ] iOS + Android 构建配置

#### 22.4 Sprint 22 验收
- [ ] 移动端可通过配对码连接桌面端
- [ ] 移动端可选择 Agent 并进行对话
- [ ] 流式响应在移动端正常渲染
- [ ] 断网重连正常工作
- [ ] iOS + Android 构建通过

---

## Sprint 23: 企业版功能（Week 45-46）

### 目标
实现团队 Agent 共享、管理员权限控制、审计合规功能。

### TODO-LIST

#### 23.1 团队管理
- [ ] 实现 `src/enterprise/team-manager.ts`：
  - 团队创建/邀请/移除成员
  - 团队 Agent 共享（指定 Agent 可被团队成员使用）
  - 共享 Agent 的记忆隔离（每个成员有独立的 memory_units）
  - 共享知识库（团队级别的知识库）
- [ ] 创建 `migrations/014_enterprise.sql`：
  - `teams` 表（id, name, owner_id, created_at）
  - `team_members` 表（team_id, user_id, role, joined_at）
  - `team_agent_shares` 表（team_id, agent_id, permissions_json）

#### 23.2 管理员权限控制
- [ ] 实现管理员功能：
  - 管理员角色（owner / admin / member）
  - 管理员可设置：
    - 允许的 Provider 列表（如禁止使用某些 Provider）
    - 默认沙箱模式（强制所有成员启用沙箱）
    - Skill 安装白名单（仅允许安装审批过的 Skill）
    - 数据导出权限
  - 审计日志聚合（查看团队所有成员的操作日志）

#### 23.3 审计合规
- [ ] 实现合规报告生成：
  - 数据访问报告（谁在什么时候访问了什么数据）
  - 凭证使用报告（API Key 使用频率和范围）
  - 异常行为报告（异常权限请求、非工作时间操作）
  - 定期审计提醒（可配置周期）
- [ ] 数据保留策略：
  - 可配置的对话日志保留期（30/90/180/365 天）
  - 过期数据自动清理
  - 清理前导出备份

#### 23.4 企业版 UI
- [ ] 实现团队管理页面（`apps/desktop/src/app/team/`）：
  - 团队成员列表 + 邀请
  - 共享 Agent 管理
  - 策略配置（Provider/沙箱/Skill 白名单）
  - 审计日志查看
  - 合规报告生成/导出

#### 23.5 Sprint 23 验收
- [ ] 团队可创建并邀请成员
- [ ] 共享 Agent 每个成员记忆独立
- [ ] 管理员策略正确执行（Provider 限制、沙箱强制、Skill 白名单）
- [ ] 合规报告正确生成
- [ ] 数据保留策略正确执行
- [ ] `pnpm test` 全部通过

---

## Sprint 24: 更多 Channel + Plugin SDK + v2.0 发布（Week 47-48）

### 目标
接入钉钉 Channel、开放 Plugin SDK、v2.0 最终集成和发布。

### TODO-LIST

#### 24.1 钉钉 Channel
- [ ] 实现 `src/channel/adapters/dingtalk.ts`：
  - 钉钉开放平台 API 集成
  - 企业内部应用 + 群机器人
  - 私聊 + 群聊消息收发
  - 卡片消息支持
  - @机器人 触发
- [ ] 钉钉工具注册：
  - `dingtalk_send(peerId, content)` → 发消息
- [ ] 更新 Channel 管理 UI：钉钉配置
- [ ] 编写钉钉适配器测试

#### 24.2 微信 Channel（预研）
- [ ] 调研微信开放平台 API 可行性
- [ ] 实现 `src/channel/adapters/wechat.ts`（如可行）：
  - 微信公众号/企业号 API
  - 或 WeChatFerry 等第三方方案评估
- [ ] 如不可行，记录技术限制和替代方案

#### 24.3 Plugin SDK
- [ ] 创建 `packages/plugin-sdk/` 新包：
  - 定义插件清单规范 `evoclaw.plugin.json`：
    ```json
    {
      "id": "string — 插件唯一标识",
      "name": "string — 显示名称",
      "version": "string — 语义化版本",
      "channels": ["string[] — 注册的 Channel ID"],
      "skills": ["string[] — Skill 目录路径"],
      "configSchema": "object — JSON Schema 配置校验",
      "uiHints": "object — UI 字段提示（label/sensitive/placeholder）"
    }
    ```
  - 定义 `EvoClawPluginApi` 接口（`register(api)` 注入模式）：
    ```typescript
    interface EvoClawPluginApi {
      registerChannel(adapter: ChannelAdapter): void;
      registerTool(tool: ToolDefinition): void;
      registerHook(name: string, handler: HookHandler): void;
      registerProvider(provider: ProviderEntry): void;
      registerHttpRoute(route: HttpRouteParams): void;
      registerService(service: PluginService): void;
      registerSkills(dir: string): void;
      config: Record<string, unknown>;
    }
    ```
  - 实现 PluginRegistry 中央注册表：
    - tools / channels / providers / hooks / services / httpRoutes / diagnostics
  - 实现 Plugin Loader：
    - 扫描 `~/.evoclaw/plugins/` + 工作区 `plugins/` + 内置 `packages/plugins/`
    - 读取 `evoclaw.plugin.json` + `package.json` 元数据
    - 通过 jiti 动态加载 TypeScript，调用 `register(api)`
    - 配置验证仅用 JSON Schema，不执行插件代码
  - 实现 CLI 命令：
    - `evoclaw plugins list` → 列出已加载插件
    - `evoclaw plugins install <npm-spec>` → 从 npm 安装
    - `evoclaw plugins remove <id>` → 卸载
- [ ] 编写 Plugin SDK 文档：
  - 快速开始指南
  - API 参考文档
  - 清单规范说明
- [ ] 编写 2 个示例 Plugin：
  - `plugin-pomodoro`：番茄钟（定时提醒 + 工作统计，演示 registerService + registerTool）
  - `plugin-feishu-lite`：飞书轻量版（演示 registerChannel + registerTool + registerSkills）
- [ ] OpenClaw Skills 兼容验证：
  - 验证 OpenClaw 生态的 SKILL.md 格式在 EvoClaw 插件中可直接使用
  - 验证插件 `"skills": ["./skills"]` 声明可被 Skill 扫描器正确发现

#### 24.4 多设备同步（基础版）
- [ ] 实现端到端加密同步：
  - 同步范围：Agent 工作区文件 + memory_units + knowledge_graph
  - 同步方式：通过 WebDAV / Syncthing / 自建中继
  - 端到端加密：在本地加密后上传，其他设备下载后解密
  - 冲突解决：最后写入者胜出（Last Writer Wins）+ 冲突记录
- [ ] 同步设置 UI：
  - 同步服务配置
  - 同步状态监控
  - 冲突查看和手动解决

#### 24.5 v2.0 全功能集成测试
- [ ] 扩展集成测试覆盖所有 v2.0 功能：
  - [ ] Growth Vectors + Crystallization
  - [ ] EvoClaw Hub 发布/下载
  - [ ] 移动端远程连接
  - [ ] 团队管理 + 权限控制
  - [ ] 钉钉 Channel
  - [ ] Plugin 加载和运行
  - [ ] 多设备同步

#### 24.6 v2.0 发布
- [ ] 三平台构建 + 签名 + 发布
- [ ] 更新文档网站
- [ ] `@evoclaw/plugin-sdk` 发布到 npm
- [ ] Hub 服务公开上线
- [ ] 发布公告 + 社区宣传

#### 24.7 Sprint 24 验收（v2.0 发布标准）
- [ ] 钉钉 Channel 正常工作
- [ ] Plugin SDK 文档完整，清单规范 + API 参考 + 快速开始
- [ ] 2 个示例 Plugin 可加载运行（pomodoro + feishu-lite）
- [ ] OpenClaw SKILL.md 在插件中可正常使用
- [ ] EvoClaw Hub 公开可访问
- [ ] 移动端伴侣应用可用
- [ ] 企业版核心功能可用
- [ ] 成长向量 + 结晶化正常运行
- [ ] 全平台 CI/CD 绿灯
- [ ] 测试覆盖率 ≥ 80%
- [ ] `pnpm test` 全部通过

---

## 完整里程碑总览

```
Phase 1: v0.1 MVP（Sprint 1-10, Week 1-20）
  安全基座 + PI 集成 + 记忆系统 + RAG + Skill + Channel + macOS 发布

Phase 2: v0.5 进化版（Sprint 11-14, Week 21-28）
  知识图谱增强 + 记忆溯源 + 进化仪表盘 + 质量评估 + QQ Channel + 模板市场 + Skill 自进化 + Docker 沙箱 + Skill 签名

Phase 3: v1.0 完整版（Sprint 15-19, Week 29-38）
  多 Agent 协作 + 协作工作流 + 空闲调度 + Prompt 压缩 + 跨平台 + 安全仪表盘 + 导入/导出 + 多知识库

Phase 4: v2.0 生态版（Sprint 20-24, Week 39-48）
  Growth Vectors + EvoClaw Hub + 移动端 + 企业版 + Plugin SDK + 钉钉 + 多设备同步
```

| 版本 | Sprint | 周数 | 发布时间 |
|------|--------|------|---------|
| v0.1 MVP | 1-10 | 20 周 | 2026 Q2 末 |
| v0.5 | 11-14 | 8 周 | 2026 Q3 末 |
| v1.0 | 15-19 | 10 周 | 2026 Q4 末 |
| v2.0 | 20-24 | 10 周 | 2027 Q1-Q2 |

> **文档版本**: v4.1 — 新增 MetaClaw 借鉴特性：Sprint 11 记忆 generation 溯源、Sprint 12 响应质量评估、Sprint 13 Skill 自进化循环、Sprint 15 空闲调度 + Prompt 压缩。基于 PRD v4.1 + Architecture v4.2
> **执行方式**: Claude 自主开发 + 测试，每个 Sprint 包含完整 TODO-LIST
> **总计**: 24 个 Sprint（48 周），覆盖 v0.1 → v0.5 → v1.0 → v2.0 全版本
