# EvoClaw 迭代计划

> **文档版本**: v6.3
> **创建日期**: 2026-03-20
> **文档状态**: 执行中（Sprint 11 ✅ 已完成, Sprint 12 ✅ 已完成, Sprint 13 ✅ 已完成, Sprint 14 ✅ 已完成, Sprint 15 ✅ 已完成, Sprint 15.5 ✅ 已完成, Sprint 15.6 ✅ 已完成, Sprint 15.7 ✅ 已完成）
> **基于**: PRD v6.4 + Architecture v6.4 + heartbeat-alignment-plan.md
> **前序**: Sprint 1-10C 已全部完成（基于 PRD v4.0），本计划从 v1.0 企业级就绪版本开始
> **废弃**: 本文档替代 `IterationPlan.md` (v4.0)

---

## 战略定位变更

| 维度 | 旧定位 (v4.0) | 新定位 (v6.0) |
|------|--------------|--------------|
| 产品定位 | 自进化 AI 伴侣（消费级） | **企业级自进化 AI Agent 平台** |
| 第一优先级 | 功能完整性 | **安全与稳定** |
| 插件策略 | 规划 Plugin SDK 开放 | **全部内置，不开放第三方** |
| Skill 生态 | ClawHub + GitHub URL 直装 | **ClawHub + EvoClaw SkillHub** |
| Channel 覆盖 | 飞书 + 企微 + QQ | **飞书 + 企微 + 微信个人号(新增) + 钉钉(新增) + QQ** |
| 平台策略 | macOS → Windows → Linux | **macOS → Windows，无 Web/Linux** |
| 目标用户 | 知识工作者 / 开发者 / 极客 | **IT 部门负责人 / 企业开发者 / 团队负责人** |

---

## 已完成基座（Sprint 1-10C）

| 模块 | 规模 | 状态 |
|------|------|------|
| packages/core (Node.js Sidecar) | 94 文件, ~15,000 行 | ✅ |
| apps/desktop (React 前端) | 16 页面, ~7,000 行 | ✅ |
| apps/desktop/src-tauri (Rust 安全层) | 703 行 | ✅ |
| packages/shared (共享类型) | 11 类型文件, ~2,000 行 | ✅ |
| 测试 | 73 测试文件, ~11,700 行 | ✅ |

**已完成能力清单**:

- ✅ Monorepo 工程基座 + Tauri 2.0 桌面壳
- ✅ Rust 安全层（AES-256-GCM + macOS Keychain）
- ✅ PI 框架集成（ReAct 循环 + 流式输出）
- ✅ Agent 核心引擎（8 文件工作区 + 6 阶段引导创建）
- ✅ L0/L1/L2 三层记忆存储 + 三阶段渐进检索 + Hotness 衰减
- ✅ 记忆提取 Pipeline（预处理 → LLM 提取 → 持久化）
- ✅ ContextPlugin 5 钩子生命周期（9 个插件）
- ✅ RAG 知识库（sqlite-vec + FTS5 混合搜索）
- ✅ Skill 自发现 + 安全安装流（ClawHub API）
- ✅ 进化引擎（8 维能力图谱 + 成长追踪 + 满意度检测）
- ✅ Channel 抽象层 + Binding 路由 + Desktop/飞书/企微适配器
- ✅ Lane Queue 3 车道并发（main:4 / subagent:8 / cron:2）
- ✅ Provider 系统（9 家 Provider + PI ID 映射 + 4 层 Fallback）
- ✅ Agent 增强工具集（web_search/web_fetch/image/pdf/apply_patch/sub_agent）
- ✅ 多级错误恢复（Auth 轮转 → overload 退避 → thinking 降级 → context overflow → 模型降级）
- ✅ 工具安全守卫（4 模式循环检测 + 结果截断 + 熔断器阈值 30）
- ✅ 反馈循环防护（零宽空格标记）
- ✅ 权限模型（7 类别 × 4 作用域，Node.js 层实现）
- ✅ 双品牌支持（EvoClaw / HealthClaw）

---

## 迭代总览

```
已完成(Sprint 1-10C)    v1.0 企业级就绪         v1.5 深度集成           v2.0 规模扩展
(2026 Q1)               (2026 Q2-Q3, 12w)      (2026 Q3-Q4, 10w)      (2027 Q1-Q2)
   |                        |                       |                      |
   v                        v                       v                      v
工程基座+Agent引擎       安全增强+Channel          钉钉+QQ+企业知识源      Windows+移动端
记忆系统+RAG+Skill       微信个人号+企微+飞书       LSP+压缩审计+SIEM       记忆结晶+规模
Provider+进化引擎        使用量追踪+稳定性          子Agent+仪表盘           Agent 市场+SkillHub
                         Auth Doctor
```

---

## v1.0 — "企业级就绪" (2026 Q2-Q3, 约 12 周)

### 目标

安全合规达到企业部署标准；微信个人号 + 企微 + 飞书 Channel 生产就绪；使用量追踪支持企业采购决策；7×24 稳定运行验证。

### v1.0 成功标准

1. **安全合规**: 权限模型 Rust 全链路集成 + Prompt 注入检测通过渗透测试
2. **IM 可用**: 微信个人号 ✅ 已完成 + 企微 + 飞书 Channel 连续 7 天无故障运行
3. **成本可控**: 使用量追踪仪表盘可输出月度费用报告
4. **稳定运行**: Sidecar 168 小时（7 天）无内存泄漏，无 OOM
5. **Skill 安全**: ClawHub Skill 安装流程安全审计（SkillHub 独立排期，不阻塞 v1.0）

---

### Phase 1: 安全增强（W1-W4）

> 安全是企业品牌承诺，不能打折。本阶段完成权限模型和安全检测能力的全面提升。

#### Sprint 11: 权限模型 Rust 层集成 + 基础设施前置（W1-W2）✅ 已完成

**目标**: 将权限模型从 Node.js 层实现提升为 Rust + Node.js 双层防御，同时搭建内存泄漏检测和架构守卫测试基础设施。

| # | 任务 | 优先级 | 预估 | 状态 | 说明 |
|---|------|--------|------|------|------|
| 11.1 | Rust 层权限模块 `permission.rs`：PermissionState + check/grant/revoke/sync_all + credential 访问权限检查 | P0 | 3d | ✅ | 10 个 Rust 测试通过 |
| 11.2 | 权限状态同步：启动全量同步 + 实时增量同步（ChatPage invoke update_permission / SecurityPage invoke revoke_permission） | P0 | 2d | ✅ | Tauri IPC 双向同步 |
| 11.3 | 权限弹窗 UI：允许/拒绝两按钮，企业级设计（类别图标+彩色卡片+安全标识栏）。因 Tauri WKWebView 不支持 fetch streaming，改为非阻塞模式（拒绝→弹窗→授权→重试） | P0 | 2d | ✅ | 适配 Tauri webview 限制 |
| 11.4 | 安全中心 UI（三 Tab）：安全防护（3 开关卡片+策略说明）+ 已授权权限（类别过滤+可折叠分组+批量撤销）+ 审计日志（状态过滤+表格式布局+工具图标） | P1 | 2d | ✅ | 合并原 SecurityGuardPage |
| 11.5 | 权限插件修复：createPermissionPlugin(SecurityExtension) 工厂函数 + 注册到 ContextEngine + 10 个 E2E 测试 | P0 | 1d | ✅ | 替代旧 stub |
| 11.6 | 内存泄漏检测：MemoryMonitor（定时采样+环形缓冲+线性回归+泄漏判定）+ GET /doctor/memory + 7 个单元测试 | P1 | 2d | ✅ | 7/7 测试通过 |
| 11.7 | 架构守卫测试：循环依赖检测（DFS 三色标记）+ 层级边界检测（11 层规则）+ 4 个测试 | P1 | 2d | ✅ | 0 循环依赖、0 层级违反 |

**额外完成（计划外）**:
- PI 框架工具执行集成：发现 PI 对 `tools` 参数用内部实现绕过 execute()，参考 OpenClaw 改为全部走 `customTools`（4 参数签名适配）
- 权限模型简化：去掉 once/session 作用域，只保留允许（always）和拒绝（不存储），降低用户认知成本
- 工具分类完善：只读工具（read/ls/grep/find/image/pdf）自动放行，仅 shell/file_write/network 需授权
- 审计日志接入：工具执行后自动写入 tool_audit_log（含 success/error/denied 状态+耗时）
- skill-discoverer 测试修复：mock 远程 API 调用，消除 5s 超时
- 废弃代码清理：删除 SecurityGuardPage、permission-gate.ts、permission-response 端点

