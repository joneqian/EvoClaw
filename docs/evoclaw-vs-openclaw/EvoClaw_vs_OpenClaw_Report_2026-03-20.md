# EvoClaw vs OpenClaw 技术架构对比报告

> 日期: 2026-03-20
> 数据范围: OpenClaw 2026年3月1日-20日（~5100 提交）
> 目的: 12 维度全面对比，明确各自优劣，为 EvoClaw 后续迭代提供决策依据

---

## 综合评分总览

| 维度 | OpenClaw | EvoClaw | 判定 |
|------|:--------:|:-------:|------|
| 1. 插件/扩展架构 | ★★★★ | ★★☆ | **OpenClaw 胜** |
| 2. 上下文引擎与压缩 | ★★★ | ★★★☆ | **EvoClaw 略优** |
| 3. 记忆系统 | ★★☆ | ★★★★★ | **EvoClaw 显著胜** |
| 4. 模型/Provider 系统 | ★★★★ | ★★★ | **OpenClaw 胜** |
| 5. Channel/通信 | ★★★★★ | ★★ | **OpenClaw 碾压** |
| 6. Agent 通信协议 | ★★★★ | ★★☆ | **OpenClaw 胜** |
| 7. 安全模型 | ★★★☆ | ★★★☆ | **平手（设计理念 EvoClaw 更优）** |
| 8. 工具系统 | ★★★ | ★★★☆ | **EvoClaw 略优** |
| 9. 技能生态 | ★★★ | ★★★ | **平手** |
| 10. 桌面/移动体验 | ★★★☆ | ★★★★ | **EvoClaw 桌面体验胜** |
| 11. 架构哲学 | — | — | **定位不同，无优劣** |
| 12. 测试与 CI | ★★★★ | ★★★ | **OpenClaw 胜** |

**EvoClaw 核心护城河**: 记忆系统（L0/L1/L2 + 三阶段检索 + 热度衰减 + 知识图谱）、工具安全守卫、桌面体验、单 DB 简约、自进化引擎

**OpenClaw 核心优势**: 插件生态广度、Channel 覆盖、ACP 标准协议、社区规模（5000+ commits/月）、CI 成熟度

---

## 维度 1: 插件/扩展架构

### 判定: OpenClaw 更优

### 事实对比

| | OpenClaw | EvoClaw |
|---|---|---|
| 插件数量 | 78 个社区扩展 | 9 个内置 ContextPlugin |
| 注册机制 | 全局所有权注册表 + manifest 加载 | 工厂函数 `createXxxPlugin()` 代码注册 |
| SDK | Plugin SDK（scoped subpath imports） | 无外部 Plugin SDK |
| 生命周期 | 多种钩子（before_agent_start, agent_end 等） | 5 钩子（bootstrap→beforeTurn→compact→afterTurn→shutdown） |
| 按需加载 | 重型插件按需安装（WhatsApp、memory-lancedb） | 全部内置加载 |
| 第三方扩展 | 成熟社区生态 + npm 发布流程 | 规划中（manifest+register(api)） |
| 严格启动 | 插件加载失败立即报错 | 无严格模式 |

### 分析

OpenClaw 3 月最大的工程投入就是 **Plugin SDK 全面重构**：所有 Channel、Provider、Memory 实现全部迁移到 `extensions/` 目录，建立统一 scoped subpath imports，形成插件飞轮效应。78 个社区扩展 vs 9 个内置插件，生态成熟度是碾压级差距。

EvoClaw 的 5 钩子设计更简洁聚焦，优先级排序（10-90）+ 逆序 compact + afterTurn 并行（Promise.allSettled）的调度策略很精巧。但缺乏外部扩展能力是最大短板。

### EvoClaw 可借鉴

- **P1**: 实现 manifest+register(api) 插件系统，允许第三方贡献 ContextPlugin
- **P2**: 参考 scoped subpath imports 模式，提前规划好 import 边界（避免 OpenClaw 那样的大迁移阵痛）
- **P3**: 增加 strict bootstrap（插件加载失败立即报错）

