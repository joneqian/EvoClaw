/**
 * P1-B Phase 1: 用户负反馈信号检测器
 *
 * 输入用户当前 turn 的消息文本 + 该 session 最近的 skill 调用记录，
 * 输出是否命中负反馈强信号 + 关联到的 skillName。
 *
 * 设计要点：
 * - 纯函数，无副作用，无 DB 访问 —— 调用方加载最近 usages 并落库
 * - 关键词模式高精度优先（宁可漏检，避免误改）
 * - 必须有最近窗口内（默认 5 min）的 skill 调用，否则信号无意义 → 'none'
 * - 多个候选 skill 时取最近一条（最相关）
 *
 * 不做：
 * - 不做"中"档信号（👎 + 错误信息）—— 那条路径走 skill_usage.user_feedback 已存在
 * - 不做语义嵌入分析 —— 信号检测必须低成本可解释
 */

/** 信号强度。strong = 立即触发 inline review；none = 不触发。 */
export type SignalStrength = 'strong' | 'none';

/** LLM 信号分类调用函数（沿用现有 secondary LLM 签名）*/
export type FeedbackLLMCallFn = (system: string, user: string) => Promise<string>;

export interface SignalDetectionInput {
  /** 用户消息原文 */
  userMessage: string;
  /** 最近 N 分钟内（默认 5min）该 session 的 skill 调用，按 invokedAt ASC/DESC 排都行 */
  recentSkillUsages: ReadonlyArray<{ skillName: string; invokedAt: string }>;
  /** 当前时间（注入便于测试），默认 new Date() */
  now?: Date;
  /** 关联窗口：当前消息前 N 分钟内的 invoke 算关联，默认 5 */
  windowMinutes?: number;
}

export interface SignalDetectionResult {
  signal: SignalStrength;
  /** 关联到的 skill（最近一条窗口内 invoke）。signal=none 时缺省 */
  skillName?: string;
  /** 命中的用户消息文本（截断 200 字，PII 已由调用方负责过滤）。signal=none 时缺省 */
  evidence?: string;
  /** 命中的模式 label，用于审计与调试。signal=none 时缺省 */
  matchedPattern?: string;
}

/** evidence 截断长度 */
const MAX_EVIDENCE_LEN = 200;

/** 默认关联窗口（分钟） */
const DEFAULT_WINDOW_MINUTES = 5;

/**
 * 中文强信号模式。
 * 设计：高精度优先，避免日常对话误判（如 "不要紧" / "继续这样做" 不应命中）。
 */
const ZH_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /不要这样|不要这么|别这样|别这么/, label: 'reject-this-way' },
  { pattern: /不要再|别再/, label: 'reject-repeat' },
  { pattern: /我说过|说过别|跟你说过/, label: 'told-you' },
  { pattern: /怎么又|你又/, label: 'you-again' },
  { pattern: /完全错|完全不对|搞砸|错离谱|不对劲/, label: 'completely-wrong' },
  { pattern: /不喜欢|讨厌/, label: 'dislike' },
];

/**
 * 英文强信号模式。
 * 用 \b 单词边界 + 显式短语避免命中 stopped/stopping/stop here 等中性用法。
 */
