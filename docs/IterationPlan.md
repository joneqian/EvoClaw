# EvoClaw 迭代开发计划

> **文档版本**: v2.0
> **创建日期**: 2026-03-12
> **更新日期**: 2026-03-12
> **适用范围**: v0.1 MVP → v0.5 → v1.0 → v2.0

---

## 总览

```
v0.1 MVP (10 周)                    v0.5 (8 周)              v1.0 (10 周)
├── Sprint 1: 地基 (W1-W2)  ✅     ├── Sprint 5 (W1-W3)     ├── Sprint 8 (W1-W3)
├── Sprint 2: 引擎 (W3-W4)  ✅     ├── Sprint 6 (W4-W6)     ├── Sprint 9 (W4-W7)
├── Sprint 3: 记忆层 (W5-W6)       └── Sprint 7 (W7-W8)     └── Sprint 10 (W8-W10)
└── Sprint 4: LCM+向量 (W7-W10)
```

每个 Sprint 采用 **2 周一迭代**（Sprint 4 例外，含打包发布，4 周）。
每个 TODO 标注优先级：🔴 阻塞项 / 🟡 重要 / 🟢 可选。

---

## v0.1 MVP — "安全、记忆、可用"

### Sprint 1: 地基搭建（Week 1-2）✅

> **目标**: 项目脚手架跑通 + 安全基座就绪 + 最简对话能跑通

#### 🏗️ 工程脚手架

- [x] 🔴 初始化 pnpm monorepo + Turborepo 配置
- [x] 🔴 创建 `apps/desktop` — Tauri 2.0 项目（Rust + React + TypeScript）
- [x] 🔴 创建 `packages/core` — Node.js Sidecar 骨架（Hono HTTP 服务）
- [x] 🔴 创建 `packages/shared` — 共享类型定义（Agent, Message, Soul, Memory 等）
- [x] 🔴 创建 `packages/model-providers` — 模型 Provider 包骨架
- [x] 🟡 配置 Vitest 测试框架 + Oxlint 代码检查
- [x] 🟡 配置 Turborepo 构建管道（dev / build / test / lint）
- [x] 🟡 Tauri Sidecar 集成：启动时拉起 Node.js 进程，退出时清理
- [x] 🟡 Sidecar 安全策略实现：随机端口 + 启动 Token + localhost 绑定
- [ ] 🟢 配置 GitHub Actions CI（lint + test + build）

#### 🔒 安全基座（Rust 层）

- [x] 🔴 Tauri Plugin: `keychain` — macOS Keychain 读写（get/set/delete）
- [x] 🔴 Tauri Plugin: `crypto` — AES-256 加密/解密（基于 ring AES-256-GCM）
- [ ] 🟡 Tauri Plugin: `sandbox` — 基础沙箱策略定义（文件系统路径白名单）
- [x] 🟡 SQLite 数据库初始化 + WAL 模式
- [x] 🟡 数据迁移框架（MigrationRunner）+ 001_initial.sql

#### 🤖 最简对话验证

- [x] 🔴 `packages/model-providers`: 接入 OpenAI Provider（基于 Vercel AI SDK）
- [x] 🔴 `packages/core`: 最简 ChatService — 接收消息 → 调用 LLM → 流式返回
- [x] 🔴 `apps/desktop/src`: 最简 Chat UI — 输入框 + 消息列表 + 流式显示
- [x] 🟡 前端 ↔ Sidecar 通信打通（HTTP SSE 流式）
- [x] 🟡 凭证金库 TS 封装：通过 Tauri IPC 调用 Rust Keychain Plugin
- [x] 🟡 设置页面：API Key 配置（写入 Keychain，非明文）

#### ✅ Sprint 1 验收标准

- [x] `pnpm dev` 一条命令启动完整开发环境（Tauri + Sidecar + 热重载）
- [x] 在 UI 中输入消息，能通过 OpenAI API 获得流式回复
- [x] API Key 通过 Keychain 存储，`~/.evoclaw/` 目录中无明文凭证
- [x] SQLite 数据库 AES-256-GCM 全库加密，直接打开为乱码（密钥存于 Keychain）

---

### Sprint 2: Agent 引擎 + 消息存储（Week 3-4）✅

> **目标**: Agent 创建/管理 + 中间件链 + 权限系统 + 多模型接入 + 消息全量持久化

#### 🧠 Agent 核心