**验收标准**:
- [x] 所有工具调用经过 Node.js PermissionInterceptor 检查（PI 内置+EvoClaw 工具均覆盖）
- [x] Rust 层 credential 命令增加 agent_id 权限验证
- [x] 权限弹窗支持允许/拒绝，允许后持久化到数据库+Rust 层
- [x] 安全中心展示完整权限历史+审计日志+安全防护策略
- [x] 权限 E2E 测试 10/10 通过
- [x] 内存泄漏检测：可采集样本、计算趋势、检测泄漏（7/7 测试通过）
- [x] 架构守卫测试：0 循环依赖、0 层级违反（4/4 测试通过）
- [x] 全量测试 777/777 通过，Rust 测试 10/10 通过

---

#### Sprint 12: 安全检测引擎（W3-W4）✅ 已完成

**目标**: 增加 Prompt 注入检测、Unicode 混淆检测、危险命令模式扩展。

| # | 任务 | 优先级 | 预估 | 状态 | 说明 |
|---|------|--------|------|------|------|
| 12.1 | Prompt 注入检测引擎 `security/injection-detector.ts`：17 种模式 × 3 级严重度（HIGH 8 + MEDIUM 5 + LOW 4），覆盖 ChatML/Llama/Claude 分隔符注入、base64 编码、角色扮演、中文注入等 | P1 | 2d | ✅ | 22 个测试通过 |
| 12.2 | Unicode 混淆检测 `security/unicode-detector.ts`：同形字（Cyrillic/Greek/数学字母/全角 ASCII）、不可见字符（16 类，排除 EvoClaw 标记序列）、NFKC 规范化比对 + `normalizeUnicode()` 工具函数 | P1 | 2d | ✅ | 18 个测试通过 |
| 12.3 | 危险命令模式扩展：DANGEROUS_PATTERNS 新增 8 个模式（base64 解码执行、链式注入、环境变量篡改、远程代码执行、解释器 eval、后台执行、进程替换、crontab 篡改） | P1 | 0.5d | ✅ | 11→19 模式 |
| 12.4 | SecurityPlugin `context/plugins/security.ts`：priority=5（最高优先级），beforeTurn 扫描用户消息 → 设置 `ctx.securityFlags` + 审计日志，不阻断对话 | P1 | 1d | ✅ | TurnContext 扩展 SecurityFlags |
| 12.5 | 集成接入：memory-extract（medium/high 注入跳过提取）+ permission-interceptor（Unicode 混淆命令/路径拒绝）+ chat.ts（注册 SecurityPlugin） | P1 | 1d | ✅ | 3 文件修改 |
| 12.6 | 安全检测测试套件：55 个用例（注入 22 + Unicode 18 + 集成 15），含性能断言（10KB < 5ms） | P1 | 1d | ✅ | 858 全量测试通过 |

**额外完成（计划外）**:
- 架构守卫更新：新增 `security` 层规则（纯叶子层，无外部依赖），`context` 层允许依赖 `security`
- exec 审批精确绑定（12.3 原计划）推迟到后续 Sprint，当前以输入层安全检测为优先

**验收标准**:
- [x] 17 种 Prompt 注入模式全部可检测，无漏报（22 个测试覆盖）
- [x] Unicode 同形字攻击检测覆盖 Cyrillic/Greek/数学符号/全角 ASCII + 16 类不可见字符
- [x] 安全检测对请求延迟影响 < 5ms（10KB 消息性能断言通过）
- [x] 全量测试 858/858 通过，无回归

---

### Phase 2: Channel 生产化（W5-W12）

> Channel 是企业用户最直接的使用入口。微信个人号已完成，企微和飞书必须达到生产可靠性。Sprint 14（工具系统优化）穿插在微信个人号完成后、企微生产化之前。

#### Sprint 13: 微信个人号渠道（W5-W6）✅ 已完成

**目标**: 实现完整的微信个人号 Channel，基于腾讯 iLink Bot 平台，支持全媒体消息收发。

| # | 任务 | 优先级 | 预估 | 对应 Feature |
|---|------|--------|------|-------------|
| 13.1 | 微信个人号核心适配器：iLink Bot API 封装 + Long-polling 消息循环（getUpdates）+ QR 扫码登录 + Bearer Token 认证 + context_token 回显 + cursor 持久化（channel_state 表 + 010 迁移） | P0 | 3d | F7.7 |
| 13.2 | 媒体 CDN 管线：AES-128-ECB 加解密 + 入站 CDN 下载解密 + 出站 MD5 密钥生成/加密/CDN PUT 上传 + IMAGE/VIDEO/FILE/VOICE 四类媒体 + MIME 检测（30+ 格式） | P0 | 3d | F7.7 |
| 13.3 | 消息处理：Markdown → 纯文本转换 + Quote/引用消息处理（ref_msg）+ 4000 字符分块 + 语音转文字（平台 ASR）+ typing 指示器 + ChannelMessage mediaPath/mediaType 扩展 | P0 | 2d | F7.7 |
| 13.4 | 运维能力：Slash 命令（/echo, /toggle-debug）+ 调试模式（全管线耗时追踪）+ 中文错误通知（fire-and-forget）+ 日志脱敏（token/body/URL）| P1 | 1d | F7.7 |
| 13.5 | 前端 WeixinConnectForm：QR 码展示 + 扫码轮询 + 连接状态管理（集成到 ChannelPage.tsx） | P0 | 1d | F7.7 |
| 13.6 | Channel 工具注入：weixin_send（文本）+ weixin_send_media（媒体）+ SILK 语音转码 WAV（可选，silk-wasm） | P1 | 1d | F7.7 |

**验收标准**:
- [x] 扫码登录后 30 秒内完成连接并开始 long-polling
- [x] 文本/图片/视频/文件/语音消息双向收发正常
- [x] 媒体 CDN 加解密管线端到端验证通过
- [x] 全量测试 918/918 通过（90 个测试文件），无回归
- [x] 调试模式可追踪完整管线耗时（平台→插件→媒体下载→AI→回复）
- [x] 日志中无 token/敏感信息泄露

**交付物**:
- 15 个新文件（weixin.ts + 14 个子模块）
- channel-state-repo.ts + 010_channel_state.sql 迁移
- ChannelType 新增 'weixin'
- ChannelMessage 新增可选 mediaPath/mediaType
- ChannelAdapter 新增可选 sendMediaMessage/sendTyping 方法
- 前端 WeixinConnectForm 组件

---

### Phase 1.5: 工具系统优化（W5-W8）

> 基于 EvoClaw vs OpenClaw 工具系统对比分析，集中优化工具注入管道、MCP 集成、Schema 兼容性等核心能力。P0 影响核心功能，P1 影响用户体验，P2/P3 扩展工具生态。

#### Sprint 14: 工具系统优化（W5-W8，约 4 周）✅ 已完成

**目标**: 补齐工具系统核心缺口，接入 MCP 生态，提升多模型工具兼容性。

