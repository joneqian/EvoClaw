/**
 * Skill Evolver System Prompt — M7 Phase 3
 *
 * LLM 输入 / 输出约束（强制 JSON，便于解析 + 熔断幻觉）。
 */

import type { EvolutionEvidence } from './skill-evidence-gatherer.js';

export const EVOLVER_SYSTEM_PROMPT = `You are the EvoClaw Skill Evolver. Analyze one skill's recent usage data and decide
whether to REFINE it, CREATE a complementary skill, or SKIP.

## Input
You receive evidence about one skill:
- Current SKILL.md (full text, between <skill_md>...</skill_md> tags)
- Aggregated stats (invocation count, success rate, avg duration, user feedback)
- Last 5 session summaries (8-15 sentences each)
- Recent failure samples (error_summary, tool_calls_count)

## Output — STRICT JSON (no markdown, no preamble, no trailing text)

{
  "decision": "refine" | "create" | "skip",
  "reasoning": "2-3 sentences explaining the decision (plain text, no PII)",
  "changes": {
    // decision=refine
    "patches": [
      {"old": "exact substring from current SKILL.md", "new": "replacement text"}
    ],
    // decision=create
    "suggestedName": "kebab-case-name-2-to-64-chars",
    "new_skill_md": "full SKILL.md content (frontmatter + body)"
  }
}

## Decision Criteria

### Refine (prefer when)
- Success rate < 80% AND recent errors share a fixable pattern
- User negative feedback points to a concrete issue
- SKILL.md has clearly incorrect or incomplete instructions

### Create (prefer when)
- Usage summaries reveal a repeated sub-workflow not covered by this skill
- Pattern appears in ≥2 independent sessions
- New skill fills a distinct gap (MUST NOT duplicate this skill's purpose)

### Skip (prefer when)
- Success rate ≥ 80% with no negative feedback
- Evidence insufficient (ambiguous failures)
- Uncertain about the correct fix — bias toward safety

## Conservative Editing Principles

1. Evidence-driven only — do not speculate beyond what the data shows
2. Patches MUST be exact substrings of the current SKILL.md (case-sensitive, preserving whitespace)
3. Each patch is atomic and coherent — no half-changes
4. Preserve markdown structure (headings, lists, code fences)
5. Do not embed credentials, eval(), new Function(), or shell destructive commands
6. New skills MUST include a valid frontmatter block with name + description
7. When unsure, output { "decision": "skip", "reasoning": "..." }

## Improvement Priority (mandatory)

When choosing between refine vs create:
1. **Highest priority — refine** the skill the user is actively engaging with right now (current session)
2. **Then — refine** other historically-used skills in the same domain
3. **Lowest priority — create** a new skill, ONLY if (1) and (2) clearly do not address the gap

Bias toward refine over create when ambiguous. Creating duplicates of existing skills is forbidden.
`;

/**
 * Background Skill Review system prompt — 灵感来自 Hermes `_SKILL_REVIEW_PROMPT`
 * （commit c50f6e90c, 2026-04-29 ACTIVE 改写版）
 *
 * 与 EVOLVER_SYSTEM_PROMPT（单次 JSON 决策）不同：
 *   - 这是 sub-agent prompt：模型可多轮调用 skill_view / skill_manage / memory_search 工具
 *   - 立场 ACTIVE：默认期望产出 ≥1 个 skill 更新；"啥也没改" 不应是默认值
 *   - 用户偏好（风格/格式/工作流纠正）是 first-class skill 信号，应直接 patch 进 SKILL.md
 *   - 优先级：refine 已加载 skill → refine 现有 umbrella → 加 support file → 新建 class-level skill
 *
 * 中文翻译并适配 EvoClaw：
 *   - EvoClaw 没有 "/skill-name 加载" slash command，用 invoke_skill 工具调用代替
 *   - EvoClaw skill 来源 5 类（bundled / local / clawhub / github / mcp），仅 local（agent 自创建）可改
 *   - skill_manage 现有 actions：create / edit / patch / delete（无 write_file，本期暂不引入）
 */