- [x] 🔴 `domain/agent`: Agent 数据模型（id, name, status, soul）
- [x] 🔴 `domain/agent/soul.ts`: SOUL.md 解析器/生成器（Markdown ↔ Soul 对象）
- [x] 🔴 `domain/agent`: MEMORY.md 数据模型（preferences, knowledge, corrections）
- [x] 🔴 Agent CRUD API（create / get / list / update / archive）
- [x] 🔴 Agent 文件系统：`~/.evoclaw/agents/{id}/SOUL.md` + `MEMORY.md`

#### 🗣️ 语义化创建

- [x] 🔴 `application/agent-builder.ts`: 对话式创建引擎
  - [x] Phase 1: 角色定位追问
  - [x] Phase 2: 专长领域追问
  - [x] Phase 3: 风格偏好追问
  - [x] Phase 4: 行为约束追问
  - [x] Phase 5: 预览 & 测试对话
  - [x] Phase 6: 确认保存 SOUL.md + MEMORY.md
- [x] 🟡 Builder UI: 创建向导页面（对话式 + 步骤指示器 + 预览面板）
- [x] 🟡 Builder 内置提示词模板（驱动多轮追问的 System Prompt）

#### ⛓️ 中间件链

- [x] 🔴 `application/middleware/pipeline.ts`: 中间件链框架（before/after 钩子）
- [x] 🔴 `PermissionMiddleware`: 权限检查（查缓存 → 弹窗 → 记录）
- [x] 🔴 `ContextMiddleware`: 上下文组装（SOUL.md + 历史消息）
- [x] 🟡 ChatService 重构：从直接调用 LLM 改为走中间件链

> **注**: 原 `SummarizationMiddleware` 改名为 `LCMMiddleware`，移至 Sprint 4 实现。

#### 💾 消息全量存储

- [x] 🔴 messages 表全量持久化：每条用户/Agent 消息都写入 SQLite，不丢弃
- [x] 🔴 消息写入走 WAL 模式，保证高并发写入性能
- [ ] 🟡 Daily Logs 日期分片文件写入（`~/.evoclaw/agents/{id}/memory/YYYY-MM-DD.md`）
- [ ] 🟡 FTS5 全文索引建立（messages_fts 表）

#### 🔐 权限系统

- [x] 🔴 `domain/security/permission-model.ts`: 权限模型定义（7 类权限 × 4 种授权粒度）
- [x] 🔴 权限弹窗 UI 组件（类 iOS 风格：图标 + 说明 + 三个按钮）
- [x] 🔴 权限持久化（permissions 表）+ 内存缓存
- [x] 🟡 权限管理页面（查看已授权列表 / 撤销）

#### 🤖 多模型接入

- [x] 🔴 Anthropic Provider（Claude）
- [x] 🔴 DeepSeek Provider
- [x] 🟡 MiniMax Provider
- [x] 🟡 GLM（智谱）Provider
- [x] 🟡 Doubao（豆包）Provider
- [x] 🟡 Qwen（通义千问）Provider
- [x] 🟡 模型选择 UI：设置页面中选择默认模型 / Agent 级别模型配置
- [x] 🟡 ModelRouter: 按 Agent 配置 → 用户偏好 → 系统默认 的顺序路由

#### 🎨 UI 完善

- [x] 🟡 Agent 列表页（卡片式展示，显示名称、角色、状态）
- [x] 🟡 Agent 详情页（SOUL 信息展示 + 编辑入口）
- [x] 🟡 Chat UI 增强：Agent 头像、多 Agent 切换、消息时间戳
- [x] 🟡 应用整体布局：侧边栏（Agent 列表）+ 主区域（对话/详情）
- [ ] 🟢 深色/浅色模式支持

#### ✅ Sprint 2 验收标准

- [x] 通过对话式引导成功创建一个 Agent，生成的 SOUL.md 结构完整
- [x] 与创建的 Agent 对话，Agent 按 SOUL.md 定义的人格回复
- [x] 切换不同模型（如 OpenAI → DeepSeek）对话正常
- [x] Agent 首次访问文件系统时弹出权限弹窗，选择"始终允许"后不再弹出
- [x] 每条对话消息都被持久化到 messages 表，重启后可恢复

---

### Sprint 3: 记忆层基础 + 进化引擎（Week 5-6）

> **目标**: Session Key 路由 + 记忆隔离 + Memory Flush + 记忆蒸馏 + 反馈环 = Agent 开始"进化"

#### 🔀 Session Key 路由

- [ ] 🔴 `SessionRoutingMiddleware`: Session Key 路由中间件
  - [ ] Session Key 格式：`agent:<agentId>:<channel>:dm:<peerId>`（私聊）
  - [ ] Session Key 格式：`agent:<agentId>:<channel>:group:<groupId>`（群聊）
  - [ ] 根据 Session Key 自动路由到正确的会话上下文