| # | 任务 | 优先级 | 预估 | 对应 Feature |
|---|------|--------|------|-------------|
| 14.1 | Memory Flush 工具集成接入 PI session：在 compaction 循环中触发 memory flush，确保 context 耗尽前（<80% 容量）记忆正确持久化到 SQLite | P0 | 2d | F9.11 |
| 14.2 | MCP Server 集成 `bridge/mcp-manager.ts`：StdioClientTransport 连接外部 MCP server + listTools() 工具自动发现 + callTool() 调用转发 + 配置文件管理（evo_claw.json mcp_servers 字段）+ 异常重连（3 次重试 + 指数退避） | P1 | 3d | F9.12 |
| 14.3 | Read 自适应分页 + 多页自动拉取：按 context window 剩余容量动态计算安全读取量（剩余 × 30%），超限自动分页 + 模型可请求后续页 | P1 | 2d | F9.13 |
| 14.4 | Schema Provider 适配 `bridge/schema-adapter.ts`：Gemini（移除 additionalProperties）/ xAI（展开 anyOf/oneOf）/ 通用（内联 $ref）兼容层，注入阶段 2 之后 | P1 | 2d | F9.14 |
| 14.5 | 工具目录规范化 `bridge/tool-catalog.ts`：统一工具 ID/Section/Profile 定义，工具元数据标准化（name, section, profile, description, provider_filter） | P1 | 1d | F9.15 |
| 14.6 | 子代理工具禁止列表显式化：在 spawn_agent 配置中显式声明各层级子代理禁止的工具清单（如子代理禁止 spawn_agent、exec 等），替代隐式过滤 | P1 | 1d | F9.16 |
| 14.7 | Exec safeBins 安全 profile `agent/safe-bins.ts`：受信二进制白名单（git, node, python, ls, cat, grep 等），非白名单命令需权限审批 | P1 | 1d | F9.15 |
| 58 | Tool Profile 系统 (minimal/coding/messaging/full) | P2 | 2d | F9.15 |
| 59 | Provider 工具过滤 | P2 | 1d | F9.15 |
| 60 | browser 浏览器自动化工具 | P2 | 3d | F9.17 |
| 61 | image_generate AI 图片生成工具 | P2 | 2d | F9.18 |
| 62 | LSP 集成 | P2 | 3d | F9.8 |
| 63 | apply_patch 条件创建 | P2 | 0.5d | F9.15 |
| 64 | 消息通道工具过滤 | P2 | 0.5d | F9.15 |
| 65 | 工具 Hook 包装 | P2 | 1d | F9.15 |
| 66 | tts 文本转语音工具 | P3 | 2d | F9.19 |
| 67 | canvas/gateway/nodes 占位工具 | P3 | 1d | F9.20 |
| 68 | 工具 description 动态修改 | P3 | 0.5d | F9.15 |
| 69 | 插件工具名称冲突检测 | P3 | 0.5d | F9.15 |
| 70 | Union Schema 扁平化 | P3 | 1d | F9.14 |

**验收标准**:
- [x] MCP server 可通过 evo_claw.json 配置并正常调用，工具自动出现在 Agent 工具列表
- [x] Read 大文件（>10K 行）自动分页，无需用户手动指定 offset/limit
- [x] Gemini 模型工具调用不报 schema 兼容性错误（additionalProperties/anyOf 等）
- [x] Memory Flush 在 context 使用率达 85% 时正确触发，记忆持久化到 memory 日记
- [x] safeBins 白名单外的命令执行触发权限审批流程
- [x] 子代理禁止列表显式定义（SUBAGENT_DENY_ALWAYS + SUBAGENT_DENY_LEAF）
- [x] 工具目录规范化（tool-catalog.ts 定义 26 个工具 × 7 个 Section × 4 个 Profile）
- [x] Tool Profile 系统支持 minimal/coding/messaging/full 四种预配置
- [x] browser/image_generate/tts 工具已实现
- [x] LSP 客户端支持 hover/definition/references
- [x] apply_patch 仅在 OpenAI 模型时创建
- [x] 消息通道工具过滤（语音通道禁 TTS 等）
- [x] beforeToolCall/afterToolCall Hook 机制就绪
- [x] Union Schema 扁平化 + Provider 特化清洗
- [x] 全量测试 968/968 通过，无回归

**交付物**:
- 13 个新文件（mcp/、lsp/、schema-adapter、adaptive-read、tool-catalog、tool-hooks、browser-tool、image-generate-tool、tts-tool、placeholder-tools 等）
- 工具总数从 15 增至 26+
- 安全增强：safeBins 白名单、子代理工具限制显式化、名称冲突检测

---

#### Sprint 15: Sub-Agent & ReAct 追平 OpenClaw（新插入）✅ 已完成

> **基于**: [`docs/architecture/SubAgent-ReAct-Optimization.md`](../architecture/SubAgent-ReAct-Optimization.md) 对比分析方案
> **注**: 本 Sprint 为 2026-03-26 新插入。后续 Sprint 编号顺延 +1（原 Sprint 15→16, 16→17, 17→18, 18→19, 19→20, 20→21, 21→22, 22→23, 23→24）。文档中其他位置的旧编号引用暂未全部更新，以本节为准。

**目标**: 消除与 OpenClaw 在 Sub-Agent 编排和 ReAct 循环上的 7 项差距。

| # | 任务 | 优先级 | 预估 | 说明 |
|---|------|--------|------|------|
| 15.1 | 可配置嵌套深度：`MAX_SPAWN_DEPTH` → 实例属性 `maxSpawnDepth`，默认 2 | P1 | 0.5d | 极低复杂度 |
| 15.2 | 动态重试上限：`MAX_LOOP_ITERATIONS` → `5 + providerChain.length * 5`，cap 30 | P1 | 0.5d | 极低复杂度 |
| 15.3 | Thinking 5 级渐进降级：`ThinkLevel`（off/low/medium/high），错误时逐级降而非直接禁用 | P1 | 1d | 低复杂度 |
| 15.4 | 丰富 Streaming 事件：补充 `compaction_start/end`、`message_start/end` 事件转发 | P1 | 0.5d | 低复杂度 |
| 15.5 | 级联 Kill：`SubAgentEntry` 新增 `childSpawner` 引用，`kill()` 递归终止所有后代 | P1 | 1d | 低复杂度 |
| 15.6 | Push-based 子代结果通知：子代完成后结果入 `pendingAnnouncements` 队列，父 session 下一次 prompt 前自动注入 | P0 | 2d | 中复杂度 |
| 15.7 | Session 模式：`spawn_agent` 新增 `mode: 'run' | 'session'`，session 模式子代可 resume，idle 30 分钟自动清理 | P1 | 3d | 高复杂度 |

**实施顺序**:
```
15.1-15.5 可并行（互不依赖）→ 15.6（依赖 spawner 结构稳定）→ 15.7（依赖 15.5 + 15.6）
```

**验收标准**:
- [x] 可配置 maxSpawnDepth=3 时支持 3 级嵌套
- [x] 重试上限随 provider 数量动态调整
- [x] ThinkLevel 渐进降级 high→medium→low→off
- [x] compaction_start/end 事件正确转发到前端
- [x] kill 父代时孙代也被终止
- [x] 子代完成后父 session 自动收到结果（无需 yield_agents）
- [x] session 模式子代可 resume 并保留上下文

---

#### Sprint 15.5: 差距补齐与优化（临时冲刺，1 周）✅ 已完成

> **基于**: [`docs/iteration-plans/gaps-and-optimizations.md`](./gaps-and-optimizations.md) EvoClaw vs Claude Code & OpenClaw 对比分析
> **注**: 本 Sprint 为 2026-03-30 临时插入，不影响后续编号。

**目标**: 补齐 EvoClaw 与 Claude Code 在任务追踪和 Heartbeat 效率上的 2 个关键差距，修复 4 项体验/稳定性问题。

| # | 任务 | 优先级 | 预估 | 说明 |
|---|------|--------|------|------|
| 15.5.1 | Heartbeat 零污染回滚：HEARTBEAT_OK / NO_REPLY 响应不保存消息、不触发事件 | P0 | 2d | 消除上下文污染和 token 浪费 |
| 15.5.2 | TodoWrite 约束工具：max 20 tasks, 单 in_progress, prompt 注入, 3 轮提醒 | P1 | 3d | 复杂任务成功率关键提升 |
| 15.5.3 | Heartbeat 间隔门控：新增 minIntervalMinutes 最小执行间隔（默认 5 分钟） | P2 | 0.5d | 防频繁触发，节省 API 成本 |
| 15.5.4 | Bundled Skills 路径修复：esbuild banner 注入 import.meta.dirname | P3 | 0.5d | 首次安装体验 |
| 15.5.5 | 工具调用卡片样式优化：轻量化视觉 + 展开/折叠动画 | P3 | 1d | 用户体验 |
| 15.5.6 | 设置页面 UI 优化：配置状态指示（绿点 + 计数） | P3 | 1d | 用户体验 |

**发现并修复的 Bug**:
- Heartbeat sessionKey 匹配不一致：`chat.ts` 用 `':heartbeat:'`（有尾部冒号）但 runner 生成的 key 无尾部冒号 → 改为 `endsWith(':heartbeat')`

**验收标准**:
- [x] Heartbeat 返回 HEARTBEAT_OK 时 conversation_log 无新增行、无 conversations-changed 事件
- [x] todo_write 工具出现在 Agent 工具列表，max 20 + 单 in_progress 约束生效
- [x] 任务状态 `<current_tasks>` 正确注入 system prompt
- [x] 连续 3 轮未调用 todo_write 时注入系统提醒
- [x] Heartbeat 间隔门控：快速连续调用被跳过
- [x] pnpm build 成功，bundled skills 正确复制到 dist/
- [x] 工具卡片样式更轻量，展开/折叠有动画过渡
- [x] 设置页面环境变量显示配置状态指示

