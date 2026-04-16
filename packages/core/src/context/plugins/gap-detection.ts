/**
 * 能力缺口检测插件 — afterTurn 检测 Agent 回复中的"无法完成"信号
 *
 * priority: 80（在其他插件之后执行）
 *
 * 检测 Agent 回复中是否包含无法完成的信号，分析是否因为缺少 Skill/工具，
 * 自动搜索匹配 Skill → 推荐给用户。
 */

import type { ContextPlugin, TurnContext } from '../plugin.interface.js';
import type { ChatMessage, SkillSearchResult } from '@evoclaw/shared';
import type { SkillDiscoverer } from '../../skill/skill-discoverer.js';

/** "无法完成"信号模式 */
const INABILITY_PATTERNS = [
  /我(?:目前|暂时)?无法(?:直接)?(?:完成|执行|处理|实现|做到)/,
  /我(?:没有|不具备)(?:这个|该)?(?:能力|功能|权限|工具)/,
  /(?:超出|不在).*(?:能力|功能)(?:范围|之外)/,
  /(?:很抱歉|对不起).*(?:无法|不能)(?:帮你|为你)/,
  /I (?:can't|cannot|don't have|am unable to)/i,
  /(?:unfortunately|sorry).*(?:unable|cannot|can't)/i,
  /(?:不支持|未安装|缺少)(?:相关)?(?:工具|插件|扩展)/,
  /需要(?:安装|配置|启用)(?:额外的|其他的)?(?:工具|插件)/,
];

/** 能力缺口检测结果 */
export interface GapDetectionResult {
  /** 是否检测到能力缺口 */
  detected: boolean;
  /** 匹配的模式 */
  matchedPattern?: string;
  /** 原始消息片段 */
  snippet?: string;
  /** 推荐的 Skill 搜索词 */
  suggestedQuery?: string;
  /** 推荐的 Skills */
  recommendations?: SkillSearchResult[];
}

/** 创建能力缺口检测插件 */
export function createGapDetectionPlugin(discoverer?: SkillDiscoverer): ContextPlugin {
  // 存储最近的检测结果（供 API 查询）
  const recentGaps = new Map<string, GapDetectionResult>();

  return {
    name: 'gap-detection',
    priority: 80,

    async afterTurn(ctx: TurnContext) {
      // 找到最后一条 assistant 消息
      const lastAssistantMsg = [...ctx.messages].reverse().find(m => m.role === 'assistant');
      if (!lastAssistantMsg) return;

      const content = lastAssistantMsg.content;
      const result = detectGap(content);

      if (!result.detected) {
        recentGaps.delete(ctx.agentId);
        return;
      }

      // 尝试从上下文提取搜索关键词
      const lastUserMsg = [...ctx.messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg) {
        result.suggestedQuery = extractSearchQuery(lastUserMsg.content);
      }

      // 如果有发现器，搜索推荐 Skill
      if (discoverer && result.suggestedQuery) {
        try {
          result.recommendations = await discoverer.search(result.suggestedQuery, 3);
        } catch {
          // 搜索失败不影响主流程
        }
      }

      recentGaps.set(ctx.agentId, result);
    },

    async compact(): Promise<ChatMessage[]> {
      return [];
    },
  };
}

/** 检测回复中是否存在能力缺口信号 */
export function detectGap(content: string): GapDetectionResult {
  for (const pattern of INABILITY_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      // 提取匹配位置前后 50 字符作为 snippet
      const idx = content.indexOf(match[0]);
      const start = Math.max(0, idx - 30);
      const end = Math.min(content.length, idx + match[0].length + 30);
      const snippet = content.slice(start, end);

      return {
        detected: true,
        matchedPattern: pattern.source,
        snippet,
      };
    }
  }

  return { detected: false };
}

/** 从用户消息中提取搜索关键词 */
function extractSearchQuery(userContent: string): string {
  // 简单策略：取用户消息的前 3 个有意义的词
  const words = userContent
    .replace(/[^\u4e00-\u9fff\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1)
    .slice(0, 5);

  return words.join(' ').slice(0, 50);
}
