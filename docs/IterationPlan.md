# EvoClaw 迭代开发计划

> **文档版本**: v1.0
> **创建日期**: 2026-03-12
> **适用范围**: v0.1 MVP → v0.5 → v1.0 → v2.0

---

## 总览

```
v0.1 MVP (8 周)                    v0.5 (8 周)              v1.0 (10 周)
├── Sprint 1: 地基 (W1-W2)        ├── Sprint 5 (W1-W3)     ├── Sprint 8 (W1-W3)
├── Sprint 2: 引擎 (W3-W4)        ├── Sprint 6 (W4-W6)     ├── Sprint 9 (W4-W7)
├── Sprint 3: 进化 (W5-W6)        └── Sprint 7 (W7-W8)     └── Sprint 10 (W8-W10)
└── Sprint 4: 生态 (W7-W8)
```

每个 Sprint 采用 **2 周一迭代**（Sprint 4 例外，含打包发布）。
每个 TODO 标注优先级：🔴 阻塞项 / 🟡 重要 / 🟢 可选。

---

## v0.1 MVP — "安全、记忆、可用"

### Sprint 1: 地基搭建（Week 1-2）

> **目标**: 项目脚手架跑通 + 安全基座就绪 + 最简对话能跑通

#### 🏗️ 工程脚手架

- [ ] 🔴 初始化 pnpm monorepo + Turborepo 配置
- [ ] 🔴 创建 `apps/desktop` — Tauri 2.0 项目（Rust + React + TypeScript）
- [ ] 🔴 创建 `packages/core` — Node.js Sidecar 骨架（Hono HTTP 服务）
- [ ] 🔴 创建 `packages/shared` — 共享类型定义（Agent, Message, Soul, Memory 等）
- [ ] 🔴 创建 `packages/model-providers` — 模型 Provider 包骨架
- [ ] 🟡 配置 Vitest 测试框架 + Oxlint 代码检查
- [ ] 🟡 配置 Turborepo 构建管道（dev / build / test / lint）
- [ ] 🟡 Tauri Sidecar 集成：启动时拉起 Node.js 进程，退出时清理
- [ ] 🟡 Sidecar 安全策略实现：随机端口 + 启动 Token + localhost 绑定
- [ ] 🟢 配置 GitHub Actions CI（lint + test + build）

#### 🔒 安全基座（Rust 层）

- [ ] 🔴 Tauri Plugin: `keychain` — macOS Keychain 读写（get/set/delete）
- [ ] 🔴 Tauri Plugin: `crypto` — AES-256 加密/解密（基于 libsodium）
- [ ] 🟡 Tauri Plugin: `sandbox` — 基础沙箱策略定义（文件系统路径白名单）
- [ ] 🟡 SQLite 数据库初始化 + SQLCipher 加密集成
- [ ] 🟡 数据迁移框架（MigrationRunner）+ 001_initial.sql

#### 🤖 最简对话验证

- [ ] 🔴 `packages/model-providers`: 接入 OpenAI Provider（基于 Vercel AI SDK）
- [ ] 🔴 `packages/core`: 最简 ChatService — 接收消息 → 调用 LLM → 流式返回
- [ ] 🔴 `apps/desktop/src`: 最简 Chat UI — 输入框 + 消息列表 + 流式显示
- [ ] 🟡 前端 ↔ Sidecar 通信打通（HTTP SSE 流式）
- [ ] 🟡 凭证金库 TS 封装：通过 Tauri IPC 调用 Rust Keychain Plugin
- [ ] 🟡 设置页面：API Key 配置（写入 Keychain，非明文）

#### ✅ Sprint 1 验收标准

- [ ] `pnpm dev` 一条命令启动完整开发环境（Tauri + Sidecar + 热重载）
- [ ] 在 UI 中输入消息，能通过 OpenAI API 获得流式回复
- [ ] API Key 通过 Keychain 存储，`~/.evoclaw/` 目录中无明文凭证
- [ ] SQLite 数据库 SQLCipher 加密，直接打开为乱码

---

### Sprint 2: Agent 引擎（Week 3-4）

> **目标**: Agent 创建/管理 + 中间件链 + 权限系统 + 多模型接入

#### 🧠 Agent 核心