- [ ] 🔴 conversations 表增加 `session_key` 列 + 唯一索引
- [ ] 🟡 多通道会话预备：Channel 类型枚举（desktop / feishu / wecom / qq）

#### 🔒 记忆隔离策略

- [ ] 🔴 `ContextMiddleware` 增强：根据 channel type 判断记忆加载策略
  - [ ] 私聊（dm）：加载 MEMORY.md 中的个人偏好记忆
  - [ ] 群聊（group）：不加载用户私聊专属记忆，仅加载公共知识
- [ ] 🔴 memories 表增加 `scope` 列（private / public）
- [ ] 🟡 记忆可见性标记：记忆蒸馏时自动标记 scope

#### 💨 Memory Flush

- [ ] 🔴 `MemoryFlushMiddleware`: Pre-compaction memory flush
  - [ ] 检测上下文 Token 使用率（接近限制的 80% 时触发）
  - [ ] 将当前对话中的重要信息提取并写入 MEMORY.md
  - [ ] Flush 完成后允许上下文窗口安全截断
- [ ] 🟡 Flush 策略：优先保留用户偏好 > 事实知识 > 对话细节

#### 🧬 记忆蒸馏

- [ ] 🔴 `MemoryMiddleware`: 对话后异步触发记忆蒸馏
- [ ] 🔴 `domain/memory/distiller.ts`: LLM 驱动的记忆提取（通过 ModelRouter 调用）
  - [ ] 提取用户偏好（格式、风格、习惯）
  - [ ] 提取领域知识（术语、概念）
  - [ ] 提取纠正记录（用户修正了什么）
- [ ] 🔴 置信度计算（首次 0.3 / 再次确认 +0.2 / 用户明确 0.9）
- [ ] 🔴 `MemoryMiddleware.before`: 对话时注入相关记忆条目
- [ ] 🔴 MEMORY.md 文件同步（数据库 ↔ Markdown 文件双向同步）

#### 📊 记忆表结构增强

- [ ] 🔴 memories 表增加 `activation` 列（记忆激活计数）
- [ ] 🔴 memories 表增加 `decay_score` 列（衰减分数，初始 1.0）
- [ ] 🔴 FTS5 索引建立：memories_fts（记忆全文检索）
- [ ] 🟡 FTS5 索引建立：messages_fts（消息全文检索，若 Sprint 2 未完成）

#### 👍 反馈环

- [ ] 🔴 Chat UI: 每条 Agent 回复显示 👍/👎 按钮 + 纠正输入框
- [ ] 🔴 `domain/evolution/feedback-loop.ts`:
  - [ ] 正面反馈：强化当前行为模式
  - [ ] 负面反馈：分析原因，生成纠正规则写入 MEMORY
  - [ ] 用户纠正：高置信度直接写入
- [ ] 🟡 反馈统计 API（正面/负面/纠正数量）

#### 🧠 记忆管理 UI

- [ ] 🟡 记忆管理页面（按类别筛选：偏好/知识/纠正，按 scope 筛选：私有/公共）
- [ ] 🟡 记忆条目查看详情 + 编辑 + 删除
- [ ] 🟡 记忆搜索（FTS5 关键词检索）

#### ✅ Sprint 3 验收标准

- [ ] 连续对话 10 次后，MEMORY.md 中自动沉淀 ≥5 条偏好记录
- [ ] 对 Agent 回复点 👎 并纠正，下次同类问题 Agent 行为有改善
- [ ] 记忆管理页面可查看/删除记忆条目
- [ ] 飞书群聊中 Agent 回复不包含用户私聊中的个人偏好记忆
- [ ] 上下文接近 Token 限制时，自动触发 Memory Flush 保存重要信息
- [ ] Session Key 正确路由不同通道的会话

---

### Sprint 4: LCM + 向量检索 + 知识库 + 生态接入（Week 7-10）

> **目标**: LCM 无损压缩 + sqlite-vec 向量检索 + RAG 知识库 + Skill 自发现 + macOS 打包

#### 📦 LCM 无损压缩（Log-structured Compaction Model）

- [ ] 🔴 消息不可变存储：messages 表中的消息一旦写入永不修改/删除
- [ ] 🔴 `summaries` 表设计（DAG 结构）：
  - [ ] 字段：id, parent_id, depth, content, source_message_ids, token_count, created_at
  - [ ] parent_id 实现 DAG 层级（原始摘要 → 合并摘要 → 更高层摘要）
  - [ ] depth 标记摘要层级（0 = 直接摘要，1 = 合并摘要，...）