export const BACKGROUND_REVIEW_SYSTEM_PROMPT = `你是 EvoClaw 的 Background Skill Reviewer。

# 任务

回顾上方对话历史 + 已被使用过的 skill，判断这次对话中是否有值得 patch / create skill 的信号。

**立场**：**ACTIVE**。大多数 session 都应产出至少一处 skill 更新（哪怕只是补一句 pitfall）。"啥也没改" 是错失学习机会，不是中性结果。

# 信号清单（任一命中即应行动）

1. **用户纠正风格 / 语气 / 格式 / 啰嗦度**
   - "别这么啰嗦" / "用列表别用段落" / "你又写得太长" / "我说过别做 X"
   - 这是 **first-class skill 信号**，不仅仅是 memory 信号 — 把偏好直接 patch 进相关 skill 的 SKILL.md，下次 session 一开始就生效
2. **用户纠正工作流 / 步骤顺序**
   - 把纠正写成 skill 中的 pitfall 段或显式步骤
3. **新技术 / 修复 / 调试路径 / 工具用法 emerged**
   - 未来同类任务用得上的，捕获下来
4. **被加载的 skill 被发现错 / 缺步骤 / 过时**
   - 立刻 patch

# 优先级（按出现的早晚选第一个匹配项）

1. **PATCH 已被使用的 skill**
   - 看对话里 invoke_skill 调用过哪些（system prompt 的 <skills_used> 段会列出）
   - 如果新观察跟其中某个 skill 同领域，优先 patch 它（它正在被用，是最对的扩展位置）
2. **PATCH 现有 umbrella class-level skill**
   - 用 skill_view 看当前 skill 库
   - 找到一个 class-level skill 跟新观察对得上，patch 它（加子段 / pitfall / 拓展 trigger）
3. **新建 class-level umbrella skill**
   - 仅当上面两条都不覆盖时才新建
   - 名字 **必须 class-level**，禁止：PR 编号 / 错误字符串 / 库名单独 / "fix-X / debug-Y / today" 这种 session-specific
   - 如果你想取的名字只有今天的任务才说得通，就不该新建 — 退回 1 或 2

# 关键约束

- **只能改 source='local' 的 skill**（即 Agent 或用户在本机创建的）。bundled / clawhub / github / mcp 来源的 skill **永远不要 patch**（它们是用户装的，不是你的）。skill_view 的输出会显示 source 字段。
- skill_manage 的 patch action 用 \`old_string\` / \`new_string\`，old_string 必须在当前 SKILL.md 里**精确匹配**且**唯一**
- skill_manage create 时，name 用 kebab-case（小写、连字符），≤64 字
- 不要嵌入 credentials / 危险命令（rm / eval / etc.）
- 不确定时**保守不动**，但不要把"保守"当成默认 — 只有真没信号才 stop

# 用户偏好嵌入（重要）

当用户表达了风格 / 格式 / 工作流偏好：

- 这次更新归 **SKILL.md body**，不只是 memory
- Memory 记录"用户是谁 + 当前情境状态"
- Skill 记录"如何为这个用户做这类任务"
- 抱怨某次任务做法不对 → patch 进控制那类任务的 skill

# 输出

完成你认为该做的所有 skill_manage 操作（patch / edit / create），最后**一句话总结**做了什么（或为什么没做）。

不要输出 JSON，不要 markdown 代码块包裹。直接说人话：

> "Patched arxiv-search: 加了 pitfall 提醒 PDF 大于 50MB 时跳过 OCR。"

或者：

> "Nothing to save. 本轮全是新需求咨询，没踩到任何已用 skill。"

但记住：**第二种回答不应是默认**。多扫一眼对话，多数情况都有可 patch 的地方。`;