- [ ] 🔴 `domain/agent`: Agent 数据模型（id, name, status, soul）
- [ ] 🔴 `domain/agent/soul.ts`: SOUL.md 解析器/生成器（Markdown ↔ Soul 对象）
- [ ] 🔴 `domain/agent`: MEMORY.md 数据模型（preferences, knowledge, corrections）
- [ ] 🔴 Agent CRUD API（create / get / list / update / archive）
- [ ] 🔴 Agent 文件系统：`~/.evoclaw/agents/{id}/SOUL.md` + `MEMORY.md`

#### 🗣️ 语义化创建

- [ ] 🔴 `application/agent-builder.ts`: 对话式创建引擎
  - [ ] Phase 1: 角色定位追问
  - [ ] Phase 2: 专长领域追问
  - [ ] Phase 3: 风格偏好追问
  - [ ] Phase 4: 行为约束追问
  - [ ] Phase 5: 预览 & 测试对话
  - [ ] Phase 6: 确认保存 SOUL.md + MEMORY.md
- [ ] 🟡 Builder UI: 创建向导页面（对话式 + 步骤指示器 + 预览面板）
- [ ] 🟡 Builder 内置提示词模板（驱动多轮追问的 System Prompt）

#### ⛓️ 中间件链

- [ ] 🔴 `application/middleware/pipeline.ts`: 中间件链框架（before/after 钩子）
- [ ] 🔴 `PermissionMiddleware`: 权限检查（查缓存 → 弹窗 → 记录）
- [ ] 🔴 `ContextMiddleware`: 上下文组装（SOUL.md + 历史消息）
- [ ] 🟡 `SummarizationMiddleware`: 长对话压缩（Token 数接近限制时触发）
- [ ] 🟡 ChatService 重构：从直接调用 LLM 改为走中间件链

#### 🔐 权限系统

- [ ] 🔴 `domain/security/permission-model.ts`: 权限模型定义（7 类权限 × 4 种授权粒度）
- [ ] 🔴 权限弹窗 UI 组件（类 iOS 风格：图标 + 说明 + 三个按钮）
- [ ] 🔴 权限持久化（permissions 表）+ 内存缓存
- [ ] 🟡 权限管理页面（查看已授权列表 / 撤销）

#### 🤖 多模型接入

- [ ] 🔴 Anthropic Provider（Claude）
- [ ] 🔴 DeepSeek Provider
- [ ] 🟡 MiniMax Provider
- [ ] 🟡 GLM（智谱）Provider
- [ ] 🟡 Doubao（豆包）Provider
- [ ] 🟡 Qwen（通义千问）Provider
- [ ] 🟡 模型选择 UI：设置页面中选择默认模型 / Agent 级别模型配置
- [ ] 🟡 ModelRouter: 按 Agent 配置 → 用户偏好 → 系统默认 的顺序路由

#### 🎨 UI 完善

- [ ] 🟡 Agent 列表页（卡片式展示，显示名称、角色、状态）
- [ ] 🟡 Agent 详情页（SOUL 信息展示 + 编辑入口）
- [ ] 🟡 Chat UI 增强：Agent 头像、多 Agent 切换、消息时间戳
- [ ] 🟡 应用整体布局：侧边栏（Agent 列表）+ 主区域（对话/详情）
- [ ] 🟢 深色/浅色模式支持

#### ✅ Sprint 2 验收标准

- [ ] 通过对话式引导成功创建一个 Agent，生成的 SOUL.md 结构完整
- [ ] 与创建的 Agent 对话，Agent 按 SOUL.md 定义的人格回复
- [ ] 切换不同模型（如 OpenAI → DeepSeek）对话正常
- [ ] Agent 首次访问文件系统时弹出权限弹窗，选择"始终允许"后不再弹出

---

### Sprint 3: 进化引擎 + 知识库（Week 5-6）

> **目标**: 记忆沉淀 + 反馈环 + RAG 知识库 = Agent 开始"进化"

#### 🧬 记忆沉淀

- [ ] 🔴 `MemoryMiddleware`: 对话后异步触发记忆蒸馏
- [ ] 🔴 `domain/memory/distiller.ts`: LLM 驱动的记忆提取
  - [ ] 提取用户偏好（格式、风格、习惯）
  - [ ] 提取领域知识（术语、概念）
  - [ ] 提取纠正记录（用户修正了什么）
- [ ] 🔴 记忆去重与合并（向量相似度 > 0.85 合并）
- [ ] 🔴 置信度计算（首次 0.3 / 再次确认 +0.2 / 用户明确 0.9）
- [ ] 🔴 `MemoryMiddleware.before`: 对话时注入相关记忆条目
- [ ] 🔴 MEMORY.md 文件同步（数据库 ↔ Markdown 文件双向同步）