const EN_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\bstop\s+(doing|that|it)\b/i, label: 'stop-doing' },
  { pattern: /\bdon'?t\s+do\s+(that|this)\b/i, label: 'dont-do' },
  { pattern: /\bdo\s+not\s+do\s+that\b/i, label: 'do-not-do-that' },
  { pattern: /\bdon'?t\s+\w+\s+again\b/i, label: 'dont-again' },
  { pattern: /\bi\s+told\s+you\b/i, label: 'i-told-you' },
  { pattern: /\bi\s+hate\b/i, label: 'i-hate' },
  { pattern: /\byou\s+(always|keep)\s+(doing|getting|making)\b/i, label: 'you-keep' },
  { pattern: /\bwrong\s+again\b/i, label: 'wrong-again' },
  { pattern: /\bnot\s+like\s+that\b/i, label: 'not-like-that' },
];

/**
 * 检测当前用户消息是否为针对最近调用 skill 的负反馈强信号。
 */
export function detectFeedbackSignal(input: SignalDetectionInput): SignalDetectionResult {
  const text = input.userMessage.trim();
  if (!text) return { signal: 'none' };

  const matched = matchAny(text);
  if (!matched) return { signal: 'none' };

  const now = input.now ?? new Date();
  const windowMs = (input.windowMinutes ?? DEFAULT_WINDOW_MINUTES) * 60_000;
  const cutoff = now.getTime() - windowMs;

  const skillName = pickMostRecentInWindow(input.recentSkillUsages, cutoff);
  if (!skillName) return { signal: 'none' };

  return {
    signal: 'strong',
    skillName,
    evidence: text.slice(0, MAX_EVIDENCE_LEN),
    matchedPattern: matched.label,
  };
}

function matchAny(text: string): { label: string } | null {
  for (const { pattern, label } of ZH_PATTERNS) {
    if (pattern.test(text)) return { label };
  }
  for (const { pattern, label } of EN_PATTERNS) {
    if (pattern.test(text)) return { label };
  }
  return null;
}

function pickMostRecentInWindow(
  usages: ReadonlyArray<{ skillName: string; invokedAt: string }>,
  cutoffMs: number,
): string | undefined {
  let bestSkill: string | undefined;
  let bestTs = cutoffMs;
  for (const u of usages) {
    const ts = Date.parse(u.invokedAt);
    if (Number.isNaN(ts)) continue;
    if (ts >= bestTs) {
      bestTs = ts;
      bestSkill = u.skillName;
    }
  }
  return bestSkill;
}

// ─────────────────────────────────────────────────────────────────────
// LLM 二级分类（regex 漏检的兜底，灵感来自 Hermes background-review LLM 路线）
// ─────────────────────────────────────────────────────────────────────

export interface LLMSignalDetectionInput extends SignalDetectionInput {
  /** secondary LLM 调用函数（沿用 createSecondaryLLMCallFn 产物）*/
  llmCall: FeedbackLLMCallFn;
  /** 上一条 assistant 回复（可选，给 LLM 更多上下文判断"用户是否对这个回复不满"）*/
  lastAssistantMessage?: string;
  /** 单次 LLM 输出长度上限（防 prompt 超时），默认 200 char */
  maxResponseLen?: number;
}

const LLM_SYSTEM_PROMPT = `你是一个用户反馈信号分类器。

任务：判断用户当前消息**是否在表达对刚刚使用过的 skill 不满意**（包括：明确抱怨、暗示纠正、反话讽刺、要求重做、表达困惑、行为信号如重复发指令）。

输出**严格 JSON**（不要 markdown 包裹）：
{
  "negative": true | false,
  "skillName": "如果有不满针对哪个 skill 名（取自 recentSkills 列表），无关时填 \"\"",
  "reason": "≤30 字解释为什么判断为是/否（中文）"
}

判断准则：
- 用户**显式抱怨**（"完全不对" / "stop doing X" / "再来" / "不喜欢这样"）→ true
- 用户**反话/讽刺**（"行行行你最对" / "厉害厉害"）→ true
- 用户**要求改输出风格**（"短一点" / "别这么啰嗦" / "用列表"）→ true
- 用户**纠正具体内容**（"这个数据错了" / "应该是 X 不是 Y"）→ true
- 用户**重发同样指令**或换问法（一定程度暗示上次失败）→ true（标 reason 为"行为信号"）
- 用户中性继续话题、提新问题、表达感谢 → false
- 用户对 skill **无关的事**抱怨 → false（如抱怨网络慢、平台 bug）

严格度：宁可漏检（false），不可过判（true）。当不确定，输出 false。`;

/**
 * LLM 二级负反馈检测（regex 漏检的兜底）。
 *
 * 流程：构造 prompt → 调 secondary LLM → JSON.parse 鲁棒解析 → 返回标准 SignalDetectionResult。
 * 失败安全：解析失败 / LLM 抛错 → 返回 signal: 'none'，永不抛。
 */
export async function detectFeedbackSignalViaLLM(
  input: LLMSignalDetectionInput,
): Promise<SignalDetectionResult> {
  const text = input.userMessage.trim();
  if (!text) return { signal: 'none' };

  // 时间窗约束（与 regex 版一致）
  const now = input.now ?? new Date();
  const windowMs = (input.windowMinutes ?? DEFAULT_WINDOW_MINUTES) * 60_000;
  const cutoff = now.getTime() - windowMs;
  const candidateSkills = input.recentSkillUsages
    .filter(u => {
      const ts = Date.parse(u.invokedAt);
      return Number.isFinite(ts) && ts >= cutoff;
    })
    .map(u => u.skillName);
  if (candidateSkills.length === 0) return { signal: 'none' };

  const recentSkillsList = Array.from(new Set(candidateSkills)).join(', ');
  const userMessage = text.slice(0, MAX_EVIDENCE_LEN);
  const lastAssistant = input.lastAssistantMessage?.slice(0, 300) ?? '(无)';

  const userPrompt = `[最近 ${input.windowMinutes ?? DEFAULT_WINDOW_MINUTES} 分钟内 invoke 过的 skill]
${recentSkillsList}

[上一条 assistant 回复（可能调用了上述某个 skill）]
${lastAssistant}

[用户当前消息]
${userMessage}

输出 JSON：`;

  let llmRaw: string;
  try {
    llmRaw = await input.llmCall(LLM_SYSTEM_PROMPT, userPrompt);
  } catch {
    return { signal: 'none' };
  }

  const parsed = parseLLMOutput(llmRaw);
  if (!parsed || !parsed.negative) return { signal: 'none' };

  // skillName 必须在候选列表里（防 LLM 幻觉编一个新 skill 名）
  const skillName = candidateSkills.find(s => s === parsed.skillName)
    ?? candidateSkills[candidateSkills.length - 1]; // 兜底：取最近一条
  if (!skillName) return { signal: 'none' };

  return {
    signal: 'strong',
    skillName,
    evidence: text.slice(0, MAX_EVIDENCE_LEN),
    matchedPattern: `llm-classifier:${parsed.reason.slice(0, 30)}`,
  };
}

/** 鲁棒解析 LLM JSON 输出（容忍 markdown fence + 前后 noise）*/
function parseLLMOutput(raw: string): { negative: boolean; skillName: string; reason: string } | null {
  if (!raw) return null;
  // 优先匹配第一对花括号包裹的 JSON
  const start = raw.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          const obj = JSON.parse(raw.slice(start, i + 1)) as Record<string, unknown>;
          const negative = obj['negative'];
          if (typeof negative !== 'boolean') return null;
          const skillName = typeof obj['skillName'] === 'string' ? obj['skillName'] : '';
          const reason = typeof obj['reason'] === 'string' ? obj['reason'] : '';
          return { negative, skillName, reason };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
