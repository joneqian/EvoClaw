# EvoClaw 产品需求文档 (PRD)

> **文档版本**: v4.0
> **创建日期**: 2026-03-11
> **更新日期**: 2026-03-13
> **产品名称**: EvoClaw
> **一句话定位**: 第一个会自我进化的 AI 伴侣 -- 安全默认、零门槛、越用越聪明
> **目标市场**: 中国国内用户

---

## 目录

1. [产品愿景与定位](#1-产品愿景与定位)
2. [目标用户画像](#2-目标用户画像)
3. [核心功能需求](#3-核心功能需求)
4. [非功能需求](#4-非功能需求)
5. [技术约束与假设](#5-技术约束与假设)
6. [MVP 范围定义](#6-mvp-范围定义)
7. [迭代路线图](#7-迭代路线图)
8. [竞品对比矩阵](#8-竞品对比矩阵)
9. [风险与缓解策略](#9-风险与缓解策略)
10. [成功指标 (KPI)](#10-成功指标-kpi)

---

## 1. 产品愿景与定位

### 1.1 产品愿景

让每个人拥有一个安全、私密、会持续成长的 AI 伴侣。用户不需要理解 API Key、YAML 配置、Docker 部署，只需打开 EvoClaw，用自然语言描述需求，AI 助手就能帮你完成任务 -- 并且每一次交互都让它变得更懂你。

### 1.2 核心定位

**"第一个会自我进化的 AI 伴侣"**

三个关键词：

| 关键词 | 含义 |
|--------|------|
| **自我进化** | Agent 通过多层记忆系统（L0/L1/L2 三层分级记忆、渐进检索、hotness 衰减、知识图谱）、行为反馈、能力自发现持续成长，越用越聪明 |
| **安全** | 数据本地加密存储，凭证系统级保护，权限分级管控，Skill 签名验证，记忆跨通道安全隔离 |
| **伴侣** | 不是冷冰冰的工具，而是有记忆、有个性、能持续陪伴成长的 AI |

### 1.3 市场定位

EvoClaw 基于 PI 框架（OpenClaw 底层引擎）构建，兼容 OpenClaw 生态（Skills、SOUL.md 模板），同时拥有超越同类产品的安全性和零门槛体验。**面向中国国内用户**，深度集成国内主流 IM 平台和大模型服务。

| 产品 | 定位 | 核心矛盾 |
|------|------|----------|
| OpenClaw | "Your personal AI" | 记忆能力强大但安全隐患严重，配置门槛高（15+ 小时），面向海外用户 |
| DeerFlow | "Agent runtime" | 开发者工具，非终端用户产品，无原生应用 |
| 智谱 AutoClaw | "企业级 AI Agent" | 聚焦企业客户，个人用户定制化不足 |
| 腾讯 WorkBuddy | "工作效率伴侣" | 绑定腾讯生态，跨平台能力受限 |
| 华为小艺Claw | "全场景 AI 助手" | 深度绑定鸿蒙生态，非鸿蒙用户难以使用 |
| 小米 miClaw | "智能生活助手" | 聚焦 IoT 场景，知识工作场景覆盖不足 |
| **EvoClaw** | **"Self-evolving AI"** | **PI 框架集成、兼容 OpenClaw Skills/模板生态、安全默认、零门槛、深度适配国内生态** |

### 1.4 为什么是现在

1. **安全危机窗口**: OpenClaw 的安全丑闻（Google 安全工程副总裁公开警告不要安装）为"安全优先"的替代品创造了市场需求
2. **用户认知升级**: 越来越多的用户关注 AI 隐私问题，"安全优先"从极客偏好变为主流需求
3. **MCP 协议普及**: Model Context Protocol 生态的快速发展降低了能力扩展的技术门槛
4. **国内大模型生态成熟**: DeepSeek、Qwen、GLM、MiniMax 等国产大模型质量追平国际水准，API 价格极具竞争力
5. **记忆架构研究成熟**: OpenViking L0/L1/L2 三层分级、claude-mem 渐进检索、MemOS 记忆安全协议等研究成果为记忆系统实现提供了清晰的技术路线参考
6. **自进化 Agent 范式涌现**: MetaClaw（MAML 式 Agent 生成）、AutoGPT（自主任务分解）等项目验证了 Agent 自动进化的技术可行性，为 Skill 自生成和响应质量评估提供了借鉴

---

## 2. 目标用户画像

### 2.1 用户画像一：知识工作者 -- "小王"

| 维度 | 描述 |
|------|------|
| **表层** | 28 岁，上海，互联网公司产品经理，Mac 用户 |
| **行为** | 每天处理大量文档、邮件、会议纪要；常用飞书、企微；通勤时间 1 小时 |
| **动机** | 希望有一个助手帮自己做信息整理和初步分析，但担心公司机密数据泄露到云端 |
| **痛点** | ChatGPT 好用但不敢把公司文档喂给它；OpenClaw 试过但花了两个周末配置还没跑通；希望 AI 助手能直接在飞书/企微中使用 |
| **核心 JTBD** | "当我需要快速整理分散在各处的信息时，我希望有一个既聪明又安全的助手，这样我可以放心地把工作资料交给它处理，而不用担心数据泄露" |

### 2.2 用户画像二：独立开发者 -- "老李"

| 维度 | 描述 |
|------|------|
| **表层** | 35 岁，杭州，全栈独立开发者，Mac + Linux 双系统 |
| **行为** | 日常在 VS Code / Terminal 中工作；关注开源社区动态；喜欢折腾新工具但讨厌繁琐配置 |
| **动机** | 想要一个编程伙伴，能记住自己的代码风格和项目上下文，帮助调试、写测试、查文档 |
| **痛点** | 每次开新 ChatGPT 对话都要重新解释项目背景；OpenClaw 安全问题让他不敢在生产环境用 |
| **核心 JTBD** | "当我在多个项目间切换时，我希望 AI 助手能记住每个项目的上下文和我的编码偏好，这样我可以无缝衔接工作而不用反复解释" |

### 2.3 用户画像三：效率极客 -- "小陈"

| 维度 | 描述 |
|------|------|
| **表层** | 24 岁，北京，研究生在读（计算机方向），Windows + macOS 双平台 |
| **行为** | 热衷于各类效率工具和自动化工作流；在 V2EX、即刻活跃；喜欢尝鲜 |
| **动机** | 想搭建一套个性化的 AI 助手体系，帮自己管理学习笔记、论文阅读、日程安排 |
| **痛点** | 用了十几个 AI 工具但它们各自为政；想通过 QQ 群或飞书直接调用 AI 而不用切换应用 |
| **核心 JTBD** | "当我面对海量学习资料和碎片化任务时，我希望有一个越用越懂我的 AI 系统，这样它能主动帮我整理信息、提醒任务，而我只需要专注于学习本身" |

### 2.4 用户共性与差异

| 维度 | 共性 | 差异 |
|------|------|------|
| **安全需求** | 全部关注数据隐私，不信任纯云端方案 | 小王：公司合规驱动；老李：技术理解深入；小陈：跟随大众认知 |
| **门槛容忍度** | 全部排斥繁琐配置 | 小王：完全零门槛；老李：接受少量配置但要合理；小陈：愿意折腾但需要引导 |
| **进化需求** | 全部希望 AI "记住我" | 小王：记住工作偏好；老李：记住代码风格和项目上下文；小陈：记住学习进度和兴趣 |
| **IM 平台** | 全部使用国内主流 IM | 小王：飞书/企微；老李：飞书；小陈：QQ |

---

## 3. 核心功能需求

### 3.1 特性一：内置安全机制

> **核心理念**: 安全不是用户需要配置的选项，而是产品出厂自带的基因。

#### 用户故事

> 小王第一次打开 EvoClaw，没有任何安全配置页面。当他导入第一份工作文档时，文档自动以加密形式存储。当一个 Agent 试图访问文件系统时，弹窗提示"该 Agent 想访问你的文件系统，是否允许？" -- 像 iPhone 上的权限弹窗一样简单直观。小王感到安心：不需要当安全专家也能安全使用 AI 助手。

#### 功能拆解

| 子功能 | 描述 | 优先级 |
|--------|------|--------|
| **F1.1 零配置安全默认** | 首次启动即启用加密存储（AES-256）、进程间安全通信、Agent 沙箱执行环境。用户无需任何手动配置 | **P0** |
| **F1.2 权限分级模型** | 类 iOS 权限系统：Agent 请求能力时弹窗授权。权限分为文件系统、网络访问、系统命令执行、剪贴板、通知五大类。支持"仅本次 / 始终允许 / 始终拒绝"三种授权粒度 | **P0** |
| **F1.3 Skill 签名验证** | 安装 Skill 前自动校验数字签名；签名通过后在沙箱中试运行，检测异常行为（如未声明的网络请求、文件读写越界）；运行期行为审计日志 | **P0** |
| **F1.4 凭证金库** | 集成系统级安全存储：macOS Keychain / Windows Credential Manager / Linux Secret Service。所有 API Key、Token 等敏感信息绝不以明文形式存在于磁盘、内存日志或配置文件中 | **P0** |
| **F1.5 安全仪表盘** | 提供安全状态总览面板：已授权权限清单、Skill 安全评分、最近安全事件日志、一键撤销授权 | **P1** |

#### 验收标准

- [ ] 全新安装后零配置即达到加密存储 + 沙箱执行 + 权限控制的安全基线
- [ ] Agent 首次请求任何敏感权限时，必须弹窗获得用户明确授权
- [ ] 未签名或签名无效的 Skill 无法安装；沙箱试运行发现异常行为时阻止安装并告知用户
- [ ] 通过安全审计工具扫描，不存在明文存储的凭证信息
- [ ] 权限可随时在安全仪表盘中查看和撤销

---

### 3.2 特性二：语义化 Agent 创建

> **核心理念**: 创建 AI 助手应该像和朋友聊天一样简单，而不是编写配置文件。

#### 用户故事

> 小陈想创建一个"论文阅读助手"。他点击"创建新 Agent"，EvoClaw 问："你想创建什么样的助手？" 小陈说："帮我读论文、提取关键信息、做笔记的助手。"EvoClaw 继续追问："你通常读什么领域的论文？偏好什么样的笔记格式？"几轮对话后，一个定制化的论文助手就创建好了。小陈还可以随时和"半成品"对话测试，不满意就继续调整。

#### 功能拆解

| 子功能 | 描述 | 优先级 |
|--------|------|--------|
| **F2.1 对话式创建引导** | 通过多轮自然语言对话收集用户需求，自动生成 Agent 工作区的全部 8 个文件：SOUL.md（行为哲学）、IDENTITY.md（外在展示）、AGENTS.md（操作规程）、TOOLS.md（工具文档）、HEARTBEAT.md（周期性行为）、USER.md（用户画像）、MEMORY.md（长期记忆快照）、BOOTSTRAP.md（启动引导） | **P0** |
| **F2.2 模板市场** | 预置常见 Agent 模板：研究助手、编程伙伴、写作助手、生活管家、学习教练等。用户可基于模板一键创建后再通过对话微调 | **P1** |
| **F2.3 实时预览与测试** | 创建过程中随时可和"半成品 Agent"对话测试效果，不满意可回退修改。所见即所得的创建体验 | **P1** |
| **F2.4 Agent 工作区模板结构** | 每个 Agent 包含标准化的 8 文件工作区结构（SOUL.md、IDENTITY.md、AGENTS.md、TOOLS.md、HEARTBEAT.md、USER.md、MEMORY.md、BOOTSTRAP.md），兼容 OpenClaw 格式，可导出、可分享 | **P0** |
| **F2.5 Agent 导入/导出** | 支持将 Agent（含完整工作区文件 + 已安装 Skill 列表）打包导出为标准格式，可在其他 EvoClaw 实例上导入 | **P2** |
| **F2.6 社区模板兼容** | 兼容 103+ OpenClaw 社区 SOUL.md 模板，用户可直接导入使用或基于社区模板创建 Agent | **P1** |

#### 验收标准

- [ ] 用户通过纯自然语言对话（无需接触任何配置文件）即可完成 Agent 创建
- [ ] 创建引导至少覆盖角色定位、专长领域、语气风格、行为约束四个维度的追问
- [ ] 模板市场提供至少 5 个高质量预置模板
- [ ] 创建过程中可随时切换到测试对话，验证 Agent 行为是否符合预期
- [ ] 生成的 8 文件工作区结构规范，兼容 OpenClaw 格式，人类可读
- [ ] 可成功导入 OpenClaw 社区 SOUL.md 模板并基于其创建 Agent

---

### 3.3 特性三：Agent 自我进化 -- 多层记忆系统

> **核心理念**: EvoClaw 名字中的 "Evo"（Evolution）就是灵魂 -- Agent 不是静态的工具，而是会持续成长的伴侣。进化的基础是一套完整的多层记忆系统：L0/L1/L2 三层分级存储、三阶段渐进检索、hotness 衰减机制、知识图谱、跨通道记忆路由，让 Agent 真正具备"越用越聪明"的能力。

#### 用户故事

> 老李用 EvoClaw 的编程助手已经两个月了。今天他打开进化日志，看到："本周学会了 3 个新技能：TypeScript 泛型最佳实践、Vitest 单元测试模式、pnpm workspace 配置。代码建议采纳率从 68% 提升到 82%。"老李还注意到，助手已经完全适应了他的代码风格 -- 变量命名偏好 camelCase、注释习惯用中文、喜欢函数式编程范式。这些都是 Agent 从日常交互中自动学到的，老李从未手动配置过任何一条规则。
>
> 更令他惊喜的是，即使在一段很长的调试对话中，助手也没有"忘掉"开头讨论的架构决策 -- PI auto-compaction 配合 L0/L1/L2 记忆检索确保了关键上下文不会丢失。而他在飞书群里和同事讨论时，助手的回答从不会暴露他私聊中透露的个人编码偏好 -- 记忆安全隔离确保了隐私边界。

#### 3.3.1 多层记忆架构总览

EvoClaw 的记忆系统借鉴 OpenViking、claude-mem、MemOS 三个项目验证过的核心机制，在 better-sqlite3 单引擎上自主实现：

**核心数据架构 -- 三表协同**:

| 表 | 职责 | 查询模式 |
|----|------|---------|
| **memory_units** | 提炼后的结构化知识，L0/L1/L2 三层存储 | 高频查询，需要快 |
| **knowledge_graph** | 实体间关系网络 | 图查询（subject → predicate → object） |
| **conversation_log** | 原始对话数据，只增不改 | 审计追溯和二次提取 |

**记忆分类体系（9 类）**:

| 分类 | 语义 | 说明 |
|------|------|------|
| profile | merge | 用户基本信息（姓名、职业、所在地） |
| preference | merge | 偏好设定（编程风格、沟通方式） |
| entity | merge | 实体知识：人物/组织/项目 |
| event | independent | 事件/情景记忆 |
| case | independent | Agent 处理过的案例 |
| pattern | merge | 可复用的流程模板 |
| tool | merge | 工具使用经验 |
| skill | merge | 技能/能力沉淀 |
| correction | merge | 用户纠正记录（高优先级） |

**L0/L1/L2 三层分级存储**:

| 层级 | 用途 | Token 量 | 加载时机 |
|------|------|---------|---------|
| **L0** | 一句话摘要，向量检索键 | ~50-100 | Phase 1 宽检索 |
| **L1** | 结构化概览，Markdown 格式 | ~500-2K | Phase 2 精筛 |
| **L2** | 完整内容，含完整背景和细节 | 全文 | Phase 3 按需深加载 |

**merge/independent 语义**: merge 型记忆按 merge_key 去重更新（如用户职业变更时覆盖旧值），independent 型每条独立存储（如每次事件独立记录）。

#### 3.3.2 记忆提取 Pipeline

对话结束后（agent_end 钩子），记忆提取分三个阶段执行：

```
对话结束
    |
    v
+-------------------------------------+
| Stage 1: 预处理（纯逻辑，不调 LLM）    |
| - 剥离注入的记忆上下文（反馈循环防护）  |
|   使用零宽空格标记识别注入内容          |
| - 过滤无信息量的消息（命令、问候等）     |
| - 截断超长工具输出（<=1000 字符）       |
| - CJK 感知的最小长度检查               |
+---------+---------------------------+
          | 有效内容
          v
+-------------------------------------+
| Stage 2: 记忆提取（一次 LLM 调用）     |
| - 输入：预处理后的对话文本              |
| - 输出：结构化 XML，每条含              |
|   category + merge_key + L0/L1/L2    |
| - 同时输出关系三元组                    |
|   (subject, predicate, object)       |
| - 记忆安全四步裁决：                    |
|   来源验证 -> 归属检查 ->              |
|   置信度评估 -> 隐私边界               |
+---------+---------------------------+
          | ParsedMemory[]
          v
+-------------------------------------+
| Stage 3: 持久化（纯逻辑，不调 LLM）    |
| - merge 型：查 merge_key，存在则更新   |
|   L1/L2，L0 不变（保持向量索引稳定）   |
| - independent 型：直接 INSERT          |
| - 关系三元组写入 knowledge_graph       |
| - 标记已处理的 conversation_log 行     |
| - 异步生成 L0 embedding 写入向量表     |
+-------------------------------------+
```

#### 3.3.3 三阶段渐进检索

每轮对话前（before_agent_start 钩子），通过三阶段渐进加载实现 80%+ token 压缩：

```
用户消息
    |
    v
Phase 1: L0 宽检索（~50ms）
    - FTS5 关键词搜索 l0_index（权重 0.3）
    - sqlite-vec 向量搜索 L0 embedding（权重 0.5）
    - knowledge_graph 关系扩展（权重 0.2）
    - 返回 Top-30 候选 { id, l0, category, activation, score }
    |
    v
Phase 2: 排序 + L1 精筛
    - finalScore = searchScore
      x hotness(activation, access, age)
      x categoryBoost(queryType, category)
      x correctionBoost (correction 类 +0.15)
    - 去重：同 merge_key 只保留最新
    - 可见性过滤（private/shared/channel_only）
    - 取 Top-10，加载 L1 overview
    - 按 category 分组格式化
    |
    v
Phase 3: L2 按需深加载
    - 触发条件（任一满足）：
      a) 用户消息含追问信号（"详细说说/具体是什么/当时怎么..."）
      b) L1 中包含 "[详情已省略]" 标记
      c) category=case 且 queryType=技能型（需要完整案例作为 few-shot）
    - 仅加载触发条件匹配的记忆的 L2
    - Token 预算控制：L2 总量 <= 8K tokens
    |
    v
  组装注入上下文
```

#### 3.3.4 ContextPlugin 生命周期

记忆系统通过 ContextPlugin 接口与 Agent 运行时集成，提供 5 个生命周期钩子：

| 钩子 | 触发时机 | 执行方式 | 用途 |
|------|---------|---------|------|
| **bootstrap** | Agent 首次启动/加载 | 一次性 | 渲染 USER.md / MEMORY.md |
| **beforeTurn** | 每轮对话前 | 串行 | 记忆检索 + 注入上下文 |
| **compact** | token 即将超限时 | 串行（逆序） | 记忆注入从 L1 降级为 L0 |
| **afterTurn** | 每轮对话后 | 并行（异步） | 记忆提取 + 进化评分 |
| **shutdown** | Agent 停止/卸载 | 一次性 | 清理资源 |

**完整插件列表**:

| 插件 | 优先级 | 阶段 | 职责 |
|------|--------|------|------|
| SessionRouterPlugin | 10 | beforeTurn | Session Key 路由 + 可见性范围 |
| PermissionPlugin | 20 | beforeTurn | 权限检查 |
| ContextAssemblerPlugin | 30 | beforeTurn/compact | SOUL.md + USER.md + 历史消息组装 + LCM 压缩 |
| MemoryRecallPlugin | 40 | beforeTurn/compact | 三阶段记忆检索 + 注入 |
| RAGPlugin | 50 | beforeTurn/compact | 知识库语义检索 + 文档注入 |
| ToolRegistryPlugin | 60 | beforeTurn | Tool/Skill/MCP 注册 |
| MemoryExtractPlugin | -- | afterTurn | 记忆提取 pipeline（Stage 1-3） |
| EvolutionPlugin | -- | afterTurn | 进化评分 + 能力图谱更新 |
| GapDetectionPlugin | -- | afterTurn | 能力缺口检测 + Skill 推荐 |
| HeartbeatPlugin | -- | afterTurn | 周期性行为检查 |

#### 3.3.5 Hotness 衰减机制

**衰减公式**:

```
hotness = sigmoid(log1p(access_count)) x exp(-0.099 x age_days)
```

- 半衰期 7 天
- 最低值 0.01（不归零）
- 用户可"钉住"重要记忆，使其免于衰减

**衰减与归档生命周期**:
- 每小时执行一次衰减调度，更新所有非钉选、非归档记忆的 activation 值
- activation < 0.1 且 30 天未访问的记忆归档（不删除，仅不参与常规检索）
- 记忆被召回时自动激活：access_count += 1, activation += 0.1

#### 3.3.6 Session Key 路由

**Session Key 格式**:

```
agent:<agentId>:<channel>:<chatType>:<peerId>
```

**路由策略**:

| 场景 | 策略 | 说明 |
|------|------|------|
| 同 Agent 同 Channel 私聊 | 共享 | 同一用户在同一平台的私聊共享上下文 |
| 同 Agent 跨 Channel 私聊 | 可配置（默认共享） | 用户可选择桌面端和飞书的对话是否共享记忆 |
| 同 Agent 群聊 | 隔离 | 每个群聊有独立的会话上下文 |
| 不同 Agent | 完全隔离 | Agent 之间的记忆不互通 |

#### 3.3.7 记忆安全隔离

**核心规则**:
- **USER.md / MEMORY.md 私聊专属**: Agent 的个人记忆仅在私聊中加载和使用，绝不在群聊中暴露
- **群聊仅用公共知识**: 群聊场景中，Agent 仅使用 SOUL.md（人格）+ 该群的历史上下文，不加载用户的个人偏好和私密记忆
- **记忆可见性三级控制**: private（仅所属 Agent 私聊可见）、shared（跨 Channel 私聊共享）、channel_only（指定通道可见）

**反馈循环防护**:
- 注入的记忆上下文使用零宽空格标记包裹
- 记忆提取时自动剥离标记内的内容，防止注入的记忆被重复存储
- relevance >= 0.45 的记忆才注入上下文

#### 3.3.8 知识图谱

**数据模型**:

```sql
CREATE TABLE knowledge_graph (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  subject_id      TEXT NOT NULL,    -- 指向 memory_units.id（entity 类型）
  predicate       TEXT NOT NULL,    -- 关系类型：works_at, knows, uses, prefers...
  object_id       TEXT,             -- 指向另一个 memory_units.id（可选）
  object_literal  TEXT,             -- 或者是字面值
  confidence      REAL NOT NULL DEFAULT 1.0,
  source_memory_id TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
```

**检索集成**: Phase 1 宽检索时，knowledge_graph 参与关系扩展（权重 0.2），如查询提到"EvoClaw"，图查询找到 EvoClaw→uses→TypeScript，把 TypeScript 相关记忆也拉进来。

#### 3.3.9 数据模型

**memory_units 表（记忆主表）**:

```sql
CREATE TABLE memory_units (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  -- L0/L1/L2 三层
  l0_index        TEXT NOT NULL,    -- ~50-100 tokens，一句话摘要
  l1_overview     TEXT NOT NULL,    -- ~500-2K tokens，结构化 Markdown
  l2_content      TEXT NOT NULL,    -- 完整内容
  -- 分类
  category        TEXT NOT NULL,    -- 9 类：profile/preference/entity/event/case/pattern/tool/skill/correction
  merge_type      TEXT NOT NULL,    -- merge / independent
  merge_key       TEXT,             -- merge 型的去重键
  scope           TEXT NOT NULL,    -- user / agent
  -- 可见性
  visibility      TEXT NOT NULL DEFAULT 'private',  -- private/shared/channel_only
  visibility_channels TEXT,
  -- 衰减
  activation      REAL NOT NULL DEFAULT 1.0,
  access_count    INTEGER NOT NULL DEFAULT 0,
  last_access_at  INTEGER,
  pinned          INTEGER NOT NULL DEFAULT 0,
  -- 来源
  source_session_key  TEXT,
  source_message_ids  TEXT,
  confidence          REAL NOT NULL DEFAULT 1.0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  archived_at     INTEGER
);
```

**conversation_log 表（对话日志）**:

```sql
CREATE TABLE conversation_log (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  session_key     TEXT NOT NULL,
  role            TEXT NOT NULL,    -- user/assistant/system/tool
  content         TEXT NOT NULL,
  tool_name       TEXT,
  tool_input      TEXT,
  tool_output     TEXT,
  compaction_status TEXT NOT NULL DEFAULT 'raw',  -- raw/extracted/compacted
  compaction_ref    TEXT,
  token_count     INTEGER,
  created_at      INTEGER NOT NULL
);
```

**双索引**:
- FTS5 全文索引（搜 L0 + L1）
- sqlite-vec 向量索引（L0 embedding，1024 维）

#### 功能拆解（综合）

| 子功能 | 描述 | 优先级 |
|--------|------|--------|
| **F3.1 L0/L1/L2 三层记忆存储** | memory_units 表存储三层分级记忆，9 类分类体系，merge/independent 语义 | **P0** |
| **F3.2 三阶段渐进检索** | Phase 1 L0 宽检索 → Phase 2 L1 排序精筛 → Phase 3 L2 按需深加载，实现 80%+ token 压缩 | **P0** |
| **F3.3 记忆提取 Pipeline** | 三阶段流水线：预处理 → LLM 提取 → 持久化，含反馈循环防护和文本清洗。提取时标注 `generation` 字段（MAML 风格），记录该记忆由哪次对话/哪个模型生成，便于溯源和质量评估 | **P0** |
| **F3.4 Session Key 路由 + 记忆隔离** | 多通道 Session Key 路由策略，USER.md/MEMORY.md 私聊专属加载，群聊不暴露个人记忆 | **P0** |
| **F3.5 ContextPlugin 生命周期** | 5 钩子（bootstrap/beforeTurn/compact/afterTurn/shutdown）驱动记忆系统与 Agent 运行时集成 | **P0** |
| **F3.6 Hotness 衰减 + 归档** | sigmoid x exp 衰减公式，7 天半衰期，30 天归档策略，钉选免衰减 | **P0** |
| **F3.7 知识图谱** | knowledge_graph 表存储实体关系网络，参与检索时的关系扩展 | **P1** |
| **F3.8 行为反馈环** | 用户可对 Agent 的每次回复进行点赞/点踩/文字纠正。负面反馈自动提取为 correction 类记忆 | **P0** |
| **F3.9 能力图谱** | Agent 自动评估自己在各领域的能力值，基于交互和反馈动态更新 | **P1** |
| **F3.10 进化日志** | 用户可查看 Agent 的成长轨迹：新技能、能力值变化、记忆量增长 | **P1** |
| **F3.11 记忆管理** | 用户可查看、编辑、删除、钉住记忆条目。支持按类别和 activation 筛选 | **P0** |
| **F3.12 Growth Vectors / Crystallization** | 成长向量追踪 Agent 能力变化趋势，30+ 天门控结晶化为永久特质写入 SOUL.md | **P2** |

#### 验收标准

- [ ] memory_units 表正确存储 L0/L1/L2 三层内容，9 类分类覆盖完整
- [ ] 三阶段渐进检索在 10 万条记忆规模下延迟 < 200ms
- [ ] 记忆提取 Pipeline 从 20 次对话中提取至少 15 条结构化记忆
- [ ] merge 型记忆通过 merge_key 正确去重更新，L0 保持稳定
- [ ] 反馈循环防护：注入的记忆上下文不会被重复提取存储
- [ ] hotness 衰减使长期未用的记忆 activation 明显下降
- [ ] 同一 Agent 在桌面端私聊和飞书私聊能共享记忆（默认配置下）
- [ ] 同一 Agent 在群聊中不暴露用户的私聊记忆（零泄露）
- [ ] 连续 10 次对话后，Agent 的 memory_units 中应包含至少 5 条用户偏好记录
- [ ] 用户对同一类问题连续给出 3 次负面反馈后，Agent 行为应有明显调整
- [ ] 混合搜索 Top-5 结果与人工标注的相关性匹配率 >= 75%
- [ ] 用户可在 3 步操作内查看、钉住或删除任意记忆条目

---

### 3.4 特性四：Skill/MCP 自发现机制

> **核心理念**: Agent 不应该因为"缺少某个工具"就无法完成任务，它应该像人一样 -- 发现能力不足时主动去学习。

#### 用户故事

> 小王让 Agent 帮他分析一份 Excel 表格。Agent 发现自己没有处理 Excel 的能力，于是说："我目前还不会处理 Excel 文件。我找到了一个评分 4.8/5 的 'excel-parser' Skill，它可以读取和分析 Excel 数据。需要我安装它吗？"小王点击"安装"，Skill 经过签名验证和沙箱试运行后自动安装完成。30 秒后 Agent 开始分析表格 -- 下次遇到 Excel 就不用再装了。

#### 功能拆解

| 子功能 | 描述 | 优先级 |
|--------|------|--------|
| **F4.1 能力缺口检测** | Agent 执行任务失败或质量不佳时，自动分析失败原因，判断是否为"缺少某种能力"导致 | **P0** |
| **F4.2 多源搜索** | 从多个来源搜索匹配的 Skill/MCP：ClawHub API（`GET /api/v1/search` 向量语义搜索）为主搜索源；支持 GitHub URL 直装（兼容 skills.sh 生态）；本地工作区 Skills 扫描。搜索结果包含评分、下载量、安全评级。遵循 AgentSkills 规范（SKILL.md 格式） | **P1** |
| **F4.3 安全安装流** | 搜索 → 展示候选列表（含安全评分） → 用户确认 → 签名验证 → 沙箱试运行 → 正式安装。每一步异常都会中止并告知用户 | **P0** |
| **F4.4 能力编排** | 新安装的 Skill 自动编入 Agent 的能力图谱，Agent 学会在合适的场景调用新能力 | **P1** |
| **F4.5 Skill 推荐引擎** | 基于用户使用模式和 Agent 能力缺口，主动推荐可能有用的 Skill（类似 App Store 推荐），但不强制安装 | **P2** |
| **F4.7 Skill 自进化循环** | 借鉴 MetaClaw MAML 思想：Agent 多次在同一领域失败时，自动触发 Skill 生成流程 — 分析失败模式 → 提取模式化指令 → 生成新 SKILL.md → 沙箱验证 → 自动安装。生成的 Skill 标记为 `auto-generated`，首次使用后需用户确认保留 | **P2** |
| **F4.6 Skill 门控机制** | EvoClaw 自定义扩展（PI/AgentSkills 规范本身不实现门控）。安装和加载 Skill 前自动检查门控条件：requires.bins（PATH 中需要的二进制文件）、requires.env（需要的环境变量）、requires.os（平台限制）。解析 SKILL.md 的 `compatibility` 信息性字段 + EvoClaw 扩展字段。不满足条件的 Skill 静默跳过或提示安装缺失依赖 | **P1** |

#### 验收标准

- [ ] Agent 执行任务失败时，80% 以上的情况能正确识别是否为能力缺口
- [ ] 搜索结果在 3 秒内返回，覆盖 ClawHub API 搜索 + 本地已安装扫描；支持 GitHub URL 直装
- [ ] 安全安装流程完整执行，任何一环失败都能正确阻止安装并给出明确原因
- [ ] 新安装的 Skill 在下次同类任务中能被自动调用
- [ ] 用户全程可取消安装流程，Skill 安装不影响 Agent 已有功能
- [ ] 门控机制正确识别缺失的 bins/env/os 依赖并给出安装引导

---

### 3.5 特性五：本地知识库 (RAG)

> **核心理念**: 你的文件就是 AI 的知识 -- 但这些知识的索引和检索在本地完成，保护隐私。

#### 用户故事

> 小陈把过去三年的论文笔记（200 多份 Markdown 文件）拖入 EvoClaw 的知识库。EvoClaw 在后台建立向量索引。现在他问"之前读过哪些关于 Transformer 注意力机制优化的论文？"，Agent 精准检索出 8 篇相关笔记，并给出摘要对比。

#### 功能拆解

| 子功能 | 描述 | 优先级 |
|--------|------|--------|
| **F5.1 文件摄取引擎** | 支持导入本地文件作为知识源：Markdown、PDF、TXT、DOCX、代码文件（.py / .js / .ts 等）。支持拖拽导入和文件夹批量导入 | **P0** |
| **F5.2 本地向量索引** | 使用嵌入式向量数据库（SQLite-vec）在本地建立文件的向量索引。支持增量更新 -- 文件修改后自动重新索引变更部分 | **P0** |
| **F5.3 语义检索** | Agent 对话时自动检索知识库中的相关内容，作为上下文注入 LLM 提示。支持用户手动指定"在 XX 文件夹中搜索" | **P0** |
| **F5.4 知识库管理** | 可视化管理界面：查看已索引文件列表、索引状态、存储占用。支持删除、重新索引、暂停索引 | **P1** |
| **F5.5 多知识库隔离** | 支持创建多个独立知识库（如"工作文档"、"个人笔记"、"代码库"），不同 Agent 可绑定不同知识库 | **P2** |

#### 验收标准

- [ ] 支持至少 5 种文件格式的摄取，单次导入 100 个文件时不超过 5 分钟（M1 Mac 基准）
- [ ] 向量索引在本地完成，嵌入计算可选本地或云端
- [ ] 语义检索的 Top-5 召回结果与人工标注的相关性匹配率 >= 70%
- [ ] 文件修改后 30 秒内触发增量重新索引
- [ ] 知识库管理界面可在 3 步操作内完成文件的增删管理

---

### 3.6 特性六：多 Agent 协作网络

> **核心理念**: 一个人再强也不如一个团队 -- Agent 之间的协作让 1+1 > 2。

#### 用户故事

> 老李创建了三个 Agent："研究员"负责搜集技术资料、"架构师"负责系统设计、"码农"负责代码实现。当老李说"帮我调研并实现一个 Redis 缓存方案"时，"研究员"自动搜索最佳实践，将结果推送给"架构师"，"架构师"出设计方案后传递给"码农"编写代码。三个 Agent 协作完成，老李只需在关键节点审核确认。

#### 功能拆解

| 子功能 | 描述 | 优先级 |
|--------|------|--------|
| **F6.1 子 Agent 派生** | 通过 sessions_spawn 工具在对话中派生子 Agent，指定任务和约束。支持 maxSpawnDepth 深度限制（默认 1，最多 2 层嵌套），子 Agent 在独立会话中运行，完成后回传结果给父 Agent | **P1** |
| **F6.2 Agent 间通信** | 独立 Agent 之间的直接通信机制，**默认关闭**，需通过 allowlist 显式开启。支持结构化消息传递（文本、文件引用、数据对象） | **P1** |
| **F6.3 Binding 路由** | 基于 Binding 配置的消息路由，最具体匹配优先（most-specific-wins）：peerId 精确匹配 > accountId + channel > channel > 默认 Agent | **P0** |
| **F6.4 Lane 队列并发** | 三种 Lane 队列管理并发：main（用户消息，并发 4）、subagent（子 Agent，并发 8）、cron（定时任务，并发 2）。同一 Session Key 下的请求串行执行，防止竞态 | **P0** |
| **F6.5 协作工作流定义** | 用户可通过自然语言描述协作流程，系统自动生成 Agent 协作 DAG。如："研究员找资料 → 写手写初稿 → 编辑润色" | **P2** |
| **F6.6 人工审核节点** | 用户可在协作流程中插入"人工审核"节点，关键产出需用户确认后才传递给下一个 Agent | **P1** |
| **F6.7 协作状态可视化** | 展示多 Agent 协作的实时状态：哪个 Agent 在工作、任务进度、消息流向图 | **P2** |

#### 验收标准

- [ ] 子 Agent 派生延迟 < 2 秒，结果正确回传给父 Agent
- [ ] Agent 间通信默认关闭，开启后消息传递延迟 < 1 秒
- [ ] Binding 路由正确执行最具体匹配优先策略
- [ ] Lane 队列确保同一 Session Key 下请求串行执行
- [ ] 用户通过自然语言描述可成功创建至少 3 个节点的协作流程
- [ ] 协作流程中单个 Agent 失败不影响其他 Agent 运行，支持失败重试
- [ ] 人工审核节点可正确暂停流程，等待用户确认后继续

---

### 3.7 特性七：Channel 消息平台接入

> **核心理念**: AI 助手应该在你常用的地方等你，而不是让你来找它。

#### 用户故事

> 小王在飞书群里 @EvoClaw："帮我总结一下今天的会议纪要。"EvoClaw 直接在飞书中回复了结构化的会议摘要。下午他切到企业微信，给 EvoClaw 发了一份客户需求文档，EvoClaw 同样精准响应 -- 因为它记得小王的偏好和工作上下文，无论在哪个平台都是同一个"懂你的助手"。但在飞书群里回答时，EvoClaw 不会暴露小王在私聊中透露的个人习惯 -- 记忆安全隔离确保了隐私边界。

#### 功能拆解

| 子功能 | 描述 | 优先级 |
|--------|------|--------|
| **F7.1 飞书 Channel** | 接入飞书机器人 API，支持私聊和群聊场景。支持文本、文件、图片消息的收发 | **P0** |
| **F7.2 企业微信 Channel** | 接入企业微信应用 API，支持私聊和群聊。适配企微的消息格式和交互规范 | **P0** |
| **F7.3 QQ Channel** | 接入 QQ 开放平台 API，支持私聊和 QQ 群场景 | **P1** |
| **F7.4 Channel 抽象层** | 统一的 Channel Adapter 接口，新平台只需实现适配器即可接入。消息标准化、Binding 路由、记忆隔离策略统一管理 | **P0** |
| **F7.5 Channel 管理界面** | 在桌面应用中集中管理所有 Channel 连接状态、消息统计、平台配置 | **P1** |

**Binding 路由**: 消息到达后通过 Binding 配置路由到对应 Agent，然后生成 Session Key（格式：`agent:<agentId>:<channel>:<chatType>:<peerId>`）用于记忆隔离。

#### 验收标准

- [ ] 飞书/企微 Channel 在配置 Bot Token 后 1 分钟内完成连接
- [ ] 同一个 Agent 在桌面应用和 IM 平台的私聊中回答风格一致，记忆共享
- [ ] 同一个 Agent 在群聊中不暴露私聊记忆
- [ ] Channel 消息处理延迟 < 3 秒（不含 LLM 推理时间）
- [ ] 单个 Channel 断开不影响其他 Channel 和桌面应用的正常使用
- [ ] Channel 适配器可独立开发和部署

---

### 3.8 特性八：可视化进化仪表盘

> **核心理念**: 让用户"看见" Agent 在成长 -- 可见的进步创造持续使用的动力。

#### 用户故事

> 小陈每周日打开 EvoClaw 的进化仪表盘。屏幕上是他的论文助手的"成长报告"：能力雷达图显示"论文摘要"能力从上周的 72 分提升到了 81 分；记忆量增长曲线显示本周新增了 45 条知识记忆，其中 12 条已从热记忆冷却为温记忆；知识图谱可视化展示了 Agent 已掌握的 87 个实体和 156 条关系。小陈觉得很有成就感 -- 就像养了一个会长大的电子宠物。

#### 功能拆解

| 子功能 | 描述 | 优先级 |
|--------|------|--------|
| **F8.1 能力雷达图** | 以雷达图形式展示 Agent 在各领域的能力值，支持查看历史变化趋势 | **P1** |
| **F8.2 记忆量增长曲线** | 以折线图展示 Agent 记忆条目随时间的增长趋势，区分高/中/低 activation 分布 | **P2** |
| **F8.3 Skill 使用热力图** | 以热力图形式展示各 Skill 的使用频率和时间分布 | **P2** |
| **F8.4 周报/月报** | 自动生成 Agent 成长周报/月报：新技能、能力变化、关键互动统计、记忆衰减/结晶情况。支持推送通知 | **P2** |
| **F8.5 对比视图** | 支持对比多个 Agent 的能力图谱，或对比同一个 Agent 不同时期的状态 | **P2** |
| **F8.6 知识图谱可视化** | 以网络图形式展示 knowledge_graph 表中的实体-关系网络，支持交互式探索 | **P2** |
| **F8.7 响应质量评估** | 借鉴 MetaClaw 评估机制：每次对话后对 Agent 响应质量进行轻量评估（用户反馈 + 自动指标：工具调用成功率、对话长度、重试次数等），评估结果反馈到 capability_graph 驱动进化方向 | **P1** |

#### 验收标准

- [ ] 仪表盘页面加载时间 < 2 秒
- [ ] 能力雷达图至少展示 5 个维度，数据来源于 Agent 实际交互
- [ ] 数据统计准确，与 Agent 实际记忆和交互记录一致
- [ ] 周报在每周一自动生成（可配置日期）
- [ ] 所有图表支持时间范围筛选（近一周 / 一月 / 三月 / 全部）

---

## 4. 非功能需求

### 4.1 性能需求

| 指标 | 要求 | 测试基准 |
|------|------|----------|
| **应用启动时间** | 冷启动 < 3 秒，热启动 < 1 秒 | M1 MacBook Air 8GB |
| **对话响应延迟** | 首 Token 延迟 < 2 秒（云端模型） | 网络延迟 < 100ms |
| **三阶段记忆检索** | Phase 1-3 总延迟 < 200ms | 10 万条 memory_units 规模 |
| **混合搜索延迟** | FTS5 + sqlite-vec 融合检索 < 200ms | 10 万条记忆规模 |
| **知识库索引速度** | 100 个文档（平均 5KB）< 5 分钟 | M1 MacBook Air 8GB |
| **内存占用** | 空闲状态 < 200MB，活跃对话 < 500MB | -- |
| **磁盘占用** | 基础安装 < 100MB | 不含向量索引和记忆数据 |
| **Channel 消息延迟** | 消息接收到开始处理 < 1 秒 | -- |

### 4.2 安全需求

| 维度 | 要求 |
|------|------|
| **数据加密** | 静态数据 AES-256 加密；与云端 LLM 通信使用 TLS 1.3 |
| **凭证管理** | 全部通过系统 Keychain 存储，禁止明文落盘 |
| **沙箱隔离** | Agent 执行环境沙箱化，文件系统访问需显式授权 |
| **Skill 安全** | 强制签名验证 + 沙箱试运行 + 运行时行为审计 |
| **记忆隔离** | USER.md/MEMORY.md 私聊专属，群聊零泄露；跨 Channel 记忆可见性可配置 |
| **隐私合规** | 默认无遥测数据收集；用户可选择性开启匿名使用统计 |
| **审计日志** | 记录所有敏感操作（权限变更、Skill 安装、凭证访问、记忆跨通道共享），日志本地加密存储 |

### 4.3 可用性需求

| 维度 | 要求 |
|------|------|
| **上手时间** | 新用户首次使用到完成第一次有效对话 < 2 分钟 |
| **零配置原则** | 核心功能（对话、安全、记忆、上下文压缩）开箱即用，无需任何手动配置 |
| **错误处理** | 所有错误提供用户可理解的中文提示和明确的修复建议 |
| **可访问性** | 支持系统级深色/浅色模式；支持键盘导航；字体大小可调 |
| **多语言** | v1.0 支持中文界面（主要），英文界面（次要） |

### 4.4 兼容性需求

| 平台 | 最低要求 | 目标版本 |
|------|----------|----------|
| **macOS** | macOS 13 (Ventura)+ / Apple Silicon 或 Intel | Tauri 原生应用 |
| **Windows** | Windows 10 21H2+ / x64 | Tauri 原生应用 |
| **Linux** | Ubuntu 22.04+ / Fedora 38+ | AppImage / Flatpak |

---

## 5. 技术约束与假设

### 5.1 技术约束

| 约束 | 说明 |
|------|------|
| **数据安全** | 所有用户数据（对话、记忆、知识库、凭证）本地加密存储，除 LLM API 调用和 Channel 消息外不产生网络数据传输 |
| **跨平台** | 需同时支持 macOS、Windows、Linux 三大桌面平台 |
| **安全底线** | 安全机制不可被用户关闭（可调整授权粒度但不可完全绕过） |
| **模型无关** | 不绑定特定 LLM Provider，支持通过标准接口接入任意兼容模型 |
| **一体化体验** | 桌面应用内嵌后端服务，用户双击即用，无需命令行操作 |
| **单引擎策略** | better-sqlite3 + sqlite-vec + FTS5 覆盖所有存储需求（结构化数据、向量索引、全文检索），不引入额外数据库引擎 |
| **LLM 统一调用** | 所有需要 LLM 的内部操作（记忆提取、上下文压缩、知识图谱构建）统一走 PI 框架的模型调用，不引入本地模型 |
| **零配置记忆** | 记忆系统（L0/L1/L2 分层、衰减、Daily Logs）开箱即用，用户无需配置参数 |

### 5.2 技术假设

| 假设 | 依据 |
|------|------|
| **SQLite-vec 成熟度** | 假设 SQLite-vec 作为嵌入式向量数据库在万级文档规模下性能和稳定性满足需求 |
| **FTS5 中文支持** | 假设 FTS5 配合中文分词 tokenizer 能满足中文全文检索需求 |
| **MCP 协议稳定性** | 假设 Model Context Protocol 在未来 12 个月内保持向后兼容 |
| **系统 Keychain 可用** | 假设目标平台的系统级安全存储 API 均可正常访问 |
| **Skill 生态可用** | ClawHub (clawhub.ai) 提供公开 HTTP API（`/api/v1/search`、`/api/v1/download`），可直接对接；skills.sh 无公开 API，通过 GitHub URL 直装兼容其 Skill 生态 |
| **国内 IM API 稳定** | 假设飞书、企微、QQ 开放平台 API 在未来 12 个月内保持稳定 |
| **LLM 提取质量** | 假设通过 PI 框架调用的云端 LLM 生成的记忆提取和上下文压缩质量满足需求 |

### 5.3 技术选型决策

| 层次 | 选型 | 理由 |
|------|------|------|
| **桌面框架** | Tauri 2.0 (Rust + WebView) | 体积小（~15MB vs Electron ~150MB），Rust 安全层 |
| **前端** | React 19 + TypeScript + Tailwind CSS 4 | 生态最大，Tauri 完美支持 |
| **后端/核心** | TypeScript (Node.js >= 22) 作为 Tauri Sidecar | 与前端共享类型，PI 框架原生 TypeScript |
| **安全关键路径** | Rust (Tauri Plugin) | 加密、沙箱、签名验证用 Rust 保证内存安全 |
| **模型调用** | PI 框架 (pi-ai + pi-agent-core + pi-coding-agent) | PI 是 OpenClaw 底层引擎，MIT 许可，提供完整 Agent 循环/工具系统/会话持久化/Skills 加载。pi-ai 统一多 Provider 接口，流式响应，Tool Calling 内置 |
| **Agent 框架** | PI 框架嵌入式运行 + ContextPlugin 扩展 | PI 提供完整的 ReAct 循环、工具执行、会话持久化、auto-compaction；EvoClaw 通过 ContextPlugin 扩展进化引擎和记忆系统，实现核心差异化 |
| **MCP 集成** | @modelcontextprotocol/sdk | 官方 TypeScript SDK |
| **存储引擎** | better-sqlite3 + sqlite-vec + FTS5 | 单引擎覆盖结构化/向量/全文三种检索，零外部依赖 |
| **加密** | Rust 层 AES-256-GCM (ring crate) | 安全关键路径在 Rust 层实现，macOS Keychain 通过 security-framework 集成 |
| **沙箱** | Docker（可选，首次触发时引导安装） | 三级安全模式：无沙箱（默认）/ 选择性沙箱 / 全沙箱。macOS 推荐 Colima（轻量级，无需 Docker Desktop 许可证） |
| **包管理** | pnpm monorepo + Turborepo | 高效依赖管理，增量构建 |

### 5.4 支持的模型 Provider

pi-ai 原生支持的 Provider:

| Provider | 模型示例 | 说明 |
|----------|----------|------|
| **OpenAI** | GPT-4o, GPT-4o-mini | 国际主流 |
| **Anthropic** | Claude Sonnet/Opus | 国际主流 |
| **DeepSeek** | DeepSeek-V3, DeepSeek-R1 | pi-ai 自动检测，OpenAI 兼容模式 |
| **MiniMax** | abab6.5s | pi-ai 原生 Provider |
| **Kimi/Moonshot** | Kimi | pi-ai Anthropic 兼容模式 |

通过 registerProvider() 注册的国内 Provider（OpenAI 兼容端点）:

| Provider | 模型示例 | 说明 |
|----------|----------|------|
| **通义千问 (Qwen)** | Qwen-Max, Qwen-Plus | 阿里云 DashScope API |
| **智谱 (GLM)** | GLM-4-Plus, GLM-4-Flash | 智谱开放平台 |
| **字节 (豆包)** | Doubao-pro-32k | 火山引擎 API |

---

## 6. MVP 范围定义

### 6.1 MVP 核心原则

> "如果你的第一版不让你感到尴尬，说明你发布得太晚了。" -- Eric Ries

MVP 版本（v0.1）聚焦于一个核心价值验证：**一个开箱即用的、安全的、具备多层记忆的 AI 助手**。

### 6.2 MVP 包含（P0 功能）

| 特性 | MVP 范围 |
|------|----------|
| **内置安全机制** | 零配置加密存储 + 权限弹窗授权 + 凭证金库（Keychain 集成） |
| **语义化 Agent 创建** | 对话式创建引导 + 8 文件工作区自动生成（无模板市场） |
| **Agent 自我进化（记忆基座）** | memory_units 表 L0/L1/L2 三层存储 + 记忆提取 Pipeline + 三阶段渐进检索 + hotness 衰减 + ContextPlugin 生命周期 + Session Key 路由 + 记忆安全隔离 + 行为反馈（点赞/点踩） + 记忆管理（查看/删除/钉住） |
| **Skill 自发现** | 能力缺口检测 + 安全安装流（主搜索源：ClawHub API；补充：GitHub URL 直装） |
| **本地知识库** | 文件摄取（Markdown / TXT / PDF）+ 本地向量索引 + 语义检索 |
| **云端模型接入** | 支持全部 Provider（OpenAI / Anthropic / DeepSeek / MiniMax / Kimi / Qwen / GLM / 豆包） |
| **Channel 接入** | 飞书 + 企微 Channel（含 Channel 抽象层 + Binding 路由 + Session Key 路由） |

### 6.3 MVP 不包含（明确排除）

| 排除项 | 原因 |
|--------|------|
| **知识图谱 (knowledge_graph)** | MVP 先验证基础记忆沉淀，知识图谱 v0.5 加入 |
| **Growth Vectors / Crystallization** | 远期特性，v2.0 加入 |
| **多 Agent 协作网络** | 依赖单 Agent 体验完善后再扩展 |
| **可视化进化仪表盘** | 需积累足够交互数据后才有意义，v0.5 再加入 |
| **模板市场** | 先验证对话式创建流程，市场可后续补充 |
| **QQ Channel** | 先聚焦飞书/企微，QQ v0.5 加入 |
| **Windows / Linux 版本** | 先聚焦 macOS 验证核心体验 |
| **多知识库隔离** | 单知识库足以验证 RAG 价值 |
| **Agent 导入/导出** | 非核心验证项 |
| **Skill 推荐引擎** | 先验证自发现机制，推荐属于增强 |
| **Docker 沙箱** | MVP 默认无沙箱模式，Docker 支持 v0.5 加入 |

### 6.4 MVP 成功标准

MVP 成功 = 用户在以下场景中给出正面反馈：

1. **安全感**: "我不需要担心数据安全" -- 零配置即获得安全保障
2. **低门槛**: "5 分钟内我就创建了自己的 AI 助手" -- 纯对话式创建
3. **会记忆**: "它记住了我的偏好，越来越好用" -- 连续使用一周后体验明显改善
4. **不忘事**: "长对话也不会忘记之前说过的话" -- PI auto-compaction + L0/L1/L2 渐进检索验证
5. **能成长**: "它自己找到了缺少的工具并装上了" -- Skill 自发现成功率 > 60%
6. **随处可用**: "在飞书里直接用，不用切应用" -- Channel 接入顺畅
7. **隐私安全**: "群聊里不会暴露我的私人偏好" -- 记忆安全隔离验证

---

## 7. 迭代路线图

### 7.1 总览

```
v0.1 MVP         v0.5 进化        v1.0 成熟         v2.0 生态
(2026 Q2)        (2026 Q3)        (2026 Q4)         (2027 Q1-Q2)
   |                |                |                  |
   v                v                v                  v
安全+创建+记忆   知识图谱+衰减   多Agent+跨平台     结晶化+社区
PI集成+插件      混合搜索+QQ     事实提取+完整      成长向量+生态
飞书+企微        仪表盘+能力     产品完整           规模增长
```

### 7.2 v0.1 MVP -- "安全、记忆、可用"（2026 Q2，约 10 周）

**目标**: 验证核心价值假设，获取首批 100 名种子用户反馈。重点验证 L0/L1/L2 记忆系统和记忆安全隔离。

| 周次 | 里程碑 |
|------|--------|
| W1-W2 | 项目脚手架（Tauri + Node Sidecar + pnpm monorepo）、安全基座（加密存储 + Keychain 集成 + 沙箱原型）、PI 框架集成（pi-ai + pi-agent-core + pi-coding-agent 嵌入式运行） |
| W3-W4 | Agent 核心引擎（8 文件工作区 + 对话式创建流程 + ContextPlugin 生命周期搭建） |
| W5-W6 | memory_units 表 + L0/L1/L2 三层存储 + 记忆提取 Pipeline + 三阶段渐进检索 + hotness 衰减 + Session Key 路由 + 记忆安全隔离 |
| W7-W8 | 记忆沉淀 + Daily Logs + 反馈环 + 知识库 RAG（SQLite-vec 集成） + Provider 接入（含国内 registerProvider 注册） |
| W9 | Skill 自发现 + 安全安装流（ClawHub API + GitHub URL 直装） + 飞书/企微 Channel（含 Binding 路由 + Session Key 路由） |
| W10 | macOS 应用打包 + 内测发布 |

**交付物**:
- macOS Tauri 应用（一体化，双击即用）
- PI 框架嵌入式运行 + ContextPlugin 扩展
- 支持全部 Provider（OpenAI / Anthropic / DeepSeek / MiniMax / Kimi / Qwen / GLM / 豆包）
- 完整的安全基座（加密 + 权限 + 凭证金库）
- 对话式 Agent 创建 + 8 文件工作区生成
- L0/L1/L2 三层记忆存储 + 三阶段渐进检索
- 记忆提取 Pipeline（预处理 → LLM 提取 → 持久化）
- hotness 衰减 + 归档生命周期
- Session Key 路由 + 记忆安全隔离（群聊零泄露）
- 本地知识库（Markdown / TXT / PDF）
- Skill 自发现与安全安装（ClawHub API + GitHub URL 直装）
- 飞书 + 企微 Channel 接入

### 7.3 v0.5 -- "图谱、可视化、更聪明"（2026 Q3，约 8 周）

**目标**: 补全高级记忆能力，让 Agent 真正"越用越聪明"。

**新增功能**:
- 知识图谱 (knowledge_graph 表)：实体-关系自动提取 + 检索关系扩展
- 可视化进化仪表盘（能力雷达图 + 记忆增长曲线 + 记忆 activation 分布）
- 进化日志 + 周报
- 能力图谱
- QQ Channel 接入
- 模板市场（首批 5-10 个高质量模板 + 社区 SOUL.md 模板导入）
- Skill 门控机制（requires.bins/env/os）
- Skill 签名验证 + 沙箱试运行
- Docker 沙箱支持（可选）

### 7.4 v1.0 -- "完整产品"（2026 Q4，约 10 周）

**目标**: 产品功能完整，覆盖主流桌面平台，准备公开发布。

**新增功能**:
- 子 Agent 派生 + Agent 间通信
- 协作工作流定义 + 人工审核节点
- Windows 版本（Tauri 跨平台构建）
- Linux 版本（AppImage）
- 多知识库隔离
- Agent 导入/导出
- 协作状态可视化
- 完善的安全仪表盘
- Skill 使用热力图 + 月报
- 知识图谱可视化

### 7.5 v2.0 -- "生态与社区"（2027 Q1-Q2）

**目标**: 建立社区生态，实现用户增长飞轮。

**规划方向**:
- Growth Vectors / Crystallization：成长向量 30+ 天门控结晶化为永久特质
- EvoClaw Hub：Agent 模板和 Skill 的社区分享平台
- Agent 人格交易市场
- 移动端伴侣应用（iOS / Android）
- 企业版功能（团队 Agent 共享、管理员权限控制、审计合规）
- Plugin SDK 开放
- 更多 Channel（钉钉、微信等）
- 多设备同步（端到端加密）

---

## 8. 竞品对比矩阵

### 8.1 核心能力对比

| 能力维度 | EvoClaw | OpenClaw | DeerFlow | ChatGPT Desktop | 国内竞品（AutoClaw/WorkBuddy/小艺Claw/miClaw） |
|----------|---------|----------|----------|-----------------|-----------------------------------------------|
| **定位** | 自进化 AI 伴侣（中国市场） | 个人 AI 助手平台 | Agent 运行时框架 | 云端 AI 对话工具 | 各自绑定平台生态的 AI 助手 |
| **目标用户** | 知识工作者 / 开发者 / 效率极客 | 技术爱好者 / 开发者 | 开发者 / 研究者 | 大众用户 | 各平台既有用户 |
| **上手门槛** | 零配置，2 分钟上手 | 15+ 小时配置 | 需 Docker / Python 环境 | 零配置 | 低（绑定平台账号） |
| **安全性** | 零配置安全默认（加密 + 沙箱 + 权限控制） | 严重安全隐患 | 相对稳健（三级沙箱） | 云端托管 | 云端为主，安全依赖平台 |
| **数据隐私** | 本地加密存储 | 本地存储但有漏洞 | 本地 / Docker / K8s | 全云端 | 全云端 |
| **记忆架构** | L0/L1/L2 三层分级存储 + 三阶段渐进检索 + knowledge_graph + hotness 衰减 | 多层记忆架构（LCM + Metabolism + Growth Vectors + 知识图谱） | 有长期记忆但无系统化架构 | 记忆功能不透明 | 基础记忆，无系统化架构 |
| **Agent 框架** | PI 框架（OpenClaw 底层引擎）嵌入式运行 + ContextPlugin 扩展 | PI 框架原生 | 自研 Agent 运行时 | 不开放 | 各自自研 |
| **自我进化** | 核心特性（记忆沉淀 + 反馈环 + 能力图谱 + 衰减 + 结晶化） | 有（Metabolism + Contemplation + Growth Vectors），但面向开发者 | 有长期记忆但无进化机制 | 记忆功能不透明 | 无系统化进化机制 |
| **上下文管理** | PI auto-compaction + L0/L1/L2 渐进检索 | LCM 无损压缩（原创） | 基础上下文窗口 | LLM 原生上下文 | 基础上下文窗口 |
| **记忆安全** | 私聊/群聊隔离 + 跨 Channel 可配置策略 | 有 Session Key 路由（原创） | 无 | 无 | 无 |
| **生态兼容** | 兼容 OpenClaw Skills（ClawHub 13,700+）/ SOUL.md 模板（103+） | 原生生态 | 自有生态 | 不开放 | 各自封闭生态 |
| **Agent 创建** | 对话式零门槛创建 | 需编写配置文件 | 需编写 Skill Markdown | 仅 GPTs 有限定制 | 模板选择为主 |
| **Skill 自发现** | 能力缺口检测 + 自动搜索安装（ClawHub API + GitHub URL 直装） | 手动搜索安装 | 手动配置 | 不支持 | 有限 |
| **本地知识库** | 内置 RAG（SQLite-vec + FTS5 混合搜索） | 需配置 Context Engine | 有文件系统支持 | 仅上传文件 | 云端知识库 |
| **国内 IM 接入** | 飞书 / 企微 / QQ | 无 | 飞书（有限） | 无 | 各自平台 |
| **国产模型支持** | 8 家 Provider | 有限 | DeepSeek/Doubao/Kimi | 仅 GPT | 绑定自家模型 |
| **多 Agent 协作** | 子 Agent 派生 + Agent 间通信 + Lane 并发 | 单 Agent | Sub-Agent 编排 | 不支持 | 有限 |
| **进化可视化** | 能力雷达图 + 记忆曲线 + 知识图谱可视化 + 热力图 | 无 | 无 | 无 | 无 |
| **开源** | 开源 (MIT) | 开源 (MIT) | 开源 (MIT) | 闭源 | 部分开源 |

### 8.2 差异化优势总结

**EvoClaw vs OpenClaw**:
- 安全性从"高风险"提升到"零配置安全默认"
- 上手门槛从 15+ 小时降低到 2 分钟
- 基于 PI 框架（OpenClaw 底层引擎）构建，兼容 OpenClaw Skills 和 SOUL.md 模板生态
- 记忆系统借鉴 OpenViking/claude-mem/MemOS 研究成果，L0/L1/L2 三层分级 + 渐进检索 + hotness 衰减
- 深度适配中国市场（国产模型 + 国内 IM）
- 一体化桌面应用（无需命令行启动服务）
- 记忆安全隔离更严格（群聊零泄露策略）

**EvoClaw vs DeerFlow**:
- 从"开发者工具"转变为"终端用户产品"
- 提供原生桌面应用而非 Web 部署
- 新增完整多层记忆系统（DeerFlow 无此能力）
- 新增语义化 Agent 创建
- 新增 Skill 自发现机制
- 基于 PI 框架，通过 ContextPlugin 扩展进化引擎

**EvoClaw vs ChatGPT Desktop**:
- 数据本地加密存储，不上传到云端
- Agent 可定制化和持续进化，记忆系统完全透明可控
- 支持 8 家 Provider（含国产）
- 国内 IM 平台无缝接入
- 开源可审计

**EvoClaw vs 国内竞品（AutoClaw/WorkBuddy/小艺Claw/miClaw）**:
- 不绑定特定平台生态，跨平台可用
- 数据本地存储而非云端，隐私保护更强
- 兼容 OpenClaw 生态（13,700+ Skills，103+ 模板），生态远超国内竞品
- 完整的多层记忆和自我进化机制，非简单的 LLM 包装
- 开源透明，用户可审计和定制

---

## 9. 风险与缓解策略

### 9.1 Pre-mortem 分析

> 假设现在是 2026 年 12 月，EvoClaw v1.0 发布后完全失败了。最可能的原因是什么？

### 9.2 风险矩阵

| # | 风险 | 类型 | 可能性 | 严重性 | 缓解策略 |
|---|------|------|--------|--------|----------|
| R1 | **记忆进化效果不明显** -- 用户使用一周后感觉 Agent "没变聪明" | 产品 | 中 | 高 | L0/L1/L2 三层分级确保记忆精准召回；hotness 衰减突出高频记忆；知识图谱结构化关键事实；进化日志量化展示成长轨迹；Daily Logs 提供完整情景回溯 |
| R2 | **L0/L1/L2 记忆提取质量风险** -- LLM 生成的记忆分层不准确，L0 摘要丢失关键语义，或分类错误导致检索偏差 | 技术 | 中 | 高 | 记忆安全四步裁决（来源验证 → 归属检查 → 置信度评估 → 隐私边界）把控提取质量；merge 型记忆 L0 不变保持向量索引稳定；Pre-compaction Memory Flush 在上下文压缩前保存关键信息；支持用户手动编辑/纠正记忆 |
| R3 | **记忆衰减参数调优风险** -- hotness 衰减过快导致有用记忆被降权，过慢则记忆噪声累积 | 技术 | 中 | 中 | 提供默认参数（半衰期 7 天）但支持用户调整；"钉住"机制让用户保护重要记忆；A/B 测试不同衰减曲线；衰减前检查记忆 activation 和 access_count |
| R4 | **安全机制影响体验** -- 频繁的权限弹窗让用户烦躁 | 产品 | 中 | 高 | "始终允许"减少重复弹窗；权限按场景聚合；参考 macOS 权限弹窗最佳实践 |
| R5 | **Skill 生态可用性** -- 自发现机制搜到的 Skill 不适配或质量差 | 生态 | 低 | 中 | ClawHub 提供公开 HTTP API（向量语义搜索 + ZIP 下载），社区已验证 Skills；skills.sh 无公开 API 但其 Skill 托管在 GitHub 可直装；门控机制（requires.bins/env/os）自动过滤不兼容 Skill；安全安装流保障质量 |
| R6 | **跨平台开发资源不足** -- 同时维护三个平台拖慢迭代速度 | 资源 | 中 | 中 | MVP 只做 macOS；Tauri 最大化代码复用 |
| R7 | **隐私承诺难以验证** -- 用户质疑数据安全 | 信任 | 中 | 中 | 全程开源；内置网络活动监控面板；第三方安全审计 |
| R8 | **与 OpenClaw 的竞争** -- 社区优势和先发优势碾压 | 市场 | 中 | 中 | 聚焦"安全 + 零门槛 + 中国市场"差异点；利用安全丑闻窗口；兼容 OpenClaw 生态（Skills + 模板）降低用户迁移成本 |
| R9 | **Channel 平台 API 变更** -- 飞书/企微/QQ API 不稳定 | 技术 | 中 | 中 | Channel 抽象层解耦具体平台；及时跟进 API 变更；保持桌面端作为核心体验 |
| R10 | **知识库 RAG 检索质量差** -- 检索结果不相关 | 技术 | 中 | 中 | FTS5 + sqlite-vec 混合检索提升召回率；hotness 激活度加权优化排序；检索范围限定 |
| R11 | **用户不理解"进化"概念** -- 不知道怎么触发进化 | 产品 | 低 | 高 | Onboarding 引导；进化仪表盘持续提醒；"进化里程碑"成就系统 |
| R12 | **多 Agent 协作复杂度爆炸** | 技术 | 低 | 中 | maxSpawnDepth 限制派生深度；Lane 队列控制并发；超时机制 |
| R13 | **PI 框架依赖风险** -- PI 框架 API 变更、版本不兼容或项目停止维护 | 技术 | 低 | 高 | PI 是 MIT 许可，可 fork 维护；EvoClaw 通过 ContextPlugin 扩展层与 PI 解耦，核心记忆/安全/进化逻辑不依赖 PI 内部实现；锁定 PI 版本，谨慎升级 |

---

## 10. 成功指标 (KPI)

### 10.1 北极星指标

**周活跃用户的 Agent 进化分数中位数**

> 定义: 活跃用户的 Agent 在过去 7 天内的记忆增量 + 知识图谱增长 + 能力值变化 + 正面反馈率的综合评分。

### 10.2 分阶段 KPI

#### v0.1 MVP 阶段 KPI

| 指标 | 目标 | 衡量方式 |
|------|------|----------|
| 种子用户数 | >= 100 | 内测注册数 |
| 首次对话完成率 | >= 80% | 下载后 24 小时内完成首次有效对话的比例 |
| 7 日留存率 | >= 40% | 首次使用后第 7 天仍活跃 |
| Agent 创建成功率 | >= 90% | 开始创建流程的用户中成功创建的比例 |
| 记忆检索准确率 | >= 80% | 三阶段渐进检索 Top-5 结果与人工标注匹配率 |
| 记忆隔离零泄露 | 0 起 | 群聊中未出现私聊记忆泄露 |
| Channel 接入率 | >= 30% | 至少连接一个 IM Channel 的用户比例 |
| 安全零事故 | 0 起 | 无明文凭证泄露、无未授权数据访问 |
| NPS | >= 30 | 用户调研 |

#### v0.5 阶段 KPI

| 指标 | 目标 | 衡量方式 |
|------|------|----------|
| 累计用户数 | >= 1,000 | 下载安装数 |
| 30 日留存率 | >= 25% | 首次使用后第 30 天仍活跃 |
| 进化感知率 | >= 60% | 用户调研中回答"Agent 有变聪明"的比例 |
| 知识图谱平均实体数 | >= 50 | 活跃用户 Agent 的 knowledge_graph 表平均实体数 |
| 平均 Skill 安装数 | >= 2 | 每个活跃用户安装的 Skill 数量 |
| 知识库使用率 | >= 30% | 创建了知识库的活跃用户比例 |
| Channel 活跃率 | >= 40% | 通过 Channel 产生对话的用户比例 |

#### v1.0 阶段 KPI

| 指标 | 目标 | 衡量方式 |
|------|------|----------|
| 累计用户数 | >= 10,000 | 下载安装数 |
| DAU/MAU | >= 30% | 日活 / 月活比 |
| GitHub Stars | >= 5,000 | GitHub 仓库 |
| 多 Agent 协作使用率 | >= 10% | 使用协作功能的活跃用户比例 |
| Skill 生态 | >= 50 个活跃使用的 Skill | ClawHub + skills.sh 中实际被 EvoClaw 用户安装的 Skill |
| 社区贡献者 | >= 30 | GitHub 贡献者数 |
| 安全审计通过 | 通过 | 第三方安全审计报告 |

### 10.3 反指标（需要警惕的指标）

| 反指标 | 警戒线 | 说明 |
|--------|--------|------|
| 权限弹窗取消率 | > 40% | 弹窗过于频繁或不合理 |
| Agent 创建放弃率 | > 30% | 对话式创建流程不够流畅 |
| 记忆删除频率 | 日均 > 3 次 / 用户 | 记忆沉淀质量差 |
| 记忆提取误判率 | > 15% | L0/L1/L2 分层或分类不准确 |
| 冷记忆误降权率 | > 15% | hotness 衰减参数需调优 |
| Skill 安装失败率 | > 20% | 自发现机制推荐不合适 |
| Channel 断连率 | > 10% | Channel 稳定性问题 |

---

## 附录 A：术语表

| 术语 | 定义 |
|------|------|
| **Agent** | 具有特定人格、记忆和能力的 AI 助手实例 |
| **SOUL.md** | Agent 的行为哲学定义文件，定义 Agent 如何思考和行为 |
| **IDENTITY.md** | Agent 的外在展示定义文件，包含名称、头像、语气等 |
| **AGENTS.md** | Agent 的标准操作规程（SOP）文件 |
| **USER.md** | 用户画像文件，从 memory_units 表动态渲染 |
| **MEMORY.md** | 长期记忆快照文件，从 memory_units 表动态渲染 |
| **HEARTBEAT.md** | Agent 周期性行为清单文件 |
| **L0/L1/L2** | 三层分级记忆存储：L0（一句话摘要，~50 tokens）/ L1（结构化概览，~500-2K tokens）/ L2（完整内容） |
| **memory_units** | 记忆主表，存储 L0/L1/L2 三层内容，9 类分类，merge/independent 语义 |
| **knowledge_graph** | 知识图谱表，存储实体间关系网络 |
| **conversation_log** | 对话日志表，原始对话数据，用于审计追溯和二次提取 |
| **merge/independent** | 记忆更新策略：merge 型按 merge_key 去重更新，independent 型每条独立存储 |
| **hotness** | 记忆激活度衰减公式：sigmoid(log1p(access_count)) x exp(-0.099 x age_days)，半衰期 7 天 |
| **ContextPlugin** | 记忆系统与 Agent 运行时的集成接口，提供 5 个生命周期钩子 |
| **Session Key** | 多通道会话路由键，格式为 `agent:<agentId>:<channel>:<chatType>:<peerId>` |
| **Binding** | 消息路由配置，定义 Channel 消息路由到哪个 Agent，最具体匹配优先 |
| **Lane** | 并发队列模型，管理 Agent 运行的并发度 |
| **PI 框架** | OpenClaw 底层引擎，MIT 许可，提供 Agent ReAct 循环/工具系统/会话持久化/Skills 加载 |
| **Daily Logs** | 日期分片的情景记忆文件，`memory/YYYY-MM-DD.md` |
| **Pre-compaction Flush** | 上下文压缩前的静默记忆保存，防止关键信息丢失 |
| **Growth Vectors** | 成长向量，追踪 Agent 在各能力维度的变化趋势 |
| **Crystallization** | 结晶化，成长向量经过 30+ 天门控后固化为永久特质 |
| **Skill** | Agent 的能力扩展模块，遵循 AgentSkills 规范（SKILL.md 格式） |
| **MCP** | Model Context Protocol，模型上下文协议 |
| **RAG** | Retrieval-Augmented Generation，检索增强生成 |
| **Channel** | 消息平台适配器（飞书/企微/QQ） |
| **SQLite-vec** | SQLite 的向量扩展，支持本地向量检索 |
| **FTS5** | SQLite 的全文检索扩展，支持 BM25 排序 |
| **能力图谱** | Agent 在各领域的能力评分系统，动态更新 |
| **进化日志** | 记录 Agent 成长轨迹的时间线日志 |
| **Sidecar** | Tauri 管理的后台 Node.js 服务进程 |

## 附录 B：Agent 工作区文件示例

### SOUL.md 示例

```markdown
# Soul

## Core Truths
- 真诚地帮助用户，而不是表演式地帮助
- 有自己的观点和判断，不要什么都说"好的"
- 遇到不确定的事情，坦诚说"我不确定"

## Boundaries
- 私密信息不主动提及
- 涉及外部操作（发消息、删文件）前先征得用户同意
- 群聊中不暴露用户的个人偏好

## Continuity
- 这些文件是你的记忆，阅读它们，在适当时候更新它们
- 每次对话都是成长的机会
```

### IDENTITY.md 示例

```yaml
---
name: "小助手"
emoji: "robot"
creature: "智能伴侣"
vibe: "温暖、细心、有条理"
theme: "warm"
---
```

### USER.md 示例（动态渲染）

```markdown
# User Profile

## Basic Info
- 职业：互联网公司产品经理
- 所在地：上海
- 主力设备：MacBook Pro M3

## Preferences
- 沟通风格：直接、简洁，不需要过多客套
- 编程：TypeScript，偏好函数式风格
- 文档：Markdown 格式，中文编写

## Important Corrections (Always Follow)
- 不要建议使用本地模型，这是门槛
- 不要在代码中用 var，统一用 const/let
- 日报格式必须包含"今日完成"和"明日计划"两个部分

## Knowledge Network
- 用户 -> works_on -> EvoClaw
- EvoClaw -> uses -> TypeScript + Tauri 2.0
```

**注意**: USER.md 和 MEMORY.md 是记忆系统的人类可读视图。实际记忆数据存储在 SQLite 的 memory_units 表和 knowledge_graph 表中，这些 .md 文件由系统在 Agent bootstrap 阶段从数据库动态渲染生成。

## 附录 C：记忆系统架构概览

EvoClaw 的记忆系统借鉴三个 OpenClaw 生态项目验证过的核心机制，在 better-sqlite3 单引擎上自主实现：

| 机制 | 来源 | 核心思想 | EvoClaw 实现 |
|------|------|---------|-------------|
| **L0/L1/L2 三层分级存储** | OpenViking | 每条记忆同时包含索引摘要/结构化概览/完整内容，按需加载 | memory_units 表 l0_index/l1_overview/l2_content 三列 |
| **三阶段渐进检索** | claude-mem | 先搜 L0 定位 → 加载 L1 精筛 → 按需加载 L2 | FTS5 + sqlite-vec 混合搜索 + 分阶段加载 |
| **反馈循环防护 + 相关度阈值** | MemOS | 零宽空格标记防止注入的记忆被重复存储 | 文本清洗 + 标记剥离 |
| **merge/independent 分类策略** | OpenViking | merge 型按 merge_key 去重更新，independent 型独立存储 | category + merge_type + merge_key 字段 |
| **hotness 衰减公式** | OpenViking | sigmoid(log1p(access_count)) x exp(-0.099 x age_days) | activation 列 + 衰减调度器 |
| **记忆安全协议** | MemOS | 四步裁决：来源验证 → 归属检查 → 置信度评估 → 隐私边界 | 提取 Pipeline Stage 2 内置 |

**设计哲学**:
- **单引擎嵌入式架构**: better-sqlite3 + sqlite-vec + FTS5 覆盖全部存储需求，零外部依赖，适合桌面端本地运行
- **PI 框架集成**: 通过 ContextPlugin 扩展钩子与 PI Agent 运行时集成，记忆系统作为 PI 的增强层运行
- **零配置开箱即用**: 记忆系统全自动运行，用户无需理解 L0/L1/L2 分层或配置衰减参数

---

> **文档版本**: v4.1 -- 新增 MetaClaw 借鉴特性：记忆 generation 溯源标注（F3.3）、Skill 自进化循环（F4.7）、响应质量评估（F8.7）；基于 PI 框架集成、L0/L1/L2 三层记忆系统、ContextPlugin 架构、ClawHub 生态兼容
> **文档状态**: 已更新
> **下次评审**: 待定