---

## 维度 2: 上下文引擎与压缩

### 判定: EvoClaw 略优

### 事实对比

| | OpenClaw | EvoClaw |
|---|---|---|
| 接口设计 | 可插拔 `ContextEngine` 接口（6+3 方法） | 单一 `ContextEngine` 类 + ContextPlugin 系统 |
| 压缩触发 | token budget 参数传入 | 85% 阈值自动触发 |
| 压缩策略 | 可配置压缩模型 + 质量审计重试 | LCM 保留 3 近回合 + 逆序 compact + forceTruncate 兜底 |
| 向后兼容 | LegacyContextEngine 包装器 | 无需（单一实现） |
| 后压缩处理 | 可配置后压缩上下文段落 | 压缩后自动更新 conversation_log 状态 |
| 错误恢复 | 基本 | 多级（Auth 轮转→overload 退避→thinking 降级→context overflow→模型降级） |

### 分析

EvoClaw 的 **LCM（Lossless Compression Model）** 设计更贴合桌面伴侣场景：
- 保留最近 3 轮（6 条消息）原始内容 — 用户刚说的话不会被压缩丢失
- 85% 阈值自动触发 — 不需要外部传入 budget
- 逆序 compact（低优先级插件先压缩）— 非核心内容优先牺牲
- forceTruncate 兜底 — 极端情况下硬截断保活

OpenClaw 的**可插拔接口**和**质量审计重试**是亮点，但增加了延迟和复杂度。EvoClaw 的**多级错误恢复链**（5 级梯度降级）是独有优势。

### EvoClaw 可借鉴

- **P2**: 增加压缩质量审计（LLM 对比压缩前后信息保留度，防止关键决策被压缩丢失）
- **P3**: 可配置压缩模型选择（当前依赖 ModelRouter 默认模型，某些场景需要更强的压缩模型）

---

## 维度 3: 记忆系统

### 判定: EvoClaw 显著更优 ★★★★★

这是 EvoClaw 最大的技术护城河。

### 事实对比

| | OpenClaw | EvoClaw |
|---|---|---|
| 架构 | 两种互不兼容实现（file-backed + LanceDB） | **L0/L1/L2 统一三层架构** |
| 存储引擎 | 文件系统 / LanceDB（外部向量 DB） | better-sqlite3 + FTS5 + sqlite-vec（**单引擎全覆盖**） |
| 检索策略 | 简单搜索 | **三阶段渐进检索**（L0 宽搜→L1 排序→L2 按需深加载） |
| 记忆类别 | 5 类（preference/decision/entity/fact/other） | **9 类**（profile/preference/entity/event/case/pattern/tool/skill/correction） |
| 分类语义 | 无 merge/independent 区分 | **merge（同 key 合并）+ independent（独立条目）** |
| 热度衰减 | 无 | **sigmoid(log1p(access)) × exp(-0.099 × age_days)**，7 天半衰期 |
| 知识图谱 | 无 | **实体关系三元组**（subject, predicate, object） |
| 反馈循环防护 | 无 | **零宽空格标记**（`\u200b\u200b[EVOCLAW_MEM_START]\u200b\u200b`） |
| 注入检测 | 17 模式 prompt 注入检测 | 提取前 Stage 1 净化 + 4 步安全裁决 |
| Token 压缩率 | 无明确数据 | **80%+** |
| 捕获方式 | 规则过滤（regex 触发词） | **LLM 结构化提取**（一次 LLM 调用输出 XML） |

### 分析

EvoClaw 的记忆系统是经过深度研究（OpenViking、claude-mem、MemOS Cloud 三个项目）后的**原创设计**：

1. **L0/L1/L2 三层**实现了信息密度的梯度管理 — L0 一行摘要做索引（~50 tokens），L1 结构化概览做排序（~500-2K tokens），L2 完整内容按需加载（无限制）。这比 OpenClaw 的"要么文件全加载，要么向量全加载"高效得多。

