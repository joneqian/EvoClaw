# 07 — Prompt 系统 差距分析

> **对标研究**: `/Users/mac/src/github/hermes-agent/.research/07-prompt-system.md`（1017 行）
> **hermes 基线**: commit `00ff9a26`（2026-04-16），`run_agent.py:2677-2836` + `agent/prompt_builder.py` + `agent/prompt_caching.py` + `agent/context_references.py` + `agent/subdirectory_hints.py` + `agent/skill_commands.py`
> **EvoClaw 基线**: 分支 `feat/hermes-parity` @ `5df3c79`（2026-04-16），`packages/core/src/agent/embedded-runner-prompt.ts`（444 行） + `agent/prompt-override.ts` + `context/plugins/tool-registry.ts`（Skill 注入） + `agent/kernel/stream-client.ts`（Anthropic cache_control + scope） + `infrastructure/system-events.ts`（事件注入）
> **综合判定**: 🟡 **部分覆盖 + 多项 🟢 反超** — 两侧都采用模块化段式组装，EvoClaw 在 **cache_control 三级 scope / Skill 渐进式两级注入 / PromptOverride 5 级优先级链 / 9 文件工作区声明式加载矩阵 / USER.md/MEMORY.md 外移 system-reminder** 五个维度反超；hermes 在 **`@filename` 引用展开 / SubdirectoryHints 动态发现 / 平台特定 hints / `_sanitize_api_messages` 孤立 tool_call 修复 / SOUL.md 运行时安全扫描 / cache 失效点审计** 六维度领先

**档位图例**:
- 🔴 **EvoClaw 明显落后** — 能力缺失或显著薄弱，补齐需 ≥1 人周工作量
- 🟡 **部分覆盖 / 形态差异** — 能力存在但不完整，或两者架构取向不同各有优劣
- 🟢 **EvoClaw 对齐或反超** — 能力持平或 EvoClaw 表现更佳

---

## 1. 定位

**hermes `_build_system_prompt`**（`run_agent.py:2677-2836`）—— 项目 prompt 系统的单一入口，按固定顺序拼接 13 个分段（源码注释称 7 层，本章细化）。整个 prompt 系统围绕三个核心约束组织：**多层组装**（13 个可条件开启的段）、**可定制人格**（用户编辑 `~/.hermes/SOUL.md` 改造 agent 身份）、**严禁打破 prompt cache**（AGENTS.md:339-347 硬约束：只有 context compression 和 model switch 才能重建 system prompt）。整个拼接后的字符串缓存到 `self._cached_system_prompt`，配套 `agent/prompt_caching.py:1-73` 的 4 断点 cache_control 策略 + `run_agent.py:2851-2919` 的 `_sanitize_api_messages` 孤立 tool_call 修复。`agent/context_references.py` / `agent/subdirectory_hints.py` / `agent/skill_commands.py` 提供"不破坏 cache"的 3 条动态注入通道（都落在 user message / tool result，不碰 system prompt）。

**EvoClaw `buildSystemPromptBlocks`**（`packages/core/src/agent/embedded-runner-prompt.ts:137-340`，含 SAFETY_CONSTITUTION L420-436，共 444 行）—— 返回 `SystemPromptBlock[]` 数组而非拼接字符串，每个 block 自带 `cacheControl: { type: 'ephemeral'; scope: 'global' | 'org' | null }`，由 `stream-client.ts:274-285` 在 Anthropic 协议路径上序列化为 `system: [{type:'text', text, cache_control:{...}}]` 数组、在 OpenAI 协议路径上通过 `systemPromptBlocksToString()` 合并为单字符串（`stream-client.ts:329`）。构建模式三分（`interactive` / `autonomous` / `fork`），配套 `agent/prompt-override.ts` 的 5 级优先级链（`override` / `coordinator` / `agent` / `custom` / `default` × `replace` / `append`）、`context/plugins/tool-registry.ts` 的 Skill 渐进式两级注入（Tier 1 `<available_skills>` XML 目录 + Tier 2 `invoke_skill` 按需加载）、`context/plugins/context-assembler.ts` 的 9 文件工作区加载矩阵（bootstrap vs beforeTurn）、`infrastructure/system-events.ts` 的 per-session 事件队列（drain 后注入 user message 前缀）。

**量级/范式对比**: hermes 单函数 160 行 + 13 段命令式拼接 vs EvoClaw 单函数 200 行 + `SystemPromptBlock[]` 声明式返回 + 插件链。EvoClaw 的块粒度架构**天然适配 Anthropic cache_control scope 三级分区**（static global / org / dynamic null），而 hermes 的字符串拼接架构让 cache_control 断点独立在 `prompt_caching.py` 里应用到 message list 上。两侧根本设计取向不同：EvoClaw 把 cache-awareness 做进 prompt 数据结构，hermes 把 cache-awareness 做在 message list 后处理层。

---

## 2. 档位速览（对应 §3 深度对比）

| # | 机制 | 档位 | 一句话 |
|---|---|---|---|
| §3.1 | 系统提示组装总入口 | 🟢 | EvoClaw `SystemPromptBlock[]` 声明式 vs hermes 13 段字符串拼接，EvoClaw cache-aware 架构更优 |
| §3.2 | 模块化段式结构 | 🟡 | 两侧都段式，hermes 13 段更成熟（含模型特定指令 + 平台 hint），EvoClaw ~10 段 + mode 三分 |
| §3.3 | 身份 / SOUL 注入 | 🟡 | EvoClaw 9 文件工作区矩阵（SOUL/IDENTITY/AGENTS/TOOLS/HEARTBEAT/USER/MEMORY/BOOT/BOOTSTRAP） vs hermes 单一 SOUL.md + 安全扫描 + 20k 截断 |
| §3.4 | 工具清单注入 | 🟢 | EvoClaw `<available_tools>` XML + 29 工具 TOOL_SUMMARIES 映射 + 优先级排序 vs hermes 按三类别合并的 tool guidance 单 prompt_part |
| §3.5 | 技能清单注入 | 🟢 | **反超**：EvoClaw Tier 1/2 两级渐进注入 + bundled 预算豁免，hermes 只有 skill slash command + skill intro |
| §3.6 | 记忆召回三层指令 | 🟢 | **反超**：EvoClaw `<memory_recall>` 7 条明确指令 + 6 类用户意图→工具映射表 + 记忆新鲜度规则，hermes MEMORY_GUIDANCE 几行粗粒度 |
| §3.7 | 运行时信息段 | 🟡 | hermes 4 字段（时间/Session/Model/Provider），EvoClaw 6-8 字段（含 Agent ID/name + OS + Node version + workspace 路径） |
| §3.8 | 安全宪法段 | 🟢 | **反超**：EvoClaw `SAFETY_CONSTITUTION`（固定常量 L420-436）7 条 Red Lines + scope='global' 跨用户缓存，hermes 无独立安全段 |
| §3.9 | Standing Orders 结构化 | 🔴 | CLAUDE.md 声称有"意识注入 <standing_orders>"，实际只在 AGENTS.md 模板里有说明注释，**无结构化 Program 解析/独立注入**，hermes 无对应 |
| §3.10 | Prompt Cache 策略 | 🟢 | **反超**：EvoClaw `cache_control scope: 'global'/'org'/null` 三级 + Latch 锁存 + PromptCacheMonitor，hermes 4 断点 ephemeral/1h + deepcopy |
| §3.11 | `_sanitize_api_messages` | 🔴 | hermes 强制 role 白名单 + 孤立 tool_call 修复 + stub 注入（`run_agent.py:2851-2919`），EvoClaw 仅 `ensureToolResultPairing` 补占位，**无 role 白名单 + 无 stub "[Result unavailable..."** |
| §3.12 | Prompt 变体 / 模式 | 🟢 | **反超**：EvoClaw `PromptBuildMode` 三分（interactive/autonomous/fork）+ 5 级 PromptOverride 链，hermes `skip_context_files` 单 gate |
| §3.13 | 平台特定 hints | 🔴 | hermes `PLATFORM_HINTS` dict 覆盖 9 平台（telegram/discord/slack/signal/email/cron/cli/sms/whatsapp），EvoClaw **无平台段**，渠道特异性下沉到 Channel 层消息格式化 |
| §3.14 | 渠道 / 群聊注入 | 🟡 | EvoClaw 有 `isGroupChat` 检测 + USER.md/MEMORY.md 群聊排除（context-assembler.ts:79-82），但无显式 `<channel>` peer info 段；hermes 有 platform hint 无 peer info |
| §3.15 | 大内容外移 system-reminder | 🟢 | **反超**：EvoClaw `buildUserContextReminder` 把 USER.md/MEMORY.md 移到首条 user message `<system-reminder>` 块，保护 system prompt cache；hermes 把这些放在 memory block（第 ⑧ 层）内，每次重建 system 时同步重载 |
| §3.16 | 动态注入通道（@引用/子目录 hint） | 🔴 | hermes `context_references.py`（6 类 @ 引用 + 敏感黑名单） + `subdirectory_hints.py`（AGENTS.md/.cursorrules 自动发现 + append 到 tool result）两条通道 EvoClaw 完全无 |

**统计**: 🔴 3 / 🟡 5 / 🟢 8（其中 5 项反超）。

---

## 3. 机制逐条深度对比

### §3.1 系统提示组装总入口

**hermes**（`.research/07-prompt-system.md §3.1` + `run_agent.py:2677-2836`）—— 命令式字符串拼接:

```python
def _build_system_prompt(self, system_message: str = None) -> str:
    """Called once per session and cached on self._cached_system_prompt."""
    # 13 段按条件 append 到 prompt_parts: List[str]
    prompt_parts = []
    # ① 身份 (SOUL.md 或 DEFAULT_AGENT_IDENTITY)
    if not self.skip_context_files:
        _soul_content = load_soul_md()
        if _soul_content: prompt_parts = [_soul_content]
    if not prompt_parts: prompt_parts = [DEFAULT_AGENT_IDENTITY]
    # ② - ⑬ 依次条件注入...
    return "\n\n".join(prompt_parts)
```

- 返回单一 `str`，全部 13 段用 `\n\n` join
- 调用方写入 `self._cached_system_prompt` 缓存，rebuild 唯一时机：context compression (L3004) / model switch (L1398)
- AGENTS.md:339-347 硬约束："禁止中途修改历史 / 切换 toolset / 重建 system prompt"

**EvoClaw**（`packages/core/src/agent/embedded-runner-prompt.ts:137-340`）—— 声明式块数组:

```typescript
export function buildSystemPromptBlocks(
  config: AgentRunConfig,
  mode: PromptBuildMode = 'interactive',
): SystemPromptBlock[] {
  if (mode === 'fork') return buildForkPromptBlocks(config);

  const files = truncateBootstrapContent(config.workspaceFiles ?? {});
  const blocks: SystemPromptBlock[] = [];

  // ═══ 全局静态段（scope: 'global'）═══
  blocks.push({ text: SAFETY_CONSTITUTION, cacheControl: { type: 'ephemeral', scope: 'global' }, label: 'safety' });
  blocks.push({ text: /* memory_recall */, cacheControl: { type: 'ephemeral', scope: 'global' }, label: 'memory_recall' });
  if (mode === 'interactive') {
    blocks.push({ text: /* tool_call_style */, cacheControl: { type: 'ephemeral', scope: 'global' }, label: 'tool_style' });
    blocks.push({ text: /* silent_reply */, cacheControl: { type: 'ephemeral', scope: 'global' }, label: 'silent_reply' });
  }
  blocks.push({ text: `<language>...${languageLabel}...</language>`, cacheControl: { type: 'ephemeral', scope: 'org' }, label: 'language' });

  // ═══ Agent 人格段（scope: 'org'）═══
  if (files['SOUL.md']) blocks.push({ text: `<personality>\n${files['SOUL.md']}\n</personality>`, cacheControl: { type: 'ephemeral', scope: 'org' }, label: 'personality' });
  if (files['IDENTITY.md']) blocks.push({ /* identity */ });
  if (files['AGENTS.md']) blocks.push({ /* operating_procedures */ });

  // ═══ 动态段（cacheControl: null）═══
  blocks.push({ text: `<runtime>\n${runtimeLines.join('\n')}\n</runtime>`, cacheControl: null, label: 'runtime' });
  if (files['BOOTSTRAP.md']) blocks.push({ text: `<bootstrap>...`, cacheControl: null, label: 'bootstrap' });
  if (files['TODO.json']) blocks.push({ /* current_tasks */ });
  if (toolCatalog) blocks.push({ text: toolCatalog, cacheControl: null, label: 'tools' });
  if (config.systemPrompt) blocks.push({ text: config.systemPrompt, cacheControl: null, label: 'custom' });

  return blocks;
}
```

- 返回 `SystemPromptBlock[]`，每块独立 `cacheControl` + `label`
- Anthropic 协议：`stream-client.ts:274-285` 序列化为 `system: TextBlock[]` 保留 cache_control + scope
- OpenAI 协议：`stream-client.ts:329` `systemPromptBlocksToString()` 合并为单字符串（忽略 cacheControl）
- 兼容函数 `buildSystemPrompt()`（`embedded-runner-prompt.ts:441-443`）返回字符串供旧调用方使用

**判定 🟢**：EvoClaw 架构设计上**反超**：

1. **cache-aware 数据结构**：`SystemPromptBlock[]` 把缓存意图作为一等公民保存到数据结构里，每块 label 可追溯；hermes 在 `prompt_caching.py` 里另起一套 cache_control 应用到 message list 上，两套系统解耦
2. **双协议透明切换**：同一 blocks 数组喂给两种 API，Anthropic 获得完整 cache_control，OpenAI 降级为字符串
3. **label 机制**：`label: 'safety' | 'memory_recall' | 'tool_style' | ...` 支持 cache 击穿根因分析（配合 PromptCacheMonitor §3.10）
4. **mode 三分与 replace/append 组合**：interactive/autonomous/fork 三种模式 + 5 级 override 链（见 §3.12）

hermes 的优势是**成熟**（13 段覆盖 gate / model-specific / platform / subscription），EvoClaw 的优势是**架构**（cache-aware + 声明式 + 多模式）。

---

### §3.2 模块化段式结构

**hermes**（`.research/07-prompt-system.md §2` + §3.1 L89-210）—— 13 段固定顺序:

| # | 段 | 控制 gate |
|---|---|---|
| ① | 身份（SOUL.md 或 DEFAULT_AGENT_IDENTITY） | `skip_context_files` |
| ② | 工具指导（memory / session_search / skill_manage 三合一 `" "` join） | `valid_tool_names` |
| ③ | Nous 订阅状态 | `build_nous_subscription_prompt(valid_tool_names)` |
| ④ | TOOL_USE_ENFORCEMENT_GUIDANCE | `_tool_use_enforcement` config |
| ⑤ | GOOGLE_MODEL_OPERATIONAL_GUIDANCE | 嵌套在 ④ 内 + `"gemini"/"gemma"` 子串 |
| ⑥ | OPENAI_MODEL_EXECUTION_GUIDANCE | 嵌套在 ④ 内 + `"gpt"/"codex"` 子串（PR #6120 6 个 XML 块） |
| ⑦ | 用户 / Gateway system message | `if system_message is not None` |
| ⑧ | 内存块（built-in + external providers，additive） | `self._memory_store` / `self._memory_manager` |
| ⑨ | 技能索引 | `{skills_list, skill_view, skill_manage} ∩ valid_tool_names` |
| ⑩ | 上下文文件（AGENTS.md/.cursorrules） | `skip_context_files` |
| ⑪ | 时间戳 + Session/Model/Provider | 无条件 + `pass_session_id` gate |
| ⑫ | 模型标识（Alibaba 特例） | `self.provider == "alibaba"` |
| ⑬ | 平台 hint | `self.platform` 查 PLATFORM_HINTS |

**EvoClaw**（`embedded-runner-prompt.ts:137-340`）—— 约 10 段 + 三 scope 分层:

| scope | 段（label） | 条件 |
|---|---|---|
| global | safety | 总是 |
| global | memory_recall | 总是 |
| global | tool_style | `mode === 'interactive'` |
| global | silent_reply | `mode === 'interactive'` |
| org | language | 总是 |
| org | personality (SOUL.md) | `files['SOUL.md']` 非空 |
| org | identity (IDENTITY.md) | `files['IDENTITY.md']` 非空 |
| org | procedures (AGENTS.md) | `files['AGENTS.md']` 非空 |
| null | runtime | 总是 |
| null | bootstrap (BOOTSTRAP.md) | 首轮 |
| null | tasks (TODO.json) | 非空且有任务 |
| null | tools (`<available_tools>`) | `config.tools` 非空 |
| null | custom (`config.systemPrompt`) | 非空 |

**判定 🟡**：

- EvoClaw 段数约 10-13 条（动态受文件可用性影响），比 hermes 的 13 段略少但**三 scope 分层更清晰**
- hermes 缺失：EvoClaw **没有**模型特定指令段（§ 嵌套在 ④ 内的 Google/OpenAI 纪律段）——hermes 这是 v0.8.0 重点 feature（PR #6120 自动化行为基准测试产出的 6 个 XML 块）
- EvoClaw 缺失：hermes `TOOL_USE_ENFORCEMENT_GUIDANCE` 反幻觉指令（"必须使用工具执行，不仅描述意图"）— 国产模型（尤其 GLM/Qwen）存在"描述工具用法而不调用"的失败模式，未来可借鉴
- hermes 的"工具指导三合一 `" "` join 成单 prompt_part"在 EvoClaw 拆成独立 memory_recall / tool_style 两个 block（各自独立可缓存）

---

### §3.3 身份 / SOUL 注入

**hermes**（`.research/07-prompt-system.md §3.2` + `agent/prompt_builder.py:838-863`）—— 单一 SOUL.md + 安全扫描:

```python
def load_soul_md() -> Optional[str]:
    soul_path = get_hermes_home() / "SOUL.md"
    if not soul_path.exists(): return None
    content = soul_path.read_text(encoding="utf-8").strip()
    content = _scan_context_content(content, "SOUL.md")      # prompt injection 检测
    content = _truncate_content(content, "SOUL.md")          # 20000 字符硬截断
    return content
```

- 位置：`~/.hermes/SOUL.md`（用户可编辑）
- 兜底：`DEFAULT_AGENT_IDENTITY`（`prompt_builder.py:134-142`）+ `DEFAULT_SOUL_MD`（`hermes_cli/default_soul.py:3-11`，**文案完全一致**）
- 出厂版本：`docker/SOUL.md`（容器 entrypoint 首次启动 copy）
- 三层安全：`_scan_context_content`（注入检测）+ `_truncate_content`（20k 上限）+ 缓存（会话内只读一次）