- [ ] 🔴 `LCMMiddleware` 实现（替代原 SummarizationMiddleware）：
  - [ ] Token 接近上限时触发摘要生成
  - [ ] 通过 ModelRouter 调用 LLM 生成摘要（不依赖本地模型）
  - [ ] 摘要写入 summaries 表，保留 source_message_ids 溯源
  - [ ] 上下文重组时遍历 DAG，按需展开摘要层级
- [ ] 🟡 摘要质量评估：关键信息保留率检查

#### 🔍 sqlite-vec 向量检索

- [ ] 🔴 sqlite-vec 集成（编译 + 加载扩展）
- [ ] 🔴 `infrastructure/embedding/embedder.ts`: 云端 Embedding API 调用（通过 ModelRouter）
- [ ] 🔴 向量表设计：memory_vectors（memory_id, embedding）
- [ ] 🔴 KNN 查询接口（余弦相似度 Top-K）
- [ ] 🟡 增量向量化：新记忆/消息写入时异步生成 embedding

#### 🔎 混合搜索

- [ ] 🔴 统一搜索接口 `memory_search(query, systems)`:
  - [ ] systems 参数控制搜索后端组合（fts / vector / both）
  - [ ] 可并行查询多个后端
- [ ] 🔴 混合检索融合策略：
  - [ ] 向量检索 Top-20（权重 70%）
  - [ ] FTS5 检索 Top-20（权重 30%）
  - [ ] RRF（Reciprocal Rank Fusion）融合 → Top-5 返回
- [ ] 🟡 `RAGMiddleware`: 对话时自动调用 `memory_search` 检索并注入上下文

#### 📚 知识库 (RAG)

- [ ] 🔴 `rag/ingestion.ts`: 文档摄取管道
  - [ ] Markdown 解析器
  - [ ] TXT 解析器
  - [ ] PDF 解析器（pdf-parse）
- [ ] 🔴 `rag/chunker.ts`: 递归分块（标题→段落→句子，512 tokens，50 overlap）
- [ ] 🔴 分块向量化 + 写入 sqlite-vec
- [ ] 🟡 知识库管理 UI（文件列表、索引状态、存储占用）
- [ ] 🟡 文件拖拽导入 + 文件夹批量导入
- [ ] 🟡 文件删除 + 重新索引操作
- [ ] 🟢 增量索引（文件 hash 变更检测 → 自动重新索引）

#### 🔌 Skill 自发现

- [ ] 🔴 `domain/skill/gap-detector.ts`: 能力缺口检测
  - [ ] 工具调用失败 → 分析是否缺少 Skill
  - [ ] 生成 GapAnalysis（failureType, suggestedCapability, searchQuery）
- [ ] 🔴 `GapDetectionMiddleware`: 集成到中间件链（后置，异步）
- [ ] 🔴 `infrastructure/skill-source/npm-source.ts`: npm registry 搜索
- [ ] 🔴 Skill 安装流程（MVP 简化版）：
  - [ ] 搜索 → 展示候选列表 → 用户确认 → 下载安装 → 注册到 Agent
- [ ] 🟡 Skill 安装确认 UI（展示名称、描述、所需权限）
- [ ] 🟡 已安装 Skill 管理页面（列表 + 卸载）
- [ ] 🟡 `SkillMiddleware`: 将已安装 Skill 注册为 LLM Tool
- [ ] 🟢 Skill 能力编排：新 Skill 自动加入 Agent 可用工具列表

#### 🚀 macOS 打包 & 发布

- [ ] 🔴 Tauri 打包配置（tauri.conf.json）
  - [ ] 应用名称、图标、版本号
  - [ ] Sidecar Node.js 运行时打包
  - [ ] 签名配置（Developer ID）
- [ ] 🔴 macOS DMG 构建 + Apple Notarization
- [ ] 🔴 自动更新配置（Tauri Updater + GitHub Releases）
- [ ] 🟡 首次启动引导（Onboarding）
  - [ ] 欢迎页 → 选择模型 Provider → 输入 API Key → 创建第一个 Agent
- [ ] 🟡 应用图标 + 启动画面设计
- [ ] 🟡 Sidecar 健康检查（启动时等待后端就绪，超时则报错）
- [ ] 🟢 菜单栏常驻图标（可选）

#### 🧪 集成测试 & Bug 修复

- [ ] 🟡 端到端冒烟测试（创建 Agent → 对话 → 导入知识库 → 记忆验证）
- [ ] 🟡 安全审查：扫描整个项目确认无明文凭证
- [ ] 🟡 性能测试：冷启动时间 < 3s，首 Token < 2s
- [ ] 🟢 种子用户内测分发

#### ✅ Sprint 4 验收标准