**交付物**:
- 新增文件：`todo-tool.ts`（TodoWrite 工具）、`todo-tool.test.ts`（15 个测试）
- 修改文件：10 个（chat.ts、heartbeat-runner.ts、tool-catalog.ts、embedded-runner-prompt.ts、tool-injector.ts、build.ts、evolution.ts、ChatPage.tsx、SettingsPage.tsx、heartbeat-runner.test.ts）
- 新增测试 22 个（15 todo + 7 heartbeat），全部通过

---

#### Sprint 15.6: 自主执行系统（W9-W10）✅ 已完成

**目标**: Agent 从被动响应升级为主动自治

**关联**: PRD F11, Architecture §3.10 扩展

| # | 任务 | 优先级 | 状态 |
|---|------|--------|------|
| 15.6.1 | HeartbeatRunner executeFn 注入改造 | P0 | ✅ |
| 15.6.2 | heartbeat-execute.ts 执行桥接（内部 HTTP 复用 /send） | P0 | ✅ |
| 15.6.3 | HeartbeatManager 多 Agent 生命周期管理 | P0 | ✅ |
| 15.6.4 | server.ts 初始化 + serve 回调 + cleanup | P0 | ✅ |
| 15.6.5 | evolution.ts API 运行时同步 | P0 | ✅ |
| 15.6.6 | System Events 内存事件队列 | P0 | ✅ |
| 15.6.7 | chat.ts System Events drain 注入 | P0 | ✅ |
| 15.6.8 | Cron event 模式 + 手动事件 API | P1 | ✅ |
| 15.6.9 | Standing Orders 模板 + system prompt 集成 | P1 | ✅ |
| 15.6.10 | HeartbeatConfig 渠道投递 (target/showOk/showAlerts) | P1 | ✅ |
| 15.6.11 | BOOT.md 启动执行（区别于 BOOTSTRAP.md） | P2 | ✅ |
| 15.6.12 | 测试补全 (heartbeat-runner 15 tests + system-events 13 tests) | P0 | ✅ |

**交付物**:
- 新增文件：heartbeat-manager.ts, heartbeat-execute.ts, system-events.ts, system-events.test.ts, system-events route
- 修改文件：heartbeat-runner.ts, server.ts, chat.ts, cron-runner.ts, evolution.ts, agent-manager.ts, embedded-runner-prompt.ts, evolution types

---

#### Sprint 15.7: Heartbeat 对齐 OpenClaw（3 Phase 渐进实施）✅ 已完成

> **基于**: [`docs/dev/heartbeat-alignment-plan.md`](../dev/heartbeat-alignment-plan.md) 完整开发文档
> **注**: 本 Sprint 为 2026-03-31 新插入，延续 15.x 系列。不影响后续编号。

**目标**: 将 Heartbeat 机制对齐 OpenClaw 生产级实现，覆盖 Token 节省、提示词工程、调度优化、上下文优化、可观测性共 8 个模块。

**关联**: PRD F10.10（增强）, F11.6-F11.11（新增）, Architecture §3.10.2-3.10.8

##### Phase 1: P0 — Token 节省 + 核心鲁棒性

| # | 任务 | 优先级 | 预估 | 说明 |
|---|------|--------|------|------|
| 15.7.1 | heartbeat-utils.ts: 空文件检测 `isHeartbeatContentEffectivelyEmpty()` + ACK 鲁棒检测 `detectHeartbeatAck()` | P0 | 1d | 新建文件 |
| 15.7.2 | heartbeat-prompts.ts: reason-based 提示词模块（4 种 HeartbeatReason × deliverToUser 组合） | P0 | 1d | 新建文件，英文 prompt |
| 15.7.3 | heartbeat-runner.ts 集成: 空文件预检 + reason 参数 + 新 prompt + 鲁棒 ACK 检测 | P0 | 1d | 修改 |
| 15.7.4 | chat.ts 集成: detectHeartbeatAck 替代旧 includes 检测 | P0 | 0.5d | 修改 |
| 15.7.5 | 测试: heartbeat-utils.test.ts + heartbeat-prompts.test.ts + 更新现有 heartbeat-runner.test.ts | P0 | 1d | |

##### Phase 2: P1 — 调度优化 + 上下文优化

| # | 任务 | 优先级 | 预估 | 说明 |
|---|------|--------|------|------|
| 15.7.6 | HeartbeatConfig 类型扩展: prompt / ackMaxChars / isolatedSession / lightContext / model | P1 | 0.5d | evolution.ts |
| 15.7.7 | heartbeat-wake.ts: HeartbeatWakeCoalescer（250ms 合并 + 4 级优先级） | P1 | 1d | 新建文件 |
| 15.7.8 | heartbeat-runner.ts: requestNow() + isolatedSession + lightContext | P1 | 1d | 修改 |
| 15.7.9 | heartbeat-execute.ts: 传递 lightContext / model 到 chat 管道 | P1 | 0.5d | 修改 |
| 15.7.10 | chat.ts: 响应 lightContext 标志（仅加载 HEARTBEAT.md） | P1 | 0.5d | 修改 |
| 15.7.11 | system-events.ts 增强: contextKey 去重 + deliveryContext + 时间戳格式化 + 噪音过滤 | P1 | 1d | 修改 |
| 15.7.12 | heartbeat-manager.ts: 暴露 requestNow(agentId) 接口 | P1 | 0.5d | 修改 |
| 15.7.13 | 测试: heartbeat-wake.test.ts + 更新 system-events.test.ts | P1 | 1d | |

##### Phase 3: P2 — 可观测性

| # | 任务 | 优先级 | 预估 | 说明 |
|---|------|--------|------|------|
| 15.7.14 | DB migration: 0XX_cron_job_state.sql（consecutive_errors / last_run_status / last_delivery_status） | P2 | 0.5d | 新建文件 |
| 15.7.15 | cron-runner.ts: 错误追踪 + 连续 5 次失败自动禁用 | P2 | 1d | 修改 |
| 15.7.16 | task-registry.ts: 统一任务生命周期追踪（create/update/list/prune） | P2 | 2d | 新建文件 |
| 15.7.17 | 集成 TaskRegistry 到 cron-runner.ts + heartbeat-runner.ts | P2 | 1d | 修改 |
| 15.7.18 | REST API: GET /tasks 端点 | P2 | 0.5d | 新建路由 |
| 15.7.19 | 测试: task-registry.test.ts + cron 错误追踪测试 | P2 | 1d | |

**实施顺序**:
```
Phase 1 (15.7.1-15.7.5) → Phase 2 (15.7.6-15.7.13) → Phase 3 (15.7.14-15.7.19)
Phase 1 内: 15.7.1 + 15.7.2 可并行 → 15.7.3 → 15.7.4 → 15.7.5
Phase 2 内: 15.7.6 先行 → 15.7.7-15.7.12 可并行 → 15.7.13
```

**交付物**:
- 新增文件: heartbeat-utils.ts, heartbeat-prompts.ts, heartbeat-wake.ts, task-registry.ts, 0XX_cron_job_state.sql, /tasks 路由
- 修改文件: heartbeat-runner.ts, heartbeat-manager.ts, heartbeat-execute.ts, chat.ts, system-events.ts, cron-runner.ts, evolution.ts types
- 新增测试: heartbeat-utils.test.ts, heartbeat-prompts.test.ts, heartbeat-wake.test.ts, task-registry.test.ts
- 修改测试: heartbeat-runner.test.ts, system-events.test.ts

**验收标准**:
- [x] HEARTBEAT.md 空文件时跳过 LLM 调用，Token 消耗为零
- [x] HEARTBEAT_OK Markdown/HTML 变体被正确检测（覆盖率 100%）
- [x] 4 种 HeartbeatReason 使用不同 prompt，英文 prompt 遵从性测试通过
- [x] 250ms 内多个唤醒请求合并为单次执行
- [x] lightContext 模式 token < 2K
- [x] contextKey 去重生效
- [x] Cron 连续 5 次失败后自动禁用
- [x] TaskRegistry /tasks API 返回正确的任务列表
- [x] 全量测试通过，无回归

---

#### Sprint 16: 企微 Channel 生产就绪