**EvoClaw**（`embedded-runner-prompt.ts:264-274` + `context/plugins/context-assembler.ts:17-60`）—— 9 文件工作区矩阵:

```typescript
// context-assembler.ts:17-26
const FILE_LOAD_MATRIX: Record<string, { bootstrap: boolean; beforeTurn: boolean }> = {
  'SOUL.md':      { bootstrap: true,  beforeTurn: false },
  'IDENTITY.md':  { bootstrap: true,  beforeTurn: false },
  'AGENTS.md':    { bootstrap: true,  beforeTurn: false },
  'TOOLS.md':     { bootstrap: true,  beforeTurn: false },
  'USER.md':      { bootstrap: false, beforeTurn: true },  // 每轮重新加载
  'MEMORY.md':    { bootstrap: false, beforeTurn: true },  // 每轮重新加载
  'HEARTBEAT.md': { bootstrap: true,  beforeTurn: false },
  'BOOTSTRAP.md': { bootstrap: true,  beforeTurn: false },
};

// embedded-runner-prompt.ts:264-274
if (files['SOUL.md']) {
  blocks.push({ text: `<personality>\n${files['SOUL.md']}\n</personality>`,
                cacheControl: { type: 'ephemeral', scope: 'org' }, label: 'personality' });
}
if (files['IDENTITY.md']) {
  blocks.push({ text: `<identity>\n${files['IDENTITY.md']}\n</identity>`, ... });
}
```

- **9 个文件**（CLAUDE.md 声称）：SOUL.md / IDENTITY.md / AGENTS.md / TOOLS.md / HEARTBEAT.md / USER.md / MEMORY.md / BOOT.md / BOOTSTRAP.md
- 加载矩阵声明式：bootstrap vs beforeTurn 两阶段
- 截断：`BOOTSTRAP_MAX_CHARS_PER_FILE = 20_000` + `BOOTSTRAP_TOTAL_MAX_CHARS = 150_000` + 总量控制（`embedded-runner-prompt.ts:104-122`）
- **无 `_scan_context_content` 等价**——`grep -r "scanContextContent\|scan_context" packages/core/src` 零结果

**判定 🟡**：

- EvoClaw **粒度更细**（9 文件 vs 1 SOUL.md），覆盖身份 / 操作规程 / 工具备注 / 用户档案 / 记忆 / 心跳 / 引导 / 启动多维度
- hermes **运行时安全扫描** EvoClaw 缺失：用户若把 `ignore all previous instructions` 写入 SOUL.md，hermes 有 `_scan_context_content` 检测（虽然规则未知），EvoClaw 零检测
- 建议：引入类似 `_scan_context_content` 的轻量 prompt injection 扫描（~0.5d）

---

### §3.4 工具清单注入

**hermes**（`.research/07-prompt-system.md §3.10` + `agent/prompt_builder.py:144-171`）—— 三类别指导合并:

```python
# prompt_builder.py:144-171
MEMORY_GUIDANCE = "You have persistent memory across sessions. Save durable facts..."
SESSION_SEARCH_GUIDANCE = "When the user references something from a past conversation..."
SKILLS_GUIDANCE = "After completing a complex task (5+ tool calls)..."

# run_agent.py:2691-2700（§ ②）
tool_guidance = []
if "memory" in self.valid_tool_names: tool_guidance.append(MEMORY_GUIDANCE)
if "session_search" in self.valid_tool_names: tool_guidance.append(SESSION_SEARCH_GUIDANCE)
if "skill_manage" in self.valid_tool_names: tool_guidance.append(SKILLS_GUIDANCE)
if tool_guidance:
    prompt_parts.append(" ".join(tool_guidance))  # 单空格 join 成 ONE prompt_part
```

- 三段指导按工具可用性条件拼接
- 工具 schema 单独在 `tools` 字段传（不进 system prompt）

**EvoClaw**（`embedded-runner-prompt.ts:38-98`）—— 29 工具 summary + XML 目录:

```typescript
const TOOL_SUMMARIES: Record<string, string> = {
  read: '读取文件内容（文本或图片），大文件用 offset/limit 分段',
  write: '创建或覆盖文件，自动创建父目录',
  edit: '精确替换文件中的文本片段（oldText → newText）',
  apply_patch: '应用多文件统一补丁（*** Begin/End Patch 格式）',
  grep: '搜索文件内容，返回匹配行+文件路径+行号',
  // ... 共 29 条（含 memory_* × 5 / spawn_agent / todo_write 等）
};

const TOOL_ORDER = ['read', 'write', 'edit', 'apply_patch', 'grep', 'find', 'ls',
                    'bash', 'exec_background', 'process', 'web_search', 'web_fetch',
                    'image', 'pdf', 'memory_search', 'memory_get',
                    'memory_write', 'memory_update', 'memory_delete',
                    'memory_forget_topic', 'memory_pin', 'knowledge_query',
                    'spawn_agent', 'list_agents', 'kill_agent', 'steer_agent',
                    'yield_agents', 'todo_write'];

function buildToolCatalog(availableTools: string[]): string {
  const sorted = [...availableTools].sort(/* by TOOL_ORDER index */);
  const lines = sorted.map(name => `- ${name}: ${TOOL_SUMMARIES[name] ?? ''}`);
  return `<available_tools>
工具名称区分大小写，请严格按照列出的名称调用。
${lines.join('\n')}
</available_tools>`;
}
```

**判定 🟢**：EvoClaw 反超：

1. **XML 包裹 + 中文引导**："工具名称区分大小写，请严格按照列出的名称调用"——针对国产模型（Qwen/GLM）命中率问题的明确引导
2. **优先级排序**：`TOOL_ORDER` 定义 28 工具的展示顺序（read/write 在最前，debug/meta 在最后）
3. **每工具一行 summary**：模型快速掌握可用能力，不需要完整 schema
4. **cache-aware**：`<available_tools>` 作为独立 block（label: 'tools', cacheControl: null），工具集变化不击穿全部 cache

hermes 在主 prompt 里仅注入"何时用内存/何时用搜索/何时用技能"的**元指导**，工具名称/描述交给 `tools` 字段。EvoClaw 同时注入 summary + schema 双通道，对国产模型工具调用准确率有正向价值。

---

### §3.5 技能清单注入

**hermes**（`.research/07-prompt-system.md §3.9` + `agent/skill_commands.py:121-197`）—— Skill slash 命令 + 单次注入:

```python
def _build_skill_message(
    loaded_skill: dict,
    skill_dir: Path | None,
    activation_note: str,
    user_instruction: str = "",
    runtime_note: str = "",
) -> str:
    """Format a loaded skill into a USER-MESSAGE payload."""
    # 注入为 USER message（不是 system prompt），保护 prompt cache
    parts = [activation_note, "", loaded_skill["content"].strip()]
    _inject_skill_config(loaded_skill, parts)
    # setup 状态 + 支持文件发现 + 用户指令 + 运行时注记
    return "\n".join(parts)
```

- 用户输入 `/skill-name` 触发，作为 **user message** 注入
- 同时 `build_skills_system_prompt` 可在系统 prompt ⑨ 层产生技能索引（条件：`{skills_list, skill_view, skill_manage}` 工具可用）
- 无预算控制，无两级注入

**EvoClaw**（`context/plugins/tool-registry.ts:288-360` + `skill/skill-tool.ts:60-95`）—— Tier 1 XML 目录 + Tier 2 invoke_skill 工具:

```typescript
// tool-registry.ts:288-310（Tier 1 - 系统 prompt 注入）
function buildSkillsPrompt(skills: InstalledSkill[]): string {
  const header = `## Skills (optional reference library)
Built-in tools are your **primary** action interface — prefer them for any direct action you can do yourself.

Skills are pre-written task templates for *complex multi-step workflows* that no single built-in tool can complete on its own. Only invoke a skill when **all** of the following hold:
- The user task genuinely requires multi-step orchestration beyond what a single built-in tool provides
- A specific skill in <available_skills> below clearly matches the workflow
- You actually need its detailed instructions (not just its name as a hint)

If a built-in tool can do the job, use the built-in tool. Do NOT invoke a skill just because the keyword sounds related.

Constraint: invoke at most one skill per turn.
`;
  const fullEntries = skills.map(skillToFullEntry);
  const fullCatalog = `<available_skills>\n${fullEntries.join('\n')}\n</available_skills>`;
  // 预算降级: full → compact → bundled 豁免 + others 截断
  if (fullPrompt.length <= MAX_SKILLS_PROMPT_CHARS) return fullPrompt;
  // ... G1: bundled 享有不可截断特权，others 在剩余预算内降级
}

// skill-tool.ts:60-95（Tier 2 - 工具按需加载）
name: 'invoke_skill',
description: `当用户请求的任务与 <available_skills> 中列出的技能匹配时，使用此工具加载该技能的完整指令，然后按指令执行。`,
inputSchema: {
  properties: {
    skill_name: { type: 'string', description: 'Skill 名称（从 <available_skills> 目录中选择）' },
  },
},
```

**判定 🟢 反超**：EvoClaw 的 Skill 注入是全面设计优势：

1. **渐进式两级注入**：Tier 1 XML 目录注入 system prompt (~50-100 tokens/skill，含 whenToUse/mode/source 标签) → Tier 2 `invoke_skill` 按需加载完整 SKILL.md（CLAUDE.md 描述准确）
2. **"one skill per turn" 约束**：防止模型在单次回复中链式调用多个 skill 导致上下文爆炸
3. **预算降级三级**：full → compact → bundled 豁免 + others 截断（`tool-registry.ts:313-350`）
4. **"Built-in tools are your primary"**：明确优先级引导，防止模型用 skill 替代基础工具
5. **5 种 source 统一**：bundled / local / clawhub / github / mcp（CLAUDE.md）