2. **三阶段渐进检索**是核心创新：Phase 1 FTS5+sqlite-vec 宽搜出 30 候选 → Phase 2 L1 排序+热度加权出 Top-10 → Phase 3 L2 按需深加载（仅触发条件满足时）。每阶段都有明确的 token 预算（L2 总量 ≤ 8K）。

3. **9 类别 + merge/independent 语义** — correction 类别 +0.15 boost 确保用户纠正被优先召回；merge 语义避免同一实体产生大量重复条目。

4. **热度衰减**（每小时 tick）+ **冷记忆归档**（activation < 0.1 且 30 天未访问）确保记忆库不会无限膨胀。

5. **零宽空格反馈循环防护**是 EvoClaw 独创 — 注入到上下文的记忆用不可见标记包裹，提取阶段 Stage 1 净化时移除，防止"记忆被记忆再次存储"的死循环。OpenClaw 完全没有此机制。

OpenClaw 的优势仅在于 **17 模式 prompt 注入检测**更全面，可作为 EvoClaw text-sanitizer 的补充。

### EvoClaw 可借鉴

- **P2**: 增加 prompt 注入检测模式（参考 OpenClaw 17 模式，如 `ignore previous`, `system:`, `<|im_start|>` 等）
- **P3**: 规则捕获过滤作为 LLM 提取的前置快速路径（高置信度记忆不需要 LLM 调用）

---

## 维度 4: 模型/Provider 系统

### 判定: OpenClaw 更优

### 事实对比

| | OpenClaw | EvoClaw |
|---|---|---|
| 架构 | Provider 插件化，12+ hooks | PI ModelRouter + 4 层 fallback |
| 模型覆盖 | GPT-5.4, Gemini 3.1, xAI, MiMo V2, MiniMax M2.7, 40+ | OpenAI, Anthropic, DeepSeek, Qwen, GLM, Doubao, MiniMax |
| 按需安装 | Provider 按需安装 | 全部内置 |
| 诊断 | auth doctor 提示 | 基本错误信息 |
| 使用量追踪 | fetchUsageSnapshot | 无 |
| 国产模型方案 | provider 插件 + openai-completions | openai-completions + 自定义 baseUrl（**更简洁**） |
| ID 映射 | 无需（各 provider 自管） | pi-provider-map.ts（glm→zai） |

### 分析

OpenClaw 3 月新增了 **xAI 完整集成**、**MiMo V2**（切换到 openai-completions）、**MiniMax M2.7**、**Azure Foundry**、**fal 图像生成** 等 provider。12+ provider hooks（catalog、auth、usage、fallback 等）提供了极高的灵活性。

EvoClaw 通过 PI 框架的 **openai-completions + 自定义 baseUrl** 统一接入国产模型，方案更简洁。4 层 fallback（Agent→用户→系统→硬编码）清晰可预测。但模型覆盖面和 provider 生态差距明显。

### EvoClaw 可借鉴

- **P1**: 增加 auth doctor 式 API Key 诊断（用户配错 Key 时给出具体提示而非通用错误）
- **P2**: 跟进 MiMo V2、MiniMax M2.7 等新模型（已验证走 openai-completions 路线）
- **P3**: 增加 usage tracking（API 调用量/费用统计）

---

## 维度 5: Channel/通信

### 判定: OpenClaw 碾压

### 事实对比

| | OpenClaw | EvoClaw |
|---|---|---|
| Channel 数量 | **20+**（Discord/Telegram/Slack/WhatsApp/Matrix/飞书/LINE/Signal/iMessage/Mattermost/Zalo/BlueBubbles/Tlon/Nostr/Google Chat/MSTeams/IRC/Nextcloud Talk/Synology Chat…） | **3**（desktop/feishu/wecom） |
| 架构 | 每个 Channel 独立插件，20+ 可选适配器 | 内置于 Sidecar，简单适配器模式 |
| 交互消息 | 共享交互式消息模型（按钮、卡片跨渠道统一） | 无 |
| 线程路由 | per-topic agent routing（Telegram/Matrix 已实现） | Session Key 路由 |
| 消息去重 | 大量去重修复（Telegram/Mattermost/iMessage…） | 基本 |
| 新增（3月） | Matrix 大量增强、shared interactive messages、Voice Call | 无新增 |