#### 👍 反馈环

- [ ] 🔴 Chat UI: 每条 Agent 回复显示 👍/👎 按钮 + 纠正输入框
- [ ] 🔴 `domain/evolution/feedback-loop.ts`:
  - [ ] 正面反馈：强化当前行为模式
  - [ ] 负面反馈：分析原因，生成纠正规则写入 MEMORY
  - [ ] 用户纠正：高置信度直接写入
- [ ] 🟡 反馈统计 API（正面/负面/纠正数量）

#### 📚 知识库 (RAG)

- [ ] 🔴 创建 `packages/rag` 包
- [ ] 🔴 `rag/ingestion.ts`: 文档摄取管道
  - [ ] Markdown 解析器
  - [ ] TXT 解析器
  - [ ] PDF 解析器（pdf-parse）
- [ ] 🔴 `rag/chunker.ts`: 递归分块（标题→段落→句子，512 tokens，50 overlap）
- [ ] 🔴 `rag/embedder.ts`: 云端 Embedding API 调用（text-embedding-3-small）
- [ ] 🔴 SQLite-vec 集成：向量写入 + KNN 查询
- [ ] 🔴 FTS5 全文索引集成
- [ ] 🔴 `rag/retriever.ts`: 混合检索（向量 Top-20 + FTS5 Top-20 → RRF 融合 → Top-5）
- [ ] 🔴 `RAGMiddleware`: 对话时自动检索知识库，注入上下文

#### 📁 知识库 UI

- [ ] 🟡 知识库管理页面（文件列表、索引状态、存储占用）
- [ ] 🟡 文件拖拽导入 + 文件夹批量导入
- [ ] 🟡 文件删除 + 重新索引操作
- [ ] 🟢 增量索引（文件 hash 变更检测 → 自动重新索引）

#### 🧠 记忆管理 UI

- [ ] 🟡 记忆管理页面（按类别筛选：偏好/知识/纠正）
- [ ] 🟡 记忆条目查看详情 + 编辑 + 删除
- [ ] 🟡 记忆搜索（关键词过滤）

#### ✅ Sprint 3 验收标准

- [ ] 连续对话 10 次后，MEMORY.md 中自动沉淀 ≥5 条偏好记录
- [ ] 对 Agent 回复点 👎 并纠正，下次同类问题 Agent 行为有改善
- [ ] 导入 20 个 Markdown 文件，提问相关内容能检索到正确文档
- [ ] 记忆管理页面可查看/删除记忆条目

---

### Sprint 4: 生态接入 + 发布（Week 7-8）

> **目标**: Skill 自发现 + Channel 接入 + macOS 打包发布

#### 🔌 Skill 自发现

- [ ] 🔴 创建 `packages/skill-runtime` 包
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

#### 📱 Channel 接入

- [ ] 🔴 创建 `packages/channels` 包
- [ ] 🔴 `channels/adapter.ts`: Channel Adapter 抽象接口定义
- [ ] 🔴 `channels/normalizer.ts`: 消息标准化层（平台消息 → 统一格式）
- [ ] 🔴 `channels/feishu.ts`: 飞书 Channel 适配器
  - [ ] 飞书机器人事件订阅（HTTP 回调或长轮询）
  - [ ] 接收文本/文件消息
  - [ ] 发送文本/富文本回复
  - [ ] 会话映射（飞书会话 → Agent 对话）
- [ ] 🔴 `channels/wecom.ts`: 企业微信 Channel 适配器
  - [ ] 企微应用回调消息处理
  - [ ] 接收/发送文本消息
  - [ ] 会话映射
- [ ] 🟡 Channel Manager: 连接状态管理 + 自动重连
- [ ] 🟡 Channel 管理 UI（添加/配置/查看状态）
- [ ] 🟡 Channel 消息与桌面端共享 Agent 记忆和上下文

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
- [ ] 🟡 Channel 集成测试：飞书/企微发消息 → Agent 回复
- [ ] 🟢 种子用户内测分发

#### ✅ Sprint 4 验收标准

- [ ] Agent 遇到不会处理的文件时，提示"找到了 xxx Skill，是否安装？"
- [ ] 在飞书中 @EvoClaw 发消息，能收到 Agent 回复
- [ ] 在企微中发消息给 EvoClaw 应用，能收到回复
- [ ] macOS DMG 安装后双击即用，无需命令行操作
- [ ] 全新用户从安装到完成首次对话 < 5 分钟