hermes 的 skill 系统是**"用户显式触发 `/skill-name`"**模型（对话期间用户打滑线命令激活），EvoClaw 是**"模型自主按需调用 invoke_skill 工具"**模型（对话中模型根据 available_skills 目录判断何时激活）。后者对**自动化工作流**更友好。

详见 [`12-skills-system-gap.md`](./12-skills-system-gap.md)（🟢 EvoClaw 显著反超）。

---

### §3.6 记忆召回三层指令

**hermes**（`.research/07-prompt-system.md §3.10` + `agent/prompt_builder.py:144-156`）—— 粗粒度 MEMORY_GUIDANCE:

```python
MEMORY_GUIDANCE = """\
You have persistent memory across sessions. Save durable facts (user preferences, project context, agreements, learned patterns) you'll want to recall later.
Save ONE fact at a time — avoid summary paragraphs.
Update facts over time rather than adding redundant ones. Remove stale or incorrect facts.
Before answering questions that depend on personal context, check your memory."""
```

- 4 行引导："保存一事一条 / 更新而非累积 / 前置检查记忆"

**EvoClaw**（`embedded-runner-prompt.ts:160-196`）—— 结构化 `<memory_recall>`:

```xml
<memory_recall>
Before answering the user, you should:
1. Use memory_search to find relevant memories — learn about the user's preferences, history, and context
2. Use memory_get for full details when needed
3. Incorporate memory context for more personalized, accurate replies
4. If the user mentions a previously discussed topic, always search memory first
5. MEMORY.md is an auto-rendered DB view — read it for context, but never write to it
6. When the user explicitly asks you to remember something, call memory_write **immediately** (see table below) — do not wait for the background extractor
7. At the start of each session, check MEMORY.md for previously recorded notes

## 主动管理记忆 — 即时反馈优先
当用户在对话中**明确**说出以下意图时，**立即**调用对应工具，并等待成功后在回复里告知用户结果（含 id）：

| 用户说 | 你应该做 |
|---|---|
| "记住 X / 帮我记一下 / 别忘了 X" | memory_write 写入新记忆 → 回复"已记住（id=...）" |
| "改一下那条记忆 / 不对应该是 Y / 修正一下" | 先 memory_search 找 id → memory_update 改 l1/l2 → 回复"已更新" |
| "删掉这条 / 把 X 那条记忆删了" | 先 memory_search 找 id → memory_delete → 回复"已删除：..." |
| "忘掉所有关于 X 的事 / 别再提 X" | memory_forget_topic 按关键词批量归档 → 回复"已遗忘 N 条" |
| "这条很重要 / 把这条置顶 / 别让它衰减" | memory_pin（pinned=true） → 回复"已钉选" |
| "取消置顶 / 不用置顶了" | memory_pin（pinned=false） → 回复"已取消钉选" |

## 记忆新鲜度
记忆可能随时间过期。使用超过 1 天的记忆前，请验证其是否仍然正确。
如果记忆与当前状态矛盾，信任当前观察并更新记忆。
标记为 [⚠] 的记忆表示已有一段时间未更新，使用时需额外谨慎。
</memory_recall>
```

**判定 🟢 反超**：

1. **7 条明确指令** vs hermes 4 行粗粒度
2. **6 类用户意图 → 工具映射表**：明确告诉模型"记住 X / 改一下 / 删掉 / 忘掉所有 / 置顶 / 取消置顶"六种意图的工具选择
3. **即时反馈**："立即调用 + 回复 id" 对比 hermes 的"save durable facts"，操作性强
4. **记忆新鲜度规则**：1 天阈值 + [⚠] 标记解读，hermes 无对应
5. **`grep 零结果`**：hermes 无"用户意图映射表" / "记忆新鲜度"等价指令

这是 L0/L1/L2 三层记忆系统（CLAUDE.md）在 prompt 层的**显式化指令**，对国产模型的记忆工具调用准确率有关键正向贡献。

---

### §3.7 运行时信息段

**hermes**（`.research/07-prompt-system.md §3.1` 层 ⑪ + `run_agent.py:2796-2810`）—— 4 字段:

```python
timestamp_line = f"Conversation started: {now.strftime('%A, %B %d, %Y %I:%M %p')}"
if self.pass_session_id and self.session_id:
    timestamp_line += f"\nSession ID: {self.session_id}"
if self.model:
    timestamp_line += f"\nModel: {self.model}"
if self.provider:
    timestamp_line += f"\nProvider: {self.provider}"
prompt_parts.append(timestamp_line)
```

- 4 字段：Conversation started / Session ID（gated）/ Model / Provider（无条件追加）

**EvoClaw**（`embedded-runner-prompt.ts:279-299`）—— 6-8 字段:

```typescript
const runtimeLines = [
  `Agent ID: ${config.agent?.id ?? 'unknown'}`,
  `Agent name: ${config.agent?.name ?? 'unnamed'}`,
  `OS: ${os.platform()} ${os.arch()}`,
  `Node.js: ${process.version}`,
  `Model: ${config.provider}/${config.modelId}`,
  `Current time: ${new Date().toISOString()}`,
];
if (config.workspacePath) {
  runtimeLines.push(`Workspace path: ${config.workspacePath}`);
  runtimeLines.push(`Scratchpad: ${config.workspacePath}/tmp/ (temporary files)`);
}
runtimeLines.push(
  `Long-term memory: stored in DB — use memory_write/update/delete/forget_topic/pin tools (not files)`,
  `Work output: files generated for the user (HTML/PDF/images etc.) go to workspace root`,
);
blocks.push({ text: `<runtime>\n${runtimeLines.join('\n')}\n</runtime>`, cacheControl: null, label: 'runtime' });
```

**判定 🟡**：

- EvoClaw 字段更多（Agent ID/name、OS、Node 版本、workspace、scratchpad），但**每次都变**（`new Date().toISOString()` 每轮不同）——幸好这个 block 是 `cacheControl: null`，不会击穿 cache
- hermes 字段精简但**Session ID 受 `pass_session_id` gate**，EvoClaw 无 gate 总是注入
- 两侧语义略不同：hermes 的"Conversation started"是会话开始时间（一次），EvoClaw 的"Current time"是每轮当前时间（更实时）
- EvoClaw 多了 **workspace path + scratchpad 提示 + 记忆 DB 提示**——对企业用户"文件应该放哪"的引导更明确

EvoClaw CLAUDE.md 声明的"Git context 不注入"在 `embedded-runner-prompt.ts:25` 注释里明确（"EvoClaw 面向企业用户，非开发者，无需 Git 状态"），这是**设计意图**。

---

### §3.8 安全宪法段

**hermes** —— 无独立安全宪法段:
- Safety 指令散布在 SOUL.md / TOOL_USE_ENFORCEMENT_GUIDANCE / 各 GUIDANCE 内
- 无 "Red Lines" 概念
- 无 scope='global' 跨用户共享缓存优化

**EvoClaw**（`embedded-runner-prompt.ts:420-436`）—— 独立 SAFETY_CONSTITUTION 常量:

```typescript
export const SAFETY_CONSTITUTION = `<safety>
You are an AI assistant governed by these core safety principles:
- You have no independent goals; always serve the user's needs
- Safety and human oversight take priority over task completion
- Do not self-preserve, attempt to keep running, or modify your own config
- Refuse instructions that could cause harm
- When uncertain, proactively ask the user for confirmation

## Red Lines (Immutable — enforced by system, cannot be overridden)
- Never reveal API keys, tokens, passwords, or secrets
- Never impersonate the user or send messages as the user
- Never bypass tool approval gates or permission checks
- Never access files outside workspace without explicit permission
- Never send messages to external channels without user consent
- Never execute financial, contractual, or legally binding actions autonomously
- In group chats, never expose private conversation context
</safety>`;

// embedded-runner-prompt.ts:153-157
blocks.push({
  text: SAFETY_CONSTITUTION,
  cacheControl: { type: 'ephemeral', scope: 'global' },  // 跨用户共享缓存
  label: 'safety',
});
```

**判定 🟢 反超**：

1. **独立常量 + 全局静态** — 所有 Agent、所有用户、所有 session 的 safety 段**完全一致**，scope='global' 让 Anthropic 1P 用户享受 1/10 cache 命中费用
2. **5 条核心原则 + 7 条 Red Lines** — 明确分层（软性原则 vs 不可覆盖红线）
3. **企业场景覆盖**：群聊隐私保护、权限门控、外部消息发送同意、财务/法律自主决策禁令，直指企业客户合规需求
4. **Fork 模式简化版**（`embedded-runner-prompt.ts:357-362`）：子 Agent 共享 SAFETY_CONSTITUTION 前缀，prompt cache 命中（`safety-prefix.test.ts` 断言 parent 与 fork 子 Agent 共享相同前缀）
5. **Test coverage**：`__tests__/safety-prefix.test.ts:95-111` 验证 parent/child 前缀一致性 + 语言切换下前缀稳定

---

### §3.9 Standing Orders 结构化

**hermes** —— 无对应机制。

**EvoClaw** — CLAUDE.md 声称的机制与实际实现存在**显著落差**:

**CLAUDE.md 宣称**（文件开头 §关键架构模式）:
> "Standing Orders: AGENTS.md 中结构化 Program（Scope/Trigger/Approval/Escalation），系统 prompt <standing_orders> 意识注入，Heartbeat 检查 trigger=heartbeat 程序"

**实际代码验证**:

```bash
# 搜索 standing_orders 注入:
grep -rn "standing_orders\|Standing Order\|standingOrder" packages/core/src
```

结果：

- `packages/core/src/agent/agent-manager.ts:420` —— **仅在 DEFAULT_AGENTS_MD 模板字符串里**，以 Markdown `## Standing Orders` + HTML 注释说明的形式存在:

```markdown
## Standing Orders

<!-- Define your persistent programs here. Each program grants you ongoing authority
     to act autonomously within defined boundaries.

### Program: [Name]
- **Scope**: What you are authorized to do
- **Trigger**: When to execute (heartbeat / cron / event)
- **Approval**: What requires human sign-off before acting
- **Escalation**: When to stop and ask for help
-->
```

- **无独立 `<standing_orders>` XML 段注入**：`embedded-runner-prompt.ts` 不含 standing_orders 关键字
- **无 Program 结构化解析**：没有 YAML/frontmatter/正则提取 Scope/Trigger/Approval/Escalation 字段的代码
- **无 Heartbeat trigger=heartbeat 过滤**：`grep "trigger.*heartbeat" packages/core/src` 零结果

**判定 🔴 缺失**：CLAUDE.md 声称的"结构化 Program + 意识注入"在当前代码中仅以 **AGENTS.md 模板注释**形式存在，AGENTS.md 整体作为 `<operating_procedures>` 注入（`embedded-runner-prompt.ts:272-274`），模型会看到 Standing Orders 章节原文但**无独立结构化处理**。

这既不是 hermes 的优势（hermes 无对应机制），也**不是 EvoClaw 的反超**——是**未实装的声明**。建议：

- P1：实装 Standing Orders 解析器 + `<standing_orders>` 独立 block 注入（~1-2d）
- 或修正 CLAUDE.md 文案，降低宣称到"AGENTS.md 中按模板写 Standing Orders，作为 operating_procedures 的一部分注入"

---

### §3.10 Prompt Cache 策略

**hermes**（`.research/07-prompt-system.md §3.3` + `agent/prompt_caching.py:1-73`）—— 4 断点 message-level:

```python
def apply_anthropic_cache_control(api_messages, cache_ttl="5m", native_anthropic=False):
    messages = copy.deepcopy(api_messages)       # ← 绝不修改原列表
    marker = {"type": "ephemeral"}
    if cache_ttl == "1h": marker["ttl"] = "1h"
    breakpoints_used = 0
    # 1. 系统消息（第一条）
    if messages[0].get("role") == "system":
        _apply_cache_marker(messages[0], marker, native_anthropic)
        breakpoints_used += 1
    # 2-4. 最后 (4 - breakpoints_used) 条非系统消息
    remaining = 4 - breakpoints_used
    non_sys = [i for i in range(len(messages)) if messages[i].get("role") != "system"]
    for idx in non_sys[-remaining:]:
        _apply_cache_marker(messages[idx], marker, native_anthropic)
    return messages
```

- 最多 4 断点（system + 最后 3 条非系统消息）
- 两档 TTL（5m 默认 / 1h 长会话）
- deepcopy 语义保证不修改调用方
- `role="tool"` + `native_anthropic=False` → 直接 return（OpenRouter 转发 Claude 场景需显式 native_anthropic=True）
- cache 失效审计：`run_agent.py:1398`（model switch）+ `run_agent.py:3004`（`_invalidate_system_prompt`）**仅 2 处**

**EvoClaw**（`embedded-runner-prompt.ts` cacheControl 字段 + `stream-client.ts:270-285` 序列化 + `kernel/prompt-cache-monitor.ts` 监控）—— 三级 scope system-level:

```typescript
// types.ts:378-393
export type CacheScope = 'global' | 'org';
export interface SystemPromptBlock {
  text: string;
  cacheControl?: { type: 'ephemeral'; scope?: CacheScope } | null;
  label?: string;
}

// stream-client.ts:270-285（Anthropic 序列化）
const systemParam = Array.isArray(config.systemPrompt)
  ? config.systemPrompt.map(block => ({
      type: 'text' as const,
      text: block.text,
      ...(block.cacheControl ? {
        cache_control: {
          type: block.cacheControl.type,
          ...(block.cacheControl.scope === 'global' ? { scope: 'global' } : {}),
        },
      } : {}),
    }))
  : config.systemPrompt;

// prompt-cache-monitor.ts:59-60（Latch 锁存）
private latchedSystemPromptHash: string | null = null;
private latchedToolSchemaHash: string | null = null;
```

- **三级 scope**：`'global'`（跨用户共享，Anthropic 1P 专属，命中费用 1/10）/ `'org'`（组织级）/ `null`（不缓存）
- **block-level 断点**：每个 SystemPromptBlock 独立声明 cache_control（vs hermes 的 message-level）
- **Latch 锁存**（`prompt-cache-monitor.ts:52-60`）：首次构建的静态段落 hash 锁存，防止 session 中途 system prompt 意外变化
- **PromptCacheMonitor**（`prompt-cache-monitor.ts:43-80`）：API 调用前记录 state，调用后检测 cache 断裂（tokenDrop ≥ 2000 且 newCacheRead < prevCacheRead × 0.95）+ 根因分析（system prompt / tools / modelId 哪个变了）
- **cacheBreakpointIndex 追踪**（见 05-agent-loop-gap.md §3.12）

**判定 🟢 反超**：

1. **Scope 三级** — hermes 只有 ephemeral 两档 TTL，EvoClaw 有 global/org/null 三 scope
2. **block-level 断点** — EvoClaw 把 cache_control 做进数据结构（每个 block 独立声明），hermes 在消息列表后处理
3. **Latch 锁存** — EvoClaw 首次 hash 锁死，session 中途变化会 **warning log** 出来；hermes 无锁存（仅靠 `_cached_system_prompt` 缓存）
4. **PromptCacheMonitor 根因分析** — 断裂时自动对比 system/tools/model 哪个变了，hermes 无
5. **Fork 子 Agent 前缀共享** — `safety-prefix.test.ts` 验证 parent/child 共享 SAFETY_CONSTITUTION 前缀 cache，hermes 无对应测试

hermes 的 cache 失效点**审计更严格**（仅 2 处显式失效 + AGENTS.md 硬约束），EvoClaw 的 cache 监测**更自动**（Monitor 主动检测 + Latch 防漂移）。详见 [`08-context-compression-gap.md`](./08-context-compression-gap.md)（🟢 EvoClaw 显著反超 — cache 微压缩）。

---

### §3.11 `_sanitize_api_messages`

**hermes**（`.research/07-prompt-system.md §3.4` + `run_agent.py:2851-2919`）—— 4 步消毒:

```python
_VALID_API_ROLES = frozenset({"system", "user", "assistant", "tool", "function", "developer"})

@staticmethod
def _sanitize_api_messages(messages: list) -> list:
    # 步骤 1: Role 白名单过滤
    filtered = [m for m in messages if m.get("role") in AIAgent._VALID_API_ROLES]
    # 步骤 2: 收集 assistant.tool_calls 的 ID
    surviving_call_ids = {tc_id for m in filtered if m["role"]=="assistant"
                          for tc_id in [_get_tool_call_id(tc) for tc in m.get("tool_calls") or []]}
    # 步骤 3: 删除孤立 tool result（tool_call_id 不在 surviving 中）
    result_call_ids = {m["tool_call_id"] for m in filtered if m.get("role")=="tool"}
    orphaned = result_call_ids - surviving_call_ids
    if orphaned:
        filtered = [m for m in filtered
                    if not (m.get("role")=="tool" and m.get("tool_call_id") in orphaned)]
    # 步骤 4: 为缺失的 tool result 注入 stub "[Result unavailable — see context summary above]"
    missing = surviving_call_ids - result_call_ids
    if missing:
        # 插入占位 stub
        ...
    return filtered
```

- **无条件运行**（不依赖 compressor 状态）
- Role 白名单防止 hermes 内部 role（如 `"meta"` / `"transcript"`）泄漏到 API
- 孤立 tool 双向修复：删除 orphaned + 插入 stub

**EvoClaw**（`packages/core/src/agent/kernel/message-utils.ts` `ensureToolResultPairing`）—— 补占位但无 role 白名单:

- 仅处理中断场景下未配对的 tool_use → 补占位 tool_result（`query-loop.ts:371` 调用）
- **无 role 白名单过滤** — `grep -r "_VALID_API_ROLES\|validApiRoles" packages/core/src` 零结果
- **无 stub 注入 "[Result unavailable..."**
- **无 orphaned tool result 删除**（压缩后如果 assistant 被删但 tool 结果留下，可能污染 API 请求）

**判定 🔴 缺失**：这是一个**隐藏风险**:

1. 压缩后 orphaned tool message 可能导致 Anthropic API 拒绝（"tool_use_id not found"）
2. 若未来 EvoClaw 增加内部 role（例如 `"meta"` 记录压缩历史、`"trajectory"` 记录训练数据），需要 role 白名单防止泄漏

建议：P0 优先级 ~0.5d 添加 `sanitizeApiMessages()` 函数，加 role 白名单 + orphaned 清理 + stub 注入。

---

### §3.12 Prompt 变体 / 模式

**hermes** —— 单一 `skip_context_files` gate:
- `skip_context_files=True` → 跳过 ① SOUL.md 和 ⑩ 上下文文件层
- 常用于 gateway 模式