> **注**: 原 Sprint 15 企微生产化顺延至 Sprint 16。

**目标**: 企微 Channel 达到生产级别。

| # | 任务 | 优先级 | 预估 | 对应 Feature |
|---|------|--------|------|-------------|
| 16.1 | 企微生产化：消息去重 + @Agent 群聊路由 + 文件消息 + 断连重连 + access_token 轮换 | P0 | 3d | F7.2 |
| 16.2 | 企微应用回调验证：URL 验证 + 消息签名校验 + 加解密（AES-CBC）| P0 | 1d | F7.2 |
| 16.3 | 企微集成测试（私聊 + 群聊 + 文件 + 加解密 + 断连重连） | P0 | 1d | F7.2 |

**验收标准**:
- [ ] 企微 Channel 连续 72 小时无故障运行
- [ ] 企微消息加解密通过官方验证工具

---

#### Sprint 17: 飞书 Channel 生产就绪

**目标**: 飞书 Channel 从原型提升到企业生产级别。

| # | 任务 | 优先级 | 预估 | 对应 Feature |
|---|------|--------|------|-------------|
| 17.1 | 飞书消息去重：基于 `message_id` + Redis-like 去重窗口（内存 LRU，1000 条滑动窗口），防止 webhook 重复推送 | P0 | 1d | F7.1 |
| 17.2 | 飞书群聊路由增强：@Agent 消息检测 + 线程跟踪（reply_in_thread）+ 群聊 Session Key 隔离 | P0 | 2d | F7.1 |
| 17.3 | 飞书文件/图片消息支持：接收文件 → 下载 → 传入 Agent（image 工具 / pdf 工具 / knowledge RAG） | P0 | 2d | F7.1 |
| 17.4 | 飞书卡片消息：Agent 回复支持飞书交互卡片（按钮、确认弹窗），用于权限确认和操作审批 | P1 | 2d | F7.1 |
| 17.5 | 飞书错误恢复：access_token 2h 自动轮换 + 断连自动重连（指数退避）+ 限频退避（20 次/秒上限） | P0 | 1d | F7.1 |
| 17.6 | 飞书集成测试（私聊 + 群聊 + 文件 + 断连重连 + 限频） | P0 | 1d | F7.1 |

**验收标准**:
- [ ] 飞书 Channel 连续 72 小时无故障运行
- [ ] 消息去重准确率 100%（同一消息不重复处理）
- [ ] 群聊中 @Agent 消息 < 3 秒响应开始
- [ ] 断连后 30 秒内自动重连
- [ ] 文件/图片消息正确传递给对应工具

---

### Phase 3: 企业必备功能 + 稳定性（W13-W16）

> **注**: 由于 Sprint 13 插入微信个人号渠道、Sprint 14 插入工具系统优化，Phase 3 整体后移 4 周。

> 使用量追踪是企业采购的硬性要求。稳定性是企业部署的基本门槛。

#### Sprint 17: 使用量追踪 + Auth Doctor（W13-W14）

**目标**: 实现 API 调用费用统计和诊断能力。

| # | 任务 | 优先级 | 预估 | 对应 Feature |
|---|------|--------|------|-------------|
| 17.1 | usage_tracking 表设计 + 迁移：`011_usage_tracking.sql`（agent_id, provider, model, input_tokens, output_tokens, estimated_cost, channel, session_key, created_at） | P1 | 1d | F8.2 |
| 17.2 | 使用量拦截中间件：在 embedded-runner.ts 的 LLM 调用后记录 usage 数据（从 PI response.usage 提取），含记忆提取/压缩等内部调用 | P1 | 2d | F8.2 |
| 17.3 | 使用量统计 API：`GET /usage/summary`（按 Provider/Model/Agent/Channel 四维度聚合）+ `GET /usage/daily`（日趋势）+ `GET /usage/export`（CSV 导出）| P1 | 2d | F8.2 |
| 17.4 | 使用量仪表盘 UI：费用总览卡片 + 按维度分布图 + 日趋势折线图 + 导出按钮 | P1 | 2d | F8.2 |
| 17.5 | Auth Doctor `routes/doctor.ts` 增强：API Key 有效性检测（试调 /models 接口）+ 余额查询（支持 OpenAI/Anthropic/DeepSeek）+ 网络可达性检测 + 具体错误提示（"API Key 格式错误"/"余额不足"/"网络不可达"） | P1 | 2d | F9.10 |

**验收标准**:
- [ ] 每次 LLM 调用（含内部调用）都记录到 usage_tracking
- [ ] 按 Provider/Model/Agent/Channel 聚合查询延迟 < 500ms
- [ ] 费用估算与实际账单偏差 < 10%
- [ ] Auth Doctor 对 6 种常见配置错误给出明确诊断和修复建议
- [ ] CSV 导出格式可直接导入企业财务系统

---

#### Sprint 18: 稳定性验证 + 发布准备（W15-W16）

**目标**: 验证 7×24 稳定性，完成 macOS 企业级就绪版本发布。

| # | 任务 | 优先级 | 预估 | 对应 Feature |
|---|------|--------|------|-------------|
| 18.1 | 168 小时稳定性测试：Sidecar 连续运行 7 天，模拟正常使用负载（每小时 10 轮对话 × 3 个 Agent），验证无内存泄漏、无 OOM、无崩溃。基于 Sprint 11 搭建的内存泄漏检测基础设施运行 | P1 | 2d（含运行等待） | F10.7 |
| 18.2 | 全量集成测试回归：覆盖 agent-lifecycle、chat-flow、guided-creation、memory-cycle、permission-flow、provider-config、startup、feishu-channel、wecom-channel、weixin-channel | P1 | 2d | — |
| 18.3 | macOS DMG 打包 + 签名 + 分发（企业内部分发通道） | P1 | 1d | — |
| 18.4 | v1.0 Release Notes + 部署文档 + 企业管理员指南 | P1 | 1d | — |

**验收标准**:
- [ ] 168 小时稳定性测试通过，内存增长 < 50MB
- [ ] 架构守卫测试检测到 0 个循环依赖、0 个层级违反
- [ ] 全量集成测试通过率 100%
- [ ] macOS DMG 签名有效，双击即用

---

### v1.0 交付物清单

| 交付物 | 描述 |
|--------|------|
| macOS Tauri 应用 | 企业级就绪版，签名 DMG |
| 权限模型 Rust 全链路 | 7 × 4 全组合，无绕过路径 |
| 安全检测引擎 | Prompt 注入 17 模式 + Unicode 混淆 + exec argv 绑定 |
| 微信个人号 Channel | 已实现（扫码登录 + long-polling + 全媒体 CDN 管线 + slash 命令 + 调试模式） |
| 飞书 Channel | 生产就绪（私聊 + 群聊 + 文件 + 卡片 + 重连 + 限频） |
| 企微 Channel | 生产就绪（私聊 + 群聊 + 文件 + 加解密 + 重连） |
| 使用量追踪 | 四维度统计 + 费用估算 + CSV 导出 |
| Auth Doctor | 6 种配置错误诊断 + 修复建议 |
| 稳定性验证 | 168h 无泄漏 + 架构守卫 + 全量回归 |

---

## v1.5 — "深度集成" (2026 Q3-Q4, 约 10 周)

### 目标

补全 Channel 矩阵（钉钉 + QQ），深化企业工具链集成（LSP + 知识源 + 工单），增强记忆系统高级能力（压缩审计 + 预过滤），安全合规进阶（SIEM + 数据分类）。

---

#### Sprint 19: 钉钉 Channel + QQ Channel（W1-W3）

| # | 任务 | 优先级 | 预估 | 对应 Feature |
|---|------|--------|------|-------------|
| 19.1 | 钉钉适配器 `adapters/dingtalk.ts`：机器人 API 接入 + 私聊 + 群聊（@机器人）+ 签名验证 + access_token 轮换 + 限频退避（40 次/分） | P1 | 3d | F7.3 |
| 19.2 | 钉钉消息去重 + 线程路由 + 文件消息 + 断连重连 | P1 | 2d | F7.3 |
| 19.3 | 钉钉交互卡片消息（ActionCard）：用于权限审批和操作确认 | P1 | 1d | F7.3 |
| 19.4 | QQ 适配器 `adapters/qq.ts`：QQ 开放平台 API + 私聊 + Q群（@机器人）+ 签名验证 | P1 | 3d | F7.4 |
| 19.5 | QQ 消息去重 + 文件消息 + 断连重连 | P1 | 1d | F7.4 |
| 19.6 | 五平台 Channel 统一集成测试（含微信个人号） | P1 | 1d | F7.3, F7.4 |
| 19.7 | Channel 管理 UI 增强：5 平台连接状态 + 消息统计 + 配置引导 | P1 | 1d | F7.6 |