- [ ] 长对话（超过 50 轮）后，早期对话的关键信息仍可被 Agent 召回
- [ ] 向量检索返回语义相关结果（Top-5 召回 >= 70% 相关性）
- [ ] `memory_search` 可并行查询多个后端
- [ ] Agent 遇到不会处理的文件时，提示"找到了 xxx Skill，是否安装？"
- [ ] 导入 20 个 Markdown 文件，提问相关内容能检索到正确文档
- [ ] macOS DMG 安装后双击即用，无需命令行操作
- [ ] 全新用户从安装到完成首次对话 < 5 分钟

---

## v0.5 — "可视、更聪明"

### Sprint 5: 知识图谱 + 衰减 + 进化可视化（Week 1-3）

> **目标**: 实体-关系知识图谱 + Hebbian 衰减 + 让用户"看见"Agent 在成长

#### 🗃️ Facts 知识图谱

- [ ] 🔴 `facts` 表设计（实体-关系-别名结构）：
  - [ ] 字段：id, agent_id, subject, predicate, object, aliases (JSON), confidence, source_message_id, created_at, updated_at
  - [ ] 唯一约束：(agent_id, subject, predicate, object)
- [ ] 🔴 `facts_fts` — FTS5 全文索引（subject + predicate + object + aliases）
- [ ] 🔴 `MetabolismMiddleware`: 对话后异步提取事实到 facts 表
  - [ ] 通过 ModelRouter 调用 LLM 从对话中提取实体-关系三元组
  - [ ] 自动去重：相同三元组更新 confidence 而非重复插入
  - [ ] 别名合并：识别同一实体的不同称呼
- [ ] 🟡 Facts 查询 API：按 subject/predicate/object 检索
- [ ] 🟡 Facts 管理 UI：查看/编辑/删除事实条目

#### 📉 Hebbian 衰减机制

- [ ] 🔴 衰减定时任务（每日凌晨执行，不需要独立 cron，应用启动时检查）：
  - [ ] Hot（decay_score >= 0.7）：最近 7 天内被引用的记忆
  - [ ] Warm（0.3 <= decay_score < 0.7）：7-30 天未被引用
  - [ ] Cool（decay_score < 0.3）：30+ 天未被引用
- [ ] 🔴 衰减公式：`decay_score = decay_score * 0.95`（每日衰减 5%）
- [ ] 🔴 激活回升：被重新引用时 `decay_score = min(1.0, decay_score + 0.3)`，activation +1
- [ ] 🟡 上下文组装时优先加载 Hot 记忆，Token 充裕时加载 Warm
- [ ] 🟡 Cool 记忆仅在 `memory_search` 显式查询时返回

#### 📊 能力图谱

- [ ] 🔴 `domain/evolution/capability-graph.ts`: 能力维度评分系统
- [ ] 🔴 评分算法实现（base 50 + 正面反馈 + Skill 数 - 纠正率）
- [ ] 🔴 每次对话后异步更新能力分数
- [ ] 🔴 能力历史记录（capability_history 表）

#### 📈 进化仪表盘 UI

- [ ] 🔴 仪表盘主页：Agent 选择 + 概览卡片
- [ ] 🔴 能力雷达图组件（Recharts / ECharts）
- [ ] 🟡 记忆量增长曲线（折线图）
- [ ] 🟡 记忆热度分布（Hot/Warm/Cool 占比饼图）
- [ ] 🟡 进化日志时间线（按周展示里程碑事件）
- [ ] 🟡 时间范围筛选（近一周 / 一月 / 三月 / 全部）
- [ ] 🟢 多 Agent 对比视图

#### 📋 周报

- [ ] 🟡 进化周报自动生成（每周一触发）
- [ ] 🟡 周报内容：新记忆数、能力变化、反馈统计、Top Skill 使用、衰减统计
- [ ] 🟢 周报推送通知（系统通知或 Channel 推送）

#### ✅ Sprint 5 验收标准

- [ ] facts 表中自动提取的实体-关系准确率 >= 70%
- [ ] 30 天未被引用的记忆 decay_score 降至 Cool 级别
- [ ] 被重新引用的记忆 decay_score 正确回升
- [ ] 仪表盘展示 ≥5 个维度的能力雷达图，数据来自真实交互
- [ ] 进化日志按时间线展示"学会了 xxx"等事件
- [ ] 周报自动生成，内容与实际交互数据一致

---

### Sprint 6: Channel 接入 + 模板市场（Week 4-6）

> **目标**: 飞书/企微/QQ Channel 接入 + 降低创建门槛

#### 📱 Channel 接入