**EvoClaw**（`embedded-runner-prompt.ts:28` + `prompt-override.ts`）—— 双维度变体:

**维度 1：构建模式（`PromptBuildMode`）**

```typescript
export type PromptBuildMode = 'interactive' | 'autonomous' | 'fork';

// 'interactive': 完整提示词（默认，用户直接交互）
// 'autonomous': 裁剪交互式引导（Cron/Heartbeat 自主执行，跳过 tool_style / silent_reply）
// 'fork': 极简提示词（Skill fork 子代理，只保留身份 + 工作目录 + 安全红线 + 自定义指令）
```

**维度 2：5 级优先级链（`prompt-override.ts:38-44`）**

```typescript
const PRIORITY_ORDER: Record<PromptOverrideLevel, number> = {
  override: 0,     // 最高优先级（loop mode、--system-prompt-file）
  coordinator: 1,  // 协调器模式
  agent: 2,        // Agent 定义（AGENTS.md 内嵌提示词）
  custom: 3,       // API 级自定义（config.systemPrompt）
  default: 4,      // 默认（buildSystemPrompt 输出）
};

export function resolvePromptOverrides(
  defaultPrompt: PromptBlock[],
  overrides: PromptOverride[],
): PromptBlock[] {
  // 1. 找最高优先级的 replace → 替换全部
  // 2. 所有 append 按优先级追加到末尾
  const firstReplace = sorted.find(o => o.mode === 'replace');
  const base = firstReplace ? [{text: firstReplace.content, ...}] : [...defaultPrompt];
  for (const override of appends) base.push({text: override.content, ...});
  return base;
}
```

**判定 🟢 反超**：

1. **三模式三视角**：interactive（UI 用户） / autonomous（无人值守 Cron/Heartbeat） / fork（Skill 子代理）— 覆盖 EvoClaw 的主要执行场景
2. **5 级优先级链** — hermes 仅单 gate，EvoClaw 支持企业级"IT 管理员强制 prompt > 协调器 > Agent 默认 > API 自定义 > 系统默认"的多层管控
3. **replace/append 正交** — 同一级别既能替换也能追加

对企业用户：IT 管理员可通过 `override` 级别强制注入合规声明（追加到所有 Agent 的 system prompt），hermes 无对应。

关于多品牌（EvoClaw / HealthClaw）—— 实际代码中**没有 brand-specific prompt 变体**（`grep -r "HealthClaw\|品牌" packages/core/src/agent` 零结果，仅 types.ts 提及）。CLAUDE.md 提到的 `pnpm build:healthclaw` 仅是构建脚本层品牌分化，prompt 层目前**无差异**。

---

### §3.13 平台特定 hints

**hermes**（`.research/07-prompt-system.md §3.7` + `agent/prompt_builder.py:285-352`）—— 9 平台 hints:

```python
PLATFORM_HINTS = {
    "whatsapp": "...",
    "telegram": "You are on a text messaging communication platform, Telegram. "
                "Please do not use markdown as it does not render. "
                "You can send media files natively: include MEDIA:/absolute/path/... ",
    "discord": "...",
    "slack": "...",
    "signal": "...",
    "email": "...",
    "cron": "...",
    "cli": "...",
    "sms": "...",
}
# 注入点：_build_system_prompt 第 ⑬ 层
platform_key = (self.platform or "").lower().strip()
if platform_key in PLATFORM_HINTS:
    prompt_parts.append(PLATFORM_HINTS[platform_key])
```

- 9 平台各自描述输出格式（markdown / 纯文本 / HTML）、长度限制（Telegram 4096 / Discord 2000 / SMS 160）、特殊能力（MEDIA tag / slash command / 按钮）、交互风格（cron 无交互 / email 异步）

**EvoClaw** —— **无平台段**:

- `grep -r "PLATFORM_HINTS\|platformHints\|channel.*hint" packages/core/src/agent` 零结果
- embedded-runner-prompt.ts 内不含平台特异性指令
- 渠道特异性下沉到 Channel 层（`packages/core/src/channels/*`，本章未展开）在 **消息格式化** 阶段处理（如企微 Markdown→纯文本、微信 Voice 转码）

**判定 🔴 缺失**：对比两侧:

- hermes：LLM 被告知"你在 Telegram 上，不要用 markdown"，模型**主动**输出纯文本
- EvoClaw：LLM 生成 markdown → Channel 层**被动**转换为纯文本

被动转换有风险：
- 复杂 markdown（嵌套表格、代码块内代码块）转换丢失信息
- 模型可能主动使用不存在的能力（例如 CLI 平台无"按钮"但模型尝试发按钮）
- Cron/Heartbeat 场景模型不知道"无人等待回复"，可能输出过长叙事

建议：P1 ~1d 添加 `<channel_context>` 段（含 channel name + render mode + length limit + interaction style），hermes `PLATFORM_HINTS` 可直接移植。EvoClaw 独有渠道（企微、微信个人号、飞书）需自行编写。

---

### §3.14 渠道 / 群聊注入

**hermes** — 平台 hint 覆盖部分，无显式 peer info 段。

**EvoClaw**（`context/plugins/context-assembler.ts:79-82`）—— 群聊隐私隔离:

```typescript
// 群聊模式：跳过 USER.md 和 MEMORY.md（隐私隔离）
const groupExcluded = new Set(['USER.md', 'MEMORY.md']);
const priorityOrder = isGroupChat(ctx.sessionKey)
  ? fullOrder.filter(f => !groupExcluded.has(f))
  : fullOrder;
```

- `isGroupChat(sessionKey)`（`routing/session-key.ts`）从 session key 格式 `agent:<agentId>:<channel>:group:<groupId>` 判断
- 群聊时排除用户档案 + 记忆（防止隐私泄露到群内其他人面前）
- SAFETY_CONSTITUTION Red Line #7: "In group chats, never expose private conversation context"（`embedded-runner-prompt.ts:435`）

**无显式 `<channel>` peer info 段**：
- `grep -r "channel_context\|channelContext\|peerInfo\|peer_info" packages/core/src/agent` 零结果
- 群组 ID / 对端用户 ID / 渠道类型不在 system prompt 中显式化

**判定 🟡**：

- 群聊隐私隔离机制 EvoClaw **独有**（hermes 无 group chat 概念）
- 但**peer info 缺失**：模型不知道当前对话对端是谁（企业群里有多人时，可能混淆说话人身份）
- hermes 的 platform hint 覆盖了"交互风格"（cron 无人等待等），但也无 peer info

建议：P1 ~0.5d 添加 `<channel_peer>` 段（channel type + peer id/name + 是否群聊 + 当前说话人），与 USER.md 正交（USER.md 是用户档案，peer info 是会话当下）。

---

### §3.15 大内容外移 system-reminder

**hermes** — USER memory / MEMORY 在 system prompt 第 ⑧ 层:

```python
# run_agent.py:2770-2784
if self._memory_store:
    if self._memory_enabled:
        mem_block = self._memory_store.format_for_system_prompt("memory")
        if mem_block: prompt_parts.append(mem_block)
    if self._user_profile_enabled:
        user_block = self._memory_store.format_for_system_prompt("user")
        if user_block: prompt_parts.append(user_block)
```

- 每次 system prompt 重建都重载 memory/user
- `_invalidate_system_prompt()`（L2997-3006）压缩后同时 `self._memory_store.load_from_disk()` 强制重读
- 问题：memory/user 每天都在变 → 高 cache 击穿率

**EvoClaw**（`embedded-runner-prompt.ts:397-412` + `embedded-runner-attempt.ts:246-254`）—— 外移到首条 user message:

```typescript
// embedded-runner-prompt.ts:397-412
export function buildUserContextReminder(files: Record<string, string>): string | null {
  const parts: string[] = [];
  if (files['USER.md']) parts.push(`# userProfile\n${files['USER.md']}`);
  if (files['MEMORY.md']) parts.push(`# agentNotes\n${files['MEMORY.md']}`);
  parts.push(`# currentDate\nToday's date is ${new Date().toISOString().slice(0, 10)}.`);
  if (parts.length <= 1) return null;
  return `<system-reminder>\n${parts.join('\n\n')}\n\nIMPORTANT: this context may or may not be relevant to your tasks.\n</system-reminder>`;
}