---

## v0.5 — "可视、更聪明"

### Sprint 5: 进化可视化（Week 1-3）

> **目标**: 让用户"看见"Agent 在成长

#### 📊 能力图谱

- [ ] 🔴 `domain/evolution/capability-graph.ts`: 能力维度评分系统
- [ ] 🔴 评分算法实现（base 50 + 正面反馈 + Skill 数 - 纠正率）
- [ ] 🔴 每次对话后异步更新能力分数
- [ ] 🔴 能力历史记录（capability_history 表）

#### 📈 进化仪表盘 UI

- [ ] 🔴 仪表盘主页：Agent 选择 + 概览卡片
- [ ] 🔴 能力雷达图组件（Recharts / ECharts）
- [ ] 🟡 记忆量增长曲线（折线图）
- [ ] 🟡 进化日志时间线（按周展示里程碑事件）
- [ ] 🟡 时间范围筛选（近一周 / 一月 / 三月 / 全部）
- [ ] 🟢 多 Agent 对比视图

#### 📋 周报

- [ ] 🟡 进化周报自动生成（每周一触发）
- [ ] 🟡 周报内容：新记忆数、能力变化、反馈统计、Top Skill 使用
- [ ] 🟢 周报推送通知（系统通知或 Channel 推送）

#### ✅ Sprint 5 验收标准

- [ ] 仪表盘展示 ≥5 个维度的能力雷达图，数据来自真实交互
- [ ] 进化日志按时间线展示"学会了 xxx"等事件
- [ ] 周报自动生成，内容与实际交互数据一致

---

### Sprint 6: 模板 + Skill 增强 + QQ（Week 4-6）

> **目标**: 降低门槛 + 扩展能力来源 + QQ Channel

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

#### 📱 QQ Channel

- [ ] 🔴 `channels/qq.ts`: QQ 开放平台 Channel 适配器
  - [ ] QQ 机器人 WebSocket 连接
  - [ ] 接收/发送消息
  - [ ] 会话映射
- [ ] 🟡 QQ 消息格式适配（QQ 特有的消息类型）

#### 🛠️ 体验优化

- [ ] 🟡 对话历史搜索
- [ ] 🟡 消息复制/分享
- [ ] 🟡 Agent 编辑（修改 SOUL.md 后立即生效）
- [ ] 🟢 键盘快捷键支持

#### ✅ Sprint 6 验收标准

- [ ] 从模板市场一键创建 Agent < 30 秒
- [ ] Skill 安装经过签名验证 + 沙箱试运行完整流程
- [ ] QQ 中给 EvoClaw 发消息能收到回复

---

### Sprint 7: 稳定化 + DOCX/代码支持（Week 7-8）

> **目标**: 质量打磨 + 知识库格式扩展

#### 📚 知识库增强

- [ ] 🟡 DOCX 文件摄取支持（mammoth 库）
- [ ] 🟡 代码文件摄取支持（.py/.js/.ts/.go 等，tree-sitter 解析）
- [ ] 🟡 文件系统监控：知识库文件变更自动触发增量重索引（Rust FSEvents）
- [ ] 🟢 国产 Embedding 模型支持（如智谱 Embedding API）

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
Sprint 1 (地基)
    │
    ├──→ Sprint 2 (Agent 引擎)   依赖: 脚手架 + 安全基座 + 最简对话
    │         │
    │         └──→ Sprint 3 (进化)  依赖: Agent 模型 + 中间件链
    │                   │
    │                   └──→ Sprint 4 (生态)  依赖: 记忆系统 + RAG
    │
    └──→ Sprint 4 (Channel)  依赖: 脚手架 + ChatService（可并行开发适配器）
```

### 关键路径（最长依赖链）

```
Tauri 脚手架 → Sidecar 集成 → 中间件链 → 记忆蒸馏 → Skill 自发现 → 打包发布
```

此路径上的任何延迟都会影响 MVP 交付日期。

### 可并行的工作

| 并行流 A | 并行流 B | 说明 |
|----------|----------|------|
| Rust 安全插件开发 | React UI 组件开发 | Sprint 1 中两人可并行 |
| 中间件链开发 | 多模型 Provider 接入 | Sprint 2 中可并行 |
| 记忆蒸馏引擎 | RAG 引擎 | Sprint 3 中可并行 |
| Skill 系统 | Channel 适配器 | Sprint 4 中可并行 |

---

> **文档状态**: 初版完成
> **下次评审**: Sprint 1 启动前