### 分析

这是两者差距最大的维度。OpenClaw 是**多通道 Hub 定位**，20+ Channel 是核心价值。EvoClaw 是**桌面伴侣定位**，3 个 Channel 足够初期使用。

但 EvoClaw 的 Channel 适配器**内置于 Sidecar 而非插件化**是架构短板 — 未来增加新 Channel 需要修改核心代码。

### EvoClaw 可借鉴

- **P1**: Channel 适配器插件化（从内置改为可扩展框架，打开第三方贡献入口）
- **P2**: 补齐 QQ 适配器（规划中未实现）
- **P3**: 考虑 Telegram 适配器（国际用户场景）
- **参考**: OpenClaw 的共享交互式消息模型（跨渠道统一按钮/卡片）

---

## 维度 6: Agent 通信协议

### 判定: OpenClaw 更优

### 事实对比

| | OpenClaw | EvoClaw |
|---|---|---|
| 协议 | **ACP（Agent Communication Protocol）**标准化 | 直接 HTTP（Hono） |
| 会话管理 | ACP 服务器 + sessionId/sessionKey | Lane Queue + per-sessionKey 串行 |
| 多 Agent 协作 | sessions_yield（协作让步）+ sessions_spawn（带 resume） | sub-agent-tools.ts（基本子 Agent 调用） |
| 审计追溯 | provenance receipts（meta/meta+receipt 模式） | 工具审计日志 |
| IDE 集成 | ACP 客户端流式更新 | SSE 推送 |
| Dashboard | Session 管理 API + WebSocket 推送 + HTTP kill session | 基本 |

### 分析

ACP 是 OpenClaw 3 月重点投入的方向（~1000 行翻译层、provenance receipts、IDE 流式、follow-up 可靠性等）。这是一个标准化的 Agent 间通信协议，具备互操作性。

EvoClaw 的 Lane Queue（main:4 / subagent:8 / cron:可配）+ per-sessionKey 串行足够桌面场景使用。sub-agent-tools 提供基本多 Agent 能力。但缺乏标准化协议意味着未来难以与外部 Agent 系统对接。

### EvoClaw 可借鉴

- **P3**: 长期考虑 ACP 兼容层（不急迫，桌面场景需求低）
- **P2**: Session 管理 Dashboard API（子 Agent 会话暴露 + WebSocket 推送 + kill 能力）

---

## 维度 7: 安全模型

### 判定: 平手（设计理念 EvoClaw 更优，实现覆盖 OpenClaw 更全）

### 事实对比

| | OpenClaw | EvoClaw |
|---|---|---|
| 凭证存储 | SecretRef 软件抽象（文件级加密） | **macOS Keychain + AES-256-GCM**（硬件级） |
| 权限模型 | auto-approval 白名单 + 危险工具黑名单 | **7 类别 × 4 作用域**（once/session/always/deny） |
| 沙箱 | 环境变量注入阻断（JVM/Python/.NET） | **Docker 3 模式**（off/selective/all） |
| 审计 | 50KB audit.ts 综合审计 | tool_auditor + permission 日志 |
| 命令审批 | exec 审批绑定精确 argv + Unicode 混淆检测 | 11 个危险命令模式 + 消息工具强制确认 |
| 注入防护 | 17 模式 prompt 注入检测 | 零宽空格反馈循环防护 + 4 步安全裁决 |
| Skill 安全 | 插件工作区信任 | **签名验证 + 安全扫描 + 沙箱试运行** |
| 历史问题 | 明文凭证、93.4% 认证绕过（已修复） | 无已知漏洞 |
| 实现完成度 | ~90% | **~40%**（Rust 层集成待完成） |

### 分析

**设计层面 EvoClaw 更优**:
- macOS Keychain 硬件级安全 vs SecretRef 软件抽象
- 7×4 权限矩阵粒度更细（但仅 40% 已实现）
- Docker 3 模式沙箱给用户选择权
- 「安全默认」是架构第一原则（Architecture.md 明确声明）