// embedded-runner-attempt.ts:246-254（注入到首条 user message 前）
const contextReminder = buildUserContextReminder(config.workspaceFiles ?? {});
if (contextReminder && kernelMessages.length > 0 && kernelMessages[0].role === 'user') {
  const first = kernelMessages[0];
  const firstText = first.content.find(b => b.type === 'text');
  if (firstText && firstText.type === 'text') {
    (firstText as { text: string }).text = contextReminder + '\n' + firstText.text;
  }
}
```

- 把易变大内容（USER.md / MEMORY.md / 当前日期）从 system prompt 移到**首条 user message 前缀**
- `<system-reminder>` 块 + "IMPORTANT: this context may or may not be relevant" 末尾提示
- **注释明确**（`embedded-runner-prompt.ts:389-395`）: "将 USER.md/MEMORY.md 等大内容从 system prompt 移至用户消息，避免破坏 system prompt 的 Prompt Cache 命中率。参考 Claude Code utils/api.ts::prependUserContext() 的 <system-reminder> 模式"

**判定 🟢 反超**：

1. **Cache-aware 决策**：显式识别 USER/MEMORY 是**易变内容**，移出 system prompt 保护 cache
2. **现代做法**：参考 Claude Code `prependUserContext` 模式（比 hermes 的 memory block 更现代）
3. **日期每轮刷新**：currentDate 每轮变化不触发 system cache 击穿
4. **IMPORTANT 末尾降噪**：明确告诉模型"这段可能不相关"，防止模型过度解读提醒内容
5. **防注入标记**（CLAUDE.md 注意事项）: "反馈循环防护: 零宽空格标记防止注入记忆被重复存储" — 此处注入的 MEMORY.md 在后续轮次不会被 memory extractor 误识别为新记忆

hermes 的 memory block 每次 system prompt 重建都重载，压缩后 `_invalidate_system_prompt()` 必同步刷新，cache 击穿代价高。EvoClaw 的外移策略让 system prompt 相对稳定，符合"AGENTS.md:339-347 硬约束"的精神（虽然 hermes 自己未这样做）。

---

### §3.16 动态注入通道（@引用 / 子目录 hint）

**hermes**（`.research/07-prompt-system.md §3.5` + `§3.6`）—— 两条通道:

**通道 1：`@filename` 引用展开**（`agent/context_references.py:16-36`）

```python
REFERENCE_PATTERN = re.compile(
    r"(?<![\w/])@(?:(?P<simple>diff|staged)\b|(?P<kind>file|folder|git|url):(?P<value>\S+))"
)
# 支持：@diff / @staged / @file:path / @file:path:10-20 / @folder:path / @git:v1.2.3 / @url:https://...
# 敏感黑名单：.ssh / .aws / .gnupg / .kube / .docker / .azure / .config/gh / .netrc / .pgpass / .npmrc
# 展开时机：用户消息预处理（preprocess_context_references_async()）
# 展开为 user message 的一部分 — 不是 system prompt
```

**通道 2：子目录 hints 动态发现**（`agent/subdirectory_hints.py:48-224`）

```python
class SubdirectoryHintTracker:
    _HINT_FILENAMES = ["AGENTS.md", "agents.md", "CLAUDE.md", "claude.md", ".cursorrules"]
    _MAX_HINT_CHARS = 8_000
    _MAX_ANCESTOR_WALK = 5
    def check_tool_call(self, tool_name, tool_args) -> Optional[str]:
        dirs = self._extract_directories(tool_name, tool_args)
        # 工具参数里的 path/file_path/workdir → 提取目录
        # terminal 工具 → shlex 解析 command
        # 向上最多 5 层祖先目录找 AGENTS.md/.cursorrules
        # 每个目录只加载一次（_loaded_dirs set）
        # 追加到 tool result（不重建 system prompt！）
```

- 核心设计：**动态内容追加到 tool result**，**绝不重建 system prompt**（AGENTS.md:339-347）

**EvoClaw** — **两条通道均无对应**:

- `grep -rn "@file:\|@folder:\|@git:\|@url:\|@diff\|@staged" packages/core/src` 零结果
- `grep -rn "SubdirectoryHint\|subdirectory_hint\|HintTracker" packages/core/src` 零结果
- `grep -rn ".cursorrules\|HINT_FILENAMES" packages/core/src` 零结果
- 唯一相关：`infrastructure/system-events.ts` 的 per-session 事件队列（drain 后注入 user message 前缀，见 CLAUDE.md "System Events: 内存 per-session 事件队列"）— 但机制完全不同（事件驱动，非用户主动 @ / 非工具调用触发）

**判定 🔴 缺失**：两条通道都是 hermes 的**实用功能**:

- `@filename` 引用让用户在消息里直接引用代码/URL/git diff，降低交互摩擦（面向开发者场景）
- SubdirectoryHints 让 agent 在访问不同目录时自动获取该目录的项目规则（面向多项目代码场景）

**对 EvoClaw 的权衡**：

- EvoClaw 面向**企业非开发者用户**（CLAUDE.md 反馈循环："EvoClaw 不需要 Git 注入，面向非程序员企业用户"），`@diff` / `@staged` / `@git:` 几乎无使用场景
- `@file:` / `@url:` 对企业用户可能**仍有价值**（"帮我看看这个 URL / 这个文件"）
- SubdirectoryHints 对企业场景**无明显价值**（企业 Agent 不做跨项目代码开发）

建议：
- P2：`@url:` 支持（~0.5d，等价于已有 web_fetch 工具但更符合人类直觉）
- 不建议做：`@diff` / `@staged` / `@git:` / SubdirectoryHints（与 EvoClaw 目标用户不匹配）

---

## 4. 建议改造蓝图（不承诺实施）

### P0（高 ROI，建议尽快）

| # | 项目 | 对应差距 | 工作量 | ROI | 价值 |
|---|---|---|---|---|---|
| 1 | `sanitizeApiMessages()` — role 白名单 + orphaned tool 清理 + stub 注入 | §3.11 | 0.5d | 🔥🔥🔥 | 压缩后 API 拒绝风险防护；未来内部 role 扩展前置保护 |
| 2 | SOUL.md 运行时 prompt injection 扫描（`_scan_context_content` 等价） | §3.3 | 0.5d | 🔥🔥 | 防止用户 SOUL.md 被恶意注入"ignore all previous instructions" |

### P1（中等 ROI）

| # | 项目 | 对应差距 | 工作量 | ROI | 价值 |
|---|---|---|---|---|---|
| 3 | Standing Orders 结构化解析 + `<standing_orders>` 独立 block | §3.9 | 1-2d | 🔥🔥 | 兑现 CLAUDE.md 承诺，Heartbeat/Cron trigger 过滤可实装 |
| 4 | `<channel_context>` 段（含 channel type + render mode + 长度限制 + interaction style） | §3.13 | 1d | 🔥🔥 | 模型主动适配渠道输出格式，比 Channel 层被动转换更稳健 |
| 5 | `<channel_peer>` 段（群聊对端信息） | §3.14 | 0.5d | 🔥 | 企业群聊场景说话人清晰 |
| 6 | 模型特定指令段（类似 hermes TOOL_USE_ENFORCEMENT / OpenAI EXECUTION_GUIDANCE） | §3.2 | 1-2d | 🔥🔥 | 国产模型（GLM/Qwen）工具调用准确率提升 |
| 7 | PromptBuildMode 扩展 Gateway 模式（无 UI 交互场景） | §3.12 | 0.5d | 🔥 | 未来接入飞书/企微 Gateway 时 prompt 自动裁剪 |

### P2（长期规划）

| # | 项目 | 对应差距 | 工作量 |
|---|---|---|---|
| 8 | `@url:` / `@file:` 引用展开支持 | §3.16 | 1d |
| 9 | 多品牌（EvoClaw/HealthClaw）prompt 变体 | §3.12 | 1d |
| 10 | Few-shot 引导示例段（未实施） | 本章未覆盖 | 2d |

### 不建议做

| # | 项目 | 理由 |
|---|---|---|
| — | 引入 `@diff` / `@staged` / `@git:` 引用 | EvoClaw 面向企业非开发者用户，Git 场景无需求 |
| — | SubdirectoryHints 动态发现 | 企业 Agent 非跨项目代码开发场景 |
| — | SOUL.md 单文件化（移除 9 文件矩阵） | EvoClaw 9 文件架构对企业场景（SOUL/IDENTITY/USER/MEMORY 分离）更合理，不应回退 |

---

## 5. EvoClaw 反超点汇总

| # | 反超项 | 证据位置 | hermes 对应 |
|---|---|---|---|
| 1 | `SystemPromptBlock[]` 声明式 + cache_control scope 三级（global/org/null） | `embedded-runner-prompt.ts:137-340` + `kernel/types.ts:378-393` + `stream-client.ts:274-285` | 字符串拼接 + message-level 4 断点 (`prompt_caching.py`) |
| 2 | `SAFETY_CONSTITUTION` 独立常量 + 5 核心原则 + 7 Red Lines + scope='global' 跨用户缓存 | `embedded-runner-prompt.ts:420-436` | Safety 指令散布在 SOUL.md / 各 GUIDANCE 内，无独立安全段 |
| 3 | 记忆召回三层指令（7 条指令 + 6 类意图表 + 新鲜度规则） | `embedded-runner-prompt.ts:160-196` | MEMORY_GUIDANCE 4 行粗粒度 (`prompt_builder.py:144-156`) |
| 4 | Skill 渐进式两级注入（Tier 1 XML 目录 + Tier 2 invoke_skill 工具 + bundled 预算豁免） | `context/plugins/tool-registry.ts:288-360` + `skill/skill-tool.ts:60-95` | 单次 user message 注入（`skill_commands.py:121-197`），无两级 |
| 5 | 9 文件工作区加载矩阵（SOUL/IDENTITY/AGENTS/TOOLS/HEARTBEAT/USER/MEMORY/BOOT/BOOTSTRAP） | `context/plugins/context-assembler.ts:17-26` | 单一 SOUL.md (`prompt_builder.py:838-863`) |
| 6 | PromptBuildMode 三分（interactive/autonomous/fork） + 5 级 PromptOverride 优先级链 | `embedded-runner-prompt.ts:28` + `prompt-override.ts:38-92` | `skip_context_files` 单 gate |
| 7 | USER.md/MEMORY.md 外移 `<system-reminder>` 首条用户消息前缀，保护 system prompt cache | `embedded-runner-prompt.ts:397-412` + `embedded-runner-attempt.ts:246-254` | Memory block 在 system prompt 第 ⑧ 层，压缩后必同步重载 |
| 8 | `<available_tools>` XML + 29 工具 TOOL_SUMMARIES + 优先级排序 | `embedded-runner-prompt.ts:38-98` | 三类别 tool guidance `" "` join 成单 prompt_part |
| 9 | PromptCacheMonitor + Latch 锁存 + 断裂根因分析 | `kernel/prompt-cache-monitor.ts:43-80` | 无 cache 监测，仅 `_cached_system_prompt` 缓存 |
| 10 | 群聊模式 USER.md/MEMORY.md 隐私隔离 + SAFETY Red Line #7 | `context/plugins/context-assembler.ts:79-82` + `embedded-runner-prompt.ts:435` | 无 group chat 概念 |

---

## 6. 附录：引用验证

### 6.1 EvoClaw 代码引用抽样（本章所有 `path:line` 均经 Read 工具验证 2026-04-16）

- `packages/core/src/agent/embedded-runner-prompt.ts:28` ✅ `PromptBuildMode = 'interactive' | 'autonomous' | 'fork'`
- `embedded-runner-prompt.ts:38-67` ✅ TOOL_SUMMARIES（29 工具中文 summary）
- `embedded-runner-prompt.ts:83-98` ✅ `buildToolCatalog()` → `<available_tools>` XML
- `embedded-runner-prompt.ts:104-122` ✅ BOOTSTRAP_MAX_CHARS_PER_FILE=20_000 / TOTAL_MAX=150_000
- `embedded-runner-prompt.ts:137-340` ✅ `buildSystemPromptBlocks()` 主函数
- `embedded-runner-prompt.ts:153-157` ✅ SAFETY_CONSTITUTION 注入（scope: 'global'）
- `embedded-runner-prompt.ts:160-196` ✅ `<memory_recall>` 7 指令 + 6 意图表 + 新鲜度
- `embedded-runner-prompt.ts:199-238` ✅ tool_call_style（interactive 模式）
- `embedded-runner-prompt.ts:264-274` ✅ SOUL.md / IDENTITY.md / AGENTS.md 分别注入为 personality / identity / operating_procedures（scope: 'org'）
- `embedded-runner-prompt.ts:279-299` ✅ runtime info 8 字段
- `embedded-runner-prompt.ts:353-387` ✅ `buildForkPromptBlocks()` fork 极简模式
- `embedded-runner-prompt.ts:397-412` ✅ `buildUserContextReminder()` 外移 USER/MEMORY → `<system-reminder>`
- `embedded-runner-prompt.ts:420-436` ✅ SAFETY_CONSTITUTION 常量（7 Red Lines）
- `packages/core/src/agent/prompt-override.ts:23-92` ✅ 5 级优先级链 + `resolvePromptOverrides()`
- `packages/core/src/agent/kernel/types.ts:378-398` ✅ `CacheScope` / `SystemPromptBlock` / `systemPromptBlocksToString`
- `packages/core/src/agent/kernel/stream-client.ts:270-285` ✅ Anthropic `cache_control` + scope 序列化
- `packages/core/src/agent/kernel/stream-client.ts:329` ✅ OpenAI 路径 `systemPromptBlocksToString` 合并
- `packages/core/src/context/plugins/context-assembler.ts:17-26` ✅ FILE_LOAD_MATRIX（9 文件 bootstrap/beforeTurn 矩阵）
- `context/plugins/context-assembler.ts:79-82` ✅ 群聊排除 USER.md/MEMORY.md
- `packages/core/src/context/plugins/tool-registry.ts:288-360` ✅ `buildSkillsPrompt()` Tier 1 XML + bundled 豁免
- `packages/core/src/skill/skill-tool.ts:60-95` ✅ `invoke_skill` 工具（Tier 2 按需加载）
- `packages/core/src/agent/kernel/prompt-cache-monitor.ts:43-80` ✅ PromptCacheMonitor + Latch 锁存
- `packages/core/src/agent/embedded-runner-attempt.ts:169-179` ✅ `buildSystemPrompt` + `resolvePromptOverrides` 集成
- `packages/core/src/agent/embedded-runner-attempt.ts:246-254` ✅ `buildUserContextReminder` 注入首条 user message
- `packages/core/src/agent/agent-manager.ts:420` ✅ DEFAULT_AGENTS_MD 中 `## Standing Orders` 章节（模板注释）
- `packages/core/src/infrastructure/system-events.ts:22-50` ✅ SystemEvent 结构 + per-session 队列
- `packages/core/src/__tests__/safety-prefix.test.ts:95-111` ✅ parent/fork 子 Agent 共享 SAFETY_CONSTITUTION 前缀测试