**验收标准**:
- [ ] 钉钉 + QQ Channel 连续 72 小时无故障
- [ ] 5 平台适配器通过统一测试套件（含微信个人号）
- [ ] Channel 管理界面一站式配置所有平台

---

#### Sprint 20: LSP 工具集成 + 企业知识源（W4-W5）

| # | 任务 | 优先级 | 预估 | 对应 Feature |
|---|------|--------|------|-------------|
| 20.1 | LSP 工具运行时 `tools/lsp-tool.ts`：Agent 通过 JSON-RPC 调用 LSP 服务器（TypeScript/Python/Go/Java）。能力：跳转定义、查引用、代码诊断、自动补全、重命名重构 | P1 | 4d | F9.8 |
| 20.2 | LSP 服务器生命周期管理：按需启动 + 超时自动关闭 + 工作区路径绑定 | P1 | 2d | F9.8 |
| 20.3 | 企业知识源集成框架 `rag/enterprise-source.ts`：定义 `KnowledgeSource` 接口（connect/sync/search），首批实现飞书文档 API + Confluence REST API | P2 | 3d | F5.6 |
| 20.4 | 工单系统集成 `tools/ticket-tool.ts`：Jira REST API + 飞书项目 API + 钉钉待办 API，Agent 可创建/查询/更新工单 | P2 | 2d | F11.2 |

**验收标准**:
- [ ] LSP 工具支持至少 TypeScript + Python 两种语言
- [ ] 跳转定义/查引用响应 < 2 秒
- [ ] 企业知识源可增量同步，搜索与本地 RAG 统一
- [ ] Agent 可通过自然语言创建和查询 Jira 工单

---

#### Sprint 21: 记忆系统增强 + 进化仪表盘（W6-W7）

| # | 任务 | 优先级 | 预估 | 对应 Feature |
|---|------|--------|------|-------------|
| 21.1 | 压缩质量审计 `context/compression-auditor.ts`：LCM 压缩后调用 LLM 对比压缩前后关键信息保留度（checklist: 关键决策/待办事项/数字数据/人名），保留度 < 80% 则重试 | P2 | 2d | F3.13 |
| 21.2 | 可配置压缩模型：企业客户可指定用于压缩的模型（数据驻留合规），在 `evo_claw.json` 中增加 `models.compression` 字段 | P2 | 1d | F3.14 |
| 21.3 | Rule-based 预过滤 `memory/rule-filter.ts`：高置信度记忆模式（用户自报姓名/职业/偏好/纠正）通过 regex 快速捕获，跳过 LLM 调用，降低 API 成本 | P2 | 2d | F3.15 |
| 21.4 | 子 Agent 派生 + Agent 间通信增强：spawn_agent 支持 maxSpawnDepth=2 + allowlist 显式开启通信 + 结构化消息传递 | P1 | 2d | F6.1, F6.2 |
| 21.5 | 进化仪表盘 UI：能力雷达图（8 维 ECharts）+ 记忆增长曲线 + 知识图谱网络可视化 + 周报自动生成 | P1 | 3d | F8.1, F8.3, F8.7, F8.5 |

**验收标准**:
- [ ] 压缩质量审计在关键信息丢失时触发重试，保留度 ≥ 80%
- [ ] Rule-based 预过滤拦截 30%+ 的高置信度记忆提取，节省 LLM 调用
- [ ] 能力雷达图正确展示 8 个维度，数据来源于实际交互
- [ ] 周报在每周一自动生成

---

#### Sprint 22: 安全合规进阶 + Docker 沙箱（W8-W10）

| # | 任务 | 优先级 | 预估 | 对应 Feature |
|---|------|--------|------|-------------|
| 22.1 | 沙箱环境变量阻断 `sandbox/env-guard.ts`：Docker 模式下白名单机制，阻断 JAVA_TOOL_OPTIONS / PYTHONBREAKPOINT / DOTNET_STARTUP_HOOKS / NODE_OPTIONS 等注入向量 | P2 | 1d | F1.6 |
| 22.2 | 审计日志 SIEM 集成 `infrastructure/siem-exporter.ts`：支持 JSON Lines 文件导出 + Syslog (RFC 5424) + Splunk HEC (HTTP Event Collector)，可配置导出周期和目标 | P2 | 3d | F1.8 |
| 22.3 | 数据分类标记：记忆和对话内容按 L1-L4 分级（公开/内部/机密/绝密），标记影响可见性和导出策略 | P2 | 2d | F1.9 |
| 22.4 | Docker 沙箱支持（可选）：3 模式（off/selective/all），首次触发引导安装（macOS 推荐 Colima），沙箱感知的 bash 工具 | P2 | 3d | F1.1 |
| 22.5 | Brave LLM Context API 模式 `tools/web-search.ts` 增强：返回适合 LLM 的预处理内容，减少 token 消耗 | P2 | 1d | F9.2 |
| 22.6 | 部门/团队记忆隔离验证：文档化 per-agent 架构天然支持的隔离策略 + 增加隔离性集成测试 | P1 | 1d | F11.3 |

**验收标准**:
- [ ] Docker 沙箱模式下阻断所有已知环境变量注入向量
- [ ] SIEM 导出 JSON Lines 可被 Splunk/ELK 正确解析
- [ ] 数据分类标记不影响正常检索性能
- [ ] 不同 Agent 的记忆零交叉泄露

---

### v1.5 交付物清单

| 交付物 | 描述 |
|--------|------|
| 钉钉 + QQ Channel | 生产就绪，4 平台全覆盖 |
| LSP 工具 | TypeScript + Python 代码智能 |
| 企业知识源 | 飞书文档 + Confluence 同步 |
| 工单集成 | Jira + 飞书项目 + 钉钉待办 |
| 压缩质量审计 | 关键信息保留度 ≥ 80% |
| Rule-based 预过滤 | 降低 30%+ LLM 调用 |
| 进化仪表盘 | 雷达图 + 增长曲线 + 知识图谱 |
| SIEM 集成 | Splunk HEC + ELK 兼容 |
| Docker 沙箱 | 3 模式可选 |

---

## v2.0 — "规模扩展" (2027 Q1-Q2)

### 目标

覆盖 Windows 平台，搭建 SkillHub 生态，支持更大规模企业部署，探索移动端。

### 规划方向（详细计划在 v1.5 完成后制定）

| 类别 | 内容 | 优先级 |
|------|------|--------|
| **跨平台** | Windows 版本（Tauri 跨平台构建 + Windows Credential Manager 凭证适配） | P0 |
| **移动端** | 评估 Tauri 2.0 mobile 成熟度；飞书/企微/微信个人号/钉钉 Channel 已提供移动入口 | P2 |
| **SkillHub v1.0** | EvoClaw SkillHub API 服务端 + 首批 20 个企业 Skill 审核上架 + skill-discoverer 接入（见独立 Sprint 23） | P2 |
| **Skill 生态** | SkillHub 扩展至 50+ Skill + 付费 Skill 支持 + 企业专属 Skill | P3 |
| **记忆进化** | Growth Vectors / Crystallization：成长向量 30+ 天门控结晶化为永久特质写入 SOUL.md | P2 |
| **图片生成** | image_generate 多 Provider 注册（OpenAI DALL-E / StableDiffusion / MidJourney API） | P2 |
| **协作增强** | 协作工作流定义 + 人工审核节点 + 协作状态可视化 | P2 |
| **Agent 市场** | Agent 导入/导出 + 企业内 Agent 模板市场 | P2 |
| **知识库** | 多知识库隔离 + 团队级知识库共享 | P2 |
| **压力测试** | 10 Channel 并发 + 5 Agent 并行压力测试套件 | P1 |
| **多设备** | 多设备同步（端到端加密） | P3 |

---

## 独立 Sprint: SkillHub（最低优先级，按需排期）

> SkillHub 从迭代主线拆出，独立排期。当前 ClawHub + GitHub URL 直装已满足 Skill 分发需求，SkillHub 作为企业级 Skill 管控平台在核心功能稳定后再启动。