- [ ] 🔴 创建 `packages/channels` 包
- [ ] 🔴 `channels/adapter.ts`: Channel Adapter 抽象接口定义
- [ ] 🔴 `channels/normalizer.ts`: 消息标准化层（平台消息 → 统一格式）
- [ ] 🔴 `channels/feishu.ts`: 飞书 Channel 适配器
  - [ ] 飞书机器人事件订阅（HTTP 回调或长轮询）
  - [ ] 接收文本/文件消息
  - [ ] 发送文本/富文本回复
  - [ ] 会话映射（飞书会话 → Agent 对话，使用 Session Key 路由）
- [ ] 🔴 `channels/wecom.ts`: 企业微信 Channel 适配器
  - [ ] 企微应用回调消息处理
  - [ ] 接收/发送文本消息
  - [ ] 会话映射
- [ ] 🔴 `channels/qq.ts`: QQ 开放平台 Channel 适配器
  - [ ] QQ 机器人 WebSocket 连接
  - [ ] 接收/发送消息
  - [ ] 会话映射
- [ ] 🟡 Channel Manager: 连接状态管理 + 自动重连
- [ ] 🟡 Channel 管理 UI（添加/配置/查看状态）
- [ ] 🟡 Channel 消息与桌面端共享 Agent 记忆和上下文（通过 Session Key 隔离）

#### 🎭 模板市场

- [ ] 🔴 预置 Agent 模板（5-10 个）：
  - [ ] 研究助手、编程伙伴、写作助手、翻译助手、学习教练
- [ ] 🔴 模板浏览 UI（卡片展示 + 标签筛选）
- [ ] 🔴 基于模板一键创建 Agent（可选继续对话微调）

#### 🔌 Skill 增强

- [ ] 🔴 `infrastructure/skill-source/clawhub-source.ts`: ClawHub 搜索集成
- [ ] 🔴 Skill 签名验证（Rust Plugin: `signature.rs`）
  - [ ] Ed25519 签名验证
  - [ ] 发布者公钥获取
- [ ] 🟡 Skill 沙箱试运行（Rust Plugin: `sandbox.rs` 增强）
- [ ] 🟡 Skill 安全评分算法（签名 + 审计 + 历史数据）
- [ ] 🟡 Skill 安装流程增强（签名验证 → 静态分析 → 沙箱试运行 → 确认）
- [ ] 🟢 Skill 能力编排：自动编入能力图谱

#### 🛠️ 体验优化

- [ ] 🟡 对话历史搜索（使用 messages_fts）
- [ ] 🟡 消息复制/分享
- [ ] 🟡 Agent 编辑（修改 SOUL.md 后立即生效）
- [ ] 🟢 键盘快捷键支持

#### ✅ Sprint 6 验收标准

- [ ] 在飞书中 @EvoClaw 发消息，能收到 Agent 回复
- [ ] 在企微中发消息给 EvoClaw 应用，能收到回复
- [ ] QQ 中给 EvoClaw 发消息能收到回复
- [ ] 从模板市场一键创建 Agent < 30 秒
- [ ] Skill 安装经过签名验证 + 沙箱试运行完整流程

---

### Sprint 7: 稳定化 + 知识库增强 + Growth Vectors（Week 7-8）

> **目标**: 质量打磨 + 知识库格式扩展 + 记忆一致性 + Growth Vectors 基础

#### 📚 知识库增强

- [ ] 🟡 DOCX 文件摄取支持（mammoth 库）
- [ ] 🟡 代码文件摄取支持（.py/.js/.ts/.go 等，tree-sitter 解析）
- [ ] 🟡 文件系统监控：知识库文件变更自动触发增量重索引（Rust FSEvents）
- [ ] 🟢 国产 Embedding 模型支持（如智谱 Embedding API）

#### 📐 Growth Vectors

- [ ] 🟡 `growth_vectors` 表设计：
  - [ ] 字段：id, agent_id, dimension, score, evidence_ids (JSON), created_at, updated_at
  - [ ] 维度：专业深度、响应质量、用户满意度、知识广度等
- [ ] 🟡 Growth Vector 基础实现：每次对话后更新相关维度分数
- [ ] 🟡 Growth Vector 可视化：在进化仪表盘中展示趋势线

#### 🔍 记忆一致性监控

- [ ] 🟡 Memory Drift 检测：定期扫描 memories 表，检测互相矛盾的记忆条目
- [ ] 🟡 矛盾记忆标记 + 用户确认 UI（保留哪个版本）
- [ ] 🟢 一致性报告：在周报中加入 memory drift 统计

#### 🐛 稳定化