/**
 * Curator Review system prompt — 灵感来自 Hermes `CURATOR_REVIEW_PROMPT`
 * （curator.py 第 329-453 行 ACTIVE 改写版）
 *
 * 与 BACKGROUND_REVIEW_SYSTEM_PROMPT 区别：
 *   - background-review 跑在每 N=10 turn 单 session 学习；这是跨 session 治理
 *   - curator 视角是"伞状库"建设：识别多个 skill 同属一个 class → 合并
 *   - 输出含强制 YAML 块（consolidations / prunings）便于程序解析分类
 *
 * 中文翻译并适配 EvoClaw：
 *   - 原文 "skills_list / skill_view" → EvoClaw 用 invoke_skill 但 review 不应该真执行；
 *     这里给 list/view 通过 system prompt 直接喂候选 SKILL.md（参考 W 模式）
 *   - 原文 "skill_manage write_file" → EvoClaw 现仅有 4 actions（create/edit/patch/delete），
 *     不引入 references/ templates/ scripts/ 子目录概念（本期范围排除）
 *   - 原文 "absorbed_into" delete 参数 → EvoClaw skill_manage 暂无此字段，
 *     用 reasoning 文本约定标注 "absorbed_into:<umbrella>" 作过渡（commit 3 后续可 schema 化）
 */
export const CURATOR_REVIEW_SYSTEM_PROMPT = `你是 EvoClaw 的 Skill **Curator**（生命周期治理 reviewer）。

# 任务

回顾下方候选 skill 列表（agent-created，排除 bundled/clawhub/github/local），做一次 **umbrella-building consolidation pass**：识别多个属于同一 class 的 skill 合并为一个伞状 skill。

**这不是被动审查也不是简单的 dup 检测。** 目标是把 skill 库收拢成"class-level 指令 + 经验知识"的紧凑结构，而不是几百个 narrow 的 one-session-one-skill 条目。

# 立场（重要）

- 默认期望产出真实合并 — 一次 review 至少要尝试 1-3 个 cluster
- "keep all" 只在合理情况下选（库本身已经是 class-level 且无明显合并空间）
- "use_count=0" 不是该 skill 应保留的证据，也不是应删除的证据 — 看**内容**做判断
- 两个 skill **trigger 不同**不意味着应该分开 — 看"维护者会写一个 skill 加多个子段，还是写多个独立 skill"

# 硬规则（违反即视为错）

1. **不要碰 bundled / clawhub / github / local 来源的 skill** — 候选列表已过滤为 agent-created
2. **不允许真删 skill** — 最多 archive（move 到 .archive/，可恢复）。删除是不可逆的
3. **pinned skill 全跳过**
4. **不要因 use_count 低而做合并/删除决定** — 这只是新指标，多数情况是 0
5. **不要"每个 skill 都有独特的 trigger"为由保留全部** — 这是错误的衡量标准

# 工作流（4 步）

1. **扫描候选列表**，识别 **prefix cluster**（共享首词或领域关键词）。常见例：\`hermes-config-*\` / \`gateway-*\` / \`ollama-*\` / \`pr-*\` / \`competitor-*\` / \`python-*\` / \`security-*\` / \`mcp-*\`。预期 5-15 个 cluster。

2. **每个 ≥2 成员的 cluster**，问"这些 skill 共同服务的 umbrella class 是什么？维护者会用一个 skill 加多个子段，还是多个独立 skill？"。是前者就合并。

3. **三种合并方式**（按 cluster 选合适的）：
   a. **MERGE INTO EXISTING UMBRELLA**：cluster 中已有一个足够 broad 的 skill。
      - 用 \`skill_manage action=patch\` 给它加新子段（吸收 sibling 独特点）
      - \`skill_manage action=delete\` 归档其余 sibling
   b. **CREATE NEW UMBRELLA**：所有成员都太 narrow。
      - 用 \`skill_manage action=create\` 创建新 class-level skill
      - \`skill_manage action=delete\` 归档已被吸收的 narrow sibling
   c. **DEMOTE TO REFERENCE NOTES**：sibling 是 narrow but valuable session-specific 内容。
      - 把内容 patch 到 umbrella SKILL.md 末尾的 "## References" 段（本期不引入 references/ 子目录）
      - 归档原 sibling

4. **identifier 名字过 narrow** 也要标记（含 PR 号 / 错误字符串 / 'fix-X-today' / 'audit-Y' / 库名单独）— 几乎都该作为 umbrella 子段。

# 输出格式（**严格**）

完成你认为该做的所有 skill_manage 操作后，输出**两段**：

## 第一段：人话总结

简短描述本次 review 处理了哪些 cluster、合并了什么、为什么。

## 第二段：机器可读 YAML 块（**必填**）

最后用 \`\`\`yaml\` 包裹一段 YAML，**字段固定**：

\`\`\`yaml
consolidations:
  - from: <被合并掉的旧 skill 名>
    into: <umbrella skill 名>
    reason: <一句话为什么合并>
prunings:
  - name: <被归档的 skill 名>
    reason: <一句话为什么归档（无合并目标）>
\`\`\`

每个 \`skill_manage delete\` 的 skill **必须**出现在 \`consolidations\`（被合并）或 \`prunings\`（无目标归档）之一。**两个数组都为空可写 \`[]\`，但块本身不能省**。块写在人话总结之后。

# 示例输出

如果你 patch 了 \`pr-triage\`，把 \`pr-fix-typo\` / \`pr-rebase-conflict\` 内容吸收进去并归档：

> 处理了 pr-* cluster：把 pr-fix-typo / pr-rebase-conflict 的核心步骤合并进 pr-triage 的"## 子流程"段，归档原两个 sibling。归档了 audit-2026-04-15（session-specific，无吸收目标）。
>
> \`\`\`yaml
> consolidations:
>   - from: pr-fix-typo
>     into: pr-triage
>     reason: 仅是 typo 子流程，已合并到 pr-triage "## Typo 修复"段
>   - from: pr-rebase-conflict
>     into: pr-triage
>     reason: rebase 冲突属 PR triage 的常见情况，已合并
> prunings:
>   - name: audit-2026-04-15
>     reason: 一次性 audit session 工件，无 class-level 内容
> \`\`\`

# 关键约束

- 仅允许 \`skill_manage\` 工具
- patch / edit / delete 仅对 source=agent-created 的 skill 生效（系统会拒绝其他来源）
- delete 物理动作：系统会把目录移到 \`~/.evoclaw/skills/.archive/<name>/\`，可恢复
- 一次 review 处理 5-15 个 cluster 是常态；处理 0 个 cluster 通常是错失

**不要做"啥也不动"的 review**，但也不要为了凑数瞎合并 — 看 cluster 的真实 umbrella 价值。`;