#### Sprint 23: EvoClaw SkillHub v1.0

**目标**: 搭建 EvoClaw 自有 Skill 市场，提供安全审计 + 搜索 + 下载能力。

| # | 任务 | 优先级 | 预估 | 对应 Feature |
|---|------|--------|------|-------------|
| 23.1 | EvoClaw SkillHub API 服务端：`/api/v1/skills/search`（向量搜索）+ `/api/v1/skills/download`（ZIP 下载）+ `/api/v1/skills/audit`（安全审计状态查询）| P2 | 3d | F4.2 |
| 23.2 | SkillHub 首批 Skill 审核上架：20 个企业场景 Skill（文档分析、数据整理、代码审查、报告生成、会议纪要等），每个通过安全扫描 + 人工审计 | P2 | 2d | F4.2 |
| 23.3 | skill-discoverer.ts 增加 SkillHub 数据源：搜索优先级 SkillHub > ClawHub，安装流程增加审计状态检查 | P2 | 1d | F4.2, F4.3 |

**验收标准**:
- [ ] SkillHub API 搜索响应 < 2 秒，20 个 Skill 可正常安装
- [ ] 安全审计状态准确标记（audited/pending/rejected）

---

## 从旧迭代计划迁移的未完成项

> 以下任务来自旧版 IterationPlan.md (v4.0)，在新计划中未覆盖但仍有价值，按版本归入。

### 归入 v1.0（Sprint 18 发布准备阶段补充）

| # | 任务 | 优先级 | 预估 | 说明 |
|---|------|--------|------|------|
| 18.5 | 错误提示中文化 + 修复建议：所有错误信息提供用户可理解的中文描述和具体修复步骤 | P1 | 1d | 企业用户零门槛 |
| 18.6 | 性能基准验证：冷启动 < 3 秒、空闲内存 < 200MB、三阶段记忆检索 < 200ms、流式首 Token < 500ms（不含 LLM） | P1 | 1d | 性能指标量化达标 |

**验收标准补充**:
- [ ] 所有用户可见的错误信息为中文且附带修复建议
- [ ] 冷启动 < 3 秒（M1 Mac 基准）

### 归入 v1.5（补充任务）

| # | 任务 | 归入 Sprint | 优先级 | 预估 | 说明 |
|---|------|------------|--------|------|------|
| 21.6 | 知识图谱增强：关系提取 prompt 增强（支持 5+ 种关系类型）+ 2 度关系扩展 + 图查询 API（`GET /knowledge/:agentId/graph`：实体查询、子图查询、路径查询）+ 实体合并 | Sprint 21 | P1 | 2d | 老计划遗留，知识图谱深化 |
| 21.7 | 响应质量评估 `evolution/quality-evaluator.ts`：每次对话后自动采集质量指标（工具调用成功率、对话轮数、重试次数、用户满意度信号），评估结果反馈到 capability_graph | Sprint 21 | P1 | 2d | 老计划 F8.8，进化引擎核心 |
| 21.8 | 记忆溯源 generation 字段：记忆提取时标注 generation 元数据（由哪次对话/哪个模型生成），`migrations/011_memory_generation.sql` + `GET /memory/:agentId/units/:id/provenance` | Sprint 21 | P2 | 1d | 老计划遗留，企业审计需要 |
| 20.5 | System prompt 缓存 `context/prompt-cache.ts`：缓存不变的 system prompt 段落（安全宪法、工具列表等），避免每轮重复 token 计算，目标命中率 > 50% | Sprint 20 | P2 | 1d | 老计划遗留，降低 token 消耗 |
| 22.7 | Rust 层 Skill 签名验证 `src-tauri/src/skill_verify.rs`：Ed25519 签名校验 + 内容 hash 比对 + 签名过期检查 | Sprint 22 | P2 | 2d | 老计划遗留，企业 Skill 安全 |
| 22.8 | 企业专家模板（8 个内置模板）：研究助手、编程伙伴、写作助手、数据分析师、项目管理、翻译助手、学习教练、生活管家。每个含完整 8 文件工作区 | Sprint 22 | P1 | 2d | 老计划 F2.2，降低创建门槛 |
| 22.9 | UX 体验打磨：暗色/亮色主题跟随系统 + 键盘快捷键（Cmd+N 新对话、Cmd+K 搜索）+ 空状态引导（无 Agent 时引导创建） | Sprint 22 | P2 | 2d | 从 v1.0 后移 |
| 22.10 | 文档：用户使用指南（内置帮助页）+ 各 Provider API Key 获取指南 + 飞书/企微 Bot 创建指南 + 企业管理员部署手册 | Sprint 22 | P2 | 2d | 从 v1.0 后移 |
| 22.11 | macOS DMG 签名 + 公证（Apple Notarization）+ Universal Binary（Intel + ARM） | Sprint 22 | P2 | 1d | 从 v1.0 后移 |

**验收标准补充**:
- [ ] 知识图谱图查询 API 支持实体/子图/路径三种查询模式
- [ ] 响应质量评估自动采集指标并写入 capability_graph
- [ ] 记忆溯源 API 返回完整生成链路（对话 ID → 模型 → 提取时间）
- [ ] System prompt 缓存命中率 > 50%
- [ ] Skill 签名验证支持 valid/invalid/unsigned 三种状态
- [ ] 8 个企业模板可一键创建 Agent

### 归入 v2.0（补充规划方向）

| 类别 | 内容 | 来源 |
|------|------|------|
| **Skill 自进化** | Agent 多次同一领域失败时，自动触发 Skill 生成流程（分析失败模式 → 生成 SKILL.md → 沙箱验证 → 自动安装），标记 `auto-generated` | 老计划 F4.7 |
| **协作工作流 DAG** | 用户自然语言描述协作流程 → 自动生成 Agent 协作 DAG → 执行引擎 + 人工审核节点 + 状态可视化 | 老计划 F6.5/F6.6/F6.7 |
| **企业团队管理** | 团队创建 + 成员邀请 + 共享 Agent（各成员记忆独立）+ 管理员策略（Provider 限制/沙箱强制/Skill 白名单）+ 合规报告 | 老计划企业版规划 |
| **多知识库隔离** | 多个独立知识库（工作文档/个人笔记/代码库）+ Agent 绑定不同知识库 + 团队级知识库共享 | 老计划 F5.5 |
| **自动更新** | macOS / Windows 应用自动更新机制（Tauri updater） | 老计划发布相关 |
| **E2E 综合测试套件** | 覆盖全流程：启动→创建→对话→记忆→Channel→Skill→进化→权限→沙箱→导入导出 | 老计划测试规划 |

---

## 优先级总览

### P0 — 立即行动（v1.0 Phase 1, W1-W4）

| # | 项目 | Sprint | 工作量 |
|---|------|--------|--------|
| 1 | 权限模型 Rust 全链路集成 | Sprint 11 | 10d |
| 16 | Heartbeat 空文件预检 + 鲁棒 ACK + 提示词重构 | Sprint 15.7 Phase 1 | 4.5d |

### P1 — v1.0 必须完成（W1-W12）

| # | 项目 | Sprint | 工作量 |
|---|------|--------|--------|
| 3 | Prompt 注入检测 17 模式 | Sprint 12 | 3d |
| 4 | Unicode 混淆检测 | Sprint 12 | 2d |
| 5 | exec 审批 argv 绑定 | Sprint 12 | 2d |
| 6 | 微信个人号渠道 | Sprint 13 | 11d |
| 7 | 企微 Channel 生产就绪 | Sprint 15 | 5d |
| 8 | 飞书 Channel 生产就绪 | Sprint 16 | 9d |
| 9 | 使用量追踪 | Sprint 17 | 7d |
| 10 | Auth Doctor 诊断 | Sprint 17 | 2d |
| 11 | 内存泄漏检测基础设施 | Sprint 11（前置） | 2d |
| 12 | 架构守卫测试 | Sprint 11（前置） | 2d |
| 13 | 安全仪表盘 UI | Sprint 11 | 2d |
| 14 | 错误提示中文化 + 修复建议 | Sprint 18 | 1d |
| 15 | 性能基准验证 | Sprint 18 | 1d |
| 16 | Wake 合并 + lightContext + System Events 增强 | Sprint 15.7 Phase 2 | 6d |

### P1 — v1.5 必须完成