**实现层面 OpenClaw 更全**:
- Unicode 混淆检测（蒙古文选择符等同形字符攻击）
- 17 模式 prompt 注入检测
- exec 审批绑定精确 argv 文本
- 50KB 综合审计系统
- 沙箱环境变量注入阻断（JAVA_TOOL_OPTIONS、PYTHONBREAKPOINT、DOTNET_STARTUP_HOOKS）

### EvoClaw 可借鉴

- **P0**: 补齐权限模型剩余 60%（安全是品牌承诺，不能打折）
- **P1**: 增加 Unicode 混淆检测（同形字符攻击防护）
- **P1**: 增加 prompt 注入检测模式（参考 OpenClaw 17 模式）
- **P2**: 沙箱环境变量注入阻断（JVM/Python/.NET 注入向量）
- **P2**: exec 审批绑定精确 argv（防止参数篡改）

---

## 维度 8: 工具系统

### 判定: EvoClaw 略优

### 事实对比

| | OpenClaw | EvoClaw |
|---|---|---|
| 注入方式 | 插件注册 + 运行时发现 | **5 阶段管道**（PI 基础→替换→EvoClaw 特有→Channel→MCP+Skills） |
| 安全守卫 | 工具种类分类（read/search/other） | **循环检测**（重复/乒乓/熔断器阈值 30）+ **结果截断**（超 context budget 50%） |
| 图像生成 | image_generate provider 注册表（OpenAI/Google/fal） | image 工具（Vision API 直调） |
| LSP 集成 | **LSP 工具运行时**（Agent 通过 JSON-RPC 调用 LSP 服务器） | 无 |
| 搜索增强 | Brave LLM Context API 模式 | web_search（Brave 标准 API）+ web_fetch |
| 审计 | 基本 | **完整审计链**（permission-interceptor → tool-auditor → audit_log 表） |
| 执行审批 | Telegram exec approvals | 危险命令弹窗确认 |

### 分析

EvoClaw 的 **5 阶段工具注入管道**设计系统性更强，清晰分层。**工具安全守卫**是独有创新 — 循环检测（同一工具反复调用检测 + 输出 hash 无进展检测）和结果截断（超过 context budget 50% 自动 head+tail 策略截断）在 OpenClaw 中没有对应物。

OpenClaw 的 **LSP 工具运行时**是亮点 — Agent 能直接调用 LSP 服务器获取代码补全、诊断等能力。**image_generate provider 注册表**也比 EvoClaw 的单一 Vision API 调用更灵活。

### EvoClaw 可借鉴

- **P2**: LSP 工具集成（coding Agent 场景价值大）
- **P2**: image_generate provider 注册表模式（支持多家图像生成服务）
- **P3**: Brave LLM Context API 模式（返回适合 LLM 的预处理页面内容）

---

## 维度 9: 技能生态

### 判定: 平手

### 事实对比

| | OpenClaw | EvoClaw |
|---|---|---|
| 来源 | ClawHub + skills.sh + Chrome 扩展（已迁移 MCP） | ClawHub API + GitHub URL 直装 |
| 注入策略 | 插件拥有的 skills + 系统 prompt 注入 | **Tier 1 XML 目录（~50-100 tokens/skill）+ Tier 2 按需加载** |
| 门控 | 无（运行时检查） | **自定义门控**（requires.bins/env/os，EvoClaw 扩展 AgentSkills 规范） |
| 安全分析 | 基本 | **完整 5 步生命周期**（discover→parse→analyze→install→gate） |
| 社区规模 | 13,700+ ClawHub Skills | 共享同一 ClawHub 生态 |
| MCP 方向 | Chrome 扩展已迁移到 MCP | MCP 支持在规划中 |

### 分析

EvoClaw 的 **Tier 1/2 渐进注入**设计 token 效率更高 — Tier 1 仅注入技能目录（每 skill ~50-100 tokens），模型按需用 Read 工具加载 Tier 2 完整指令。OpenClaw 倾向于将更多 skill 内容直接注入 prompt，token 消耗更高。