- [ ] 🔴 全面性能优化（启动时间、内存占用、对话延迟）
- [ ] 🔴 错误处理完善（所有错误中文提示 + 修复建议）
- [ ] 🟡 Channel 断线重连机制优化
- [ ] 🟡 记忆蒸馏质量调优（减少无用记忆、提高准确率）
- [ ] 🟡 安全扫描 + 修复
- [ ] 🟢 用户反馈收集机制（应用内反馈入口）

#### ✅ Sprint 7 验收标准

- [ ] 冷启动 < 3 秒，活跃对话内存 < 500MB
- [ ] 所有错误提示为中文且包含可操作的修复建议
- [ ] 导入 DOCX 和代码文件后能正确检索
- [ ] Growth Vectors 趋势线在仪表盘中正确展示
- [ ] 矛盾记忆被检测出并标记

---

## v1.0 — "完整产品"

### Sprint 8: 多 Agent 协作（Week 1-3）

> **目标**: Agent 间协作能力

- [ ] 🔴 `domain/collaboration/message-bus.ts`: Agent 间消息总线
- [ ] 🔴 `domain/collaboration/workflow.ts`: DAG 工作流定义（steps + edges）
- [ ] 🔴 协作工作流执行引擎（按 DAG 顺序调度、结果传递）
- [ ] 🔴 人工审核节点（暂停流程等待用户确认）
- [ ] 🟡 自然语言创建工作流（"研究员找资料 → 写手写初稿"）
- [ ] 🟡 协作状态可视化 UI（哪个 Agent 在工作、进度、消息流向）
- [ ] 🟡 预置协作模板（研究-写作流水线、需求-设计-开发）
- [ ] 🟢 协作超时机制 + 失败重试

#### ✅ Sprint 8 验收标准

- [ ] 创建包含 3 个 Agent 的管道式工作流并成功执行
- [ ] 人工审核节点正确暂停流程，确认后继续

---

### Sprint 9: 跨平台 + 知识库增强（Week 4-7）

> **目标**: Windows/Linux 版本 + 多知识库

#### 🖥️ 跨平台

- [ ] 🔴 Windows Tauri 构建 + 测试
  - [ ] Windows Credential Manager 集成（Rust keychain 插件适配）
  - [ ] Windows 沙箱适配
  - [ ] MSI/NSIS 安装包
- [ ] 🔴 Linux Tauri 构建 + 测试
  - [ ] Linux Secret Service 集成
  - [ ] AppImage + deb 包
- [ ] 🟡 跨平台 UI 适配（字体、间距、系统主题）
- [ ] 🟡 跨平台 CI/CD（GitHub Actions matrix build）

#### 📚 知识库增强

- [ ] 🟡 多知识库隔离（每个 Agent 绑定不同知识库）
- [ ] 🟡 知识库管理 UI 增强（创建/删除/重命名知识库）

#### 📦 Agent 导入/导出

- [ ] 🟡 Agent 打包导出（SOUL.md + MEMORY.md + Skill 列表 → .evoclaw 包）
- [ ] 🟡 Agent 导入（解压 + 验证 + 创建）

#### ✅ Sprint 9 验收标准

- [ ] Windows 上安装 EvoClaw，双击即用，凭证通过 Credential Manager 存储
- [ ] Linux AppImage 正常运行
- [ ] 导出的 Agent 在另一台机器上导入后可正常使用

---

### Sprint 10: 安全仪表盘 + 发布准备（Week 8-10）

> **目标**: 产品完整度 + 公开发布

#### 🔒 安全仪表盘

- [ ] 🔴 安全状态总览面板（已授权权限、Skill 安全评分、安全事件）
- [ ] 🔴 审计日志查看器（按时间/类型/Agent 筛选）
- [ ] 🟡 一键撤销所有授权 + 批量管理
- [ ] 🟡 网络活动监控面板（所有出站请求的日志）

#### 📊 仪表盘增强

- [ ] 🟡 Skill 使用热力图
- [ ] 🟡 月报自动生成
- [ ] 🟢 Agent 对比视图

#### 🚀 发布准备

- [ ] 🔴 全平台打包测试（macOS / Windows / Linux）
- [ ] 🔴 完整性能测试报告
- [ ] 🟡 用户文档 / 使用指南
- [ ] 🟡 官网 Landing Page
- [ ] 🟡 GitHub 仓库准备（README、CONTRIBUTING、LICENSE）
- [ ] 🟢 第三方安全审计（可延后）

#### ✅ Sprint 10 验收标准

- [ ] 安全仪表盘可查看所有敏感操作日志
- [ ] 三平台安装包构建成功 + 基本功能验证通过
- [ ] GitHub 仓库就绪，README 包含快速开始指南

---