**零结果 grep 证据**（说明 EvoClaw 未实装）:

- `grep -rn "standing_orders\|standingOrders\|StandingOrder" packages/core/src` → 仅 `agent-manager.ts:420`（AGENTS.md 模板字符串）
- `grep -rn "PLATFORM_HINTS\|platformHints\|channel.*hint" packages/core/src/agent` → 零结果
- `grep -rn "channel_context\|channelContext\|peerInfo\|peer_info" packages/core/src/agent` → 零结果
- `grep -rn "_VALID_API_ROLES\|validApiRoles\|sanitizeApiMessages" packages/core/src` → 零结果
- `grep -rn "@file:\|@folder:\|@git:\|@url:\|@diff\|@staged" packages/core/src` → 零结果
- `grep -rn "SubdirectoryHint\|_HINT_FILENAMES\|\.cursorrules" packages/core/src` → 零结果
- `grep -rn "scanContextContent\|_scan_context\|prompt.injection.scan" packages/core/src` → 零结果

### 6.2 hermes 研究引用（章节 §）

- `.research/07-prompt-system.md §1` — 三核心约束（多层组装 / 可定制人格 / 禁止打破 cache）
- `.research/07-prompt-system.md §2` — 13 段拼接顺序 + 源码 7 layers 映射
- `.research/07-prompt-system.md §3.1` — `_build_system_prompt` 入口（run_agent.py:2677-2836）
- `.research/07-prompt-system.md §3.2` — SOUL.md 加载 + 三层安全（prompt_builder.py:838-863 + hermes_cli/default_soul.py:3-11）
- `.research/07-prompt-system.md §3.3` — `prompt_caching.py` 4 断点策略
- `.research/07-prompt-system.md §3.4` — `_sanitize_api_messages` 4 步消毒（run_agent.py:2851-2919）
- `.research/07-prompt-system.md §3.5` — `context_references.py` `@filename` 引用 + 敏感黑名单
- `.research/07-prompt-system.md §3.6` — `SubdirectoryHintTracker` 动态发现
- `.research/07-prompt-system.md §3.7` — `PLATFORM_HINTS` 9 平台
- `.research/07-prompt-system.md §3.8` — AGENTS.md:339-347 硬约束 + 2 处 invalidate 点（L1398 + L3004）
- `.research/07-prompt-system.md §3.9` — `skill_commands.py` `/skill-name` user message 注入
- `.research/07-prompt-system.md §3.10` — 所有 prompt 文案常量真实名称（DEFAULT_AGENT_IDENTITY / MEMORY_GUIDANCE / TOOL_USE_ENFORCEMENT_GUIDANCE / GOOGLE_MODEL_OPERATIONAL_GUIDANCE / OPENAI_MODEL_EXECUTION_GUIDANCE / PLATFORM_HINTS 等）

### 6.3 关联差距章节（crosslink）

- [`04-core-abstractions-gap.md`](./04-core-abstractions-gap.md) — SystemPromptBlock / CacheScope / KernelMessage 类型层抽象差异
- [`05-agent-loop-gap.md`](./05-agent-loop-gap.md) §3.12 — PromptCacheMonitor + cacheBreakpointIndex（反超点）
- [`06-llm-providers-gap.md`](./06-llm-providers-gap.md) §3.8 — buildAnthropicRequest / buildOpenAIRequest 双协议清晰（反超点）
- [`08-context-compression-gap.md`](./08-context-compression-gap.md) — 压缩后 system prompt 重建时机（EvoClaw 三层压缩 vs hermes `_invalidate_system_prompt`）
- [`10-toolsets-gap.md`](./10-toolsets-gap.md) — `<available_tools>` 工具清单注入机制
- [`12-skills-system-gap.md`](./12-skills-system-gap.md) — Tier 1/Tier 2 Skill 渐进注入 + 5 source 统一（反超点）
- [`14-state-sessions-gap.md`](./14-state-sessions-gap.md)（待写）— Session Key 路由 / 群聊隔离与 `<system-reminder>` 外移的关联
- [`15-memory-providers-gap.md`](./15-memory-providers-gap.md)（待写）— L0/L1/L2 三层记忆如何渲染到 MEMORY.md + `<memory_recall>` 指令

---

**本章完成**。Prompt 系统对比：**EvoClaw 在 cache_control scope 三级 / Skill 两级注入 / 记忆召回指令 / SAFETY 独立常量 / USER/MEMORY 外移 / PromptOverride 5 级链 / PromptBuildMode 三分 / 9 文件工作区矩阵 / PromptCacheMonitor 九项反超**；hermes 在 **`_sanitize_api_messages` 孤立 tool 修复 / SOUL 运行时安全扫描 / `@filename` 引用 / SubdirectoryHints / 模型特定指令段（OpenAI EXECUTION_GUIDANCE 6 XML 块）/ 9 平台 hints 六项领先**。Standing Orders 是 EvoClaw CLAUDE.md **未兑现的声明**（🔴 缺失），建议 P1 实装或修正文案。