| # | 项目 | Sprint | 工作量 |
|---|------|--------|--------|
| 19 | 钉钉 Channel | Sprint 19 | 6d |
| 20 | QQ Channel | Sprint 19 | 4d |
| 21 | LSP 工具集成 | Sprint 20 | 6d |
| 22 | 知识图谱增强（关系提取/图查询 API） | Sprint 21 | 2d |
| 23 | 响应质量评估（自动指标采集） | Sprint 21 | 2d |
| 24 | 子 Agent 派生增强 | Sprint 21 | 2d |
| 25 | 进化仪表盘 | Sprint 21 | 3d |
| 26 | 企业专家模板（8 个内置） | Sprint 22 | 2d |
| 27 | 部门/团队记忆隔离验证 | Sprint 22 | 1d |

### P2 — v1.5 完成

| # | 项目 | Sprint | 工作量 |
|---|------|--------|--------|
| 28 | 企业知识源集成 | Sprint 20 | 3d |
| 29 | 工单系统集成 | Sprint 20 | 2d |
| 30 | System prompt 缓存 | Sprint 20 | 1d |
| 31 | 压缩质量审计 | Sprint 21 | 2d |
| 32 | Rule-based 预过滤 | Sprint 21 | 2d |
| 33 | 可配置压缩模型 | Sprint 21 | 1d |
| 34 | 记忆溯源 generation 字段 | Sprint 21 | 1d |
| 35 | SIEM 集成 | Sprint 22 | 3d |
| 36 | Docker 沙箱 | Sprint 22 | 3d |
| 37 | 数据分类标记 | Sprint 22 | 2d |
| 38 | Rust 层 Skill 签名验证 | Sprint 22 | 2d |
| 39 | Brave LLM Context API | Sprint 22 | 1d |
| 40 | UX 体验打磨（主题/快捷键/空状态） | Sprint 22 | 2d |
| 41 | 文档（使用指南/API Key/Bot 创建） | Sprint 22 | 2d |
| 42 | macOS 签名 + 公证 | Sprint 22 | 1d |
| 43 | Cron 错误追踪 + TaskRegistry | Sprint 15.7 Phase 3 | 6d |

### P0/P1 — 工具系统优化（Sprint 14，当前进行中）

| # | 项目 | Sprint | 工作量 |
|---|------|--------|--------|
| 51 | Memory Flush 工具集成接入 PI session | Sprint 14 | 2d |
| 52 | MCP Server 集成（StdioClientTransport + tool discovery） | Sprint 14 | 3d |
| 53 | Read 自适应分页 + 多页自动拉取 | Sprint 14 | 2d |
| 54 | Schema Provider 适配（Gemini/xAI 兼容） | Sprint 14 | 2d |
| 55 | 工具目录规范化（tool-catalog.ts） | Sprint 14 | 1d |
| 56 | 子代理工具禁止列表显式化 | Sprint 14 | 1d |
| 57 | Exec safeBins 安全 profile | Sprint 14 | 1d |

### P2 — SkillHub（独立排期，最低优先级）

| # | 项目 | Sprint | 工作量 |
|---|------|--------|--------|
| 50 | EvoClaw SkillHub v1.0（API + 20 Skill + discoverer 接入） | Sprint 23 | 6d |

### P3 — v2.0+ 探索

| # | 项目 |
|---|------|
| 40 | ACP 兼容层（按客户需求驱动） |
| 41 | 移动端（等 Tauri 2.0 mobile 稳定） |
| 42 | 多设备同步（端到端加密） |
| 43 | Skill 自进化（失败模式 → 自动生成 SKILL.md） |
| 44 | 协作工作流 DAG + 人工审核节点 |
| 45 | 企业团队管理（成员/策略/合规报告） |
| 46 | 多知识库隔离 + 团队级共享 |
| 47 | 自动更新机制（Tauri updater） |
| 48 | E2E 综合测试套件（全流程覆盖） |

---

## 明确不做的事项

| 项目 | 原因 |
|------|------|
| 第三方插件系统 / Plugin SDK | 企业安全：可控攻击面 |
| GitHub URL 直装 Skill | 保留作为 SkillHub 上线前的过渡方案 |
| Web UI | 仅桌面应用，IM Channel 作为移动入口 |
| Linux 版本 | 企业桌面以 macOS + Windows 为主 |
| 本地模型 | 所有 LLM 调用统一走 ModelRouter |
| ACP 协议（近期） | 当前架构满足需求，按客户需求驱动 |

---

## 风险与缓解

| 风险 | 影响 | 概率 | 缓解策略 |
|------|------|------|---------|
| Rust 权限集成复杂度超预期 | v1.0 Phase 1 延期 | 中 | 优先保证 Node.js 层权限的正确性不退化，Rust 层增量增强 |
| 飞书/企微 API 变更 | Channel 不可用 | 低 | 抽象层隔离变更影响，官方 SDK 跟进 |
| SkillHub 冷启动 | Skill 数量不足 | 低 | 已降为最低优先级独立 Sprint，ClawHub + GitHub URL 直装可先行覆盖 |
| 168h 稳定性测试发现内存泄漏 | 发布延期 | 中 | 提前在 Sprint 17 就开始内存监控，不等到 Sprint 18 |
| 企业客户安全审计不通过 | 商业风险 | 低 | Sprint 11-12 安全增强 + 第三方渗透测试 |

---

## 附录：Feature ID 与 Sprint 映射

| Feature ID | 名称 | Sprint | 优先级 |
|-----------|------|--------|--------|
| F1.2 | 权限模型 Rust 集成 | Sprint 11 | P0 |
| F1.3 | Prompt 注入检测 | Sprint 12 | P1 |
| F1.4 | Unicode 混淆检测 | Sprint 12 | P1 |
| F1.5 | exec 审批绑定 | Sprint 12 | P1 |
| F1.6 | 沙箱环境变量阻断 | Sprint 22 | P2 |
| F1.8 | SIEM 审计集成 | Sprint 22 | P2 |
| F1.9 | 数据分类标记 | Sprint 22 | P2 |
| F1.10 | 安全仪表盘 | Sprint 11 | P1 |
| F4.2 | EvoClaw SkillHub | Sprint 23（独立排期） | P2 |
| F7.1 | 飞书 Channel 生产化 | Sprint 16 | P0 |
| F7.2 | 企微 Channel 生产化 | Sprint 15 | P0 |
| F7.3 | 钉钉 Channel | Sprint 19 | P1 |
| F7.4 | QQ Channel | Sprint 19 | P1 |
| F7.7 | 微信个人号 Channel | Sprint 13 | P0 |
| F8.2 | 使用量追踪 | Sprint 17 | P1 |
| F9.8 | LSP 工具集成 | Sprint 20 | P1 |
| F9.10 | Auth Doctor | Sprint 17 | P1 |
| F10.7 | 内存泄漏检测 | Sprint 18 | P1 |
| F10.8 | 架构守卫测试 | Sprint 18 | P1 |
| F3.13 | 压缩质量审计 | Sprint 21 | P2 |
| F3.14 | 可配置压缩模型 | Sprint 21 | P2 |
| F3.15 | Rule-based 预过滤 | Sprint 21 | P2 |
| F5.6 | 企业知识源集成 | Sprint 20 | P2 |
| F6.1 | 子 Agent 派生 | Sprint 21 | P1 |
| F11.2 | 工单系统集成 | Sprint 20 | P2 |
| F9.11 | Memory Flush 工具集成 | Sprint 14 | P0 |
| F9.12 | MCP 集成 | Sprint 14 | P1 |
| F9.13 | Read 自适应分页 | Sprint 14 | P1 |
| F9.14 | Schema Provider 适配 | Sprint 14 | P1 |
| F9.15 | 工具目录规范化 + safeBins | Sprint 14 | P1 |
| F9.16 | 子代理工具禁止列表 | Sprint 14 | P1 |
| F10.10 | Heartbeat 零污染（增强） | Sprint 15.7 | P0 |
| F11.6 | Reason-based 提示词体系 | Sprint 15.7 | P0 |
| F11.7 | Wake 合并与优先级调度 | Sprint 15.7 | P1 |
| F11.8 | 隔离 Session（lightContext） | Sprint 15.7 | P1 |
| F11.9 | System Events 增强 | Sprint 15.7 | P1 |
| F11.10 | Cron 错误追踪与状态机 | Sprint 15.7 | P2 |
| F11.11 | TaskRegistry 统一任务追踪 | Sprint 15.7 | P2 |