EvoClaw 的 **skill-gate.ts**（检查 bins/env/os）是 PI/AgentSkills 规范没有的自定义扩展，防止不兼容 Skill 加载。**5 步安全分析生命周期**也更严谨。

但 OpenClaw 正在全面迁移到 **MCP**（Model Context Protocol），这是行业趋势。EvoClaw 需要跟进。

### EvoClaw 可借鉴

- **P1**: MCP 集成（行业趋势，OpenClaw 已迁移方向）
- **P2**: Skill 自动更新机制

---

## 维度 10: 桌面/移动体验

### 判定: EvoClaw 桌面体验更优，OpenClaw 平台覆盖更广

### 事实对比

| | OpenClaw | EvoClaw |
|---|---|---|
| 入口 | CLI 优先 + Dashboard v2 + Web UI + macOS 原生 | **Tauri 2.0 桌面优先**（~15MB） |
| 移动端 | Android（全面重设计 + 暗色主题）+ iOS（Live Activity + App Store） | 无 |
| Agent 创建 | 配置文件 / CLI | **对话式 6 阶段引导向导** |
| 品牌化 | 单一品牌 | **双品牌**（EvoClaw/HealthClaw，一套代码） |
| 体积 | CLI + Node.js 运行时 | **~15MB**（Tauri 原生） |
| 3 月新增 | Dashboard v2 重构、Android 暗色主题、iOS App Store 准备 | Agent/Skill 页面增强 |

### 分析

EvoClaw 的**桌面体验是核心竞争力**：
- Tauri 2.0 原生 ~15MB（vs Electron 100MB+）
- 对话式 Agent 创建向导（6 阶段引导，实时预览）— 这是桌面伴侣的杀手级体验
- 双品牌支持（一套代码出 EvoClaw + HealthClaw）— 商业模式灵活

OpenClaw 的**全平台覆盖**更广（CLI/Web/Desktop/Android/iOS），但每个平台体验深度不及 EvoClaw 桌面端。

### EvoClaw 可借鉴

- **P3**: Tauri 2.0 原生支持 iOS/Android，可探索移动端
- **P3**: Web UI 版本作为轻量级入口（不需要安装桌面应用）

---

## 维度 11: 架构哲学

### 判定: 定位不同，无绝对优劣

| | OpenClaw | EvoClaw |
|---|---|---|
| 定位 | **服务端网关**，多通道 AI Hub | **桌面伴侣**，个人/小团队 AI 助手 |
| 核心原则 | 插件一切，社区驱动 | 安全默认，PI 框架杠杆，单 DB 简约 |
| 数据存储 | 多引擎（文件 + LanceDB + Redis 等） | **单引擎**（better-sqlite3 覆盖全部） |
| 差异化 | Channel 覆盖广度 + 社区生态 | **自进化引擎**（capability-graph + growth-tracker + feedback-detector）+ **记忆深度** |
| 复杂度 | 高（5000+ commits/月） | 低（核心 ~26K 行，可维护性好） |
| 运维成本 | 需要 Docker/Gateway/多 DB | **零运维**（本地 SQLite，无外部依赖） |

### 分析

两者不在同一赛道竞争：
- OpenClaw 是**基础设施级**产品 — 企业部署多通道 AI 网关
- EvoClaw 是**消费级**产品 — 个人桌面 AI 伴侣

EvoClaw 的「自进化」（Evolution Engine）是独特定位：Agent 通过 capability_graph 追踪成长、feedback-detector 分析用户反馈、gap-detection 发现能力缺口并推荐 Skill，形成"越用越聪明"的飞轮。这在 OpenClaw 中完全没有对应概念。

---

## 维度 12: 测试与 CI

### 判定: OpenClaw 更优

### 事实对比

