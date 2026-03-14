import type { SatisfactionSignal } from '@evoclaw/shared';

/** 正面信号及权重 */
const POSITIVE_SIGNALS: [string, number][] = [
  ['谢谢', 0.2],
  ['完美', 0.2],
  ['太棒了', 0.2],
  ['不错', 0.15],
  ['很好', 0.15],
  ['感谢', 0.2],
  ['great', 0.2],
  ['perfect', 0.2],
  ['thanks', 0.2],
  ['awesome', 0.2],
  ['excellent', 0.2],
  ['good job', 0.15],
  ['👍', 0.2],
  ['❤️', 0.15],
  ['🎉', 0.15],
];

/** 负面信号及权重 */
const NEGATIVE_SIGNALS: [string, number][] = [
  ['不对', -0.3],
  ['重来', -0.3],
  ['错了', -0.3],
  ['有问题', -0.2],
  ['不行', -0.25],
  ['wrong', -0.3],
  ['redo', -0.3],
  ['incorrect', -0.3],
  ['fix this', -0.25],
  ['not right', -0.25],
  ['bug', -0.2],
  ['👎', -0.3],
];

/**
 * 从消息中检测满意度信号
 * 仅分析用户消息（role === 'user'）
 */
export function detectSatisfaction(
  messages: { role: string; content: string }[],
): SatisfactionSignal {
  const userMessages = messages.filter((m) => m.role === 'user');

  if (userMessages.length === 0) {
    return { score: 0.5, signals: [] };
  }

  // 取最后 3 条用户消息
  const recentMessages = userMessages.slice(-3);
  const text = recentMessages.map((m) => m.content).join(' ').toLowerCase();
  const detectedSignals: string[] = [];
  let delta = 0;

  for (const [keyword, weight] of POSITIVE_SIGNALS) {
    if (text.includes(keyword.toLowerCase())) {
      detectedSignals.push(keyword);
      delta += weight;
    }
  }

  for (const [keyword, weight] of NEGATIVE_SIGNALS) {
    if (text.includes(keyword.toLowerCase())) {
      detectedSignals.push(keyword);
      delta += weight; // weight 已经是负数
    }
  }

  // 基准 0.5 + delta，clamp 到 [0, 1]
  const score = Math.max(0, Math.min(1, 0.5 + delta));

  return { score, signals: detectedSignals };
}
