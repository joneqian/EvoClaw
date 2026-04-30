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