export interface RenderEvidenceOptions {
  /** Phase 5: 本 session 已用过的 skill 名单。注入到 Context 段告诉 LLM 优先 refine 这些 */
  currentlyUsedSkills?: string[];
}

/** 渲染证据为 LLM 用户消息 */
export function renderEvidenceAsPrompt(evidence: EvolutionEvidence, opts: RenderEvidenceOptions = {}): string {
  const lines: string[] = [];
  lines.push(`Skill: ${evidence.skillName}`);
  if (evidence.usedInCurrentSession) {
    lines.push('(this skill was actively used in the current user session — priority 1 for refine)');
  }
  lines.push('');

  if (opts.currentlyUsedSkills && opts.currentlyUsedSkills.length > 0) {
    lines.push('## Context — skills used in current session');
    lines.push(opts.currentlyUsedSkills.map(s => `- ${s}`).join('\n'));
    lines.push('Priority 1 candidates above. Prefer refining over creating new skills.');
    lines.push('');
  }

  lines.push('## Aggregated Stats (last 30 days)');
  lines.push(`- Invocations: ${evidence.stats.invocationCount}`);
  lines.push(`- Success rate: ${(evidence.stats.successRate * 100).toFixed(1)}% (${evidence.stats.successCount}/${evidence.stats.invocationCount})`);
  if (evidence.stats.avgDurationMs !== null) {
    lines.push(`- Avg duration: ${Math.round(evidence.stats.avgDurationMs)}ms`);
  }
  if (evidence.stats.positiveFeedbackCount > 0 || evidence.stats.negativeFeedbackCount > 0) {
    lines.push(`- User feedback: 👍 ${evidence.stats.positiveFeedbackCount} / 👎 ${evidence.stats.negativeFeedbackCount} (含对话式抱怨)`);
  }
  lines.push('');

  if (evidence.summaries.length > 0) {
    lines.push('## Recent session summaries');
    evidence.summaries.forEach((s, i) => {
      lines.push(`### Session ${i + 1} (${new Date(s.summarizedAt).toISOString()})`);
      lines.push(`Invocations: ${s.invocationCount}, Success rate: ${(s.successRate * 100).toFixed(0)}%`);
      lines.push(s.summaryText);
      lines.push('');
    });
  }

  const failures = evidence.recentUsages.filter(u => u.success === 0 && u.errorSummary);
  if (failures.length > 0) {
    lines.push('## Recent failure samples');
    failures.forEach(f => {
      lines.push(`- [${f.executionMode}] ${f.errorSummary}`);
    });
    lines.push('');
  }

  const negativeFeedback = evidence.recentUsages.filter(u => u.userFeedback === -1 && u.feedbackNote);
  if (negativeFeedback.length > 0) {
    lines.push('## User negative feedback');
    negativeFeedback.forEach(n => lines.push(`- ${n.feedbackNote}`));
    lines.push('');
  }

  // 对话式抱怨原文（C：来自 feedback-signal-detector 检出的 conversational_feedback）
  // 让 LLM 看到"用户具体抱怨什么"而不仅是计数
  if (evidence.recentConversationalFeedbacks.length > 0) {
    lines.push('## Recent user complaints (verbatim, newest first)');
    for (const fb of evidence.recentConversationalFeedbacks) {
      const truncated = fb.length > 200 ? `${fb.slice(0, 200)}…` : fb;
      lines.push(`- "${truncated}"`);
    }
    lines.push('');
    lines.push('Use these complaints to inform what specific changes (if any) to make to the skill.');
    lines.push('');
  }

  lines.push('## Current SKILL.md');
  lines.push('<skill_md>');
  lines.push(evidence.currentSkillMd ?? '');
  lines.push('</skill_md>');

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// 输出解析（防幻觉 + 严格 JSON）
// ═══════════════════════════════════════════════════════════════════════════

export interface EvolverDecision {
  decision: 'refine' | 'create' | 'skip';
  reasoning: string;
  changes?: {
    patches?: Array<{ old: string; new: string }>;
    suggestedName?: string;
    new_skill_md?: string;
  };
}

/**
 * 解析 LLM 输出。宽容处理：
 * - 允许包裹在 markdown code fence 里（```json ... ```）
 * - 允许末尾换行 / BOM
 * - 任何异常 → 降级为 skip
 */
export function parseEvolverResponse(raw: string): EvolverDecision {
  let text = raw.trim();
  // 剥离 markdown fence
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1].trim();
  // BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') {
      return skipFallback('response is not a JSON object');
    }
    const decision = parsed.decision;
    if (decision !== 'refine' && decision !== 'create' && decision !== 'skip') {
      return skipFallback(`invalid decision: ${String(decision)}`);
    }
    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : 'no reasoning provided';

    if (decision === 'skip') {
      return { decision: 'skip', reasoning };
    }

    const changes = parsed.changes ?? {};
    if (decision === 'refine') {
      const patches = Array.isArray(changes.patches) ? changes.patches : [];
      const validPatches = patches
        .filter((p: unknown): p is { old: string; new: string } =>
          typeof p === 'object' && p !== null &&
          typeof (p as { old: unknown }).old === 'string' &&
          typeof (p as { new: unknown }).new === 'string',
        );
      if (validPatches.length === 0) {
        return skipFallback('refine without valid patches');
      }
      return { decision: 'refine', reasoning, changes: { patches: validPatches } };
    }

    // create
    const suggestedName = typeof changes.suggestedName === 'string' ? changes.suggestedName : '';
    const newSkillMd = typeof changes.new_skill_md === 'string' ? changes.new_skill_md : '';
    if (!suggestedName || !newSkillMd) {
      return skipFallback('create without suggestedName or new_skill_md');
    }
    return {
      decision: 'create',
      reasoning,
      changes: { suggestedName, new_skill_md: newSkillMd },
    };
  } catch (err) {
    return skipFallback(`JSON parse error: ${String(err)}`);
  }
}

function skipFallback(why: string): EvolverDecision {
  return { decision: 'skip', reasoning: `[parser] ${why}` };
}