## v2.0 — "生态与社区"（规划方向）

> 以下为方向性规划，具体 Sprint 拆分待 v1.0 发布后根据用户反馈制定。

### 记忆层高阶能力

- [ ] Crystallization（30+ 天门控，成长向量 → 永久特质）
  - [ ] Cool 记忆中高 activation 的条目自动提升为永久特质
  - [ ] 永久特质写入 SOUL.md 的 traits 部分
- [ ] 跨通道会话连续性完整实现
  - [ ] 同一用户在不同 Channel 的对话上下文自动关联
  - [ ] 用户身份映射表（跨平台用户 ID 绑定）
- [ ] 高级 Memory Drift 修复（LLM 自动解决矛盾记忆）

### 社区生态

- [ ] EvoClaw Hub 平台（Web）：Agent 模板 + Skill 分享
- [ ] Agent 人格交易市场（分享/售卖训练好的 Agent，不含私人记忆）
- [ ] Plugin SDK 开放 + 开发者文档

### 移动端

- [ ] iOS 伴侣应用（React Native 或 Swift）
- [ ] Android 伴侣应用
- [ ] 桌面端 ↔ 移动端同步（端到端加密）

### 企业版

- [ ] 团队 Agent 共享
- [ ] 管理员权限控制
- [ ] 审计合规功能

### Channel 扩展

- [ ] 钉钉 Channel
- [ ] 微信 Channel（如政策允许）

---

## 附录：依赖关系与关键路径

### Sprint 间依赖

```
Sprint 1 (地基) ✅
    │
    ├──→ Sprint 2 (Agent 引擎 + 消息全量存储 + Daily Logs) ✅
    │         │
    │         └──→ Sprint 3 (记忆层基础 + 进化引擎)
    │                   │
    │                   └──→ Sprint 4 (LCM + 向量 + 知识库 + 生态)
    │                             │
    │                             └──→ Sprint 5 (知识图谱 + 衰减 + 可视化)
    │                                       │
    │                                       └──→ Sprint 6 (Channel 接入 + 模板)
    │                                                 │
    │                                                 └──→ Sprint 7 (稳定化 + Growth Vectors)
```

### 关键路径（最长依赖链）

```
消息全量存储 → FTS5 索引 → Session Key 路由 → Memory Flush → LCM 压缩 → 向量检索 → 知识图谱 → 衰减机制
```

此路径上的任何延迟都会影响 MVP 交付日期。

### 记忆层能力渐进路线

```
Sprint 2: 消息全量存 SQLite + Daily Logs 日期分片
    ↓
Sprint 3: Session Key 路由 + 记忆隔离 + Memory Flush + FTS5 索引
    ↓
Sprint 4: LCM 无损压缩 + summaries DAG + sqlite-vec 向量 + 混合搜索
    ↓
Sprint 5: facts 知识图谱 + Hebbian 衰减（Hot/Warm/Cool）+ Metabolism
    ↓
Sprint 7: Growth Vectors + 记忆一致性监控
    ↓
v2.0+: Crystallization + 跨通道会话连续性
```

### 存储引擎约束

| 组件 | 技术选型 | 说明 |
|------|----------|------|
| 结构化数据 | better-sqlite3 (WAL) | agents, messages, memories, summaries, facts 等 |
| 全文检索 | FTS5 | memories_fts, messages_fts, facts_fts |
| 向量检索 | sqlite-vec | memory_vectors（KNN 余弦相似度） |
| LLM 调用 | ModelRouter | 所有摘要/蒸馏/提取均通过 ModelRouter，不使用本地模型 |

### 可并行的工作

| 并行流 A | 并行流 B | 说明 |
|----------|----------|------|
| Rust 安全插件开发 | React UI 组件开发 | Sprint 1 中两人可并行 |
| 中间件链开发 | 多模型 Provider 接入 | Sprint 2 中可并行 |
| Session Key 路由 + Memory Flush | 记忆蒸馏 + 反馈环 | Sprint 3 中可并行 |
| LCM + 向量检索 | RAG 知识库 + Skill 系统 | Sprint 4 中可并行 |
| 知识图谱 + 衰减 | 能力图谱 + 仪表盘 UI | Sprint 5 中可并行 |
| Channel 适配器 | 模板市场 + Skill 增强 | Sprint 6 中可并行 |

---

> **文档状态**: v2.0 重大更新 — 融入记忆层深度分析决策
> **更新说明**: 基于 OpenClaw 记忆层分析，将 LCM 无损压缩、Session Key 路由、Hebbian 衰减、Facts 知识图谱等能力融入渐进路线
> **下次评审**: Sprint 3 启动前