| | OpenClaw | EvoClaw |
|---|---|---|
| 测试框架 | Vitest + 大量自研工具 | Vitest + Oxlint |
| 特色 | OOM 隔离、内存泄漏检测、架构异味探测器、插件契约测试 | 77 个测试文件（~11.7K 行），7 个 e2e 测试 |
| CI 投入 | 重型（3 月数百个 CI 相关提交） | 轻量级 |
| 内存管理 | 大量 OOM 热点隔离、2GB 主机优化 | 无特别处理 |
| 测试类型 | unit + integration + contract + e2e + memory-leak | unit + e2e |

### 分析

OpenClaw 的 CI 投入反映了**大规模生产运行经验** — OOM 隔离、内存泄漏检测工具、架构异味探测器都是踩过坑后的产物。**插件契约测试**确保 provider/channel 插件遵守接口契约。

EvoClaw 的 77 个测试文件覆盖了每个核心模块，7 个 e2e 测试覆盖核心流程（agent-lifecycle、chat-flow、guided-creation、memory-cycle、permission-flow、provider-config、startup）。测试密度不低，但缺乏生产级稳定性测试。

### EvoClaw 可借鉴

- **P2**: 增加内存泄漏检测（Sidecar 长期运行场景，Node.js 进程可能内存泄漏）
- **P2**: 架构守卫测试（防止循环依赖、层级违反等退化）
- **P3**: 插件契约测试（为未来插件系统做准备）

---

## EvoClaw 优先改进建议（按 ROI 排序）

### P0 — 立即行动（安全承诺相关）

| # | 改进项 | 来源维度 | 预估工作量 |
|---|---|---|---|
| 1 | 补齐权限模型剩余 60%（Rust 层集成） | 安全模型 | 大 |

### P1 — 短期优先（1-2 个 Sprint）

| # | 改进项 | 来源维度 | 预估工作量 |
|---|---|---|---|
| 2 | 实现 manifest+register(api) 插件系统 | 插件架构 | 大 |
| 3 | 增加 Unicode 混淆检测 + prompt 注入检测（17 模式） | 安全模型 | 中 |
| 4 | Channel 适配器插件化 | Channel | 大 |
| 5 | MCP 集成 | 技能生态 | 大 |
| 6 | Auth doctor 式 API Key 诊断 | Provider | 小 |

### P2 — 中期改进（2-4 个 Sprint）

| # | 改进项 | 来源维度 | 预估工作量 |
|---|---|---|---|
| 7 | 压缩质量审计 | 上下文引擎 | 中 |
| 8 | LSP 工具集成 | 工具系统 | 大 |
| 9 | Session 管理 Dashboard API | ACP | 中 |
| 10 | 内存泄漏检测 | 测试 | 中 |
| 11 | 跟进新模型（MiMo V2、MiniMax M2.7） | Provider | 小 |
| 12 | image_generate provider 注册表 | 工具系统 | 中 |
| 13 | 沙箱环境变量注入阻断 | 安全模型 | 中 |
| 14 | 架构守卫测试 | 测试 | 小 |

### P3 — 长期探索

| # | 改进项 | 来源维度 | 预估工作量 |
|---|---|---|---|
| 15 | ACP 兼容层 | 通信协议 | 大 |
| 16 | 移动端探索（Tauri 2.0 iOS/Android） | 体验 | 超大 |
| 17 | 可配置压缩模型 | 上下文引擎 | 小 |
| 18 | Brave LLM Context API 模式 | 工具系统 | 小 |
| 19 | 插件契约测试 | 测试 | 中 |

---

## 核心结论

**EvoClaw 不应追赶 OpenClaw 的广度（Channel、Provider、社区规模），而应深耕自己的深度优势**：

1. **记忆系统是最大护城河** — L0/L1/L2 + 三阶段检索 + 热度衰减 + 知识图谱的组合在开源 AI Agent 领域无出其右
2. **桌面体验是差异化定位** — 对话式创建、~15MB 原生、零运维，这是 OpenClaw 做不到的
3. **自进化引擎是长期壁垒** — capability_graph + growth_tracker + gap_detection 形成"越用越聪明"的飞轮

**最需要补齐的短板**：安全实现完成度（40%→90%）、插件系统开放性、MCP 集成。这三项直接影响产品可信度和生态扩展性。
